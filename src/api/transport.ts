import { HttpMethod } from './types';
import { ApiErrorCode } from '../shared/error-codes';
import { serviceUrls } from '../config/services';
import { waitForOperation } from '../core/operation';
import { ApiError } from './errors';
import { pause, retryDelay } from './retry';
import type { ClientOptions, RequestOptions } from './types';

interface TransportOptions extends RequestOptions {
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}

/** Internal transport. Callers use the board-scoped facade, never arbitrary endpoints */
export class Transport {
  /**
   * Creates internal transport with injectable browser boundaries
   * @param options - Token provider, HTTP implementation, and retry timer
   */
  constructor(private readonly options: ClientOptions) {}

  /**
   * Reads JSON or performs one creating request without retrying uncertain writes
   * @param method - HTTP method selected by the scoped client
   * @param path - Fixed API path constructed by the scoped client
   * @param options - Query fields, optional request body, and cancellation signal
   * @returns Parsed response data for subsequent domain validation
   * @throws ApiError for failures or unobserved dispatched writes; the signal reason for cancelled reads or cancellation before dispatch
   */
  async request(
    method: HttpMethod,
    path: string,
    options: TransportOptions = {},
  ): Promise<unknown> {
    const response = await this.#response(method, path, options);
    return readJson(response, method, options.signal);
  }

  async #response(method: HttpMethod, path: string, options: TransportOptions): Promise<Response> {
    const url = new URL(`${serviceUrls.trelloApi}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {}))
      url.searchParams.set(key, value);
    const attempts = method === HttpMethod.Get ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const response = await this.#send(method, url, options);
      if (method === HttpMethod.Get) options.signal?.throwIfAborted();
      if (response.ok) return response;
      const canRetry =
        method === HttpMethod.Get &&
        [429, 502, 503, 504].includes(response.status) &&
        attempt + 1 < attempts;
      if (!canRetry) throw responseError(response.status, method);
      await (this.options.pauseImpl ?? pause)(retryDelay(response, attempt), options.signal);
    }
    throw new ApiError(ApiErrorCode.RequestFailed);
  }

  async #token(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    let token: string | null | undefined;
    try {
      const pending = this.options.getAccessToken();
      token = signal ? await waitForOperation(pending, signal) : await pending;
    } catch {
      signal?.throwIfAborted();
      throw new ApiError(ApiErrorCode.AuthRequired);
    }
    signal?.throwIfAborted();
    if (typeof token !== 'string' || !token) throw new ApiError(ApiErrorCode.AuthRequired);
    return token;
  }

  async #send(method: HttpMethod, url: URL, { body, signal }: TransportOptions): Promise<Response> {
    const token = await this.#token(signal);
    signal?.throwIfAborted();
    try {
      // Web APIs require their original receiver, not this Transport instance.
      const fetchRequest = this.options.fetchImpl ?? fetch;
      return await fetchRequest(url.href, {
        method,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        ...(signal ? { signal } : {}),
      });
    } catch {
      if (method === HttpMethod.Get) signal?.throwIfAborted();
      throw new ApiError(
        method === HttpMethod.Get ? ApiErrorCode.NetworkError : ApiErrorCode.WriteResultUnknown,
      );
    }
  }
}

async function readJson(
  response: Response,
  method: HttpMethod,
  signal?: AbortSignal,
): Promise<unknown> {
  try {
    const value: unknown = await response.json();
    if (method === HttpMethod.Get) signal?.throwIfAborted();
    return value;
  } catch {
    if (method === HttpMethod.Get) signal?.throwIfAborted();
    throw new ApiError(
      method === HttpMethod.Get ? ApiErrorCode.InvalidResponse : ApiErrorCode.WriteResultUnknown,
    );
  }
}

function responseError(status: number, method: HttpMethod): ApiError {
  if (method !== HttpMethod.Get && (status >= 500 || status === 408))
    return new ApiError(ApiErrorCode.WriteResultUnknown, status, method);
  if (status === 401) return new ApiError(ApiErrorCode.AuthRequired, status, method);
  return new ApiError(ApiErrorCode.RequestFailed, status, method);
}
