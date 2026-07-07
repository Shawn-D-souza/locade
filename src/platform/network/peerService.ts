import { Peer, DataConnection } from 'peerjs';
import { useNetworkStore } from '../store/useNetworkStore';
import { useUser } from '../store/useUserStore';

class PeerService {
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();

  // 1. Initialize as Host
  public initializeHost(partyId: string) { // partyId comes in as "123456"
    const { userId, userName } = useUser.getState();
    const networkStore = useNetworkStore.getState();

    networkStore.setStatus('connecting');

    // Create the prefixed network ID
    const networkId = `locade-${partyId}`;

    // Use the prefixed ID for the actual Peer connection
    this.peer = new Peer(networkId, {
      debug: 2
    });

    this.peer.on('open', (id) => {
      // id will be "locade-123456"
      console.log('Host connection open with ID:', id);
      
      // Save the clean partyId (123456) to the store for the UI, not the network ID
      networkStore.setPartyDetails(partyId, true); 
      networkStore.setStatus('connected');
      
      // Add the host to their own roster
      networkStore.addPeer({ id: userId, name: userName, isHost: true });
    });

    this.peer.on('connection', (conn) => {
      this.handleIncomingConnection(conn);
    });

    this.peer.on('error', (err) => {
      console.error('PeerJS Error:', err);
      networkStore.setStatus('error', err.message);
    });
  }

  // Helper to manage incoming guest connections
  private handleIncomingConnection(conn: DataConnection) {
    const networkStore = useNetworkStore.getState();

    conn.on('open', () => {
      console.log(`Guest connected: ${conn.peer}`);
      this.connections.set(conn.peer, conn);
      
      // We'll need a handshake mechanism later to get their actual userName,
      // but for now, we add them to the store with a placeholder.
      networkStore.addPeer({ id: conn.peer, name: 'Guest Joining...', isHost: false });
    });

    conn.on('data', (data) => {
      console.log('Received data from guest:', data);
      // TODO: Handle incoming game state or chat messages here
    });

    conn.on('close', () => {
      console.log(`Guest disconnected: ${conn.peer}`);
      this.connections.delete(conn.peer);
      networkStore.removePeer(conn.peer);
    });
  }

  // Clean up
  public disconnect() {
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.connections.clear();
    useNetworkStore.getState().resetNetwork();
  }
}

// Export a single instance to be used globally
export const peerService = new PeerService();
