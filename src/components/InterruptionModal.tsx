import { useEffect, useState } from 'react';
import { useNetworkStore } from '../platform/store/useNetworkStore';
import { useNavigate } from 'react-router';
import { lobbyAudioManager } from '../platform/audio/lobbyAudioManager';
import { peerService } from '../platform/network/peerService';

export default function InterruptionModal() {
  const { status, errorMessage, resetNetwork } = useNetworkStore();
  const navigate = useNavigate();
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const isReconnecting = status === 'reconnecting';

  // The deadline lives in peerService; poll it so the countdown moves. Reading
  // the clock stays inside the service so neither render nor this effect body
  // has to be impure.
  useEffect(() => {
    if (!isReconnecting) return;
    const id = window.setInterval(() => {
      setSecondsLeft(peerService.getReconnectSecondsLeft());
    }, 500);
    return () => clearInterval(id);
  }, [isReconnecting]);

  if (isReconnecting) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm font-mono">
        <div className="bg-white border-4 border-indigo-900 rounded-3xl w-full max-w-md p-6 flex flex-col items-center gap-5 shadow-2xl animate-in fade-in zoom-in duration-200">
          <div className="w-14 h-14 border-[6px] border-indigo-900/20 border-t-indigo-900 rounded-full animate-spin"></div>
          <div className="text-center flex flex-col gap-2">
            <h2 className="text-3xl font-black uppercase text-indigo-900 tracking-[-1px]">
              Reconnecting
            </h2>
            <p className="text-slate-600 font-bold text-lg leading-tight">
              Lost the connection for a moment. Your game is being held
              {secondsLeft !== null && secondsLeft > 0 ? ` for ${secondsLeft}s` : ''}.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // We only care about errors, specifically when a guest is disconnected because the host left.
  // Actually, any error in the lobby/game should probably stop the game.
  if (status !== 'error') return null;

  const handleReturnHome = () => {
    lobbyAudioManager.stop({ fadeOutDuration: 300 });
    resetNetwork();
    navigate('/');
  };

  const handleCreateLobby = () => {
    lobbyAudioManager.unlock();
    resetNetwork();
    const newLobbyId = Math.floor(100000 + Math.random() * 900000).toString();
    navigate(`/lobby/${newLobbyId}`, { state: { isHost: true, userUnlocked: true } });
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm font-mono">
      <div className="bg-white border-4 border-indigo-900 rounded-3xl w-full max-w-md p-6 flex flex-col gap-6 shadow-2xl animate-in fade-in zoom-in duration-300">
        <div className="text-center flex flex-col gap-2">
          <h2 className="text-3xl font-black uppercase text-indigo-900 mt-2 tracking-[-1px]">Lobby Closed</h2>
          <p className="text-slate-600 font-bold text-lg leading-tight">
            {errorMessage === 'The host has disconnected.'
              ? 'The Host disconnected. This lobby has been closed.'
              : errorMessage || 'A network error occurred. This party has ended.'}
          </p>
        </div>
        <div className="flex flex-col gap-3 mt-2">
          <button
            onClick={handleCreateLobby}
            className="w-full bg-red-400 hover:bg-red-500 text-white border-2 border-indigo-900 rounded-2xl p-4 font-mono text-lg font-black uppercase tracking-wider flex justify-center items-center cursor-pointer active:translate-y-[2px] transition-all"
          >
            Start Your Own Party
          </button>
          <button
            onClick={handleReturnHome}
            className="w-full bg-[#f0f2f5] hover:bg-slate-200 text-indigo-900 border-2 border-indigo-900 rounded-2xl p-4 font-mono text-lg font-black uppercase tracking-wider flex justify-center items-center cursor-pointer active:translate-y-[2px] transition-all"
          >
            Return to Home
          </button>
        </div>
      </div>
    </div>
  );
}
