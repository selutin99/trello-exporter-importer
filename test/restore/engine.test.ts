import { assert, expect, test, vi } from 'vitest';
import { ApiErrorCode } from '../../src/shared/error-codes';
import { attributedComment } from '../../src/restore/comments';
import { RestoreEngine } from '../../src/restore/engine';
import {
  RestoreResource,
  RestoreStatus,
  RestoreWarning,
  RestoreErrorCode,
} from '../../src/restore/codes';
import { createSyntheticCapture, createLegacyFieldCapture } from '../helpers/board-capture';
import { jsonBytes } from '../../src/snapshot/encoding';
import { readImport } from '../../src/import/read';
import type { ImportedBoard } from '../../src/import/read';
import { Locale } from '../../src/i18n';
import { MemoryJournal, restorationFixture, restoreJournal, targetId } from '../helpers/restore';
import { sourceBoard, id } from '../helpers/snapshot';
import type { RestoreOptions } from '../../src/restore/types';
import { buildMergePlan } from '../../src/restore/merge/planner';
import { MergeChoice } from '../../src/restore/merge/types';

type Fixture = ReturnType<typeof restorationFixture>;
async function imported() {
  return readImport(new Blob([jsonBytes(createSyntheticCapture().snapshot)]));
}
async function run(
  fixture: Fixture,
  input: ImportedBoard,
  options: Partial<RestoreOptions> = {},
  store = fixture.store,
) {
  const context = await fixture.api.context(sourceBoard.id);
  const plan = await fixture.plan(input);
  return new RestoreEngine(fixture.api, store).run(input, context, {
    locale: Locale.English,
    plan,
    ...options,
  });
}
const writes = (fixture: Fixture) => fixture.calls.filter((call) => call.method !== 'GET');

test('JSON adds missing content and source attachment links without creating a board', async () => {
  const fixture = restorationFixture();
  const input = await imported();
  const report = await run(fixture, input);
  expect(report.target?.id).toBe(sourceBoard.id);
  expect(report.status).toBe(RestoreStatus.Partial);
  expect(Object.keys(report.completed).filter((key) => key.startsWith('cards/'))).toHaveLength(6);
  expect(Object.keys(report.completed).filter((key) => key.startsWith('checkItems/'))).toHaveLength(
    19,
  );
  expect(report.pending).toBeNull();
  expect(writes(fixture).some((call) => call.path === '/boards' || call.method === 'DELETE')).toBe(
    false,
  );
  expect(writes(fixture).filter((call) => call.path.endsWith('/attachments'))).toHaveLength(3);
  expect(writes(fixture).every((call) => !(call.body instanceof FormData))).toBe(true);
  expect(JSON.stringify(report)).not.toContain('synthetic-token');
});

test('loading the exact same snapshot again reuses IDs and performs no duplicate writes', async () => {
  const input = await imported();
  const fixture = restorationFixture(undefined, input.snapshot);
  expect((await fixture.plan(input)).actions).toHaveLength(0);
  expect((await run(fixture, input)).status).toBe(RestoreStatus.Complete);
  expect(writes(fixture)).toHaveLength(0);
  expect(fixture.children('/cards')).toHaveLength(input.snapshot.cards.length);
});

test('a second import into another board reuses journal mappings and comment chunks', async () => {
  const input = await imported();
  input.snapshot.board.id = id(999);
  const fixture = restorationFixture();
  await run(fixture, input);
  const before = writes(fixture).length;
  const plan = await fixture.plan(input);
  expect(plan.unresolved).toBe(0);
  expect(plan.actions).toHaveLength(0);
  await run(fixture, input);
  await run(fixture, input);
  expect(writes(fixture)).toHaveLength(before);
});

test('selected fields change while current-only cards and board identity remain intact', async () => {
  const input = await imported();
  const fixture = restorationFixture(undefined, input.snapshot);
  const card = input.snapshot.cards[0]!;
  fixture.records.get(`/cards/${card.id}`)!.name = 'Newer current name';
  fixture.records.set(`/cards/${id(980)}`, {
    ...fixture.records.get(`/cards/${card.id}`),
    id: id(980),
    name: 'Current-only',
  });
  const plan = await fixture.plan(input);
  expect(plan.actions).toHaveLength(1);
  const report = await run(fixture, input, { plan });
  expect(report.status).toBe(RestoreStatus.Partial);
  expect(fixture.records.get(`/cards/${card.id}`)?.name).toBe(card.name);
  expect(fixture.records.get(`/cards/${id(980)}`)?.name).toBe('Current-only');
  expect(writes(fixture).map((call) => call.path)).toEqual([`/cards/${card.id}`]);
});

