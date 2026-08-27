import type { AxiosInstance, AxiosResponse, AxiosResponseHeaders } from 'axios';
import { ApiError, AssinafyError, ValidationError } from '../errors';
import type { Logger, PaginatedResult, PaginationMeta } from '../types';
import { createNoopLogger, createSafeLogger, handleAssinafyResponse, toSdkError } from '../utils';
import { readHeader } from '../support/headers';
import { encodePathSegment } from '../support/path';
import { buildUploadForm, loadSource, MAX_UPLOAD_BYTES, validateUpload } from './upload';
import type { DocumentUploadSource } from './upload';
import { applySdkTransportDefaults } from '../support/transport';

/** Content-Type required by the document and template upload endpoints. */
const MULTIPART_CONTENT_TYPE = 'multipart/form-data';

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
    protected readonly logger: Logger;

    constructor(
        protected readonly http: AxiosInstance,
        protected readonly defaultAccountId?: string,
        logger: Logger = createNoopLogger(),
    ) {
        this.logger = createSafeLogger(logger);
        applySdkTransportDefaults(http);
    }

    /** Resolve the effective account id, throwing if none is available. */
    protected accountId(explicit?: string): string {
        const id = explicit ?? this.defaultAccountId;
        if (typeof id !== 'string' || id.trim().length === 0) {
            throw new ValidationError(
                'Account ID is required. Provide it as a parameter or set a default in the client.',
            );
        }
        return id;
    }

    /** Guard required path arguments (documentId, signerId, …). */
    protected requireId<T extends string>(value: T | undefined | null, name: string): T {
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new ValidationError(`${name} is required`);
        }
        return value;
    }

    /** Validate and encode a value that will occupy one URL path segment. */
    protected pathSegment(value: string | undefined | null, name: string): string {
        const required = this.requireId(value, name);
        try {
            return encodePathSegment(required);
        } catch {
            throw new ValidationError(`${name} contains invalid URL characters`);
        }
    }

    /** Execute an HTTP call and return the unwrapped envelope body. */
    protected async call<T>(label: string, request: RequestFn): Promise<T> {
        try {
            const response = assertSuccessful(await request());
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
            const response = assertSuccessful(await request());
            // Validate an Assinafy status/message envelope when present. This
            // also normalizes acknowledgement responses that intentionally omit
            // `data` to `void`.
            handleAssinafyResponse<void>(response.data);
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
            const response = assertSuccessful(await request());
            return Buffer.from(response.data);
        } catch (err) {
            throw toSdkError(err, label);
        }
    }

    /**
     * Upload a PDF as `multipart/form-data` and assert the API echoed an id.
     *
     * Shared by `documents.upload` and `templates.create`, which are the same
     * sequence over different paths: load → validate → build form → POST →
     * assert an id came back. Callers keep their own success logging.
     *
     * @param path - Account-scoped endpoint to POST to.
     * @param source - The PDF, as a file path or in-memory buffer.
     * @param formOptions - `name` (display name) and optional `metadata`.
     * @param labels - `errorLabel` for the request failure, `missingId` for a
     * `2xx` that returned no id.
     */
    protected async uploadPdf<T extends { id?: string }>(
        path: string,
        source: DocumentUploadSource,
        formOptions: { name?: string; metadata?: Record<string, unknown> },
        labels: { errorLabel: string; missingId: string },
    ): Promise<T> {
        const { buffer, fileName } = await loadSource(source, { maxBytes: MAX_UPLOAD_BYTES });
        validateUpload(buffer, fileName);

        this.logger.info('Uploading PDF', { path, fileName, size: buffer.byteLength });

        const form = buildUploadForm(buffer, fileName, formOptions);
        const result = await this.call<T>(labels.errorLabel, () =>
            this.http.post(path, form, { headers: { 'Content-Type': MULTIPART_CONTENT_TYPE } }),
        );

        if (!result?.id) {
            throw new ValidationError(labels.missingId, {
                response: result as Record<string, unknown>,
            });
        }
        return result;
    }

    /** Execute a paginated list call and attach meta from `X-Pagination-*` headers. */
    protected async callList<T>(label: string, request: RequestFn): Promise<PaginatedResult<T>> {
        try {
            const response = assertSuccessful(await request());
            const unwrapped = handleAssinafyResponse<T[] | { data?: T[] }>(response.data);
            let data: T[];
            if (Array.isArray(unwrapped)) {
                data = unwrapped;
            } else if (Array.isArray(unwrapped?.data)) {
                data = (unwrapped as { data: T[] }).data;
            } else {
                throw new AssinafyError(`${label}: API returned a malformed list payload`, {
                    responseData: unwrapped,
                });
            }
            const meta = parsePaginationMeta(response.headers);
            return meta === undefined ? { data } : { data, meta };
        } catch (err) {
            throw toSdkError(err, label);
        }
    }
}

type RequestFn = () => Promise<AxiosResponse>;

function assertSuccessful<T extends AxiosResponse>(response: T): T {
    if (response.status < 200 || response.status >= 300) {
        throw ApiError.fromResponse(response.status, response.data);
    }
    return response;
}

function parsePaginationMeta(
    headers: AxiosResponseHeaders | Record<string, unknown> | undefined,
): PaginationMeta | undefined {
    if (!headers) return undefined;

    const read = (key: string): string | undefined =>
        readHeader(headers as Record<string, unknown>, key);

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
    const normalized = value.trim();
    if (!/^\d+$/.test(normalized)) return undefined;
    const n = Number(normalized);
    return Number.isSafeInteger(n) ? n : undefined;
}
