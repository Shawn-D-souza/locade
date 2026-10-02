import { Peer, type DataConnection } from 'peerjs';
import { useNetworkStore, type PeerPlayer } from '../store/useNetworkStore';
import { useUser } from '../store/useUserStore';
import { lobbyAudioManager } from '../audio/lobbyAudioManager';

// Strict typing for network data payloads
type PeerMessage =
  | { type: 'HELLO'; payload: { id: string; name: string } }
  | { type: 'ROSTER_UPDATE'; payload: PeerPlayer[] }
  | { type: 'START_GAME'; payload: { gameId: string } }
  | { type: 'END_GAME'; payload: null }
  | { type: 'AUDIO_SYNC'; payload: { trackPosition: number; sentAt: number } }
  | { type: 'GAME_DATA'; payload: unknown }
  | { type: 'REQUEST_SNAPSHOT'; payload: null }
  | { type: 'PING'; payload: { timestamp: number } }
  | { type: 'PONG'; payload: { timestamp: number } };

/**
 * How long a dropped player keeps their seat. Covers a WiFi roam, a walk through
 * a dead spot, an app switch, or a page reload. Used on both sides: the guest
 * retries for this long, and the host holds the roster entry for this long.
 */
const GRACE_PERIOD_MS = 30_000;

/** No PONG for this long (while we're in the foreground) means a zombie channel. */
const PONG_TIMEOUT_MS = 6_000;

const PING_INTERVAL_MS = 2_000;

/**
 * PeerJS errors that genuinely cannot be retried. Everything else — notably
 * `network` (lost the signalling server, which does not affect established data
 * channels), `unavailable-id` (explicitly documented as non-fatal while
 * connections are open) and `peer-unavailable` (host not registered yet) — is
 * recoverable and routes through the reconnect path instead of killing the game.
 */
const FATAL_PEER_ERRORS = new Set([
  'browser-incompatible',
  'invalid-id',
  'invalid-key',
  'ssl-unavailable',
]);

const PEER_CONFIG = {
  debug: 2,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
    ]
  }
};

class PeerService {
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  private hostConnection: DataConnection | null = null;
  private audioSyncInterval: number | null = null;
  private pingInterval: number | null = null;
  public estimatedLatency: number = 0;

  // ── Reconnect bookkeeping ──────────────────────────────────────────────────
  private lobbyId: string | null = null;
  /** Set by disconnect() so a self-inflicted ICE `closed` isn't read as a drop. */
  private intentionalTeardown = false;
  /** Distinguishes "lobby never existed" from "we lost a working connection". */
  private hasConnected = false;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  /** Absolute time the grace window expires; null when not reconnecting. */
  private graceDeadline: number | null = null;
  private lastPongAt = 0;

  // ── Host-side state ────────────────────────────────────────────────────────
  /** Pending seat expiries, keyed by stable userId. */
  private peerRemovalTimers: Map<string, number> = new Map();
  /**
   * Last full game snapshot the host broadcast. Every game in the registry is
   * host-authoritative and publishes complete state as `type: 'SYNC'`, so
   * replaying this one message fully restores a rejoining player with no
   * game-specific logic.
   */
  private lastGameSnapshot: PeerMessage | null = null;

  // Helper to generate the unique namespace key
  private getNetworkId(lobbyId: string): string {
    return `locade-${lobbyId.toUpperCase()}`;
  }

  /**
   * Initialize as Host
   */
  public initializeHost(lobbyId: string) {
    const { userId, userName } = useUser.getState();
    const networkStore = useNetworkStore.getState();

    networkStore.setStatus('connecting');

    this.lobbyId = lobbyId;
    this.intentionalTeardown = false;
    const networkId = this.getNetworkId(lobbyId);

    this.peer = new Peer(networkId, PEER_CONFIG);

    this.peer.on('open', () => {
      console.log('Host connection running with network ID:', networkId);
      this.hasConnected = true;
      networkStore.setLobbyDetails(lobbyId, true);
      networkStore.setStatus('connected');

      // Seed roster with the host themselves
      networkStore.addPeer({ id: userId, name: userName, isHost: true, connected: true });

      // Start the lightweight audio synchronization heartbeat
      this.startAudioSync();
    });

    this.peer.on('connection', (conn) => {
      this.handleIncomingConnection(conn);
    });

    // Signalling-server loss only. Existing data channels are peer-to-peer and
    // keep working, so we quietly restore the broker rather than ending the game.
    this.peer.on('disconnected', () => {
      if (this.intentionalTeardown) return;
      console.warn('Host lost the signalling server; reconnecting broker.');
      try {
        this.peer?.reconnect();
      } catch (err) {
        console.error('Host broker reconnect failed:', err);
      }
    });

    this.peer.on('error', (err) => {
      console.error('PeerJS Host Error:', err.type, err.message);
      if (FATAL_PEER_ERRORS.has(err.type)) {
        networkStore.setStatus('error', err.message);
        return;
      }
      // Non-fatal: the broker may be flaky, but guests already connected stay
      // connected. Leave the lobby running.
    });
  }

