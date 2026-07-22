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
    allowPreviewActivities?: boolean;
    supportedRollbackContracts?: ReadonlyArray<RunbookActivityRequirement["rollbackContract"]>;
    supportedOutputContracts?: readonly string[];
    bindings?: {
        connection?: boolean;
        secret?: boolean;
        provisionedTarget?: boolean;
    };
}

/** Deterministic product policy for the selectable VS Code runtime lanes.
 * The local lane permits only the installed guarded effects: workspace build
 * outputs plus approval-bound disposable localhost database operations. */
export function preflightContextForRuntime(
    runtimeKind: string,
    phase: RunbookPreflightContext["phase"] = "authoring",
): RunbookPreflightContext {
    if (runtimeKind === "fake") {
        return {
            phase,
            host: "extension",
            allowedEffects: ["read", "mutate"],
            approvalSupported: true,
            allowPreviewActivities: true,
            supportedRollbackContracts: ["none", "automatic", "required"],
        };
    }
    if (runtimeKind === "local") {
        return {
            phase,
            host: "extension",
            allowedEffects: ["read", "mutate"],
            approvalSupported: true,
            allowPreviewActivities: false,
            supportedRollbackContracts: ["none", "automatic", "required"],
        };
    }
    return {
        phase,
        allowPreviewActivities: false,
    };
}

