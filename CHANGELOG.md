# Changelog

All notable changes to `@assinafy/sdk` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.2.0] - 2026-08-27

### Security

- **`baseUrl` now requires `https` for any remote host.** Every request on the
  authenticated transport carries the caller's `X-Api-Key` or bearer token, so
  a plaintext `http://` base URL put a long-lived credential on the wire in
  cleartext. `http` remains accepted when the host is loopback (`localhost`,
  the `127.0.0.0/8` block, or `::1`) so local mock servers and the packed
  consumer smoke test keep working; anything else is rejected with a
  `ValidationError` at construction time. `SECURITY.md` already required HTTPS
  endpoints — the client now enforces it rather than trusting configuration.
  - Callers pointing at a remote `http://` host must switch to `https://`.

### Fixed

- **`signers.findByEmail()` requested 100 rows per page and received 50.** The
  API clamps `per-page` to 50 and answers `200`, so the lookup scanned half the
  window its documentation claimed. It now pins the real maximum, and the
  method and `signers.list()` documentation state the clamp instead of naming
  100 as the API maximum. `documents.list()` carried the same incorrect claim.
- **Unstructured error bodies were reported as the generic "API request
  failed".** A gateway or proxy in front of the API answers with `text/plain`
  or HTML rather than the Assinafy JSON envelope. `ApiError.fromResponse()`
  only read `message`/`error` off an object, so exactly the failures with no
  structured body to explain them lost their only explanation. A non-JSON body
  is now used as the message, with whitespace collapsed and the text capped at
  500 characters; the untouched body remains on `ApiError.responseData`.

### Added

- **`MAX_LIST_PAGE_SIZE`** — the largest page any list endpoint returns (50).
  Exported so callers can size pagination loops against the value the server
  actually honours rather than the one they request.

### Changed

- The email and E.164 phone-number patterns had five and two copies across the
  resource files. They are now `isEmail()`, `assertEmail()`, and
  `isE164PhoneNumber()` in `src/utils.ts`, so the accepted shape of a contact
  value is defined in one place. Validation behaviour and error messages are
  unchanged.
- `decodeBinaryErrorBody()` returns a non-JSON binary body as a string instead
  of wrapping it in `{ message }`, so both unstructured-body paths converge on
  the single rule in `ApiError.fromResponse()`.
- GitLab CI reads the Bun version from `package.json`'s `packageManager` field
  instead of repeating the literal, matching how GitHub Actions' `setup-bun`
  resolves it. Both CIs now move together when that field is bumped.
- README gained a contents map linking the setup, end-to-end workflow, and
  per-resource sections; list examples use the `per-page` spelling the API
  reads and document the page-size clamp.

## [2.1.2] - 2026-08-26

### Added

- `SDK_USER_AGENT` — every transport, including public and signer-access-code
  requests, now identifies itself as `Assinafy-Typescript-SDK/v<VERSION>`.
- `scripts/node-consumer-smoke.mjs`, exercised by CI and the release workflow:
  it installs the packed tarball into an isolated consumer and drives the real
  Node HTTP, auth, and multipart paths through both CJS and ESM entrypoints.
- A manual **Sandbox integration** workflow with `read-only` and
  `disposable-full` modes, gated on a protected environment.

### Security

- Requests on the authenticated transport are pinned to the configured API
  origin. A cross-origin URL is rejected before dispatch, and `Authorization`
  and `X-Api-Key` are marked redirect-sensitive so the redirect stack strips
  them.
- Cross-origin redirects are blocked unless they are a `GET`/`HEAD` to an
  `https` target whose source URL carries no sensitive query parameter.
- Public, login, and signer-access-code flows run on a transport whose
  credential headers are removed at construction, so a configured API key
  cannot reach a public endpoint.
- `AxiosError` is no longer attached as an SDK error `cause`. It retains the
  full request config, including credentials and body, which error reporters
  commonly serialize. Transport failures now carry a sanitized cause with
  credential-shaped values redacted from the message.
