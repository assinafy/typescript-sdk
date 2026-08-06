import { describe, test, expect, beforeEach } from 'bun:test';
import { WorkspaceResource } from './workspaces';
import { ValidationError } from '../errors';
import type { AxiosInstance } from 'axios';

describe('WorkspaceResource', () => {
    let mockAxios: AxiosInstance;
    let workspaceResource: WorkspaceResource;

    beforeEach(() => {
        mockAxios = {
            post: async () => ({ data: { status: 200, data: { id: '123' } } }),
            get: async () => ({ data: { status: 200, data: [] } }),
            put: async () => ({ data: { status: 200, data: { id: '123' } } }),
            delete: async () => ({ status: 200 }),
        } as unknown as AxiosInstance;

        workspaceResource = new WorkspaceResource(mockAxios);
    });

    test('throws when getting workspace without account ID', async () => {
        await expect(workspaceResource.get('')).rejects.toThrow(ValidationError);
    });

    test('throws when updating workspace without account ID', async () => {
        await expect(workspaceResource.update('', { name: 'Test' })).rejects.toThrow(ValidationError);
    });

    test('throws when deleting workspace without account ID', async () => {
        await expect(workspaceResource.delete('')).rejects.toThrow(ValidationError);
    });

    test('create POSTs to /accounts and forwards the payload', async () => {
        let url = '';
        let body: unknown;
        const ax = {
            ...mockAxios,
            post: async (u: string, b: unknown) => {
                url = u;
                body = b;
                return {
                    data: {
                        status: 200,
                        data: {
                            id: 'w1',
                            name: 'Acme Legal',
                            primary_color: 'ff0066',
                            secondary_color: '0066ff',
                            created_at: '2026-05-12T18:05:11Z',
                        },
                    },
                };
            },
        } as unknown as AxiosInstance;
        const ws = await new WorkspaceResource(ax).create({
            name: 'Acme Legal',
            primary_color: 'ff0066',
            secondary_color: '0066ff',
        });
        expect(url).toBe('/accounts');
        expect(body).toEqual({ name: 'Acme Legal', primary_color: 'ff0066', secondary_color: '0066ff' });
        expect(ws.id).toBe('w1');
        expect(ws.name).toBe('Acme Legal');
    });

    test('list GETs /accounts and returns { data }', async () => {
        let url = '';
        const ax = {
            ...mockAxios,
            get: async (u: string) => {
                url = u;
                return {
                    status: 200,
                    data: {
                        status: 200,
                        data: [
                            {
                                id: 'w1',
                                name: 'MT',
                                roles: ['owner'],
                                is_delete_allowed: true,
                                created_at: '2026-05-12T18:05:11Z',
                            },
                        ],
                    },
                    headers: {},
                };
            },
        } as unknown as AxiosInstance;
        const res = await new WorkspaceResource(ax).list();
        expect(url).toBe('/accounts');
        expect(res.data).toHaveLength(1);
        expect(res.data[0]?.id).toBe('w1');
        expect(res.data[0]?.roles).toEqual(['owner']);
    });

    test('get hits /accounts/{id}', async () => {
        let url = '';
        const ax = {
            ...mockAxios,
            get: async (u: string) => {
                url = u;
                return {
                    data: {
                        status: 200,
                        data: {
                            id: 'w1',
                            name: 'MT',
                            primary_color: null,
                            secondary_color: null,
                            created_at: '2026-05-12T18:05:11Z',
                        },
                    },
                };
            },
        } as unknown as AxiosInstance;
        const ws = await new WorkspaceResource(ax).get('w1');
        expect(url).toBe('/accounts/w1');
        expect(ws.id).toBe('w1');
    });

    test('getTheme fetches the account theme', async () => {
        let url = '';
        const theme = {
            account_name: 'Acme',
            primary_color: 'aabbcc',
            secondary_color: null,
            logo: 'https://example.test/logo',
        };
        const ax = {
            ...mockAxios,
            get: async (u: string) => {
                url = u;
                return { status: 200, data: { status: 200, data: theme } };
            },
        } as unknown as AxiosInstance;
        await expect(new WorkspaceResource(ax).getTheme('w1')).resolves.toEqual(theme);
        expect(url).toBe('/accounts/w1/theme');
    });

    test('downloadLogo requests binary image data', async () => {
        let config: unknown;
        const bytes = new Uint8Array([137, 80, 78, 71]).buffer;
        const ax = {
            ...mockAxios,
            get: async (_url: string, c: unknown) => {
                config = c;
                return { status: 200, data: bytes };
            },
        } as unknown as AxiosInstance;
        const logo = await new WorkspaceResource(ax).downloadLogo('w1');
        expect([...logo]).toEqual([137, 80, 78, 71]);
        expect(config).toEqual({ responseType: 'arraybuffer' });
    });

    test('uploadLogo posts a one-file multipart body and validates empty files', async () => {
        let url = '';
        let body: FormData | undefined;
        const ax = {
            ...mockAxios,
            post: async (u: string, b: FormData) => {
                url = u;
                body = b;
                return { status: 200, data: { status: 200, message: '' } };
            },
        } as unknown as AxiosInstance;
        const workspaces = new WorkspaceResource(ax);
        await workspaces.uploadLogo('w1', {
            buffer: Buffer.from([1, 2, 3]),
            fileName: 'logo.png',
        });
        expect(url).toBe('/accounts/w1/logo');
        const file = body?.get('file') as File;
        expect(file.name).toBe('logo.png');
        expect(file.type).toBe('image/png');
        expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([1, 2, 3]);
        await expect(
            workspaces.uploadLogo('w1', { buffer: Buffer.alloc(0), fileName: 'logo.png' }),
        ).rejects.toBeInstanceOf(ValidationError);
    });

    test('deleteLogo calls the documented account logo endpoint', async () => {
        let url = '';
        const ax = {
            ...mockAxios,
            delete: async (u: string) => {
                url = u;
                return { status: 200, data: { status: 200, message: '' } };
            },
        } as unknown as AxiosInstance;
        await new WorkspaceResource(ax).deleteLogo('w1');
        expect(url).toBe('/accounts/w1/logo');
    });

    test('getStats validates and forwards granularity/month', async () => {
        let config: unknown;
        const rows = [
            {
                period: '2026-06-01',
                documents_uploaded: 2,
                documents_sent: 2,
                signature_requests: 3,
                signature_requests_email: 2,
                signature_requests_whatsapp: 1,
                signature_requests_viewed: 2,
                signature_requests_completed: 1,
                documents_certified: 1,
            },
        ];
        const ax = {
            ...mockAxios,
            get: async (_url: string, c: unknown) => {
                config = c;
                return { status: 200, data: { status: 200, data: rows } };
            },
        } as unknown as AxiosInstance;
        const workspaces = new WorkspaceResource(ax);
        await expect(
            workspaces.getStats('w1', { granularity: 'daily', month: '2026-06' }),
        ).resolves.toEqual(rows);
        expect(config).toEqual({ params: { granularity: 'daily', month: '2026-06' } });
        await expect(
            workspaces.getStats('w1', { granularity: 'daily' }),
        ).rejects.toBeInstanceOf(ValidationError);
    });

    test('update PUTs /accounts/{id} with the payload', async () => {
        let url = '';
        let body: unknown;
        const ax = {
            ...mockAxios,
            put: async (u: string, b: unknown) => {
                url = u;
                body = b;
                return { data: { status: 200, data: { id: 'w1', name: 'Renamed' } } };
            },
        } as unknown as AxiosInstance;
        await new WorkspaceResource(ax).update('w1', { name: 'Renamed', primary_color: 'ff0066' });
        expect(url).toBe('/accounts/w1');
        expect(body).toEqual({ name: 'Renamed', primary_color: 'ff0066' });
    });

    test('delete forwards { force: true } in the request body config', async () => {
        let url = '';
        let config: unknown;
        const ax = {
            ...mockAxios,
            delete: async (u: string, c: unknown) => {
                url = u;
                config = c;
                return { status: 200 };
            },
        } as unknown as AxiosInstance;
        await new WorkspaceResource(ax).delete('w1', { force: true });
        expect(url).toBe('/accounts/w1');
        expect(config).toEqual({ data: { force: true } });
    });

    test('delete without force sends no request body config', async () => {
        let config: unknown = 'unset';
        const ax = {
            ...mockAxios,
            delete: async (_u: string, c: unknown) => {
                config = c;
                return { status: 200 };
            },
        } as unknown as AxiosInstance;
        await new WorkspaceResource(ax).delete('w1');
        expect(config).toBeUndefined();
    });
});
