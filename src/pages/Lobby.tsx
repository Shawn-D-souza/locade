import { useEffect, useRef } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { peerService } from '../platform/network/peerService';
import { useNetworkStore } from '../platform/store/useNetworkStore';
import QRCode from 'react-qr-code';

export default function Lobby() {
  const { lobbyId } = useParams<{ lobbyId: string }>();
  const location = useLocation();
  const { status, errorMessage, peers } = useNetworkStore();
  const initialized = useRef(false);
  const currentUrl = window.location.href;

  useEffect(() => {
    if (!lobbyId || initialized.current) return;
    initialized.current = true;
    
    // Default to guest if not explicitly started as host
    const isHosting = location.state?.isHost === true;

    if (isHosting) {
      peerService.initializeHost(lobbyId);
    } else {
      peerService.joinLobby(lobbyId);
    }

    return () => {
      peerService.disconnect();
      initialized.current = false;
    };
  }, [lobbyId, location.state]);

  return (
    <div className="p-4">
      <h1>Party Lobby</h1>
      <p>Room Code: <strong>{lobbyId}</strong></p>
      
      <div style={{ marginTop: '16px', marginBottom: '16px' }}>
        <QRCode value={currentUrl} />
      </div>

      <div className="my-4">
        <p>Status: {status}</p>
        {errorMessage && <p className="text-red-500">Error: {errorMessage}</p>}
      </div>

      <div className="my-4">
        <h2>Players</h2>
        <ul>
          {peers.map((peer) => (
            <li key={peer.id}>
              {peer.name} {peer.isHost && '(Host)'}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
