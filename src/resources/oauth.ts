import type { AxiosInstance } from 'axios';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
    IOAuthAuthorizationCallback,
    IOAuthAuthorizationRequest,
    IOAuthAuthorizationServerMetadata,
    IOAuthProtectedResourceMetadata,
    IOAuthTokenResponse,
    IOAuthUserInfo,
    Logger,
    OAuthScope,
} from '../types';
import { OAuthError, ValidationError } from '../errors';
import { assertNonEmptyString, assertRecord, cleanParams } from '../utils';
import { BaseResource } from './base';
import { withoutCredentials } from '../support/transport';

/** RFC 8615 path of this API's protected-resource metadata, served at the host root. */
const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource';

/** RFC 8414 path of the authorization server's own metadata. */
const AUTHORIZATION_SERVER_PATH = '/.well-known/oauth-authorization-server';

/** RFC 7636 code-verifier grammar: 43–128 unreserved characters. */
const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/u;

/** Token-endpoint client authentication methods Assinafy accepts. */
type TokenEndpointAuthOptions = {
    /** The application's `client_id` from Settings → OAuth applications. */
    clientId: string;
    /**
     * The application's `client_secret`. Confidential applications only —
     * public ones authenticate with PKCE and are never issued a secret. Never
     * ship it in browser, mobile, or repository code.
     */
    clientSecret?: string;
};

/**
 * OAuth 2.1 + OpenID Connect endpoints for applications acting inside *other
 * people's* workspaces.
 *
 * Use this resource only when your product is connected by its users. To
 * automate your own workspace, keep using an API key and ignore everything
 * here.
 *
 * Two hosts are involved on purpose: the consent page lives on the
 * authorization server (`https://auth.assinafy.com.br`) while the token,
 * revocation and userinfo endpoints live on this API. Both are published by
 * {@link OAuthResource.getAuthorizationServerMetadata}, so nothing needs
 * hardcoding.
 *
 * The full round trip:
 *
 * 1. {@link OAuthResource.createAuthorizationUrl} — mint PKCE + `state`, build
 *    the consent URL, store the returned request in the user's session.
 * 2. Redirect the browser there; the user picks **one** workspace and approves.
 * 3. {@link OAuthResource.readAuthorizationCallback} — check `state` and `iss`
 *    on your redirect URI, and surface a declined consent as an
 *    {@link OAuthError}.
 * 4. {@link OAuthResource.exchangeCode} — swap the 60-second code for tokens.
 * 5. Build a per-connection client with that token and read the one workspace
 *    it covers:
 *    ```ts
 *    const connected = new AssinafyClient({ token: tokens.access_token });
 *    const { data } = await connected.workspaces.list();
 *    const accountId = data[0]?.id;
 *    ```
 * 6. {@link OAuthResource.refreshToken} before the hour is up (requires
 *    `offline_access`), and {@link OAuthResource.revokeToken} when the user
 *    disconnects.
 *
 * Two facts that cause most integration bugs: a token works for exactly one
 * workspace (any other answers `403`), and a connection expires 30 days after
 * approval no matter how often it is refreshed.
 *
 * @example
 * ```ts
 * const client = new AssinafyClient();               // no credentials needed
 *
 * // Step 1 — before redirecting the user
 * const request = await client.oauth.createAuthorizationUrl({
 *   clientId: process.env.ASSINAFY_CLIENT_ID!,
 *   redirectUri: 'https://myapp.com/oauth/callback',
 *   scopes: ['documents:read', 'documents:write', 'offline_access'],
 * });
 * session.oauth = request;                           // state + codeVerifier + issuer
 * response.redirect(request.url);
 *
 * // Step 3/4 — on https://myapp.com/oauth/callback
 * const { code } = client.oauth.readAuthorizationCallback(query, session.oauth);
 * const tokens = await client.oauth.exchangeCode({
 *   code,
 *   codeVerifier: session.oauth.codeVerifier,
 *   redirectUri: 'https://myapp.com/oauth/callback',
 *   clientId: process.env.ASSINAFY_CLIENT_ID!,
 *   clientSecret: process.env.ASSINAFY_CLIENT_SECRET,
 * });
 * ```
 */
export class OAuthResource extends BaseResource {
    private readonly publicHttp: AxiosInstance;

