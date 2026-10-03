import { Actor, log } from 'apify';

import { JOB_RESULT_EVENT, type ActorInput } from './input.js';
import { RunFailedError, runFeed } from './run.js';
import { EMPTY_SEEN, isSeenState, type SeenState } from './state.js';
import { errorMessage } from './text.js';
import type { JobListing } from './types.js';

const STATE_STORE = 'ats-jobs-feed';

await Actor.init();

try {
    const input = (await Actor.getInput<ActorInput>()) ?? {};
    const summary = await runFeed(input, {
        log,
        loadSeen: loadSeenState,
        saveSeen: saveSeenState,
        pushJob: pushJob,
    });
    await Actor.setValue('OUTPUT', summary);
    await Actor.exit();
} catch (error) {
    if (error instanceof RunFailedError) {
        await Actor.setValue('OUTPUT', error.summary);
    }
    log.error(errorMessage(error));
    await Actor.exit({ exitCode: 1 });
}

async function loadSeenState(recordKey: string): Promise<SeenState> {
    const store = await Actor.openKeyValueStore(STATE_STORE);
    const value = await store.getValue(recordKey);
    return isSeenState(value) ? value : EMPTY_SEEN;
}

async function saveSeenState(recordKey: string, state: SeenState): Promise<void> {
    const store = await Actor.openKeyValueStore(STATE_STORE);
    await store.setValue(recordKey, state);
}

async function pushJob(job: JobListing): Promise<{ accepted: boolean; stopped: boolean }> {
    if (isPayPerEvent()) {
        const result = await Actor.pushData(job, JOB_RESULT_EVENT);
        const accepted = result.chargedCount > 0;
        return { accepted, stopped: result.eventChargeLimitReached || !accepted };
    }
    await Actor.pushData(job);
    return { accepted: true, stopped: false };
}

function isPayPerEvent(): boolean {
    try {
        return Actor.getChargingManager().getPricingInfo().isPayPerEvent;
    } catch {
        return false;
    }
}
