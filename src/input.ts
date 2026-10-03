import type { JobFilters } from './filters.js';

export const DEFAULT_BOARDS = [
    'https://boards.greenhouse.io/discord',
    'https://jobs.lever.co/spotify',
    'https://jobs.ashbyhq.com/linear',
];

export const DEFAULT_MAX_RESULTS = 15;
export const DEFAULT_MAX_CONCURRENCY = 4;
export const DEFAULT_WORKDAY_MAX_JOBS = 100;
export const JOB_RESULT_EVENT = 'job-result';

export interface ActorInput {
    boards?: string[] | string;
    keyword?: string;
    location?: string;
    remoteOnly?: boolean;
    department?: string;
    postedWithinDays?: number;
    onlyNew?: boolean;
    stateKey?: string;
    resetState?: boolean;
    maxResults?: number;
    maxConcurrency?: number;
    includeDescriptions?: boolean;
    workdayMaxJobs?: number;
}

export interface NormalizedInput {
    boards: string[];
    filters: JobFilters;
    onlyNew: boolean;
    stateKey: string;
    resetState: boolean;
    maxResults: number;
    maxConcurrency: number;
    includeDescriptions: boolean;
    workdayMaxJobs: number;
}

export function normalizeInput(input: ActorInput | null | undefined): NormalizedInput {
    const source = input ?? {};
    const boards = source.boards === undefined ? [...DEFAULT_BOARDS] : stringList(source.boards, 'boards');
    if (boards.length === 0) {
        throw new Error('No career pages or board identifiers were provided.');
    }
    if (boards.length > 100) {
        throw new Error('Provide at most 100 career pages per run.');
    }
    return {
        boards,
        filters: {
            keyword: optionalText(source.keyword, 'keyword'),
            location: optionalText(source.location, 'location'),
            remoteOnly: bool(source.remoteOnly, false, 'remoteOnly'),
            department: optionalText(source.department, 'department'),
            postedWithinDays: optionalInt(source.postedWithinDays, 1, 3650, 'postedWithinDays'),
        },
        onlyNew: bool(source.onlyNew, false, 'onlyNew'),
        stateKey: optionalText(source.stateKey, 'stateKey') ?? 'default',
        resetState: bool(source.resetState, false, 'resetState'),
        maxResults: intOption(source.maxResults, DEFAULT_MAX_RESULTS, 1, 10_000, 'maxResults'),
        maxConcurrency: intOption(source.maxConcurrency, DEFAULT_MAX_CONCURRENCY, 1, 8, 'maxConcurrency'),
        includeDescriptions: bool(source.includeDescriptions, true, 'includeDescriptions'),
        workdayMaxJobs: intOption(source.workdayMaxJobs, DEFAULT_WORKDAY_MAX_JOBS, 1, 2_000, 'workdayMaxJobs'),
    };
}

function stringList(value: unknown, name: string): string[] {
    if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
    if (!Array.isArray(value)) throw new Error(`${name} must be a list of strings.`);
    return value.map((item, index) => {
        if (typeof item !== 'string') throw new Error(`${name}[${index}] must be a string.`);
        return item.trim();
    }).filter(Boolean);
}

function optionalText(value: unknown, name: string): string | undefined {
    if (value == null || value === '') return undefined;
    if (typeof value !== 'string') throw new Error(`${name} must be a string.`);
    const trimmed = value.trim();
    return trimmed || undefined;
}

function bool(value: unknown, fallback: boolean, name: string): boolean {
    if (value == null) return fallback;
    if (typeof value === 'boolean') return value;
    throw new Error(`${name} must be true or false.`);
}

function intOption(value: unknown, fallback: number, min: number, max: number, name: string): number {
    if (value == null || value === '') return fallback;
    const parsed = parseInteger(value, name);
    if (parsed < min || parsed > max) throw new Error(`${name} must be between ${min} and ${max}.`);
    return parsed;
}

function optionalInt(value: unknown, min: number, max: number, name: string): number | undefined {
    if (value == null || value === '') return undefined;
    const parsed = parseInteger(value, name);
    if (parsed < min || parsed > max) throw new Error(`${name} must be between ${min} and ${max}.`);
    return parsed;
}

function parseInteger(value: unknown, name: string): number {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (!Number.isInteger(parsed)) throw new Error(`${name} must be a whole number.`);
    return parsed;
}
