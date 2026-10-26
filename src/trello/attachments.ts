import type { AttachmentClient } from './sdk';
import { runtimeSettings } from './runtime';

export enum AttachmentAccessState {
  Unavailable = 'exportFilesUnconfigured',
  Required = 'exportFilesRequired',
  Authorizing = 'exportFilesAuthorizing',
  Ready = 'exportFilesConnected',
  Failed = 'exportFilesAuthFailed',
}
export enum AttachmentScope {
  Read = 'read',
}
export enum AttachmentExpiration {
  OneDay = '1day',
}

/**
 * Lets the official SDK finish its file-consent popup before standalone rendering
 * @param window - Callback window; embedded frames and ordinary links are ignored
 * @returns Whether a configured SDK callback was initialized without exposing its fragment
 */
export function completeAttachmentCallback(window: Window): boolean {
  try {
    if (
      window.parent !== window ||
      !window.opener ||
      !window.location.hash.startsWith('#token=') ||
      !window.TrelloPowerUp
    )
      return false;
    const settings = runtimeSettings(window.location.href);
    if (!settings.appKey) return false;
    window.TrelloPowerUp.iframe(settings.oauthOptions);
    return true;
  } catch {
    return false;
  }
}

/** Owns read-only file authorization through Trello's official REST API client */
export class AttachmentAccess {
  state = AttachmentAccessState.Unavailable;
  /**
   * Binds the SDK client without retaining its token
   * @param client - File client, or null when its public key is not configured
   * @param changed - View notification after access state changes
   */
  constructor(
    private readonly client: AttachmentClient | null,
    private readonly changed: () => void,
  ) {}
  /**
   * Checks existing SDK authorization without opening a consent window
   * @returns Completion after the view has been notified
   */
  async refresh(): Promise<void> {
    if (!this.client) return;
    try {
      this.state = (await this.client.getToken())
        ? AttachmentAccessState.Ready
        : AttachmentAccessState.Required;
    } catch {
      this.state = AttachmentAccessState.Failed;
    }
    this.changed();
  }
  /**
   * Opens a one-day, read-only grant from an explicit user click
   * @returns Completion after consent or a safe, token-free failure state
   */
  async authorize(): Promise<void> {
    if (!this.client || this.state === AttachmentAccessState.Authorizing) return;
    this.state = AttachmentAccessState.Authorizing;
    this.changed();
    try {
      await this.client.authorize({
        scope: AttachmentScope.Read,
        expiration: AttachmentExpiration.OneDay,
      });
      await this.refresh();
    } catch {
      this.state = AttachmentAccessState.Failed;
      this.changed();
    }
  }
}
