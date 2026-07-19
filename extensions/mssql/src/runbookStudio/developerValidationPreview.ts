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
            id: "dispose-sandbox",
            label: "Dispose disposable local database",
            kind: "activity",
            activityKind: "sandbox.dispose",
            inputs: { database: "$nodes.provision-sandbox.connectionRef" },
        },
        { id: "report", label: "Summarize developer validation", kind: "report" },
    ]);

    const artifact: RunbookArtifactFile = {
        schemaVersion: 1,
        id: "fixture-developer-validation-preview",
        name: "Developer validation chain",
        description:
            "Build a database project, validate its deployment against a disposable local database, and retain typed cleanup evidence.",
        family: "validate",
        source: {
            schemaVersion: RUNBOOK_SOURCE_SCHEMA_VERSION,
            intent: "Build the database project, approve and provision an isolated local target, preview deployment, clean up, and report typed evidence.",
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
                    requirement("sandbox.dispose", "mutate", "cleanupEvidence/1", {
                        connectionRequirement: "provisioned",
                        rollbackContract: "automatic",
                    }),
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
                { from: "preview-deploy", to: "dispose-sandbox" },
                { from: "dispose-sandbox", to: "report" },
            ],
        },
    };
    artifact.lock!.planHash = computePlanHash(artifact.source, artifact.lock!);
    return artifact;
}
