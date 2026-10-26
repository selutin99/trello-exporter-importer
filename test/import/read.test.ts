import { expect, test, vi } from 'vitest';
import { createSyntheticCapture } from '../helpers/board-capture';
import { jsonBytes, sha256 } from '../../src/snapshot/encoding';
import { readImport, MAXIMUM_IMPORT_BYTES } from '../../src/import/read';
import { ImportError, ImportErrorCode } from '../../src/import/codes';
import { ProductName } from '../../src/config/product';

const json = (value: unknown) => new Blob([jsonBytes(value)]);

test.each(Object.values(ProductName))(
  'JSON retains source links and producer compatibility for %s',
  async (name) => {
    const snapshot = createSyntheticCapture().snapshot;
    snapshot.exporter.name = name;
    const input = json(snapshot);
    const imported = await readImport(input);
    expect(imported.snapshot).toEqual(snapshot);
    expect(imported.checksum).toBe(await sha256(new Uint8Array(await input.arrayBuffer())));
    expect(imported.snapshot.attachments).toHaveLength(3);
    expect(
      imported.snapshot.attachments.every(
        (a) => a.file === null && a.url?.startsWith('https://trello.com/1/cards/'),
      ),
    ).toBe(true);
    expect(imported.snapshot.coverage.attachmentFiles).toEqual({ status: 'excluded', count: 0 });
  },
);

test.each([
  null,
  {},
  { format: 'trello-exporter.snapshot', snapshotId: 'report-only', capture: {} },
  { ...createSyntheticCapture().snapshot, formatVersion: '2.0.0' },
  { ...createSyntheticCapture().snapshot, snapshotId: 'invalid' },
])('unsupported input cannot enter restoration: %j', async (value) => {
  await expect(readImport(json(value))).rejects.toBeInstanceOf(ImportError);
});

test('archives, embedded-file references, malformed JSON and invalid UTF-8 are rejected', async () => {
  for (const file of [
    new Blob([new Uint8Array([0x50, 0x4b, 3, 4])]),
    new Blob(['{invalid']),
    new Blob([new Uint8Array([0xff, 0xfe])]),
  ]) {
    await expect(readImport(file)).rejects.toMatchObject({ code: ImportErrorCode.InvalidSnapshot });
  }
  const snapshot = createSyntheticCapture().snapshot;
  const attachments = snapshot.attachments.map((a) => ({
    ...a,
    file: { path: `attachments/${a.id}/content`, size: 1, sha256: '0'.repeat(64) },
  }));
  await expect(readImport(json({ ...snapshot, attachments }))).rejects.toBeInstanceOf(ImportError);
});

test('oversized JSON is rejected before its contents are read', async () => {
  const file = new Blob();
  Object.defineProperty(file, 'size', { value: MAXIMUM_IMPORT_BYTES + 1 });
  const read = vi.spyOn(file, 'arrayBuffer');
  await expect(readImport(file)).rejects.toMatchObject({ code: ImportErrorCode.LimitExceeded });
  expect(read).not.toHaveBeenCalled();
});

test('cancellation before and during file reading cannot publish an import', async () => {
  const active = new AbortController();
  active.abort();
  const file = json(createSyntheticCapture().snapshot);
  const read = vi.spyOn(file, 'arrayBuffer');
  await expect(readImport(file, active.signal)).rejects.toBe(active.signal.reason);
  expect(read).not.toHaveBeenCalled();
  const reading = new AbortController();
  read.mockImplementation(async () => {
    reading.abort();
    return jsonBytes(createSyntheticCapture().snapshot).buffer;
  });
  await expect(readImport(file, reading.signal)).rejects.toBe(reading.signal.reason);
});

test('cancellation during the checksum cannot publish a validated JSON import', async () => {
  const active = new AbortController();
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (...args) => {
    const result = await digest(...args);
    active.abort();
    return result;
  });
  await expect(
    readImport(json(createSyntheticCapture().snapshot), active.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
});
