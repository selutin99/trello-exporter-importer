import { expect, test, vi } from 'vitest';
import { AttachmentAccess, AttachmentAccessState } from '../../src/trello/attachments';
import { deferred } from '../helpers/deferred';

test('consent is explicit, read-only, one-day, and duplicate clicks do not open more windows', async () => {
  const pending = deferred<void>();
  const client = {
    clearToken: vi.fn().mockResolvedValue(undefined),
    getToken: vi.fn().mockResolvedValue(null),
    authorize: vi.fn(() => pending.promise),
  };
  const changed = vi.fn();
  const access = new AttachmentAccess(client, changed);
  await access.refresh();
  expect(access.state).toBe(AttachmentAccessState.Required);
  expect(client.authorize).not.toHaveBeenCalled();
  const consent = access.authorize();
  await access.authorize();
  expect(access.state).toBe(AttachmentAccessState.Authorizing);
  expect(client.authorize).toHaveBeenCalledExactlyOnceWith({ scope: 'read', expiration: '1day' });
  client.getToken.mockResolvedValue('synthetic');
  pending.resolve();
  await consent;
  expect(access.state).toBe(AttachmentAccessState.Ready);
  expect(changed).toHaveBeenCalled();
});

test('missing configuration, rejected consent, and unreadable SDK storage stay safe', async () => {
  const unavailable = new AttachmentAccess(null, vi.fn());
  await unavailable.refresh();
  await unavailable.authorize();
  expect(unavailable.state).toBe(AttachmentAccessState.Unavailable);
  const client = {
    clearToken: vi.fn().mockRejectedValue(new Error('private')),
    getToken: vi.fn().mockRejectedValue(new Error('private')),
    authorize: vi.fn().mockRejectedValue(new Error('private')),
  };
  const access = new AttachmentAccess(client, vi.fn());
  await access.refresh();
  expect(access.state).toBe(AttachmentAccessState.Failed);
  await access.authorize();
  expect(access.state).toBe(AttachmentAccessState.Failed);
  await access.reset();
  expect(access.state).toBe(AttachmentAccessState.Failed);
  await unavailable.reset();
});

test('an expired SDK token can be reset before a fresh user-initiated consent', async () => {
  const clearing = deferred<void>();
  let token: string | null = 'synthetic-expired';
  const client = {
    getToken: vi.fn(async () => token),
    clearToken: vi.fn(async () => {
      await clearing.promise;
      token = null;
    }),
    authorize: vi.fn(async () => {
      token = 'synthetic-renewed';
    }),
  };
  const access = new AttachmentAccess(client, vi.fn());
  await access.refresh();
  expect(access.state).toBe(AttachmentAccessState.Ready);
  const reset = access.reset();
  await access.reset();
  await access.authorize();
  expect(access.busy).toBe(true);
  expect(client.clearToken).toHaveBeenCalledOnce();
  expect(client.authorize).not.toHaveBeenCalled();
  clearing.resolve();
  await reset;
  expect(access.state).toBe(AttachmentAccessState.Required);
  await access.authorize();
  expect(client.authorize).toHaveBeenCalledExactlyOnceWith({ scope: 'read', expiration: '1day' });
  expect(access.state).toBe(AttachmentAccessState.Ready);
});
