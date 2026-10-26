/** Public service endpoints reviewed with the application code, never read from query parameters */
export const serviceUrls = Object.freeze({
  trelloApi: 'https://api.trello.com/1',
  trelloBoardOrigin: 'https://trello.com',
  powerUpSdk: 'https://p.trellocdn.com/power-up.min.js',
  connectedApps: 'https://id.atlassian.com/manage-profile/apps',
  supportIssues: 'https://github.com/selutin99/trello-exporter-importer/issues',
});

/** HTML placeholders resolved by the Vite pipeline in development and production */
export const htmlServiceUrls = Object.freeze({
  '%POWER_UP_SDK_URL%': serviceUrls.powerUpSdk,
  '%CONNECTED_APPS_URL%': serviceUrls.connectedApps,
  '%SUPPORT_ISSUES_URL%': serviceUrls.supportIssues,
});
