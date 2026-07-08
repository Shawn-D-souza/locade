import { Peer, type DataConnection } from 'peerjs';
import { useNetworkStore, type PeerPlayer } from '../store/useNetworkStore';
import { useUser } from '../store/useUserStore';

// Strict typing for network data payloads
type PeerMessage =
  | { type: 'HELLO'; payload: { id: string; name: string } }
  | { type: 'ROSTER_UPDATE'; payload: PeerPlayer[] };

class PeerService {
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  private hostConnection: DataConnection | null = null;

  // Helper to generate the unique namespace key
  private getNetworkId(partyId: string): string {
    return `locade-${partyId.toUpperCase()}`;
  }

  /**
   * Initialize as Host
   */
  public initializeHost(partyId: string) {
    const { userId, userName } = useUser.getState();
    const networkStore = useNetworkStore.getState();

    networkStore.setStatus('connecting');

    const networkId = this.getNetworkId(partyId);

    this.peer = new Peer(networkId, {
      debug: 2,
    });

    this.peer.on('open', () => {
      console.log('Host connection running with network ID:', networkId);
      networkStore.setPartyDetails(partyId, true);
      networkStore.setStatus('connected');
      
      // Seed roster with the host themselves
      networkStore.addPeer({ id: userId, name: userName, isHost: true });
    });

    this.peer.on('connection', (conn) => {
      this.handleIncomingConnection(conn);
    });

    this.peer.on('error', (err) => {
      console.error('PeerJS Host Error:', err);
      networkStore.setStatus('error', err.message);
    });
  }

  /**
   * Initialize as Guest & Connect to Host
   */
  public joinParty(partyId: string) {
    const networkStore = useNetworkStore.getState();
    networkStore.setStatus('connecting');

    // Guests let PeerJS generate a clean random cloud ID for their own node
    this.peer = new Peer({
      debug: 2,
    });

    this.peer.on('open', (guestPeerId) => {
      console.log('Guest node initialized with cloud ID:', guestPeerId);
      
      const hostNetworkId = this.getNetworkId(partyId);
      const conn = this.peer!.connect(hostNetworkId);
      
      this.handleHostConnection(conn, partyId);
    });

    this.peer.on('error', (err) => {
      console.error('PeerJS Guest Error:', err);
      networkStore.setStatus('error', err.message);
    });
  }

  /**
   * Host handling incoming connections
   */
  private handleIncomingConnection(conn: DataConnection) {
    const networkStore = useNetworkStore.getState();

    conn.on('open', () => {
      console.log(`Connection established with node: ${conn.peer}`);
      this.connections.set(conn.peer, conn);
      
      // Temporary placeholder until handshake payload is received
      networkStore.addPeer({ id: conn.peer, name: 'Guest Joining...', isHost: false });
    });

    conn.on('data', (data) => {
      const message = data as PeerMessage;
      console.log('Host received message:', message);

      if (message.type === 'HELLO') {
        const { id: realUserId, name: realUserName } = message.payload;
        
        // Remap connection map key from the raw PeerJS ID to their true stable user UUID
        this.connections.delete(conn.peer);
        this.connections.set(realUserId, conn);

        // Update host's local Zustand state with true identification
        networkStore.removePeer(conn.peer); // Drop placeholder
        networkStore.addPeer({ id: realUserId, name: realUserName, isHost: false });

        // Broadcast updated full state roster to all connected guests
        this.broadcastToAllGuests({
          type: 'ROSTER_UPDATE',
          payload: useNetworkStore.getState().peers
        });
      }
    });

    conn.on('close', () => {
      console.log(`Connection dropped: ${conn.peer}`);
      
      // Find and remove connection reference using key lookup
      let targetUserId = conn.peer;
      for (const [userId, connection] of this.connections.entries()) {
        if (connection === conn) {
          targetUserId = userId;
          break;
        }
      }

      this.connections.delete(targetUserId);
      networkStore.removePeer(targetUserId);

      // Notify remaining guests of roster changes
      this.broadcastToAllGuests({
        type: 'ROSTER_UPDATE',
        payload: useNetworkStore.getState().peers
      });
    });
  }

  /**
   * Guest handling connection to Host
   */
  private handleHostConnection(conn: DataConnection, partyId: string) {
    const { userId, userName } = useUser.getState();
    const networkStore = useNetworkStore.getState();
    this.hostConnection = conn;

    conn.on('open', () => {
      console.log('Connected to Host data channel safely.');
      networkStore.setPartyDetails(partyId, false);
      networkStore.setStatus('connected');

      // Executing Handshake: Send true profile identity immediately
      const handshake: PeerMessage = {
        type: 'HELLO',
        payload: { id: userId, name: userName }
      };
      conn.send(handshake);
    });

    conn.on('data', (data) => {
      const message = data as PeerMessage;
      console.log('Guest received message:', message);

      if (message.type === 'ROSTER_UPDATE') {
        // Sync entire peer list directly to local store state from the authoritative source (Host)
        useNetworkStore.setState({ peers: message.payload });
      }
    });

    conn.on('close', () => {
      console.warn('Host disconnected. Network session closing.');
      this.disconnect();
      networkStore.setStatus('error', 'The host has disconnected.');
    });
  }

  /**
   * Utilities & Broadcasting 
   */
  private broadcastToAllGuests(message: PeerMessage) {
    this.connections.forEach((conn) => {
      if (conn.open) {
        conn.send(message);
      }
    });
  }

  public disconnect() {
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    if (this.hostConnection) {
      this.hostConnection.close();
      this.hostConnection = null;
    }
    this.connections.clear();
    useNetworkStore.getState().resetNetwork();
  }
}

export const peerService = new PeerService();
