import type {
    ICreateFieldPayload,
    IFieldDefinition,
    IFieldType,
    IFieldValidateMultipleEntry,
    IFieldValidationResult,
    IUpdateFieldPayload,
} from '../types';
import { ValidationError } from '../errors';
import { cleanParams } from '../utils';
import { BaseResource } from './base';

/**
 * Custom field definitions used by `collect` assignments.
 *
 * Covers the full Field Definition section of the API docs:
 *  - `POST /accounts/{id}/fields`
 *  - `GET /accounts/{id}/fields`
 *  - `GET /accounts/{id}/fields/{id}`
 *  - `PUT /accounts/{id}/fields/{id}`
 *  - `DELETE /accounts/{id}/fields/{id}`
 *  - `POST /accounts/{id}/fields/{id}/validate?signer-access-code=…`
 *  - `POST /accounts/{id}/fields/validate-multiple?signer-access-code=…`
 *  - `GET /field-types`
 */
export class FieldsResource extends BaseResource {
    /** Create a field definition. */
    async create(payload: ICreateFieldPayload, accountId?: string): Promise<IFieldDefinition> {
        if (!payload.type) throw new ValidationError('field type is required');
        if (!payload.name) throw new ValidationError('field name is required');
        const id = this.accountId(accountId);
        return this.call('Failed to create field definition', () =>
            this.http.post(`/accounts/${id}/fields`, payload),
        );
    }

    /**
     * List field definitions for the workspace.
     *
     * @param params.include_inactive  return inactive fields too
     * @param params.include_standard  also return `signature`, `initial`, `signatureDate`
     */
    async list(
        params: { include_inactive?: boolean; include_standard?: boolean } = {},
        accountId?: string,
    ): Promise<IFieldDefinition[]> {
        const id = this.accountId(accountId);
        return this.call('Failed to list field definitions', () =>
            this.http.get(`/accounts/${id}/fields`, {
                params: cleanParams(params as Record<string, unknown>),
            }),
        );
    }

    /** Get a single field definition by ID. */
    async get(fieldId: string, accountId?: string): Promise<IFieldDefinition> {
        const id = this.accountId(accountId);
        const fid = this.requireId(fieldId, 'Field ID');
        return this.call('Failed to fetch field definition', () =>
            this.http.get(`/accounts/${id}/fields/${fid}`),
        );
    }

    /** Update a field definition. */
    async update(
        fieldId: string,
        payload: IUpdateFieldPayload,
        accountId?: string,
    ): Promise<IFieldDefinition> {
        const id = this.accountId(accountId);
        const fid = this.requireId(fieldId, 'Field ID');
        return this.call('Failed to update field definition', () =>
            this.http.put(`/accounts/${id}/fields/${fid}`, payload),
        );
    }

    /** Delete a field definition. Fails if the field has been used. */
    async delete(fieldId: string, accountId?: string): Promise<void> {
        const id = this.accountId(accountId);
        const fid = this.requireId(fieldId, 'Field ID');
        return this.callVoid('Failed to delete field definition', () =>
            this.http.delete(`/accounts/${id}/fields/${fid}`),
        );
    }

    /**
     * Validate a single value against a field definition.
     *
     * Pass `signerAccessCode` for signer-side validation (the typical use case);
     * omit it when the caller is authenticated via API key.
     */
    async validate(
        fieldId: string,
        value: unknown,
        options: { signerAccessCode?: string; accountId?: string } = {},
    ): Promise<IFieldValidationResult> {
        const id = this.accountId(options.accountId);
        const fid = this.requireId(fieldId, 'Field ID');
        const params = options.signerAccessCode
            ? { 'signer-access-code': options.signerAccessCode }
            : undefined;
        return this.call('Failed to validate field value', () =>
            this.http.post(`/accounts/${id}/fields/${fid}/validate`, { value }, { params }),
        );
    }

    /** Validate multiple values at once. */
    async validateMultiple(
        entries: IFieldValidateMultipleEntry[],
        options: { signerAccessCode?: string; accountId?: string } = {},
    ): Promise<IFieldValidationResult[]> {
        if (!Array.isArray(entries) || entries.length === 0) {
            throw new ValidationError('entries must be a non-empty array');
        }
        const id = this.accountId(options.accountId);
        const params = options.signerAccessCode
            ? { 'signer-access-code': options.signerAccessCode }
            : undefined;
        return this.call('Failed to validate field values', () =>
            this.http.post(`/accounts/${id}/fields/validate-multiple`, entries, { params }),
        );
    }

    /** List the platform's supported field types. */
    async listTypes(): Promise<IFieldType[]> {
        return this.call('Failed to list field types', () => this.http.get('/field-types'));
    }
}
