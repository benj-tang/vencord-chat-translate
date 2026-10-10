# Development instructions

- Keep this repository independent from upstream Vencord and research checkouts.
- Detection must remain local. Do not introduce remote detection fallbacks.
- Automatic translation stays inside the current visible chat viewport.
- Never send Discord messages or install into a live client as part of a build.
- Preserve original user drafts; reject stale or incompatible replacements.
- Add meaningful regression tests for scope, visibility, batching and stale results.
- Use synthetic fixtures. Keep credentials and private chat content out of Git.
- Run `npm run format:check`, `npm run check`, `npm run test:worker`,
  `npm run test:native` and `npm run verify:vencord` for a release candidate.
- Distinguish core tests and compilation from actual client acceptance.
- Original code is GPL-3.0-or-later. Preserve the model's separate license.
