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
export type DocumentArtifactName =
    | 'original'
    | 'certificated'
    | 'certificate-page'
    | 'pades'
    | 'bundle';

/** Server-defined signature image category, with known values suggested. */
export type SignatureImageType = 'signature' | 'initial' | AnyString;

/**
 * Any string, while keeping editor autocomplete for the literals it is unioned
 * with.
 *
 * `'Email' | 'Whatsapp' | string` collapses to plain `string`, so the literals
 * vanish from autocomplete. `'Email' | 'Whatsapp' | AnyString` keeps them
 * suggested while staying assignable from any string, so a value the API adds
 * later still type-checks.
 *
 * This deliberately does **not** reject unknown strings — these fields mirror
 * server-controlled vocabularies, so forward-compatibility is worth more than
 * rejecting a typo at compile time.
 */
export type AnyString = string & {};

/** Assignment methods supported by the API. */
export type AssignmentMethod = 'virtual' | 'collect';

/** Verification methods accepted by assignment signer entries. */
export type AssignmentVerificationMethod = 'Email' | 'Whatsapp' | 'DigitalCertificate';

/** Notification methods accepted by assignment signer entries. */
export type AssignmentNotificationMethod = 'Email' | 'Whatsapp';

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
     * Access token. If provided (and `apiKey` is not), the client will send
     * `Authorization: Bearer <token>` instead.
     */
    token?: string;
    /** Default account (workspace) ID applied to account-scoped endpoints. */
    accountId?: string;
    /**
     * Override the API base URL. Defaults to https://api.assinafy.com.br/v1.
     * Must be absolute HTTP(S) without credentials, a query, or a fragment.
     */
    baseUrl?: string;
    /**
     * Secret for an opt-in HMAC-SHA256 convention implemented by your own
     * gateway. The public Assinafy contract does not currently define a
     * platform webhook-signature header or shared-secret exchange.
     */
    webhookSecret?: string;
    /** Request timeout in milliseconds. Defaults to 30_000. */
    timeout?: number;
    /**
     * Max automatic retries on HTTP 429 (rate limit), honoring `Retry-After`.
     * Automatic retries are limited to replay-safe GET, HEAD, OPTIONS, and
     * DELETE requests. `GET /sign` is excluded because it records a signer
     * view. An explicit `Idempotency-Key` opts other requests into SDK replay;
     * callers must confirm server-side deduplication for the target route.
     * Defaults to `2`. Set to `0` to disable retrying.
     */
    maxRetries?: number;
    /** Optional logger. Defaults to a no-op logger. */
    logger?: Logger;
}

/**
 * Payload for creating a signer.
 *
 * The official schema requires only `full_name`. Contact fields are optional;
 * name-only signers cannot receive a signing notification until updated.
 */
export interface ICreateSignerPayload {
    full_name: string;
    email?: string;
    whatsapp_phone_number?: string;
    /** Compatibility alias normalized to `whatsapp_phone_number` before sending. */
    phone?: string;
    /** Compatibility extension. Brazilian CPF; non-digits are stripped. */
    cpf?: string;
    /** Compatibility extension retained for existing integrations. */
    metadata?: Record<string, unknown>;
}

/** Payload for updating a signer. */
export interface IUpdateSignerPayload {
    full_name?: string;
    email?: string;
    whatsapp_phone_number?: string;
    /** Compatibility alias normalized to `whatsapp_phone_number` before sending. */
    phone?: string;
    /** Compatibility extension. Brazilian CPF; non-digits are stripped. */
    cpf?: string;
    /** Official CPF/CNPJ field; non-digits are stripped before sending. */
    government_id?: string;
}

/** Signer object as returned by the API. */
export interface ISigner {
    resource?: string;
    id: string;
    full_name: string;
    email: string | null;
    whatsapp_phone_number?: string | null;
    /**
     * Accepted on create/update payloads but **never echoed back** on any signer
     * response — present here only so response objects stay assignable from inputs.
     */
    cpf?: string | null;
    has_accepted_terms?: boolean;
    /** Only returned by `GET /signers/self`. */
    has_signature?: boolean;
    /** Only returned by `GET /signers/self`. */
    has_initial?: boolean;
    /** Only returned by `GET /signers/self`. */
    is_signature_reusable?: boolean;
    metadata?: Record<string, unknown>;
}

/** Signer profile returned by the signer-code-authenticated `GET /signers/self`. */
export interface ISignerSelf extends ISigner {
    /** Optional for compatibility with deployments that omit this field. */
    has_signature?: boolean;
    /** Optional for compatibility with deployments that omit this field. */
    has_initial?: boolean;
    /** Optional for compatibility with deployments that omit this field. */
    is_signature_reusable?: boolean;
}

