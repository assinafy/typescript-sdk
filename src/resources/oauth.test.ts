import { describe, expect, test } from 'bun:test';
import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { ApiError, OAuthError, ValidationError } from '../errors';
import { OAuthResource } from './oauth';

const API_BASE = 'https://api.assinafy.com.br/v1';
const ISSUER = 'https://auth.assinafy.com.br';

const PROTECTED_RESOURCE = {
    resource: 'https://api.assinafy.com.br',
    authorization_servers: [ISSUER],
    scopes_supported: ['documents:read', 'documents:write', 'webhooks:write', 'openid'],
    bearer_methods_supported: ['header'],
};

const SERVER_METADATA = {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/oauth/authorize`,
    token_endpoint: `${API_BASE}/oauth/token`,
    revocation_endpoint: `${API_BASE}/oauth/revoke`,
    userinfo_endpoint: `${API_BASE}/oauth/userinfo`,
    code_challenge_methods_supported: ['S256'],
};

const TOKENS = {
    access_token: 'access-token',
    token_type: 'Bearer',
    expires_in: 3600,
    scope: 'documents:read documents:write',
    refresh_token: 'refresh-token',
};

type Call = { method: string; url: string; body: unknown; headers: Record<string, unknown> };
type Reply = { status?: number; data?: unknown; headers?: Record<string, string> };

/**
 * Drive the resource through a real axios instance with a stub adapter.
 *
 * `withoutCredentials` clones the transport via `axios.create(defaults)`, so a
 * plain object mock would be replaced by a live instance. An adapter survives
 * that clone and exercises the genuine URL, header and body handling.
 */
function mockTransport(
    route: (url: string, config: InternalAxiosRequestConfig) => Reply,
    baseURL: string | null = API_BASE,
): { http: AxiosInstance; calls: Call[] } {
    const calls: Call[] = [];
    const http = axios.create({
        ...(baseURL === null ? {} : { baseURL }),
        adapter: async (config) => {
            const url = config.url ?? '';
            calls.push({
                method: (config.method ?? 'get').toUpperCase(),
                url,
                // The token and revocation endpoints take a form-encoded body.
                body: config.data === undefined
                    ? undefined
                    : Object.fromEntries(new URLSearchParams(String(config.data))),
                headers: { ...config.headers } as Record<string, unknown>,
            });
            const reply = route(url, config);
            const response = {
                data: reply.data ?? null,
                status: reply.status ?? 200,
                statusText: '',
                headers: reply.headers ?? {},
                config,
            };
            if (response.status >= 200 && response.status < 300) return response;
            throw new AxiosError('Request failed', String(response.status), config, {}, response);
        },
    });
    return { http, calls };
}

/** Transport answering both discovery documents and the token endpoints. */
function discoveryTransport(overrides: Record<string, Reply> = {}) {
    return mockTransport((url) => {
        if (url in overrides) return overrides[url] as Reply;
        if (url.endsWith('/.well-known/oauth-protected-resource')) {
            return { data: PROTECTED_RESOURCE };
        }
        if (url.endsWith('/.well-known/oauth-authorization-server')) {
            return { data: SERVER_METADATA };
        }
        if (url === '/oauth/token') return { data: TOKENS };
        if (url === '/oauth/revoke') return { status: 200, data: '' };
        if (url === '/oauth/userinfo') return { data: { sub: 'user-1', email: 'a@example.com' } };
        return { status: 404, data: { message: 'not found' } };
    });
}

function resourceFor(transport: { http: AxiosInstance }): OAuthResource {
    return new OAuthResource(transport.http, undefined, undefined, transport.http);
}

describe('OAuthResource discovery', () => {
    test('reads protected-resource metadata from the API host root, not /v1', async () => {
        const transport = discoveryTransport();
        const metadata = await resourceFor(transport).getProtectedResourceMetadata();

        expect(metadata).toEqual(PROTECTED_RESOURCE);
        expect(transport.calls[0]?.url).toBe(
            'https://api.assinafy.com.br/.well-known/oauth-protected-resource',
        );
    });

    test('discovers the issuer from protected-resource metadata when omitted', async () => {
        const transport = discoveryTransport();
        const metadata = await resourceFor(transport).getAuthorizationServerMetadata();

        expect(metadata).toEqual(SERVER_METADATA);
        expect(transport.calls.map((call) => call.url)).toEqual([
            'https://api.assinafy.com.br/.well-known/oauth-protected-resource',
            'https://auth.assinafy.com.br/.well-known/oauth-authorization-server',
        ]);
    });

    test('accepts an explicit issuer and tolerates a trailing slash', async () => {
        const transport = discoveryTransport();
        await resourceFor(transport).getAuthorizationServerMetadata(`${ISSUER}/`);

        expect(transport.calls).toHaveLength(1);
        expect(transport.calls[0]?.url).toBe(
            'https://auth.assinafy.com.br/.well-known/oauth-authorization-server',
        );
    });

    test('rejects metadata whose issuer disagrees with where it was fetched from', async () => {
        const transport = discoveryTransport({
            [`${ISSUER}/.well-known/oauth-authorization-server`]: {
                data: { ...SERVER_METADATA, issuer: 'https://evil.example' },
            },
        });

        await expect(
            resourceFor(transport).getAuthorizationServerMetadata(ISSUER),
        ).rejects.toBeInstanceOf(ValidationError);
    });

    test('rejects a non-https issuer before requesting anything', async () => {
        const transport = discoveryTransport();

        await expect(
            resourceFor(transport).getAuthorizationServerMetadata('http://auth.example'),
        ).rejects.toBeInstanceOf(ValidationError);
        expect(transport.calls).toHaveLength(0);
    });

    test('reports protected-resource metadata that lists no authorization server', async () => {
        const transport = discoveryTransport({
            'https://api.assinafy.com.br/.well-known/oauth-protected-resource': {
                data: { ...PROTECTED_RESOURCE, authorization_servers: [] },
            },
        });

        await expect(
            resourceFor(transport).getAuthorizationServerMetadata(),
        ).rejects.toBeInstanceOf(ValidationError);
    });

    test('omits the resource indicator for a loopback http base URL', async () => {
        const transport = mockTransport(
            () => ({ data: TOKENS }),
            'http://127.0.0.1:4321/v1',
        );
        await resourceFor(transport).exchangeCode({
            code: 'c',
            codeVerifier: 'a'.repeat(43),
            redirectUri: 'https://myapp.example.com/oauth/callback',
            clientId: 'cli',
        });

        expect(transport.calls[0]?.body).not.toHaveProperty('resource');
    });

    test('reports a transport with no base URL to derive the API origin from', async () => {
        const transport = mockTransport(() => ({ data: PROTECTED_RESOURCE }), null);

        await expect(
            resourceFor(transport).getProtectedResourceMetadata(),
        ).rejects.toBeInstanceOf(ValidationError);
    });
});

describe('OAuthResource.createAuthorizationUrl', () => {
    const base = {
        clientId: 'cli_1a2b3c',
        redirectUri: 'https://myapp.example.com/oauth/callback',
        scopes: ['documents:read', 'documents:write', 'webhooks:write'],
        authorizationEndpoint: `${ISSUER}/oauth/authorize`,
        issuer: ISSUER,
    };

    test('builds a complete PKCE authorization request', async () => {
        const transport = discoveryTransport();
        const request = await resourceFor(transport).createAuthorizationUrl(base);

        const url = new URL(request.url);
        expect(url.origin + url.pathname).toBe(`${ISSUER}/oauth/authorize`);
        expect(url.searchParams.get('response_type')).toBe('code');
        expect(url.searchParams.get('client_id')).toBe('cli_1a2b3c');
        expect(url.searchParams.get('redirect_uri')).toBe(base.redirectUri);
        expect(url.searchParams.get('scope')).toBe('documents:read documents:write webhooks:write');
        expect(url.searchParams.get('state')).toBe(request.state);
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        expect(url.searchParams.get('resource')).toBe('https://api.assinafy.com.br');
        expect(url.searchParams.get('nonce')).toBeNull();
        expect(request.issuer).toBe(ISSUER);
        expect(request.nonce).toBeUndefined();
        expect(request.codeVerifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
        // No discovery request is made when both endpoint and issuer are given.
        expect(transport.calls).toHaveLength(0);
    });

    test('derives the S256 challenge from the verifier it returns', async () => {
        const { createHash } = await import('node:crypto');
        const request = await resourceFor(discoveryTransport()).createAuthorizationUrl(base);

        expect(new URL(request.url).searchParams.get('code_challenge')).toBe(
            createHash('sha256').update(request.codeVerifier).digest('base64url'),
        );
    });

    test('discovers the endpoint and issuer when neither is supplied', async () => {
        const transport = discoveryTransport();
        const request = await resourceFor(transport).createAuthorizationUrl({
            clientId: base.clientId,
            redirectUri: base.redirectUri,
            scopes: base.scopes,
        });

        expect(request.issuer).toBe(ISSUER);
        expect(transport.calls).toHaveLength(2);
    });

    test('adds a nonce for openid, honours an explicit one, and omits it on null', async () => {
        const oauth = resourceFor(discoveryTransport());

        const openid = await oauth.createAuthorizationUrl({
            ...base,
            scopes: ['openid', 'email'],
        });
        expect(openid.nonce).toBeDefined();
        expect(new URL(openid.url).searchParams.get('nonce')).toBe(openid.nonce as string);

        const explicit = await oauth.createAuthorizationUrl({ ...base, nonce: 'fixed-nonce' });
        expect(explicit.nonce).toBe('fixed-nonce');

        const suppressed = await oauth.createAuthorizationUrl({
            ...base,
            scopes: ['openid'],
            nonce: null,
        });
        expect(suppressed.nonce).toBeUndefined();
        expect(new URL(suppressed.url).searchParams.get('nonce')).toBeNull();
    });

    test('omits the resource indicator when told to, and forwards prompt', async () => {
        const oauth = resourceFor(discoveryTransport());

        const bare = await oauth.createAuthorizationUrl({ ...base, resource: null });
        expect(new URL(bare.url).searchParams.get('resource')).toBeNull();

        const prompted = await oauth.createAuthorizationUrl({ ...base, prompt: 'consent' });
        expect(new URL(prompted.url).searchParams.get('prompt')).toBe('consent');
    });

    test('accepts caller-supplied state and verifier, and de-duplicates scopes', async () => {
        const codeVerifier = 'a'.repeat(43);
        const request = await resourceFor(discoveryTransport()).createAuthorizationUrl({
            ...base,
            scopes: ['documents:read', 'documents:read', 'openid'],
            state: 'my-state',
            codeVerifier,
        });

        expect(request.state).toBe('my-state');
        expect(request.codeVerifier).toBe(codeVerifier);
        expect(new URL(request.url).searchParams.get('scope')).toBe('documents:read openid');
    });

    test('rejects every malformed authorization option before building a URL', async () => {
        const oauth = resourceFor(discoveryTransport());
        const invalid = [
            null,
            { ...base, clientId: '' },
            { ...base, redirectUri: 'http://myapp.example.com/cb' },
            { ...base, redirectUri: 'https://myapp.example.com/cb#fragment' },
            { ...base, redirectUri: 'not-a-url' },
            { ...base, scopes: [] },
            { ...base, scopes: 'documents:read' },
            { ...base, scopes: ['documents:read openid'] },
            { ...base, scopes: [''] },
            { ...base, codeVerifier: 'too-short' },
            { ...base, codeVerifier: `${'a'.repeat(42)}!` },
            { ...base, state: '' },
            { ...base, nonce: '' },
            { ...base, prompt: '' },
            { ...base, resource: 'http://api.example' },
            { ...base, authorizationEndpoint: 'http://auth.example/authorize' },
        ];

        for (const options of invalid) {
            await expect(
                oauth.createAuthorizationUrl(options as never),
            ).rejects.toBeInstanceOf(ValidationError);
        }
    });
});

describe('OAuthResource.readAuthorizationCallback', () => {
    const expected = { state: 'stored-state', issuer: ISSUER };
    const oauth = resourceFor(discoveryTransport());

    test('accepts every shape the callback query arrives in', () => {
        const query = `code=the-code&state=stored-state&iss=${encodeURIComponent(ISSUER)}`;
        const shapes = [
            query,
            `?${query}`,
            `https://myapp.example.com/oauth/callback?${query}`,
            new URL(`https://myapp.example.com/oauth/callback?${query}`),
            new URLSearchParams(query),
            { code: 'the-code', state: 'stored-state', iss: ISSUER },
            { code: ['the-code'], state: ['stored-state'], iss: [ISSUER], page: 1 },
        ];

        for (const shape of shapes) {
            expect(oauth.readAuthorizationCallback(shape, expected)).toEqual({
                code: 'the-code',
                state: 'stored-state',
                issuer: ISSUER,
            });
        }
    });

    test('checks iss against the Assinafy issuer when none is stored', () => {
        const stored = { state: 'stored-state' };
        expect(
            oauth.readAuthorizationCallback({ code: 'c', state: 'stored-state', iss: ISSUER }, stored),
        ).toEqual({ code: 'c', state: 'stored-state', issuer: ISSUER });

        for (const params of [
            { code: 'c', state: 'stored-state' },
            { code: 'c', state: 'stored-state', iss: 'https://auth-sandbox.assinafy.com.br' },
            // An error return is refused the same way before its error is surfaced.
            { error: 'access_denied', state: 'stored-state' },
        ]) {
            expect(() => oauth.readAuthorizationCallback(params, stored)).toThrow(ValidationError);
        }
    });

    test('refuses a response whose state is missing or does not match', () => {
        for (const params of [
            { code: 'c' },
            { code: 'c', state: 'other-state' },
            { code: 'c', state: 'stored-state-longer' },
        ]) {
            expect(() => oauth.readAuthorizationCallback(params, expected)).toThrow(ValidationError);
        }
    });

    test('refuses a response issued by a different authorization server', () => {
        expect(() =>
            oauth.readAuthorizationCallback(
                { code: 'c', state: 'stored-state', iss: 'https://evil.example' },
                expected,
            ),
        ).toThrow(ValidationError);
    });

    test('refuses a response with no iss at all when an issuer is expected', () => {
        expect(() =>
            oauth.readAuthorizationCallback({ code: 'c', state: 'stored-state' }, expected),
        ).toThrow(ValidationError);
    });

    test('ignores a trailing slash when comparing the issuer', () => {
        expect(
            oauth.readAuthorizationCallback(
                { code: 'c', state: 'stored-state', iss: `${ISSUER}/` },
                expected,
            ).code,
        ).toBe('c');
    });

    test('surfaces a declined consent as an OAuthError', () => {
        try {
            oauth.readAuthorizationCallback(
                {
                    error: 'access_denied',
                    error_description: 'The user declined.',
                    state: 'stored-state',
                    iss: ISSUER,
                },
                expected,
            );
            throw new Error('expected a throw');
        } catch (error) {
            expect(error).toBeInstanceOf(OAuthError);
            expect(error).toBeInstanceOf(ApiError);
            expect((error as OAuthError).error).toBe('access_denied');
            expect((error as OAuthError).errorDescription).toBe('The user declined.');
            expect((error as OAuthError).statusCode).toBe(400);
        }
    });

    test('refuses a response carrying neither a code nor an error', () => {
        expect(() =>
            oauth.readAuthorizationCallback({ state: 'stored-state', iss: ISSUER }, expected),
        ).toThrow(ValidationError);
    });

    test('refuses a malformed stored authorization request', () => {
        expect(() => oauth.readAuthorizationCallback({ code: 'c' }, null as never)).toThrow(
            ValidationError,
        );
        expect(() =>
            oauth.readAuthorizationCallback({ code: 'c' }, { state: '' } as never),
        ).toThrow(ValidationError);
    });
});

