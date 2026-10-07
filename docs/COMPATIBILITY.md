# API compatibility

The SDK targets the official Assinafy contract at
[`/v1/docs/openapi.json`](https://api.assinafy.com.br/v1/docs/openapi.json).
New integrations should send the published request shape. Compatibility paths
are narrow, typed, and used only when a caller selects one or when a validation
response unambiguously requests an older shape.

## Host availability

The production contract includes these account and authenticated-user routes:

```text
GET, POST          /v1/accounts
GET, PUT, DELETE   /v1/accounts/{accountId}
GET, POST, DELETE  /v1/accounts/{accountId}/logo
GET                /v1/accounts/{accountId}/theme
GET                /v1/accounts/{accountId}/stats
GET                /v1/users/self
GET, PUT           /v1/users/self/notification-preferences
GET                /v1/users/self/stats
GET                /v1/users/self/mfa (and the two-factor management routes)
POST               /v1/authentication/mfa/verify
GET, POST          /v1/accounts/{accountId}/webhooks/endpoints (and per-endpoint routes)
```

Sandbox deployments can return `404` for user statistics, account statistics,
notification preferences, two-factor routes, or webhook endpoint routes while still accepting the production methods on
the production host. The SDK keeps the official paths and response types. A
sandbox `404` does not cause the client to route a request elsewhere.

Two browser URL helpers used by older deployments remain available:

```text
GET /v1/auth/authenticate
GET /v1/login-callback
```

They map to `auth.getSocialLoginUrl()` and
`auth.getSocialLoginCallbackUrl()` and are not part of the official
106-operation total.

The SDK also includes the production contract additions for:

- the `pades` document artifact;
- `DigitalCertificate` verification on assignment and template-document
  creation and cost estimation;
- typed `display_settings` for collect fields;
- signer `government_id` updates;
- signature-image `reuse`;
- the documented `400` response from `GET /sign`; and
- the dedicated `SignerSelf` response fields.

Older signer-self responses can omit `has_signature`, `has_initial`, and
`is_signature_reusable`; assignment signers can omit `notification_history`.
Those fields are optional in the SDK response types.

`DocumentStatsRow` separates notification-channel counters from verification
method counters. Notification counters are not mutually exclusive.
`signature_requests_verification_{email,whatsapp,bypass,digital_certificate}`
are mutually exclusive and sum to `signature_requests`. Older unsuffixed email
and WhatsApp counters remain optional.

## OAuth uses separate API and authorization hosts

The flow deliberately spans two hosts, which no other part of this SDK does:

```text
GET   https://api.assinafy.com.br/.well-known/oauth-protected-resource   # host root, NOT /v1
GET   https://auth.assinafy.com.br/.well-known/oauth-authorization-server
GET   https://auth.assinafy.com.br/oauth/authorize                       # browser only
POST  https://api.assinafy.com.br/v1/oauth/token
POST  https://api.assinafy.com.br/v1/oauth/revoke
GET   https://api.assinafy.com.br/v1/oauth/userinfo
```

`getProtectedResourceMetadata()` therefore builds its URL from the configured
base URL's **origin**, not from `baseUrl` itself, and
`getAuthorizationServerMetadata()` issues a cross-host request on the
credential-free transport.

The sandbox has its own authorization server at
`https://auth-sandbox.assinafy.com.br`, with the consent screen at
`/oauth/authorize`. Both discovery documents are available, and its OpenAPI
contract includes the token, revocation and userinfo routes. Discover the
sandbox issuer from its API origin:

```ts
const client = new AssinafyClient({ baseUrl: 'https://sandbox.assinafy.com.br/v1' });
const metadata = await client.oauth.getAuthorizationServerMetadata();
const request = await client.oauth.createAuthorizationUrl({
  clientId: process.env.ASSINAFY_CLIENT_ID!,
  redirectUri: 'https://myapp.example.com/oauth/callback',
  scopes: ['documents:read', 'account:read', 'offline_access'],
});
```

Register the application in the matching environment. Production and sandbox
use different issuers, clients, credentials and workspace IDs; keep the entire
connection in one environment. Token, revocation and userinfo requests use the
configured `baseUrl`. Use a temporary HTTPS tunnel for local callbacks and
register its exact callback URL before starting the connection.

Response shapes diverge from the rest of the API on purpose:

| Operation | Success body | Error body |
| --- | --- | --- |
| Discovery documents | bare metadata object (RFC 8615) | — |
| `POST /oauth/token`, `POST /oauth/revoke` | flat, no envelope (RFC 6749 §5.1) | flat `{ error, error_description }` (§5.2) |
| `GET /oauth/userinfo` | flat claims object (OIDC Core §5.3.2) | the usual `{ status, message, data }` envelope |

Both JSON and `application/x-www-form-urlencoded` bodies are accepted by the
token and revocation endpoints, and the production OpenAPI document lists both.
The SDK sends `application/x-www-form-urlencoded`: the encoding RFC 6749 and
RFC 7009 define and the OAuth Integration Guide uses.

The RFC 8707 `resource` indicator defaults to the configured API origin, and is
omitted when that origin is a loopback `http://` host — the shape used by mock
servers and the packed-consumer smoke test, which has no valid resource
identifier.

## List pagination

Two behaviours of the list endpoints are silent rather than loud, so neither
surfaces as an error a caller could react to:

- Only the hyphenated `per-page` is read. `per_page` is accepted and discarded,
  and the response falls back to the default of 20 rows. The SDK normalizes
  `per_page` to `per-page` on every list method, and an explicit `per-page`
  wins if both are supplied.
- `per-page` is clamped to **50**. A request for 100 returns 50 rows with a
  `200`, so page-size arithmetic based on the requested value is wrong by half.
  That maximum is exported as `MAX_LIST_PAGE_SIZE`.

```ts
import { MAX_LIST_PAGE_SIZE } from '@assinafy/sdk';

const { data, meta } = await client.documents.list({ 'per-page': MAX_LIST_PAGE_SIZE });
// meta is read from the X-Pagination-* response headers, so it reports the
// page size the server actually applied — prefer it over the requested value.
```

`signers.findByEmail()` pins this maximum for its single lookup request.

## Assignment list account context

`GET /v1/assignments` requires the workspace in the camel-case `accountId`
query parameter even though most account-scoped routes place it in the path.
The SDK obtains it from the optional method argument or the client default:

```ts
const page = await client.assignments.list(
  { page: 1, 'per-page': 20 },
  'account-id',
);
// Request query: ?page=1&per-page=20&accountId=account-id
// Response: { data: IAssignment[], meta?: PaginationMeta }
```

If neither source supplies an account ID, the SDK throws `ValidationError`
before making the request.

## Template management extensions

The official OpenAPI document contains only:

```text
GET /v1/accounts/{accountId}/templates
```

Existing integrations can also use these routes:

```text
POST   /v1/accounts/{accountId}/templates
GET    /v1/accounts/{accountId}/templates/{templateId}
PUT    /v1/accounts/{accountId}/templates/{templateId}
DELETE /v1/accounts/{accountId}/templates/{templateId}
GET    /v1/accounts/{accountId}/templates/{templateId}/pages/{pageId}/download
```

They map to `templates.create`, `get`, `update`, `delete`, and `downloadPage`
and are excluded from the official operation count. Template status casing can
vary, so normalize before branching:

```ts
if (template.status.toLowerCase() === 'ready') {
  // rendered pages are available
}
```

A page object's `download_url` is protected by account authentication. Prefer
`templates.downloadPage(templateId, pageId)` so the SDK attaches credentials
and returns the JPEG bytes as a `Buffer`.

## Public send-token request

The official operation sends an email body:

```http
PUT /v1/public/documents/{documentId}/send-token
Content-Type: application/json

{ "email": "signer@example.com" }
```

```ts
await client.documents.sendToken(documentId, 'signer@example.com');
```

Older environments can require `{ recipient, channel }`. The explicit
three-argument overload sends that shape:

```ts
await client.documents.sendToken(documentId, '+5511999990000', 'whatsapp');
```

For a two-argument call, the SDK starts with `{ email }` and retries the older
email shape only when the validation response names `recipient` or `channel` as
required. Other errors are returned unchanged.

## Document tags

Replace and attach requests require existing tag IDs:

```ts
const tag = await client.tags.create({ name: 'Contracts', color: '#ff8800' });
await client.documents.addTags(documentId, [tag.id]);
await client.documents.replaceTags(documentId, [tag.id]);
const result = await client.documents.detachTag(documentId, tag.id);
// result → { detached: true }
```

The API accepts a tag color with or without a leading `#` and returns the
stored six-character value without it. Unknown tag names are not the normal
attachment input; create or list the tag first and send its ID. An empty array
passed to `replaceTags` detaches every tag.

## Account branding fields

The official account create/update request schemas define `name` and
`notification_sender_type`. The response includes `primary_color` and
`secondary_color`. Some deployments also accept those two color fields on
create/update, so the SDK retains them as optional inputs. Account colors must
be six hexadecimal characters without a leading `#`.

Some sandbox plans reject `notification_sender_type` during account creation
while accepting it on update. If that occurs, create with `{ name }` and apply
the sender type in a separate update. `getTheme`, `downloadLogo`, `uploadLogo`,
and `deleteLogo` are official operations.

`workspaces.delete(accountId, { force: true })` requests cancellation of an
active paid subscription as part of account deletion. It is not a general
override for unrelated deletion restrictions.

## Field-definition extensions

The official field-create body defines `type`, `name`, nullable `regex`, and
`is_required`; update defines `name`, nullable `regex`, and `is_active`. The SDK
also retains `is_active` on create and `type` or `is_required` on update for
deployments that accept them. New code should prefer the operation-specific
official fields.

The field-validation schemas omit the `signer-access-code` query parameter used
by some signer portals. `fields.validate()` and `validateMultiple()` retain the
typed `signerAccessCode` option for those environments.

## Signer request extensions

The official signer schemas use `full_name`, `email`, `whatsapp_phone_number`,
and `government_id` on both create and update. `government_id` is sent as given:
the API strips formatting itself and keeps the letters of an alphanumeric CNPJ
(`12.ABC.345/01DE-35` is stored as `12ABC34501DE35`). Three older integration
inputs remain accepted:

- `phone` is normalized to `whatsapp_phone_number` before transmission;
- `cpf` is normalized to digits and forwarded; and
- create-time `metadata` is forwarded unchanged.

New integrations should use the official fields, including `government_id`. `cpf` is not an alias for the official update field, and signer
responses do not return it.

## Digital certificate and collect placement

`DigitalCertificate` requires the account feature, a CPF or CNPJ stored in the
signer's `government_id`, and exactly one certificate signer in that signing
step. It costs two credits per signer in addition to the selected notification
cost. Notification methods remain `Email` and `Whatsapp`.

For a `collect` assignment, each field can include `display_settings`.
`left`, `top`, `width`, `height`, and `fontSize` are required; `fontFamily` and
`backgroundColor` are optional. Values use Assinafy's 150-DPI page-image pixels
from the upper-left corner and must stay within the page.

## Document responses and artifacts

`documents.rename()` can return a document without `pages` or `assignment`.
`IRenameDocumentResponse` therefore keeps those two properties optional while
retaining the other document fields.

`documents.details()` returns `decline_reason` only when the access token
belongs to the document creator. Do not infer the absence of a decline merely
because that field is missing for another authenticated user.

Owner and signer downloads accept `original`, `certificated`,
`certificate-page`, `pades`, and `bundle`:

- `pades` exists only when the document had an ICP-Brasil certificate signer;
- `bundle` is a ZIP containing `original`, `certificated`, and
  `certificate-page`, plus `pades` when it exists; and
- a generated artifact can return `404` until processing or certification is
  complete.

Document and page download URLs in JSON responses are protected. Prefer the
typed download methods so credentials are applied and binary data is returned
as a `Buffer`.

## Signer-side preconditions

The signer `confirm-data` body contains `full_name`, `email`,
`government_id`, and `has_accepted_terms`. A certificate signer must confirm
data and accept terms before `getAssignment()`; either send
`has_accepted_terms: true` with `confirmData()` or call `acceptTerms()` first.
The `has_accepted_terms` query on `getAssignment()` is too late to open that
gate for a certificate signer.

`getAssignment()` uses `GET /sign`, but the API records the signer as having
viewed the assignment. The SDK therefore excludes this request from automatic
HTTP 429 replay.

`sign()` sends a non-empty array of `{ itemId, fieldId, pageId, value }` and is
intended for collect assignments. A virtual signer must confirm their data
before signing and should use `signMultiple()`, which accepts only virtual
documents. Certificate signers cannot use `sign()`; they complete the
certificate-start and certificate-complete browser flow.

Signature image upload sends raw PNG bytes with `Content-Type: image/png`.
`reuse: true` persists the image for later documents. A deprecated
`contentType` option remains for older integrations, but the official contract
supports PNG only.

## Upload metadata and expiration reset

Document upload accepts a PDF of at most 25 MB and 2,000 pages. The multipart
schema documents the file; the SDK's optional `metadata` JSON part is retained
for deployments that accept application-owned opaque metadata.

The reset-expiration schema requires an ISO-8601 date-time string. The SDK also
accepts `null` for older integrations that clear an expiration this way. Confirm
support in the target deployment before sending `null`.

## Resend-cost response variants

The official resend-cost response is `ICostEstimate`. Older deployments can
return a compact branch, so the SDK exposes `IResendCostEstimate`:

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

The SDK does not add absent balance fields.

## Public document and signer download

The official public-document response is the full `Document` schema. Compact
responses can contain only `id`, `name`, `page_count`, and `created_by`.
`IPublicDocumentInfo` requires `id` and `name`, keeps expanded fields optional,
and retains the compact fields:

```ts
const document = await client.documents.getPublic(documentId);
const pages = document.pages?.length ?? Number(document.page_count ?? 0);
```

Signer artifact download is public in the OpenAPI document and requires no
access-code query in the official three-argument call. An optional fourth code
is available only for older deployments that require it.

## Empty acknowledgements

Several write operations return a success envelope without `data`; older
responses can use an empty array or object. Methods with no meaningful result
resolve to `Promise<void>` after validating the HTTP and envelope status. This
applies to token dispatch, signer OTP and terms, signature-image upload, bulk
signer actions, and deletions without a documented result. Tag deletion and
document-tag detachment preserve `{ deleted: boolean }` and
`{ detached: boolean }`.

## WhatsApp notification buttons

The published notification button schema requires `text`. Some deployments
also return `url`, so the SDK types it as optional. A button URL can contain a
signer access or verification value; treat it as a credential and never log it.

## Webhook delivery

Assinafy sends webhook events as HTTP `POST` JSON requests with
`Connection: close`, `webhook-id` and `webhook-timestamp` headers, and a
`webhook-signature` header on signing-enabled endpoints. Every active endpoint
subscribed to an event receives it independently. Any `2xx` is successful. There are at most two automatic
attempts per event with a three-second wait. After ten consecutive failed
events, ordinary delivery pauses and about 5% of later events are attempted
until one succeeds. `webhooks.retryDispatch()` requests immediate redelivery.
Only the first 2,000 characters of the receiver response body are retained in
dispatch history.

The common body contains `id`, `event`, nullable `message`, nullable `payload`,
nullable `origin`, Unix-second `created_at`, polymorphic `subject` and `object`,
and `account_id`. Deduplicate on the `webhook-id` header, which also tells
deliveries of the same event to different endpoints apart, and accept unknown
fields.

## Webhook endpoints and signatures

An account has 1 webhook endpoint, or up to 3 on paid plans. The subscription
routes (`webhooks.register()`, `get()`, `inactivate()`) act on the account's
oldest endpoint; the endpoint routes address each one by ID.

Signing-enabled endpoints follow Standard Webhooks:
`webhook-signature` holds space-separated `v1,<base64>` entries, each an
HMAC-SHA256 of `{webhook-id}.{webhook-timestamp}.{raw body}` keyed with the
base64-decoded part of the `whsec_` secret.
`webhookVerifier.verifySignature()` implements this, with a 300-second
timestamp tolerance by default. The signing-secret routes are not available to
OAuth applications. The earlier `webhookVerifier.verify()` (hex HMAC over the
body alone) is deprecated; it never matched an Assinafy signature.

## Authentication isolation

Public documents, login and social login, password reset, OAuth URLs, and
signer-access-code flows use a separate HTTP transport without `X-Api-Key` or
`Authorization` defaults. A credentialless `new AssinafyClient()` can drive
those flows, and credentials configured for protected resources are not sent.

Protected methods use the authenticated transport and receive the API's normal
`401` response when credentials are absent or invalid. The authenticated
transport accepts same-origin absolute URLs, rejects cross-origin requests
before dispatch, and treats credentials as redirect-sensitive. Use a separate
HTTP client for unrelated origins.

## Authenticated-user response variants

`GET /users/self` officially returns `AuthUser` directly. Some sandbox
deployments return `{ user, accounts }` and add `user.is_password_set`.
`users.getCurrent()` normalizes both forms to `IAuthenticatedUser`, where
`is_password_set` is optional.
