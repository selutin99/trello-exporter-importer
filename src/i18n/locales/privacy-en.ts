/** English data-handling notice for the selected interface language */
export const privacyEn = {
  privacyProcessing:
    'trello-exporter-importer prepares JSON, ZIP, Markdown, PDF, XLSX, and CSV files in your browser or Trello Desktop window',
  privacyScope:
    'When opened as an authorized Trello Power-Up, export reads only the currently open board: active lists and cards, checklists, comments, labels, member display identities, and attachment metadata. Archived lists and cards are excluded. ZIP downloads available Trello-uploaded files; external attachment links are not fetched. Export does not modify board data',
  privacyStorage:
    'The project operates no backend receiving board content, exports, files, or tokens. Prepared exports stay in memory until downloaded or the window is closed. Downloaded files may contain personal information; keep them private. Warnings identify unavailable content. Export takes time and is not an atomic backup',
  privacyRestore:
    'Restoration validates a selected project JSON/ZIP file locally, then compares it with the currently open board. After conflict review, confirmation, and authorization, selected changes and attachment bytes are sent to that board in Trello. Current-only content is preserved. Cancellation retains changes already applied',
  privacyAuthorization:
    'Authorization uses the official Atlassian Power-Up SDK. The SDK manages tokens in Trello private plugin data and may use browser storage during the file-consent callback. API requests send them only in Authorization headers to Trello. They are not included in exports, reports, or application logs. OAuth 2.0 handles board reads and reviewed imports within the authorized Workspace. ZIP files require a separate Trello Auth read-only grant across your Trello account for one day; the exporter still reads only the open board and its discovered uploads',
  privacyPreferences:
    'Local storage keeps the language, a fixed authorization diagnostic stage, and the last restoration journal: operation IDs, input checksum, target board name/link, ID mappings, merge choices, operation hashes, progress, and warning codes. It contains no tokens, full snapshot, or attachment bytes. Clearing site data removes recovery information; changes already applied to the board remain. No analytics or advertising scripts are added. The official SDK loads from Atlassian CDN; the static host and Atlassian receive ordinary request metadata under their policies',
  privacyRevocation:
    'Revoke OAuth access through Atlassian connected apps and file access in your Trello account application settings. Deleting local files and revoking access are separate actions',
  privacyTrelloAccess: 'Manage Trello file access',
  privacySupport: 'For support, use GitHub Issues with synthetic examples only',
  privacyUpdated: 'Updated October 26, 2026',
} as const;