describe('OAuthResource token endpoints', () => {
    const exchange = {
        code: 'the-code',
        codeVerifier: 'a'.repeat(43),
        redirectUri: 'https://myapp.example.com/oauth/callback',
        clientId: 'cli_1a2b3c',
        clientSecret: 'shhh',
    };

    test('exchangeCode posts the documented authorization_code body', async () => {
        const transport = discoveryTransport();
        const tokens = await resourceFor(transport).exchangeCode(exchange);

        expect(tokens).toEqual(TOKENS);
        expect(String(transport.calls[0]?.headers['Content-Type'])).toStartWith(
            'application/x-www-form-urlencoded',
        );
        expect(transport.calls[0]).toMatchObject({
            method: 'POST',
            url: '/oauth/token',
            body: {
                grant_type: 'authorization_code',
                code: 'the-code',
                redirect_uri: exchange.redirectUri,
                code_verifier: exchange.codeVerifier,
                client_id: 'cli_1a2b3c',
                client_secret: 'shhh',
                resource: 'https://api.assinafy.com.br',
            },
        });
    });

    test('exchangeCode omits the secret for a public client and honours resource: null', async () => {
        const transport = discoveryTransport();
        await resourceFor(transport).exchangeCode({
            code: exchange.code,
            codeVerifier: exchange.codeVerifier,
            redirectUri: exchange.redirectUri,
            clientId: exchange.clientId,
            resource: null,
        });

        expect(transport.calls[0]?.body).toEqual({
            grant_type: 'authorization_code',
            code: 'the-code',
            redirect_uri: exchange.redirectUri,
            code_verifier: exchange.codeVerifier,
            client_id: 'cli_1a2b3c',
        });
    });

    test('refreshToken posts the documented refresh_token body', async () => {
        const transport = discoveryTransport();
        await resourceFor(transport).refreshToken({
            refreshToken: 'current-refresh-token',
            clientId: 'cli_1a2b3c',
            clientSecret: 'shhh',
        });

        expect(transport.calls[0]?.body).toEqual({
            grant_type: 'refresh_token',
            refresh_token: 'current-refresh-token',
            client_id: 'cli_1a2b3c',
            client_secret: 'shhh',
            resource: 'https://api.assinafy.com.br',
        });
    });

    test.each([
        ['missing', { access_token: 'new-access', token_type: 'Bearer', expires_in: 3600 }],
        ['null', { access_token: 'new-access', token_type: 'Bearer', expires_in: 3600, refresh_token: null }],
        ['empty', { access_token: 'new-access', token_type: 'Bearer', expires_in: 3600, refresh_token: '' }],
    ])('refreshToken rejects a success without a replacement refresh_token (%s)', async (_label, body) => {
        const transport = discoveryTransport({ '/oauth/token': { status: 200, data: body } });
        await expect(
            resourceFor(transport).refreshToken({ refreshToken: 'current-refresh-token', clientId: 'cli_1a2b3c' }),
        ).rejects.toThrow(/no replacement refresh_token/);
        expect(transport.calls).toHaveLength(1);
    });

    test('maps an RFC 6749 error body to a typed OAuthError', async () => {
        const transport = discoveryTransport({
            '/oauth/token': {
                status: 400,
                data: { error: 'invalid_grant', error_description: 'Authorization code expired.' },
            },
        });

        try {
            await resourceFor(transport).exchangeCode(exchange);
            throw new Error('expected a throw');
        } catch (error) {
            expect(error).toBeInstanceOf(OAuthError);
            expect((error as OAuthError).error).toBe('invalid_grant');
            expect((error as OAuthError).errorDescription).toBe('Authorization code expired.');
            expect((error as OAuthError).statusCode).toBe(400);
            expect((error as OAuthError).message).toBe(
                'invalid_grant: Authorization code expired.',
            );
        }
    });

    test('leaves a non-OAuth error body as a plain ApiError', async () => {
        const transport = discoveryTransport({
            '/oauth/token': { status: 500, data: { message: 'Erro interno.' } },
        });

        const error = await resourceFor(transport).exchangeCode(exchange).catch((err) => err);
        expect(error).toBeInstanceOf(ApiError);
        expect(error).not.toBeInstanceOf(OAuthError);
    });

    test('rejects a 2xx token response that carries no access_token', async () => {
        const transport = discoveryTransport({
            '/oauth/token': { data: { token_type: 'Bearer', expires_in: 3600 } },
        });

        await expect(resourceFor(transport).exchangeCode(exchange)).rejects.toBeInstanceOf(
            ValidationError,
        );
    });

    test('rejects malformed exchange and refresh arguments before requesting', async () => {
        const transport = discoveryTransport();
        const oauth = resourceFor(transport);
        const requests = [
            () => oauth.exchangeCode(null as never),
            () => oauth.exchangeCode({ ...exchange, code: '' }),
            () => oauth.exchangeCode({ ...exchange, codeVerifier: 'short' }),
            () => oauth.exchangeCode({ ...exchange, redirectUri: 'http://myapp.example.com/cb' }),
            () => oauth.exchangeCode({ ...exchange, clientId: '' }),
            () => oauth.exchangeCode({ ...exchange, clientSecret: '' }),
            () => oauth.exchangeCode({ ...exchange, resource: 'http://api.example' }),
            () => oauth.refreshToken(null as never),
            () => oauth.refreshToken({ refreshToken: '', clientId: 'cli' }),
            () => oauth.refreshToken({ refreshToken: 'r', clientId: '' }),
        ];

        for (const request of requests) {
            await expect(request()).rejects.toBeInstanceOf(ValidationError);
        }
        expect(transport.calls).toHaveLength(0);
    });
});

