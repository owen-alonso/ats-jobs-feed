import type { BoardTarget, Region, WorkdayLocation } from './types.js';

export type DetectResult =
    | { kind: 'target'; target: BoardTarget }
    | { kind: 'probe'; slug: string; input: string }
    | { kind: 'error'; message: string };

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

export function detectBoard(raw: string): DetectResult {
    const input = raw.trim();
    if (!input) return { kind: 'error', message: 'Empty board value.' };

    const prefixed = input.match(/^(greenhouse|gh|lever|lv|ashby|ab|workday|wd)\s*:\s*(.+)$/i);
    if (prefixed) {
        const token = prefixed[1]!.toLowerCase();
        const rest = prefixed[2]!.trim();
        const ats = token === 'gh' ? 'greenhouse'
            : token === 'lv' ? 'lever'
                : token === 'ab' ? 'ashby'
                    : token === 'wd' ? 'workday'
                        : token;
        if (ats !== 'greenhouse' && ats !== 'lever' && ats !== 'ashby' && ats !== 'workday') {
            return { kind: 'error', message: `Unknown ATS prefix in "${input}".` };
        }
        if (ats === 'workday') {
            const workday = parseWorkday(rest);
            if (!workday) return { kind: 'error', message: `Could not parse a Workday career page from "${rest}".` };
            return { kind: 'target', target: workdayTarget(workday, input) };
        }
        if (looksLikeUrl(rest) || rest.includes('://') || rest.includes('.')) {
            const nested = detectBoard(rest);
            if (nested.kind === 'error') return nested;
            if (nested.kind === 'probe') {
                return { kind: 'target', target: slugTarget(ats, nested.slug, 'us', input) };
            }
            if (nested.target.ats !== ats) {
                return {
                    kind: 'error',
                    message: `"${rest}" looks like ${nested.target.ats}, but the prefix says ${ats}.`,
                };
            }
            return { kind: 'target', target: { ...nested.target, input } };
        }
        const slug = rest.split(/[/?#]/)[0] ?? rest;
        if (!SLUG.test(slug)) return { kind: 'error', message: `Invalid ${ats} board id "${rest}".` };
        return { kind: 'target', target: slugTarget(ats, slug, 'us', input) };
    }

    if (looksLikeUrl(input) || input.includes('/') || input.includes('.')) {
        const url = toUrl(input);
        if (!url) return { kind: 'error', message: `Invalid URL "${input}".` };
        const target = fromUrl(url, input);
        if (!target) return { kind: 'error', message: `Could not detect Greenhouse, Lever, Ashby, or Workday from "${input}".` };
        return { kind: 'target', target };
    }

    if (SLUG.test(input)) return { kind: 'probe', slug: input, input };
    return { kind: 'error', message: `Unrecognized board identifier "${input}".` };
}

export function boardKey(target: BoardTarget): string {
    if (target.ats === 'workday' && target.workday) {
        const workday = target.workday;
        return `workday:${workday.tenant}:${workday.shard}:${workday.site}`.toLowerCase();
    }
    return `${target.ats}:${target.region}:${target.id}`.toLowerCase();
}

function looksLikeUrl(value: string): boolean {
    return /^https?:\/\//i.test(value);
}

function toUrl(value: string): URL | null {
    try {
        return new URL(looksLikeUrl(value) ? value : `https://${value}`);
    } catch {
        return null;
    }
}

function fromUrl(url: URL, input: string): BoardTarget | null {
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host.includes('greenhouse.io')) {
        const id = greenhouseId(url);
        if (!id) return null;
        return slugTarget('greenhouse', id, greenhouseRegion(host), input);
    }
    if (host.includes('lever.co')) {
        const id = leverId(url);
        if (!id) return null;
        return slugTarget('lever', id, host.includes('.eu.lever.co') || host.startsWith('jobs.eu.') ? 'eu' : 'us', input);
    }
    if (host.includes('ashbyhq.com')) {
        const id = ashbyId(url);
        if (!id) return null;
        return slugTarget('ashby', id, 'us', input);
    }
    const workday = parseWorkdayUrl(url);
    if (workday) return workdayTarget(workday, input);
    return null;
}

function greenhouseRegion(host: string): Region {
    return host.includes('.eu.greenhouse.io') || host.startsWith('boards.eu.') ? 'eu' : 'us';
}

function greenhouseId(url: URL): string | null {
    const fromQuery = url.searchParams.get('for') ?? url.searchParams.get('token');
    if (fromQuery && SLUG.test(fromQuery)) return fromQuery;
    const parts = segments(url);
    const boardsIndex = parts.findIndex((part) => part.toLowerCase() === 'boards');
    if (url.hostname.toLowerCase().includes('boards-api') && boardsIndex >= 0) {
        const token = parts[boardsIndex + 1];
        return token && SLUG.test(token) ? token : null;
    }
    if (parts[0]?.toLowerCase() === 'embed') return null;
    const token = parts[0];
    return token && SLUG.test(token) ? token : null;
}

function leverId(url: URL): string | null {
    const parts = segments(url);
    const postings = parts.findIndex((part) => part.toLowerCase() === 'postings');
    if (postings >= 0 && parts[postings + 1] && SLUG.test(parts[postings + 1]!)) return parts[postings + 1]!;
    const site = parts[0];
    return site && SLUG.test(site) ? site : null;
}

function ashbyId(url: URL): string | null {
    const parts = segments(url);
    const board = parts.findIndex((part) => part.toLowerCase() === 'job-board');
    if (board >= 0 && parts[board + 1] && SLUG.test(parts[board + 1]!)) return parts[board + 1]!;
    const slug = parts[0];
    return slug && SLUG.test(slug) ? slug : null;
}

export function parseWorkday(value: string): WorkdayLocation | null {
    const url = toUrl(value.trim());
    if (!url) return null;
    return parseWorkdayUrl(url);
}

function parseWorkdayUrl(url: URL): WorkdayLocation | null {
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const segs = segments(url);
    const jobsHost = host.match(/^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/);
    if (jobsHost) {
        const tenant = jobsHost[1]!;
        const shard = jobsHost[2]!;
        const site = workdaySite(segs);
        if (!site) return null;
        return {
            tenant,
            shard,
            site,
            origin: `${url.protocol}//${url.host}`,
            hostStyle: 'myworkdayjobs',
        };
    }
    const siteWithTenant = host.match(/^([a-z0-9-]+)\.(wd\d+)\.myworkdaysite\.com$/);
    if (siteWithTenant) {
        const tenant = siteWithTenant[1]!;
        const shard = siteWithTenant[2]!;
        const site = myworkdaysiteName(segs, tenant);
        if (!site) return null;
        return {
            tenant,
            shard,
            site,
            origin: `${url.protocol}//${url.host}`,
            hostStyle: 'myworkdaysite',
        };
    }
    const siteHost = host.match(/^(wd\d+)\.myworkdaysite\.com$/);
    if (siteHost) {
        const recruiting = segs.findIndex((part) => part.toLowerCase() === 'recruiting');
        const tenant = recruiting >= 0 ? segs[recruiting + 1] : undefined;
        const site = recruiting >= 0 ? segs[recruiting + 2] : undefined;
        if (!tenant || !site) return null;
        return {
            tenant,
            shard: siteHost[1]!,
            site,
            origin: `${url.protocol}//${url.host}`,
            hostStyle: 'myworkdaysite',
        };
    }
    return null;
}

function myworkdaysiteName(segs: string[], tenant: string): string | null {
    const recruiting = segs.findIndex((part) => part.toLowerCase() === 'recruiting');
    if (recruiting >= 0) {
        const first = segs[recruiting + 1];
        const second = segs[recruiting + 2];
        if (first && second && first.toLowerCase() === tenant.toLowerCase()) return second;
        return first ?? null;
    }
    const site = segs[0];
    if (!site || site.toLowerCase() === 'job') return null;
    return site;
}

function workdaySite(segs: string[]): string | null {
    if (segs.length === 0) return null;
    if (segs[0]?.toLowerCase() === 'wday' && segs[1]?.toLowerCase() === 'cxs') {
        return segs[3] ?? null;
    }
    const site = segs[0];
    if (!site || site.toLowerCase() === 'job' || site.toLowerCase() === 'wday') return null;
    return site;
}

function segments(url: URL): string[] {
    const parts = url.pathname.split('/').filter(Boolean).map((part) => {
        try {
            return decodeURIComponent(part);
        } catch {
            return part;
        }
    });
    if (parts[0] && /^[a-z]{2}-[a-z]{2}$/i.test(parts[0])) return parts.slice(1);
    return parts;
}

function slugTarget(ats: BoardTarget['ats'], id: string, region: Region, input: string): BoardTarget {
    return { ats, id, region, input };
}

function workdayTarget(workday: WorkdayLocation, input: string): BoardTarget {
    return {
        ats: 'workday',
        id: `${workday.tenant}/${workday.site}`,
        region: 'us',
        input,
        workday,
    };
}
