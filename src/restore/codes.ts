export enum RestoreStatus {
  Ready = 'ready',
  Running = 'running',
  Complete = 'complete',
  Partial = 'partial',
  Failed = 'failed',
  Cancelled = 'cancelled',
  Unknown = 'unknown',
}
export enum RestoreMode {
  Merge = 'current-board-merge',
}
export enum RestoreResource {
  Board = 'boards',
  List = 'lists',
  Card = 'cards',
  Label = 'labels',
  Checklist = 'checklists',
  Item = 'checkItems',
  Attachment = 'attachments',
  Comment = 'comments',
  // Retained for legacy journal keys and explicit omissions; field writes are unsupported.
  Field = 'customFields',
  Option = 'options',
  Value = 'customFieldValues',
}
export enum RestoreWarning {
  SourcePartial = 'RESTORE_SOURCE_PARTIAL',
  Members = 'RESTORE_MEMBERS_NOT_ASSIGNED',
  Covers = 'RESTORE_COVERS_METADATA_ONLY',
  AdvancedItems = 'RESTORE_ITEM_ASSIGNEES_NOT_ASSIGNED',
  MissingFiles = 'RESTORE_MISSING_FILES',
  CommentSummary = 'RESTORE_COMMENT_SUMMARIES',
  CustomFields = 'RESTORE_CUSTOM_FIELDS_EXCLUDED',
  Unsupported = 'RESTORE_SECTION_UNAVAILABLE',
}
export enum RestoreErrorCode {
  InvalidTarget = 'RESTORE_INVALID_TARGET',
  JournalUnavailable = 'RESTORE_JOURNAL_UNAVAILABLE',
  JournalMismatch = 'RESTORE_JOURNAL_MISMATCH',
  UnknownWrite = 'RESTORE_UNKNOWN_WRITE',
  InvalidPlan = 'RESTORE_INVALID_PLAN',
  Failed = 'RESTORE_FAILED',
  PlanStale = 'RESTORE_PLAN_STALE',
  IncompleteTarget = 'RESTORE_TARGET_INCOMPLETE',
}
/** A restoration error without request or imported content */
export class RestoreError extends Error {
  /**
   * Creates a safe restoration error
   * @param code - Stable failure identifier
   */
  constructor(readonly code: RestoreErrorCode) {
    super(code);
    this.name = 'RestoreError';
  }
}
