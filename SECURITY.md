# Security

Do not include credentials or private Discord messages in public issue reports.
Until a public repository with a private reporting channel exists, report
security problems directly to the project maintainer through an agreed private
channel. Do not invent a maintainer email address.

The plugin sends translation material only to the endpoint configured by the
user. HTTPS is required, except for HTTP loopback services. Redirects are rejected
to avoid forwarding credentials to a different destination.

Model responses are rendered as text, never HTML. Batch IDs and protected tokens
are validated. Model output is untrusted and may still be a poor translation.
Prompt instructions reduce instruction-following risk but do not establish a
security guarantee.

In local-profile mode, credentials are read only by the native process from
`~/.config/chat-translate/provider.json`. POSIX group/other permissions must be
absent (use 0600). The profile completely replaces the endpoint, model and key;
its key is never combined with an endpoint supplied by the renderer.
It is a private plaintext file, not an OS credential vault.
In custom mode, keys remain in local Vencord settings; do not share those settings.
Errors deliberately omit provider response bodies, request contents and credentials.

Electron requests use Chromium's network stack and system certificate trust.
Certificate verification remains enabled; private LAN certificates must be
trusted by the operating system.

The installed Discord client is not modified by development or verification
scripts. Any future client installation is a separate user action.

Incoming translations are persisted locally by default, with 30-day expiry and
a 5000-entry / 10 MiB cap. The native file uses 0600 permissions in a 0700 directory
on POSIX. It stores hashes and protected translations, not separate message
originals, IDs or credentials. Translations themselves can still contain personal
information; this is a private plaintext cache, not encrypted storage. You can
disable persistence and clear both cache tiers in plugin settings. Expired entries
are removed on cache access; no cleanup daemon runs while Discord is closed.