- Caller-supplied loggers receive an allowlist of numeric operational counters
  only. Logger exceptions and rejected promises are swallowed so telemetry
  cannot change request semantics.

### Fixed

- `AssinafyClient.create()` no longer let its options bag override the
  `apiKey`/`accountId` passed positionally, and it rejects missing or malformed
  credentials instead of constructing an unusable client.
- Constructor options are validated up front: a non-object bag, a blank
  credential, or an invalid `timeout`/`maxRetries` throws `ValidationError`.
- `uploadAndRequestSignatures()` validates every signer before uploading, so an
  invalid later signer no longer leaves an orphaned document behind, and it no
  longer waits for `metadata_ready` before creating a virtual assignment.
- HTTP 429 replay is limited to `GET`, `HEAD`, `OPTIONS`, and `DELETE`, with
  `GET /sign` excluded because that read records a signer view.

## [2.1.1] - 2026-08-06

Maintenance only. The published `dist/` is byte-identical to 2.1.0; no runtime,
type, or API surface changed.

### Changed

- Dependabot no longer proposes `typescript` 7.x. TypeScript 7 is the native
  rewrite: the `typescript` entrypoint exports only `{version,
  versionMajorMinor}` and the compiler API moved to `typescript/unstable/*`
  with a different shape. That breaks `tsup --dts` (bundled `rollup-plugin-dts`
  reads `ts.sys.useCaseSensitiveFileNames` at module load) and falls outside
  `typescript-eslint`'s `>=4.8.4 <6.1.0` peer range. The ignore is documented
  in `.github/dependabot.yml` and should be removed once both support TS 7.

## [2.1.0] - 2026-08-06

### Added

- Full typed coverage of the current official OpenAPI contract: **89/89
  operations across 68 paths**, including account theme/logo/statistics, OAuth
  URL helpers/linking, authenticated-user profile/statistics, and all signer
  response/acknowledgement shapes.
- An exhaustive machine-auditable endpoint ledger (`docs/API_COVERAGE.md`),
  compatibility record, and a scheduled OpenAPI operation-drift gate.
- Strict test-source typechecking and enforced Bun coverage floors. The suite
  now executes every public HTTP wrapper and covers the production source at
  more than 95% of functions and 98% of lines.
- Canonical GitLab CI plus SHA-pinned GitHub mirror workflows. Tag mirrors now
  build one immutable tarball, verify its checksum, and publish that same file
  to npm (OIDC trusted publishing) and GitHub Packages.

### Fixed

- Public/login/signer-code requests now use a credential-free transport, so
  account API keys and Bearer tokens cannot leak onto public routes.
- The high-level upload workflow validates every signer before uploading and
  always waits for document metadata before creating an assignment; opting out
  only skips the final presentation re-fetch.
- `sendToken(documentId, email)` now sends the official `{ email }` request and
  uses the legacy `{ recipient, channel }` form only explicitly or after a
  narrowly matched compatibility error.
- Empty success acknowledgements resolve to `void`, malformed list envelopes
  throw instead of silently becoming `[]`, and API response types were aligned
  with nullable/variant wire shapes.
- Automatic `429` replay is now limited to idempotent HTTP methods. `POST` and
  `PATCH` require an explicit non-empty `Idempotency-Key`.
- Configuration, upload files/PDF content, dynamic paths, polling values,
  signer updates, webhook inputs/events, and pagination metadata receive strict
  validation; diagnostic logging and network-error causes no longer expose
  request credentials or user payloads.
- Restored the official name-only signer request and account
  `notification_sender_type` field. Both are now represented exactly as the
  OpenAPI defines them; the live audit records the sandbox's lagging rejection
  of `notification_sender_type` without blocking unrelated endpoint tests.
