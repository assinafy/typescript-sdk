import { describe, expect, test } from 'bun:test';
import type { AxiosInstance } from 'axios';
import { ValidationError } from '../errors';
import { AuthenticationResource } from './authentication';

type HttpCall = {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    url: string;
    body?: unknown;
    config?: unknown;
};

const LOGIN_RESPONSE = {
    access_token: 'jwt-token',
    user: {
        id: 'user-1',
        name: 'Test User',
        email: 'user@example.com',
        telephone: null,
        government_id: null,
        is_email_verified: true,
        has_accepted_terms: true,
        created_at: '2026-05-12T13:45:11Z',
        to_be_deleted_at: null,
    },
    accounts: [
        {
            id: 'account-1',
            name: 'Acme',
            roles: ['Owner'],
            is_delete_allowed: true,
            created_at: '2026-05-12T13:45:11Z',
        },
    ],
};

function response(data: unknown) {
    return { status: 200, data: { status: 200, data } };
}

function mockHttp(
    apiKeyResponse: { api_key: string | null } | null = { api_key: '***masked***' },
): { http: AxiosInstance; calls: HttpCall[] } {
    const calls: HttpCall[] = [];
    const http = {
        get: async (url: string, config?: unknown) => {
            calls.push({ method: 'GET', url, config });
            return response(apiKeyResponse);
        },
        post: async (url: string, body?: unknown, config?: unknown) => {
            calls.push({ method: 'POST', url, body, config });
            if (url === '/login' || url === '/authentication/social-login') {
                return response(LOGIN_RESPONSE);
            }
            if (url === '/users/api-keys') return response({ api_key: 'fresh-key' });
            return response([]);
        },
        put: async (url: string, body?: unknown, config?: unknown) => {
            calls.push({ method: 'PUT', url, body, config });
            return response({ email: (body as { email: string }).email });
        },
        delete: async (url: string, config?: unknown) => {
            calls.push({ method: 'DELETE', url, config });
            return response([]);
        },
    } as unknown as AxiosInstance;
    return { http, calls };
}

