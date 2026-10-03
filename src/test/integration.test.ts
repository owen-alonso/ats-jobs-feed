import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchAshby } from '../adapters/ashby.js';
import { fetchGreenhouse } from '../adapters/greenhouse.js';
import { fetchLever } from '../adapters/lever.js';
import { enrichWorkdayJob, fetchWorkday } from '../adapters/workday.js';
import { detectBoard } from '../detect.js';
import { runFeed } from '../run.js';
import type { BoardTarget, JobListing } from '../types.js';

function target(url: string): BoardTarget {
    const detected = detectBoard(url);
    if (detected.kind !== 'target') throw new Error(`expected a board target for ${url}`);
    return detected.target;
}

test('live greenhouse discord', { timeout: 60_000 }, async () => {
    const result = await fetchGreenhouse(target('https://boards.greenhouse.io/discord'));
    assert.equal(result.ok, true, result.error);
    assert.ok(result.jobs.length > 0);
    const job = result.jobs.find((item) => item.descriptionHtml) ?? result.jobs[0]!;
    assert.ok(job);
    assert.equal(job.source, 'greenhouse');
    assert.equal(job.company, 'Discord');
    assert.ok(job.jobId);
    assert.ok(job.title.trim().length > 0);
    assert.ok(job.applyUrl.startsWith('http'));
    assert.ok(job.descriptionHtml);
    assert.equal(job.descriptionHtml.includes('&lt;'), false);
    assert.ok(job.descriptionHtml.includes('<'));
    assert.ok(job.descriptionText);
    assert.equal(job.descriptionText.includes('<p'), false);
});

test('live lever spotify', { timeout: 60_000 }, async () => {
    const result = await fetchLever(target('https://jobs.lever.co/spotify'));
    assert.equal(result.ok, true, result.error);
    assert.ok(result.jobs.length > 0);
    const job = result.jobs[0];
    assert.ok(job);
    assert.equal(job.source, 'lever');
    assert.equal(job.company, 'Spotify');
    assert.ok(job.applyUrl.includes('jobs.lever.co/spotify'));
    assert.ok(['remote', 'hybrid', 'onsite', 'unknown'].includes(job.workplaceType));
    assert.ok(job.descriptionText);
});

test('live ashby linear', { timeout: 60_000 }, async () => {
    const result = await fetchAshby(target('https://jobs.ashbyhq.com/linear'));
    assert.equal(result.ok, true, result.error);
    assert.ok(result.jobs.length > 0);
    const job = result.jobs[0];
    assert.ok(job);
    assert.equal(job.source, 'ashby');
    assert.equal(job.title, job.title.trim());
    assert.ok(job.applyUrl.includes('jobs.ashbyhq.com/linear'));
    assert.ok(job.descriptionHtml?.includes('<'));
    assert.ok(job.descriptionText);
});

test('live workday nvidia list and one detail', { timeout: 60_000 }, async () => {
    const board = target('https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite');
    const result = await fetchWorkday(board, { maxJobs: 5, keyword: '' });
    assert.equal(result.ok, true, result.error);
    assert.ok(result.jobs.length > 0);
    const job = result.jobs[0];
    assert.ok(job);
    assert.equal(job.source, 'workday');
    assert.match(job.jobId, /^[A-Z]{1,6}\d{3,}$/);
    assert.ok(job.applyUrl.includes('myworkdayjobs.com'));
    const detailed = await enrichWorkdayJob(job);
    assert.ok(detailed.descriptionHtml?.includes('<'));
    assert.ok(detailed.descriptionText);
    assert.ok(detailed.postedAt);
});

test('live default input returns a normalized feed', { timeout: 90_000 }, async () => {
    const pushed: JobListing[] = [];
    const summary = await runFeed({ maxResults: 5 }, {
        pushJob: async (job) => {
            pushed.push(job);
            return { accepted: true, stopped: false };
        },
    });
    assert.equal(summary.boardsSucceeded, 3, JSON.stringify(summary.boardsFailed));
    assert.equal(summary.jobsReturned, 5);
    assert.equal(pushed.length, 5);
    for (const job of pushed) {
        assert.ok(['greenhouse', 'lever', 'ashby'].includes(job.source));
        assert.ok(job.company);
        assert.ok(job.jobId);
        assert.ok(job.title);
        assert.ok(Array.isArray(job.locations));
        assert.ok(job.applyUrl.startsWith('http'));
        assert.equal('detailUrl' in job, false);
    }
});
