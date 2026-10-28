import type {
    IDocumentContract,
    IDocumentContractAmendment,
    IDocumentContractInput,
    IDocumentContractListParams,
    IDocumentContractListResponse,
    IRenewDocumentContractPayload,
    ITerminateDocumentContractPayload,
} from '../types';
import { ValidationError } from '../errors';
import { assertDateTime, assertRecord, cleanListParams } from '../utils';
import { BaseResource } from './base';

const CONTRACT_STATUSES = new Set(['draft', 'active', 'expired', 'terminated']);
const RELATION_TYPES = new Set(['amendment', 'renewal', 'termination']);
const CONTRACT_INPUT_KEYS = [
    'status',
    'counterparty_name',
    'counterparty_taxpayer_id',
    'value',
    'currency',
    'start_date',
    'end_date',
    'auto_renew',
    'renewal_term_months',
    'notice_period_days',
    'owner_id',
    'metadata',
    'external_references',
    'parent_document_id',
    'relation_type',
    'updated_at',
] as const satisfies readonly (keyof IDocumentContractInput)[];

/** Operations for contract terms tracked on workspace documents. */
export class ContractResource extends BaseResource {
    /**
     * List the workspace's tracked contracts (`GET /accounts/{accountId}/contracts`).
     *
     * Results are ordered by `-updated_at` unless `sort` is supplied. Use
     * `updated_at` to catch up after a missed webhook; `ending_within_days` is
     * evaluated by the API in the Brasília calendar day. OAuth tokens need
     * `documents:read`.
     *
     * @param params - Optional filters, expansion, sorting, and pagination.
     * @param params.status - Contract states to match; sent comma-separated.
     * @param params.counterparty - Part of the name, or an exact CPF/CNPJ.
     * @param params.search - Part of the document name.
     * @param params.end_date_from - Earliest end date (`YYYY-MM-DD`).
     * @param params.end_date_to - Latest end date (`YYYY-MM-DD`).
     * @param params.ending_within_days - Inclusive 0–3650 day window from today.
     * @param params.external_system - External-reference system.
     * @param params.external_id - External-reference ID.
     * @param params.sort - `end_date` / `updated_at`, optionally prefixed by `-`.
     * @param params.expand - Pass `document` to embed each document.
     * @param params.page - One-based page number.
     * @param params.per_page - Alias normalized to the API's `per-page` spelling.
     * @param params.per-page - Page size; the deployed API returns at most 50.
     * @param accountId - Override the client's default account ID.
     * @returns Contract rows and pagination metadata:
     * ```jsonc
     * {
     *   "data": [{
     *     "document_id": "66b2f0e1c3a4d5e6f7a8b9c0",
     *     "status": "active",
     *     "counterparty_name": "Example Ltda",
     *     "counterparty_taxpayer_id": "11222333000181",
     *     "value": 120000.5,
     *     "currency": "BRL",
     *     "start_date": "2026-11-01",
     *     "end_date": "2027-10-31",
     *     "auto_renew": true,
     *     "renewal_term_months": 12,
     *     "notice_period_days": 30,
     *     "term": 1,
     *     "owner_id": "d6zqpbyog2v3xvxerwn8la94",
     *     "metadata": { "crm_stage": "won" },
     *     "external_references": [{ "system": "crm", "id": "98765" }],
     *     "created_at": "2026-10-23T12:00:00Z",
     *     "updated_at": "2026-10-23T12:00:00Z"
     *   }],
     *   "meta": { "current_page": 1, "per_page": 20, "total": 1, "last_page": 1 }
     * }
     * ```
     * @throws {ValidationError} If a filter is malformed or no account ID is available.
     * @throws {ApiError} `400` for invalid filters, `401` for invalid credentials,
     * or `500` when the API cannot list contracts.
     *
     * @example
     * ```ts
     * const contracts = await client.contracts.list({
     *   status: ['active'],
     *   ending_within_days: 30,
     *   expand: 'document',
     * });
     * ```
     */
    async list(
        params: IDocumentContractListParams = {},
        accountId?: string,
    ): Promise<IDocumentContractListResponse> {
        const query = buildListParams(params);
        const id = this.accountId(accountId);
        return this.callList('Failed to list contracts', () =>
            this.http.get(`/accounts/${this.pathSegment(id, 'Account ID')}/contracts`, {
                params: query,
            }),
        );
    }