    constructor(
        http: AxiosInstance,
        defaultAccountId?: string,
        logger?: Logger,
        publicHttp?: AxiosInstance,
    ) {
        super(http, defaultAccountId, logger);
        // The token and revocation endpoints authenticate the *application*
        // with `client_id`/`client_secret`. Sending the integrator's own
        // `X-Api-Key` alongside would leak a workspace credential to a route
        // that has no use for it.
        this.publicHttp = withoutCredentials(publicHttp ?? http);
    }

    /**
     * Read this API's protected-resource metadata
     * (`GET /.well-known/oauth-protected-resource`).
     *
     * Served at the API host root — not under `/v1` — and bare, without the
     * `{ status, message, data }` envelope, as RFC 8615 requires. Use it to
     * discover which authorization server may issue tokens for this API and
     * which scopes it accepts.
     *
     * Request body: none. Authentication: none.
     *
     * @returns The metadata document:
     * ```jsonc
     * {
     *   "resource": "https://api.assinafy.com.br",
     *   "authorization_servers": ["https://auth.assinafy.com.br"],
     *   "scopes_supported": [
     *     "documents:read", "documents:write",
     *     "templates:read", "templates:write",
     *     "account:read", "webhooks:write", "openid", "profile", "email"
     *   ],
     *   "bearer_methods_supported": ["header"]
     * }
     * ```
     * `offline_access` is deliberately absent: it is a request-time signal to
     * the authorization server, not a permission this API enforces.
     * @throws {ApiError} If the host does not publish the document.
     *
     * @example
     * ```ts
     * const metadata = await client.oauth.getProtectedResourceMetadata();
     * console.log(metadata.authorization_servers[0]);
     * ```
     */
    async getProtectedResourceMetadata(): Promise<IOAuthProtectedResourceMetadata> {
        return this.call('Failed to fetch OAuth protected-resource metadata', () =>
            this.publicHttp.get(`${this.apiOrigin()}${PROTECTED_RESOURCE_PATH}`),
        );
    }

    /**
     * Read the authorization server's metadata
     * (`GET {issuer}/.well-known/oauth-authorization-server`, RFC 8414).
     *
     * Every endpoint URL an OAuth client needs comes from here, so nothing has
     * to be hardcoded. The document is served by the authorization server, a
     * different host from this API.
     *
     * @param issuer - Issuer to read. Defaults to the first entry of
     * {@link OAuthResource.getProtectedResourceMetadata}, which costs one extra
     * request — pass the issuer to skip it.
     * @returns The metadata document:
     * ```jsonc
     * {
     *   "issuer": "https://auth.assinafy.com.br",
     *   "authorization_endpoint": "https://auth.assinafy.com.br/oauth/authorize",
     *   "token_endpoint": "https://api.assinafy.com.br/v1/oauth/token",
     *   "revocation_endpoint": "https://api.assinafy.com.br/v1/oauth/revoke",
     *   "userinfo_endpoint": "https://api.assinafy.com.br/v1/oauth/userinfo",
     *   "jwks_uri": "https://auth.assinafy.com.br/.well-known/jwks.json",
     *   "scopes_supported": ["documents:read", "documents:write", "templates:read",
     *                        "templates:write", "account:read", "webhooks:write", "openid",
     *                        "profile", "email", "offline_access"],
     *   "response_types_supported": ["code"],
     *   "grant_types_supported": ["authorization_code", "refresh_token",
     *                             "urn:ietf:params:oauth:grant-type:token-exchange"],
     *   "code_challenge_methods_supported": ["S256"],
     *   "token_endpoint_auth_methods_supported": ["client_secret_post", "none"],
     *   "authorization_response_iss_parameter_supported": true,
     *   "client_id_metadata_document_supported": true
     * }
     * ```
     * The token-exchange grant is reserved for Assinafy's internal service
     * clients; integrations use `authorization_code` and `refresh_token`.
     * @throws {ValidationError} If `issuer` is not an absolute `https://` URL,
     * or the document's own `issuer` disagrees with where it was fetched from
     * (RFC 8414 §3.3 — a mismatch means the document is not authoritative).
     * @throws {ApiError} If the authorization server rejects the request.
     *
     * @example
     * ```ts
     * const as = await client.oauth.getAuthorizationServerMetadata();
     * console.log(as.authorization_endpoint);
     * ```
     */
    async getAuthorizationServerMetadata(
        issuer?: string,
    ): Promise<IOAuthAuthorizationServerMetadata> {
        const resolved = issuer ?? (await this.defaultIssuer());
        const base = assertHttpsUrl(resolved, 'issuer').replace(/\/+$/u, '');
        const metadata = await this.call<IOAuthAuthorizationServerMetadata>(
            'Failed to fetch OAuth authorization-server metadata',
            () => this.publicHttp.get(`${base}${AUTHORIZATION_SERVER_PATH}`),
        );
        if (normaliseIssuer(metadata?.issuer) !== normaliseIssuer(base)) {
            throw new ValidationError(
                'Authorization-server metadata issuer does not match the requested issuer',
                { expected: base, received: metadata?.issuer ?? null },
            );
        }
        return metadata;
    }

