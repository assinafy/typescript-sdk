import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import packageJson from '../../package.json';

export const SDK_USER_AGENT = `Assinafy-Typescript-SDK/v${packageJson.version}`;

const SENSITIVE_QUERY_KEYS = new Set([
    'accesstoken',
    'apikey',
    'password',
    'signeraccesscode',
    'token',
    'verificationcode',
]);
const GUARDED_REDIRECT = Symbol('assinafyGuardedRedirect');
const CREDENTIAL_FREE_TRANSPORTS = new WeakSet<AxiosInstance>();

const guardRedirect: NonNullable<AxiosRequestConfig['beforeRedirect']> = (
    options,
    _response,
    request,
) => {
    if (typeof options['href'] !== 'string') throw new Error('Invalid redirect destination');
    const from = new URL(request.url);
    const to = new URL(options['href']);
    if (from.origin === to.origin) return;

    const method = String(options['method'] ?? request.method).toUpperCase();
    const hasSensitiveQuery = [...from.searchParams.keys()].some((key) =>
        SENSITIVE_QUERY_KEYS.has(key.toLowerCase().replaceAll(/[-_]/gu, '')),
    );
    if (to.protocol !== 'https:' || !['GET', 'HEAD'].includes(method) || hasSensitiveQuery) {
        throw new Error('Unsafe cross-origin redirect blocked');
    }
};

export function applySdkUserAgent(http: AxiosInstance): AxiosInstance {
    const defaults = http.defaults as unknown as {
        headers?: Record<string, unknown>;
    } | undefined;
    if (defaults?.headers) defaults.headers['User-Agent'] = SDK_USER_AGENT;
    return http;
}

export function applySdkTransportDefaults(http: AxiosInstance): AxiosInstance {
    applySdkUserAgent(http);
    if (!http.defaults) return http;
    const current = http.defaults.beforeRedirect as GuardedRedirect | undefined;
    if (!current?.[GUARDED_REDIRECT]) {
        const guarded: GuardedRedirect = (options, response, request) => {
            guardRedirect(options, response, request);
            if (
                current
                && typeof options['href'] === 'string'
                && new URL(request.url).origin === new URL(options['href']).origin
            ) {
                current(options, response, request);
                guardRedirect(options, response, request);
            }
        };
        guarded[GUARDED_REDIRECT] = true;
        http.defaults.beforeRedirect = guarded;
    }
    const sensitiveHeaders = Array.isArray(http.defaults.sensitiveHeaders)
        ? http.defaults.sensitiveHeaders.filter((name): name is string => typeof name === 'string')
        : [];
    for (const required of ['Authorization', 'X-Api-Key']) {
        if (!sensitiveHeaders.some((name) => name.toLowerCase() === required.toLowerCase())) {
            sensitiveHeaders.push(required);
        }
    }
    http.defaults.sensitiveHeaders = sensitiveHeaders;
    return http;
}

type GuardedRedirect = NonNullable<AxiosRequestConfig['beforeRedirect']> & {
    [GUARDED_REDIRECT]?: true;
};

export function withoutCredentials(http: AxiosInstance): AxiosInstance {
    if (CREDENTIAL_FREE_TRANSPORTS.has(http)) return applySdkTransportDefaults(http);
    if (!http.defaults) return applySdkTransportDefaults(http);
    const clone = axios.create(http.defaults);
    stripCredentials(
        (clone.defaults as unknown as { headers: Record<string, unknown> }).headers,
    );
    delete clone.defaults.auth;
    CREDENTIAL_FREE_TRANSPORTS.add(clone);
    return applySdkTransportDefaults(clone);
}

function stripCredentials(headers: Record<string, unknown>): void {
    for (const group of headerGroups(headers)) {
        for (const name of Object.keys(group)) {
            if (isCredentialHeader(name)) delete group[name];
        }
    }
}

function headerGroups(headers: Record<string, unknown>): Record<string, unknown>[] {
    return [
        headers,
        ...Object.values(headers).filter(
            (value): value is Record<string, unknown> =>
                value !== null && typeof value === 'object' && !Array.isArray(value),
        ),
    ];
}

function isCredentialHeader(name: string): boolean {
    const normalized = name.toLowerCase();
    return normalized === 'authorization' || normalized === 'x-api-key';
}
