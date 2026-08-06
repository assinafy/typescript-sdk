/** Base class for all Assinafy SDK errors. */
export class AssinafyError extends Error {
    public readonly context: Record<string, unknown>;

    /**
     * Create a base SDK error with structured diagnostic context.
     *
     * @param message - Human-readable error summary.
     * @param context - Structured details safe for the caller to inspect.
     * @param options - Standard JavaScript error options, including `cause`.
     *
     * @example
     * ```ts
     * throw new AssinafyError('Operation failed', { operation: 'upload' });
     * ```
     */
    constructor(message: string, context: Record<string, unknown> = {}, options?: ErrorOptions) {
        super(message, options);
        this.name = 'AssinafyError';
        this.context = context;
    }
}

/** Thrown when the API returns a non-success HTTP status. */
export class ApiError extends AssinafyError {
    public readonly statusCode: number;
    public readonly responseData: unknown;

    /**
     * Create an error representing a non-success API response.
     *
     * @param message - API-provided or fallback error summary.
     * @param statusCode - HTTP response status.
     * @param responseData - Parsed response body, when available.
     * @param options - Standard JavaScript error options, including `cause`.
     */
    constructor(message: string, statusCode: number, responseData: unknown = null, options?: ErrorOptions) {
        super(message, { statusCode, responseData }, options);
        this.name = 'ApiError';
        this.statusCode = statusCode;
        this.responseData = responseData;
    }

    /**
     * Convert a status/body pair into an {@link ApiError}.
     *
     * @param statusCode - Non-success HTTP response status.
     * @param responseData - Parsed API body. String `message` takes priority,
     * followed by string `error`, then the stable fallback message.
     * @returns An `ApiError` retaining the original response body.
     *
     * @example
     * ```ts
     * const error = ApiError.fromResponse(422, { message: 'Invalid signer' });
     * console.log(error.statusCode, error.message);
     * ```
     */
    static fromResponse(statusCode: number, responseData: unknown): ApiError {
        const data = (responseData ?? {}) as Record<string, unknown>;
        const rawMessage = data['message'];
        const rawError = data['error'];
        const message =
            typeof rawMessage === 'string' && rawMessage.length > 0
                ? rawMessage
                : typeof rawError === 'string'
                    ? rawError
                    : 'API request failed';
        return new ApiError(message, statusCode, responseData);
    }
}

/** Thrown when client-side validation fails before the request is sent. */
export class ValidationError extends AssinafyError {
    public readonly errors: Record<string, unknown>;

    /**
     * Create a client-side validation failure raised before network I/O.
     *
     * @param message - Human-readable validation summary.
     * @param errors - Field/value diagnostics for programmatic handling.
     *
     * @example
     * ```ts
     * throw new ValidationError('Signer ID is required', { signerId: '' });
     * ```
     */
    constructor(message = 'Validation failed', errors: Record<string, unknown> = {}) {
        super(message, { errors });
        this.name = 'ValidationError';
        this.errors = errors;
    }
}

/** Thrown when the HTTP transport itself fails (DNS, timeout, etc.). */
export class NetworkError extends AssinafyError {
    /**
     * Create a transport-layer failure such as DNS, connection, or timeout.
     *
     * @param message - Sanitized transport error summary.
     * @param options - Standard JavaScript error options carrying a safe cause.
     *
     * @example
     * ```ts
     * throw new NetworkError('Request timed out', { cause });
     * ```
     */
    constructor(message: string, options?: ErrorOptions) {
        super(message, {}, options);
        this.name = 'NetworkError';
    }
}