/** Official identity fields accepted by the signer `confirm-data` operation. */
export interface IConfirmSignerDataPayload {
    /** Signer's full name as it should appear on the signed document. */
    full_name?: string;
    email?: string;
    /** Government-issued identifier recorded with the signature. */
    government_id?: string;
    /**
     * Accept terms atomically with identity confirmation. Required before
     * opening a DigitalCertificate assignment unless `acceptTerms()` was called.
     */
    has_accepted_terms?: boolean;
}

/**
 * Compatibility input retained for integrations written against older
 * Assinafy deployments. The extra phone property does not belong to the current
 * `confirm-data` request schema.
 */
export interface ILegacyConfirmSignerDataPayload extends IConfirmSignerDataPayload {
    /**
     * @deprecated Compatibility field. Prefer updating the account signer
     * record before starting the signing flow.
     */
    whatsapp_phone_number?: string;
}

/** Official options for uploading the PNG signature image described by OpenAPI. */
export interface IUploadSignatureOptions {
    imageType?: SignatureImageType;
    /** Persist this image so it is reused on future documents. */
    reuse?: boolean;
}

/** Source-compatible options for older deployments that accepted other media types. */
export interface ILegacyUploadSignatureOptions extends IUploadSignatureOptions {
    /**
     * @deprecated The current API contract accepts only `image/png`. Non-PNG
     * values are retained as a compatibility escape hatch.
     */
    contentType?: string;
}

/** Signer returned after create or update. */
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

/** Paginated signer-list response. */
export type ISignerListResponse = PaginatedResult<ISigner>;

/** Signer reference accepted by the assignment endpoints. */
export type SignerReference =
    | string
    | {
          id?: string;
          signer_id?: string;
          verification_method?: AssignmentVerificationMethod;
          notification_methods?: AssignmentNotificationMethod[];
          /**
           * Positive integer controlling signing order. Signers sharing a step
           * sign in parallel; a step is activated (and its signers notified)
           * only after every signer in the previous step has signed. If supplied
           * for one signer it must be supplied for all, forming a contiguous
           * sequence starting at 1.
           */
          step?: number;
      };

/** Payload for creating an assignment. */
export interface ICreateAssignmentPayload {
    method?: AssignmentMethod;
    /**
     * List of signers. Each entry may be a signer id string, or an object with
     * `id` / `signer_id`.
     *
     * The SDK normalises them to the docs-sanctioned `signers: [{ ... }]`
     * shape before sending.
     */
    signers?: SignerReference[];
    /** Compatibility alias rewritten by the SDK to the official `signers` field. */
    signer_ids?: string[];
    /** Camel-case legacy alias used by the quick-start docs. */
    signerIds?: string[];
    message?: string;
    expires_at?: string;
    /**
     * Existing signer IDs to CC on the signature request (not email addresses).
     *
     * This can be plan-dependent. Confirm that returned assignment data retains
     * the IDs before treating a copy as delivered; unsupported plans may accept
     * the field but return an empty array.
     */
    copy_receivers?: string[];
    /** Field placement entries used when `method` is `collect`. */
    entries?: IAssignmentEntry[];
}

/**
 * Field rectangle used by collect assignments. Coordinates are pixels in the
 * API's 150-DPI page image, measured from the upper-left corner.
 */
export interface IDisplaySettings {
    left: number;
    top: number;
    width: number;
    height: number;
    fontSize: number;
    fontFamily?: string;
    backgroundColor?: string;
}

/**
 * Assignment-item rendering metadata. Collect items use
 * {@link IDisplaySettings}; older virtual responses can contain an empty array
 * or another JSON primitive instead.
 */
export type AssignmentDisplaySettings =
    | IDisplaySettings
    | unknown[]
    | string
    | number
    | boolean
    | null;

/**
 * A field-placement entry for a `collect`-method assignment: one page and the
 * per-signer fields positioned on it.
 */
export interface IAssignmentEntry {
    page_id: string;
    fields: Array<{
        signer_id: string;
        field_id: string;
        /** Rectangle and presentation metadata for this field. */
        display_settings?: IDisplaySettings;
    }>;
}

/** Channel descriptor accepted by assignment cost estimation. */
export interface IAssignmentCostSigner {
    verification_method?: AssignmentVerificationMethod;
    notification_methods?: AssignmentNotificationMethod[];
}

/**
 * Official request body for
 * `POST /documents/{documentId}/assignments/estimate-cost`.
 */
