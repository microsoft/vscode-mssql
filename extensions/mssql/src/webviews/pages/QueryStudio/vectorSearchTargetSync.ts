/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Decision seam for reconciling the Search view's LOCAL target selection
 * with the panel-authoritative `targetId` prop (shared with the Index
 * workspace through vectorTab).
 *
 * The prop is fed from the view's own onViewStateChange emissions, so it
 * always lags local picks by at least one commit. Treating that echo as an
 * external change reverts the user's pick; the persist effect then re-emits
 * the reverted value and the two effects leapfrog forever — the pane
 * flickers as target-dependent controls reset every cycle. The rule that
 * breaks the loop: a prop equal to the view's LAST EMISSION carries no new
 * information, only a prop that differs from it is a real external
 * (Index-initiated or restored) change.
 */

export interface AuthoritativeVectorTargetDecision {
    readonly authoritativeTargetId: string | undefined;
    /** Last targetId the Search view emitted through onViewStateChange. */
    readonly lastEmittedTargetId: string | undefined;
    /** The view's currently selected target id (derived from targetIndex). */
    readonly currentTargetId: string | undefined;
    readonly targets: readonly { readonly id: string }[] | undefined;
}

/**
 * Index (into `targets`) the view must switch to, or undefined when the
 * prop must be ignored (echo of our own emission, unknown id, no targets,
 * or already selected).
 */
export function resolveAuthoritativeVectorTargetIndex(
    decision: AuthoritativeVectorTargetDecision,
): number | undefined {
    const { authoritativeTargetId, lastEmittedTargetId, currentTargetId, targets } = decision;
    if (!authoritativeTargetId || !targets || targets.length === 0) {
        return undefined;
    }
    if (authoritativeTargetId === lastEmittedTargetId) {
        // Echo (or a prop still lagging a newer local pick): the local
        // selection is the newer fact — never "correct" it backward.
        return undefined;
    }
    const nextIndex = targets.findIndex((candidate) => candidate.id === authoritativeTargetId);
    if (nextIndex < 0 || targets[nextIndex].id === currentTargetId) {
        return undefined;
    }
    return nextIndex;
}
