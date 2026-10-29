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
118-operation total.

The SDK also includes the production contract additions for:

- the `pades` document artifact;
- `DigitalCertificate` verification on virtual assignment creation and cost
  estimation (template calls remain typed but are temporarily rejected because
  the server derives their method);
- typed `display_settings` for collect fields;
- signer `government_id` updates;
- signature-image `reuse`;
- the documented `400` response from `GET /sign`; and
- the dedicated `SignerSelf` response fields.

Older signer-self responses can omit `has_signature`, `has_initial`, and
`is_signature_reusable`; assignment signers can omit `notification_history`.
Those fields are optional in the SDK response types.

## Contract lifecycle management (CLM)

Production exposes the six contract lifecycle operations under
`/v1/accounts/{accountId}` through `client.contracts`. They track terms on an
existing document, link signed amendment/renewal/termination instruments, run
the hourly renewal and expiration lifecycle, and expose portfolio filters.
OAuth reads require `documents:read`; writes require `documents:write` plus a
workspace plan with contract tracking.

Owner assignment is optional. Integrations that do not manage ownership can
omit `owner_id` without discovering or supplying workspace member IDs.
Workspace membership is never available to OAuth tokens, including those with
`account:read`: the member directory includes other members' and pending
invitees' emails, roles, and session-only data. Adding it to that scope would
expand existing grants without renewed consent.

For an explicit "assign to me" action, `client.oauth.getUserInfo()` calls
`GET /v1/oauth/userinfo` with the `openid` scope. Its `sub` is the signed-in
user's ID in the format accepted by `owner_id`; this does not enumerate other
members. Assignment to someone else by email is not a supported contract field.

An amendment's `apply_error` is human-readable text, not a stable code. Do not
parse it to select localized guidance. The published causes are a missing
contract-tracking plan, a parent that cannot accept the delta, an earlier signed
instrument still pending, a later signed instrument already applied, and an
unexpected failure. A machine-readable error code requires an API contract
addition before the SDK can expose it.

A sandbox may return the generic `404` while these routes are not deployed, or
`403` while its workspace plan does not include contract tracking. The SDK does
not reinterpret either response or route a sandbox request to production.
Read operations remain available after a production plan lapses; writes are
plan-gated. Signed amendments wait and the lifecycle catches up after the plan
returns, as defined by the production integration guide.
The current sandbox specification publishes neither the six CLM operations nor
activity paging. The SDK's `audit:api` checks the production contract; passing
sandbox smoke tests does not verify either capability.

`documents.details()` can expose `has_contract` only in a workspace context and
only when contract tracking is available. A missing key means unknown, not
false. The thirteen notification preferences include
`ContractRenewalNotice`, `ContractExpiring`, `ContractExpired`, and
`ContractRenewed`. Contract changes also use the typed
`document_contract_*` webhook event names; obtain the current subscribable
catalog with `webhooks.listEventTypes()`.

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

Two behaviours observed on document and signer lists are silent rather than
loud, so neither surfaces as an error a caller could react to:

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

`signers.findByEmail()` pins this maximum when scanning matching signer pages.

### Document activities

Production `GET /v1/documents/{documentId}/activities` is paginated: 20 entries
per page by default, with `page`, `per-page` (documented maximum 100), and `sort`
(`-id` for newest first, the default; `id` for oldest first). A page beyond the
end returns an empty `data` array. Its documented limit differs from the observed
50-row cap above; the SDK forwards the requested size without clamping it.

`documents.activities(documentId, params?)` continues to return
`IDocumentActivity[]`, normalizing an absent body to `[]`. It accepts `per_page`
as an alias for `per-page`, with the hyphenated form taking precedence. It makes
one request. Use `documents.listActivities()` to receive `{ data, meta }`, with
`current_page`, `per_page`, `total` and `last_page` parsed from the production
`X-Pagination-*` headers. `meta` is absent when the server sends no pagination
headers.

```ts
import type { IDocumentActivity } from '@assinafy/sdk';

const events: IDocumentActivity[] = [];
for (let page = 1; ; page++) {
  const { data, meta } = await client.documents.listActivities('document-id', {
    page, 'per-page': 100, sort: 'id',
  });
  events.push(...data);
  // Unpaged sandbox responses have no meta and must be consumed only once.
  if (!meta?.last_page || page >= meta.last_page || data.length === 0) break;
}
```

Production's change from an unpaged history to a default page of 20 affects
existing clients even without an SDK upgrade: a successful request no longer
implies a complete activity log. SDK 2.9.1 and earlier cannot request later
pages through `activities()`. Integrations that need the full history must
upgrade to SDK 2.10.0 or later and explicitly traverse
pages. This SDK change does not automatically fetch the entire history.

