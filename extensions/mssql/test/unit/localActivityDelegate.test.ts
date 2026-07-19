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
        ...overrides,
    };
}

function binding(resolveBind: (input: unknown) => unknown = (input) => input) {
    return {
        parameterValues: {},
        resolveBind,
        isCancellationRequested: () => false,
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

    test("advertises only locally implemented activities", () => {
        const delegate = new LocalSqlActivityDelegate(operations());
        expect([...delegate.supportedActivityKinds]).to.have.members([
            "workspace.inspect",
            "dacpac.build",
            "sql.query.read",
        ]);
        expect(delegate.supportedActivityKinds.has("sandbox.provision")).to.equal(false);
    });
});
