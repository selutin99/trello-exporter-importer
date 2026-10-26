import type { Snapshot } from '../snapshot/types';
import { sha256 } from '../snapshot/encoding';
import { ImportError, ImportErrorCode } from './codes';
import { parseSnapshot } from './schema';

export const MAXIMUM_IMPORT_BYTES = 16 * 1024 * 1024;

export interface ImportedBoard {
  snapshot: Snapshot;
  checksum: string;
}

/**
 * Opens and validates a project JSON snapshot before any board access
 * @param file - User-selected local JSON export
 * @param signal - Optional cancellation signal
 * @returns Validated board content and input checksum
 * @throws ImportError for oversized inputs, invalid JSON, unsupported snapshots, or invalid references
 * @throws The signal reason on cancellation
 */
export async function readImport(file: Blob, signal?: AbortSignal): Promise<ImportedBoard> {
  signal?.throwIfAborted();
  if (file.size > MAXIMUM_IMPORT_BYTES) throw new ImportError(ImportErrorCode.LimitExceeded);
  const bytes = new Uint8Array(await file.arrayBuffer());
  signal?.throwIfAborted();
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new ImportError(ImportErrorCode.InvalidSnapshot);
  }
  const snapshot = parseSnapshot(value);
  const checksum = await sha256(bytes);
  signal?.throwIfAborted();
  return { snapshot, checksum };
}
