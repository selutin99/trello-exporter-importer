import { expect, test } from 'vitest';
import { ScopeError } from '../../src/api/errors';
import { RestoreErrorCode, RestoreResource } from '../../src/restore/codes';
import { RestoreScope } from '../../src/restore/scope';
import { createSyntheticCapture } from '../helpers/board-capture';
import { restorationFixture } from '../helpers/restore';
import { id, sourceBoard } from '../helpers/snapshot';

function setup() {
  const fixture = restorationFixture(undefined, createSyntheticCapture().snapshot);
  const scope = new RestoreScope({
    boardReference: sourceBoard.id,
    fetchImpl: fixture.fetchImpl,
    getAccessToken: async () => 'synthetic-token',
  });
  return { ...fixture, scope };
}

test('target metadata cannot be read or used before selection, or mutated through a returned copy', async () => {
  const { scope, calls } = setup();
  expect(() => scope.target).toThrow(RestoreErrorCode.InvalidTarget);
  await expect(scope.verifyTarget()).rejects.toMatchObject({
    code: RestoreErrorCode.InvalidTarget,
  });
  await expect(scope.verifyEntity(RestoreResource.Card, id(100))).rejects.toMatchObject({
    code: RestoreErrorCode.InvalidTarget,
  });
  expect(calls).toHaveLength(0);
  const context = await scope.context(sourceBoard.id);
  const target = await scope.selectTarget(context);
  target.id = id(999);
  scope.target.id = id(999);
  expect(scope.target.id).toBe(sourceBoard.id);
  await scope.verifyTarget();
  expect(calls.every((call) => call.method === 'GET' && !call.path.includes(id(999)))).toBe(true);
});

test('nested identities require their verified current-board parent and an exact response ID', async () => {
  const { scope, records, calls } = setup();
  await scope.selectTarget(await scope.context(sourceBoard.id));
  expect(await scope.verifyNested(RestoreResource.Item, id(200), id(1000))).toMatchObject({
    id: id(1000),
  });
  records.set(`/checklists/${id(200)}/checkItems/${id(1000)}`, { id: id(999) });
  await expect(scope.verifyNested(RestoreResource.Item, id(200), id(1000))).rejects.toThrow(
    ScopeError,
  );
  const card = records.get(`/cards/${id(100)}`);
  if (!card) throw new Error('Missing synthetic card');
  card.idList = id(999);
  records.set(`/lists/${id(999)}`, { id: id(999), idBoard: id(888), closed: false });
  await expect(scope.verifyEntity(RestoreResource.Checklist, id(200))).rejects.toThrow(ScopeError);
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});
