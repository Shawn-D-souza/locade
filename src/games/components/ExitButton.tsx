import { useState, useRef, useEffect } from 'react';
import { X } from 'lucide-react';

interface ExitButtonProps {
  onExit: () => void;
  className?: string;
}

export function ExitButton({ onExit, className = '' }: ExitButtonProps) {
  const [progress, setProgress] = useState(0);
  const [isPressing, setIsPressing] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const requestRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  
  const HOLD_DURATION = 1000; // 1 second hold

  const updateProgress = (timestamp: number) => {
    if (!startTimeRef.current) startTimeRef.current = timestamp;
    const elapsed = timestamp - startTimeRef.current;
    
    if (elapsed >= HOLD_DURATION) {
      setProgress(100);
      onExit();
      return;
    }
    
    setProgress((elapsed / HOLD_DURATION) * 100);
    requestRef.current = requestAnimationFrame(updateProgress);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    setIsPressing(true);
    startTimeRef.current = null;
    requestRef.current = requestAnimationFrame(updateProgress);
  };

  const handlePointerUp = () => {
    setIsPressing(false);
    setProgress(0);
    if (requestRef.current !== null) cancelAnimationFrame(requestRef.current);
  };

  useEffect(() => {
    const btn = buttonRef.current;
    if (!btn) return;

    const handleTouchStart = (e: TouchEvent) => {
      // strictly tell the OS not to handle this touch
      e.preventDefault();
      setIsPressing(true);
      startTimeRef.current = null;
      requestRef.current = requestAnimationFrame(updateProgress);
    };

    const handleTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      setIsPressing(false);
      setProgress(0);
      if (requestRef.current !== null) cancelAnimationFrame(requestRef.current);
    };

    // Attach native touch events with { passive: false } to guarantee preventDefault works
    btn.addEventListener('touchstart', handleTouchStart, { passive: false });
    btn.addEventListener('touchend', handleTouchEnd, { passive: false });
    btn.addEventListener('touchcancel', handleTouchEnd, { passive: false });

    return () => {
      btn.removeEventListener('touchstart', handleTouchStart);
      btn.removeEventListener('touchend', handleTouchEnd);
      btn.removeEventListener('touchcancel', handleTouchEnd);
      if (requestRef.current !== null) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  return (
    <button
      ref={buttonRef}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onContextMenu={(e) => e.preventDefault()}
      className={`absolute top-4 right-4 z-10 w-12 h-12 flex items-center justify-center rounded-full shadow-md transition-transform touch-none
        ${isPressing ? 'scale-110' : 'hover:scale-105'}
        ${className}`}
      style={{
        background: `conic-gradient(#94a3b8 ${progress}%, rgba(255,255,255,0.7) ${progress}%)`
      }}
    >
      <div className="w-[88%] h-[88%] bg-white/90 backdrop-blur-sm rounded-full flex items-center justify-center absolute">
        <X 
          size={20} 
          className={`transition-all duration-200 ${isPressing ? 'scale-110 text-slate-800' : 'text-slate-600'}`} 
          strokeWidth={3}
        />
      </div>
    </button>
  );
}
