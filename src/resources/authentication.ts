import type { AxiosInstance } from 'axios';
import type {
    IApiKeyResponse,
    ILoginResponse,
    IMaskedApiKeyResponse,
    Logger,
} from '../types';
import { ValidationError } from '../errors';
import { assertEmail, assertNonEmptyString, assertRecord } from '../utils';
import { BaseResource } from './base';
import { withoutCredentials } from '../support/transport';

/**
 * Authentication endpoints (login, social login, password management) and
 * personal API key management (`/users/api-keys`).
 *
 * Most of these endpoints are intended to bootstrap an authenticated session
 * for a human user. Production server-to-server integrations should use
 * `X-Api-Key` and skip this resource entirely.
 */
export class AuthenticationResource extends BaseResource {
    private readonly publicHttp: AxiosInstance;

    constructor(
        http: AxiosInstance,
        defaultAccountId?: string,
        logger?: Logger,
        publicHttp?: AxiosInstance,
    ) {
        super(http, defaultAccountId, logger);
        this.publicHttp = withoutCredentials(publicHttp ?? http);
    }

    /**
     * Build the browser-facing OAuth start URL
     * (`GET /auth/authenticate?authclient=…`).
     *
     * This is a compatibility browser route. Confirm availability on the
     * configured host before exposing it in a login flow.
     *
     * This endpoint responds with `302` to the provider consent screen, so the
     * SDK returns the URL for your web framework to redirect to instead of
     * following the redirect inside the Node process.
     *
     * @param authClient - Provider key; currently `google`.
     * @returns An absolute URL, for example
     * `https://api.assinafy.com.br/v1/auth/authenticate?authclient=google`.
     * @throws {ValidationError} If `authClient` is not `google`.
     *
     * @example
     * ```ts
     * response.redirect(client.auth.getSocialLoginUrl('google'));
     * ```
     */
    getSocialLoginUrl(authClient: 'google' = 'google'): string {
        if (authClient !== 'google') {
            throw new ValidationError('authClient must be google');
        }
        return this.absoluteUrl('/auth/authenticate', { authclient: authClient });
    }

    /**
     * Return the Assinafy browser callback URL (`GET /login-callback`).
     *
     * This is a compatibility browser route. Confirm availability on the
     * configured host before use.
     *
     * The callback response payload is intentionally unspecified by the API;
     * OAuth providers call it in a browser. Use this URL when a provider setup
     * asks for Assinafy's callback/redirect URI.
     *
     * @returns The absolute Assinafy callback URL for the configured API host.
     *
     * @example
     * ```ts
     * console.log(client.auth.getSocialLoginCallbackUrl());
     * ```
     */
    getSocialLoginCallbackUrl(): string {
        return this.absoluteUrl('/login-callback');
    }

    /**
     * Log in with email + password (`POST /login`).
     *
     * Exchanges credentials for a JWT `access_token` plus the authenticated
     * user and the accounts they can act on. The token authenticates
     * subsequent requests; long-lived integrations should prefer an
     * `X-Api-Key` (see {@link AuthenticationResource.createApiKey}) instead of
     * storing a password.
     *
     * @param email - The user's email address, e.g. `'user@example.com'`.
     * @param password - The user's password.
     * @returns An {@link ILoginResponse} with the access token, user, and
     * accounts. Response shape:
     * ```jsonc
     * {
     *   "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…",
     *   "user": {
     *     "id": "md3j6p9w8b7y6qvqaoy5er42",
     *     "name": "Multica Test",
     *     "email": "user@example.com",
     *     "telephone": null,
     *     "government_id": "",
     *     "is_email_verified": true,
     *     "has_accepted_terms": true,
     *     "created_at": "2026-05-12T13:45:11Z",
     *     "to_be_deleted_at": null
     *   },
     *   "accounts": [
     *     {
     *       "id": "acc_example",
     *       "name": "Multica Test",
     *       "roles": ["Owner"],
     *       "is_delete_allowed": true,
     *       "created_at": "2026-05-12T13:45:11Z"
     *     }
     *   ]
     * }
     * ```
     * @throws {ValidationError} If `email` or `password` is missing.
     * @throws {ApiError} `400` if the credentials are rejected.
     *
     * @example
     * ```ts
     * const { access_token, accounts } = await client.auth.login(
     *   'user@example.com',
     *   's3cret',
     * );
     * ```
     */
    async login(email: string, password: string): Promise<ILoginResponse> {
        assertEmail(email);
        assertNonEmptyString(password, 'password');
        return this.call('Login failed', () =>
            this.publicHttp.post('/login', { email, password }),
        );
    }

