import { HttpMethod } from '../../src/api/types';
import { ApiErrorCode } from '../../src/shared/error-codes';
import { expect, test, vi } from 'vitest';
import { ApiError, TestBoardApi } from '../../src/api';
import { Transport } from '../../src/api/transport';
import { deferred } from '../helpers/deferred';

const board = { id: 'a'.repeat(24), shortLink: 'TEST0001', name: 'Synthetic', closed: false };
const ok = (value: unknown) => new Response(JSON.stringify(value));

test('file grants use classic headers only for binary requests while JSON keeps OAuth 2.0', async () => {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockImplementation(async (input) =>
      (input instanceof Request ? input.url : input.toString()).includes('/download/')
        ? new Response('file')
        : ok(board),
    );
  const transport = new Transport({
    boardReference: board.shortLink,
    getAccessToken: async () => 'synthetic-access',
    attachmentAuth: { appKey: 'public-key', getToken: async () => 'synthetic-file-token' },
    fetchImpl,
  });
  expect(
    await transport.download('/cards/scoped/attachments/scoped/download/original.txt', 4),
  ).toEqual(new TextEncoder().encode('file'));
  await transport.request(HttpMethod.Get, '/boards/scoped');
  const [download, metadata] = fetchImpl.mock.calls;
  expect(download?.[0]).toBe(
    'https://trello.com/1/cards/scoped/attachments/scoped/download/original.txt',
  );
  expect(download?.[1]).toMatchObject({
    credentials: 'omit',
    redirect: 'follow',
    headers: {
      Authorization: 'OAuth oauth_consumer_key="public-key", oauth_token="synthetic-file-token"',
      Accept: '*/*',
    },
  });
  expect(metadata?.[1]).toMatchObject({
    headers: { Authorization: 'Bearer synthetic-access' },
    redirect: 'error',
  });
  expect(download?.[0]).not.toContain('token');
});

test('missing file consent never falls back to a board bearer token', async () => {
  const fetchImpl = vi.fn<typeof fetch>();
  const getAccessToken = vi.fn(async () => 'synthetic-access');
  const transport = new Transport({
    boardReference: board.shortLink,
    getAccessToken,
    fetchImpl,
    attachmentAuth: { appKey: 'public-key', getToken: async () => null },
  });
  await expect(transport.download('/scoped-download', 10)).rejects.toMatchObject({
    code: ApiErrorCode.AuthRequired,
  });
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(getAccessToken).not.toHaveBeenCalled();
});

test('cancelling file-token acquisition prevents late dispatch and hides SDK details', async () => {
  const active = new AbortController();
  const token = deferred<string>();
  const fetchImpl = vi.fn<typeof fetch>();
  const transport = new Transport({
    boardReference: board.shortLink,
    fetchImpl,
    getAccessToken: async () => 'synthetic',
    attachmentAuth: { appKey: 'public-key', getToken: () => token.promise },
  });
  const request = transport.download('/scoped-download', 10, { signal: active.signal });
  active.abort();
  await expect(request).rejects.toBe(active.signal.reason);
  token.resolve('synthetic-private');
  expect(fetchImpl).not.toHaveBeenCalled();
  const failed = new Transport({
    boardReference: board.shortLink,
    fetchImpl,
    getAccessToken: async () => 'synthetic',
    attachmentAuth: {
      appKey: 'public-key',
      getToken: async () => {
        throw new Error('private-file-token');
      },
    },
  });
  await expect(failed.download('/scoped-download', 10)).rejects.toEqual(
    new ApiError(ApiErrorCode.AuthRequired),
  );
});

test.each(Object.values(HttpMethod))(
  'cancelling a pending token wait releases %s without dispatching a late request',
  async (method) => {
    const active = new AbortController();
    const token = deferred<string>();
    const fetchImpl = vi.fn<typeof fetch>();
    const transport = new Transport({
      boardReference: board.shortLink,
      fetchImpl,
      getAccessToken: () => token.promise,
    });
    const rejected = vi.fn();
    const request = transport.request(method, '/scoped-test', { signal: active.signal });
    void request.catch(rejected);
    active.abort();
    await vi.waitFor(() => expect(rejected).toHaveBeenCalledWith(active.signal.reason));
    token.resolve('synthetic');
    await expect(request).rejects.toBe(active.signal.reason);
    expect(fetchImpl).not.toHaveBeenCalled();
  },
);

