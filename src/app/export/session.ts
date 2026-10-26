import { ScopeError } from '../../api/errors';
import type { BoardReader } from '../../api/reader';
import { prepareExport } from '../../export/prepare';
import { Locale } from '../../i18n';
import { captureBoard } from '../../snapshot/capture';
import { CaptureOutcome, ExportFormat } from '../../snapshot/codes';
import { ExportState } from './types';
import type { ExportModel } from './types';

/** One cancellable export at a time; content remains in this window only */
export class ExportSession {
  #model: ExportModel = {
    state: ExportState.Disconnected,
    board: null,
    format: ExportFormat.Json,
    progress: null,
    result: null,
  };
  #active: AbortController | null = null;

  /**
   * Creates an export session with an explicit UI notification boundary
   * @param changed - Called when visible session state changes
   */
  constructor(private readonly changed: () => void) {}

  /**
   * Exposes a coherent state whose completed outcomes always include a prepared export
   * @returns Current read-only session state
   */
  get model(): Readonly<ExportModel> {
    return this.#model;
  }

  /**
   * Reports whether a load or export is in progress
   * @returns Whether a cancellable operation owns the session
   */
  get busy(): boolean {
    return this.#active !== null;
  }

  /**
   * Selects an output format when no operation is in progress
   * @param format - Requested portable format
   */
  selectFormat(format: ExportFormat): void {
    if (this.busy) return;
    const model = this.#model;
    if (model.board)
      this.#model = {
        ...model,
        format,
        result: null,
        board: model.board,
        state: ExportState.Ready,
      };
    else this.#model = { ...model, format };
    this.changed();
  }

  /**
   * Loads a small board overview through the scoped API
   * @param reader - Board-scoped reader
   * @param contextBoardId - Live SDK board identity
   * @returns Completion of the overview request
   */
  async load(reader: BoardReader, contextBoardId: string): Promise<void> {
    await this.#run(ExportState.Loading, async (signal) => {
      const board = await reader.board(contextBoardId, { signal });
      const lists = await reader.lists({ signal });
      const cards = await reader.cards({ signal });
      signal.throwIfAborted();
      this.#model = {
        ...this.#model,
        result: null,
        board: { name: board.name, lists: lists.length, cards: cards.length },
        state: ExportState.Ready,
      };
    });
  }

  /**
   * Builds a fresh snapshot and prepares a separate, user-initiated download
   * @param reader - Live board-scoped reader, or null before connection
   * @param contextBoardId - Live SDK board identity
   * @param locale - Product language for readable export labels
   * @returns Completion after the file is ready, the board is empty, or an error is displayed
   */
  async prepare(
    reader: BoardReader | null,
    contextBoardId: string,
    locale: Locale = Locale.English,
  ): Promise<void> {
    const board = this.#model.board;
    if (!board || !reader || board.cards === 0) return;
    await this.#run(ExportState.Running, async (signal) => {
      const options = {
        signal,
        onProgress: (progress: NonNullable<ExportModel['progress']>) => {
          if (signal.aborted) return;
          this.#model = { ...this.#model, progress };
          this.changed();
        },
      };
      const capture = await captureBoard(reader, contextBoardId, options);
      signal.throwIfAborted();
      const snapshot = capture.snapshot;
      const overview = {
        name: snapshot.board.name,
        lists: snapshot.lists.length,
        cards: snapshot.cards.length,
      };
      if (overview.cards === 0) {
        this.#model = {
          ...this.#model,
          board: overview,
          progress: null,
          result: null,
          state: ExportState.Ready,
        };
        return;
      }
      const format = this.model.format;
      const blob = await prepareExport(capture, format, locale, options);
      signal.throwIfAborted();
      const date = new Date().toISOString().replaceAll(':', '-').slice(0, 19);
      this.#model = {
        ...this.#model,
        board: overview,
        result: { blob, snapshot, format, filename: `trello-exporter-importer-${date}.${format}` },
        state:
          snapshot.capture.outcome === CaptureOutcome.Complete
            ? ExportState.Complete
            : ExportState.Partial,
      };
    });
  }

  /** Cancels the active operation and immediately clears prepared content */
  cancel(): void {
    this.#active?.abort();
    this.#active = null;
    this.#model = { ...this.#model, result: null, progress: null, state: ExportState.Cancelled };
    this.changed();
  }

  async #run(
    state: ExportState.Loading | ExportState.Running,
    task: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    if (this.busy) return;
    const active = new AbortController();
    this.#active = active;
    this.#model = { ...this.#model, result: null, progress: null, state };
    this.changed();
    try {
      await task(active.signal);
    } catch (error) {
      if (!active.signal.aborted)
        this.#model = {
          ...this.#model,
          result: null,
          state: error instanceof ScopeError ? ExportState.ScopeFailed : ExportState.Failed,
        };
    } finally {
      if (this.#active === active) {
        this.#active = null;
        this.changed();
      }
    }
  }
}
