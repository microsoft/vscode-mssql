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
    RbsReadinessIssue,
    RunbookActivityRequirement,
    RunbookArtifactFile,
    RunbookCapabilityManifest,
    RunbookDesignPlan,
    RunbookFamily,
    RunbookTargetKind,
    RUNBOOK_REQUIREMENTS_SCHEMA_VERSION,
    RUNBOOK_DESIGN_SCHEMA_VERSION,
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

/** Host/policy/binding facts supplied by an authoring surface or run host.
 * Omitted facts remain "not yet bound" rather than being guessed. */
export interface RunbookPreflightContext {
    phase?: "authoring" | "admission";
    host?: RunbookActivityRequirement["host"];
    hostVersion?: string;
    providerAvailable?: boolean;
    allowedEffects?: ReadonlyArray<RunbookActivityRequirement["effect"]>;
    availableTargetKinds?: ReadonlyArray<RunbookTargetKind>;
    approvalSupported?: boolean;
    supportedRollbackContracts?: ReadonlyArray<RunbookActivityRequirement["rollbackContract"]>;
    supportedOutputContracts?: readonly string[];
    bindings?: {
        connection?: boolean;
        secret?: boolean;
        provisionedTarget?: boolean;
    };
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

const DESIGN_COPY: Readonly<Record<string, { label: string; description: string }>> = {
    "sql.query.read": {
        label: "Inspect the target database",
        description: "Run the bounded read-only SQL checks needed to gather current evidence.",
    },
    "workspace.inspect": {
        label: "Inspect the workspace",
        description: "Discover the existing database projects, source files, and build inputs.",
    },
    "dbproject.create": {
        label: "Create the database project",
        description: "Scaffold the project structure and its deterministic build configuration.",
    },
    "dbproject.add-object": {
        label: "Author the requested schema objects",
        description: "Add the tables, keys, constraints, indexes, and other project-owned objects.",
    },
    "dacpac.build": {
        label: "Build the DACPAC",
        description: "Compile the database project and retain the build diagnostics and artifact.",
    },
    "sandbox.provision": {
        label: "Provision an isolated SQL target",
        description: "Create a bounded ephemeral database and record its cleanup lease.",
    },
    "dacpac.deploy.preview": {
        label: "Preview the deployment",
        description:
            "Generate the deployment report and script for review before applying changes.",
    },
    "dacpac.deploy": {
        label: "Deploy to the isolated target",
        description: "Apply the approved DACPAC change to the explicitly provisioned database.",
    },
    "schema.compare": {
        label: "Verify the deployed schema",
        description: "Compare the expected project model with the target and report any drift.",
    },
    "sqltest.run": {
        label: "Run database tests",
        description:
            "Execute the registered SQL test suite and capture deterministic pass/fail results.",
    },
    "workload.benchmark": {
        label: "Run the workload benchmark",
        description:
            "Execute the bounded workload and capture latency, throughput, and error evidence.",
    },
    "baseline.compare": {
        label: "Compare with the approved baseline",
        description:
            "Detect statistically meaningful regressions against versioned baseline evidence.",
    },
    "security.permissions.validate": {
        label: "Validate effective permissions",
        description: "Check the target access model against the requested least-privilege policy.",
    },
    "connection.auth.diagnose": {
        label: "Diagnose connection and authentication",
        description:
            "Test the bound target's authentication, TLS, firewall, and login prerequisites.",
    },
    "incident.replay.sandbox": {
        label: "Replay the incident in isolation",
        description:
            "Reproduce the captured incident against a disposable target with bounded effects.",
    },
    "evidence.bundle": {
        label: "Publish the evidence bundle",
        description:
            "Collect build, deployment, test, comparison, and cleanup evidence for review or CI.",
    },
    "sandbox.dispose": {
        label: "Dispose the isolated SQL target",
        description: "Release the ephemeral database and prove that cleanup completed.",
    },
};

/** Family grammars intentionally order cleanup last and never substitute an
 * installed read query for an unavailable operational verb. */
const DESIGN_ACTIVITY_ORDER: Readonly<Record<RunbookFamily, readonly string[]>> = {
    build: [
        "workspace.inspect",
        "dbproject.create",
        "dbproject.add-object",
        "dacpac.build",
        "sandbox.provision",
        "dacpac.deploy.preview",
        "dacpac.deploy",
        "schema.compare",
        "sqltest.run",
        "workload.benchmark",
        "baseline.compare",
        "security.permissions.validate",
        "connection.auth.diagnose",
        "incident.replay.sandbox",
        "evidence.bundle",
        "sandbox.dispose",
    ],
    validate: [
        "workspace.inspect",
        "dacpac.build",
        "sandbox.provision",
        "dacpac.deploy.preview",
        "dacpac.deploy",
        "schema.compare",
        "sqltest.run",
        "workload.benchmark",
        "baseline.compare",
        "security.permissions.validate",
        "connection.auth.diagnose",
        "incident.replay.sandbox",
        "sql.query.read",
        "evidence.bundle",
        "sandbox.dispose",
    ],
    investigate: [
        "connection.auth.diagnose",
        "sql.query.read",
        "workload.benchmark",
        "baseline.compare",
        "security.permissions.validate",
        "sandbox.provision",
        "incident.replay.sandbox",
        "evidence.bundle",
        "sandbox.dispose",
    ],
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
    context: RunbookPreflightContext = {},
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
        return {
            status: "designOnly",
            missingActivityKinds,
            issues: missingActivityKinds.map((activityKind) => ({
                dimension: "activity",
                code: "activity.missingOrOutdated",
                message: `Required activity '${activityKind}' is not installed at a compatible version.`,
                activityKind,
            })),
        };
    }

