/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    BlastRadius,
    RunbookPlanEdge,
    RunbookPlanNode,
} from "../../../sharedInterfaces/runbookStudio";

export interface PlanStepTrustSummary {
    environment?: BlastRadius["targetEnvironment"];
    operation?: BlastRadius["operation"];
    resource?: BlastRadius["resource"];
    reversibility?: BlastRadius["reversibility"];
    approval?: "gate" | "protected";
}

/** Payload-free projection of compiler-owned safety facts for one Plan card.
 * It never infers safety from labels, SQL text, or runtime messages. */
export function projectPlanStepTrust(
    node: RunbookPlanNode,
    edges: RunbookPlanEdge[],
): PlanStepTrustSummary {
    const approval =
        node.kind === "gate" || node.runtime?.approval
            ? "gate"
            : edges.some((edge) => edge.to === node.id && edge.when === "approved")
              ? "protected"
              : undefined;
    return {
        environment: node.blastRadius?.targetEnvironment,
        operation: node.blastRadius?.operation,
        resource: node.blastRadius?.resource,
        reversibility: node.blastRadius?.reversibility,
        approval,
    };
}

export function humanizePlanTrustToken(value: string): string {
    return value
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[-_]+/g, " ")
        .toLocaleLowerCase();
}

export function planTrustTone(
    kind: "environment" | "effect" | "reversibility" | "approval",
    summary: PlanStepTrustSummary,
): "default" | "ok" | "warn" {
    if (kind === "approval") {
        return summary.approval === "protected" ? "ok" : "warn";
    }
    if (kind === "environment") {
        return summary.environment === "approvedReadOnlyProduction" ? "warn" : "default";
    }
    if (kind === "effect") {
        return summary.operation === "read" || summary.resource === "none" ? "ok" : "default";
    }
    return summary.reversibility === "noEffect" || summary.reversibility === "autoReversible"
        ? "ok"
        : "warn";
}
