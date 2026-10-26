import { ProbeError } from '../core/errors';
import { ProbeErrorCode } from '../shared/error-codes';
import { parseBoardReference } from '../api';
import type { OAuthOptions } from './sdk';

export interface RuntimeSettings {
  boardReference: string | null;
  clientId: string;
  redirectUri: string;
  oauthOptions: OAuthOptions;
}

/**
 * Builds public runtime settings and a clean exact OAuth callback URL
 * @param href - Current connector, probe, or callback URL
 * @returns Validated public configuration without inherited authorization parameters
 * @throws TypeError on an invalid URL; ProbeError on an invalid client ID; ScopeError on an invalid board reference
 */
export function runtimeSettings(href: string): RuntimeSettings {
  const url = new URL(href);
  const reference = url.searchParams.get('board');
  const clientId = url.searchParams.get('clientId') ?? '';
  if (clientId && !/^[a-zA-Z0-9_-]{1,100}$/.test(clientId))
    throw new ProbeError(ProbeErrorCode.InvalidConfig);
  const callback = new URL('./authorize.html', url);
  if (clientId) callback.searchParams.set('clientId', clientId);
  return {
    boardReference: reference ? parseBoardReference(reference) : null,
    clientId,
    redirectUri: callback.href,
    oauthOptions: clientId ? { clientId, redirectUri: callback.href } : {},
  };
}

/**
 * Builds the diagnostic modal URL without forwarding authorization parameters
 * @param href - Current connector URL
 * @param settings - Validated public runtime configuration
 * @returns The modal URL containing only the board reference and public client ID
 * @throws TypeError if the base URL is invalid
 */
export function probeUrl(href: string, settings: RuntimeSettings): string {
  const url = new URL('./export.html', href);
  if (settings.boardReference) url.searchParams.set('board', settings.boardReference);
  if (settings.clientId) url.searchParams.set('clientId', settings.clientId);
  return url.href;
}
