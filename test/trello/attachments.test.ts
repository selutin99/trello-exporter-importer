import { expect, test, vi } from 'vitest';
import { AttachmentAccess, AttachmentAccessState } from '../../src/trello/attachments';
import { deferred } from '../helpers/deferred';

test('consent is explicit, read-only, one-day, and duplicate clicks do not open more windows', async () => {
  const pending = deferred<void>();
  const client = {
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
    getToken: vi.fn().mockRejectedValue(new Error('private')),
    authorize: vi.fn().mockRejectedValue(new Error('private')),
  };
  const access = new AttachmentAccess(client, vi.fn());
  await access.refresh();
  expect(access.state).toBe(AttachmentAccessState.Failed);
  await access.authorize();
  expect(access.state).toBe(AttachmentAccessState.Failed);
});
