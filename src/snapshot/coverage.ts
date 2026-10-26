import { snapshotCollections } from './collections';
import { CaptureOutcome, CoverageStatus, SnapshotSection } from './codes';
import type { Snapshot } from './types';

/**
 * Updates section counts and completeness after content capture
 * @param snapshot - Capture to finalize while explicitly excluding attachment bytes
 */
export function finishCapture(snapshot: Snapshot): void {
  const incomplete = new Set(snapshot.issues.map((item) => item.entityType));
  if (incomplete.has(SnapshotSection.Checklists)) incomplete.add(SnapshotSection.ChecklistItems);
  if (incomplete.has(SnapshotSection.CustomFields))
    incomplete.add(SnapshotSection.CustomFieldValues);
  for (const section of snapshotCollections) {
    const excluded =
      snapshot.coverage[section]?.status === CoverageStatus.Excluded &&
      snapshot[section].length === 0 &&
      !incomplete.has(section);
    let status = incomplete.has(section) ? CoverageStatus.Partial : CoverageStatus.Complete;
    if (excluded) status = CoverageStatus.Excluded;
    snapshot.coverage[section] = {
      status,
      count: snapshot[section].length,
    };
  }
  snapshot.coverage[SnapshotSection.Board] = {
    status: incomplete.has(SnapshotSection.Board)
      ? CoverageStatus.Partial
      : CoverageStatus.Complete,
    count: 1,
  };
  snapshot.coverage[SnapshotSection.AttachmentFiles] = {
    status: CoverageStatus.Excluded,
    count: 0,
  };
  snapshot.capture.completedAt = new Date().toISOString();
  snapshot.capture.outcome = snapshot.issues.length
    ? CaptureOutcome.Partial
    : CaptureOutcome.Complete;
}
