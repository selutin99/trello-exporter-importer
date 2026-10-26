import { localizePage, translations } from '../../i18n';
import type { Locale } from '../../i18n';
import { ExportFormat, IssueCode } from '../../snapshot/codes';
import type { ExportModel, PreparedExport } from './types';
import { ExportState } from './types';
import { AttachmentAccessState } from '../../trello/attachments';

/** Text-only DOM rendering for the export workflow */
export class ExportView {
  /**
   * Binds the export document
   * @param document - Document hosting the export page
   */
  constructor(private readonly document: Document) {}

  /**
   * Returns a required control with its expected DOM type
   * @param id - Element identity
   * @param type - Expected DOM constructor
   * @returns The typed element
   * @throws Error on incompatible markup
   */
  element<T extends HTMLElement>(id: string, type: { new (...args: never[]): T }): T {
    const element = this.document.getElementById(id);
    if (!(element instanceof type)) throw new Error(`Missing export control: ${id}`);
    return element;
  }

  /**
   * Renders session state without interpreting board content as HTML
   * @param locale - Current product language
   * @param model - Export session state
   * @param connected - Whether an embedded Trello frame is available
   * @param busy - Whether an operation is running
   * @param files - SDK-managed attachment access state
   */
  render(
    locale: Locale,
    model: Readonly<ExportModel>,
    connected: boolean,
    busy: boolean,
    files = AttachmentAccessState.Ready,
  ): void {
    localizePage(locale, this.document);
    const text = translations[locale];
    this.element('language', HTMLSelectElement).value = locale;
    this.element('standalone', HTMLElement).hidden = connected;
    this.element('connection', HTMLElement).hidden = !!model.board || !connected;
    this.element('connect', HTMLButtonElement).disabled = !connected || busy;
    this.element('connection-status', HTMLElement).textContent = text[model.state];
    this.element('board-name', HTMLElement).textContent = model.board?.name ?? '—';
    this.element('board-counts', HTMLElement).textContent = model.board
      ? `${text.exportLists}: ${model.board.lists} · ${text.exportCardCount}: ${model.board.cards}`
      : text.exportAuthRequired;
    const refresh = this.element('refresh', HTMLButtonElement);
    refresh.hidden = !model.board;
    refresh.disabled = busy;
    this.element('formats', HTMLFieldSetElement).disabled = busy;
    for (const input of this.document.querySelectorAll<HTMLInputElement>('input[name="format"]'))
      input.checked = input.value === String(model.format);
    const includesFiles = model.format === ExportFormat.Zip;
    this.element('file-access', HTMLElement).hidden = !includesFiles || !connected || !model.board;
    this.element('file-access-status', HTMLElement).textContent = text[files];
    const fileConnect = this.element('file-connect', HTMLButtonElement);
    fileConnect.disabled = busy || files === AttachmentAccessState.Unavailable;
    fileConnect.textContent =
      text[files === AttachmentAccessState.Ready ? 'exportFilesReconnect' : 'exportFilesConnect'];
    this.element('attachment-coverage', HTMLElement).classList.toggle('excluded', !includesFiles);
    this.element('attachment-mark', HTMLElement).textContent = includesFiles ? '✓' : '×';
    this.element('attachment-status', HTMLElement).textContent =
      text[includesFiles ? 'exportIncludedStatus' : 'exportExcludedStatus'];
    const action = this.element('export', HTMLButtonElement);
    action.disabled =
      !model.board ||
      model.board.cards === 0 ||
      busy ||
      (includesFiles && files !== AttachmentAccessState.Ready);
    action.textContent = model.result ? text.exportAnother : text.exportAction;
    const emptyMessage = model.board?.cards === 0 && !busy ? text.exportEmpty : '';
    this.element('status', HTMLElement).textContent = [
      ExportState.Failed,
      ExportState.ScopeFailed,
      ExportState.Cancelled,
    ].includes(model.state)
      ? text[model.state]
      : emptyMessage;
    this.element('operation', HTMLElement).hidden = !busy;
    this.element('progress-label', HTMLElement).textContent = model.progress
      ? `${text[model.progress.stage]} ${model.progress.current} / ${model.progress.total}`
      : text[model.state];
    const progress = this.element('progress', HTMLProgressElement);
    progress.max = Math.max(1, model.progress?.total ?? 1);
    if (model.progress) progress.value = model.progress.current;
    else progress.removeAttribute('value');
    this.element('result', HTMLElement).hidden = !model.result;
    if (model.result) this.#result(locale, model.result, model.state === ExportState.Partial);
  }

  #result(locale: Locale, result: PreparedExport, partial: boolean): void {
    const text = translations[locale];
    this.element('result-title', HTMLElement).textContent =
      text[partial ? 'exportPartial' : 'exportReady'];
    this.element('result-note', HTMLElement).textContent =
      text[partial ? 'exportPartialNote' : 'exportDoneNote'];
    const snapshot = result.snapshot;
    const metrics = this.element('metrics', HTMLElement);
    metrics.replaceChildren();
    for (const [label, count] of [
      [text.exportLists, snapshot.lists.length],
      [text.exportCardCount, snapshot.cards.length],
      [text.exportItemCount, snapshot.checklistItems.length],
      [text.exportFileCount, snapshot.coverage.attachmentFiles?.count ?? 0],
    ] as const) {
      const row = this.document.createElement('div');
      const dt = this.document.createElement('dt');
      dt.textContent = label;
      const dd = this.document.createElement('dd');
      dd.textContent = String(count);
      row.append(dt, dd);
      metrics.append(row);
    }
    this.element('file-size', HTMLElement).textContent =
      `${result.format.toUpperCase()} · ${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(result.blob.size / 1024)} KiB`;
    this.element('save', HTMLButtonElement).textContent =
      `${text.exportDownload} ${result.format.toUpperCase()}`;
    const warnings = this.element('warning-list', HTMLElement);
    warnings.replaceChildren();
    const messages = {
      [IssueCode.FileUnavailable]: text.exportFileUnavailable,
      [IssueCode.SectionUnavailable]: text.exportSectionUnavailable,
      [IssueCode.UnsafeLink]: text.exportUnsafeLink,
      [IssueCode.BoardChanged]: text.exportBoardChanged,
    };
    for (const issue of snapshot.issues) {
      const item = this.document.createElement('li');
      const identity = issue.entityId ? ' / ' + issue.entityId : '';
      item.textContent = `${messages[issue.code]} · ${issue.entityType}${identity}`;
      warnings.append(item);
    }
    this.element('warnings', HTMLElement).hidden = snapshot.issues.length === 0;
  }
}
