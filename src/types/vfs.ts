export type FileKind = 'agent' | 'memory' | 'artifact' | 'unknown';

export interface FileVersion {
  timestamp: number;
  content: string;
  diff: string;
  authorAgentId?: string;
  activationId?: string;
}

export interface VFSFile {
  path: string;
  content: string;
  kind: FileKind;
  versions: FileVersion[];
  createdBy?: string;
  createdAt: number;
  updatedAt: number;
}

export interface WriteMeta {
  authorAgentId?: string;
  activationId?: string;
}
