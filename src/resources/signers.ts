import type {
    ICreateSignerPayload,
    ICreateSignerResponse,
    ISigner,
    ISignerListResponse,
    IUpdateSignerPayload,
    ISignerListParams,
} from '../types';
import { ApiError, ValidationError } from '../errors';
import { cleanListParams, cleanParams, serializeJsonRecord } from '../utils';
import { BaseResource } from './base';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class SignerResource extends BaseResource {
    /**
     * Create a signer in the workspace (`POST /accounts/{accountId}/signers`).
     *
     * `email` and `whatsapp_phone_number` are both optional in the official
     * schema; a name-only signer is valid. When an `email` is supplied the call
     * is idempotent by email:
     * an existing signer with that address is reused instead of duplicated (a
     * duplicate POST is answered by the API with `400 "Um signatário com este
     * e-mail já existe."`, which this method recovers from transparently).
     * A reused signer is returned unchanged; this method does not overwrite its
     * existing name, phone, CPF, or metadata with the create payload.
     *
     * @param payload - The signer to create. The official fields are required
     * `full_name` plus optional `email` and E.164 `whatsapp_phone_number`.
     * `phone`, `cpf`, and `metadata` are compatibility extensions; the SDK
     * normalizes the phone alias and strips non-digits from CPF before sending.
     * @param accountId - Override the client's default account ID.
     * @returns The created (or reused) signer. Note the response **never echoes
     * `cpf` back**, even when one was sent:
     * ```jsonc
     * {
     *   "resource": "signer",
     *   "id": "19e6b92e7895332ed9708535d8c",
     *   "full_name": "Ana Souza",
     *   "email": "ana@example.com",
     *   "whatsapp_phone_number": null,
     *   "has_accepted_terms": false
     * }
     * ```
     * @throws {ValidationError} If the name/contact values are malformed or no
     * account ID is available.
     * @throws {ApiError} If the API rejects the request for a reason other than a
     * recoverable duplicate email.
     *
     * @example
     * ```ts
     * const signer = await client.signers.create({
     *   full_name: 'Ana Souza',
     *   email: 'ana@example.com',
     *   cpf: '390.533.447-05', // sent as '39053344705', never echoed back
     * });
     *
     * // A whatsapp-only signer (no email):
     * await client.signers.create({
     *   full_name: 'Bruno Lima',
     *   whatsapp_phone_number: '+5548999990000',
     * });
     *
     * // Name-only is also valid (but cannot receive a notification yet):
     * await client.signers.create({ full_name: 'Carla Sem Contato' });
     * ```
     */
    async create(payload: ICreateSignerPayload, accountId?: string): Promise<ICreateSignerResponse> {
        const id = this.accountId(accountId);
        validateCreateSignerPayload(payload);

        if (payload.email) {
            const existing = await this.findByEmail(payload.email, id);
            if (existing) {
                this.logger.info('Using existing signer', { email: payload.email });
                return existing;
            }
        }

        this.logger.info('Creating signer', { email: payload.email });
        try {
            return await this.call('Failed to create signer', () =>
                this.http.post(
                    `/accounts/${this.pathSegment(id, 'Account ID')}/signers`,
                    normaliseSignerPayload(payload),
                ),
            );
        } catch (err) {
            // Recover from the lost-race case: another caller created the same
            // signer between the findByEmail above and this POST.
            //
            // This API answers a duplicate email with **400** ("Um signatário com
            // este e-mail já existe."), not the 409 the status name would suggest,
            // so 400 must be caught too — a 409-only guard never fires here. The
            // lookup is what makes this safe: an unrelated 400 (malformed email,
            // say) finds nothing and rethrows below.
            const isDuplicateStatus =
                err instanceof ApiError && (err.statusCode === 409 || err.statusCode === 400);
            if (isDuplicateStatus && payload.email) {
                const duplicate = await this.findByEmail(payload.email, id);
                if (duplicate) {
                    this.logger.info('Signer already exists, using existing signer', {
                        email: payload.email,
                    });
                    return duplicate;
                }
            }
            throw err;
        }
    }

    /**
     * Get a signer by ID (`GET /accounts/{accountId}/signers/{signerId}`).
     *
     * @param signerId - The signer to fetch.
     * @param accountId - Override the client's default account ID.
     * @returns The signer:
     * ```jsonc
     * {
     *   "resource": "signer",
     *   "id": "19e6b92e7895332ed9708535d8c",
     *   "full_name": "Example Signer",
     *   "email": "signer@example.com",
     *   "whatsapp_phone_number": null,
     *   "has_accepted_terms": false
     * }
     * ```
     * @throws {ValidationError} If `signerId` is missing or no account ID is available.
     * @throws {ApiError} `404` if the signer does not exist.
     *
     * @example
     * ```ts
     * const signer = await client.signers.get('19e6b92e7895332ed9708535d8c');
     * ```
     */
    async get(signerId: string, accountId?: string): Promise<ISigner> {
        const id = this.accountId(accountId);
        const sid = this.requireId(signerId, 'Signer ID');
        return this.call('Failed to fetch signer', () =>
            this.http.get(
                `/accounts/${this.pathSegment(id, 'Account ID')}/signers/${this.pathSegment(sid, 'Signer ID')}`,
            ),
        );
    }

    /**
     * List signers for the workspace (`GET /accounts/{accountId}/signers`).
     * Pagination info (if any) is attached in `meta`.
     *
     * @param params - `page`, `per-page`, and `search` (matches `full_name` or
     * `email`). The API maximum is 100 items per page.
     * @param accountId - Override the client's default account ID.
     * @returns The matching signers, with pagination in `meta`. Each item:
     * ```jsonc
     * {
     *   "id": "19e6b92e7895332ed9708535d8c",
     *   "full_name": "Example Signer",
     *   "email": "signer@example.com",
     *   "whatsapp_phone_number": null,
     *   "has_accepted_terms": false
     * }
     * ```
     * @throws {ValidationError} If no account ID is available.
     * @throws {ApiError} If the API rejects the request.
     *
     * @example
     * ```ts
     * const { data, meta } = await client.signers.list({
     *   search: 'ana',
     *   'per-page': 20,
     * });
     * ```
     */
    async list(params: ISignerListParams = {}, accountId?: string): Promise<ISignerListResponse> {
        const id = this.accountId(accountId);
        return this.callList<ISigner>('Failed to list signers', () =>
            this.http.get(`/accounts/${this.pathSegment(id, 'Account ID')}/signers`, {
                params: cleanListParams(params),
            }),
        );
    }

    /**
     * Update a signer (`PUT /accounts/{accountId}/signers/{signerId}`). A name
     * can always be updated. A verified email or WhatsApp channel cannot change
     * while it belongs to an in-flight document; changing an unverified channel
     * rotates its access/verification codes, so resend the notification.
     *
     * @param signerId - The signer to update.
     * @param payload - Fields to change. The official `government_id` field and
     * legacy `cpf` extension are stripped to digits before sending.
     * @param accountId - Override the client's default account ID.
     * @returns The updated signer (as with create, `cpf` is never echoed back):
     * ```jsonc
     * {
     *   "resource": "signer",
     *   "id": "19e6b92e7895332ed9708535d8c",
     *   "full_name": "Ana Souza Lima",
     *   "email": "ana@example.com",
     *   "whatsapp_phone_number": null,
     *   "has_accepted_terms": false
     * }
     * ```
     * @throws {ValidationError} If `signerId` is missing or no account ID is available.
     * @throws {ApiError} `400` if a verified contact channel is in use by an
     * in-flight document; `404` if the signer does not exist.
     *
     * @example
     * ```ts
     * await client.signers.update('19e6b92e7895332ed9708535d8c', {
     *   full_name: 'Ana Souza Lima',
     *   government_id: '390.533.447-05',
     * });
     * ```
     */
    async update(
        signerId: string,
        payload: IUpdateSignerPayload,
        accountId?: string,
    ): Promise<ICreateSignerResponse> {
        const id = this.accountId(accountId);
        const sid = this.requireId(signerId, 'Signer ID');
        validateUpdateSignerPayload(payload);
        return this.call('Failed to update signer', () =>
            this.http.put(
                `/accounts/${this.pathSegment(id, 'Account ID')}/signers/${this.pathSegment(sid, 'Signer ID')}`,
                normaliseSignerPayload(payload),
            ),
        );
    }

    /**
     * Delete a signer (`DELETE /accounts/{accountId}/signers/{signerId}`).
     *
     * @param signerId - The signer to delete.
     * @param accountId - Override the client's default account ID.
     * @returns Nothing on success (resolves to `void`).
     * @throws {ValidationError} If `signerId` is missing or no account ID is available.
     * @throws {ApiError} `404` if the signer does not exist; `400`/`409` if it
     * still has active assignments.
     *
     * @example
     * ```ts
     * await client.signers.delete('19e6b92e7895332ed9708535d8c');
     * ```
     */
    async delete(signerId: string, accountId?: string): Promise<void> {
        const id = this.accountId(accountId);
        const sid = this.requireId(signerId, 'Signer ID');
        return this.callVoid('Failed to delete signer', () =>
            this.http.delete(
                `/accounts/${this.pathSegment(id, 'Account ID')}/signers/${this.pathSegment(sid, 'Signer ID')}`,
            ),
        );
    }

    /**
     * Find a signer by exact email
     * (`GET /accounts/{accountId}/signers?search={email}`), using the API's
     * `search` filter to narrow the page first. Returns `null` if none match.
     *
     * `search` is a substring match across signer fields, so the result is
     * re-filtered here for an exact, case-insensitive email match.
     *
     * Page size is pinned to the API's maximum of 100.
     * An exact address realistically matches one signer, but a search term that
     * matched more than 100 could in principle miss one — the API exposes no
     * exact-email filter to rule that out.
     *
     * A `404` from the underlying list is treated as "no match" and mapped to
     * `null`; any other {@link ApiError} propagates.
     *
     * @param email - Exact email address to look for.
     * @param accountId - Override the client's default account ID.
     * @returns The matching {@link ISigner}, or `null` if none match. A hit
     * looks like:
     * ```jsonc
     * {
     *   "id": "19e6b92e7895332ed9708535d8c",
     *   "full_name": "Ana Souza",
     *   "email": "ana@example.com",
     *   "whatsapp_phone_number": null,
     *   "has_accepted_terms": false
     * }
     * ```
     * @throws {ValidationError} If `email` is not a valid address.
     * @throws {ApiError} If the list request fails with a status other than 404.
     *
     * @example
     * ```ts
     * const signer = await client.signers.findByEmail('ana@example.com');
     * if (signer) console.log(signer.id);
     * ```
     */
    async findByEmail(email: string, accountId?: string): Promise<ISigner | null> {
        this.assertEmail(email);
        try {
            const { data } = await this.list({ search: email, 'per-page': 100 }, accountId);
            const lower = email.toLowerCase();
            return data.find((s) => (s.email ?? '').toLowerCase() === lower) ?? null;
        } catch (err) {
            if (err instanceof ApiError && err.statusCode === 404) {
                return null;
            }
            throw err;
        }
    }

    private assertEmail(email: string): void {
        if (!email || !EMAIL_RE.test(email)) {
            throw new ValidationError('Invalid email address', { email });
        }
    }
}