    /**
     * Log in with a social provider (`POST /authentication/social-login`).
     *
     * Exchanges a provider-issued OAuth token (currently Google) for an
     * Assinafy JWT. Returns the same {@link ILoginResponse} shape as
     * {@link AuthenticationResource.login}.
     *
     * @param payload - The social-login body.
     * @param payload.provider - OAuth provider; currently exactly `'google'`.
     * @param payload.token - The provider-issued OAuth/ID token.
     * @param payload.has_accepted_terms - Whether the user has accepted the
     * terms of service.
     * @returns An {@link ILoginResponse} with the access token, user, and
     * accounts. Response shape:
     * ```jsonc
     * {
     *   "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…",
     *   "user": {
     *     "id": "md3j6p9w8b7y6qvqaoy5er42",
     *     "name": "Multica Test",
     *     "email": "user@example.com",
     *     "telephone": null,
     *     "government_id": "",
     *     "is_email_verified": true,
     *     "has_accepted_terms": true,
     *     "created_at": "2026-05-12T13:45:11Z",
     *     "to_be_deleted_at": null
     *   },
     *   "accounts": [
     *     {
     *       "id": "acc_example",
     *       "name": "Multica Test",
     *       "roles": ["Owner"],
     *       "is_delete_allowed": true,
     *       "created_at": "2026-05-12T13:45:11Z"
     *     }
     *   ]
     * }
     * ```
     * @throws {ValidationError} If `provider` is not `google`, `token` is
     * missing, or `has_accepted_terms` is not a boolean.
     * @throws {ApiError} `400` if the provider token is rejected.
     *
     * @example
     * ```ts
     * const session = await client.auth.socialLogin({
     *   provider: 'google',
     *   token: googleIdToken,
     *   has_accepted_terms: true,
     * });
     * ```
     */
    async socialLogin(payload: {
        /** OAuth provider. The current API accepts only `google`. */
        provider: 'google';
        token: string;
        has_accepted_terms: boolean;
    }): Promise<ILoginResponse> {
        assertRecord(payload, 'social login payload');
        if (payload.provider !== 'google') {
            throw new ValidationError('provider must be google');
        }
        assertNonEmptyString(payload.token, 'token');
        if (typeof payload.has_accepted_terms !== 'boolean') {
            throw new ValidationError('has_accepted_terms must be a boolean');
        }
        return this.call('Social login failed', () =>
            this.publicHttp.post('/authentication/social-login', {
                provider: payload.provider,
                token: payload.token,
                has_accepted_terms: payload.has_accepted_terms,
            }),
        );
    }

    /**
     * Link a Google identity to the authenticated user
     * (`POST /auth/link-social-login`).
     *
     * Request body:
     * ```jsonc
     * { "provider": "google", "token": "provider-issued-token" }
     * ```
     * The response is the standard status/message acknowledgement with no data,
     * so this method resolves to `void`.
     *
     * @param payload - Social provider and provider-issued access/ID token.
     * @returns Resolves when the API acknowledges that the identity was linked.
     * @throws {ValidationError} If `provider` is not `google` or `token` is empty.
     * @throws {ApiError} `400` for an invalid provider token or `401` for
     * missing/invalid Assinafy credentials.
     *
     * @example
     * ```ts
     * await client.auth.linkSocialLogin({
     *   provider: 'google',
     *   token: googleIdToken,
     * });
     * ```
     */
    async linkSocialLogin(payload: {
        provider: 'google';
        token: string;
    }): Promise<void> {
        assertRecord(payload, 'social login link payload');
        if (payload.provider !== 'google') {
            throw new ValidationError('provider must be google');
        }
        assertNonEmptyString(payload.token, 'token');
        return this.callVoid('Failed to link social login', () =>
            this.http.post('/auth/link-social-login', {
                provider: payload.provider,
                token: payload.token,
            }),
        );
    }

