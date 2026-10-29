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
const EXPECTED_CONTRACT_FINGERPRINT = '014ad8040c0a611e470872f88bf9c7aef536c8aa7fd6f332d16f4a066d87f790';
const NON_CONTRACT_KEYS = new Set([
    'description',
    'summary',
    'operationId',
    'example',
    'examples',
    'externalDocs',
]);
const NAMED_CONTRACT_MAPS = new Set([
    'properties', 'patternProperties', '$defs', 'definitions', 'schemas',
    'parameters', 'responses', 'headers', 'requestBodies', 'securitySchemes',
    'links', 'callbacks',
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

function sameMembers(value: unknown, expected: readonly string[]): boolean {
    return Array.isArray(value)
        && value.length === expected.length
        && expected.every((item) => value.includes(item));
}

function assertContract(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(`OpenAPI structural drift: ${message}`);
}

function normalizedContract(value: unknown, namedEntries = false): unknown {
    if (Array.isArray(value)) return value.map((item) => normalizedContract(item));
    if (!isRecord(value)) return value;

    return Object.fromEntries(
        Object.keys(value)
            .filter((key) => namedEntries || !NON_CONTRACT_KEYS.has(key))
            .sort()
            .map((key) => [key, normalizedContract(value[key], NAMED_CONTRACT_MAPS.has(key))]),
    );
}

function validateFingerprintNormalization(): void {
    for (const name of NON_CONTRACT_KEYS) {
        const fingerprint = (type: string, description: string): string => contractFingerprint({
            components: { schemas: { [name]: { description, properties: { [name]: { type } } } } },
        });
        assertContract(fingerprint('string', 'first') === fingerprint('string', 'second'),
            'fingerprints must ignore prose annotations');
        assertContract(fingerprint('string', 'first') !== fingerprint('number', 'first'),
            'fingerprints must retain schema names and payload properties named like annotations');
    }
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

    const activitiesPath = '/v1/documents/{documentId}/activities';
    const activitiesParameters = at(spec, 'paths', activitiesPath, 'get', 'parameters');
    for (const name of ['Page', 'PerPage']) {
        requireValue(
            Array.isArray(activitiesParameters) && activitiesParameters.some(
                (entry: unknown) => at(entry, '$ref') === `#/components/parameters/${name}`,
            ),
            `document activities must accept ${name}`,
        );
    }
    requireValue(
        at(parameter(spec, activitiesPath, 'get', 'sort'), 'in') === 'query'
            && at(parameter(spec, activitiesPath, 'get', 'sort'), 'schema', 'type') === 'string',
        'document activities must accept sort',
    );
    requireValue(
        at(spec, 'components', 'parameters', 'PerPage', 'schema', 'maximum') === 100,
        'document activities must allow per-page up to 100',
    );

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
            sameMembers(methods, ['Email', 'Whatsapp', 'DigitalCertificate', 'IdDocumentFaceMatchBasic']),
            `${path} verification methods changed`,
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
        isRecord(preferenceProperties)
            && sameMembers(Object.keys(preferenceProperties), [
                'DocumentCompleted',
                'SignerDeclined',
                'DocumentCancelled',
                'DocumentAboutToExpire',
                'DocumentExpired',
                'DocumentExpirationReset',
                'DocumentProcessingFailed',
                'TemplateProcessingFailed',
                'SignerWhatsappFailed',
                'ContractRenewalNotice',
                'ContractExpiring',
                'ContractExpired',
                'ContractRenewed',
            ]),
        'NotificationPreferences keys changed',
    );
    const contractStatuses = ['draft', 'active', 'expired', 'terminated'];
    const relationTypes = ['amendment', 'renewal', 'termination'];
    requireValue(
        sameMembers(
            at(spec, 'components', 'schemas', 'DocumentContract', 'properties', 'status', 'enum'),
            contractStatuses,
        )
            && at(spec, 'components', 'schemas', 'Document', 'properties', 'has_contract', 'type') === 'boolean',
        'contract status or document has_contract changed',
    );
    requireValue(
        sameMembers(
            at(spec, 'components', 'schemas', 'DocumentContractAmendment', 'properties',
                'relation_type', 'enum'),
            relationTypes,
        )
            && sameMembers(
                at(spec, 'components', 'schemas', 'DocumentContractAmendment', 'properties',
                    'status', 'enum'),
                ['pending', 'applied'],
            ),
        'contract amendment relation or lifecycle states changed',
    );
    const contractInputProperties = at(
        spec, 'components', 'schemas', 'DocumentContractInput', 'properties',
    );
    requireValue(
        isRecord(contractInputProperties)
            && sameMembers(Object.keys(contractInputProperties), [
                'status',
                'counterparty_name',
                'counterparty_taxpayer_id',
                'value',
                'currency',
                'start_date',
                'end_date',
                'auto_renew',
                'renewal_term_months',
                'notice_period_days',
                'owner_id',
                'metadata',
                'external_references',
                'parent_document_id',
                'relation_type',
                'updated_at',
            ])
            && sameMembers(at(contractInputProperties, 'status', 'enum'), contractStatuses)
            && sameMembers(at(contractInputProperties, 'relation_type', 'enum'), relationTypes),
        'DocumentContractInput fields changed',
    );
    requireValue(
        sameMembers(
            at(parameter(spec, '/v1/accounts/{accountId}/contracts', 'get', 'status'),
                'schema', 'items', 'enum'),
            contractStatuses,
        )
            && at(parameter(spec, '/v1/accounts/{accountId}/contracts', 'get', 'ending_within_days'),
                'schema', 'maximum') === 3650,
        'contract list filters changed',
    );
    requireValue(
        at(spec, 'components', 'schemas', 'Assignment', 'properties', 'signing_urls', 'items', '$ref')
            === '#/components/schemas/SigningUrl'
            && at(spec, 'components', 'schemas', 'SigningUrl', 'properties', 'signer_id', 'type') === 'string'
            && at(spec, 'components', 'schemas', 'SigningUrl', 'properties', 'url', 'type') === 'string',
        'assignment signing URL shape changed',
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
    const agreementCode = at(
        spec,
        'components',
        'schemas',
        'DocumentVerification',
        'properties',
        'agreement_code',
    );
    requireValue(
        sameMembers(at(agreementCode, 'type'), ['string', 'null']),
        'DocumentVerification must expose a nullable agreement_code',
    );
    requireValue(
        at(spec, 'components', 'schemas', 'WebhookEndpoint', 'properties', 'signing_enabled', 'type') === 'boolean'
            && at(spec, 'components', 'schemas', 'WebhookEndpointSecret', 'properties', 'secret', 'type') === 'string',
        'WebhookEndpoint must expose signing_enabled and WebhookEndpointSecret a string secret',
    );
    const createEndpointBody = at(
        spec, 'paths', '/v1/accounts/{accountId}/webhooks/endpoints', 'post', 'requestBody',
        'content', 'application/json', 'schema',
    );
    requireValue(
        sameMembers(at(createEndpointBody, 'required'), ['url', 'email', 'events'])
            && at(createEndpointBody, 'properties', 'signing_enabled', 'type') === 'boolean',
        'Webhook endpoint create body must require url/email/events and accept signing_enabled',
    );
    requireValue(
        at(spec, 'paths', '/v1/accounts/{accountId}/webhooks/endpoints', 'post', 'responses',
            '200', 'content', 'application/json', 'schema', 'allOf', 1, 'properties', 'data',
            'allOf', 1, 'properties', 'secret', 'type') === 'string',
        'Webhook endpoint creation must return its signing secret',
    );
    requireValue(
        at(parameter(spec, '/v1/accounts/{accountId}/webhooks/endpoints', 'delete', 'url'), 'required') === true,
        'Webhook deletion by URL must require the url query parameter',
    );
    requireValue(
        at(parameter(spec, '/v1/accounts/{accountId}/webhooks/endpoints', 'get', 'url'), 'schema', 'type') === 'string',
        'Webhook endpoint listing must accept the exact url filter',
    );
    requireValue(
        sameMembers(at(spec, 'paths', '/v1/signers/identity-verification', 'post', 'requestBody',
            'content', 'application/json', 'schema', 'required'), ['consent'])
            && at(spec, 'paths', '/v1/signers/identity-verification', 'post', 'security', 0,
                'signerAccessCode') instanceof Array,
        'Identity verification must require explicit consent and signer-code authentication',
    );
    requireValue(
        sameMembers(at(spec, 'paths', '/v1/documents/{documentId}/assignments/{assignmentId}/signers/{signerId}/identity-verification/review',
            'post', 'requestBody', 'content', 'application/json', 'schema', 'properties', 'decision', 'enum'), ['Approved', 'Rejected'])
            && at(spec, 'components', 'schemas', 'SignerIdentityReview', 'properties', 'reason_codes',
                'items', 'properties', 'description', 'type') === 'string',
        'Identity reviews must retain their decision values and reason descriptions',
    );
    requireValue(
        sameMembers(
            at(spec, 'paths', '/v1/authentication/mfa/verify', 'post', 'requestBody',
                'content', 'application/json', 'schema', 'required'),
            ['mfa_token', 'code'],
        ),
        'Two-factor verify body must require mfa_token and code',
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
    for (const [path, schema] of [
        ['/v1/oauth/token', 'OAuthTokenRequest'],
        ['/v1/oauth/revoke', 'OAuthRevokeRequest'],
    ] as const) {
        // The SDK sends these bodies form-encoded (RFC 6749, RFC 7009).
        requireValue(
            at(
                spec,
                'paths',
                path,
                'post',
                'requestBody',
                'content',
                'application/x-www-form-urlencoded',
                'schema',
                '$ref',
            ) === `#/components/schemas/${schema}`,
            `${path} must accept a form-encoded ${schema}`,
        );
    }
    const tokenProperties = at(spec, 'components', 'schemas', 'OAuthTokenRequest', 'properties');
    const grantTypes = at(tokenProperties, 'grant_type', 'enum');
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
        isRecord(at(tokenProperties, 'code_verifier')),
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
    validateFingerprintNormalization();
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