/** Validate a create payload without performing a request. */
export function validateCreateSignerPayload(payload: ICreateSignerPayload): void {
    if (!payload || typeof payload !== 'object') {
        throw new ValidationError('Signer payload is required');
    }
    if (typeof payload.full_name !== 'string' || !payload.full_name.trim()) {
        throw new ValidationError('full_name is required');
    }
    const phone = payload.whatsapp_phone_number ?? payload.phone;
    if (
        payload.email !== undefined &&
        (typeof payload.email !== 'string' || !EMAIL_RE.test(payload.email))
    ) {
        throw new ValidationError('Invalid email address', { email: payload.email });
    }
    validateOptionalPhone(phone);
    if (payload.metadata !== undefined) serializeJsonRecord(payload.metadata, 'metadata');
    validateOptionalDigits(payload.cpf, 'cpf');
}

/** Validate the fields supplied to a partial signer update. */
export function validateUpdateSignerPayload(payload: IUpdateSignerPayload): void {
    if (!payload || typeof payload !== 'object') {
        throw new ValidationError('Signer update payload is required');
    }

    const hasSupportedField = [
        payload.full_name,
        payload.email,
        payload.whatsapp_phone_number,
        payload.phone,
        payload.cpf,
        payload.government_id,
    ].some((value) => value !== undefined);
    if (!hasSupportedField) {
        throw new ValidationError('Signer update must include at least one field');
    }
    if (
        payload.full_name !== undefined &&
        (typeof payload.full_name !== 'string' || !payload.full_name.trim())
    ) {
        throw new ValidationError('full_name cannot be empty');
    }
    if (
        payload.email !== undefined &&
        (typeof payload.email !== 'string' || !EMAIL_RE.test(payload.email))
    ) {
        throw new ValidationError('Invalid email address', { email: payload.email });
    }

    const phone = payload.whatsapp_phone_number ?? payload.phone;
    validateOptionalPhone(phone);
    validateOptionalDigits(payload.cpf, 'cpf');
    validateOptionalDigits(payload.government_id, 'government_id');
}

