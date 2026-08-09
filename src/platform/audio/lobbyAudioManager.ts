/**
 * Lobby Audio Manager (Web Audio API Edition)
 * 
 * Manages background music lifecycle with smooth native fade-in / fade-out,
 * browser autoplay unlock mechanisms, guaranteed GAPLESS looping,
 * and Authoritative Cross-Device Timeline Synchronization.
 */

class LobbyAudioManager {
  private ctx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private audioBuffer: AudioBuffer | null = null;
  private loadPromise: Promise<void> | null = null;

  private unlocked = false;
  private musicVolume = 0; // Default 0%
  private sfxVolume = 0.5;   // Default 50%
  private currentFadeTarget = 0.2; // Track current intended target for fade operations
  private playbackRate = 1.0; // Normal playback rate, using pre-slowed audio
  private isPlaying = false;
  private playbackStartCtxTime = 0;
  private initialSyncedOffset = 0;
  private stopTimeout: number | null = null;
  private rawArrayBuffer: ArrayBuffer | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.setupGlobalUnlockListener();
      this.setupVisibilityListener();
      this.loadSettings();
      // Start downloading and decoding the audio in the background immediately
      this.loadAudio();
    }
  }

  private loadSettings() {
    if (typeof window !== 'undefined') {
      const savedMusic = localStorage.getItem('locade_music_volume');
      const savedSfx = localStorage.getItem('locade_sfx_volume');
      if (savedMusic !== null) this.musicVolume = parseFloat(savedMusic);
      if (savedSfx !== null) this.sfxVolume = parseFloat(savedSfx);
    }
  }

  public getMusicVolume(): number { return this.musicVolume; }
  public getSfxVolume(): number { return this.sfxVolume; }

  public setMusicVolume(vol: number) {
    const clamped = Math.max(0, Math.min(1, vol));
    this.musicVolume = clamped;
    if (typeof window !== 'undefined') {
      localStorage.setItem('locade_music_volume', clamped.toString());
    }
    // Update live volume if playing
    if (this.isPlaying && this.ctx && this.gainNode) {
      this.currentFadeTarget = clamped;
      this.gainNode.gain.cancelScheduledValues(this.ctx.currentTime);
      this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, this.ctx.currentTime);
      this.gainNode.gain.linearRampToValueAtTime(clamped, this.ctx.currentTime + 0.1); // Fast smooth ramp
    }
  }

  public setSfxVolume(vol: number) {
    const clamped = Math.max(0, Math.min(1, vol));
    this.sfxVolume = clamped;
    if (typeof window !== 'undefined') {
      localStorage.setItem('locade_sfx_volume', clamped.toString());
    }
  }

  /**
   * Plays a short synthesized "beep" to test SFX volume without external files.
   */
  public playTestSfx() {
    this.initContext();
    if (!this.ctx || this.ctx.state === 'suspended') return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    // Nice professional pop/click sound
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, this.ctx.currentTime + 0.05);

    gain.gain.setValueAtTime(this.sfxVolume, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.1);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(this.ctx.currentTime);
    osc.stop(this.ctx.currentTime + 0.1);
  }

  private stoppedByVisibility = false;

  private setupVisibilityListener() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          // Fully stop the audio source when the page is hidden.
          // suspend() alone is unreliable — network changes and other browser
          // events can resume the AudioContext unexpectedly.
          if (this.isPlaying) {
            this.stoppedByVisibility = true;
            this.stopImmediate();
          }
        }
        // We intentionally do NOT auto-resume here.
        // The Lobby component will call play() again via onVisibilityResume().
      });
    }
  }

  /**
   * Call this from the component's visibility-resume handler.
   * Only resumes playback if it was interrupted by the page going hidden.
   */
  public onVisibilityResume() {
    if (this.stoppedByVisibility) {
      this.stoppedByVisibility = false;
      this.play({ fadeInDuration: 1500 });
    }
  }

  /**
   * Immediately stops audio without fade — disconnects the source node
   * so nothing can accidentally restart it.
   */
  private stopImmediate() {
    this.initialSyncedOffset = this.getCurrentPosition();
    this.isPlaying = false;
    this.currentFadeTarget = 0;

    if (this.stopTimeout) {
      clearTimeout(this.stopTimeout);
      this.stopTimeout = null;
    }

    if (this.gainNode && this.ctx) {
      this.gainNode.gain.cancelScheduledValues(this.ctx.currentTime);
      this.gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
    }

    if (this.sourceNode) {
      try { this.sourceNode.stop(); } catch (e) {}
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    // Suspend the context as a belt-and-suspenders measure
    if (this.ctx && this.ctx.state === 'running') {
      this.ctx.suspend().catch(() => {});
    }
  }

  private setupGlobalUnlockListener() {
    const handleFirstInteraction = () => {
      this.unlock();
      window.removeEventListener('pointerdown', handleFirstInteraction);
      window.removeEventListener('keydown', handleFirstInteraction);
      window.removeEventListener('touchstart', handleFirstInteraction);
    };

    window.addEventListener('pointerdown', handleFirstInteraction, { passive: true, once: true });
    window.addEventListener('keydown', handleFirstInteraction, { passive: true, once: true });
    window.addEventListener('touchstart', handleFirstInteraction, { passive: true, once: true });
  }

  private initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.gainNode = this.ctx.createGain();
        this.gainNode.gain.value = 0;
        this.gainNode.connect(this.ctx.destination);
      }
    }
  }

  private async loadAudio() {
    if (this.audioBuffer) return;

    // Context now exists but a previous fetch completed without one — decode the cached bytes
    if (this.rawArrayBuffer && this.ctx) {
      try {
        this.audioBuffer = await this.ctx.decodeAudioData(this.rawArrayBuffer.slice(0));
      } catch (e) {
        console.warn('LobbyAudioManager decode retry error:', e);
      }
      return;
    }

    if (this.loadPromise) return this.loadPromise;

    this.initContext();
    this.loadPromise = (async () => {
      try {
        const response = await fetch('/audio/Final Stero low.ogg');
        this.rawArrayBuffer = await response.arrayBuffer();
        if (this.ctx) {
          this.audioBuffer = await this.ctx.decodeAudioData(this.rawArrayBuffer.slice(0));
        }
      } catch (e) {
        console.warn('LobbyAudioManager load error:', e);
      }
    })();
    return this.loadPromise;
  }

  /**
   * Unlock audio playback upon any user gesture (button tap, click, screen touch).
   */
  public async unlock(): Promise<boolean> {
    this.initContext();
    if (!this.ctx) return false;

    if (this.unlocked) return true;

    try {
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      
      // Play a tiny silent buffer to forcibly unlock the audio context (critical for iOS)
      const buffer = this.ctx.createBuffer(1, 1, 22050);
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.ctx.destination);
      source.start(0);

      this.unlocked = true;
      return true;
    } catch (err) {
      console.debug('Audio unlock deferred pending direct interaction:', err);
      return false;
    }
  }

  public isUnlocked(): boolean {
    return this.unlocked;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public isContextRunning(): boolean {
    return this.ctx?.state === 'running';
  }

  /**
   * Calculate current track playback position (in seconds) within the loop.
   */
  public getCurrentPosition(): number {
    if (!this.isPlaying || !this.ctx || !this.audioBuffer || this.audioBuffer.duration <= 0) {
      return this.initialSyncedOffset || 0;
    }

    const elapsedCtxTime = Math.max(0, this.ctx.currentTime - this.playbackStartCtxTime);
    
    // We strictly use the base playbackRate here. Multiplying the entire elapsed 
    // time by a momentary live rate (which fluctuates during elastic sync) would 
    // cause massive position jumps the longer the track has been playing.
    const elapsedTrackSeconds = elapsedCtxTime * this.playbackRate;
    return elapsedTrackSeconds % this.audioBuffer.duration;
  }

  /**
   * Synchronize this device's audio playback to an authoritative host track position.
   * If drift exceeds 80ms, gracefully re-anchors playback to maintain unison.
   */
  public syncTo(targetPosition: number) {
    if (typeof targetPosition !== 'number' || isNaN(targetPosition) || targetPosition < 0) return;

    if (!this.isPlaying || !this.ctx || !this.audioBuffer || this.audioBuffer.duration <= 0) {
      this.initialSyncedOffset = targetPosition;
      return;
    }

    const duration = this.audioBuffer.duration;
    const normalizedTarget = targetPosition % duration;
    const currentPos = this.getCurrentPosition();

    // Shortest path error accounting for loop boundary
    // error > 0 means guest is behind, needs to speed up
    // error < 0 means guest is ahead, needs to slow down
    let error = normalizedTarget - currentPos;
    if (error > duration / 2) error -= duration;
    if (error < -duration / 2) error += duration;

    // Hard snap for any drift > 150ms: clean position reset, inaudible because gain is preserved.
    // Elastic rate is reserved for tiny micro-drifts only.
    if (Math.abs(error) > 0.15) {
      this.startSource(normalizedTarget);
      if (this.gainNode && this.ctx) {
        this.gainNode.gain.cancelScheduledValues(this.ctx.currentTime);
        this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, this.ctx.currentTime);
        // Restore the intended volume that the cancelled fade was heading towards
        this.gainNode.gain.linearRampToValueAtTime(this.currentFadeTarget, this.ctx.currentTime + 0.3);
      }
      return;
    }

    // Soft Elastic Sync: Adjust playback rate slightly to catch up seamlessly
    if (this.sourceNode && Math.abs(error) > 0.02) {
      // Limit adjustment to +/- 3% speed to avoid noticeable pitch shifts
      const rateAdjustment = Math.max(-0.03, Math.min(0.03, error / 2));
      
      // Smoothly transition to the adjusted speed, and then back to normal after catching up
      this.sourceNode.playbackRate.setTargetAtTime(this.playbackRate + rateAdjustment, this.ctx.currentTime, 0.1);
      
      // Reset back to base playback rate after 4.5 seconds (just before next 5s sync pulse)
      this.sourceNode.playbackRate.setTargetAtTime(this.playbackRate, this.ctx.currentTime + 4.5, 0.5);
    }
  }

  private startSource(offsetSeconds = 0) {
    if (!this.ctx || !this.gainNode || !this.audioBuffer || this.audioBuffer.duration <= 0) return;

    const normalizedOffset = offsetSeconds % this.audioBuffer.duration;

    // In Web Audio API, BufferSourceNodes are single-use. Recreate on each playback segment.
    if (this.sourceNode) {
      try { this.sourceNode.stop(); } catch (e) {}
      this.sourceNode.disconnect();
    }

    this.sourceNode = this.ctx.createBufferSource();
    this.sourceNode.buffer = this.audioBuffer;
    this.sourceNode.loop = true; // Guaranteed gapless loop!
    this.sourceNode.playbackRate.value = this.playbackRate;
    
    this.sourceNode.connect(this.gainNode);

    // Anchor the timeline: how many context-seconds ago did offset=0 occur?
    // At playbackRate = 1.0 this simplifies to: startCtxTime = now - offset
    this.playbackStartCtxTime = this.ctx.currentTime - (normalizedOffset / this.playbackRate);
    this.sourceNode.start(0, normalizedOffset);
  }

  /**
   * Smoothly fades in the lobby background music using native audio scheduling.
   */
  public async play(options?: { fadeInDuration?: number; targetVolume?: number; startOffset?: number }) {
    await this.loadAudio();
    this.initContext();
    if (!this.ctx || !this.gainNode) return;

    const durationMs = options?.fadeInDuration ?? 5000;
    const targetVol = options?.targetVolume ?? this.musicVolume;
    this.currentFadeTarget = targetVol;
    
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    const startOffset = options?.startOffset ?? this.initialSyncedOffset ?? 0;
    this.initialSyncedOffset = 0;

    if (!this.isPlaying) {
      this.isPlaying = true;
      this.gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
      this.startSource(startOffset);
    }

    // Cancel any previous fade commands
    this.gainNode.gain.cancelScheduledValues(this.ctx.currentTime);
    
    // Smoothly ramp volume up
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, this.ctx.currentTime);
    this.gainNode.gain.linearRampToValueAtTime(targetVol, this.ctx.currentTime + (durationMs / 1000));
    
    if (this.stopTimeout) {
      clearTimeout(this.stopTimeout);
      this.stopTimeout = null;
    }
  }

  /**
   * Smoothly fades out and stops the lobby background music.
   */
  public stop(options?: { fadeOutDuration?: number }) {
    this.stoppedByVisibility = false; // Clear stale flag — explicit stop takes precedence

    if (!this.ctx || !this.gainNode || !this.isPlaying) {
      this.isPlaying = false;
      return;
    }

    // Capture the exact track position so we can resume from here later
    this.initialSyncedOffset = this.getCurrentPosition();

    const durationMs = options?.fadeOutDuration ?? 4000;
    this.isPlaying = false;
    this.currentFadeTarget = 0;

    // Smoothly ramp volume down to 0
    this.gainNode.gain.cancelScheduledValues(this.ctx.currentTime);
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, this.ctx.currentTime);
    this.gainNode.gain.linearRampToValueAtTime(0, this.ctx.currentTime + (durationMs / 1000));

    // Fully stop the audio source after the fade completes to save CPU
    if (this.stopTimeout) clearTimeout(this.stopTimeout);
    this.stopTimeout = window.setTimeout(() => {
      if (!this.isPlaying && this.sourceNode) {
        try { this.sourceNode.stop(); } catch (e) {}
        this.sourceNode.disconnect();
        this.sourceNode = null;
      }
    }, durationMs + 100);
  }
}

export const lobbyAudioManager = new LobbyAudioManager();
