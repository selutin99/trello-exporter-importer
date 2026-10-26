import { textChunks } from '../../shared/text';
import { RestoreError, RestoreErrorCode, RestoreResource, RestoreWarning } from '../codes';
import { attributedComment } from '../comments';
import type { RestoreExecution } from '../types';
import { MergeActionKind } from './types';
import type { MergeAction } from './types';
import { createPayload, updatePayload } from './writes';

const optional = new Set([RestoreResource.Comment, RestoreResource.Attachment]);

/**
 * Executes selected content changes without a board-creation or deletion path
 * @param execution - Validated current-board plan and durable checkpoints
 * @returns Completion of all selected writes or an explicit optional omission
 * @throws Propagates stale-plan, ownership, storage, cancellation, and unknown-write failures
 */
export async function executeMerge(execution: RestoreExecution): Promise<void> {
  for (const action of execution.plan.actions) {
    execution.options.signal?.throwIfAborted();
    if (!parentsAvailable(action, execution)) {
      omit(action, execution);
      continue;
    }
    if (action.record.resource === RestoreResource.Comment) {
      await comments(action, execution);
      continue;
    }
    const attempt = () => apply(action, execution);
    const sourceId = action.key;
    const id = optional.has(action.record.resource)
      ? await execution.checkpoint.optionalStep(action.record.resource, sourceId, attempt)
      : await execution.checkpoint.step(action.record.resource, sourceId, attempt);
    if (id !== null) {
      execution.journal.bindings[action.record.key] = id;
      execution.checkpoint.save();
    } else {
      omit(action, execution);
    }
  }
}
function parentsAvailable(action: MergeAction, execution: RestoreExecution): boolean {
  const bindings = execution.journal.bindings;
  if (action.record.parent && !bindings[action.record.parent]) return false;
  if (action.record.resource === RestoreResource.Attachment) {
    const source = execution.imported.snapshot.attachments.find(
      (item) => item.id === action.record.sourceId,
    );
    return !!source?.url;
  }
  return true;
}
function omit(action: MergeAction, execution: RestoreExecution): void {
  const key = `${action.record.resource}/${action.key}`;
  if (!execution.journal.skipped.includes(key)) execution.journal.skipped.push(key);
  if (!execution.journal.warnings.includes(RestoreWarning.Unsupported))
    execution.journal.warnings.push(RestoreWarning.Unsupported);
  // A rejected copy cannot satisfy references with the old, explicitly rejected option.
  delete execution.journal.bindings[action.record.key];
  execution.checkpoint.save();
}
async function apply(action: MergeAction, execution: RestoreExecution): Promise<string> {
  const { api, journal, options } = execution;
  const bindings = journal.bindings;
  const record = action.record;
  const parent = record.parent ? bindings[record.parent] : execution.target.id;
  if (!parent) throw new RestoreError(RestoreErrorCode.InvalidPlan);
  const request = { signal: options.signal };
  if (record.resource === RestoreResource.Attachment) return attachment(action, parent, execution);
  if (action.kind !== MergeActionKind.Update)
    return api.create(record.resource, parent, createPayload(record, parent, bindings), request);
  const { body, expected } = updatePayload(action, bindings);
  if (record.resource === RestoreResource.Item)
    await api.item(parent, action.targetId, body, expected, request);
  else await api.update(record.resource, action.targetId, body, expected, request);
  return action.targetId;
}
async function attachment(
  action: MergeAction,
  parent: string,
  execution: RestoreExecution,
): Promise<string> {
  const source = execution.imported.snapshot.attachments.find(
    (item) => item.id === action.record.sourceId,
  );
  if (!source) throw new RestoreError(RestoreErrorCode.InvalidPlan);

  if (!source.url) throw new RestoreError(RestoreErrorCode.InvalidPlan);
  const body = { name: source.name, url: source.url };
  return execution.api.create(RestoreResource.Attachment, parent, body, {
    signal: execution.options.signal,
  });
}
async function comments(action: MergeAction, execution: RestoreExecution): Promise<void> {
  const { journal, checkpoint, options } = execution;
  const operationKey = `${RestoreResource.Comment}/${action.key}`;
  if (journal.completed[operationKey] || journal.skipped.includes(operationKey)) return;
  const source = execution.imported.snapshot.comments.find(
    (comment) => comment.id === action.record.sourceId,
  );
  const parent = journal.bindings[action.record.parent ?? ''];
  if (!source || !parent) throw new RestoreError(RestoreErrorCode.InvalidPlan);
  const parts: string[] = [];
  for (const [index, text] of textChunks(
    attributedComment(source, options.locale),
    10_000,
  ).entries()) {
    const id = await checkpoint.optionalStep(
      RestoreResource.Comment,
      `${action.key}/part/${index}`,
      () =>
        execution.api.create(RestoreResource.Comment, parent, { text }, { signal: options.signal }),
    );
    if (id === null) {
      omit(action, execution);
      return;
    }
    parts.push(id);
  }
  const first = parts[0];
  if (!first) throw new RestoreError(RestoreErrorCode.InvalidPlan);
  journal.completed[operationKey] = first;
  journal.bindings[action.record.key] = first;
  journal.commentParts[action.record.key] = parts;
  checkpoint.save();
}
