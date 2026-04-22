import type { AxiosInstance, AxiosResponse, AxiosResponseHeaders } from 'axios';
import { ApiError, ValidationError } from '../errors';
import type { Logger, PaginatedResult, PaginationMeta } from '../types';
import { createNoopLogger, handleAssinafyResponse, toSdkError } from '../utils';

/**
 * Shared plumbing for every Assinafy resource:
 *
 *  - holds the axios instance, default account ID, and logger
 *  - provides `accountId()` / `requireId()` argument guards
 *  - wraps HTTP calls in a single `try/catch` → typed-error pipeline
 *  - unwraps the Assinafy response envelope
 *  - parses `X-Pagination-*` headers into a typed meta object
 *
 * Resources should never `try/catch` or touch the envelope directly — they call
 * one of `call` / `callVoid` / `callBinary` / `callList` instead.
 */
export abstract class BaseResource {
    constructor(
        protected readonly http: AxiosInstance,
        protected readonly defaultAccountId?: string,
        protected readonly logger: Logger = createNoopLogger(),
    ) {}

    /** Resolve the effective account id, throwing if none is available. */
    protected accountId(explicit?: string): string {
        const id = explicit ?? this.defaultAccountId;
        if (!id) {
            throw new ValidationError(
                'Account ID is required. Provide it as a parameter or set a default in the client.',
            );
        }
        return id;
    }

    /** Guard required path arguments (documentId, signerId, …). */
    protected requireId<T extends string>(value: T | undefined | null, name: string): T {
        if (!value) {
            throw new ValidationError(`${name} is required`);
        }
        return value;
    }

    /** Execute an HTTP call and return the unwrapped envelope body. */
    protected async call<T>(label: string, request: RequestFn): Promise<T> {
        try {
            const response = await request();
            return handleAssinafyResponse<T>(response.data);
        } catch (err) {
            throw toSdkError(err, label);
        }
    }

    /** Like {@link call} but returns `null` when the API responds with 404. */
    protected async callOptional<T>(label: string, request: RequestFn): Promise<T | null> {
        try {
            return await this.call<T>(label, request);
        } catch (err) {
            if (err instanceof ApiError && err.statusCode === 404) return null;
            throw err;
        }
    }

    /** Execute an HTTP call that returns no body (DELETE / 204). */
    protected async callVoid(label: string, request: RequestFn): Promise<void> {
        try {
            const response = await request();
            if (response.status < 200 || response.status >= 300) {
                throw new ValidationError(`${label}: HTTP ${response.status}`);
            }
        } catch (err) {
            throw toSdkError(err, label);
        }
    }

    /** Execute an HTTP call that returns binary data (artifact downloads). */
    protected async callBinary(
        label: string,
        request: () => Promise<AxiosResponse<ArrayBuffer>>,
    ): Promise<Buffer> {
        try {
            const response = await request();
            return Buffer.from(response.data);
        } catch (err) {
            throw toSdkError(err, label);
        }
    }

    /** Execute a paginated list call and attach meta from `X-Pagination-*` headers. */
    protected async callList<T>(label: string, request: RequestFn): Promise<PaginatedResult<T>> {
        try {
            const response = await request();
            const unwrapped = handleAssinafyResponse<T[] | { data?: T[] }>(response.data);
            const data: T[] = Array.isArray(unwrapped)
                ? unwrapped
                : Array.isArray(unwrapped?.data)
                    ? (unwrapped as { data: T[] }).data
                    : [];
            const meta = parsePaginationMeta(response.headers);
            return meta === undefined ? { data } : { data, meta };
        } catch (err) {
            throw toSdkError(err, label);
        }
    }
}

type RequestFn = () => Promise<AxiosResponse>;

function parsePaginationMeta(
    headers: AxiosResponseHeaders | Record<string, unknown> | undefined,
): PaginationMeta | undefined {
    if (!headers) return undefined;

    const read = (key: string): string | undefined => {
        const h = headers as Record<string, unknown>;
        const raw = h[key] ?? h[key.toLowerCase()];
        if (raw === undefined || raw === null) return undefined;
        return Array.isArray(raw) ? String(raw[0]) : String(raw);
    };

    const current = toInt(read('x-pagination-current-page'));
    const perPage = toInt(read('x-pagination-per-page'));
    const total = toInt(read('x-pagination-total-count'));
    const lastPage = toInt(read('x-pagination-page-count'));

    if (current === undefined && perPage === undefined && total === undefined && lastPage === undefined) {
        return undefined;
    }

    const meta: PaginationMeta = {};
    if (current !== undefined) meta.current_page = current;
    if (perPage !== undefined) meta.per_page = perPage;
    if (total !== undefined) meta.total = total;
    if (lastPage !== undefined) meta.last_page = lastPage;
    return meta;
}

function toInt(value: string | undefined): number | undefined {
    if (value === undefined) return undefined;
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : undefined;
}
