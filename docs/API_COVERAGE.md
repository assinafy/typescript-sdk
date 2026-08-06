# API coverage

This ledger maps the official Assinafy OpenAPI document to the public SDK API.
It was reconciled on 2026-08-06 against
[`GET /v1/docs/openapi.json`](https://api.assinafy.com.br/v1/docs/openapi.json):
68 paths, 89 HTTP operations, and 37 component schemas. The audited response's
SHA-256 digest is
`7e5957082002e8e96c5abc2cadf7b4b463eaa5bd61b76e26f64b90a8b922088c`.

All paths below include the `/v1` prefix shown by the OpenAPI document. The
SDK's default `baseUrl` already ends in `/v1`, so resource implementations use
the corresponding relative path without repeating that prefix.

Status meanings:

- **Covered** — a public, typed SDK method sends the operation.
- **URL helper** — the operation is a browser redirect/callback; the SDK builds
  its absolute URL instead of following it inside the server process.
- **Live extension** — verified route retained for compatibility, but absent
  from the current OpenAPI path set and excluded from the 89-operation total.

## Accounts — 10/10

| Method | Path | SDK method | Status |
| --- | --- | --- | --- |
| `GET` | `/v1/accounts` | `client.workspaces.list()` | Covered |
| `POST` | `/v1/accounts` | `client.workspaces.create(payload)` | Covered |
| `GET` | `/v1/accounts/{accountId}` | `client.workspaces.get(accountId)` | Covered |
| `PUT` | `/v1/accounts/{accountId}` | `client.workspaces.update(accountId, payload)` | Covered |
| `DELETE` | `/v1/accounts/{accountId}` | `client.workspaces.delete(accountId, options?)` | Covered |
| `GET` | `/v1/accounts/{accountId}/theme` | `client.workspaces.getTheme(accountId)` | Covered |
| `GET` | `/v1/accounts/{accountId}/logo` | `client.workspaces.downloadLogo(accountId)` | Covered |
| `POST` | `/v1/accounts/{accountId}/logo` | `client.workspaces.uploadLogo(accountId, source)` | Covered |
| `DELETE` | `/v1/accounts/{accountId}/logo` | `client.workspaces.deleteLogo(accountId)` | Covered |
| `GET` | `/v1/accounts/{accountId}/stats` | `client.workspaces.getStats(accountId, params?)` | Covered |

## Assignments — 7/7

| Method | Path | SDK method | Status |
| --- | --- | --- | --- |
| `GET` | `/v1/assignments` | `client.assignments.list(params?, accountId?)` | Covered |
| `POST` | `/v1/documents/{documentId}/assignments` | `client.assignments.create(documentId, payload)` | Covered |
| `POST` | `/v1/documents/{documentId}/assignments/estimate-cost` | `client.assignments.estimateCost(documentId, payload)` | Covered |
| `PUT` | `/v1/documents/{documentId}/assignments/{assignmentId}/signers/{signerId}/resend` | `client.assignments.resendNotification(documentId, assignmentId, signerId)` | Covered |
| `POST` | `/v1/documents/{documentId}/assignments/{assignmentId}/signers/{signerId}/estimate-resend-cost` | `client.assignments.estimateResendCost(documentId, assignmentId, signerId)` | Covered |
| `PUT` | `/v1/documents/{documentId}/assignments/{assignmentId}/reset-expiration` | `client.assignments.resetExpiration(documentId, assignmentId, expiresAt)` | Covered |
| `GET` | `/v1/documents/{documentId}/assignments/{assignmentId}/whatsapp-notifications` | `client.assignments.listWhatsAppNotifications(documentId, assignmentId)` | Covered |

## Authentication — 11/11

| Method | Path | SDK method | Status |
| --- | --- | --- | --- |
| `GET` | `/v1/auth/authenticate` | `client.auth.getSocialLoginUrl(authClient?)` | URL helper |
| `GET` | `/v1/login-callback` | `client.auth.getSocialLoginCallbackUrl()` | URL helper |
| `POST` | `/v1/login` | `client.auth.login(email, password)` | Covered |
| `PUT` | `/v1/authentication/request-password-reset` | `client.auth.requestPasswordReset(email)` | Covered |
| `PUT` | `/v1/authentication/reset-password` | `client.auth.resetPassword(payload)` | Covered |
| `PUT` | `/v1/authentication/change-password` | `client.auth.changePassword(payload)` | Covered |
| `POST` | `/v1/authentication/social-login` | `client.auth.socialLogin(payload)` | Covered |
| `POST` | `/v1/auth/link-social-login` | `client.auth.linkSocialLogin(payload)` | Covered |
| `GET` | `/v1/users/api-keys` | `client.auth.getApiKey()` | Covered |
| `POST` | `/v1/users/api-keys` | `client.auth.createApiKey(password)` | Covered |
| `DELETE` | `/v1/users/api-keys` | `client.auth.deleteApiKey()` | Covered |

## Documents — 18/18

| Method | Path | SDK method | Status |
| --- | --- | --- | --- |
| `GET` | `/v1/accounts/{accountId}/documents` | `client.documents.list(params?, accountId?)` | Covered |
| `POST` | `/v1/accounts/{accountId}/documents` | `client.documents.upload(source, options?)` | Covered |
| `GET` | `/v1/accounts/{accountId}/documents/search` | `client.documents.search(params?, accountId?)` | Covered |
| `GET` | `/v1/documents/statuses` | `client.documents.statuses()` | Covered |
| `GET` | `/v1/documents/{documentId}` | `client.documents.details(documentId)` / `get(documentId)` | Covered |
| `DELETE` | `/v1/documents/{documentId}` | `client.documents.delete(documentId)` | Covered |
| `PATCH` | `/v1/documents/{documentId}` | `client.documents.rename(documentId, name)` | Covered |
| `GET` | `/v1/documents/{documentId}/activities` | `client.documents.activities(documentId)` | Covered |
| `GET` | `/v1/documents/{documentId}/download/{artifactName}` | `client.documents.download(documentId, artifactName)` | Covered |
| `GET` | `/v1/documents/{documentSignatureHash}/verify` | `client.documents.verify(documentSignatureHash)` | Covered |
| `GET` | `/v1/documents/{documentId}/thumbnail` | `client.documents.thumbnail(documentId)` | Covered |
| `GET` | `/v1/documents/{documentId}/pages/{pageId}/download` | `client.documents.downloadPage(documentId, pageId)` | Covered |
| `GET` | `/v1/accounts/{accountId}/documents/{documentId}/tags` | `client.documents.listTags(documentId, accountId?)` | Covered |
| `PUT` | `/v1/accounts/{accountId}/documents/{documentId}/tags` | `client.documents.replaceTags(documentId, tagIds, accountId?)` | Covered |
| `POST` | `/v1/accounts/{accountId}/documents/{documentId}/tags` | `client.documents.addTags(documentId, tagIds, accountId?)` | Covered |
| `DELETE` | `/v1/accounts/{accountId}/documents/{documentId}/tags/{tagId}` | `client.documents.detachTag(documentId, tagId, accountId?)` | Covered |
| `POST` | `/v1/accounts/{accountId}/templates/{templateId}/documents` | `client.documents.createFromTemplate(templateId, signers, options?, accountId?)` | Covered |
| `POST` | `/v1/accounts/{accountId}/templates/{templateId}/documents/estimate-cost` | `client.documents.estimateCostFromTemplate(templateId, signers, accountId?)` | Covered |

## Fields — 8/8

| Method | Path | SDK method | Status |
| --- | --- | --- | --- |
| `GET` | `/v1/accounts/{accountId}/fields` | `client.fields.list(params?, accountId?)` | Covered |
| `POST` | `/v1/accounts/{accountId}/fields` | `client.fields.create(payload, accountId?)` | Covered |
| `GET` | `/v1/accounts/{accountId}/fields/{fieldId}` | `client.fields.get(fieldId, accountId?)` | Covered |
| `PUT` | `/v1/accounts/{accountId}/fields/{fieldId}` | `client.fields.update(fieldId, payload, accountId?)` | Covered |
| `DELETE` | `/v1/accounts/{accountId}/fields/{fieldId}` | `client.fields.delete(fieldId, accountId?)` | Covered |
| `POST` | `/v1/accounts/{accountId}/fields/{fieldId}/validate` | `client.fields.validate(fieldId, value, options?)` | Covered |
| `POST` | `/v1/accounts/{accountId}/fields/validate-multiple` | `client.fields.validateMultiple(entries, options?)` | Covered |
| `GET` | `/v1/field-types` | `client.fields.listTypes()` | Covered |

## Signers — 5/5

| Method | Path | SDK method | Status |
| --- | --- | --- | --- |
| `GET` | `/v1/accounts/{accountId}/signers` | `client.signers.list(params?, accountId?)` | Covered |
| `POST` | `/v1/accounts/{accountId}/signers` | `client.signers.create(payload, accountId?)` | Covered |
| `GET` | `/v1/accounts/{accountId}/signers/{signerId}` | `client.signers.get(signerId, accountId?)` | Covered |
| `PUT` | `/v1/accounts/{accountId}/signers/{signerId}` | `client.signers.update(signerId, payload, accountId?)` | Covered |
| `DELETE` | `/v1/accounts/{accountId}/signers/{signerId}` | `client.signers.delete(signerId, accountId?)` | Covered |

## Signing and public flows — 17/17

All methods in this section use the auth-free transport. Most signer operations
authenticate with the `signer-access-code` query parameter required by the
OpenAPI security scheme. The artifact download is explicitly public and accepts
an optional fourth access-code argument only for legacy compatibility.

| Method | Path | SDK method | Status |
| --- | --- | --- | --- |
| `GET` | `/v1/public/documents/{documentId}` | `client.documents.getPublic(documentId)` | Covered |
| `PUT` | `/v1/public/documents/{documentId}/send-token` | `client.documents.sendToken(documentId, email)` | Covered |
| `GET` | `/v1/signers/self` | `client.signerDocuments.self(accessCode)` | Covered |
| `GET` | `/v1/signers/{signerId}/document` | `client.signerDocuments.getCurrent(signerId, accessCode)` | Covered |
| `GET` | `/v1/sign` | `client.signerDocuments.getAssignment(accessCode, hasAcceptedTerms?)` | Covered |
| `POST` | `/v1/documents/{documentId}/assignments/{assignmentId}` | `client.signerDocuments.sign(documentId, assignmentId, accessCode, entries)` | Covered |
| `PUT` | `/v1/documents/{documentId}/assignments/{assignmentId}/reject` | `client.signerDocuments.decline(documentId, assignmentId, accessCode, reason)` | Covered |
| `PUT` | `/v1/signers/documents/sign-multiple` | `client.signerDocuments.signMultiple(documentIds, accessCode)` | Covered |
| `PUT` | `/v1/signers/documents/decline-multiple` | `client.signerDocuments.declineMultiple(documentIds, reason, accessCode)` | Covered |
| `POST` | `/v1/verify` | `client.signerDocuments.verifyEmail(payload)` | Covered |
| `PUT` | `/v1/documents/{documentId}/signers/confirm-data` | `client.signerDocuments.confirmData(documentId, accessCode, payload)` | Covered |
| `PUT` | `/v1/signers/accept-terms` | `client.signerDocuments.acceptTerms(accessCode)` | Covered |
| `POST` | `/v1/signature` | `client.signerDocuments.uploadSignature(accessCode, image, options?)` | Covered |
| `GET` | `/v1/signature/{signatureType}` | `client.signerDocuments.downloadSignature(accessCode, signatureType)` | Covered |
| `GET` | `/v1/signers/{signerId}/documents` | `client.signerDocuments.list(signerId, accessCode, params?)` | Covered |
| `GET` | `/v1/signers/{signerId}/documents/search` | `client.signerDocuments.search(signerId, accessCode, search)` | Covered |
| `GET` | `/v1/signers/{signerId}/documents/{documentId}/download/{artifactName}` | `client.signerDocuments.download(signerId, documentId, artifactName)` | Covered |

## Tags — 4/4

| Method | Path | SDK method | Status |
| --- | --- | --- | --- |
| `GET` | `/v1/accounts/{accountId}/tags` | `client.tags.list(params?, accountId?)` | Covered |
| `POST` | `/v1/accounts/{accountId}/tags` | `client.tags.create(payload, accountId?)` | Covered |
| `PUT` | `/v1/accounts/{accountId}/tags/{tagId}` | `client.tags.update(tagId, payload, accountId?)` | Covered |
| `DELETE` | `/v1/accounts/{accountId}/tags/{tagId}` | `client.tags.delete(tagId, options?)` | Covered |

## Templates — 1/1 official

| Method | Path | SDK method | Status |
| --- | --- | --- | --- |
| `GET` | `/v1/accounts/{accountId}/templates` | `client.templates.list(params?, accountId?)` | Covered |

Five additional live routes are documented separately under
[Live template extensions](#live-template-extensions).

## Users — 2/2

| Method | Path | SDK method | Status |
| --- | --- | --- | --- |
| `GET` | `/v1/users/self` | `client.users.getCurrent()` | Covered |
| `GET` | `/v1/users/self/stats` | `client.users.getStats(params?)` | Covered |

## Webhooks — 6/6

| Method | Path | SDK method | Status |
| --- | --- | --- | --- |
| `GET` | `/v1/accounts/{accountId}/webhooks/subscriptions` | `client.webhooks.get(accountId?)` | Covered |
| `PUT` | `/v1/accounts/{accountId}/webhooks/subscriptions` | `client.webhooks.register(payload, accountId?)` | Covered |
| `PUT` | `/v1/accounts/{accountId}/webhooks/inactivate` | `client.webhooks.inactivate(accountId?)` | Covered |
| `GET` | `/v1/webhooks/event-types` | `client.webhooks.listEventTypes()` | Covered |
| `GET` | `/v1/accounts/{accountId}/webhooks` | `client.webhooks.listDispatches(params?, accountId?)` | Covered |
| `POST` | `/v1/accounts/{accountId}/webhooks/{historyId}/retry` | `client.webhooks.retryDispatch(historyId, accountId?)` | Covered |

## Live template extensions

These routes are available in the live API and covered by the SDK, but they do
not appear in the 2026-08-06 OpenAPI path set. They are intentionally excluded
from the official 89-operation coverage count.

| Method | Live path | SDK method | Status |
| --- | --- | --- | --- |
| `POST` | `/v1/accounts/{accountId}/templates` | `client.templates.create(source, options?)` | Live extension |
| `GET` | `/v1/accounts/{accountId}/templates/{templateId}` | `client.templates.get(templateId, accountId?)` | Live extension |
| `PUT` | `/v1/accounts/{accountId}/templates/{templateId}` | `client.templates.update(templateId, payload, accountId?)` | Live extension |
| `DELETE` | `/v1/accounts/{accountId}/templates/{templateId}` | `client.templates.delete(templateId, accountId?)` | Live extension |
| `GET` | `/v1/accounts/{accountId}/templates/{templateId}/pages/{pageId}/download` | `client.templates.downloadPage(templateId, pageId, accountId?)` | Live extension |

## SDK conveniences

These helpers compose or derive official operations and therefore do not add to
the endpoint count:

- `client.uploadAndRequestSignatures(options)` validates the complete input,
  uploads a document, waits for metadata readiness, reuses or creates signers,
  creates an assignment, and optionally fetches the final document snapshot.
- `client.documents.waitUntilReady(documentId, options?)` polls the official
  document-details operation with terminal-state and timeout handling.
- `client.documents.isFullySigned(documentId)` and
  `getSigningProgress(documentId)` derive state from document details.
- `client.signers.findByEmail(email, accountId?)` uses the official signer list.
- `client.webhookVerifier` parses webhook envelopes and optionally verifies a
  caller-configured HMAC contract; signature verification itself is not in the
  current OpenAPI document.

For request and response payload definitions, use the exported TypeScript
interfaces and each method's JSDoc examples together with the
[official API reference](https://api.assinafy.com.br/v1/docs). Contract
differences that require compatibility handling are recorded in
[COMPATIBILITY.md](COMPATIBILITY.md).
