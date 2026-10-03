import type { BoardResult, BoardTarget, InternalJob, Logger, Salary } from '../types.js';
import { silentLog } from '../types.js';
import { fetchJson, type FetchJsonOptions } from '../http.js';
import {
    asNumber,
    companyFromSlug,
    emptySalary,
    htmlToText,
    humanizeEmployment,
    normalizeInterval,
    salaryOrNull,
    toIso,
} from '../text.js';
import { errorMessage } from '../text.js';
import { classifyWorkplace, departmentLabel, realLocations } from '../workplace.js';

interface AshbyCompensationComponent {
    compensationType?: string;
    interval?: string | null;
    currencyCode?: string | null;
    minValue?: number | null;
    maxValue?: number | null;
    summary?: string | null;
}

interface AshbyJob {
    id?: string;
    title?: string;
    department?: string | null;
    team?: string | null;
    employmentType?: string | null;
    location?: string | null;
    secondaryLocations?: Array<{ location?: string | null }>;
    publishedAt?: string | null;
    isListed?: boolean;
    isRemote?: boolean | null;
    workplaceType?: string | null;
    jobUrl?: string;
    applyUrl?: string;
    descriptionHtml?: string | null;
    descriptionPlain?: string | null;
    compensation?: {
        compensationTierSummary?: string | null;
        scrapeableCompensationSalarySummary?: string | null;
        summaryComponents?: AshbyCompensationComponent[];
        compensationTiers?: Array<{ components?: AshbyCompensationComponent[] }>;
    } | null;
}

export function ashbyListUrl(id: string): string {
    return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(id)}?includeCompensation=true`;
}

export function normalizeAshbyJob(raw: AshbyJob, target: BoardTarget): InternalJob | null {
    if (raw.isListed === false) return null;
    const title = raw.title?.replace(/\s+/g, ' ').trim();
    const jobId = raw.id?.trim() ?? '';
    const applyUrl = (raw.applyUrl || raw.jobUrl || '').trim();
    if (!title || !jobId || !applyUrl) return null;

    const locations = realLocations([
        raw.location,
        ...(raw.secondaryLocations ?? []).map((item) => item.location),
    ]);
    const workplace = classifyWorkplace({
        explicit: raw.workplaceType,
        isRemote: raw.isRemote ?? null,
        locations,
    });
    const descriptionHtml = raw.descriptionHtml?.trim() || null;

    return {
        source: 'ashby',
        boardId: target.id,
        company: companyFromSlug(target.id),
        jobId,
        title,
        department: departmentLabel(raw.department, raw.team),
        locations,
        workplaceType: workplace.workplaceType,
        isRemote: workplace.isRemote,
        employmentType: humanizeEmployment(raw.employmentType),
        salary: salaryFromAshby(raw.compensation),
        postedAt: toIso(raw.publishedAt),
        updatedAt: null,
        applyUrl,
        descriptionHtml,
        descriptionText: raw.descriptionPlain?.trim() || htmlToText(descriptionHtml),
    };
}

export async function fetchAshby(
    target: BoardTarget,
    options: FetchJsonOptions & { log?: Logger } = {},
): Promise<BoardResult> {
    const started = Date.now();
    const log = options.log ?? silentLog;
    try {
        const payload = await fetchJson(ashbyListUrl(target.id), {}, options);
        if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { jobs?: unknown }).jobs)) {
            throw new Error('Ashby response did not contain a jobs array.');
        }
        const jobs = ((payload as { jobs: AshbyJob[] }).jobs)
            .map((job) => normalizeAshbyJob(job, target))
            .filter((job): job is InternalJob => job != null);
        log.info(`Ashby ${target.id}: ${jobs.length} jobs.`);
        return { ok: true, ats: 'ashby', boardId: target.id, input: target.input, jobs, durationMs: Date.now() - started };
    } catch (error) {
        return {
            ok: false,
            ats: 'ashby',
            boardId: target.id,
            input: target.input,
            jobs: [],
            error: errorMessage(error),
            durationMs: Date.now() - started,
        };
    }
}

function salaryFromAshby(compensation: AshbyJob['compensation']): Salary | null {
    if (!compensation) return null;
    const components = compensation.summaryComponents
        ?? compensation.compensationTiers?.[0]?.components
        ?? [];
    const salaryComponent = components.find((component) => /salary|cash/i.test(component.compensationType ?? ''))
        ?? components.find((component) => component.minValue != null || component.maxValue != null);
    const salary = emptySalary();
    salary.min = asNumber(salaryComponent?.minValue);
    salary.max = asNumber(salaryComponent?.maxValue);
    salary.currency = salaryComponent?.currencyCode?.trim() || null;
    salary.interval = normalizeInterval(salaryComponent?.interval);
    salary.text = compensation.scrapeableCompensationSalarySummary?.trim()
        || compensation.compensationTierSummary?.trim()
        || salaryComponent?.summary?.trim()
        || null;
    return salaryOrNull(salary);
}
