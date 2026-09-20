# Security policy

## Supported releases

Security fixes are developed on the canonical default branch and released on
the current supported major. Unless a separate support agreement states
otherwise, users should run the latest published patch. Older majors and
superseded minor releases may not receive fixes.

## Reporting a vulnerability

Do not disclose a suspected vulnerability in a public issue, discussion, merge
request, commit message, or CI log.

Use the canonical GitLab project's confidential vulnerability-reporting
channel, or the GitHub mirror's private **Security → Report a vulnerability**
flow when it is enabled. Verify that the report is private before adding
sensitive details. If neither private channel is available, open a public issue
that asks maintainers for a private contact method and include no vulnerability
details.

Provide:

- the affected SDK and runtime versions;
- the affected method, endpoint, and authentication mode;
- impact and realistic attack preconditions;
- a minimal, sanitized reproducer or failing test;
- any proposed mitigation or patch; and
- whether the issue has been disclosed elsewhere.

Do not include usable API keys, bearer tokens, signer access codes, account
identifiers, webhook secrets, documents, or personal data. Replace them with
clearly fake values. If a real credential was exposed, revoke or rotate it at
once; deleting the message or git commit is not sufficient.

Maintainers will confirm receipt through the private channel, investigate the
supported release, coordinate a fix and advisory, and publish a patched version
when appropriate. Public disclosure should wait until users have a reasonable
opportunity to upgrade.

## Security expectations

- Protected resources require explicit account credentials. Public,
  authentication, and signer-access-code flows use an auth-free transport so
  configured account credentials are not sent to public endpoints.
- Consumers must use HTTPS endpoints and protect all SDK configuration as
  secrets. The client enforces this: a `baseUrl` using plaintext `http` is
  rejected unless its host is loopback, so a credential cannot be sent in the
  clear to a remote host. Debug logging and error telemetry must be reviewed
  for response data before being enabled in production.
- An OAuth `client_secret` belongs only on a server you control: never in
  browser code, a mobile application, or a repository. A public application has
  no secret and authenticates with PKCE alone. The SDK sends the token and
  revocation requests on the credential-free transport, so a workspace
  `X-Api-Key` is never attached to a route that authenticates the application.
- Treat OAuth refresh tokens as single-use. Each refresh returns a new one and
  retires the old one, and replaying a retired token ends the whole connection
  for that user. Persist the new value before acting on the response, and never
  refresh one connection concurrently.
- Authorization responses are validated before they are trusted: `state` is
  compared in constant time and `iss` must match the expected issuer. Do not
  bypass `readAuthorizationCallback()` and exchange a code straight from the
  query string.
- The webhook HMAC helper is an opt-in utility, not proof of an official
  Assinafy signing contract. Confirm the header, algorithm, encoding, and secret
  delivery mechanism with Assinafy before enforcing it. See
  `docs/COMPATIBILITY.md`.
- Dependency changes must keep `bun.lock` synchronized and pass `bun run audit`.
  GitHub Actions are pinned to immutable commit SHAs and updated through
  Dependabot review.
- Sandbox credentials and fixtures must never be reused in production. Live
  mutation tests belong only in dedicated, disposable sandbox accounts.

For general defects without a security impact, use the normal issue tracker.
