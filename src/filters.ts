import type { InternalJob } from './types.js';
import { isRemoteJob } from './workplace.js';

export interface JobFilters {
    keyword?: string;
    location?: string;
    remoteOnly: boolean;
    department?: string;
    postedWithinDays?: number;
}

export function matchesFilters(job: InternalJob, filters: JobFilters, now: Date): boolean {
    if (filters.keyword) {
        const needle = filters.keyword.trim().toLowerCase();
        if (needle) {
            const haystack = [job.title, job.department, job.company, ...job.locations, job.descriptionText]
                .filter((part): part is string => Boolean(part))
                .join('\n')
                .toLowerCase();
            if (!haystack.includes(needle)) return false;
        }
    }
    if (filters.location) {
        const needle = filters.location.trim().toLowerCase();
        if (needle && !job.locations.join('\n').toLowerCase().includes(needle)) return false;
    }
    if (filters.department) {
        const needle = filters.department.trim().toLowerCase();
        if (needle && !(job.department ?? '').toLowerCase().includes(needle)) return false;
    }
    if (filters.remoteOnly && !isRemoteJob(job)) return false;
    if (filters.postedWithinDays != null) {
        if (!job.postedAt) return false;
        const posted = Date.parse(job.postedAt);
        if (Number.isNaN(posted)) return false;
        const cutoff = now.getTime() - filters.postedWithinDays * 24 * 60 * 60 * 1000;
        if (posted < cutoff) return false;
    }
    return true;
}

export function compareJobs(a: InternalJob, b: InternalJob): number {
    const left = a.postedAt ? Date.parse(a.postedAt) : Number.NEGATIVE_INFINITY;
    const right = b.postedAt ? Date.parse(b.postedAt) : Number.NEGATIVE_INFINITY;
    if (right !== left) return right - left;
    return a.jobId.localeCompare(b.jobId);
}

export function dedupeJobs(jobs: InternalJob[]): InternalJob[] {
    const byKey = new Map<string, InternalJob>();
    for (const job of jobs) {
        const key = jobKey(job);
        const current = byKey.get(key);
        if (!current || richness(job) >= richness(current)) byKey.set(key, job);
    }
    return [...byKey.values()];
}

export function jobKey(job: Pick<InternalJob, 'source' | 'boardId' | 'jobId'>): string {
    return `${job.source}:${job.boardId}:${job.jobId}`.toLowerCase();
}

function richness(job: InternalJob): number {
    return (job.descriptionText?.length ?? 0)
        + (job.salary ? 1_000 : 0)
        + (job.postedAt ? 100 : 0)
        + job.locations.length;
}
