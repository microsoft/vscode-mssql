/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Session History artifact chips (final plan WI-4.4 / addendum §6.4): a pure
 * projection from one session's bundle catalog to the compact chip counts
 * the History page renders (`Diag n`, `Completions n`, `QS runs n`,
 * `Replay runs n`, plus a "!" state for refused/invalid artifacts).
 *
 * Bundle DESCRIPTORS only — this module never opens a child manifest or a
 * segment (§14 manifest-only rule; the descriptor counts were written by the
 * artifact owners). Zero counts are omitted so the UI shows no "0" noise,
 * and a session without a bundle gets NO chips object at all (legacy
 * sessions stay honest, not decorated).
 */

import { HistoryArtifactChips } from "../../sharedInterfaces/debugConsole";
import { ObservabilityBundleV1 } from "./bundleSchemas";

const COMPLETIONS_FEATURE_ID = "completions";
const QUERY_STUDIO_FEATURE_ID = "queryStudio";
const MAX_INVALID_LABELS = 8;

/**
 * Project one bundle to its chip counts. Returns an object with only the
 * nonzero fields set; an entirely-empty bundle yields `{}` (the row renders
 * no chips — same as zero everywhere, honestly).
 */
export function projectHistoryArtifactChips(bundle: ObservabilityBundleV1): HistoryArtifactChips {
    let diagEvents = 0;
    let completionEvents = 0;
    let qsRuns = 0;
    let replayRuns = 0;
    const invalidLabels: string[] = [];
    for (const artifact of bundle.artifacts) {
        if (artifact.status === "invalid" || artifact.status === "missing") {
            invalidLabels.push(`${artifact.kind}:${artifact.artifactId} (${artifact.status})`);
            continue; // an invalid artifact's counts are not trustworthy
        }
        switch (artifact.kind) {
            case "diagStream":
                diagEvents += artifact.events ?? 0;
                break;
            case "featureCapture":
                if (artifact.featureId === COMPLETIONS_FEATURE_ID) {
                    completionEvents += artifact.events ?? 0;
                } else if (artifact.featureId === QUERY_STUDIO_FEATURE_ID) {
                    // Each captured Query Studio run is one event in the
                    // queryStudio capture stream.
                    qsRuns += artifact.events ?? 0;
                }
                break;
            case "replayRun":
                replayRuns++;
                break;
            default:
                break; // refs (perf/sts2/import) get chips when pages exist
        }
    }
    return {
        ...(diagEvents > 0 ? { diagEvents } : {}),
        ...(completionEvents > 0 ? { completionEvents } : {}),
        ...(qsRuns > 0 ? { qsRuns } : {}),
        ...(replayRuns > 0 ? { replayRuns } : {}),
        ...(invalidLabels.length > 0
            ? {
                  invalidArtifacts: invalidLabels.length,
                  invalidArtifactLabels: invalidLabels.slice(0, MAX_INVALID_LABELS),
              }
            : {}),
    };
}

/** True when the projection produced at least one renderable chip. */
export function hasHistoryArtifactChips(chips: HistoryArtifactChips): boolean {
    return (
        chips.diagEvents !== undefined ||
        chips.completionEvents !== undefined ||
        chips.qsRuns !== undefined ||
        chips.replayRuns !== undefined ||
        chips.invalidArtifacts !== undefined
    );
}
