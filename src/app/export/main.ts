import { isId } from '../../api/validation';
import { BoardReader } from '../../api/reader';
import { chooseLocale, translations } from '../../i18n';
import { runtimeSettings } from '../../trello/runtime';
import { pageReady } from '../../trello/sdk';
import type { PowerUpFrame } from '../../trello/sdk';
import { OAuthScope } from '../../trello/scopes';
import {
  AttachmentAccess,
  AttachmentAccessState,
  completeAttachmentCallback,
} from '../../trello/attachments';
import { ExportFormat } from '../../snapshot/codes';
import { downloadBlob, downloadJson } from '../download';
import { ExportSession } from './session';
import { ExportView } from './view';
import { RestoreUI } from '../restore/controller';

const view = new ExportView(document);
let locale = chooseLocale(navigator.language);
let preferredLocale: string | null = null;
try {
  preferredLocale = localStorage.getItem('exporter-locale');
} catch {
  /* Optional preference */
}
if (preferredLocale) locale = chooseLocale(preferredLocale);
let frame: PowerUpFrame | null = null;
let reader: BoardReader | null = null;
let restore: RestoreUI | null = null;
const session = new ExportSession(render);
let files = new AttachmentAccess(null, render);
window.addEventListener('pagehide', () => session.cancel(), { once: true });
function render(): void {
  view.render(
    locale,
    session.model,
    !!frame,
    session.busy || !!restore?.busy || files.busy,
    files.state,
  );
  restore?.render();
}

const language = view.element('language', HTMLSelectElement);
language.addEventListener('change', () => {
  locale = chooseLocale(language.value);
  preferredLocale = locale;
  try {
    localStorage.setItem('exporter-locale', locale);
  } catch {
    /* Optional preference */
  }
  render();
});
for (const input of document.querySelectorAll<HTMLInputElement>('input[name="format"]')) {
  input.addEventListener('change', () => {
    const format = Object.values(ExportFormat).find((format) => String(format) === input.value);
    if (format) session.selectFormat(format);
  });
}
view.element('export', HTMLButtonElement).addEventListener('click', () => {
  if (session.model.format === ExportFormat.Zip && files.state !== AttachmentAccessState.Ready)
    return;
  void session.prepare(reader, frame?.getContext().board ?? '', locale);
});
view.element('file-connect', HTMLButtonElement).addEventListener('click', () => {
  if (files.state === AttachmentAccessState.Ready) void files.reset();
  else void files.authorize();
});
view.element('cancel', HTMLButtonElement).addEventListener('click', () => session.cancel());
view.element('save', HTMLButtonElement).addEventListener('click', () => {
  const result = session.model.result;
  if (result) downloadBlob(result.blob, result.filename);
});
view.element('report', HTMLButtonElement).addEventListener('click', () => {
  const snapshot = session.model.result?.snapshot;
  if (snapshot)
    downloadJson(
      {
        snapshotId: snapshot.snapshotId,
        capture: snapshot.capture,
        coverage: snapshot.coverage,
        issues: snapshot.issues,
      },
      'trello-exporter-importer-report.json',
    );
});
view.element('refresh', HTMLButtonElement).addEventListener('click', () => {
  void loadBoard();
});
view.element('connect', HTMLButtonElement).addEventListener('click', () => {
  void connect();
});

async function loadBoard(): Promise<void> {
  const context = frame?.getContext().board;
  if (reader && context) await session.load(reader, context);
}
async function connect(): Promise<void> {
  if (!frame) return;
  const button = view.element('connect', HTMLButtonElement);
  button.disabled = true;
  try {
    await frame.getOAuth2ApiClient().authorize({ scopes: [OAuthScope.ReadBoard] });
    await loadBoard();
  } catch {
    view.element('connection-status', HTMLElement).textContent = translations[locale].exportFailed;
  } finally {
    button.disabled = false;
  }
}

restore = new RestoreUI({
  document,
  getFrame: () => frame,
  getLocale: () => locale,
  exportBusy: () => session.busy || files.busy,
  changed: render,
});
render();
await pageReady(window);
completeAttachmentCallback(window);
if (window.TrelloPowerUp && window.parent !== window) {
  try {
    const settings = runtimeSettings(window.location.href);
    if (!settings.clientId) throw new Error('Missing public configuration');
    const activeFrame = window.TrelloPowerUp.iframe(settings.oauthOptions);
    const boardId = activeFrame.getContext().board;
    if (!isId(boardId)) throw new Error('Missing current board context');
    frame = activeFrame;
    const fileClient = settings.appKey ? (activeFrame.getRestApi?.() ?? null) : null;
    files = new AttachmentAccess(fileClient, render);
    reader = new BoardReader({
      boardReference: boardId,
      getAccessToken: () => activeFrame.getOAuth2ApiClient().getAccessToken(),
      ...(fileClient
        ? { attachmentAuth: { appKey: settings.appKey, getToken: () => fileClient.getToken() } }
        : {}),
    });
    let initialized = false;
    activeFrame.render(() => {
      if (!preferredLocale) locale = chooseLocale(activeFrame.getContext().locale);
      render();
      if (!initialized) {
        initialized = true;
        void files.refresh();
        void loadBoard();
      }
    });
  } catch {
    frame = null;
    reader = null;
    render();
  }
}
