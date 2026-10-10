# Architecture

```text
Vencord message accessory / context menu / composer button
    -> scope resolution + actual chat viewport observation
    -> per-message continuous visibility (1 second)
    -> local worker detection + cached language rules
    -> same-channel contextual batch (up to 50 items)
    -> native HTTPS translation adapter
    -> ID + protected-token + current-content validation
    -> locally resolved plain-text translation / guarded draft replacement
```

- `src/core`: platform-independent rules, detection interpretation, content
  protection, budgets, memory cache, scheduler, provider protocol and draft guards.
- `src/native`: fastText worker and worker lifecycle. Build embeds the unchanged
  model and WASM; inference has no network dependency. The private provider
  profile is read in the native process and never returned over IPC.
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
Only standalone mention tokens that occur in the original message are resolved
for incoming display. User names come from guild nickname, global name or username;
roles and channels use local stores. Code and unknown/generated mention tokens
remain literal. Unavailable names use generic labels. Resolution subscribes to
local store updates and never fetches names or changes the protected cache text.

The composer translates on click, then checks the selected channel, saved draft
and visible editor before replacing it. It uses Discord's `CLEAR_TEXT` and
`INSERT_TEXT` editor events, confirming both Slate text and DraftStore after
each step. Failed insertion restores the original only if the same editor and
store remain empty; user edits are never overwritten. Complex mentions and
unsupported editors are rejected. An optional keydown gesture triggers after
three rapid space presses, excluding IME, repeats and modifier shortcuts.

Display styles use current Discord theme variables with light/dark fallbacks.
Style and gesture settings use reactive UI subscriptions without restarting the
engine. Scoped reactive settings are snapshotted with JSON, since their Proxy
objects cannot be passed to `structuredClone`. Saving a second scope must deep-snapshot
all existing overrides before native IPC, not shallow-spread nested proxies. Scope
menus show checked radios and close after saving; the viewport status portal is
anchored to the observed chat scroll root and works in read-only channels.
Current toast rendering receives
text and variant directly through `Toasts.show`.

Session translations use a 1000-entry LRU bound to channel/message, original content/version,
target, preserved terms and glossary.
An existing cached translation retains the context from its original successful
request. New neighboring messages do not force a paid refresh of unchanged text.
Explicit retranslation bypasses that cache. Scope reloads preserve the shared
1000-entry translation LRU and daily character budget; provider settings changes
clear session translations. Client restart loses the session LRU and daily character
budget, but incoming translations are now restored from the optional native disk cache.

The disk cache stores SHA-256 keys, protected translated text and creation/access
timestamps. The key includes the actual endpoint/model/effort namespace and the
message cache identity; no originals, credentials or Discord IDs are serialized
as separate fields. Original code, URLs and Discord tokens are replaced by stable
markers on disk and restored/validated from the current message before display.
Translations may still contain personal names, amounts or preserved Chinese text.
Native request identity is captured per response, so a profile change during a
request cannot write its result into a different provider namespace.

Defaults are 30 days, 5000 entries and 10 MiB. TTL uses creation time, not hits;
reads/writes prune expiry, reads update LRU, writes merge through a serial queue,
then fsync a 0600 temporary file and rename atomically inside a 0700 directory.
Unsafe permissions and symbolic links are rejected; malformed files are rebuilt.
Lookup failure or invalid protected tokens are misses, write failure leaves valid
session results visible. Every async lookup rechecks visibility and content before
automatic dispatch. Clearing removes both cache tiers; draft results are not stored.

Automatic transient failures retry as batches, twice by default, after 2 and 5
seconds. Each attempt rechecks visibility, target rules and character budget.
Successful results stay cached; partial/malformed responses require explicit
retry and never fan out into individual automatic calls. Exhaustion pauses new
automatic work until a visible retry or configuration reload. Provider 429 waits
at least Retry-After and cannot be bypassed by aggregate retry; credential/config
failures pause without blind retries. Budget exhaustion pauses until the next
UTC day. Outgoing drafts have no automatic retries.

Automatic per-message errors are suppressed in favor of one viewport status,
with pause reason, counts and a retry-current-viewport action. Explicit manual
message errors remain local to that message.

The local profile supplies endpoint, model, key and optional reasoning effort;
UI settings still supply timeout and output-token limits. Custom endpoints and
profile credentials are never merged. Each request rereads the profile, so a
credential rotation creates a new translator without restarting Discord.
Electron uses `net.fetch` for the operating system's private-CA trust. Node-only
loopback tests use ordinary fetch; they do not establish Electron certificate
behavior. Separate reasoning fields are ignored; malformed final output fails
validation instead of being displayed.

Native diagnostics keep only detection counts and the last 20 request counts,
status, elapsed time and valid nonnegative integer usage counts. Reasoning text,
message IDs, originals and credentials are never stored in diagnostic history.
Missing usage is reported as unknown rather than zero. Completion tokens are
the provider's raw total and may include reasoning. The diagnostic "message"
category covers both automatic and manual incoming requests; it is not proof
of how a particular request was triggered without a recorded UI action.
