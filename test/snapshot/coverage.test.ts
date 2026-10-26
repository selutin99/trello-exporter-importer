import { expect, test } from 'vitest';
import { finishCapture } from '../../src/snapshot/coverage';
import {
  CaptureOutcome,
  CoverageStatus,
  IssueCode,
  SnapshotSection,
} from '../../src/snapshot/codes';
import { issue } from '../../src/snapshot/normalize';
import { createSyntheticCapture } from '../helpers/board-capture';

test('fresh section counts reflect current records while file coverage stays explicitly excluded', () => {
  const { snapshot } = createSyntheticCapture();
  snapshot.cards = [];
  finishCapture(snapshot);
  expect(snapshot.coverage.cards).toEqual({ status: CoverageStatus.Complete, count: 0 });
  expect(snapshot.coverage.board).toEqual({ status: CoverageStatus.Complete, count: 1 });
  expect(snapshot.coverage.attachmentFiles).toEqual({ status: CoverageStatus.Excluded, count: 0 });
  expect(snapshot.capture.outcome).toBe(CaptureOutcome.Complete);
});

test.each([
  [SnapshotSection.Checklists, SnapshotSection.ChecklistItems],
  [SnapshotSection.CustomFields, SnapshotSection.CustomFieldValues],
] as const)(
  'an unavailable %s section also marks its %s dependent content as partial',
  (parent, child) => {
    const { snapshot } = createSyntheticCapture();
    snapshot.issues.push(issue(IssueCode.SectionUnavailable, parent, null));
    finishCapture(snapshot);
    expect(snapshot.coverage[parent]?.status).toBe(CoverageStatus.Partial);
    expect(snapshot.coverage[child]?.status).toBe(CoverageStatus.Partial);
    expect(snapshot.coverage.lists?.status).toBe(CoverageStatus.Complete);
    expect(snapshot.capture.outcome).toBe(CaptureOutcome.Partial);
  },
);

test('finalization excludes file coverage and reports an unverifiable board', () => {
  const { snapshot } = createSyntheticCapture();
  snapshot.coverage.attachmentFiles = { status: CoverageStatus.Partial, count: 1 };
  snapshot.issues.push(issue(IssueCode.BoardChanged, SnapshotSection.Board, snapshot.board.id));
  finishCapture(snapshot);
  expect(snapshot.coverage.attachmentFiles).toEqual({ status: CoverageStatus.Excluded, count: 0 });
  expect(snapshot.coverage.board?.status).toBe(CoverageStatus.Partial);
  expect(snapshot.capture.outcome).toBe(CaptureOutcome.Partial);
});