describe('OAuthResource.revokeToken', () => {
    test('posts the token, the hint and the client credentials', async () => {
        const transport = discoveryTransport();
        await resourceFor(transport).revokeToken({
            token: 'refresh-token',
            tokenTypeHint: 'refresh_token',
            clientId: 'cli_1a2b3c',
            clientSecret: 'shhh',
        });

        expect(String(transport.calls[0]?.headers['Content-Type'])).toStartWith(
            'application/x-www-form-urlencoded',
        );
        expect(transport.calls[0]).toMatchObject({
            method: 'POST',
            url: '/oauth/revoke',
            body: {
                token: 'refresh-token',
                token_type_hint: 'refresh_token',
                client_id: 'cli_1a2b3c',
                client_secret: 'shhh',
            },
        });
    });

    test('omits an absent hint and reports failed client authentication', async () => {
        const transport = discoveryTransport({
            '/oauth/revoke': {
                status: 401,
                data: { error: 'invalid_client', error_description: 'Client authentication failed.' },
            },
        });
        const oauth = resourceFor(transport);

        const error = await oauth
            .revokeToken({ token: 't', clientId: 'cli' })
            .catch((err) => err);
        expect(error).toBeInstanceOf(OAuthError);
        expect((error as OAuthError).error).toBe('invalid_client');
        expect(transport.calls[0]?.body).toEqual({ token: 't', client_id: 'cli' });
    });

    test('rejects malformed revocation arguments before requesting', async () => {
        const transport = discoveryTransport();
        const oauth = resourceFor(transport);
        const requests = [
            () => oauth.revokeToken(null as never),
            () => oauth.revokeToken({ token: '', clientId: 'cli' }),
            () => oauth.revokeToken({ token: 't', clientId: '' }),
            () => oauth.revokeToken({ token: 't', clientId: 'cli', tokenTypeHint: 'id_token' as never }),
        ];

        for (const request of requests) {
            await expect(request()).rejects.toBeInstanceOf(ValidationError);
        }
        expect(transport.calls).toHaveLength(0);
    });
});

