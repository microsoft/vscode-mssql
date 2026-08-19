/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    featureAvailability,
    featureAvailabilityDetail,
    platformFeatureForNode,
    platformFeatureNodes,
    platformFeatures,
    type PlatformFeature,
} from "../../common/platformFeatureRegistry.js";
import type { SyntaxNode, SyntaxSnapshot } from "../../syntax/index.js";
import type { FeatureAvailabilityDecision, ResolvedCall } from "./contracts.js";

/** Built-in routine names the registry gates, folded once for lookup. */
const featuresByBuiltIn: ReadonlyMap<string, PlatformFeature> = new Map(
    platformFeatures.flatMap((feature) =>
        (feature.builtIns ?? []).map((name) => [name.toLocaleUpperCase(), feature] as const),
    ),
);

/**
 * One availability answer per gated construct in the document.
 *
 * Syntax diagnostics, semantic diagnostics, completion filtering, hover, and signature help used to
 * apply engine and version rules independently, which is how a construct could parse, be offered by
 * completion, and still be reported as unavailable with no explanation. Every consumer now reads
 * the decision made here.
 *
 * `deferred` is a real answer, not a missing one: while the engine is unidentified nothing is
 * declared unavailable, so an unconnected document is never told it cannot run valid T-SQL.
 */
export function buildAvailabilityDecisions(
    syntax: SyntaxSnapshot,
    index: ReadonlyMap<string, readonly SyntaxNode[]>,
    calls: readonly ResolvedCall[] = [],
): readonly FeatureAvailabilityDecision[] {
    const decisions: FeatureAvailabilityDecision[] = [];

    const add = (feature: PlatformFeature, start: number, end: number): void => {
        // One construct, one decision. The node path and the resolved-call path can both recognise
        // the same construct with different spans — the whole expression and just its keyword — so
        // a second decision is dropped whenever the feature is already decided over that text.
        const duplicate = decisions.some(
            (decision) =>
                decision.featureId === feature.id &&
                decision.range.start <= start &&
                end <= decision.range.end,
        );
        if (duplicate) return;
        const status = featureAvailability(feature, syntax.profile);
        const detail = featureAvailabilityDetail(feature, syntax.profile);
        decisions.push(
            Object.freeze({
                featureId: feature.id,
                status,
                range: { start, end },
                ...(detail
                    ? { reason: detail.requirement, detail }
                    : status === "deferred"
                      ? { reason: "The connected engine has not been identified yet." }
                      : {}),
            }) as FeatureAvailabilityDecision,
        );
    };

    for (const nodeName of platformFeatureNodes) {
        for (const node of index.get(nodeName) ?? []) {
            const text = syntax.document.text.slice(node.start, node.end);
            const feature = platformFeatureForNode(nodeName, text);
            if (feature) add(feature, node.start, node.end);
        }
    }

    // A gated construct the grammar also accepts as an ordinary call must still be gated. Several
    // JSON constructors are only distinguishable from a plain `NAME(args)` call by a trailing
    // clause, so keying the decision solely on the node kind lets the plain form escape the gate.
    // The resolved call names the routine either way.
    for (const call of calls) {
        if (call.target.kind !== "builtin") continue;
        const feature = featuresByBuiltIn.get(call.target.name.toLocaleUpperCase());
        if (!feature) continue;
        const range = call.keywordRange ?? call.name?.range ?? call.range;
        add(feature, range.start, range.end);
    }

    return Object.freeze(decisions.sort((left, right) => left.range.start - right.range.start));
}

/** The sentence a hover or signature uses to explain a decision, without re-deriving the rule. */
export function availabilityExplanation(decision: FeatureAvailabilityDecision): string | undefined {
    if (decision.status === "available") return undefined;
    return decision.reason ?? decision.detail?.requirement;
}