    /**
     * Create (or rotate) the current user's API key (`POST /users/api-keys`).
     *
     * Returns the **full, unmasked** key exactly once — store it securely, as
     * subsequent reads via {@link AuthenticationResource.getApiKey} only return
     * a masked value. Calling this again rotates the key, invalidating the
     * previous one.
     *
     * @param password - The current user's password, required to authorize
     * key generation.
     * @returns An {@link IApiKeyResponse} containing the new key. Response
     * shape:
     * ```jsonc
     * {
     *   "api_key": "Hf8s2Jd9KpQ1mZ4xVn7bLcR3tWy6aEu0oCiSgBvNEWq"
     * }
     * ```
     * @throws {ValidationError} If `password` is missing.
     * @throws {ApiError} If the API rejects the request (e.g. wrong password).
     *
     * @example
     * ```ts
     * const { api_key } = await client.auth.createApiKey('s3cret');
     * if (!api_key) throw new Error('API returned no generated key');
     * // Persist api_key now — it is not retrievable unmasked later.
     * ```
     */
    async createApiKey(password: string): Promise<IApiKeyResponse> {
        assertNonEmptyString(password, 'password');
        return this.call('Failed to create API key', () =>
            this.http.post('/users/api-keys', { password }),
        );
    }

    /**
     * Fetch a masked view of the current API key (`GET /users/api-keys`).
     *
     * Only the last few characters are revealed; the leading characters are
     * masked with asterisks. The documented no-key form is
     * `{ api_key: null }`; older deployments may return `null` for the entire
     * data value.
     * The unmasked key is only ever returned by
     * {@link AuthenticationResource.createApiKey}.
     *
     * @returns An {@link IMaskedApiKeyResponse}: `{ api_key }` with a masked
     * string or `null`, or the legacy top-level `null`. Response shape:
     * ```jsonc
     * {
     *   "api_key": "************************************************************NEWq"
     * }
     * ```
     * @throws {ApiError} If the API rejects the request.
     *
     * @example
     * ```ts
     * const masked = await client.auth.getApiKey();
     * if (masked?.api_key) console.log('Key ends with', masked.api_key.slice(-4));
     * else console.log('No API key generated yet');
     * ```
     */
    async getApiKey(): Promise<IMaskedApiKeyResponse> {
        const result = await this.call<IMaskedApiKeyResponse>(
            'Failed to fetch API key',
            () => this.http.get('/users/api-keys'),
        );
        return result ?? null;
    }

    /**
     * Revoke the current API key (`DELETE /users/api-keys`).
     *
     * After this call any existing `X-Api-Key` using the deleted key stops
     * working; generate a new one with
     * {@link AuthenticationResource.createApiKey}.
     *
     * @returns Nothing; resolves once the key is revoked.
     * @throws {ApiError} If the API rejects the request.
     *
     * @example
     * ```ts
     * await client.auth.deleteApiKey();
     * ```
     */
    async deleteApiKey(): Promise<void> {
        return this.callVoid('Failed to delete API key', () =>
            this.http.delete('/users/api-keys'),
        );
    }

