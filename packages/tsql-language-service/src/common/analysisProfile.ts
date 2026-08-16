/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * How the analysed script will be consumed.
 *
 * `interactive` is ordinary editing: every statement T-SQL accepts is analysed normally.
 * `build` analyses a script that will be deployed as a data-tier application. That deployment
 * pipeline replays only the CREATE data-definition subset of T-SQL, so statements outside that
 * subset — and a small number of options inside it — are reported before the script is built.
 */
export type DeploymentMode = "interactive" | "build";

/**
 * Immutable analysis settings supplied once per operation.
 *
 * The profile is part of a snapshot's identity: two results are comparable only when they were
 * produced from the same profile, so incremental reuse keys include {@link analysisProfileKey}.
 */
export interface AnalysisProfile {
    readonly deploymentMode: DeploymentMode;
}

/** The profile used when a host supplies none. Editing behaviour must never depend on build mode. */
export const defaultAnalysisProfile: AnalysisProfile = Object.freeze({
    deploymentMode: "interactive",
});

const deploymentModes: readonly DeploymentMode[] = Object.freeze(["interactive", "build"]);

/**
 * Normalizes a partial host profile into a frozen profile. An absent or unrecognized value falls
 * back to the interactive default rather than silently enabling build-only diagnostics.
 */
export function resolveAnalysisProfile(profile?: Partial<AnalysisProfile>): AnalysisProfile {
    const deploymentMode = profile?.deploymentMode;
    if (deploymentMode === undefined || !deploymentModes.includes(deploymentMode)) {
        return defaultAnalysisProfile;
    }
    return Object.freeze({ deploymentMode });
}

/** A stable identity for a profile, used in reuse keys so a profile change cannot be reused across. */
export function analysisProfileKey(profile: AnalysisProfile = defaultAnalysisProfile): string {
    return `deployment=${profile.deploymentMode}`;
}