- Restored the official public, code-free signer artifact download while
  retaining an optional access-code argument for legacy deployments, and made
  owner-only assignment-signer fields optional in signer-context responses.

### Security

- Updated the dependency graph and overrides to **zero known advisories**.
- Removed arbitrary-ref/manual publishing, pinned current actions to immutable
  commit SHAs, set least-privilege permissions/timeouts, and removed the
  long-lived npm publish token in favor of OIDC.
- Clarified that webhook HMAC verification is an opt-in utility: the current
  Assinafy OpenAPI document does not specify a signing header or algorithm.

### Earlier 2.1.0 audit work (completed 2026-07-19)

Full audit against the live sandbox API (`https://sandbox.assinafy.com.br/v1`)
and the OpenAPI reference: every safely runnable operation was probed, fixture-
or legal-consent-dependent operations were recorded as explicit skips, and the
SDK was reconciled against the observed request/response shapes.

#### Fixed

- **`signerDocuments.acceptTerms()` and `signerDocuments.verifyEmail()` were
  unauthenticated.** Both sent the `signer-access-code` in the JSON request body,
  but the API's `signerAccessCode` security scheme is a **query** parameter — so
  every call was rejected with `401`. They now pass the code as
  `?signer-access-code=…` (matching every other signer-side method), and
  `verifyEmail` sends only `verification-code` in the body.
- **`uploadAndRequestSignatures()` returned a stale document.** With
  `waitForReady` enabled (the default) it still returned the pre-processing
  upload snapshot (`status: 'uploaded'`, empty `pages`, no `assignment`). It now
  returns the document re-fetched after the assignment is created, so `status`,
  `pages`, and the embedded `assignment` are current.
- **README workspace example used an invalid colour.** `primary_color:
  '#ff0066'` is rejected by the account endpoints, which require exactly 6 hex
  characters with **no** leading `#` (verified live). Fixed the example and
  documented the format on the payload types.

#### Added

- **`workspaces.delete(accountId, { force: true })`** — send the documented
  `force` flag (in the request body) to override deletion restrictions.
- **`signerDocuments.uploadSignature(..., { reuse: true })`** — expose the API's
  `reuse` query flag to persist a signature for reuse on future documents.
- **`confirmData()` now accepts the documented `full_name` and `government_id`**
  fields (additive; `undefined` values are stripped).
- **`IDocumentUploadResponse.signing_url`** — the upload endpoint always returns
  it (previously missing from the type).
- **`IAssignmentEntry`** — a typed shape for `collect`-method assignment
  `entries` (was `unknown[]`).
- Request/response payload examples on **every** public method, and expanded
  unit-test coverage across all resources.

#### Changed

- **`IDocumentUploadResponse.declined_by`** is now typed `ISigner | null` (was
  `string | null`), matching the sibling document response types and the API.
- Workspace `events` on webhook registration and `socialLogin.provider` now use
  the open-enum (`… | AnyString`) convention, keeping literal autocomplete while
  accepting server-controlled strings.
- **Tooling / CI:** GitHub Actions are pinned to commit SHAs (with a
  `dependabot.yml` to keep them and npm deps current); the release workflow pins
  an exact Bun version for reproducible, provenance-signed publishes; `scripts/`
  is now linted and typechecked; the redundant `.npmignore` and the stale,
  CI-unused `package-lock.json` were removed (the repo is Bun-first).

#### Compatibility notes

- The sandbox still rejects `notification_sender_type` during account creation
  but accepts it during update. The SDK exposes the official field and records
  that sandbox lag explicitly instead of deleting documented functionality.
- The live list API clamps `per-page` to **50**. `sendToken` uses the current
  official `{ email }` body first and retains the older `{ recipient, channel }`
  form as an explicit, narrowly scoped compatibility path.

## [2.0.0] - 2026-07-15

### Removed (breaking)

