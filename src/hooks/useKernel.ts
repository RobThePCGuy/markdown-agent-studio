import { useCallback, useEffect, useState } from 'react';
import { runController } from '../core/run-controller';

export function useKernel() {
  const [state, setState] = useState(runController.getState());

  useEffect(() => runController.subscribe(setState), []);

  const run = useCallback(async (
    agentPath: string,
    input: string,
    options?: { autonomous?: boolean },
  ) => {
    if (options?.autonomous) {
      await runController.runAutonomous(agentPath, input);
    } else {
      await runController.run(agentPath, input);
    }
  }, []);

  const replayFromEvent = useCallback(async (eventId: string) => {
    return runController.replayFromEvent(eventId);
  }, []);

  const restoreFromEvent = useCallback((eventId: string) => {
    return runController.restoreFromEvent(eventId);
  }, []);

  const pause = useCallback(() => {
    runController.pause();
  }, []);

  const resume = useCallback(() => {
    runController.resume();
  }, []);

  const killAll = useCallback(() => {
    runController.killAll();
  }, []);

  const runWorkflow = useCallback(async (workflowPath: string, variables?: Record<string, string>) => {
    await runController.runWorkflow(workflowPath, variables);
  }, []);

  return {
    run,
    runWorkflow,
    replayFromEvent,
    restoreFromEvent,
    pause,
    resume,
    killAll,
    ...state,
  };
}
