/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Family-specific planner contracts. Models receive these rules, but the
 * same rules are enforced after generation so prompt text is never the
 * security or correctness boundary.
 */

import { RunbookArtifactFile, RunbookFamily } from "../../sharedInterfaces/runbookStudio";

export interface FamilyPlannerContract {
    family: RunbookFamily;
    purpose: string;
    operationalActivityKinds: readonly string[];
    helperActivityKinds: readonly string[];
    rules: readonly string[];
}

const BUILD_ACTIVITIES = [
    "git.change-set.inspect",
    "ef.project.discover",
    "ef.relational-model.extract",
    "ef.relational-model.compare",
    "migration.script.generate",
    "migration.apply",
    "migration.scope.validate",
    "migration.data-loss.analyze",
    "workspace.inspect",
    "sqltest.discover",
    "dbproject.create",
    "dbproject.add-object",
    "dacpac.build",
    "dacpac.extract",
    "devdatabase.provision",
    "sql.container.provision",
    "sandbox.provision",
    "dacpac.deploy.preview",
    "dacpac.deploy.dev",
    "dacpac.deploy.container",
    "dacpac.deploy",
    "sql.schema.apply",
    "schema.compare",
    "schema.compare.export",
    "database.schema.inventory",
    "database.schema.visualize",
    "tsqlt.run",
    "sqltest.run",
    "xevent.session.start",
    "sql.workload.generate",
    "sql.workload.inspect",
    "sql.workload.run",
    "xevent.session.stop",
    "xevent.xel.analyze",
    "xevent.xel.collect",
    "database.schema.fingerprint",
    "workload.benchmark",
    "performance.dmv.snapshot",
    "performance.dmv.delta",
    "xevent.capture.reconcile",
    "database.backup",
    "release.manifest.create",
    "release.promote",
    "deployment.reconcile",
    "evidence.bundle",
    "sql.container.dispose",
    "sandbox.dispose",
] as const;

const VALIDATE_ACTIVITIES = [
    "git.change-set.inspect",
    "ef.project.discover",
    "ef.relational-model.extract",
    "ef.relational-model.compare",
    "migration.script.generate",
    "migration.apply",
    "migration.scope.validate",
    "migration.data-loss.analyze",
    "workspace.inspect",
    "sqltest.discover",
    "dacpac.build",
    "dacpac.extract",
    "devdatabase.provision",
    "sql.container.provision",
    "sandbox.provision",
    "dacpac.deploy.preview",
    "dacpac.deploy.dev",
    "dacpac.deploy.container",
    "dacpac.deploy",
    "sql.schema.apply",
    "schema.compare",
    "schema.compare.export",
    "database.schema.inventory",
    "database.schema.visualize",
    "tsqlt.run",
    "sqltest.run",
    "xevent.session.start",
    "sql.workload.generate",
    "sql.workload.inspect",
    "sql.workload.run",
    "xevent.session.stop",
    "xevent.xel.analyze",
    "xevent.xel.collect",
    "database.schema.fingerprint",
    "workload.benchmark",
    "performance.dmv.snapshot",
    "performance.dmv.delta",
    "xevent.capture.reconcile",
    "baseline.compare",
    "database.backup",
    "release.manifest.create",
    "release.promote",
    "deployment.reconcile",
    "security.permissions.validate",
    "connection.auth.diagnose",
    "sql.query.read",
    "evidence.bundle",
    "sql.container.dispose",
    "sandbox.dispose",
] as const;

const INVESTIGATE_ACTIVITIES = [
    "git.change-set.inspect",
    "ef.project.discover",
    "ef.relational-model.extract",
    "ef.relational-model.compare",
    "migration.script.generate",
    "migration.apply",
    "migration.scope.validate",
    "migration.data-loss.analyze",
    "sql.query.read",
    "database.schema.inventory",
    "database.schema.visualize",
    "database.schema.fingerprint",
    "workload.benchmark",
    "performance.dmv.snapshot",
    "performance.dmv.delta",
    "xevent.capture.reconcile",
    "baseline.compare",
    "database.backup",
    "release.manifest.create",
    "release.promote",
    "deployment.reconcile",
    "security.permissions.validate",
    "connection.auth.diagnose",
    "sql.container.provision",
    "xevent.session.start",
    "sql.workload.generate",
    "sql.workload.inspect",
    "sql.workload.run",
    "xevent.session.stop",
    "xevent.xel.analyze",
    "xevent.xel.collect",
    "sandbox.provision",
    "incident.replay.sandbox",
    "evidence.bundle",
    "sql.container.dispose",
    "sandbox.dispose",
] as const;

