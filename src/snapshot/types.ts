import type {
  AttachmentKind,
  CaptureOutcome,
  CustomFieldType,
  CoverageStatus,
  ExportStage,
  IssueCode,
} from './codes';
import type { ProductName } from '../config/product';

export interface Coverage {
  status: CoverageStatus;
  count: number;
}
export interface SnapshotIssue {
  code: IssueCode;
  severity: 'warning';
  entityType: string;
  entityId: string | null;
  message: string;
}
export interface SnapshotAttachment {
  id: string;
  cardId: string;
  name: string;
  kind: AttachmentKind;
  url: string | null;
  mimeType: string | null;
  size: number | null;
  file: null;
}
export interface Snapshot {
  format: 'trello-exporter.snapshot';
  formatVersion: '0.1.0';
  snapshotId: string;
  exporter: { name: ProductName; version: string };
  capture: {
    startedAt: string;
    completedAt: string;
    consistency: 'best-effort';
    changedDuringCapture: boolean | null;
    outcome: CaptureOutcome;
  };
  coverage: Record<string, Coverage>;
  board: { id: string; name: string; description: string; url: string | null; closed: boolean };
  lists: { id: string; name: string; order: number; closed: boolean }[];
  cards: {
    id: string;
    listId: string;
    name: string;
    description: string;
    order: number;
    closed: boolean;
    start: string | null;
    due: string | null;
    dueComplete: boolean;
    labelIds: string[];
    memberIds: string[];
    cover: {
      idAttachment: string | null;
      color: string | null;
      size: string;
      brightness: string;
    } | null;
  }[];
  labels: { id: string; name: string; color: string | null }[];
  members: { id: string; username: string; displayName: string }[];
  /** Legacy content; new captures retain an empty collection with excluded coverage */
  customFields: {
    id: string;
    name: string;
    type: CustomFieldType;
    order: number;
    options: { id: string; text: string; color: string; order: number }[];
  }[];
  /** Legacy content validated on import and reported as an intentional omission */
  customFieldValues: {
    cardId: string;
    fieldId: string;
    value?:
      | {
          text?: string | undefined;
          number?: string | undefined;
          date?: string | undefined;
          checked?: string | undefined;
        }
      | undefined;
    optionId?: string | undefined;
  }[];
  checklists: { id: string; cardId: string; name: string; order: number }[];
  checklistItems: {
    id: string;
    checklistId: string;
    name: string;
    order: number;
    checked: boolean;
    due?: string | null | undefined;
    memberId?: string | null | undefined;
  }[];
  comments: {
    id: string;
    cardId: string;
    authorId: string | null;
    authorDisplayName: string | null;
    createdAt: string;
    text: string;
    order: number;
  }[];
  attachments: SnapshotAttachment[];
  issues: SnapshotIssue[];
}
export interface ExportProgress {
  stage: ExportStage;
  current: number;
  total: number;
}
export interface CaptureOptions {
  signal?: AbortSignal;
  onProgress?: (progress: ExportProgress) => void;
}
