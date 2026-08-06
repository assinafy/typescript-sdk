import axios from 'axios';
import { ApiError, AssinafyError, NetworkError } from './errors';
import type { Logger } from './types';

const SAFE_LOG_NUMBER_FIELDS = new Set([
    'attempt',
    'attempts',
    'delayMs',
    'maxRetries',
    'signerCount',
    'size',
]);

/**
 * Unwrap the Assinafy API envelope `{ status, message, data }`.
 * Throws {@link ApiError} when the envelope reports a non-success status.
 */
export function handleAssinafyResponse<T>(response: unknown): T {
    const resp = response as { status?: number; data?: T; message?: string } | null | undefined;

    if (
        resp
        && typeof resp === 'object'
        && typeof resp.status === 'number'
        && ('data' in resp || 'message' in resp)
    ) {
        if (resp.status >= 200 && resp.status < 300) {
            // Some acknowledgement operations intentionally omit `data`.
            return resp.data as T;
        }
        throw ApiError.fromResponse(resp.status, resp);
    }

    return response as T;
}

/**
 * Decode an error body that arrived as binary.
 *
 * Artifact downloads are issued with `responseType: 'arraybuffer'`, which axios
 * applies to error responses too — so a JSON error body comes back as a Buffer
 * (Node) or ArrayBuffer. Left undecoded, {@link ApiError.fromResponse} finds no
 * `message` field and reports the generic "API request failed", discarding what
 * the server actually said (e.g. "Artefato não está disponível.").
 *
 * Returns the parsed JSON when the body is JSON, the raw string when it is not,
 * and the value untouched when it was never binary.
 */
function decodeBinaryErrorBody(data: unknown): unknown {
    let text: string;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) {
        text = data.toString('utf8');
    } else if (data instanceof ArrayBuffer) {
        text = Buffer.from(data).toString('utf8');
    } else if (ArrayBuffer.isView(data)) {
        text = Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
    } else {
        return data;
    }

    try {
        return JSON.parse(text);
    } catch {
        // Not JSON (an HTML error page, say) — keep the text so it is not lost.
        return text.length > 0 ? { message: text } : null;
    }
}

/**
 * Convert an unknown thrown value into a typed SDK error.
 * Axios errors become {@link ApiError} / {@link NetworkError}; SDK errors pass through.
 */
export function toSdkError(error: unknown, fallbackMessage: string): AssinafyError {
    if (error instanceof AssinafyError) {
        return error;
    }

    if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status) {
            const body = decodeBinaryErrorBody(error.response?.data ?? null);
            return ApiError.fromResponse(status, body ?? null);
        }
        // AxiosError retains the entire request config, including Authorization
        // and X-Api-Key headers. Never attach that object to a public SDK error:
        // error reporters commonly serialize `cause`, which would disclose the
        // caller's credentials and request body. Keep only diagnostic fields
        // that are useful for transport failures.
        const cause = sanitiseNetworkCause(error);
        return new NetworkError(`${fallbackMessage}: ${cause.message}`, { cause });
    }

    if (error instanceof Error) {
        return new AssinafyError(`${fallbackMessage}: ${error.message}`, {}, { cause: error });
    }

    return new AssinafyError(fallbackMessage, {}, { cause: error });
}

/** No-op logger used when the caller does not supply one. */
export function createNoopLogger(): Logger {
    return {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
    };
}

/**
 * Wrap a caller-supplied logger so observability is never a correctness or
 * privacy boundary.
 *
 * Logger exceptions (including rejected promises returned by an `async`
 * callback) are swallowed, so a successful API request cannot be converted
 * into an SDK failure by telemetry. Context is reduced to a small allowlist of
 * operational numeric counters; request bodies, paths, URLs, names, emails,
 * phone numbers, account/document identifiers and credentials are never
 * forwarded.
 *
 * @internal
 */
export function createSafeLogger(logger: Logger = createNoopLogger()): Logger {
    return {
        debug: (message, context) => invokeLogger(logger, 'debug', message, context),
        info: (message, context) => invokeLogger(logger, 'info', message, context),
        warn: (message, context) => invokeLogger(logger, 'warn', message, context),
        error: (message, context) => invokeLogger(logger, 'error', message, context),
    };
}

function invokeLogger(
    logger: Logger,
    level: keyof Logger,
    message: string,
    context: Record<string, unknown> | undefined,
): void {
    try {
        // Although Logger callbacks are typed as `void`, JavaScript callers can
        // supply async functions. Observe a returned thenable so its rejection
        // does not become an unhandled rejection.
        const method = logger[level] as (
            message: string,
            context?: Record<string, unknown>,
        ) => unknown;
        const safeContext = sanitiseLogContext(context);
        const result = safeContext === undefined
            ? method.call(logger, message)
            : method.call(logger, message, safeContext);
        if (isPromiseLike(result)) {
            void Promise.resolve(result).catch(() => undefined);
        }
    } catch {
        // Logging is best-effort and must never alter request semantics.
    }
}

function sanitiseLogContext(
    context: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
    if (!context) return undefined;

    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(context)) {
        if (SAFE_LOG_NUMBER_FIELDS.has(key) && typeof value === 'number' && Number.isFinite(value)) {
            safe[key] = value;
        }
    }

    return Object.keys(safe).length > 0 ? safe : undefined;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    return (
        (typeof value === 'object' && value !== null) || typeof value === 'function'
    ) && typeof (value as { then?: unknown }).then === 'function';
}

type ErrorWithCode = Error & { code?: unknown };

function sanitiseNetworkCause(error: ErrorWithCode): ErrorWithCode {
    const safe = new Error(redactSensitiveErrorText(error.message)) as ErrorWithCode;
    safe.name = error.name || 'AxiosError';
    if (typeof error.code === 'string' || typeof error.code === 'number') {
        Object.defineProperty(safe, 'code', {
            configurable: false,
            enumerable: true,
            value: error.code,
            writable: false,
        });
    }
    return safe;
}

function redactSensitiveErrorText(message: string): string {
    return message
        .replace(
            /((?:authorization|x-api-key|api[_-]?key|access[_-]?token|token|secret)\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi,
            '$1[REDACTED]',
        )
        .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, '$1[REDACTED]@');
}

/** Strip undefined values from a params record (Axios sends `undefined` as literal). */
export function cleanParams(params: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
            out[key] = value;
        }
    }
    return out;
}

/**
 * Clean query params for a paginated list call, normalising `per_page` to the
 * `per-page` spelling the API actually reads.
 *
 * The API honours **only** `per-page`. `per_page` is not rejected — it is
 * silently ignored and the response falls back to the default page size of 20
 * (verified: `?per-page=2` returns 2 items with `x-pagination-per-page: 2`,
 * while `?per_page=2` returns 20). Accepting both spellings keeps the
 * snake_case form working for callers rather than failing them quietly.
 *
 * An explicit `per-page` always wins over `per_page`.
 */
export function cleanListParams(params: Record<string, unknown>): Record<string, unknown> {
    const out = cleanParams(params);
    if (out['per_page'] !== undefined) {
        out['per-page'] ??= out['per_page'];
        delete out['per_page'];
    }
    return out;
}
