import { ApiError, ScopeError } from '../api/errors';
import { ApiErrorCode } from '../shared/error-codes';
import type { BoardReader } from '../api/reader';
import { serviceUrls } from '../config/services';
import { product } from '../config/product';
import { CaptureOutcome, CoverageStatus, ExportStage, IssueCode, SnapshotSection } from './codes';
import { finishCapture } from './coverage';
export { finishCapture } from './coverage';
import {
  appendChecklists,
  appendComments,
  issue,
  normalizeAttachment,
  normalizeCards,
  ordered,
} from './normalize';
import type { CaptureOptions, Snapshot } from './types';

export interface CapturedBoard {
  snapshot: Snapshot;
}

/**
 * Captures current board content using read-only requests scoped to the SDK board
 * @param reader - Board-scoped API reader
 * @param contextBoardId - Live board identity from Trello
 * @param options - Cancellation and progress observer
 * @returns A portable JSON snapshot containing attachment metadata and source links
 * @throws ApiError for unreadable core content; ScopeError for foreign identities; the signal reason on cancellation
 */
export async function captureBoard(
  reader: BoardReader,
  contextBoardId: string,
  options: CaptureOptions = {},
): Promise<CapturedBoard> {
  const { signal, onProgress } = options;
  const request = { signal };
  const startedAt = new Date().toISOString();
  onProgress?.({ stage: ExportStage.Board, current: 0, total: 1 });
  const board = await reader.board(contextBoardId, request);
  const lists = await reader.lists(request);
  onProgress?.({ stage: ExportStage.Cards, current: 0, total: 1 });
  const cards = await reader.cards(request);
  const labels = await reader.labels(request);
  const members = await reader.members(request);
  const snapshot: Snapshot = {
    format: 'trello-exporter.snapshot',
    formatVersion: '0.1.0',
    snapshotId: crypto.randomUUID(),
    exporter: { ...product },
    capture: {
      startedAt,
      completedAt: startedAt,
      consistency: 'best-effort',
      changedDuringCapture: null,
      outcome: CaptureOutcome.Complete,
    },
    coverage: {
      [SnapshotSection.CustomFields]: { status: CoverageStatus.Excluded, count: 0 },
      [SnapshotSection.CustomFieldValues]: { status: CoverageStatus.Excluded, count: 0 },
    },
    board: {
      id: board.id,
      name: board.name,
      description: board.desc,
      url: `${serviceUrls.trelloBoardOrigin}/b/${board.shortLink}`,
      closed: board.closed,
    },
    lists: ordered(lists).map((list) => ({
      id: list.id,
      name: list.name,
      closed: list.closed,
      order: list.order,
    })),
    cards: normalizeCards(cards),
    labels,
    members: members.map((member) => ({
      id: member.id,
      username: member.username,
      displayName: member.fullName,
    })),
    customFields: [],
    customFieldValues: [],
    checklists: [],
    checklistItems: [],
    comments: [],
    attachments: [],
    issues: [],
  };
  const optional = optionalSection(snapshot, signal);
  for (const [index, card] of cards.entries()) {
    signal?.throwIfAborted();
    onProgress?.({ stage: ExportStage.Content, current: index, total: cards.length });
    await optional(SnapshotSection.Checklists, card.id, async () =>
      appendChecklists(snapshot, await reader.checklists(card.id, request)),
    );
    await optional(SnapshotSection.Comments, card.id, async () =>
      appendComments(snapshot, await reader.comments(card.id, request), card.id),
    );
    await optional(SnapshotSection.Attachments, card.id, async () => {
      for (const attachment of await reader.attachments(card.id, request)) {
        const normalized = normalizeAttachment(attachment, card.id);
        snapshot.attachments.push(normalized);
        if (!normalized.url)
          snapshot.issues.push(
            issue(IssueCode.UnsafeLink, SnapshotSection.Attachments, attachment.id),
          );
      }
    });
  }
  await optional(SnapshotSection.Board, null, async () => {
    const after = await reader.board(contextBoardId, request);
    snapshot.capture.changedDuringCapture =
      board.dateLastActivity && after.dateLastActivity
        ? board.dateLastActivity !== after.dateLastActivity
        : null;
    if (snapshot.capture.changedDuringCapture)
      snapshot.issues.push(issue(IssueCode.BoardChanged, SnapshotSection.Board, board.id));
  });
  finishCapture(snapshot);
  assertReferences(snapshot);
  return { snapshot };
}

function optionalSection(snapshot: Snapshot, signal?: AbortSignal) {
  return async (
    section: SnapshotSection,
    entityId: string | null,
    read: () => Promise<void>,
  ): Promise<void> => {
    try {
      await read();
    } catch (error) {
      signal?.throwIfAborted();
      if (!(error instanceof ApiError) || error.code === ApiErrorCode.AuthRequired) throw error;
      snapshot.issues.push(issue(IssueCode.SectionUnavailable, section, entityId));
    }
  };
}

function assertReferences(snapshot: Snapshot): void {
  const labels = new Set(snapshot.labels.map((label) => label.id));
  const members = new Set(snapshot.members.map((member) => member.id));
  if (
    snapshot.cards.some(
      (card) =>
        card.labelIds.some((id) => !labels.has(id)) ||
        card.memberIds.some((id) => !members.has(id)),
    )
  )
    throw new ScopeError();
}
