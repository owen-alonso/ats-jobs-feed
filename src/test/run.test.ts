import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchWorkday } from '../adapters/workday.js';
import { fatalMessage, RunFailedError, runFeed } from '../run.js';
import { EMPTY_SEEN, type SeenState } from '../state.js';
import type { BoardResult, BoardTarget, JobListing } from '../types.js';

function greenhousePayload() {
    return {
        jobs: [
            {
                id: 2,
                title: 'Newer role',
                absolute_url: 'https://boards.greenhouse.io/discord/jobs/2',
                company_name: 'Discord',
                location: { name: 'Remote' },
                departments: [{ name: 'Engineering' }],
                content: '&lt;p&gt;New role.&lt;/p&gt;',
                first_published: '2026-10-02T00:00:00.000Z',
            },
            {
                id: 1,
                title: 'Older role',
                absolute_url: 'https://boards.greenhouse.io/discord/jobs/1',
                company_name: 'Discord',
                location: { name: 'London' },
                departments: [{ name: 'Engineering' }],
                content: '&lt;p&gt;Old role.&lt;/p&gt;',
                first_published: '2026-09-01T00:00:00.000Z',
            },
        ],
    };
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('a Workday failure does not fail a run that also has a good board', async () => {
    const pushed: JobListing[] = [];
    const summary = await runFeed({
        boards: [
            'https://boards.greenhouse.io/discord',
            'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite',
        ],
        maxResults: 5,
    }, {
        fetchImpl: async (input) => {
            const url = String(input);
            if (url.includes('greenhouse.io')) return jsonResponse(greenhousePayload());
            throw new TypeError('workday down');
        },
        sleep: async () => {},
        random: () => 0,
        maxAttempts: 2,
        pushJob: async (job) => {
            pushed.push(job);
            return { accepted: true, stopped: false };
        },
    });

    assert.equal(summary.boardsSucceeded, 1);
    assert.equal(summary.boardsFailed.length, 1);
    assert.equal(summary.boardsFailed[0]?.ats, 'workday');
    assert.equal(pushed.length, 2);
    assert.equal(pushed[0]?.title, 'Newer role');
    assert.equal(pushed[0]?.descriptionHtml, '<p>New role.</p>');
});

test('a Workday-only failure still finishes successfully', async () => {
    const summary = await runFeed({
        boards: ['https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite'],
        maxResults: 5,
        includeDescriptions: false,
    }, {
        fetchImpl: async () => {
            throw new TypeError('workday down');
        },
        sleep: async () => {},
        random: () => 0,
        maxAttempts: 1,
    });
    assert.equal(summary.jobsReturned, 0);
    assert.equal(summary.boardsFailed[0]?.ats, 'workday');
});

test('fetchWorkday itself never throws', async () => {
    const target: BoardTarget = {
        ats: 'workday',
        id: 'nvidia/NVIDIAExternalCareerSite',
        region: 'us',
        input: 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite',
        workday: {
            tenant: 'nvidia',
            shard: 'wd5',
            site: 'NVIDIAExternalCareerSite',
            origin: 'https://nvidia.wd5.myworkdayjobs.com',
            hostStyle: 'myworkdayjobs',
        },
    };
    const result = await fetchWorkday(target, {
        fetchImpl: async () => {
            throw new TypeError('socket hang up');
        },
        sleep: async () => {},
        maxAttempts: 2,
        maxJobs: 5,
    });
    assert.equal(result.ok, false);
    assert.equal(result.jobs.length, 0);
    assert.match(result.error ?? '', /socket hang up/);
});

test('onlyNew returns the next unseen job and stops at the charge limit', async () => {
    let state: SeenState = EMPTY_SEEN;
    const pushed: string[] = [];
    const deps = {
        fetchImpl: async () => jsonResponse(greenhousePayload()),
        sleep: async () => {},
        random: () => 0,
        maxAttempts: 1,
        loadSeen: async () => state,
        saveSeen: async (_key: string, next: SeenState) => {
            state = next;
        },
        pushJob: async (job: JobListing) => {
            pushed.push(job.jobId);
            return { accepted: true, stopped: false };
        },
    };

    await runFeed({ boards: ['https://boards.greenhouse.io/discord'], maxResults: 1 }, deps);
    assert.deepEqual(pushed, ['2']);

    pushed.length = 0;
    await runFeed({ boards: ['https://boards.greenhouse.io/discord'], maxResults: 5, onlyNew: true }, deps);
    assert.deepEqual(pushed, ['1']);

    pushed.length = 0;
    const limited = await runFeed({
        boards: ['https://boards.greenhouse.io/discord'],
        maxResults: 5,
        resetState: true,
    }, {
        ...deps,
        pushJob: async (job) => {
            pushed.push(job.jobId);
            return { accepted: pushed.length === 1, stopped: true };
        },
    });
    assert.equal(limited.chargeLimitReached, true);
    assert.deepEqual(pushed, ['2']);
});

test('every non-Workday board failing fails the run', async () => {
    await assert.rejects(
        () => runFeed({ boards: ['https://boards.greenhouse.io/missing-board'] }, {
            fetchImpl: async () => jsonResponse({ error: 'missing' }, 404),
            sleep: async () => {},
            maxAttempts: 1,
        }),
        (error: unknown) => error instanceof RunFailedError && /failed/i.test(error.message),
    );
});

test('fatal message ignores a Workday-only miss', () => {
    const failed: BoardResult = {
        ok: false,
        ats: 'workday',
        boardId: 'nvidia/site',
        input: 'nvidia',
        jobs: [],
        error: 'timeout',
        durationMs: 1,
    };
    assert.equal(fatalMessage([failed]), null);
    assert.match(fatalMessage([{ ...failed, ats: 'greenhouse' }]) ?? '', /failed/i);
});