- **`webhooks.delete()`** — `DELETE /accounts/{id}/webhooks/subscriptions`
  returns `404`; the endpoint does not exist. Use **`webhooks.inactivate()`**
  (`PUT /accounts/{id}/webhooks/inactivate`) to stop deliveries; the
  subscription is retained and re-enabled by calling `webhooks.register()` again
  with `is_active: true`. The method never functioned, so no working runtime
  behaviour changes.

### Fixed

- **`per_page` was silently ignored on every list call.** The API reads only
  `per-page`; `per_page` is accepted and discarded, so the response fell back to
  20 items (verified: `?per-page=2` → 2 items, `?per_page=2` → 20). Every list
  method's documentation advertised `per_page`, so paging appeared to work while
  quietly returning the wrong page size. Both spellings are now honoured —
  `per_page` is normalised to `per-page`, and an explicit `per-page` wins.
  - `signers.findByEmail` asked for `per_page: 100` and therefore received 20.
    It now requests the API's **maximum page size of 50** (larger values are
    silently clamped to 50 by the server).
- **Failed artifact downloads reported "API request failed".** Downloads are
  issued with `responseType: 'arraybuffer'`, which axios also applies to error
  responses, so JSON error bodies arrived as a Buffer and the real message was
  discarded. `download`, `thumbnail`, `downloadPage`, `templates.downloadPage`
  and the signer-side downloads now surface what the server actually said (e.g.
  "Artefato não está disponível." when requesting `certificated` before signing).
- **`signers.create` could not recover from a duplicate-email race.** It caught
  `409`, but this API answers a duplicate email with **400**, so the recovery
  path never ran. It now handles both and still rethrows unrelated 4xx.
- **`waitUntilReady` reported auth and not-found failures as a timeout.** The
  poll loop swallowed every `ApiError`, so an invalid API key, a wrong account,
  or a deleted document burned the full `maxWaitMs` and then threw
  `ValidationError('Timeout waiting for document to be ready')`. Because
  `uploadAndRequestSignatures` awaits it by default, a bad key hung the SDK's
  flagship helper for 30 s and then misreported the cause. A 4xx now surfaces
  immediately; 5xx and 429 still retry as before.
- **`toSdkError` dropped `cause` when a non-`Error` value was thrown.** The
  cause was passed into the `context` parameter instead of `options`, so
  `error.cause` was `undefined` exactly where the original throw was least
  identifiable. It now populates `cause` and leaves `context` empty.
- **`templates.create(source, { name })` silently ignored `name`.** The API
  derives a template's display name from the filename of the uploaded `file`
  part, not from a `name` field, so every template was named after the uploaded
  file regardless of the option. `name` is now applied.
  - `.pdf` is appended when absent: `'NDA template'` → `'NDA template.pdf'`.
  - Accents are transliterated by the API: `'Contrato de Serviço'` is stored as
    `'Contrato de Servico.pdf'`.
  - Callers who passed `name` and relied on the previous filename-derived result
    will now get the name they asked for.

### Added

- **`documents.upload(source, { name })`** — uploaded documents could not
  previously be named. Same semantics as `templates.create`.
- **`documents.search(params, accountId?)`** — `GET /accounts/{id}/documents/search`.
  A lighter-weight `list`: same item shape, without the expanded
  `assignment`/`pages`. Supports `search`, `status`, `page`, `per-page`.
- **`documents.rename(documentId, name)`** — `PATCH /documents/{id}`. Returns
  `400` while the document is still in `metadata_processing`, so await
  `waitUntilReady()` first on a fresh upload; passing `name` to `upload()`
  avoids both the round-trip and the wait.
- **`assignments.list(params, accountId?)`** — `GET /assignments`, paginated via
  `page` / `per-page`.
- **`signerDocuments.search(signerId, accessCode, search?)`** —
  `GET /signers/{id}/documents/search`, the signer-side counterpart of
  `documents.search`.
- **`IPage`** — a real type for document/template `pages[]`:
  `{ id, number, height, width, download_url?, fields? }`.
