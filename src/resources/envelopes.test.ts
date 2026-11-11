import { describe, expect, test } from 'bun:test';
import type { AxiosInstance } from 'axios';
import { ValidationError } from '../errors';
import type { ICreateEnvelopePayload, IEnvelope } from '../types';
import { EnvelopeResource } from './envelopes';

/** Captured production response shape (IDs and contacts replaced). */
const envelope: IEnvelope = {
    resource: 'document_envelope',
    id: 'env-1',
    name: 'Admission kit',
    message: null,
    documents: [{
        id: 'doc-1',
        position: 1,
        name: 'contract.pdf',
        status: 'pending_signature',
        artifacts: { original: 'https://api.assinafy.com.br/v1/documents/doc-1/download/original' },
        signers: [{
            id: 'signer-1',
            full_name: 'Ana Souza',
            email: 'ana@example.com',
            whatsapp_phone_number: null,
            completed: false,
            signed_at: null,
        }],
    }],
    counts: { pending_signature: 1 },
    signing_urls: [{ signer_id: 'signer-1', url: null, embedded: true }],
    created_at: '2026-11-11T14:00:00Z',
};

type Call = { method: string; url: string; body?: unknown; config?: unknown };

function mockHttp(data: unknown = envelope, headers: Record<string, string> = {}) {
    const calls: Call[] = [];
    const reply = (payload: unknown) => ({ status: 200, data: { status: 200, message: '', data: payload }, headers });
    const http = {
        get: async (url: string, config?: unknown) => {
            calls.push({ method: 'GET', url, config });
            if (url.includes('/download/')) return { status: 200, data: Buffer.from('PK').buffer, headers };
            return reply(data);
        },
        post: async (url: string, body?: unknown, config?: unknown) => {
            calls.push({ method: 'POST', url, body, config });
            return reply(data);
        },
        put: async (url: string, body?: unknown, config?: unknown) => {
            calls.push({ method: 'PUT', url, body, config });
            return reply(data);
        },
        patch: async (url: string, body?: unknown, config?: unknown) => {
            calls.push({ method: 'PATCH', url, body, config });
            return reply(data);
        },
        delete: async (url: string, config?: unknown) => {
            calls.push({ method: 'DELETE', url, config });
            return reply(data);
        },
    } as unknown as AxiosInstance;
    return { http, calls, resource: new EnvelopeResource(http, 'acc') };
}

const payload: ICreateEnvelopePayload = {
    name: 'Admission kit',
    message: 'Please sign',
    max_total_credits: 2,
    signers: [
        { id: 'signer-1', verification_method: 'Bypass', notification_methods: ['Bypass'], embedded: true },
        { id: 'signer-2', verification_method: 'DigitalCertificate', notification_methods: ['Email'] },
    ],
    documents: [
        {
            id: 'doc-1',
            method: 'collect',
            signer_ids: ['signer-1'],
            entries: [{
                page_id: 'page-1',
                fields: [{
                    signer_id: 'signer-1',
                    field_id: 'field-1',
                    display_settings: { left: 1, top: 2, width: 10, height: 5, fontSize: 12 },
                }],
            }],
            expires_at: '2026-12-31',
            copy_receiver_ids: ['signer-3'],
        },
        { id: 'doc-2', signer_ids: ['signer-2'], expires_at: null },
    ],
};

