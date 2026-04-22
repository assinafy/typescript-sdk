/** Document lifecycle states emitted by the API. */
export type DocumentStatus =
    | 'uploading'
    | 'uploaded'
    | 'metadata_processing'
    | 'metadata_ready'
    | 'pending_signature'
    | 'expired'
    | 'certificating'
    | 'certificated'
    | 'rejected_by_signer'
    | 'rejected_by_user'
    | 'failed';

/** Artifact names available for document download. */
export type DocumentArtifactName = 'original' | 'certificated' | 'certificate-page' | 'bundle';

/** Assignment methods supported by the API. */
export type AssignmentMethod = 'virtual' | 'collect';

/** Verification methods accepted by assignment signer entries. */
export type AssignmentVerificationMethod = 'Email' | 'Whatsapp' | string;

/** Notification methods accepted by assignment signer entries. */
export type AssignmentNotificationMethod = 'Email' | 'Whatsapp' | string;

/** Minimal logger contract (compatible with console, pino, winston, etc.). */
export interface Logger {
    debug: (message: string, context?: Record<string, unknown>) => void;
    info: (message: string, context?: Record<string, unknown>) => void;
    warn: (message: string, context?: Record<string, unknown>) => void;
    error: (message: string, context?: Record<string, unknown>) => void;
}

/** Client configuration options. */
export interface AssinafyClientOptions {
    /** Assinafy API key. Preferred authentication method (sends `X-Api-Key` header). */
    apiKey?: string;
    /**
     * Legacy access token. If provided (and `apiKey` is not), the client will send
     * `Authorization: Bearer <token>` instead. Kept for backwards compatibility.
     */
    token?: string;
    /** Default account (workspace) ID applied to account-scoped endpoints. */
    accountId?: string;
    /** Override the API base URL. Defaults to https://api.assinafy.com.br/v1. */
    baseUrl?: string;
    /** Secret used to verify webhook payload signatures (HMAC-SHA256). */
    webhookSecret?: string;
    /** Request timeout in milliseconds. Defaults to 30_000. */
    timeout?: number;
    /** Optional logger. Defaults to a no-op logger. */
    logger?: Logger;
}

/** Payload for creating a signer. */
export interface ICreateSignerPayload {
    full_name: string;
    email: string;
    whatsapp_phone_number?: string;
    /** PHP SDK compatibility alias for `whatsapp_phone_number`. */
    phone?: string;
    metadata?: Record<string, unknown>;
}

/** Payload for updating a signer. */
export interface IUpdateSignerPayload {
    full_name?: string;
    email?: string;
    whatsapp_phone_number?: string;
    /** PHP SDK compatibility alias for `whatsapp_phone_number`. */
    phone?: string;
}

/** Signer object as returned by the API. */
export interface ISigner {
    id: string;
    full_name: string;
    email: string;
    whatsapp_phone_number?: string | null;
    has_accepted_terms?: boolean;
    metadata?: Record<string, unknown>;
}

export type ICreateSignerResponse = ISigner;

/** Pagination metadata extracted from `X-Pagination-*` response headers. */
export interface PaginationMeta {
    current_page?: number;
    last_page?: number;
    per_page?: number;
    total?: number;
}

/** Shape returned by every paginated list call in the SDK. */
export interface PaginatedResult<T> {
    data: T[];
    meta?: PaginationMeta;
}

/** @deprecated use {@link PaginatedResult} — retained for existing type imports. */
export type IPaginatedResponse<T> = PaginatedResult<T>;

export type ISignerListResponse = PaginatedResult<ISigner>;

/** Signer reference accepted by the assignment endpoints. */
export type SignerReference =
    | string
    | {
          id?: string;
          signer_id?: string;
          verification_method?: AssignmentVerificationMethod;
          notification_methods?: AssignmentNotificationMethod[];
      };

/** Payload for creating an assignment. */
export interface ICreateAssignmentPayload {
    method?: AssignmentMethod;
    /**
     * List of signers. Each entry may be a signer id string, or an object with
     * `id` / `signer_id`. For cost estimation, entries may omit the ID and
     * specify only `verification_method` / `notification_methods`.
     *
     * The SDK normalises them to the docs-sanctioned `signers: [{ ... }]`
     * shape before sending.
     */
    signers?: SignerReference[];
    /** Legacy field still accepted by the API docs and used by the PHP SDK. */
    signer_ids?: string[];
    /** Camel-case legacy alias used by the quick-start docs. */
    signerIds?: string[];
    message?: string;
    expires_at?: string;
    copy_receivers?: string[];
    /** Field placement entries used when `method` is `collect`. */
    entries?: unknown[];
}

/** Assignment object as returned by the API. */
export interface IAssignment {
    id: string;
    sender_email?: string;
    method: AssignmentMethod;
    expires_at?: string;
    expiration?: string;
    message?: string;
    signers: ISigner[];
    copy_receivers?: string[];
    items?: unknown[];
    summary?: {
        signer_count: number;
        completed_count: number;
        signers: unknown[];
    };
    signing_urls?: Record<string, string>;
}

export type ICreateAssignmentResponse = IAssignment;

export interface IResendEmailResponse {
    is_sent?: boolean;
    document_id?: string;
    signer_id?: string;
}

