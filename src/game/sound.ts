class PixelSoundEngine {
  private ctx: AudioContext | null = null;
  public muted = false;

  private ensureCtx(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private tone(freq: number, duration: number, type: OscillatorType = 'square', delay = 0, gainVal = 0.05) {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(gainVal, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  playClick() {
    this.tone(520, 0.045, 'square', 0, 0.03);
  }

  playHonestChime() {
    this.tone(523.25, 0.08, 'square', 0, 0.04);
    this.tone(659.25, 0.08, 'square', 0.07, 0.04);
    this.tone(783.99, 0.14, 'square', 0.14, 0.045);
  }

  playBluffBuzz() {
    this.tone(190, 0.1, 'sawtooth', 0, 0.045);
    this.tone(145, 0.15, 'sawtooth', 0.09, 0.045);
  }

  playLevelUp() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, i) => this.tone(n, 0.11, 'square', i * 0.08, 0.05));
  }

  playEquip() {
    this.tone(440, 0.06, 'triangle', 0, 0.05);
    this.tone(880, 0.1, 'triangle', 0.05, 0.05);
  }
}

export const soundFx = new PixelSoundEngine();
