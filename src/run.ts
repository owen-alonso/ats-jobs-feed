import { fetchAshby } from './adapters/ashby.js';
import { fetchGreenhouse } from './adapters/greenhouse.js';
import { fetchLever } from './adapters/lever.js';
import { enrichWorkdayJob, fetchWorkday } from './adapters/workday.js';
import { compareJobs, dedupeJobs, jobKey, matchesFilters } from './filters.js';
import { normalizeInput, type ActorInput } from './input.js';
import { mapPool } from './pool.js';
import { resolveBoards } from './resolve.js';
import { EMPTY_SEEN, stateRecordKey, updateSeenState, type SeenState } from './state.js';
import { errorMessage, toPublicJob } from './text.js';
import type { BoardResult, BoardTarget, InternalJob, JobListing, Logger, RunSummary } from './types.js';
import { silentLog } from './types.js';
import type { FetchJsonOptions } from './http.js';

export interface PushResult {
    accepted: boolean;
    stopped: boolean;
}

export interface RunDeps extends FetchJsonOptions {
    log?: Logger;
    now?: () => Date;
    loadSeen?: (recordKey: string) => Promise<SeenState>;
    saveSeen?: (recordKey: string, state: SeenState) => Promise<void>;
    pushJob?: (job: JobListing) => Promise<PushResult>;
}

export class RunFailedError extends Error {
    readonly summary: RunSummary;

    constructor(message: string, summary: RunSummary) {
        super(message);
        this.name = 'RunFailedError';
        this.summary = summary;
    }
}

export async function runFeed(input: ActorInput | null | undefined, deps: RunDeps = {}): Promise<RunSummary> {
    const config = normalizeInput(input);
    const log = deps.log ?? silentLog;
    const now = deps.now ?? (() => new Date());
    const pushJob = deps.pushJob ?? (async () => ({ accepted: true, stopped: false }));
    const loadSeen = deps.loadSeen ?? (async () => EMPTY_SEEN);
    const saveSeen = deps.saveSeen ?? (async () => {});

    const { targets, failures } = await resolveBoards(config.boards, {
        ...deps,
        log,
        concurrency: config.maxConcurrency,
    });
    const fetched = await mapPool(targets, config.maxConcurrency, (target) => fetchBoard(target, config, deps, log, now()));
    const results = [...failures, ...fetched];

    let state = EMPTY_SEEN;
    let persistState = true;
    const recordKey = stateRecordKey(config.stateKey);
    if (config.resetState) {
        log.info(`Resetting seen-jobs state "${recordKey}".`);
    } else {
        try {
            state = await loadSeen(recordKey);
        } catch (error) {
            if (config.onlyNew) {
                throw new Error(`Could not read seen-jobs state, so onlyNew was not applied: ${errorMessage(error)}`);
            }
            persistState = false;
            log.warning(`Could not read seen-jobs state. This run will not update history: ${errorMessage(error)}`);
        }
    }

    const matched = dedupeJobs(results.flatMap((result) => result.jobs))
        .filter((job) => matchesFilters(job, config.filters, now()))
        .sort(compareJobs);
    const pool = config.onlyNew ? matched.filter((job) => !state.jobs[jobKey(job)]) : matched;

    const emitted: InternalJob[] = [];
    let cursor = 0;
    let chargeLimitReached = false;
    for (let round = 0; round < 8 && emitted.length < config.maxResults && cursor < pool.length; round += 1) {
        const need = config.maxResults - emitted.length;
        const batch = pool.slice(cursor, cursor + need);
        cursor += batch.length;
        const enriched = await enrichBatch(batch, config.includeDescriptions, config.maxConcurrency, deps, log, now());
        const passed = enriched.filter((job) => matchesFilters(job, config.filters, now()));
        for (const job of passed) {
            if (emitted.length >= config.maxResults) break;
            const pushed = await pushJob(toPublicJob(job));
            if (pushed.accepted) emitted.push(job);
            if (pushed.stopped || !pushed.accepted) {
                chargeLimitReached = true;
                break;
            }
        }
        if (chargeLimitReached) break;
    }

    if (persistState) {
        const remembered = updateSeenState(state, matched, emitted, now().toISOString());
        try {
            await saveSeen(recordKey, remembered);
        } catch (error) {
            log.warning(`Could not save seen-jobs state: ${errorMessage(error)}`);
        }
    }

    const summary = buildSummary(results, matched.length, emitted.length, config.onlyNew, chargeLimitReached, now());
    log.info(`Returned ${summary.jobsReturned} jobs from ${summary.boardsSucceeded}/${summary.boardsRequested} boards.`);
    const fatal = fatalMessage(results);
    if (fatal) throw new RunFailedError(fatal, summary);
    return summary;
}

