# API compatibility

The SDK targets the official Assinafy contract at
[`/v1/docs/openapi.json`](https://api.assinafy.com.br/v1/docs/openapi.json) and
keeps compatibility behavior narrow, explicit, and typed. This document records
the differences observed during the 2026-08-06 contract and sandbox audit. It
contains no credentials, account identifiers, signer data, or reusable test
artifacts. The audited OpenAPI response's SHA-256 digest is
`7e5957082002e8e96c5abc2cadf7b4b463eaa5bd61b76e26f64b90a8b922088c`.

The governing rule is simple: new integrations should send the published
contract. A compatibility path is used only when the caller selects it
explicitly or the server returns a validation error that unambiguously requests
the older shape.

## Template management live extensions

The current OpenAPI document contains only:

```text
GET /v1/accounts/{accountId}/templates
```

The live API additionally exposes five routes used by existing integrations:

```text
POST   /v1/accounts/{accountId}/templates
GET    /v1/accounts/{accountId}/templates/{templateId}
PUT    /v1/accounts/{accountId}/templates/{templateId}
DELETE /v1/accounts/{accountId}/templates/{templateId}
GET    /v1/accounts/{accountId}/templates/{templateId}/pages/{pageId}/download
```

They map to `client.templates.create`, `get`, `update`, `delete`, and
`downloadPage`. They are documented and tested as **live compatibility
extensions**, not counted as official OpenAPI operations. Their absence from a
future schema is not by itself grounds for removal; removal requires a live
regression test, a deprecation period, and a major-version decision.

Template status examples have also differed in casing (`Uploaded`/`Ready` in
live extension responses versus `uploaded`/`ready` in the published schema).
The exported type intentionally remains `string`. Applications should normalize
before comparing:

```ts
if (template.status.toLowerCase() === 'ready') {
  // rendered pages are available
}
```

## Public send-token request

The official operation is:

```http
PUT /v1/public/documents/{documentId}/send-token
Content-Type: application/json

{ "email": "signer@example.com" }
```

That is the default SDK call:

```ts
await client.documents.sendToken(documentId, 'signer@example.com');
```

Some older environments require `{ recipient, channel }`. The explicit
three-argument overload sends that shape:

```ts
await client.documents.sendToken(documentId, '+5511999990000', 'whatsapp');
```

For a two-argument call, the SDK starts with `{ email }` and retries the older
email shape only when the API's validation body specifically says that
`recipient` or `channel` is required. Unrelated errors are never swallowed or
retried under this compatibility rule.

## Document tag identifiers

The current OpenAPI request schemas for replacing and attaching document tags
define `tags` as an array of existing **tag IDs**. The SDK follows that contract:

```ts
const tag = await client.tags.create({ name: 'Contracts' });
await client.documents.addTags(documentId, [tag.id]);
await client.documents.replaceTags(documentId, [tag.id]);
```

Older environments have accepted tag names and auto-created unknown names. The
wire type remains `string[]` so those deployments are not broken, but name-based
attachment is a legacy extension and is not the documented default. Production
code should create/list tags first and submit IDs.

## Account branding fields on create and update

The official `Account` response schema includes `primary_color` and
`secondary_color`, while the current create/update request schemas list only
`name` and `notification_sender_type`. The sandbox also accepts the two color
fields on create/update, and the SDK preserves them for existing integrations.
They must be six hexadecimal characters without a leading `#`.

The sandbox audited on 2026-08-06 rejects the official optional
`notification_sender_type` field with `400` on account creation, while accepting
the same field on update. The SDK still exposes and sends it because it is part
of the production OpenAPI contract. The live audit creates its prerequisite
workspace with a name only, then tests the field independently via update so
the create-side deployment lag cannot prevent the rest of the suite.

The branding read and file operations—`getTheme`, `downloadLogo`, `uploadLogo`,
and `deleteLogo`—are official operations and are not extensions.

## Field-definition request extensions

The official field-create body defines `type`, `name`, nullable `regex`, and
`is_required`; the update body defines `name`, nullable `regex`, and
`is_active`. The audited sandbox also accepts `is_active` on create and
`type`/`is_required` on update. Those three properties remain typed as explicit
live extensions so existing integrations keep working. New code should prefer
the operation-specific official fields.

The field-validation schemas also omit the `signer-access-code` query parameter
accepted by signer-portal deployments. `fields.validate` and `validateMultiple`
retain the typed `signerAccessCode` option for those deployments. The 2026-08-06
full audit exercised account-authenticated validation; it did not have the
signer-code fixture needed to re-certify this compatibility query.

## Retained signer request compatibility

The current signer create/update schemas use `full_name`, `email`, and
`whatsapp_phone_number`. The SDK also retains three older integration inputs:

- `phone` is a client-only alias normalized to `whatsapp_phone_number` before
  transmission;
- `cpf` is normalized to digits and forwarded; and
- create-time `metadata` is forwarded unchanged.

These inputs remain source-compatible because removing them without a live
regression would break existing consumers. They were unit/request-contract
tested but were not separately re-probed in the 2026-08-06 disposable signer
matrix, so new integrations should prefer only the published fields.

The official signer `confirm-data` body contains only `full_name`, `email`, and
`government_id`. Its primary overload exposes exactly those fields. A deprecated
compatibility overload retains `whatsapp_phone_number`, which was not live-
certified in this audit. It also preserves the pre-audit `has_accepted_terms`
pass-through because that behavior could not be live-tested with the supplied
fixtures. This field is outside the current contract and must **not** be treated
as legal consent or as a substitute for the separate official `acceptTerms()`
request. Production signer UIs should call `acceptTerms()` explicitly.

## Signature-image media type

`POST /signature` officially accepts a raw `image/png` body. That is the SDK's
typed/default request and the only media type claimed by the API contract. The
deprecated `contentType` compatibility overload is retained so older consumers
are not silently broken, but non-PNG values were not live-certified because the
provided audit fixtures contained no signer access code or legal-consent flow.
Do not use the override in new integrations without verifying the target
deployment.

## Document upload metadata

The multipart upload schema documents the PDF file but not the SDK's optional
JSON `metadata` part. The audited sandbox accepted and processed a disposable
document carrying metadata on 2026-08-06. The option remains an explicit live
extension; callers should treat metadata keys and values as application-owned,
opaque JSON.

## Reset-expiration null and public signer-download compatibility

The reset-expiration schema declares `expires_at` as a date-time string. The SDK
retains `null` as a compatibility value used by older integrations to clear an
expiration, but the full live audit tested only a future timestamp; `null` is
unit/request-contract tested and remains live-unverified.

The signer artifact download is the opposite case: OpenAPI explicitly marks it
public and defines no `signer-access-code` query. The official three-argument SDK
call therefore sends no code. An optional fourth code remains available for
older deployments, but it is a compatibility query rather than part of the
published operation.

## Resend-cost response variants

The published
`POST /documents/{documentId}/assignments/{assignmentId}/signers/{signerId}/estimate-resend-cost`
response references the full `CostEstimate` schema. A smaller resend-specific
shape has also been observed live. The SDK therefore returns the honest union
`IResendCostEstimate`:

```ts
const estimate = await client.assignments.estimateResendCost(
  documentId,
  assignmentId,
  signerId,
);

if ('total_credits' in estimate) {
  console.log(estimate.has_sufficient_resources);
} else {
  console.log(estimate.total, estimate.has_sufficient_credits);
}
```

The SDK does not synthesize missing fields, so callers never mistake invented
zeroes for server-provided balances.

## Public-document response variants

The official `GET /public/documents/{documentId}` response references the full
`Document` schema. Older public responses can be compact and expose only fields
such as `id`, `name`, `page_count`, and `created_by`. `IPublicDocumentInfo`
requires the stable `id` and `name`, makes expanded document fields optional,
and retains the compact fields. Check optional fields before using them:

```ts
const document = await client.documents.getPublic(documentId);
if (document.pages) {
  console.log(document.pages.length);
} else {
  console.log(Number(document.page_count ?? 0));
}
```

## Empty acknowledgements

Several write operations return a successful status/message envelope with no
`data` field, while a few older responses use an empty array or object. Methods
whose contract has no meaningful result resolve to `Promise<void>` and validate
the HTTP/envelope status. This applies to token dispatch, signer OTP/terms,
signature-image upload, bulk signer actions, and deletion operations. Success is
not represented as a fabricated object.

## Webhook signature verification is not in the OpenAPI contract

The official webhook operations define subscription management, event types,
delivery history, and retry. The current OpenAPI document does **not** define a
shared-secret field, signature algorithm, digest encoding, or signature header
for incoming deliveries.

`client.webhookVerifier` is retained as an opt-in HMAC-SHA256 utility for
environments whose separate Assinafy agreement provides a shared secret and a
hex digest. Confirm the header name and signing procedure with Assinafy for the
target environment before enforcing it. Do not assume an
`X-Assinafy-Signature` header solely from this SDK.

## Authentication isolation

Public documents, login/social login, password-reset, OAuth URL, and
signer-access-code flows use a separate HTTP transport without `X-Api-Key` or
`Authorization` defaults. This is a security boundary rather than a
wire-contract deviation: a credentialless `new AssinafyClient()` can drive
those flows, and credentials configured for protected resources are not leaked
to them.

Protected methods still use the authenticated transport and receive the API's
normal `401` response if credentials are absent or invalid.

## Sandbox user and statistics deployment lag

The current OpenAPI schema defines `GET /users/self` as a direct `AuthUser`
payload. The sandbox audited on 2026-08-06 still wraps that value as
`{ user, accounts }` and adds `user.is_password_set`. `users.getCurrent()`
normalizes both forms to `IAuthenticatedUser`; `is_password_set` is an optional
live-compatibility field.

The same sandbox returns `404` for the official `GET /users/self/stats` and
`GET /accounts/{accountId}/stats` routes. The production host recognizes both
routes (an unauthenticated probe receives `401`), so the SDK retains the exact
published paths and types. The live audit reports those sandbox-only `404`s as
explicit `SKIP`s rather than claiming they passed or rewriting calls to an
undocumented route.

## Updating this record

When the upstream API changes:

1. Diff the new official OpenAPI paths and schemas against the snapshot date
   above.
2. Add or update typed methods and request/response tests.
3. Verify live-only behavior in the sandbox without logging secrets or tokens.
4. Update [API_COVERAGE.md](API_COVERAGE.md) and this file in the same change.
5. Keep compatibility behavior isolated and feature-detectable; do not silently
   broaden retries or coerce malformed success payloads.