    /**
     * Mint a PKCE pair and a `state`, then build the consent URL to send the
     * user's browser to (`GET {authorization_endpoint}`).
     *
     * Call this once per connection attempt and keep the whole returned object
     * in the user's session: reusing a verifier or a `state` across attempts
     * defeats both PKCE and CSRF protection. Navigate the browser to `url` with
     * a full page load — an `fetch`/XHR cannot show a consent screen.
     *
     * PKCE is mandatory for confidential applications too, and Assinafy accepts
     * only the `S256` challenge method.
     *
     * @param options - Authorization-request options.
     * @param options.clientId - The application's `client_id`.
     * @param options.redirectUri - One of the application's registered redirect
     * URIs, matched character for character (`…/callback` and `…/callback/` are
     * different). Must be `https://` and carry no fragment.
     * @param options.scopes - Permissions to request, e.g.
     * `['documents:read', 'documents:write', 'offline_access']`. Ask for the
     * minimum: the user approves all of them or none. Add `offline_access` to
     * receive a refresh token and `openid` to receive an `id_token`.
     * `webhooks:write` permits subscription updates and inactivation.
     * @param options.authorizationEndpoint - Skip discovery by supplying the
     * endpoint yourself. Defaults to the discovered
     * `authorization_endpoint`.
     * @param options.issuer - Issuer to discover from, and the value the
     * callback's `iss` must equal. Defaults to the discovered issuer.
     * @param options.resource - RFC 8707 resource indicator. Defaults to this
     * API's origin; pass `null` to omit it. It must match the value sent to the
     * token endpoint, or the exchange fails with `invalid_target`.
     * @param options.state - Supply your own CSRF value instead of a generated
     * one. Must be unique per attempt.
     * @param options.codeVerifier - Supply your own RFC 7636 verifier (43–128
     * characters from `A-Z a-z 0-9 - . _ ~`) instead of a generated one.
     * @param options.nonce - OIDC nonce echoed in the `id_token`. Generated
     * automatically when `openid` is requested; pass a string to set it or
     * `null` to omit it.
     * @param options.prompt - Forwarded as the OIDC `prompt` parameter, e.g.
     * `'consent'` to force the approval screen again.
     * @returns The request to store and redirect with:
     * ```jsonc
     * {
     *   "url": "https://auth.assinafy.com.br/oauth/authorize?response_type=code&client_id=…&redirect_uri=https%3A%2F%2Fmyapp.com%2Foauth%2Fcallback&scope=documents%3Aread+offline_access&state=8Xv…&code_challenge=E9M…&code_challenge_method=S256&resource=https%3A%2F%2Fapi.assinafy.com.br",
     *   "state": "8Xv2rQ7mJt0aLpKcWn4dZg",
     *   "codeVerifier": "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
     *   "issuer": "https://auth.assinafy.com.br",
     *   "nonce": "n-0S6_WzA2Mj"
     * }
     * ```
     * @throws {ValidationError} If `clientId` is empty, `redirectUri` is not an
     * absolute `https://` URL without a fragment, `scopes` is empty or contains
     * a value with whitespace, or a supplied `codeVerifier`/`state` is invalid.
     * @throws {ApiError} If discovery is needed and fails.
     *
     * @example
     * ```ts
     * const request = await client.oauth.createAuthorizationUrl({
     *   clientId: process.env.ASSINAFY_CLIENT_ID!,
     *   redirectUri: 'https://myapp.com/oauth/callback',
     *   scopes: ['documents:read', 'documents:write', 'offline_access'],
     * });
     * session.oauth = request;
     * response.redirect(request.url);
     * ```
     */
    async createAuthorizationUrl(options: {
        clientId: string;
        redirectUri: string;
        scopes: OAuthScope[];
        authorizationEndpoint?: string;
        issuer?: string;
        resource?: string | null;
        state?: string;
        codeVerifier?: string;
        nonce?: string | null;
        prompt?: string;
    }): Promise<IOAuthAuthorizationRequest> {
        assertRecord(options, 'authorization options');
        assertNonEmptyString(options.clientId, 'clientId');
        assertRedirectUri(options.redirectUri);
        const scope = assertScopes(options.scopes);

        let endpoint = options.authorizationEndpoint;
        let issuer = options.issuer;
        if (endpoint === undefined || issuer === undefined) {
            const metadata = await this.getAuthorizationServerMetadata(options.issuer);
            endpoint ??= metadata.authorization_endpoint;
            issuer ??= metadata.issuer;
        }
        assertHttpsUrl(endpoint, 'authorizationEndpoint');
        assertHttpsUrl(issuer, 'issuer');

        const codeVerifier = options.codeVerifier ?? createCodeVerifier();
        assertCodeVerifier(codeVerifier);
        const state = options.state ?? createRandomValue(16);
        assertNonEmptyString(state, 'state');

        const url = new URL(endpoint);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('client_id', options.clientId);
        url.searchParams.set('redirect_uri', options.redirectUri);
        url.searchParams.set('scope', scope);
        url.searchParams.set('state', state);
        url.searchParams.set('code_challenge', codeChallengeFor(codeVerifier));
        url.searchParams.set('code_challenge_method', 'S256');

        const { resource } = this.resourceParam(options.resource);
        if (resource !== undefined) url.searchParams.set('resource', resource);

        // A nonce only means something for OpenID Connect, so default it to the
        // presence of the `openid` scope rather than always emitting one.
        const wantsNonce = options.nonce === undefined
            ? options.scopes.includes('openid')
            : options.nonce !== null;
        const nonce = wantsNonce ? (options.nonce ?? createRandomValue(16)) : undefined;
        if (nonce !== undefined) {
            assertNonEmptyString(nonce, 'nonce');
            url.searchParams.set('nonce', nonce);
        }
        if (options.prompt !== undefined) {
            assertNonEmptyString(options.prompt, 'prompt');
            url.searchParams.set('prompt', options.prompt);
        }

        this.logger.info('Built OAuth authorization URL');

        const request: IOAuthAuthorizationRequest = {
            url: url.toString(),
            state,
            codeVerifier,
            issuer,
        };
        if (nonce !== undefined) request.nonce = nonce;
        return request;
    }

