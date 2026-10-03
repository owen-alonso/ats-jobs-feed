import assert from 'node:assert/strict';
import test from 'node:test';

import { compareJobs, dedupeJobs, matchesFilters } from '../filters.js';
import { stateRecordKey, updateSeenState, type SeenState } from '../state.js';
import type { InternalJob } from '../types.js';

const now = new Date('2026-10-03T00:00:00.000Z');

function job(overrides: Partial<InternalJob>): InternalJob {
    return {
        source: 'greenhouse',
        boardId: 'discord',
        company: 'Discord',
        jobId: '1',
        title: 'Software Engineer',
        department: 'Engineering',
        locations: ['London'],
        workplaceType: 'onsite',
        isRemote: false,
        employmentType: 'Full-time',
        salary: null,
        postedAt: '2026-10-01T00:00:00.000Z',
        updatedAt: null,
        applyUrl: 'https://example.com/1',
        descriptionText: 'Build chat products.',
        descriptionHtml: '<p>Build chat products.</p>',
        ...overrides,
    };
}

test('filters keyword, location, department, remote, and recency', () => {
    const roles = [
        job({ jobId: '1', title: 'Software Engineer', locations: ['London'] }),
        job({
            jobId: '2',
            title: 'Designer',
            department: 'Design',
            locations: ['Remote - US'],
            workplaceType: 'remote',
            isRemote: true,
            postedAt: '2026-01-01T00:00:00.000Z',
        }),
    ];

    const keywordHits = roles.filter((role) => matchesFilters(role, { remoteOnly: false, keyword: 'software engineer' }, now));
    assert.deepEqual(keywordHits.map((role) => role.jobId), ['1']);

    const locationHits = roles.filter((role) => matchesFilters(role, { remoteOnly: false, location: 'london' }, now));
    assert.deepEqual(locationHits.map((role) => role.jobId), ['1']);

    const remoteHits = roles.filter((role) => matchesFilters(role, { remoteOnly: true }, now));
    assert.deepEqual(remoteHits.map((role) => role.jobId), ['2']);

    const recent = roles.filter((role) => matchesFilters(role, { remoteOnly: false, postedWithinDays: 10 }, now));
    assert.deepEqual(recent.map((role) => role.jobId), ['1']);

    const hybrid = job({ workplaceType: 'hybrid', isRemote: true, locations: ['New York'] });
    assert.equal(matchesFilters(hybrid, { remoteOnly: true }, now), false);
});

test('dedupes and sorts newest first', () => {
    const older = job({ jobId: 'a', postedAt: '2026-09-01T00:00:00.000Z', descriptionText: 'short' });
    const newer = job({ jobId: 'b', postedAt: '2026-10-01T00:00:00.000Z' });
    const richer = job({ jobId: 'a', postedAt: '2026-09-01T00:00:00.000Z', descriptionText: 'a much longer description' });
    const deduped = dedupeJobs([older, newer, richer]).sort(compareJobs);
    assert.deepEqual(deduped.map((role) => role.jobId), ['b', 'a']);
    assert.equal(deduped[1]?.descriptionText, 'a much longer description');
});

test('only records returned jobs and keeps unseen jobs for the next run', () => {
    const seen: SeenState = { version: 1, jobs: {} };
    const matched = [
        job({ jobId: 'new-1', postedAt: '2026-10-02T00:00:00.000Z' }),
        job({ jobId: 'new-2', postedAt: '2026-10-01T00:00:00.000Z' }),
    ];
    const afterFirst = updateSeenState(seen, matched, [matched[0]!], '2026-10-03T00:00:00.000Z');
    assert.ok(afterFirst.jobs['greenhouse:discord:new-1']);
    assert.equal(afterFirst.jobs['greenhouse:discord:new-2'], undefined);

    const afterSecond = updateSeenState(afterFirst, matched, [matched[1]!], '2026-10-04T00:00:00.000Z');
    assert.equal(afterSecond.jobs['greenhouse:discord:new-1']?.lastSeenAt, '2026-10-04T00:00:00.000Z');
    assert.equal(afterSecond.jobs['greenhouse:discord:new-2']?.firstSeenAt, '2026-10-04T00:00:00.000Z');
});

test('state keys are safe key-value names', () => {
    assert.equal(stateRecordKey('my watch list'), 'seen-my_watch_list');
    assert.equal(stateRecordKey(undefined), 'seen-default');
});
