import { ashbyListUrl } from './adapters/ashby.js';
import { greenhouseListUrl } from './adapters/greenhouse.js';
import { leverListUrl } from './adapters/lever.js';
import { boardKey, detectBoard } from './detect.js';
import { fetchJson, type FetchJsonOptions } from './http.js';
import { mapPool } from './pool.js';
import type { BoardResult, BoardTarget, Logger } from './types.js';
import { silentLog } from './types.js';
import { errorMessage } from './text.js';

export async function resolveBoards(
    raws: string[],
    options: FetchJsonOptions & { log?: Logger; concurrency?: number } = {},
): Promise<{ targets: BoardTarget[]; failures: BoardResult[] }> {
    const log = options.log ?? silentLog;
    const resolved = await mapPool(raws, options.concurrency ?? 4, async (raw) => resolveOne(raw, options, log));
    const targets: BoardTarget[] = [];
    const failures: BoardResult[] = [];
    const seen = new Set<string>();
    for (const item of resolved) {
        if (item.failure) failures.push(item.failure);
        if (!item.target) continue;
        const key = boardKey(item.target);
        if (seen.has(key)) {
            log.info(`Skipping duplicate board ${item.target.input}.`);
            continue;
        }
        seen.add(key);
        targets.push(item.target);
    }
    return { targets, failures };
}

async function resolveOne(
    raw: string,
    options: FetchJsonOptions,
    log: Logger,
): Promise<{ target?: BoardTarget; failure?: BoardResult }> {
    const detected = detectBoard(raw);
    if (detected.kind === 'error') return { failure: failureResult(raw, 'unknown', detected.message) };
    if (detected.kind === 'target') return { target: detected.target };
    try {
        const target = await probeSlug(detected.slug, detected.input, options);
        if (!target) {
            return { failure: failureResult(raw, 'unknown', `No public Greenhouse, Lever, or Ashby board found for "${detected.slug}".`) };
        }
        log.info(`Detected ${target.ats} board "${target.id}" from "${raw}".`);
        return { target };
    } catch (error) {
        return { failure: failureResult(raw, 'unknown', errorMessage(error)) };
    }
}

async function probeSlug(slug: string, input: string, options: FetchJsonOptions): Promise<BoardTarget | null> {
    const checks: Array<{ ats: BoardTarget['ats']; url: string; accept: (data: unknown) => boolean }> = [
        {
            ats: 'greenhouse',
            url: greenhouseListUrl(slug, 'us', false),
            accept: (data) => isRecord(data) && Array.isArray(data.jobs),
        },
        {
            ats: 'lever',
            url: `${leverListUrl(slug, 'us')}&limit=1`,
            accept: (data) => Array.isArray(data),
        },
        {
            ats: 'ashby',
            url: ashbyListUrl(slug),
            accept: (data) => isRecord(data) && Array.isArray(data.jobs),
        },
    ];
    const results = await Promise.all(checks.map(async (check) => {
        try {
            const data = await fetchJson(check.url, {}, { ...options, maxAttempts: 2 });
            return { check, data, ok: check.accept(data) };
        } catch {
            return { check, data: null, ok: false };
        }
    }));
    const hits = results.filter((result) => result.ok);
    if (hits.length === 0) return null;
    const withJobs = hits.find((result) => jobCount(result.data) > 0) ?? hits[0]!;
    return {
        ats: withJobs.check.ats,
        id: slug,
        region: 'us',
        input,
    };
}

function jobCount(data: unknown): number {
    if (Array.isArray(data)) return data.length;
    if (isRecord(data) && Array.isArray(data.jobs)) return data.jobs.length;
    return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object';
}

function failureResult(input: string, ats: BoardResult['ats'], error: string): BoardResult {
    return { ok: false, ats, boardId: input, input, jobs: [], error, durationMs: 0 };
}