  /**
   * Initialize as Guest & Connect to Host
   */
  public joinLobby(lobbyId: string) {
    this.lobbyId = lobbyId;
    this.intentionalTeardown = false;
    this.hasConnected = false;
    this.reconnectAttempt = 0;
    this.graceDeadline = null;

    useNetworkStore.getState().setStatus('connecting');
    this.createGuestPeer(lobbyId);
  }

  /** Builds a fresh guest node and dials the host as soon as the broker is up. */
  private createGuestPeer(lobbyId: string) {
    // Guests let PeerJS generate a clean random cloud ID for their own node
    this.peer = new Peer(PEER_CONFIG);

    this.peer.on('open', (guestPeerId) => {
      console.log('Guest node initialized with cloud ID:', guestPeerId);
      this.dialHost(lobbyId);
    });

    this.peer.on('disconnected', () => {
      if (this.intentionalTeardown) return;
      console.warn('Guest lost the signalling server.');
      // Don't tear anything down: the data channel to the host is direct and may
      // still be fine. We only need the broker back to negotiate a *new*
      // connection, which the reconnect path handles when it actually needs it.
      try {
        this.peer?.reconnect();
      } catch (err) {
        console.error('Guest broker reconnect failed:', err);
      }
    });

    this.peer.on('error', (err) => {
      console.error('PeerJS Guest Error:', err.type, err.message);
      if (FATAL_PEER_ERRORS.has(err.type)) {
        useNetworkStore.getState().setStatus('error', err.message);
        return;
      }
      // `peer-unavailable` here also covers opening a QR link before the host's
      // peer is registered, which used to hard-fail on the first attempt.
      this.beginReconnect(`peer error: ${err.type}`);
    });
  }

  private dialHost(lobbyId: string) {
    if (!this.peer || this.peer.destroyed) return;
    this.teardownHostConnection();
    const conn = this.peer.connect(this.getNetworkId(lobbyId));
    this.handleHostConnection(conn, lobbyId);
  }

  /**
   * Host handling incoming connections
   */
  private handleIncomingConnection(conn: DataConnection) {
    const networkStore = useNetworkStore.getState();

    conn.on('open', () => {
      console.log(`Connection established with node: ${conn.peer}`);
      this.connections.set(conn.peer, conn);

      // Only show a placeholder row in the lobby. Mid-game this would flash a
      // bogus extra player into the roster while a known player reconnects.
      if (useNetworkStore.getState().gameState === 'lobby') {
        networkStore.addPeer({
          id: conn.peer,
          name: 'Guest Joining...',
          isHost: false,
          connected: true
        });
      }

      // Watch this guest's transport directly. ICE events are driven by the
      // connection itself rather than by a timer, so they stay accurate even
      // when either device throttles background tasks.
      this.watchIce(conn, {
        onFailed: () => this.handleGuestGone(conn),
      });
    });

    conn.on('data', (data) => {
      const message = data as PeerMessage;
      console.log('Host received message:', message);

      if (message.type === 'HELLO') {
        this.admitGuest(conn, message.payload);
        return;
      }

      if (message.type === 'PING') {
        // Host responds to PING with PONG immediately
        conn.send({ type: 'PONG', payload: message.payload });
        return;
      }

      if (message.type === 'REQUEST_SNAPSHOT') {
        this.sendSnapshot(conn);
        return;
      }

      if (message.type === 'GAME_DATA') {
        // Update local game state with incoming data
        useNetworkStore.setState({ incomingGameData: message.payload });

        // Relay game data to other connected clients
        this.connections.forEach((c) => {
          if (c.open && c !== conn) {
            c.send(message);
          }
        });
      }
    });

    conn.on('close', () => {
      console.log(`Connection dropped: ${conn.peer}`);
      this.handleGuestGone(conn);
    });
  }

