import { useState, useEffect } from 'react';
import { Settings, X, Volume2, Music, Heart, Smartphone } from 'lucide-react';
import { lobbyAudioManager } from '../platform/audio/lobbyAudioManager';
import { feedback } from '../platform/feedback/feedbackManager';

interface LobbySettingsModalProps {
  onClose: () => void;
}

export default function LobbySettingsModal({ onClose }: LobbySettingsModalProps) {
  const [musicVol, setMusicVol] = useState(() => lobbyAudioManager.getMusicVolume());
  const [sfxVol, setSfxVol] = useState(() => feedback.getSfxVolume());
  const [hapticsOn, setHapticsOn] = useState(() => feedback.isHapticsEnabled());
  const [activeTab, setActiveTab] = useState<'audio' | 'credits'>('audio');

  const handleMusicChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setMusicVol(val);
    lobbyAudioManager.setMusicVolume(val);
  };

  const handleSfxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setSfxVol(val);
    feedback.setSfxVolume(val);
  };

  const handleSfxRelease = () => {
    feedback.tap();
  };

  const toggleHaptics = () => {
    const newVal = !hapticsOn;
    setHapticsOn(newVal);
    feedback.setHapticsEnabled(newVal);
    if (newVal) feedback.tap();
  };

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 font-mono select-none">
      <div className="w-full max-w-[480px] bg-white border-4 border-indigo-900 rounded-3xl p-6 flex flex-col items-stretch gap-5 animate-in fade-in zoom-in-95 duration-200 shadow-2xl">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-indigo-900/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-100 border-2 border-indigo-900 rounded-xl flex items-center justify-center text-indigo-900">
              <Settings className="w-5 h-5" strokeWidth={2.5} />
            </div>
            <h2 className="text-2xl font-black uppercase text-indigo-900 tracking-tight">Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 bg-slate-100 hover:bg-red-100 text-slate-500 hover:text-red-500 border-2 border-transparent hover:border-red-500 rounded-xl flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-6 h-6" strokeWidth={2.5} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('audio')}
            className={`flex-1 py-2 px-4 rounded-xl font-bold text-sm uppercase tracking-wider transition-all border-2 ${activeTab === 'audio' ? 'bg-indigo-900 text-white border-indigo-900 shadow-md' : 'bg-[#f0f2f5] text-slate-500 border-transparent hover:bg-slate-200'}`}
          >
            Audio
          </button>
          <button
            onClick={() => setActiveTab('credits')}
            className={`flex-1 py-2 px-4 rounded-xl font-bold text-sm uppercase tracking-wider transition-all border-2 ${activeTab === 'credits' ? 'bg-indigo-900 text-white border-indigo-900 shadow-md' : 'bg-[#f0f2f5] text-slate-500 border-transparent hover:bg-slate-200'}`}
          >
            Credits
          </button>
        </div>

        {/* Content Area */}
        <div className="min-h-[220px]">
          
          {/* Audio Tab */}
          {activeTab === 'audio' && (
            <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-right-4 duration-200 pt-2">
              
              {/* Music Volume Slider */}
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center text-indigo-900 font-bold">
                  <div className="flex items-center gap-2">
                    <Music className="w-5 h-5" />
                    <span className="uppercase text-sm tracking-widest">Music</span>
                  </div>
                  <span>{Math.round(musicVol * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={musicVol}
                  onChange={handleMusicChange}
                  className="w-full h-3 bg-indigo-100 rounded-lg appearance-none cursor-pointer accent-indigo-600 outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>

              {/* SFX Volume Slider */}
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center text-indigo-900 font-bold">
                  <div className="flex items-center gap-2">
                    <Volume2 className="w-5 h-5" />
                    <span className="uppercase text-sm tracking-widest">SFX</span>
                  </div>
                  <span>{Math.round(sfxVol * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={sfxVol}
                  onChange={handleSfxChange}
                  onMouseUp={handleSfxRelease}
                  onTouchEnd={handleSfxRelease}
                  className="w-full h-3 bg-indigo-100 rounded-lg appearance-none cursor-pointer accent-indigo-600 outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>

              {/* Haptics Toggle */}
              <div className="flex items-center justify-between pt-2 border-t-2 border-indigo-900/10">
                <div className="flex items-center gap-2 text-indigo-900 font-bold">
                  <Smartphone className="w-5 h-5" />
                  <span className="uppercase text-sm tracking-widest">Haptics</span>
                </div>
                <button
                  onClick={toggleHaptics}
                  className={`w-14 h-8 rounded-full flex items-center p-1 transition-colors ${hapticsOn ? 'bg-indigo-600' : 'bg-slate-300'}`}
                >
                  <div className={`w-6 h-6 rounded-full bg-white shadow-md transform transition-transform ${hapticsOn ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>
          )}

          {/* Credits Tab */}
          {activeTab === 'credits' && (
            <div className="flex flex-col gap-5 animate-in fade-in slide-in-from-left-4 duration-200 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
              
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-4 bg-indigo-50 border-2 border-indigo-200 rounded-2xl p-4 shadow-sm">
                  <Heart className="w-8 h-8 text-red-500 shrink-0 fill-red-500/20" />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-bold uppercase text-indigo-900/70 tracking-widest">Created By</span>
                    <span className="font-black text-indigo-900 text-lg">Shawn Dsouza</span>
                    <span className="text-sm text-slate-700 font-semibold leading-tight">Programming, Design, & Everything Else</span>
                  </div>
                </div>

                <div className="flex flex-col gap-2 bg-slate-100 border-2 border-slate-300 rounded-2xl p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <Music className="w-5 h-5 text-slate-600" />
                    <span className="text-sm font-bold uppercase text-slate-700 tracking-widest">Lobby Music</span>
                  </div>
                  <div className="text-xs text-slate-800 font-semibold leading-relaxed bg-white p-3 rounded-xl border-2 border-slate-200 shadow-inner">
                    "Pixelland" Kevin MacLeod (incompetech.com)<br/>
                    Licensed under Creative Commons: By Attribution 4.0 License<br/>
                    <a href="http://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer" className="text-indigo-700 hover:text-indigo-900 hover:underline font-bold">
                      http://creativecommons.org/licenses/by/4.0/
                    </a>
                  </div>
                </div>
              </div>

            </div>
          )}
        </div>

      </div>
    </div>
  );
}
