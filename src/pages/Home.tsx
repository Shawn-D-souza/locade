import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../platform/store/useUserStore';
import { Pencil } from 'lucide-react';

export default function Home() {
  const { userName, setUserName } = useUser();
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState(userName);
  const [joinId, setJoinId] = useState('');
  const navigate = useNavigate();

  const handleSave = () => {
    if (inputValue.trim()) setUserName(inputValue.trim().substring(0, 15));
    setIsEditing(false);
  };

  const handleCreateLobby = () => {
    const newLobbyId = Math.random().toString(36).substring(2, 8).toUpperCase();
    navigate(`/lobby/${newLobbyId}`, { state: { isHost: true } });
  };

  const handleJoinLobby = () => {
    const code = joinId.trim().toUpperCase();
    if (code.length === 6) {
      navigate(`/lobby/${code}`, { state: { isHost: false } });
    }
  };

  return (
    <div className="flex flex-col justify-center items-stretch gap-4 w-full min-h-[100dvh] max-w-[540px] lg:max-w-[680px] mx-auto p-4 sm:p-5 font-mono">
      <h1 className="text-4xl md:text-[2.5rem] font-black uppercase text-center text-indigo-900 mt-0 pt-0 mb-2 tracking-[-1.5px] mx-auto relative">
        Locade
      </h1>

      <div className="bg-white border-2 border-indigo-900 rounded-3xl w-full p-5 sm:p-6 flex flex-col gap-5 mb-5">
        
        {/* Name Section */}
        <div className="flex flex-col items-center justify-center gap-2">
          {isEditing ? (
            <div className="w-full flex flex-col gap-3">
              <input 
                type="text" 
                value={inputValue}
                maxLength={15}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                className="font-mono text-xl text-indigo-900 bg-transparent border-b-2 border-red-500 rounded-none p-2 outline-none w-full text-center transition-colors focus:border-red-600"
                autoFocus
              />
              <div className="flex gap-3 w-full mt-2">
                <button 
                  onClick={() => setIsEditing(false)}
                  className="flex-1 bg-slate-100 text-indigo-900 border-2 border-indigo-900 rounded-xl p-3 font-mono font-bold uppercase cursor-pointer shadow-[0_4px_0_theme(colors.indigo.900)] active:shadow-[0_0px_0_theme(colors.indigo.900)] active:translate-y-[4px] transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleSave}
                  className="flex-1 bg-red-400 hover:bg-red-500 text-white border-2 border-indigo-900 rounded-xl p-3 font-mono font-bold uppercase cursor-pointer shadow-[0_4px_0_theme(colors.indigo.900)] active:shadow-[0_0px_0_theme(colors.indigo.900)] active:translate-y-[4px] transition-all"
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-row items-center justify-between w-full bg-white border-[3px] border-indigo-900 rounded-xl p-3 px-4">
              <div className="flex flex-row items-center gap-2">
                <span className="text-xl font-bold text-indigo-900">
                  {userName}
                  <span className="text-[0.8em] text-slate-600 font-medium ml-[6px] relative -top-[2px]">(YOU)</span>
                </span>
              </div>
              <button 
                onClick={() => { setInputValue(userName); setIsEditing(true); }}
                className="text-slate-400 hover:text-indigo-900 cursor-pointer bg-transparent border-none transition-colors p-1"
                title="Edit Name"
              >
                <Pencil className="w-5 h-5" strokeWidth={2.5} />
              </button>
            </div>
          )}
        </div>

        {/* Start Game Section */}
        <div className="mt-2">
          <button 
            onClick={handleCreateLobby}
            className="w-full bg-red-400 hover:bg-red-500 text-white border-2 border-indigo-900 rounded-2xl p-4 font-mono text-xl font-black uppercase tracking-wider flex justify-center items-center cursor-pointer shadow-[0_4px_0_theme(colors.indigo.900)] active:shadow-[0_0px_0_theme(colors.indigo.900)] active:translate-y-[4px] transition-all"
          >
            Start a Lobby
          </button>
        </div>

        {/* Divider */}
        <div className="relative flex items-center justify-center my-2">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t-2 border-dashed border-indigo-900/20"></div>
          </div>
          <div className="relative bg-white px-4 text-sm text-slate-400 font-bold uppercase tracking-widest">
            Or
          </div>
        </div>

        {/* Join Game Section */}
        <div className="flex flex-col gap-3">
          <input 
            type="text" 
            placeholder="CODE"
            value={joinId}
            maxLength={6}
            onChange={(e) => setJoinId(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && joinId.trim().length === 6 && handleJoinLobby()}
            className="w-full bg-slate-50 focus:bg-white border-2 border-indigo-900 rounded-xl p-4 font-mono text-xl font-bold uppercase text-indigo-900 outline-none tracking-[8px] placeholder:tracking-[2px] placeholder:text-indigo-900/40 text-center transition-colors h-[60px]"
          />
          <button 
            onClick={handleJoinLobby}
            disabled={joinId.trim().length !== 6}
            className="w-full bg-indigo-900 hover:bg-indigo-800 text-white border-2 border-indigo-900 rounded-2xl p-4 font-mono text-xl font-black uppercase tracking-wider flex justify-center items-center cursor-pointer shadow-[0_4px_0_theme(colors.indigo.900)] active:shadow-[0_0px_0_theme(colors.indigo.900)] active:translate-y-[4px] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:active:shadow-[0_4px_0_theme(colors.indigo.900)] disabled:active:translate-y-0"
          >
            Join Lobby
          </button>
        </div>
      </div>
    </div>
  );
}
