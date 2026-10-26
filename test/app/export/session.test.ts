import { expect, test, vi } from 'vitest';
import { ExportSession } from '../../../src/app/export/session';
import { ExportFormat } from '../../../src/snapshot/codes';
import { ExportState } from '../../../src/app/export/types';
import { id, readerFixture, sourceList } from '../../helpers/snapshot';

test('a session rejects concurrent work and late results after cancellation', async () => {
  const changed = vi.fn();
  const session = new ExportSession(changed);
  await session.prepare(null, '');
  session.selectFormat(ExportFormat.Json);
  const active = new AbortController();
  const { reader } = readerFixture(
    {},
    {
      getAccessToken: () =>
        new Promise((resolve) =>
          active.signal.addEventListener('abort', () => resolve('synthetic')),
        ),
    },
  );
  const pending = session.load(reader, id(1));
  expect(session.busy).toBe(true);
  session.selectFormat(ExportFormat.Markdown);
  await session.load(reader, id(1));
  expect(session.model.format).toBe(ExportFormat.Json);
  session.cancel();
  active.abort();
  await pending;
  expect(session.model.state).toBe(ExportState.Cancelled);
  expect(session.model.board).toBeNull();
});

test('scope failure is distinct from a transport failure and no download is retained', async () => {
  const session = new ExportSession(() => {});
  await session.load(readerFixture().reader, id(99));
  expect(session.model.state).toBe(ExportState.ScopeFailed);
  const { reader } = readerFixture({}, { getAccessToken: async () => null });
  await session.load(reader, id(1));
  expect(session.model.state).toBe(ExportState.Failed);
  expect(session.model.result).toBeNull();
});

test('refreshing board information clears a previously prepared download', async () => {
  const session = new ExportSession(() => {});
  const { reader } = readerFixture();
  await session.load(reader, id(1));
  session.selectFormat(ExportFormat.Json);
  await session.prepare(reader, id(1));
  expect(session.model.result).not.toBeNull();
  await session.load(reader, id(1));
  expect(session.model.state).toBe(ExportState.Ready);
  expect(session.model.result).toBeNull();
});

test('a fresh export updates the overview after board content changes', async () => {
  const session = new ExportSession(() => {});
  const previous = readerFixture({
    [`/1/boards/${id(1)}/lists`]: [sourceList, { ...sourceList, id: id(90) }],
  });
  await session.load(previous.reader, id(1));
  expect(session.model.board).toMatchObject({ lists: 2, cards: 1 });
  session.selectFormat(ExportFormat.Json);
  await session.prepare(readerFixture().reader, id(1));
  expect(session.model.state).toBe(ExportState.Complete);
  expect(session.model.board).toEqual({ name: 'Synthetic board', lists: 1, cards: 1 });
});

test.each(Object.values(ExportFormat))(
  'a board without active cards cannot start a %s export',
  async (format) => {
    const session = new ExportSession(() => {});
    const { reader, calls } = readerFixture({ [`/1/boards/${id(1)}/cards`]: [] });
    await session.load(reader, id(1));
    session.selectFormat(format);
    const before = calls.length;
    await session.prepare(reader, id(1));
    expect(calls).toHaveLength(before);
    expect(session.model.result).toBeNull();
    expect(session.busy).toBe(false);
  },
);

test('a board that becomes empty during capture produces no download', async () => {
  const session = new ExportSession(() => {});
  await session.load(readerFixture().reader, id(1));
  const { reader } = readerFixture({ [`/1/boards/${id(1)}/cards`]: [] });
  await session.prepare(reader, id(1));
  expect(session.model.state).toBe(ExportState.Ready);
  expect(session.model.board).toMatchObject({ lists: 1, cards: 0 });
  expect(session.model.result).toBeNull();
  expect(session.model.progress).toBeNull();
});

test('format selection preserves an unavailable board outcome until the board can be loaded', async () => {
  const session = new ExportSession(() => {});
  await session.load(readerFixture().reader, id(99));
  session.selectFormat(ExportFormat.Csv);
  expect(session.model.state).toBe(ExportState.ScopeFailed);
  expect(session.model.board).toBeNull();
});
