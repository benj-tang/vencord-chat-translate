# Architecture

```text
Vencord message accessory / context menu / composer button
    -> scope resolution + actual chat viewport observation
    -> per-message continuous visibility (1 second)
    -> local worker detection + cached language rules
    -> same-channel contextual batch (up to 50 items)
    -> native HTTPS translation adapter
    -> ID + protected-token + current-content validation
    -> plain-text translation display / draft preview
```

- `src/core`: platform-independent rules, detection interpretation, content
  protection, budgets, memory cache, scheduler, provider protocol and draft guards.
- `src/native`: fastText worker and worker lifecycle. Build embeds the unchanged
  model and WASM; inference has no network dependency.
- `src/plugin`: Vencord UI, private scope overrides, settings and IPC.
- `scripts/build.mjs`: makes a self-contained user-plugin source package.
- `scripts/verify-vencord.mjs`: pinned Vencord typecheck and desktop build.

Messages may remain mounted outside the visible viewport. An accessory registers
the entire message with an observer rooted in its real scroll container. Window
focus, visibility and selected-channel checks independently gate scheduling.
If a scroll container cannot be identified, automatic translation does not run.

Each message maintains its own visibility time. Scroll-out removes eligibility.
An already dispatched batch is allowed to finish and cache valid results.
Manual requests have priority for the next shared request slot; automatic work
does not interrupt a dispatched batch.

IDs in provider requests are batch-local. Replies only refer to other included
items, and author identifiers become anonymous speaker labels.
Chinese portions of mixed messages and Discord tokens are protected with
placeholders whose occurrence counts are checked before restoration.
Translations are displayed as React text; Markdown links, HTML and model-generated
mentions are not executed by the plugin.

Caches are memory-only and bound to original content, target and configuration.
An existing cached translation retains the context from its original successful
request. New neighboring messages do not force a paid refresh of unchanged text.
Explicit retranslation bypasses that cache. Config changes clear the runtime cache.

Batch failures and missing items are surfaced for manual retry in 0.1.0. There is
no automatic single-message fan-out and no infinite retry loop. Provider 429
responses pause the provider until its Retry-After; credential/config failures
pause it until provider configuration is replaced.