Sandbox still serves an unpaged activity log and may ignore these parameters.
Do not use a loop that waits for an empty page on that deployment: it can keep
returning the same full log. A successful sandbox call does not verify production
pagination.

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

The operation requires both `channel` and `recipient`; `email` is the only
channel, and the response `data` is `{ document, channel, recipient }`:

```http
PUT /v1/public/documents/{documentId}/send-token
Content-Type: application/json

{ "channel": "email", "recipient": "signer@example.com" }
```

```ts
const { recipient } = await client.documents.sendToken(documentId, 'signer@example.com');
```

## Document tags

The published contract specifies existing tag IDs for replace and attach:

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

Older sandbox deployments interpret those same string arrays as **tag names**:
sending an ID creates a new tag whose name is that ID. On such a deployment,
pass the existing tag's `name` intentionally to attach it. `detachTag` still
takes an ID. The SDK sends the supplied strings unchanged; it does not retry a
successful mutation or infer an ID-to-name translation. Check the returned tag
IDs and names when selecting the deployment's input shape.

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
step. It costs 0.5 credits per signer in addition to the selected notification
cost. Notification methods remain `Email` and `Whatsapp`. It also requires
`method: virtual`: certificate completion completes a virtual item, while the
ordinary field-signing endpoint refuses certificate signers. The SDK rejects a
certificate/`collect` combination before assignment creation or cost
estimation with `ValidationError.errors.code` set to
`digital_certificate_requires_virtual_method`.

Template role IDs do not reveal which entries are signers, editors or copy
receivers. The SDK validates each entry's channel and positive `step`, then
lets the API enforce role-aware signing order. The server also derives the
assignment method from placed template fields but does not yet reject an
unusable certificate/`collect` result. Until it does, the SDK refuses
`DigitalCertificate` on both template-document creation and cost estimation
with the same stable code; use a direct virtual assignment instead.

## Identity document and face verification

`IdDocumentFaceMatchBasic` requires the **ID Document + Face Match** feature and
a valid CPF in the signer's `government_id` (a CNPJ is not sufficient). It
accepts either notification channel. Use assignment or template cost estimation
for its current per-signer fee before creating the assignment.

`signerDocuments.self()` exposes `verification_method` before verification.
For this method, obtain explicit biometric consent and call
`startIdentityVerification(accessCode, { consent: true })`; preserve the entire
returned bearer URL, including its fragment, and keep it out of logs and
browser storage. `getIdentityVerification()` returns `can_start`, `status`,
`url`, `expires_at`, and `completed_at`. Only no session or an `Expired` session
allows another start. `expires_at` is the capture-link expiry, not a processing
or review deadline. `Declined` and `Abandoned` require a new document/assignment.

`InReview` permits signing but holds certification. Once everyone has signed,
the document is `pending_identity_review`. Account reviewers use
`assignments.getIdentityVerification()`, `downloadIdentityVerificationImage()`
and `reviewIdentityVerification()`. Evidence images are available only while
the review is open and must not be cached. Approval permits certification after
all reviews are approved; rejection cancels the document and notifies signers
and copy receivers. The optional nullable note (2000 characters maximum) is
recorded in activity and sent to the provider, but hidden from signers.

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

The reset-expiration schema requires the `expires_at` key itself: send an
ISO-8601 date-time string, or `null` to remove the expiration. The SDK's
`resetExpiration` always sends the key and accepts `null` for clearing.

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
oldest endpoint; the endpoint routes address each one by ID. Exact registered
URLs can also filter `listEndpoints(accountId?, { url })` and identify the
target of `deleteEndpointByUrl(url, accountId?)`.

`createEndpoint()` returns `IWebhookEndpointCreateResponse` with `secret` when
signing is enabled. Store that value securely at creation, including for OAuth
applications: they cannot read or rotate the secret afterward. If an OAuth
application loses it, delete and recreate its endpoint.

Signing-enabled endpoints follow Standard Webhooks:
`webhook-signature` holds space-separated `v1,<base64>` entries, each an
HMAC-SHA256 of `{webhook-id}.{webhook-timestamp}.{raw body}` keyed with the
base64-decoded part of the `whsec_` secret.
`webhookVerifier.verifySignature()` implements this, with a 300-second
timestamp tolerance by default; non-finite or negative windows fail closed.
The signing-secret routes are not available to
OAuth applications. The earlier `webhookVerifier.verify()` (hex HMAC over the
body alone) is deprecated; it never matched an Assinafy signature.

Older sandbox deployments can omit `secret` from the creation response and
return `404` for deletion by URL. API-key integrations can still use the secret
read/rotation and deletion-by-ID routes. OAuth integrations need a deployment
that returns the creation secret to configure signed endpoints.

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
