# @assinafy/sdk

TypeScript SDK for the [Assinafy API](https://api.assinafy.com.br/v1/docs) — a Brazilian digital signature platform.

Covers all 89 operations in the current official OpenAPI document: accounts,
authentication, users, documents, assignments, signers, signer-side flows,
templates, tags, fields, webhooks, branding, statistics, and the high-level
`uploadAndRequestSignatures` workflow. Five additional template-management
routes exposed by the live API are retained as compatibility extensions.

See [API coverage](docs/API_COVERAGE.md) for the exhaustive operation map and
[compatibility notes](docs/COMPATIBILITY.md) for the few places where live
behavior differs from the published schema.

## Requirements

- Node.js 22+ for the built-in `FormData` / `Blob` APIs used by uploads. Packed
  CJS and ESM imports are tested on 22 (maintenance LTS), 24 (active LTS), and
  26 (Current); Node 20 reached end-of-life in April 2026 and is unsupported.
- or Bun 1.3.14 (the version pinned for development and CI)

## Installation

```bash
npm install @assinafy/sdk
# or
bun add @assinafy/sdk
```

The package is published to both [npmjs.com](https://www.npmjs.com/package/@assinafy/sdk) and [GitHub Packages](https://github.com/assinafy/typescript-sdk/packages). To install from GitHub Packages, add to your `.npmrc`:

```
@assinafy:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

## Quick start

```ts
import { AssinafyClient } from '@assinafy/sdk';

const client = new AssinafyClient({
  apiKey: process.env.ASSINAFY_API_KEY!,
  accountId: process.env.ASSINAFY_ACCOUNT_ID!,
});

const result = await client.uploadAndRequestSignatures({
  source: { filePath: './contract.pdf' },
  signers: [
    { name: 'John Doe',    email: 'john@example.com' },
    { name: 'Jane Smith',  email: 'jane@example.com', whatsapp_phone_number: '+5548999990000' },
  ],
  message: 'Please sign this contract',
});

console.log('Document ID:', result.document.id);
```

## Authentication

The API supports two authentication methods. Prefer `apiKey` — it maps to the `X-Api-Key` header recommended by Assinafy for backend services.

```ts
// Preferred: X-Api-Key header
new AssinafyClient({ apiKey: 'k_xxx', accountId: 'acc_xxx' });

// Access token: Authorization: Bearer <token>
new AssinafyClient({ token: 'jwt_xxx', accountId: 'acc_xxx' });
```

Credentials are optional at construction time. A credentialless client uses a
separate, auth-free transport for public authentication and signer-access-code
operations, so an API key or Bearer token is never attached accidentally:

```ts
const publicClient = new AssinafyClient({
  baseUrl: 'https://sandbox.assinafy.com.br/v1',
});

await publicClient.auth.login('me@example.com', 'password');
await publicClient.documents.getPublic(documentId);
await publicClient.signerDocuments.self(signerAccessCode);
```

Protected methods still require `apiKey` or `token`; the API returns its normal
`401` response if one is called without credentials.

## Configuration

| Option          | Type     | Default                                 | Description                                   |
| --------------- | -------- | --------------------------------------- | --------------------------------------------- |
| `apiKey`        | string   | —                                       | Preferred credential (sent as `X-Api-Key`).   |
| `token`         | string   | —                                       | Access token (sent as `Authorization: Bearer`). |
| `accountId`     | string   | —                                       | Default workspace/account ID.                  |
| `baseUrl`       | string   | `https://api.assinafy.com.br/v1`        | Override base URL (e.g. the sandbox).          |
| `webhookSecret` | string   | —                                       | Opt-in HMAC secret used by `WebhookVerifier`; see its [contract caveat](docs/COMPATIBILITY.md#webhook-signature-verification-is-not-in-the-openapi-contract). |
| `timeout`       | number   | `30000`                                 | Request timeout in milliseconds.               |
| `maxRetries`    | number   | `2`                                     | Auto-retries eligible HTTP 429 responses, honoring `Retry-After`. `0` disables. |
| `logger`        | `Logger` | no-op                                   | Optional `{debug,info,warn,error}` logger.     |

### Rate limiting

On an HTTP `429`, the client automatically retries up to `maxRetries` times,
waiting for the server-provided `Retry-After` (or `X-Rate-Limit-Reset`) delay
before each attempt. Automatic replay is limited to `GET`, `HEAD`, `OPTIONS`,
`PUT`, and `DELETE`. A `POST` or `PATCH` is retried only when the request has a
non-empty `Idempotency-Key` header. No other HTTP status is retried.

### Factories

```ts
// Positional factory
const client = AssinafyClient.create('api-key', 'account-id');

// From a plain object (accepts snake_case or camelCase keys)
const client = AssinafyClient.fromConfig({
  api_key: process.env.ASSINAFY_API_KEY!,
  account_id: process.env.ASSINAFY_ACCOUNT_ID!,
});
```

## Endpoint coverage

All 89 operations documented at https://api.assinafy.com.br/v1/docs are
covered. The table below is the resource-level summary; the auditable,
operation-by-operation ledger is in [docs/API_COVERAGE.md](docs/API_COVERAGE.md).

| Resource              | Endpoints                                                                                                                                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client.documents`    | list, **search**, upload, details, get, **rename**, activities, waitUntilReady, download, thumbnail, downloadPage, statuses, delete, verify, createFromTemplate, estimateCostFromTemplate, getPublic, sendToken, listTags, replaceTags, addTags, detachTag, isFullySigned, getSigningProgress |
| `client.signers`      | create, get, list, update, delete, findByEmail                                                                                                                                                                                                     |
| `client.assignments`  | **list**, create, estimateCost, resetExpiration, resendNotification, estimateResendCost, listWhatsAppNotifications                                                                                                                                  |
| `client.templates`    | **create**, list, get, **update**, **delete**, downloadPage                                                                                                                                                                                        |
| `client.tags`         | list, create, update, delete                                                                                                                                                                                                                       |
| `client.workspaces`   | create, list, get, update, delete, getTheme, downloadLogo, uploadLogo, deleteLogo, getStats                                                                                                                                                        |
| `client.webhooks`     | register, get, inactivate, listEventTypes, listDispatches, retryDispatch                                                                                                                                                                           |
| `client.fields`       | create, list, get, update, delete, validate, validateMultiple, listTypes                                                                                                                                                                           |
| `client.auth`         | getSocialLoginUrl, getSocialLoginCallbackUrl, login, socialLogin, linkSocialLogin, createApiKey, getApiKey, deleteApiKey, changePassword, requestPasswordReset, resetPassword                                                                      |
| `client.users`        | getCurrent, getStats                                                                                                                                                                                                                              |
| `client.signerDocuments` | getCurrent, list, **search**, download, signMultiple, declineMultiple, self, acceptTerms, verifyEmail, confirmData, uploadSignature, downloadSignature, getAssignment, sign, decline                                                            |
| `client.webhookVerifier` | verify, extractEvent, getEventType, getEventData                                                                                                                                                                                                |

Every HTTP wrapper has TypeScript-checked request/response shapes and
method-level JSDoc covering the wire payload, return shape, validation,
relevant API errors, and a copyable example. Reusable and OpenAPI schema-level
payloads are exported as named types; small method-local option bags remain
inline in the generated declarations. Editors expose the reference on hover,
and declaration files ship with the package. The coverage ledger links those
typed methods back to each upstream operation without duplicating the schema.

## Resources

Most account-scoped methods accept an optional `accountId` that overrides the
client default. Workspace `get`, `update`, `delete`, branding, and statistics
methods always require an explicit account ID.

### Documents

```ts
// Upload from a file path (recommended)
const doc = await client.documents.upload(
  { filePath: './contract.pdf' },
  { name: 'Service agreement', metadata: { type: 'service' } },
);
// `name` is optional and defaults to the file's own name. The API derives the
// display name from the uploaded filename and appends `.pdf` when absent, so
// the document above is stored as 'Service agreement.pdf'. Accents are
// transliterated by the API ('Contrato de Serviço' → 'Contrato de Servico.pdf').
// → {
//   resource: 'document', id: '1031…', account_id: '102d…', template_id: null,
//   name: 'contract.pdf', status: 'uploaded',
//   artifacts: { original: 'https://…/download/original' },
//   signing_url: 'https://app…/sign/1031…',
//   pages: [],                 // populated once status reaches `metadata_ready`
//   tags: [], is_closed: false, created_at: '2026-…', updated_at: '2026-…'
// }

// …or from a Buffer already in memory
await client.documents.upload({ buffer, fileName: 'contract.pdf' });

// List → { data: IDocumentListItem[], meta?: { current_page, per_page, total, last_page } }
const { data, meta } = await client.documents.list({ page: 1, per_page: 20, sort: '-created_at' });

// Search is the lightweight alternative to list: same item shape, but the API
// skips the expanded `assignment`/`pages`. Prefer it for name lookups.
const hits = await client.documents.search({ search: 'agreement', status: 'pending_signature', 'per-page': 20 });

await client.documents.details(doc.id);
await client.documents.activities(doc.id);
await client.documents.waitUntilReady(doc.id, { maxWaitMs: 30_000 });

// Rename. The API rejects this with 400 while the document is still in
// `metadata_processing`, so await waitUntilReady() first on a fresh upload.
// (Passing `name` to upload() avoids both the round-trip and the race.)
await client.documents.rename(doc.id, 'Signed service agreement.pdf');

await client.documents.download(doc.id, 'certificated');   // 'original' | 'certificated' | 'certificate-page' | 'bundle'
await client.documents.thumbnail(doc.id);
await client.documents.downloadPage(doc.id, pageId);

await client.documents.statuses();                          // list every status code + deletable flag
await client.documents.isFullySigned(doc.id);
await client.documents.getSigningProgress(doc.id);
await client.documents.delete(doc.id);

// Verify a signed document by its Assinafy signature hash
await client.documents.verify('FE32EDDADE7CBDDCBB934E7402047450B0E59C02');

// Public endpoints (no auth)
await client.documents.getPublic(doc.id);
// Official request body: { email: 'jane@example.com' }
await client.documents.sendToken(doc.id, 'jane@example.com');

// Explicit compatibility overload for older deployments:
// { recipient: '+5548999990000', channel: 'whatsapp' }
await client.documents.sendToken(doc.id, '+5548999990000', 'whatsapp');

// The current OpenAPI contract requires existing tag IDs.
const contractsTag = await client.tags.create({ name: 'Contracts' });
const quarterTag = await client.tags.create({ name: '2026-Q1' });
const urgentTag = await client.tags.create({ name: 'Urgent' });
await client.documents.listTags(doc.id);
await client.documents.replaceTags(doc.id, [contractsTag.id, quarterTag.id]); // [] detaches all
await client.documents.addTags(doc.id, [urgentTag.id]);                         // append
await client.documents.detachTag(doc.id, urgentTag.id);                         // remove one
```

Uploads are validated locally: only `.pdf` files up to 25 MB whose bytes begin
with the PDF magic header (`%PDF-`) are accepted (the API's current hard limit).

List endpoints return `{ data, meta }` where `meta` is populated from the `X-Pagination-*` headers returned by the API.

### Signers

```ts
await client.signers.create({
  full_name: 'John Doe',
  email: 'john@example.com',
  whatsapp_phone_number: '+5548999990000',
  cpf: '123.456.789-00', // optional Brazilian tax ID — non-digits are stripped automatically
});
// → { id: '19e6…', full_name: 'John Doe', email: 'john@example.com',
//     whatsapp_phone_number: '+5548999990000', has_accepted_terms: false }
// (note: `cpf` is accepted on input but never echoed back by the API)

// Both contacts are optional in the create endpoint. A WhatsApp-only signer:
await client.signers.create({
  full_name: 'WhatsApp Only',
  whatsapp_phone_number: '+5548999990000',
});

// Name-only is valid too, but cannot be notified until a contact is added.
await client.signers.create({ full_name: 'Contact Pending' });

// PHP SDK compatibility aliases are also accepted
await client.signers.create({
  full_name: 'Jane Doe',
  email: 'jane@example.com',
  phone: '+5548999991111', // alias for whatsapp_phone_number
});

await client.signers.get(signerId);
await client.signers.list({ page: 1, per_page: 50, search: 'john' });
await client.signers.update(signerId, { full_name: 'Johnny Doe' });
await client.signers.delete(signerId);

const existing = await client.signers.findByEmail('john@example.com');
```

When an `email` is supplied, `signers.create()` is idempotent by email, matching the PHP SDK behavior: it reuses an existing signer when the same email is already present in the workspace. WhatsApp-only signers (no email) are always created fresh.

### Assignments

```ts
// List every assignment in the workspace.
// → { data: IAssignment[], meta?: { current_page, per_page, total, last_page } }
const { data, meta } = await client.assignments.list({ page: 1, 'per-page': 20 });

// Signers may be ids or objects — the SDK normalises to the API shape.
await client.assignments.create(documentId, {
  method: 'virtual',
  signers: ['signer-1', 'signer-2'],
  message: 'Please review and sign',
  expires_at: '2024-12-31T23:59:00Z',
  copy_receivers: ['observer-id'],
});

// Sequential signing: `step` controls signing order (parallel within a step).
await client.assignments.create(documentId, {
  method: 'virtual',
  signers: [
    { id: 'signer-1', step: 1 },
    { id: 'signer-2', step: 2 }, // notified only after step 1 finishes
  ],
});

// Estimate cost (the endpoint prices channel descriptors, not signer IDs) → ICostEstimate
await client.assignments.estimateCost(documentId, { signers: [{}] }); // default Email
await client.assignments.estimateCost(documentId, {
  signers: [{ verification_method: 'Whatsapp' }],
});
// → {
//   documents: 1, credits: 0, needs_extra_document: false, extra_document_cost: 0,
//   total_credits: 0, breakdown: [], document_balance: 67, credit_balance: 0,
//   has_sufficient_resources: true, blocking_reason: null, message: null
// }

await client.assignments.resetExpiration(documentId, assignmentId, '2025-06-30T00:00:00Z');
await client.assignments.resetExpiration(documentId, assignmentId, null); // remove expiration

await client.assignments.resendNotification(documentId, assignmentId, signerId);
// → { is_sent: true, document_id: '…', signer_id: '…' }

await client.assignments.estimateResendCost(documentId, assignmentId, signerId);
// → { total: 0, breakdown: [{ code: 'NotificationEmailResend', name: '…', cost: 0 }],
//     credit_balance: 0, has_sufficient_credits: true }

await client.assignments.listWhatsAppNotifications(documentId, assignmentId); // → IWhatsAppNotification[]
```

The `create` response is an `IAssignment`: `{ id, method, signers: [...], items: [...], signing_urls: [{ signer_id, url }], … }`.

For backwards compatibility, the SDK also accepts legacy `signer_ids` and `signerIds` payloads and rewrites them to the current `signers: [{ id }]` format expected by the API.

**Cancelling a signature request.** Assinafy has no workspace-side "cancel" endpoint. To stop a pending request either delete the document (when its status is deletable) or have the signer decline:

```ts
await client.documents.delete(documentId);                                  // workspace-side
await client.signerDocuments.decline(documentId, assignmentId, accessCode, 'No longer needed'); // signer-side
```

### Templates

`templates.list()` is part of the current OpenAPI document. The live API also
exposes five template-management routes—`create`, `get`, `update`, `delete`,
and `downloadPage`—that are retained as tested compatibility extensions even
though they are absent from that document. See
[compatibility notes](docs/COMPATIBILITY.md#template-management-live-extensions).
Template status casing has varied between published examples and live
responses; compare `template.status.toLowerCase()` when branching on it.

```ts
// Create a template by uploading a PDF (multipart). The template starts in
// an uploaded state and becomes ready once its pages are processed.
const created = await client.templates.create(
  { filePath: './nda.pdf' },          // or { buffer, fileName: 'nda.pdf' }
  { name: 'NDA template' },
);
// →
// {
//   resource: 'template', id: '1032...', name: 'nda.pdf',
//   document_name: 'nda.pdf', message: null, status: 'Uploaded',
//   roles: [{ id: '1032...', name: 'TemplateEditor', assignment_type: 'Editor' }],
//   pages: [], tags: [], created_at: '2026-…', updated_at: '2026-…'
// }

const { data, meta } = await client.templates.list({ search: 'NDA', per_page: 20 });
const template = await client.templates.get(created.id);   // includes pages[] + default_document_tags
await client.templates.update(created.id, { name: 'NDA v2', message: 'Please sign' });
const firstPage = template.pages?.[0];
if (firstPage) await client.templates.downloadPage(created.id, firstPage.id); // → Buffer (JPEG)
await client.templates.delete(created.id);

// Create a document from an existing, configured template. Fresh uploads have
// only an Editor role; add signer roles in Assinafy's editor first.
const configured = await client.templates.get(templateId);
const signerRole = configured.roles?.find(
  (role) => typeof role.assignment_type === 'string'
    && role.assignment_type.toLowerCase() !== 'editor',
);
if (!signerRole) throw new Error('Template has no signer role');
await client.documents.createFromTemplate(
  templateId,
  [{ role_id: signerRole.id, id: signerId, verification_method: 'Email', notification_methods: ['Email'] }],
  { name: 'NDA - John Doe', message: 'Please sign at your earliest convenience.' },
);

// Estimate the cost before creating → ICostEstimate
await client.documents.estimateCostFromTemplate(templateId, [
  { role_id: 'role_id', verification_method: 'Email', notification_methods: ['Email'] },
]);
// → { documents: 1, total_credits: 0, document_balance: 67, credit_balance: 0,
//     has_sufficient_resources: true, blocking_reason: null, breakdown: [], … }
```

Template creation only uploads the PDF and provisions the default editor role —
configure roles/fields in the Assinafy editor (or the web UI) afterwards.

### Tags

Workspace-scoped labels that can be attached to documents and templates. Tag names are unique per workspace (case-insensitive).

```ts
await client.tags.list({ search: 'contract' });          // ITag[]
const tag = await client.tags.create({ name: 'Contracts', color: 'ff8800' });
await client.tags.update(tag.id, { name: 'Sales Contracts' });
await client.tags.update(tag.id, { color: null });        // clear the color
await client.tags.delete(tag.id);                         // 409 if still attached
await client.tags.delete(tag.id, { force: true });        // detach everywhere, then delete
```

Attach/detach tags on a specific document via `client.documents.listTags / replaceTags / addTags / detachTag` (see [Documents](#documents)).

### Workspaces

The official create/update request schemas define `name` and
`notification_sender_type`. The sandbox also accepts the color fields shown
below; they are retained as a documented compatibility extension.

```ts
// Colours are 6-char hex WITHOUT a leading '#' (unlike tags, which strip it).
// '#ff0066' is rejected — the account endpoints want exactly 6 characters.
await client.workspaces.create({
  name: 'My Workspace',
  notification_sender_type: 'Account',
  primary_color: 'ff0066',
  secondary_color: '0066ff',
});
// → { id, name, primary_color: 'ff0066', secondary_color: '0066ff', created_at }
await client.workspaces.list();
await client.workspaces.get(accountId);
await client.workspaces.update(accountId, {
  name: 'Renamed',
  notification_sender_type: 'User',
  primary_color: '112233',
});

// Branding
const theme = await client.workspaces.getTheme(accountId);
const logo = await client.workspaces.downloadLogo(accountId); // Buffer
await client.workspaces.uploadLogo(accountId, { filePath: './logo.png' });
await client.workspaces.uploadLogo(accountId, {
  buffer: logoBuffer,
  fileName: 'logo.png',
  contentType: 'image/png',
});
await client.workspaces.deleteLogo(accountId);

// Latest 12 months by default; daily statistics require a YYYY-MM month.
await client.workspaces.getStats(accountId);
await client.workspaces.getStats(accountId, {
  granularity: 'daily',
  month: '2026-06',
});

await client.workspaces.delete(accountId);
// If the API reports deletion restrictions, explicitly opt in to overriding them:
await client.workspaces.delete(restrictedAccountId, { force: true });
```

### Field definitions

Custom field types used by `collect`-method assignments.

```ts
await client.fields.create({ type: 'text', name: 'Contract Number' });
await client.fields.list({ include_inactive: true, include_standard: true });
await client.fields.get(fieldId);
await client.fields.update(fieldId, { name: 'Updated Name' });
await client.fields.delete(fieldId);

// Validate a single value (signer-access-code only required for signer-side calls)
await client.fields.validate(fieldId, '400.676.228-36', { signerAccessCode });

// Validate multiple values at once
await client.fields.validateMultiple(
  [
    { field_id: 'f1', value: '1111111111111' },
    { field_id: 'f2', value: 'foo@bar.com' },
  ],
  { signerAccessCode },
);

// Catalog of every field type the platform recognises
await client.fields.listTypes();
```

### Authentication / API key management

Most server-side integrations should just use `X-Api-Key` directly. Use these endpoints when you need to bootstrap a session for a human user.

```ts
// Browser OAuth: redirect the user to this URL. The callback helper returns the
// Assinafy callback URL for provider configuration; neither follows a redirect.
const oauthStart = client.auth.getSocialLoginUrl('google');
const oauthCallback = client.auth.getSocialLoginCallbackUrl();

const { access_token, user, accounts } = await client.auth.login('me@example.com', 'pw');
await client.auth.socialLogin({ provider: 'google', token: 'google-id-token', has_accepted_terms: true });
await client.auth.linkSocialLogin({ provider: 'google', token: 'google-id-token' });

// Personal API key
await client.auth.createApiKey('current-password');
await client.auth.getApiKey();                     // → { api_key: '****...nBNr' } or null
await client.auth.deleteApiKey();

// Password lifecycle
await client.auth.changePassword({ email, password: 'current', new_password: 'next' });
await client.auth.requestPasswordReset('me@example.com');
await client.auth.resetPassword({ email, token: 'tk', new_password: 'next' });
```

### Authenticated user

```ts
const user = await client.users.getCurrent();
// → { id, name, email, telephone, government_id, is_email_verified,
//     has_accepted_terms, created_at, to_be_deleted_at }

// Cross-account document funnel, latest 12 monthly periods by default.
const monthly = await client.users.getStats();
const daily = await client.users.getStats({
  granularity: 'daily',
  month: '2026-06',
});
// Each row includes period, documents_uploaded, documents_sent,
// signature_requests by channel/view/completion, and documents_certified.
```

### Webhooks

```ts
await client.webhooks.register({
  url: 'https://example.com/webhooks/assinafy',
  email: 'admin@example.com',
  // events defaults to the current SDK default set below
  events: [
    'document_ready',
    'document_prepared',
    'signer_signed_document',
    'signer_rejected_document',
    'document_processing_failed',
  ],
});

await client.webhooks.get();          // current subscription or null
await client.webhooks.inactivate();   // stop deliveries (no delete route exists)
await client.webhooks.listEventTypes();
await client.webhooks.listDispatches({ delivered: false, page: 1, 'per-page': 20 });
await client.webhooks.retryDispatch(dispatchId);
```

### Webhook verification

`WebhookVerifier` is an opt-in HMAC-SHA256 utility for integrations whose
Assinafy environment provides a shared secret and signature header. The
current official OpenAPI document does **not** define a webhook signature
scheme or header name. Confirm the delivery contract for your environment
before enabling this check; do not reject production callbacks based on an
assumed header. The example below uses an application-configured header name.

```ts
import express from 'express';

const webhookSecret = process.env.ASSINAFY_WEBHOOK_SECRET;
const signatureHeader = process.env.ASSINAFY_SIGNATURE_HEADER;
if (!webhookSecret || !signatureHeader) {
  throw new Error('This deployment has no confirmed webhook-signature contract');
}

const webhookClient = new AssinafyClient({ webhookSecret });

app.post('/webhooks/assinafy', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.header(signatureHeader) ?? '';
  const rawBody = req.body as Buffer;

  if (!webhookClient.webhookVerifier.verify(rawBody, signature)) {
    return res.status(401).send('Invalid signature');
  }

  const event = webhookClient.webhookVerifier.extractEvent(rawBody);
  const type = webhookClient.webhookVerifier.getEventType(event);
  const data = webhookClient.webhookVerifier.getEventData(event);

  switch (type) {
    case 'document_ready':            break;
    case 'signer_signed_document':    break;
    case 'signer_rejected_document':  break;
    case 'document_processing_failed':break;
  }
  res.sendStatus(200);
});
```

### Signer-side endpoints

For building custom signer portals. Most calls require the `signer-access-code`
URL parameter that Assinafy emails/whatsapps to the signer. Artifact download is
the documented public exception; its optional fourth access-code argument exists
only for compatibility with deployments that still expect the legacy query.

```ts
await client.signerDocuments.self(accessCode);
await client.signerDocuments.acceptTerms(accessCode);
await client.signerDocuments.verifyEmail({ signerAccessCode: accessCode, verificationCode: '123456' });

await client.signerDocuments.getCurrent(signerId, accessCode);
const { data } = await client.signerDocuments.list(signerId, accessCode, { per_page: 20 });
// Signer-side counterpart of documents.search(), authorised by the access code.
const found = await client.signerDocuments.search(signerId, accessCode, 'invoice');
await client.signerDocuments.download(signerId, documentId, 'original');

await client.signerDocuments.confirmData(documentId, accessCode, {
  email: 'me@example.com',
  full_name: 'Example Signer',
  government_id: '123.456.789-00',
});
await client.signerDocuments.acceptTerms(accessCode);

// Signature image management ({ reuse: true } persists it for future documents)
await client.signerDocuments.uploadSignature(accessCode, pngBuffer, { imageType: 'signature', reuse: true });
await client.signerDocuments.downloadSignature(accessCode, 'signature');

// Sign / decline
const assignment = await client.signerDocuments.getAssignment(accessCode);
await client.signerDocuments.sign(documentId, assignmentId, accessCode, [
  { itemId, fieldId, pageId, value: 'Signed by John' },
]);
await client.signerDocuments.decline(documentId, assignmentId, accessCode, 'Not authorized');

// Bulk operations
await client.signerDocuments.signMultiple(['doc-1', 'doc-2'], accessCode);
await client.signerDocuments.declineMultiple(['doc-1'], 'Unfavorable terms', accessCode);
```

## High-level helper

Uploads a PDF, waits for processing, reuses or creates signers by email, and kicks off a virtual assignment.

```ts
const result = await client.uploadAndRequestSignatures({
  source: { filePath: './contract.pdf' },
  signers: [
    { name: 'John', email: 'john@example.com' },
    { name: 'Jane', email: 'jane@example.com', whatsapp_phone_number: '+5548999990000' },
  ],
  message: 'Please sign',
  metadata: { year: 2026 },
  waitForReady: true,
  expiresAt: '2026-12-31T00:00:00Z',
});

result.document;   // fully-processed IDocumentDetailsResponse (waitForReady: true, the default);
                   // the raw IDocumentUploadResponse when waitForReady: false
result.assignment; // IAssignment
result.signer_ids; // string[]
```

`waitForReady: false` skips only the final post-assignment document re-fetch.
The helper always waits for the uploaded document to reach a metadata-ready
state before creating its assignment; that safety wait is required to avoid a
processing race.

## Errors

HTTP methods reject with an `AssinafyError` subclass. Synchronous helpers such
as `getSocialLoginUrl()` can throw `ValidationError` before any request.

```ts
import { ApiError, ValidationError, NetworkError, AssinafyError } from '@assinafy/sdk';

try {
  await client.documents.upload({ filePath: './x.pdf' });
} catch (err) {
  if (err instanceof ValidationError) {
    console.error('Validation failed:', err.errors);
  } else if (err instanceof ApiError) {
    console.error(`API error ${err.statusCode}:`, err.responseData);
  } else if (err instanceof NetworkError) {
    console.error('Network error:', err.message);
  } else if (err instanceof AssinafyError) {
    console.error('SDK error:', err.message, err.context);
  }
}
```

## Live smoke test

A redaction-safe real-network audit under
[`scripts/live-smoke.ts`](scripts/live-smoke.ts) exercises read-only operations
by default. Its `--all` mode creates an isolated sandbox workspace, audits
reversible CRUD, upload, assignment, branding, statistics, and template flows,
then attempts per-resource cleanup and force-deletes that workspace in `finally`.
It complements the unit/contract suites. Optional login credentials enable the
password-login probe; an optional signer access code/OTP enables read-only
signer-link and OTP probes; and an optional HTTPS webhook receiver enables the
subscription lifecycle. Password changes, API-key rotation, social-provider
login/linking, legal consent, identity/signature mutation, signing, and decline
flows are deliberately never automated by this harness and are always reported
as explicit `SKIP`s. They require credentials, authorization, or legal fixtures
that an API key/account/e-mail set cannot safely supply.

```bash
# Read-only account/API checks. The base URL is deliberately mandatory.
ASSINAFY_BASE_URL=https://sandbox.assinafy.com.br/v1 \
ASSINAFY_API_KEY=… ASSINAFY_ACCOUNT_ID=… \
bun scripts/live-smoke.ts

# Full reversible audit in a disposable sandbox workspace.
ASSINAFY_BASE_URL=https://sandbox.assinafy.com.br/v1 \
ASSINAFY_API_KEY=… ASSINAFY_ACCOUNT_ID=… \
ASSINAFY_TEST_EMAIL_PRIMARY=first@example.com \
ASSINAFY_TEST_EMAIL_SECONDARY=second@example.com \
bun scripts/live-smoke.ts --all
```

Mutation is refused unless the URL's exact host is the Assinafy sandbox. The
explicit `--confirm-production` escape hatch exists for controlled environments
but should not be used for routine SDK verification. The script never prints
credentials, IDs, e-mail addresses, URLs, request/response payloads, or raw API
errors. See [CONTRIBUTING.md](CONTRIBUTING.md#sandbox-tests) for optional fixture
variables and safety guidance.

## Development

```bash
bun install          # or npm install
bun run typecheck    # source, script, and test type checks
bun run lint
bun test             # bun:test suites
bun run test:coverage
bun run build        # tsup → dist/ (CJS + ESM + .d.ts)
bun run lint:pkg     # publint + arethetypeswrong
bun run verify       # complete local release gate
```

## License

MIT
