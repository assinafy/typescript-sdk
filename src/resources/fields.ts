import type {
    ICreateFieldPayload,
    IFieldDefinition,
    IFieldType,
    IFieldValidateMultipleEntry,
    IFieldValidationResult,
    IUpdateFieldPayload,
} from '../types';
import { ValidationError } from '../errors';
import { cleanListParams } from '../utils';
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
    /**
     * Create a field definition (`POST /accounts/{accountId}/fields`).
     *
     * @param payload - The field to create. `type` and `name` are required;
     *   `type` must be one of the platform field types (see
     *   {@link FieldsResource.listTypes}); `regex` may be a string or `null`,
     *   and `is_required` is optional. `is_active` is a tested live extension.
     * @param accountId - Override the client's default account ID.
     * @returns The created field definition. Response shape:
     * ```jsonc
     * {
     *   "resource": "field_definition",
     *   "id": "103ad21709d15eca8c48085b5b8f",
     *   "name": "Employee CPF",
     *   "type": "cpf",
     *   "regex": null,
     *   "is_pre_defined": false,
     *   "is_active": true,
     *   "is_required": true,
     *   "is_standard": false,
     *   "is_read_only": false,
     *   "is_visible": true
     * }
     * ```
     * @throws {ValidationError} If `type` or `name` is missing, or no account
     * ID is available.
     * @throws {ApiError} If the API rejects the request (e.g. `400` invalid type).
     *
     * @example
     * ```ts
     * const field = await client.fields.create({
     *   name: 'Employee CPF',
     *   type: 'cpf',
     *   is_required: true,
     * });
     * ```
     */
    async create(payload: ICreateFieldPayload, accountId?: string): Promise<IFieldDefinition> {
        if (!payload.type) throw new ValidationError('field type is required');
        if (!payload.name) throw new ValidationError('field name is required');
        const id = this.accountId(accountId);
        return this.call('Failed to create field definition', () =>
            this.http.post(`/accounts/${this.pathSegment(id, 'Account ID')}/fields`, payload),
        );
    }

    /**
     * List field definitions for the workspace
     * (`GET /accounts/{accountId}/fields`).
     *
     * @param params - Filters.
     * @param params.include_inactive - Return inactive fields too.
     * @param params.include_standard - Also return the built-in standard fields
     *   (`signature`, `initial`, `signatureDate`).
     * @param accountId - Override the client's default account ID.
     * @returns The field definitions (a plain array — this endpoint is not
     * paginated). Each item:
     * ```jsonc
     * {
     *   "id": "field-example",
     *   "name": "CPF",
     *   "type": "cpf",
     *   "regex": null,
     *   "is_pre_defined": true,
     *   "is_active": true,
     *   "is_required": false,
     *   "is_standard": false,
     *   "is_read_only": false,
     *   "is_visible": true
     * }
     * ```
     * @throws {ValidationError} If no account ID is available.
     * @throws {ApiError} If the API rejects the request.
     *
     * @example
     * ```ts
     * const fields = await client.fields.list({ include_standard: true });
     * ```
     */
    async list(
        params: { include_inactive?: boolean; include_standard?: boolean } = {},
        accountId?: string,
    ): Promise<IFieldDefinition[]> {
        const id = this.accountId(accountId);
        return this.call('Failed to list field definitions', () =>
            this.http.get(`/accounts/${this.pathSegment(id, 'Account ID')}/fields`, {
                params: cleanListParams(params as Record<string, unknown>),
            }),
        );
    }

    /**
     * Get a single field definition by ID
     * (`GET /accounts/{accountId}/fields/{fieldId}`).
     *
     * @param fieldId - The field definition to fetch.
     * @param accountId - Override the client's default account ID.
     * @returns The field definition. Response shape:
     * ```jsonc
     * {
     *   "resource": "field_definition",
     *   "id": "103ad21709d15eca8c48085b5b8f",
     *   "name": "Employee CPF",
     *   "type": "cpf",
     *   "regex": null,
     *   "is_pre_defined": false,
     *   "is_active": true,
     *   "is_required": true,
     *   "is_standard": false,
     *   "is_read_only": false,
     *   "is_visible": true
     * }
     * ```
     * @throws {ValidationError} If `fieldId` or the account ID is missing.
     * @throws {ApiError} `404` if the field does not exist.
     *
     * @example
     * ```ts
     * const field = await client.fields.get('103ad21709d15eca8c48085b5b8f');
     * ```
     */
    async get(fieldId: string, accountId?: string): Promise<IFieldDefinition> {
        const id = this.accountId(accountId);
        const fid = this.requireId(fieldId, 'Field ID');
        return this.call('Failed to fetch field definition', () =>
            this.http.get(
                `/accounts/${this.pathSegment(id, 'Account ID')}/fields/${this.pathSegment(fid, 'Field ID')}`,
            ),
        );
    }

    /**
     * Update a field definition
     * (`PUT /accounts/{accountId}/fields/{fieldId}`).
     *
     * @param fieldId - The field definition to update.
     * @param payload - Official fields are `name`, nullable `regex`, and
     * `is_active`. The sandbox also accepts `type` and `is_required` as live
     * compatibility extensions.
     * @param accountId - Override the client's default account ID.
     * @returns The updated field definition. Response shape:
     * ```jsonc
     * {
     *   "resource": "field_definition",
     *   "id": "103ad21709d15eca8c48085b5b8f",
     *   "name": "Employee CPF (renamed)",
     *   "type": "cpf",
     *   "regex": null,
     *   "is_pre_defined": false,
     *   "is_active": true,
     *   "is_required": true,
     *   "is_standard": false,
     *   "is_read_only": false,
     *   "is_visible": true
     * }
     * ```
     * @throws {ValidationError} If `fieldId` or the account ID is missing.
     * @throws {ApiError} `404` if the field does not exist.
     *
     * @example
     * ```ts
     * await client.fields.update('103ad21709d15eca8c48085b5b8f', {
     *   name: 'Employee CPF (renamed)',
     *   is_active: false,
     * });
     * ```
     */
    async update(
        fieldId: string,
        payload: IUpdateFieldPayload,
        accountId?: string,
    ): Promise<IFieldDefinition> {
        const id = this.accountId(accountId);
        const fid = this.requireId(fieldId, 'Field ID');
        return this.call('Failed to update field definition', () =>
            this.http.put(
                `/accounts/${this.pathSegment(id, 'Account ID')}/fields/${this.pathSegment(fid, 'Field ID')}`,
                payload,
            ),
        );
    }

    /**
     * Delete a field definition
     * (`DELETE /accounts/{accountId}/fields/{fieldId}`).
     *
     * Fails if the field has already been used by an assignment; deactivate it
     * via {@link FieldsResource.update} (`is_active: false`) instead.
     *
     * @param fieldId - The field definition to delete.
     * @param accountId - Override the client's default account ID.
     * @returns Nothing on success.
     * @throws {ValidationError} If `fieldId` or the account ID is missing.
     * @throws {ApiError} If the field is in use or does not exist.
     *
     * @example
     * ```ts
     * await client.fields.delete('103ad21709d15eca8c48085b5b8f');
     * ```
     */
    async delete(fieldId: string, accountId?: string): Promise<void> {
        const id = this.accountId(accountId);
        const fid = this.requireId(fieldId, 'Field ID');
        return this.callVoid('Failed to delete field definition', () =>
            this.http.delete(
                `/accounts/${this.pathSegment(id, 'Account ID')}/fields/${this.pathSegment(fid, 'Field ID')}`,
            ),
        );
    }

    /**
     * Validate a single value against a field definition
     * (`POST /accounts/{accountId}/fields/{fieldId}/validate`).
     *
     * The official operation uses the client's API-key/Bearer authentication.
     * `signerAccessCode` is retained as a deployment-specific, live-unverified
     * compatibility query and is sent as `signer-access-code` when supplied.
     *
     * @param fieldId - The field definition to validate against.
     * @param value - The value to check (validated against the field's
     *   type/regex). Sent as `{ value }` in the request body.
     * @param options - Account override and optional legacy `signerAccessCode`.
     * @returns The validation result. Response shape:
     * ```jsonc
     * {
     *   "type": "text",
     *   "success": true,
     *   "error_message": ""
     * }
     * ```
     * @throws {ValidationError} If `fieldId` or the account ID is missing.
     * @throws {ApiError} If the API rejects the request.
     *
     * @example
     * ```ts
     * const result = await client.fields.validate(
     *   '103ad21709d15eca8c48085b5b8f',
     *   '123.456.789-09',
     * );
     * if (!result.success) console.warn(result.error_message);
     * ```
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
            this.http.post(
                `/accounts/${this.pathSegment(id, 'Account ID')}/fields/${this.pathSegment(fid, 'Field ID')}/validate`,
                { value },
                { params },
            ),
        );
    }

    /**
     * Validate multiple values at once
     * (`POST /accounts/{accountId}/fields/validate-multiple`).
     *
     * The request body is the array of `{ field_id, value }` entries itself
     * (not wrapped in an object). The optional `signerAccessCode` query is the
     * same live-unverified compatibility extension described on
     * {@link FieldsResource.validate}.
     *
     * @param entries - Non-empty array of `{ field_id, value }` pairs.
     * @param options - Account override and optional legacy `signerAccessCode`.
     * @returns One validation result per entry. Response shape:
     * ```jsonc
     * [
     *   { "type": "cpf", "success": true, "error_message": "" },
     *   { "type": "text", "success": true, "error_message": "" }
     * ]
     * ```
     * @throws {ValidationError} If `entries` is empty or the account ID is missing.
     * @throws {ApiError} If the API rejects the request.
     *
     * @example
     * ```ts
     * const results = await client.fields.validateMultiple(
     *   [
     *     { field_id: 'field-cpf', value: '123.456.789-09' },
     *     { field_id: 'field-name', value: 'Example Signer' },
     *   ],
     * );
     * ```
     */
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
            this.http.post(
                `/accounts/${this.pathSegment(id, 'Account ID')}/fields/validate-multiple`,
                entries,
                { params },
            ),
        );
    }

    /**
     * List the platform's supported field types (`GET /field-types`).
     *
     * @returns The catalogue of field types (11 live entries). Response shape:
     * ```jsonc
     * [
     *   { "type": "personName", "name": "Nome" },
     *   { "type": "cpf", "name": "CPF" },
     *   { "type": "email", "name": "E-mail" },
     *   { "type": "text", "name": "Texto" }
     * ]
     * ```
     * @throws {ApiError} If the API rejects the request.
     *
     * @example
     * ```ts
     * const types = await client.fields.listTypes();
     * const cpf = types.find((t) => t.type === 'cpf');
     * ```
     */
    async listTypes(): Promise<IFieldType[]> {
        return this.call('Failed to list field types', () => this.http.get('/field-types'));
    }
}