export interface IEstimateAssignmentCostPayload {
    method?: AssignmentMethod;
    /** Required for `virtual`; `{}` prices the default Email channel. */
    signers?: IAssignmentCostSigner[];
    /** Required for `collect`; signer descriptors are optional in that mode. */
    entries?: IAssignmentEntry[];
}

/** A signer as embedded inside an assignment (richer than the bare {@link ISigner}). */
export interface IAssignmentSigner extends ISigner {
    /** Only present in account-owner contexts; omitted from signer-code responses. */
    completed?: boolean | null;
    /** Optional because some deployments omit notification history. */
    notification_history?: INotificationHistoryEntry[] | null;
    /** Server-controlled response value; request payloads use the strict request enum. */
    verification_method: AssignmentVerificationMethod | AnyString | null;
    /** Server-controlled response values; request payloads use the strict request enum. */
    notification_methods: Array<AssignmentNotificationMethod | AnyString> | null;
    /** 1-based signing order. See {@link SignerReference.step}. */
    step: number | null;
    notified: boolean | null;
}

/** Per-channel notification delivery history embedded in an assignment signer. */
export interface INotificationHistoryEntry {
    event: string;
    status: 'sent' | 'failed';
    error_code: string | null;
    error_message: string | null;
    sent_at: string | null;
    failed_at: string | null;
}

/** A placed field/item within an assignment (one row per signer × field). */
export interface IAssignmentItem {
    id: string;
    page: {
        id: string;
        number: number;
        height: number;
        width: number;
        download_url: string;
    } | null;
    signer: ISigner;
    field: IFieldDefinition | null;
    /** Collect settings or a documented legacy/non-object wire value. */
    display_settings?: AssignmentDisplaySettings;
    /** Captured field value; its wire type depends on the field definition. */
    value: unknown | null;
    completed?: boolean;
    [key: string]: unknown;
}

/** Assignment object as returned by the API. */
export interface IAssignment {
    resource?: string;
    id: string;
    sender_email?: string;
    method: AssignmentMethod;
    expires_at?: string | null;
    expiration?: string;
    message?: string | null;
    signers: IAssignmentSigner[];
    /** Expanded copy-receiver objects returned by the API. */
    copy_receivers?: Array<Record<string, unknown>>;
    items?: IAssignmentItem[];
    summary?: {
        signer_count: number;
        completed_count: number;
        signers: Array<ISigner & { completed?: boolean }>;
    };
    /** Per-signer signing URLs. Array of `{ signer_id, url }` (not a map). */
    signing_urls?: Array<{ signer_id: string; url: string }>;
}

/** Assignment returned after requesting signatures. */
export type ICreateAssignmentResponse = IAssignment;

/** Acknowledgement returned after resending a signature notification. */
export interface IResendEmailResponse {
    is_sent: boolean;
    document_id: string;
    signer_id: string;
}

/**
 * Credit/document cost estimate returned by `assignments.estimateCost` and
 * `documents.estimateCostFromTemplate`.
 */
export interface ICostEstimate {
    documents: number;
    credits: number;
    needs_extra_document: boolean;
    extra_document_cost: number;
    total_credits: number;
    breakdown: Array<{
        code: string;
        name: string;
        cost: number;
        quantity?: number;
        unit_cost?: number;
    }>;
    document_balance: number;
    credit_balance: number;
    has_sufficient_resources: boolean;
    /** `null` when the operation can proceed; otherwise the documented reason code. */
    blocking_reason:
        | 'PendingPayment'
        | 'InsufficientDocuments'
        | 'InsufficientCredits'
        | null;
    message: string | null;
}

/**
 * Legacy resend-cost payload still returned by some Assinafy environments.
 *
 * This smaller, resend-specific compatibility shape can be returned instead of
 * {@link ICostEstimate}; the SDK models both wire formats.
 */
export interface ILegacyResendCostEstimate {
    total: number;
    breakdown: Array<{ code: string; name: string; cost: number }>;
    credit_balance: number;
    has_sufficient_credits: boolean;
}

/** Cost estimate returned by `assignments.estimateResendCost`. */
export type IResendCostEstimate = ICostEstimate | ILegacyResendCostEstimate;

/** Webhook payload envelope. */
export interface IWebhookPayload {
    /** Internal activity id; use it as an idempotency/deduplication key. */
    id?: number;
    event?: WebhookEventType | AnyString;
    type?: string;
    message?: string | null;
    payload?: Record<string, unknown> | null;
    origin?: Record<string, unknown> | null;
    /** Unix timestamp in seconds. */
    created_at?: number;
    subject?: Record<string, unknown>;
    object?: Record<string, unknown>;
    account_id?: string;
    /** Legacy envelope accepted by the verifier for backwards compatibility. */
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
    status: DocumentStatus | AnyString;
    account_id?: string;
    template_id?: string | null;
    /** Artifact download URLs keyed by name (`original`, `thumbnail`, …). */
    artifacts?: IDocumentUploadResponse['artifacts'];
    /** Public signing-portal URL for the document. */
    signing_url?: string;
    pages?: IDocumentUploadResponse['pages'];
    assignment?: IAssignment | null;
    decline_reason?: string | null;
    declined_by?: ISigner | null;
    /** Tags attached to the document (inline `{ id, name, color }` shape). */
    tags?: IInlineTag[];
    created_at: string;
    updated_at?: string;
    is_closed?: boolean;
}

