# @assinafy/sdk

*[Leia em português](README.md) · English*

Official TypeScript SDK for the [Assinafy API](https://api.assinafy.com.br/v1/docs), with Node.js
and Bun support, complete types, and ESM/CJS builds.

The SDK maps all 147 operations in the published OpenAPI document (146 with methods; the embed
session exchange is reserved for Assinafy's embed page), plus compatibility extensions
maintained by the API. The complete reference, including payloads, responses, errors, and examples
for every resource, is in the **[English manual](docs/README.en.md)**.

## Requirements

- Node.js 22+ or Bun 1.4.4
- HTTPS with TLS 1.2 or higher

## Installation

```bash
npm install @assinafy/sdk
# or
bun add @assinafy/sdk
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
    {
      name: 'Example Signer',
      email: 'signer@example.com',
    },
  ],
  message: 'Please sign this contract',
});

console.log(result.document.id, result.assignment.id);
```

The helper uploads the PDF, creates or reuses the signers, and requests their signatures. To
control each step independently, follow the [complete document flow](docs/README.en.md#document-lifecycle).

## Authentication

| Credential | Use |
| --- | --- |
| `apiKey` | Server-to-server automation in your own workspace |
| `token` | Authenticated session or OAuth access token |
| No credential | Login, password reset, public reads, signer access codes, and OAuth endpoints |

```ts
const withApiKey = new AssinafyClient({
  apiKey: process.env.ASSINAFY_API_KEY!,
  accountId: process.env.ASSINAFY_ACCOUNT_ID!,
});

const withOAuth = new AssinafyClient({
  token: process.env.ASSINAFY_ACCESS_TOKEN!,
  accountId: process.env.ASSINAFY_ACCOUNT_ID!,
});
```

Applications connected to other people's workspaces must use OAuth 2.1 with PKCE S256. See the
[OAuth guide](docs/README.en.md#oauth-applications) for discovery, authorization, callback
validation, refresh-token rotation, and revocation.

## Configuration

| Option | Default | Purpose |
| --- | --- | --- |
| `apiKey` | — | `X-Api-Key` credential |
| `token` | — | `Authorization: Bearer` credential |
| `accountId` | — | Default workspace |
| `baseUrl` | `https://api.assinafy.com.br/v1` | API environment |
| `webhookSecret` | — | Standard Webhooks signature verification |
| `timeout` | `30000` | Timeout in milliseconds |
| `maxRetries` | `2` | Safe retries for HTTP 429 |
| `logger` | no-op | Optional logger |

The [configuration manual](docs/README.en.md#configuration) explains retries, rate limits, and
factories.

## Integration flow

1. Configure the client with an API key or complete OAuth in the workspace's environment.
2. Create or find the signers.
3. Upload the PDF and wait for metadata processing.
4. Estimate the cost and create the assignment with the required verification and notification,
   or send several documents to the same signers at once with `client.envelopes`.
5. Deliver the signing URL, or show the signing screen inside your app with `client.embed`, and
   authenticate webhooks before processing events.
6. Observe completion and download the signed document or certificate.

WhatsApp, ID-document and face biometrics, ICP-Brasil digital certificates, and per-account
`Bypass` verification have specific prerequisites; `workspaces.get(id, { expand:
'signing_features' })` reports which ones the plan enables. The SDK represents A1 and A3 as `DigitalCertificate`; the signer selects the medium
in their browser. See the [signing branches](docs/README.en.md#paid-signing-branches).

## API resources

| Resource | Area |
| --- | --- |
| `client.documents` | Uploads, reads, artifacts, tags, and template creation |
| `client.signers` | Signer registration, lookup, and updates |
| `client.assignments` | Requests, costs, notifications, and identity review |
| `client.envelopes` | Several documents to the same signers, one invitation and one charge |
| `client.embed` | Embed origins and single-use sessions for in-app signing |
| `client.contracts` | Terms, families, renewals, and contract termination |
| `client.templates`, `client.tags`, `client.fields` | Reusable content and fields |
| `client.workspaces`, `client.users` | Workspace, branding, usage, notification policy, preferences, and MFA/TOTP |
| `client.auth`, `client.oauth` | Login, API keys, and OAuth 2.1 |
| `client.webhooks`, `client.webhookVerifier` | Endpoints, deliveries, and event authentication |
| `client.signerDocuments` | Public and authenticated signer flows |

See the [resource reference](docs/README.en.md#resource-reference) and the
[operation-by-operation map](docs/API_COVERAGE.md). The TypeScript declarations and JSDoc shipped
with the package document the complete payloads.

## Documentation

- [Manual completo em português](docs/README.md)
- [Complete manual in English](docs/README.en.md)
- [API coverage](docs/API_COVERAGE.md)
- [Environment compatibility](docs/COMPATIBILITY.md)
- [Release process](docs/RELEASING.md)
- [Official API documentation](https://api.assinafy.com.br/v1/docs)

## Development

```bash
bun install --frozen-lockfile
bun run verify
bun run audit
bun run audit:api
```

`bun run verify` runs type checks, lint, tests, coverage, build, and package validation.

## License

Distributed under the [MIT License](LICENSE).
