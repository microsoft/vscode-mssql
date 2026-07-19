/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Resolve a Plan-page SQL activity into the narrow Query Studio launch
 * contract. This is deliberately pure: the webview sends only a node id and
 * opaque connection-parameter values; the extension host re-reads the SQL
 * from the compiled lock and never trusts executable text from the page.
 */

import { RunbookArtifactFile } from "../sharedInterfaces/runbookStudio";
import { isReadOnlySql } from "./readOnlySql";

export type PlanQueryLaunchFailure =
    | "nodeNotFound"
    | "notReadQuery"
    | "sqlMissing"
    | "sqlNotReadOnly"
    | "connectionBindingInvalid"
    | "connectionParameterInvalid"
    | "connectionValueMissing";

export type PlanQueryLaunchResolution =
    | {
          ok: true;
          sql: string;
          profileId: string;
          connectionParameterId: string;
      }
    | {
          ok: false;
          reason: PlanQueryLaunchFailure;
          connectionParameterLabel?: string;
      };

const PARAMETER_BIND = /^\$params\.([A-Za-z0-9_-]+)$/;

/**
 * Resolve only registered read-query nodes. Literal/ambient connections are
 * refused: portable runbooks bind an explicit connection parameter whose
 * value is an opaque saved-profile id supplied at interaction time.
 */
export function resolvePlanQueryLaunch(
    artifact: RunbookArtifactFile,
    nodeId: string,
    connectionValues: Readonly<Record<string, string | undefined>>,
): PlanQueryLaunchResolution {
    const node = artifact.lock?.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) {
        return { ok: false, reason: "nodeNotFound" };
    }
    if (node.kind !== "activity" || node.activityKind !== "sql.query.read") {
        return { ok: false, reason: "notReadQuery" };
    }

    const sql = node.inputs?.sql;
    if (typeof sql !== "string" || sql.trim().length === 0) {
        return { ok: false, reason: "sqlMissing" };
    }
    if (!isReadOnlySql(sql)) {
        return { ok: false, reason: "sqlNotReadOnly" };
    }

    const target = node.target;
    if (
        target?.kind !== "sqlDatabase" ||
        target.binding.source !== "parameter" ||
        !target.binding.parameterId
    ) {
        return { ok: false, reason: "connectionBindingInvalid" };
    }
    const connectionParameterId = target.binding.parameterId;
    const connection = node.inputs?.connection;
    const parameterMatch =
        typeof connection === "string" ? PARAMETER_BIND.exec(connection) : undefined;
    if (!parameterMatch || parameterMatch[1] !== connectionParameterId) {
        return { ok: false, reason: "connectionBindingInvalid" };
    }
    const definition = artifact.source.parameters.find(
        (parameter) => parameter.id === connectionParameterId,
    );
    if (!definition || definition.type !== "connection") {
        return { ok: false, reason: "connectionParameterInvalid" };
    }
    const profileId = connectionValues[connectionParameterId] ?? definition.default;
    if (typeof profileId !== "string" || profileId.trim().length === 0) {
        return {
            ok: false,
            reason: "connectionValueMissing",
            connectionParameterLabel: definition.label,
        };
    }
    return {
        ok: true,
        sql,
        profileId,
        connectionParameterId,
    };
}