/** Paginated document-list/search response. */
export type IDocumentListResponse = PaginatedResult<IDocumentListItem>;

/** Query parameters accepted by `documents.list`. */
export interface IDocumentListParams extends IListParams {
    /** Free-text term matched against document fields. */
    search?: string;
    /** Sort expression accepted by the document list endpoint. */
    sort?: string;
    /** Filter by document status, e.g. `pending_signature`. */
    status?: DocumentStatus | AnyString;
    /** Filter by signature method (`virtual` or `collect`). */
    method?: AssignmentMethod;
    /** Comma-separated list of tag IDs (AND semantics). */
    tags?: string;
}

/**
 * Response of `documents.rename` (`PATCH /documents/{documentId}`).
 *
 * The response can omit `pages` and `assignment` and return only
 * `resource`, `id`, `account_id`, `template_id`, `name`, `status`,
 * `artifacts`, `signing_url`, `is_closed`, `decline_reason`, `declined_by`,
 * `tags`, `created_at` and `updated_at`. The two fields are therefore optional:
 * callers get the complete document fields without being promised values that
 * can be absent at runtime.
 */
export type IRenameDocumentResponse = Omit<IDocumentDetailsResponse, 'pages' | 'assignment'> &
    Partial<Pick<IDocumentDetailsResponse, 'pages' | 'assignment'>>;

/** Query parameters accepted by `documents.search`. */
export interface IDocumentSearchParams extends IListParams {
    /** Free-text term matched against the document name. */
    search?: string;
    /** Filter by document status, e.g. `pending_signature`. */
    status?: DocumentStatus | AnyString;
    /** Page number (1-based). */
    page?: number;
    /** Results per page. */
    'per-page'?: number;
}

/** Query parameters accepted by `assignments.list`. */
export interface IAssignmentListParams extends IListParams {
    /** Page number (1-based). */
    page?: number;
    /** Results per page. */
    'per-page'?: number;
}

/** Paginated result of `assignments.list`. */
export type IAssignmentListResponse = PaginatedResult<IAssignment>;

/** Document upload response. */
export interface IDocumentUploadResponse {
    resource?: string;
    id: string;
    account_id: string;
    template_id: string | null;
    name: string;
    status: DocumentStatus | AnyString;
    /** Absent on a fresh upload; an {@link IAssignment} (or `null`) once one exists. */
    assignment?: IAssignment | null;
    artifacts: {
        original: string;
        certificated?: string;
        'certificate-page'?: string;
        pades?: string;
        bundle?: string;
        thumbnail?: string;
    };
    /** Public signing-portal URL for the document (always returned by the upload endpoint). */
    signing_url?: string;
    /** Empty (`[]`) on fresh upload (status `uploaded`); populated once `metadata_ready`. */
    pages: Array<{
        id: string;
        number: number;
        height: number;
        width: number;
        download_url: string;
    }>;
    /** Tags attached to the document (inline `{ id, name, color }` shape). */
    tags?: IInlineTag[];
    created_at: string;
    updated_at: string;
    is_closed: boolean;
    decline_reason: string | null;
    /** The signer who declined, once one has (matches the sibling document response types); `null` otherwise. */
    declined_by: ISigner | null;
}

/** Detailed document response. */
export interface IDocumentDetailsResponse {
    resource?: string;
    id: string;
    account_id: string;
    template_id?: string | null;
    name: string;
    status: DocumentStatus | AnyString;
    assignment: IAssignment | null;
    download_url?: string;
    download_final_url?: string;
    signing_url?: string;
    artifacts?: {
        original: string;
        certificated?: string;
        'certificate-page'?: string;
        pades?: string;
        bundle?: string;
        thumbnail?: string;
    };
    /** Rendered pages. Empty until the document reaches `metadata_ready`. */
    pages: IPage[];
    /** Tags attached to the document (inline `{ id, name, color }` shape). */
    tags?: IInlineTag[];
    created_at: string;
    updated_at: string;
    is_closed: boolean;
    decline_reason?: string | null;
    declined_by?: ISigner | null;
    activities?: Array<IDocumentActivity>;
}

