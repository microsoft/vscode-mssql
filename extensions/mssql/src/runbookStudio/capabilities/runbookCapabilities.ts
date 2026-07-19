/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Model-free intent routing and capability admission. This deliberately
 * recognizes only strong developer-workflow signals. Unknown prose stays in
 * the investigate family; an operational verb is never silently translated
 * into a SQL read activity just because that is what happens to be installed.
 */

import {
    RbsRunbookReadiness,
    RunbookActivityRequirement,
    RunbookArtifactFile,
    RunbookCapabilityManifest,
    RunbookFamily,
    RunbookTargetKind,
    RUNBOOK_REQUIREMENTS_SCHEMA_VERSION,
} from "../../sharedInterfaces/runbookStudio";
import { findActivity } from "../activities/activityCatalog";

export interface ClassifiedRunbookIntent {
    family: RunbookFamily;
    requirements: RunbookCapabilityManifest;
}

export interface PreparedRunbookIntent {
    artifact: RunbookArtifactFile;
    readiness: RbsRunbookReadiness;
}

interface RequirementDefaults {
    target: RunbookTargetKind;
    effect: RunbookActivityRequirement["effect"];
    approvalRequired?: boolean;
    connectionRequirement?: RunbookActivityRequirement["connectionRequirement"];
    secretRequirement?: RunbookActivityRequirement["secretRequirement"];
    rollbackContract?: RunbookActivityRequirement["rollbackContract"];
    outputContract: string;
}

const REQUIREMENT_DEFAULTS: Readonly<Record<string, RequirementDefaults>> = {
    "sql.query.read": {
        target: "sqlDatabase",
        effect: "read",
        connectionRequirement: "required",
        outputContract: "rowset/1",
    },
    "workspace.inspect": {
        target: "workspace",
        effect: "read",
        outputContract: "workspaceSnapshot/1",
    },
    "dbproject.create": {
        target: "databaseProject",
        effect: "mutate",
        rollbackContract: "automatic",
        outputContract: "databaseProject/1",
    },
    "dbproject.add-object": {
        target: "databaseProject",
        effect: "mutate",
        rollbackContract: "automatic",
        outputContract: "databaseProjectChange/1",
    },
    "dacpac.build": {
        target: "dacpac",
        effect: "mutate",
        outputContract: "dacpacArtifact/1",
    },
    "sandbox.provision": {
        target: "ephemeralSqlDatabase",
        effect: "mutate",
        approvalRequired: true,
        rollbackContract: "required",
        outputContract: "databaseLease/1",
    },
    "sandbox.dispose": {
        target: "ephemeralSqlDatabase",
        effect: "mutate",
        rollbackContract: "automatic",
        outputContract: "cleanupEvidence/1",
    },
    "dacpac.deploy.preview": {
        target: "ephemeralSqlDatabase",
        effect: "read",
        connectionRequirement: "provisioned",
        outputContract: "deploymentPreview/1",
    },
    "dacpac.deploy": {
        target: "ephemeralSqlDatabase",
        effect: "mutate",
        approvalRequired: true,
        connectionRequirement: "provisioned",
        rollbackContract: "required",
        outputContract: "deploymentEvidence/1",
    },
    "schema.compare": {
        target: "sqlDatabase",
        effect: "read",
        connectionRequirement: "required",
        outputContract: "schemaDiff/1",
    },
    "sqltest.run": {
        target: "sqlDatabase",
        effect: "read",
        connectionRequirement: "required",
        outputContract: "testResults/1",
    },
    "workload.benchmark": {
        target: "sqlDatabase",
        effect: "read",
        connectionRequirement: "required",
        outputContract: "benchmarkResults/1",
    },
    "baseline.compare": {
        target: "workspace",
        effect: "read",
        outputContract: "regressionComparison/1",
    },
    "security.permissions.validate": {
        target: "sqlDatabase",
        effect: "read",
        connectionRequirement: "required",
        outputContract: "permissionFindings/1",
    },
    "connection.auth.diagnose": {
        target: "sqlDatabase",
        effect: "read",
        connectionRequirement: "required",
        secretRequirement: "requiredAtRunTime",
        outputContract: "connectionDiagnostics/1",
    },
    "incident.replay.sandbox": {
        target: "ephemeralSqlDatabase",
        effect: "mutate",
        approvalRequired: true,
        rollbackContract: "required",
        outputContract: "replayEvidence/1",
    },
    "evidence.bundle": {
        target: "workspace",
        effect: "mutate",
        rollbackContract: "automatic",
        outputContract: "evidenceBundle/1",
    },
};

function has(text: string, expression: RegExp): boolean {
    return expression.test(text);
}

function requirement(kind: string): RunbookActivityRequirement {
    const defaults = REQUIREMENT_DEFAULTS[kind];
    if (!defaults) {
        throw new Error(`missing requirement metadata for '${kind}'`);
    }
    return {
        kind,
        version: 1,
        host: "extension",
        effect: defaults.effect,
        approvalRequired: defaults.approvalRequired ?? false,
        connectionRequirement: defaults.connectionRequirement ?? "none",
        secretRequirement: defaults.secretRequirement ?? "none",
        rollbackContract: defaults.rollbackContract ?? "none",
        outputContract: defaults.outputContract,
    };
}

