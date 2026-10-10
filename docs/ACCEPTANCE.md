# Client acceptance

These checks are not established by Node tests or a successful build.
Do them against the actual client and a configured translation service.

- [x] Enable two selected channels; confirm saved settings and global auto remains disabled.
- [x] Show current preset/rule/target in the viewport, including read-only announcements.
- [x] Reopen scope menu: correct checked radio; saving closes menu and shows success.
- [ ] Review an English and a Chinese channel with the default presets.
- [ ] Stop on a message for less than one second; no automatic request.
- [ ] Stop for more than one second; only genuinely visible messages are eligible.
- [ ] Scroll through history quickly; no hidden-history retrieval or growing queue.
- [ ] Read the top of a long message; observer uses the whole message, not its footer.
- [ ] Change focus, minimize, switch channel and open/close a thread; scheduling pauses.
- [ ] Load more than 50 eligible items; verify bounded batches, chronology and response IDs.
- [ ] Confirm provider receives no Discord IDs or author IDs.
- [ ] Check missing IDs, 429, truncation, network failure and protected-token corruption.
- [x] Credentials unavailable: one aggregate notice; restore and retry only untranslated visible targets.
- [ ] Edit/delete a message while translation is pending; old result cannot overwrite it.
- [ ] Check Chinese, English, mixed text, short words and pure noise.
- [ ] Check local worker starts without any model or detection network request.
- [ ] Translate a draft directly, continue typing while pending; stale overwrite is rejected.
- [x] Apply and restore a plain-text draft; verify DraftStore, editor and restart persistence.
- [x] Enable triple-space triggering and confirm actual direct replacement.
- [x] Confirm readable translations in light/gray themes and hover-only action icons.
- [x] Resolve actual user mentions to local readable names.
- [ ] Complex mentions/unsupported editor reject replacement and preserve the draft.
- [ ] Configure actual model limits and verify long-message behavior and real billing.
- [ ] Disable/re-enable plugin, change configuration and repeat worker-lifecycle checks.
- [ ] Run a longer session and observe memory, cache eviction and thread cleanup.

Record client/build version, configured provider/model, date and concrete results.
Redact credentials and private chat material. Do not mark these complete from a
screenshot, a compiler result or an agent report alone.

Checked items are recorded in [the 2026-10-10 live validation](LIVE-VALIDATION-2026-10-10.md).
Unchecked combined checks may have synthetic coverage or partial live coverage.
