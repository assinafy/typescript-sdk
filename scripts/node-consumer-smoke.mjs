import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

import {
    ApiError,
    AssinafyClient,
    SDK_USER_AGENT,
    ValidationError,
    WebhookVerifier,
} from '@assinafy/sdk';

const require = createRequire(import.meta.url);
const commonJsSdk = require('@assinafy/sdk');

for (const exported of [AssinafyClient, WebhookVerifier, ApiError, ValidationError]) {
    assert.equal(typeof exported, 'function');
}
for (const name of ['AssinafyClient', 'WebhookVerifier', 'ApiError', 'ValidationError']) {
    assert.equal(typeof commonJsSdk[name], 'function', `CommonJS export ${name} is missing`);
}
assert.equal(SDK_USER_AGENT, commonJsSdk.SDK_USER_AGENT);
new commonJsSdk.AssinafyClient({ apiKey: 'commonjs-key', accountId: 'commonjs-account' });

const requests = [];
const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    requests.push({
        method: request.method,
        path: request.url,
        headers: request.headers,
        body: Buffer.concat(chunks),
    });

    const id = request.url?.includes('/public/')
        ? 'public-document'
        : request.url?.endsWith('/documents')
          ? 'uploaded-document'
          : 'protected-request';
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 200, data: { id } }));
});

server.listen(0, '127.0.0.1');
await once(server, 'listening');

try {
    const address = server.address();
    assert(address && typeof address === 'object');
    const client = new AssinafyClient({
        apiKey: 'consumer-key',
        accountId: 'consumer-account',
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        maxRetries: 0,
    });

    const protectedResponse = await client
        .getAxiosInstance()
        .post('/consumer-json', { message: 'hello' });
    assert.equal(protectedResponse.data.data.id, 'protected-request');

    const publicDocument = await client.documents.getPublic('public-document');
    assert.equal(publicDocument.id, 'public-document');

    const uploadedDocument = await client.documents.upload({
        buffer: Buffer.from('%PDF-1.4\n%%EOF\n'),
        fileName: 'consumer-smoke.pdf',
    });
    assert.equal(uploadedDocument.id, 'uploaded-document');
} finally {
    await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
}

assert.equal(requests.length, 3);
const [protectedRequest, publicRequest, uploadRequest] = requests;

assert.equal(protectedRequest.method, 'POST');
assert.equal(protectedRequest.path, '/v1/consumer-json');
assert.equal(protectedRequest.headers['x-api-key'], 'consumer-key');
assert.equal(protectedRequest.headers['user-agent'], SDK_USER_AGENT);
assert.deepEqual(JSON.parse(protectedRequest.body.toString('utf8')), { message: 'hello' });

assert.equal(publicRequest.method, 'GET');
assert.equal(publicRequest.path, '/v1/public/documents/public-document');
assert.equal(publicRequest.headers['x-api-key'], undefined);
assert.equal(publicRequest.headers['authorization'], undefined);
assert.equal(publicRequest.headers['user-agent'], SDK_USER_AGENT);

assert.equal(uploadRequest.method, 'POST');
assert.equal(uploadRequest.path, '/v1/accounts/consumer-account/documents');
assert.equal(uploadRequest.headers['x-api-key'], 'consumer-key');
assert.equal(uploadRequest.headers['user-agent'], SDK_USER_AGENT);
assert.match(uploadRequest.headers['content-type'] ?? '', /^multipart\/form-data; boundary=/u);
assert.match(uploadRequest.body.toString('utf8'), /filename="consumer-smoke\.pdf"/u);
assert(uploadRequest.body.includes(Buffer.from('%PDF-1.4')));
