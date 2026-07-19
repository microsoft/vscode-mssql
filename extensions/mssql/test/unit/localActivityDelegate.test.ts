/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { RunbookPlanNode } from "../../src/sharedInterfaces/runbookStudio";
import {
    LocalActivityError,
    LocalSqlActivityDelegate,
    LocalSqlOperations,
} from "../../src/runbookStudio/runtime/localSqlDelegate";
import { buildLocalDeploymentPreviewResult } from "../../src/runbookStudio/runtime/localDeveloperOperations";

function operations(overrides: Partial<LocalSqlOperations> = {}): LocalSqlOperations {
    return {
        connect: async () => true,
        execute: async () => ({ rowCount: 0, columnInfo: [], rows: [] }),
        disconnect: async () => undefined,
        inspectWorkspace: async () => ({
            workspaceFolderCount: 1,
            projectPaths: ["C:\\repo\\B.sqlproj", "C:\\repo\\A.sqlproj"],
        }),
        buildDacpac: async (projectPath) => ({
            projectPath,
            artifactPath: "C:\\repo\\bin\\Debug\\A.dacpac",
            artifactSizeBytes: 2048,
            artifactSha256: "a".repeat(64),
            diagnosticCount: 2,
            builtAtUtc: "2026-07-19T20:00:00.000Z",
        }),
        previewDacpacDeployment: async (dacpacPath) => ({
            dacpacPath,
            targetDatabase: "RunbookTarget",
            operationId: "preview-op",
            changeCount: 4,
            alertCount: 1,
            operationSummary: "Alter: 1; Create: 3",
            reportSha256: "c".repeat(64),
            reportXml: "<DeploymentReport />",
            reportTruncated: false,
            generatedAtUtc: "2026-07-19T20:02:00.000Z",
        }),
        ...overrides,
    };
}

function binding(resolveBind: (input: unknown) => unknown = (input) => input) {
    return {
        parameterValues: {},
        resolveBind,
        isCancellationRequested: () => false,
        invocation: {
            runId: "run-1",
            planRevision: "1",
            planHash: "sha256:plan",
            attempt: 1,
        },
    };
}

function activity(activityKind: string, inputs: Record<string, unknown> = {}): RunbookPlanNode {
    return {
        id: activityKind,
        label: activityKind,
        kind: "activity",
        activityKind,
        inputs,
    };
}