- **`MAX_UPLOAD_BYTES`** is now exported, so callers can check a file against the
  API's 25 MB limit before uploading.
- **`AnyString`** — used to keep editor autocomplete on fields like
  `AssignmentVerificationMethod` and `SendTokenChannel`. `'Email' | 'Whatsapp' |
  string` collapses to plain `string` and loses the suggestions; these now read
  `'Email' | 'Whatsapp' | AnyString`. Any string is still accepted, so values the
  API adds later keep type-checking.

### Changed (breaking)

- **Node.js 22+ is now required** (`engines: >=22`, was `>=20`). Node 20 reached
  end-of-life in April 2026. The SDK is tested on Node 22 and 24 against the
  built CJS and ESM artifacts.
- **`exports` now declares per-condition `types`**, so ESM consumers resolve
  `dist/index.d.mts` instead of the CJS-flavoured `dist/index.d.ts`.

### Internal

- Compiled against ES2022 with `noUncheckedIndexedAccess`, `isolatedModules` and
  `verbatimModuleSyntax` enabled (each produced zero errors). ES2022 also lets
  the error classes pass `cause` through the native `Error` constructor instead
  of assigning it behind a cast.
- `src` is now typechecked against `@types/node` rather than `bun-types`. The
  package ships to Node but was type-checked against Bun's globals, so a
  Bun-only API would have compiled cleanly and failed at runtime for consumers.
- `documents.upload` and `templates.create` were byte-for-byte the same
  load → validate → build-form → POST → assert-id sequence over different paths;
  both now share `BaseResource.uploadPdf`.

### Heads-up for upgraders (type-level — no runtime break)

- **`ITemplateDetailsResponse.pages` and `IDocumentDetailsResponse.pages` are
  now `IPage[]`** (were `unknown[]`). This fixes the documented
  `template.pages![0].id` pattern, which previously failed to compile with
  `TS2571: Object is of type 'unknown'`. Code that cast `pages` to a local shape
  can drop the cast.
- **`IWebhookDispatch.created_at` / `updated_at` are now `string`** (were
  `number`). The API sends ISO-8601 (`'2026-07-15T20:04:36Z'`), so arithmetic on
  these was always operating on a string.
- **`ITemplateListItem` gained `pages` and lost `resource` / `account_id`.** The
  list endpoint does return `pages` — so `template.pages` no longer fails to
  compile — and never returned the other two. `ITemplateDetailsResponse.account_id`
  was likewise a phantom and is gone.
- **`documents.rename` now returns `IRenameDocumentResponse`**
  (`Omit<IDocumentDetailsResponse, 'pages' | 'assignment'>`). The endpoint does
  not return either field, so the old type promised a required `pages` array
  that was `undefined` at runtime.
- **`ICreateAssignmentPayload.copy_receivers` is documented as unreliable.** On
  the sandbox plan the API accepts it and persists nothing — verified `[]` from
  `create`, `list` and `details().assignment`, for both emails and signer IDs.
  Kept (it may be plan-gated) but do not assume a CC was delivered.

## [1.5.0] - 2026-06-05

