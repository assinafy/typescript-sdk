import { describe, test, expect, beforeEach } from 'bun:test';
import { TagResource } from './tags';
import { ValidationError } from '../errors';
import type { AxiosInstance } from 'axios';

describe('TagResource', () => {
    let mockAxios: AxiosInstance;
    let tags: TagResource;

    beforeEach(() => {
        mockAxios = {
            get: async () => ({ status: 200, data: { status: 200, data: [] }, headers: {} }),
            post: async () => ({ status: 200, data: { status: 200, data: { id: 't1' } } }),
            put: async () => ({ status: 200, data: { status: 200, data: { id: 't1' } } }),
            delete: async () => ({ status: 200 }),
        } as unknown as AxiosInstance;
        tags = new TagResource(mockAxios, 'acc');
    });

    test('list hits the account-scoped tags endpoint and forwards search', async () => {
        let url = '';
        let params: unknown;
        const ax = {
            ...mockAxios,
            get: async (u: string, cfg: { params: unknown }) => {
                url = u;
                params = cfg.params;
                return { status: 200, data: { status: 200, data: [] }, headers: {} };
            },
        } as unknown as AxiosInstance;
        await new TagResource(ax, 'acc').list({ search: 'contract' });
        expect(url).toBe('/accounts/acc/tags');
        expect(params).toEqual({ search: 'contract' });
    });

    test('create requires a name', async () => {
        await expect(tags.create({ name: '' })).rejects.toThrow(ValidationError);
    });

    test('create posts name + color', async () => {
        let body: unknown;
        const ax = {
            ...mockAxios,
            post: async (_u: string, b: unknown) => {
                body = b;
                return { status: 200, data: { status: 200, data: { id: 't1' } } };
            },
        } as unknown as AxiosInstance;
        await new TagResource(ax, 'acc').create({ name: 'Contracts', color: 'ff8800' });
        expect(body).toEqual({ name: 'Contracts', color: 'ff8800' });
    });

    test('update preserves color:null (clear) but omits absent fields', async () => {
        let body: unknown;
        const ax = {
            ...mockAxios,
            put: async (_u: string, b: unknown) => {
                body = b;
                return { status: 200, data: { status: 200, data: { id: 't1' } } };
            },
        } as unknown as AxiosInstance;
        await new TagResource(ax, 'acc').update('t1', { color: null });
        expect(body).toEqual({ color: null });
    });

    test('delete requires a tag id', async () => {
        await expect(tags.delete('')).rejects.toThrow(ValidationError);
    });

    test('delete sends force=true when requested', async () => {
        let url = '';
        let params: unknown;
        const ax = {
            ...mockAxios,
            delete: async (u: string, cfg: { params: unknown }) => {
                url = u;
                params = cfg?.params;
                return { status: 200 };
            },
        } as unknown as AxiosInstance;
        await new TagResource(ax, 'acc').delete('t1', { force: true });
        expect(url).toBe('/accounts/acc/tags/t1');
        expect(params).toEqual({ force: 'true' });
    });
});
