import type { CapturedBoard } from '../../src/snapshot/capture';
import { finishCapture } from '../../src/snapshot/coverage';
import {
  AttachmentKind,
  CaptureOutcome,
  CoverageStatus,
  CustomFieldType,
} from '../../src/snapshot/codes';
import { syntheticCards, syntheticFiles, syntheticLabels, syntheticLists } from './board-data';
import { product } from '../../src/config/product';

const id = (number: number) => number.toString(16).padStart(24, '0');

/**
 * Builds a synthetic capture fixture without network or account access
 * @returns A fresh capture fixture containing only attachment metadata and source links
 */
export function createSyntheticCapture(): CapturedBoard {
  const now = new Date().toISOString();
  const files = syntheticFiles();
  const snapshot: CapturedBoard['snapshot'] = {
    format: 'trello-exporter.snapshot',
    formatVersion: '0.1.0',
    snapshotId: crypto.randomUUID(),
    exporter: { ...product },
    capture: {
      startedAt: now,
      completedAt: now,
      consistency: 'best-effort',
      changedDuringCapture: false,
      outcome: CaptureOutcome.Complete,
    },
    coverage: {
      customFields: { status: CoverageStatus.Excluded, count: 0 },
      customFieldValues: { status: CoverageStatus.Excluded, count: 0 },
    },
    board: {
      id: id(1),
      name: 'Studio launch',
      description: 'Synthetic preview board',
      url: null,
      closed: false,
    },
    lists: syntheticLists.map((name, order) => ({
      id: id(10 + order),
      name,
      order,
      closed: false,
    })),
    cards: [],
    labels: syntheticLabels.map((label, index) => ({ id: id(20 + index), ...label })),
    members: [
      { id: id(30), username: 'demo-designer', displayName: 'Demo designer' },
      { id: id(31), username: 'demo-engineer', displayName: 'Demo engineer' },
    ],
    customFields: [],
    customFieldValues: [],
    checklists: [],
    checklistItems: [],
    comments: [],
    attachments: [],
    issues: [],
  };
  const positions = new Map<number, number>();
  for (const [index, card] of syntheticCards.entries()) {
    const cardId = id(100 + index);
    const order = positions.get(card.list) ?? 0;
    positions.set(card.list, order + 1);
    snapshot.cards.push({
      id: cardId,
      listId: id(10 + card.list),
      name: card.name,
      description: card.description,
      order,
      closed: card.closed,
      start: null,
      due: card.due,
      dueComplete: index === 4,
      labelIds: [id(20 + card.label)],
      memberIds: [id(30 + (index % 2))],
      cover: null,
    });
    const checklistId = id(200 + index);
    snapshot.checklists.push({ id: checklistId, cardId, name: 'Tasks', order: 0 });
    snapshot.checklistItems.push(
      ...card.items.map((name, itemIndex) => ({
        id: id(1000 + index * 10 + itemIndex),
        checklistId,
        name,
        order: itemIndex,
        checked: itemIndex < card.completed,
      })),
    );
    if (card.comment)
      snapshot.comments.push({
        id: id(300 + index),
        cardId,
        authorId: null,
        authorDisplayName: 'Demo reviewer',
        createdAt: now,
        text: card.comment,
        order: 0,
      });
    const file = files[card.file];
    if (file) {
      const attachmentId = id(400 + card.file);
      snapshot.attachments.push({
        id: attachmentId,
        cardId,
        name: file.name,
        kind: AttachmentKind.Upload,
        url: `https://trello.com/1/cards/${cardId}/attachments/${attachmentId}/download/${encodeURIComponent(file.name)}`,
        mimeType: file.mimeType,
        size: file.bytes.length,
        file: null,
      });
    }
  }
  finishCapture(snapshot);
  return { snapshot };
}

/**
 * Adds legacy custom-field content for backward-compatibility and omission checks
 * @returns A synthetic legacy capture with two field definitions and per-card values
 */
export function createLegacyFieldCapture(): CapturedBoard {
  const capture = createSyntheticCapture();
  capture.snapshot.customFields = [
    {
      id: id(40),
      name: 'Priority',
      type: CustomFieldType.List,
      order: 0,
      options: [
        { id: id(41), text: 'Normal', color: 'blue', order: 0 },
        { id: id(42), text: 'High', color: 'red', order: 1 },
      ],
    },
    { id: id(45), name: 'Working note', type: CustomFieldType.Text, order: 1, options: [] },
  ];
  capture.snapshot.customFieldValues = capture.snapshot.cards.flatMap((card, index) => [
    { cardId: card.id, fieldId: id(40), optionId: id(index % 2 ? 42 : 41) },
    { cardId: card.id, fieldId: id(45), value: { text: `Synthetic note ${index + 1}` } },
  ]);
  finishCapture(capture.snapshot);
  return capture;
}
