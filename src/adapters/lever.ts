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

interface LeverList {
    text?: string;
    content?: string;
}

interface LeverJob {
    id?: string;
    text?: string;
    categories?: {
        commitment?: string | null;
        department?: string | null;
        team?: string | null;
        location?: string | null;
        allLocations?: string[];
    };
    workplaceType?: string | null;
    createdAt?: number;
    description?: string;
    descriptionPlain?: string;
    lists?: LeverList[];
    additional?: string;
    additionalPlain?: string;
    hostedUrl?: string;
    applyUrl?: string;
    salaryRange?: {
        min?: number | null;
        max?: number | null;
        currency?: string | null;
        interval?: string | null;
    } | null;
    salaryDescription?: string | null;
    salaryDescriptionPlain?: string | null;
}

export function leverListUrl(id: string, region: BoardTarget['region']): string {
    const host = region === 'eu' ? 'https://api.eu.lever.co' : 'https://api.lever.co';
    return `${host}/v0/postings/${encodeURIComponent(id)}?mode=json`;
}

export function normalizeLeverJob(raw: LeverJob, target: BoardTarget): InternalJob | null {
    const title = raw.text?.trim();
    const jobId = raw.id?.trim() ?? '';
    const applyUrl = (raw.applyUrl || raw.hostedUrl || '').trim();
    if (!title || !jobId || !applyUrl) return null;

    const locations = realLocations(raw.categories?.allLocations?.length
        ? raw.categories.allLocations
        : [raw.categories?.location]);
    const workplace = classifyWorkplace({ explicit: raw.workplaceType, locations });
    const descriptionHtml = leverHtml(raw);
    const descriptionText = leverText(raw);

    return {
        source: 'lever',
        boardId: target.id,
        company: companyFromSlug(target.id),
        jobId,
        title,
        department: departmentLabel(raw.categories?.department, raw.categories?.team),
        locations,
        workplaceType: workplace.workplaceType,
        isRemote: workplace.isRemote,
        employmentType: humanizeEmployment(raw.categories?.commitment),
        salary: salaryFromLever(raw),
        postedAt: toIso(raw.createdAt),
        updatedAt: null,
        applyUrl,
        descriptionHtml,
        descriptionText,
    };
}

export async function fetchLever(
    target: BoardTarget,
    options: FetchJsonOptions & { log?: Logger } = {},
): Promise<BoardResult> {
    const started = Date.now();
    const log = options.log ?? silentLog;
    try {
        const payload = await fetchJson(leverListUrl(target.id, target.region), {}, options);
        if (!Array.isArray(payload)) throw new Error('Lever response was not a JSON array.');
        const jobs = payload
            .map((job) => normalizeLeverJob(job as LeverJob, target))
            .filter((job): job is InternalJob => job != null);
        log.info(`Lever ${target.id}: ${jobs.length} jobs.`);
        return { ok: true, ats: 'lever', boardId: target.id, input: target.input, jobs, durationMs: Date.now() - started };
    } catch (error) {
        return {
            ok: false,
            ats: 'lever',
            boardId: target.id,
            input: target.input,
            jobs: [],
            error: errorMessage(error),
            durationMs: Date.now() - started,
        };
    }
}

function leverHtml(raw: LeverJob): string | null {
    const parts: string[] = [];
    if (raw.description) parts.push(raw.description);
    for (const list of raw.lists ?? []) {
        if (!list.content && !list.text) continue;
        const heading = list.text ? `<h3>${escapeHtml(list.text)}</h3>` : '';
        parts.push(`${heading}<ul>${list.content ?? ''}</ul>`);
    }
    if (raw.additional) parts.push(raw.additional);
    return parts.length > 0 ? parts.join('\n') : null;
}

function leverText(raw: LeverJob): string | null {
    const parts = [
        raw.descriptionPlain || htmlToText(raw.description),
        ...(raw.lists ?? []).map((list) => {
            const body = htmlToText(list.content);
            return [list.text, body].filter(Boolean).join('\n');
        }),
        raw.additionalPlain || htmlToText(raw.additional),
    ].filter((part): part is string => Boolean(part && part.trim()));
    return parts.length > 0 ? parts.join('\n\n') : null;
}

function salaryFromLever(raw: LeverJob): Salary | null {
    const salary = emptySalary();
    salary.min = asNumber(raw.salaryRange?.min);
    salary.max = asNumber(raw.salaryRange?.max);
    salary.currency = raw.salaryRange?.currency?.trim() || null;
    salary.interval = normalizeInterval(raw.salaryRange?.interval);
    const text = raw.salaryDescriptionPlain || (raw.salaryDescription ? htmlToText(raw.salaryDescription) : null);
    salary.text = text?.trim() || null;
    return salaryOrNull(salary);
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