    /**
     * Validate the authorization response that lands on your redirect URI and
     * return the code to exchange.
     *
     * Checks, in order and before anything else is trusted: `state` equals the
     * value from {@link OAuthResource.createAuthorizationUrl} (constant-time),
     * `iss` is present and equals the expected issuer, and only then whether
     * the server reported an error. A declined consent arrives as
     * `?error=access_denied`, not as a failed HTTP request.
     *
     * The `iss` check is strict because the authorization server advertises
     * RFC 9207 support and always sends the parameter: a missing `iss` is
     * treated exactly like a wrong one. Omit `expected.issuer` only if
     * something between the browser and your handler strips query parameters.
     *
     * This performs no network I/O.
     *
     * @param params - The callback's query parameters. Accepts an Express-style
     * `req.query` record, a `URLSearchParams`, a `URL`, a full callback URL
     * string, or a bare `a=b&c=d` query string.
     * @param expected - The stored {@link IOAuthAuthorizationRequest} (or any
     * object carrying its `state` and `issuer`).
     * @returns The validated response:
     * ```jsonc
     * {
     *   "code": "def50200a1b2c3…",
     *   "state": "8Xv2rQ7mJt0aLpKcWn4dZg",
     *   "issuer": "https://auth.assinafy.com.br"
     * }
     * ```
     * @throws {ValidationError} If `state` is missing or does not match, `iss`
     * is absent or disagrees with the expected issuer, or a successful response
     * carries no `code`. In every case the response is not yours — stop, do not
     * exchange.
     * @throws {OAuthError} If the server returned `error` (e.g.
     * `access_denied`, `invalid_scope`, `invalid_request`,
     * `unsupported_response_type`, `invalid_target`).
     *
     * @example
     * ```ts
     * app.get('/oauth/callback', async (req, res) => {
     *   const stored = req.session.oauth;
     *   const { code } = client.oauth.readAuthorizationCallback(req.query, stored);
     *   const tokens = await client.oauth.exchangeCode({
     *     code,
     *     codeVerifier: stored.codeVerifier,
     *     redirectUri: 'https://myapp.com/oauth/callback',
     *     clientId: process.env.ASSINAFY_CLIENT_ID!,
     *     clientSecret: process.env.ASSINAFY_CLIENT_SECRET,
     *   });
     * });
     * ```
     */
    readAuthorizationCallback(
        params: string | URL | URLSearchParams | Record<string, unknown>,
        expected: { state: string; issuer?: string },
    ): IOAuthAuthorizationCallback {
        assertRecord(expected, 'expected authorization request');
        assertNonEmptyString(expected.state, 'expected.state');
        const query = toSearchParams(params);

        const state = query.get('state');
        if (state === null || !constantTimeEquals(state, expected.state)) {
            throw new ValidationError(
                'OAuth callback state does not match the stored authorization request',
            );
        }

        const issuer = query.get('iss') ?? undefined;
        if (expected.issuer !== undefined) {
            // RFC 9207. The authorization server advertises
            // `authorization_response_iss_parameter_supported: true`, so a
            // response without `iss` is as suspect as one with the wrong `iss`:
            // both mean it may have been minted somewhere else. Callers that
            // must tolerate a proxy stripping the parameter omit
            // `expected.issuer` instead.
            if (issuer === undefined || normaliseIssuer(issuer) !== normaliseIssuer(expected.issuer)) {
                throw new ValidationError(
                    'OAuth callback issuer is missing or does not match the expected issuer',
                    { expected: expected.issuer, received: issuer ?? null },
                );
            }
        }

        const error = query.get('error');
        if (error !== null && error.length > 0) {
            throw new OAuthError(error, query.get('error_description'), 400, {
                error,
                error_description: query.get('error_description'),
            });
        }

        const code = query.get('code');
        if (code === null || code.length === 0) {
            throw new ValidationError('OAuth callback carries neither a code nor an error');
        }

        const result: IOAuthAuthorizationCallback = { code, state };
        if (issuer !== undefined) result.issuer = issuer;
        return result;
    }

