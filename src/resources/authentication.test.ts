import { describe, test, expect } from 'bun:test';
import type { AxiosInstance } from 'axios';
import { AuthenticationResource } from './authentication';
import { ValidationError } from '../errors';

function mockHttp(): { http: AxiosInstance; calls: Array<{ method: string; url: string; body?: unknown }> } {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    const respond = (data: unknown) => ({ status: 200, data: { status: 200, data } });
    const http = {
        get: async (url: string) => {
            calls.push({ method: 'GET', url });
            return respond({ api_key: '***masked***' });
        },
        post: async (url: string, body: unknown) => {
            calls.push({ method: 'POST', url, body });
            return respond({ api_key: 'fresh-key' });
        },
        put: async (url: string, body: unknown) => {
            calls.push({ method: 'PUT', url, body });
            return respond({ email: (body as { email: string }).email });
        },
        delete: async (url: string) => {
            calls.push({ method: 'DELETE', url });
            return { status: 200, data: { status: 200, data: [] } };
        },
    } as unknown as AxiosInstance;
    return { http, calls };
}

describe('AuthenticationResource', () => {
    test('login validates and posts to /login', async () => {
        const { http, calls } = mockHttp();
        const auth = new AuthenticationResource(http);
        await expect(auth.login('', 'pw')).rejects.toThrow(ValidationError);
        await expect(auth.login('a@b.com', '')).rejects.toThrow(ValidationError);
        await auth.login('a@b.com', 'pw');
        expect(calls.find((c) => c.url === '/login')?.body).toEqual({ email: 'a@b.com', password: 'pw' });
    });

    test('createApiKey requires password', async () => {
        const { http } = mockHttp();
        const auth = new AuthenticationResource(http);
        await expect(auth.createApiKey('')).rejects.toThrow(ValidationError);
        const r = await auth.createApiKey('pw');
        expect(r.api_key).toBe('fresh-key');
    });

    test('getApiKey returns masked key', async () => {
        const { http, calls } = mockHttp();
        const auth = new AuthenticationResource(http);
        const r = await auth.getApiKey();
        expect(r).toEqual({ api_key: '***masked***' });
        expect(calls[0]).toEqual({ method: 'GET', url: '/users/api-keys' });
    });

    test('changePassword validates inputs and PUTs', async () => {
        const { http, calls } = mockHttp();
        const auth = new AuthenticationResource(http);
        await expect(
            auth.changePassword({ email: '', password: 'a', new_password: 'b' }),
        ).rejects.toThrow(ValidationError);
        await auth.changePassword({ email: 'x@y.com', password: 'a', new_password: 'b' });
        const call = calls.find((c) => c.url === '/authentication/change-password');
        expect(call?.method).toBe('PUT');
        expect(call?.body).toEqual({ email: 'x@y.com', password: 'a', new_password: 'b' });
    });

    test('resetPassword requires email + new_password', async () => {
        const { http } = mockHttp();
        const auth = new AuthenticationResource(http);
        await expect(
            auth.resetPassword({ email: '', new_password: 'pw' }),
        ).rejects.toThrow(ValidationError);
        await expect(
            auth.resetPassword({ email: 'a@b.com', new_password: '' }),
        ).rejects.toThrow(ValidationError);
    });
});