    /**
     * Read a document's contract terms or amendment link
     * (`GET /accounts/{accountId}/documents/{documentId}/contract`).
     *
     * A root contract includes its `amendments`; a document that is itself an
     * instrument returns the `document_contract_amendment` shape. Reads remain
     * available if the workspace's plan no longer includes contract tracking.
     *
     * @param documentId - Contract or amendment document ID.
     * @param accountId - Override the client's default account ID.
     * @returns The root contract or amendment. Root-contract response:
     * ```jsonc
     * {
     *   "resource": "document_contract",
     *   "document_id": "66b2f0e1c3a4d5e6f7a8b9c0",
     *   "status": "active",
     *   "counterparty_name": "Example Ltda",
     *   "counterparty_taxpayer_id": "11222333000181",
     *   "value": 130000,
     *   "currency": "BRL",
     *   "start_date": "2026-11-01",
     *   "end_date": "2028-06-30",
     *   "auto_renew": true,
     *   "renewal_term_months": 12,
     *   "notice_period_days": 30,
     *   "term": 2,
     *   "owner_id": null,
     *   "metadata": null,
     *   "external_references": [],
     *   "amendments": [],
     *   "created_at": "2026-10-23T12:00:00Z",
     *   "updated_at": "2027-05-12T18:20:00Z"
     * }
     * ```
     * @throws {ValidationError} If an ID is missing or invalid.
     * @throws {ApiError} `401` for invalid credentials, `404` when the document
     * has no tracked terms, or `500` on a server error.
     *
     * @example
     * ```ts
     * const contract = await client.contracts.get(document.id);
     * if (contract.resource === 'document_contract_amendment') {
     *   console.log(contract.parent_document_id);
     * }
     * ```
     */
    async get(
        documentId: string,
        accountId?: string,
    ): Promise<IDocumentContract | IDocumentContractAmendment> {
        return this.call('Failed to fetch contract terms', () =>
            this.http.get(this.contractPath(documentId, accountId)),
        );
    }

    /**
     * Create or partially update contract terms
     * (`PUT /accounts/{accountId}/documents/{documentId}/contract`).
     *
     * Only supplied fields are sent. `external_references` replaces the list;
     * `parent_document_id` links this document as an instrument. Pass the
     * `updated_at` previously read to reject concurrent changes with `409`.
     * OAuth tokens need `documents:write`; writes require a contract-tracking plan.
     *
     * @param documentId - Document whose terms or amendment link will change.
     * @param payload - At least one contract attribute.
     * @param payload.status - `draft`, `active`, `expired`, or `terminated`.
     * @param payload.counterparty_name - Counterparty name; null clears it.
     * @param payload.counterparty_taxpayer_id - CPF/CNPJ; null clears it.
     * @param payload.value - Non-negative contract value; null clears it.
     * @param payload.currency - Three-letter currency; null resets as documented.
     * @param payload.start_date - Start date (`YYYY-MM-DD`), or null.
     * @param payload.end_date - End date (`YYYY-MM-DD`), or null.
     * @param payload.auto_renew - Whether the hourly lifecycle starts a new term.
     * @param payload.renewal_term_months - 1–600 months, or null for the default.
     * @param payload.notice_period_days - 0–3650 days, or null to disable notice.
     * @param payload.owner_id - Active workspace member ID, or null.
     * @param payload.metadata - Up to 50 string fields, or null.
     * @param payload.external_references - Up to 20 `{ system, id }` entries; null/[] clears.
     * @param payload.parent_document_id - Parent contract document, or null to unlink pending.
     * @param payload.relation_type - `amendment`, `renewal`, or `termination`.
     * @param payload.updated_at - Optimistic-concurrency timestamp, or null for last-write-wins.
     * @param accountId - Override the client's default account ID.
     * @returns The saved contract or amendment link. Amendment response:
     * ```jsonc
     * {
     *   "resource": "document_contract_amendment",
     *   "document_id": "7c3d1e2f4a5b6c7d8e9f0a1b",
     *   "document_name": "Amendment 1.pdf",
     *   "parent_document_id": "66b2f0e1c3a4d5e6f7a8b9c0",
     *   "relation_type": "amendment",
     *   "number": null,
     *   "status": "pending",
     *   "document_status": "pending_signature",
     *   "apply_error": null,
     *   "currency": "BRL",
     *   "terms": { "value": 130000, "end_date": "2028-06-30" },
     *   "changes": { "value": { "from": 120000.5, "to": 130000 } },
     *   "applied_at": null,
     *   "created_at": "2027-05-10T15:00:00Z",
     *   "updated_at": "2027-05-10T15:00:00Z"
     * }
     * ```
     * @throws {ValidationError} If the payload or an ID is malformed.
     * @throws {ApiError} `400` for invalid terms, `403` when the plan does not
     * include tracking, `404` for an unknown document, `409` after a concurrent
     * change, or `500` on a server error.
     *
     * @example
     * ```ts
     * const contract = await client.contracts.set(document.id, {
     *   status: 'active',
     *   counterparty_name: 'Example Ltda',
     *   value: 120000.50,
     *   currency: 'BRL',
     *   start_date: '2026-11-01',
     *   end_date: '2027-10-31',
     * });
     * ```
     */
    async set(
        documentId: string,
        payload: IDocumentContractInput,
        accountId?: string,
    ): Promise<IDocumentContract | IDocumentContractAmendment> {
        const body = buildContractInput(payload);
        return this.call('Failed to set contract terms', () =>
            this.http.put(this.contractPath(documentId, accountId), body),
        );
    }

