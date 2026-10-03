import { fetchJson, type FetchJsonOptions } from '../http.js';
import {
    asNumber,
    companyFromSlug,
    decodeHtmlEntities,
    emptySalary,
    errorMessage,
    htmlToText,
    humanizeEmployment,
    salaryOrNull,
    toIso,
    uniqueStrings,
} from '../text.js';
import type { BoardResult, BoardTarget, InternalJob, Logger, Salary } from '../types.js';
import { silentLog } from '../types.js';
import { classifyWorkplace, departmentLabel, realLocations } from '../workplace.js';

interface GreenhouseDepartment {
    name?: string | null;
}

interface GreenhouseOffice {
    name?: string | null;
    location?: string | null;
}

interface GreenhouseJob {
    id?: number | string;
    title?: string;
    absolute_url?: string;
    company_name?: string;
    location?: { name?: string | null };
    departments?: GreenhouseDepartment[];
    offices?: GreenhouseOffice[];
    content?: string | null;
    first_published?: string | null;
    updated_at?: string | null;
    metadata?: unknown;
}

export function greenhouseListUrl(id: string, region: BoardTarget['region'], withContent: boolean): string {
    const host = region === 'eu' ? 'https://boards-api.eu.greenhouse.io' : 'https://boards-api.greenhouse.io';
    const query = withContent ? '?content=true' : '';
    return `${host}/v1/boards/${encodeURIComponent(id)}/jobs${query}`;
}

export function normalizeGreenhouseJob(raw: GreenhouseJob, target: BoardTarget): InternalJob | null {
    const title = raw.title?.trim();
    const jobId = raw.id == null ? '' : String(raw.id);
    const applyUrl = raw.absolute_url?.trim() ?? '';
    if (!title || !jobId || !applyUrl) return null;

    const html = raw.content ? decodeHtmlEntities(raw.content) : null;
    const department = departmentLabel(uniqueStrings((raw.departments ?? []).map((item) => item.name)).join(', '));
    const locations = realLocations([
        raw.location?.name,
        ...(raw.offices ?? []).map((office) => office.location || office.name),
    ]);
    const workplace = classifyWorkplace({ locations });

    return {
        source: 'greenhouse',
        boardId: target.id,
        company: raw.company_name?.trim() || companyFromSlug(target.id),
        jobId,
        title,
        department,
        locations,
        workplaceType: workplace.workplaceType,
        isRemote: workplace.isRemote,
        employmentType: humanizeEmployment(employmentFromMetadata(raw.metadata)),
        salary: salaryFromMetadata(raw.metadata),
        postedAt: toIso(raw.first_published),
        updatedAt: toIso(raw.updated_at),
        applyUrl,
        descriptionHtml: html,
        descriptionText: htmlToText(html),
    };
}

export async function fetchGreenhouse(
    target: BoardTarget,
    options: FetchJsonOptions & { log?: Logger } = {},
): Promise<BoardResult> {
    const started = Date.now();
    const log = options.log ?? silentLog;
    try {
        const url = greenhouseListUrl(target.id, target.region, true);
        const payload = await fetchJson(url, {}, options);
        const jobs = readJobs(payload).map((job) => normalizeGreenhouseJob(job, target)).filter((job): job is InternalJob => job != null);
        log.info(`Greenhouse ${target.id}: ${jobs.length} jobs.`);
        return { ok: true, ats: 'greenhouse', boardId: target.id, input: target.input, jobs, durationMs: Date.now() - started };
    } catch (error) {
        return {
            ok: false,
            ats: 'greenhouse',
            boardId: target.id,
            input: target.input,
            jobs: [],
            error: errorMessage(error),
            durationMs: Date.now() - started,
        };
    }
}

function readJobs(payload: unknown): GreenhouseJob[] {
    if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { jobs?: unknown }).jobs)) {
        throw new Error('Greenhouse response did not contain a jobs array.');
    }
    return (payload as { jobs: GreenhouseJob[] }).jobs;
}

function salaryFromMetadata(metadata: unknown): Salary | null {
    if (!Array.isArray(metadata)) return null;
    const field = metadata.find((item) => {
        if (!item || typeof item !== 'object') return false;
        const name = (item as { name?: unknown }).name;
        return typeof name === 'string' && /pay|salary|compensation/i.test(name);
    }) as { value?: unknown } | undefined;
    if (!field) return null;
    const salary = emptySalary();
    const { value } = field;
    if (typeof value === 'string' && value.trim()) salary.text = value.trim();
    else if (typeof value === 'number') {
        salary.min = value;
        salary.max = value;
    } else if (Array.isArray(value)) {
        const text = value.filter((item) => typeof item === 'string' && item.trim()).join(', ');
        if (text) salary.text = text;
    } else if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        salary.min = asNumber(record.min ?? record.min_value ?? record.minimum);
        salary.max = asNumber(record.max ?? record.max_value ?? record.maximum);
        salary.currency = typeof record.currency === 'string' ? record.currency : null;
        salary.text = typeof record.text === 'string' ? record.text : null;
    }
    return salaryOrNull(salary);
}

function employmentFromMetadata(metadata: unknown): string | null {
    if (!Array.isArray(metadata)) return null;
    const field = metadata.find((item) => {
        if (!item || typeof item !== 'object') return false;
        const name = (item as { name?: unknown }).name;
        return typeof name === 'string' && /employment|commitment|time type/i.test(name);
    }) as { value?: unknown } | undefined;
    if (!field) return null;
    if (typeof field.value === 'string') return field.value;
    if (Array.isArray(field.value)) {
        const text = field.value.find((item) => typeof item === 'string');
        return typeof text === 'string' ? text : null;
    }
    return null;
}
