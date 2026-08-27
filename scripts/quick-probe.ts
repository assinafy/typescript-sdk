/**
 * Quick connectivity check for the configured API deployment.
 *
 * Run with:
 *   ASSINAFY_API_KEY=... ASSINAFY_ACCOUNT_ID=... bun scripts/quick-probe.ts
 */
import { AssinafyClient } from '../src';

const apiKey = process.env['ASSINAFY_API_KEY'];
const accountId = process.env['ASSINAFY_ACCOUNT_ID'];
const baseUrl = process.env['ASSINAFY_BASE_URL'];
if (!apiKey || !accountId) {
    throw new Error('Set ASSINAFY_API_KEY and ASSINAFY_ACCOUNT_ID.');
}

const client = new AssinafyClient({
    apiKey,
    accountId,
    ...(baseUrl === undefined ? {} : { baseUrl }),
});

async function main(): Promise<void> {
    const docs = await client.documents.list({ per_page: 1 });
    console.log('documents.list →', docs.data.length, 'documents');

    const signers = await client.signers.list({ per_page: 1 });
    console.log('signers.list →', signers.data.length, 'signers');

    const templates = await client.templates.list({ per_page: 1 });
    console.log('templates.list →', templates.data.length, 'templates');

    const eventTypes = await client.webhooks.listEventTypes();
    console.log('webhooks.listEventTypes →', eventTypes.length, 'event types');

    const sub = await client.webhooks.get();
    console.log('webhooks.get →', sub === null ? 'not configured' : 'configured');

    const verify = await client.documents.verify('FE32EDDADE7CBDDCBB934E7402047450B0E59C02');
    console.log('documents.verify →', verify.is_valid ? 'valid' : 'not valid');

    const workspaces = await client.workspaces.list();
    console.log('workspaces.list →', workspaces.data.length, 'workspaces');

    if (workspaces.data[0]) {
        await client.workspaces.get(workspaces.data[0].id);
        console.log('workspaces.get → loaded');
    }
}

main().catch((err) => {
    console.error('error:', err);
    process.exit(1);
});
