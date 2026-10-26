import { test } from 'vitest';
import assert from 'node:assert/strict';
import { runtimeSettings, probeUrl } from '../../src/trello/runtime';
test('OAuth callback excludes Trello context, authorization codes, and board IDs', () => {
  const settings = runtimeSettings(
    'https://example.com/prototype/probe.html?board=TEST0001&clientId=public-client&code=secret&signature=unused',
  );
  assert.equal(
    settings.redirectUri,
    'https://example.com/prototype/authorize.html?clientId=public-client',
  );
  assert.equal(settings.boardReference, 'TEST0001');
});

test('new and legacy callback paths discard incoming query and fragments', () => {
  for (const base of ['trello-exporter', 'trello-exporter-importer'])
    for (const prefix of ['', 'prototype/']) {
      const settings = runtimeSettings(
        `https://example.com/${base}/${prefix}probe.html?board=TEST0001&clientId=public-client&code=synthetic#secret=synthetic`,
      );
      assert.equal(
        settings.redirectUri,
        `https://example.com/${base}/${prefix}authorize.html?clientId=public-client`,
      );
    }
});

test('invalid public client IDs fail closed', () => {
  assert.throws(() => runtimeSettings('https://example.com/probe.html?clientId=bad%3Fvalue'));
});

test('file SDK configuration propagates only the public key and keeps the OAuth callback exact', () => {
  const href =
    'https://example.com/connector.html?clientId=public-client&appKey=0123456789abcdef0123456789abcdef&token=private#secret';
  const settings = runtimeSettings(href);
  assert.deepEqual(settings.oauthOptions, {
    clientId: 'public-client',
    redirectUri: 'https://example.com/authorize.html?clientId=public-client',
    appKey: '0123456789abcdef0123456789abcdef',
    appName: 'trello-exporter-importer',
  });
  assert.equal(
    probeUrl(href, settings),
    'https://example.com/export.html?clientId=public-client&appKey=0123456789abcdef0123456789abcdef',
  );
  assert.throws(() => runtimeSettings('https://example.com/connector.html?appKey=bad%22key'));
});
