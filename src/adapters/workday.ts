import type { BoardResult, BoardTarget, InternalJob, Logger, Salary, WorkdayLocation } from '../types.js';
import { silentLog } from '../types.js';
import { fetchJson, type FetchJsonOptions } from '../http.js';
import {
    asNumber,
    companyFromSlug,
    emptySalary,
    errorMessage,
    htmlToText,
    humanizeEmployment,
    normalizeInterval,
    salaryOrNull,
    toIso,
} from '../text.js';
import { classifyWorkplace, realLocations } from '../workplace.js';

interface WorkdayPosting {
    title?: string;
    externalPath?: string;
    locationsText?: string;
    postedOn?: string;
    bulletFields?: string[];
}

interface WorkdayListResponse {
    total?: number;
    jobPostings?: WorkdayPosting[];
}

interface WorkdayDetailInfo {
    id?: string;
    title?: string;
    jobDescription?: string;
    location?: string;
    additionalLocations?: string[];
    postedOn?: string;
    startDate?: string;
    timeType?: string;
    jobReqId?: string;
    externalUrl?: string;
    [key: string]: unknown;
}

const PAGE_SIZE = 20;
const WORKDAY_BUDGET_MS = 45_000;

export interface WorkdayFetchOptions extends FetchJsonOptions {
    log?: Logger;
    keyword?: string;
    maxJobs?: number;
    now?: Date;
}

export function workdayListUrl(workday: WorkdayLocation): string {
    return `${workday.origin}/wday/cxs/${encodeURIComponent(workday.tenant)}/${encodeURIComponent(workday.site)}/jobs`;
}

export function workdayDetailUrl(workday: WorkdayLocation, externalPath: string): string {
    return `${workday.origin}/wday/cxs/${encodeURIComponent(workday.tenant)}/${encodeURIComponent(workday.site)}${externalPath}`;
}

export function workdayApplyUrl(workday: WorkdayLocation, externalPath: string): string {
    if (workday.hostStyle === 'myworkdaysite') {
        return `${workday.origin}/recruiting/${encodeURIComponent(workday.tenant)}/${encodeURIComponent(workday.site)}${externalPath}`;
    }
    return `${workday.origin}/${encodeURIComponent(workday.site)}${externalPath}`;
}

export function parseRelativePostedOn(text: string | null | undefined, now: Date): string | null {
    if (!text) return null;
    const value = text.trim().toLowerCase();
    if (!value.startsWith('posted')) return null;
    let days: number | null = null;
    if (value.includes('today')) days = 0;
    else if (value.includes('yesterday')) days = 1;
    else {
        const match = value.match(/(\d+)\+?\s*days?/);
        if (match) days = Number(match[1]);
    }
    if (days == null) return null;
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString();
}

export function normalizeWorkdayPosting(
    raw: WorkdayPosting,
    target: BoardTarget,
    now: Date,
): InternalJob | null {
    const workday = target.workday;
    if (!workday) return null;
    const title = raw.title?.trim();
    const externalPath = raw.externalPath?.trim() ?? '';
    const jobId = workdayJobId(raw);
    if (!title || !jobId || !externalPath) return null;
    const locations = realLocations([raw.locationsText]);
    const workplace = classifyWorkplace({ locations });
    const bulletEmployment = (raw.bulletFields ?? []).find((field) => /full|part|intern|contract|temporary/i.test(field));

    return {
        source: 'workday',
        boardId: `${workday.tenant}/${workday.site}`,
        company: companyFromSlug(workday.tenant),
        jobId,
        title,
        department: null,
        locations,
        workplaceType: workplace.workplaceType,
        isRemote: workplace.isRemote,
        employmentType: humanizeEmployment(bulletEmployment),
        salary: null,
        postedAt: parseRelativePostedOn(raw.postedOn, now),
        updatedAt: null,
        applyUrl: workdayApplyUrl(workday, externalPath),
        descriptionText: null,
        descriptionHtml: null,
        detailUrl: workdayDetailUrl(workday, externalPath),
    };
}

/**
 * Workday is best-effort. Timeouts, HTTP errors, and bad payloads are returned
 * as a failed board result. This function does not throw.
 */
