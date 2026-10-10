# Changelog

## 0.1.0 - Development preview

- Introduce local fastText worker packaging and bilingual reading presets.
- Add viewport-scoped 1-second scheduling and contextual batches of up to 50.
- Add manual incoming translation and guarded outgoing draft replacement/restore.
- Add configurable native Chat Completions translation and response validation.
- Establish an independent Git repository, GPL license, third-party notices,
  deterministic dependency lock, tests and CI.

- Add private native-only provider profiles and Magpie / DeepSeek V4 Flash setup.
- Use Electron system networking for trusted private LAN HTTPS certificates.
- Add explicit reasoning effort and an opt-in real-provider synthetic probe.

- Add optional triple-space translation, outgoing default language and composer busy indication.
- Add theme-aware translation styles and hover-only retry/hide icons.
- Resolve protected user, role and channel mentions locally for readable incoming text.
- Add memory-only native batch diagnostics and token counts without storing reasoning text.
- Fix reactive scope settings snapshots and current Discord toast compatibility.
- Verify real scoped automatic batching, plain-text draft persistence and restoration,
  enabled triple-space triggering, light/dark readability and user mention display.
- Probe thinking-off parameters through Magpie Chat and Responses: reasoning tokens
  remain present; retain the verified low configuration.

- Fix second-channel scope persistence: deep-snapshot all existing reactive overrides
  before settings IPC so the saved scope and runtime agree.
- Show selected scope radios, explicit inherited/off state and a viewport mode indicator
  including read-only announcement channels; close the menu after a successful save.
- Add bounded automatic batch retries, rate-limit cooldowns and one aggregated failure notice.
- Preserve translation cache and character budget across scope reloads; keep successful
  partial results out of later target batches.

See `docs/LIVE-VALIDATION-2026-10-10.md` for exact acceptance and remaining checks.