  /**
   * Host: a guest finished its handshake. Covers both a brand-new player and one
   * returning inside their grace window — they're told apart by the stable
   * `userId` from the guest's persisted profile.
   */
  private admitGuest(conn: DataConnection, profile: { id: string; name: string }) {
    const networkStore = useNetworkStore.getState();
    const { id: realUserId, name: realUserName } = profile;

    const existing = useNetworkStore.getState().peers.find((p) => p.id === realUserId);
    const isReturning = existing !== undefined;

    // They made it back in time — cancel the seat expiry.
    const pendingRemoval = this.peerRemovalTimers.get(realUserId);
    if (pendingRemoval !== undefined) {
      clearTimeout(pendingRemoval);
      this.peerRemovalTimers.delete(realUserId);
    }

    // Drop any stale connection object still held under this user's id.
    const stale = this.connections.get(realUserId);
    if (stale && stale !== conn) {
      try {
        stale.close();
      } catch { /* already gone */ }
    }

    // Remap connection map key from the raw PeerJS ID to their true stable user UUID
    this.connections.delete(conn.peer);
    this.connections.set(realUserId, conn);

    // Drop the placeholder row keyed by the raw peer id (guard: a guest's cloud
    // id is never equal to their profile uuid, but don't risk self-removal).
    if (conn.peer !== realUserId) {
      networkStore.removePeer(conn.peer);
    }

    // addPeer upserts in place, so a returning player keeps their roster index
    // and therefore their seat, quadrant and colour.
    networkStore.addPeer({
      id: realUserId,
      name: realUserName,
      isHost: false,
      connected: true
    });

    console.log(isReturning ? `Guest ${realUserName} reconnected.` : `Guest ${realUserName} joined.`);

    // Broadcast updated full state roster to all connected guests
    this.broadcastToAllGuests({
      type: 'ROSTER_UPDATE',
      payload: useNetworkStore.getState().peers
    });

    const { gameState, activeGameId } = useNetworkStore.getState();

    if (gameState === 'lobby') {
      // Immediately sync the joining guest to the current host audio timeline
      conn.send({
        type: 'AUDIO_SYNC',
        payload: { trackPosition: lobbyAudioManager.getCurrentPosition(), sentAt: Date.now() }
      });
      return;
    }

    // A game is in progress. Tell them which one so they mount it; their
    // GameShell then pulls the snapshot once it's ready to receive it.
    if (activeGameId) {
      conn.send({ type: 'START_GAME', payload: { gameId: activeGameId } });
    }
  }

  /** Host: replay the latest authoritative snapshot to one guest. */
  private sendSnapshot(conn: DataConnection) {
    if (!this.lastGameSnapshot || !conn.open) return;
    console.log('Replaying game snapshot to', conn.peer);
    conn.send(this.lastGameSnapshot);
  }

  /**
   * Host: a guest's transport died. Keep their seat (and their tokens) for the
   * grace window so a blip or a page reload doesn't bench them.
   */
  private handleGuestGone(conn: DataConnection) {
    const networkStore = useNetworkStore.getState();

    // Find the stable user id this connection was filed under.
    let targetUserId = conn.peer;
    for (const [userId, connection] of this.connections.entries()) {
      if (connection === conn) {
        targetUserId = userId;
        break;
      }
    }

    // Already being handled (ICE failure and 'close' both fire for one drop).
    if (this.peerRemovalTimers.has(targetUserId)) return;

    this.connections.delete(targetUserId);

    const known = useNetworkStore.getState().peers.some((p) => p.id === targetUserId);
    if (!known) return;

    networkStore.markPeerConnected(targetUserId, false);
    this.broadcastToAllGuests({
      type: 'ROSTER_UPDATE',
      payload: useNetworkStore.getState().peers
    });

    const timer = window.setTimeout(() => {
      this.peerRemovalTimers.delete(targetUserId);
      console.log(`Grace window expired for ${targetUserId}; releasing seat.`);
      useNetworkStore.getState().removePeer(targetUserId);
      this.broadcastToAllGuests({
        type: 'ROSTER_UPDATE',
        payload: useNetworkStore.getState().peers
      });
    }, GRACE_PERIOD_MS);

    this.peerRemovalTimers.set(targetUserId, timer);
  }

