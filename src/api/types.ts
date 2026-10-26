export enum HttpMethod {
  Get = 'GET',
  Post = 'POST',
  Put = 'PUT',
}
export enum CheckItemState {
  Complete = 'complete',
  Incomplete = 'incomplete',
}
export enum TrelloActionType {
  Comment = 'commentCard',
}

export interface BoardSummary {
  id: string;
  shortLink: string;
  name: string;
  closed: boolean;
}

export interface BoardList {
  id: string;
  idBoard: string;
  name: string;
  closed: boolean;
  pos: number;
}

export interface TestCard {
  id: string;
  idBoard: string;
  idList: string;
}

export interface RequestOptions {
  signal?: AbortSignal | undefined;
}

/** Injectable Web API boundaries, shared by browser runtime and offline tests */
export interface ClientOptions {
  boardReference: string;
  getAccessToken: () => Promise<string | null | undefined>;
  attachmentAuth?: {
    appKey: string;
    getToken: () => Promise<string | null | undefined>;
  };
  fetchImpl?: typeof fetch;
  pauseImpl?: (ms: number, signal?: AbortSignal) => Promise<void>;
  writesEnabled?: boolean;
}
