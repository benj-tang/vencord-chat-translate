# Contributing

Start with a small, focused change and explain the user behavior it fixes.
Use conventional commit subjects such as `feat:`, `fix:` and `docs:`.

Before submitting changes:

```sh
npm ci --ignore-scripts
npm run format:check
npm run check
npm run test:worker
npm run test:native
npm run verify:vencord
```

Write tests for language decisions, scheduler boundaries, stale results, protected
content or provider failures affected by the change. Avoid private chat fixtures.
Never commit API keys, Discord tokens, settings exports, real private messages,
`dist`, dependency trees or the verification checkout.

Keep runtime detection entirely local. Do not add message sending, historical
message retrieval or a remote language detector as a fallback.
Separate tested core behavior from actual client acceptance in your report.

Original source uses SPDX `GPL-3.0-or-later` headers. Contributions are provided
under the same license. Preserve third-party notices.
Changes to bundled models must retain their separate license and attribution.
