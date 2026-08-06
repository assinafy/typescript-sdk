# Contributing

Thank you for improving the Assinafy TypeScript SDK. Changes should preserve
the public API unless a versioned breaking change is intentional, keep the
implementation small and typed, and remain traceable to the official Assinafy
OpenAPI contract.

## Development environment

Use the versions exercised by automation:

| Runtime | Role |
| --- | --- |
| Bun 1.3.14 | Package manager, test runner, and primary development runtime |
| Node.js 22 | Minimum supported Node.js major |
| Node.js 24 | LTS build and release runtime |
| Node.js 26 | Current-release compatibility target |

Install from the committed Bun lockfile:

```sh
bun install --frozen-lockfile
```

`bun.lock` is the only dependency lockfile. Do not commit an npm lockfile or
generated `dist`, coverage, log, archive, or environment files.

## Required checks

Run the complete local gate before opening a merge request:

```sh
bun run verify
bun run audit
```

The scripts have the following responsibilities:

| Command | Checks |
| --- | --- |
| `bun run typecheck` | Library, script, and test TypeScript projects |
| `bun run lint` | SDK and maintainer scripts, with zero warnings allowed |
| `bun run test:coverage` | Unit and contract tests plus coverage thresholds |
| `bun run build` | CJS, ESM, and declaration outputs |
| `bun run lint:pkg` | Packed exports, declarations, and consumer compatibility |
| `bun run verify` | Typecheck, lint, coverage, build, and package validation |
| `bun run audit` | Locked dependency vulnerability audit |
| `bun run audit:api` | Current official OpenAPI operation coverage |

Run `bun run audit:api` when an API resource, request, response, or endpoint is
changed. It reads the public specification and therefore requires network
access.

GitLab is the canonical repository. Its pipeline runs the verification gates
before changes are mirrored to GitHub. The GitHub workflow repeats the gates
and imports the built package with Node 22, 24, and 26 using both CJS and ESM.

## Change guidelines

- Add focused tests before changing or removing existing behavior. A route
  that is absent from the current OpenAPI document may still be a live
  compatibility extension.
- Validate input before a network request or any earlier mutation in a
  multi-step workflow.
- Keep public request and response types explicit. Do not hide malformed API
  responses behind fabricated defaults or broad `unknown` return values.
- Keep authentication boundaries intact: public, login, and signer-access-code
  operations must not inherit API-key or bearer-token defaults.
- Reuse the resource, upload, pagination, path, retry, and header helpers rather
  than duplicating transport behavior.
- Document every public method with its request shape, response shape, errors,
  and a realistic example. Never put credentials or customer data in examples.
- Update `docs/API_COVERAGE.md` and `docs/COMPATIBILITY.md` with contract or
  compatibility changes. Update the changelog for user-visible changes.

Keep diffs focused. Do not reformat unrelated files or overwrite another
contributor's uncommitted work.

## Sandbox tests

Unit tests are the default. Live tests are an additional verification step and
must use a dedicated sandbox account with short-lived credentials:

```sh
ASSINAFY_API_KEY='...' \
ASSINAFY_ACCOUNT_ID='...' \
ASSINAFY_BASE_URL='https://sandbox.assinafy.com.br/v1' \
bun scripts/live-smoke.ts
```

The default run is read-only. A comprehensive reversible audit uses in-memory
PDF/PNG fixtures and two controlled notification recipients:

```sh
ASSINAFY_API_KEY='...' \
ASSINAFY_ACCOUNT_ID='...' \
ASSINAFY_BASE_URL='https://sandbox.assinafy.com.br/v1' \
ASSINAFY_TEST_EMAIL_PRIMARY='first@example.com' \
ASSINAFY_TEST_EMAIL_SECONDARY='second@example.com' \
bun scripts/live-smoke.ts --all
```

`--all` creates a disposable workspace, attempts cleanup of every tracked
resource, and force-deletes that workspace in `finally`. It refuses to mutate
any host other than the exact Assinafy sandbox unless the operator also passes
`--confirm-production`. An interrupted process can still leave fixtures behind,
so inspect the sandbox after a run.

Optional fixtures extend coverage: `ASSINAFY_TEST_LOGIN_EMAIL` plus
`ASSINAFY_TEST_LOGIN_PASSWORD`; `ASSINAFY_SIGNER_ACCESS_CODE` and optionally
`ASSINAFY_SIGNER_OTP`; `ASSINAFY_PUBLIC_DOCUMENT_ID`; and an HTTPS
`ASSINAFY_TEST_WEBHOOK_URL`. Missing prerequisites are printed as `SKIP`, never
silently treated as passing coverage.

Do not use the production override for routine tests. Do not print, paste into an issue,
or commit API keys, access codes, account identifiers, documents, recipient
addresses, or response payloads containing personal data. Rotate any test
credential that is exposed.

## Merge requests

Describe the API operations affected, compatibility decisions, tests run, and
whether sandbox verification was performed. Include sanitized failure details
when a live behavior differs from the published contract. Security reports must
follow [SECURITY.md](SECURITY.md), not a public issue or merge request.