/** One immutable activity event returned by `documents.activities()`. */
export interface IDocumentActivity {
    id: number;
    event: string;
    message: string;
    /** Event-specific payload. Object for most events, occasionally `[]` or `null`. */
    payload?: Record<string, unknown> | unknown[] | null;
    /** Request origin (`ip` / `user-agent`) when available; `null` for system events. */
    origin: { ip?: string; 'user-agent'?: string } | string | null;
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
    /** Compatibility filter used by several list endpoints. */
    search?: string;
    /** Compatibility sort expression retained for existing integrations. */
    sort?: string;
    /** Deployment-specific list filters retained for backwards compatibility. */
    [key: string]: string | number | boolean | undefined;
}

/** Query parameters accepted by `signers.list`. */
export interface ISignerListParams extends IListParams {
    search?: string;
}

/** Query parameters accepted by `templates.list`. */
export interface ITemplateListParams extends IListParams {
    search?: string;
}

/**
 * Workspace creation payload.
 *
 * Colours are persisted and echoed back on the workspace object. Unlike tags —
 * which accept a leading `#` and strip it — the account endpoints require an
 * **exactly 6-character hex string with NO leading `#`** (`'ff0066'`, not
 * `'#ff0066'`); a 7-character `#`-prefixed value is rejected with `400`
 * ("Primary Color" deve conter 6 caracteres).
 */
export interface ICreateWorkspacePayload {
    name: string;
    /** Who signers see as the notification sender (`User` is the API default). */
    notification_sender_type?: NotificationSenderType;
    /** 6-char hex, no leading `#` (e.g. `'ff0066'`). */
    primary_color?: string;
    /** 6-char hex, no leading `#` (e.g. `'0066ff'`). */
    secondary_color?: string;
}

/** Workspace update payload. Colours follow the same 6-char-no-`#` rule as {@link ICreateWorkspacePayload}. */
export interface IUpdateWorkspacePayload {
    name?: string;
    /** Who signers see as the notification sender. */
    notification_sender_type?: NotificationSenderType;
    /** 6-char hex, no leading `#`. */
    primary_color?: string | null;
    /** 6-char hex, no leading `#`. */
    secondary_color?: string | null;
}

/** Workspace returned by account create/get/update operations. */
export interface IWorkspaceResponse {
    resource?: string;
    id: string;
    name: string;
    primary_color?: string | null;
    secondary_color?: string | null;
    notification_sender_type?: NotificationSenderType;
    roles?: string[];
    is_delete_allowed?: boolean;
    created_at: string;
}

/** Notification sender identity accepted by account create/update operations. */
export type NotificationSenderType = 'User' | 'Account';

/** Workspace list item with the caller's roles and deletion permission. */
export interface IWorkspaceListItem extends IWorkspaceResponse {
    is_delete_allowed: boolean;
    roles: string[];
}

/** Paginated workspace-list response. */
export type IWorkspaceListResponse = PaginatedResult<IWorkspaceListItem>;

/** Branding returned by `GET /accounts/{accountId}/theme`. */
export interface IAccountTheme {
    account_name: string;
    /** Six-character hex colour without a leading `#`. */
    primary_color: string;
    secondary_color: string | null;
    /** Absolute URL of the account logo. */
    logo: string;
}

/** Granularity accepted by account/user document-statistics endpoints. */
export type DocumentStatsGranularity = 'monthly' | 'daily';

/** Query for account/user document-statistics endpoints. */
export interface IDocumentStatsParams {
    /** Defaults to `monthly`. */
    granularity?: DocumentStatsGranularity;
    /** Target `YYYY-MM`; required when `granularity` is `daily`. */
    month?: string;
}

/**
 * One zero-filled document-funnel KPI period. Notification counters are not
 * mutually exclusive; verification counters are and sum to
 * `signature_requests`.
 */
export interface IDocumentStatsRow {
    /** `YYYY-MM` for monthly results or `YYYY-MM-DD` for daily results. */
    period: string;
    documents_uploaded: number;
    documents_sent: number;
    signature_requests: number;
    signature_requests_notification_email: number;
    signature_requests_notification_whatsapp: number;
    signature_requests_notification_bypass: number;
    signature_requests_verification_email: number;
    signature_requests_verification_whatsapp: number;
    signature_requests_verification_bypass: number;
    signature_requests_verification_digital_certificate: number;
    signature_requests_viewed: number;
    signature_requests_completed: number;
    documents_certified: number;
    /** @deprecated Older deployment field; use `signature_requests_notification_email`. */
    signature_requests_email?: number;
    /** @deprecated Older deployment field; use `signature_requests_notification_whatsapp`. */
    signature_requests_whatsapp?: number;
}

