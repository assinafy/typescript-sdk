import type { AxiosInstance } from 'axios';

/** One request captured by {@link recordingHttp}. Test-only; not part of the package. */
export type RecordedCall = { method: string; url: string; body?: unknown; config?: unknown };

/**
 * Axios stand-in that records each request and answers every JSON route with
 * the `{ status, message, data }` envelope, and `…/thumbnail` / `…/download`
 * with bytes. Test-only; not part of the package.
 */
export function recordingHttp(data: unknown = {}): { http: AxiosInstance; calls: RecordedCall[] } {
    const calls: RecordedCall[] = [];
    const record = (method: string) => async (url: string, second?: unknown, third?: unknown) => {
        const bodyless = method === 'GET' || method === 'DELETE';
        calls.push(bodyless ? { method, url, config: second } : { method, url, body: second, config: third });
        return /\/(thumbnail|download)$/u.test(url)
            ? { status: 200, data: Buffer.from('bytes').buffer }
            : { status: 200, data: { status: 200, message: '', data } };
    };
    const http = { get: record('GET'), post: record('POST'), put: record('PUT'), patch: record('PATCH'), delete: record('DELETE') };
    return { http: http as unknown as AxiosInstance, calls };
}