    const issues: RbsReadinessIssue[] = [];
    const incompatible: RbsReadinessIssue[] = [];
    const policyBlocked: RbsReadinessIssue[] = [];
    const bindingRequired: RbsReadinessIssue[] = [];
    const availableTargets = context.availableTargetKinds
        ? new Set(context.availableTargetKinds)
        : undefined;
    const allowedEffects = context.allowedEffects ? new Set(context.allowedEffects) : undefined;
    const rollbackContracts = new Set(context.supportedRollbackContracts ?? ["none"]);
    const outputContracts = context.supportedOutputContracts
        ? new Set(context.supportedOutputContracts)
        : undefined;

    for (const requirement of manifest.activities) {
        const installed = findActivity(requirement.kind)!;
        if (context.host && requirement.host !== context.host) {
            incompatible.push(
                readinessIssue(
                    "host",
                    "host.unsupported",
                    requirement,
                    `Activity '${requirement.kind}' requires the ${requirement.host} host; current host is ${context.host}.`,
                ),
            );
        }
        if (
            requirement.minimumHostVersion &&
            (!context.hostVersion ||
                compareVersions(context.hostVersion, requirement.minimumHostVersion) < 0)
        ) {
            incompatible.push(
                readinessIssue(
                    "host",
                    "host.versionIncompatible",
                    requirement,
                    `Activity '${requirement.kind}' requires host ${requirement.minimumHostVersion} or newer.`,
                ),
            );
        }
        if (
            requirement.providerRequirement &&
            requirement.providerRequirement !== "none" &&
            context.providerAvailable !== true
        ) {
            incompatible.push(
                readinessIssue(
                    "provider",
                    "provider.unavailable",
                    requirement,
                    `Activity '${requirement.kind}' requires a ${requirement.providerRequirement} provider that is not ready.`,
                ),
            );
        }
        if (installed.outputContract !== requirement.outputContract) {
            incompatible.push(
                readinessIssue(
                    "output",
                    "output.contractIncompatible",
                    requirement,
                    `Activity '${requirement.kind}' produces '${installed.outputContract}', not required '${requirement.outputContract}'.`,
                ),
            );
        } else if (outputContracts && !outputContracts.has(requirement.outputContract)) {
            incompatible.push(
                readinessIssue(
                    "output",
                    "output.rendererUnavailable",
                    requirement,
                    `Output contract '${requirement.outputContract}' is not supported by this host.`,
                ),
            );
        }
        if (!rollbackContracts.has(requirement.rollbackContract)) {
            incompatible.push(
                readinessIssue(
                    "rollback",
                    "rollback.executorUnavailable",
                    requirement,
                    `Activity '${requirement.kind}' requires '${requirement.rollbackContract}' rollback support.`,
                ),
            );
        }
        if (allowedEffects && !allowedEffects.has(requirement.effect)) {
            policyBlocked.push(
                readinessIssue(
                    "policy",
                    "policy.effectDenied",
                    requirement,
                    `Policy denies the '${requirement.effect}' effect required by '${requirement.kind}'.`,
                ),
            );
        }
        if (requirement.approvalRequired && context.approvalSupported !== true) {
            policyBlocked.push(
                readinessIssue(
                    "approval",
                    "approval.unavailable",
                    requirement,
                    `Activity '${requirement.kind}' requires an approval provider.`,
                ),
            );
        }
        if (
            requirement.connectionRequirement === "required" &&
            context.bindings?.connection !== true
        ) {
            bindingRequired.push(
                readinessIssue(
                    "binding",
                    "binding.connectionRequired",
                    requirement,
                    `Activity '${requirement.kind}' needs a bound SQL connection.`,
                ),
            );
        }
        if (
            requirement.connectionRequirement === "provisioned" &&
            context.bindings?.provisionedTarget !== true
        ) {
            bindingRequired.push(
                readinessIssue(
                    "binding",
                    "binding.provisionedTargetRequired",
                    requirement,
                    `Activity '${requirement.kind}' needs a provisioned database target.`,
                ),
            );
        }
        if (
            requirement.secretRequirement === "requiredAtRunTime" &&
            context.bindings?.secret !== true
        ) {
            bindingRequired.push(
                readinessIssue(
                    "binding",
                    "binding.secretRequired",
                    requirement,
                    `Activity '${requirement.kind}' needs a run-time secret binding.`,
                ),
            );
        }
    }