/** Webhook subscription payload. */
export interface IWebhookRegisterPayload {
    url: string;
    email: string;
    /**
     * Events to subscribe to. Known {@link WebhookEventType} literals are
     * suggested in editors while any server-controlled string is still accepted
     * (via {@link AnyString}), matching the open-enum convention used elsewhere.
     */
    events?: (WebhookEventType | AnyString)[];
    is_active?: boolean;
}

/**
 * Webhook subscription as returned by the API. There is exactly one
 * subscription per workspace, keyed by URL — the API returns
 * `{ events, is_active, url, email, updated_at }` (no `id` / `created_at`).
 */
export interface IWebhookSubscription {
    url: string | null;
    email: string | null;
    events: string[];
    is_active: boolean;
    updated_at?: string | null;
}

/** Event code and human-readable description from the webhook event catalog. */
export interface IWebhookEventTypeInfo {
    id: WebhookEventType | AnyString;
    description: string;
}

/** One webhook delivery attempt returned by the delivery-history endpoints. */
export interface IWebhookDispatch {
    resource?: string;
    id: string;
    event: WebhookEventType | AnyString;
    activity_id: number;
    endpoint: string | null;
    payload: IWebhookPayload | Record<string, unknown> | null;
    delivered: boolean;
    http_status: number | null;
    /** Receiving endpoint body, truncated by Assinafy to 2,000 characters. */
    response_body: string | null;
    error: string | null;
    /** ISO-8601 UTC timestamp, e.g. `'2026-07-15T20:04:36Z'`. */
    created_at: string;
    /** ISO-8601 UTC timestamp, e.g. `'2026-07-15T20:04:36Z'`. */
    updated_at?: string;
}

/** Filters accepted by `webhooks.listDispatches()`. */
export interface IWebhookDispatchListParams extends IListParams {
    event?: WebhookEventType | AnyString;
    delivered?: boolean | 'true' | 'false';
    from?: number;
    to?: number;
}

/** Shape of the high-level `uploadAndRequestSignatures` helper result. */
export interface IUploadAndRequestSignaturesResult {
    /**
     * The document. When `waitForReady` is enabled (the default) this is the
     * fully-processed {@link IDocumentDetailsResponse} re-fetched after the
     * assignment is created — so `status`, `pages` and the embedded `assignment`
     * are current. When `waitForReady` is `false` it is the raw
     * {@link IDocumentUploadResponse} upload response (`status: 'uploaded'`).
     */
    document: IDocumentUploadResponse | IDocumentDetailsResponse;
    assignment: IAssignment;
    signer_ids: string[];
}

/** Input for a signer in `uploadAndRequestSignatures`. */
export interface IUploadAndRequestSignaturesSigner {
    name: string;
    email?: string;
    whatsapp_phone_number?: string;
    /** PHP SDK compatibility alias for `whatsapp_phone_number`. */
    phone?: string;
    /** Brazilian tax ID (CPF). Non-digits are stripped before sending. */
    cpf?: string;
    metadata?: Record<string, unknown>;
}

/** Template role definition. */
export interface ITemplateRole {
    id: string;
    name: string;
    /** Role kind, e.g. `Editor` or `Signer`. */
    assignment_type?: string;
    created_at?: string;
    updated_at?: string;
    [key: string]: unknown;
}

/** Payload for `PUT /accounts/{id}/templates/{template_id}`. Omit a field to leave it unchanged. */
export interface IUpdateTemplatePayload {
    name?: string;
    /** Default invitation message applied to documents created from the template. */
    message?: string;
}

/** Template list item (paginated). */
export interface ITemplateListItem {
    id: string;
    name: string;
    document_name?: string | null;
    message?: string | null;
    status: string;
    /**
     * Rendered pages, each with a `download_url`. Empty until the template
     * finishes processing (`status: 'Ready'`). Both the list and get endpoints
     * return `pages`, so there is no need to fetch a template again just to read
     * them. The URL requires API-key authentication; prefer
     * `templates.downloadPage()` to fetch its bytes.
     */
    pages?: IPage[];
    roles?: ITemplateRole[];
    /** Tags attached to the template itself (inline `{ id, name }` shape). */
    tags?: IInlineTag[];
    created_at: string;
    updated_at?: string;
}

/** Paginated template-list response. */
export type ITemplateListResponse = PaginatedResult<ITemplateListItem>;