    /**
     * Exchange an authorization code for tokens
     * (`POST /oauth/token`, `grant_type=authorization_code`).
     *
     * Run this on your server: the code is single-use and expires **60 seconds**
     * after approval, and a confidential application's secret must never reach
     * a browser. Every value must match the authorization request exactly, or
     * the API answers `invalid_grant`.
     *
     * @param options - Exchange options.
     * @param options.code - The code from
     * {@link OAuthResource.readAuthorizationCallback}.
     * @param options.codeVerifier - The verifier stored alongside the request.
     * @param options.redirectUri - The same redirect URI that was authorized.
     * @param options.clientId - The application's `client_id`.
     * @param options.clientSecret - The `client_secret`, for confidential
     * applications only. Public applications omit it and rely on PKCE.
     * @param options.resource - The same RFC 8707 resource indicator sent to
     * the authorization endpoint. Defaults to this API's origin; pass `null` to
     * omit it. A value disagreeing with the authorized one fails with
     * `invalid_target`.
     * @returns The token set — a flat object, **not** the API's usual envelope:
     * ```jsonc
     * {
     *   "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9…",
     *   "token_type": "Bearer",
     *   "expires_in": 3600,
     *   "scope": "documents:read documents:write",
     *   "refresh_token": "def5020088c2…",   // only with offline_access
     *   "id_token": "eyJraWQiOiJEQlR0S0…"   // only with openid
     * }
     * ```
     * Read `scope` rather than assuming every requested permission was granted.
     * @throws {ValidationError} If an argument is missing or malformed, or a
     * `2xx` response carries no `access_token`.
     * @throws {OAuthError} `invalid_grant` for a spent, expired, replayed or
     * mismatched code; `invalid_client` for a bad `client_id`/`client_secret`;
     * `invalid_target` for a `resource` mismatch.
     *
     * @example
     * ```ts
     * const tokens = await client.oauth.exchangeCode({
     *   code,
     *   codeVerifier: session.oauth.codeVerifier,
     *   redirectUri: 'https://myapp.com/oauth/callback',
     *   clientId: process.env.ASSINAFY_CLIENT_ID!,
     *   clientSecret: process.env.ASSINAFY_CLIENT_SECRET,
     * });
     * ```
     */
    async exchangeCode(options: TokenEndpointAuthOptions & {
        code: string;
        codeVerifier: string;
        redirectUri: string;
        resource?: string | null;
    }): Promise<IOAuthTokenResponse> {
        assertRecord(options, 'code exchange options');
        assertNonEmptyString(options.code, 'code');
        assertCodeVerifier(options.codeVerifier);
        assertRedirectUri(options.redirectUri);

        return this.requestToken('Failed to exchange the OAuth authorization code', {
            grant_type: 'authorization_code',
            code: options.code,
            redirect_uri: options.redirectUri,
            code_verifier: options.codeVerifier,
            ...this.clientAuth(options),
            ...this.resourceParam(options.resource),
        });
    }

