/**
 * Live smoke test against https://api.assinafy.com.br/v1.
 *
 * Run with:
 *   ASSINAFY_API_KEY=... ASSINAFY_ACCOUNT_ID=... bun scripts/live-smoke.ts
 *
 * It exercises every read-only or non-destructive endpoint and prints PASS/FAIL
 * for each section. Add `--write` to also create + delete a signer.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AssinafyClient } from '../src';

const apiKey = process.env.ASSINAFY_API_KEY;
const accountId = process.env.ASSINAFY_ACCOUNT_ID;
if (!apiKey || !accountId) {
    throw new Error('Set ASSINAFY_API_KEY and ASSINAFY_ACCOUNT_ID.');
}

const writeMode = process.argv.includes('--write');
const uploadMode = process.argv.includes('--upload');

const client = new AssinafyClient({ apiKey, accountId });

const results: Array<{ section: string; ok: boolean; note: string }> = [];

async function run(section: string, fn: () => Promise<string>): Promise<void> {
    try {
        const note = await fn();
        results.push({ section, ok: true, note });
        console.log(`PASS ${section}: ${note}`);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ section, ok: false, note: msg });
        console.log(`FAIL ${section}: ${msg}`);
    }
}

async function main(): Promise<void> {
    await run('workspaces.list', async () => {
        const { data } = await client.workspaces.list();
        return `${data.length} workspaces`;
    });

    await run('workspaces.get(default)', async () => {
        const ws = await client.workspaces.get(accountId);
        return `workspace ${ws.name} (${ws.id})`;
    });

    await run('documents.statuses', async () => {
        const statuses = await client.documents.statuses();
        return `${statuses.length} statuses, first=${statuses[0]?.code ?? '?'}`;
    });

    await run('documents.list', async () => {
        const { data, meta } = await client.documents.list({ per_page: 5 });
        return `${data.length} docs (total ${meta?.total ?? '?'})`;
    });

    await run('signers.list', async () => {
        const { data, meta } = await client.signers.list({ per_page: 5 });
        return `${data.length} signers (total ${meta?.total ?? '?'})`;
    });

    await run('templates.list', async () => {
        const { data, meta } = await client.templates.list({ per_page: 5 });
        return `${data.length} templates (total ${meta?.total ?? '?'})`;
    });

    await run('webhooks.listEventTypes', async () => {
        const types = await client.webhooks.listEventTypes();
        return `${types.length} event types`;
    });

    await run('webhooks.get (may be null)', async () => {
        const sub = await client.webhooks.get();
        return sub ? `subscription url=${sub.url}, active=${sub.is_active}` : 'no subscription';
    });

    await run('webhooks.listDispatches', async () => {
        const { data, meta } = await client.webhooks.listDispatches({ 'per-page': 3 });
        return `${data.length} dispatches (total ${meta?.total ?? '?'})`;
    });

    await run('fields.list', async () => {
        const fields = await client.fields.list();
        return `${fields.length} field definitions`;
    });

    await run('fields.listTypes', async () => {
        const types = await client.fields.listTypes();
        return `${types.length} field types`;
    });

    await run('documents.verify (bogus hash)', async () => {
        const result = await client.documents.verify(
            'FE32EDDADE7CBDDCBB934E7402047450B0E59C02',
        );
        return `is_valid=${(result as Record<string, unknown>)['is_valid'] ?? '?'}`;
    });

    // Auth/users self-info
    await run('users.getApiKey (masked)', async () => {
        const r = await client.auth.getApiKey();
        return r === null
            ? 'no key generated yet'
            : `masked=${String(r['api_key'] ?? '?')}`;
    });

    if (writeMode) {
        const email = `sdk-smoke-${Date.now()}@example.com`;
        let signerId = '';

        await run('signers.create (write)', async () => {
            const s = await client.signers.create({
                full_name: 'SDK Smoke Test',
                email,
                cpf: '123.456.789-09',
            });
            signerId = s.id;
            return `created ${s.id}`;
        });

        await run('signers.findByEmail', async () => {
            const s = await client.signers.findByEmail(email);
            return s ? `found ${s.id}` : 'not found';
        });

        await run('signers.get', async () => {
            const s = await client.signers.get(signerId);
            return `name=${s.full_name}`;
        });

        await run('signers.update', async () => {
            const s = await client.signers.update(signerId, { full_name: 'SDK Smoke Test Updated' });
            return `name=${s.full_name}`;
        });

        await run('signers.delete', async () => {
            await client.signers.delete(signerId);
            return 'deleted';
        });
    }

    if (uploadMode) {
        const pdfPath = process.env.SAMPLE_PDF ?? '/tmp/test-doc.pdf';
        const buf = await fs.readFile(pdfPath);
        let documentId = '';

        await run('documents.upload', async () => {
            const d = await client.documents.upload({ buffer: buf, fileName: path.basename(pdfPath) });
            documentId = d.id;
            return `uploaded ${d.id} status=${d.status}`;
        });

        await run('documents.details', async () => {
            const d = await client.documents.details(documentId);
            return `name=${d.name} status=${d.status}`;
        });

        await run('documents.activities', async () => {
            const acts = await client.documents.activities(documentId);
            return `${acts.length} activities`;
        });

        await run('documents.waitUntilReady', async () => {
            const d = await client.documents.waitUntilReady(documentId, { maxWaitMs: 60_000, pollIntervalMs: 2_000 });
            return `status=${d.status}`;
        });

        await run('assignments.estimateCost (email)', async () => {
            const r = await client.assignments.estimateCost(documentId, {
                method: 'virtual',
                signers: [{}],
            });
            return `credits=${(r as Record<string, unknown>)['total_credits'] ?? '?'}`;
        });

        await run('documents.delete', async () => {
            await client.documents.delete(documentId);
            return 'deleted';
        });
    }

    console.log('\n----- summary -----');
    const passed = results.filter((r) => r.ok).length;
    console.log(`${passed}/${results.length} passed`);
    if (passed !== results.length) {
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error('Unhandled error:', err);
    process.exit(1);
});