/**
 * A rendered page of a document or template.
 *
 * `download_url` is an absolute, API-key-authenticated URL for the page's JPEG
 * rendering — the same bytes returned by `templates.downloadPage()` /
 * `documents.downloadPage()`.
 *
 * @example
 * ```jsonc
 * {
 *   "id": "e5f6a7b8c9d0e1f2a3b4c5d6e7f8",
 *   "number": 1,
 *   "height": 1651,
 *   "width": 1275,
 *   "download_url": "https://api.assinafy.com.br/v1/accounts/…/pages/…/download",
 *   "fields": []
 * }
 * ```
 */
export interface IPage {
    id: string;
    /** 1-based page number. */
    number: number;
    /** Rendered height in pixels (150 DPI). */
    height: number;
    /** Rendered width in pixels (150 DPI). */
    width: number;
    /** Absolute API-key-authenticated URL of the page's JPEG rendering. */
    download_url?: string;
    /** Fields positioned on this page. Present on templates; absent on documents. */
    fields?: ITemplateFieldPlacement[];
}

/** A field placement returned on a rendered template page. */
export interface ITemplateFieldPlacement {
    id?: string;
    field_id?: string;
    role_id?: string;
    label?: string;
    /** Opaque rendering metadata; the current schema intentionally leaves it untyped. */
    display_settings?: unknown;
    created_at?: string;
    updated_at?: string;
}

/** Full template details returned by `templates.get()`. */
export interface ITemplateDetailsResponse {
    resource?: string;
    id: string;
    name: string;
    document_name?: string | null;
    message?: string | null;
    status: string;
    /** Empty until the template finishes processing (`status: 'Ready'`). */
    pages?: IPage[];
    roles?: ITemplateRole[];
    /** Tags attached to the template itself. */
    tags?: IInlineTag[];
    /** Tags auto-applied to every document created from this template. */
    default_document_tags?: IInlineTag[];
    created_at: string;
    updated_at?: string;
    [key: string]: unknown;
}

/** Signer assignment for creating a document from a template. */
export interface ITemplateSigner {
    role_id: string;
    id: string;
    verification_method?: AssignmentVerificationMethod;
    notification_methods?: AssignmentNotificationMethod[];
    /** Positive integer controlling signing order (see {@link SignerReference}). */
    step?: number;
}

/**
 * Role/channel descriptor used only for template cost estimation. The official
 * schema intentionally omits signer `id` and sequential-signing `step`.
 */
export interface ITemplateCostSigner {
    role_id: string;
    verification_method?: AssignmentVerificationMethod;
    notification_methods?: AssignmentNotificationMethod[];
}

/** Options for creating a document from a template. */
export interface ICreateDocumentFromTemplateOptions {
    name?: string;
    message?: string;
    expires_at?: string;
    editor_fields?: Array<{ field_id: string; value: string }>;
    /**
     * Tag names to attach to the new document. Names that don't exist yet are
     * auto-created; the template's default-document-tags are always merged in.
     */
    tags?: string[];
}

/**
 * Item returned by `GET /documents/statuses`.
 *
 * The API uses `code` (the status name); we mirror that field. `description`
 * is optional because responses can omit it.
 */
export interface IDocumentStatusInfo {
    code: DocumentStatus | AnyString;
    deletable: boolean;
    description?: string;
}

/** Item returned by `GET /public/documents/{id}`. */
export interface IPublicDocumentInfo
    extends Partial<Omit<IDocumentDetailsResponse, 'id' | 'name'>> {
    resource?: string;
    id: string;
    name: string;
    /** Optional compatibility response field. */
    page_count?: string | number;
    /** Optional compatibility response field. */
    created_by?: string;
    [key: string]: unknown;
}

/** Result returned by public document signature-hash verification. */
export interface IDocumentVerification {
    hash: string;
    id: string | null;
    status: DocumentStatus | AnyString | null;
    page_count: string | null;
    signer_count: string | null;
    completed_count: number | null;
    completed_at: string | null;
    verified_at: string;
    is_valid: boolean;
    message: string;
}

/** Channel accepted by the `send-token` endpoint. */
export type SendTokenChannel = 'email' | 'whatsapp' | AnyString;

/** Authenticated user profile returned by login and `users.getCurrent()`. */
export interface IAuthenticatedUser {
    id: string;
    name: string;
    email: string;
    telephone: string | null;
    government_id: string | null;
    is_email_verified: boolean;
    has_accepted_terms: boolean;
    /** Compatibility field. */
    is_password_set?: boolean;
    created_at: string;
    to_be_deleted_at: string | null;
}

/**
 * Owner-facing document e-mail preferences returned by
 * `GET /users/self/notification-preferences`. The API always returns all nine
 * keys; `true` means that notification is enabled.
 */