    /**
     * Read a document's complete contract family
     * (`GET /accounts/{accountId}/documents/{documentId}/contract/related`).
     *
     * The document may be the root or any linked instrument; the response is
     * always the root contract with every amendment, renewal, and termination.
     *
     * @param documentId - Any document in the contract family.
     * @param accountId - Override the client's default account ID.
     * @returns The root contract and ordered instruments:
     * ```jsonc
     * {
     *   "resource": "document_contract",
     *   "document_id": "66b2f0e1c3a4d5e6f7a8b9c0",
     *   "status": "active",
     *   "counterparty_name": "Example Ltda",
     *   "counterparty_taxpayer_id": "11222333000181",
     *   "value": 130000,
     *   "currency": "BRL",
     *   "start_date": "2026-11-01",
     *   "end_date": "2028-06-30",
     *   "auto_renew": true,
     *   "renewal_term_months": 12,
     *   "notice_period_days": 30,
     *   "term": 2,
     *   "owner_id": null,
     *   "metadata": null,
     *   "external_references": [],
     *   "amendments": [{
     *     "document_id": "7c3d1e2f4a5b6c7d8e9f0a1b",
     *     "document_name": "Amendment 1.pdf",
     *     "parent_document_id": "66b2f0e1c3a4d5e6f7a8b9c0",
     *     "relation_type": "amendment",
     *     "status": "applied",
     *     "number": 1,
     *     "document_status": "certificated",
     *     "apply_error": null,
     *     "currency": "BRL",
     *     "terms": { "value": 130000, "end_date": "2028-06-30" },
     *     "changes": {
     *       "value": { "from": 120000.5, "to": 130000 },
     *       "end_date": { "from": "2027-10-31", "to": "2028-06-30" }
     *     },
     *     "applied_at": "2027-05-12T18:20:00Z",
     *     "created_at": "2027-05-10T15:00:00Z",
     *     "updated_at": "2027-05-12T18:20:00Z"
     *   }],
     *   "created_at": "2026-10-23T12:00:00Z",
     *   "updated_at": "2027-05-12T18:20:00Z"
     * }
     * ```
     * @throws {ValidationError} If an ID is missing or invalid.
     * @throws {ApiError} `401` for invalid credentials, `404` when no contract
     * family exists, or `500` on a server error.
     *
     * @example
     * ```ts
     * const family = await client.contracts.listRelated(amendmentDocument.id);
     * ```
     */
    async listRelated(documentId: string, accountId?: string): Promise<IDocumentContract> {
        return this.call('Failed to fetch related contracts', () =>
            this.http.get(`${this.contractPath(documentId, accountId)}/related`),
        );
    }