suite("Runbook Studio local activity delegate", () => {
    test("workspace inspection emits bounded, stably ordered local evidence", async () => {
        const delegate = new LocalSqlActivityDelegate(
            operations({
                inspectWorkspace: async () => ({
                    workspaceFolderCount: 2,
                    projectPaths: ["C:\\repo\\B.sqlproj", "C:\\repo\\A.sqlproj"],
                    truncated: true,
                }),
            }),
        );

        const result = await delegate.executeActivity(activity("workspace.inspect"), binding());

        expect(result?.success).to.equal(true);
        expect(result?.output?.contract).to.equal("workspaceSnapshot/1");
        expect(result?.output?.scalars).to.deep.include({
            workspaceFolderCount: 2,
            projectCount: 2,
            projectPaths: "C:\\repo\\A.sqlproj\nC:\\repo\\B.sqlproj",
            truncated: true,
            executionMode: "local",
        });
        expect(result?.values).to.deep.equal({ projectCount: 2 });
    });

    test("DACPAC build emits verified artifact provenance", async () => {
        let requestedProject = "";
        const delegate = new LocalSqlActivityDelegate(
            operations({
                buildDacpac: async (projectPath) => {
                    requestedProject = projectPath;
                    return {
                        projectPath,
                        artifactPath: "C:\\repo\\bin\\Debug\\A.dacpac",
                        artifactSizeBytes: 4096,
                        artifactSha256: "b".repeat(64),
                        diagnosticCount: 0,
                        builtAtUtc: "2026-07-19T20:01:00.000Z",
                    };
                },
            }),
        );

        const result = await delegate.executeActivity(
            activity("dacpac.build", { project: "$params.projectPath" }),
            binding((value) => (value === "$params.projectPath" ? " C:\\repo\\A.sqlproj " : value)),
        );

        expect(requestedProject).to.equal("C:\\repo\\A.sqlproj");
        expect(result?.success).to.equal(true);
        expect(result?.output?.contract).to.equal("dacpacArtifact/1");
        expect(result?.output?.scalars).to.deep.include({
            artifactSizeBytes: 4096,
            artifactSha256: "b".repeat(64),
            diagnosticCount: 0,
            executionMode: "local",
        });
        expect(result?.values).to.deep.equal({
            artifactPath: "C:\\repo\\bin\\Debug\\A.dacpac",
            diagnosticCount: 0,
        });
    });

    test("DACPAC host refusals preserve stable error codes", async () => {
        const delegate = new LocalSqlActivityDelegate(
            operations({
                buildDacpac: async () => {
                    throw new LocalActivityError(
                        "Project is outside the workspace.",
                        "RunbookStudio.TargetOutsideWorkspace",
                    );
                },
            }),
        );

        const result = await delegate.executeActivity(
            activity("dacpac.build", { project: "C:\\outside\\A.sqlproj" }),
            binding(),
        );

        expect(result).to.deep.include({
            success: false,
            message: "Project is outside the workspace.",
            errorCode: "RunbookStudio.TargetOutsideWorkspace",
        });
    });

    test("deployment preview emits bounded DacFx report evidence", async () => {
        const delegate = new LocalSqlActivityDelegate(operations());

        const result = await delegate.executeActivity(
            activity("dacpac.deploy.preview", {
                dacpac: "$nodes.build.artifactPath",
                database: "$params.target",
            }),
            binding((value) => {
                if (value === "$nodes.build.artifactPath") {
                    return "C:\\repo\\bin\\Debug\\A.dacpac";
                }
                if (value === "$params.target") {
                    return "profile-id";
                }
                return value;
            }),
        );

        expect(result?.success).to.equal(true);
        expect(result?.output?.contract).to.equal("deploymentPreview/1");
        expect(result?.output?.text).to.equal("<DeploymentReport />");
        expect(result?.output?.scalars).to.deep.include({
            targetDatabase: "RunbookTarget",
            changeCount: 4,
            alertCount: 1,
            operationSummary: "Alter: 1; Create: 3",
            reportSha256: "c".repeat(64),
            reportTruncated: false,
            executionMode: "local",
        });
        expect(result?.values).to.deep.equal({
            changeCount: 4,
            reportSha256: "c".repeat(64),
        });
    });

    test("advertises only locally implemented activities", () => {
        const delegate = new LocalSqlActivityDelegate(operations());
        expect([...delegate.supportedActivityKinds]).to.have.members([
            "workspace.inspect",
            "dacpac.build",
            "dacpac.deploy.preview",
            "sql.query.read",
        ]);
        expect(delegate.supportedActivityKinds.has("sandbox.provision")).to.equal(false);
    });

    test("deployment report summarization counts operations and alerts", () => {
        const report = [
            "<DeploymentReport>",
            '<Alerts><Alert Name="DataIssue" /></Alerts>',
            "<Operations>",
            '<Operation Name="Create"><Item Value="A" /><Item Value="B" /></Operation>',
            '<Operation Name="Alter"><Item Value="C" /></Operation>',
            "</Operations>",
            "</DeploymentReport>",
        ].join("");

        const result = buildLocalDeploymentPreviewResult(
            "C:\\repo\\A.dacpac",
            "TargetDb",
            "operation-1",
            report,
        );

        expect(result.changeCount).to.equal(3);
        expect(result.alertCount).to.equal(1);
        expect(result.operationSummary).to.equal("Alter: 1; Create: 2");
        expect(result.reportSha256).to.have.length(64);
        expect(result.reportTruncated).to.equal(false);
        expect(result.reportXml).to.equal(report);
    });

    test("deployment report projection is bounded while its hash covers the full report", () => {
        const report = `<DeploymentReport><Operations>${" ".repeat(300_000)}</Operations></DeploymentReport>`;

        const result = buildLocalDeploymentPreviewResult(
            "C:\\repo\\A.dacpac",
            "TargetDb",
            "operation-2",
            report,
        );

        expect(result.reportTruncated).to.equal(true);
        expect(Buffer.byteLength(result.reportXml, "utf8")).to.be.lessThan(270_000);
        expect(result.reportSha256).to.have.length(64);
    });
});
