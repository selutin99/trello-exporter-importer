# Repository instructions

- Never create or use Git worktrees. Work in the main project directory.
- The project implements JSON export and current-board merging, alongside
  Markdown/PDF/XLSX/CSV export and historical diagnostics
  Attachment files remain in Trello; export and import preserve source links only
  Keep implementation status distinct from pending live client/workload validation
- Keep the README workflow, snapshot contract, and executable schemas consistent
  when changing behavior or release scope. Do not recreate a docs/ directory.
- Use synthetic board data in examples, fixtures, screenshots, and issues.
  Never commit real exports, attachments, API tokens, or restore journals.
- Do not promise exact restoration of Trello identities, timestamps, activity
  history, permissions, or unsupported Power-Up data.
- Live tests may access only the board explicitly designated by the user and
  other destination boards explicitly approved for that operation. Never enumerate
  other boards or change their cards, memberships, settings, or Power-Ups.
- Keep real test-board references in runtime configuration, not public fixtures.
  Verify the source board and child ownership before mutations. Prototype UI
  writes remain disabled until an explicit write test is ready and authorized.
- Imports target only the currently open SDK board. Never create boards during
  import, infer a destination from snapshot data, or delete current-only content.
  Require explicit conflict choices and revalidate the reviewed state before writes.

## Language and source organization

- Communicate with the user in Russian. Keep source identifiers, comments,
  repository documentation, issue forms, and pull request templates in English
- Keep Russian product strings in the Russian locale resource; deliberate Unicode
  fixtures are permitted
- Product message resources must not end with periods in either language
- Russian product copy uses the Cyrillic letter U+0435 instead of U+0451
- Show the data-handling notice only in the selected interface language
- Export only active lists and active cards in those lists; never collect archived
  card content or attachment files
- Keep one npm project under `src/`; do not introduce npm workspaces for the MVP
- Mirror source paths in tests: `src/api/client.ts` maps to
  `test/api/client.test.ts`, `src/core/controller.ts` to
  `test/core/controller.test.ts`, and so on
- Keep shared test setup under `test/helpers/` and repository/configuration tests
  under `test/repository/` and `test/config/`, rather than flattening `test/`
- Use named string enums for stable error codes, states, events, callback stages,
  and other repeated protocol values; keep their serialized values compatible
- Keep shared code enums in `src/shared/` and domain-specific enums alongside
  their domain; do not embed long string-literal unions or raw error codes in throws

- Keep public service endpoints in `src/config/services.ts`; use its HTML
  placeholders instead of repeating service URLs in page sources
- Never accept API origin overrides from untrusted runtime settings or snapshot
  input, because the transport sends an OAuth bearer token to that origin

## Documentation and checks

- Use TSDoc/JSDoc for public functions, methods, and constructors with behavior
  worth documenting; write summaries without a trailing period
- Document each parameter with `@param`, return values with `@returns`, and
  meaningful failure or cancellation contracts with `@throws` where applicable
- Do not duplicate TypeScript types in documentation or invent failure conditions
- Run `npm run check` before publishing changes: typed lint, CSS lint, formatting,
  code smell analysis, type checking, tests with coverage gates, and a build
- Keep coverage reports and generated build files out of Git
- CI checks code and uploads coverage and the built Power-Up as separate artifacts
- GitHub Pages deployment is explicitly authorized as of October 19, 2026
- Keep CD in a separate workflow after successful CI for a push to this repository's
  main branch; deploy only that CI run's site artifact, never coverage reports or
  an unverified checkout; do not deploy pull request artifacts
- Reference GitHub Actions by readable major-version tags in `uses:`
- Use the official Gitleaks Action for push/PR commit-range scans, with a fixed
  scanner version, read-only permissions, and PR comments/artifact uploads disabled
- Configure community templates only in this repository's `.github/` directory
