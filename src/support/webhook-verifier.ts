import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IWebhookPayload } from '../types';

/**
 * Opt-in verifier for deployments that wrap Assinafy webhook bodies in an
 * HMAC-SHA256 convention of their own.
 *
 * The current public Assinafy API contract does not specify a webhook-signature
 * header or shared-secret exchange. This helper therefore makes no claim about
 * a platform-provided header: callers must explicitly supply the raw lowercase
 * or uppercase hexadecimal HMAC digest produced by their own trusted gateway.
 */
export class WebhookVerifier {
    private readonly webhookSecret: string | undefined;

    /**
     * Create an opt-in verifier for a gateway-defined HMAC convention.
     *
     * @param webhookSecret - Shared secret configured in both the trusted
     * gateway and this process. Omit it to keep verification disabled.
     *
     * @example
     * ```ts
     * const verifier = new WebhookVerifier(process.env.WEBHOOK_SHARED_SECRET);
     * ```
     */
    constructor(webhookSecret?: string) {
        this.webhookSecret = webhookSecret;
    }

    /**
     * Compare a hexadecimal HMAC-SHA256 digest with the raw request body.
     *
     * @param payload - Exact, unparsed request bytes (or their UTF-8 string).
     * @param signature - 64-character hexadecimal SHA-256 digest supplied by
     * the caller's trusted gateway.
     * @returns `true` only for a well-formed, timing-safe match; `false` when
     * verification is disabled or either input is invalid.
     *
     * @example
     * ```ts
     * const valid = verifier.verify(rawRequestBody, gatewaySignature);
     * if (!valid) throw new Error('Invalid webhook signature');
     * ```
     */
    verify(payload: string | Buffer, signature: string): boolean {
        if (!this.webhookSecret || !signature) return false;

        const buf = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
        const provided = signature.trim();
        if (!/^[\da-f]{64}$/i.test(provided)) return false;

        const expected = createHmac('sha256', this.webhookSecret).update(buf).digest();
        const actual = Buffer.from(provided, 'hex');
        try {
            return timingSafeEqual(expected, actual);
        } catch {
            return false;
        }
    }

    /**
     * Parse the raw webhook body into a JSON object. Inbound webhook bodies are
     * not described by the current OpenAPI, so this remains deliberately
     * tolerant of both the observed rich envelope and legacy `{ type, data }`.
     *
     * @param payload - Raw UTF-8 JSON request body.
     * @returns The object envelope, or `null` for malformed JSON, primitives,
     * arrays, and `null`.
     *
     * @example
     * ```ts
     * const event = verifier.extractEvent(rawRequestBody);
     * if (!event) return response.status(400).end();
     * ```
     */
    extractEvent(payload: string | Buffer): IWebhookPayload | null {
        try {
            const text = typeof payload === 'string' ? payload : payload.toString('utf8');
            const parsed: unknown = JSON.parse(text);
            return isRecord(parsed) ? parsed as IWebhookPayload : null;
        } catch {
            return null;
        }
    }

    /**
     * Extract an event name from the current `event` or legacy `type` field.
     *
     * @param event - Parsed webhook envelope, or a nullable parse result.
     * @returns The event name, or `null` when neither field is a string.
     *
     * @example
     * ```ts
     * const type = verifier.getEventType(event);
     * if (type === 'document_ready') await handleReady(event);
     * ```
     */
    getEventType(event: IWebhookPayload | null | undefined): string | null {
        if (!event || typeof event !== 'object') return null;
        const candidate = event.event ?? event.type;
        return typeof candidate === 'string' ? candidate : null;
    }

    /**
     * Extract the event-specific object, falling back to legacy `data`.
     *
     * @param event - Parsed webhook envelope, or a nullable parse result.
     * @returns `event.object`, then `event.data`, or an empty object when no
     * object payload exists.
     *
     * @example
     * ```ts
     * const data = verifier.getEventData(event);
     * console.log(data.document_id);
     * ```
     */
    getEventData(event: IWebhookPayload | null | undefined): Record<string, unknown> {
        if (!event || typeof event !== 'object') return {};
        if (isRecord(event.object)) return event.object;
        if (isRecord(event.data)) return event.data;
        return {};
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
