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