/** Fast conservative classifier for the developer scenario families. */
export function classifyRunbookIntent(intent: string): ClassifiedRunbookIntent {
    const text = intent.trim().toLowerCase();
    const requested = new Set<string>();

    const isPreMerge = has(text, /\b(pre[- ]?merge|pull request|ci\/cd|pipeline|quality gate)\b/);
    const isBuild =
        !isPreMerge &&
        has(
            text,
            /\b(scaffold|create|author|add|edit)\b.{0,40}\b(database|sql) (project|schema|table|constraint|index)\b|\b(database|sql) project\b|\bdacpac\b|\bdeploy\b/,
        );
    const isValidate =
        isPreMerge ||
        has(
            text,
            /\b(validate|verify|check|test|regression|benchmark|drift|security|permissions|diagnos(e|is)|replay)\b/,
        );
    const family: RunbookFamily = isBuild ? "build" : isValidate ? "validate" : "investigate";

    if (family === "build") {
        requested.add("workspace.inspect");
        if (has(text, /\b(project|scaffold)\b/)) requested.add("dbproject.create");
        if (has(text, /\b(tables?|schemas?|foreign keys?|constraints?|indexes?|objects?)\b/)) {
            requested.add("dbproject.add-object");
        }
        if (has(text, /\b(build|dacpac|deploy)\b/)) requested.add("dacpac.build");
    }
    if (isPreMerge || has(text, /\b(build|dacpac)\b/)) requested.add("dacpac.build");
    if (has(text, /\b(provision|sandbox|scratch|isolated|ephemeral|local target)\b/)) {
        requested.add("sandbox.provision");
        requested.add("sandbox.dispose");
    }
    if (has(text, /\bdeploy(ment|ed)?\b/)) {
        requested.add("dacpac.deploy.preview");
        requested.add("dacpac.deploy");
    }
    if (
        has(text, /\b(schema compare|schema drift|drift|verify deployed schema)\b/) ||
        (family === "build" && has(text, /\bverify\b/))
    ) {
        requested.add("schema.compare");
    }
    if (isPreMerge || has(text, /\b(t-sqlt|tsqlt|sql test|database test)\b/)) {
        requested.add("sqltest.run");
    }
    if (has(text, /\b(performance|latency|benchmark|regression)\b/)) {
        requested.add("workload.benchmark");
        requested.add("baseline.compare");
    }
    if (has(text, /\b(permission|least privilege|effective access|security)\b/)) {
        requested.add("security.permissions.validate");
    }
    if (
        has(
            text,
            /\b(connection|authentication|login|firewall|tls)\b.{0,30}\b(diagnos(e|is)|failure|problem|issue)\b/,
        )
    ) {
        requested.add("connection.auth.diagnose");
    }
    if (has(text, /\b(replay|reproduce)\b.{0,40}\b(production|incident)\b/)) {
        requested.add("incident.replay.sandbox");
    }
    if (has(text, /\b(evidence|artifact|report|ci\/cd|pipeline)\b/) && family !== "investigate") {
        requested.add("evidence.bundle");
    }
    if (requested.size === 0) {
        requested.add("sql.query.read");
    }

    const activities = [...requested].map(requirement);
    const targetKinds = new Set(activities.map((item) => REQUIREMENT_DEFAULTS[item.kind].target));
    return {
        family,
        requirements: {
            schemaVersion: RUNBOOK_REQUIREMENTS_SCHEMA_VERSION,
            targets: [...targetKinds].map((kind) => ({
                kind,
                environment: kind === "ephemeralSqlDatabase" ? "ephemeral" : "development",
            })),
            activities,
        },
    };
}

/** Installed-catalog preflight used both before planning and at admission. */
export function preflightRunbookRequirements(
    manifest: RunbookCapabilityManifest | undefined,
): RbsRunbookReadiness {
    if (!manifest) {
        return { status: "ready", missingActivityKinds: [] };
    }
    const missingActivityKinds = manifest.activities
        .filter((requirement) => {
            const installed = findActivity(requirement.kind);
            return installed === undefined || installed.version < requirement.version;
        })
        .map((requirement) => `${requirement.kind}@${requirement.version}`);
    if (missingActivityKinds.length > 0) {
        return { status: "designOnly", missingActivityKinds };
    }
    const needsBinding = manifest.activities.some(
        (requirement) => requirement.connectionRequirement === "required",
    );
    return {
        status: needsBinding ? "readyAfterBinding" : "ready",
        missingActivityKinds: [],
    };
}

/** Apply deterministic routing metadata to an artifact. Design-only intent
 *  always drops an older lock so source and executable state cannot diverge. */
export function prepareRunbookIntent(
    current: RunbookArtifactFile,
    intent: string,
): PreparedRunbookIntent {
    const classified = classifyRunbookIntent(intent);
    const readiness = preflightRunbookRequirements(classified.requirements);
    return {
        artifact: {
            ...current,
            family: classified.family,
            source: {
                ...current.source,
                intent,
                requirements: classified.requirements,
            },
            ...(readiness.status === "designOnly" ? { lock: undefined } : {}),
        },
        readiness,
    };
}
