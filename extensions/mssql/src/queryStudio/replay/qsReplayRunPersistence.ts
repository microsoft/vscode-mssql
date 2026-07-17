/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Query Studio wiring for the durable replay-run repository (WI-3.6),
 * mirroring completionsReplayRunPersistence.ts: DiagnosticsManager calls
 * `configureQsReplayRunPersistence` once the store root and bundle manager
 * exist; each Query Studio replay controller then constructs its OWN
 * repository through `createQsReplayRunRepository` (run directories are
 * keyed by globally unique replay run ids, so per-viewer repositories never
 * collide). Everything is optional and failure-isolated: when the store is
 * unavailable, QS replay keeps working with UI-only run state.
 */

import {
    ReplayRunBundleRegistrar,
    ReplayRunRepository,
} from "../../diagnostics/featureCapture/replayRunRepository";
import { JournalFsLike } from "../../diagnostics/featureCapture/journal/journalWriter";
import { logger2 } from "../../models/logger2";
import { ReplayProvenance } from "../../sharedInterfaces/replaySafety";

export interface QsReplayRunPersistenceDeps {
    storeRoot: string;
    hostSessionId: string;
    bundleRegistrar?: ReplayRunBundleRegistrar;
    provenance?: ReplayProvenance;
    /** Injectable for tests; NodeJournalFs in the product. */
    fs?: JournalFsLike;
}

let activeDeps: QsReplayRunPersistenceDeps | undefined;

/** Set (or clear, with undefined) by DiagnosticsManager during activation. */
export function configureQsReplayRunPersistence(
    deps: QsReplayRunPersistenceDeps | undefined,
): void {
    activeDeps = deps;
}

/**
 * Build a repository over the configured store, or undefined when durable
 * persistence is not wired (tests, failed activation). Never throws.
 */
export function createQsReplayRunRepository(): ReplayRunRepository | undefined {
    if (!activeDeps) {
        return undefined;
    }
    try {
        return new ReplayRunRepository({
            storeRoot: activeDeps.storeRoot,
            hostSessionId: activeDeps.hostSessionId,
            featureId: "queryStudio",
            semantics: "interactiveExperiment",
            provenance: activeDeps.provenance,
            bundleRegistrar: activeDeps.bundleRegistrar,
            fs: activeDeps.fs,
        });
    } catch (error) {
        logger2
            .withPrefix("QsReplayRuns")
            .warn(
                `Replay run repository unavailable (isolated): ${error instanceof Error ? error.message : String(error)}`,
            );
        return undefined;
    }
}
