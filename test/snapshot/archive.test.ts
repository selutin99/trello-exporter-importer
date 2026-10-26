import { expect, test } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildArchive, MAXIMUM_ARCHIVE_BYTES, sha256 } from '../../src/snapshot/archive';
import { createSyntheticCapture, syntheticFileReader } from '../helpers/board-capture';
import { syntheticFiles } from '../helpers/board-data';
import { ApiError, ScopeError } from '../../src/api/errors';
import { ApiErrorCode } from '../../src/shared/error-codes';
import type { Snapshot, SnapshotFile } from '../../src/snapshot/types';
import { captureBoard } from '../../src/snapshot/capture';
import { readImport } from '../../src/import/read';
import { readerFixture, id } from '../helpers/snapshot';
import { CaptureOutcome, CoverageStatus, IssueCode } from '../../src/snapshot/codes';

test('ZIP contains exactly the manifest entries, verifies every digest, and preserves original file bytes', async () => {
  const capture = createSyntheticCapture();
  const blob = await buildArchive(capture, syntheticFileReader);
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const manifest = JSON.parse(strFromU8(entries['manifest.json']!)) as {
    snapshotId: string;
    files: SnapshotFile[];
  };
  const snapshot = JSON.parse(strFromU8(entries['snapshot.json']!)) as Snapshot;
  expect(manifest.snapshotId).toBe(snapshot.snapshotId);
  expect(Object.keys(entries).sort()).toEqual(
    ['manifest.json', ...manifest.files.map((file) => file.path)].sort(),
  );
  for (const file of manifest.files) {
    const bytes = entries[file.path]!;
    expect(bytes.length).toBe(file.size);
    expect(await sha256(new Uint8Array(bytes))).toBe(file.sha256);
  }
  const sources = syntheticFiles();
  for (const attachment of snapshot.attachments) {
    const original = sources.find((file) => file.name === attachment.name)!;
    expect(entries[attachment.file!.path]).toEqual(original.bytes);
    expect(attachment.file!.path).not.toContain(attachment.name);
  }
  expect(snapshot.coverage.attachmentFiles).toEqual({ status: 'complete', count: 3 });
  expect(snapshot.capture.outcome).toBe('complete');
});

test('failed downloads and byte-size mismatches produce a useful partial archive', async () => {
  const capture = createSyntheticCapture();
  let calls = 0;
  const blob = await buildArchive(capture, {
    file: async (_card, _attachment, budget) => {
      expect(budget).toBe(MAXIMUM_ARCHIVE_BYTES);
      if (++calls === 1) throw new ApiError(ApiErrorCode.NetworkError);
      return new Uint8Array(0);
    },
  });
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  expect(Object.keys(entries).sort()).toEqual(['manifest.json', 'snapshot.json']);
  expect(capture.snapshot.capture.outcome).toBe('partial');
  expect(capture.snapshot.issues).toHaveLength(3);
  expect(capture.snapshot.attachments.every((file) => file.file === null)).toBe(true);
});

test('a download body failure produces an importable ZIP with an explicit missing-file warning', async () => {
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('synthetic interrupted download'));
      },
    }),
  );
  const { reader } = readerFixture({
    [`/1/cards/${id(3)}/attachments/${id(4)}/download/note.txt`]: response,
  });
  const capture = await captureBoard(reader, id(1));
  const imported = await readImport(await buildArchive(capture, reader));
  expect(imported.files.size).toBe(0);
  expect(imported.snapshot.capture.outcome).toBe(CaptureOutcome.Partial);
  expect(imported.snapshot.coverage.attachmentFiles).toEqual({
    status: CoverageStatus.Partial,
    count: 0,
  });
  expect(imported.snapshot.issues).toMatchObject([{ code: IssueCode.FileUnavailable }]);
  expect(imported.snapshot.attachments).toHaveLength(1);
  expect(imported.snapshot.attachments[0]?.file).toBeNull();
});

test('HTTP file omissions retain only fixed failure codes and status, without server details', async () => {
  const { reader } = readerFixture(
    {
      [`/1/cards/${id(3)}/attachments/${id(4)}/download/note.txt`]: new Response(
        'synthetic-private-response-and-signed-url',
        { status: 404 },
      ),
    },
    { attachmentAuth: { appKey: 'public-key', getToken: async () => 'synthetic-file-token' } },
  );
  const capture = await captureBoard(reader, id(1));
  const imported = await readImport(await buildArchive(capture, reader));
  expect(imported.snapshot.issues).toMatchObject([
    {
      code: IssueCode.FileUnavailable,
    },
  ]);
  expect(imported.snapshot.issues[0]?.message).toContain('REQUEST_FAILED, HTTP 404');
  expect(JSON.stringify(imported.snapshot)).not.toContain('synthetic-private-response');
  expect(JSON.stringify(imported.snapshot)).not.toContain('synthetic-file-token');
  expect(imported.snapshot.coverage.attachmentFiles).toEqual({
    status: CoverageStatus.Partial,
    count: 0,
  });
});

test('foreign scope and cancellation terminate packaging instead of returning a download', async () => {
  await expect(
    buildArchive(createSyntheticCapture(), {
      file: async () => {
        throw new ScopeError();
      },
    }),
  ).rejects.toThrow(ScopeError);
  const active = new AbortController();
  await expect(
    buildArchive(createSyntheticCapture(), syntheticFileReader, {
      signal: active.signal,
      onProgress: () => active.abort(),
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
});

test('an empty attachment set still yields a valid ZIP with no file warnings', async () => {
  const capture = createSyntheticCapture();
  capture.snapshot.attachments = [];
  const blob = await buildArchive(capture, syntheticFileReader);
  expect(Object.keys(unzipSync(new Uint8Array(await blob.arrayBuffer()))).sort()).toEqual([
    'manifest.json',
    'snapshot.json',
  ]);
  expect(capture.snapshot.coverage.attachmentFiles).toEqual({ status: 'complete', count: 0 });
});
