import { useEffect, useRef } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { peerService } from '../platform/network/peerService';
import { useNetworkStore } from '../platform/store/useNetworkStore';
import QRCode from 'react-qr-code';
import { GAME_REGISTRY } from '../games/registry';
import GameShell from '../features/game-shell/GameShell';

export default function Lobby() {
  const { lobbyId } = useParams<{ lobbyId: string }>();
  const location = useLocation();
  const { status, errorMessage, peers, isHost, gameState, activeGameId } = useNetworkStore();
  const initialized = useRef(false);
  const currentUrl = window.location.href;

  const totalPlayers = peers.length; 

  const handleStartGame = (gameId: string) => {
    const game = GAME_REGISTRY[gameId];
    if (!game) return;
    
    const canStart = totalPlayers >= game.minPlayers && totalPlayers <= game.maxPlayers;

    if (canStart && isHost) {
      peerService.broadcast({ type: 'START_GAME', payload: { gameId } });
      useNetworkStore.setState({ gameState: 'game', activeGameId: gameId });
    }
  };

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

  if (gameState === 'game' && activeGameId) {
    const ActiveGameComponent = GAME_REGISTRY[activeGameId]?.component;
    if (ActiveGameComponent) {
      return <GameShell GameComponent={ActiveGameComponent} />;
    } else {
      return <div>Game component not found for {activeGameId}!</div>;
    }
  }

  return (
    <div>
      <h1>Party Lobby</h1>
      <p>Room Code: <strong>{lobbyId}</strong></p>
      
      <div style={{ marginTop: '16px', marginBottom: '16px' }}>
        <QRCode value={currentUrl} />
      </div>

      <div>
        <p>Status: {status}</p>
        {errorMessage && <p>Error: {errorMessage}</p>}
      </div>

      <div>
        <h2>Players</h2>
        <ul>
          {peers.map((peer) => (
            <li key={peer.id}>
              {peer.name} {peer.isHost && '(Host)'}
            </li>
          ))}
        </ul>
      </div>

      {isHost && (
        <div>
          <h2>Available Games</h2>
          <div>
            {Object.values(GAME_REGISTRY).map((game) => {
              const hasEnoughPlayers = totalPlayers >= game.minPlayers;
              const hasTooManyPlayers = totalPlayers > game.maxPlayers;
              const canStartGame = hasEnoughPlayers && !hasTooManyPlayers;

              return (
                <div key={game.id} onClick={() => canStartGame && handleStartGame(game.id)}>
                  <h3>{game.name}</h3>
                  <p>Players: {game.minPlayers} - {game.maxPlayers}</p>
                  
                  {!hasEnoughPlayers && (
                    <p>Waiting for more players ({totalPlayers}/{game.minPlayers})</p>
                  )}
                  {hasTooManyPlayers && (
                    <p>Too many players ({totalPlayers}/{game.maxPlayers})</p>
                  )}
                  {canStartGame && (
                    <p>Click to start playing!</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
