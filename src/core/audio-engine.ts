export type SoundEvent =
  | 'spawn'
  | 'tool_start'
  | 'tool_result'
  | 'signal'
  | 'complete'
  | 'error'
  | 'pause'
  | 'resume';

class AudioEngine {
  private ctx: AudioContext | null = null;
  private _enabled = false;
  private _volume = 0.3;

  get enabled(): boolean { return this._enabled; }

  enable(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    this._enabled = true;
  }

  disable(): void {
    this._enabled = false;
  }

  setVolume(v: number): void {
    this._volume = Math.max(0, Math.min(1, v));
  }

  play(event: SoundEvent): void {
    if (!this._enabled || !this.ctx || document.hidden) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;

    switch (event) {
      case 'spawn': {
        // Rising two-tone chime (200ms)
        const gain = ctx.createGain();
        gain.connect(ctx.destination);
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.linearRampToValueAtTime(800, now + 0.2);
        gain.gain.setValueAtTime(this._volume, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.25);
        osc.connect(gain);
        osc.start(now);
        osc.stop(now + 0.25);
        break;
      }
      case 'tool_start': {
        // Soft click (50ms)
        const gain = ctx.createGain();
        gain.connect(ctx.destination);
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 600;
        gain.gain.setValueAtTime(this._volume * 0.5, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.05);
        osc.connect(gain);
        osc.start(now);
        osc.stop(now + 0.06);
        break;
      }
      case 'tool_result': {
        // Subtle confirmation (100ms)
        const gain = ctx.createGain();
        gain.connect(ctx.destination);
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 800;
        gain.gain.setValueAtTime(this._volume * 0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
        osc.connect(gain);
        osc.start(now);
        osc.stop(now + 0.13);
        break;
      }
      case 'signal': {
        // Double blip
        const g1 = ctx.createGain();
        g1.connect(ctx.destination);
        const osc1 = ctx.createOscillator();
        osc1.type = 'sine';
        osc1.frequency.value = 500;
        g1.gain.setValueAtTime(this._volume * 0.5, now);
        g1.gain.linearRampToValueAtTime(0, now + 0.05);
        osc1.connect(g1);
        osc1.start(now);
        osc1.stop(now + 0.06);

        const g2 = ctx.createGain();
        g2.connect(ctx.destination);
        const osc2 = ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.value = 700;
        g2.gain.setValueAtTime(this._volume * 0.5, now + 0.08);
        g2.gain.linearRampToValueAtTime(0, now + 0.13);
        osc2.connect(g2);
        osc2.start(now + 0.08);
        osc2.stop(now + 0.14);
        break;
      }
      case 'complete': {
        // Warm chord (C-E-G, 400ms)
        [261.6, 329.6, 392.0].forEach((freq) => {
          const g = ctx.createGain();
          g.connect(ctx.destination);
          const osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.value = freq;
          g.gain.setValueAtTime(this._volume * 0.3, now);
          g.gain.exponentialRampToValueAtTime(0.01, now + 0.45);
          osc.connect(g);
          osc.start(now);
          osc.stop(now + 0.5);
        });
        break;
      }
      case 'error': {
        // Low warning tone with vibrato
        const gain = ctx.createGain();
        gain.connect(ctx.destination);
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 200;
        const vibrato = ctx.createOscillator();
        vibrato.frequency.value = 8;
        const vibratoGain = ctx.createGain();
        vibratoGain.gain.value = 10;
        vibrato.connect(vibratoGain).connect(osc.frequency);
        vibrato.start(now);
        vibrato.stop(now + 0.35);
        gain.gain.setValueAtTime(this._volume * 0.4, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.3);
        osc.connect(gain);
        osc.start(now);
        osc.stop(now + 0.35);
        break;
      }
      case 'pause': {
        // Descending two-tone
        const gain = ctx.createGain();
        gain.connect(ctx.destination);
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.linearRampToValueAtTime(400, now + 0.15);
        gain.gain.setValueAtTime(this._volume * 0.5, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.18);
        osc.connect(gain);
        osc.start(now);
        osc.stop(now + 0.2);
        break;
      }
      case 'resume': {
        // Ascending two-tone
        const gain = ctx.createGain();
        gain.connect(ctx.destination);
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.linearRampToValueAtTime(600, now + 0.15);
        gain.gain.setValueAtTime(this._volume * 0.5, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.18);
        osc.connect(gain);
        osc.start(now);
        osc.stop(now + 0.2);
        break;
      }
    }
  }
}

export const audioEngine = new AudioEngine();
