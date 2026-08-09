import { useState, useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import { feedback } from '../../platform/feedback/feedbackManager';

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
  const exitFiredRef = useRef(false);
  const lastHapticThreshold = useRef(0);

  const HOLD_DURATION = 1000; // 1 second hold

  const cancelHold = () => {
    setIsPressing(false);
    setProgress(0);
    lastHapticThreshold.current = 0;
    exitFiredRef.current = false;
    if (requestRef.current !== null) {
      cancelAnimationFrame(requestRef.current);
      requestRef.current = null;
    }
    startTimeRef.current = null;
  };

  const updateProgress = (timestamp: number) => {
    if (!startTimeRef.current) startTimeRef.current = timestamp;
    const elapsed = timestamp - startTimeRef.current;
    const pct = Math.min((elapsed / HOLD_DURATION) * 100, 100);

    // Trigger escalating haptic pulses at 25%, 50%, 75%, 100%
    const thresholds = [25, 50, 75, 100];
    for (const t of thresholds) {
      if (pct >= t && lastHapticThreshold.current < t) {
        lastHapticThreshold.current = t;
        if (t < 100) {
          feedback.customHaptic([{ duration: 15 + t / 5, intensity: t / 100 }]);
        }
      }
    }

    if (elapsed >= HOLD_DURATION) {
      if (!exitFiredRef.current) {
        exitFiredRef.current = true;
        setProgress(100);
        // Satisfying "confirmed" haptic + sound on successful exit
        feedback.customHaptic([
          { duration: 60, intensity: 0.8 },
          { delay: 60, duration: 100, intensity: 1.0 },
        ]);
        feedback.tap();
        setTimeout(() => onExit(), 80); // tiny delay so the haptic lands first
      }
      return;
    }

    setProgress(pct);
    requestRef.current = requestAnimationFrame(updateProgress);
  };

  const startHold = () => {
    if (exitFiredRef.current) return;
    setIsPressing(true);
    startTimeRef.current = null;
    lastHapticThreshold.current = 0;
    requestRef.current = requestAnimationFrame(updateProgress);
  };

  useEffect(() => {
    const btn = buttonRef.current;
    if (!btn) return;

    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault(); // blocks click, contextmenu, scroll, and pointer events
      startHold();
    };

    const handleTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      cancelHold();
    };

    const handlePointerDown = (e: PointerEvent) => {
      // Only handle non-touch pointer devices (mouse, stylus)
      if (e.pointerType === 'touch') return;
      e.preventDefault();
      startHold();
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      cancelHold();
    };

    const handlePointerLeave = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      cancelHold();
    };

    // Block plain click so a tap never exits
    const handleClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    btn.addEventListener('touchstart', handleTouchStart, { passive: false });
    btn.addEventListener('touchend', handleTouchEnd, { passive: false });
    btn.addEventListener('touchcancel', handleTouchEnd, { passive: false });
    btn.addEventListener('pointerdown', handlePointerDown);
    btn.addEventListener('pointerup', handlePointerUp);
    btn.addEventListener('pointerleave', handlePointerLeave);
    btn.addEventListener('click', handleClick);

    return () => {
      btn.removeEventListener('touchstart', handleTouchStart);
      btn.removeEventListener('touchend', handleTouchEnd);
      btn.removeEventListener('touchcancel', handleTouchEnd);
      btn.removeEventListener('pointerdown', handlePointerDown);
      btn.removeEventListener('pointerup', handlePointerUp);
      btn.removeEventListener('pointerleave', handlePointerLeave);
      btn.removeEventListener('click', handleClick);
      if (requestRef.current !== null) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  return (
    <button
      ref={buttonRef}
      onContextMenu={(e) => e.preventDefault()}
      className={`absolute top-4 right-4 z-10 w-12 h-12 flex items-center justify-center rounded-full shadow-md transition-transform touch-none select-none
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
