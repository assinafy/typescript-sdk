import { describe, test, expect } from 'bun:test';
import type { AxiosInstance } from 'axios';
import { TemplateResource } from './templates';
import { ValidationError } from '../errors';

function mockHttp(): {
    http: AxiosInstance;
    calls: Array<{ method: string; url: string; body?: unknown; config?: unknown }>;
} {
    const calls: Array<{ method: string; url: string; body?: unknown; config?: unknown }> = [];
    const ok = (data: unknown) => ({ status: 200, data: { status: 200, data }, headers: {} });
    const http = {
        get: async (url: string, config?: unknown) => {
            calls.push({ method: 'GET', url, config });
            if (url.includes('/download')) {
                return { status: 200, data: Buffer.from('jpeg').buffer };
            }
            return ok({ id: 'tmpl-1', name: 'T', status: 'Ready' });
        },
        post: async (url: string, body: unknown, config?: unknown) => {
            calls.push({ method: 'POST', url, body, config });
            return ok({ id: 'tmpl-1', name: 'T', status: 'Uploaded', roles: [], pages: [], tags: [] });
        },
        put: async (url: string, body: unknown) => {
            calls.push({ method: 'PUT', url, body });
            return ok({ id: 'tmpl-1', name: 'Renamed', message: 'hi', status: 'Ready' });
        },
        delete: async (url: string) => {
            calls.push({ method: 'DELETE', url });
            return { status: 200, data: { status: 200, data: [] } };
        },
    } as unknown as AxiosInstance;
    return { http, calls };
}

describe('TemplateResource', () => {
    test('create POSTs multipart to the templates endpoint, carrying name as the file part filename', async () => {
        const { http, calls } = mockHttp();
        const templates = new TemplateResource(http, 'acc');
        const result = await templates.create(
            { buffer: Buffer.from('%PDF-1.4 test'), fileName: 'doc.pdf' },
            { name: 'My Template' },
        );

        expect(calls[0]?.method).toBe('POST');
        expect(calls[0]?.url).toBe('/accounts/acc/templates');
        const form = calls[0]?.body as FormData;
        expect(form).toBeInstanceOf(FormData);
        // The API derives the display name from the file part's filename and
        // ignores a separate `name` field, so `name` must ride on the filename.
        // The templates endpoint 415s on a filename with no `.pdf` extension,
        // so the extension is appended when absent.
        expect(form.get('file')).toBeInstanceOf(File);
        expect((form.get('file') as File).name).toBe('My Template.pdf');
        expect(form.get('name')).toBeNull();
        expect((calls[0]?.config as { headers: Record<string, string> }).headers['Content-Type']).toBe(
            'multipart/form-data',
        );
        // envelope unwrapped → template object
        expect(result.id).toBe('tmpl-1');
        expect(result.status).toBe('Uploaded');
    });

    test('create falls back to the real file name when no name is given', async () => {
        const { http, calls } = mockHttp();
        const templates = new TemplateResource(http, 'acc');
        await templates.create({ buffer: Buffer.from('%PDF-1.4'), fileName: 'contract.pdf' });
        const file = (calls[0]?.body as FormData).get('file') as File;
        expect(file.name).toBe('contract.pdf');
    });

    test('create does not double-append .pdf to a name that already has it', async () => {
        const { http, calls } = mockHttp();
        const templates = new TemplateResource(http, 'acc');
        await templates.create(
            { buffer: Buffer.from('%PDF-1.4'), fileName: 'src.pdf' },
            { name: 'Already Named.pdf' },
        );
        expect(((calls[0]?.body as FormData).get('file') as File).name).toBe('Already Named.pdf');
    });

    test('create appends .pdf case-insensitively', async () => {
        const { http, calls } = mockHttp();
        const templates = new TemplateResource(http, 'acc');
        await templates.create(
            { buffer: Buffer.from('%PDF-1.4'), fileName: 'src.pdf' },
            { name: 'Upper.PDF' },
        );
        expect(((calls[0]?.body as FormData).get('file') as File).name).toBe('Upper.PDF');
    });

    test('create rejects non-PDF uploads before any request', async () => {
        const { http, calls } = mockHttp();
        const templates = new TemplateResource(http, 'acc');
        await expect(
            templates.create({ buffer: Buffer.from('x'), fileName: 'notes.txt' }),
        ).rejects.toThrow(ValidationError);
        expect(calls.length).toBe(0);
    });

    test('create requires an account id', async () => {
        const { http } = mockHttp();
        const templates = new TemplateResource(http);
        await expect(
            templates.create({ buffer: Buffer.from('%PDF-1.4'), fileName: 'd.pdf' }),
        ).rejects.toThrow(ValidationError);
    });

    test('get fetches the single-template endpoint', async () => {
        const { http, calls } = mockHttp();
        const templates = new TemplateResource(http, 'acc');
        await templates.get('tmpl-1');
        expect(calls[0]).toMatchObject({ method: 'GET', url: '/accounts/acc/templates/tmpl-1' });
    });

    test('get validates the template id', async () => {
        const { http } = mockHttp();
        const templates = new TemplateResource(http, 'acc');
        await expect(templates.get('')).rejects.toThrow(ValidationError);
    });

    test('update PUTs name/message and strips undefined', async () => {
        const { http, calls } = mockHttp();
        const templates = new TemplateResource(http, 'acc');
        const result = await templates.update('tmpl-1', { name: 'Renamed' });
        expect(calls[0]?.method).toBe('PUT');
        expect(calls[0]?.url).toBe('/accounts/acc/templates/tmpl-1');
        expect(calls[0]?.body).toEqual({ name: 'Renamed' });
        expect(result.name).toBe('Renamed');
    });

    test('delete DELETEs the template and returns void', async () => {
        const { http, calls } = mockHttp();
        const templates = new TemplateResource(http, 'acc');
        const result = await templates.delete('tmpl-1');
        expect(calls[0]).toEqual({ method: 'DELETE', url: '/accounts/acc/templates/tmpl-1' });
        expect(result).toBeUndefined();
    });

    test('list and downloadPage hit the documented paths', async () => {
        const { http, calls } = mockHttp();
        const templates = new TemplateResource(http, 'acc');
        await templates.list({ search: 'nda' });
        expect(calls[0]?.url).toBe('/accounts/acc/templates');
        expect((calls[0]?.config as { params: unknown }).params).toEqual({ search: 'nda' });

        await templates.downloadPage('tmpl-1', 'page-1');
        expect(calls[1]?.url).toBe('/accounts/acc/templates/tmpl-1/pages/page-1/download');
    });
});
