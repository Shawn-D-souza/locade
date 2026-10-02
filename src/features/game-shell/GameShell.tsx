import { useNetworkStore } from '../../platform/store/useNetworkStore';
import { peerService } from '../../platform/network/peerService';
import type { GameProps } from '../../games/GameProps';
import React, { useEffect } from 'react';

interface GameShellProps<T = unknown> {
  GameComponent: React.ComponentType<GameProps<T>>;
}

export default function GameShell<T>({ GameComponent }: GameShellProps<T>) {
  const { incomingGameData, setGameState, isHost, clearIncomingGameData } = useNetworkStore();

  useEffect(() => {
    clearIncomingGameData();
    // Now that a game component is mounted and listening, pull the host's
    // authoritative snapshot. On a first start this is a no-op (the host has
    // nothing cached yet); after a reconnect or a page reload it restores the
    // game in progress.
    if (!isHost) peerService.requestSnapshot();
    return () => clearIncomingGameData();
  }, [clearIncomingGameData, isHost]);

  const handleSendData = (data: T) => {
    peerService.broadcast({ type: 'GAME_DATA', payload: data });
  };

  const handleGameEnd = () => {
    if (isHost) {
      setGameState('lobby');
      peerService.broadcast({ type: 'END_GAME', payload: null });
    } else {
      console.warn('Action denied: Only the host can end the game session.');
    }
  };

  return (
    <div>
      {/* This is the permanent wrapper. 
        It passes the network props down to the Game Engine. 
      */}
      <GameComponent 
        sendDataToPeers={handleSendData} 
        incomingData={incomingGameData as T | null}
        onGameEnd={handleGameEnd}
      />
    </div>
  );
}
