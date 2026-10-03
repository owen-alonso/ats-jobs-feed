import type { Salary } from './types.js';

const NAMED_ENTITIES: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: '\u00a0',
    mdash: '\u2014',
    ndash: '\u2013',
    rsquo: '\u2019',
    lsquo: '\u2018',
    rdquo: '\u201d',
    ldquo: '\u201c',
    hellip: '\u2026',
    middot: '\u00b7',
    bull: '\u2022',
    copy: '\u00a9',
    reg: '\u00ae',
    trade: '\u2122',
    deg: '\u00b0',
};

function decodeOnce(value: string): string {
    return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, body: string) => {
        if (body.startsWith('#x') || body.startsWith('#X')) {
            const code = Number.parseInt(body.slice(2), 16);
            return codePoint(code) ?? match;
        }
        if (body.startsWith('#')) {
            const code = Number.parseInt(body.slice(1), 10);
            return codePoint(code) ?? match;
        }
        return NAMED_ENTITIES[body.toLowerCase()] ?? match;
    });
}

function codePoint(code: number): string | null {
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return null;
    try {
        return String.fromCodePoint(code);
    } catch {
        return null;
    }
}

/**
 * Decode HTML entities, including Greenhouse's double-encoded descriptions
 * (`&amp;lt;h2&amp;gt;` and `&lt;h2&gt;` both become `<h2>`).
 */
export function decodeHtmlEntities(value: string): string {
    let current = value;
    for (let pass = 0; pass < 2; pass += 1) {
        const next = decodeOnce(current);
        if (next === current) break;
        current = next;
    }
    return current;
}

export function htmlToText(html: string | null | undefined): string | null {
    if (!html) return null;
    const decoded = decodeHtmlEntities(html);
    const text = decoded
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<\s*br\s*\/?\s*>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|li|tr|table|section|ul|ol)>/gi, '\n')
        .replace(/<li[^>]*>/gi, '- ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return text || null;
}

export function uniqueStrings(values: Array<string | null | undefined>): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
        if (!value) continue;
        const trimmed = value.trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(trimmed);
    }
    return out;
}

export function companyFromSlug(slug: string): string {
    const cleaned = slug.trim();
    if (!cleaned) return cleaned;
    if (cleaned.length <= 3) return cleaned.toUpperCase();
    return cleaned
        .replace(/[-_]+/g, ' ')
        .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export function asNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

export function toIso(value: unknown): string | null {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
        const ms = value < 1e12 ? value * 1000 : value;
        const date = new Date(ms);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    if (typeof value === 'string') {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    return null;
}

export function normalizeInterval(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const value = raw.toLowerCase().replace(/[_-]+/g, ' ').trim();
    if (!value || value === 'none') return null;
    if (value.includes('year') || value.includes('annual')) return 'year';
    if (value.includes('month')) return 'month';
    if (value.includes('week')) return 'week';
    if (value.includes('day') && !value.includes('today')) return 'day';
    if (value.includes('hour')) return 'hour';
    return value;
}

export function humanizeEmployment(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const key = trimmed.toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ');
    const compact = key.replace(/[\s-]/g, '');
    const mapped: Record<string, string> = {
        fulltime: 'Full-time',
        parttime: 'Part-time',
        intern: 'Internship',
        internship: 'Internship',
        contract: 'Contract',
        contractor: 'Contract',
        temporary: 'Temporary',
        permanent: 'Permanent',
    };
    return mapped[compact] ?? mapped[key] ?? trimmed;
}

export function emptySalary(): Salary {
    return { min: null, max: null, currency: null, interval: null, text: null };
}

export function salaryOrNull(salary: Salary): Salary | null {
    if (
        salary.min == null
        && salary.max == null
        && !salary.currency
        && !salary.interval
        && !salary.text
    ) {
        return null;
    }
    return salary;
}

export function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

export function toPublicJob(job: import('./types.js').InternalJob): import('./types.js').JobListing {
    return {
        source: job.source,
        boardId: job.boardId,
        company: job.company,
        jobId: job.jobId,
        title: job.title,
        department: job.department,
        locations: job.locations,
        workplaceType: job.workplaceType,
        isRemote: job.isRemote,
        employmentType: job.employmentType,
        salary: job.salary,
        postedAt: job.postedAt,
        updatedAt: job.updatedAt,
        applyUrl: job.applyUrl,
        descriptionText: job.descriptionText,
        descriptionHtml: job.descriptionHtml,
    };
}
