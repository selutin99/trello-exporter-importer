import { expect, test } from 'vitest';
import { captureBoard } from '../../src/snapshot/capture';
import { jsonBytes } from '../../src/snapshot/encoding';
import type { Snapshot } from '../../src/snapshot/types';
import { ApiError, ScopeError } from '../../src/api';
import { ApiErrorCode } from '../../src/shared/error-codes';
import { ExportStage, IssueCode } from '../../src/snapshot/codes';
import {
  id,
  readerFixture,
  sourceAttachment,
  sourceBoard,
  sourceCard,
  sourceComment,
  sourceList,
} from '../helpers/snapshot';

test('JSON excludes archived objects and never request their nested content', async () => {
  const { reader, calls } = readerFixture({
    [`/1/boards/${id(1)}/lists`]: [sourceList, { ...sourceList, id: id(90), closed: true }],
    [`/1/boards/${id(1)}/cards`]: [
      sourceCard,
      { ...sourceCard, id: id(91), closed: true },
      { ...sourceCard, id: id(92), idList: id(90) },
    ],
  });
  const capture = await captureBoard(reader, id(1));
  const json = JSON.parse(new TextDecoder().decode(jsonBytes(capture.snapshot))) as Snapshot;
  for (const snapshot of [json]) {
    expect(snapshot.lists.map((list) => list.id)).toEqual([sourceList.id]);
    expect(snapshot.cards.map((card) => card.id)).toEqual([sourceCard.id]);
    expect(snapshot.attachments.map((attachment) => attachment.cardId)).toEqual([sourceCard.id]);
    expect(snapshot.checklists.map((checklist) => checklist.cardId)).toEqual([sourceCard.id]);
    expect(snapshot.comments.map((comment) => comment.cardId)).toEqual([sourceCard.id]);
    expect(snapshot.capture.outcome).toBe('complete');
    expect(snapshot.coverage.customFields).toEqual({ status: 'excluded', count: 0 });
    expect(snapshot.coverage.customFieldValues).toEqual({ status: 'excluded', count: 0 });
  }
  expect(calls.some((url) => url.pathname.includes('/download/'))).toBe(false);
  expect(
    calls.some(
      (url) =>
        url.pathname.startsWith(`/1/cards/${id(91)}`) ||
        url.pathname.startsWith(`/1/cards/${id(92)}`),
    ),
  ).toBe(false);
});

test('capture preserves active content and excludes custom fields without requesting them', async () => {
  const { reader, calls } = readerFixture();
  const stages: string[] = [];
  const { snapshot } = await captureBoard(reader, id(1), {
    onProgress: (progress) => stages.push(progress.stage),
  });
  expect(snapshot.capture.outcome).toBe('complete');
  expect(snapshot.cards[0]).toMatchObject({
    closed: false,
    dueComplete: true,
    description: sourceCard.desc,
  });
  expect(snapshot.customFields).toEqual([]);
  expect(snapshot.customFieldValues).toEqual([]);
  expect(snapshot.coverage.customFields).toEqual({ status: 'excluded', count: 0 });
  expect(snapshot.coverage.customFieldValues).toEqual({ status: 'excluded', count: 0 });
  expect(calls.some((url) => /customFields|customFieldItems/.test(url.pathname))).toBe(false);
  expect(snapshot.checklistItems.map((item) => item.name)).toEqual(['Next', 'Done ✓']);
  expect(snapshot.checklistItems[1]?.memberId).toBe(id(6));
  expect(snapshot.coverage.attachmentFiles).toEqual({ status: 'excluded', count: 0 });
  expect(JSON.stringify(snapshot)).not.toMatch(/synthetic-token|never-export|must-not-export/);
  expect(calls.every((url) => !url.searchParams.has('token'))).toBe(true);
  expect(stages).toContain('exportContent');
});

test('optional section failures and unsafe links become explicit partial coverage', async () => {
  const { reader } = readerFixture({
    [`/1/boards/${id(1)}/customFields`]: new Response('', { status: 403 }),
    [`/1/cards/${id(3)}/checklists`]: new Response('', { status: 403 }),
    [`/1/cards/${id(3)}/attachments`]: [
      { ...sourceAttachment, isUpload: false, url: 'javascript:alert(1)' },
    ],
  });
  const { snapshot } = await captureBoard(reader, id(1));
  expect(snapshot.capture.outcome).toBe('partial');
  for (const section of ['checklists', 'checklistItems', 'attachments'])
    expect(snapshot.coverage[section]?.status).toBe('partial');
  expect(snapshot.issues.some((issue) => issue.code === IssueCode.UnsafeLink)).toBe(true);
});

test('authorization and scope failures are never disguised as a partial success', async () => {
  const auth = readerFixture({ [`/1/cards/${id(3)}/actions`]: new Response('', { status: 401 }) });
  await expect(captureBoard(auth.reader, id(1))).rejects.toMatchObject({
    code: ApiErrorCode.AuthRequired,
  });
  const scope = readerFixture({
    [`/1/cards/${id(3)}/checklists`]: [
      { id: id(7), idCard: id(99), name: 'Foreign', pos: 1, checkItems: [] },
    ],
  });
  await expect(captureBoard(scope.reader, id(1))).rejects.toThrow(ScopeError);
});

test('cancellation aborts capture without publishing a partial snapshot', async () => {
  const active = new AbortController();
  const { reader } = readerFixture();
  await expect(
    captureBoard(reader, id(1), {
      signal: active.signal,
      onProgress: (progress) => {
        if (progress.stage === ExportStage.Content) active.abort();
      },
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
});

test('changes and failed final verification are recorded in board coverage', async () => {
  for (const after of [
    { ...sourceBoard, dateLastActivity: '2026-10-19T10:00:00Z' },
    null,
    { ...sourceBoard, dateLastActivity: null },
  ]) {
    const { reader } = readerFixture();
    const original = reader.board.bind(reader);
    let count = 0;
    reader.board = async (...args) => {
      if (++count === 1) return original(...args);
      if (!after) throw new ApiError(ApiErrorCode.NetworkError);
      return after;
    };
    const { snapshot } = await captureBoard(reader, id(1));
    expect(snapshot.capture.changedDuringCapture).toBe(after?.dateLastActivity ? true : null);
    if (!after || after.dateLastActivity) expect(snapshot.coverage.board?.status).toBe('partial');
  }
});

test('dangling member and label references cannot produce a valid snapshot', async () => {
  const cases = [{ [`/1/boards/${id(1)}/members`]: [] }, { [`/1/boards/${id(1)}/labels`]: [] }];
  for (const data of cases)
    await expect(captureBoard(readerFixture(data).reader, id(1))).rejects.toThrow(ScopeError);
});

test('an absent comment author is preserved safely', async () => {
  const { reader } = readerFixture({
    [`/1/cards/${id(3)}/actions`]: [{ ...sourceComment, memberCreator: undefined }],
  });
  const { snapshot } = await captureBoard(reader, id(1));
  expect(snapshot.comments[0]?.authorId).toBeNull();
});
