import type { Activation } from '../types';
import type { TaskItem } from '../stores/task-queue-store';
import type { VFSState } from '../stores/vfs-store';
import { computeHash } from '../utils/vfs-helpers';

type Store<T> = { getState(): T; subscribe(listener: (state: T) => void): () => void };

const AUTONOMOUS_STATE_VERSION = 1;
const AUTONOMOUS_STATE_ROOT = 'memory/autonomous';
const MAX_NOTE_COUNT = 12;

export type AutonomousMissionStatus = 'running' | 'paused' | 'completed' | 'stopped' | 'error';

export type PendingActivationSnapshot = Omit<Activation, 'id' | 'createdAt'>;

export interface AutonomousMissionState {
  version: number;
  missionId: string;
  agentPath: string;
  missionPrompt: string;
  status: AutonomousMissionStatus;
  totalCycles: number;
  totalTokens: number;
  taskQueue: TaskItem[];
  pendingActivations: PendingActivationSnapshot[];
  cycleNotes: string[];
  createdAt: number;
  updatedAt: number;
  lastSummaryAt?: number;
  lastRunStartedAt?: number;
  lastRunFinishedAt?: number;
  lastError?: string;
}

export interface PrepareMissionStateResult {
  state: AutonomousMissionState;
  statePath: string;
  resumed: boolean;
}

function missionStatePath(agentPath: string): string {
  const base = agentPath
    .replace(/^agents\//, '')
    .replace(/\.md$/i, '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'agent';
  const hash = computeHash(agentPath).replace(/[^a-z0-9_-]/gi, '_');
  return `${AUTONOMOUS_STATE_ROOT}/${base}-${hash}.json`;
}

function normalizePrompt(prompt: string): string {
  return prompt.trim().replace(/\s+/g, ' ').toLowerCase();
}

function sanitizeTaskItem(input: unknown): TaskItem | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;

  if (typeof raw.id !== 'string' || raw.id.trim() === '') return null;
  if (typeof raw.description !== 'string') return null;
  if (
    raw.status !== 'pending' &&
    raw.status !== 'in_progress' &&
    raw.status !== 'done' &&
    raw.status !== 'blocked'
  ) return null;
  if (typeof raw.notes !== 'string') return null;
  if (typeof raw.priority !== 'number' || Number.isNaN(raw.priority)) return null;
  if (typeof raw.createdAt !== 'number' || Number.isNaN(raw.createdAt)) return null;
  if (typeof raw.updatedAt !== 'number' || Number.isNaN(raw.updatedAt)) return null;

  return {
    id: raw.id,
    description: raw.description,
    status: raw.status,
    notes: raw.notes,
    priority: raw.priority,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function sanitizePendingActivation(input: unknown): PendingActivationSnapshot | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.agentId !== 'string' || raw.agentId.trim() === '') return null;
  if (typeof raw.input !== 'string') return null;
  if (typeof raw.spawnDepth !== 'number' || Number.isNaN(raw.spawnDepth)) return null;
  if (typeof raw.priority !== 'number' || Number.isNaN(raw.priority)) return null;

  return {
    agentId: raw.agentId,
    input: raw.input,
    parentId: typeof raw.parentId === 'string' && raw.parentId.trim() ? raw.parentId : undefined,
    spawnDepth: raw.spawnDepth,
    priority: raw.priority,
  };
}

function sanitizeNotes(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(-MAX_NOTE_COUNT);
}

function sanitizeStatus(input: unknown): AutonomousMissionStatus {
  if (
    input === 'running' ||
    input === 'paused' ||
    input === 'completed' ||
    input === 'stopped' ||
    input === 'error'
  ) {
    return input;
  }
  return 'paused';
}

function sanitizeState(raw: unknown, agentPath: string): AutonomousMissionState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;

  const savedAgentPath = typeof value.agentPath === 'string' ? value.agentPath : '';
  if (!savedAgentPath || savedAgentPath !== agentPath) return null;

  const missionPrompt = typeof value.missionPrompt === 'string' ? value.missionPrompt : '';
  if (!missionPrompt) return null;

  const taskQueue = Array.isArray(value.taskQueue)
    ? value.taskQueue.map(sanitizeTaskItem).filter((t): t is TaskItem => t !== null)
    : [];
  const pendingActivations = Array.isArray(value.pendingActivations)
    ? value.pendingActivations
      .map(sanitizePendingActivation)
      .filter((a): a is PendingActivationSnapshot => a !== null)
    : [];

  const now = Date.now();
  return {
    version: AUTONOMOUS_STATE_VERSION,
    missionId:
      typeof value.missionId === 'string' && value.missionId.trim()
        ? value.missionId
        : `mission-${computeHash(`${agentPath}:${now}`)}-${now}`,
    agentPath,
    missionPrompt,
    status: sanitizeStatus(value.status),
    totalCycles:
      typeof value.totalCycles === 'number' && value.totalCycles >= 0
        ? Math.floor(value.totalCycles)
        : 0,
    totalTokens:
      typeof value.totalTokens === 'number' && value.totalTokens >= 0
        ? Math.floor(value.totalTokens)
        : 0,
    taskQueue,
    pendingActivations,
    cycleNotes: sanitizeNotes(value.cycleNotes),
    createdAt:
      typeof value.createdAt === 'number' && value.createdAt > 0
        ? value.createdAt
        : now,
    updatedAt:
      typeof value.updatedAt === 'number' && value.updatedAt > 0
        ? value.updatedAt
        : now,
    lastSummaryAt:
      typeof value.lastSummaryAt === 'number' && value.lastSummaryAt > 0
        ? value.lastSummaryAt
        : undefined,
    lastRunStartedAt:
      typeof value.lastRunStartedAt === 'number' && value.lastRunStartedAt > 0
        ? value.lastRunStartedAt
        : undefined,
    lastRunFinishedAt:
      typeof value.lastRunFinishedAt === 'number' && value.lastRunFinishedAt > 0
        ? value.lastRunFinishedAt
        : undefined,
    lastError:
      typeof value.lastError === 'string' && value.lastError.trim()
        ? value.lastError
        : undefined,
  };
}

