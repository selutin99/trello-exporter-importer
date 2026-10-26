import { ScopeError } from '../api/errors';
import { canonicalJson } from '../shared/json';
import { RestoreError, RestoreErrorCode, RestoreResource } from './codes';

const createFields = new Map<RestoreResource, readonly string[]>([
  [RestoreResource.List, ['name', 'pos']],
  [RestoreResource.Label, ['name', 'color']],
  [
    RestoreResource.Card,
    ['idList', 'name', 'desc', 'pos', 'start', 'due', 'dueComplete', 'idLabels'],
  ],
  [RestoreResource.Checklist, ['name', 'pos']],
  [RestoreResource.Item, ['name', 'checked', 'pos', 'due']],
  [RestoreResource.Comment, ['text']],
  [RestoreResource.Attachment, ['name', 'url']],
]);
const updateFields = new Map<RestoreResource, readonly string[]>([
  [RestoreResource.Board, ['desc']],
  [RestoreResource.List, ['name']],
  [RestoreResource.Label, ['name', 'color']],
  [RestoreResource.Card, ['name', 'desc', 'idList', 'idLabels', 'start', 'due', 'dueComplete']],
  [RestoreResource.Checklist, ['name']],
  [RestoreResource.Item, ['name', 'state', 'due']],
]);

/**
 * Rejects properties outside the supported create contract and prevents parent overrides
 * @param resource - Supported child collection
 * @param parent - Verified current-board parent identity
 * @param body - Engine-produced JSON properties
 * @throws ScopeError for unsupported fields, form data, or a different parent
 */
export function assertCreatePayload(
  resource: RestoreResource,
  parent: string,
  body: Record<string, unknown>,
): void {
  if (body instanceof FormData) throw new ScopeError();
  if (
    !Object.keys(body).length ||
    Object.keys(body).some((key) => !createFields.get(resource)?.includes(key)) ||
    (resource === RestoreResource.Card && body.idList !== parent)
  )
    throw new ScopeError();
}
/**
 * Restricts a mutation to supported content fields without identity or access changes
 * @param resource - Mutable entity kind
 * @param body - Selected fields, without unrelated properties
 * @throws ScopeError for an empty mutation or unsupported property
 */
export function assertUpdatePayload(
  resource: RestoreResource,
  body: Record<string, unknown>,
): void {
  if (
    !Object.keys(body).length ||
    Object.keys(body).some((key) => !updateFields.get(resource)?.includes(key))
  )
    throw new ScopeError();
}

/**
 * Requires a reviewed old value for every update and compares it with the fresh response
 * @param current - Validated current-board response
 * @param body - Selected updates
 * @param expected - Reviewed old values, treating label assignments as a set
 * @throws ScopeError for an unreviewed field; RestoreError when the reviewed state changed
 */
export function assertExpectedValues(
  current: Record<string, unknown>,
  body: Record<string, unknown>,
  expected: Record<string, unknown>,
): void {
  if (Object.keys(body).some((key) => !Object.hasOwn(expected, key))) throw new ScopeError();
  for (const [key, value] of Object.entries(expected)) {
    const actual = current[key] ?? null;
    const normalize = (item: unknown) =>
      key === 'idLabels' && Array.isArray(item)
        ? item.map((entry: unknown) => canonicalJson(entry)).sort((a, b) => a.localeCompare(b))
        : item;
    if (canonicalJson(normalize(actual)) !== canonicalJson(normalize(value)))
      throw new RestoreError(RestoreErrorCode.PlanStale);
  }
}