test('a failed attachment stream becomes a safe download error and releases its lock', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error('private-download-detail'));
    },
  });
  const transport = new Transport({
    boardReference: board.shortLink,
    getAccessToken: async () => 'synthetic',
    fetchImpl: async () => new Response(stream),
  });
  await expect(transport.download('/scoped-test-download', 10)).rejects.toEqual(
    new ApiError(ApiErrorCode.NetworkError),
  );
  expect(stream.locked).toBe(false);
});

test('cancelling a pending attachment read cancels the source and releases its lock', async () => {
  const active = new AbortController();
  const cancel = vi.fn();
  const pull = vi.fn();
  const stream = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
  const transport = new Transport({
    boardReference: board.shortLink,
    getAccessToken: async () => 'synthetic',
    fetchImpl: async () => new Response(stream),
  });
  const request = transport.download('/scoped-test-download', 10, { signal: active.signal });
  const rejected = vi.fn();
  void request.catch(rejected);
  await vi.waitFor(() => expect(pull).toHaveBeenCalledOnce());
  active.abort();
  await vi.waitFor(() => expect(rejected).toHaveBeenCalledWith(active.signal.reason));
  expect(cancel).toHaveBeenCalledOnce();
  expect(stream.locked).toBe(false);
});

test('binary downloads enforce their byte budget and release the stream on failure', async () => {
  const transport = (response: Response) =>
    new Transport({
      boardReference: 'TEST0001',
      getAccessToken: async () => 'synthetic',
      fetchImpl: async () => response,
    });
  await expect(
    transport(new Response('oversized')).download('/scoped-test-download', 3),
  ).rejects.toMatchObject({ code: ApiErrorCode.InvalidResponse });
  await expect(
    transport(new Response(null)).download('/scoped-test-download', 3),
  ).rejects.toMatchObject({ code: ApiErrorCode.InvalidResponse });
  expect(await transport(new Response('abc')).download('/scoped-test-download', 3)).toEqual(
    new TextEncoder().encode('abc'),
  );
});

test('cancellation while acquiring a token prevents all HTTP requests', async () => {
  const controller = new AbortController();
  const fetchImpl = vi.fn<typeof fetch>();
  const client = new TestBoardApi({
    boardReference: board.shortLink,
    fetchImpl,
    getAccessToken: async () => {
      controller.abort();
      return 'synthetic';
    },
  });
  await expect(client.verifyBoard({ signal: controller.signal })).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(fetchImpl).not.toHaveBeenCalled();
});

test('SDK errors containing credentials become a fixed authentication error', async () => {
  const fetchImpl = vi.fn<typeof fetch>();
  const client = new TestBoardApi({
    boardReference: board.shortLink,
    fetchImpl,
    getAccessToken: async () => {
      throw new Error('https://example.invalid?code=synthetic-secret');
    },
  });
  await expect(client.verifyBoard()).rejects.toEqual(new ApiError(ApiErrorCode.AuthRequired));
  expect(fetchImpl).not.toHaveBeenCalled();
});

test('cancellation while reading the response body preserves AbortError', async () => {
  const controller = new AbortController();
  const response = ok(board);
  vi.spyOn(response, 'json').mockImplementation(async () => {
    controller.abort();
    throw new Error('body aborted');
  });
  const client = new TestBoardApi({
    boardReference: board.shortLink,
    getAccessToken: async () => 'synthetic',
    fetchImpl: async () => response,
  });
  await expect(client.verifyBoard({ signal: controller.signal })).rejects.toMatchObject({
    name: 'AbortError',
  });
});

test('retries stop after three GET attempts and never copy server error text', async () => {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response('synthetic-private-data', { status: 503 }));
  const pauseImpl = vi.fn(async () => {});
  const client = new TestBoardApi({
    boardReference: board.shortLink,
    getAccessToken: async () => 'synthetic',
    fetchImpl,
    pauseImpl,
  });
  await expect(client.verifyBoard()).rejects.toEqual(
    new ApiError(ApiErrorCode.RequestFailed, 503, HttpMethod.Get),
  );
  expect(fetchImpl).toHaveBeenCalledTimes(3);
  expect(pauseImpl.mock.calls).toHaveLength(2);
});