export const FAMILY_PLANNER_CONTRACTS: Readonly<Record<RunbookFamily, FamilyPlannerContract>> = {
    build: {
        family: "build",
        purpose: "Create or change database source and produce deployable artifacts.",
        operationalActivityKinds: BUILD_ACTIVITIES,
        helperActivityKinds: [],
        rules: [
            "Every create, edit, build, provision, preview, deploy, verify, and cleanup verb must map to its matching registered activity.",
            "A SQL query, report, or prose analysis node must never substitute for a workspace, DacFx, deployment, or cleanup operation.",
            "Deployment requires preview before mutation, and cleanup must follow evidence collection.",
        ],
    },
    validate: {
        family: "validate",
        purpose: "Produce a deterministic pass/fail developer or CI validation verdict.",
        operationalActivityKinds: VALIDATE_ACTIVITIES,
        helperActivityKinds: ["assert.threshold"],
        rules: [
            "Build and deploy only through their typed activities; read queries may gather evidence but cannot stand in for them.",
            "Every check must produce a typed result consumed by a deterministic assertion or final verdict.",
            "Cleanup and evidence publication remain on terminal paths, including failed validation paths.",
        ],
    },
    investigate: {
        family: "investigate",
        purpose: "Gather bounded read evidence, interpret it, and recommend developer actions.",
        operationalActivityKinds: INVESTIGATE_ACTIVITIES,
        helperActivityKinds: ["assert.threshold"],
        rules: [
            "Gather only through registered read or explicitly sandboxed activities.",
            "Analysis and recommendation nodes may interpret typed evidence but may not claim that an unavailable operation ran.",
            "All SQL targets must be explicit and every SQL statement must remain read-only.",
        ],
    },
    composed: {
        family: "composed",
        purpose: "Sequence multiple developer families without weakening any family boundary.",
        operationalActivityKinds: [
            ...new Set([...BUILD_ACTIVITIES, ...VALIDATE_ACTIVITIES, ...INVESTIGATE_ACTIVITIES]),
        ],
        helperActivityKinds: ["assert.threshold"],
        rules: [
            "Preserve each sub-workflow's typed operational activities; do not collapse a Build or Validate phase into investigation prose.",
            "Pass only typed outputs between phases and keep target changes explicit.",
            "Preview and approval precede mutation; evidence precedes cleanup; the final report summarizes actual typed outcomes only.",
            "Route failure paths through owned session stop and target disposal whenever those leases may already exist.",
        ],
    },
};

export function plannerContractFor(family: RunbookFamily): FamilyPlannerContract {
    return FAMILY_PLANNER_CONTRACTS[family];
}

export function describePlannerContract(family: RunbookFamily): string {
    const contract = plannerContractFor(family);
    return [
        `Planner family: ${contract.family}. ${contract.purpose}`,
        `Family activity vocabulary: ${contract.operationalActivityKinds.map((kind) => `"${kind}"`).join(", ")}.`,
        ...contract.rules.map((rule) => `- ${rule}`),
    ].join("\n");
}

/** Post-generation family admission. Catalog validation runs separately;
 * this enforces operational completeness and terminal report semantics. */
export function validateCompiledFamilyContract(artifact: RunbookArtifactFile): string[] {
    const lock = artifact.lock;
    if (!lock) {
        return ["compiled family contract has no lock"];
    }
    const family = artifact.family ?? "investigate";
    const contract = plannerContractFor(family);
    const allowed = new Set([
        ...contract.operationalActivityKinds,
        ...contract.helperActivityKinds,
    ]);
    const activityKinds = lock.nodes
        .filter((node) => node.kind === "activity")
        .map((node) => node.activityKind)
        .filter((kind): kind is string => typeof kind === "string");
    const issues: string[] = [];

    for (const kind of activityKinds) {
        if (!allowed.has(kind)) {
            issues.push(`family '${family}' does not allow activity '${kind}'`);
        }
    }
    const plannedKinds = new Set(activityKinds);
    const requiredKinds = new Set(
        (artifact.source.requirements?.activities ?? []).map((requirement) => requirement.kind),
    );
    for (const requirement of artifact.source.requirements?.activities ?? []) {
        if (!plannedKinds.has(requirement.kind)) {
            issues.push(`required operation '${requirement.kind}' has no executable plan node`);
        }
    }
    if (artifact.source.requirements) {
        const helperKinds = new Set(contract.helperActivityKinds);
        for (const kind of plannedKinds) {
            if (!requiredKinds.has(kind) && !helperKinds.has(kind)) {
                issues.push(`activity '${kind}' is absent from the source capability manifest`);
            }
        }
    }
    if (family === "build" && plannedKinds.has("sql.query.read")) {
        issues.push("build plans cannot substitute sql.query.read for a Build operation");
    }

    const reports = lock.nodes.filter((node) => node.kind === "report");
    if (reports.length !== 1) {
        issues.push(`compiled plan must contain exactly one report node; found ${reports.length}`);
    } else if (lock.edges.some((edge) => edge.from === reports[0].id)) {
        issues.push("the final report node cannot have outgoing edges");
    }
    return issues;
}
