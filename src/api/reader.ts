import { z } from 'zod';
import { TestBoardApi } from './client';
import { TestBoardScope } from './scope';
import { Transport } from './transport';
import { ApiError, ScopeError } from './errors';
import { ApiErrorCode } from '../shared/error-codes';
import { isRecord } from './validation';
import { HttpMethod, TrelloActionType } from './types';
import type { ClientOptions, RequestOptions, BoardList } from './types';
import {
  attachmentSchema,
  boardSchema,
  cardSchema,
  checklistSchema,
  commentSchema,
  labelSchema,
  memberSchema,
  parseResponse,
} from './schemas';
import type {
  SourceBoard,
  SourceCard,
  SourceAttachment,
  SourceChecklist,
  SourceComment,
  SourceLabel,
  SourceMember,
} from './schemas';

/** Read-only content API restricted to one verified board and its discovered cards */
export class BoardReader {
  readonly #api: TestBoardApi;
  readonly #scope: TestBoardScope;
  readonly #transport: Transport;
  readonly #cards = new Set<string>();
  readonly #activeLists = new Set<string>();

  /**
   * Creates a board-scoped reader without write access
   * @param options - Selected board and injectable HTTP boundaries
   */
  constructor(options: ClientOptions) {
    this.#api = new TestBoardApi(options);
    this.#scope = new TestBoardScope(options.boardReference);
    this.#transport = new Transport(options);
  }

