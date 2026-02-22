export const RUN_ONCE_EVENT = 'mas:run-once';
export const RUN_AUTONOMOUS_EVENT = 'mas:run-autonomous';
export const TOGGLE_PAUSE_EVENT = 'mas:toggle-pause';
export const KILL_ALL_EVENT = 'mas:kill-all';
export const FOCUS_PROMPT_EVENT = 'mas:focus-kickoff-prompt';

export function dispatchRunControlEvent(eventName: string): void {
  window.dispatchEvent(new Event(eventName));
}