  /**
   * Guest handling connection to Host
   */
  private handleHostConnection(conn: DataConnection, lobbyId: string) {
    const { userId, userName } = useUser.getState();
    const networkStore = useNetworkStore.getState();
    this.hostConnection = conn;

    conn.on('open', () => {
      console.log('Connected to Host data channel safely.');
      this.onReconnected();
      networkStore.setLobbyDetails(lobbyId, false);

      this.watchIce(conn, {
        // `disconnected` is recoverable by design: the ICE agent stopped getting
        // connectivity-check responses and is expected to come back on its own.
        // Flag it, start the clock, and let onIceRecovered() undo it.
        onTransient: () => this.beginReconnect('ICE disconnected', { dialNow: false }),
        onFailed: () => this.beginReconnect('ICE failed'),
        onRecovered: () => this.onReconnected(),
      });

      // Executing Handshake: Send true profile identity immediately
      const handshake: PeerMessage = {
        type: 'HELLO',
        payload: { id: userId, name: userName }
      };
      conn.send(handshake);

      // If we dropped mid-game our GameShell is still mounted and will never
      // re-run its mount effect, so ask for a fresh snapshot here too.
      if (useNetworkStore.getState().gameState === 'game') {
        conn.send({ type: 'REQUEST_SNAPSHOT', payload: null });
      }

      // Start pinging host to measure latency and detect a zombie channel
      this.lastPongAt = Date.now();
      this.startPing(conn);
    });

    conn.on('data', (data) => {
      const message = data as PeerMessage;
      console.log('Guest received message:', message);

      if (message.type === 'ROSTER_UPDATE') {
        // Sync entire peer list directly to local store state from the authoritative source (Host)
        useNetworkStore.setState({ peers: message.payload });
      }

      if (message.type === 'AUDIO_SYNC') {
        const { gameState } = useNetworkStore.getState();
        // Only synchronize if in lobby state; zero impact during gameplay
        if (gameState === 'lobby') {
          // Use the smoothed RTT/2 latency estimate for transit compensation.
          // The old approach (Date.now() - sentAt) compared clocks across
          // devices, but machine clocks aren't synchronized — the offset
          // between two devices is typically 100ms–2s, creating phantom
          // drift that triggers constant hard corrections every 5s pulse.
          const transitSec = this.estimatedLatency / 1000;
          lobbyAudioManager.syncTo(message.payload.trackPosition + transitSec);
        }
      }

      if (message.type === 'PONG') {
        this.lastPongAt = Date.now();
        // Calculate one-way latency (RTT / 2)
        const rtt = Date.now() - message.payload.timestamp;
        const oneWay = rtt / 2;
        // Smooth latency estimate using exponential moving average
        this.estimatedLatency = this.estimatedLatency === 0 ? oneWay : this.estimatedLatency * 0.8 + oneWay * 0.2;
      }

      if (message.type === 'START_GAME') {
        useNetworkStore.setState({ gameState: 'game', activeGameId: message.payload.gameId });
      }

      if (message.type === 'END_GAME') {
        useNetworkStore.setState({ gameState: 'lobby', activeGameId: null });
      }

      if (message.type === 'GAME_DATA') {
        useNetworkStore.setState({ incomingGameData: message.payload });
      }
    });

    conn.on('close', () => {
      if (this.intentionalTeardown) return;
      console.warn('Host data channel closed.');
      this.beginReconnect('host channel closed');
    });
  }

