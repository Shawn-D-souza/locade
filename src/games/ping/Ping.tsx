import { useEffect, useState, useMemo } from 'react';
import type { GameProps } from '../GameProps';
import { useNetworkStore } from '../../platform/store/useNetworkStore';
import { useUser } from '../../platform/store/useUserStore';
import { Activity, XCircle, User as UserIcon } from 'lucide-react';

export type PingData = {
  action: 'PING';
  userId: string;
  score: number;
};

export default function Ping({ sendDataToPeers, incomingData, onGameEnd }: GameProps<PingData>) {
  const [scores, setScores] = useState<Record<string, number>>({});
  const { isHost, peers } = useNetworkStore();
  const { userId, userName } = useUser();

  const allPlayers = useMemo(() => {
    return [
      { id: userId, name: userName + " (You)" },
      ...peers.filter(p => p.id !== userId).map(p => ({ id: p.id, name: p.name }))
    ];
  }, [peers, userId, userName]);

  useEffect(() => {
    if (incomingData?.action === 'PING' && incomingData.userId) {
      setScores(prev => ({
        ...prev,
        [incomingData.userId]: incomingData.score
      }));
    }
  }, [incomingData]);

  const handlePlayerAction = () => {
    setScores(prev => {
      const currentScore = prev[userId] || 0;
      const newScore = currentScore + 1;
      
      sendDataToPeers({ action: 'PING', userId, score: newScore });
      
      return {
        ...prev,
        [userId]: newScore
      };
    });
  };

  return (
    <div className="flex flex-col justify-center items-stretch gap-6 w-full min-h-[var(--app-height,100dvh)] max-w-[540px] lg:max-w-[680px] mx-auto p-4 sm:p-5 font-mono">
      {/* Header */}
      <div className="flex flex-col items-center gap-1 mb-2">
        <h1 className="text-4xl md:text-[2.5rem] font-black uppercase text-center text-indigo-900 tracking-[-1.5px]">
          Ping Game
        </h1>
      </div>

      <div className="bg-white border-[3px] border-indigo-900 rounded-3xl w-full p-6 sm:p-8 flex flex-col gap-6 items-center">
        
        {/* Score Board */}
        <div className="w-full flex flex-col gap-3">
          <h2 className="text-xl font-bold text-slate-500 uppercase tracking-widest mb-2 text-center">Players</h2>
          {allPlayers.map((player) => (
            <div key={player.id} className="bg-[#f0f2f5] border-[3px] border-indigo-900 rounded-2xl p-4 w-full flex items-center justify-between">
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="bg-indigo-100 p-2 rounded-full border-2 border-indigo-900 shrink-0">
                  <UserIcon className="w-5 h-5 text-indigo-900" strokeWidth={2.5} />
                </div>
                <span className="text-lg font-bold text-slate-700 truncate max-w-[150px] sm:max-w-[200px]">{player.name}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-sm font-bold text-slate-400 uppercase">Pings</span>
                <span className="text-3xl font-black text-indigo-900 tracking-tighter min-w-[2ch] text-right">{scores[player.id] || 0}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Action Button */}
        <button 
          onClick={handlePlayerAction}
          className="w-full bg-red-400 hover:bg-red-500 text-white border-[3px] border-b-[9px] border-indigo-900 rounded-2xl py-6 font-mono text-2xl font-black uppercase tracking-wider active:border-b-[3px] active:mb-[6px] active:translate-y-[6px] flex items-center justify-center gap-3 mt-4"
        >
          <Activity className="w-8 h-8" strokeWidth={3} />
          Send Ping
        </button>

      </div>

      {isHost && (
        <button 
          onClick={onGameEnd}
          className="mt-4 mx-auto bg-slate-200 hover:bg-slate-300 text-slate-700 border-2 border-slate-700 rounded-xl px-6 py-3 font-mono font-bold uppercase tracking-wider transition-all flex items-center gap-2"
        >
          <XCircle className="w-5 h-5" strokeWidth={2.5} />
          End Game
        </button>
      )}
    </div>
  );
}
