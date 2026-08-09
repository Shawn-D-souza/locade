/**
 * Procedural Web Audio Sound Synthesizer
 * 
 * Generates rich, low-latency synthesized sound effects (win, lose, score, hit, tap)
 * dynamically using Web Audio API oscillators and gain envelopes without requiring
 * any external sound asset downloads.
 */

export class SoundSynthesizer {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private volume = 0.5; // Default 50% volume

  constructor() {
    if (typeof window !== 'undefined') {
      this.loadSettings();
      this.setupInteractionUnlock();
    }
  }

  private loadSettings() {
    try {
      const savedVol = localStorage.getItem('locade_sfx_volume');
      if (savedVol !== null) {
        this.volume = Math.max(0, Math.min(1, parseFloat(savedVol)));
      }
    } catch {
      // Fallback to default
    }
  }

  private setupInteractionUnlock() {
    const unlock = () => {
      this.initContext();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => { });
      }
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };

    window.addEventListener('pointerdown', unlock, { passive: true, once: true });
    window.addEventListener('keydown', unlock, { passive: true, once: true });
    window.addEventListener('touchstart', unlock, { passive: true, once: true });
  }

  private initContext(): AudioContext | null {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.volume;
        this.masterGain.connect(this.ctx.destination);
      }
    }
    return this.ctx;
  }

  public setVolume(vol: number) {
    const clamped = Math.max(0, Math.min(1, vol));
    this.volume = clamped;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(clamped, this.ctx.currentTime);
    }
  }

  public getVolume(): number {
    return this.volume;
  }

  /**
   * Plays a crisp, uplifting 2-tone score chime (D5 -> A5).
   */
  public playScore() {
    const ctx = this.initContext();
    if (!ctx || ctx.state === 'suspended' || this.volume <= 0) return;

    const now = ctx.currentTime;

    // Tone 1: D5 (587.33 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(587.33, now);
    osc1.frequency.exponentialRampToValueAtTime(620, now + 0.08);

    gain1.gain.setValueAtTime(this.volume * 0.7, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);

    osc1.start(now);
    osc1.stop(now + 0.09);

    // Tone 2: A5 (880.00 Hz) with bright chime
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880.00, now + 0.07);
    osc2.frequency.exponentialRampToValueAtTime(890, now + 0.28);

    gain2.gain.setValueAtTime(0, now);
    gain2.gain.setValueAtTime(this.volume * 0.9, now + 0.07);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);

    osc2.start(now + 0.07);
    osc2.stop(now + 0.35);
  }

  /**
   * Plays a triumphant victory fanfare arpeggio (C5 -> E5 -> G5 -> C6).
   */
  public playWin() {
    const ctx = this.initContext();
    if (!ctx || ctx.state === 'suspended' || this.volume <= 0) return;

    const notes = [
      { freq: 523.25, start: 0.00, dur: 0.12, type: 'triangle' as OscillatorType }, // C5
      { freq: 659.25, start: 0.10, dur: 0.12, type: 'triangle' as OscillatorType }, // E5
      { freq: 783.99, start: 0.20, dur: 0.14, type: 'triangle' as OscillatorType }, // G5
      { freq: 1046.50, start: 0.32, dur: 0.50, type: 'sine' as OscillatorType },    // C6 (Grand sustain)
    ];

    const now = ctx.currentTime;

    notes.forEach(({ freq, start, dur, type }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, now + start);

      gain.gain.setValueAtTime(0, now);
      gain.gain.setValueAtTime(this.volume * 0.8, now + start);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + start);
      osc.stop(now + start + dur);
    });
  }

  /**
   * Plays a defeat sound — two descending tones that stay in the audible range
   * of phone speakers (above 150Hz).
   */
  public playLose() {
    const ctx = this.initContext();
    if (!ctx || ctx.state === 'suspended' || this.volume <= 0) return;

    const now = ctx.currentTime;

    // First tone: mid note that drops to a lower mid note
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(370, now);
    osc1.frequency.exponentialRampToValueAtTime(220, now + 0.3);
    gain1.gain.setValueAtTime(this.volume * 0.7, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    // Second tone: follows a beat later, lower, trails off
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(220, now + 0.28);
    osc2.frequency.exponentialRampToValueAtTime(160, now + 0.65);
    gain2.gain.setValueAtTime(0, now);
    gain2.gain.setValueAtTime(this.volume * 0.55, now + 0.28);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.28);
    osc2.stop(now + 0.7);
  }

  /**
   * Plays a puck/paddle/wall collision impact sound.
   * Uses a fixed-frequency percussive "thock" — no sweep, so no laser effect.
   */
  public playHit(intensity: 'light' | 'medium' | 'heavy' = 'medium') {
    const ctx = this.initContext();
    if (!ctx || ctx.state === 'suspended' || this.volume <= 0) return;

    const now = ctx.currentTime;

    // Body tone: fixed freq square-ish burst with fast decay
    const config = {
      light: { freq: 180, dur: 0.025, vol: 0.50 },
      medium: { freq: 220, dur: 0.040, vol: 0.55 },
      heavy: { freq: 260, dur: 0.060, vol: 0.62 },
    }[intensity];

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(config.freq, now);

    // Sharp attack, exponential decay — percussive, not tonal
    gain.gain.setValueAtTime(this.volume * config.vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + config.dur);

    // Bandpass to cut the harshness of raw square wave
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(config.freq * 1.5, now);
    filter.Q.setValueAtTime(1.2, now);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + config.dur);
  }

  /**
   * Plays a UI button click / tap pop.
   */
  public playTap() {
    const ctx = this.initContext();
    if (!ctx || ctx.state === 'suspended' || this.volume <= 0) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    // Use sine wave to avoid harshness, and keep the frequency fixed 
    // or dropping almost instantly to avoid the "pew-pew" laser sound.
    osc.type = 'sine';
    osc.frequency.setValueAtTime(900, now);
    
    // A 10ms pitch drop is heard as a "click" or transient, not a laser sweep
    osc.frequency.exponentialRampToValueAtTime(400, now + 0.01);

    // Very short, percussive volume decay (30ms total)
    gain.gain.setValueAtTime(this.volume * 0.6, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.03);
  }

  /**
   * Plays a soft "pop" or "bubble" sound, perfect for placing a dot.
   */
  public playPop() {
    const ctx = this.initContext();
    if (!ctx || ctx.state === 'suspended' || this.volume <= 0) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    // Start mid-high and quickly bend up to simulate a bubble popping
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.05);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(this.volume * 0.7, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.06);
  }

  /**
   * Plays a deeper "boop" sound, for a low-impact explosion/expansion.
   */
  public playBoop() {
    const ctx = this.initContext();
    if (!ctx || ctx.state === 'suspended' || this.volume <= 0) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    // Start low-mid and bend down
    osc.frequency.setValueAtTime(250, now);
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.1);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(this.volume * 0.8, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.15);
  }
}

export const soundSynthesizer = new SoundSynthesizer();