    /**
     * Renew an access token (`POST /oauth/token`, `grant_type=refresh_token`).
     *
     * Access tokens last one hour; refresh tokens are available only when
     * `offline_access` was requested and granted.
     *
     * **Refresh tokens rotate.** Every call returns a new one and retires the
     * one you sent, and a replayed refresh token cannot be told apart from a
     * stolen one — so the server ends the entire connection and the user must
     * reconnect. Therefore: persist `refresh_token` from the response before
     * doing anything else with it, treat a timeout as "it may have succeeded"
     * and re-read your stored token instead of retrying blindly, and never run
     * two refreshes concurrently for one connection.
     *
     * Refreshing does not extend the connection's 30-day life.
     *
     * @param options - Refresh options.
     * @param options.refreshToken - The current refresh token.
     * @param options.clientId - The application's `client_id`.
     * @param options.clientSecret - The `client_secret`, for confidential
     * applications only.
     * @param options.resource - RFC 8707 resource indicator. Defaults to this
     * API's origin; pass `null` to omit it.
     * @returns A fresh token set, identical in shape to
     * {@link OAuthResource.exchangeCode}:
     * ```jsonc
     * {
     *   "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9…",
     *   "token_type": "Bearer",
     *   "expires_in": 3600,
     *   "scope": "documents:read documents:write",
     *   "refresh_token": "def50200f1e2…"    // NEW — persist it immediately
     * }
     * ```
     * @throws {ValidationError} If an argument is missing, or a `2xx` response
     * carries no `access_token`.
     * @throws {OAuthError} `invalid_grant` when the refresh token was already
     * used, expired, or the user reconnected with different permissions — ask
     * the user to reconnect. `invalid_client` for bad client credentials.
     *
     * @example
     * ```ts
     * const tokens = await client.oauth.refreshToken({
     *   refreshToken: connection.refreshToken,
     *   clientId: process.env.ASSINAFY_CLIENT_ID!,
     *   clientSecret: process.env.ASSINAFY_CLIENT_SECRET,
     * });
     * await connection.save({ refreshToken: tokens.refresh_token });
     * ```
     */
    async refreshToken(options: TokenEndpointAuthOptions & {
        refreshToken: string;
        resource?: string | null;
    }): Promise<IOAuthTokenResponse> {
        assertRecord(options, 'refresh options');
        assertNonEmptyString(options.refreshToken, 'refreshToken');

        return this.requestToken('Failed to refresh the OAuth access token', {
            grant_type: 'refresh_token',
            refresh_token: options.refreshToken,
            ...this.clientAuth(options),
            ...this.resourceParam(options.resource),
        });
    }

    /**
     * Revoke an access or refresh token (`POST /oauth/revoke`, RFC 7009).
     *
     * Call this when a user disconnects your app, instead of only deleting your
     * copy of the token. Revoking a refresh token ends the whole connection.
     *
     * Every token outcome answers `200` — unknown, malformed and
     * already-revoked included — so the endpoint cannot be used to probe
     * whether a token exists. Only failed client authentication returns `401`.
     *
     * @param options - Revocation options.
     * @param options.token - The access or refresh token to revoke.
     * @param options.clientId - The application's `client_id`.
     * @param options.clientSecret - The `client_secret`, for confidential
     * applications only.
     * @param options.tokenTypeHint - Optional `access_token` or
     * `refresh_token` hint that lets the server skip a lookup.
     * @returns Nothing; resolves once the API acknowledges the request.
     * Request body:
     * ```jsonc
     * {
     *   "token": "def50200f1e2…",
     *   "token_type_hint": "refresh_token",
     *   "client_id": "cli_1a2b3c",
     *   "client_secret": "…"
     * }
     * ```
     * @throws {ValidationError} If `token` or `clientId` is missing, or
     * `tokenTypeHint` is not one of the two documented values.
     * @throws {OAuthError} `invalid_client` when client authentication fails.
     *
     * @example
     * ```ts
     * await client.oauth.revokeToken({
     *   token: connection.refreshToken,
     *   tokenTypeHint: 'refresh_token',
     *   clientId: process.env.ASSINAFY_CLIENT_ID!,
     *   clientSecret: process.env.ASSINAFY_CLIENT_SECRET,
     * });
     * ```
     */
    async revokeToken(options: TokenEndpointAuthOptions & {
        token: string;
        tokenTypeHint?: 'access_token' | 'refresh_token';
    }): Promise<void> {
        assertRecord(options, 'revocation options');
        assertNonEmptyString(options.token, 'token');
        if (
            options.tokenTypeHint !== undefined
            && options.tokenTypeHint !== 'access_token'
            && options.tokenTypeHint !== 'refresh_token'
        ) {
            throw new ValidationError('tokenTypeHint must be access_token or refresh_token');
        }

        const body = cleanParams({
            token: options.token,
            token_type_hint: options.tokenTypeHint,
            ...this.clientAuth(options),
        });
        try {
            await this.callVoid('Failed to revoke the OAuth token', () =>
                this.publicHttp.post('/oauth/revoke', body),
            );
        } catch (error) {
            throw OAuthError.upgrade(error);
        }
    }

