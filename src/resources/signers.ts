import type {
    ICreateSignerPayload,
    ICreateSignerResponse,
    ISigner,
    ISignerListResponse,
    IUpdateSignerPayload,
    IListParams,
} from '../types';
import { ApiError, ValidationError } from '../errors';
import { cleanParams } from '../utils';
import { BaseResource } from './base';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class SignerResource extends BaseResource {
    /**
     * Create a signer in the workspace.
     *
     * `email` is optional — the API also accepts whatsapp-only signers — but at
     * least one of `email` / `whatsapp_phone_number` (or the `phone` alias) is
     * required. When an `email` is supplied the call is idempotent by email:
     * an existing signer with that address is reused instead of duplicated.
     */
    async create(payload: ICreateSignerPayload, accountId?: string): Promise<ICreateSignerResponse> {
        const id = this.accountId(accountId);
        const phone = payload.whatsapp_phone_number ?? payload.phone;
        if (!payload.email && !phone) {
            throw new ValidationError(
                'A signer requires at least an email or a whatsapp_phone_number',
            );
        }
        if (payload.email) this.assertEmail(payload.email);

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
                this.http.post(`/accounts/${id}/signers`, normaliseSignerPayload(payload)),
            );
        } catch (err) {
            if (err instanceof ApiError && err.statusCode === 409 && payload.email) {
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

    /** Get a signer by ID. */
    async get(signerId: string, accountId?: string): Promise<ISigner> {
        const id = this.accountId(accountId);
        const sid = this.requireId(signerId, 'Signer ID');
        return this.call('Failed to fetch signer', () =>
            this.http.get(`/accounts/${id}/signers/${sid}`),
        );
    }

    /** List signers for the workspace (supports `page`, `per_page`, `search`, `sort`). */
    async list(params: IListParams = {}, accountId?: string): Promise<ISignerListResponse> {
        const id = this.accountId(accountId);
        return this.callList<ISigner>('Failed to list signers', () =>
            this.http.get(`/accounts/${id}/signers`, { params: cleanParams(params) }),
        );
    }

    /** Update a signer. Fails if the signer has active assignments. */
    async update(
        signerId: string,
        payload: IUpdateSignerPayload,
        accountId?: string,
    ): Promise<ICreateSignerResponse> {
        const id = this.accountId(accountId);
        const sid = this.requireId(signerId, 'Signer ID');
        return this.call('Failed to update signer', () =>
            this.http.put(`/accounts/${id}/signers/${sid}`, normaliseSignerPayload(payload)),
        );
    }

    /** Delete a signer. */
    async delete(signerId: string, accountId?: string): Promise<void> {
        const id = this.accountId(accountId);
        const sid = this.requireId(signerId, 'Signer ID');
        return this.callVoid('Failed to delete signer', () =>
            this.http.delete(`/accounts/${id}/signers/${sid}`),
        );
    }

    /** Find a signer by email via the API's `search` parameter. Returns `null` if none match. */
    async findByEmail(email: string, accountId?: string): Promise<ISigner | null> {
        this.assertEmail(email);
        try {
            const { data } = await this.list({ search: email, per_page: 100 }, accountId);
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

    if ('metadata' in payload && payload.metadata !== undefined) {
        normalised['metadata'] = payload.metadata;
    }

    return cleanParams(normalised);
}
