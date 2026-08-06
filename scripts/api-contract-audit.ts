/**
 * Compare the checked-in coverage ledger with Assinafy's live OpenAPI operation
 * set and verify that every referenced SDK method is actually exported. This
 * intentionally checks normalized method/path pairs rather than a byte hash,
 * so harmless prose/schema-description edits do not create false alarms while
 * endpoint additions/removals and stale method references do.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { AssinafyClient } from '../src';

const DEFAULT_SPEC_URL = 'https://api.assinafy.com.br/v1/docs/openapi.json';
const COVERAGE_FILE = new URL('../docs/API_COVERAGE.md', import.meta.url);
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

interface OpenApiDocument {
    openapi?: string;
    paths?: Record<string, Record<string, unknown>>;
}

function operationKey(method: string, path: string): string {
    return `${method.toUpperCase()} ${path}`;
}

function officialOperations(spec: OpenApiDocument): Set<string> {
    if (!spec.openapi || !spec.paths || typeof spec.paths !== 'object') {
        throw new Error('The downloaded document is not a valid OpenAPI document with paths.');
    }

    const operations = new Set<string>();
    for (const [path, pathItem] of Object.entries(spec.paths)) {
        if (!pathItem || typeof pathItem !== 'object') continue;
        for (const method of Object.keys(pathItem)) {
            const normalizedMethod = method.toUpperCase();
            if (HTTP_METHODS.has(normalizedMethod)) {
                operations.add(operationKey(normalizedMethod, path));
            }
        }
    }
    return operations;
}

function documentedOperations(markdown: string): Set<string> {
    const operations = new Set<string>();
    for (const line of markdown.split(/\r?\n/u)) {
        const columns = line.split('|').map((column) => column.trim().replace(/^`|`$/gu, ''));
        if (columns.length < 6) continue;

        const method = columns[1]?.toUpperCase() ?? '';
        const path = columns[2] ?? '';
        const sdkMethod = columns[3] ?? '';
        const status = columns[4]?.toLowerCase() ?? '';
        if (!HTTP_METHODS.has(method) || !path.startsWith('/')) continue;
        // The same document separately inventories live compatibility routes
        // that are intentionally absent from OpenAPI; exclude that table from
        // the official operation-set comparison.
        if (status.includes('live extension')) continue;
        if (!sdkMethod || sdkMethod === '—' || sdkMethod === '-') {
            throw new Error(`Coverage row has no SDK method: ${method} ${path}`);
        }
        if (!status.includes('covered') && !status.includes('url helper')) {
            throw new Error(`Coverage row has an unsupported status: ${method} ${path}`);
        }

        const key = operationKey(method, path);
        if (operations.has(key)) throw new Error(`Duplicate coverage row: ${key}`);
        operations.add(key);
    }
    return operations;
}

function validateExportedSdkMethods(markdown: string): number {
    const client = new AssinafyClient({ maxRetries: 0 });
    let validated = 0;

    for (const line of markdown.split(/\r?\n/u)) {
        const columns = line.split('|').map((column) => column.trim());
        if (columns.length < 6) continue;
        const method = columns[1]?.replaceAll('`', '').toUpperCase() ?? '';
        const path = columns[2]?.replaceAll('`', '') ?? '';
        const sdkMethod = columns[3] ?? '';
        const status = columns[4]?.toLowerCase() ?? '';
        if (!HTTP_METHODS.has(method) || !path.startsWith('/')) continue;
        if (
            !status.includes('covered')
            && !status.includes('url helper')
            && !status.includes('live extension')
        ) {
            continue;
        }

        const references = [...sdkMethod.matchAll(/client\.([A-Za-z][A-Za-z0-9]*)\.([A-Za-z][A-Za-z0-9]*)\s*\(/gu)];
        if (references.length === 0) {
            throw new Error(`Coverage row has no parseable SDK reference: ${method} ${path}`);
        }
        for (const reference of references) {
            const resourceName = reference[1]!;
            const methodName = reference[2]!;
            const resource = (client as unknown as Record<string, unknown>)[resourceName];
            if (!resource || typeof resource !== 'object') {
                throw new Error(
                    `Coverage row references missing SDK resource client.${resourceName}: ${method} ${path}`,
                );
            }
            if (typeof (resource as Record<string, unknown>)[methodName] !== 'function') {
                throw new Error(
                    `Coverage row references missing SDK method client.${resourceName}.${methodName}: ${method} ${path}`,
                );
            }
            validated += 1;
        }
    }

    return validated;
}

function difference(left: Set<string>, right: Set<string>): string[] {
    return [...left].filter((entry) => !right.has(entry)).sort();
}

async function main(): Promise<void> {
    const specUrl = process.env['ASSINAFY_OPENAPI_URL'] ?? DEFAULT_SPEC_URL;
    const response = await fetch(specUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
        throw new Error(`OpenAPI download failed with HTTP ${response.status}.`);
    }

    const spec = (await response.json()) as OpenApiDocument;
    const official = officialOperations(spec);
    const markdown = await readFile(COVERAGE_FILE, 'utf8');
    const coverage = documentedOperations(markdown);
    const exportedMethods = validateExportedSdkMethods(markdown);
    const missing = difference(official, coverage);
    const stale = difference(coverage, official);

    if (missing.length > 0 || stale.length > 0) {
        if (missing.length > 0) console.error('Missing SDK coverage rows:\n' + missing.join('\n'));
        if (stale.length > 0) console.error('Rows absent from current OpenAPI:\n' + stale.join('\n'));
        throw new Error(
            `OpenAPI drift detected (${official.size} official, ${coverage.size} documented).`,
        );
    }

    const fingerprint = createHash('sha256')
        .update([...official].sort().join('\n'))
        .digest('hex')
        .slice(0, 16);
    console.log(
        `PASS: ${official.size}/${official.size} official operations are mapped to exported SDK methods (${exportedMethods} references checked; operation-set sha256:${fingerprint}).`,
    );
}

await main();
