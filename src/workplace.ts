import type { InternalJob, WorkplaceType } from './types.js';
import { uniqueStrings } from './text.js';

export function normalizeWorkplace(explicit: string | null | undefined): WorkplaceType | null {
    if (!explicit) return null;
    const value = explicit.trim().toLowerCase().replace(/[\s_]+/g, '-');
    if (value === 'remote' || value === 'fully-remote') return 'remote';
    if (value === 'hybrid') return 'hybrid';
    if (value === 'onsite' || value === 'on-site' || value === 'in-office' || value === 'office') return 'onsite';
    return null;
}

export function classifyWorkplace(options: {
    explicit?: string | null;
    isRemote?: boolean | null;
    locations: string[];
}): { workplaceType: WorkplaceType; isRemote: boolean | null } {
    const explicit = normalizeWorkplace(options.explicit);
    const locations = options.locations.filter((location) => !/^\d+\s+locations?$/i.test(location));
    if (explicit === 'remote') return { workplaceType: 'remote', isRemote: true };
    if (explicit === 'hybrid') return { workplaceType: 'hybrid', isRemote: options.isRemote === true };
    if (explicit === 'onsite') return { workplaceType: 'onsite', isRemote: false };

    const remoteCount = locations.filter((location) => /\bremote\b/i.test(location)).length;
    if (locations.length > 0 && remoteCount === locations.length) {
        return { workplaceType: 'remote', isRemote: true };
    }
    if (remoteCount > 0) return { workplaceType: 'hybrid', isRemote: false };
    if (options.isRemote === true) return { workplaceType: 'remote', isRemote: true };
    if (options.isRemote === false && locations.length > 0) return { workplaceType: 'onsite', isRemote: false };
    return { workplaceType: 'unknown', isRemote: options.isRemote ?? null };
}

/** Fully remote roles. Hybrid jobs stay out of the remote-only filter. */
export function isRemoteJob(job: Pick<InternalJob, 'workplaceType' | 'isRemote' | 'locations'>): boolean {
    if (job.workplaceType === 'remote') return true;
    if (job.workplaceType === 'hybrid' || job.workplaceType === 'onsite') return false;
    if (job.isRemote === true) return true;
    return job.locations.some((location) => /\bremote\b/i.test(location));
}

export function departmentLabel(department: string | null | undefined, team?: string | null): string | null {
    const primary = department?.trim() ?? '';
    const secondary = team?.trim() ?? '';
    if (primary && secondary && primary.toLowerCase() !== secondary.toLowerCase()) {
        return `${primary} / ${secondary}`;
    }
    return primary || secondary || null;
}

export function realLocations(locations: Array<string | null | undefined>): string[] {
    return uniqueStrings(locations).filter((location) => !/^\d+\s+locations?$/i.test(location));
}