test('abort during retry backoff prevents a subsequent request', async () => {
  const controller = new AbortController();
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response('', { status: 429 }));
  const client = new TestBoardApi({
    boardReference: board.shortLink,
    getAccessToken: async () => 'synthetic',
    fetchImpl,
    pauseImpl: async () => {
      controller.abort();
    },
  });
  await expect(client.verifyBoard({ signal: controller.signal })).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('only validated board fields leave the API facade', async () => {
  const client = new TestBoardApi({
    boardReference: board.shortLink,
    getAccessToken: async () => 'synthetic',
    fetchImpl: async () => ok({ ...board, privateField: 'excluded' }),
  });
  expect(await client.verifyBoard()).toEqual(board);
});

test.each([null, {}, { ...board, closed: 'false' }, { ...board, name: null }])(
  'malformed board response cannot bind scope: %j',
  async (value) => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => ok(value));
    const client = new TestBoardApi({
      boardReference: board.shortLink,
      getAccessToken: async () => 'synthetic',
      fetchImpl,
    });
    await expect(client.verifyBoard()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(client.readLists()).rejects.toMatchObject({ code: 'BOARD_NOT_VERIFIED' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  },
);

test('a malformed successful POST is uncertain and is never retried', async () => {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(ok(board))
    .mockResolvedValueOnce(ok(null));
  const client = new TestBoardApi({
    boardReference: board.shortLink,
    getAccessToken: async () => 'synthetic',
    fetchImpl,
    writesEnabled: true,
  });
  await client.verifyBoard();
  await expect(client.createTestList()).rejects.toMatchObject({ code: 'WRITE_RESULT_UNKNOWN' });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

test('cancellation when the final binary read completes cannot return a successful download', async () => {
  const active = new AbortController();
  const response = new Response(
    new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          active.abort();
          controller.close();
        },
      },
      { highWaterMark: 0 },
    ),
  );
  const transport = new Transport({
    boardReference: board.shortLink,
    getAccessToken: async () => 'synthetic',
    fetchImpl: async () => response,
  });
  await expect(
    transport.download('/scoped-test-download', 10, { signal: active.signal }),
  ).rejects.toMatchObject({ name: 'AbortError' });
});

test.each([HttpMethod.Post, HttpMethod.Put])(
  'cancellation during token acquisition never dispatches %s',
  async (method) => {
    const active = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>();
    const transport = new Transport({
      boardReference: board.shortLink,
      fetchImpl,
      getAccessToken: async () => {
        active.abort();
        return 'synthetic';
      },
    });
    await expect(
      transport.request(method, '/scoped-test-write', { signal: active.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchImpl).not.toHaveBeenCalled();
  },
);

test.each([HttpMethod.Post, HttpMethod.Put])(
  'a cancelled body read after %s preserves write uncertainty without retries',
  async (method) => {
    const active = new AbortController();
    const response = ok({ id: board.id });
    vi.spyOn(response, 'json').mockImplementation(async () => {
      active.abort();
      throw new Error('Synthetic lost body');
    });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
    const transport = new Transport({
      boardReference: board.shortLink,
      fetchImpl,
      getAccessToken: async () => 'synthetic',
    });
    await expect(
      transport.request(method, '/scoped-test-write', { signal: active.signal }),
    ).rejects.toMatchObject({ code: ApiErrorCode.WriteResultUnknown });
    expect(fetchImpl).toHaveBeenCalledOnce();
  },
);

test.each([HttpMethod.Post, HttpMethod.Put])(
  'an observed %s result is retained if cancellation follows dispatch',
  async (method) => {
    const active = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      active.abort();
      return ok({ id: board.id });
    });
    const transport = new Transport({
      boardReference: board.shortLink,
      fetchImpl,
      getAccessToken: async () => 'synthetic',
    });
    expect(
      await transport.request(method, '/scoped-test-write', { signal: active.signal }),
    ).toEqual({ id: board.id });
    expect(fetchImpl).toHaveBeenCalledOnce();
  },
);