export function createMissionState(agentPath: string, missionPrompt: string, now = Date.now()): AutonomousMissionState {
  return {
    version: AUTONOMOUS_STATE_VERSION,
    missionId: `mission-${computeHash(`${agentPath}:${missionPrompt}:${now}`)}-${now}`,
    agentPath,
    missionPrompt: missionPrompt.trim(),
    status: 'running',
    totalCycles: 0,
    totalTokens: 0,
    taskQueue: [],
    pendingActivations: [],
    cycleNotes: [],
    createdAt: now,
    updatedAt: now,
    lastRunStartedAt: now,
  };
}

export function loadMissionState(
  vfs: Store<VFSState>,
  agentPath: string,
): { state: AutonomousMissionState; statePath: string } | null {
  const statePath = missionStatePath(agentPath);
  const raw = vfs.getState().read(statePath);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const state = sanitizeState(parsed, agentPath);
    if (!state) return null;
    return { state, statePath };
  } catch {
    return null;
  }
}

export function saveMissionState(
  vfs: Store<VFSState>,
  statePath: string,
  state: AutonomousMissionState,
): void {
  const nextState: AutonomousMissionState = {
    ...state,
    version: AUTONOMOUS_STATE_VERSION,
    cycleNotes: state.cycleNotes.slice(-MAX_NOTE_COUNT),
    updatedAt: Date.now(),
  };
  vfs.getState().write(statePath, JSON.stringify(nextState, null, 2), {});
}

export function prepareMissionState(
  vfs: Store<VFSState>,
  agentPath: string,
  missionPrompt: string,
  resumeMission: boolean,
): PrepareMissionStateResult {
  const loaded = loadMissionState(vfs, agentPath);
  const normalizedPrompt = normalizePrompt(missionPrompt);
  const now = Date.now();

  if (!resumeMission || !loaded) {
    return {
      state: createMissionState(agentPath, missionPrompt, now),
      statePath: loaded?.statePath ?? missionStatePath(agentPath),
      resumed: false,
    };
  }

  const canResume = normalizePrompt(loaded.state.missionPrompt) === normalizedPrompt;
  if (!canResume) {
    return {
      state: createMissionState(agentPath, missionPrompt, now),
      statePath: loaded.statePath,
      resumed: false,
    };
  }

  return {
    state: {
      ...loaded.state,
      status: 'running',
      updatedAt: now,
      lastRunStartedAt: now,
      lastError: undefined,
    },
    statePath: loaded.statePath,
    resumed: true,
  };
}

