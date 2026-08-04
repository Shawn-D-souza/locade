import { useEffect, useRef, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { peerService } from '../platform/network/peerService';
import { useNetworkStore } from '../platform/store/useNetworkStore';
import QRCode from 'react-qr-code';
import { GAME_REGISTRY } from '../games/registry';
import GameShell from '../features/game-shell/GameShell';
import { useUser } from '../platform/store/useUserStore';
import { Copy, Share2, AlertCircle, ArrowLeft, Settings } from 'lucide-react';
import InterruptionModal from '../components/InterruptionModal';
import LobbyEntrySplash from '../components/LobbyEntrySplash';
import LobbySettingsModal from '../components/LobbySettingsModal';
import { lobbyAudioManager } from '../platform/audio/lobbyAudioManager';

const PLAYER_COLORS = [
  '#FF6B6B', // P1: Action Red
  '#4D96FF', // P2: Player Blue
  '#6BCB77', // P3: Player Green
  '#FFD93D', // P4: Arcade Yellow
  '#9D4EDD', // P5: Purple
  '#FF9F43', // P6: Orange
  '#FF85B3', // P7: Pink
  '#00CFD6', // P8: Cyan
];

let disconnectTimeout: ReturnType<typeof setTimeout> | undefined;

export default function Lobby() {
  const { lobbyId } = useParams<{ lobbyId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { errorMessage, peers, isHost, gameState, activeGameId, status, resetNetwork } = useNetworkStore();
  const { userId } = useUser();
  const activeLobbyId = useRef<string | null>(null);
  const currentUrl = window.location.href;

  // Track if we need the arcade direct entry splash (for fresh QR/URL joins without previous user gesture)
  const isDirectJoin = !location.state?.userUnlocked && !lobbyAudioManager.isUnlocked();
  const [showEntrySplash, setShowEntrySplash] = useState(isDirectJoin);
  const [showSettings, setShowSettings] = useState(false);

  const totalPlayers = peers.length;

  // Background Music & Audio Sync Lifecycle Management
  useEffect(() => {
    // If not waiting on direct-entry splash and in lobby state, smoothly fade music in
    if (!showEntrySplash && gameState === 'lobby' && status !== 'connecting') {
      lobbyAudioManager.play({ fadeInDuration: 5000 });
      if (isHost) {
        peerService.startAudioSync();
      }
    } else if (gameState === 'game') {
      // Fade music out when entering an active game
      lobbyAudioManager.stop({ fadeOutDuration: 4000 });
      if (isHost) {
        peerService.stopAudioSync();
      }
    }

    return () => {
      // Fade music out if leaving lobby
      lobbyAudioManager.stop({ fadeOutDuration: 2500 });
      peerService.stopAudioSync();
    };
  }, [showEntrySplash, gameState, status, isHost]);

  // Professional Navigation: Ensure direct entry (e.g. via URL / QR / APK) has Home in history stack
  useEffect(() => {
    if (!window.history.state || window.history.state.idx === 0) {
      // Capture the original Lobby URL before we alter the history
      const originalLobbyUrl = window.location.pathname + window.location.search;

      // Replace the current entry (Index 0) with the Home screen
      window.history.replaceState({ ...window.history.state, idx: 0 }, '', '/');

      // Push the Lobby screen back on top (Index 1)
      window.history.pushState({ ...window.history.state, idx: 1 }, '', originalLobbyUrl);
    }
  }, []);

  const handleLeaveLobby = () => {
    lobbyAudioManager.stop({ fadeOutDuration: 2500 });
    peerService.disconnect();
    resetNetwork();
    navigate('/');
  };

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
    if (!lobbyId) return;

    if (activeLobbyId.current !== lobbyId) {
      // If changing lobbies, disconnect the old one
      if (activeLobbyId.current !== null) {
        peerService.disconnect();
      }

      if (disconnectTimeout) {
        clearTimeout(disconnectTimeout);
        disconnectTimeout = undefined;
      }

      activeLobbyId.current = lobbyId;

      const isHosting = location.state?.isHost === true;
      if (isHosting) {
        peerService.initializeHost(lobbyId);
      } else {
        peerService.joinLobby(lobbyId);
      }
    } else {
      // Same lobbyId remounting (React Strict Mode fix)
      if (disconnectTimeout) {
        clearTimeout(disconnectTimeout);
        disconnectTimeout = undefined;
      }
    }

    return () => {
      // Delay disconnect to gracefully handle Strict Mode remount cycles
      disconnectTimeout = setTimeout(() => {
        peerService.disconnect();
        activeLobbyId.current = null;
        disconnectTimeout = undefined;
      }, 150);
    };
  }, [lobbyId, location.state]);

  const handleCopy = () => {
    navigator.clipboard.writeText(currentUrl);
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: 'Join Locade Lobby',
        text: `Join my Locade lobby: ${lobbyId}`,
        url: currentUrl,
      });
    } else {
      handleCopy();
    }
  };

  if (status === 'connecting') {
    return (
      <div className="h-[var(--app-height,100dvh)] flex flex-col items-center justify-center p-4 font-mono gap-6 overflow-y-auto touch-auto">
        <div className="flex flex-col items-center gap-6 text-indigo-900">
          <div className="w-16 h-16 border-[6px] border-indigo-900/20 border-t-indigo-900 rounded-full animate-spin"></div>
          <h2 className="text-xl font-black uppercase tracking-widest animate-pulse">Connecting...</h2>
        </div>
        <button
          onClick={handleLeaveLobby}
          className="bg-white hover:bg-slate-100 text-indigo-900 border-2 border-indigo-900 rounded-xl px-4 py-2 font-bold shadow-[2px_2px_0_theme(colors.indigo.900)] active:shadow-none active:translate-y-[2px] active:translate-x-[2px] transition-all cursor-pointer text-sm uppercase"
        >
          Cancel
        </button>
      </div>
    );
  }

  if (gameState === 'game' && activeGameId) {
    const ActiveGameComponent = GAME_REGISTRY[activeGameId]?.component;
    if (ActiveGameComponent) {
      return (
        <>
          <InterruptionModal />
          <GameShell GameComponent={ActiveGameComponent} />
        </>
      );
    } else {
      return <div>Game component not found for {activeGameId}!</div>;
    }
  }

  return (
    <>
      {showEntrySplash && lobbyId && (
        <LobbyEntrySplash lobbyId={lobbyId} onEnter={() => setShowEntrySplash(false)} />
      )}
      {showSettings && (
        <LobbySettingsModal onClose={() => setShowSettings(false)} />
      )}
      <InterruptionModal />
      <div className="flex flex-col justify-start items-stretch gap-0 w-full h-[var(--app-height,100dvh)] max-w-[540px] lg:max-w-[680px] mx-auto p-4 sm:p-5 font-mono pt-4 sm:pt-8 pb-20 overflow-y-auto touch-auto">

        {/* Header with Back Button */}
        <div className="relative flex items-center justify-center w-full mt-0 pt-0 mb-4 sm:mb-6">
          <button
            onClick={handleLeaveLobby}
            aria-label="Leave Lobby"
            title="Leave Lobby"
            className="absolute left-0 w-11 h-11 bg-white hover:bg-slate-100 text-indigo-900 border-2 border-indigo-900 rounded-xl flex items-center justify-center font-bold shadow-[2px_2px_0_theme(colors.indigo.900)] active:shadow-none active:translate-y-[2px] active:translate-x-[2px] transition-all cursor-pointer"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="text-4xl md:text-[2.5rem] font-black uppercase text-center text-indigo-900 tracking-[-1.5px] mx-auto">
            Locade
          </h1>
          <button
            onClick={() => setShowSettings(true)}
            aria-label="Settings"
            title="Settings"
            className="absolute right-0 w-11 h-11 bg-white hover:bg-slate-100 text-indigo-900 border-2 border-indigo-900 rounded-xl flex items-center justify-center font-bold shadow-[2px_2px_0_theme(colors.indigo.900)] active:shadow-none active:translate-y-[2px] active:translate-x-[2px] transition-all cursor-pointer"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>

        {errorMessage && (
          <div className="bg-red-100 border-2 border-red-500 rounded-xl p-3 flex items-center gap-3 text-red-700 font-bold mb-2">
            <AlertCircle className="w-6 h-6 shrink-0" />
            <p>{errorMessage}</p>
          </div>
        )}

        {/* Code and QR Section */}
        <section className="flex flex-col">
          <h2 className="text-[1.2rem] font-semibold uppercase text-slate-600 text-left -mb-[2px] px-2 ml-2 bg-[#f0f2f5] inline-block relative z-10 w-fit self-start">
            Lobby
          </h2>
          <div className="bg-white border-2 border-indigo-900 rounded-3xl w-full p-5 sm:p-6 flex flex-col gap-5 mb-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
              {/* QR Code */}
              <div className="w-40 h-40 shrink-0 bg-white border-4 border-indigo-900 rounded-2xl p-3 flex items-center justify-center relative">
                <QRCode value={currentUrl} size={120} style={{ height: "auto", maxWidth: "100%", width: "100%" }} />
              </div>

              {/* Lobby ID and actions */}
              <div className="flex flex-col w-full gap-3">
                <div className="bg-white border-4 border-indigo-900 rounded-xl flex items-center justify-center text-4xl sm:text-5xl font-black text-indigo-900 tracking-[8px] sm:tracking-[12px] h-20 pl-2">
                  {lobbyId}
                </div>

                <div className="flex gap-3 mt-1">
                  <button onClick={handleCopy} className="flex-1 h-14 bg-[#f0f2f5] hover:bg-slate-200 text-indigo-900 border-2 border-indigo-900 rounded-xl p-3 font-bold shadow-[2px_2px_0_theme(colors.indigo.900)] active:shadow-none active:translate-y-[2px] active:translate-x-[2px] transition-all flex justify-center items-center gap-2">
                    <Copy className="w-6 h-6" />
                  </button>
                  <button onClick={handleShare} className="flex-1 h-14 bg-[#f0f2f5] hover:bg-slate-200 text-indigo-900 border-2 border-indigo-900 rounded-xl p-3 font-bold shadow-[2px_2px_0_theme(colors.indigo.900)] active:shadow-none active:translate-y-[2px] active:translate-x-[2px] transition-all flex justify-center items-center gap-2">
                    <Share2 className="w-6 h-6" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Players Section */}
        <section className="flex flex-col">
          <h2 className="text-[1.2rem] font-semibold uppercase text-slate-600 text-left -mb-[2px] px-2 ml-2 bg-[#f0f2f5] inline-block relative z-10 w-fit self-start">
            Players ({totalPlayers})
          </h2>
          <div className="bg-white border-2 border-indigo-900 rounded-3xl w-full p-4 sm:p-6 flex flex-col gap-3 mb-4">
            {peers.map((peer, index) => {
              const isMe = peer.id === userId;
              const playerColor = PLAYER_COLORS[index % PLAYER_COLORS.length];
              return (
                <div
                  key={peer.id}
                  className={`flex flex-row items-center justify-between border-2 rounded-xl p-3 px-4 transition-colors ${isMe ? 'border-indigo-900 border-[3px]' : 'border-indigo-900'}`}
                  style={{ backgroundColor: playerColor }}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="text-xl font-bold text-indigo-900 flex items-center min-w-0 w-full">
                      {peer.isHost && (
                        <span className="bg-red-400 text-white text-[0.8em] px-[6px] py-[2px] rounded border border-indigo-900 mr-2 inline-block shrink-0">
                          HOST
                        </span>
                      )}
                      <span className="truncate min-w-0" title={peer.name}>
                        {peer.name}
                      </span>
                      {isMe && (
                        <span className="text-[0.8em] text-slate-600 font-medium ml-2 relative -top-[2px] shrink-0">(YOU)</span>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
            {peers.length === 0 && (
              <div className="p-4 text-center text-slate-400 font-bold uppercase tracking-widest animate-pulse">
                Waiting for players...
              </div>
            )}
          </div>
        </section>

        {/* Games Section */}
        {isHost ? (
          <section className="flex flex-col">
            <h2 className="text-[1.2rem] font-semibold uppercase text-slate-600 text-left -mb-[2px] px-2 ml-2 bg-[#f0f2f5] inline-block relative z-10 w-fit self-start">
              Games
            </h2>
            <div className="bg-white border-2 border-indigo-900 rounded-3xl w-full p-4 sm:p-6">
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 p-1">
                {Object.values(GAME_REGISTRY).map((game) => {
                  const hasEnoughPlayers = totalPlayers >= game.minPlayers;
                  const hasTooManyPlayers = totalPlayers > game.maxPlayers;
                  const canStartGame = hasEnoughPlayers && !hasTooManyPlayers;

                  return (
                    <div
                      key={game.id}
                      onClick={() => canStartGame && handleStartGame(game.id)}
                      className={`relative border-4 border-indigo-900 rounded-2xl aspect-square flex flex-col group ${canStartGame ? 'cursor-pointer hover:-translate-y-1 hover:shadow-lg transition-transform' : 'cursor-not-allowed opacity-75'}`}
                    >
                      <div className={`absolute inset-0 flex items-center justify-center bg-[#f0f2f5] transition-opacity ${canStartGame ? 'group-active:opacity-80' : 'grayscale opacity-50'}`}>
                        {game.thumbnailUrl ? (
                          <img src={game.thumbnailUrl} alt={game.name} className="w-full h-full object-cover relative z-10" />
                        ) : (
                          <>
                            <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, #312e81 1px, transparent 0)', backgroundSize: '12px 12px' }}></div>
                            <span className="text-[4rem] font-black text-indigo-900/20 uppercase tracking-tighter relative z-10">
                              {game.name.substring(0, 2)}
                            </span>
                          </>
                        )}

                        {/* Overlay for unplayable games */}
                        {!canStartGame && (
                          <div className="absolute inset-0 bg-slate-900/40 flex items-center justify-center backdrop-blur-[2px] z-20">
                            <span className="bg-white text-indigo-900 font-black px-2 py-1 rounded text-xs uppercase border-2 border-indigo-900 shadow-md">
                              {hasTooManyPlayers ? 'Max Reached' : `Need ${game.minPlayers - totalPlayers}`}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        ) : (
          <div className="mt-4 text-center text-slate-500 font-bold uppercase tracking-widest animate-pulse">
            Waiting for host to pick a game...
          </div>
        )}
      </div>
    </>
  );
}
