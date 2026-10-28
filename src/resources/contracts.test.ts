import { describe, expect, test } from 'bun:test';
import type { AxiosInstance } from 'axios';
import { ValidationError } from '../errors';
import type { IDocumentContract } from '../types';
import { ContractResource } from './contracts';

const contract: IDocumentContract = {
    resource: 'document_contract',
    document_id: 'doc-1',
    status: 'active',
    counterparty_name: 'Example Ltda',
    counterparty_taxpayer_id: '11222333000181',
    value: 1000,
    currency: 'BRL',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    auto_renew: true,
    renewal_term_months: 12,
    notice_period_days: 30,
    term: 1,
    owner_id: null,
    metadata: null,
    external_references: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
};

const reply = (data: unknown, headers: Record<string, string> = {}) => ({
    status: 200,
    data: { status: 200, message: '', data },
    headers,
});

describe('ContractResource', () => {
    test('list validates and serializes every documented filter', async () => {
        let url = '';
        let params: unknown;
        const http = {
            get: async (requestUrl: string, config: { params: unknown }) => {
                url = requestUrl;
                params = config.params;
                return reply([contract], {
                    'x-pagination-current-page': '1',
                    'x-pagination-per-page': '20',
                    'x-pagination-total-count': '1',
                    'x-pagination-page-count': '1',
                });
            },
        } as unknown as AxiosInstance;

        const result = await new ContractResource(http, 'acc').list({
            status: ['active', 'expired'],
            counterparty: 'Example',
            search: 'Agreement',
            end_date_from: '2026-01-01',
            end_date_to: '2026-12-31',
            ending_within_days: 30,
            external_system: 'crm',
            external_id: '42',
            sort: '-updated_at',
            expand: 'document',
            page: 1,
            per_page: 20,
            internal_secret: 'do-not-send',
        } as never);

        expect(url).toBe('/accounts/acc/contracts');
        expect(params).toEqual({
            status: 'active,expired',
            counterparty: 'Example',
            search: 'Agreement',
            end_date_from: '2026-01-01',
            end_date_to: '2026-12-31',
            ending_within_days: 30,
            external_system: 'crm',
            external_id: '42',
            sort: '-updated_at',
            expand: 'document',
            page: 1,
            'per-page': 20,
        });
        expect(result).toEqual({
            data: [contract],
            meta: { current_page: 1, per_page: 20, total: 1, last_page: 1 },
        });
    });

    test('list rejects malformed filters before requesting', async () => {
        let calls = 0;
        const contracts = new ContractResource({
            get: async () => {
                calls++;
                return reply([]);
            },
        } as unknown as AxiosInstance, 'acc');
        const badParams = [
            null,
            { status: 'active' },
            { status: [] },
            { status: ['unknown'] },
            { counterparty: 1 },
            { search: false },
            { external_system: [] },
            { external_id: null },
            { end_date_from: '2026-02-30' },
            { end_date_to: '0999-12-31' },
            { ending_within_days: -1 },
            { ending_within_days: 3651 },
            { ending_within_days: 1.5 },
            { sort: 'name' },
            { expand: 'assignment' },
            { page: 0 },
            { per_page: 1.5 },
            { 'per-page': -1 },
        ];

        for (const params of badParams) {
            await expect(contracts.list(params as never)).rejects.toBeInstanceOf(ValidationError);
        }
        expect(calls).toBe(0);
    });

    test('get and listRelated use the account-scoped encoded paths', async () => {
        const urls: string[] = [];
        const http = {
            get: async (url: string) => {
                urls.push(url);
                return reply(contract);
            },
        } as unknown as AxiosInstance;
        const contracts = new ContractResource(http, 'acc/one');

        await expect(contracts.get('doc/two')).resolves.toEqual(contract);
        await expect(contracts.listRelated('doc/two')).resolves.toEqual(contract);
        expect(urls).toEqual([
            '/accounts/acc%2Fone/documents/doc%2Ftwo/contract',
            '/accounts/acc%2Fone/documents/doc%2Ftwo/contract/related',
        ]);
        await expect(contracts.get('..')).rejects.toBeInstanceOf(ValidationError);
        await expect(new ContractResource(http).get('doc')).rejects.toBeInstanceOf(ValidationError);
    });

    test('set projects the exact partial body and preserves clear values', async () => {
        let url = '';
        let body: unknown;
        const http = {
            put: async (requestUrl: string, requestBody: unknown) => {
                url = requestUrl;
                body = requestBody;
                return reply(contract);
            },
        } as unknown as AxiosInstance;
        const result = await new ContractResource(http, 'acc').set('doc', {
            status: 'active',
            counterparty_name: null,
            counterparty_taxpayer_id: '11.222.333/0001-81',
            value: 120000.5,
            currency: 'brl',
            start_date: '2026-11-01',
            end_date: '2027-10-31',
            auto_renew: true,
            renewal_term_months: 12,
            notice_period_days: 30,
            owner_id: null,
            metadata: { crm_stage: 'won' },
            external_references: [{ system: 'crm', id: '98765', internal_secret: true }],
            parent_document_id: null,
            relation_type: 'amendment',
            updated_at: null,
            internal_secret: 'do-not-send',
        } as never);

        expect(url).toBe('/accounts/acc/documents/doc/contract');
        expect(body).toEqual({
            status: 'active',
            counterparty_name: null,
            counterparty_taxpayer_id: '11.222.333/0001-81',
            value: 120000.5,
            currency: 'brl',
            start_date: '2026-11-01',
            end_date: '2027-10-31',
            auto_renew: true,
            renewal_term_months: 12,
            notice_period_days: 30,
            owner_id: null,
            metadata: { crm_stage: 'won' },
            external_references: [{ system: 'crm', id: '98765' }],
            parent_document_id: null,
            relation_type: 'amendment',
            updated_at: null,
        });
        expect(result).toEqual(contract);
    });

    test('set rejects malformed terms before requesting', async () => {
        let calls = 0;
        const contracts = new ContractResource({
            put: async () => {
                calls++;
                return reply(contract);
            },
        } as unknown as AxiosInstance, 'acc');
        const oversizedMetadata = Object.fromEntries(
            Array.from({ length: 51 }, (_, index) => [`key_${index}`, 'value']),
        );
        const longName = 'x'.repeat(256);
        const longMetadata = 'x'.repeat(501);
        const longExternalId = 'x'.repeat(256);
        const badPayloads = [
            null,
            {},
            { internal_secret: true },
            { status: 'unknown' },
            { counterparty_name: 1 },
            { counterparty_name: longName },
            { counterparty_taxpayer_id: false },
            { owner_id: [] },
            { value: -1 },
            { value: 1.001 },
            { value: Number.POSITIVE_INFINITY },
            { value: 10_000_000_000_000 },
            { currency: 'REAL' },
            { start_date: '2026-02-30' },
            { end_date: '999-01-01' },
            { start_date: '2026-02-02', end_date: '2026-02-01' },
            { auto_renew: 'yes' },
            { renewal_term_months: 0 },
            { renewal_term_months: 601 },
            { notice_period_days: -1 },
            { notice_period_days: 3651 },
            { metadata: [] },
            { metadata: oversizedMetadata },
            { metadata: { 'bad key': 'value' } },
            { metadata: { key: 1 } },
            { metadata: { key: longMetadata } },
            { external_references: {} },
            { external_references: Array.from({ length: 21 }, () => ({ system: 'crm', id: '1' })) },
            { external_references: [null] },
            { external_references: [{ system: 'bad key', id: '1' }] },
            { external_references: [{ system: 'crm', id: '' }] },
            { external_references: [{ system: 'crm', id: 'record-😀' }] },
            { external_references: [{ system: 'crm', id: longExternalId }] },
            { parent_document_id: 1 },
            { relation_type: 'replacement' },
            { updated_at: 'yesterday' },
        ];

        for (const payload of badPayloads) {
            await expect(contracts.set('doc', payload as never)).rejects.toBeInstanceOf(
                ValidationError,
            );
        }
        expect(calls).toBe(0);
    });

    test('renew and terminate send only their documented bodies', async () => {
        const calls: Array<{ url: string; body: unknown }> = [];
        const http = {
            post: async (url: string, body: unknown) => {
                calls.push({ url, body });
                return reply(contract);
            },
        } as unknown as AxiosInstance;
        const contracts = new ContractResource(http, 'acc');

        await contracts.renew('doc', {
            end_date: null,
            value: null,
            term: 1,
            updated_at: '2026-01-02T00:00:00Z',
            internal_secret: true,
        } as never);
        await contracts.terminate('doc', {
            reason: null,
            updated_at: '2026-01-02T00:00:00Z',
            internal_secret: true,
        } as never);
        await contracts.renew('doc', { end_date: '2027-12-31' });
        await contracts.terminate('doc');

        expect(calls).toEqual([
            {
                url: '/accounts/acc/documents/doc/contract/renew',
                body: {
                    end_date: null,
                    value: null,
                    term: 1,
                    updated_at: '2026-01-02T00:00:00Z',
                },
            },
            {
                url: '/accounts/acc/documents/doc/contract/terminate',
                body: { reason: null, updated_at: '2026-01-02T00:00:00Z' },
            },
            {
                url: '/accounts/acc/documents/doc/contract/renew',
                body: { end_date: '2027-12-31' },
            },
            { url: '/accounts/acc/documents/doc/contract/terminate', body: {} },
        ]);
    });

    test('renew and terminate reject malformed payloads before requesting', async () => {
        let calls = 0;
        const contracts = new ContractResource({
            post: async () => {
                calls++;
                return reply(contract);
            },
        } as unknown as AxiosInstance, 'acc');
        const badRenewals = [
            null,
            { end_date: '2026-02-30' },
            { value: -1 },
            { term: 0 },
            { term: 1.5 },
            {},
            { end_date: null },
            { end_date: '' },
            { updated_at: 'invalid' },
        ];
        const badTerminations = [
            null,
            { reason: 1 },
            { reason: 'x'.repeat(501) },
            { updated_at: 'invalid' },
        ];
        for (const payload of badRenewals) {
            await expect(contracts.renew('doc', payload as never)).rejects.toBeInstanceOf(
                ValidationError,
            );
        }
        for (const payload of badTerminations) {
            await expect(contracts.terminate('doc', payload as never)).rejects.toBeInstanceOf(
                ValidationError,
            );
        }
        expect(calls).toBe(0);
    });
});
