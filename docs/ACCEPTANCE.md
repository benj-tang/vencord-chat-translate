# Client acceptance

These checks are not established by Node tests or a successful build.
Do them against the actual client and a configured translation service.

- [ ] Enable in a chosen server/channel; confirm global auto remains disabled.
- [ ] Review an English and a Chinese channel with the default presets.
- [ ] Stop on a message for less than one second; no automatic request.
- [ ] Stop for more than one second; only genuinely visible messages are eligible.
- [ ] Scroll through history quickly; no hidden-history retrieval or growing queue.
- [ ] Read the top of a long message; observer uses the whole message, not its footer.
- [ ] Change focus, minimize, switch channel and open/close a thread; scheduling pauses.
- [ ] Load more than 50 eligible items; verify bounded batches, chronology and response IDs.
- [ ] Confirm provider receives no Discord IDs or author IDs.
- [ ] Check missing IDs, 429, truncation, network failure and protected-token corruption.
- [ ] Edit/delete a message while translation is pending; old result cannot overwrite it.
- [ ] Check Chinese, English, mixed text, short words and pure noise.
- [ ] Check local worker starts without any model or detection network request.
- [ ] Preview a draft, continue typing, then try applying; stale overwrite is rejected.
- [ ] Apply and restore a plain-text draft; verify DraftStore and editor match.
- [ ] Complex mentions/unsupported editor fall back to copying; no automatic send.
- [ ] Configure actual model limits and verify long-message behavior and real billing.
- [ ] Disable/re-enable plugin, change configuration and repeat worker-lifecycle checks.
- [ ] Run a longer session and observe memory, cache eviction and thread cleanup.

Record client/build version, configured provider/model, date and concrete results.
Redact credentials and private chat material. Do not mark these complete from a
screenshot, a compiler result or an agent report alone.
