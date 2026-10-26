import { expect, test, vi } from 'vitest';
import { ScopeError } from '../../src/api';
import {
  id,
  readerFixture,
  sourceAttachment,
  sourceBoard,
  sourceCard,
  sourceList,
  sourceChecklist,
  sourceComment,
  verifiedReader,
} from '../helpers/snapshot';

test('only active cards in active lists enter the reader allowlist, even if filters are ignored', async () => {
  const { reader, calls } = readerFixture({
    [`/1/boards/${id(1)}/lists`]: [sourceList, { ...sourceList, id: id(90), closed: true }],
    [`/1/boards/${id(1)}/cards`]: [
      sourceCard,
      { ...sourceCard, id: id(91), closed: true },
      { ...sourceCard, id: id(92), idList: id(90) },
    ],
  });
  await reader.board(id(1));
  expect((await reader.lists()).map((list) => list.id)).toEqual([sourceList.id]);
  expect((await reader.cards()).map((card) => card.id)).toEqual([sourceCard.id]);
  expect(calls.find((url) => url.pathname.endsWith('/lists'))?.searchParams.get('filter')).toBe(
    'open',
  );
  expect(calls.find((url) => url.pathname.endsWith('/cards'))?.searchParams.get('filter')).toBe(
    'visible',
  );
  const count = calls.length;
  await expect(reader.attachments(id(91))).rejects.toThrow(ScopeError);
  await expect(reader.comments(id(92))).rejects.toThrow(ScopeError);
  expect(calls).toHaveLength(count);
});

test('reader blocks collection and unknown-card requests before making HTTP calls', async () => {
  const { reader, calls } = readerFixture();
  await expect(reader.cards()).rejects.toThrow(ScopeError);
  await expect(reader.labels()).rejects.toThrow(ScopeError);
  await expect(reader.members()).rejects.toThrow(ScopeError);
  await expect(reader.attachments(id(99))).rejects.toThrow(ScopeError);
  await expect(reader.checklists(id(99))).rejects.toThrow(ScopeError);
  await expect(reader.comments(id(99))).rejects.toThrow(ScopeError);
  await expect(reader.file(id(3), sourceAttachment, 10)).rejects.toThrow(ScopeError);
  expect(calls).toHaveLength(0);
});

test('all board identities and child owners must match before content is read', async () => {
  await expect(readerFixture().reader.board(id(99))).rejects.toThrow(ScopeError);
  const foreign = await verifiedReader({ [`/1/cards/${id(3)}`]: { id: id(3), idBoard: id(99) } });
  const before = foreign.calls.length;
  await expect(foreign.reader.attachments(id(3))).rejects.toThrow(ScopeError);
  expect(foreign.calls).toHaveLength(before + 1);
  const malformed = await verifiedReader({ [`/1/cards/${id(3)}`]: { id: id(99), idBoard: id(1) } });
  await expect(malformed.reader.checklists(id(3))).rejects.toThrow(ScopeError);
  const moved = readerFixture({
    [`/1/boards/${id(1)}/cards`]: [{ ...sourceCard, idBoard: id(99) }],
  });
  await moved.reader.board(id(1));
  await moved.reader.lists();
  await expect(moved.reader.cards()).rejects.toThrow(ScopeError);
});

test('foreign nested checklist and comment parents are rejected', async () => {
  const { reader } = await verifiedReader({
    [`/1/cards/${id(3)}/checklists`]: [{ ...sourceChecklist, idCard: id(99) }],
    [`/1/cards/${id(3)}/actions`]: [
      { ...sourceComment, data: { ...sourceComment.data, card: { id: id(99) } } },
    ],
  });
  await expect(reader.checklists(id(3))).rejects.toThrow(ScopeError);
  await expect(reader.comments(id(3))).rejects.toThrow(ScopeError);
});

test('comments paginate with the oldest cursor and reject a server repeating pages', async () => {
  const page = Array.from({ length: 1000 }, (_, index) => ({
    ...sourceComment,
    id: id(2000 + index),
  }));
  const { reader, calls } = await verifiedReader({ [`/1/cards/${id(3)}/actions`]: page });
  await expect(reader.comments(id(3))).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  const pages = calls.filter((url) => url.pathname.endsWith('/actions'));
  expect(pages).toHaveLength(2);
  expect(pages[1]?.searchParams.get('before')).toBe(id(2000));
  expect(pages[0]?.searchParams.get('filter')).toBe('commentCard');
});

test('download is built from scoped IDs, never the untrusted attachment URL', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('demo'));
  const { reader } = await verifiedReader();
  await reader.attachments(id(3));
  const { reader: downloading } = readerFixture({}, { fetchImpl: fetcher });
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify(sourceBoard)));
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify(sourceBoard)));
  await downloading.board(id(1));
  // A foreign upload remains blocked even after board verification.
  await expect(downloading.file(id(3), sourceAttachment, 4)).rejects.toThrow(ScopeError);
  const fixture = await verifiedReader({
    [`/1/cards/${id(3)}/attachments`]: [{ ...sourceAttachment, isUpload: false }],
  });
  await fixture.reader.attachments(id(3));
  await expect(fixture.reader.file(id(3), sourceAttachment, 4)).rejects.toThrow(ScopeError);
});

test.each(['original file.txt', 'original café.txt'])(
  'renaming an upload does not change its download filename: %s',
  async (fileName) => {
    const attachment = {
      ...sourceAttachment,
      name: 'Renamed attachment',
      fileName,
      url: 'https://untrusted.example/file',
    };
    const downloadPath = `/1/cards/${id(3)}/attachments/${attachment.id}/download/${encodeURIComponent(fileName)}`;
    const { reader, calls } = await verifiedReader({
      [`/1/cards/${id(3)}/attachments`]: [attachment],
      [downloadPath]: new Response('data'),
    });
    await reader.attachments(id(3));
    expect(
      await reader.file(id(3), { ...attachment, fileName: 'changed.txt', name: 'Changed' }, 4),
    ).toEqual(new TextEncoder().encode('data'));
    expect(calls.at(-1)?.href).toBe(`https://trello.com${downloadPath}`);
    expect(
      calls
        .find((url) => url.pathname.endsWith('/attachments'))
        ?.searchParams.get('fields')
        ?.split(','),
    ).toContain('fileName');
  },
);

test.each([undefined, null, ''])(
  'uploads without an original filename retain the display-name fallback: %s',
  async (fileName) => {
    const attachment = { ...sourceAttachment, fileName };
    const path = `/1/cards/${id(3)}/attachments/${attachment.id}/download/${attachment.name}`;
    const { reader } = await verifiedReader({
      [`/1/cards/${id(3)}/attachments`]: [attachment],
      [path]: new Response('data'),
    });
    await reader.attachments(id(3));
    expect(await reader.file(id(3), attachment, 4)).toEqual(new TextEncoder().encode('data'));
  },
);
