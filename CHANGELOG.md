# Changelog

All notable changes to `@assinafy/sdk` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.5.0]: https://github.com/assinafy/typescript-sdk/releases/tag/v1.5.0
[1.4.0]: https://github.com/assinafy/typescript-sdk/releases/tag/v1.4.0
[1.3.0]: https://github.com/assinafy/typescript-sdk/releases/tag/v1.3.0
[1.2.0]: https://github.com/assinafy/typescript-sdk/releases/tag/v1.2.0
[1.1.1]: https://github.com/assinafy/typescript-sdk/releases/tag/v1.1.1
[1.1.0]: https://github.com/assinafy/typescript-sdk/releases/tag/v1.1.0
