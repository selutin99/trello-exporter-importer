import type { RequestOptions } from '../api/types';
import type { Snapshot } from '../snapshot/types';
import type { RestoreResource } from './codes';

export interface RestoreTarget {
  id: string;
  name: string;
  workspaceId: string;
  url: string;
}
export interface RestoreContext {
  boardId: string;
  workspaceId: string;
  workspaceName: string;
}
/** Current-board I/O contract, independent of the HTTP implementation */
export interface RestoreWriter {
  /**
   * Selects the existing board verified by the live context
   * @param context - SDK-bound destination
   * @param options - Optional cancellation
   * @returns Verified destination metadata
   * @throws Ownership, API, and cancellation failures
   */
  selectTarget(context: RestoreContext, options?: RequestOptions): Promise<RestoreTarget>;
  /**
   * Captures active content without downloading attachment bytes
   * @param context - SDK-bound destination
   * @param options - Optional cancellation
   * @returns Normalized current content
   * @throws Ownership, API, and cancellation failures
   */
  snapshot(context: RestoreContext, options?: RequestOptions): Promise<Snapshot>;
  /**
   * Rechecks the selected board before further writes
   * @param options - Optional cancellation
   * @returns Completion after ownership verification
   * @throws Ownership, API, and cancellation failures
   */
  verifyTarget(options?: RequestOptions): Promise<void>;
  /**
   * Creates one child after verifying its current-board parent
   * @param resource - Supported child collection
   * @param parentId - Mapped parent identity
   * @param body - Allowlisted content or attachment bytes
   * @param options - Optional cancellation
   * @returns Confirmed created identity
   * @throws Ownership, payload, API, cancellation, or unknown-write failures
   */
  create(
    resource: RestoreResource,
    parentId: string,
    body: Record<string, unknown> | FormData,
    options?: RequestOptions,
  ): Promise<string>;
  /**
   * Verifies an active board-owned entity
   * @param resource - Entity kind
   * @param id - Current identity
   * @param options - Optional cancellation
   * @returns Verified API fields
   * @throws Ownership, API, and cancellation failures
   */
  verifyEntity(
    resource: RestoreResource,
    id: string,
    options?: RequestOptions,
  ): Promise<Record<string, unknown>>;
  /**
   * Verifies a nested item through its current-board parent
   * @param resource - Checklist item
   * @param parent - Owning checklist
   * @param id - Nested identity
   * @param options - Optional cancellation
   * @returns Verified nested fields
   * @throws Ownership, API, and cancellation failures
   */
  verifyNested(
    resource: RestoreResource,
    parent: string,
    id: string,
    options?: RequestOptions,
  ): Promise<Record<string, unknown>>;
  /**
   * Applies selected fields after checking their reviewed values
   * @param resource - Mutable entity kind
   * @param id - Current identity
   * @param body - Selected updates
   * @param expected - Reviewed old values
   * @param options - Optional cancellation
   * @returns Completion after a confirmed write
   * @throws Ownership, stale-plan, API, cancellation, or unknown-write failures
   */
  update(
    resource: RestoreResource,
    id: string,
    body: Record<string, unknown>,
    expected: Record<string, unknown>,
    options?: RequestOptions,
  ): Promise<void>;
  /**
   * Updates one item through its verified checklist and card
   * @param checklistId - Owning checklist
   * @param itemId - Current item
   * @param body - Selected updates
   * @param expected - Reviewed old values
   * @param options - Optional cancellation
   * @returns Completion after a confirmed write
   * @throws Ownership, stale-plan, API, cancellation, or unknown-write failures
   */
  item(
    checklistId: string,
    itemId: string,
    body: Record<string, unknown>,
    expected: Record<string, unknown>,
    options?: RequestOptions,
  ): Promise<void>;
}
