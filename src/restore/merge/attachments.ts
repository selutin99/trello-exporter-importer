import type { ImportedBoard } from '../../import/read';
import { AttachmentKind } from '../../snapshot/codes';
import { MergeField } from './types';
import type { MergeRecord } from './types';
import { canonical } from './values';

/**
 * Compares attachment metadata, including a previously imported source link
 * @param imported - Validated JSON input
 * @param record - Incoming attachment projection
 * @param current - Current metadata
 * @param rememberedId - Verified mapping from this browser's prior merge
 * @returns Whether the supported attachment representation already matches
 */
export function attachmentMatches(
  imported: ImportedBoard,
  record: MergeRecord,
  current: MergeRecord,
  rememberedId?: string,
): boolean {
  const source = imported.snapshot.attachments.find((item) => item.id === record.sourceId);
  const incoming = record.fields[MergeField.Content];
  const existing = current.fields[MergeField.Content];
  if (
    !source ||
    !incoming ||
    typeof incoming !== 'object' ||
    Array.isArray(incoming) ||
    !existing ||
    typeof existing !== 'object' ||
    Array.isArray(existing)
  )
    return false;
  let expected = { ...incoming };
  const actual = { ...existing };
  if (
    rememberedId === current.sourceId &&
    source.kind === AttachmentKind.Upload &&
    source.url &&
    existing.kind === AttachmentKind.Link
  )
    expected = {
      name: source.name,
      kind: AttachmentKind.Link,
      size: null,
      mimeType: null,
      url: source.url,
    };
  if (expected.mimeType === null) {
    delete expected.mimeType;
    delete actual.mimeType;
  }
  return canonical(expected) === canonical(actual);
}
