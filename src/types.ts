export type Ats = 'greenhouse' | 'lever' | 'ashby' | 'workday';

export type WorkplaceType = 'remote' | 'hybrid' | 'onsite' | 'unknown';

export type Region = 'us' | 'eu';

export interface Salary {
    min: number | null;
    max: number | null;
    currency: string | null;
    interval: string | null;
    text: string | null;
}

/** One normalized job listing. This is the dataset item. */
export interface JobListing {
    source: Ats;
    boardId: string;
    company: string;
    jobId: string;
    title: string;
    department: string | null;
    locations: string[];
    workplaceType: WorkplaceType;
    isRemote: boolean | null;
    employmentType: string | null;
    salary: Salary | null;
    postedAt: string | null;
    updatedAt: string | null;
    applyUrl: string;
    descriptionText: string | null;
    descriptionHtml: string | null;
}

/** In-memory job. `detailUrl` is stripped before the dataset write. */
export interface InternalJob extends JobListing {
    detailUrl?: string;
}

export interface WorkdayLocation {
    tenant: string;
    shard: string;
    site: string;
    origin: string;
    hostStyle: 'myworkdayjobs' | 'myworkdaysite';
}

export interface BoardTarget {
    ats: Ats;
    id: string;
    region: Region;
    input: string;
    workday?: WorkdayLocation;
}

export interface BoardResult {
    ok: boolean;
    ats: Ats | 'unknown';
    boardId: string;
    input: string;
    jobs: InternalJob[];
    error?: string;
    durationMs: number;
}

export interface Logger {
    info(message: string): void;
    warning(message: string): void;
}

export const silentLog: Logger = {
    info() {},
    warning() {},
};

export interface RunSummary {
    boardsRequested: number;
    boardsSucceeded: number;
    boardsFailed: Array<{ input: string; ats: string; error: string }>;
    jobsFetched: number;
    jobsMatched: number;
    jobsReturned: number;
    onlyNew: boolean;
    chargeLimitReached: boolean;
    finishedAt: string;
}
