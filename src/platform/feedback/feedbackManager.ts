import { WebHaptics } from 'web-haptics';
import { soundSynthesizer, SoundSynthesizer } from './soundSynthesizer';

export type HitIntensity = 'light' | 'medium' | 'heavy';

export class FeedbackManager {
  private haptics: WebHaptics | null = null;
  private sound: SoundSynthesizer = soundSynthesizer;
  private hapticsEnabled = true;
  private sfxEnabled = true;

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        this.haptics = new WebHaptics();
      } catch {
        // Graceful fallback for non-supported environments
      }
      this.loadSettings();
    }
  }

  private loadSettings() {
    try {
      const savedHaptics = localStorage.getItem('locade_haptics_enabled');
      if (savedHaptics !== null) {
        this.hapticsEnabled = savedHaptics === 'true';
      }

      const savedSfx = localStorage.getItem('locade_sfx_volume');
      if (savedSfx !== null) {
        const vol = parseFloat(savedSfx);
        this.sfxEnabled = vol > 0;
        this.sound.setVolume(vol);
      }
    } catch {
      // Fallback to defaults
    }
  }

  // ─── Settings Controls ───────────────────────────────────────────────────────

  public setHapticsEnabled(enabled: boolean) {
    this.hapticsEnabled = enabled;
    try {
      localStorage.setItem('locade_haptics_enabled', String(enabled));
    } catch {}
  }

  public isHapticsEnabled(): boolean {
    return this.hapticsEnabled;
  }

  public setSfxVolume(vol: number) {
    const clamped = Math.max(0, Math.min(1, vol));
    this.sfxEnabled = clamped > 0;
    this.sound.setVolume(clamped);
    try {
      localStorage.setItem('locade_sfx_volume', clamped.toString());
    } catch {}
  }

  public getSfxVolume(): number {
    return this.sound.getVolume();
  }

  public isSfxEnabled(): boolean {
    return this.sfxEnabled && this.sound.getVolume() > 0;
  }

  // ─── Semantic Sensory Triggers (Sound + Haptics in sync) ─────────────────────

  /**
   * Point or Goal Scored: Uplifting 2-tone chime + double-tap nudge vibration.
   */
  public score() {
    if (this.sfxEnabled) {
      this.sound.playScore();
    }
    if (this.hapticsEnabled && this.haptics) {
      this.haptics.trigger('nudge');
    }
  }

  /**
   * Game Victory: Victorious fanfare arpeggio + celebratory success vibration.
   */
  public win() {
    if (this.sfxEnabled) {
      this.sound.playWin();
    }
    if (this.hapticsEnabled && this.haptics) {
      // Light, rhythmic triple tap — feels celebratory without being aggressive
      this.haptics.trigger([
        { duration: 40, intensity: 0.3 },
        { delay: 50, duration: 40, intensity: 0.4 },
        { delay: 50, duration: 40, intensity: 0.5 },
      ]);
    }
  }

  /**
   * Game Defeat: Low defeat slide + error vibration.
   */
  public lose() {
    if (this.sfxEnabled) {
      this.sound.playLose();
    }
    if (this.hapticsEnabled && this.haptics) {
      // Slow, soft single pulse that gently trails off — somber, not jarring
      this.haptics.trigger([
        { duration: 200, intensity: 0.3 },
        { delay: 150, duration: 80, intensity: 0.15 },
      ]);
    }
  }

  /**
   * Physical Collision / Impact (Puck, Paddle, Wall): Dynamic tone + matched impulse.
   */
  public hit(intensity: HitIntensity = 'medium') {
    if (this.sfxEnabled) {
      this.sound.playHit(intensity);
    }
    if (this.hapticsEnabled && this.haptics) {
      const preset = intensity === 'heavy' ? 'heavy' : intensity === 'light' ? 'light' : 'medium';
      this.haptics.trigger(preset);
    }
  }

  /**
   * UI Tap / Button Click: Subtle pop + micro tactile click.
   */
  public tap() {
    if (this.sfxEnabled) {
      this.sound.playTap();
    }
    if (this.hapticsEnabled && this.haptics) {
      this.haptics.trigger('selection');
    }
  }

  /**
   * Soft pop for placing items like dots.
   */
  public pop() {
    if (this.sfxEnabled) {
      this.sound.playPop();
    }
    if (this.hapticsEnabled && this.haptics) {
      this.haptics.trigger([{ duration: 15, intensity: 0.2 }]);
    }
  }

  /**
   * Deeper boop for organic explosions/expansions.
   */
  public boop() {
    if (this.sfxEnabled) {
      this.sound.playBoop();
    }
    if (this.hapticsEnabled && this.haptics) {
      this.haptics.trigger([{ duration: 30, intensity: 0.5 }]);
    }
  }

  /**
   * Direct access to underlying haptics trigger for custom patterns.
   */
  public customHaptic(input: Parameters<WebHaptics['trigger']>[0], options?: Parameters<WebHaptics['trigger']>[1]) {
    if (this.hapticsEnabled && this.haptics) {
      this.haptics.trigger(input, options);
    }
  }
}

export const feedback = new FeedbackManager();
