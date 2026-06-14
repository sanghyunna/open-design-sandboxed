export type ProjectCheckpointKind =
  | 'before_run'
  | 'after_run_unfinalized'
  | 'after_message'
  | 'before_restore'
  | 'manual';

export type RollbackMode =
  | 'files_only'
  | 'chat_only'
  | 'files_and_chat';

export type RollbackConflictPolicy =
  | 'fail'
  | 'overwrite'
  | 'keep_current';

export interface ProjectCheckpointSummary {
  id: string;
  projectId: string;
  conversationId: string | null;
  messageId: string | null;
  runId: string | null;
  kind: ProjectCheckpointKind;
  createdAt: number;
  rootPathHash: string;
  fileCount: number;
  totalBytes: number;
  manifestHash: string;
  restoreModes: RollbackMode[];
}

export interface ProjectCheckpointFileDelta {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'unchanged';
  fromHash?: string | null;
  toHash?: string | null;
  fromSize?: number | null;
  toSize?: number | null;
}

export type ProjectCheckpointConflictReason =
  | 'current_changed_since_checkpoint'
  | 'current_deleted_since_checkpoint'
  | 'target_path_blocked'
  | 'unsupported_file_type'
  | 'path_escapes_project';

export interface ProjectCheckpointConflict {
  path: string;
  reason: ProjectCheckpointConflictReason;
  currentHash?: string | null;
  expectedHash?: string | null;
  targetHash?: string | null;
}

export interface ProjectCheckpointsResponse {
  checkpoints: ProjectCheckpointSummary[];
}

export interface ProjectCheckpointResponse {
  checkpoint: ProjectCheckpointSummary;
}

export interface ProjectCheckpointDiffResponse {
  checkpoint: ProjectCheckpointSummary;
  baseCheckpoint?: ProjectCheckpointSummary | null;
  files: ProjectCheckpointFileDelta[];
  conflicts: ProjectCheckpointConflict[];
}

export interface RollbackRequest {
  targetMessageId: string;
  targetCheckpointId?: string;
  mode: RollbackMode;
  conflictPolicy?: RollbackConflictPolicy;
  createSafetyCheckpoint?: boolean;
}

export interface RollbackFileChangeCounts {
  added: number;
  modified: number;
  deleted: number;
  unchanged: number;
}

export interface RollbackResponse {
  projectId: string;
  conversationId: string;
  mode: RollbackMode;
  targetMessageId: string;
  restoredCheckpointId?: string | null;
  safetyCheckpointId?: string | null;
  deletedMessageIds: string[];
  clearedAgentSessions: boolean;
  fileChanges: RollbackFileChangeCounts;
  conflicts: ProjectCheckpointConflict[];
}

export interface RollbackConflictError {
  code: 'ROLLBACK_CONFLICT';
  message: string;
  conflicts: ProjectCheckpointConflict[];
}

export interface RollbackConflictResponse {
  error: RollbackConflictError;
}