/** Webhook payload envelope. */
export interface IWebhookPayload {
    id?: number;
    event?: string;
    type?: string;
    message?: string | null;
    payload?: Record<string, unknown> | null;
    origin?: Record<string, unknown> | null;
    subject?: Record<string, unknown>;
    object?: Record<string, unknown>;
    account_id?: string;
    data?: {
        document_uuid?: string;
        document_id?: string;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

/** Known webhook event names. */
export type WebhookEventType =
    | 'document_uploaded'
    | 'document_metadata_ready'
    | 'document_prepared'
    | 'assignment_created'
    | 'document_ready'
    | 'signature_requested'
    | 'signer_created'
    | 'signer_email_verified'
    | 'signer_whatsapp_verified'
    | 'signer_data_confirmed'
    | 'signer_viewed_document'
    | 'signer_signed_document'
    | 'signer_rejected_document'
    | 'user_rejected_document'
    | 'document_processing_failed'
    | 'template_created'
    | 'template_processed'
    | 'template_processing_failed';

/** Document listing item (paginated). */
export interface IDocumentListItem {
    id: string;
    name: string;
    status: DocumentStatus;
    account_id?: string;
    template_id?: string | null;
    created_at: string;
    updated_at?: string;
    is_closed?: boolean;
}

export type IDocumentListResponse = PaginatedResult<IDocumentListItem>;

/** Document upload response. */
export interface IDocumentUploadResponse {
    resource?: string;
    id: string;
    account_id: string;
    template_id: string | null;
    name: string;
    status: DocumentStatus;
    assignment: unknown;
    artifacts: {
        original: string;
        certificated?: string;
        'certificate-page'?: string;
        bundle?: string;
    };
    pages: Array<{
        id: string;
        number: number;
        height: number;
        width: number;
        download_url: string;
    }>;
    created_at: string;
    updated_at: string;
    is_closed: boolean;
    decline_reason: string | null;
    declined_by: string | null;
}

/** Detailed document response. */
export interface IDocumentDetailsResponse {
    resource?: string;
    id: string;
    account_id: string;
    name: string;
    status: DocumentStatus;
    assignment: IAssignment | null;
    download_url?: string;
    download_final_url?: string;
    signing_url?: string;
    artifacts?: {
        original: string;
        certificated?: string;
        'certificate-page'?: string;
        bundle?: string;
    };
    pages: unknown[];
    created_at: string;
    updated_at: string;
    is_closed: boolean;
    decline_reason?: string;
    activities?: Array<IDocumentActivity>;
}

export interface IDocumentActivity {
    id: number;
    event: string;
    message: string;
    origin: string;
    created_at: string;
}

/** Progress summary returned by `documents.getSigningProgress`. */
export interface ISigningProgress {
    signed: number;
    total: number;
    percentage: number;
    pending: number;
}

/** Query parameters accepted by paginated list endpoints. */
export interface IListParams {
    page?: number;
    per_page?: number;
    'per-page'?: number;
    search?: string;
    sort?: string;
    [key: string]: string | number | boolean | undefined;
}

/** Workspace creation payload. */
export interface ICreateWorkspacePayload {
    name: string;
    primary_color?: string;
    secondary_color?: string;
}

export interface IUpdateWorkspacePayload {
    name?: string;
    primary_color?: string | null;
    secondary_color?: string | null;
}

export interface IWorkspaceResponse {
    id: string;
    name: string;
    primary_color?: string;
    secondary_color?: string;
    created_at: string;
}

export interface IWorkspaceListItem {
    id: string;
    name: string;
    is_delete_allowed: boolean;
    roles: string[];
    created_at: string;
}

export type IWorkspaceListResponse = PaginatedResult<IWorkspaceListItem>;

/** Webhook subscription payload. */
export interface IWebhookRegisterPayload {
    url: string;
    email: string;
    events?: WebhookEventType[] | string[];
    is_active?: boolean;
}

export interface IWebhookSubscription {
    id?: string;
    url: string;
    email: string;
    events: string[];
    is_active: boolean;
    created_at?: string;
    updated_at?: string;
}

export interface IWebhookEventTypeInfo {
    id: WebhookEventType | string;
    description: string;
}

export interface IWebhookDispatch {
    id: string;
    event: WebhookEventType | string;
    activity_id: number;
    endpoint: string | null;
    payload: IWebhookPayload | Record<string, unknown> | null;
    delivered: boolean;
    http_status: number | null;
    response_body: string | null;
    error: string | null;
    created_at: number;
    updated_at?: number;
}

export interface IWebhookDispatchListParams extends IListParams {
    event?: WebhookEventType | string;
    delivered?: boolean | 'true' | 'false';
    from?: number;
    to?: number;
}

/** Shape of the high-level `uploadAndRequestSignatures` helper result. */
export interface IUploadAndRequestSignaturesResult {
    document: IDocumentUploadResponse;
    assignment: IAssignment;
    signer_ids: string[];
}

/** Input for a signer in `uploadAndRequestSignatures`. */
export interface IUploadAndRequestSignaturesSigner {
    name: string;
    email: string;
    whatsapp_phone_number?: string;
    /** PHP SDK compatibility alias for `whatsapp_phone_number`. */
    phone?: string;
    metadata?: Record<string, unknown>;
}
