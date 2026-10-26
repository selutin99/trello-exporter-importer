import type { ImportedBoard } from '../import/read';
import { ApiError } from '../api/errors';
import { ApiErrorCode } from '../shared/error-codes';
import { canResumeJournal, createMergeJournal, hasUncertainWrite } from './journal';
import { RestoreError, RestoreErrorCode, RestoreStatus } from './codes';
import type {
  JournalStore,
  RestoreContext,
  RestoreJournal,
  RestoreOptions,
  RestoreWriter,
  MergeJournal,
} from './types';
import { RestoreCheckpoint } from './checkpoint';
import { executeMerge } from './merge/execute';
import { reviewMergePlan } from './merge/review';

export type { RestoreExecution, RestoreOptions } from './types';
export { commentSummaries } from './comments';

/** Applies reviewed snapshot content to the existing current board with durable write checkpoints */
export class RestoreEngine {
  /**
   * Binds a current-board writer and same-browser journal
   * @param api - SDK-scoped read/write boundary
   * @param store - Durable operation storage
   */
  constructor(
    private readonly api: RestoreWriter,
    private readonly store: JournalStore,
  ) {}

  /**
   * Revalidates and applies a resolved merge; boards are never created and current-only content is preserved
   * @param imported - Validated project JSON content
   * @param context - Current SDK-bound board, independent of imported source IDs
   * @param options - Reviewed merge plan, language, cancellation, and continuation choice
   * @returns Token-free operation result, including partial and uncertain outcomes
   * @throws RestoreError before writes for stale/unresolved plans or unsafe continuation
   * @throws Propagates cancellation, context read, and storage failures before opening the operation
   */
  async run(
    imported: ImportedBoard,
    context: RestoreContext,
    options: RestoreOptions,
  ): Promise<RestoreJournal> {
    options.signal?.throwIfAborted();
    const reviewed = options.plan;
    if (
      !reviewed ||
      reviewed.unresolved ||
      reviewed.targetBoardId !== context.boardId ||
      reviewed.sourceBoardId !== imported.snapshot.board.id
    )
      throw new RestoreError(RestoreErrorCode.InvalidPlan);
    const previous = this.store.read();
    if (hasUncertainWrite(previous)) throw new RestoreError(RestoreErrorCode.UnknownWrite);
    const continuation = options.resume ? requireContinuation(previous, imported, context) : null;
    const fresh = await this.api.snapshot(context, { signal: options.signal });
    const { plan, planned } = await reviewMergePlan({
      imported,
      current: fresh,
      reviewed,
      previous,
      continuation,
    });
    const target = await this.api.selectTarget(context, { signal: options.signal });
    options.signal?.throwIfAborted();
    const journal = continuation
      ? {
          ...continuation,
          target,
          decisions: { ...plan.decisions },
          commentLocale: continuation.commentLocale ?? options.locale,
          status: RestoreStatus.Running,
          error: null,
        }
      : createMergeJournal({
          imported,
          context,
          target,
          plan,
          planned,
          locale: options.locale,
          previous,
        });
    const save = () => {
      journal.updatedAt = new Date().toISOString();
      this.store.save(journal);
    };
    save();
    try {
      const checkpoint = new RestoreCheckpoint(journal, save, options);
      await executeMerge({
        imported,
        journal,
        api: this.api,
        target,
        plan,
        checkpoint,
        options: { ...options, locale: journal.commentLocale ?? options.locale },
      });
      await this.api.verifyTarget({ signal: options.signal });
      options.signal?.throwIfAborted();
      journal.status =
        journal.warnings.length || journal.skipped.length
          ? RestoreStatus.Partial
          : RestoreStatus.Complete;
    } catch (error) {
      journal.status = failureStatus(error, options.signal);
      journal.error =
        error instanceof ApiError || error instanceof RestoreError
          ? error.code
          : RestoreErrorCode.Failed;
      if (journal.status !== RestoreStatus.Unknown) journal.pending = null;
    }
    try {
      save();
    } catch {
      journal.status = RestoreStatus.Unknown;
      journal.error = RestoreErrorCode.JournalUnavailable;
    }
    return journal;
  }
}
function requireContinuation(
  previous: RestoreJournal | null,
  imported: ImportedBoard,
  context: RestoreContext,
): MergeJournal {
  if (
    !canResumeJournal(previous, imported.checksum, context) ||
    previous.sourceBoardId !== imported.snapshot.board.id
  )
    throw new RestoreError(RestoreErrorCode.JournalMismatch);
  return previous;
}
function failureStatus(error: unknown, signal?: AbortSignal): RestoreStatus {
  if (
    (error instanceof ApiError && error.code === ApiErrorCode.WriteResultUnknown) ||
    (error instanceof RestoreError && error.code === RestoreErrorCode.UnknownWrite)
  )
    return RestoreStatus.Unknown;
  return signal?.aborted ? RestoreStatus.Cancelled : RestoreStatus.Failed;
}
