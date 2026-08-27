# @assinafy/sdk

TypeScript SDK for the [Assinafy API](https://api.assinafy.com.br/v1/docs) — a Brazilian digital signature platform.

Covers all 89 operations in the current official OpenAPI document: accounts,
authentication, users, documents, assignments, signers, signer-side flows,
templates, tags, fields, webhooks, branding, statistics, and the high-level
`uploadAndRequestSignatures` workflow. Five additional template-management
routes used by existing integrations and two legacy browser URL helpers are
retained for compatibility.

See [API coverage](docs/API_COVERAGE.md) for the operation map and
[compatibility notes](docs/COMPATIBILITY.md) for deployment-specific request
and response variants.

## Requirements

- Node.js 22+ for the built-in `FormData` / `Blob` APIs used by uploads. Packed
  CJS and ESM imports are tested on 22 (maintenance LTS), 24 (active LTS), and
  26 (Current); Node 20 reached end-of-life in April 2026 and is unsupported.
- or Bun 1.4.0 (the version pinned for development and CI)

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

const baseUrl = process.env.ASSINAFY_BASE_URL ?? 'https://api.assinafy.com.br/v1';
const client = new AssinafyClient({
  apiKey: process.env.ASSINAFY_API_KEY!,
  accountId: process.env.ASSINAFY_ACCOUNT_ID!,
  baseUrl,
});

const result = await client.uploadAndRequestSignatures({
  source: { filePath: './contract.pdf' },
  signers: [
    { name: 'John Doe', email: 'john@example.com' },
    { name: 'Jane Smith', email: 'jane@example.com' },
  ],
  message: 'Please sign this contract',
});

console.log('Document ID:', result.document.id);
console.log('Assignment ID:', result.assignment.id);
```

This path uses email verification and notification for every signer. WhatsApp
and ICP-Brasil certificate signing have separate prerequisites and costs; see
[Paid signing branches](#paid-signing-branches) before enabling either one.

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

Every SDK transport, including public and signer-access-code requests, sends
`User-Agent: Assinafy-Typescript-SDK/v<VERSION>`, where `<VERSION>` is the
installed package version. The exact value is also exported as
`SDK_USER_AGENT` for custom transport checks and observability rules.

## Configuration

| Option          | Type     | Default                                 | Description                                   |
| --------------- | -------- | --------------------------------------- | --------------------------------------------- |
| `apiKey`        | string   | —                                       | Preferred credential (sent as `X-Api-Key`).   |
| `token`         | string   | —                                       | Access token (sent as `Authorization: Bearer`). |
| `accountId`     | string   | —                                       | Default workspace/account ID.                  |
| `baseUrl`       | string   | `https://api.assinafy.com.br/v1`        | Absolute HTTP(S) API base without credentials, query, or fragment. |
| `webhookSecret` | string   | —                                       | Opt-in HMAC secret used by `WebhookVerifier`; see its [contract caveat](docs/COMPATIBILITY.md#webhook-signature-verification-is-not-in-the-openapi-contract). |
| `timeout`       | number   | `30000`                                 | Request timeout in milliseconds.               |
| `maxRetries`    | number   | `2`                                     | Auto-retries eligible HTTP 429 responses, honoring `Retry-After`. `0` disables. |
| `logger`        | `Logger` | no-op                                   | Optional `{debug,info,warn,error}` logger.     |

### Rate limiting

On an HTTP `429`, the client automatically retries up to `maxRetries` times,
waiting for the server-provided `Retry-After` (or `X-Rate-Limit-Reset`) delay
before each attempt. Automatic replay is limited to read-safe `GET`, `HEAD`,
`OPTIONS`, and `DELETE` requests. `GET /sign` is excluded because it records
that the signer viewed the assignment. Writes are not replayed by default.
A non-empty `Idempotency-Key` opts a custom request into SDK replay, but it is
not part of the current Assinafy OpenAPI contract: confirm that the target
route deduplicates that key server-side first. No other HTTP status is retried.

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
covered. The table below is the resource-level summary; the detailed operation
ledger is in [docs/API_COVERAGE.md](docs/API_COVERAGE.md).

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
| `client.users`        | getCurrent, getStats, getNotificationPreferences, updateNotificationPreferences                                                                                                                                                                  |
| `client.signerDocuments` | getCurrent, list, **search**, download, signMultiple, declineMultiple, self, acceptTerms, verifyEmail, confirmData, uploadSignature, downloadSignature, getAssignment, sign, decline                                                            |
| `client.webhookVerifier` | verify, extractEvent, getEventType, getEventData                                                                                                                                                                                                |

Every HTTP wrapper has TypeScript-checked request/response shapes and
method-level JSDoc covering the wire payload, return shape, validation,
relevant API errors, and a copyable example. Reusable and OpenAPI schema-level
payloads are exported as named types; small method-local option bags remain
inline in the generated declarations. Editors expose the reference on hover,
and declaration files ship with the package. The coverage ledger links those
typed methods back to each upstream operation without duplicating the schema.

## Document lifecycle

The normal integration has an account-owner phase, a signer phase, and a final
artifact phase. The example below keeps every signer on email and uses a
`virtual` assignment, so no page coordinates or paid notification channel are
required.

### 1. Upload the PDF

```ts
const uploaded = await client.documents.upload({ filePath: './contract.pdf' });
```

The official multipart body contains the `file` part. The SDK also supports a
display-name override (used as that file part's filename) and an optional JSON
`metadata` part for deployments that accept it. A successful response is
`IDocumentUploadResponse`:

```ts
{
  resource?: string;
  id: string;
  account_id: string;
  template_id: string | null;
  name: string;
  status: DocumentStatus;
  assignment?: IAssignment | null;
  artifacts: {
    original: string;
    certificated?: string;
    'certificate-page'?: string;
    pades?: string;
    bundle?: string;
    thumbnail?: string;
  };
  signing_url?: string;
  pages: Array<{ id: string; number: number; height: number; width: number; download_url: string }>;
  tags?: Array<{ id: string; name: string; color?: string | null }>;
  created_at: string;
  updated_at: string;
  is_closed: boolean;
  decline_reason: string | null;
  declined_by: ISigner | null;
}
```

`DocumentStatus` covers `uploading`, `uploaded`, `metadata_processing`,
`metadata_ready`, `pending_signature`, `expired`, `certificating`,
`certificated`, `rejected_by_signer`, `rejected_by_user`, and `failed`.

Uploads must be PDFs, at most 25 MB and at most 2,000 pages. The SDK checks the
extension, size, and `%PDF-` header before sending. A new upload can have an
empty `pages` array until metadata processing finishes. Wait before creating a
`collect` assignment because its fields refer to rendered page IDs; a
`virtual` assignment may be created immediately.

```ts
const prepared = await client.documents.waitUntilReady(uploaded.id, {
  maxWaitMs: 30_000,
  pollIntervalMs: 2_000,
});
```

### 2. Create or reuse the email signers

```ts
const signerA = await client.signers.create({
  full_name: 'John Doe',
  email: 'john@example.com',
});
const signerB = await client.signers.create({
  full_name: 'Jane Smith',
  email: 'jane@example.com',
});
```

The wire body is `{ full_name, email }`. Each response is an `ISigner`:

```ts
{
  resource?: string;
  id: string;
  full_name: string;
  email: string | null;
  whatsapp_phone_number?: string | null;
  cpf?: string | null;                // compatibility type; not echoed by the API
  has_accepted_terms?: boolean;
  has_signature?: boolean;            // signer-self response only
  has_initial?: boolean;              // signer-self response only
  is_signature_reusable?: boolean;    // signer-self response only
  metadata?: Record<string, unknown>;
}
```

When an email is present, `signers.create()` first looks up that email in the
workspace and reuses the matching signer; a name-only or phone-only request
always creates a new signer.

### 3. Price, then request signatures

Cost estimation takes channel descriptors, not signer IDs:

```ts
const estimate = await client.assignments.estimateCost(uploaded.id, {
  method: 'virtual',
  signers: [{}, {}], // `{}` selects Email for each signer
});

if (!estimate.has_sufficient_resources) {
  throw new Error(estimate.blocking_reason ?? estimate.message ?? 'Insufficient resources');
}
```

The response is `ICostEstimate`:

```ts
{
  documents: number;
  credits: number;
  needs_extra_document: boolean;
  extra_document_cost: number;
  total_credits: number;
  breakdown: Array<{ code: string; name: string; cost: number; quantity?: number; unit_cost?: number }>;
  document_balance: number;
  credit_balance: number;
  has_sufficient_resources: boolean;
  blocking_reason: 'PendingPayment' | 'InsufficientDocuments' | 'InsufficientCredits' | null;
  message: string | null;
}
```

Create the email assignment only after accepting that estimate:

```ts
const assignment = await client.assignments.create(uploaded.id, {
  method: 'virtual',
  signers: [
    { id: signerA.id, verification_method: 'Email', notification_methods: ['Email'] },
    { id: signerB.id, verification_method: 'Email', notification_methods: ['Email'] },
  ],
  message: 'Please review and sign',
  expires_at: '2027-12-31T23:59:00Z',
});
```

The request returns an `IAssignment`:

```ts
{
  resource?: string;
  id: string;
  sender_email?: string;
  method: 'virtual' | 'collect';
  expires_at?: string | null;
  expiration?: string;
  message?: string | null;
  signers: IAssignmentSigner[];
  copy_receivers?: Array<Record<string, unknown>>;
  items?: IAssignmentItem[];
  summary?: {
    signer_count: number;
    completed_count: number;
    signers: Array<ISigner & { completed?: boolean }>;
  };
  signing_urls?: Array<{ signer_id: string; url: string }>;
}
```

The URLs and delivered messages contain signer credentials; treat them as
secrets.

### 4. Complete the email signer flow

Assinafy sends each signer a link containing their access code and sends the
one-time verification code through the selected channel. Neither value is
returned as a standalone owner-side API field. A custom signer portal must
obtain both values from the signer-delivery flow; do not manufacture them or
log them.

```ts
// Signer-side client: no account API credential is needed or sent.
const signerClient = new AssinafyClient({
  baseUrl,
});

const self = await signerClient.signerDocuments.self(accessCode); // ISignerSelf

// Query: signer-access-code=<accessCode>
// Body: { 'verification-code': '<six-digit code>' }
await signerClient.signerDocuments.verifyEmail({
  signerAccessCode: accessCode,
  verificationCode,
}); // Promise<void>

const confirmed = await signerClient.signerDocuments.confirmData(
  uploaded.id,
  accessCode,
  { full_name: self.full_name, email: self.email ?? undefined },
); // ISigner

const signable = await signerClient.signerDocuments.getAssignment(accessCode, true);
// `getAssignment` returns IDocumentDetailsResponse and records that the signer
// viewed the assignment. Do not issue it merely as a health check.

await signerClient.signerDocuments.signMultiple([signable.id], accessCode);
// Wire body: { document_ids: [signable.id] }; acknowledgement has no data.
```

Repeat this phase separately for each signer with that signer's own access code
and one-time code. The two signers in this example share the default step and
can sign in parallel.

`signMultiple` is only for `virtual` assignments. For `collect`, read
`signable.assignment.items`, then call `sign(documentId, assignmentId,
accessCode, entries)` with a non-empty array of
`{ itemId, fieldId, pageId, value }`. A virtual signer must confirm their data
before signing. A `DigitalCertificate` signer cannot call `sign`; that branch
uses Assinafy's certificate-start and certificate-complete flow, which is not
part of this SDK's current 89-operation surface.

### 5. Observe completion and download artifacts

Subscribe to `document_ready` for event-driven completion, or fetch
`documents.details(documentId)` until `status === 'certificated'`. Webhook
deliveries can repeat, so use their numeric `id` as an
idempotency key. Once complete:

```ts
const finalDocument = await client.documents.details(uploaded.id);
const signedPdf = await client.documents.download(uploaded.id, 'certificated');
const certificatePage = await client.documents.download(uploaded.id, 'certificate-page');
const bundleZip = await client.documents.download(uploaded.id, 'bundle');

// Validate an Assinafy signature hash when your workflow has extracted it.
const validation = await client.documents.verify(documentSignatureHash);
```

`original`, `certificated`, and `certificate-page` are PDFs. `bundle` is a ZIP
containing those three artifacts and also `pades` when the document had an
ICP-Brasil certificate signer. The `pades` PDF exists only for documents that
had certificate signers. An artifact can return `404` before generation has
finished. `decline_reason` is included in document details only when the access
token belongs to the document creator.

## Resource reference

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
// `name` and `metadata` are compatibility multipart parts outside the published
// file-only request schema.
// `name` is optional and defaults to the file's own name. The API derives the
// display name from the uploaded filename and appends `.pdf` when absent, so
// the document above is stored as 'Service agreement.pdf'. Accents are
// transliterated by the API ('Contrato de Serviço' → 'Contrato de Servico.pdf').
// → {
//   resource: 'document', id: '1031…', account_id: '102d…', template_id: null,
//   name: 'Service agreement.pdf', status: 'uploaded',
//   artifacts: { original: 'https://…/download/original' },
//   signing_url: 'https://app…/sign/1031…',
//   pages: [],                 // populated once status reaches `metadata_ready`
//   tags: [], is_closed: false, created_at: '2026-…', updated_at: '2026-…'
// }

// …or from a Buffer already in memory
await client.documents.upload({ buffer, fileName: 'contract.pdf' });

// List → { data: IDocumentListItem[], meta?: { current_page, per_page, total, last_page } }
const { data, meta } = await client.documents.list({ page: 1, per_page: 20, sort: 'updated_at' });

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

await client.documents.download(doc.id, 'certificated');   // signed PDF
await client.documents.download(doc.id, 'certificate-page');
await client.documents.download(doc.id, 'bundle');          // ZIP
// `pades` exists only when at least one signer used DigitalCertificate.
await client.documents.download(doc.id, 'pades');
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
await client.documents.detachTag(doc.id, urgentTag.id); // → { detached: true }
```

Uploads are validated locally: only `.pdf` files up to 25 MB whose bytes begin
with the PDF magic header (`%PDF-`) are accepted. The API also limits documents
to 2,000 pages.

Page and artifact URLs embedded in JSON responses still require the same
account authentication as their download operations. Prefer
`documents.downloadPage()` and `documents.download()` so the SDK applies the
credential and returns a `Buffer`. `bundle` contains `original`, `certificated`,
and `certificate-page`, plus `pades` when available.

List endpoints return `{ data, meta }` where `meta` is populated from the `X-Pagination-*` headers returned by the API.

### Signers

```ts
await client.signers.create({
  full_name: 'John Doe',
  email: 'john@example.com',
  cpf: '123.456.789-00', // legacy compatibility input; non-digits are stripped
});
// → { id: '19e6…', full_name: 'John Doe', email: 'john@example.com',
//     whatsapp_phone_number: null, has_accepted_terms: false }
// (note: `cpf` is accepted on input but never echoed back by the API)

// Both contacts are optional. A name-only signer cannot be notified until a
// contact is added.
await client.signers.create({ full_name: 'Contact Pending' });

await client.signers.create({
  full_name: 'Jane Doe',
  email: 'jane@example.com',
});

await client.signers.get(signerId);
await client.signers.list({ page: 1, per_page: 50, search: 'john' });
await client.signers.update(signerId, {
  full_name: 'Johnny Doe',
  government_id: '390.533.447-05', // official update field; sent as digits
});
await client.signers.delete(signerId);

const existing = await client.signers.findByEmail('john@example.com');
```

When an `email` is supplied, `signers.create()` is idempotent by email: it
reuses an existing signer when the same email is already present in the
workspace. Signers without email are always created fresh. See
[Paid signing branches](#paid-signing-branches) for phone-only signers.

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
  expires_at: '2027-12-31T23:59:00Z',
  copy_receivers: ['copy-recipient-signer-id'],
});

// Sequential signing: `step` controls signing order (parallel within a step).
await client.assignments.create(documentId, {
  method: 'virtual',
  signers: [
    { id: 'signer-1', step: 1 },
    { id: 'signer-2', step: 2 }, // notified only after step 1 finishes
  ],
});

// Collect fields use 150-DPI page-image pixels measured from the upper-left.
await client.assignments.create(documentId, {
  method: 'collect',
  signers: [{ id: signerId }],
  entries: [{
    page_id: pageId,
    fields: [{
      signer_id: signerId,
      field_id: fieldId,
      display_settings: {
        left: 69, top: 282, width: 421, height: 45.86, fontSize: 22,
        fontFamily: 'Arial', backgroundColor: '#D5EBFF',
      },
    }],
  }],
});

// Estimate cost (the endpoint prices channel descriptors, not signer IDs) → ICostEstimate
await client.assignments.estimateCost(documentId, { signers: [{}] }); // default Email
// → {
//   documents: 1, credits: 0, needs_extra_document: false, extra_document_cost: 0,
//   total_credits: 0, breakdown: [], document_balance: 67, credit_balance: 0,
//   has_sufficient_resources: true, blocking_reason: null, message: null
// }

await client.assignments.resetExpiration(documentId, assignmentId, '2027-06-30T00:00:00Z');
// Compatibility only: the published request requires a date-time string.
// Confirm target support before using `null` to clear an expiration.
await client.assignments.resetExpiration(documentId, assignmentId, null);

await client.assignments.resendNotification(documentId, assignmentId, signerId);
// → { is_sent: true, document_id: '…', signer_id: '…' }

const resendCost = await client.assignments.estimateResendCost(documentId, assignmentId, signerId);
// Official response: ICostEstimate. Older deployments can return the compact
// IResendCostEstimate branch with `total` and `has_sufficient_credits`; narrow
// with `'total_credits' in resendCost` before reading branch-specific fields.
```

The `create` response is an `IAssignment`: `{ id, method, signers: [...],
items: [{ display_settings, ... }], signing_urls: [{ signer_id, url }], … }`.

For backwards compatibility, the SDK also accepts legacy `signer_ids` and `signerIds` payloads and rewrites them to the current `signers: [{ id }]` format expected by the API.

**Cancelling a signature request.** Assinafy has no workspace-side "cancel" endpoint. To stop a pending request either delete the document (when its status is deletable) or have the signer decline:

```ts
await client.documents.delete(documentId);                                  // workspace-side
await client.signerDocuments.decline(documentId, assignmentId, accessCode, 'No longer needed'); // signer-side
```

### Paid signing branches

Keep the email flow as the default. Enable either branch below only after the
workspace has the required plan or feature and the returned cost estimate is
acceptable.

#### WhatsApp verification and notification

WhatsApp is available only on paid subscriptions and costs 0.45 credit per
notification. Create a phone-only signer or add a phone to an existing signer,
then request the `Whatsapp` channel explicitly:

```ts
const phoneSigner = await client.signers.create({
  full_name: 'Mobile Signer',
  whatsapp_phone_number: '+5511999990000',
});

const whatsappCost = await client.assignments.estimateCost(documentId, {
  method: 'virtual',
  signers: [{ verification_method: 'Whatsapp', notification_methods: ['Whatsapp'] }],
});

const whatsappAssignment = await client.assignments.create(documentId, {
  method: 'virtual',
  signers: [{
    id: phoneSigner.id,
    verification_method: 'Whatsapp',
    notification_methods: ['Whatsapp'],
  }],
});

const notices = await client.assignments.listWhatsAppNotifications(
  documentId,
  whatsappAssignment.id,
);
// IWhatsAppNotification[]:
// [{ sent_at, header, body, buttons: [{ text, url? }], phone_number, signer_id }]
```

The high-level helper selects this paid branch for a signer that has a phone
number but no email. Button URLs can contain signer credentials; do not log or
forward them outside the signing flow.

#### ICP-Brasil digital certificate

`DigitalCertificate` requires the account feature, a CPF or CNPJ in the
signer's `government_id`, and exactly one certificate signer in that signing
step. It costs two credits per certificate signer in addition to the selected
notification cost.

```ts
const certificateSigner = await client.signers.update(signerId, {
  government_id: '390.533.447-05',
});

const certificateCost = await client.assignments.estimateCost(documentId, {
  method: 'virtual',
  signers: [{ verification_method: 'DigitalCertificate', notification_methods: ['Email'] }],
});

await client.assignments.create(documentId, {
  method: 'virtual',
  signers: [{
    id: certificateSigner.id,
    step: 1,
    verification_method: 'DigitalCertificate',
    notification_methods: ['Email'],
  }],
});
```

Before opening the assignment, the signer must confirm identity data and accept
terms with `confirmData(..., { has_accepted_terms: true })` or `acceptTerms()`.
The regular `sign()` endpoint rejects certificate signers; they complete the
ICP-Brasil flow through Assinafy's browser integration. After completion,
`documents.download(documentId, 'pades')` returns the qualified PAdES artifact.

### Templates

`templates.list()` is part of the current OpenAPI document. Existing
integrations can also use five template-management routes—`create`, `get`,
`update`, `delete`, and `downloadPage`—that are absent from that document. See
[compatibility notes](docs/COMPATIBILITY.md#template-management-extensions).
Template status casing can vary by deployment; normalize with
`template.status.toLowerCase()` when branching on it.

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

Template signer descriptors also accept
`verification_method: 'DigitalCertificate'` with the same prerequisites under
[ICP-Brasil digital certificate](#icp-brasil-digital-certificate).

Template creation only uploads the PDF and provisions the default editor role —
configure roles/fields in the Assinafy editor (or the web UI) afterwards.
The `download_url` values in template page objects are protected URLs; prefer
`templates.downloadPage()` so the API credential is attached.

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
// `force` cancels an active paid subscription as part of account deletion. It
// is not a general bypass for unrelated deletion restrictions.
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
    { field_id: 'f2', value: 'value@example.com' },
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
// Each row includes period, upload/send/certification totals, notification
// counts for email/WhatsApp/bypass, verification counts for
// email/WhatsApp/bypass/digital-certificate, viewed, and completed counts.

const preferences = await client.users.getNotificationPreferences();
await client.users.updateNotificationPreferences({
  SignerDeclined: false,
  DocumentExpired: false,
});
// Updates merge: omitted keys keep their current value. Both methods return
// the complete nine-key notification preference map.
```

### Webhooks

```ts
await client.webhooks.register({
  url: 'https://example.com/webhooks/assinafy',
  email: 'admin@example.com',
  is_active: true,
  // events defaults to the current SDK default set below
  events: [
    'document_ready',
    'document_prepared',
    'signer_signed_document',
    'signer_rejected_document',
    'document_processing_failed',
  ],
});

await client.webhooks.get();          // IWebhookSubscription | null
await client.webhooks.inactivate();   // stop deliveries (no delete route exists)
await client.webhooks.listEventTypes();
const history = await client.webhooks.listDispatches({
  delivered: false,
  page: 1,
  'per-page': 20,
}); // { data: IWebhookDispatch[], meta?: PaginationMeta }
const retried = await client.webhooks.retryDispatch(dispatchId); // IWebhookDispatch
```

`register` sends `{ events, is_active, url, email }` and returns
`{ events, is_active, url, email, updated_at? }`. Assinafy delivers each event
as an HTTP `POST` with `Content-Type: application/json` and `Connection: close`.
Any `2xx` is success. There are at most two automatic attempts, separated by
three seconds. After ten consecutive failed events, ordinary delivery pauses
and about 5% of later events are attempted until one succeeds; use
`retryDispatch()` for an immediate manual redelivery. The dispatch history
retains only the first 2,000 characters of the receiver's response body.

Each history or retry result is an `IWebhookDispatch`:

```ts
{
  resource?: string;
  id: string;
  event: string;
  activity_id: number;
  endpoint: string | null;
  payload: IWebhookPayload | Record<string, unknown> | null;
  delivered: boolean;
  http_status: number | null;
  response_body: string | null;
  error: string | null;
  created_at: string;
  updated_at?: string;
}
```

Every delivery body uses this envelope:

```ts
{
  id: number;                         // use for idempotent processing
  event: string;
  message: string | null;
  payload: Record<string, unknown> | null;
  origin: { ip?: string; 'user-agent'?: string } | null;
  created_at: number;                 // Unix seconds
  subject: { type: 'User' | 'Signer' | 'Account' | 'Document' | 'Template'; [key: string]: unknown };
  object: { type: 'User' | 'Signer' | 'Account' | 'Document' | 'Template'; [key: string]: unknown };
  account_id: string;
}
```

Event-specific values are:

| `event` | `subject.type` | `object.type` | `payload` keys |
| --- | --- | --- | --- |
| `document_uploaded` | `User` | `Document` | — |
| `document_metadata_ready` | `User` | `Document` | — |
| `document_prepared` | `User` | `Document` | — |
| `assignment_created` | `User` | `Document` | `user_name`, `user_email`, `user_telephone` |
| `document_ready` | `Account` | `Document` | — |
| `document_processing_failed` | `Account` | `Document` | `error_message` |
| `signature_requested` | `User` | `Document` | `signer_email`, `signer_full_name`, or `signer_whatsapp_phone_number`, according to channel |
| `signer_created` | `User` | `Signer` | `signer_full_name` |
| `signer_email_verified` | `Signer` | `Document` | `signer_email` |
| `signer_whatsapp_verified` | `Signer` | `Document` | `signer_whatsapp_phone_number` |
| `signer_data_confirmed` | `Signer` | `Document` | `signer_email` |
| `signer_viewed_document` | `Signer` | `Document` | `signer_full_name` |
| `signer_signed_document` | `Signer` | `Document` | `signer_full_name` |
| `signer_rejected_document` | `Signer` | `Document` | `signer_full_name` |
| `user_rejected_document` | `User` | `Document` | `user_name` |
| `template_created` | `User` | `Template` | — |
| `template_processed` | `User` | `Template` | — |
| `template_processing_failed` | `Account` | `Template` | `error_message` |

`payload`, `subject`, and `object` are event-dependent. Accept unknown fields
for forward compatibility and acknowledge only after durable, idempotent
processing. Non-`2xx` responses, timeouts, and connection failures all count as
failed deliveries. `assignment_created` and `document_metadata_ready` have no
guaranteed ordering. For account entities, Assinafy removes the `integration`
property before delivery.

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
await client.signerDocuments.verifyEmail({ signerAccessCode: accessCode, verificationCode: '123456' });

await client.signerDocuments.getCurrent(signerId, accessCode);
const { data } = await client.signerDocuments.list(signerId, accessCode, { per_page: 20 });
// Signer-side counterpart of documents.search(), authorised by the access code.
const found = await client.signerDocuments.search(signerId, accessCode, 'invoice');
await client.signerDocuments.download(signerId, documentId, 'original');
// Available only after an ICP-Brasil certificate signer completes signing.
await client.signerDocuments.download(signerId, documentId, 'pades');

await client.signerDocuments.confirmData(documentId, accessCode, {
  email: 'me@example.com',
  full_name: 'Example Signer',
  government_id: '123.456.789-00',
  has_accepted_terms: true,
});
// Alternatively, accept terms separately before getAssignment():
// await client.signerDocuments.acceptTerms(accessCode);

// Signature image management ({ reuse: true } persists it for future documents)
await client.signerDocuments.uploadSignature(accessCode, pngBuffer, { imageType: 'signature', reuse: true });
await client.signerDocuments.downloadSignature(accessCode, 'signature');

// Sign / decline
const signable = await client.signerDocuments.getAssignment(accessCode);
// `sign()` is for collect assignments and requires every placed field value.
await client.signerDocuments.sign(documentId, assignmentId, accessCode, [
  { itemId, fieldId, pageId, value: 'Signed by John' },
]);
await client.signerDocuments.decline(documentId, assignmentId, accessCode, 'Not authorized');

// `signMultiple()` is for virtual assignments only.
await client.signerDocuments.signMultiple(['doc-1', 'doc-2'], accessCode);
await client.signerDocuments.declineMultiple(['doc-1'], 'Unfavorable terms', accessCode);
```

`sign()` also requires virtual signers to have confirmed their data first, but
virtual assignments should normally use `signMultiple()`. Certificate signers
cannot use `sign()`; see [Paid signing branches](#paid-signing-branches).

## High-level helper

Uploads a PDF, reuses or creates signers by email, creates a virtual assignment
immediately, and optionally waits for processing before returning.

```ts
const result = await client.uploadAndRequestSignatures({
  source: { filePath: './contract.pdf' },
  signers: [
    { name: 'John', email: 'john@example.com' },
    { name: 'Jane', email: 'jane@example.com' },
  ],
  message: 'Please sign',
  metadata: { year: 2026 }, // compatibility upload part; omit for file-only wire format
  waitForReady: true,
  waitOptions: { maxWaitMs: 30_000, pollIntervalMs: 1_000 },
  expiresAt: '2027-12-31T00:00:00Z',
  copyReceivers: ['existing-copy-recipient-signer-id'],
});

result.document;   // fully-processed IDocumentDetailsResponse (waitForReady: true, the default);
                   // the raw IDocumentUploadResponse when waitForReady: false
result.assignment; // IAssignment
result.signer_ids; // string[]
```

`waitForReady: false` skips post-assignment polling and returns the initial
upload response. With the default `true`, the helper creates the assignment first and
then waits for the current document details. Both production and sandbox allow
virtual assignments in `uploaded` and `metadata_processing` and promote them
automatically; only `collect` assignments require rendered pages.
Every signer above uses the default email channel. A phone-only signer selects
the paid WhatsApp branch described earlier. `copyReceivers` accepts existing
signer IDs, not email addresses; check the returned assignment before treating
a copy receiver as registered.

The helper is not transactional. A post-assignment polling error includes the
created `documentId`, `assignmentId`, and `signerIds` in its `context` (and in
`ValidationError.errors` for timeouts); inspect those IDs before deciding
whether to retry the workflow.

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

## Development

```bash
bun install --frozen-lockfile
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
