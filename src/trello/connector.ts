import icon from '../assets/icons/board-snapshot.svg';
import { chooseLocale, translations } from '../i18n';
import { probeUrl, runtimeSettings } from './runtime';
import { pageReady } from './sdk';
import type { PowerUpFrame } from './sdk';

await pageReady(window);
const status = document.getElementById('connector-status');
try {
  const settings = runtimeSettings(window.location.href);
  const sdk = window.TrelloPowerUp;
  if (!sdk) throw new Error();
  const openProbe = (frame: PowerUpFrame) =>
    frame.modal({
      title: translations[chooseLocale(frame.getContext().locale)].modalTitle,
      // t.modal signs the URL itself, including the current Trello context.
      url: probeUrl(window.location.href, settings),
      height: 780,
      fullscreen: false,
      // Trello owns the header, close control, and their contrast on this background
      accentColor: '#1D2125',
    });
  sdk.initialize(
    {
      'board-buttons': (frame) => [
        {
          text: translations[chooseLocale(frame.getContext().locale)].boardButton,
          icon: new URL(icon, window.location.href).href,
          callback: openProbe,
        },
      ],
      'show-settings': openProbe,
      'show-authorization': openProbe,
      'authorization-status': async (frame) => {
        if (!settings.clientId) return { authorized: false };
        try {
          return { authorized: Boolean(await frame.getOAuth2ApiClient().getAccessToken()) };
        } catch {
          return { authorized: false };
        }
      },
    },
    { clientId: settings.clientId, redirectUri: settings.redirectUri },
  );
  if (status) status.textContent = translations[chooseLocale(navigator.language)].connectorReady;
} catch {
  if (status)
    status.textContent = translations[chooseLocale(navigator.language)].connectorUnavailable;
}
