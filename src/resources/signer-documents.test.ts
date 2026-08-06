import { describe, test, expect } from 'bun:test';
import type { AxiosInstance } from 'axios';
import { SignerDocumentsResource } from './signer-documents';
import { ValidationError } from '../errors';
import type {
    IDocumentDetailsResponse,
    IDocumentListResponse,
    ISigner,
    ISignerSelf,
} from '../types';

const signerResponse: ISigner = {
    resource: 'signer',
    id: 'signer-1',
    full_name: 'Example Signer',
    email: 'signer@example.com',
    has_accepted_terms: true,
};

const signerSelfResponse: ISignerSelf = {
    ...signerResponse,
    has_signature: true,
    has_initial: false,
    is_signature_reusable: true,
};

const documentResponse: IDocumentDetailsResponse = {
    resource: 'document',
    id: 'doc-1',
    account_id: 'account-1',
    name: 'Agreement.pdf',
    status: 'pending_signature',
    assignment: null,
    pages: [],
    created_at: '2026-08-06T12:00:00Z',
    updated_at: '2026-08-06T12:00:00Z',
    is_closed: false,
};

function mockHttp(): { http: AxiosInstance; calls: Array<{ method: string; url: string; body?: unknown; config?: unknown }> } {
    const calls: Array<{ method: string; url: string; body?: unknown; config?: unknown }> = [];
    const ok = (data: unknown) => ({ status: 200, data: { status: 200, data } });
    const acknowledged = () => ({ status: 200, data: { status: 200, message: '' } });
    const binaryOk = (buf: Buffer) => ({ status: 200, data: buf.buffer });
    const http = {
        get: async (url: string, config?: unknown) => {
            calls.push({ method: 'GET', url, config });
            if (url.includes('/download') || url.startsWith('/signature/')) {
                return binaryOk(Buffer.from('pdf'));
            }
            if (url === '/signers/self') return ok(signerSelfResponse);
            if (url === '/sign' || url.endsWith('/document')) return ok(documentResponse);
            return ok([]);
        },
        post: async (url: string, body: unknown, config?: unknown) => {
            calls.push({ method: 'POST', url, body, config });
            if (url === '/verify' || url === '/signature') return acknowledged();
            return ok({ signed: true });
        },
        put: async (url: string, body: unknown, config?: unknown) => {
            calls.push({ method: 'PUT', url, body, config });
            if (url.endsWith('/signers/confirm-data')) return ok(signerResponse);
            if (url === '/signers/accept-terms') return acknowledged();
            return ok([]);
        },
    } as unknown as AxiosInstance;
    return { http, calls };
}

describe('SignerDocumentsResource', () => {
    test('getCurrent requires both IDs', async () => {
        const { http } = mockHttp();
        const r = new SignerDocumentsResource(http);
        await expect(r.getCurrent('', 'c')).rejects.toThrow(ValidationError);
        await expect(r.getCurrent('s', '')).rejects.toThrow(ValidationError);
    });

    test('list passes the signer-access-code', async () => {
        const { http, calls } = mockHttp();
        const r = new SignerDocumentsResource(http);
        const result: IDocumentListResponse = await r.list(
            's1',
            'code',
            { search: 'foo', 'signer-access-code': 'attacker-code' } as never,
        );
        expect(calls[0]?.url).toBe('/signers/s1/documents');
        expect(calls[0]?.config).toEqual({ params: { 'signer-access-code': 'code', search: 'foo' } });
        expect(result).toEqual({ data: [] });
    });

    test('signMultiple rejects empty arrays', async () => {
        const { http } = mockHttp();
        const r = new SignerDocumentsResource(http);
        await expect(r.signMultiple([], 'code')).rejects.toThrow(ValidationError);
    });

    test('declineMultiple needs a reason', async () => {
        const { http } = mockHttp();
        const r = new SignerDocumentsResource(http);
        await expect(r.declineMultiple(['d1'], '', 'code')).rejects.toThrow(ValidationError);
    });

    test('uploadSignature posts to /signature with image data', async () => {
        const { http, calls } = mockHttp();
        const r = new SignerDocumentsResource(http);
        await r.uploadSignature('code', Buffer.from([1, 2, 3]));
        expect(calls[0]?.url).toBe('/signature');
        expect(calls[0]?.config).toEqual({
            params: { 'signer-access-code': 'code', type: 'signature' },
            headers: { 'Content-Type': 'image/png' },
        });
    });

    test('sign requires entries', async () => {
        const { http } = mockHttp();
        const r = new SignerDocumentsResource(http);
        await expect(r.sign('d', 'a', 'code', [])).rejects.toThrow(ValidationError);
    });

    test('decline requires reason', async () => {
        const { http } = mockHttp();
        const r = new SignerDocumentsResource(http);
        await expect(r.decline('d', 'a', 'code', '')).rejects.toThrow(ValidationError);
    });
});

