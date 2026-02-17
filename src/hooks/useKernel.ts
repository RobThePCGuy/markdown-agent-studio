import { useRef, useCallback, useState } from 'react';
import { Kernel } from '../core/kernel';
import { GeminiProvider } from '../core/gemini-provider';
import { MockAIProvider } from '../core/mock-provider';
import { vfsStore, agentRegistry, eventLogStore, sessionStore, uiStore } from '../stores/use-stores';
import type { KernelConfig } from '../types';

export function useKernel() {
  const kernelRef = useRef<Kernel | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [totalTokens, setTotalTokens] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [queueCount, setQueueCount] = useState(0);

  const createKernel = useCallback((config: KernelConfig) => {
    const apiKey = uiStore.getState().apiKey;
    const provider = apiKey && apiKey !== 'your-api-key-here'
      ? new GeminiProvider(apiKey)
      : new MockAIProvider([
          { type: 'text', text: 'Mock response (no API key configured)' },
          { type: 'done', tokenCount: 10 },
        ]);

    const kernel = new Kernel({
      aiProvider: provider,
      vfs: vfsStore,
      registry: agentRegistry,
      eventLog: eventLogStore,
      config,
      sessionStore,
      onSessionUpdate: () => {
        setTotalTokens(kernel.totalTokens);
        setActiveCount(kernel.activeSessionCount);
        setQueueCount(kernel.queueLength);
      },
    });

    kernelRef.current = kernel;
    return kernel;
  }, []);

  const run = useCallback(async (agentPath: string, input: string) => {
    const config = uiStore.getState().kernelConfig;
    const kernel = createKernel(config);

    kernel.enqueue({
      agentId: agentPath,
      input,
      spawnDepth: 0,
      priority: 0,
    });

    setIsRunning(true);
    try {
      await kernel.runUntilEmpty();
    } finally {
      setIsRunning(false);
      setTotalTokens(kernel.totalTokens);
      setActiveCount(0);
      setQueueCount(0);
    }
  }, [createKernel]);

  const pause = useCallback(() => {
    kernelRef.current?.pause();
    setIsPaused(true);
  }, []);

  const resume = useCallback(() => {
    kernelRef.current?.resume();
    setIsPaused(false);
  }, []);

  const killAll = useCallback(() => {
    kernelRef.current?.killAll();
    setIsRunning(false);
    setIsPaused(false);
  }, []);

  return { run, pause, resume, killAll, isRunning, isPaused, totalTokens, activeCount, queueCount };
}
