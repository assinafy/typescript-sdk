/**
 * Validate the checked-in coverage ledger against Assinafy's current OpenAPI
 * operation set and verify that every referenced SDK method is exported. This
 * intentionally checks normalized method/path pairs rather than a byte hash,
 * so harmless prose/schema-description edits do not create false alarms while
 * endpoint additions/removals and stale method references do.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { AssinafyClient } from '../src';
import { SDK_USER_AGENT } from '../src/support/transport';

const DEFAULT_SPEC_URL = 'https://api.assinafy.com.br/v1/docs/openapi.json';
const COVERAGE_FILE = new URL('../docs/API_COVERAGE.md', import.meta.url);
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const EXPECTED_CONTRACT_FINGERPRINT = '144bd132a436905d610148d53d284089a736b116009527ead215511594640a82';
const NON_CONTRACT_KEYS = new Set([
    'description',
    'summary',
    'operationId',
    'example',
    'examples',
    'externalDocs',
]);

interface OpenApiDocument {
    openapi?: string;
    paths?: Record<string, Record<string, unknown>>;
    components?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function at(value: unknown, ...segments: Array<string | number>): unknown {
    let current = value;
    for (const segment of segments) {
        if (typeof segment === 'number') {
            if (!Array.isArray(current)) return undefined;
            current = current[segment];
        } else {
            if (!isRecord(current)) return undefined;
            current = current[segment];
        }
    }
    return current;
}

function assertContract(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(`OpenAPI structural drift: ${message}`);
}

function normalizedContract(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalizedContract);
    if (!isRecord(value)) return value;

    return Object.fromEntries(
        Object.keys(value)
            .filter((key) => !NON_CONTRACT_KEYS.has(key))
            .sort()
            .map((key) => [key, normalizedContract(value[key])]),
    );
}

function contractFingerprint(spec: OpenApiDocument): string {
    const contract = normalizedContract({
        openapi: spec.openapi,
        paths: spec.paths,
        components: spec.components,
    });
    return createHash('sha256').update(JSON.stringify(contract)).digest('hex');
}

function parameter(
    spec: OpenApiDocument,
    path: string,
    method: string,
    name: string,
): Record<string, unknown> | undefined {
    const parameters = at(spec, 'paths', path, method, 'parameters');
    if (!Array.isArray(parameters)) return undefined;
    return parameters.find(
        (candidate): candidate is Record<string, unknown> =>
            isRecord(candidate) && candidate['name'] === name,
    );
}

function validateProductionStructure(spec: OpenApiDocument): number {
    let checked = 0;
    const requireValue = (condition: unknown, message: string): void => {
        assertContract(condition, message);
        checked++;
    };

    for (const path of [
        '/v1/documents/{documentId}/download/{artifactName}',
        '/v1/signers/{signerId}/documents/{documentId}/download/{artifactName}',
    ]) {
        const artifacts = at(parameter(spec, path, 'get', 'artifactName'), 'schema', 'enum');
        requireValue(Array.isArray(artifacts) && artifacts.includes('pades'), `${path} must include pades`);
    }

    for (const path of [
        '/v1/documents/{documentId}/assignments',
        '/v1/documents/{documentId}/assignments/estimate-cost',
        '/v1/accounts/{accountId}/templates/{templateId}/documents',
        '/v1/accounts/{accountId}/templates/{templateId}/documents/estimate-cost',
    ]) {
        const methods = at(
            spec,
            'paths',
            path,
            'post',
            'requestBody',
            'content',
            'application/json',
            'schema',
            'properties',
            'signers',
            'items',
            'properties',
            'verification_method',
            'enum',
        );
        requireValue(
            Array.isArray(methods) && methods.includes('DigitalCertificate'),
            `${path} must include DigitalCertificate`,
        );
    }

    requireValue(
        at(
            spec,
            'paths',
            '/v1/documents/{documentId}/assignments',
            'post',
            'requestBody',
            'content',
            'application/json',
            'schema',
            'properties',
            'entries',
            'items',
            'properties',
            'fields',
            'items',
            'properties',
            'display_settings',
            '$ref',
        ) === '#/components/schemas/DisplaySettings',
        'assignment display_settings must reference DisplaySettings',
    );
    requireValue(
        isRecord(at(
            spec,
            'paths',
            '/v1/accounts/{accountId}/signers/{signerId}',
            'put',
            'requestBody',
            'content',
            'application/json',
            'schema',
            'properties',
            'government_id',
        )),
        'signer update must include government_id',
    );
    requireValue(
        at(
            spec,
            'paths',
            '/v1/signers/self',
            'get',
            'responses',
            '200',
            'content',
            'application/json',
            'schema',
            'allOf',
            1,
            'properties',
            'data',
            '$ref',
        ) === '#/components/schemas/SignerSelf',
        'signers/self must return SignerSelf',
    );
    requireValue(
        at(parameter(spec, '/v1/signature', 'post', 'reuse'), 'schema', 'type') === 'boolean',
        'signature reuse must be a boolean query parameter',
    );
    const preferenceProperties = at(
        spec,
        'components',
        'schemas',
        'NotificationPreferences',
        'properties',
    );
    requireValue(
        isRecord(preferenceProperties) && Object.keys(preferenceProperties).length === 9,
        'NotificationPreferences must expose nine keys',
    );
    requireValue(
        isRecord(at(
            spec,
            'components',
            'schemas',
            'AssignmentSigner',
            'allOf',
            1,
            'properties',
            'notification_history',
        )),
        'AssignmentSigner must include notification_history',
    );
    const displayRequired = at(spec, 'components', 'schemas', 'DisplaySettings', 'required');
    requireValue(
        Array.isArray(displayRequired)
            && ['left', 'top', 'width', 'height', 'fontSize'].every((key) =>
                displayRequired.includes(key)),
        'DisplaySettings required geometry changed',
    );
    const oauthFlow = at(
        spec,
        'components',
        'securitySchemes',
        'oauth2',
        'flows',
        'authorizationCode',
    );
    requireValue(
        at(oauthFlow, 'authorizationUrl') === 'https://auth.assinafy.com.br/oauth/authorize'
            && at(oauthFlow, 'tokenUrl') === 'https://api.assinafy.com.br/v1/oauth/token',
        'OAuth authorization/token endpoints changed',
    );
    const oauthScopes = at(oauthFlow, 'scopes');
    requireValue(
        isRecord(oauthScopes)
            && [
                'documents:read',
                'documents:write',
                'templates:read',
                'templates:write',
                'account:read',
                'webhooks:write',
                'openid',
                'profile',
                'email',
                'offline_access',
            ].every((scope) => scope in oauthScopes),
        'OAuth scope catalog changed',
    );
    const grantTypes = at(
        spec,
        'paths',
        '/v1/oauth/token',
        'post',
        'requestBody',
        'content',
        'application/json',
        'schema',
        'properties',
        'grant_type',
        'enum',
    );
    requireValue(
        Array.isArray(grantTypes)
            && grantTypes.length === 3
            && grantTypes.includes('authorization_code')
            && grantTypes.includes('refresh_token')
            // The third grant is reserved for Assinafy's internal service clients.
            && grantTypes.includes('urn:ietf:params:oauth:grant-type:token-exchange'),
        'OAuth token endpoint grant types changed',
    );
    requireValue(
        isRecord(at(
            spec,
            'paths',
            '/v1/oauth/token',
            'post',
            'requestBody',
            'content',
            'application/json',
            'schema',
            'properties',
            'code_verifier',
        )),
        'OAuth token endpoint must keep PKCE code_verifier',
    );
    const statsProperties = at(spec, 'components', 'schemas', 'DocumentStatsRow', 'properties');
    requireValue(
        isRecord(statsProperties)
            && [
                'period',
                'documents_uploaded',
                'documents_sent',
                'signature_requests',
                'signature_requests_notification_email',
                'signature_requests_notification_whatsapp',
                'signature_requests_notification_bypass',
                'signature_requests_verification_email',
                'signature_requests_verification_whatsapp',
                'signature_requests_verification_bypass',
                'signature_requests_verification_digital_certificate',
                'signature_requests_viewed',
                'signature_requests_completed',
                'documents_certified',
            ].every((key) => key in statsProperties),
        'DocumentStatsRow notification/verification counters changed',
    );
    return checked;
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
        // Compatibility routes are intentionally outside the official
        // operation set.
        if (status.includes('compatibility extension')) {
            continue;
        }
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
            && !status.includes('compatibility extension')
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

/**
 * Confirm the OAuth discovery documents are actually served and agree with the
 * spec.
 *
 * They are the only part of the OAuth contract that does not live in the
 * OpenAPI document: an integration reads its endpoint URLs from them, so a
 * silent change there breaks every client without changing the spec at all.
 * RFC 8615 requires both to be bare metadata objects, not this API's envelope.
 */
