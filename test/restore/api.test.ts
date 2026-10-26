import { expect, test } from 'vitest';
import { restorationFixture, targetId, workspaceId } from '../helpers/restore';
import { sourceBoard, id } from '../helpers/snapshot';
import { RestoreResource, RestoreErrorCode } from '../../src/restore/codes';
import { ScopeError } from '../../src/api/errors';
import { createSyntheticCapture } from '../helpers/board-capture';

test('context selects only the existing current board without enumeration or creation', async () => {
  const { api, calls } = restorationFixture();
  const context = await api.context(sourceBoard.id);
  expect(context.workspaceId).toBe(workspaceId);
  expect((await api.selectTarget(context)).id).toBe(targetId);
  expect((await api.snapshot(context)).cards).toHaveLength(0);
  expect(
    calls.every((call) => call.method === 'GET' && !call.path.includes('/organizations/')),
  ).toBe(true);
  await expect(api.context(id(999))).rejects.toThrow(ScopeError);
  await expect(api.create(RestoreResource.Board, targetId, {})).rejects.toThrow(ScopeError);
  expect(calls.some((call) => call.method === 'POST')).toBe(false);
});

test('foreign parents, archived cards, and body overrides never receive writes', async () => {
  const { api, records, calls } = restorationFixture(undefined, createSyntheticCapture().snapshot);
  await api.selectTarget(await api.context(sourceBoard.id));
  const foreign = id(888);
  records.set(`/cards/${foreign}`, { id: foreign, idBoard: id(889), closed: false });
  await expect(
    api.create(
      RestoreResource.Attachment,
      foreign,
      new FormData() as unknown as Record<string, unknown>,
    ),
  ).rejects.toThrow(ScopeError);
  records.get(`/cards/${foreign}`)!.idBoard = targetId;
  records.get(`/cards/${foreign}`)!.closed = true;
  await expect(api.create(RestoreResource.Comment, foreign, { text: 'Blocked' })).rejects.toThrow(
    ScopeError,
  );
  await expect(api.create(RestoreResource.List, id(999), { name: 'Blocked' })).rejects.toThrow(
    ScopeError,
  );
  await expect(api.create(RestoreResource.Card, id(10), { idList: id(11) })).rejects.toThrow(
    ScopeError,
  );
  await expect(api.create(RestoreResource.Field, targetId, { idModel: foreign })).rejects.toThrow(
    ScopeError,
  );
  await expect(api.create(RestoreResource.List, targetId, { idBoard: foreign })).rejects.toThrow(
    ScopeError,
  );
  await expect(
    api.create(
      RestoreResource.List,
      targetId,
      new FormData() as unknown as Record<string, unknown>,
    ),
  ).rejects.toThrow(ScopeError);
  expect(calls.some((call) => call.method !== 'GET')).toBe(false);
});

test.each(['closed', 'workspace', 'identity'])(
  'destination changes stop writes: %s',
  async (kind) => {
    const fixture = restorationFixture();
    await fixture.api.selectTarget(await fixture.api.context(sourceBoard.id));
    Object.assign(
      fixture.records.get(`/boards/${targetId}`)!,
      kind === 'closed'
        ? { closed: true }
        : kind === 'workspace'
          ? { idOrganization: id(999) }
          : { id: id(999) },
    );
    await expect(
      fixture.api.create(RestoreResource.List, targetId, { name: 'Blocked' }),
    ).rejects.toThrow(ScopeError);
    expect(fixture.calls.every((call) => call.method === 'GET')).toBe(true);
  },
);