describe('OAuthResource.getUserInfo', () => {
    test('uses the client credential when no token is supplied', async () => {
        const transport = discoveryTransport();
        const claims = await resourceFor(transport).getUserInfo();

        expect(claims).toEqual({ sub: 'user-1', email: 'a@example.com' });
        expect(transport.calls[0]).toMatchObject({ method: 'GET', url: '/oauth/userinfo' });
        expect(transport.calls[0]?.headers['Authorization']).toBeUndefined();
    });

    test('sends an explicit access token as a Bearer header', async () => {
        const transport = discoveryTransport();
        await resourceFor(transport).getUserInfo('user-access-token');

        expect(transport.calls[0]?.headers['Authorization']).toBe('Bearer user-access-token');
    });

    test('rejects an empty explicit access token', async () => {
        await expect(
            resourceFor(discoveryTransport()).getUserInfo(''),
        ).rejects.toBeInstanceOf(ValidationError);
    });

    test('exposes the insufficient_scope challenge from a 403', async () => {
        const transport = discoveryTransport({
            '/oauth/userinfo': {
                status: 403,
                data: { status: 403, data: null, message: 'Permissão insuficiente.' },
                headers: {
                    'www-authenticate':
                        'Bearer error="insufficient_scope", scope="documents:write", '
                        + 'resource_metadata="https://api.assinafy.com.br/.well-known/oauth-protected-resource"',
                },
            },
        });

        const error = await resourceFor(transport).getUserInfo().catch((err) => err);
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).challenge).toEqual({
            scheme: 'Bearer',
            error: 'insufficient_scope',
            scope: 'documents:write',
            resource_metadata: 'https://api.assinafy.com.br/.well-known/oauth-protected-resource',
        });
    });
});