test('a complete supported snapshot can finish with no fidelity warnings', async () => {
  const input = await imported();
  input.snapshot.cards.forEach((card) => {
    card.memberIds = [];
    card.cover = null;
  });
  input.snapshot.comments = [];
  input.snapshot.attachments = [];
  expect((await run(restorationFixture(), input)).status).toBe(RestoreStatus.Complete);
});

test('unresolved and stale plans stop before the first write', async () => {
  const fixture = restorationFixture();
  const input = await imported();
  const context = await fixture.api.context(sourceBoard.id);
  const current = await fixture.api.snapshot(context);
  current.board.description = 'Divergent';
  const unresolved = buildMergePlan(input, current);
  const engine = new RestoreEngine(fixture.api, fixture.store);
  await expect(
    engine.run(input, context, { locale: Locale.English, plan: unresolved }),
  ).rejects.toMatchObject({ code: RestoreErrorCode.InvalidPlan });
  const plan = await fixture.plan(input);
  fixture.records.get(`/boards/${targetId}`)!.desc = 'Changed after review';
  await expect(engine.run(input, context, { locale: Locale.English, plan })).rejects.toMatchObject({
    code: RestoreErrorCode.PlanStale,
  });
  expect(writes(fixture)).toHaveLength(0);
});

test('known failures resume the same operation without duplicating previously created objects', async () => {
  let blocked = true;
  const fixture = restorationFixture((call) =>
    call.method === 'POST' && call.path === '/cards' && blocked
      ? new Response('', { status: 403 })
      : undefined,
  );
  const input = await imported();
  const failed = await run(fixture, input);
  expect(failed.status).toBe(RestoreStatus.Failed);
  blocked = false;
  const resumed = await run(fixture, input, { resume: true });
  expect(resumed.status).toBe(RestoreStatus.Partial);
  expect(fixture.children('/lists')).toHaveLength(3);
  expect(fixture.children('/cards')).toHaveLength(6);
  expect(writes(fixture).filter((call) => call.path.endsWith('/lists'))).toHaveLength(3);
});

