# Assinafy

TypeScript SDK for the [Assinafy API](https://api.assinafy.com.br/v1/docs) — a Brazilian digital signature platform.

Covers documents, signers, assignments, webhooks, workspaces, templates, and the high-level `uploadAndRequestSignatures` helper.

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
| `baseUrl`       | string   | `https://api.assinafy.com.br/v1`        | Switch to sandbox with `…/sandbox…/v1`.        |
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
  base_url: 'https://sandbox.assinafy.com.br/v1',
});
```

## Resources

All resources are available on the client. Most account-scoped methods accept an optional `accountId` that overrides the client default. Workspace `get()`, `update()`, and `delete()` always require an explicit account ID.

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
await client.documents.download(doc.id, 'certificated');
await client.documents.thumbnail(doc.id);
await client.documents.downloadPage(doc.id, pageId);
await client.documents.isFullySigned(doc.id);
await client.documents.getSigningProgress(doc.id);
await client.documents.delete(doc.id);
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

// PHP SDK compatibility aliases are also accepted
await client.signers.create({
  full_name: 'Jane Doe',
  email: 'jane@example.com',
  phone: '+5548999991111',
});

await client.signers.get(signerId);
await client.signers.list({ page: 1, per_page: 50, search: 'john' });
await client.signers.update(signerId, { full_name: 'Johnny Doe' });
await client.signers.delete(signerId);

const existing = await client.signers.findByEmail('john@example.com');
```

`signers.create()` is idempotent by email, matching the PHP SDK behavior: it reuses an existing signer when the same email is already present in the workspace.

`phone` is accepted as an alias for `whatsapp_phone_number` to match the PHP SDK ergonomics.

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

await client.assignments.estimateCost(documentId, { signers: ['signer-1'] });
await client.assignments.estimateCost(documentId, {
  signers: [{ verification_method: 'Whatsapp' }],
});
await client.assignments.resetExpiration(documentId, assignmentId, '2025-06-30T00:00:00Z');
await client.assignments.resendNotification(documentId, assignmentId, signerId);
await client.assignments.estimateResendCost(documentId, assignmentId, signerId);
await client.assignments.cancel(documentId, 'No longer needed');
```

For backwards compatibility, the SDK also accepts legacy `signer_ids` and `signerIds` payloads and rewrites them to the current `signers: [{ id }]` format expected by the API.

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

await client.webhooks.get();     // current subscription or null
await client.webhooks.inactivate();
await client.webhooks.delete();
await client.webhooks.listEventTypes();
await client.webhooks.listDispatches({ delivered: false, page: 1, 'per-page': 20 });
await client.webhooks.retryDispatch(dispatchId);
```

The webhook event catalog in the current docs includes additional event types beyond the legacy four, including `document_uploaded`, `document_metadata_ready`, `document_prepared`, `assignment_created`, `signature_requested`, `signer_created`, and template lifecycle events.

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

### Templates

```ts
const { data, meta } = await client.templates.list({ search: 'NDA', per_page: 20 });
const template = await client.templates.get(templateId);

// Create a document from a template (each signer maps to a template role)
await client.documents.createFromTemplate(
  templateId,
  [{ role_id: template.roles![0].id, id: signerId, verification_method: 'Email', notification_methods: ['Email'] }],
  { name: 'NDA - John Doe', message: 'Please sign at your earliest convenience.' },
);

// Estimate the cost before creating
await client.documents.estimateCostFromTemplate(templateId, [{ role_id: 'role_id', id: signerId }]);

// Verify a signed document by its SHA-1 hash
await client.documents.verify(signatureHash);
```

### Workspaces

```ts
await client.workspaces.create({ name: 'My Workspace', primary_color: '#ff0066' });
await client.workspaces.list();
await client.workspaces.get(accountId);
await client.workspaces.update(accountId, { name: 'Renamed' });
await client.workspaces.delete(accountId);
```

## High-level helper

Uploads a PDF, waits for processing, reuses or creates signers by email, and kicks off a virtual assignment.

```ts
const result = await client.uploadAndRequestSignatures({
  source: { filePath: './contract.pdf' },
  signers: [
    { name: 'John',  email: 'john@example.com' },
    { name: 'Jane',  email: 'jane@example.com', whatsapp_phone_number: '+5548999990000' },
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

The SDK throws typed errors; every method rejects with something that is an instance of `AssinafyError`.

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
bun install        # or npm install
bun test           # runs bun:test suites (Bun is required for tests)
npm run typecheck  # tsc --noEmit
npm run lint
npm run build      # tsup → dist/ (CJS + ESM + .d.ts)
```

## License

MIT
