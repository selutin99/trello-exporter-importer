import { RestoreError, RestoreErrorCode, RestoreResource } from '../codes';
import { CheckItemState } from '../../api/types';
import { MergeActionKind, MergeField } from './types';
import type { MergeAction, MergeRecord, MergeValue } from './types';

/**
 * Resolves tagged references into verified current-board IDs for a write payload
 * @param value - Internally projected JSON
 * @param bindings - Current source-to-target identities
 * @param required - Whether every reference must have an explicit mapping
 * @returns Literal values with actual target IDs
 * @throws RestoreError for a required missing parent or option
 */
export function writeValue(
  value: MergeValue,
  bindings: Record<string, string>,
  required = true,
): MergeValue {
  if (Array.isArray(value)) return value.map((item) => writeValue(item, bindings, required));
  if (value !== null && typeof value === 'object') {
    if (typeof value.ref === 'string') {
      const id = bindings[value.ref];
      if (!id && required) throw new RestoreError(RestoreErrorCode.InvalidPlan);
      return id ?? value.ref.slice(value.ref.indexOf('/') + 1);
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, writeValue(item, bindings, required)]),
    );
  }
  return value;
}

/**
 * Maps a reviewed domain field to a supported Trello update property
 * @param action - Selected single-field difference
 * @param bindings - Verified source-to-target mappings
 * @returns A narrow update and its reviewed old value
 * @throws RestoreError for unsupported field updates
 */
export function updatePayload(
  action: MergeAction & { kind: MergeActionKind.Update },
  bindings: Record<string, string>,
): {
  body: Record<string, unknown>;
  expected: Record<string, unknown>;
} {
  const names = new Map<MergeField, string>([
    [MergeField.Name, 'name'],
    [MergeField.Description, 'desc'],
    [MergeField.Parent, 'idList'],
    [MergeField.Labels, 'idLabels'],
    [MergeField.Start, 'start'],
    [MergeField.Due, 'due'],
    [MergeField.Complete, 'dueComplete'],
    [MergeField.Checked, 'state'],
    [MergeField.Color, 'color'],
  ]);
  const property = names.get(action.field);
  if (!property) throw new RestoreError(RestoreErrorCode.InvalidPlan);
  const incoming = writeValue(action.after, bindings);
  const current = writeValue(action.before, {}, false);
  const state = (value: MergeValue) =>
    value ? CheckItemState.Complete : CheckItemState.Incomplete;
  return {
    body: { [property]: action.field === MergeField.Checked ? state(incoming) : incoming },
    expected: { [property]: action.field === MergeField.Checked ? state(current) : current },
  };
}

/**
 * Builds a missing entity using only known writable properties and mapped parents
 * @param record - Incoming entity projection
 * @param parentId - Verified mapped parent
 * @param bindings - Current identity mappings
 * @returns Narrow create payload
 * @throws RestoreError for an unsupported create resource
 */
export function createPayload(
  record: MergeRecord,
  parentId: string,
  bindings: Record<string, string>,
): Record<string, unknown> {
  const fields = record.fields;
  const name = fields[MergeField.Name];
  switch (record.resource) {
    case RestoreResource.List:
    case RestoreResource.Checklist:
      return { name, pos: 'bottom' };
    case RestoreResource.Label:
      return { name, color: fields[MergeField.Color] };
    case RestoreResource.Card:
      return {
        idList: parentId,
        name,
        desc: fields[MergeField.Description],
        pos: 'bottom',
        start: fields[MergeField.Start],
        due: fields[MergeField.Due],
        dueComplete: fields[MergeField.Complete],
        idLabels: writeValue(fields[MergeField.Labels] ?? [], bindings),
      };
    case RestoreResource.Item:
      return {
        name,
        checked: fields[MergeField.Checked],
        pos: 'bottom',
        ...(MergeField.Due in fields ? { due: fields[MergeField.Due] } : {}),
      };
    default:
      throw new RestoreError(RestoreErrorCode.InvalidPlan);
  }
}
