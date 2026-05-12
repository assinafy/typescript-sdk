/**
 * Quick probe to make sure the current SDK can talk to the live API.
 *
 * Run with:
 *   ASSINAFY_API_KEY=... ASSINAFY_ACCOUNT_ID=... bun scripts/quick-probe.ts
 */
import { AssinafyClient } from '../src';

const apiKey = process.env.ASSINAFY_API_KEY;
const accountId = process.env.ASSINAFY_ACCOUNT_ID;
if (!apiKey || !accountId) {
    throw new Error('Set ASSINAFY_API_KEY and ASSINAFY_ACCOUNT_ID.');
}

const client = new AssinafyClient({ apiKey, accountId });

async function main(): Promise<void> {
    const docs = await client.documents.list({ per_page: 1 });
    console.log('documents.list →', docs.data.length, 'docs, meta:', docs.meta);

    const signers = await client.signers.list({ per_page: 1 });
    console.log('signers.list →', signers.data.length, 'signers, meta:', signers.meta);

    const templates = await client.templates.list({ per_page: 1 });
    console.log('templates.list →', templates.data.length, 'templates, meta:', templates.meta);

    const eventTypes = await client.webhooks.listEventTypes();
    console.log('webhooks.listEventTypes →', eventTypes.length, 'event types');

    const sub = await client.webhooks.get();
    console.log('webhooks.get →', sub);

    const verify = await client.documents.verify('FE32EDDADE7CBDDCBB934E7402047450B0E59C02');
    console.log('documents.verify →', verify);

    const workspaces = await client.workspaces.list();
    console.log('workspaces.list →', workspaces.data.length, 'workspaces');

    if (workspaces.data[0]) {
        const ws = await client.workspaces.get(workspaces.data[0].id);
        console.log('workspaces.get →', ws);
    }
}

main().catch((err) => {
    console.error('error:', err);
    process.exit(1);
});
