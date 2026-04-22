import { describe, test, expect } from 'bun:test';
import { createHmac } from 'node:crypto';
import { WebhookVerifier } from './webhook-verifier';

describe('WebhookVerifier', () => {
    const secret = 'super-secret';
    const payload = JSON.stringify({ event: 'document_ready', data: { document_id: 'doc-1' } });
    const signature = createHmac('sha256', secret).update(payload).digest('hex');

    test('verify returns true for a matching HMAC-SHA256 signature', () => {
        const verifier = new WebhookVerifier(secret);
        expect(verifier.verify(payload, signature)).toBe(true);
    });

    test('verify returns false for mismatched signature', () => {
        const verifier = new WebhookVerifier(secret);
        expect(verifier.verify(payload, 'deadbeef')).toBe(false);
    });

    test('verify returns false when no secret is configured', () => {
        const verifier = new WebhookVerifier(undefined);
        expect(verifier.verify(payload, signature)).toBe(false);
    });

    test('extractEvent parses JSON payloads', () => {
        const verifier = new WebhookVerifier(secret);
        expect(verifier.extractEvent(payload)).toEqual({
            event: 'document_ready',
            data: { document_id: 'doc-1' },
        });
    });

    test('extractEvent returns null on malformed payload', () => {
        const verifier = new WebhookVerifier(secret);
        expect(verifier.extractEvent('{not json')).toBeNull();
    });

    test('getEventType / getEventData unwrap the envelope', () => {
        const verifier = new WebhookVerifier(secret);
        const event = verifier.extractEvent(payload);
        expect(verifier.getEventType(event)).toBe('document_ready');
        expect(verifier.getEventData(event)).toEqual({ document_id: 'doc-1' });
    });
});
