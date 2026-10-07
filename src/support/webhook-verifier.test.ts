import { describe, test, expect } from 'bun:test';
import { createHmac } from 'node:crypto';
import { WebhookVerifier } from './webhook-verifier';
import type { IWebhookPayload } from '../types';

describe('WebhookVerifier', () => {
    const secret = 'super-secret';
    const event: IWebhookPayload = {
        id: 1,
        event: 'document_ready',
        created_at: 1_786_000_000,
        subject: {},
        object: { document_id: 'doc-1' },
        account_id: 'account-1',
        data: { document_id: 'doc-1' },
    };
    const payload = JSON.stringify(event);
    const signature = createHmac('sha256', secret).update(payload).digest('hex');

    test('verify returns true for a matching HMAC-SHA256 signature', () => {
        const verifier = new WebhookVerifier(secret);
        expect(verifier.verify(payload, signature)).toBe(true);
    });

    test('verify returns false for mismatched signature', () => {
        const verifier = new WebhookVerifier(secret);
        expect(verifier.verify(payload, 'deadbeef')).toBe(false);
        expect(verifier.verify(payload, `${signature.slice(0, 63)}z`)).toBe(false);
    });

    test('verify returns false when no secret is configured', () => {
        const verifier = new WebhookVerifier(undefined);
        expect(verifier.verify(payload, signature)).toBe(false);
    });

    test('verify fails closed for malformed runtime inputs', () => {
        const verifier = new WebhookVerifier(secret);

        expect(verifier.verify(null as never, signature)).toBe(false);
        expect(verifier.verify(new Uint8Array([1, 2, 3]) as never, signature)).toBe(false);
        expect(verifier.verify(payload, {} as never)).toBe(false);
        expect(new WebhookVerifier({} as never).verify(payload, signature)).toBe(false);
    });

    test('extractEvent parses JSON payloads', () => {
        const verifier = new WebhookVerifier(secret);
        expect(verifier.extractEvent(payload)).toEqual(event);
    });

    test('extractEvent returns null on malformed payload', () => {
        const verifier = new WebhookVerifier(secret);
        expect(verifier.extractEvent('{not json')).toBeNull();
        expect(verifier.extractEvent('[]')).toBeNull();
        expect(verifier.extractEvent('null')).toBeNull();
    });

    test('extractEvent retains legacy and forward-compatible object envelopes', () => {
        const verifier = new WebhookVerifier(secret);
        const legacy = { type: 'document.ready', data: { document_id: 'doc-1' } };
        expect(verifier.extractEvent(JSON.stringify(legacy))).toEqual(legacy);
        expect(verifier.extractEvent('{}')).toEqual({});
        expect(verifier.getEventType(legacy)).toBe('document.ready');
        expect(verifier.getEventData(legacy)).toEqual({ document_id: 'doc-1' });
    });

    test('getEventType / getEventData unwrap the envelope', () => {
        const verifier = new WebhookVerifier(secret);
        const event = verifier.extractEvent(payload);
        expect(verifier.getEventType(event)).toBe('document_ready');
        expect(verifier.getEventData(event)).toEqual({ document_id: 'doc-1' });
    });
});

describe('WebhookVerifier.verifySignature (Standard Webhooks)', () => {
    const key = Buffer.from('assinafy-test-signing-key');
    const secret = `whsec_${key.toString('base64')}`;
    const body = '{"id":1,"event":"document_ready","account_id":"account-1"}';
    const now = () => String(Math.floor(Date.now() / 1000));
    const sign = (id: string, ts: string, raw: string, k = key) =>
        `v1,${createHmac('sha256', k).update(`${id}.${ts}.${raw}`).digest('base64')}`;
    const headersFor = (ts = now(), signature = sign('msg_1', ts, body)) => ({
        'webhook-id': 'msg_1',
        'webhook-timestamp': ts,
        'webhook-signature': signature,
    });

    test('accepts a valid signature from a header record, Fetch Headers, or a Buffer body', () => {
        const verifier = new WebhookVerifier(secret);
        expect(verifier.verifySignature(body, headersFor())).toBe(true);
        expect(verifier.verifySignature(Buffer.from(body), new Headers(headersFor()))).toBe(true);
        expect(new WebhookVerifier(key.toString('base64')).verifySignature(body, headersFor())).toBe(true);
    });

    test('accepts when any space-separated v1 entry matches', () => {
        const ts = now();
        const signature = `v1a,ignored v1,${Buffer.alloc(32).toString('base64')} ${sign('msg_1', ts, body)}`;
        expect(new WebhookVerifier(secret).verifySignature(body, headersFor(ts, signature))).toBe(true);
        expect(
            new WebhookVerifier(secret).verifySignature(body, {
                ...headersFor(ts),
                'webhook-signature': [sign('msg_1', ts, body)],
            }),
        ).toBe(true);
    });

    test('rejects tampering, wrong secrets, stale timestamps, and missing inputs', () => {
        const verifier = new WebhookVerifier(secret);
        const old = String(Math.floor(Date.now() / 1000) - 301);
        const cases: Array<[unknown, unknown]> = [
            [`${body} `, headersFor()],
            [body, { ...headersFor(), 'webhook-id': 'msg_2' }],
            [body, headersFor(now(), sign('msg_1', now(), body, Buffer.from('other')))],
            [body, headersFor(old, sign('msg_1', old, body))],
            [body, headersFor('12x')],
            [body, headersFor(now(), 'v1,')],
            [body, headersFor(now(), 'v1,c2hvcnQ=')],
            [body, { 'webhook-id': 'msg_1' }],
            [body, null],
            [42, headersFor()],
        ];
        for (const [payload, headers] of cases) {
            expect(verifier.verifySignature(payload as never, headers as never)).toBe(false);
        }
        expect(new WebhookVerifier(undefined).verifySignature(body, headersFor())).toBe(false);
        expect(new WebhookVerifier('whsec_').verifySignature(body, headersFor())).toBe(false);
    });

    test('honours a custom tolerance', () => {
        const old = String(Math.floor(Date.now() / 1000) - 600);
        const headers = headersFor(old, sign('msg_1', old, body));
        expect(new WebhookVerifier(secret).verifySignature(body, headers, 900)).toBe(true);
    });
});