    /**
     * Read the OpenID Connect claims of the user who authorized a token
     * (`GET /oauth/userinfo`).
     *
     * Requires the `openid` scope; `name` additionally requires `profile` and
     * `email`/`email_verified` require `email`. Per OIDC Core §5.3.2 the
     * response is a flat claims object, not this API's usual envelope.
     *
     * @param accessToken - Token to introspect. Omit to use the credential the
     * client was constructed with (`token` or `apiKey`).
     * @returns The claims the granted scopes allow:
     * ```jsonc
     * {
     *   "sub": "d6zqpbyog2v3xvxerwn8la94",
     *   "name": "Maria Silva",
     *   "email": "maria@example.com",
     *   "email_verified": true
     * }
     * ```
     * `sub` is the stable user identifier; the rest are `null` when their scope
     * was not granted.
     * @throws {ValidationError} If `accessToken` is supplied but empty.
     * @throws {ApiError} `401` when the token is missing, expired or revoked;
     * `403` when the `openid` scope was not granted — its `WWW-Authenticate`
     * header names the scope to reconnect with.
     *
     * @example
     * ```ts
     * const who = await client.oauth.getUserInfo(tokens.access_token);
     * console.log(who.sub, who.email);
     * ```
     */
    async getUserInfo(accessToken?: string): Promise<IOAuthUserInfo> {
        if (accessToken === undefined) {
            return this.call('Failed to fetch OAuth userinfo', () =>
                this.http.get('/oauth/userinfo'),
            );
        }
        assertNonEmptyString(accessToken, 'accessToken');
        return this.call('Failed to fetch OAuth userinfo', () =>
            this.publicHttp.get('/oauth/userinfo', {
                headers: { Authorization: `Bearer ${accessToken}` },
            }),
        );
    }

    /** POST the token endpoint and assert the response actually carries a token. */
    private async requestToken(
        label: string,
        body: Record<string, unknown>,
    ): Promise<IOAuthTokenResponse> {
        let tokens: IOAuthTokenResponse;
        try {
            tokens = await this.call<IOAuthTokenResponse>(label, () =>
                this.publicHttp.post('/oauth/token', cleanParams(body)),
            );
        } catch (error) {
            throw OAuthError.upgrade(error);
        }
        if (typeof tokens?.access_token !== 'string' || tokens.access_token.length === 0) {
            throw new ValidationError(`${label}: the token endpoint returned no access_token`, {
                response: tokens as unknown as Record<string, unknown>,
            });
        }
        return tokens;
    }

    /** `client_secret_post` credentials, omitting the secret for public clients. */
    private clientAuth(options: TokenEndpointAuthOptions): Record<string, string | undefined> {
        assertNonEmptyString(options.clientId, 'clientId');
        if (options.clientSecret !== undefined) {
            assertNonEmptyString(options.clientSecret, 'clientSecret');
        }
        return { client_id: options.clientId, client_secret: options.clientSecret };
    }

    /**
     * Resolve the optional RFC 8707 `resource` indicator.
     *
     * Defaults to the configured API origin, which is what this API publishes
     * as its `resource`. A loopback `http://` base URL — the shape used by mock
     * servers and the packed-consumer smoke test — has no valid resource
     * identifier, so the parameter is simply omitted rather than rejected; an
     * explicitly supplied value is still required to be `https`.
     */
    private resourceParam(resource: string | null | undefined): { resource?: string } {
        if (resource === undefined) {
            const origin = this.apiOrigin();
            return origin.startsWith('https:') ? { resource: origin } : {};
        }
        if (resource === null) return {};
        assertHttpsUrl(resource, 'resource');
        return { resource };
    }

