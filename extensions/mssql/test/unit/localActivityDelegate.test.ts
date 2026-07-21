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
import { LOCAL_SCHEMA_INVENTORY_SQL } from "../../src/runbookStudio/runtime/localSchemaInventory";

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
        extractDacpac: async () => ({
            databaseName: "WideWorldImporters",
            operationId: "extract-op",
            artifactPath: "C:\\managed\\WideWorldImporters.dacpac",
            artifactSizeBytes: 4096,
            artifactSha256: "e".repeat(64),
            extractedAtUtc: "2026-07-20T20:01:00.000Z",
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
        deployDevelopmentDacpac: async (
            _nodeId,
            dacpacPath,
            _databaseRef,
            _artifactDigest,
            previewDigest,
        ) => ({
            effectId: `effect-${"f".repeat(64)}`,
            dacpacPath,
            artifactSha256: "b".repeat(64),
            stagedArtifactSha256: "b".repeat(64),
            databaseName: "WWI_2",
            operationId: "development-deploy-op",
            approvedPreviewDigest: previewDigest,
            postDeployReportSha256: "f".repeat(64),
            postDeployChangeCount: 0,
            deployedAtUtc: "2026-07-20T20:03:30.000Z",
        }),
        deployContainerDacpac: async (
            _nodeId,
            dacpacPath,
            _databaseRef,
            _artifactDigest,
            previewDigest,
        ) => ({
            effectId: `effect-${"3".repeat(64)}`,
            dacpacPath,
            artifactSha256: "b".repeat(64),
            stagedArtifactSha256: "b".repeat(64),
            databaseName: "WWI_Container",
            operationId: "container-deploy-op",
            approvedPreviewDigest: previewDigest,
            postDeployReportSha256: "f".repeat(64),
            postDeployChangeCount: 0,
            deployedAtUtc: "2026-07-20T20:03:30.000Z",
        }),
        applySchema: async () => ({
            effectId: `effect-${"1".repeat(64)}`,
            databaseName: "WWI_2",
            tableName: "dbo.RunLog",
            sqlSha256: "2".repeat(64),
            changedObjectCount: 1,
            appliedAtUtc: "2026-07-20T20:04:00.000Z",
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
        exportSchemaComparison: async (dacpacPath) => ({
            dacpacPath,
            targetDatabase: "WWI_2",
            operationId: "compare-export-op",
            changeCount: 1,
            alertCount: 0,
            operationSummary: "Create: 1",
            reportSha256: "7".repeat(64),
            reportXml: "<DeploymentReport />",
            reportTruncated: false,
            generatedAtUtc: "2026-07-20T20:02:00.000Z",
            matches: false,
            artifactPath: "C:\\managed\\schema-comparison.xml",
            artifactSizeBytes: 512,
            artifactSha256: "7".repeat(64),
            exportedAtUtc: "2026-07-20T20:02:01.000Z",
        }),
        provisionSandbox: async () => ({
            effectId: `effect-${"d".repeat(64)}`,
            leaseId: "lease-1",
            connectionRef: `runbook-sql-lease:effect-${"d".repeat(64)}`,
            databaseName: `RunbookStudio_${"d".repeat(20)}`,
            createdAtUtc: "2026-07-19T20:03:00.000Z",
        }),
        provisionDevelopmentDatabase: async (_nodeId, _baseConnectionRef, databaseName) => ({
            effectId: `effect-${"f".repeat(64)}`,
            leaseId: `effect-${"f".repeat(64)}`,
            connectionRef: `runbook-sql-dev-lease:effect-${"f".repeat(64)}`,
            databaseName,
            createdAtUtc: "2026-07-20T20:03:00.000Z",
            retention: "retained",
        }),
        provisionSqlContainer: async (_nodeId, containerName, databaseName, version) => ({
            effectId: `effect-${"3".repeat(64)}`,
            leaseId: `effect-${"3".repeat(64)}`,
            connectionRef: `runbook-sql-container-lease:effect-${"3".repeat(64)}`,
            containerName,
            databaseName,
            version,
            port: 14330,
            createdAtUtc: "2026-07-20T20:03:00.000Z",
        }),
        inspectWorkload: async () => ({
            workloadRef: `runbook-workload:${"4".repeat(64)}:11111111-1111-4111-8111-111111111111`,
            fileName: "workload.sql",
            workloadSha256: "4".repeat(64),
            sourceByteCount: 128,
            batchCount: 2,
            mutating: true,
            inspectedAtUtc: "2026-07-20T20:03:01.000Z",
        }),
        runWorkload: async () => ({
            effectId: `effect-${"5".repeat(64)}`,
            workloadSha256: "4".repeat(64),
            plannedBatchCount: 2,
            executedBatchCount: 2,
            failedBatchCount: 0,
            totalDurationMs: 30,
            repetitions: 1,
            results: [
                {
                    iteration: 1,
                    batch: 1,
                    durationMs: 10,
                    rowCount: 1,
                    succeeded: true,
                    errorCode: "",
                },
                {
                    iteration: 1,
                    batch: 2,
                    durationMs: 20,
                    rowCount: 0,
                    succeeded: true,
                    errorCode: "",
                },
            ],
            completedAtUtc: "2026-07-20T20:03:02.000Z",
        }),
        startXeventSession: async () => ({
            effectId: `effect-${"6".repeat(64)}`,
            sessionRef: `runbook-xevent-session:effect-${"6".repeat(64)}`,
            sessionName: "rbs_xe_666666666666666666666666",
            template: "developer-diagnostics",
            maxFileSizeMb: 16,
            startedAtUtc: "2026-07-20T20:03:03.000Z",
        }),
        stopXeventSession: async () => ({
            effectId: `effect-${"6".repeat(64)}`,
            captureRef: `runbook-xevent-capture:effect-${"6".repeat(64)}`,
            sessionName: "rbs_xe_666666666666666666666666",
            eventFileName: "rbs_xe_666666666666666666666666_0_1.xel",
            eventCount: 12,
            stoppedAtUtc: "2026-07-20T20:03:04.000Z",
        }),
        collectXel: async () => ({
            sessionName: "rbs_xe_666666666666666666666666",
            artifactPath: "C:\\managed\\rbs_xe_666666666666666666666666_0_1.xel",
            artifactSizeBytes: 4096,
            artifactSha256: "8".repeat(64),
            eventCount: 12,
            captureComplete: true,
            collectedAtUtc: "2026-07-20T20:03:05.000Z",
        }),
        disposeSandbox: async () => ({
            effectId: `effect-${"d".repeat(64)}`,
            leaseId: "lease-1",
            databaseName: `RunbookStudio_${"d".repeat(20)}`,
            cleaned: true,
            cleanedAtUtc: "2026-07-19T20:04:00.000Z",
            cleanupEvidenceDigest: "sha256:cleanup",
        }),
        disposeSqlContainer: async () => ({
            effectId: `effect-${"3".repeat(64)}`,
            leaseId: `effect-${"3".repeat(64)}`,
            databaseName: "WWI_Container",
            containerName: "rbs-wwi",
            cleaned: true,
            cleanedAtUtc: "2026-07-20T20:04:00.000Z",
            cleanupEvidenceDigest: "sha256:container-cleanup",
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
        expect(result?.runMetrics).to.deep.equal({
            "workspace.folderCount": 2,
            "workspace.projectCount": 2,
            "workspace.truncated": true,
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
        expect(result?.runMetrics).to.deep.equal({
            "tests.discovered": 1,
            "tests.discoveredClassCount": 1,
            "tests.scannedSqlFileCount": 2,
            "tests.discoveryComplete": true,
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
        expect(result?.runMetrics).to.deep.include({ "tests.discoveryComplete": false });
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
            "build.artifactSizeBytes": 4096,
            "build.diagnosticCount": 0,
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

    test("dacpacExtractionDelegate emits a reusable hashed artifact", async () => {
        let requestedDatabase = "";
        let requestedDatabaseName = "";
        const delegate = new LocalSqlActivityDelegate(
            operations({
                extractDacpac: async (_nodeId, databaseRef, databaseName) => {
                    requestedDatabase = databaseRef;
                    requestedDatabaseName = databaseName;
                    return {
                        databaseName: "WideWorldImporters",
                        operationId: "extract-op",
                        artifactPath: "C:\\managed\\WideWorldImporters.dacpac",
                        artifactSizeBytes: 8192,
                        artifactSha256: "e".repeat(64),
                        extractedAtUtc: "2026-07-20T20:01:00.000Z",
                    };
                },
            }),
        );

        const result = await delegate.executeActivity(
            activity("dacpac.extract", {
                database: "$params.source",
                databaseName: "WideWorldImporters",
            }),
            binding((value) => (value === "$params.source" ? " source-profile " : value)),
        );

        expect(requestedDatabase).to.equal("source-profile");
        expect(requestedDatabaseName).to.equal("WideWorldImporters");
        expect(result?.success).to.equal(true);
        expect(result?.output?.contract).to.equal("dacpacArtifact/1");
        expect(result?.output?.scalars).to.deep.include({
            databaseName: "WideWorldImporters",
            artifactPath: "C:\\managed\\WideWorldImporters.dacpac",
            artifactSizeBytes: 8192,
            artifactSha256: "e".repeat(64),
            executionMode: "local",
        });
        expect(result?.values).to.deep.equal({
            databaseName: "WideWorldImporters",
            artifactPath: "C:\\managed\\WideWorldImporters.dacpac",
            artifactSha256: "e".repeat(64),
        });
        expect(result?.runMetrics).to.deep.equal({
            "extract.artifactSizeBytes": 8192,
            "extract.completed": true,
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
        expect(provision?.runMetrics).to.deep.equal({ "sandbox.provisioned": true });
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

    test("named development provision and deploy retain typed ownership evidence", async () => {
        const delegate = new LocalSqlActivityDelegate(operations());
        const values: Record<string, string> = {
            "$params.server": "profile-id",
            "$params.databaseName": "WWI_2",
            "$nodes.extract.artifactPath": "C:\\managed\\WideWorldImporters.dacpac",
            "$nodes.extract.artifactSha256": "b".repeat(64),
            "$nodes.provision.connectionRef": `runbook-sql-dev-lease:effect-${"f".repeat(64)}`,
            "$nodes.preview.reportSha256": "c".repeat(64),
        };
        const resolve = (value: unknown) =>
            typeof value === "string" ? (values[value] ?? value) : value;
        const provision = await delegate.executeActivity(
            activity("devdatabase.provision", {
                server: "$params.server",
                databaseName: "$params.databaseName",
            }),
            binding(resolve),
        );

        expect(provision?.success).to.equal(true);
        expect(provision?.runMetrics).to.deep.equal({
            "developmentDatabase.provisioned": true,
        });
        expect(provision?.output?.scalars).to.include({
            databaseName: "WWI_2",
            retention: "retained",
            executionMode: "local",
        });
        expect(provision?.values?.connectionRef).to.match(/^runbook-sql-dev-lease:effect-/);

        const deploy = await delegate.executeActivity(
            activity("dacpac.deploy.dev", {
                dacpac: "$nodes.extract.artifactPath",
                database: "$nodes.provision.connectionRef",
                artifactDigest: "$nodes.extract.artifactSha256",
                previewDigest: "$nodes.preview.reportSha256",
            }),
            binding(resolve),
        );
        expect(deploy?.success).to.equal(true);
        expect(deploy?.output?.contract).to.equal("deploymentEvidence/1");
        expect(deploy?.output?.scalars).to.include({
            databaseName: "WWI_2",
            operationId: "development-deploy-op",
            postDeployChangeCount: 0,
        });

        const mutation = await delegate.executeActivity(
            activity("sql.schema.apply", {
                database: "$nodes.provision.connectionRef",
                sql: "CREATE TABLE dbo.RunLog (Id bigint NOT NULL PRIMARY KEY)",
            }),
            binding(resolve),
        );
        expect(mutation?.success).to.equal(true);
        expect(mutation?.output?.contract).to.equal("schemaMutationEvidence/1");
        expect(mutation?.output?.scalars).to.include({
            databaseName: "WWI_2",
            tableName: "dbo.RunLog",
            changedObjectCount: 1,
        });
    });

    test("container provision, deployment, and disposal retain no secret output", async () => {
        const delegate = new LocalSqlActivityDelegate(operations());
        const values: Record<string, string | number> = {
            "$params.containerName": "rbs-wwi",
            "$params.databaseName": "WWI_Container",
            "$params.version": "2022",
            "$params.password": "Secret1!",
            "$nodes.extract.artifactPath": "C:\\managed\\WideWorldImporters.dacpac",
            "$nodes.extract.artifactSha256": "b".repeat(64),
            "$nodes.container.connectionRef": `runbook-sql-container-lease:effect-${"3".repeat(64)}`,
            "$nodes.preview.reportSha256": "c".repeat(64),
        };
        const resolve = (value: unknown) =>
            typeof value === "string" ? (values[value] ?? value) : value;
        const provision = await delegate.executeActivity(
            activity("sql.container.provision", {
                containerName: "$params.containerName",
                databaseName: "$params.databaseName",
                version: "$params.version",
                password: "$params.password",
            }),
            binding(resolve),
        );
        expect(provision?.success).to.equal(true);
        expect(provision?.output?.scalars).to.include({
            containerName: "rbs-wwi",
            databaseName: "WWI_Container",
            version: "2022",
            port: 14330,
        });
        expect(JSON.stringify(provision?.output)).not.to.include("Secret1!");

        const deploy = await delegate.executeActivity(
            activity("dacpac.deploy.container", {
                dacpac: "$nodes.extract.artifactPath",
                database: "$nodes.container.connectionRef",
                artifactDigest: "$nodes.extract.artifactSha256",
                previewDigest: "$nodes.preview.reportSha256",
            }),
            binding(resolve),
        );
        expect(deploy?.success).to.equal(true);
        expect(deploy?.output?.scalars).to.include({
            databaseName: "WWI_Container",
            operationId: "container-deploy-op",
        });

        const dispose = await delegate.executeActivity(
            activity("sql.container.dispose", {
                database: "$nodes.container.connectionRef",
            }),
            binding(resolve),
        );
        expect(dispose?.success).to.equal(true);
        expect(dispose?.output?.scalars).to.include({
            containerName: "rbs-wwi",
            cleaned: true,
        });
    });

    test("workload inspection and execution emit digest-bound batch evidence", async () => {
        const delegate = new LocalSqlActivityDelegate(operations());
        const workloadRef = `runbook-workload:${"4".repeat(64)}:11111111-1111-4111-8111-111111111111`;
        const values: Record<string, string> = {
            "$params.workload": "workload.sql",
            "$nodes.inspect.workloadRef": workloadRef,
            "$nodes.inspect.workloadSha256": "4".repeat(64),
            "$nodes.container.connectionRef": `runbook-sql-container-lease:effect-${"3".repeat(64)}`,
        };
        const resolve = (value: unknown) =>
            typeof value === "string" ? (values[value] ?? value) : value;

        const inspect = await delegate.executeActivity(
            activity("sql.workload.inspect", { file: "$params.workload" }),
            binding(resolve),
        );
        expect(inspect?.success).to.equal(true);
        expect(inspect?.output?.contract).to.equal("workloadPreview/1");
        expect(inspect?.output?.scalars).to.include({
            fileName: "workload.sql",
            workloadSha256: "4".repeat(64),
            batchCount: 2,
            mutating: true,
        });
        expect(inspect?.values).to.deep.include({
            workloadRef,
            workloadSha256: "4".repeat(64),
        });

        const run = await delegate.executeActivity(
            activity("sql.workload.run", {
                database: "$nodes.container.connectionRef",
                workload: "$nodes.inspect.workloadRef",
                workloadDigest: "$nodes.inspect.workloadSha256",
                repetitions: 1,
                timeoutSeconds: 30,
            }),
            binding(resolve),
        );
        expect(run?.success).to.equal(true);
        expect(run?.output?.contract).to.equal("workloadResults/1");
        expect(run?.output?.rows).to.have.length(2);
        expect(run?.output?.scalars).to.include({
            workloadSha256: "4".repeat(64),
            plannedBatchCount: 2,
            executedBatchCount: 2,
            failedBatchCount: 0,
            repetitions: 1,
        });
        expect(run?.runMetrics).to.deep.include({
            "workload.plannedBatchCount": 2,
            "workload.executedBatchCount": 2,
            "workload.failedBatchCount": 0,
        });
    });

    test("XEvent start, stop, and collection emit an actionable XEL artifact", async () => {
        const delegate = new LocalSqlActivityDelegate(operations());
        const databaseRef = `runbook-sql-container-lease:effect-${"3".repeat(64)}`;
        const sessionRef = `runbook-xevent-session:effect-${"6".repeat(64)}`;
        const captureRef = `runbook-xevent-capture:effect-${"6".repeat(64)}`;
        const values: Record<string, string> = {
            "$nodes.container.connectionRef": databaseRef,
            "$nodes.start.sessionRef": sessionRef,
            "$nodes.stop.captureRef": captureRef,
        };
        const resolve = (value: unknown) =>
            typeof value === "string" ? (values[value] ?? value) : value;

        const start = await delegate.executeActivity(
            activity("xevent.session.start", {
                database: "$nodes.container.connectionRef",
                template: "developer-diagnostics",
                maxFileSizeMb: 16,
            }),
            binding(resolve),
        );
        expect(start?.success).to.equal(true);
        expect(start?.output?.contract).to.equal("xeventSessionLease/1");
        expect(start?.values?.sessionRef).to.equal(sessionRef);

        const stop = await delegate.executeActivity(
            activity("xevent.session.stop", {
                database: "$nodes.container.connectionRef",
                session: "$nodes.start.sessionRef",
            }),
            binding(resolve),
        );
        expect(stop?.success).to.equal(true);
        expect(stop?.output?.contract).to.equal("xeventCapture/1");
        expect(stop?.values?.captureRef).to.equal(captureRef);

        const collect = await delegate.executeActivity(
            activity("xevent.xel.collect", {
                database: "$nodes.container.connectionRef",
                capture: "$nodes.stop.captureRef",
            }),
            binding(resolve),
        );
        expect(collect?.success).to.equal(true);
        expect(collect?.output?.contract).to.equal("xelArtifact/1");
        expect(collect?.output?.scalars).to.include({
            artifactSizeBytes: 4096,
            artifactSha256: "8".repeat(64),
            eventCount: 12,
            captureComplete: true,
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
        expect(deploy?.runMetrics).to.deep.equal({
            "deployment.applied": true,
            "deployment.postDeployChangeCount": 0,
        });
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
        expect(verify?.runMetrics).to.deep.equal({
            "schema.alertCount": 0,
            "schema.changeCount": 0,
            "schema.matches": true,
        });
        expect(verify?.output?.contract).to.equal("schemaDiff/1");
        expect(verify?.values).to.deep.include({ matches: true, changeCount: 0 });
    });

    test("schemaComparisonExportDelegate retains expected differences", async () => {
        const delegate = new LocalSqlActivityDelegate(operations());
        const result = await delegate.executeActivity(
            activity("schema.compare.export", {
                dacpac: "$nodes.extract.artifactPath",
                database: "$params.target",
            }),
            binding((value) => {
                if (value === "$nodes.extract.artifactPath") {
                    return "C:\\managed\\WideWorldImporters.dacpac";
                }
                return value === "$params.target" ? "target-profile" : value;
            }),
        );

        expect(result?.success).to.equal(true);
        expect(result?.output?.contract).to.equal("schemaDiff/1");
        expect(result?.output?.scalars).to.deep.include({
            matches: false,
            changeCount: 1,
            artifactPath: "C:\\managed\\schema-comparison.xml",
            artifactSizeBytes: 512,
            artifactSha256: "7".repeat(64),
            executionMode: "local",
        });
        expect(result?.values).to.deep.include({
            matches: false,
            changeCount: 1,
            artifactPath: "C:\\managed\\schema-comparison.xml",
        });
        expect(result?.runMetrics).to.deep.include({
            "schema.matches": false,
            "schema.exported": true,
            "schema.exportSizeBytes": 512,
        });
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
            "evidence.passedNodeCount": 10,
            "evidence.failedNodeCount": 0,
            "evidence.handleCount": 8,
            "evidence.verdict": "pass",
        });
    });

    test("advertises only locally implemented activities", () => {
        const delegate = new LocalSqlActivityDelegate(operations());
        expect([...delegate.supportedActivityKinds]).to.have.members([
            "workspace.inspect",
            "sqltest.discover",
            "tsqlt.run",
            "dacpac.build",
            "dacpac.extract",
            "sandbox.provision",
            "devdatabase.provision",
            "sql.container.provision",
            "sql.workload.inspect",
            "dacpac.deploy.preview",
            "dacpac.deploy",
            "dacpac.deploy.dev",
            "dacpac.deploy.container",
            "xevent.session.start",
            "sql.schema.apply",
            "sql.workload.run",
            "xevent.session.stop",
            "xevent.xel.collect",
            "schema.compare",
            "schema.compare.export",
            "database.schema.inventory",
            "sandbox.dispose",
            "sql.container.dispose",
            "sqltest.run",
            "evidence.bundle",
            "sql.query.read",
        ]);
    });

    test("schema inventory uses closed SQL and returns a typed bounded grid", async () => {
        let executedSql = "";
        let disconnects = 0;
        const delegate = new LocalSqlActivityDelegate(
            operations({
                execute: async (_ownerUri, sql) => {
                    executedSql = sql;
                    return {
                        rowCount: 3,
                        columnInfo: [
                            column("ObjectType"),
                            column("SchemaName"),
                            column("ObjectName"),
                        ],
                        rows: [
                            [cell("Table"), cell("dbo"), cell("Orders")],
                            [cell("View"), cell("sales"), cell("OrderSummary")],
                            [cell("Stored procedure"), cell("dbo"), cell("GetOrders")],
                        ],
                    };
                },
                disconnect: async () => {
                    disconnects++;
                },
            }),
        );

        const result = await delegate.executeActivity(
            activity("database.schema.inventory", { database: "owned-target" }),
            binding(),
        );

        expect(executedSql).to.equal(LOCAL_SCHEMA_INVENTORY_SQL);
        expect(result?.success).to.equal(true);
        expect(result?.output).to.deep.include({
            contract: "databaseSchemaInventory/1",
            columns: ["ObjectType", "SchemaName", "ObjectName"],
        });
        expect(result?.output?.rows).to.deep.equal([
            ["Table", "dbo", "Orders"],
            ["View", "sales", "OrderSummary"],
            ["Stored procedure", "dbo", "GetOrders"],
        ]);
        expect(result?.output?.scalars).to.deep.include({ objectCount: 3, truncated: false });
        expect(result?.values).to.deep.equal({ objectCount: 3, truncated: false });
        expect(disconnects).to.equal(1);
    });

    test("schema inventory reports upstream row truncation honestly", async () => {
        const delegate = new LocalSqlActivityDelegate(
            operations({
                execute: async () => ({
                    rowCount: 5001,
                    columnInfo: [column("ObjectType"), column("SchemaName"), column("ObjectName")],
                    rows: [[cell("Table"), cell("dbo"), cell("Orders")]],
                }),
            }),
        );

        const result = await delegate.executeActivity(
            activity("database.schema.inventory", { database: "owned-target" }),
            binding(),
        );

        expect(result?.output?.scalars).to.deep.include({ objectCount: 1, truncated: true });
        expect(result?.values).to.deep.equal({ objectCount: 1, truncated: true });
        expect(result?.runMetrics).to.deep.include({ "schemaInventory.truncated": true });
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
