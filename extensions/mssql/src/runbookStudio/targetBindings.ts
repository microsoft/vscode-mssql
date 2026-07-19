/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Admission checks for explicit locked targets. This module is pure so the
 * future headless runner can apply the same rules as the VS Code host.
 */

import {
    RunbookArtifactFile,
    RunbookParameterDefinition,
    RunbookParameterType,
    RunbookPlanNode,
    RunbookTargetKind,
} from "../sharedInterfaces/runbookStudio";
import { findActivity, targetFromCatalog, targetsEqual } from "./activities/activityCatalog";

export type TargetBindingIssueKind =
    | "missingTarget"
    | "catalogMismatch"
    | "manifestMismatch"
    | "parameterMissing"
    | "parameterTypeInvalid"
    | "valueMissing"
    | "producerMissing"
    | "workspaceBindingInvalid";

export interface TargetBindingIssue {
    kind: TargetBindingIssueKind;
    nodeId: string;
    detail: string;
}

const PARAMETER_TYPES_BY_TARGET: Record<RunbookTargetKind, ReadonlySet<RunbookParameterType>> = {
    workspace: new Set(["string"]),
    databaseProject: new Set(["string"]),
    dacpac: new Set(["string"]),
    sqlDatabase: new Set(["connection", "database"]),
    ephemeralSqlDatabase: new Set(["string", "connection", "database"]),
    ciAgent: new Set(["string"]),
};

function requiresTarget(node: RunbookPlanNode): boolean {
    return (
        findActivity(node.activityKind)?.target !== undefined ||
        node.activityKind === "hobbes.native"
    );
}

function parameterById(
    definitions: RunbookParameterDefinition[],
    id: string,
): RunbookParameterDefinition | undefined {
    return definitions.find((definition) => definition.id === id);
}

function hasBoundValue(
    values: Readonly<Record<string, string | number | boolean | null>>,
    id: string,
): boolean {
    const value = values[id];
    return value !== undefined && value !== null && value !== "";
}

/** Validate structural target compatibility plus run-time parameter values.
 * No value is included in an issue, so callers may safely log the result. */
export function validateTargetBindings(
    artifact: RunbookArtifactFile,
    boundValues: Readonly<Record<string, string | number | boolean | null>>,
): TargetBindingIssue[] {
    const lock = artifact.lock;
    if (!lock) {
        return [];
    }
    const issues: TargetBindingIssue[] = [];
    const nodeIds = new Set(lock.nodes.map((node) => node.id));
    const manifestKinds = artifact.source.requirements
        ? new Set(artifact.source.requirements.targets.map((target) => target.kind))
        : undefined;

    for (const node of lock.nodes) {
        if (node.kind !== "activity") {
            continue;
        }
        if (!node.target) {
            if (requiresTarget(node)) {
                issues.push({
                    kind: "missingTarget",
                    nodeId: node.id,
                    detail: `node '${node.id}' has no explicit target`,
                });
            }
            continue;
        }

        const descriptor = findActivity(node.activityKind);
        const expected = descriptor ? targetFromCatalog(node, descriptor) : undefined;
        if (descriptor?.target && (!expected || !targetsEqual(expected, node.target))) {
            issues.push({
                kind: "catalogMismatch",
                nodeId: node.id,
                detail: `node '${node.id}' target does not match the registered activity contract`,
            });
        }
        if (manifestKinds && !manifestKinds.has(node.target.kind)) {
            issues.push({
                kind: "manifestMismatch",
                nodeId: node.id,
                detail: `node '${node.id}' target kind '${node.target.kind}' is absent from the source manifest`,
            });
        }

        const binding = node.target.binding;
        if (binding.source === "parameter") {
            const definition = parameterById(artifact.source.parameters, binding.parameterId);
            if (!definition) {
                issues.push({
                    kind: "parameterMissing",
                    nodeId: node.id,
                    detail: `node '${node.id}' targets unknown parameter '${binding.parameterId}'`,
                });
                continue;
            }
            if (!PARAMETER_TYPES_BY_TARGET[node.target.kind].has(definition.type)) {
                issues.push({
                    kind: "parameterTypeInvalid",
                    nodeId: node.id,
                    detail: `node '${node.id}' target parameter '${binding.parameterId}' has incompatible type '${definition.type}'`,
                });
            }
            if (!hasBoundValue(boundValues, binding.parameterId)) {
                issues.push({
                    kind: "valueMissing",
                    nodeId: node.id,
                    detail: `node '${node.id}' target parameter '${binding.parameterId}' is not bound`,
                });
            }
        } else if (binding.source === "nodeOutput") {
            if (!nodeIds.has(binding.nodeId) || binding.nodeId === node.id) {
                issues.push({
                    kind: "producerMissing",
                    nodeId: node.id,
                    detail: `node '${node.id}' target producer '${binding.nodeId}' is invalid`,
                });
            }
        } else if (
            node.target.kind !== "workspace" &&
            node.target.kind !== "databaseProject" &&
            node.target.kind !== "dacpac"
        ) {
            issues.push({
                kind: "workspaceBindingInvalid",
                nodeId: node.id,
                detail: `node '${node.id}' cannot use a workspace binding for '${node.target.kind}'`,
            });
        }
    }
    return issues;
}