async function fetchBoard(
    target: BoardTarget,
    config: ReturnType<typeof normalizeInput>,
    deps: RunDeps,
    log: Logger,
    now: Date,
): Promise<BoardResult> {
    const started = Date.now();
    try {
        if (target.ats === 'greenhouse') return await fetchGreenhouse(target, { ...deps, log });
        if (target.ats === 'lever') return await fetchLever(target, { ...deps, log });
        if (target.ats === 'ashby') return await fetchAshby(target, { ...deps, log });
        return await fetchWorkday(target, {
            ...deps,
            log,
            keyword: config.filters.keyword,
            maxJobs: config.workdayMaxJobs,
            now,
        });
    } catch (error) {
        log.warning(`Board ${target.input} failed and was skipped: ${errorMessage(error)}`);
        return {
            ok: false,
            ats: target.ats,
            boardId: target.id,
            input: target.input,
            jobs: [],
            error: errorMessage(error),
            durationMs: Date.now() - started,
        };
    }
}

async function enrichBatch(
    jobs: InternalJob[],
    includeDescriptions: boolean,
    concurrency: number,
    deps: RunDeps,
    log: Logger,
    now: Date,
): Promise<InternalJob[]> {
    if (!includeDescriptions) return jobs.map(stripDetail);
    return mapPool(jobs, concurrency, async (job) => {
        if (job.source !== 'workday' || !job.detailUrl) return stripDetail(job);
        try {
            return stripDetail(await enrichWorkdayJob(job, { ...deps, now }));
        } catch (error) {
            log.warning(`Workday detail skipped for ${job.jobId}: ${errorMessage(error)}`);
            return stripDetail(job);
        }
    });
}

function stripDetail(job: InternalJob): InternalJob {
    if (!job.detailUrl) return job;
    const copy = { ...job };
    delete copy.detailUrl;
    return copy;
}

function buildSummary(
    results: BoardResult[],
    jobsMatched: number,
    jobsReturned: number,
    onlyNew: boolean,
    chargeLimitReached: boolean,
    now: Date,
): RunSummary {
    const failed = results.filter((result) => !result.ok);
    return {
        boardsRequested: results.length,
        boardsSucceeded: results.length - failed.length,
        boardsFailed: failed.map((result) => ({
            input: result.input,
            ats: result.ats,
            error: result.error ?? 'failed',
        })),
        jobsFetched: results.reduce((sum, result) => sum + result.jobs.length, 0),
        jobsMatched,
        jobsReturned,
        onlyNew,
        chargeLimitReached,
        finishedAt: now.toISOString(),
    };
}

/**
 * A Workday-only failure does not fail the run. A run fails when every
 * non-Workday board failed and nothing succeeded.
 */
export function fatalMessage(results: BoardResult[]): string | null {
    if (results.length === 0) return 'No career boards were processed.';
    const nonWorkday = results.filter((result) => result.ats !== 'workday');
    if (nonWorkday.length === 0) return null;
    if (results.some((result) => result.ok)) return null;
    const details = nonWorkday.map((result) => `${result.input}: ${result.error ?? 'failed'}`).join('; ');
    return `Every career board failed. ${details}`;
}
