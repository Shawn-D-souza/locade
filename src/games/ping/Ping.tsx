import { useEffect, useState } from 'react';
import type { GameProps } from '../GameProps';

export type PingData = {
  action: 'PING';
};

export default function Ping({ sendDataToPeers, incomingData, onGameEnd }: GameProps<PingData>) {
  const [pingsReceived, setPingsReceived] = useState(0);

  useEffect(() => {
    if (incomingData?.action === 'PING') {
      setPingsReceived(prev => prev + 1);
    }
  }, [incomingData]);

  const handlePlayerAction = () => {
    sendDataToPeers({ action: 'PING' });
  };

  return (
    <div>
      <h1>PING</h1>
      <p>Pings received: {pingsReceived}</p>
      
      <button onClick={handlePlayerAction}>
        Send Ping
      </button>
      
      <button onClick={onGameEnd}>
        Quit to Lobby
      </button>
    </div>
  );
}
