import { expect, test } from 'vitest';
import { ScopeError } from '../../src/api/errors';
import { RestoreErrorCode, RestoreResource } from '../../src/restore/codes';
import {
  assertCreatePayload,
  assertExpectedValues,
  assertUpdatePayload,
} from '../../src/restore/payloads';

test('reviewed values require every selected field and compare labels as a set without mutation', () => {
  const current = { name: 'Current', idLabels: ['b', 'a'] };
  const expected = { name: 'Current', idLabels: ['a', 'b'] };
  const body = { name: 'Incoming', idLabels: ['c'] };
  const original = structuredClone({ current, expected, body });
  expect(() => assertExpectedValues(current, body, expected)).not.toThrow();
  expect({ current, expected, body }).toEqual(original);
  expect(() => assertExpectedValues(current, body, { name: 'Current' })).toThrow(ScopeError);
  expect(() => assertExpectedValues(current, body, { ...expected, name: 'Stale' })).toThrow(
    RestoreErrorCode.PlanStale,
  );
});

test('create and update contracts reject access changes, parent overrides, and unknown form fields', () => {
  expect(() =>
    assertCreatePayload(RestoreResource.List, 'board', { name: 'Synthetic' }),
  ).not.toThrow();
  expect(() => assertCreatePayload(RestoreResource.Field, 'board', { idModel: 'other' })).toThrow(
    ScopeError,
  );
  expect(() => assertUpdatePayload(RestoreResource.Board, { desc: 'Reviewed' })).not.toThrow();
  for (const body of [{}, { name: 'Board rename' }, { closed: true }, { prefs: {} }])
    expect(() => assertUpdatePayload(RestoreResource.Board, body)).toThrow(ScopeError);
  const form = new FormData();
  form.set('name', 'Synthetic.txt');
  expect(() =>
    assertCreatePayload(
      RestoreResource.Attachment,
      'card',
      form as unknown as Record<string, unknown>,
    ),
  ).toThrow(ScopeError);
  form.set('idBoard', 'other');
  expect(() =>
    assertCreatePayload(
      RestoreResource.Attachment,
      'card',
      form as unknown as Record<string, unknown>,
    ),
  ).toThrow(ScopeError);
});
