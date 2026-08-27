import { describe, expect, test } from 'bun:test';
import axios from 'axios';
import { AuthenticationResource } from '../resources/authentication';
import { DocumentResource } from '../resources/documents';
import { SignerDocumentsResource } from '../resources/signer-documents';
import { SDK_USER_AGENT } from './transport';

describe('public resource transports', () => {
    test('strip privileged headers and dispatch the versioned user-agent', async () => {
        const seen: Array<Record<string, unknown>> = [];
        const http = axios.create({
            baseURL: 'https://api.assinafy.com.br/v1',
            headers: {
                Authorization: 'Bearer secret',
                'X-Api-Key': 'secret',
            },
            adapter: async (config) => {
                seen.push(config.headers.toJSON());
                return {
                    data: { status: 200, data: {} },
                    status: 200,
                    statusText: 'OK',
                    headers: {},
                    config,
                };
            },
        });

        await new AuthenticationResource(http).login('user@example.com', 'password');
        await new DocumentResource(http).getPublic('doc-1');
        await new SignerDocumentsResource(http).self('access-code');

        expect(seen).toHaveLength(3);
        for (const headers of seen) {
            expect(headers['Authorization']).toBeUndefined();
            expect(headers['X-Api-Key']).toBeUndefined();
            expect(headers['User-Agent']).toBe(SDK_USER_AGENT);
        }
        expect(http.defaults.headers['Authorization']).toBe('Bearer secret');
        expect(http.defaults.headers['X-Api-Key']).toBe('secret');
    });

    test('does not copy interceptors that inject credentials', async () => {
        const seen: Array<Record<string, unknown>> = [];
        const http = axios.create({
            baseURL: 'https://api.assinafy.com.br/v1',
            auth: { username: 'secret', password: 'secret' },
            adapter: async (config) => {
                seen.push(config.headers.toJSON());
                return {
                    data: { status: 200, data: {} },
                    status: 200,
                    statusText: 'OK',
                    headers: {},
                    config,
                };
            },
        });
        http.interceptors.request.use((config) => {
            config.headers.set('Authorization', 'Bearer secret');
            config.headers.set('X-Api-Key', 'secret');
            return config;
        });

        await new AuthenticationResource(http).login('user@example.com', 'password');
        await new DocumentResource(http).verify('sha256');
        await new SignerDocumentsResource(http).self('access-code');

        expect(seen).toHaveLength(3);
        for (const headers of seen) {
            expect(headers['Authorization']).toBeUndefined();
            expect(headers['X-Api-Key']).toBeUndefined();
            expect(headers['User-Agent']).toBe(SDK_USER_AGENT);
        }
    });

    test('sanitizes and identifies an explicitly supplied public transport', async () => {
        const authenticated = axios.create();
        const seen: Array<Record<string, unknown>> = [];
        const publicHttp = axios.create({
            headers: {
                Authorization: 'Bearer secret',
                'X-Api-Key': 'secret',
            },
            adapter: async (config) => {
                seen.push(config.headers.toJSON());
                return {
                    data: { status: 200, data: {} },
                    status: 200,
                    statusText: 'OK',
                    headers: {},
                    config,
                };
            },
        });
        publicHttp.interceptors.request.use((config) => {
            config.headers.set('Authorization', 'Bearer injected-secret');
            config.headers.set('X-Api-Key', 'injected-secret');
            return config;
        });

        await new AuthenticationResource(authenticated, undefined, undefined, publicHttp).login(
            'user@example.com',
            'password',
        );
        await new DocumentResource(authenticated, undefined, undefined, publicHttp).getPublic(
            'doc-1',
        );

        expect(seen).toHaveLength(2);
        for (const headers of seen) {
            expect(headers['Authorization']).toBeUndefined();
            expect(headers['X-Api-Key']).toBeUndefined();
            expect(headers['User-Agent']).toBe(SDK_USER_AGENT);
        }
    });

    test('preserves caller redirect hooks and sensitive headers', () => {
        let redirects = 0;
        const beforeRedirect = () => {
            redirects++;
        };
        const http = axios.create({
            beforeRedirect,
            sensitiveHeaders: ['X-Custom-Secret'],
        });

        new DocumentResource(http);

        expect(http.defaults.beforeRedirect).not.toBe(beforeRedirect);
        expect(http.defaults.sensitiveHeaders).toEqual([
            'X-Custom-Secret',
            'Authorization',
            'X-Api-Key',
        ]);
        http.defaults.beforeRedirect?.(
            { href: 'https://api.example.com/v1/next', method: 'GET' },
            { headers: {}, statusCode: 302 },
            { headers: {}, url: 'https://api.example.com/v1/start', method: 'GET' },
        );
        http.defaults.beforeRedirect?.(
            { href: 'https://cdn.example.com/file', method: 'GET' },
            { headers: {}, statusCode: 302 },
            { headers: {}, url: 'https://api.example.com/v1/file', method: 'GET' },
        );
        expect(redirects).toBe(1);
    });

    test('blocks cross-origin redirects when the source URL carries a credential query', () => {
        const http = axios.create();
        new DocumentResource(http);

        expect(() =>
            http.defaults.beforeRedirect?.(
                { href: 'https://cdn.example.com/file', method: 'GET' },
                { headers: {}, statusCode: 302 },
                {
                    headers: {},
                    url: 'https://api.example.com/v1/file?signer_access_code=placeholder',
                    method: 'GET',
                },
            ),
        ).toThrow('Unsafe cross-origin redirect blocked');
    });
});
