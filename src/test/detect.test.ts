import assert from 'node:assert/strict';
import test from 'node:test';

import { boardKey, detectBoard } from '../detect.js';

test('detects Greenhouse, Lever, Ashby, and Workday URLs', () => {
    const greenhouse = detectBoard('https://boards.greenhouse.io/discord/jobs/5231045');
    assert.equal(greenhouse.kind, 'target');
    if (greenhouse.kind === 'target') {
        assert.equal(greenhouse.target.ats, 'greenhouse');
        assert.equal(greenhouse.target.id, 'discord');
        assert.equal(greenhouse.target.region, 'us');
    }

    const eu = detectBoard('https://job-boards.eu.greenhouse.io/acme');
    assert.equal(eu.kind, 'target');
    if (eu.kind === 'target') assert.equal(eu.target.region, 'eu');

    const embed = detectBoard('https://boards.greenhouse.io/embed/job_board?for=discord');
    assert.equal(embed.kind, 'target');
    if (embed.kind === 'target') assert.equal(embed.target.id, 'discord');

    const api = detectBoard('https://boards-api.greenhouse.io/v1/boards/discord/jobs?content=true');
    assert.equal(api.kind, 'target');
    if (api.kind === 'target') assert.equal(api.target.id, 'discord');

    const lever = detectBoard('https://jobs.lever.co/spotify/6ed76ce8-4156-4b60-b120-403538bd66cd');
    assert.equal(lever.kind, 'target');
    if (lever.kind === 'target') {
        assert.equal(lever.target.ats, 'lever');
        assert.equal(lever.target.id, 'spotify');
    }

    const leverEu = detectBoard('https://jobs.eu.lever.co/spotify');
    assert.equal(leverEu.kind, 'target');
    if (leverEu.kind === 'target') assert.equal(leverEu.target.region, 'eu');

    const ashby = detectBoard('https://jobs.ashbyhq.com/linear/34413f8d-26bf-4bbc-8ade-eb309a0e2245');
    assert.equal(ashby.kind, 'target');
    if (ashby.kind === 'target') {
        assert.equal(ashby.target.ats, 'ashby');
        assert.equal(ashby.target.id, 'linear');
    }

    const nvidia = detectBoard('https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Role_JR1');
    assert.equal(nvidia.kind, 'target');
    if (nvidia.kind === 'target') {
        assert.equal(nvidia.target.workday?.tenant, 'nvidia');
        assert.equal(nvidia.target.workday?.shard, 'wd5');
        assert.equal(nvidia.target.workday?.site, 'NVIDIAExternalCareerSite');
        assert.equal(nvidia.target.workday?.hostStyle, 'myworkdayjobs');
    }

    const cxs = detectBoard('https://adobe.wd5.myworkdayjobs.com/wday/cxs/adobe/external_experienced/jobs');
    assert.equal(cxs.kind, 'target');
    if (cxs.kind === 'target') {
        assert.equal(cxs.target.workday?.tenant, 'adobe');
        assert.equal(cxs.target.workday?.site, 'external_experienced');
    }

    const site = detectBoard('https://pwc.wd3.myworkdaysite.com/recruiting/pwc/Global_Experienced_Careers');
    const shardOnly = detectBoard('https://wd3.myworkdaysite.com/en-US/recruiting/pwc/Global_Experienced_Careers');
    assert.equal(site.kind, 'target');
    if (site.kind === 'target') {
        assert.equal(site.target.workday?.hostStyle, 'myworkdaysite');
        assert.equal(site.target.workday?.tenant, 'pwc');
        assert.equal(site.target.workday?.shard, 'wd3');
        assert.equal(site.target.workday?.site, 'Global_Experienced_Careers');
    }
    assert.equal(shardOnly.kind, 'target');
    if (shardOnly.kind === 'target') {
        assert.equal(shardOnly.target.workday?.tenant, 'pwc');
        assert.equal(shardOnly.target.workday?.site, 'Global_Experienced_Careers');
    }
});

test('accepts ATS prefixes and bare slugs', () => {
    const forced = detectBoard('gh:discord/jobs/1');
    assert.equal(forced.kind, 'target');
    if (forced.kind === 'target') {
        assert.equal(forced.target.ats, 'greenhouse');
        assert.equal(forced.target.id, 'discord');
    }

    const bare = detectBoard('discord');
    assert.equal(bare.kind, 'probe');

    const mismatch = detectBoard('lever:https://jobs.ashbyhq.com/linear');
    assert.equal(mismatch.kind, 'error');

    const garbage = detectBoard('not a board!!!');
    assert.equal(garbage.kind, 'error');
});

test('board keys collapse duplicate URLs', () => {
    const a = detectBoard('https://boards.greenhouse.io/discord');
    const b = detectBoard('https://job-boards.greenhouse.io/discord/');
    assert.equal(a.kind, 'target');
    assert.equal(b.kind, 'target');
    if (a.kind === 'target' && b.kind === 'target') {
        assert.equal(boardKey(a.target), boardKey(b.target));
    }
});
