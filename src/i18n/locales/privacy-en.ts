/** English data-handling notice for the selected interface language */
export const privacyEn = {
  privacyProcessing:
    'trello-exporter-importer prepares JSON, Markdown, PDF, XLSX, and CSV files in your browser or Trello Desktop window',
  privacyScope:
    'When opened as an authorized Trello Power-Up, export reads only the currently open board: active lists and cards, checklists, comments, labels, member display identities, and attachment metadata with source links. Archived lists and cards are excluded. Attachment files and external links are not fetched. Export does not modify board data',
  privacyStorage:
    'The project operates no backend receiving board content, exports, files, or tokens. Prepared exports stay in memory until downloaded or the window is closed. Downloaded files may contain personal information; keep them private. Warnings identify unavailable content. Export takes time and is not an atomic backup',
  privacyRestore:
    'Import validates a selected project JSON file locally, then compares it with the currently open board. After conflict review, confirmation, and authorization, selected content changes and attachment links are sent to that board in Trello. Current-only content is preserved. Cancellation retains changes already applied',
  privacyAuthorization:
    'Authorization uses OAuth 2.0 through the official Atlassian Power-Up SDK. The SDK manages tokens in Trello private plugin data. API requests send tokens only in Authorization headers to Trello. Tokens are not included in exports, reports, or application logs. Export requests board read access; reviewed import requests board write access within the authorized Workspace. No Trello Auth API key or account-wide file grant is required',
  privacyPreferences:
    'Local storage keeps the language, a fixed authorization diagnostic stage, and the last restoration journal: operation IDs, input checksum, target board name/link, ID mappings, merge choices, operation hashes, progress, and warning codes. It contains no tokens, full snapshot, or attachment bytes. Clearing site data removes recovery information; changes already applied to the board remain. No analytics or advertising scripts are added. The official SDK loads from Atlassian CDN; the static host and Atlassian receive ordinary request metadata under their policies',
  privacyRevocation:
    'Revoke OAuth access through Atlassian connected apps. Deleting local files and revoking access are separate actions',
  privacySupport: 'For support, use GitHub Issues with synthetic examples only',
  privacyUpdated: 'Updated October 26, 2026',
} as const;