describe('EnvelopeResource', () => {
    test('create sends the documented body and the Idempotency-Key header', async () => {
        const { resource, calls } = mockHttp();
        const result = await resource.create(payload, { idempotencyKey: 'key-1' });

        expect(result).toEqual(envelope);
        expect(calls).toEqual([{
            method: 'POST',
            url: '/accounts/acc/envelopes',
            body: {
                name: 'Admission kit',
                message: 'Please sign',
                max_total_credits: 2,
                signers: [
                    { id: 'signer-1', verification_method: 'Bypass', notification_methods: ['Bypass'], embedded: true },
                    { id: 'signer-2', verification_method: 'DigitalCertificate', notification_methods: ['Email'] },
                ],
                documents: [
                    {
                        id: 'doc-1',
                        method: 'collect',
                        signer_ids: ['signer-1'],
                        entries: payload.documents[0]!.entries,
                        expires_at: '2026-12-31',
                        copy_receiver_ids: ['signer-3'],
                    },
                    { id: 'doc-2', method: 'virtual', signer_ids: ['signer-2'], expires_at: null },
                ],
            },
            config: { headers: { 'Idempotency-Key': 'key-1' } },
        }]);
    });

    test('create without a key sends no header, and estimateCost posts the same body', async () => {
        const { resource, calls } = mockHttp();
        const minimal: ICreateEnvelopePayload = {
            name: 'Kit',
            signers: [{ id: 's' }],
            documents: [{ id: 'd', signer_ids: ['s'] }],
        };
        await resource.create(minimal, {}, 'other');
        await resource.estimateCost(minimal);
        const body = { name: 'Kit', signers: [{ id: 's' }], documents: [{ id: 'd', method: 'virtual', signer_ids: ['s'] }] };
        expect(calls).toEqual([
            { method: 'POST', url: '/accounts/other/envelopes', body, config: {} },
            { method: 'POST', url: '/accounts/acc/envelopes/estimate-cost', body, config: undefined },
        ]);
    });

    test('rejects malformed shapes and unpaired channels before any request', async () => {
        const { resource, calls } = mockHttp();
        const base = (): ICreateEnvelopePayload => ({
            name: 'Kit',
            signers: [{ id: 's1' }],
            documents: [{ id: 'd1', signer_ids: ['s1'] }],
        });
        const variants: Array<(value: ICreateEnvelopePayload) => unknown> = [
            (value) => { value.name = ' '; },
            (value) => { value.message = 1 as never; },
            (value) => { value.max_total_credits = -1; },
            (value) => { value.signers = 'signer' as never; },
            (value) => { value.signers = [null as never]; },
            (value) => { value.signers = [{ id: ' ' }]; },
            (value) => { value.signers = [{ id: 's1', verification_method: 'Sms' as never }]; },
            (value) => { value.signers = [{ id: 's1', verification_method: 'Email', notification_methods: ['Whatsapp'] }]; },
            (value) => { value.signers = [{ id: 's1', embedded: 'yes' as never }]; },
            (value) => { value.signers = [{ id: 's1', verification_method: 'IdDocumentFaceMatchBasic', embedded: true }]; },
            (value) => { value.documents = {} as never; },
            (value) => { value.documents = [{ id: '', signer_ids: ['s1'] }]; },
            (value) => { value.documents = [{ id: 'd1', signer_ids: 's1' as never }]; },
            (value) => { value.documents = [{ id: 'd1', signer_ids: [''] }]; },
            (value) => { value.documents = [{ id: 'd1', method: 'paper' as never, signer_ids: ['s1'] }]; },
            (value) => { value.documents = [{ id: 'd1', method: 'collect', signer_ids: ['s1'] }]; },
            (value) => { value.documents = [{ id: 'd1', method: 'collect', signer_ids: ['s1'], entries: 'x' as never }]; },
            (value) => { value.documents = [{ id: 'd1', signer_ids: ['s1'], expires_at: 'tomorrow' }]; },
            (value) => { value.documents = [{ id: 'd1', signer_ids: ['s1'], copy_receiver_ids: [''] }]; },
        ];
        for (const mutate of variants) {
            const candidate = base();
            mutate(candidate);
            await expect(resource.create(candidate)).rejects.toBeInstanceOf(ValidationError);
            await expect(resource.estimateCost(candidate)).rejects.toBeInstanceOf(ValidationError);
        }
        await expect(resource.create(null as never)).rejects.toBeInstanceOf(ValidationError);
        await expect(resource.create(base(), null as never)).rejects.toBeInstanceOf(ValidationError);
        await expect(resource.create(base(), { idempotencyKey: ' ' })).rejects.toBeInstanceOf(ValidationError);
        await expect(new EnvelopeResource(mockHttp().http).create(base())).rejects.toBeInstanceOf(ValidationError);
        expect(calls).toHaveLength(0);
    });

    test('leaves envelope-structure rules to the API, forwarding step so the API refuses it', async () => {
        const { resource, calls } = mockHttp();
        await resource.estimateCost({
            name: 'Kit',
            signers: [{ id: 's1', step: 1 } as never, { id: 's1' }],
            documents: [{ id: 'd1', signer_ids: [] }],
        });
        expect(calls[0]?.body).toEqual({
            name: 'Kit',
            signers: [{ id: 's1', step: 1 }, { id: 's1' }],
            documents: [{ id: 'd1', method: 'virtual', signer_ids: [] }],
        });
    });

    test('list, get, activities and download address the documented routes', async () => {
        const meta = {
            'x-pagination-current-page': '1',
            'x-pagination-per-page': '20',
            'x-pagination-total-count': '1',
            'x-pagination-page-count': '1',
        };
        const { resource, calls } = mockHttp([envelope], meta);
        expect(await resource.list({ status: 'open', search: 'kit', per_page: 10 })).toEqual({
            data: [envelope],
            meta: { current_page: 1, per_page: 20, total: 1, last_page: 1 },
        });
        await resource.get('env-1');
        await resource.listActivities('env-1', { sort: 'id', page: 2 });
        const zip = await resource.download('env-1', 'certificate-page');

        expect(zip).toBeInstanceOf(Buffer);
        expect(calls).toEqual([
            { method: 'GET', url: '/accounts/acc/envelopes', config: { params: { status: 'open', search: 'kit', 'per-page': 10 } } },
            { method: 'GET', url: '/accounts/acc/envelopes/env-1', config: undefined },
            { method: 'GET', url: '/accounts/acc/envelopes/env-1/activities', config: { params: { sort: 'id', page: 2 } } },
            { method: 'GET', url: '/accounts/acc/envelopes/env-1/download/certificate-page', config: { responseType: 'arraybuffer' } },
        ]);
    });

    test('update, cancel, delete, document changes and reminders send the documented requests', async () => {
        const { resource, calls } = mockHttp();
        await resource.update('env-1', { name: 'New name', message: null, document_ids: ['doc-2', 'doc-1'] });
        await resource.cancel('env-1');
        await resource.delete('env-1');
        await resource.addDocument('env-1', { id: 'doc-3', signer_ids: ['signer-1'], max_total_credits: 0 });
        await resource.addDocument('env-1', { id: 'doc-4', signer_ids: ['signer-1'] });
        await resource.removeDocument('env-1', 'doc-3');
        await resource.resendNotification('env-1', 'signer-1');

        expect(calls).toEqual([
            {
                method: 'PATCH',
                url: '/accounts/acc/envelopes/env-1',
                body: { name: 'New name', message: null, document_ids: ['doc-2', 'doc-1'] },
                config: undefined,
            },
            { method: 'PUT', url: '/accounts/acc/envelopes/env-1/cancel', body: undefined, config: undefined },
            { method: 'DELETE', url: '/accounts/acc/envelopes/env-1', config: undefined },
            {
                method: 'POST',
                url: '/accounts/acc/envelopes/env-1/documents',
                body: { id: 'doc-3', method: 'virtual', signer_ids: ['signer-1'], max_total_credits: 0 },
                config: undefined,
            },
            {
                method: 'POST',
                url: '/accounts/acc/envelopes/env-1/documents',
                body: { id: 'doc-4', method: 'virtual', signer_ids: ['signer-1'] },
                config: undefined,
            },
            { method: 'DELETE', url: '/accounts/acc/envelopes/env-1/documents/doc-3', config: undefined },
            { method: 'PUT', url: '/accounts/acc/envelopes/env-1/signers/signer-1/resend', body: undefined, config: undefined },
        ]);
    });

    test('rejects malformed reads, updates and IDs before any request', async () => {
        const { resource, calls } = mockHttp();
        const requests = [
            () => resource.list({ status: 'pending' as never }),
            () => resource.list(null as never),
            () => resource.get(''),
            () => resource.get('..'),
            () => resource.download('env-1', 'thumbnail' as never),
            () => resource.update('env-1', {}),
            () => resource.update('env-1', { name: '' }),
            () => resource.update('env-1', { message: 3 as never }),
            () => resource.update('env-1', { document_ids: 'a' as never }),
            () => resource.update('env-1', { document_ids: [' '] }),
            () => resource.addDocument('env-1', { id: 'doc', signer_ids: ['s'], max_total_credits: -2 }),
            () => resource.addDocument('env-1', null as never),
            () => resource.removeDocument('env-1', ' '),
            () => resource.resendNotification('env-1', ''),
        ];
        for (const request of requests) await expect(request()).rejects.toBeInstanceOf(ValidationError);
        expect(calls).toHaveLength(0);
    });
});
