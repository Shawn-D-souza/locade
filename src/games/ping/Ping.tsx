import { useEffect, useState } from 'react';
import type { GameProps } from '../GameProps';
import { useNetworkStore } from '../../platform/store/useNetworkStore';
import { Activity, XCircle } from 'lucide-react';

export type PingData = {
  action: 'PING';
};

export default function Ping({ sendDataToPeers, incomingData, onGameEnd }: GameProps<PingData>) {
  const [pingsReceived, setPingsReceived] = useState(0);
  const { isHost } = useNetworkStore();

  useEffect(() => {
    if (incomingData?.action === 'PING') {
      setPingsReceived(prev => prev + 1);
    }
  }, [incomingData]);

  const handlePlayerAction = () => {
    sendDataToPeers({ action: 'PING' });
  };

  return (
    <div className="flex flex-col justify-center items-stretch gap-6 w-full min-h-[100dvh] max-w-[540px] lg:max-w-[680px] mx-auto p-4 sm:p-5 font-mono">
      {/* Header */}
      <div className="flex flex-col items-center gap-1 mb-2">
        <h1 className="text-4xl md:text-[2.5rem] font-black uppercase text-center text-indigo-900 tracking-[-1.5px]">
          Ping Game
        </h1>
      </div>

      <div className="bg-white border-[3px] border-indigo-900 rounded-3xl w-full p-6 sm:p-8 flex flex-col gap-6 items-center">
        
        {/* Score / Pings display */}
        <div className="bg-[#f0f2f5] border-[3px] border-indigo-900 rounded-2xl p-6 w-full flex flex-col items-center gap-2 shadow-[inset_0_4px_0_theme(colors.indigo.900),inset_4px_0_0_theme(colors.indigo.900),inset_-4px_0_0_theme(colors.indigo.900)]">
          <span className="text-sm font-bold text-slate-500 uppercase tracking-widest">Pings Received</span>
          <span className="text-7xl font-black text-indigo-900 tracking-tighter">{pingsReceived}</span>
        </div>

        {/* Action Button */}
        <button 
          onClick={handlePlayerAction}
          className="w-full bg-red-400 hover:bg-red-500 text-white border-[3px] border-indigo-900 rounded-2xl py-6 font-mono text-2xl font-black uppercase tracking-wider shadow-[0_6px_0_theme(colors.indigo.900)] active:shadow-none active:translate-y-[6px] active:translate-x-[2px] transition-all flex items-center justify-center gap-3"
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