    /**
     * Start a contract's next term
     * (`POST /accounts/{accountId}/documents/{documentId}/contract/renew`).
     *
     * Supply the current `term` to make a by-term renewal safe to repeat, or an
     * explicit later `end_date`. `updated_at` rejects concurrent changes. A
     * renewal reopens an expired contract but cannot reopen a terminated one.
     *
     * @param documentId - Root contract document ID.
     * @param payload - Renewal precondition and optional new date/value.
     * @param payload.end_date - Explicit new end date, or null to renew by term.
     * @param payload.value - New value; omitted keeps it and null clears it.
     * @param payload.term - Current term, required by the API when no date is sent.
     * @param payload.updated_at - Optional optimistic-concurrency timestamp.
     * @param accountId - Override the client's default account ID.
     * @returns The renewed contract:
     * ```jsonc
     * {
     *   "resource": "document_contract",
     *   "document_id": "66b2f0e1c3a4d5e6f7a8b9c0",
     *   "status": "active",
     *   "counterparty_name": "Example Ltda",
     *   "counterparty_taxpayer_id": "11222333000181",
     *   "value": 130000,
     *   "currency": "BRL",
     *   "start_date": "2026-11-01",
     *   "end_date": "2029-06-30",
     *   "auto_renew": true,
     *   "renewal_term_months": 12,
     *   "notice_period_days": 30,
     *   "term": 2,
     *   "owner_id": null,
     *   "metadata": null,
     *   "external_references": [],
     *   "created_at": "2026-10-23T12:00:00Z",
     *   "updated_at": "2027-10-15T09:30:00Z"
     * }
     * ```
     * @throws {ValidationError} If the payload or an ID is malformed.
     * @throws {ApiError} `400` for an invalid renewal, `403` when tracking is
     * unavailable, `404` when terms do not exist, `409` after a concurrent
     * change, or `500` on a server error.
     *
     * @example
     * ```ts
     * const renewed = await client.contracts.renew(document.id, {
     *   term: contract.term,
     *   value: 130000,
     *   updated_at: contract.updated_at,
     * });
     * ```
     */
    async renew(
        documentId: string,
        payload: IRenewDocumentContractPayload,
        accountId?: string,
    ): Promise<IDocumentContract> {
        const body = buildRenewPayload(payload);
        return this.call('Failed to renew contract', () =>
            this.http.post(`${this.contractPath(documentId, accountId)}/renew`, body),
        );
    }

    /**
     * Close a contract (`POST /accounts/{accountId}/documents/{documentId}/contract/terminate`).
     *
     * Termination stops lifecycle alerts and records the optional reason in the
     * document activity. Pass `updated_at` to reject concurrent changes.
     *
     * @param documentId - Root contract document ID.
     * @param payload - Optional reason and concurrency precondition.
     * @param payload.reason - Activity reason (up to 500 characters), or null.
     * @param payload.updated_at - Optional optimistic-concurrency timestamp.
     * @param accountId - Override the client's default account ID.
     * @returns The terminated contract:
     * ```jsonc
     * {
     *   "resource": "document_contract",
     *   "document_id": "66b2f0e1c3a4d5e6f7a8b9c0",
     *   "status": "terminated",
     *   "counterparty_name": "Example Ltda",
     *   "counterparty_taxpayer_id": "11222333000181",
     *   "value": 120000.5,
     *   "currency": "BRL",
     *   "start_date": "2026-11-01",
     *   "end_date": "2027-10-31",
     *   "auto_renew": false,
     *   "renewal_term_months": 12,
     *   "notice_period_days": 30,
     *   "term": 1,
     *   "owner_id": null,
     *   "metadata": null,
     *   "external_references": [],
     *   "created_at": "2026-10-23T12:00:00Z",
     *   "updated_at": "2027-03-02T14:00:00Z"
     * }
     * ```
     * @throws {ValidationError} If the payload or an ID is malformed.
     * @throws {ApiError} `400` for invalid state/input, `403` when tracking is
     * unavailable, `404` when terms do not exist, `409` after a concurrent
     * change, or `500` on a server error.
     *
     * @example
     * ```ts
     * await client.contracts.terminate(document.id, {
     *   reason: 'Replaced by a new agreement',
     *   updated_at: contract.updated_at,
     * });
     * ```
     */
    async terminate(
        documentId: string,
        payload: ITerminateDocumentContractPayload = {},
        accountId?: string,
    ): Promise<IDocumentContract> {
        const body = buildTerminatePayload(payload);
        return this.call('Failed to terminate contract', () =>
            this.http.post(`${this.contractPath(documentId, accountId)}/terminate`, body),
        );
    }

    private contractPath(documentId: string, accountId?: string): string {
        const id = this.accountId(accountId);
        return `/accounts/${this.pathSegment(id, 'Account ID')}/documents/${this.pathSegment(documentId, 'Document ID')}/contract`;
    }
}

