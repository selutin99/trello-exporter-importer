import { z } from 'zod';
import { Locale } from '../i18n/types';
import {
  RestoreMode,
  RestoreError,
  RestoreErrorCode,
  RestoreResource,
  RestoreStatus,
  RestoreWarning,
} from './codes';
import type { JournalStore, RestoreContext, RestoreJournal, MergeJournal } from './types';
import type { RestoreTarget } from './types';
import type { ImportedBoard } from '../import/read';
import type { MergePlan } from './merge/types';
import { MergeActionKind } from './merge/types';
import { excludedFieldRecords, restorationPlan } from './plan';

// Keep existing checkpoints and uncertain-write guards across product renames.
const key = 'trello-exporter-restore-journal';
const journalSchema = z.object({
  format: z.literal('trello-exporter.restore-report'),
  formatVersion: z.literal('0.1.0'),
  operationId: z.uuid(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  snapshotId: z.uuid(),
  sourceContextId: z.string().regex(/^[a-f0-9]{24}$/),
  workspaceId: z.string().regex(/^[a-f0-9]{24}$/),
  target: z
    .object({
      id: z.string().regex(/^[a-f0-9]{24}$/),
      name: z.string(),
      workspaceId: z.string().regex(/^[a-f0-9]{24}$/),
      url: z.string(),
    })
    .nullable(),
  startedAt: z.string(),
  updatedAt: z.string(),
  status: z.enum(RestoreStatus),
  pending: z.string().nullable(),
  completed: z.record(z.string(), z.string()),
  skipped: z.array(z.string()),
  warnings: z.array(z.enum(RestoreWarning)),
  error: z.string().nullable(),
  commentLocale: z.enum(Locale).optional(),
  mode: z.enum(RestoreMode).optional(),
  merge: z
    .object({
      plannedCreates: z.number().int().nonnegative(),
      plannedUpdates: z.number().int().nonnegative(),
      unchanged: z.number().int().nonnegative(),
      retained: z.number().int().nonnegative(),
    })
    .optional(),
  sourceBoardId: z.string().max(128).optional(),
  bindings: z.record(z.string(), z.string()).optional(),
  decisions: z.record(z.string(), z.string()).optional(),
  planned: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)).optional(),
  commentParts: z.record(z.string(), z.array(z.string())).optional(),
});

/** Same-browser operation storage; downloaded reports cannot authorize arbitrary targets */
export class LocalJournalStore implements JournalStore {
  /**
   * Binds the optional browser storage boundary
   * @param storage - Local browser storage, never imported snapshot data
   */
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'>) {}

  /**
   * Reads this browser's last operation with structural validation
   * @returns A valid local journal or null when none exists
   * @throws RestoreError for unavailable or corrupt storage
   */
  read(): RestoreJournal | null {
    try {
      const text = this.storage.getItem(key);
      if (!text) return null;
      const value: unknown = JSON.parse(text);
      const parsed = journalSchema.safeParse(value);
      if (!parsed.success) throw new Error();
      return parsed.data;
    } catch {
      throw new RestoreError(RestoreErrorCode.JournalUnavailable);
    }
  }

  /**
   * Persists an operation checkpoint before any creating request
   * @param journal - Token-free operation state
   * @throws RestoreError if durable storage is unavailable
   */
  save(journal: RestoreJournal): void {
    try {
      this.storage.setItem(key, JSON.stringify(journal));
    } catch {
      throw new RestoreError(RestoreErrorCode.JournalUnavailable);
    }
  }
}

/**
 * Keeps an unresolved write journal from being replaced, including on another board
 * @param journal - Last structurally validated local operation
 * @returns Whether a pending request or uncertain result requires reconciliation
 */
export function hasUncertainWrite(journal: RestoreJournal | null): boolean {
  return journal !== null && (journal.pending !== null || journal.status === RestoreStatus.Unknown);
}

/**
 * Checks whether this exact input and live context can safely continue a local operation
 * @param journal - Last structurally validated local operation
 * @param checksum - Exact selected file checksum
 * @param context - Current verified source board and destination Workspace
 * @returns Whether the journal has a target and no uncertain or finished steps
 */
export function canResumeJournal(
  journal: RestoreJournal | null,
  checksum: string,
  context: RestoreContext,
): journal is MergeJournal {
  return (
    journal !== null &&
    journal.target !== null &&
    journal.target.id === context.boardId &&
    journal.mode === RestoreMode.Merge &&
    journal.bindings !== undefined &&
    journal.planned !== undefined &&
    journal.decisions !== undefined &&
    journal.commentParts !== undefined &&
    journal.sourceBoardId !== undefined &&
    journal.checksum === checksum &&
    journal.sourceContextId === context.boardId &&
    journal.workspaceId === context.workspaceId &&
    journal.pending === null &&
    (journal.commentLocale !== undefined || !hasCommentSteps(journal)) &&
    [RestoreStatus.Failed, RestoreStatus.Cancelled, RestoreStatus.Running].includes(journal.status)
  );
}

function hasCommentSteps(journal: RestoreJournal): boolean {
  return [...Object.keys(journal.completed), ...journal.skipped].some((key) =>
    key.startsWith(`${RestoreResource.Comment}/`),
  );
}

interface NewMergeJournal {
  imported: ImportedBoard;
  context: RestoreContext;
  target: RestoreTarget;
  plan: MergePlan;
  planned: Record<string, string>;
  locale: Locale;
  previous: RestoreJournal | null;
}

/**
 * Creates token-free operation metadata from a revalidated current-board merge
 * @param input - Verified destination, reviewed writes, file identity, and reusable mappings
 * @returns An unsaved running journal with no pending or completed writes
 */
export function createMergeJournal({
  imported,
  context,
  target,
  plan,
  planned,
  locale,
  previous,
}: NewMergeJournal): MergeJournal {
  const now = new Date().toISOString();
  const creates = plan.actions.filter((action) => action.kind !== MergeActionKind.Update).length;
  return {
    format: 'trello-exporter.restore-report',
    formatVersion: '0.1.0',
    operationId: crypto.randomUUID(),
    checksum: imported.checksum,
    snapshotId: imported.snapshot.snapshotId,
    sourceContextId: context.boardId,
    workspaceId: context.workspaceId,
    target,
    startedAt: now,
    updatedAt: now,
    status: RestoreStatus.Running,
    pending: null,
    completed: {},
    skipped: excludedFieldRecords(imported.snapshot),
    warnings: restorationPlan(imported).warnings.filter(
      (warning) => plan.actions.length > 0 || warning === RestoreWarning.CustomFields,
    ),
    error: null,
    commentLocale: locale,
    mode: RestoreMode.Merge,
    sourceBoardId: imported.snapshot.board.id,
    bindings: { ...plan.bindings },
    decisions: { ...plan.decisions },
    planned,
    commentParts: Object.fromEntries(
      Object.entries(previous?.commentParts ?? {}).filter(
        ([key]) => previous?.bindings?.[key] === plan.bindings[key],
      ),
    ),
    merge: {
      plannedCreates: creates,
      plannedUpdates: plan.actions.length - creates,
      unchanged: plan.unchanged,
      retained: plan.retained,
    },
  };
}