  private startPing(conn: DataConnection) {
    this.stopPing();
    this.pingInterval = window.setInterval(() => {
      if (!conn.open) return;
      conn.send({ type: 'PING', payload: { timestamp: Date.now() } });

      // A data channel can report `open` long after it has stopped carrying
      // traffic. Missing PONGs catch that — but only trust the signal while the
      // page is visible: backgrounded tabs have their timers throttled to as
      // little as once a minute, so our own pings stop going out and the silence
      // would say nothing about the connection.
      if (document.hidden) return;
      if (Date.now() - this.lastPongAt > PONG_TIMEOUT_MS) {
        console.warn('Host stopped answering pings.');
        this.beginReconnect('ping timeout');
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing() {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Attach an ICE state listener. Uses addEventListener rather than assigning
   * `oniceconnectionstatechange` so PeerJS's own handler isn't clobbered.
   */
  private watchIce(
    conn: DataConnection,
    handlers: { onTransient?: () => void; onFailed?: () => void; onRecovered?: () => void }
  ) {
    const pc = conn.peerConnection;
    if (!pc) return;

    pc.addEventListener('iceconnectionstatechange', () => {
      const state = pc.iceConnectionState;
      switch (state) {
        case 'connected':
        case 'completed':
          handlers.onRecovered?.();
          break;
        case 'disconnected':
          console.warn('ICE transiently disconnected.');
          handlers.onTransient?.();
          break;
        case 'failed':
          console.warn('ICE failed.');
          handlers.onFailed?.();
          break;
        case 'closed':
          // Closing a connection ourselves drives ICE here; only react when we
          // didn't ask for it.
          if (!this.intentionalTeardown) handlers.onFailed?.();
          break;
      }
    });
  }

  // ── Guest reconnect loop ───────────────────────────────────────────────────

  /**
   * Enter (or stay in) the reconnecting state. Never calls disconnect(): that
   * resets the network store, which drops `gameState` back to 'lobby', unmounts
   * GameShell and destroys the in-progress game.
   */
  private beginReconnect(reason: string, opts: { dialNow?: boolean } = {}) {
    const { dialNow = true } = opts;
    if (this.intentionalTeardown) return;
    if (useNetworkStore.getState().isHost) return;

    const alreadyReconnecting = this.graceDeadline !== null;
    if (!alreadyReconnecting) {
      console.warn(`Reconnecting (${reason}).`);
      this.graceDeadline = Date.now() + GRACE_PERIOD_MS;
      this.reconnectAttempt = 0;
      useNetworkStore.getState().setStatus('reconnecting');
    }

    if (dialNow) {
      this.scheduleReconnectAttempt();
    } else if (this.reconnectTimer === null) {
      // ICE says it may heal itself. Give it a moment before we force a redial.
      this.reconnectTimer = window.setTimeout(this.tryConnect, 2_000);
    }
  }

  private scheduleReconnectAttempt() {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.graceDeadline === null) return;

    if (Date.now() >= this.graceDeadline) {
      this.failReconnect();
      return;
    }

    // 1s, 2s, 4s, then every 5s for the rest of the window.
    const delay = Math.min(1_000 * 2 ** this.reconnectAttempt, 5_000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(this.tryConnect, delay);
  }

  private tryConnect = () => {
    this.reconnectTimer = null;
    const lobbyId = this.lobbyId;

    if (this.intentionalTeardown || this.graceDeadline === null || !lobbyId) return;
    if (Date.now() >= this.graceDeadline) {
      this.failReconnect();
      return;
    }

    // Transport gone entirely — build a fresh node. Its 'open' handler dials.
    if (!this.peer || this.peer.destroyed) {
      console.log('Rebuilding guest peer node.');
      this.createGuestPeer(lobbyId);
      this.scheduleReconnectAttempt();
      return;
    }

    // We need the broker to negotiate a new DataConnection, so get it back
    // first and retry on the next tick rather than guessing at event ordering.
    if (this.peer.disconnected) {
      console.log('Waiting on signalling server before redialling.');
      try {
        this.peer.reconnect();
      } catch {
        this.peer.destroy();
        this.peer = null;
      }
      this.scheduleReconnectAttempt();
      return;
    }

    console.log('Redialling host.');
    this.dialHost(lobbyId);
    // Watchdog: disarmed by onReconnected() if this attempt lands.
    this.scheduleReconnectAttempt();
  };

  /** A connection is live again (or was never lost). Clear the reconnect state. */
  private onReconnected() {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const wasReconnecting = this.graceDeadline !== null;
    this.graceDeadline = null;
    this.reconnectAttempt = 0;
    this.lastPongAt = Date.now();
    this.hasConnected = true;

    if (wasReconnecting) console.log('Reconnected.');
    if (useNetworkStore.getState().status !== 'connected') {
      useNetworkStore.getState().setStatus('connected');
    }
  }

  /** Grace window elapsed without getting back in. */
  private failReconnect() {
    this.graceDeadline = null;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const message = this.hasConnected
      ? 'The host has disconnected.'
      : 'Could not find that lobby.';
    console.warn(`Giving up: ${message}`);
    this.softDisconnect();
    useNetworkStore.getState().setStatus('error', message);
  }

  /** Current reconnect deadline, for the UI countdown. Null when not reconnecting. */
  public getReconnectDeadline(): number | null {
    return this.graceDeadline;
  }

  /** Whole seconds left in the grace window, or null if we aren't reconnecting. */
  public getReconnectSecondsLeft(): number | null {
    if (this.graceDeadline === null) return null;
    return Math.max(0, Math.ceil((this.graceDeadline - Date.now()) / 1000));
  }

  /**
   * Guest: ask the host to replay its latest authoritative snapshot. Called when
   * a game component mounts, which is the point at which it can actually receive
   * one — GameShell clears `incomingGameData` on mount, so a snapshot pushed
   * before then would be thrown away.
   */
  public requestSnapshot() {
    if (useNetworkStore.getState().isHost) return;
    if (this.hostConnection && this.hostConnection.open) {
      this.hostConnection.send({ type: 'REQUEST_SNAPSHOT', payload: null });
    }
  }

  /**
   * Authoritative Audio Timeline Synchronization
   */
  public startAudioSync() {
    this.stopAudioSync();

    // Send an immediate sync pulse if guests are connected
    this.sendAudioSync();

    // 5-second lightweight heartbeat: sends ~40 bytes only while host is in lobby
    this.audioSyncInterval = window.setInterval(() => {
      const { gameState, isHost } = useNetworkStore.getState();
      if (isHost && gameState === 'lobby' && this.connections.size > 0) {
        this.sendAudioSync();
      }
    }, 5000);
  }

  public stopAudioSync() {
    if (this.audioSyncInterval !== null) {
      clearInterval(this.audioSyncInterval);
      this.audioSyncInterval = null;
    }
  }

  public sendAudioSync() {
    const { isHost, gameState } = useNetworkStore.getState();
    if (!isHost || gameState !== 'lobby' || this.connections.size === 0) return;

    // Do not broadcast frozen timestamps if the host's audio context is suspended (e.g. mobile phone locked)
    if (!lobbyAudioManager.isContextRunning()) return;

    const trackPosition = lobbyAudioManager.getCurrentPosition();
    this.broadcastToAllGuests({
      type: 'AUDIO_SYNC',
      payload: { trackPosition, sentAt: Date.now() }
    });
  }

  /**
   * Utilities & Broadcasting
   */
  public broadcast(message: PeerMessage) {
    const isHost = useNetworkStore.getState().isHost;

    // Automatically manage audio sync heartbeat state on game transitions
    if (message.type === 'START_GAME') {
      this.stopAudioSync();
      this.lastGameSnapshot = null;
    } else if (message.type === 'END_GAME') {
      this.startAudioSync();
      this.lastGameSnapshot = null;
    }

    // Cache the host's authoritative snapshots so a rejoining player can be
    // restored. Every game publishes full state as 'SYNC'; their other message
    // types are per-move requests and are not worth replaying.
    if (
      isHost &&
      message.type === 'GAME_DATA' &&
      typeof message.payload === 'object' &&
      message.payload !== null &&
      (message.payload as { type?: string }).type === 'SYNC'
    ) {
      this.lastGameSnapshot = message;
    }

    if (isHost) {
      this.broadcastToAllGuests(message);
    } else {
      if (this.hostConnection && this.hostConnection.open) {
        this.hostConnection.send(message);
      }
    }
  }

  private broadcastToAllGuests(message: PeerMessage) {
    this.connections.forEach((conn) => {
      if (conn.open) {
        conn.send(message);
      }
    });
  }

  /** Closes the transport but leaves the network store (and the game) intact. */
  private softDisconnect() {
    this.stopAudioSync();
    this.stopPing();
    this.estimatedLatency = 0;
    this.teardownHostConnection();

    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.connections.clear();
  }

  private teardownHostConnection() {
    if (this.hostConnection) {
      const conn = this.hostConnection;
      this.hostConnection = null;
      try {
        conn.removeAllListeners();
        conn.close();
      } catch { /* already gone */ }
    }
  }

  public disconnect() {
    this.intentionalTeardown = true;

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.graceDeadline = null;
    this.reconnectAttempt = 0;
    this.peerRemovalTimers.forEach((timer) => clearTimeout(timer));
    this.peerRemovalTimers.clear();
    this.lastGameSnapshot = null;
    this.lobbyId = null;
    this.hasConnected = false;

    this.softDisconnect();
    useNetworkStore.getState().resetNetwork();
  }
}

export const peerService = new PeerService();