function buildListParams(params: IDocumentContractListParams): Record<string, unknown> {
    assertRecord(params, 'contract list params');
    const query: Record<string, unknown> = {};
    if (params.status !== undefined) {
        if (
            !Array.isArray(params.status)
            || params.status.length === 0
            || params.status.some((status) => !CONTRACT_STATUSES.has(status))
        ) {
            throw new ValidationError('status must be a non-empty array of contract statuses');
        }
        query['status'] = params.status.join(',');
    }
    for (const key of ['counterparty', 'search', 'external_system', 'external_id'] as const) {
        if (params[key] !== undefined) assertOptionalString(params[key], key);
        if (params[key] !== undefined) query[key] = params[key];
    }
    for (const key of ['end_date_from', 'end_date_to'] as const) {
        if (params[key] !== undefined) assertDate(params[key], key);
        if (params[key] !== undefined) query[key] = params[key];
    }
    if (
        params.ending_within_days !== undefined
        && (!Number.isSafeInteger(params.ending_within_days)
            || params.ending_within_days < 0
            || params.ending_within_days > 3650)
    ) {
        throw new ValidationError('ending_within_days must be an integer from 0 to 3650');
    }
    if (params.ending_within_days !== undefined) {
        query['ending_within_days'] = params.ending_within_days;
    }
    if (
        params.sort !== undefined
        && !['end_date', '-end_date', 'updated_at', '-updated_at'].includes(params.sort)
    ) {
        throw new ValidationError('sort must be end_date or updated_at, optionally prefixed by -');
    }
    if (params.sort !== undefined) query['sort'] = params.sort;
    if (params.expand !== undefined && params.expand !== 'document') {
        throw new ValidationError('expand must be document');
    }
    if (params.expand !== undefined) query['expand'] = params.expand;
    for (const key of ['page', 'per_page', 'per-page'] as const) {
        if (
            params[key] !== undefined
            && (!Number.isSafeInteger(params[key]) || params[key] <= 0)
        ) {
            throw new ValidationError(`${key} must be a positive safe integer`);
        }
        if (params[key] !== undefined) query[key] = params[key];
    }
    return cleanListParams(query);
}

function buildContractInput(payload: IDocumentContractInput): Record<string, unknown> {
    assertRecord(payload, 'contract payload');
    if (payload.status !== undefined && !CONTRACT_STATUSES.has(payload.status)) {
        throw new ValidationError('status must be draft, active, expired, or terminated');
    }
    for (const key of ['counterparty_name', 'counterparty_taxpayer_id', 'owner_id'] as const) {
        assertNullableString(payload[key], key);
    }
    if (typeof payload.counterparty_name === 'string' && [...payload.counterparty_name].length > 255) {
        throw new ValidationError('counterparty_name must be at most 255 characters');
    }
    validateMoney(payload.value, 'value');
    if (
        payload.currency !== undefined
        && payload.currency !== null
        && (typeof payload.currency !== 'string' || !/^[A-Za-z]{3}$/u.test(payload.currency))
    ) {
        throw new ValidationError('currency must be a three-letter code or null');
    }
    for (const key of ['start_date', 'end_date'] as const) {
        if (payload[key] !== undefined && payload[key] !== null) assertDate(payload[key], key);
    }
    if (
        typeof payload.start_date === 'string'
        && typeof payload.end_date === 'string'
        && payload.end_date < payload.start_date
    ) {
        throw new ValidationError('end_date must be on or after start_date');
    }
    if (payload.auto_renew !== undefined && typeof payload.auto_renew !== 'boolean') {
        throw new ValidationError('auto_renew must be a boolean');
    }
    validateNullableInteger(payload.renewal_term_months, 'renewal_term_months', 1, 600);
    validateNullableInteger(payload.notice_period_days, 'notice_period_days', 0, 3650);
    validateMetadata(payload.metadata);
    validateExternalReferences(payload.external_references);
    assertNullableString(payload.parent_document_id, 'parent_document_id');
    if (payload.relation_type !== undefined && !RELATION_TYPES.has(payload.relation_type)) {
        throw new ValidationError('relation_type must be amendment, renewal, or termination');
    }
    if (payload.updated_at !== undefined && payload.updated_at !== null) {
        assertDateTime(payload.updated_at, 'updated_at');
    }

    const body: Record<string, unknown> = {};
    for (const key of CONTRACT_INPUT_KEYS) {
        if (payload[key] !== undefined) body[key] = payload[key];
    }
    if (Array.isArray(payload.external_references)) {
        body['external_references'] = payload.external_references.map(({ system, id }) => ({
            system,
            id,
        }));
    }
    if (Object.keys(body).length === 0) {
        throw new ValidationError('contract payload must include at least one attribute');
    }
    return body;
}

