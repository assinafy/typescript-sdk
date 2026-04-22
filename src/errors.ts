/** Base class for all Assinafy SDK errors. */
export class AssinafyError extends Error {
    public readonly context: Record<string, unknown>;

    constructor(message: string, context: Record<string, unknown> = {}, options?: { cause?: unknown }) {
        super(message);
        this.name = 'AssinafyError';
        this.context = context;
        if (options?.cause !== undefined) {
            (this as { cause?: unknown }).cause = options.cause;
        }
    }
}

/** Thrown when the API returns a non-success HTTP status. */
export class ApiError extends AssinafyError {
    public readonly statusCode: number;
    public readonly responseData: unknown;

    constructor(message: string, statusCode: number, responseData: unknown = null, options?: { cause?: unknown }) {
        super(message, { statusCode, responseData }, options);
        this.name = 'ApiError';
        this.statusCode = statusCode;
        this.responseData = responseData;
    }

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

    constructor(message = 'Validation failed', errors: Record<string, unknown> = {}) {
        super(message, { errors });
        this.name = 'ValidationError';
        this.errors = errors;
    }
}

/** Thrown when the HTTP transport itself fails (DNS, timeout, etc.). */
export class NetworkError extends AssinafyError {
    constructor(message: string, options?: { cause?: unknown }) {
        super(message, {}, options);
        this.name = 'NetworkError';
    }
}
