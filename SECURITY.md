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

API keys are stored in local Vencord settings, not an OS credential vault.
Do not share those settings. Errors deliberately omit provider response bodies,
request contents and credentials.

The installed Discord client is not modified by development or verification
scripts. Any future client installation is a separate user action.
