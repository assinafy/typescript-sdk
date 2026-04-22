import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IWebhookPayload } from '../types';

/**
 * Verifier for Assinafy webhook payloads.
 *
 * The Assinafy platform signs webhook bodies with HMAC-SHA256 using the
 * workspace webhook secret and sends the hex digest in an `X-Assinafy-Signature`
 * header. Use {@link WebhookVerifier.verify} to confirm the signature before
 * trusting the payload.
 */
export class WebhookVerifier {
    constructor(private readonly webhookSecret?: string) {}

    /** Returns `true` if `signature` is a valid HMAC-SHA256 of `payload`. */
    verify(payload: string | Buffer, signature: string): boolean {
        if (!this.webhookSecret || !signature) return false;

        const buf = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
        const expected = createHmac('sha256', this.webhookSecret).update(buf).digest('hex');
        const provided = signature.trim();

        const a = Buffer.from(expected, 'utf8');
        const b = Buffer.from(provided, 'utf8');
        if (a.length !== b.length) return false;
        try {
            return timingSafeEqual(a, b);
        } catch {
            return false;
        }
    }

    /** Parse the raw webhook body into a JSON event envelope. */
    extractEvent(payload: string | Buffer): IWebhookPayload | null {
        try {
            const text = typeof payload === 'string' ? payload : payload.toString('utf8');
            const parsed = JSON.parse(text) as IWebhookPayload;
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch {
            return null;
        }
    }

    /** Extract the event name (`event` or `type`) from an event envelope. */
    getEventType(event: IWebhookPayload | null | undefined): string | null {
        if (!event || typeof event !== 'object') return null;
        const e = event as IWebhookPayload & { type?: string };
        return e.event ?? e.type ?? null;
    }

    /** Extract the event data (`data` or `object`) from an event envelope. */
    getEventData(event: IWebhookPayload | null | undefined): Record<string, unknown> {
        if (!event || typeof event !== 'object') return {};
        const e = event as IWebhookPayload & { object?: Record<string, unknown> };
        return (e.data as Record<string, unknown> | undefined) ?? e.object ?? {};
    }
}
