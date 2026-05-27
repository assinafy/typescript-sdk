# @assinafy/sdk

TypeScript SDK for the [Assinafy API](https://api.assinafy.com.br/v1/docs) — a Brazilian digital signature platform.

Provides 100% endpoint coverage of the public API: documents, signers, assignments, templates, tags, workspaces, webhooks, field definitions, authentication, public/signer-side flows, and the high-level `uploadAndRequestSignatures` helper.

## Requirements

- Node.js 18+ for the built-in `FormData` / `Blob` APIs used by uploads
- or Bun 1.0+

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
  webhookSecret: process.env.ASSINAFY_WEBHOOK_SECRET,
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

// Legacy: Authorization: Bearer <token>
new AssinafyClient({ token: 'jwt_xxx', accountId: 'acc_xxx' });
```

## Configuration

| Option          | Type     | Default                                 | Description                                   |
| --------------- | -------- | --------------------------------------- | --------------------------------------------- |
| `apiKey`        | string   | —                                       | Preferred credential (sent as `X-Api-Key`).   |
| `token`         | string   | —                                       | Legacy access token (sent as `Bearer`).       |
| `accountId`     | string   | —                                       | Default workspace/account ID.                  |
| `baseUrl`       | string   | `https://api.assinafy.com.br/v1`        | Override base URL.                             |
| `webhookSecret` | string   | —                                       | Shared secret used by `WebhookVerifier`.       |
| `timeout`       | number   | `30000`                                 | Request timeout in milliseconds.               |
| `logger`        | `Logger` | no-op                                   | Optional `{debug,info,warn,error}` logger.     |

### Factories

```ts
// Positional factory
const client = AssinafyClient.create('api-key', 'account-id', { webhookSecret: 'shhh' });

// From a plain object (accepts snake_case or camelCase keys)
const client = AssinafyClient.fromConfig({
  api_key: process.env.ASSINAFY_API_KEY!,
  account_id: process.env.ASSINAFY_ACCOUNT_ID!,
});
```

## Endpoint coverage

Every public endpoint documented in https://api.assinafy.com.br/v1/docs is covered. The table below maps each resource to its API surface.

| Resource              | Endpoints                                                                                                                                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client.documents`    | list, upload, details, activities, waitUntilReady, download, thumbnail, downloadPage, statuses, delete, verify, createFromTemplate, estimateCostFromTemplate, **getPublic**, **sendToken**, **listTags**, **replaceTags**, **addTags**, **detachTag**, isFullySigned, getSigningProgress |
| `client.signers`      | create, get, list, update, delete, findByEmail                                                                                                                                                                                                     |
| `client.assignments`  | create, estimateCost, resetExpiration, resendNotification, estimateResendCost, listWhatsAppNotifications, cancel                                                                                                                                   |
| `client.templates`    | list, get, downloadPage                                                                                                                                                                                                                            |
| `client.tags`         | list, create, update, delete                                                                                                                                                                                                                       |
| `client.workspaces`   | create, list, get, update, delete                                                                                                                                                                                                                  |
| `client.webhooks`     | register, get, inactivate, delete, listEventTypes, listDispatches, retryDispatch                                                                                                                                                                   |
| `client.fields`       | create, list, get, update, delete, validate, validateMultiple, listTypes                                                                                                                                                                           |
| `client.auth`         | login, socialLogin, createApiKey, getApiKey, deleteApiKey, changePassword, requestPasswordReset, resetPassword                                                                                                                                     |
| `client.signerDocuments` | getCurrent, list, download, signMultiple, declineMultiple, self, acceptTerms, verifyEmail, confirmData, uploadSignature, downloadSignature, getAssignment, sign, decline                                                                        |
| `client.webhookVerifier` | verify, extractEvent, getEventType, getEventData                                                                                                                                                                                                |

## Resources

Most account-scoped methods accept an optional `accountId` that overrides the client default. Workspace `get/update/delete` always require an explicit account ID.

### Documents

```ts
// Upload from a file path (recommended)
const doc = await client.documents.upload(
  { filePath: './contract.pdf' },
  { metadata: { type: 'service' } },
);

// …or from a Buffer already in memory
await client.documents.upload({ buffer, fileName: 'contract.pdf' });

const { data, meta } = await client.documents.list({ page: 1, per_page: 20, sort: '-created_at' });
await client.documents.details(doc.id);
await client.documents.activities(doc.id);
await client.documents.waitUntilReady(doc.id, { maxWaitMs: 30_000 });

await client.documents.download(doc.id, 'certificated');   // 'original' | 'certificated' | 'certificate-page' | 'bundle'
await client.documents.thumbnail(doc.id);
await client.documents.downloadPage(doc.id, pageId);

await client.documents.statuses();                          // list every status code + deletable flag
await client.documents.isFullySigned(doc.id);
await client.documents.getSigningProgress(doc.id);
await client.documents.delete(doc.id);

// Verify a signed document by its SHA-1 hash
await client.documents.verify('FE32EDDADE7CBDDCBB934E7402047450B0E59C02');

// Public endpoints (no auth)
await client.documents.getPublic(doc.id);
await client.documents.sendToken(doc.id, 'jane@example.com', 'email');

// Tags attached to a document (by tag name; unknown names are auto-created)
await client.documents.listTags(doc.id);
await client.documents.replaceTags(doc.id, ['Contracts', '2026-Q1']); // [] detaches all
await client.documents.addTags(doc.id, ['Urgent']);                   // append, idempotent
await client.documents.detachTag(doc.id, tagId);                      // remove one
```

Uploads are validated locally: only `.pdf` files up to 25 MB are accepted (the API's current hard limit).

List endpoints return `{ data, meta }` where `meta` is populated from the `X-Pagination-*` headers returned by the API.

### Signers

```ts
await client.signers.create({
  full_name: 'John Doe',
  email: 'john@example.com',
  whatsapp_phone_number: '+5548999990000',
  cpf: '123.456.789-00', // optional Brazilian tax ID — non-digits are stripped automatically
});

// `email` is optional — a WhatsApp-only signer is valid (at least one is required)
await client.signers.create({
  full_name: 'WhatsApp Only',
  whatsapp_phone_number: '+5548999990000',
});

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

// Estimate cost (signers may omit `id` when only the channel matters)
await client.assignments.estimateCost(documentId, { signers: ['signer-1'] });
await client.assignments.estimateCost(documentId, {
  signers: [{ verification_method: 'Whatsapp' }],
});

await client.assignments.resetExpiration(documentId, assignmentId, '2025-06-30T00:00:00Z');
await client.assignments.resetExpiration(documentId, assignmentId, null); // remove expiration
await client.assignments.resendNotification(documentId, assignmentId, signerId);
await client.assignments.estimateResendCost(documentId, assignmentId, signerId);
await client.assignments.listWhatsAppNotifications(documentId, assignmentId);
await client.assignments.cancel(documentId, 'No longer needed');
```

For backwards compatibility, the SDK also accepts legacy `signer_ids` and `signerIds` payloads and rewrites them to the current `signers: [{ id }]` format expected by the API.

### Templates

```ts
const { data, meta } = await client.templates.list({ search: 'NDA', per_page: 20 });
const template = await client.templates.get(templateId);
await client.templates.downloadPage(templateId, pageId);

// Create a document from a template (each signer maps to a template role)
await client.documents.createFromTemplate(
  templateId,
  [{ role_id: template.roles![0].id, id: signerId, verification_method: 'Email', notification_methods: ['Email'] }],
  { name: 'NDA - John Doe', message: 'Please sign at your earliest convenience.' },
);

// Estimate the cost before creating
await client.documents.estimateCostFromTemplate(templateId, [{ role_id: 'role_id', id: signerId }]);
```

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

```ts
await client.workspaces.create({ name: 'My Workspace', primary_color: '#ff0066' });
await client.workspaces.list();
await client.workspaces.get(accountId);
await client.workspaces.update(accountId, { name: 'Renamed' });
await client.workspaces.delete(accountId);
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
const { access_token, user, accounts } = await client.auth.login('me@example.com', 'pw');
await client.auth.socialLogin({ provider: 'google', token: 'google-id-token', has_accepted_terms: true });

// Personal API key
await client.auth.createApiKey('current-password');
await client.auth.getApiKey();                     // → { api_key: '****...nBNr' } or null
await client.auth.deleteApiKey();

// Password lifecycle
await client.auth.changePassword({ email, password: 'current', new_password: 'next' });
await client.auth.requestPasswordReset('me@example.com');
await client.auth.resetPassword({ email, token: 'tk', new_password: 'next' });
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
await client.webhooks.inactivate();
await client.webhooks.delete();
await client.webhooks.listEventTypes();
await client.webhooks.listDispatches({ delivered: false, page: 1, 'per-page': 20 });
await client.webhooks.retryDispatch(dispatchId);
```

### Webhook verification

Webhook payloads are signed with HMAC-SHA256 of the raw body using the workspace `webhookSecret`. Assinafy sends the hex digest in the `X-Assinafy-Signature` header.

```ts
import express from 'express';

app.post('/webhooks/assinafy', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.header('x-assinafy-signature') ?? '';
  const rawBody = req.body as Buffer;

  if (!client.webhookVerifier.verify(rawBody, signature)) {
    return res.status(401).send('Invalid signature');
  }

  const event = client.webhookVerifier.extractEvent(rawBody);
  const type = client.webhookVerifier.getEventType(event);
  const data = client.webhookVerifier.getEventData(event);

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

For building custom signer portals. Every call requires the `signer-access-code` URL parameter that Assinafy emails/whatsapps to the signer.

```ts
await client.signerDocuments.self(accessCode);
await client.signerDocuments.acceptTerms(accessCode);
await client.signerDocuments.verifyEmail({ signerAccessCode: accessCode, verificationCode: '123456' });

await client.signerDocuments.getCurrent(signerId, accessCode);
const { data } = await client.signerDocuments.list(signerId, accessCode, { search: 'invoice' });
await client.signerDocuments.download(signerId, documentId, 'original', accessCode);

await client.signerDocuments.confirmData(documentId, accessCode, {
  email: 'me@example.com',
  whatsapp_phone_number: '+5548999990000',
  has_accepted_terms: true,
});

// Signature image management
await client.signerDocuments.uploadSignature(accessCode, pngBuffer, { imageType: 'signature' });
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

result.document;   // IDocumentUploadResponse
result.assignment; // IAssignment
result.signer_ids; // string[]
```

## Errors

Every method rejects with an `AssinafyError` subclass.

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

A real-network test script under [`scripts/live-smoke.ts`](scripts/live-smoke.ts) exercises the full API. Use it to sanity-check a workspace before shipping.

```bash
ASSINAFY_API_KEY=… ASSINAFY_ACCOUNT_ID=… bun scripts/live-smoke.ts            # read-only
ASSINAFY_API_KEY=… ASSINAFY_ACCOUNT_ID=… bun scripts/live-smoke.ts --write    # also creates+deletes a signer
ASSINAFY_API_KEY=… ASSINAFY_ACCOUNT_ID=… bun scripts/live-smoke.ts --upload   # also uploads+deletes a PDF
```

## Development

```bash
bun install        # or npm install
bun test           # runs bun:test suites (Bun is required for tests)
npm run typecheck  # tsc --noEmit
npm run lint
npm run build      # tsup → dist/ (CJS + ESM + .d.ts)
```

## License

MIT