    if (availableTargets) {
        for (const target of manifest.targets) {
            if (!availableTargets.has(target.kind)) {
                const issue: RbsReadinessIssue = {
                    dimension: "target",
                    code: "target.unavailable",
                    message: `Target kind '${target.kind}' is not available in this host.`,
                };
                (context.phase === "admission" ? incompatible : bindingRequired).push(issue);
            }
        }
    }

    issues.push(...incompatible, ...policyBlocked, ...bindingRequired);
    return {
        status:
            incompatible.length > 0
                ? "incompatible"
                : policyBlocked.length > 0
                  ? "policyBlocked"
                  : bindingRequired.length > 0
                    ? "readyAfterBinding"
                    : "ready",
        missingActivityKinds: [],
        ...(issues.length > 0 ? { issues } : {}),
    };
}

function readinessIssue(
    dimension: RbsReadinessIssue["dimension"],
    code: string,
    requirement: RunbookActivityRequirement,
    message: string,
): RbsReadinessIssue {
    return { dimension, code, message, activityKind: `${requirement.kind}@${requirement.version}` };
}

/** Numeric dotted-version comparison; prerelease labels compare as their
 * numeric base because the contract only expresses a minimum host release. */
function compareVersions(actual: string, minimum: string): number {
    const parts = (value: string) =>
        value
            .split(/[.-]/)
            .map((part) => Number.parseInt(part, 10))
            .filter((part) => Number.isFinite(part));
    const left = parts(actual);
    const right = parts(minimum);
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index++) {
        const difference = (left[index] ?? 0) - (right[index] ?? 0);
        if (difference !== 0) {
            return difference;
        }
    }
    return 0;
}

/** Produce a deterministic, family-ordered review outline. The outline is
 * source material only: no inputs, bindings, gates, or executable lock. */
export function buildDesignOnlyPlan(classified: ClassifiedRunbookIntent): RunbookDesignPlan {
    const priority = DESIGN_ACTIVITY_ORDER[classified.family];
    const priorityOf = (kind: string) => {
        const index = priority.indexOf(kind);
        return index < 0 ? Number.MAX_SAFE_INTEGER : index;
    };
    const ordered = [...classified.requirements.activities].sort(
        (left, right) => priorityOf(left.kind) - priorityOf(right.kind),
    );
    let previousId: string | undefined;
    const steps = ordered.map((activity) => {
        const copy = DESIGN_COPY[activity.kind];
        const defaults = REQUIREMENT_DEFAULTS[activity.kind];
        if (!copy || !defaults) {
            throw new Error(`missing design grammar for '${activity.kind}'`);
        }
        const id = `design-${activity.kind.replace(/[^A-Za-z0-9_-]/g, "-")}`;
        const step = {
            id,
            label: copy.label,
            description: copy.description,
            activityKind: activity.kind,
            activityVersion: activity.version,
            targetKind: defaults.target,
            dependsOn: previousId ? [previousId] : [],
        };
        previousId = id;
        return step;
    });
    return {
        schemaVersion: RUNBOOK_DESIGN_SCHEMA_VERSION,
        family: classified.family,
        steps,
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
    const sourceWithoutDesign = { ...current.source };
    delete sourceWithoutDesign.design;
    return {
        artifact: {
            ...current,
            family: classified.family,
            source: {
                ...sourceWithoutDesign,
                intent,
                requirements: classified.requirements,
                ...(readiness.status === "designOnly"
                    ? { design: buildDesignOnlyPlan(classified) }
                    : {}),
            },
            ...(readiness.status === "designOnly" ? { lock: undefined } : {}),
        },
        readiness,
    };
}