describe('AuthenticationResource', () => {
    test('builds the documented OAuth start and callback URLs', () => {
        const http = {
            defaults: { baseURL: 'https://sandbox.assinafy.com.br/v1/' },
        } as unknown as AxiosInstance;
        const auth = new AuthenticationResource(http);

        expect(auth.getSocialLoginUrl()).toBe(
            'https://sandbox.assinafy.com.br/v1/auth/authenticate?authclient=google',
        );
        expect(auth.getSocialLoginCallbackUrl()).toBe(
            'https://sandbox.assinafy.com.br/v1/login-callback',
        );
        expect(() => auth.getSocialLoginUrl('' as never)).toThrow(ValidationError);
        expect(() => auth.getSocialLoginUrl('github' as never)).toThrow(ValidationError);
    });

    test('login validates credentials and returns the POST response', async () => {
        const { http, calls } = mockHttp();
        const auth = new AuthenticationResource(http);

        await expect(auth.login('', 'password')).rejects.toThrow(ValidationError);
        await expect(auth.login('user@example.com', '')).rejects.toThrow(ValidationError);

        const result = await auth.login('user@example.com', 'password');

        expect(calls).toEqual([
            {
                method: 'POST',
                url: '/login',
                body: { email: 'user@example.com', password: 'password' },
                config: undefined,
            },
        ]);
        expect(result).toEqual(LOGIN_RESPONSE);
    });

    test('socialLogin validates and forwards the complete provider payload', async () => {
        const { http, calls } = mockHttp();
        const auth = new AuthenticationResource(http);

        await expect(
            auth.socialLogin({ provider: '' as never, token: 'token', has_accepted_terms: true }),
        ).rejects.toThrow(ValidationError);
        await expect(
            auth.socialLogin({
                provider: 'github' as never,
                token: 'token',
                has_accepted_terms: true,
            }),
        ).rejects.toThrow(ValidationError);
        await expect(
            auth.socialLogin({ provider: 'google', token: '', has_accepted_terms: true }),
        ).rejects.toThrow(ValidationError);
        await expect(
            auth.socialLogin({ provider: 'google', token: 'token' } as never),
        ).rejects.toThrow(ValidationError);
        await expect(
            auth.socialLogin({
                provider: 'google',
                token: 'token',
                has_accepted_terms: 'true',
            } as never),
        ).rejects.toThrow(ValidationError);

        const payload = {
            provider: 'google' as const,
            token: 'provider-token',
            has_accepted_terms: false,
        };
        const result = await auth.socialLogin(payload);

        expect(calls).toEqual([
            {
                method: 'POST',
                url: '/authentication/social-login',
                body: payload,
                config: undefined,
            },
        ]);
        expect(result).toEqual(LOGIN_RESPONSE);
    });

    test('payload methods reject null with ValidationError before requesting', async () => {
        const { http, calls } = mockHttp();
        const auth = new AuthenticationResource(http);
        const requests = [
            () => auth.socialLogin(null as never),
            () => auth.linkSocialLogin(null as never),
            () => auth.changePassword(null as never),
            () => auth.resetPassword(null as never),
        ];

        for (const request of requests) {
            await expect(request()).rejects.toBeInstanceOf(ValidationError);
        }
        expect(calls).toHaveLength(0);
    });

    test('closed authentication payloads do not forward structural extras', async () => {
        const { http, calls } = mockHttp();
        const auth = new AuthenticationResource(http);

        await auth.socialLogin({
            provider: 'google',
            token: 'provider-token',
            has_accepted_terms: true,
            internal_secret: 'do-not-send',
        } as never);
        await auth.linkSocialLogin({
            provider: 'google',
            token: 'provider-token',
            internal_secret: 'do-not-send',
        } as never);
        await auth.changePassword({
            email: 'user@example.com',
            password: 'old-password',
            new_password: 'new-password',
            internal_secret: 'do-not-send',
        } as never);
        await auth.resetPassword({
            email: 'user@example.com',
            token: 'reset-token',
            new_password: 'new-password',
            internal_secret: 'do-not-send',
        } as never);

        expect(calls.map((call) => call.body)).toEqual([
            {
                provider: 'google',
                token: 'provider-token',
                has_accepted_terms: true,
            },
            { provider: 'google', token: 'provider-token' },
            {
                email: 'user@example.com',
                password: 'old-password',
                new_password: 'new-password',
            },
            {
                email: 'user@example.com',
                token: 'reset-token',
                new_password: 'new-password',
            },
        ]);
    });

    test('closed authentication fields reject truthy non-strings before requesting', async () => {
        const { http, calls } = mockHttp();
        const auth = new AuthenticationResource(http);
        const requests = [
            () => auth.login(42 as never, 'password'),
            () => auth.login('user@example.com', {} as never),
            () => auth.socialLogin({
                provider: 'google',
                token: 42,
                has_accepted_terms: true,
            } as never),
            () => auth.linkSocialLogin({ provider: 'google', token: {} } as never),
            () => auth.createApiKey(42 as never),
            () => auth.changePassword({
                email: 42,
                password: 'old-password',
                new_password: 'new-password',
            } as never),
            () => auth.requestPasswordReset({} as never),
            () => auth.resetPassword({
                email: 'user@example.com',
                token: 42,
                new_password: 'new-password',
            } as never),
        ];

        for (const request of requests) {
            await expect(request()).rejects.toBeInstanceOf(ValidationError);
        }
        expect(calls).toHaveLength(0);
    });

    test('email-formatted authentication fields reject malformed addresses before requesting', async () => {
        const { http, calls } = mockHttp();
        const auth = new AuthenticationResource(http);
        const requests = [
            () => auth.login('not-an-email', 'password'),
            () => auth.changePassword({
                email: 'not-an-email',
                password: 'old-password',
                new_password: 'new-password',
            }),
            () => auth.requestPasswordReset('not-an-email'),
            () => auth.resetPassword({
                email: 'not-an-email',
                token: 'reset-token',
                new_password: 'new-password',
            }),
        ];

        for (const request of requests) {
            await expect(request()).rejects.toBeInstanceOf(ValidationError);
        }
        expect(calls).toHaveLength(0);
    });

    test('linkSocialLogin validates, POSTs the payload, and resolves void', async () => {
        const { http, calls } = mockHttp();
        const auth = new AuthenticationResource(http);

        await expect(
            auth.linkSocialLogin({ provider: '' as never, token: 'token' }),
        ).rejects.toThrow(ValidationError);
        await expect(
            auth.linkSocialLogin({ provider: 'github' as never, token: 'token' }),
        ).rejects.toThrow(ValidationError);
        await expect(auth.linkSocialLogin({ provider: 'google', token: '' })).rejects.toThrow(
            ValidationError,
        );

        const result = await auth.linkSocialLogin({
            provider: 'google',
            token: 'provider-token',
        });

        expect(calls).toEqual([
            {
                method: 'POST',
                url: '/auth/link-social-login',
                body: { provider: 'google', token: 'provider-token' },
                config: undefined,
            },
        ]);
        expect(result).toBeUndefined();
    });

    test('createApiKey requires a password and returns the unmasked key', async () => {
        const { http, calls } = mockHttp();
        const auth = new AuthenticationResource(http);

        await expect(auth.createApiKey('')).rejects.toThrow(ValidationError);
        const result = await auth.createApiKey('password');

        expect(calls).toEqual([
            {
                method: 'POST',
                url: '/users/api-keys',
                body: { password: 'password' },
                config: undefined,
            },
        ]);
        expect(result).toEqual({ api_key: 'fresh-key' });
    });

    test('getApiKey GETs and returns the masked key', async () => {
        const { http, calls } = mockHttp();
        const auth = new AuthenticationResource(http);

        const result = await auth.getApiKey();

        expect(calls).toEqual([
            { method: 'GET', url: '/users/api-keys', config: undefined },
        ]);
        expect(result).toEqual({ api_key: '***masked***' });
    });

    test('getApiKey preserves the documented nullable api_key', async () => {
        const { http, calls } = mockHttp({ api_key: null });
        const auth = new AuthenticationResource(http);

        const result = await auth.getApiKey();

        expect(calls).toEqual([
            { method: 'GET', url: '/users/api-keys', config: undefined },
        ]);
        expect(result).toEqual({ api_key: null });
    });

    test('getApiKey preserves the legacy top-level null response', async () => {
        const { http } = mockHttp(null);
        await expect(new AuthenticationResource(http).getApiKey()).resolves.toBeNull();
    });

    test('deleteApiKey DELETEs the key and resolves void', async () => {
        const { http, calls } = mockHttp();
        const auth = new AuthenticationResource(http);

        const result = await auth.deleteApiKey();

        expect(calls).toEqual([
            { method: 'DELETE', url: '/users/api-keys', config: undefined },
        ]);
        expect(result).toBeUndefined();
    });

    test('requestPasswordReset validates and returns the PUT response', async () => {
        const { http, calls } = mockHttp();
        const auth = new AuthenticationResource(http);

        await expect(auth.requestPasswordReset('')).rejects.toThrow(ValidationError);
        const result = await auth.requestPasswordReset('user@example.com');

        expect(calls).toEqual([
            {
                method: 'PUT',
                url: '/authentication/request-password-reset',
                body: { email: 'user@example.com' },
                config: undefined,
            },
        ]);
        expect(result).toEqual({ email: 'user@example.com' });
    });

    test('changePassword validates every required field and forwards the body', async () => {
        const { http, calls } = mockHttp();
        const auth = new AuthenticationResource(http);

        await expect(
            auth.changePassword({ email: '', password: 'old', new_password: 'new' }),
        ).rejects.toThrow(ValidationError);
        await expect(
            auth.changePassword({
                email: 'user@example.com',
                password: '',
                new_password: 'new',
            }),
        ).rejects.toThrow(ValidationError);
        await expect(
            auth.changePassword({
                email: 'user@example.com',
                password: 'old',
                new_password: '',
            }),
        ).rejects.toThrow(ValidationError);

        const payload = {
            email: 'user@example.com',
            password: 'old-password',
            new_password: 'new-password',
        };
        const result = await auth.changePassword(payload);

        expect(calls).toEqual([
            {
                method: 'PUT',
                url: '/authentication/change-password',
                body: payload,
                config: undefined,
            },
        ]);
        expect(result).toEqual({ email: 'user@example.com' });
    });

    test('resetPassword validates and forwards the reset token and new password', async () => {
        const { http, calls } = mockHttp();
        const auth = new AuthenticationResource(http);

        await expect(
            auth.resetPassword({ email: '', token: 'reset-token', new_password: 'new' }),
        ).rejects.toThrow(ValidationError);
        await expect(
            auth.resetPassword({
                email: 'user@example.com',
                token: 'reset-token',
                new_password: '',
            }),
        ).rejects.toThrow(ValidationError);

        const payload = {
            email: 'user@example.com',
            token: 'reset-token',
            new_password: 'new-password',
        };
        const result = await auth.resetPassword(payload);

        expect(calls).toEqual([
            {
                method: 'PUT',
                url: '/authentication/reset-password',
                body: payload,
                config: undefined,
            },
        ]);
        expect(result).toEqual({ email: 'user@example.com' });
    });
});
