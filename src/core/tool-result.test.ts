import { describe, it, expect } from 'vitest';
import {
  isToolError,
  isTransientError,
  successResult,
  errorResult,
} from './tool-result';

describe('tool-result', () => {
  describe('successResult', () => {
    it('returns ok: true with the given value', () => {
      const r = successResult('file contents here');
      expect(r.ok).toBe(true);
      expect(r.value).toBe('file contents here');
      expect(r.errorType).toBeUndefined();
    });

    it('handles empty string value', () => {
      const r = successResult('');
      expect(r.ok).toBe(true);
      expect(r.value).toBe('');
    });
  });

  describe('errorResult', () => {
    it('returns ok: false with permanent error by default', () => {
      const r = errorResult('Something went wrong');
      expect(r.ok).toBe(false);
      expect(r.value).toBe('Something went wrong');
      expect(r.errorType).toBe('permanent');
    });

    it('supports transient error type', () => {
      const r = errorResult('Network timeout', 'transient');
      expect(r.ok).toBe(false);
      expect(r.value).toBe('Network timeout');
      expect(r.errorType).toBe('transient');
    });

    it('supports policy error type', () => {
      const r = errorResult('Policy blocked tool', 'policy');
      expect(r.ok).toBe(false);
      expect(r.value).toBe('Policy blocked tool');
      expect(r.errorType).toBe('policy');
    });

    it('handles empty string value', () => {
      const r = errorResult('');
      expect(r.ok).toBe(false);
      expect(r.value).toBe('');
      expect(r.errorType).toBe('permanent');
    });
  });

  describe('isToolError', () => {
    it('returns false for success results', () => {
      expect(isToolError(successResult('ok'))).toBe(false);
    });

    it('returns true for error results', () => {
      expect(isToolError(errorResult('bad'))).toBe(true);
    });

    it('returns true for transient errors', () => {
      expect(isToolError(errorResult('timeout', 'transient'))).toBe(true);
    });

    it('returns true for policy errors', () => {
      expect(isToolError(errorResult('blocked', 'policy'))).toBe(true);
    });
  });

  describe('isTransientError', () => {
    it('returns false for success results', () => {
      expect(isTransientError(successResult('ok'))).toBe(false);
    });

    it('returns false for permanent errors', () => {
      expect(isTransientError(errorResult('bad', 'permanent'))).toBe(false);
    });

    it('returns false for policy errors', () => {
      expect(isTransientError(errorResult('blocked', 'policy'))).toBe(false);
    });

    it('returns true for transient errors', () => {
      expect(isTransientError(errorResult('timeout', 'transient'))).toBe(true);
    });
  });
});