test('field updates compare current values immediately before PUT and reject unsafe properties', async () => {
  const fixture = restorationFixture(undefined, createSyntheticCapture().snapshot);
  await fixture.api.selectTarget(await fixture.api.context(sourceBoard.id));
  const card = fixture.records.get(`/cards/${id(100)}`)!;
  await expect(
    fixture.api.update(RestoreResource.Card, id(100), { name: 'New' }, { name: 'Stale' }),
  ).rejects.toMatchObject({ code: RestoreErrorCode.PlanStale });
  await expect(
    fixture.api.update(RestoreResource.Card, id(100), { closed: true }, {}),
  ).rejects.toThrow(ScopeError);
  await expect(
    fixture.api.update(RestoreResource.Board, id(999), { desc: '' }, {}),
  ).rejects.toThrow(ScopeError);
  expect(fixture.calls.some((call) => call.path === `/boards/${id(999)}`)).toBe(false);
  await fixture.api.update(RestoreResource.Card, id(100), { name: 'New' }, { name: card.name });
  expect(card.name).toBe('New');
  expect(fixture.calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
});

test.each([RestoreResource.Field, RestoreResource.Option, RestoreResource.Value])(
  'legacy %s writes and field reads are rejected before custom-field requests',
  async (resource) => {
    const fixture = restorationFixture();
    await fixture.api.selectTarget(await fixture.api.context(sourceBoard.id));
    await expect(
      fixture.api.create(resource, targetId, { name: 'Excluded', idModel: targetId }),
    ).rejects.toThrow(ScopeError);
    await expect(fixture.api.verifyEntity(RestoreResource.Field, id(40))).rejects.toThrow(
      ScopeError,
    );
    await expect(fixture.api.verifyNested(RestoreResource.Option, id(40), id(41))).rejects.toThrow(
      ScopeError,
    );
    expect(fixture.calls.some((call) => /customFields|customFieldItems/.test(call.path))).toBe(
      false,
    );
    expect(fixture.calls.some((call) => call.method !== 'GET')).toBe(false);
  },
);

test('checklist updates stay anchored to verified parents and reviewed values', async () => {
  const fixture = restorationFixture(undefined, createSyntheticCapture().snapshot);
  await fixture.api.selectTarget(await fixture.api.context(sourceBoard.id));
  const item = fixture.records.get(`/checklists/${id(200)}/checkItems/${id(1000)}`)!;
  await fixture.api.item(id(200), id(1000), { name: 'Reviewed' }, { name: item.name });
  await expect(fixture.api.item(id(200), id(1000), { closed: true }, {})).rejects.toThrow(
    ScopeError,
  );
  await expect(fixture.api.verifyNested(RestoreResource.Board, targetId, id(1000))).rejects.toThrow(
    ScopeError,
  );
  await expect(fixture.api.verifyEntity(RestoreResource.Board, targetId)).rejects.toThrow(
    ScopeError,
  );
  expect(fixture.calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
});

test('a card in an archived list and a checklist on a moved card are rejected before nested writes', async () => {
  const fixture = restorationFixture(undefined, createSyntheticCapture().snapshot);
  await fixture.api.selectTarget(await fixture.api.context(sourceBoard.id));
  const list = fixture.records.get(`/lists/${id(10)}`)!;
  list.closed = true;
  await expect(
    fixture.api.create(RestoreResource.Comment, id(100), { text: 'Blocked' }),
  ).rejects.toThrow(ScopeError);
  list.closed = false;
  fixture.records.get(`/cards/${id(100)}`)!.idBoard = id(999);
  await expect(
    fixture.api.create(RestoreResource.Item, id(200), { name: 'Blocked' }),
  ).rejects.toThrow(ScopeError);
  await expect(
    fixture.api.update(RestoreResource.Checklist, id(200), { name: 'Blocked' }, {}),
  ).rejects.toThrow(ScopeError);
  expect(fixture.calls.every((call) => call.method === 'GET')).toBe(true);
});

test('a new card cannot assign a label belonging to another board', async () => {
  const fixture = restorationFixture(undefined, createSyntheticCapture().snapshot);
  await fixture.api.selectTarget(await fixture.api.context(sourceBoard.id));
  const labelId = id(888);
  fixture.records.set(`/labels/${labelId}`, { id: labelId, idBoard: id(999) });
  await expect(
    fixture.api.create(RestoreResource.Card, id(10), {
      idList: id(10),
      name: 'Synthetic card',
      idLabels: [labelId],
    }),
  ).rejects.toThrow(ScopeError);
  expect(fixture.calls.every((call) => call.method === 'GET')).toBe(true);
});

test('unreviewed fields and unexpected create properties never reach the write transport', async () => {
  const fixture = restorationFixture(undefined, createSyntheticCapture().snapshot);
  await fixture.api.selectTarget(await fixture.api.context(sourceBoard.id));
  await expect(
    fixture.api.update(RestoreResource.Card, id(100), { name: 'Unreviewed' }, {}),
  ).rejects.toThrow(ScopeError);
  await expect(
    fixture.api.create(RestoreResource.List, targetId, { name: 'Blocked', closed: true }),
  ).rejects.toThrow(ScopeError);
  await expect(fixture.api.item(id(200), id(1000), {}, {})).rejects.toThrow(ScopeError);
  expect(fixture.calls.every((call) => call.method === 'GET')).toBe(true);
});