Full production-readiness audit against [the live API docs](https://api.assinafy.com.br/v1/docs),
re-verified end-to-end against the live **sandbox** (`https://sandbox.assinafy.com.br/v1`).
Closes the last coverage gap (Template create/update/delete), removes a dead
endpoint, tightens types to the real wire shapes, and modernises the toolchain.

### Removed

- **`assignments.cancel`** — it called
  `POST /accounts/{id}/signature-requests/{id}/cancel`, which is undocumented and
  returns `404` on the live API (verified). There is no workspace-side cancel
  endpoint — cancel by deleting the document (`documents.delete`, when its status
  is deletable) or via the signer-side decline
  (`signerDocuments.decline(documentId, assignmentId, accessCode, reason)`).
  The method never functioned, so no working runtime behaviour changes.

### Heads-up for upgraders (type-level / advisory — no runtime break)

- **`IAssignment.signing_urls` is now `Array<{ signer_id, url }>`** (was
  `Record<string, string>`) — matching the live/doc payload. TypeScript code that
  indexed it as a map (`signing_urls[signerId]`) should switch to finding the
  entry by `signer_id`.
- **`IWebhookSubscription` no longer declares `id` / `created_at`** — the API
  returns `{ events, is_active, url, email, updated_at }` (one subscription per
  workspace, keyed by URL).
- **Recommended Node is now 20+** (`engines` updated; Node 18 is end-of-life).
  Advisory only — `engines` does not block installs on older runtimes.

### Added

- **`TemplateResource.create`** — `POST /accounts/{id}/templates` (multipart PDF
  upload). Returns the template object (status `Uploaded` → `Ready`).
- **`TemplateResource.update`** — `PUT /accounts/{id}/templates/{id}` (`name`,
  `message`).
- **`TemplateResource.delete`** — `DELETE /accounts/{id}/templates/{id}`.
- **Automatic 429 retry.** The client retries rate-limited requests up to
  `maxRetries` times (default `2`), honoring `Retry-After` /
  `X-Rate-Limit-Reset`. Configure via the new `maxRetries` client option; set
  `0` to disable.
- Exported `DEFAULT_WEBHOOK_EVENTS` (the default `webhooks.register` event set).
- New types: `ICostEstimate`, `IResendCostEstimate`, `IAssignmentSigner`,
  `IAssignmentItem`, `IUpdateTemplatePayload`.

### Changed

- `assignments.estimateCost` / `documents.estimateCostFromTemplate` now return
  the typed `ICostEstimate`; `assignments.estimateResendCost` returns
  `IResendCostEstimate` (was `Record<string, unknown>`).
- `IAssignment.items` / `.signers` are now fully typed (`IAssignmentItem[]` /
  `IAssignmentSigner[]`); `IDocumentListItem` exposes the `artifacts`,
  `signing_url`, `pages`, `assignment`, `decline_reason`, `declined_by` fields
  the API actually returns; `IDocumentUploadResponse.assignment` is optional;
  `IWorkspaceResponse` colors are nullable; `IDocumentDetailsResponse` gains
  `template_id`.
- Multipart upload helpers (`loadSource` / `validateUpload` / `buildUploadForm`)
  were extracted into `src/resources/upload.ts` and shared by document and
  template uploads (DRY).
- `scripts/live-smoke.ts` honors `ASSINAFY_BASE_URL` (so it can target the
  sandbox) and now exercises the template lifecycle in `--upload` mode.

### Tooling

- ESLint upgraded to v9 (flat config, `eslint.config.mjs`) with
  `typescript-eslint` v8.
- CI/release workflows hardened: least-privilege `permissions`, `concurrency`
  cancellation, `oven-sh/setup-bun@v2`, `--frozen-lockfile` installs, Node 22
  for publishing, and npm provenance (`--provenance` + `id-token: write`).
- esbuild pinned via `overrides` to keep the bun + npm lockfiles reproducible.

### Tests

113 unit tests pass (`bun test`). New suites cover `TemplateResource` (incl. the
new CRUD), the `BaseResource` helpers (`callOptional` 404→null, `callVoid`,
`callBinary`, `callList`), the rate-limit retry helpers, and assignment/document
response shapes. All read and write paths re-verified against the live sandbox,
including template create/get/update/downloadPage/delete.

## [1.4.0] - 2026-05-27

Full file-by-file audit against [the live API docs](https://api.assinafy.com.br/v1/docs),
re-validated end-to-end against the live API. Closes the last coverage gap (Tags)
and fixes signer-creation and type accuracy.

### Added

- **`TagResource`** (new — `client.tags`): `list` (with `search`), `create`,
  `update` (rename / recolor, `color: null` clears), and `delete`
  (`{ force: true }` detaches everywhere first). Covers
  `GET/POST/PUT/DELETE /accounts/{id}/tags`.
- **`DocumentResource` tag methods**: `listTags`, `replaceTags`, `addTags`,
  `detachTag` — the `GET/PUT/POST /accounts/{id}/documents/{id}/tags` and
  `DELETE /accounts/{id}/documents/{id}/tags/{tag_id}` endpoints.
- **Sequential signing**: `step` is now accepted on assignment signer objects
  (`assignments.create` / `estimateCost`) and on template signers
  (`documents.createFromTemplate`).
- `documents.createFromTemplate` options now accept `tags` (tag names attached
  to the created document).
- New types: `ITag`, `IInlineTag`, `ICreateTagPayload`, `IUpdateTagPayload`, and
  `IDocumentListParams` (typed `status` / `method` / `tags` filters).

### Changed

- **Signer `email` is now optional.** The API accepts WhatsApp-only signers, so
  `signers.create` requires *at least one* of `email` / `whatsapp_phone_number`
  (or the `phone` alias). The idempotent-by-email reuse only runs when an email
  is supplied; WhatsApp-only signers are always created fresh. `ISigner.email`
  is now `string | null`.
- `assignments.resetExpiration` accepts `string | null` — passing `null` clears
  the expiration (previously the value was silently dropped).
- Document/template types now expose the `tags` (and template
  `default_document_tags`) arrays returned by the API; `IDocumentActivity.origin`
  is typed as the `{ ip, user-agent }` object the API actually returns, with the
  event `payload` snapshot added.

### Tests

86 unit tests pass (`bun test`). New `tags` and `documents` suites cover Tag CRUD
and document-tag attach/detach; new signer tests cover WhatsApp-only creation and
CPF normalisation. All read and write paths re-verified against the live API
(`scripts/live-smoke.ts --write`).

## [1.3.0] - 2026-05-12

100% endpoint coverage of [the live API docs](https://api.assinafy.com.br/v1/docs).
Audited file-by-file and validated end-to-end against the live API.

### Added

- **`AuthenticationResource`** (new — `client.auth`): `login`, `socialLogin`,
  `createApiKey`, `getApiKey`, `deleteApiKey`, `changePassword`,
  `requestPasswordReset`, `resetPassword`.
- **`FieldsResource`** (new — `client.fields`): full CRUD for field definitions,
  plus `validate`, `validateMultiple`, and `listTypes`.
- **`SignerDocumentsResource`** (new — `client.signerDocuments`) for signer-side
  flows authenticated by `signer-access-code`: `self`, `acceptTerms`,
  `verifyEmail`, `confirmData`, `getCurrent`, `list`, `download`, `signMultiple`,
  `declineMultiple`, `uploadSignature`, `downloadSignature`, `getAssignment`,
  `sign`, `decline`.
- **`DocumentResource`**: `statuses`, `getPublic`, `sendToken` (the
  `/documents/statuses`, `/public/documents/{id}`, and `/public/documents/{id}/send-token`
  endpoints).
- **`AssignmentResource`**: `listWhatsAppNotifications`
  (`GET /documents/{id}/assignments/{id}/whatsapp-notifications`).
- **`TemplateResource`**: `downloadPage`
  (`GET /accounts/{id}/templates/{id}/pages/{page_id}/download`).
- New types: `IDocumentStatusInfo`, `IPublicDocumentInfo`, `SendTokenChannel`,
  `ILoginResponse`, `IApiKeyResponse`, `IMaskedApiKeyResponse`,
  `IFieldDefinition`, `ICreateFieldPayload`, `IUpdateFieldPayload`,
  `IFieldType`, `IFieldValidationResult`, `IFieldValidateMultipleEntry`,
  `IWhatsAppNotification`, `ISignFieldEntry`. Added `has_signature`,
  `has_initial`, and `resource` fields to `ISigner`.
- `ClientConfigInput` and `buildAssignmentPayload` are now re-exported from
  the package entry point for advanced use cases.
- Live smoke-test script (`scripts/live-smoke.ts`) covering every read-only
  endpoint plus optional `--write` and `--upload` modes.

### Tests

70 unit tests pass (`bun test`). New suites cover the authentication, fields,
and signer-documents resources. Build + ESM/CJS bundles validated against the
live API.

## [1.2.0] - 2026-05-06

Full API parity audit. Adds the Template resource and missing Document operations, and aligns signer
fields (`cpf`, `whatsapp_phone_number`) with the PHP SDK and n8n node.

### Added

- **`TemplateResource`** (new class exposed as `client.templates`):
  - `list(params?, accountId?)` — `GET /accounts/{accountId}/templates`
  - `get(templateId, accountId?)` — `GET /accounts/{accountId}/templates/{templateId}`
- **`DocumentResource`**:
  - `createFromTemplate(templateId, signers, options?, accountId?)` — `POST /accounts/{accountId}/templates/{templateId}/documents`
  - `estimateCostFromTemplate(templateId, signers, accountId?)` — `POST /accounts/{accountId}/templates/{templateId}/documents/estimate-cost`
  - `verify(hash)` — `GET /documents/{hash}/verify`
- **`cpf` field** in `ICreateSignerPayload`, `IUpdateSignerPayload`, `ISigner`, and `IUploadAndRequestSignaturesSigner`. The `normaliseSignerPayload` helper strips non-digit characters before sending (mirrors PHP SDK `sanitizeDocument` behaviour).
- New types: `ITemplateListItem`, `ITemplateListResponse`, `ITemplateDetailsResponse`, `ITemplateRole`, `ITemplateSigner`, `ICreateDocumentFromTemplateOptions`.
- `TemplateResource` exported from `index.ts`.

## [1.1.1] - 2026-04-28

### Changed

- Renamed package to `@assinafy/sdk` and configured dual-publish to npmjs.com and GitHub Packages.

## [1.1.0] - 2026-04-25

### Added

- `AssignmentResource.estimateCost`, `resendNotification`, `estimateResendCost`, `resetExpiration`, `cancel`.
- `DocumentResource.thumbnail`, `downloadPage`, `activities`, `isFullySigned`, `getSigningProgress`, `waitUntilReady`.
- `WorkspaceResource.update`, `delete`.
- `WebhookResource.inactivate`, `listEventTypes`, `listDispatches`, `retryDispatch`.
- High-level `uploadAndRequestSignatures` helper on `AssinafyClient`.
- `PaginatedResult<T>` with parsed `X-Pagination-*` header meta.

[Unreleased]: https://github.com/assinafy/typescript-sdk/compare/v2.2.0...HEAD
[2.2.0]: https://github.com/assinafy/typescript-sdk/compare/v2.1.2...v2.2.0
[2.1.2]: https://github.com/assinafy/typescript-sdk/compare/v2.1.1...v2.1.2
[2.1.1]: https://github.com/assinafy/typescript-sdk/compare/v2.1.0...v2.1.1
[2.1.0]: https://github.com/assinafy/typescript-sdk/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/assinafy/typescript-sdk/releases/tag/v2.0.0
[1.5.0]: https://github.com/assinafy/typescript-sdk/releases/tag/v1.5.0
[1.4.0]: https://github.com/assinafy/typescript-sdk/releases/tag/v1.4.0
[1.3.0]: https://github.com/assinafy/typescript-sdk/releases/tag/v1.3.0
[1.2.0]: https://github.com/assinafy/typescript-sdk/releases/tag/v1.2.0
[1.1.1]: https://github.com/assinafy/typescript-sdk/releases/tag/v1.1.1
[1.1.0]: https://github.com/assinafy/typescript-sdk/releases/tag/v1.1.0