async function validateOAuthDiscovery(spec: OpenApiDocument): Promise<number> {
    const flow = at(spec, 'components', 'securitySchemes', 'oauth2', 'flows', 'authorizationCode');
    const apiOrigin = new URL(String(at(flow, 'tokenUrl'))).origin;

    const resourceMetadata = await fetchJson(`${apiOrigin}/.well-known/oauth-protected-resource`);
    const issuer = at(resourceMetadata, 'authorization_servers', 0);
    assertContract(
        typeof issuer === 'string' && issuer.length > 0,
        'protected-resource metadata lists no authorization server',
    );

    const serverMetadata = await fetchJson(`${issuer}/.well-known/oauth-authorization-server`);
    for (const [document, scopes] of [
        ['protected resource', at(resourceMetadata, 'scopes_supported')],
        ['authorization server', at(serverMetadata, 'scopes_supported')],
    ] as const) {
        assertContract(
            Array.isArray(scopes) && scopes.includes('webhooks:write'),
            `${document} no longer advertises webhooks:write`,
        );
    }
    for (const [metadataKey, specKey] of [
        ['issuer', undefined],
        ['authorization_endpoint', 'authorizationUrl'],
        ['token_endpoint', 'tokenUrl'],
    ] as const) {
        const published = at(serverMetadata, metadataKey);
        const expected = specKey === undefined ? issuer : at(flow, specKey);
        assertContract(
            published === expected,
            `authorization-server ${metadataKey} (${String(published)}) disagrees with ${String(expected)}`,
        );
    }
    assertContract(
        Array.isArray(at(serverMetadata, 'code_challenge_methods_supported'))
            && (at(serverMetadata, 'code_challenge_methods_supported') as string[]).includes('S256'),
        'authorization server no longer advertises PKCE S256',
    );
    assertContract(
        at(serverMetadata, 'authorization_response_iss_parameter_supported') === true,
        'authorization server no longer sets the RFC 9207 iss parameter',
    );
    return 7;
}

