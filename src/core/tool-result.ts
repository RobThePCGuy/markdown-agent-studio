export interface ToolResult {
  ok: boolean;
  value: string;
  errorType?: 'transient' | 'policy' | 'permanent';
}

export function isToolError(r: ToolResult): boolean {
  return !r.ok;
}

export function isTransientError(r: ToolResult): boolean {
  return !r.ok && r.errorType === 'transient';
}

export function successResult(value: string): ToolResult {
  return { ok: true, value };
}

export function errorResult(
  value: string,
  errorType: 'transient' | 'policy' | 'permanent' = 'permanent',
): ToolResult {
  return { ok: false, value, errorType };
}
