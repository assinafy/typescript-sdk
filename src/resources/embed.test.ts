import { describe, expect, test } from 'bun:test';
import type { AxiosInstance } from 'axios';
import { ValidationError } from '../errors';
import { EmbedResource } from './embed';

const origin = { id: 'origin-1', origin: 'https://app.example.com', created_at: '2026-11-04T12:05:00Z' };
const session = {
    url: 'https://app.assinafy.com.br/embed/3b1f0c7e9a2d4c58b6e1f4a07d93c2e85a1b0f6d4c7e2a9183b5d6f0e4c8a712',
    expires_at: '2026-11-04T12:05:00Z',
};

type Call = { method: string; url: string; body?: unknown };

function mockHttp() {
    const calls: Call[] = [];
    const reply = (data: unknown) => ({ status: 200, data: { status: 200, message: '', data } });
    const http = {
        get: async (url: string) => {
            calls.push({ method: 'GET', url });
            return reply([origin]);
        },
        post: async (url: string, body?: unknown) => {
            calls.push({ method: 'POST', url, body });
            return reply(url.endsWith('/embed-sessions') ? session : origin);
        },
        put: async (url: string, body?: unknown) => {
            calls.push({ method: 'PUT', url, body });
            return reply(origin);
        },
        delete: async (url: string) => {
            calls.push({ method: 'DELETE', url });
            return reply([]);
        },
    } as unknown as AxiosInstance;
    return { calls, resource: new EmbedResource(http, 'acc') };
}

describe('EmbedResource', () => {
    test('manages origins and mints sessions on the documented routes', async () => {
        const { resource, calls } = mockHttp();
        expect(await resource.listOrigins()).toEqual([origin]);
        expect(await resource.addOrigin('https://app.example.com')).toEqual(origin);
        await resource.addOrigin('http://localhost:5174/', 'other');
        await resource.updateOrigin('origin-1', 'https://sign.example.com:8443');
        await resource.deleteOrigin('origin-1');
        expect(await resource.createSession('doc-1', 'asg-1', 'signer-1')).toEqual(session);

        expect(calls).toEqual([
            { method: 'GET', url: '/accounts/acc/embed-origins' },
            { method: 'POST', url: '/accounts/acc/embed-origins', body: { origin: 'https://app.example.com' } },
            { method: 'POST', url: '/accounts/other/embed-origins', body: { origin: 'http://localhost:5174/' } },
            { method: 'PUT', url: '/accounts/acc/embed-origins/origin-1', body: { origin: 'https://sign.example.com:8443' } },
            { method: 'DELETE', url: '/accounts/acc/embed-origins/origin-1' },
            { method: 'POST', url: '/documents/doc-1/assignments/asg-1/signers/signer-1/embed-sessions', body: undefined },
        ]);
    });

    test('rejects blank origins and missing IDs before requesting; the API judges the origin format', async () => {
        const { resource, calls } = mockHttp();
        for (const value of ['', ' ', 42, undefined]) {
            await expect(resource.addOrigin(value as never)).rejects.toBeInstanceOf(ValidationError);
            await expect(resource.updateOrigin('origin-1', value as never)).rejects.toBeInstanceOf(ValidationError);
        }
        const requests = [
            () => resource.deleteOrigin(''),
            () => resource.updateOrigin(' ', 'https://app.example.com'),
            () => resource.createSession('doc-1', '', 'signer-1'),
            () => resource.createSession('doc-1', 'asg-1', '..'),
            () => new EmbedResource({} as AxiosInstance).listOrigins(),
        ];
        for (const request of requests) await expect(request()).rejects.toBeInstanceOf(ValidationError);
        expect(calls).toHaveLength(0);
    });
});
