import { TestBoardApi } from '../api/client';
import { Transport } from '../api/transport';
import { HttpMethod } from '../api/types';
import type { ClientOptions, RequestOptions } from '../api/types';
import { isId, isRecord } from '../api/validation';
import { ScopeError } from '../api/errors';
import { serviceUrls } from '../config/services';
import { RestoreError, RestoreErrorCode, RestoreResource } from './codes';
import type { RestoreContext, RestoreTarget } from './types';

/** Verifies the SDK board and active parent ownership independently of write payloads */
export class RestoreScope {
  readonly #transport: Transport;
  readonly #source: TestBoardApi;
  #target: RestoreTarget | null = null;

  /**
   * Binds read dependencies to one explicitly configured board
   * @param options - Trusted board reference, token provider, and HTTP dependencies
   */
  constructor(options: ClientOptions) {
    this.#transport = new Transport(options);
    this.#source = new TestBoardApi(options);
  }

  /**
   * Exposes verified metadata without transferring ownership of the selected target
   * @returns A copy of the current destination
   * @throws RestoreError before a target has been verified
   */
  get target(): RestoreTarget {
    return { ...this.#requireTarget() };
  }
  /**
   * Verifies the current SDK board and its Workspace without enumerating other boards
   * @param boardId - Canonical identity from the SDK, never the snapshot
   * @param options - Optional cancellation
   * @returns Verified destination context
   * @throws ScopeError for an identity mismatch; propagates API and cancellation failures
   */
  async context(boardId: string, options: RequestOptions = {}): Promise<RestoreContext> {
    await this.#source.verifyBoard({ contextBoardId: boardId, ...options });
    const board = await this.#board(boardId, options);
    if (board.id !== boardId || !isId(board.idOrganization) || board.closed !== false)
      throw new ScopeError();
    const organization = board.organization;
    const workspaceName =
      isRecord(organization) &&
      organization.id === board.idOrganization &&
      typeof organization.displayName === 'string'
        ? organization.displayName
        : board.idOrganization;
    return { boardId, workspaceId: board.idOrganization, workspaceName };
  }
  /**
   * Selects only the existing board verified by the current context
   * @param context - Fresh SDK-bound destination context
   * @param options - Optional cancellation
   * @returns Current board metadata for progress and reports
   * @throws ScopeError when board identity or Workspace changed
   */
  async selectTarget(
    context: RestoreContext,
    options: RequestOptions = {},
  ): Promise<RestoreTarget> {
    await this.#source.verifyBoard({ contextBoardId: context.boardId, ...options });
    const board = await this.#board(context.boardId, options);
    if (
      board.id !== context.boardId ||
      board.idOrganization !== context.workspaceId ||
      board.closed !== false ||
      typeof board.name !== 'string' ||
      typeof board.shortLink !== 'string' ||
      !/^[a-zA-Z0-9]{8}$/.test(board.shortLink)
    )
      throw new ScopeError();
    this.#target = {
      id: context.boardId,
      name: board.name,
      workspaceId: context.workspaceId,
      url: `${serviceUrls.trelloBoardOrigin}/b/${board.shortLink}`,
    };
    return { ...this.#target };
  }
  /**
   * Rechecks that the selected current board remains active in the same Workspace
   * @param options - Optional cancellation
   * @returns Verified current board fields
   * @throws ScopeError when the destination changed; RestoreError before selection
   */
  async verifyTarget(options: RequestOptions = {}): Promise<Record<string, unknown>> {
    const target = this.#requireTarget();
    const board = await this.#board(target.id, options);
    if (
      board.id !== target.id ||
      board.idOrganization !== target.workspaceId ||
      board.closed !== false
    )
      throw new ScopeError();
    return board;
  }
  /**
   * Verifies a selected active parent before it can receive content
   * @param resource - Board-owned entity kind
   * @param id - Current target identity
   * @param options - Optional cancellation
   * @returns Current API fields
   * @throws RestoreError before target selection; ScopeError for malformed, archived, or foreign parents
   */
  async verifyEntity(
    resource: RestoreResource,
    id: string,
    options: RequestOptions = {},
  ): Promise<Record<string, unknown>> {
    if (
      !isId(id) ||
      ![
        RestoreResource.Card,
        RestoreResource.List,
        RestoreResource.Label,
        RestoreResource.Checklist,
      ].includes(resource)
    )
      throw new ScopeError();
    const targetId = this.#requireTarget().id;
    const value = await this.#transport.request(HttpMethod.Get, `/${resource}/${id}`, options);
    if (!isRecord(value) || value.id !== id) throw new ScopeError();
    const boardId = value.idBoard;
    if (
      boardId !== targetId ||
      ([RestoreResource.Card, RestoreResource.List].includes(resource) && value.closed !== false)
    )
      throw new ScopeError();
    if (resource === RestoreResource.Card) {
      if (!isId(value.idList)) throw new ScopeError();
      await this.verifyEntity(RestoreResource.List, value.idList, options);
    }
    if (resource === RestoreResource.Checklist) {
      if (!isId(value.idCard)) throw new ScopeError();
      await this.verifyEntity(RestoreResource.Card, value.idCard, options);
    }
    return value;
  }
  /**
   * Verifies an item through its owning current-board checklist
   * @param resource - Supported nested identity kind
   * @param parent - Mapped current-board parent
   * @param id - Nested target identity
   * @param options - Optional cancellation
   * @returns The validated nested response
   * @throws RestoreError before target selection; ScopeError for mismatched parent or nested identity
   */
  async verifyNested(
    resource: RestoreResource,
    parent: string,
    id: string,
    options: RequestOptions = {},
  ): Promise<Record<string, unknown>> {
    if (!isId(id)) throw new ScopeError();
    const kind = RestoreResource.Checklist;
    if (resource !== RestoreResource.Item) throw new ScopeError();
    await this.verifyEntity(kind, parent, options);
    const value = await this.#transport.request(
      HttpMethod.Get,
      `/${kind}/${parent}/${resource}/${id}`,
      options,
    );
    if (!isRecord(value) || value.id !== id) throw new ScopeError();
    return value;
  }
  async #board(id: string, options: RequestOptions): Promise<Record<string, unknown>> {
    if (!isId(id)) throw new ScopeError();
    const value = await this.#transport.request(HttpMethod.Get, `/boards/${id}`, {
      query: {
        fields: 'id,name,desc,shortLink,idOrganization,closed',
        organization: 'true',
        organization_fields: 'id,displayName',
      },
      ...options,
    });
    if (!isRecord(value)) throw new ScopeError();
    return value;
  }
  #requireTarget(): RestoreTarget {
    if (!this.#target) throw new RestoreError(RestoreErrorCode.InvalidTarget);
    return this.#target;
  }
}
