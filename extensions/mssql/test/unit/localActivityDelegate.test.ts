/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import type * as mssql from "vscode-mssql";
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
        discoverSqlTests: async () => ({
            candidateSqlFileCount: 2,
            scannedSqlFileCount: 2,
            skippedOversizedFileCount: 0,
            skippedByteBudgetFileCount: 0,
            unsafePathFileCount: 0,
            unreadableFileCount: 0,
            scannedSourceBytes: 512,
            tSqltClassCount: 1,
            tSqltSourceFileCount: 1,
            duplicateDefinitionCount: 0,
            truncated: false,
            tests: [
                {
                    framework: "tSQLt",
                    suite: "OrderTests",
                    name: "test total is correct",
                    relativePath: "repo/tests/OrderTests.sql",
                    line: 8,
                },
            ],
        }),
        runTsqlt: async () => ({
            rowCount: 2,
            columnInfo: [
                column("suite_name"),
                column("test_name"),
                column("result"),
                column("message"),
                column("duration_ms"),
            ],
            rows: [
                [cell("OrderTests"), cell("test one"), cell("Success"), cell(""), cell("12")],
                [cell("OrderTests"), cell("test two"), cell("Skipped"), cell(""), cell("0")],
            ],
        }),
        buildDacpac: async (projectPath) => ({
            projectPath,
            artifactPath: "C:\\repo\\bin\\Debug\\A.dacpac",
            artifactSizeBytes: 2048,
            artifactSha256: "a".repeat(64),
            diagnosticCount: 2,
            warningCount: 1,
            errorCount: 1,
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
        deployDacpac: async (
            _nodeId,
            dacpacPath,
            _databaseRef,
            _artifactDigest,
            previewDigest,
        ) => ({
            effectId: `effect-${"e".repeat(64)}`,
            dacpacPath,
            artifactSha256: "b".repeat(64),
            stagedArtifactSha256: "b".repeat(64),
            databaseName: `RunbookStudio_${"d".repeat(20)}`,
            operationId: "deploy-op",
            approvedPreviewDigest: previewDigest,
            postDeployReportSha256: "f".repeat(64),
            postDeployChangeCount: 0,
            deployedAtUtc: "2026-07-19T20:03:30.000Z",
        }),
        verifyDacpacDeployment: async (dacpacPath) => ({
            dacpacPath,
            targetDatabase: `RunbookStudio_${"d".repeat(20)}`,
            operationId: "verify-op",
            changeCount: 0,
            alertCount: 0,
            operationSummary: "No schema changes",
            reportSha256: "f".repeat(64),
            reportXml: "<DeploymentReport />",
            reportTruncated: false,
            generatedAtUtc: "2026-07-19T20:03:40.000Z",
            matches: true,
        }),
        provisionSandbox: async () => ({
            effectId: `effect-${"d".repeat(64)}`,
            leaseId: "lease-1",
            connectionRef: `runbook-sql-lease:effect-${"d".repeat(64)}`,
            databaseName: `RunbookStudio_${"d".repeat(20)}`,
            createdAtUtc: "2026-07-19T20:03:00.000Z",
        }),
        disposeSandbox: async () => ({
            effectId: `effect-${"d".repeat(64)}`,
            leaseId: "lease-1",
            databaseName: `RunbookStudio_${"d".repeat(20)}`,
            cleaned: true,
            cleanedAtUtc: "2026-07-19T20:04:00.000Z",
            cleanupEvidenceDigest: "sha256:cleanup",
        }),
        bundleEvidence: async () => ({
            bundleSha256: "9".repeat(64),
            manifestJson: '{"contract":"evidenceBundle/1","verdict":"pass"}',
            nodeCount: 10,
            passedNodeCount: 10,
            failedNodeCount: 0,
            evidenceHandleCount: 8,
            verdict: "pass",
            generatedAtUtc: "2026-07-19T20:05:00.000Z",
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

    test("repository test discovery emits bounded typed rows and completeness", async () => {
        const delegate = new LocalSqlActivityDelegate(operations());

        const result = await delegate.executeActivity(activity("sqltest.discover"), binding());

        expect(result?.success).to.equal(true);
        expect(result?.output?.contract).to.equal("testSuiteDiscovery/1");
        expect(result?.output?.rows).to.deep.equal([
            ["tSQLt", "OrderTests", "test total is correct", "repo/tests/OrderTests.sql", 8],
        ]);
        expect(result?.output?.scalars).to.deep.include({
            candidateSqlFileCount: 2,
            scannedSqlFileCount: 2,
            tSqltClassCount: 1,
            tSqltTestCount: 1,
            complete: true,
            truncated: false,
        });
        expect(result?.values).to.deep.equal({
            tSqltClassCount: 1,
            tSqltTestCount: 1,
            complete: true,
        });
    });

    test("repository test discovery reports partial evidence honestly", async () => {
        const delegate = new LocalSqlActivityDelegate(
            operations({
                discoverSqlTests: async () => ({
                    candidateSqlFileCount: 2001,
                    scannedSqlFileCount: 1998,
                    skippedOversizedFileCount: 2,
                    skippedByteBudgetFileCount: 0,
                    unsafePathFileCount: 0,
                    unreadableFileCount: 0,
                    scannedSourceBytes: 4096,
                    tSqltClassCount: 0,
                    tSqltSourceFileCount: 0,
                    duplicateDefinitionCount: 0,
                    truncated: true,
                    tests: [],
                }),
            }),
        );

        const result = await delegate.executeActivity(activity("sqltest.discover"), binding());

        expect(result?.success).to.equal(true);
        expect(result?.output?.scalars).to.deep.include({
            skippedOversizedFileCount: 2,
            complete: false,
            truncated: true,
        });
        expect(result?.values?.complete).to.equal(false);
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
                        warningCount: 0,
                        errorCount: 0,
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
            artifactSha256: "b".repeat(64),
            diagnosticCount: 0,
        });
        expect(result?.runMetrics).to.deep.equal({
            "build.warningCount": 0,
            "build.errorCount": 0,
        });
        expect(result?.diagnosticCounts).to.deep.equal({ warningCount: 0, errorCount: 0 });
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

    test("sandbox provision and dispose emit opaque lease and cleanup evidence", async () => {
        const delegate = new LocalSqlActivityDelegate(operations());
        const provision = await delegate.executeActivity(
            activity("sandbox.provision", { sandbox: "$params.sandbox" }),
            binding((value) => (value === "$params.sandbox" ? "profile-id" : value)),
        );
        expect(provision?.success).to.equal(true);
        expect(provision?.output?.contract).to.equal("databaseLease/1");
        expect(provision?.values?.connectionRef).to.match(/^runbook-sql-lease:effect-/);
        expect(provision?.output?.scalars).to.include({
            databaseName: `RunbookStudio_${"d".repeat(20)}`,
            executionMode: "local",
        });

        const dispose = await delegate.executeActivity(
            activity("sandbox.dispose", { database: "$nodes.provision.connectionRef" }),
            binding((value) =>
                value === "$nodes.provision.connectionRef"
                    ? `runbook-sql-lease:effect-${"d".repeat(64)}`
                    : value,
            ),
        );
        expect(dispose?.success).to.equal(true);
        expect(dispose?.output?.contract).to.equal("cleanupEvidence/1");
        expect(dispose?.values).to.deep.equal({ cleaned: true });
        expect(dispose?.output?.scalars).to.include({
            cleaned: true,
            cleanupEvidenceDigest: "sha256:cleanup",
            executionMode: "local",
        });
    });

    test("guarded deployment and schema verification emit typed evidence", async () => {
        const delegate = new LocalSqlActivityDelegate(operations());
        const resolve = (value: unknown) => {
            const values: Record<string, string> = {
                "$nodes.build.artifactPath": "C:\\repo\\bin\\Debug\\A.dacpac",
                "$nodes.build.artifactSha256": "b".repeat(64),
                "$nodes.provision.connectionRef": `runbook-sql-lease:effect-${"d".repeat(64)}`,
                "$nodes.preview.reportSha256": "c".repeat(64),
            };
            return typeof value === "string" ? (values[value] ?? value) : value;
        };
        const deploy = await delegate.executeActivity(
            activity("dacpac.deploy", {
                dacpac: "$nodes.build.artifactPath",
                database: "$nodes.provision.connectionRef",
                artifactDigest: "$nodes.build.artifactSha256",
                previewDigest: "$nodes.preview.reportSha256",
            }),
            binding(resolve),
        );
        expect(deploy?.success).to.equal(true);
        expect(deploy?.output?.contract).to.equal("deploymentEvidence/1");
        expect(deploy?.output?.scalars).to.include({
            operationId: "deploy-op",
            approvedPreviewDigest: "c".repeat(64),
            postDeployChangeCount: 0,
            executionMode: "local",
        });

        const verify = await delegate.executeActivity(
            activity("schema.compare", {
                dacpac: "$nodes.build.artifactPath",
                database: "$nodes.provision.connectionRef",
            }),
            binding(resolve),
        );
        expect(verify?.success).to.equal(true);
        expect(verify?.output?.contract).to.equal("schemaDiff/1");
        expect(verify?.values).to.deep.include({ matches: true, changeCount: 0 });
    });

    test("SQL test execution interprets typed rows and always disconnects", async () => {
        let disconnects = 0;
        const delegate = new LocalSqlActivityDelegate(
            operations({
                execute: async () => ({
                    rowCount: 2,
                    columnInfo: [column("test_name"), column("passed"), column("message")],
                    rows: [
                        [cell("table exists"), cell("1"), cell("found")],
                        [cell("key exists"), cell("true"), cell("found")],
                    ],
                }),
                disconnect: async () => {
                    disconnects++;
                },
            }),
        );

        const result = await delegate.executeActivity(
            activity("sqltest.run", {
                database: "$nodes.provision.connectionRef",
                sql: "SELECT N'table exists' AS test_name, CAST(1 AS bit) AS passed",
            }),
            binding((value) => (value === "$nodes.provision.connectionRef" ? "lease-ref" : value)),
        );

        expect(result?.success).to.equal(true);
        expect(result?.verdict).to.equal("pass");
        expect(result?.output?.contract).to.equal("testResults/1");
        expect(result?.output?.rows).to.deep.equal([
            ["table exists", true, "found"],
            ["key exists", true, "found"],
        ]);
        expect(result?.values).to.deep.equal({ total: 2, passed: 2, failed: 0, allPassed: true });
        expect(result?.runMetrics).to.deep.equal({
            "sqlTests.total": 2,
            "sqlTests.passed": 2,
            "sqlTests.failed": 0,
            "sqlTests.allPassed": true,
        });
        expect(disconnects).to.equal(1);
    });

    test("governed tSQLt execution projects typed outcomes", async () => {
        let requestedSelection: { suite?: string; test?: string } | undefined;
        const delegate = new LocalSqlActivityDelegate(
            operations({
                runTsqlt: async (_nodeId, _databaseRef, selection) => {
                    requestedSelection = selection;
                    return operations().runTsqlt(
                        "node",
                        "lease",
                        selection,
                        binding().invocation,
                        () => false,
                    );
                },
            }),
        );

        const result = await delegate.executeActivity(
            activity("tsqlt.run", {
                database: "$nodes.provision.connectionRef",
                suite: "OrderTests",
            }),
            binding((value) => (value === "$nodes.provision.connectionRef" ? "lease-ref" : value)),
        );

        expect(requestedSelection).to.deep.equal({ suite: "OrderTests" });
        expect(result).to.deep.include({ success: true, verdict: "pass" });
        expect(result?.output?.contract).to.equal("testResults/1");
        expect(result?.output?.rows).to.deep.equal([
            ["OrderTests", "test one", "passed", "", 12],
            ["OrderTests", "test two", "skipped", "", 0],
        ]);
        expect(result?.values).to.deep.equal({
            total: 2,
            passed: 1,
            failed: 0,
            errors: 0,
            skipped: 1,
            allPassed: true,
        });
        expect(result?.runMetrics).to.deep.include({
            "tsqlt.total": 2,
            "tsqlt.passed": 1,
            "tsqlt.skipped": 1,
            "tsqlt.allPassed": true,
        });
    });

    test("governed tSQLt failures retain results and fail the run", async () => {
        const delegate = new LocalSqlActivityDelegate(
            operations({
                runTsqlt: async () => ({
                    rowCount: 1,
                    columnInfo: [
                        column("suite_name"),
                        column("test_name"),
                        column("result"),
                        column("message"),
                        column("duration_ms"),
                    ],
                    rows: [
                        [
                            cell("OrderTests"),
                            cell("test total"),
                            cell("Failure"),
                            cell("expected 2 but found 3"),
                            cell("31"),
                        ],
                    ],
                }),
            }),
        );

        const result = await delegate.executeActivity(
            activity("tsqlt.run", { database: "lease-ref" }),
            binding(),
        );

        expect(result).to.deep.include({
            success: false,
            verdict: "fail",
            errorCode: "RunbookStudio.TsqltTestsFailed",
        });
        expect(result?.output?.scalars).to.deep.include({
            total: 1,
            failed: 1,
            errors: 0,
            allPassed: false,
        });
        expect(result?.runMetrics).to.deep.include({
            "tsqlt.failed": 1,
            "tsqlt.errors": 0,
            "tsqlt.allPassed": false,
        });
    });

    test("governed tSQLt rejects a test without a suite before host execution", async () => {
        let executed = false;
        const delegate = new LocalSqlActivityDelegate(
            operations({
                runTsqlt: async () => {
                    executed = true;
                    return { rowCount: 0, columnInfo: [], rows: [] };
                },
            }),
        );

        const result = await delegate.executeActivity(
            activity("tsqlt.run", { database: "lease-ref", test: "test one" }),
            binding(),
        );

        expect(result).to.deep.include({
            success: false,
            errorCode: "RunbookStudio.BindingInvalid",
        });
        expect(executed).to.equal(false);
    });

    test("SQL test failures retain typed results and produce a failing verdict", async () => {
        const delegate = new LocalSqlActivityDelegate(
            operations({
                execute: async () => ({
                    rowCount: 1,
                    columnInfo: [column("name"), column("passed")],
                    rows: [[cell("schema converged"), cell("0")]],
                }),
            }),
        );

        const result = await delegate.executeActivity(
            activity("sqltest.run", {
                database: "lease-ref",
                sql: "SELECT N'schema converged' AS name, CAST(0 AS bit) AS passed",
            }),
            binding(),
        );

        expect(result).to.deep.include({
            success: false,
            verdict: "fail",
            errorCode: "RunbookStudio.SqlTestsFailed",
        });
        expect(result?.output?.scalars).to.deep.include({
            total: 1,
            passed: 0,
            failed: 1,
            allPassed: false,
        });
        expect(result?.runMetrics).to.deep.include({
            "sqlTests.failed": 1,
            "sqlTests.allPassed": false,
        });
    });

    test("SQL test cancellation stops before query execution and disconnects", async () => {
        let executed = false;
        let disconnects = 0;
        const delegate = new LocalSqlActivityDelegate(
            operations({
                execute: async () => {
                    executed = true;
                    return { rowCount: 0, columnInfo: [], rows: [] };
                },
                disconnect: async () => {
                    disconnects++;
                },
            }),
        );

        const result = await delegate.executeActivity(
            activity("sqltest.run", {
                database: "lease-ref",
                sql: "SELECT N'test' AS name, CAST(1 AS bit) AS passed",
            }),
            { ...binding(), isCancellationRequested: () => true },
        );

        expect(result).to.deep.include({
            success: false,
            errorCode: "RunbookStudio.ActivityCancelled",
        });
        expect(executed).to.equal(false);
        expect(disconnects).to.equal(1);
    });

    test("SQL test timeout input is bounded before connecting", async () => {
        let connected = false;
        const delegate = new LocalSqlActivityDelegate(
            operations({
                connect: async () => {
                    connected = true;
                    return true;
                },
            }),
        );

        const result = await delegate.executeActivity(
            activity("sqltest.run", {
                database: "lease-ref",
                sql: "SELECT N'test' AS name, CAST(1 AS bit) AS passed",
                timeoutSeconds: 0,
            }),
            binding(),
        );

        expect(result).to.deep.include({
            success: false,
            errorCode: "RunbookStudio.BindingInvalid",
        });
        expect(connected).to.equal(false);
    });

    test("evidence aggregation emits a content-addressed manifest", async () => {
        const delegate = new LocalSqlActivityDelegate(operations());

        const result = await delegate.executeActivity(activity("evidence.bundle"), binding());

        expect(result?.success).to.equal(true);
        expect(result?.verdict).to.equal("pass");
        expect(result?.output?.contract).to.equal("evidenceBundle/1");
        expect(result?.output?.text).to.contain("evidenceBundle/1");
        expect(result?.values).to.deep.equal({
            bundleSha256: "9".repeat(64),
            nodeCount: 10,
            verdict: "pass",
        });
        expect(result?.runMetrics).to.deep.equal({
            "evidence.nodeCount": 10,
            "evidence.failedNodeCount": 0,
        });
    });

    test("advertises only locally implemented activities", () => {
        const delegate = new LocalSqlActivityDelegate(operations());
        expect([...delegate.supportedActivityKinds]).to.have.members([
            "workspace.inspect",
            "sqltest.discover",
            "tsqlt.run",
            "dacpac.build",
            "sandbox.provision",
            "dacpac.deploy.preview",
            "dacpac.deploy",
            "schema.compare",
            "sandbox.dispose",
            "sqltest.run",
            "evidence.bundle",
            "sql.query.read",
        ]);
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

function column(columnName: string): mssql.IDbColumn {
    return { columnName } as mssql.IDbColumn;
}

function cell(displayValue: string): mssql.DbCellValue {
    return { displayValue, isNull: false };
}
