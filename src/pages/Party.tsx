import { useEffect, useRef } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { peerService } from '../platform/network/peerService';
import { useNetworkStore } from '../platform/store/useNetworkStore';

export default function Party() {
  const { partyId } = useParams<{ partyId: string }>();
  const location = useLocation();
  const { status, errorMessage, peers } = useNetworkStore();
  const initialized = useRef(false);

  useEffect(() => {
    if (!partyId || initialized.current) return;
    initialized.current = true;
    
    // Default to guest if not explicitly started as host
    const isHosting = location.state?.isHost === true;

    if (isHosting) {
      peerService.initializeHost(partyId);
    } else {
      peerService.joinParty(partyId);
    }

    return () => {
      peerService.disconnect();
      initialized.current = false;
    };
  }, [partyId, location.state]);

  return (
    <div className="p-4">
      <h1>Party Lobby</h1>
      <p>Room Code: <strong>{partyId}</strong></p>
      
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
