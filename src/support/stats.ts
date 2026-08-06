import { ValidationError } from '../errors';
import type { IDocumentStatsParams } from '../types';
import { cleanParams } from '../utils';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Validate and serialize the query shared by account and current-user KPI routes. */
export function documentStatsParams(params: IDocumentStatsParams = {}): Record<string, unknown> {
    if (params.granularity === 'daily' && !params.month) {
        throw new ValidationError('month is required when granularity is daily');
    }
    if (params.month !== undefined && !MONTH_RE.test(params.month)) {
        throw new ValidationError('month must use YYYY-MM format');
    }
    return cleanParams({
        granularity: params.granularity,
        month: params.month,
    });
}
