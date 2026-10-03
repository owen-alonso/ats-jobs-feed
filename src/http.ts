const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export const USER_AGENT = 'ats-jobs-feed/1.0 (+https://apify.com)';

export class HttpError extends Error {
    readonly status: number;
    readonly url: string;

    constructor(status: number, url: string, bodySnippet: string) {
        super(`HTTP ${status} for ${url}${bodySnippet ? `: ${bodySnippet}` : ''}`);
        this.name = 'HttpError';
        this.status = status;
        this.url = url;
    }
}

export interface FetchJsonOptions {
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
    timeoutMs?: number;
    maxAttempts?: number;
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
    if (!value) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return seconds;
    const date = Date.parse(value);
    if (Number.isNaN(date)) return undefined;
    return Math.max(0, (date - now) / 1000);
}

export function backoffMs(attempt: number, retryAfterSeconds?: number, rand: () => number = Math.random): number {
    if (
        retryAfterSeconds != null
        && Number.isFinite(retryAfterSeconds)
        && retryAfterSeconds >= 0
        && retryAfterSeconds <= 15
    ) {
        return Math.round(retryAfterSeconds * 1000);
    }
    const base = 400 * 2 ** attempt;
    return base + Math.floor(rand() * 250);
}

function isTransient(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;
    if (error instanceof TypeError) return true;
    return /network|fetch failed|econnreset|etimedout|socket/i.test(error.message);
}

export function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

export async function fetchJson(url: string, init: RequestInit = {}, options: FetchJsonOptions = {}): Promise<unknown> {
    const fetchImpl = options.fetchImpl ?? fetch;
    const sleep = options.sleep ?? delay;
    const maxAttempts = options.maxAttempts ?? 4;
    const timeoutMs = options.timeoutMs ?? 20_000;
    const random = options.random ?? Math.random;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
            const response = await fetchImpl(url, {
                ...init,
                headers: {
                    accept: 'application/json',
                    'user-agent': USER_AGENT,
                    ...(init.body ? { 'content-type': 'application/json' } : {}),
                    ...plainHeaders(init.headers),
                },
                signal: AbortSignal.timeout(timeoutMs),
            });
            const text = await response.text();
            if (!response.ok) {
                const error = new HttpError(response.status, url, text.slice(0, 180).replace(/\s+/g, ' '));
                if (RETRYABLE_STATUS.has(response.status) && attempt < maxAttempts - 1) {
                    lastError = error;
                    const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
                    await sleep(backoffMs(attempt, retryAfter, random));
                    continue;
                }
                throw error;
            }
            if (!text) return null;
            try {
                return JSON.parse(text) as unknown;
            } catch {
                throw new Error(`Invalid JSON from ${url}`);
            }
        } catch (error) {
            if (error instanceof HttpError) throw error;
            lastError = error;
            if (attempt >= maxAttempts - 1 || !isTransient(error)) throw error;
            await sleep(backoffMs(attempt, undefined, random));
        }
    }

    throw lastError instanceof Error ? lastError : new Error(`Request failed for ${url}`);
}

function plainHeaders(headers: HeadersInit | undefined): Record<string, string> {
    if (!headers) return {};
    if (headers instanceof Headers) {
        const out: Record<string, string> = {};
        headers.forEach((value, key) => {
            out[key] = value;
        });
        return out;
    }
    if (Array.isArray(headers)) return Object.fromEntries(headers);
    return { ...headers };
}