interface RequirementDefaults {
    target: RunbookTargetKind;
    effect: RunbookActivityRequirement["effect"];
    approvalRequired?: boolean;
    connectionRequirement?: RunbookActivityRequirement["connectionRequirement"];
    secretRequirement?: RunbookActivityRequirement["secretRequirement"];
    providerRequirement?: RunbookActivityRequirement["providerRequirement"];
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
    "database.schema.inventory": {
        target: "sqlDatabase",
        effect: "read",
        connectionRequirement: "provisioned",
        outputContract: "databaseSchemaInventory/1",
    },
    "database.schema.visualize": {
        target: "sqlDatabase",
        effect: "read",
        connectionRequirement: "required",
        providerRequirement: "execution",
        outputContract: "databaseSchemaGraph/1",
    },
    "workspace.inspect": {
        target: "workspace",
        effect: "read",
        outputContract: "workspaceSnapshot/1",
    },
    "git.change-set.inspect": {
        target: "workspace",
        effect: "read",
        outputContract: "gitChangeSet/1",
    },
    "ef.project.discover": {
        target: "workspace",
        effect: "read",
        outputContract: "efProjectDiscovery/1",
    },
    "ef.relational-model.compare": {
        target: "workspace",
        effect: "read",
        providerRequirement: "execution",
        outputContract: "efModelDiff/1",
    },
    "migration.script.generate": {
        target: "workspace",
        effect: "mutate",
        approvalRequired: true,
        rollbackContract: "required",
        providerRequirement: "execution",
        outputContract: "migrationManifest/1",
    },
    "migration.data-loss.analyze": {
        target: "workspace",
        effect: "read",
        providerRequirement: "execution",
        outputContract: "migrationRisk/1",
    },
    "sqltest.discover": {
        target: "workspace",
        effect: "read",
        outputContract: "testSuiteDiscovery/1",
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
        target: "databaseProject",
        effect: "mutate",
        providerRequirement: "execution",
        outputContract: "dacpacArtifact/1",
    },
    "dacpac.extract": {
        target: "sqlDatabase",
        effect: "mutate",
        connectionRequirement: "required",
        rollbackContract: "automatic",
        outputContract: "dacpacArtifact/1",
    },
    "devdatabase.provision": {
        target: "sqlDatabase",
        effect: "mutate",
        approvalRequired: true,
        connectionRequirement: "required",
        rollbackContract: "automatic",
        outputContract: "databaseLease/1",
    },
    "dacpac.deploy.dev": {
        target: "sqlDatabase",
        effect: "mutate",
        approvalRequired: true,
        connectionRequirement: "required",
        rollbackContract: "required",
        providerRequirement: "execution",
        outputContract: "deploymentEvidence/1",
    },
    "dacpac.deploy.container": {
        target: "ephemeralSqlDatabase",
        effect: "mutate",
        approvalRequired: true,
        connectionRequirement: "provisioned",
        rollbackContract: "required",
        providerRequirement: "execution",
        outputContract: "deploymentEvidence/1",
    },
    "sql.schema.apply": {
        target: "sqlDatabase",
        effect: "mutate",
        approvalRequired: true,
        connectionRequirement: "required",
        rollbackContract: "required",
        outputContract: "schemaMutationEvidence/1",
    },
    "sandbox.provision": {
        target: "ephemeralSqlDatabase",
        effect: "mutate",
        approvalRequired: true,
        connectionRequirement: "required",
        rollbackContract: "required",
        outputContract: "databaseLease/1",
    },
    "sandbox.dispose": {
        target: "ephemeralSqlDatabase",
        effect: "mutate",
        connectionRequirement: "provisioned",
        rollbackContract: "automatic",
        outputContract: "cleanupEvidence/1",
    },
    "dacpac.deploy.preview": {
        target: "sqlDatabase",
        effect: "read",
        connectionRequirement: "required",
        providerRequirement: "execution",
        outputContract: "deploymentPreview/1",
    },
    "dacpac.deploy": {
        target: "ephemeralSqlDatabase",
        effect: "mutate",
        approvalRequired: true,
        connectionRequirement: "provisioned",
        rollbackContract: "required",
        providerRequirement: "execution",
        outputContract: "deploymentEvidence/1",
    },
    "schema.compare": {
        target: "sqlDatabase",
        effect: "read",
        connectionRequirement: "required",
        providerRequirement: "execution",
        outputContract: "schemaDiff/1",
    },
    "schema.compare.export": {
        target: "sqlDatabase",
        effect: "mutate",
        connectionRequirement: "required",
        rollbackContract: "automatic",
        providerRequirement: "execution",
        outputContract: "schemaCompareDocument/1",
    },
    "sql.container.provision": {
        target: "ephemeralSqlDatabase",
        effect: "mutate",
        approvalRequired: true,
        secretRequirement: "requiredAtRunTime",
        rollbackContract: "required",
        outputContract: "databaseLease/1",
    },
    "sql.container.dispose": {
        target: "ephemeralSqlDatabase",
        effect: "mutate",
        connectionRequirement: "provisioned",
        rollbackContract: "automatic",
        outputContract: "cleanupEvidence/1",
    },
    "sql.workload.inspect": {
        target: "workspace",
        effect: "read",
        outputContract: "workloadPreview/1",
    },
    "sql.workload.generate": {
        target: "sqlDatabase",
        effect: "mutate",
        connectionRequirement: "required",
        providerRequirement: "execution",
        rollbackContract: "automatic",
        outputContract: "workloadArtifact/1",
    },
    "xevent.session.start": {
        target: "ephemeralSqlDatabase",
        effect: "mutate",
        approvalRequired: true,
        connectionRequirement: "provisioned",
        rollbackContract: "required",
        outputContract: "xeventSessionLease/1",
    },
    "sql.workload.run": {
        target: "ephemeralSqlDatabase",
        effect: "mutate",
        approvalRequired: true,
        connectionRequirement: "provisioned",
        rollbackContract: "required",
        outputContract: "workloadResults/1",
    },
    "xevent.session.stop": {
        target: "ephemeralSqlDatabase",
        effect: "mutate",
        connectionRequirement: "provisioned",
        rollbackContract: "automatic",
        outputContract: "xeventCapture/1",
    },
    "xevent.xel.collect": {
        target: "ephemeralSqlDatabase",
        effect: "mutate",
        connectionRequirement: "provisioned",
        rollbackContract: "automatic",
        outputContract: "xelArtifact/1",
    },
    "xevent.xel.analyze": {
        target: "ephemeralSqlDatabase",
        effect: "read",
        connectionRequirement: "provisioned",
        providerRequirement: "execution",
        outputContract: "xeventAnalysis/1",
    },
    "workload.benchmark": {
        target: "workspace",
        effect: "read",
        outputContract: "performanceMetrics/1",
    },
    "performance.dmv.snapshot": {
        target: "sqlDatabase",
        effect: "read",
        connectionRequirement: "provisioned",
        providerRequirement: "execution",
        outputContract: "performanceSnapshot/1",
    },
    "xevent.capture.reconcile": {
        target: "ephemeralSqlDatabase",
        effect: "read",
        connectionRequirement: "provisioned",
        providerRequirement: "execution",
        outputContract: "captureIntegrity/1",
    },
    "sqltest.run": {
        target: "sqlDatabase",
        effect: "read",
        connectionRequirement: "required",
        outputContract: "testResults/1",
    },
    "tsqlt.run": {
        target: "ephemeralSqlDatabase",
        effect: "mutate",
        approvalRequired: true,
        connectionRequirement: "provisioned",
        rollbackContract: "automatic",
        outputContract: "testResults/1",
    },
    "baseline.compare": {
        target: "workspace",
        effect: "read",
        outputContract: "regressionComparison/1",
    },
    "database.backup": {
        target: "sqlDatabase",
        effect: "mutate",
        approvalRequired: true,
        connectionRequirement: "required",
        rollbackContract: "automatic",
        providerRequirement: "execution",
        outputContract: "databaseBackup/1",
    },
    "release.manifest.create": {
        target: "workspace",
        effect: "mutate",
        rollbackContract: "automatic",
        outputContract: "releaseManifest/1",
    },
    "release.promote": {
        target: "sqlDatabase",
        effect: "mutate",
        approvalRequired: true,
        connectionRequirement: "required",
        rollbackContract: "required",
        providerRequirement: "execution",
        outputContract: "promotionEvidence/1",
    },
    "deployment.reconcile": {
        target: "sqlDatabase",
        effect: "mutate",
        approvalRequired: true,
        connectionRequirement: "required",
        rollbackContract: "required",
        providerRequirement: "execution",
        outputContract: "reconciliationEvidence/1",
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
        effect: "read",
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
    "git.change-set.inspect": {
        label: "Capture the repository change set",
        description:
            "Resolve the selected base/head refs and retain the exact bounded patch without changing the checkout.",
    },
    "ef.relational-model.compare": {
        label: "Compare the Entity Framework relational models",
        description:
            "Build isolated base/head project snapshots and produce a semantic relational-model delta.",
    },
    "migration.script.generate": {
        label: "Generate the reviewed migration artifact",
        description:
            "Turn the exact semantic model delta and explicit rename decisions into validated forward and rollback evidence.",
    },
    "sqltest.discover": {
        label: "Discover repository SQL tests",
        description:
            "Find bounded repository-owned tSQLt classes and tests without granting database execution authority.",
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
    "dacpac.extract": {
        label: "Extract the source database DACPAC",
        description:
            "Use DacFx against the explicitly bound source database and retain a hashed DACPAC artifact.",
    },
    "devdatabase.provision": {
        label: "Provision the named development database",
        description:
            "Create the requested local database only when the name is absent, mark Runbook Studio ownership, and retain a governed lease.",
    },
    "dacpac.deploy.dev": {
        label: "Deploy to the named development database",
        description:
            "Preview, approve, apply, and record rollback evidence for the explicitly named durable development target.",
    },
    "dacpac.deploy.container": {
        label: "Deploy to the provisioned SQL container",
        description:
            "Apply the approved DACPAC to the ownership-verified database lease returned by container provisioning.",
    },
    "sql.schema.apply": {
        label: "Apply the requested schema change",
        description:
            "Execute the reviewed schema mutation against the explicit target and retain rollback and effect evidence.",
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
    "schema.compare.export": {
        label: "Export the schema comparison artifact",
        description:
            "Retain the complete DacFx comparison report as a hashed file even when differences are expected.",
    },
    "database.schema.inventory": {
        label: "Inventory the deployed schema",
        description:
            "List the deployed user tables, views, and stored procedures in a bounded typed results grid.",
    },
    "database.schema.visualize": {
        label: "Visualize the database schema",
        description:
            "Render a bounded read-only ER diagram from the STS v2 MetadataStore catalog snapshot.",
    },
    "sql.container.provision": {
        label: "Provision the local SQL container",
        description:
            "Create an ownership-labeled local SQL container, wait for readiness, and issue a cleanup lease.",
    },
    "sql.container.dispose": {
        label: "Dispose the local SQL container",
        description: "Remove the ownership-verified container and prove cleanup completed.",
    },
    "sql.workload.inspect": {
        label: "Inspect the SQL workload",
        description:
            "Snapshot and classify the explicitly selected workspace SQL file before approval.",
    },
    "sql.workload.generate": {
        label: "Generate the sampled SQL workload",
        description:
            "Sample the allowlisted source table and retain a reviewable disposable shadow-table workload.",
    },
    "xevent.session.start": {
        label: "Start the XEvent capture",
        description:
            "Create and start an ownership-marked bounded XEvent session before the workload begins.",
    },
    "sql.workload.run": {
        label: "Run the SQL workload",
        description:
            "Execute the explicitly selected repository workload with bounded batches, timeout, cancellation, and measured results.",
    },
    "xevent.session.stop": {
        label: "Stop the XEvent capture",
        description:
            "Stop and remove the owned XEvent session while retaining its server-side capture identity.",
    },
    "xevent.xel.collect": {
        label: "Collect the XEL artifact",
        description:
            "Copy the completed capture into managed evidence and record its path, size, and SHA-256 digest.",
    },
    "xevent.xel.analyze": {
        label: "Analyze the XEvent trace",
        description:
            "Correlate bounded XEL activity to this run and project duration, CPU, reads, writes, rows, and errors.",
    },
    "sqltest.run": {
        label: "Run database tests",
        description:
            "Execute the registered SQL test suite and capture deterministic pass/fail results.",
    },
    "tsqlt.run": {
        label: "Run the approved tSQLt selection",
        description:
            "Execute repository tSQLt procedures only on the owned disposable target and retain typed results.",
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
        label: "Assemble the evidence bundle",
        description:
            "Collect durable build, deployment, test, comparison, and cleanup handles for review or CI export.",
    },
    "sandbox.dispose": {
        label: "Dispose the isolated SQL target",
        description: "Release the ephemeral database and prove that cleanup completed.",
    },
};

/** Family grammars intentionally order cleanup as the last external effect,
 * followed only by evidence aggregation. They never substitute an installed
 * read query for an unavailable operational verb. */
const DESIGN_ACTIVITY_ORDER: Readonly<Record<RunbookFamily, readonly string[]>> = {
    build: [
        "git.change-set.inspect",
        "ef.project.discover",
        "ef.relational-model.compare",
        "migration.script.generate",
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
        "workload.benchmark",
        "baseline.compare",
        "security.permissions.validate",
        "connection.auth.diagnose",
        "incident.replay.sandbox",
        "sql.container.dispose",
        "sandbox.dispose",
        "evidence.bundle",
    ],
    validate: [
        "git.change-set.inspect",
        "ef.project.discover",
        "ef.relational-model.compare",
        "migration.script.generate",
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
        "workload.benchmark",
        "baseline.compare",
        "security.permissions.validate",
        "connection.auth.diagnose",
        "incident.replay.sandbox",
        "sql.query.read",
        "sql.container.dispose",
        "sandbox.dispose",
        "evidence.bundle",
    ],
    investigate: [
        "git.change-set.inspect",
        "ef.project.discover",
        "ef.relational-model.compare",
        "connection.auth.diagnose",
        "sql.query.read",
        "database.schema.inventory",
        "database.schema.visualize",
        "sql.container.provision",
        "xevent.session.start",
        "sql.workload.generate",
        "sql.workload.inspect",
        "sql.workload.run",
        "xevent.session.stop",
        "xevent.xel.analyze",
        "xevent.xel.collect",
        "workload.benchmark",
        "baseline.compare",
        "security.permissions.validate",
        "sandbox.provision",
        "incident.replay.sandbox",
        "sql.container.dispose",
        "sandbox.dispose",
        "evidence.bundle",
    ],
    composed: [
        "git.change-set.inspect",
        "ef.project.discover",
        "ef.relational-model.compare",
        "migration.script.generate",
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
        "sql.query.read",
        "xevent.session.start",
        "sql.workload.generate",
        "sql.workload.inspect",
        "sql.workload.run",
        "xevent.session.stop",
        "xevent.xel.analyze",
        "xevent.xel.collect",
        "workload.benchmark",
        "baseline.compare",
        "security.permissions.validate",
        "connection.auth.diagnose",
        "incident.replay.sandbox",
        "sql.container.dispose",
        "sandbox.dispose",
        "evidence.bundle",
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
        version: findActivity(kind)?.version ?? 1,
        host: "extension",
        effect: defaults.effect,
        approvalRequired: defaults.approvalRequired ?? false,
        connectionRequirement: defaults.connectionRequirement ?? "none",
        secretRequirement: defaults.secretRequirement ?? "none",
        ...(defaults.providerRequirement
            ? { providerRequirement: defaults.providerRequirement }
            : {}),
        rollbackContract: defaults.rollbackContract ?? "none",
        outputContract: defaults.outputContract,
    };
}

/** Fast conservative classifier for the developer scenario families. */
export function classifyRunbookIntent(intent: string): ClassifiedRunbookIntent {
    const text = intent.trim().toLowerCase();
    const requested = new Set<string>();

    const requestsDacpacExtraction = has(
        text,
        /\b(extract|create|generate|make)\b.{0,45}\bdacpac\b.{0,45}\b(from|of)\b|\bdacpac\b.{0,35}\bfrom\b|\b(extract|exact)\b.{0,65}\b(to|into|as)\s+(an?\s+)?dacpac\b/,
    );
    const requestsExistingDacpac =
        has(text, /\b(import|deploy|publish)\b.{0,40}\b(the\s+|an?\s+)?dacpac\b/) &&
        !has(text, /\bbuild\b.{0,30}\bdacpac\b|\bdacpac\b.{0,30}\bbuild\b/);
    const requestsContainer = has(
        text,
        /\b(provision|create|start|spin up|launch)\b.{0,45}\b(sql|mssql)\b.{0,20}\bcontainer\b|\b(sql|mssql)\b.{0,20}\bcontainer\b/,
    );
    const requestsSchemaMutation = has(
        text,
        /\b(create|alter|drop|add)\b.{0,40}\b(tables?|schemas?|foreign keys?|constraints?|indexes?|objects?)\b/,
    );
    const requestsGitChangeSet = has(
        text,
        /\bgit\s+(?:diff|change(?:s| set)?)\b|\b(?:diff|changes?)\b.{0,60}\b(?:branches?|main|development|commits?|repository|repo)\b|\b(?:branches?|main|development)\b.{0,60}\b(?:diff|changes?)\b/,
    );
    const requestsEfModelChange = has(
        text,
        /\b(entity\s*framework|entityframework|ef\s*core|dbcontext|entities)\b.{0,100}\b(diff|changes?|schema|ddl|migration|create|alter|drop)\b|\b(diff|changes?)\b.{0,100}\b(entity\s*framework|entityframework|ef\s*core|dbcontext|entities)\b/,
    );
    const requestsMigrationGeneration =
        requestsEfModelChange &&
        has(text, /\b(ddl|migration|create|alter|drop|update the database)\b/);
    const requestsMigrationRiskAnalysis = has(
        text,
        /\b(data loss|destructive migration|narrow(?:s|ing|ed)?\b.{0,35}\bcolumn|drop(?:s|ping|ped)?\b.{0,35}\btable)\b/,
    );
    const requestsDmvSnapshot = has(
        text,
        /\b(dmvs?|dynamic management views?|dm_os_|dm_exec_|dm_io_)\b/,
    );
    const requestsIncompleteCaptureRecovery = has(
        text,
        /\b(partial|incomplete|interrupted|failed)\b.{0,40}\b(xevent|extended event|xel|capture|trace)\b|\b(xevent|extended event|xel|capture|trace)\b.{0,40}\b(partial|incomplete|interrupted|failed)\b/,
    );
    const requestsReleaseManifest = has(text, /\brelease\s+manifest\b/);
    const requestsDatabaseBackup = has(
        text,
        /\b(back\s*up|backup)\b.{0,40}\b(database|target|staging)\b|\b(database|target|staging)\b.{0,40}\b(back\s*up|backup)\b/,
    );
    const requestsPromotion = has(
        text,
        /\b(promote|promotion)\b|\bdeploy\b.{0,45}\bback\b.{0,35}\b(staging|production)\b/,
    );
    const requestsDeploymentReconciliation = has(
        text,
        /\b(reconcile|rollback|roll back|operator attention|deployment recovery)\b/,
    );
    const requestsProjectAuthoring = has(
        text,
        /\b(database|sql)\s+project\b|\.sqlproj\b|\bproject\b.{0,40}\b(tables?|schemas?|foreign keys?|constraints?|indexes?|objects?)\b/,
    );
    const requestsNamedDatabaseDeployment = has(
        text,
        /\b(deploy|publish|import)\b.{0,35}\b(dacpac|it)\b.{0,20}\b(as|into|to)\b\s+(?!a\s+)?(?:\[[^\]]+\]|[a-z_][a-z0-9_$#@.-]*)/,
    );
    const requestsGeneratedWorkload = has(
        text,
        /\b(generate|create|author)\b.{0,45}\bworkload\b|\bworkload\s+generation\b|\binserts?\b.{0,25}\bdeletes?\b.{0,45}\b(loop|times|iterations?)\b/,
    );
    const requestsWorkload =
        requestsGeneratedWorkload ||
        has(
            text,
            /\b(run|execute|replay)\b.{0,45}\bworkload\b|\bworkload\b.{0,45}\.(sql|tsql)\b|\bworkload\.(sql|tsql)\b/,
        );
    const requestsXevent = has(
        text,
        /\b(xevent|extended events?|xel|server statistics|logical reads?|physical reads?|blocking)\b/,
    );
    const requestsSchemaCompareExport = has(
        text,
        /\b(schema compare|schema diff|diff)\b.{0,120}\b(file|artifact|report|xml|script|output|patch(?:es)?)\b|\bschema deltas?\b.{0,40}\b(diff|patch|output)\b|\b(create|save|export|write|show)\b.{0,35}\b(diff|comparison|deltas?)\b.{0,20}\b(file|artifact|report|xml|script|output|patch(?:es)?)\b/,
    );
    const requestsSchemaInventory = has(
        text,
        /\b(show|list|inventory|enumerate|dump)\b[^.\r\n]{0,65}\b(tables?|views?|stored procedures?|sprocs?|schema objects?)\b|\b(tables?|views?|stored procedures?|sprocs?)\b[^.\r\n]{0,50}\b(show|list|inventory|enumerate|dump)\b/,
    );
    const requestsSchemaVisualization = has(
        text,
        /\b(erd|entity[- ]relationship diagram|schema (diagram|visuali[sz](?:e|ation))|visuali[sz]e (?:the )?(?:database )?schema)\b/,
    );
    const isPreMerge = has(text, /\b(pre[- ]?merge|pull request|ci\/cd|pipeline|quality gate)\b/);
    const hasBuildWork = has(
        text,
        /\b(scaffold|create|author|add|edit)\b.{0,40}\b(database|sql) (project|schema|table|constraint|index)\b|\b(database|sql) project\b|\bdacpac\b|\bdeploy\b/,
    );
    const hasValidationWork = has(
        text,
        /\b(sql tests?|database tests?|t-?sqlt|schema (drift|compare)|benchmark|regression|least privilege|effective access|security gate)\b/,
    );
    const hasInvestigationWork = has(
        text,
        /\b(investigate|diagnos(e|is)|root cause|why|blocking|deadlock|database health)\b/,
    );
    const isBuild = !isPreMerge && hasBuildWork;
    const isValidate =
        isPreMerge ||
        has(
            text,
            /\b(validate|verify|check|tests?|t-?sqlt|regression|benchmark|drift|security|permissions|diagnos(e|is)|replay)\b/,
        );
    const family: RunbookFamily =
        isBuild && (hasValidationWork || hasInvestigationWork)
            ? "composed"
            : isBuild
              ? "build"
              : isValidate
                ? "validate"
                : "investigate";

    if (requestsGitChangeSet) {
        requested.add("git.change-set.inspect");
    }
    if (requestsEfModelChange) {
        requested.add("ef.project.discover");
        requested.add("ef.relational-model.compare");
    }
    if (requestsMigrationGeneration) {
        requested.add("migration.script.generate");
    }
    if (requestsMigrationRiskAnalysis) {
        requested.add("migration.data-loss.analyze");
    }
    if (requestsDmvSnapshot) {
        requested.add("performance.dmv.snapshot");
    }
    if (requestsIncompleteCaptureRecovery) {
        requested.add("xevent.capture.reconcile");
    }
    if (requestsReleaseManifest) {
        requested.add("release.manifest.create");
    }
    if (requestsDatabaseBackup) {
        requested.add("database.backup");
    }
    if (requestsPromotion) {
        requested.add("release.promote");
    }
    if (requestsDeploymentReconciliation) {
        requested.add("deployment.reconcile");
    }

    if (family === "build" || family === "composed") {
        if ((!requestsDacpacExtraction && !requestsExistingDacpac) || requestsProjectAuthoring) {
            requested.add("workspace.inspect");
        }
        if (
            has(
                text,
                /\b(create|scaffold|initialize|new)\b.{0,40}\b(database|sql)?\s*project\b|\bnew\s+\.sqlproj\b/,
            )
        ) {
            requested.add("dbproject.create");
        }
        if (requestsSchemaMutation && requestsProjectAuthoring) {
            requested.add("dbproject.add-object");
        }
        if (
            !requestsDacpacExtraction &&
            !requestsExistingDacpac &&
            has(text, /\b(build|dacpac|deploy)\b/)
        ) {
            requested.add("dacpac.build");
        }
    }
    if (requestsDacpacExtraction) {
        requested.add("dacpac.extract");
    }
    if (requestsSchemaMutation && !requestsProjectAuthoring && !requestsEfModelChange) {
        requested.add("sql.schema.apply");
    }
    if (
        isPreMerge ||
        (!requestsDacpacExtraction && !requestsExistingDacpac && has(text, /\b(build|dacpac)\b/))
    ) {
        requested.add("dacpac.build");
    }
    if (requestsContainer || requestsGeneratedWorkload) {
        requested.add("sql.container.provision");
        requested.add("sql.container.dispose");
    } else if (has(text, /\b(provision|sandbox|scratch|isolated|ephemeral|local target)\b/)) {
        requested.add("sandbox.provision");
        requested.add("sandbox.dispose");
    }
    const requestsDeploymentPreview = has(
        text,
        /\bdeployment\s+(change\s+)?(preview|report|script)\b|\b(preview|dry[- ]?run)\b.{0,30}\bdeploy(ment)?\b|\bwhat (would|will) change\b.{0,30}\bdeploy(ment)?\b/,
    );
    const requestsActualDeployment = text
        .split(/[.;\n]/)
        .some(
            (clause) =>
                (has(clause, /\b(deploy(ed|ing|s)?|deployment|publish)\b/) ||
                    (has(clause, /\bimport\b/) && has(text, /\bdacpac\b/))) &&
                !has(clause, /\b(preview|report|script|dry[- ]?run|what (would|will) change)\b/),
        );
    if (requestsDeploymentPreview) {
        if (has(text, /\b(database|sql) project\b/)) {
            requested.add("dacpac.build");
        }
        requested.add("dacpac.deploy.preview");
    }
    if (requestsActualDeployment) {
        requested.add("dacpac.deploy.preview");
        if (requestsContainer) {
            requested.add("dacpac.deploy.container");
        } else if (requestsNamedDatabaseDeployment) {
            // A named target gets a distinct absent-target-only ownership
            // lease; never substitute the generated disposable sandbox or
            // take ownership of a pre-existing database.
            requested.add("devdatabase.provision");
            requested.add("dacpac.deploy.dev");
        } else {
            requested.add("sandbox.provision");
            requested.add("dacpac.deploy");
            requested.add("sandbox.dispose");
        }
        if (!requestsSchemaCompareExport) {
            requested.add("schema.compare");
        }
    }
    if (requestsSchemaInventory) {
        requested.add(requestsActualDeployment ? "database.schema.inventory" : "sql.query.read");
    }
    if (requestsSchemaVisualization) {
        requested.add("database.schema.visualize");
    }
    if (
        !requestsSchemaCompareExport &&
        (has(text, /\b(schema compare|schema drift|drift|verify deployed schema)\b/) ||
            ((family === "build" || family === "composed") && has(text, /\bverify\b/)))
    ) {
        requested.add("schema.compare");
    }
    if (requestsSchemaCompareExport) {
        requested.add("schema.compare.export");
    }
    if (requestsXevent) {
        requested.add("xevent.session.start");
    }
    if (requestsWorkload) {
        requested.add(requestsGeneratedWorkload ? "sql.workload.generate" : "sql.workload.inspect");
        requested.add("sql.workload.run");
    }
    if (requestsXevent) {
        requested.add("xevent.session.stop");
        requested.add("xevent.xel.analyze");
        requested.add("xevent.xel.collect");
    }
    const requestsTsqlt = has(text, /\b(t-sqlt|tsqlt)\b/);
    if (isPreMerge || has(text, /\b(sql tests?|database tests?)\b/) || requestsTsqlt) {
        requested.add("sqltest.discover");
    }
    if (requestsTsqlt) {
        requested.add("tsqlt.run");
    }
    if (isPreMerge || has(text, /\b(sql tests?|database tests?)\b/)) {
        requested.add("sqltest.run");
    }
    if (
        has(
            text,
            /\b(performance|latency|benchmark|regression|activity metrics?|server statistics)\b/,
        )
    ) {
        requested.add("workload.benchmark");
    }
    if (has(text, /\b(regression|baseline|head[- ]?to[- ]?head)\b/)) {
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
    if (
        (has(text, /\b(evidence|artifact|ci\/cd|pipeline)\b/) ||
            (!requestsDeploymentPreview && has(text, /\breport\b/))) &&
        family !== "investigate"
    ) {
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
    const rollbackContracts = context.supportedRollbackContracts
        ? new Set(context.supportedRollbackContracts)
        : undefined;
    const outputContracts = context.supportedOutputContracts
        ? new Set(context.supportedOutputContracts)
        : undefined;

    for (const requirement of manifest.activities) {
        const installed = findActivity(requirement.kind)!;
        if (installed.previewOnly && context.allowPreviewActivities !== true) {
            incompatible.push(
                readinessIssue(
                    "activity",
                    "activity.previewOnly",
                    requirement,
                    `Activity '${requirement.kind}' is available only in the deterministic preview runtime.`,
                ),
            );
        }
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
            context.providerAvailable === false
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
        if (rollbackContracts && !rollbackContracts.has(requirement.rollbackContract)) {
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
        if (requirement.approvalRequired && context.approvalSupported === false) {
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
    context: RunbookPreflightContext = {},
): PreparedRunbookIntent {
    const classified = classifyRunbookIntent(intent);
    const readiness = preflightRunbookRequirements(classified.requirements, context);
    const blocked = ["designOnly", "policyBlocked", "incompatible"].includes(readiness.status);
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
                ...(blocked ? { design: buildDesignOnlyPlan(classified) } : {}),
            },
            ...(blocked ? { lock: undefined } : {}),
        },
        readiness,
    };
}