    /**
     * Change the authenticated user's password
     * (`PUT /authentication/change-password`).
     *
     * Requires the current password as a confirmation. On success the API
     * echoes back the affected `email`.
     *
     * @param payload - The change-password body.
     * @param payload.email - The user's email address.
     * @param payload.password - The current password.
     * @param payload.new_password - The new password to set.
     * @returns `{ email }` — the address whose password was changed. Response
     * shape:
     * ```jsonc
     * {
     *   "email": "user@example.com"
     * }
     * ```
     * @throws {ValidationError} If `email`, `password`, or `new_password` is
     * missing.
     * @throws {ApiError} `400`/`401` if the current password is wrong or the
     * new password is rejected.
     *
     * @example
     * ```ts
     * await client.auth.changePassword({
     *   email: 'user@example.com',
     *   password: 'old-s3cret',
     *   new_password: 'new-s3cret',
     * });
     * ```
     */
    async changePassword(payload: {
        email: string;
        password: string;
        new_password: string;
    }): Promise<{ email: string }> {
        assertRecord(payload, 'change password payload');
        assertEmail(payload.email);
        assertNonEmptyString(payload.password, 'password');
        assertNonEmptyString(payload.new_password, 'new_password');
        return this.call('Failed to change password', () =>
            this.http.put('/authentication/change-password', {
                email: payload.email,
                password: payload.password,
                new_password: payload.new_password,
            }),
        );
    }

    /**
     * Request a password-reset email
     * (`PUT /authentication/request-password-reset`).
     *
     * Triggers Assinafy to email a reset link/token to the given address.
     * Complete the flow with {@link AuthenticationResource.resetPassword}.
     *
     * @param email - The email address to send the reset link to.
     * @returns `{ email }` — the address the reset link was sent to. Response
     * shape:
     * ```jsonc
     * {
     *   "email": "user@example.com"
     * }
     * ```
     * @throws {ValidationError} If `email` is missing.
     * @throws {ApiError} If the API rejects the request.
     *
     * @example
     * ```ts
     * await client.auth.requestPasswordReset('user@example.com');
     * ```
     */
    async requestPasswordReset(email: string): Promise<{ email: string }> {
        assertEmail(email);
        return this.call('Failed to request password reset', () =>
            this.publicHttp.put('/authentication/request-password-reset', { email }),
        );
    }

    /**
     * Complete a password reset using the emailed token
     * (`PUT /authentication/reset-password`).
     *
     * Consumes the token delivered by
     * {@link AuthenticationResource.requestPasswordReset} and sets the new
     * password. On success the API echoes back the affected `email`.
     *
     * @param payload - The reset-password body.
     * @param payload.email - The user's email address.
     * @param payload.token - The reset token from the emailed link. The current
     * schema leaves it optional even though the operation description says the
     * reset uses that token.
     * @param payload.new_password - The new password to set.
     * @returns `{ email }` — the address whose password was reset. Response
     * shape:
     * ```jsonc
     * {
     *   "email": "user@example.com"
     * }
     * ```
     * @throws {ValidationError} If `email` or `new_password` is missing.
     * @throws {ApiError} `400` if the token is invalid or expired.
     *
     * @example
     * ```ts
     * await client.auth.resetPassword({
     *   email: 'user@example.com',
     *   token: 'reset-token-from-email',
     *   new_password: 'new-s3cret',
     * });
     * ```
     */
    async resetPassword(payload: {
        email: string;
        token?: string;
        new_password: string;
    }): Promise<{ email: string }> {
        assertRecord(payload, 'reset password payload');
        assertEmail(payload.email);
        assertNonEmptyString(payload.new_password, 'new_password');
        const body: { email: string; token?: string; new_password: string } = {
            email: payload.email,
            new_password: payload.new_password,
        };
        if (payload.token !== undefined) {
            assertNonEmptyString(payload.token, 'token');
            body.token = payload.token;
        }
        return this.call('Failed to reset password', () =>
            this.publicHttp.put('/authentication/reset-password', body),
        );
    }

    private absoluteUrl(path: string, params: Record<string, string> = {}): string {
        const baseUrl = String(this.publicHttp.defaults.baseURL ?? '').replace(/\/$/, '');
        const url = new URL(`${baseUrl}${path}`);
        for (const [key, value] of Object.entries(params)) {
            url.searchParams.set(key, value);
        }
        return url.toString();
    }
}
