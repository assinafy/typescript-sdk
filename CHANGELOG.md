# Changelog

All notable changes to `@assinafy/sdk` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.3.0]: https://github.com/assinafy/typescript-sdk/releases/tag/v1.3.0
[1.2.0]: https://github.com/assinafy/typescript-sdk/releases/tag/v1.2.0
[1.1.1]: https://github.com/assinafy/typescript-sdk/releases/tag/v1.1.1
[1.1.0]: https://github.com/assinafy/typescript-sdk/releases/tag/v1.1.0
