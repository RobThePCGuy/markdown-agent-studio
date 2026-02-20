import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SoundEvent } from './audio-engine';

// Mock AudioContext before importing the module
const mockOscillator = () => ({
  type: 'sine',
  frequency: {
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  },
  connect: vi.fn().mockReturnThis(),
  start: vi.fn(),
  stop: vi.fn(),
});

const mockGainNode = () => ({
  gain: {
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  },
  connect: vi.fn().mockReturnThis(),
});

const mockAudioContext = {
  state: 'running' as string,
  resume: vi.fn(),
  currentTime: 0,
  createOscillator: vi.fn(() => mockOscillator()),
  createGain: vi.fn(() => mockGainNode()),
  destination: {},
};

// Use a proper constructor function so `new AudioContext()` works
globalThis.AudioContext = vi.fn(function (this: Record<string, unknown>) {
  Object.assign(this, mockAudioContext);
}) as unknown as typeof AudioContext;

// Import after mocking AudioContext
const { audioEngine } = await import('./audio-engine');

describe('AudioEngine', () => {
  beforeEach(() => {
    audioEngine.disable();
    mockAudioContext.createOscillator.mockClear();
    mockAudioContext.createGain.mockClear();
  });

  it('starts disabled', () => {
    expect(audioEngine.enabled).toBe(false);
  });

  it('enable() sets enabled to true', () => {
    audioEngine.enable();
    expect(audioEngine.enabled).toBe(true);
  });

  it('disable() sets enabled to false', () => {
    audioEngine.enable();
    expect(audioEngine.enabled).toBe(true);
    audioEngine.disable();
    expect(audioEngine.enabled).toBe(false);
  });

  it('play() does nothing when disabled (no errors)', () => {
    const events: SoundEvent[] = [
      'spawn', 'tool_start', 'tool_result', 'signal',
      'complete', 'error', 'pause', 'resume',
    ];
    for (const event of events) {
      expect(() => audioEngine.play(event)).not.toThrow();
    }
    // Since disabled, createOscillator should not have been called
    expect(mockAudioContext.createOscillator).not.toHaveBeenCalled();
  });

  it('play() creates oscillators and gain nodes when enabled', () => {
    audioEngine.enable();
    audioEngine.play('spawn');
    expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    expect(mockAudioContext.createGain).toHaveBeenCalled();
  });

  it('setVolume() clamps to 0-1 range', () => {
    audioEngine.enable();

    // Setting volume above 1 should clamp to 1
    audioEngine.setVolume(5);
    audioEngine.play('spawn');
    const gainCalls = mockAudioContext.createGain.mock.results;
    const lastGain = gainCalls[gainCalls.length - 1].value;
    const setValueCalls = lastGain.gain.setValueAtTime.mock.calls;
    // Volume was clamped to 1, so for spawn the gain is this._volume (= 1)
    expect(setValueCalls[0][0]).toBe(1);

    mockAudioContext.createGain.mockClear();
    mockAudioContext.createOscillator.mockClear();

    // Setting volume below 0 should clamp to 0
    audioEngine.setVolume(-2);
    audioEngine.play('spawn');
    const gainCalls2 = mockAudioContext.createGain.mock.results;
    const lastGain2 = gainCalls2[gainCalls2.length - 1].value;
    const setValueCalls2 = lastGain2.gain.setValueAtTime.mock.calls;
    expect(setValueCalls2[0][0]).toBe(0);

    // Reset to default
    audioEngine.setVolume(0.3);
  });

  it('play() handles all sound event types without error', () => {
    audioEngine.enable();
    const events: SoundEvent[] = [
      'spawn', 'tool_start', 'tool_result', 'signal',
      'complete', 'error', 'pause', 'resume',
    ];
    for (const event of events) {
      expect(() => audioEngine.play(event)).not.toThrow();
    }
  });
});
