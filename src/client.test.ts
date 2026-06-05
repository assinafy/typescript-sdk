import { describe, test, expect } from 'bun:test';
import axios from 'axios';
import { AssinafyClient } from './client';
import { ApiError, ValidationError } from './errors';

describe('AssinafyClient', () => {
    test('throws when no credentials are provided', () => {
        expect(() => new AssinafyClient({ accountId: 'acc' } as never)).toThrow(ValidationError);
    });

    test('accepts apiKey credentials', () => {
        const client = new AssinafyClient({ apiKey: 'k', accountId: 'acc' });
        expect(client.documents).toBeDefined();
        expect(client.signers).toBeDefined();
        expect(client.workspaces).toBeDefined();
        expect(client.assignments).toBeDefined();
        expect(client.webhooks).toBeDefined();
        expect(client.webhookVerifier).toBeDefined();
    });

    test('accepts legacy token credentials', () => {
        const client = new AssinafyClient({ token: 't', accountId: 'acc' });
        expect(client.documents).toBeDefined();
    });

    test('static create() builds a configured client', () => {
        const client = AssinafyClient.create('k', 'acc', { webhookSecret: 's' });
        expect(client.documents).toBeDefined();
    });

    test('fromConfig accepts snake_case keys', () => {
        const client = AssinafyClient.fromConfig({
            api_key: 'k',
            account_id: 'acc',
            webhook_secret: 's',
        });
        expect(client.documents).toBeDefined();
    });

    test('sends X-Api-Key header when apiKey is provided', () => {
        const client = new AssinafyClient({ apiKey: 'my-key', accountId: 'acc' });
        const headers = client.getAxiosInstance().defaults.headers as Record<string, unknown>;
        expect(headers['X-Api-Key']).toBe('my-key');
    });

    test('sends Bearer Authorization when only token is provided', () => {
        const client = new AssinafyClient({ token: 'legacy', accountId: 'acc' });
        const headers = client.getAxiosInstance().defaults.headers as Record<string, unknown>;
        expect(headers['Authorization']).toBe('Bearer legacy');
    });

    test('strips trailing slash from baseUrl', () => {
        const client = new AssinafyClient({
            apiKey: 'k',
            accountId: 'acc',
            baseUrl: 'https://sandbox.assinafy.com.br/v1/',
        });
        expect(client.getAxiosInstance().defaults.baseURL).toBe('https://sandbox.assinafy.com.br/v1');
    });

    test('retries an HTTP 429 then succeeds (honoring Retry-After)', async () => {
        const client = new AssinafyClient({ apiKey: 'k', accountId: 'acc', maxRetries: 2 });
        const ax = client.getAxiosInstance();
        let calls = 0;
        ax.defaults.adapter = async (config) => {
            calls++;
            if (calls === 1) {
                throw new axios.AxiosError('Too Many Requests', 'ERR_BAD_RESPONSE', config, {}, {
                    status: 429,
                    statusText: 'Too Many Requests',
                    headers: { 'retry-after': '0' },
                    data: {},
                    config,
                });
            }
            return {
                data: { status: 200, data: [{ id: 'd1' }] },
                status: 200,
                statusText: 'OK',
                headers: {},
                config,
            };
        };
        const result = await client.documents.list();
        expect(calls).toBe(2);
        expect(result.data).toEqual([{ id: 'd1' }] as never);
    });

    test('gives up after maxRetries 429s and surfaces an ApiError', async () => {
        const client = new AssinafyClient({ apiKey: 'k', accountId: 'acc', maxRetries: 1 });
        const ax = client.getAxiosInstance();
        let calls = 0;
        ax.defaults.adapter = async (config) => {
            calls++;
            throw new axios.AxiosError('Too Many Requests', 'ERR_BAD_RESPONSE', config, {}, {
                status: 429,
                statusText: 'Too Many Requests',
                headers: { 'retry-after': '0' },
                data: { message: 'rate limited' },
                config,
            });
        };
        await expect(client.documents.list()).rejects.toBeInstanceOf(ApiError);
        expect(calls).toBe(2); // initial + 1 retry
    });
});
