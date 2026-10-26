import { readImport } from '../../import/read';
import { waitForOperation } from '../../core/operation';
import type { ImportedBoard } from '../../import/read';
import type { Locale } from '../../i18n';
import { RestoreEngine } from '../../restore/engine';
import { canResumeJournal, hasUncertainWrite } from '../../restore/journal';
import { buildMergePlan } from '../../restore/merge/planner';
import { MergeChoice, MergeConflictKind } from '../../restore/merge/types';
import { RestoreError, RestoreErrorCode } from '../../restore/codes';
import type { JournalStore } from '../../restore/types';
import { RestoreMessage } from './types';
import type { RestoreConnection, RestoreSessionModel } from './types';

interface Dependencies {
  context: (signal: AbortSignal) => Promise<RestoreConnection>;
  authorize: (signal: AbortSignal) => Promise<void>;
  store: () => JournalStore;
  changed: () => void;
}

/** Owns validation, live comparison, conflict choices, and one current-board merge without DOM dependencies */
export class RestoreSession {
  #model: RestoreSessionModel = {
    imported: null,
    current: null,
    plan: null,
    context: null,
    report: null,
    previous: null,
    message: RestoreMessage.Choose,
  };
  #active: AbortController | null = null;
  /**
   * Binds authorization, current-board capture, storage, and view notifications
   * @param dependencies - Explicit external effects
   */
  constructor(private readonly dependencies: Dependencies) {}
  /**
   * Exposes current view state without transferring operation ownership
   * @returns Local state and derived activity
   */
  get model(): Readonly<RestoreSessionModel & { busy: boolean }> {
    return { ...this.#model, busy: this.busy };
  }
  /**
   * Reports exclusive ownership during analysis and writes
   * @returns Whether an operation is active
   */
  get busy(): boolean {
    return this.#active !== null;
  }
  /** Cancels waiting or writes while retaining already applied changes */
  cancel(): void {
    this.#active?.abort();
  }
  /**
   * Validates a local file and attempts a read-only comparison with the current board
   * @param file - Selected project JSON
   * @returns Accepted local content, or null after invalid input or cancellation
   */
  async load(file: Blob): Promise<ImportedBoard | null> {
    let accepted: ImportedBoard | null = null;
    await this.#task(RestoreMessage.Loading, RestoreMessage.Invalid, async (signal) => {
      this.#model = {
        ...this.#model,
        imported: null,
        current: null,
        plan: null,
        context: null,
        report: null,
        previous: null,
      };
      const input = await waitForOperation(readImport(file, signal), signal);
      signal.throwIfAborted();
      this.#model = { ...this.#model, imported: input };
      try {
        this.#model.previous = this.dependencies.store().read();
      } catch {
        this.#model.message = RestoreMessage.JournalUnavailable;
        accepted = input;
        return;
      }
      try {
        await this.#analyze(signal);
      } catch (error) {
        signal.throwIfAborted();
        this.#model.message = failureMessage(error, signal, RestoreMessage.Unavailable);
      }
      accepted = input;
    });
    return accepted;
  }
  /**
   * Requests consent then compares against the current SDK board
   * @returns Completion after analysis or a safe failure
   */
  async connect(): Promise<void> {
    await this.#task(RestoreMessage.Loading, RestoreMessage.Unavailable, async (signal) => {
      await waitForOperation(this.dependencies.authorize(signal), signal);
      await this.#analyze(signal);
    });
  }
  /**
   * Rebuilds a read-only comparison, dropping outdated choices
   * @returns Completion of a fresh board analysis
   */
  async analyze(): Promise<void> {
    if (!this.#model.imported) return;
    await this.#task(RestoreMessage.Loading, RestoreMessage.Unavailable, (signal) =>
      this.#analyze(signal),
    );
  }
  /**
   * Resolves one conflict and recalculates dependent matches and operations
   * @param key - Current conflict identity
   * @param choice - Candidate identity or named resolution
   */
  resolve(key: string, choice: string): void {
    const model = this.#model;
    const { imported, current, plan } = model;
    if (
      this.busy ||
      !imported ||
      !current ||
      !plan ||
      !plan.conflicts.some((conflict) => conflict.key === key)
    )
      return;
    this.#model = {
      ...model,
      plan: buildMergePlan(imported, current, { ...plan.decisions, [key]: choice }, model.previous),
    };
    this.dependencies.changed();
  }
  /**
   * Applies an explicit bulk preference to value conflicts, leaving identity matches for individual review
   * @param choice - Keep current or use snapshot
   */
  resolveValues(choice: MergeChoice.Current | MergeChoice.Snapshot): void {
    const model = this.#model;
    const { imported, current, plan } = model;
    if (this.busy || !imported || !current || !plan) return;
    const decisions = { ...plan.decisions };
    for (const conflict of plan.conflicts)
      if (conflict.kind === MergeConflictKind.Value) decisions[conflict.key] = choice;
    this.#model = { ...model, plan: buildMergePlan(imported, current, decisions, model.previous) };
    this.dependencies.changed();
  }
  /**
   * Applies only an explicitly reviewed resolved plan to a freshly verified current board
   * @param locale - Attribution language
   * @param resume - Continue the same browser's known unfinished operation
   * @returns Whether an operation report was produced, including failed and uncertain outcomes
   */
  async run(locale: Locale, resume = false): Promise<boolean> {
    const { imported, plan, current } = this.#model;
    if (!imported || !plan || plan.unresolved || !current) return false;
    let reported = false;
    await this.#task(RestoreMessage.Running, RestoreMessage.Failed, async (signal) => {
      await waitForOperation(this.dependencies.authorize(signal), signal);
      const { api, context } = await waitForOperation(this.dependencies.context(signal), signal);
      signal.throwIfAborted();
      if (context.boardId !== plan.targetBoardId)
        throw new RestoreError(RestoreErrorCode.PlanStale);
      const engine = new RestoreEngine(api, this.dependencies.store());
      const report = await engine.run(imported, context, { plan, locale, resume, signal });
      this.#model = {
        imported,
        current,
        context,
        report,
        previous: report,
        plan: null,
        message:
          report.error === RestoreErrorCode.PlanStale ? RestoreMessage.Stale : RestoreMessage.Ready,
      };
      reported = true;
    });
    return reported;
  }
  async #analyze(signal: AbortSignal): Promise<void> {
    const imported = this.#model.imported;
    if (!imported) return;
    this.#clearComparison();
    const { context, api } = await waitForOperation(this.dependencies.context(signal), signal);
    const current = await waitForOperation(api.snapshot(context, { signal }), signal);
    signal.throwIfAborted();
    const previous = this.dependencies.store().read();
    const decisions = canResumeJournal(previous, imported.checksum, context)
      ? (previous.decisions ?? {})
      : {};
    const plan = buildMergePlan(imported, current, decisions, previous);
    this.#model = {
      imported,
      context,
      current,
      plan,
      previous,
      report: null,
      message: hasUncertainWrite(previous) ? RestoreMessage.Unknown : RestoreMessage.Ready,
    };
  }
  #clearComparison(): void {
    this.#model = { ...this.#model, current: null, context: null, plan: null, report: null };
  }
  async #task(
    message: RestoreMessage,
    failure: RestoreMessage,
    task: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    if (this.#active) return;
    const active = new AbortController();
    this.#active = active;
    this.#model.message = message;
    this.dependencies.changed();
    try {
      await task(active.signal);
    } catch (error) {
      this.#model.message = failureMessage(error, active.signal, failure);
      if (error instanceof RestoreError && error.code === RestoreErrorCode.PlanStale)
        this.#clearComparison();
    } finally {
      this.#active = null;
      this.dependencies.changed();
    }
  }
}
function failureMessage(
  error: unknown,
  signal: AbortSignal,
  fallback: RestoreMessage,
): RestoreMessage {
  if (signal.aborted) return RestoreMessage.Cancelled;
  if (!(error instanceof RestoreError)) return fallback;
  const messages = new Map([
    [RestoreErrorCode.PlanStale, RestoreMessage.Stale],
    [RestoreErrorCode.IncompleteTarget, RestoreMessage.Incomplete],
    [RestoreErrorCode.UnknownWrite, RestoreMessage.Unknown],
    [RestoreErrorCode.JournalUnavailable, RestoreMessage.JournalUnavailable],
  ]);
  return messages.get(error.code) ?? fallback;
}
