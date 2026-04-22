import axios from 'axios';
import { ApiError, AssinafyError, NetworkError } from './errors';
import type { Logger } from './types';

/**
 * Unwrap the Assinafy API envelope `{ status, message, data }`.
 * Throws {@link ApiError} when the envelope reports a non-success status.
 */
export function handleAssinafyResponse<T>(response: unknown): T {
    const resp = response as { status?: number; data?: T; message?: string } | null | undefined;

    if (resp && typeof resp === 'object' && resp.status !== undefined && 'data' in resp) {
        if ((resp.status as number) >= 200 && (resp.status as number) < 300) {
            return resp.data as T;
        }
        throw ApiError.fromResponse(resp.status as number, resp);
    }

    return response as T;
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
            return ApiError.fromResponse(status, error.response?.data ?? null);
        }
        return new NetworkError(`${fallbackMessage}: ${error.message}`, { cause: error });
    }

    if (error instanceof Error) {
        return new AssinafyError(`${fallbackMessage}: ${error.message}`, {}, { cause: error });
    }

    return new AssinafyError(fallbackMessage, { cause: error });
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
