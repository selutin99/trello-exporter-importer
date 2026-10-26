/** The official SDK surface used here. No token storage or OAuth protocol is reimplemented */
export interface OAuthOptions {
  clientId?: string;
  redirectUri?: string;
}
export interface OAuthClient {
  getAccessToken(): Promise<string | null | undefined>;
  authorize(options: { scopes: string[] }): Promise<unknown>;
  redirectUriCallback(): Promise<unknown>;
}
export interface PowerUpFrame {
  getContext(): { board?: string; locale?: string };
  getOAuth2ApiClient(): OAuthClient;
  render(callback: () => void): void;
  modal(options: {
    title: string;
    url: string;
    height: number;
    fullscreen: boolean;
    accentColor: string;
  }): Promise<unknown>;
}
export interface PowerUpCapabilities {
  'board-buttons': (
    frame: PowerUpFrame,
  ) => { text: string; icon: string; callback: (frame: PowerUpFrame) => Promise<unknown> }[];
  'show-settings': (frame: PowerUpFrame) => Promise<unknown>;
  'show-authorization': (frame: PowerUpFrame) => Promise<unknown>;
  'authorization-status': (frame: PowerUpFrame) => Promise<{ authorized: boolean }>;
}
export interface PowerUpSdk {
  iframe(options: OAuthOptions): PowerUpFrame;
  initialize(capabilities: PowerUpCapabilities, options: OAuthOptions): void;
}

declare global {
  interface Window {
    TrelloPowerUp?: PowerUpSdk;
  }
}

/**
 * Waits until deferred SDK scripts and the document have loaded
 * @param window - Window hosting the official SDK script
 * @returns A promise resolved when SDK initialization can be attempted
 */
export async function pageReady(window: Window): Promise<void> {
  if (window.document.readyState !== 'complete') {
    await new Promise<void>((resolve) =>
      window.addEventListener('load', () => resolve(), { once: true }),
    );
  }
}
