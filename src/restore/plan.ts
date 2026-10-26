import { AttachmentKind, CaptureOutcome } from '../snapshot/codes';
import type { ImportedBoard } from '../import/read';
import { RestoreResource, RestoreWarning } from './codes';
import type { Snapshot } from '../snapshot/types';

/**
 * Lists legacy custom-field records excluded from current-board writes
 * @param snapshot - Validated input, including legacy field collections
 * @returns Stable source keys for explicit omissions in the operation report
 */
export function excludedFieldRecords(snapshot: Snapshot): string[] {
  return [
    ...snapshot.customFields.map((field) => `${RestoreResource.Field}/${field.id}`),
    ...snapshot.customFields.flatMap((field) =>
      field.options.map((option) => `${RestoreResource.Option}/${option.id}`),
    ),
    ...snapshot.customFieldValues.map(
      (value) => `${RestoreResource.Value}/${value.cardId}-${value.fieldId}`,
    ),
  ];
}

export interface RestorePlan {
  lists: number;
  cards: number;
  items: number;
  files: number;
  warnings: RestoreWarning[];
}

/**
 * Previews the restoration scope and intentional fidelity limits without network access
 * @param imported - Fully validated local export
 * @returns Object counts and explicit omissions to review before current-board merging
 */
export function restorationPlan(imported: ImportedBoard): RestorePlan {
  const { snapshot } = imported;
  const warnings: RestoreWarning[] = [];
  if (excludedFieldRecords(snapshot).length) warnings.push(RestoreWarning.CustomFields);
  if (snapshot.capture.outcome === CaptureOutcome.Partial)
    warnings.push(RestoreWarning.SourcePartial);
  if (snapshot.cards.some((card) => card.memberIds.length)) warnings.push(RestoreWarning.Members);
  if (snapshot.cards.some((card) => card.cover)) warnings.push(RestoreWarning.Covers);
  if (snapshot.checklistItems.some((item) => item.memberId))
    warnings.push(RestoreWarning.AdvancedItems);
  if (
    snapshot.attachments.some(
      (attachment) => !attachment.file && attachment.kind === AttachmentKind.Upload,
    )
  )
    warnings.push(RestoreWarning.MissingFiles);
  if (snapshot.comments.length) warnings.push(RestoreWarning.CommentSummary);
  return {
    lists: snapshot.lists.length,
    cards: snapshot.cards.length,
    items: snapshot.checklistItems.length,
    files: imported.files.size,
    warnings,
  };
}
