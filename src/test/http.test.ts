import assert from 'node:assert/strict';
import test from 'node:test';

import { backoffMs, fetchJson, HttpError, parseRetryAfter } from '../http.js';

test('backoff grows and honors a short Retry-After', () => {
    assert.equal(backoffMs(0, undefined, () => 0), 400);
    assert.equal(backoffMs(1, undefined, () => 0), 800);
    assert.equal(backoffMs(2, undefined, () => 0), 1600);
    assert.equal(backoffMs(0, 2, () => 0), 2000);
    assert.equal(backoffMs(0, 120, () => 0), 400);
    assert.equal(parseRetryAfter('3'), 3);
});

test('retries transient failures and does not retry 404', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const fetchImpl: typeof fetch = async () => {
        calls += 1;
        if (calls < 3) throw new TypeError('fetch failed');
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const body = await fetchJson('https://example.com/jobs', {}, {
        fetchImpl,
        sleep: async (ms) => {
            sleeps.push(ms);
        },
        random: () => 0,
        maxAttempts: 4,
    });
    assert.deepEqual(body, { ok: true });
    assert.equal(calls, 3);
    assert.deepEqual(sleeps, [400, 800]);

    let notFoundCalls = 0;
    await assert.rejects(
        () => fetchJson('https://example.com/missing', {}, {
            fetchImpl: async () => {
                notFoundCalls += 1;
                return new Response('missing', { status: 404 });
            },
            sleep: async () => {
                throw new Error('should not sleep');
            },
            maxAttempts: 4,
        }),
        (error: unknown) => error instanceof HttpError && error.status === 404,
    );
    assert.equal(notFoundCalls, 1);
});

test('retries HTTP 429', async () => {
    let calls = 0;
    const body = await fetchJson('https://example.com/limited', {}, {
        fetchImpl: async () => {
            calls += 1;
            if (calls === 1) {
                return new Response('slow down', { status: 429, headers: { 'retry-after': '1' } });
            }
            return new Response('[]', { status: 200 });
        },
        sleep: async () => {},
        random: () => 0,
        maxAttempts: 3,
    });
    assert.deepEqual(body, []);
    assert.equal(calls, 2);
});
