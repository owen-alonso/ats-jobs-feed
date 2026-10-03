import { jobKey } from './filters.js';
import type { InternalJob } from './types.js';

export interface SeenRecord {
    firstSeenAt: string;
    lastSeenAt: string;
}

export interface SeenState {
    version: 1;
    jobs: Record<string, SeenRecord>;
}

export const EMPTY_SEEN: SeenState = { version: 1, jobs: {} };

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_SEEN_JOBS = 20_000;

export function stateRecordKey(stateKey: string | undefined): string {
    const raw = (stateKey ?? 'default').trim() || 'default';
    const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    return `seen-${safe || 'default'}`;
}

/**
 * Refresh jobs that still match and were already seen. Record only the jobs
 * actually returned, so a maxResults cap does not hide the rest forever.
 */
export function updateSeenState(
    state: SeenState,
    matched: InternalJob[],
    emitted: InternalJob[],
    nowIso: string,
): SeenState {
    const next: SeenState = { version: 1, jobs: { ...state.jobs } };
    const matchedKeys = new Set(matched.map((job) => jobKey(job)));
    for (const [key, record] of Object.entries(next.jobs)) {
        if (matchedKeys.has(key)) next.jobs[key] = { ...record, lastSeenAt: nowIso };
    }
    for (const job of emitted) {
        const key = jobKey(job);
        const previous = next.jobs[key];
        next.jobs[key] = {
            firstSeenAt: previous?.firstSeenAt ?? nowIso,
            lastSeenAt: nowIso,
        };
    }
    return pruneSeen(next, nowIso);
}

export function pruneSeen(state: SeenState, nowIso: string): SeenState {
    const now = Date.parse(nowIso);
    const jobs: Record<string, SeenRecord> = {};
    for (const [key, record] of Object.entries(state.jobs)) {
        const seenAt = Date.parse(record.lastSeenAt);
        if (Number.isNaN(seenAt) || now - seenAt > NINETY_DAYS_MS) continue;
        jobs[key] = record;
    }
    const entries = Object.entries(jobs);
    if (entries.length <= MAX_SEEN_JOBS) return { version: 1, jobs };
    entries.sort((left, right) => Date.parse(left[1].lastSeenAt) - Date.parse(right[1].lastSeenAt));
    return { version: 1, jobs: Object.fromEntries(entries.slice(entries.length - MAX_SEEN_JOBS)) };
}

export function isSeenState(value: unknown): value is SeenState {
    if (!value || typeof value !== 'object') return false;
    const record = value as { version?: unknown; jobs?: unknown };
    return record.version === 1 && !!record.jobs && typeof record.jobs === 'object';
}