export interface INotificationPreferences {
    DocumentCompleted: boolean;
    SignerDeclined: boolean;
    DocumentCancelled: boolean;
    DocumentAboutToExpire: boolean;
    DocumentExpired: boolean;
    DocumentExpirationReset: boolean;
    DocumentProcessingFailed: boolean;
    TemplateProcessingFailed: boolean;
    SignerWhatsappFailed: boolean;
}

/** Partial preference map accepted by `PUT /users/self/notification-preferences`. */
export type IUpdateNotificationPreferences = Partial<INotificationPreferences>;

/** Login/social-login response containing the bearer token, user, and accounts. */
export interface ILoginResponse {
    access_token: string;
    user: IAuthenticatedUser;
    accounts: Array<{
        id: string;
        name: string;
        roles: string[];
        is_delete_allowed: boolean;
        created_at: string;
    }>;
}

/** Authentication: API key payload returned by `POST /users/api-keys`. */
export interface IApiKeyResponse {
    api_key: string | null;
}

/** Authentication: masked API key returned by `GET /users/api-keys`. */
export type IMaskedApiKeyResponse = { api_key: string | null } | null;

/** Field definition object. */
export interface IFieldDefinition {
    resource?: string;
    id: string;
    name: string;
    type: string;
    regex?: string | null;
    is_pre_defined?: boolean;
    is_active: boolean;
    is_required?: boolean;
    is_standard?: boolean;
    is_read_only?: boolean;
    is_visible?: boolean;
}

/** Payload for creating a field definition. */
export interface ICreateFieldPayload {
    type: string;
    name: string;
    regex?: string | null;
    is_required?: boolean;
    /** Compatibility extension. */
    is_active?: boolean;
}

/** Payload for updating a field definition. */
export interface IUpdateFieldPayload {
    /** Compatibility extension. */
    type?: string;
    name?: string;
    regex?: string | null;
    /** Compatibility extension. */
    is_required?: boolean;
    is_active?: boolean;
}

/** Field type description returned by `GET /field-types`. */
export interface IFieldType {
    type: string;
    name: string;
}

/**
 * @deprecated Compatibility shape previously shared by both field-validation
 * endpoints. Prefer {@link IFieldValidationResponse} for a single value or
 * {@link IFieldValidationMultipleResult} for one item in a batch response.
 */
export interface IFieldValidationResult {
    type?: string;
    field_id?: string;
    success: boolean;
    error_message: string;
}

/** Result returned by `POST /accounts/{id}/fields/{id}/validate`. */
export interface IFieldValidationResponse extends IFieldValidationResult {
    type: string;
    /** The single-value endpoint does not return a field ID. */
    field_id?: never;
}

/** One item returned by `POST /accounts/{id}/fields/validate-multiple`. */
export interface IFieldValidationMultipleResult extends IFieldValidationResult {
    type: string;
    field_id: string;
}

/** Payload entry for `POST /accounts/{id}/fields/validate-multiple`. */
export interface IFieldValidateMultipleEntry {
    field_id: string;
    value: unknown;
}

/** Item returned by `GET /documents/{id}/assignments/{id}/whatsapp-notifications`. */
export interface IWhatsAppNotification {
    sent_at: number;
    header: string;
    body: string;
    buttons: Array<{ text: string; url?: string }>;
    phone_number: string;
    signer_id: string;
}

/** Body entry for the signer-side `POST /documents/{id}/assignments/{id}` sign endpoint. */
export interface ISignFieldEntry {
    itemId: string;
    fieldId: string;
    pageId: string;
    value: string;
}

/**
 * Workspace tag object. Tag names are unique per workspace (case-insensitive)
 * and `color` is an optional 6-char hex string (without the leading `#`).
 */
export interface ITag {
    resource?: string;
    id: string;
    name: string;
    color: string | null;
    created_at: string;
    updated_at: string;
}

/** Acknowledgement returned after detaching a tag from a document. */
export interface IDetachDocumentTagResponse {
    detached: boolean;
}

/** Acknowledgement returned after deleting a workspace tag. */
export interface IDeleteTagResponse {
    deleted: boolean;
}

/** Inline tag shape embedded inside documents/templates (`{ id, name, color? }`). */
export interface IInlineTag {
    id: string;
    name: string;
    color?: string | null;
}

/** Payload for `POST /accounts/{id}/tags`. */
export interface ICreateTagPayload {
    name: string;
    /** 6-char hex color, with or without a leading `#`. Omit/`null` for none. */
    color?: string | null;
}

/** Payload for `PUT /accounts/{id}/tags/{id}`. Omit a field to leave it unchanged. */
export interface IUpdateTagPayload {
    name?: string;
    /** Pass `null` to clear the color; omit to leave unchanged. */
    color?: string | null;
}
