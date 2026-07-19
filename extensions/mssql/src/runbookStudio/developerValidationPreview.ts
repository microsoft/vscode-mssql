/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Developer validation chain. The fake lane remains a deterministic contract
 * fixture; the local lane executes the guarded build -> approval -> disposable
 * localhost database -> DacFx report -> cleanup workflow end to end.
 */

import {
    RUNBOOK_LOCK_SCHEMA_VERSION,
    RUNBOOK_REQUIREMENTS_SCHEMA_VERSION,
    RUNBOOK_SOURCE_SCHEMA_VERSION,
    RunbookActivityRequirement,
    RunbookArtifactFile,
    RunbookPlanNode,
} from "../sharedInterfaces/runbookStudio";
import { stampCatalogMetadata } from "./activities/activityCatalog";
import { computePlanHash } from "./runbookArtifact";

function requirement(
    kind: string,
    effect: RunbookActivityRequirement["effect"],
    outputContract: string,
    options: Partial<RunbookActivityRequirement> = {},
): RunbookActivityRequirement {
    return {
        kind,
        version: 1,
        host: "extension",
        effect,
        approvalRequired: false,
        connectionRequirement: "none",
        secretRequirement: "none",
        rollbackContract: "none",
        outputContract,
        ...options,
    };
}

export function createDeveloperValidationPreviewArtifact(): RunbookArtifactFile {
    const nodes: RunbookPlanNode[] = stampCatalogMetadata([
        {
            id: "inspect-workspace",
            label: "Inspect database workspace",
            kind: "activity",
            activityKind: "workspace.inspect",
            inputs: {},
        },
        {
            id: "build-dacpac",
            label: "Build DACPAC",
            kind: "activity",
            activityKind: "dacpac.build",
            inputs: { project: "$params.projectPath" },
        },
        {
            id: "approve-sandbox",
            label: "Approve disposable local database",
            kind: "gate",
        },
        {
            id: "provision-sandbox",
            label: "Provision disposable local database",
            kind: "activity",
            activityKind: "sandbox.provision",
            inputs: { sandbox: "$params.sandboxConnection" },
        },
        {
            id: "preview-deploy",
            label: "Preview DACPAC deployment",
            kind: "activity",
            activityKind: "dacpac.deploy.preview",
            inputs: {
                dacpac: "$nodes.build-dacpac.artifactPath",
                database: "$nodes.provision-sandbox.connectionRef",
            },
        },
        {
            id: "approve-deploy",
            label: "Approve exact DACPAC deployment preview",
            kind: "gate",
        },
        {
            id: "deploy-dacpac",
            label: "Deploy DACPAC to disposable database",
            kind: "activity",
            activityKind: "dacpac.deploy",
            inputs: {
                dacpac: "$nodes.build-dacpac.artifactPath",
                database: "$nodes.provision-sandbox.connectionRef",
                artifactDigest: "$nodes.build-dacpac.artifactSha256",
                previewDigest: "$nodes.preview-deploy.reportSha256",
            },
        },
        {
            id: "verify-schema",
            label: "Verify deployed schema convergence",
            kind: "activity",
            activityKind: "schema.compare",
            inputs: {
                dacpac: "$nodes.build-dacpac.artifactPath",
                database: "$nodes.provision-sandbox.connectionRef",
            },
        },
        {
            id: "run-sql-tests",
            label: "Run SQL validation tests",
            kind: "activity",
            activityKind: "sqltest.run",
            inputs: {
                database: "$nodes.provision-sandbox.connectionRef",
                sql: [
                    "SELECT N'Owned sandbox target' AS test_name,",
                    "CAST(CASE WHEN EXISTS (",
                    "SELECT 1 FROM sys.extended_properties",
                    "WHERE class = 0 AND name = N'RunbookStudioLeaseId'",
                    ") THEN 1 ELSE 0 END AS bit) AS passed,",
                    "N'Runbook Studio ownership marker remains present after deployment' AS message",
                ].join(" "),
            },
        },
        {
            id: "dispose-sandbox",
            label: "Dispose disposable local database",
            kind: "activity",
            activityKind: "sandbox.dispose",
            inputs: { database: "$nodes.provision-sandbox.connectionRef" },
        },
        {
            id: "bundle-evidence",
            label: "Assemble developer validation evidence",
            kind: "activity",
            activityKind: "evidence.bundle",
            inputs: {},
        },
        { id: "report", label: "Summarize developer validation", kind: "report" },
    ]);

    const artifact: RunbookArtifactFile = {
        schemaVersion: 1,
        id: "fixture-developer-validation-preview",
        name: "Developer validation chain",
        description:
            "Build a database project, approve and deploy it to a disposable local database, verify convergence, run SQL assertions, clean up, and retain a content-addressed evidence bundle.",
        family: "validate",
        source: {
            schemaVersion: RUNBOOK_SOURCE_SCHEMA_VERSION,
            intent: "Build the database project, approve and provision an isolated local target, approve the exact deployment preview, deploy, verify schema convergence, run SQL assertions, clean up, and report a typed evidence bundle.",
            parameters: [
                {
                    id: "projectPath",
                    label: "Database project path",
                    type: "string",
                    required: true,
                },
                {
                    id: "sandboxConnection",
                    label: "Local SQL Server connection",
                    type: "connection",
                    required: true,
                },
            ],
            requirements: {
                schemaVersion: RUNBOOK_REQUIREMENTS_SCHEMA_VERSION,
                targets: [
                    { kind: "workspace", environment: "local" },
                    { kind: "databaseProject", environment: "local" },
                    { kind: "sqlDatabase", environment: "ephemeral" },
                    { kind: "ephemeralSqlDatabase", environment: "ephemeral" },
                ],
                activities: [
                    requirement("workspace.inspect", "read", "workspaceSnapshot/1"),
                    requirement("dacpac.build", "mutate", "dacpacArtifact/1", {
                        providerRequirement: "execution",
                    }),
                    requirement("sandbox.provision", "mutate", "databaseLease/1", {
                        approvalRequired: true,
                        connectionRequirement: "required",
                        rollbackContract: "required",
                    }),
                    requirement("dacpac.deploy.preview", "read", "deploymentPreview/1", {
                        connectionRequirement: "provisioned",
                        providerRequirement: "execution",
                    }),
                    requirement("dacpac.deploy", "mutate", "deploymentEvidence/1", {
                        approvalRequired: true,
                        connectionRequirement: "provisioned",
                        providerRequirement: "execution",
                        rollbackContract: "required",
                    }),
                    requirement("schema.compare", "read", "schemaDiff/1", {
                        connectionRequirement: "provisioned",
                        providerRequirement: "execution",
                    }),
                    requirement("sqltest.run", "read", "testResults/1", {
                        connectionRequirement: "provisioned",
                    }),
                    requirement("sandbox.dispose", "mutate", "cleanupEvidence/1", {
                        connectionRequirement: "provisioned",
                        rollbackContract: "automatic",
                    }),
                    requirement("evidence.bundle", "read", "evidenceBundle/1"),
                ],
            },
        },
        lock: {
            schemaVersion: RUNBOOK_LOCK_SCHEMA_VERSION,
            planRevision: "1",
            planHash: "sha256:pending",
            entryNodeId: "inspect-workspace",
            nodes,
            edges: [
                { from: "inspect-workspace", to: "build-dacpac" },
                { from: "build-dacpac", to: "approve-sandbox" },
                { from: "approve-sandbox", to: "provision-sandbox", when: "approved" },
                { from: "provision-sandbox", to: "preview-deploy" },
                { from: "preview-deploy", to: "approve-deploy" },
                { from: "approve-deploy", to: "deploy-dacpac", when: "approved" },
                { from: "approve-deploy", to: "dispose-sandbox", when: "rejected" },
                { from: "deploy-dacpac", to: "verify-schema" },
                { from: "deploy-dacpac", to: "dispose-sandbox", when: "failure" },
                { from: "verify-schema", to: "run-sql-tests" },
                { from: "verify-schema", to: "dispose-sandbox", when: "failure" },
                { from: "run-sql-tests", to: "dispose-sandbox" },
                { from: "run-sql-tests", to: "dispose-sandbox", when: "failure" },
                { from: "dispose-sandbox", to: "bundle-evidence" },
                { from: "dispose-sandbox", to: "bundle-evidence", when: "failure" },
                { from: "bundle-evidence", to: "report" },
            ],
        },
    };
    artifact.lock!.planHash = computePlanHash(artifact.source, artifact.lock!);
    return artifact;
}
