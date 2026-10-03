import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeAshbyJob } from '../adapters/ashby.js';
import { normalizeGreenhouseJob } from '../adapters/greenhouse.js';
import { normalizeLeverJob } from '../adapters/lever.js';
import { normalizeWorkdayPosting, parseRelativePostedOn } from '../adapters/workday.js';
import type { BoardTarget } from '../types.js';
import { decodeHtmlEntities, htmlToText } from '../text.js';

const now = new Date('2026-10-03T12:00:00.000Z');

const greenhouseTarget: BoardTarget = { ats: 'greenhouse', id: 'discord', region: 'us', input: 'discord' };
const leverTarget: BoardTarget = { ats: 'lever', id: 'spotify', region: 'us', input: 'spotify' };
const ashbyTarget: BoardTarget = { ats: 'ashby', id: 'ramp', region: 'us', input: 'ramp' };
const workdayTarget: BoardTarget = {
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

test('decodes Greenhouse double-encoded HTML', () => {
    const decoded = decodeHtmlEntities('&amp;lt;div class=&amp;quot;content-intro&amp;quot;&amp;gt;Hello&amp;lt;/div&amp;gt;');
    assert.equal(decoded, '<div class="content-intro">Hello</div>');
    assert.equal(htmlToText('&lt;h2&gt;Who we are&lt;/h2&gt;'), 'Who we are');
});

test('normalizes a Greenhouse job', () => {
    const job = normalizeGreenhouseJob({
        id: 5231045,
        title: 'Software Engineer',
        absolute_url: 'https://boards.greenhouse.io/discord/jobs/5231045',
        company_name: 'Discord',
        location: { name: 'Remote - United States' },
        departments: [{ name: 'Engineering' }],
        offices: [{ name: 'Remote - United States', location: 'Remote' }],
        content: '&lt;p&gt;Build chat.&lt;/p&gt;',
        first_published: '2026-09-03T13:32:53-04:00',
        updated_at: '2026-09-25T16:45:00-04:00',
        metadata: [{ id: 1, name: 'Salary Range', value: '$180,000 - $220,000', value_type: 'text' }],
    }, greenhouseTarget);

    assert.ok(job);
    assert.equal(job.source, 'greenhouse');
    assert.equal(job.company, 'Discord');
    assert.equal(job.jobId, '5231045');
    assert.equal(job.department, 'Engineering');
    assert.equal(job.workplaceType, 'remote');
    assert.equal(job.descriptionHtml, '<p>Build chat.</p>');
    assert.equal(job.descriptionText, 'Build chat.');
    assert.equal(job.salary?.text, '$180,000 - $220,000');
    assert.equal(job.postedAt, '2026-09-03T17:32:53.000Z');
    assert.ok(job.locations.some((location) => /remote/i.test(location)));
});

test('normalizes a Lever job, including salary and workplace', () => {
    const job = normalizeLeverJob({
        id: 'abc',
        text: 'Backend Engineer',
        categories: {
            commitment: 'Full-time',
            department: 'Engineering',
            team: 'Platform',
            location: 'London',
            allLocations: ['London', 'Remote'],
        },
        workplaceType: 'hybrid',
        createdAt: 1753564800000,
        descriptionPlain: 'Build systems.',
        description: '<p>Build systems.</p>',
        hostedUrl: 'https://jobs.lever.co/spotify/abc',
        applyUrl: 'https://jobs.lever.co/spotify/abc/apply',
        salaryRange: { min: 100000, max: 140000, currency: 'USD', interval: 'per-year-salary' },
        salaryDescriptionPlain: '$100k–$140k',
    }, leverTarget);

    assert.ok(job);
    assert.equal(job.department, 'Engineering / Platform');
    assert.equal(job.workplaceType, 'hybrid');
    assert.equal(job.isRemote, false);
    assert.equal(job.employmentType, 'Full-time');
    assert.equal(job.salary?.min, 100000);
    assert.equal(job.salary?.interval, 'year');
    assert.equal(job.applyUrl, 'https://jobs.lever.co/spotify/abc/apply');
    assert.equal(job.company, 'Spotify');
});

test('normalizes an Ashby job and trims the title', () => {
    const job = normalizeAshbyJob({
        id: '34413f8d-26bf-4bbc-8ade-eb309a0e2245',
        title: ' Security Engineer, Cloud',
        department: 'Engineering',
        team: 'Backend',
        employmentType: 'FullTime',
        location: 'New York, NY (HQ)',
        secondaryLocations: [{ location: 'Remote (US)' }],
        isListed: true,
        isRemote: true,
        workplaceType: 'Hybrid',
        publishedAt: '2026-04-07T17:12:35.753+00:00',
        jobUrl: 'https://jobs.ashbyhq.com/ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245',
        applyUrl: 'https://jobs.ashbyhq.com/ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245/application',
        descriptionPlain: 'About Ramp',
        descriptionHtml: '<h1>About Ramp</h1>',
        compensation: {
            scrapeableCompensationSalarySummary: '$211.4K - $290.6K',
            summaryComponents: [{
                compensationType: 'Salary',
                interval: '1 YEAR',
                currencyCode: 'USD',
                minValue: 211400,
                maxValue: 290600,
            }],
        },
    }, ashbyTarget);

    assert.ok(job);
    assert.equal(job.title, 'Security Engineer, Cloud');
    assert.equal(job.employmentType, 'Full-time');
    assert.equal(job.workplaceType, 'hybrid');
    assert.equal(job.isRemote, true);
    assert.deepEqual(job.locations, ['New York, NY (HQ)', 'Remote (US)']);
    assert.equal(job.salary?.min, 211400);
    assert.equal(job.salary?.currency, 'USD');
    assert.equal(job.salary?.interval, 'year');
    assert.equal(job.salary?.text, '$211.4K - $290.6K');
});

test('drops unlisted Ashby jobs', () => {
    const job = normalizeAshbyJob({
        id: 'hidden',
        title: 'Hidden',
        isListed: false,
        applyUrl: 'https://jobs.ashbyhq.com/ramp/hidden/application',
    }, ashbyTarget);
    assert.equal(job, null);
});

test('normalizes a Workday list row and relative dates', () => {
    assert.equal(parseRelativePostedOn('Posted Yesterday', now), '2026-10-02T00:00:00.000Z');
    assert.equal(parseRelativePostedOn('Posted Today', now), '2026-10-03T00:00:00.000Z');
    assert.equal(parseRelativePostedOn('Posted 20 Days Ago', now), '2026-09-13T00:00:00.000Z');

    const job = normalizeWorkdayPosting({
        title: 'Senior Software Engineer',
        externalPath: '/job/US-CA-Santa-Clara/Senior-Software-Engineer_JR1997186',
        locationsText: '5 Locations',
        postedOn: 'Posted Yesterday',
        bulletFields: ['JR1997186'],
    }, workdayTarget, now);

    assert.ok(job);
    assert.equal(job.jobId, 'JR1997186');
    assert.deepEqual(job.locations, []);
    assert.equal(job.workplaceType, 'unknown');
    assert.equal(job.company, 'Nvidia');
    assert.equal(job.postedAt, '2026-10-02T00:00:00.000Z');
    assert.equal(
        job.applyUrl,
        'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Senior-Software-Engineer_JR1997186',
    );
    assert.match(job.detailUrl ?? '', /\/wday\/cxs\/nvidia\/NVIDIAExternalCareerSite\/job\//);
});
