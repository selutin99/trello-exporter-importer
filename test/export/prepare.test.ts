import { expect, test, vi } from 'vitest';
import { prepareExport } from '../../src/export/prepare';
import { ExportFormat } from '../../src/snapshot/codes';
import { Locale } from '../../src/i18n';
import { createSyntheticCapture } from '../helpers/board-capture';
vi.mock('../../src/export/pdf', () => ({
  pdfExport: vi.fn(() =>
    Promise.resolve(new Blob(['%PDF-synthetic'], { type: 'application/pdf' })),
  ),
}));

test.each(Object.values(ExportFormat))(
  'format %s uses the snapshot without fetching attachment bytes',
  async (format) => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    try {
      const capture = createSyntheticCapture();
      const before = structuredClone(capture.snapshot);
      const blob = await prepareExport(capture, format, Locale.English);
      expect(blob.size).toBeGreaterThan(0);
      expect(capture.snapshot).toEqual(before);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  },
);

test('cancelled preparation cannot return an export', async () => {
  const active = new AbortController();
  active.abort();
  await expect(
    prepareExport(createSyntheticCapture(), ExportFormat.Json, Locale.English, {
      signal: active.signal,
    }),
  ).rejects.toBe(active.signal.reason);
});