function validateOptionalDigits(value: string | undefined, field: 'cpf' | 'government_id'): void {
    if (value === undefined) return;
    if (typeof value !== 'string' || value.replace(/\D/g, '').length === 0) {
        throw new ValidationError(`${field} must contain digits`);
    }
}

function validateOptionalPhone(value: string | undefined): void {
    if (value === undefined) return;
    if (typeof value !== 'string' || !/^\+[1-9]\d{1,14}$/u.test(value)) {
        throw new ValidationError('whatsapp_phone_number must use E.164 format');
    }
}

function normaliseSignerPayload(
    payload: ICreateSignerPayload | IUpdateSignerPayload,
): Record<string, unknown> {
    const normalised: Record<string, unknown> = {
        full_name: payload.full_name,
        email: payload.email,
        whatsapp_phone_number: payload.whatsapp_phone_number ?? payload.phone,
    };

    if (payload.cpf) {
        normalised['cpf'] = payload.cpf.replace(/\D/g, '');
    }

    if ('government_id' in payload && payload.government_id) {
        normalised['government_id'] = payload.government_id.replace(/\D/g, '');
    }

    if ('metadata' in payload && payload.metadata !== undefined) {
        normalised['metadata'] = payload.metadata;
    }

    return cleanParams(normalised);
}