    /** Discover which authorization server may issue tokens for this API. */
    private async defaultIssuer(): Promise<string> {
        const metadata = await this.getProtectedResourceMetadata();
        const issuer = metadata?.authorization_servers?.[0];
        if (typeof issuer !== 'string' || issuer.length === 0) {
            throw new ValidationError(
                'Protected-resource metadata lists no authorization server',
                { metadata: metadata as unknown as Record<string, unknown> },
            );
        }
        return issuer;
    }

    /**
     * Origin of the configured API host.
     *
     * The `.well-known` document and the RFC 8707 resource indicator both sit
     * at the host root, while `baseUrl` points at `/v1`.
     */
    private apiOrigin(): string {
        const baseUrl = this.publicHttp.defaults.baseURL;
        if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
            throw new ValidationError('The client has no base URL to derive the API origin from');
        }
        return new URL(baseUrl).origin;
    }
}

/** RFC 7636 verifier: 32 random bytes rendered as 43 base64url characters. */
function createCodeVerifier(): string {
    return randomBytes(32).toString('base64url');
}

/** Random base64url value used for `state` and `nonce`. */
function createRandomValue(bytes: number): string {
    return randomBytes(bytes).toString('base64url');
}

/** RFC 7636 S256 challenge derived from a verifier. */
function codeChallengeFor(codeVerifier: string): string {
    return createHash('sha256').update(codeVerifier).digest('base64url');
}

function assertCodeVerifier(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !CODE_VERIFIER_PATTERN.test(value)) {
        throw new ValidationError(
            'codeVerifier must be 43-128 characters from A-Z a-z 0-9 - . _ ~',
        );
    }
}

function assertRedirectUri(value: unknown): asserts value is string {
    const uri = assertHttpsUrl(value, 'redirectUri');
    if (uri.includes('#')) {
        throw new ValidationError('redirectUri must not contain a fragment');
    }
}

/** Require an absolute `https://` URL; returns it unchanged for chaining. */
function assertHttpsUrl(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new ValidationError(`${label} must be an absolute https URL`);
    }
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new ValidationError(`${label} must be an absolute https URL`);
    }
    if (url.protocol !== 'https:') {
        throw new ValidationError(`${label} must be an absolute https URL`);
    }
    return value;
}

/** Validate the requested permissions and join them into a `scope` string. */
function assertScopes(scopes: unknown): string {
    if (!Array.isArray(scopes) || scopes.length === 0) {
        throw new ValidationError('scopes must be a non-empty array of scope strings');
    }
    for (const scope of scopes) {
        if (typeof scope !== 'string' || scope.trim().length === 0 || /\s/u.test(scope)) {
            throw new ValidationError('each scope must be a non-empty string without whitespace');
        }
    }
    return [...new Set(scopes as string[])].join(' ');
}

/** Compare issuer identifiers ignoring a trailing slash. */
function normaliseIssuer(value: unknown): string {
    return typeof value === 'string' ? value.replace(/\/+$/u, '') : '';
}

/**
 * Compare two `state` values without leaking their contents through timing.
 *
 * Length is compared first because `timingSafeEqual` throws on a mismatch; the
 * length of a CSRF token is not the secret part.
 */
function constantTimeEquals(left: string, right: string): boolean {
    const a = Buffer.from(left, 'utf8');
    const b = Buffer.from(right, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
}

/** Accept every practical shape a callback's query parameters arrive in. */
function toSearchParams(
    params: string | URL | URLSearchParams | Record<string, unknown>,
): URLSearchParams {
    if (params instanceof URLSearchParams) return params;
    if (params instanceof URL) return params.searchParams;
    if (typeof params === 'string') {
        // A full callback URL, or the bare `code=…&state=…` query behind it.
        return params.includes('://')
            ? new URL(params).searchParams
            : new URLSearchParams(params.replace(/^\?/u, ''));
    }
    assertRecord(params, 'callback parameters');
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        // Express repeats a duplicated query key as an array; the first value
        // is the one the browser sent first, and OAuth defines no repeats.
        const first = Array.isArray(value) ? value[0] : value;
        if (typeof first === 'string') search.set(key, first);
    }
    return search;
}