export async function fetchWorkday(target: BoardTarget, options: WorkdayFetchOptions = {}): Promise<BoardResult> {
    const started = Date.now();
    const log = options.log ?? silentLog;
    const workday = target.workday;
    if (!workday) {
        return failed(target, 'Workday URL could not be parsed.', started);
    }
    const deadline = started + WORKDAY_BUDGET_MS;
    const maxJobs = options.maxJobs ?? 100;
    try {
        const postings: WorkdayPosting[] = [];
        let offset = 0;
        let total = Number.POSITIVE_INFINITY;
        while (postings.length < maxJobs && offset < total) {
            if (Date.now() > deadline) {
                log.warning(`Workday ${workday.tenant}/${workday.site} hit the time budget. Returning ${postings.length} list rows.`);
                break;
            }
            const page = await fetchJson(workdayListUrl(workday), {
                method: 'POST',
                body: JSON.stringify({
                    limit: PAGE_SIZE,
                    offset,
                    searchText: (options.keyword ?? '').slice(0, 200),
                    appliedFacets: {},
                }),
            }, {
                ...options,
                timeoutMs: Math.min(options.timeoutMs ?? 20_000, Math.max(1_000, deadline - Date.now())),
            }) as WorkdayListResponse;
            const batch = Array.isArray(page?.jobPostings) ? page.jobPostings : [];
            if (offset === 0 && typeof page?.total === 'number' && page.total >= 0) total = page.total;
            postings.push(...batch);
            offset += batch.length;
            if (batch.length === 0 || batch.length < PAGE_SIZE) break;
        }
        const now = options.now ?? new Date();
        const jobs = postings
            .slice(0, maxJobs)
            .map((posting) => normalizeWorkdayPosting(posting, target, now))
            .filter((job): job is InternalJob => job != null);
        log.info(`Workday ${workday.tenant}/${workday.site}: ${jobs.length} list rows.`);
        return {
            ok: true,
            ats: 'workday',
            boardId: target.id,
            input: target.input,
            jobs,
            durationMs: Date.now() - started,
        };
    } catch (error) {
        log.warning(`Workday ${workday.tenant}/${workday.site} failed and was skipped: ${errorMessage(error)}`);
        return failed(target, errorMessage(error), started);
    }
}

export async function enrichWorkdayJob(job: InternalJob, options: FetchJsonOptions & { now?: Date } = {}): Promise<InternalJob> {
    if (!job.detailUrl) return job;
    const payload = await fetchJson(job.detailUrl, {}, options);
    if (!payload || typeof payload !== 'object') return job;
    const record = payload as { jobPostingInfo?: WorkdayDetailInfo; hiringOrganization?: { name?: string } };
    const info = record.jobPostingInfo;
    if (!info) return job;
    const locations = realLocations([
        info.location,
        ...(Array.isArray(info.additionalLocations) ? info.additionalLocations : []),
    ]);
    const workplace = locations.length > 0
        ? classifyWorkplace({ locations })
        : { workplaceType: job.workplaceType, isRemote: job.isRemote };
    const postedAt = toIso(info.startDate) ?? parseRelativePostedOn(info.postedOn, options.now ?? new Date()) ?? job.postedAt;
    const companyName = cleanHiringOrg(record.hiringOrganization?.name) ?? job.company;
    const descriptionHtml = info.jobDescription?.trim() || job.descriptionHtml;

    return {
        ...job,
        company: companyName,
        jobId: info.jobReqId?.trim() || job.jobId,
        title: info.title?.trim() || job.title,
        locations: locations.length > 0 ? locations : job.locations,
        workplaceType: workplace.workplaceType,
        isRemote: workplace.isRemote,
        employmentType: humanizeEmployment(info.timeType) ?? job.employmentType,
        salary: salaryFromWorkday(info) ?? job.salary,
        postedAt,
        applyUrl: info.externalUrl?.trim() || job.applyUrl,
        descriptionHtml,
        descriptionText: htmlToText(descriptionHtml) ?? job.descriptionText,
    };
}

function workdayJobId(raw: WorkdayPosting): string {
    const bullet = (raw.bulletFields ?? []).find((field) => /^[A-Z]{1,6}\d{3,}$/.test(field.replace(/\s+/g, '')));
    if (bullet) return bullet.replace(/\s+/g, '');
    const fromPath = raw.externalPath?.match(/_([A-Z]{1,6}\d{3,})$/);
    if (fromPath) return fromPath[1]!;
    return raw.externalPath?.replace(/^\//, '') || '';
}

function cleanHiringOrg(name: string | undefined): string | null {
    const trimmed = name?.trim() ?? '';
    if (!trimmed || /^\d/.test(trimmed)) return null;
    if (trimmed.length > 80) return null;
    return trimmed;
}

function salaryFromWorkday(info: WorkdayDetailInfo): Salary | null {
    const candidate = info.compensation ?? info.payRange ?? info.salary ?? info.compensationRange;
    if (typeof candidate === 'string') {
        return salaryOrNull({ ...emptySalary(), text: candidate.trim() || null });
    }
    if (!candidate || typeof candidate !== 'object') return null;
    const record = candidate as Record<string, unknown>;
    const salary = emptySalary();
    salary.min = asNumber(record.min ?? record.minValue ?? record.minimum);
    salary.max = asNumber(record.max ?? record.maxValue ?? record.maximum);
    salary.currency = typeof record.currency === 'string'
        ? record.currency
        : typeof record.currencyCode === 'string' ? record.currencyCode : null;
    salary.interval = normalizeInterval(record.interval ?? record.frequency);
    salary.text = typeof record.text === 'string'
        ? record.text
        : typeof record.summary === 'string' ? record.summary : null;
    return salaryOrNull(salary);
}

function failed(target: BoardTarget, error: string, started: number): BoardResult {
    return {
        ok: false,
        ats: 'workday',
        boardId: target.id,
        input: target.input,
        jobs: [],
        error,
        durationMs: Date.now() - started,
    };
}
