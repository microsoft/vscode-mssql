/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as vscode from "vscode";
import ConnectionManager, { ConnectionInfo } from "../../src/controllers/connectionManager";
import { ConnectionProfile } from "../../src/models/connectionProfile";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { SqlProjectsService } from "../../src/services/sqlProjectsService";
import { DacFxService } from "../../src/services/dacFxService";
import {
    taskCreatedEmitter,
    TaskStatus,
    SqlTasksService,
    type TaskInfo,
} from "../../src/services/sqlTasksService";
import {
    AzureSqlCompatibilityBuilder,
    getCompatibilityModelObjects,
    parseCompatibilityDiagnostics,
} from "../../src/deployment/azureSqlCompatibilityBuilder";
import { LocalDatabaseCompatibilityService } from "../../src/deployment/localDatabaseCompatibility";
import {
    LocalDatabaseCompatibilityRequest,
    LocalDatabaseCompatibilityDiagnostic,
} from "../../src/sharedInterfaces/azureSqlDatabase";
import { ProjectType } from "../../src/databaseProjects/common/enums";
import { ExtractTarget, TaskExecutionMode } from "../../src/enums";
import { stubLogger, stubTelemetry } from "./utils";
import { TelemetryActions, TelemetryViews } from "../../src/sharedInterfaces/telemetry";
import * as netCore from "../../src/databaseProjects/tools/netcoreTool";

chai.use(sinonChai);
const { expect } = chai;