async function fetchJson(url: string): Promise<unknown> {
    const response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': SDK_USER_AGENT },
        signal: AbortSignal.timeout(30_000),
    });
    assertContract(response.ok, `${url} answered HTTP ${response.status}`);
    return response.json();
}

async function main(): Promise<void> {
    const specUrl = process.env['ASSINAFY_OPENAPI_URL'] ?? DEFAULT_SPEC_URL;
    const response = await fetch(specUrl, {
        headers: { Accept: 'application/json', 'User-Agent': SDK_USER_AGENT },
        signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
        throw new Error(`OpenAPI download failed with HTTP ${response.status}.`);
    }

    const spec = (await response.json()) as OpenApiDocument;
    const currentContractFingerprint = contractFingerprint(spec);
    assertContract(
        currentContractFingerprint === EXPECTED_CONTRACT_FINGERPRINT,
        `full contract fingerprint changed (expected ${EXPECTED_CONTRACT_FINGERPRINT}, got ${currentContractFingerprint})`,
    );
    const official = officialOperations(spec);
    const structuralChecks = validateProductionStructure(spec)
        + (await validateOAuthDiscovery(spec));
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

    const operationFingerprint = createHash('sha256')
        .update([...official].sort().join('\n'))
        .digest('hex')
        .slice(0, 16);
    console.log(
        `PASS: ${official.size}/${official.size} official operations are mapped to exported SDK methods (${exportedMethods} references and ${structuralChecks} named contracts checked; operation-set sha256:${operationFingerprint}; full-contract sha256:${currentContractFingerprint.slice(0, 16)}).`,
    );
}

await main();
