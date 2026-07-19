/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Deterministic Phase-2 developer validation preview. This artifact is an
 * executable contract fixture for the fake runtime: it proves typed Build ->
 * approval -> provision -> deployment preview -> cleanup flow while the fake
 * lane performs no filesystem, DacFx, process, container, network, or SQL
 * work. The local lane can execute the inspection/build prefix separately.
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
            label: "Build DACPAC contract preview",
            kind: "activity",
            activityKind: "dacpac.build",
            inputs: { project: "$params.projectPath" },
        },
        {
            id: "approve-sandbox",
            label: "Approve deterministic sandbox preview",
            kind: "gate",
        },
        {
            id: "provision-sandbox",
            label: "Provision ephemeral target contract preview",
            kind: "activity",
            activityKind: "sandbox.provision",
            inputs: { sandbox: "$params.sandboxName" },
        },
        {
            id: "preview-deploy",
            label: "Preview DACPAC deployment contract",
            kind: "activity",
            activityKind: "dacpac.deploy.preview",
            inputs: {
                dacpac: "$nodes.build-dacpac.artifactPath",
                database: "$nodes.provision-sandbox.connectionRef",
            },
        },
        {
            id: "dispose-sandbox",
            label: "Dispose ephemeral target contract preview",
            kind: "activity",
            activityKind: "sandbox.dispose",
            inputs: { database: "$nodes.provision-sandbox.connectionRef" },
        },
        { id: "report", label: "Summarize developer validation preview", kind: "report" },
    ]);

    const artifact: RunbookArtifactFile = {
        schemaVersion: 1,
        id: "fixture-developer-validation-preview",
        name: "Developer validation chain (deterministic preview)",
        description:
            "Fake-runtime-only contract proof for build, ephemeral target, deployment preview, and cleanup evidence.",
        family: "validate",
        source: {
            schemaVersion: RUNBOOK_SOURCE_SCHEMA_VERSION,
            intent: "Build the database project, approve and provision an isolated target, preview deployment, clean up, and report typed evidence without performing real effects.",
            parameters: [
                {
                    id: "projectPath",
                    label: "Database project path",
                    type: "string",
                    required: true,
                },
                {
                    id: "sandboxName",
                    label: "Sandbox specification",
                    type: "string",
                    required: true,
                    default: "preview-sandbox",
                },
            ],
            requirements: {
                schemaVersion: RUNBOOK_REQUIREMENTS_SCHEMA_VERSION,
                targets: [
                    { kind: "workspace", environment: "local" },
                    { kind: "databaseProject", environment: "local" },
                    { kind: "ephemeralSqlDatabase", environment: "ephemeral" },
                ],
                activities: [
                    requirement("workspace.inspect", "read", "workspaceSnapshot/1"),
                    requirement("dacpac.build", "mutate", "dacpacArtifact/1", {
                        providerRequirement: "execution",
                    }),
                    requirement("sandbox.provision", "mutate", "databaseLease/1", {
                        approvalRequired: true,
                        rollbackContract: "required",
                    }),
                    requirement("dacpac.deploy.preview", "read", "deploymentPreview/1", {
                        connectionRequirement: "provisioned",
                    }),
                    requirement("sandbox.dispose", "mutate", "cleanupEvidence/1", {
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
