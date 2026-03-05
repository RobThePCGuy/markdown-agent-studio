import { useEffect } from 'react';
import { eventLogStore, uiStore } from '../stores/use-stores';
import { audioEngine } from '../core/audio-engine';

export function useAudioEvents(): void {
  useEffect(() => {
    const unsub = eventLogStore.subscribe((state, prev) => {
      if (!uiStore.getState().soundEnabled) return;
      if (state.entries.length <= prev.entries.length) return;
      const latest = state.entries[state.entries.length - 1];
      switch (latest.type) {
        case 'spawn': audioEngine.play('spawn'); break;
        case 'tool_call': audioEngine.play('tool_start'); break;
        case 'tool_result': audioEngine.play('tool_result'); break;
        case 'signal': audioEngine.play('signal'); break;
        case 'complete': audioEngine.play('complete'); break;
        case 'error': audioEngine.play('error'); break;
      }
    });
    return unsub;
  }, []);
}