test.each([408, 503])(
  'uncertain write %s is never retried and blocks both new and resumed operations',
  async (status) => {
    const fixture = restorationFixture((call) =>
      call.method === 'POST' && call.path === '/cards' ? new Response('', { status }) : undefined,
    );
    const input = await imported();
    const report = await run(fixture, input);
    expect(report.status).toBe(RestoreStatus.Unknown);
    expect(report.pending).toMatch(/^cards\//);
    for (const resume of [false, true])
      await expect(run(fixture, input, { resume })).rejects.toMatchObject({
        code: RestoreErrorCode.UnknownWrite,
      });
    expect(writes(fixture).filter((call) => call.path === '/cards')).toHaveLength(1);
  },
);

test('storage failure before writes and mismatched continuation cannot mutate the board', async () => {
  const fixture = restorationFixture();
  const input = await imported();
  const store = new MemoryJournal();
  store.save = () => {
    throw new Error('storage blocked');
  };
  await expect(run(fixture, input, {}, store)).rejects.toThrow();
  await expect(run(fixture, input, { resume: true })).rejects.toMatchObject({
    code: RestoreErrorCode.JournalMismatch,
  });
  expect(writes(fixture)).toHaveLength(0);
});

test('cancellation before dispatch stores a known checkpoint without deleting content', async () => {
  const active = new AbortController();
  const fixture = restorationFixture();
  const report = await run(fixture, await imported(), {
    signal: active.signal,
    onProgress: () => active.abort(),
  });
  expect(report.status).toBe(RestoreStatus.Cancelled);
  expect(report.pending).toBeNull();
  expect(writes(fixture)).toHaveLength(0);
});

test('lost journal storage after a confirmed write returns an uncertain report', async () => {
  const fixture = restorationFixture();
  const store = new MemoryJournal();
  const persist = store.save.bind(store);
  store.save = (journal) => {
    if (Object.keys(journal.completed).length) throw new Error('quota');
    persist(journal);
  };
  const report = await run(fixture, await imported(), {}, store);
  expect(report.status).toBe(RestoreStatus.Unknown);
  expect(report.error).toBe(RestoreErrorCode.JournalUnavailable);
  expect(writes(fixture)).toHaveLength(1);
  expect(store.read()?.pending).not.toBeNull();
});

test('cancellation after dispatch distinguishes observed and lost responses: lost=%s', async (lost) => {
  const active = new AbortController();
  const fixture = restorationFixture((call) => {
    if (call.method === 'POST' && call.path === '/cards') {
      active.abort();
      if (lost) throw new Error('lost write');
    }
  });
  const report = await run(fixture, await imported(), { signal: active.signal });
  expect(report.status).toBe(lost ? RestoreStatus.Unknown : RestoreStatus.Cancelled);
  expect(Object.keys(report.completed).filter((key) => key.startsWith('cards/'))).toHaveLength(
    lost ? 0 : 1,
  );
  expect(writes(fixture).filter((call) => call.path === '/cards')).toHaveLength(1);
  if (lost) expect(report.error).toBe(ApiErrorCode.WriteResultUnknown);
});

test('a rate limit on an optional write remains resumable instead of permanently skipped', async () => {
  let limited = true;
  const fixture = restorationFixture((call) =>
    limited && call.method === 'POST' && call.path.endsWith('/actions/comments')
      ? new Response('', { status: 429 })
      : undefined,
  );
  const input = await imported();
  const failed = await run(fixture, input);
  expect(failed.status).toBe(RestoreStatus.Failed);
  expect(failed.skipped).toEqual([]);
  limited = false;
  expect((await run(fixture, input, { resume: true })).status).toBe(RestoreStatus.Partial);
  expect(
    fixture.calls.some((call) => call.method === 'POST' && call.path.endsWith('/actions/comments')),
  ).toBe(true);
});

test('a failed parent read does not permanently skip an optional object', async () => {
  let failReads = false;
  const fixture = restorationFixture((call) =>
    failReads && call.method === 'GET' && call.path === `/boards/${targetId}`
      ? new Response('', { status: 503 })
      : undefined,
  );
  const input = await imported();
  const report = await run(fixture, input, {
    onProgress: ({ resource }) => {
      if (resource === RestoreResource.Comment) failReads = true;
    },
  });
  expect(report.status).toBe(RestoreStatus.Failed);
  expect(report.skipped).toEqual([]);
  failReads = false;
  expect((await run(fixture, input, { resume: true })).status).toBe(RestoreStatus.Partial);
});

test('comment chunks resume with original attribution language and reimport without duplication', async () => {
  let count = 0;
  const fixture = restorationFixture((call) =>
    call.method === 'POST' && call.path.endsWith('/actions/comments') && ++count === 2
      ? new Response('', { status: 401 })
      : undefined,
  );
  const input = await imported();
  const comment = input.snapshot.comments[0]!;
  comment.text = '0123456789'.repeat(2500);
  expect((await run(fixture, input)).status).toBe(RestoreStatus.Failed);
  const resumed = await run(fixture, input, { locale: Locale.Russian, resume: true });
  expect(resumed.status).toBe(RestoreStatus.Partial);
  const parts = resumed.commentParts?.[`comments/${comment.id}`] ?? [];
  const cardId = resumed.bindings?.[`cards/${comment.cardId}`];
  const combined = parts
    .map(
      (part) =>
        (fixture.records.get(`/cards/${cardId}/actions/${part}`)?.data as { text: string }).text,
    )
    .join('');
  expect(combined).toBe(attributedComment(comment, Locale.English));
  const before = writes(fixture).length;
  expect((await fixture.plan(input)).actions).toHaveLength(0);
  await run(fixture, input);
  expect(writes(fixture)).toHaveLength(before);
});

test('already cancelled operations leave the previous journal untouched', async () => {
  const fixture = restorationFixture();
  const input = await imported();
  const plan = await fixture.plan(input);
  const active = new AbortController();
  active.abort();
  const context = await fixture.api.context(sourceBoard.id);
  await expect(
    new RestoreEngine(fixture.api, fixture.store).run(input, context, {
      plan,
      locale: Locale.English,
      signal: active.signal,
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(fixture.store.read()).toBeNull();
  expect(writes(fixture)).toHaveLength(0);
});

test('a deleted completed resource invalidates continuation instead of reusing a stale checkpoint', async () => {
  const fixture = restorationFixture((call) =>
    call.method === 'POST' && call.path === '/cards'
      ? new Response('', { status: 403 })
      : undefined,
  );
  const input = await imported();
  const failed = await run(fixture, input);
  const listId = failed.bindings?.[`lists/${input.snapshot.lists[0]!.id}`];
  fixture.records.delete(`/lists/${listId}`);
  await expect(run(fixture, input, { resume: true })).rejects.toMatchObject({
    code: RestoreErrorCode.PlanStale,
  });
});

test('legacy new-board journals cannot resume or redirect imports', async () => {
  const fixture = restorationFixture();
  const input = await imported();
  const journal = await run(fixture, input);
  const plan = await fixture.plan(input);
  delete journal.mode;
  journal.status = RestoreStatus.Failed;
  journal.target!.id = id(777);
  fixture.store.save(journal);
  await expect(run(fixture, input, { resume: true, plan })).rejects.toMatchObject({
    code: RestoreErrorCode.JournalMismatch,
  });
  expect(fixture.calls.some((call) => call.path.includes(id(777)))).toBe(false);
});

test('cancellation at final verification cannot report success', async () => {
  const input = await imported();
  const fixture = restorationFixture(undefined, input.snapshot);
  const active = new AbortController();
  const verify = fixture.api.verifyTarget.bind(fixture.api);
  vi.spyOn(fixture.api, 'verifyTarget').mockImplementation(async (options) => {
    await verify(options);
    active.abort();
  });
  expect((await run(fixture, input, { signal: active.signal })).status).toBe(
    RestoreStatus.Cancelled,
  );
  expect(writes(fixture)).toHaveLength(0);
});

test('keeping current values writes nothing despite differing snapshot fields', async () => {
  const input = await imported();
  const fixture = restorationFixture(undefined, input.snapshot);
  fixture.records.get(`/cards/${input.snapshot.cards[0]!.id}`)!.desc = 'Current description';
  const plan = await fixture.plan(input, MergeChoice.Current);
  expect(plan.unresolved).toBe(0);
  expect((await run(fixture, input, { plan })).status).toBe(RestoreStatus.Complete);
  expect(writes(fixture)).toHaveLength(0);
});

test('JSON imports recreate available file links once and retain that mapping on subsequent imports', async () => {
  const input = await imported();
  for (const attachment of input.snapshot.attachments)
    attachment.url = `https://trello.com/1/cards/${attachment.cardId}/attachments/${attachment.id}/download/${encodeURIComponent(attachment.name)}`;
  const fixture = restorationFixture();
  const first = await run(fixture, input);
  expect(first.status).toBe(RestoreStatus.Partial);
  expect(writes(fixture).filter((call) => call.path.endsWith('/attachments'))).toHaveLength(3);
  expect((await fixture.plan(input)).actions).toHaveLength(0);
  const before = writes(fixture).length;
  await run(fixture, input);
  expect(writes(fixture)).toHaveLength(before);
});

test('reviewed item, list, and label differences update only selected fields', async () => {
  const input = await imported();
  const fixture = restorationFixture(undefined, input.snapshot);
  fixture.records.get(`/lists/${input.snapshot.lists[0]!.id}`)!.name = 'Current list';
  fixture.records.get(`/labels/${input.snapshot.labels[0]!.id}`)!.color = 'yellow';
  const item = input.snapshot.checklistItems[0]!;
  fixture.records.get(`/checklists/${item.checklistId}/checkItems/${item.id}`)!.state = item.checked
    ? 'incomplete'
    : 'complete';
  const report = await run(fixture, input);
  expect(report.status).toBe(RestoreStatus.Partial);
  expect(writes(fixture).filter((call) => call.method === 'PUT')).toHaveLength(3);
  expect((await fixture.plan(input)).actions).toHaveLength(0);
});

test.each([RestoreStatus.Unknown, RestoreStatus.Running])(
  'an uncertain journal on another board cannot be overwritten: %s',
  async (status) => {
    const input = await imported();
    const fixture = restorationFixture();
    const previous = restoreJournal();
    assert(previous.target);
    previous.target.id = id(777);
    previous.sourceContextId = id(777);
    previous.status = status;
    previous.pending = status === RestoreStatus.Running ? 'cards/uncertain' : null;
    fixture.store.save(previous);
    await expect(run(fixture, input)).rejects.toMatchObject({
      code: RestoreErrorCode.UnknownWrite,
    });
    expect(fixture.store.read()).toEqual(previous);
    expect(writes(fixture)).toHaveLength(0);
  },
);

test('legacy custom fields are explicitly omitted without any field API calls', async () => {
  const capture = createLegacyFieldCapture();
  const input = await readImport(new Blob([jsonBytes(capture.snapshot)]));
  const fixture = restorationFixture(undefined, capture.snapshot);
  const before = structuredClone([...fixture.records.entries()]);
  const report = await run(fixture, input);
  expect(report.status).toBe(RestoreStatus.Partial);
  expect(report.warnings).toContain(RestoreWarning.CustomFields);
  expect(report.skipped).toHaveLength(16);
  expect(
    fixture.calls.some((call) => /customFields|customFieldItems|customField\//.test(call.path)),
  ).toBe(false);
  expect(writes(fixture)).toHaveLength(0);
  expect([...fixture.records.entries()]).toEqual(before);
  const again = await run(fixture, input);
  expect(again.warnings).toContain(RestoreWarning.CustomFields);
  expect(writes(fixture)).toHaveLength(0);
});