describe('SignerDocumentsResource.search', () => {
    test('GETs the signer search endpoint with the access code and term', async () => {
        const { http, calls } = mockHttp();
        await new SignerDocumentsResource(http).search('signer-1', 'code-abc', 'nda');
        expect(calls[0]?.method).toBe('GET');
        expect(calls[0]?.url).toBe('/signers/signer-1/documents/search');
        expect((calls[0]?.config as { params: unknown }).params).toEqual({
            'signer-access-code': 'code-abc',
            search: 'nda',
        });
    });

    test('omits `search` when no term is given', async () => {
        const { http, calls } = mockHttp();
        await new SignerDocumentsResource(http).search('signer-1', 'code-abc');
        expect((calls[0]?.config as { params: unknown }).params).toEqual({
            'signer-access-code': 'code-abc',
        });
    });

    test('requires signerId and access code before any request', async () => {
        const { http, calls } = mockHttp();
        const res = new SignerDocumentsResource(http);
        await expect(res.search('', 'code')).rejects.toThrow(ValidationError);
        await expect(res.search('signer-1', '')).rejects.toThrow(ValidationError);
        expect(calls.length).toBe(0);
    });
});

// Every signer-side call is authenticated by the `signer-access-code` QUERY
// param, never the request body. These tests pin the verb, path, body, and
// `config.params` so the auth mechanism can't silently regress again.
describe('SignerDocumentsResource — signer-access-code query auth', () => {
    const paramsOf = (call: { config?: unknown } | undefined): unknown =>
        (call?.config as { params?: unknown } | undefined)?.params;

    test('getCurrent GETs the signer document endpoint with the code as a query param', async () => {
        const { http, calls } = mockHttp();
        const result: IDocumentDetailsResponse = await new SignerDocumentsResource(
            http,
        ).getCurrent('signer/1', 'code-xyz');
        expect(calls[0]?.method).toBe('GET');
        expect(calls[0]?.url).toBe('/signers/signer%2F1/document');
        expect(paramsOf(calls[0])).toEqual({ 'signer-access-code': 'code-xyz' });
        expect(result).toEqual(documentResponse);
    });

    test('acceptTerms PUTs /signers/accept-terms with no body and the code as a query param', async () => {
        const { http, calls } = mockHttp();
        const result: void = await new SignerDocumentsResource(http).acceptTerms('code-xyz');
        expect(calls[0]?.method).toBe('PUT');
        expect(calls[0]?.url).toBe('/signers/accept-terms');
        expect(calls[0]?.body).toBeUndefined();
        expect(calls[0]?.config).toEqual({ params: { 'signer-access-code': 'code-xyz' } });
        expect(result).toBeUndefined();
    });

    test('verifyEmail POSTs /verify with the OTP in the body and the code as a query param', async () => {
        const { http, calls } = mockHttp();
        const result: void = await new SignerDocumentsResource(http).verifyEmail({
            signerAccessCode: 'code-xyz',
            verificationCode: '123456',
        });
        expect(calls[0]?.method).toBe('POST');
        expect(calls[0]?.url).toBe('/verify');
        expect(calls[0]?.body).toEqual({ 'verification-code': '123456' });
        expect(calls[0]?.config).toEqual({ params: { 'signer-access-code': 'code-xyz' } });
        // The access code must NEVER appear in the body (would leave the request unauthenticated → 401).
        expect(calls[0]?.body).not.toHaveProperty('signer-access-code');
        expect(result).toBeUndefined();
    });

    test('verifyEmail requires both the access code and the OTP', async () => {
        const { http, calls } = mockHttp();
        const r = new SignerDocumentsResource(http);
        await expect(
            r.verifyEmail({ signerAccessCode: '', verificationCode: '123456' }),
        ).rejects.toThrow(ValidationError);
        await expect(
            r.verifyEmail({ signerAccessCode: 'code-xyz', verificationCode: '' }),
        ).rejects.toThrow(ValidationError);
        expect(calls.length).toBe(0);
    });

    test('self GETs /signers/self with the code as a query param', async () => {
        const { http, calls } = mockHttp();
        const result: ISignerSelf = await new SignerDocumentsResource(http).self('code-xyz');
        expect(calls[0]?.method).toBe('GET');
        expect(calls[0]?.url).toBe('/signers/self');
        expect(paramsOf(calls[0])).toEqual({ 'signer-access-code': 'code-xyz' });
        expect(result).toEqual(signerSelfResponse);
    });

    test('self requires the access code', async () => {
        const { http, calls } = mockHttp();
        await expect(new SignerDocumentsResource(http).self('')).rejects.toThrow(ValidationError);
        expect(calls.length).toBe(0);
    });

    test('confirmData sends only official identity fields and keeps the code in params', async () => {
        const { http, calls } = mockHttp();
        const dirtyPayload = {
            full_name: 'Example Signer',
            government_id: '123.456.789-00',
            email: undefined,
        };
        const result: ISigner = await new SignerDocumentsResource(http).confirmData(
            'doc-1',
            'code-xyz',
            dirtyPayload as never,
        );
        expect(calls[0]?.method).toBe('PUT');
        expect(calls[0]?.url).toBe('/documents/doc-1/signers/confirm-data');
        expect(calls[0]?.body).toEqual({
            full_name: 'Example Signer',
            government_id: '123.456.789-00',
        });
        expect(paramsOf(calls[0])).toEqual({ 'signer-access-code': 'code-xyz' });
        expect(result).toEqual(signerResponse);
    });

    test('confirmData preserves deprecated legacy fields without claiming terms acceptance', async () => {
        const { http, calls } = mockHttp();
        await new SignerDocumentsResource(http).confirmData('doc-1', 'code-xyz', {
            full_name: 'Example Signer',
            whatsapp_phone_number: '+5548999990000',
            has_accepted_terms: true,
        });
        expect(calls[0]?.body).toEqual({
            full_name: 'Example Signer',
            whatsapp_phone_number: '+5548999990000',
            has_accepted_terms: true,
        });
        expect(calls).toHaveLength(1);
    });

    test('confirmData preserves a false legacy consent value without extra requests', async () => {
        const { http, calls } = mockHttp();
        await new SignerDocumentsResource(http).confirmData('doc-1', 'code-xyz', {
            full_name: 'Example Signer',
            has_accepted_terms: false,
        });
        expect(calls).toHaveLength(1);
        expect(calls[0]?.body).toEqual({ full_name: 'Example Signer', has_accepted_terms: false });
    });

    test('confirmData requires the document ID and the access code', async () => {
        const { http } = mockHttp();
        const r = new SignerDocumentsResource(http);
        await expect(r.confirmData('', 'code', {})).rejects.toThrow(ValidationError);
        await expect(r.confirmData('doc-1', '', {})).rejects.toThrow(ValidationError);
    });

    test('uploadSignature sends the official raw PNG body with type + reuse params', async () => {
        const { http, calls } = mockHttp();
        const result: void = await new SignerDocumentsResource(http).uploadSignature(
            'code-xyz',
            Buffer.from([1, 2, 3]),
            {
                imageType: 'initial',
                reuse: true,
            },
        );
        expect(calls[0]?.method).toBe('POST');
        expect(calls[0]?.url).toBe('/signature');
        expect(calls[0]?.body).toBeInstanceOf(Buffer);
        expect(calls[0]?.config).toEqual({
            params: { 'signer-access-code': 'code-xyz', type: 'initial', reuse: true },
            headers: { 'Content-Type': 'image/png' },
        });
        expect(result).toBeUndefined();
    });

    test('uploadSignature retains the deprecated content-type pass-through', async () => {
        const { http, calls } = mockHttp();
        await new SignerDocumentsResource(http).uploadSignature(
            'code-xyz',
            Buffer.from([1, 2, 3]),
            { contentType: 'image/jpeg' },
        );
        expect(calls[0]?.config).toEqual({
            params: { 'signer-access-code': 'code-xyz', type: 'signature' },
            headers: { 'Content-Type': 'image/jpeg' },
        });
    });

    test('uploadSignature rejects an empty buffer', async () => {
        const { http } = mockHttp();
        await expect(
            new SignerDocumentsResource(http).uploadSignature('code-xyz', Buffer.alloc(0)),
        ).rejects.toThrow(ValidationError);
    });

    test('download uses the official public request without an access-code query', async () => {
        const { http, calls } = mockHttp();
        const buf = await new SignerDocumentsResource(http).download(
            'signer-1',
            'doc-1',
            'original',
        );
        expect(calls[0]?.method).toBe('GET');
        expect(calls[0]?.url).toBe('/signers/signer-1/documents/doc-1/download/original');
        expect(calls[0]?.config).toEqual({ responseType: 'arraybuffer' });
        expect(buf).toBeInstanceOf(Buffer);
    });

    test('download retains the optional legacy access-code query', async () => {
        const { http, calls } = mockHttp();
        await new SignerDocumentsResource(http).download(
            'signer-1',
            'doc-1',
            'original',
            'code-xyz',
        );
        expect(calls[0]?.config).toEqual({
            responseType: 'arraybuffer',
            params: { 'signer-access-code': 'code-xyz' },
        });
    });

    test('download rejects an explicitly blank legacy access code', async () => {
        const { http } = mockHttp();
        await expect(
            new SignerDocumentsResource(http).download('signer-1', 'doc-1', 'original', ''),
        ).rejects.toThrow(ValidationError);
    });

    test('downloadSignature fetches the selected image type as arraybuffer', async () => {
        const { http, calls } = mockHttp();
        const buf = await new SignerDocumentsResource(http).downloadSignature(
            'code-xyz',
            'initial',
        );
        expect(calls[0]?.method).toBe('GET');
        expect(calls[0]?.url).toBe('/signature/initial');
        expect(calls[0]?.config).toEqual({
            responseType: 'arraybuffer',
            params: { 'signer-access-code': 'code-xyz' },
        });
        expect(buf).toBeInstanceOf(Buffer);
    });

    test('getAssignment GETs /sign and forwards has_accepted_terms=true', async () => {
        const { http, calls } = mockHttp();
        const result: IDocumentDetailsResponse = await new SignerDocumentsResource(
            http,
        ).getAssignment('code-xyz', true);
        expect(calls[0]?.method).toBe('GET');
        expect(calls[0]?.url).toBe('/sign');
        expect(paramsOf(calls[0])).toEqual({
            'signer-access-code': 'code-xyz',
            has_accepted_terms: true,
        });
        expect(result).toEqual(documentResponse);
    });

    test('getAssignment accepts the official signer-context shape without completed', async () => {
        const signerContextResponse: IDocumentDetailsResponse = {
            ...documentResponse,
            assignment: {
                id: 'assignment-1',
                method: 'virtual',
                signers: [
                    {
                        ...signerResponse,
                        notification_history: null,
                        verification_method: 'Email',
                        notification_methods: ['Email'],
                        step: 1,
                        notified: true,
                    },
                ],
            },
        };
        const http = {
            get: async () => ({ status: 200, data: { status: 200, data: signerContextResponse } }),
        } as unknown as AxiosInstance;

        const result = await new SignerDocumentsResource(http).getAssignment('code-xyz');
        expect(result.assignment?.signers[0]?.completed).toBeUndefined();
    });

    test('getAssignment omits has_accepted_terms when it is not provided', async () => {
        const { http, calls } = mockHttp();
        await new SignerDocumentsResource(http).getAssignment('code-xyz');
        expect(paramsOf(calls[0])).toEqual({ 'signer-access-code': 'code-xyz' });
    });

    test('getAssignment keeps an explicit has_accepted_terms=false', async () => {
        const { http, calls } = mockHttp();
        await new SignerDocumentsResource(http).getAssignment('code-xyz', false);
        expect(paramsOf(calls[0])).toEqual({
            'signer-access-code': 'code-xyz',
            has_accepted_terms: false,
        });
    });

    test('signMultiple sends document_ids in the body and the code as a query param', async () => {
        const { http, calls } = mockHttp();
        const result: void = await new SignerDocumentsResource(http).signMultiple(
            ['d1', 'd2'],
            'code-xyz',
        );
        expect(calls[0]?.method).toBe('PUT');
        expect(calls[0]?.url).toBe('/signers/documents/sign-multiple');
        expect(calls[0]?.body).toEqual({ document_ids: ['d1', 'd2'] });
        expect(paramsOf(calls[0])).toEqual({ 'signer-access-code': 'code-xyz' });
        expect(result).toBeUndefined();
    });

    test('declineMultiple sends document_ids + decline_reason with the code as a query param', async () => {
        const { http, calls } = mockHttp();
        const result: void = await new SignerDocumentsResource(http).declineMultiple(
            ['d1'],
            'nope',
            'code-xyz',
        );
        expect(calls[0]?.method).toBe('PUT');
        expect(calls[0]?.url).toBe('/signers/documents/decline-multiple');
        expect(calls[0]?.body).toEqual({ document_ids: ['d1'], decline_reason: 'nope' });
        expect(paramsOf(calls[0])).toEqual({ 'signer-access-code': 'code-xyz' });
        expect(result).toBeUndefined();
    });

    test('sign POSTs the entries array with the code as a query param', async () => {
        const { http, calls } = mockHttp();
        const entries = [{ itemId: 'i1', fieldId: 'f1', pageId: 'p1', value: 'Bill' }];
        const result: Record<string, unknown> = await new SignerDocumentsResource(http).sign(
            'doc-1',
            'asg-1',
            'code-xyz',
            entries,
        );
        expect(calls[0]?.method).toBe('POST');
        expect(calls[0]?.url).toBe('/documents/doc-1/assignments/asg-1');
        expect(calls[0]?.body).toEqual(entries);
        expect(paramsOf(calls[0])).toEqual({ 'signer-access-code': 'code-xyz' });
        expect(result).toEqual({ signed: true });
    });

    test('decline PUTs the reject endpoint with decline_reason and the code as a query param', async () => {
        const { http, calls } = mockHttp();
        const result: void = await new SignerDocumentsResource(http).decline(
            'doc-1',
            'asg-1',
            'code-xyz',
            'bad terms',
        );
        expect(calls[0]?.method).toBe('PUT');
        expect(calls[0]?.url).toBe('/documents/doc-1/assignments/asg-1/reject');
        expect(calls[0]?.body).toEqual({ decline_reason: 'bad terms' });
        expect(paramsOf(calls[0])).toEqual({ 'signer-access-code': 'code-xyz' });
        expect(result).toBeUndefined();
    });
});
