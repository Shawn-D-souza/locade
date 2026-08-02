import { Gamepad2, ArrowRight } from 'lucide-react';
import { lobbyAudioManager } from '../platform/audio/lobbyAudioManager';

interface LobbyEntrySplashProps {
  lobbyId: string;
  onEnter: () => void;
}

export default function LobbyEntrySplash({ lobbyId, onEnter }: LobbyEntrySplashProps) {
  const handleInteraction = async () => {
    await lobbyAudioManager.unlock();
    lobbyAudioManager.play({ fadeInDuration: 5000 });
    onEnter();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#f0f2f5] p-4 font-mono select-none">
      <div className="w-full max-w-[480px] bg-white border-4 border-indigo-900 rounded-3xl p-6 sm:p-8 flex flex-col items-center gap-6 text-center animate-in fade-in zoom-in-95 duration-200">
        
        {/* Arcade Title */}
        <div className="flex flex-col items-center gap-1">
          <div className="w-16 h-16 bg-red-400 border-3 border-indigo-900 rounded-2xl flex items-center justify-center mb-2">
            <Gamepad2 className="w-9 h-9 text-white" strokeWidth={2.5} />
          </div>
          <h1 className="text-3xl sm:text-4xl font-black uppercase text-indigo-900 tracking-[-1px]">
            Locade
          </h1>
          <div className="inline-flex items-center gap-2 bg-indigo-50 border-2 border-indigo-900/30 rounded-xl px-3 py-1 mt-1">
            <span className="text-xs font-bold uppercase text-indigo-900/70 tracking-wider">Room Code</span>
            <span className="text-sm font-black text-indigo-900 tracking-[3px]">{lobbyId}</span>
          </div>
        </div>

        {/* Enter CTA Button */}
        <button
          onClick={handleInteraction}
          className="w-full bg-red-400 hover:bg-red-500 active:bg-red-600 text-white border-3 border-indigo-900 rounded-2xl p-5 font-mono text-xl sm:text-2xl font-black uppercase tracking-wider flex items-center justify-center gap-3 cursor-pointer active:scale-[0.98] transition-all group"
        >
          <span>Enter Lobby</span>
          <ArrowRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" strokeWidth={3} />
        </button>
      </div>
    </div>
  );
}
