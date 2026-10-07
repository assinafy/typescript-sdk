import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IWebhookPayload } from '../types';

/** Headers read by {@link WebhookVerifier.verifySignature}. */
export type WebhookHeaders =
    | { get(name: string): string | null }
    | Record<string, string | string[] | undefined>;

/** Default replay window for `webhook-timestamp`, in seconds. */
const DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * Verifies and parses Assinafy webhook deliveries.
 *
 * Endpoints created with `signing_enabled: true` sign every delivery following
 * the Standard Webhooks specification: `webhook-signature` carries
 * space-separated `v1,<base64 HMAC-SHA256>` entries over
 * `{webhook-id}.{webhook-timestamp}.{raw body}`, keyed with the base64-decoded
 * part of the endpoint's `whsec_` secret.
 */
export class WebhookVerifier {
    private readonly webhookSecret: string | undefined;

    /**
     * @param webhookSecret - The endpoint's `whsec_…` secret from
     * `webhooks.getEndpointSecret()`. Omit it to keep verification disabled
     * (every check returns `false`).
     *
     * @example
     * ```ts
     * const verifier = new WebhookVerifier(process.env.ASSINAFY_WEBHOOK_SECRET);
     * ```
     */
    constructor(webhookSecret?: string) {
        this.webhookSecret = webhookSecret;
    }

    /**
     * Verify a signed delivery: the Standard Webhooks signature over the raw
     * body, and a `webhook-timestamp` within `toleranceSeconds` of this
     * machine's clock (replay protection).
     *
     * @param payload - Exact, unparsed request bytes (or their UTF-8 string).
     * Re-serialized JSON will not match.
     * @param headers - Request headers: a Node/Express header object
     * (lowercase keys) or a Fetch `Headers`. Reads `webhook-id`,
     * `webhook-timestamp` and `webhook-signature`.
     * @param toleranceSeconds - Accepted clock distance. Defaults to `300`.
     * @returns `true` only when a signature entry matches (constant-time) and
     * the timestamp is fresh; `false` when verification is disabled, a header
     * is missing, or anything does not match.
     *
     * @example
     * ```ts
     * app.post('/webhooks/assinafy', express.raw({ type: 'application/json' }), (req, res) => {
     *   if (!client.webhookVerifier.verifySignature(req.body, req.headers)) {
     *     return res.status(401).end();
     *   }
     *   const event = client.webhookVerifier.extractEvent(req.body);
     *   // deduplicate on req.headers['webhook-id'], then process
     *   res.status(204).end();
     * });
     * ```
     */
    verifySignature(
        payload: string | Buffer,
        headers: WebhookHeaders,
        toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
    ): boolean {
        const key = decodeSecret(this.webhookSecret);
        if (!key || (typeof payload !== 'string' && !Buffer.isBuffer(payload)) || !headers) {
            return false;
        }
        const id = header(headers, 'webhook-id');
        const timestamp = header(headers, 'webhook-timestamp');
        const signatures = header(headers, 'webhook-signature');
        if (!id || !timestamp || !signatures || !/^\d+$/.test(timestamp)) return false;
        if (Math.abs(Date.now() / 1000 - Number(timestamp)) > toleranceSeconds) return false;

        const expected = createHmac('sha256', key)
            .update(`${id}.${timestamp}.`)
            .update(payload)
            .digest();
        return signatures.split(' ').some((entry) => {
            const [version, signature] = entry.split(',', 2);
            if (version !== 'v1' || !signature) return false;
            const actual = Buffer.from(signature, 'base64');
            return actual.length === expected.length && timingSafeEqual(actual, expected);
        });
    }

    /**
     * Compare a hexadecimal HMAC-SHA256 digest of the raw body, keyed with the
     * secret string as-is.
     *
     * @deprecated For gateways that apply their own HMAC convention. Assinafy's
     * own signatures are verified with {@link WebhookVerifier.verifySignature}.
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
        if (
            typeof this.webhookSecret !== 'string'
            || !this.webhookSecret
            || (typeof payload !== 'string' && !Buffer.isBuffer(payload))
            || typeof signature !== 'string'
            || !signature
        ) {
            return false;
        }

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
     * Parse the raw webhook body into a JSON object. Both the rich envelope and
     * compatibility `{ type, data }` form are accepted.
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

/** Strip the optional `whsec_` prefix and base64-decode the key. */
function decodeSecret(secret: string | undefined): Buffer | null {
    if (typeof secret !== 'string' || !secret) return null;
    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
    return key.length > 0 ? key : null;
}

function header(headers: WebhookHeaders, name: string): string | undefined {
    const value = typeof headers.get === 'function'
        ? (headers as { get(name: string): string | null }).get(name)
        : (headers as Record<string, string | string[] | undefined>)[name];
    const first = Array.isArray(value) ? value[0] : value;
    return typeof first === 'string' ? first.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