function buildRenewPayload(payload: IRenewDocumentContractPayload): Record<string, unknown> {
    assertRecord(payload, 'contract renewal payload');
    const hasExplicitEndDate = payload.end_date !== undefined
        && payload.end_date !== null
        && payload.end_date !== '';
    if (hasExplicitEndDate) {
        assertDate(payload.end_date, 'end_date');
    }
    validateMoney(payload.value, 'value');
    if (payload.term !== undefined && (!Number.isSafeInteger(payload.term) || payload.term < 1)) {
        throw new ValidationError('term must be a positive safe integer');
    }
    if (!hasExplicitEndDate && payload.term === undefined) {
        throw new ValidationError('term is required when end_date is absent, empty, or null');
    }
    if (payload.updated_at !== undefined) assertDateTime(payload.updated_at, 'updated_at');

    const body: Record<string, unknown> = {};
    for (const key of ['end_date', 'value', 'term', 'updated_at'] as const) {
        if (payload[key] !== undefined) body[key] = payload[key];
    }
    return body;
}

function buildTerminatePayload(payload: ITerminateDocumentContractPayload): Record<string, unknown> {
    assertRecord(payload, 'contract termination payload');
    if (
        payload.reason !== undefined
        && payload.reason !== null
        && (typeof payload.reason !== 'string' || [...payload.reason].length > 500)
    ) {
        throw new ValidationError('reason must be a string of at most 500 characters or null');
    }
    if (payload.updated_at !== undefined) assertDateTime(payload.updated_at, 'updated_at');

    const body: Record<string, unknown> = {};
    if (payload.reason !== undefined) body['reason'] = payload.reason;
    if (payload.updated_at !== undefined) body['updated_at'] = payload.updated_at;
    return body;
}

function assertDate(value: unknown, label: string): asserts value is string {
    if (typeof value !== 'string') throw new ValidationError(`${label} must use YYYY-MM-DD`);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
    if (!match) throw new ValidationError(`${label} must use YYYY-MM-DD`);
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        year < 1000
        || date.getUTCFullYear() !== year
        || date.getUTCMonth() !== month - 1
        || date.getUTCDate() !== day
    ) {
        throw new ValidationError(`${label} must be a valid date from year 1000`);
    }
}

function assertOptionalString(value: unknown, label: string): asserts value is string {
    if (typeof value !== 'string') throw new ValidationError(`${label} must be a string`);
}

function assertNullableString(value: unknown, label: string): void {
    if (value !== undefined && value !== null && typeof value !== 'string') {
        throw new ValidationError(`${label} must be a string or null`);
    }
}

function validateMoney(value: unknown, label: string): void {
    if (
        value !== undefined
        && value !== null
        && (
            typeof value !== 'number'
            || !Number.isFinite(value)
            || value < 0
            || value > 9_999_999_999_999.99
            || Number(value.toFixed(2)) !== value
        )
    ) {
        throw new ValidationError(
            `${label} must be a finite non-negative amount with at most two decimals or null`,
        );
    }
}

function validateNullableInteger(
    value: unknown,
    label: string,
    minimum: number,
    maximum: number,
): void {
    if (
        value !== undefined
        && value !== null
        && (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum)
    ) {
        throw new ValidationError(`${label} must be an integer from ${minimum} to ${maximum}, or null`);
    }
}

function validateMetadata(value: unknown): void {
    if (value === undefined || value === null) return;
    assertRecord(value, 'metadata');
    const entries = Object.entries(value);
    if (entries.length > 50) throw new ValidationError('metadata must have at most 50 keys');
    for (const [key, item] of entries) {
        if (!/^[A-Za-z0-9_.-]{1,40}$/u.test(key)) {
            throw new ValidationError('metadata keys must use 1-40 letters, digits, _, -, or .');
        }
        if (typeof item !== 'string' || [...item].length > 500) {
            throw new ValidationError(`metadata.${key} must be a string of at most 500 characters`);
        }
    }
}

function validateExternalReferences(value: unknown): void {
    if (value === undefined || value === null) return;
    if (!Array.isArray(value) || value.length > 20) {
        throw new ValidationError('external_references must be an array of at most 20 entries or null');
    }
    for (const reference of value) {
        assertRecord(reference, 'external reference');
        if (
            typeof reference['system'] !== 'string'
            || !/^[A-Za-z0-9_.-]{1,64}$/u.test(reference['system'])
        ) {
            throw new ValidationError('external reference system is invalid');
        }
        if (
            typeof reference['id'] !== 'string'
            || reference['id'].length === 0
            || [...reference['id']].length > 255
            || /[\u{10000}-\u{10FFFF}]/u.test(reference['id'])
        ) {
            throw new ValidationError('external reference id must be 1-255 three-byte characters');
        }
    }
}