  /**
   * Verifies the configured board against the live Trello iframe context
   * @param contextBoardId - Board identity from the official SDK
   * @param options - Optional cancellation signal
   * @returns The board's current metadata
   * @throws ScopeError for a different board; ApiError for an unreadable board
   */
  async board(contextBoardId: string, options: RequestOptions = {}): Promise<SourceBoard> {
    await this.#api.verifyBoard({ contextBoardId, ...options });
    const board = parseResponse(
      boardSchema,
      await this.#transport.request(HttpMethod.Get, `/boards/${contextBoardId}`, {
        query: { fields: 'id,shortLink,name,desc,closed,dateLastActivity' },
        ...options,
      }),
    );
    this.#scope.bind(board, contextBoardId);
    return board;
  }

  /**
   * Reads active lists within the selected board
   * @param options - Optional cancellation signal
   * @returns Validated list metadata
   * @throws ScopeError before verification; ApiError on an invalid response
   */
  async lists(options: RequestOptions = {}): Promise<BoardList[]> {
    const lists = await this.#api.readLists(options);
    this.#activeLists.clear();
    lists.forEach((list) => this.#activeLists.add(list.id));
    this.#scope.rememberLists(lists);
    return lists;
  }

  /**
   * Reads cards, retaining an allowlist for subsequent card content requests
   * @param options - Optional cancellation signal
   * @returns Active cards in active lists, independent of Trello UI search filters
   * @throws ScopeError on foreign ownership; ApiError on invalid or repeated pages
   */
  async cards(options: RequestOptions = {}): Promise<SourceCard[]> {
    const cards = await this.#pages(
      `/boards/${this.#scope.boardId}/cards`,
      cardSchema,
      {
        filter: 'visible',
        fields:
          'id,idBoard,idList,name,desc,pos,closed,start,due,dueComplete,idLabels,idMembers,cover',
      },
      options,
    );
    for (const card of cards) {
      this.#scope.assertBoard(card.idBoard);
    }
    const active = cards.filter((card) => !card.closed && this.#activeLists.has(card.idList));
    this.#cards.clear();
    active.forEach((card) => this.#cards.add(card.id));
    return active;
  }

  /**
   * Reads labels with bounded pagination
   * @param options - Optional cancellation signal
   * @returns Board labels
   * @throws ApiError on invalid or repeated pages
   */
  async labels(options: RequestOptions = {}): Promise<SourceLabel[]> {
    return this.#pages(
      `/boards/${this.#scope.boardId}/labels`,
      labelSchema,
      { fields: 'id,name,color' },
      options,
    );
  }

  /**
   * Reads members without email addresses or account tokens
   * @param options - Optional cancellation signal
   * @returns Public member identity fields
   * @throws ApiError on invalid responses
   */
  async members(options: RequestOptions = {}): Promise<SourceMember[]> {
    return parseResponse(
      z.array(memberSchema),
      await this.#transport.request(HttpMethod.Get, `/boards/${this.#scope.boardId}/members`, {
        query: { fields: 'id,username,fullName' },
        ...options,
      }),
    );
  }

  /**
   * Reads attachment metadata without following external links
   * @param cardId - Previously discovered card identity
   * @param options - Optional cancellation signal
   * @returns Attachment metadata
   * @throws ScopeError for an unknown card; ApiError on unreadable content
   */
  async attachments(cardId: string, options: RequestOptions = {}): Promise<SourceAttachment[]> {
    const attachments = parseResponse(
      z.array(attachmentSchema),
      await this.#cardRequest(
        cardId,
        'attachments',
        { fields: 'id,name,fileName,isUpload,url,mimeType,bytes,pos' },
        options,
      ),
    );
    return attachments;
  }

  /**
   * Reads all checklists and their current items
   * @param cardId - Previously discovered card identity
   * @param options - Optional cancellation signal
   * @returns Checklists with validated parent identities
   * @throws ScopeError on a foreign checklist; ApiError on unreadable content
   */
  async checklists(cardId: string, options: RequestOptions = {}): Promise<SourceChecklist[]> {
    const lists = parseResponse(
      z.array(checklistSchema),
      await this.#cardRequest(
        cardId,
        'checklists',
        {
          checkItems: 'all',
          checkItem_fields: 'id,name,pos,state,due,idMember',
          fields: 'id,idCard,name,pos',
        },
        options,
      ),
    );
    if (lists.some((list) => list.idCard !== cardId)) throw new ScopeError();
    return lists;
  }

  /**
   * Reads current comments only, paginating beyond Trello's action page limit
   * @param cardId - Previously discovered card identity
   * @param options - Optional cancellation signal
   * @returns Comment actions without unrelated activity history
   * @throws ScopeError for foreign actions; ApiError for invalid pagination
   */
  async comments(cardId: string, options: RequestOptions = {}): Promise<SourceComment[]> {
    await this.#verifyCard(cardId, options);
    const comments = await this.#pages(
      `/cards/${cardId}/actions`,
      commentSchema,
      { filter: TrelloActionType.Comment, memberCreator_fields: 'id,fullName' },
      options,
    );
    for (const comment of comments) {
      this.#scope.assertBoard(comment.data.board.id);
      if (comment.data.card.id !== cardId) throw new ScopeError();
    }
    return comments;
  }

  #assertCard(cardId: string): void {
    if (!this.#cards.has(cardId)) throw new ScopeError();
  }

  async #verifyCard(cardId: string, options: RequestOptions): Promise<void> {
    this.#assertCard(cardId);
    const card = await this.#transport.request(HttpMethod.Get, `/cards/${cardId}`, {
      query: { fields: 'id,idBoard' },
      ...options,
    });
    if (!isRecord(card) || card.id !== cardId) throw new ScopeError();
    this.#scope.assertBoard(card.idBoard);
  }

  async #cardRequest(
    cardId: string,
    resource: string,
    query: Record<string, string>,
    options: RequestOptions,
  ): Promise<unknown> {
    await this.#verifyCard(cardId, options);
    return this.#transport.request(HttpMethod.Get, `/cards/${cardId}/${resource}`, {
      query,
      ...options,
    });
  }

  async #pages<T extends { id: string }>(
    path: string,
    schema: z.ZodType<T>,
    query: Record<string, string>,
    options: RequestOptions,
  ): Promise<T[]> {
    const result: T[] = [];
    const seen = new Set<string>();
    let before = '';
    for (;;) {
      const page = parseResponse(
        z.array(schema),
        await this.#transport.request(HttpMethod.Get, path, {
          query: { ...query, limit: '1000', ...(before ? { before } : {}) },
          ...options,
        }),
      );
      for (const item of page) {
        if (seen.has(item.id)) throw new ApiError(ApiErrorCode.InvalidResponse);
        seen.add(item.id);
      }
      result.push(...page);
      if (page.length < 1000) return result;
      before = page.reduce(
        (oldest, item) => (!oldest || item.id.localeCompare(oldest) < 0 ? item.id : oldest),
        '',
      );
    }
  }
}