suite("Local database Azure SQL compatibility", () => {
    let sandbox: sinon.SinonSandbox;
    let manager: sinon.SinonStubbedInstance<ConnectionManager>;
    let client: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let tasks: sinon.SinonStubbedInstance<SqlTasksService>;
    let disposeSuppression: sinon.SinonSpy;
    let projects: sinon.SinonStubbedInstance<SqlProjectsService>;
    let dacFx: sinon.SinonStubbedInstance<DacFxService>;
    let builder: sinon.SinonStubbedInstance<AzureSqlCompatibilityBuilder>;
    let service: LocalDatabaseCompatibilityService;
    let directory: string | undefined;
    let telemetry: ReturnType<typeof stubTelemetry>;
    const request: LocalDatabaseCompatibilityRequest = {
        validationId: "validation-one",
        sourceId: "local-database",
        deploymentContent: "schemaOnly",
    };
    async function createPackage(
        projectPath: string,
        diagnostics: LocalDatabaseCompatibilityDiagnostic[] = [],
        schemaObjects = ["[dbo].[Inventory]", "[dbo].[InventoryView]"],
    ) {
        const packagePath = path.join(path.dirname(projectPath), "Compatibility.dacpac");
        await fs.writeFile(packagePath, "test package");
        return { diagnostics, packagePath, objectsValidated: schemaObjects.length, schemaObjects };
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        telemetry = stubTelemetry(sandbox);
        manager = sandbox.createStubInstance(ConnectionManager);
        client = sandbox.createStubInstance(SqlToolsServiceClient);
        tasks = sandbox.createStubInstance(SqlTasksService);
        disposeSuppression = sandbox.spy();
        tasks.suppressTaskUI.callsFake(() => new vscode.Disposable(disposeSuppression));
        projects = sandbox.createStubInstance(SqlProjectsService);
        dacFx = sandbox.createStubInstance(DacFxService);
        builder = sandbox.createStubInstance(AzureSqlCompatibilityBuilder);
        sandbox.stub(netCore, "getMicrosoftBuildSqlVersion").returns("2.2.0");
        const profile = sandbox.createStubInstance(ConnectionProfile);
        Object.assign(profile, {
            id: request.sourceId,
            server: "localhost,1433",
            database: "InventoryDb",
        });

        const connection = new ConnectionInfo();
        connection.credentials = profile;
        sandbox.stub(manager, "activeConnections").get(() => ({ "source-uri": connection }));
        manager.isConnected.withArgs("source-uri").returns(true);
        projects.createProject.callsFake(async (projectPath) => {
            directory = path.dirname(projectPath);
            return { success: true, errorMessage: "" };
        });
        projects.openProject.resolves({ success: true, errorMessage: "" });
        projects.closeProject.resolves({ success: true, errorMessage: "" });
        dacFx.createProjectFromDatabase.resolves({
            success: true,
            errorMessage: "",
            operationId: "extract-one",
        });
        builder.build.callsFake((projectPath) => createPackage(projectPath));
        service = new LocalDatabaseCompatibilityService(
            manager,
            client,
            tasks,
            projects,
            dacFx,
            builder,
            stubLogger(sandbox),
        );
    });

    teardown(async () => {
        await service.clear();
        service.dispose();
        sandbox.restore();
        directory = undefined;
    });

    test("copies the validated package into deployment ownership before validation cleanup", async () => {
        await service.validate(request);
        const deploymentDirectory = await fs.mkdtemp(
            path.join(os.tmpdir(), "mssql-deployment-copy-test-"),
        );
        const destination = path.join(deploymentDirectory, "schema.dacpac");
        try {
            const result = await service.copyValidatedPackage(request, destination);
            await service.cancel(request.validationId);
            expect(await fs.readFile(destination, "utf8")).to.equal("test package");
            expect(result).to.include({ status: "passed", database: "InventoryDb" });
            expect(JSON.stringify(result)).not.to.include(deploymentDirectory);
        } finally {
            await fs.rm(deploymentDirectory, { recursive: true, force: true });
        }
    });

    test("refuses stale validations and mismatched source or deployment modes", async () => {
        await service.validate(request);
        for (const invalid of [
            { ...request, validationId: "stale" },
            { ...request, sourceId: "another-source" },
            { ...request, deploymentContent: "schemaAndData" as const },
        ]) {
            const error = await service
                .copyValidatedPackage(invalid, path.join(directory!, "invalid-copy.dacpac"))
                .then(
                    () => undefined,
                    (failure: unknown) => failure,
                );
            expect(error).to.be.instanceOf(Error);
        }
    });

    test("extracts into an Azure-targeted temporary project and retains the successful package until invalidated", async () => {
        const result = await service.validate(request);
        expect(result).to.include({
            sourceId: request.sourceId,
            database: "InventoryDb",
            status: "passed",
            objectsValidated: 2,
            packageId: request.validationId,
            packageFileName: "InventoryDb.dacpac",
        });
        expect(result.schemaObjects).to.deep.equal(["[dbo].[Inventory]", "[dbo].[InventoryView]"]);
        expect(projects.createProject).to.have.been.calledWith(
            sinon.match.string,
            ProjectType.SdkStyle,
            "Microsoft.Data.Tools.Schema.Sql.SqlAzureV12DatabaseSchemaProvider",
            "2.2.0",
        );
        expect(dacFx.createProjectFromDatabase).to.have.been.calledWith(
            "InventoryDb",
            directory,
            "InventoryDb",
            "1.0.0.0",
            "source-uri",
            ExtractTarget.schemaObjectType,
            TaskExecutionMode.execute,
            true,
        );
        const matchesTask = tasks.suppressTaskUI.firstCall.args[0];
        expect(matchesTask({ targetLocation: directory! } as TaskInfo)).to.equal(true);
        expect(
            matchesTask({ targetLocation: path.join(directory!, "other") } as TaskInfo),
        ).to.equal(false);
        expect(disposeSuppression).to.have.been.called;
        expect(projects.closeProject).to.have.been.calledWith(
            path.join(directory!, "Compatibility.sqlproj"),
        );
        expect(result).not.to.have.property("packagePath");
        expect(await fs.readFile(path.join(directory!, "InventoryDb.dacpac"), "utf8")).to.equal(
            "test package",
        );
        expect(await fs.readdir(directory!)).not.to.include("Compatibility.dacpac");
        await service.cancel(request.validationId);
        let exists = true;
        try {
            await fs.access(directory!);
        } catch {
            exists = false;
        }
        expect(exists).to.equal(false);
    });

    test("preserves actual warnings while allowing a successfully built package", async () => {
        const diagnostic: LocalDatabaseCompatibilityDiagnostic = {
            severity: "warning",
            category: "dependency",
            code: "SQL71502",
            message: "Unresolved reference",
        };
        builder.build.callsFake((projectPath) =>
            createPackage(projectPath, [diagnostic], ["[dbo].[Inventory]"]),
        );
        const result = await service.validate(request);
        expect(result.status).to.equal("warnings");
        expect(result.packageFileName).to.equal("InventoryDb.dacpac");
        await fs.access(path.join(directory!, "InventoryDb.dacpac"));
        expect(result.diagnostics).to.deep.equal([diagnostic]);
        expect(result.schemaObjects).to.deep.equal(["[dbo].[Inventory]"]);
        expect(telemetry.sendActionEvent).to.have.been.calledWith(
            TelemetryViews.LocalToCloudDeployment,
            TelemetryActions.ValidateLocalDatabaseCompatibility,
            sinon.match({
                additionalProps: {
                    deploymentContent: "schemaOnly",
                    status: "warnings",
                    stage: "validatingSchema",
                },
                additionalMeasurements: {
                    warningCount: 1,
                    errorCount: 0,
                    objectsValidated: 1,
                    durationInMs: sinon.match.number,
                },
            }),
        );
    });

    test("escapes filename separators in database names without creating directories", async () => {
        manager.activeConnections["source-uri"].credentials.database = "Sales/Inventory";
        const result = await service.validate(request);
        expect(result).to.include({
            status: "passed",
            database: "Sales/Inventory",
            packageFileName: "Sales_Inventory.dacpac",
        });
        expect(await fs.readFile(path.join(directory!, "Sales_Inventory.dacpac"), "utf8")).to.equal(
            "test package",
        );
    });

    test("reports a package renaming failure instead of a validation pass", async () => {
        builder.build.callsFake(async (projectPath) => ({
            diagnostics: [],
            packagePath: path.join(path.dirname(projectPath), "missing.dacpac"),
            objectsValidated: 1,
        }));
        const result = await service.validate(request);
        expect(result.status).to.equal("error");
        expect(result.errorMessage).to.be.a("string").and.not.to.equal("");
        expect(result.packageId).to.equal(undefined);
        expect(result.packageFileName).to.equal(undefined);
    });

    test("distinguishes blocking schema errors from build-tool failures", async () => {
        builder.build.resolves({
            diagnostics: [
                {
                    severity: "error",
                    category: "compatibility",
                    code: "SQL71578",
                    message: "Unsupported object",
                },
            ],
            errorMessage: "Build failed",
        });
        const blocked = await service.validate(request);
        expect(blocked.status).to.equal("blocked");
        expect(blocked.packageId).to.equal(undefined);
        expect(telemetry.sendActionEvent).to.have.been.calledWith(
            TelemetryViews.LocalToCloudDeployment,
            TelemetryActions.ValidateLocalDatabaseCompatibility,
            sinon.match({
                additionalProps: { status: "blocked" },
                additionalMeasurements: { errorCount: 1 },
            }),
        );
        expect(telemetry.sendErrorEvent).not.to.have.been.called;
        builder.build.resolves({
            diagnostics: [
                {
                    severity: "error",
                    category: "tooling",
                    code: "NU1301",
                    message: "Restore failed",
                },
            ],
            errorMessage: "Build failed",
        });
        expect((await service.validate({ ...request, validationId: "retry" })).status).to.equal(
            "error",
        );
        expect(telemetry.sendErrorEvent).to.have.been.calledWith(
            TelemetryViews.LocalToCloudDeployment,
            TelemetryActions.ValidateLocalDatabaseCompatibility,
            sinon.match({
                includeErrorMessage: false,
                errorType: "CompatibilityValidationFailed",
                additionalProps: { status: "error", stage: "validatingSchema" },
            }),
        );
    });

    test("does not build after unsuccessful extraction", async () => {
        const onProgress = sandbox.spy();
        dacFx.createProjectFromDatabase.resolves({
            success: false,
            errorMessage: "Extraction denied",
            operationId: "extract-one",
        });
        const result = await service.validate(request, onProgress);
        expect(result).to.include({ status: "error", errorMessage: "Extraction denied" });
        expect(onProgress).to.have.been.calledWith({
            validationId: request.validationId,
            stage: "extractingSchema",
        });
        expect(onProgress).not.to.have.been.calledWith(sinon.match({ stage: "validatingSchema" }));
        expect(builder.build).not.to.have.been.called;
        expect(projects.closeProject).to.have.been.called;
        expect(disposeSuppression).to.have.been.called;
    });

    test("reports progress only when extraction, Azure validation, and package verification start", async () => {
        const onProgress = sandbox.spy();
        dacFx.createProjectFromDatabase.callsFake(async () => {
            expect(onProgress).to.have.been.calledWith({
                validationId: request.validationId,
                stage: "extractingSchema",
            });
            expect(onProgress).not.to.have.been.calledWith(
                sinon.match({ stage: "validatingSchema" }),
            );
            return { success: true, errorMessage: "", operationId: "extract-one" };
        });
        builder.build.callsFake(async (_project, _signal, onCheckingPackage) => {
            expect(onProgress).to.have.been.calledWith({
                validationId: request.validationId,
                stage: "validatingSchema",
            });
            expect(onProgress).not.to.have.been.calledWith(
                sinon.match({ stage: "checkingPackage" }),
            );
            onCheckingPackage?.();
            return createPackage(_project, [], ["[dbo].[Inventory]"]);
        });
        expect((await service.validate(request, onProgress)).status).to.equal("passed");
        expect(telemetry.sendActionEvent).to.have.been.calledWith(
            TelemetryViews.LocalToCloudDeployment,
            TelemetryActions.ValidateLocalDatabaseCompatibility,
            sinon.match({
                additionalProps: {
                    deploymentContent: "schemaOnly",
                    status: "passed",
                    stage: "checkingPackage",
                },
                additionalMeasurements: {
                    objectsValidated: 1,
                    errorCount: 0,
                    warningCount: 0,
                    durationInMs: sinon.match.number,
                },
            }),
        );
        for (const stage of ["extractingSchema", "validatingSchema", "checkingPackage"]) {
            expect(telemetry.sendActionEvent).to.have.been.calledWith(
                TelemetryViews.LocalToCloudDeployment,
                TelemetryActions.LocalDatabaseCompatibilityStage,
                { additionalProps: { deploymentContent: "schemaOnly", stage } },
            );
        }
        expect(onProgress).to.have.been.calledWith({
            validationId: request.validationId,
            stage: "checkingPackage",
        });
    });

    test("rejects disconnected sources before creating artifacts", async () => {
        manager.isConnected.withArgs("source-uri").returns(false);
        expect((await service.validate(request)).status).to.equal("error");
        expect(projects.createProject).not.to.have.been.called;
    });

    test("cancels extraction by its task ID and waits before cleaning up", async () => {
        let finishExtraction!: () => void;
        let extractionStarted!: () => void;
        const started = new Promise<void>((resolve) => {
            extractionStarted = resolve;
        });
        dacFx.createProjectFromDatabase.callsFake(async () => {
            taskCreatedEmitter.fire({
                taskId: "extract-task",
                targetLocation: directory!,
                status: TaskStatus.InProgress,
                taskExecutionMode: TaskExecutionMode.execute,
                serverName: "localhost",
                databaseName: "InventoryDb",
                name: "Extract",
                description: "",
                providerName: "DacFx",
                isCancelable: true,
            });
            extractionStarted();
            await new Promise<void>((resolve) => {
                finishExtraction = resolve;
            });
            return { success: false, errorMessage: "Cancelled", operationId: "extract-one" };
        });
        client.sendRequest.callsFake(async () => {
            finishExtraction();
            return true;
        });
        const pending = service.validate(request);
        await started;
        await service.cancel(request.validationId);
        expect((await pending).status).to.equal("cancelled");
        expect(client.sendRequest).to.have.been.calledWith(
            sinon.match({ method: "tasks/canceltask" }),
            {
                taskId: "extract-task",
            },
        );
        expect(builder.build).not.to.have.been.called;
        expect(projects.closeProject).to.have.been.called;
        expect(telemetry.sendActionEvent).to.have.been.calledWith(
            TelemetryViews.LocalToCloudDeployment,
            TelemetryActions.ValidateLocalDatabaseCompatibility,
            sinon.match({ additionalProps: { status: "cancelled", stage: "extractingSchema" } }),
        );
        expect(telemetry.sendErrorEvent).not.to.have.been.called;
    });

    test("does not let a late cancellation invalidate a newer retained package", async () => {
        await service.validate(request);
        const second = {
            ...request,
            validationId: "newer-validation",
            deploymentContent: "schemaAndData" as const,
        };
        await service.validate(second);
        const retained = directory!;
        await service.cancel(request.validationId);
        await fs.access(path.join(retained, "InventoryDb.dacpac"));
    });

    test("surfaces project-close failures rather than reporting a compatibility pass", async () => {
        projects.closeProject.resolves({ success: false, errorMessage: "Close failed" });
        const result = await service.validate(request);
        expect(result).to.include({ status: "error", errorMessage: "Close failed" });
        expect(result.packageId).to.equal(undefined);
        expect(result.packageFileName).to.equal(undefined);
        expect(telemetry.sendErrorEvent).to.have.been.calledWith(
            TelemetryViews.LocalToCloudDeployment,
            TelemetryActions.ValidateLocalDatabaseCompatibility,
            sinon.match({ additionalProps: { status: "error", stage: "cleanup" } }),
        );
    });

    test("keeps database identities, diagnostics, paths and raw errors out of telemetry", async () => {
        builder.build.resolves({
            diagnostics: [
                {
                    severity: "error",
                    category: "tooling",
                    code: "CUSTOM-CODE",
                    message: "private diagnostic InventoryDb",
                    file: "private-source.sql",
                    line: 42,
                },
            ],
            errorMessage: "private build failure",
        });
        await service.validate(request);
        for (const event of [telemetry.sendActionEvent, telemetry.sendErrorEvent].flatMap((stub) =>
            stub.getCalls(),
        )) {
            const payload = event.args[2];
            expect(payload).not.to.have.property("error");
            expect(Object.keys(payload.additionalProps)).to.satisfy((keys: string[]) =>
                keys.every((key) => ["deploymentContent", "status", "stage"].includes(key)),
            );
            const text = JSON.stringify(payload);
            for (const value of [
                "InventoryDb",
                request.sourceId,
                request.validationId,
                "private diagnostic",
                "CUSTOM-CODE",
                "private-source.sql",
                "private build failure",
                directory!,
            ]) {
                expect(text).not.to.include(value);
            }
        }
    });

    test("parses real MSBuild diagnostics, deduplicates summaries, and separates unresolved references", () => {
        const root = path.join("test", "project");
        const table = path.resolve(root, "dbo", "Tables", "Inventory.sql");
        const output = [
            `${table}(3,5): error SQL71501: Table has an unresolved reference. [Compatibility.sqlproj]`,
            `${table}(3,5): error SQL71501: Table has an unresolved reference. [Compatibility.sqlproj]`,
            `${table}(1,1,1,1): Build error SQL71578: Object is not supported in Azure SQL. [Compatibility.sqlproj]`,
            "MSBUILD : error MSB1009: Project file does not exist.",
            `${table}(2,1): warning SQL71502: Unresolved object. [Compatibility.sqlproj]`,
        ].join("\r\n");
        const diagnostics = parseCompatibilityDiagnostics(output, root);
        expect(diagnostics.map(({ code, category }) => ({ code, category }))).to.deep.equal([
            { code: "SQL71501", category: "dependency" },
            { code: "SQL71578", category: "compatibility" },
            { code: "MSB1009", category: "tooling" },
            { code: "SQL71502", category: "dependency" },
        ]);
        expect(diagnostics[0]).to.include({
            file: path.join("dbo", "Tables", "Inventory.sql"),
            line: 3,
        });
    });

    test("lists named model objects rather than files, columns or database settings", () => {
        expect(
            getCompatibilityModelObjects(`<DataSchemaModel><Model>
            <Element Type="SqlTable" Name="[dbo].[Inventory]"><Relationship><Element Type="SqlTable" Name="nested"/></Relationship></Element>
            <Element Type="SqlView" Name="[dbo].[InventoryView]" />
            <Element Type="SqlDatabaseOptions" Name="Options" />
            <Element Type="SqlSimpleColumn" Name="[dbo].[Inventory].[Id]" />
            <Element Type="SqlTable" />
            <Element Type="SqlProcedure" Name="[dbo].[Sales&amp;Inventory]" />
        </Model></DataSchemaModel>`),
        ).to.deep.equal(["[dbo].[Inventory]", "[dbo].[InventoryView]", "[dbo].[Sales&Inventory]"]);
        expect(() => getCompatibilityModelObjects("<invalid />")).to.throw();
    });

    test("builds a supported schema and blocks FILESTREAM under the Azure target", async function () {
        if (process.env.MSSQL_COMPATIBILITY_BUILD_INTEGRATION !== "1") {
            this.skip();
        }
        this.timeout(4 * 60 * 1000);
        const buildDirectory = await fs.mkdtemp(
            path.join(os.tmpdir(), "mssql-compatibility-build-test-"),
        );
        const output = vscode.window.createOutputChannel("Azure SQL compatibility build test");
        try {
            const project = path.join(buildDirectory, "Compatibility.sqlproj");
            await fs.writeFile(
                project,
                `<Project Sdk="Microsoft.Build.Sql/${netCore.getMicrosoftBuildSqlVersion()}"><PropertyGroup><DSP>Microsoft.Data.Tools.Schema.Sql.SqlAzureV12DatabaseSchemaProvider</DSP></PropertyGroup></Project>`,
            );
            await fs.writeFile(
                path.join(buildDirectory, "Inventory.sql"),
                "CREATE TABLE [dbo].[Inventory] ([Id] INT NOT NULL PRIMARY KEY, [Name] NVARCHAR(100));",
            );
            const realBuilder = new AzureSqlCompatibilityBuilder(output);
            const onCheckingPackage = sandbox.spy();
            const supported = await realBuilder.build(
                project,
                new AbortController().signal,
                onCheckingPackage,
            );
            expect(supported.errorMessage).to.equal(undefined);
            expect(supported.objectsValidated).to.equal(1);
            expect(supported.schemaObjects).to.deep.equal(["[dbo].[Inventory]"]);
            expect(supported.packagePath).to.be.a("string");
            await fs.access(supported.packagePath!);
            expect(onCheckingPackage).to.have.been.called;
            onCheckingPackage.resetHistory();
            await fs.writeFile(
                path.join(buildDirectory, "Unsupported.sql"),
                "CREATE TABLE [dbo].[FileData] ([Id] UNIQUEIDENTIFIER ROWGUIDCOL NOT NULL UNIQUE, [Content] VARBINARY(MAX) FILESTREAM NULL);",
            );
            const blocked = await realBuilder.build(
                project,
                new AbortController().signal,
                onCheckingPackage,
            );
            expect(blocked.packagePath).to.equal(undefined);
            expect(onCheckingPackage).not.to.have.been.called;
            expect(blocked.diagnostics).to.deep.include({
                severity: "error",
                category: "compatibility",
                code: "SQL70015",
                message:
                    "Keyword or statement option 'FILESTREAM' is not supported for the targeted platform.",
                file: "Unsupported.sql",
                line: 1,
            });
        } finally {
            output.dispose();
            await fs.rm(buildDirectory, { recursive: true, force: true });
        }
    });
});
