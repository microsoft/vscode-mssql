/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { DacFxResult, IServerInfo, SimpleExecuteResult } from "vscode-mssql";
import { KnownFreeLimitExhaustionBehavior } from "@azure/arm-sql";
import MainController from "../../src/controllers/mainController";
import ConnectionManager, { ConnectionInfo } from "../../src/controllers/connectionManager";
import { ConnectionStore } from "../../src/models/connectionStore";
import { ConnectionProfile } from "../../src/models/connectionProfile";
import { CredentialsQuickPickItemType } from "../../src/models/interfaces";
import { ConnectionUI } from "../../src/views/connectionUI";
import { TreeNodeInfo } from "../../src/objectExplorer/nodes/treeNodeInfo";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { SqlProjectsService } from "../../src/services/sqlProjectsService";
import { DacFxService } from "../../src/services/dacFxService";
import {
    SqlTasksService,
    taskCreatedEmitter,
    taskProgressEmitter,
    TaskStatus,
    type TaskInfo,
} from "../../src/services/sqlTasksService";
import {
    AzureSqlCompatibilityBuilder,
    connectLocalDatabaseSource,
    getCompatibilityModelObjects,
    getLocalDatabaseSources,
    LocalDatabaseCompatibilityService,
    LocalDatabaseDeploymentService,
    parseCompatibilityDiagnostics,
} from "../../src/deployment/localToCloudHelpers";
import { DeploymentWebviewController } from "../../src/deployment/deploymentWebviewController";
import { VsCodeAzureHelper } from "../../src/connectionconfig/azureHelpers";
import * as cloud from "../../src/azure/providerSettings";
import * as entra from "../../src/azure/vscodeEntraMfaUtils";
import { DatabaseEngineEdition, ProjectType } from "../../src/databaseProjects/common/enums";
import * as netCore from "../../src/databaseProjects/tools/netcoreTool";
import { AuthenticationType } from "../../src/sharedInterfaces/connectionDialog";
import {
    AzureSqlDatabaseState,
    LocalDatabaseCompatibilityDiagnostic,
    LocalDatabaseCompatibilityRequest,
    LocalDatabaseDeploymentProgress,
    LocalDatabaseDeploymentRequest,
} from "../../src/sharedInterfaces/azureSqlDatabase";
import { DeploymentType, DeploymentWebviewState } from "../../src/sharedInterfaces/deployment";
import { ApiStatus } from "../../src/sharedInterfaces/webview";
import { ExtractTarget, TaskExecutionMode } from "../../src/enums";
import * as Constants from "../../src/constants/constants";
import { LocalToCloud } from "../../src/constants/locConstants";
import { TelemetryActions, TelemetryViews } from "../../src/sharedInterfaces/telemetry";
import {
    BackgroundTasksService,
    BackgroundTaskState,
} from "../../src/backgroundTasks/backgroundTasksService";
import { stubLogger, stubTelemetry } from "./utils";
import { mockSubscriptions } from "./azureHelperStubs";

chai.use(sinonChai);
const { expect } = chai;

suite("Local-to-cloud helpers", () => {
    //#region Source databases

    suite("Local database deployment sources", () => {
        test("includes localhost aliases, protocols, ports and named instances", () => {
            const servers = [
                "localhost",
                "LOCALHOST,1433",
                " tcp:localhost,1434 ",
                "localhost\\SQLEXPRESS",
                "127.0.0.1,1433",
                "127.0.0.2",
                "[::1],1433",
                "::1",
                "(local)\\SQL",
                ".",
                ".\\SQLEXPRESS",
            ];
            const sources = getLocalDatabaseSources(
                servers.map((server, index) => ({
                    id: String(index),
                    server,
                    database: "InventoryDb",
                })),
            );
            expect(sources.map((source) => source.server)).to.deep.equal(
                servers.map((server) => server.trim()),
            );
        });

        test("excludes remote hosts and localhost prefix lookalikes", () => {
            const servers = [
                "localhost.example.com",
                "localhost-other",
                "127.0.0.1.example.com",
                "server.database.windows.net",
                "192.168.1.20,1433",
                "[::10],1433",
                "",
            ];
            expect(
                getLocalDatabaseSources(
                    servers.map((server, index) => ({
                        id: String(index),
                        server,
                        database: "InventoryDb",
                    })),
                ),
            ).to.deep.equal([]);
        });

        test("excludes server-level connections without a selected database", () => {
            const sources = getLocalDatabaseSources([
                { id: "missing", server: "localhost,1433" },
                { id: "empty", server: "localhost,1433", database: "" },
                { id: "whitespace", server: "localhost,1433", database: "   " },
                { id: "database", server: "localhost,1433", database: "InventoryDb" },
            ]);
            expect(sources.map((source) => source.id)).to.deep.equal(["database"]);
        });

        test("deduplicates by identity, not display values, and only returns display fields", () => {
            const connection = {
                id: "local-one",
                profileName: "Development",
                server: "localhost,1433",
                database: "InventoryDb",
                password: "not-for-the-webview",
            };
            const sources = getLocalDatabaseSources([
                connection,
                { ...connection, database: "RecentDb" },
                { ...connection, id: "local-two" },
                { server: "localhost", database: "NoIdentity" },
            ]);
            expect(sources).to.deep.equal([
                {
                    id: "local-one",
                    profileName: "Development",
                    server: "localhost,1433",
                    database: "InventoryDb",
                    isConnected: false,
                    serverVersion: undefined,
                },
                {
                    id: "local-two",
                    profileName: "Development",
                    server: "localhost,1433",
                    database: "InventoryDb",
                    isConnected: false,
                    serverVersion: undefined,
                },
            ]);
        });

        test("uses active connection metadata instead of a saved profile with the same identity", () => {
            const saved = {
                id: "local",
                profileName: "Development",
                server: "localhost,1433",
                database: "InventoryDb",
            };
            expect(
                getLocalDatabaseSources([
                    saved,
                    {
                        id: saved.id,
                        server: saved.server,
                        database: "AppDb",
                        isConnected: true,
                        serverVersion: "17.0.1000",
                    },
                    saved,
                ]),
            ).to.deep.equal([
                {
                    ...saved,
                    database: "AppDb",
                    isConnected: true,
                    serverVersion: "17.0.1000",
                },
            ]);
        });
    });

    //#endregion

    //#region Source connections

    suite("Connecting local deployment databases", () => {
        let sandbox: sinon.SinonSandbox;
        let manager: sinon.SinonStubbedInstance<ConnectionManager>;
        let store: sinon.SinonStubbedInstance<ConnectionStore>;
        let profile: ConnectionProfile;
        let connection: ConnectionInfo;
        let active: Record<string, ConnectionInfo>;
        let client: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
        const connectSource = () => connectLocalDatabaseSource(manager, profile.id, client);

        setup(() => {
            sandbox = sinon.createSandbox();
            manager = sandbox.createStubInstance(ConnectionManager);
            client = sandbox.createStubInstance(SqlToolsServiceClient);
            client.sendRequest.resolves({
                rowCount: 1,
                columnInfo: [],
                rows: [
                    [
                        {
                            displayValue: "Microsoft SQL Server 2025 (RTM) - 17.0.1000",
                            isNull: false,
                        },
                    ],
                ],
            });
            store = sandbox.createStubInstance(ConnectionStore);
            sandbox.stub(manager, "connectionStore").get(() => store);
            active = {};
            sandbox.stub(manager, "activeConnections").get(() => active);
            profile = sandbox.createStubInstance(ConnectionProfile);
            profile.id = "local-db";
            profile.profileName = "Development";
            profile.server = "localhost,1433";
            profile.database = "InventoryDb";
            store.readAllConnections.resolves([
                Object.assign(profile, { profileSource: CredentialsQuickPickItemType.Profile }),
            ]);
            connection = new ConnectionInfo();
            connection.credentials = profile;
            connection.connectionId = "active-db";
            connection.serverInfo = {
                serverVersion: "17.0.1000",
                serverMajorVersion: 17,
                engineEditionId: DatabaseEngineEdition.Enterprise,
                isCloud: false,
            } as IServerInfo;
            manager.getConnectionInfo.returns(connection);
        });

        teardown(() => sandbox.restore());

        test("connects a saved database and returns its release year without leaking credentials", async () => {
            manager.connect.callsFake(async (_uri, credentials) => {
                credentials.password = "test-only-password";
                return true;
            });
            const result = await connectSource();

            expect(result).to.include({
                id: profile.id,
                database: "InventoryDb",
                isConnected: true,
                serverVersion: "2025",
            });
            expect(result).not.to.have.property("password");
            expect(profile.password).not.to.equal("test-only-password");
            expect(manager.connect).to.have.been.calledWith(
                sinon.match.string,
                sinon.match({ id: profile.id }),
                {
                    shouldHandleErrors: false,
                    connectionSource: "localToCloudDeployment",
                },
            );
            expect(client.sendRequest).to.have.been.calledWith(
                sinon.match({ method: "query/simpleexecute" }),
                sinon.match({
                    ownerUri: sinon.match.string,
                    queryString: "SELECT @@VERSION AS version;",
                }),
            );
        });

        test("reuses a connected database identified by its connection ID", async () => {
            active.existing = connection;
            manager.isConnected.withArgs("existing").returns(true);

            const result = await connectSource();

            expect(result.isConnected).to.equal(true);
            expect(result.serverVersion).to.equal("2025");
            expect(manager.connect).not.to.have.been.called;
            expect(client.sendRequest).to.have.been.calledWith(sinon.match.any, {
                ownerUri: "existing",
                queryString: "SELECT @@VERSION AS version;",
            });
        });

        test("rejects a failed connection instead of returning a stale version", async () => {
            manager.connect.resolves(false);
            let failure: unknown;
            try {
                await connectSource();
            } catch (error) {
                failure = error;
            }
            expect(failure).to.be.instanceOf(Error);
            expect(failure).to.have.property(
                "message",
                "Unable to connect to the selected local database.",
            );
        });

        test("propagates credential or connection errors", async () => {
            const failure = new Error("Credential lookup failed");
            manager.connect.rejects(failure);
            let actual: unknown;
            try {
                await connectSource();
            } catch (error) {
                actual = error;
            }
            expect(actual).to.equal(failure);
        });

        test("does not connect an unknown ID", async () => {
            store.readAllConnections.resolves([]);
            let failure: unknown;
            try {
                await connectSource();
            } catch (error) {
                failure = error;
            }
            expect(failure).to.be.instanceOf(Error);
            expect(manager.connect).not.to.have.been.called;
        });

        test("does not connect a remote profile", async () => {
            profile.server = "remote.database.windows.net";
            let failure: unknown;
            try {
                await connectSource();
            } catch (error) {
                failure = error;
            }
            expect(failure).to.be.instanceOf(Error);
            expect(manager.connect).not.to.have.been.called;
        });

        test("extracts the release year from the query rather than a major-version mapping", async () => {
            manager.connect.resolves(true);
            client.sendRequest.resolves({
                rows: [
                    [
                        {
                            displayValue:
                                "Microsoft SQL Server 2022 (RTM-CU) - 16.0.1234\nDeveloper Edition",
                            isNull: false,
                        },
                    ],
                ],
            });
            expect((await connectSource()).serverVersion).to.equal("2022");
        });

        test("keeps the actual Azure SQL container build instead of labeling it SQL Server 2014", async () => {
            connection.serverInfo = {
                ...connection.serverInfo!,
                serverVersion: "12.0.2000.8",
                serverMajorVersion: 12,
                engineEditionId: -978196525,
            };
            manager.connect.resolves(true);

            expect(await connectSource()).to.include({
                serverVersion: "12.0.2000.8",
                isAzureSql: true,
            });
            active.existing = connection;
            manager.isConnected.withArgs("existing").returns(true);
            expect(await connectSource()).to.include({
                serverVersion: "12.0.2000.8",
                isAzureSql: true,
            });
            expect(client.sendRequest).not.to.have.been.called;
        });

        test("rejects missing, unexpected and error query results instead of guessing a year", async () => {
            manager.connect.resolves(true);
            for (const result of [
                { rows: [] },
                { rows: [[{ displayValue: "17.0.1000", isNull: false }]] },
                { rows: [[{ displayValue: "Microsoft SQL Server 2025", isNull: true }]] },
                {
                    rows: [[{ displayValue: "Microsoft SQL Server 2025", isNull: false }]],
                    messages: [{ isError: true, message: "Query failed" }],
                },
            ]) {
                client.sendRequest.resolves(result);
                let failure: unknown;
                try {
                    await connectSource();
                } catch (error) {
                    failure = error;
                }
                expect(failure).to.have.property(
                    "message",
                    "Unable to determine the selected SQL Server release year.",
                );
            }
        });

        test("propagates a version-query failure", async () => {
            manager.connect.resolves(true);
            const failure = new Error("Version query failed");
            client.sendRequest.rejects(failure);
            let actual: unknown;
            try {
                await connectSource();
            } catch (error) {
                actual = error;
            }
            expect(actual).to.equal(failure);
        });
    });

    //#endregion

    //#region Compatibility validation

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
            return {
                diagnostics,
                packagePath,
                objectsValidated: schemaObjects.length,
                schemaObjects,
            };
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
            expect(result.schemaObjects).to.deep.equal([
                "[dbo].[Inventory]",
                "[dbo].[InventoryView]",
            ]);
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
            expect(
                await fs.readFile(path.join(directory!, "Sales_Inventory.dacpac"), "utf8"),
            ).to.equal("test package");
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
            expect(onProgress).not.to.have.been.calledWith(
                sinon.match({ stage: "validatingSchema" }),
            );
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
                sinon.match({
                    additionalProps: { status: "cancelled", stage: "extractingSchema" },
                }),
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
            for (const event of [telemetry.sendActionEvent, telemetry.sendErrorEvent].flatMap(
                (stub) => stub.getCalls(),
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
            ).to.deep.equal([
                "[dbo].[Inventory]",
                "[dbo].[InventoryView]",
                "[dbo].[Sales&Inventory]",
            ]);
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

    //#endregion

    //#region Deployment

    function rows(values: string[][]): SimpleExecuteResult {
        return {
            rowCount: values.length,
            columnInfo: [],
            rows: values.map((row) => row.map((displayValue) => ({ displayValue, isNull: false }))),
        };
    }

    suite("Local database Azure SQL deployment", () => {
        let sandbox: sinon.SinonSandbox;
        let controller: sinon.SinonStubbedInstance<DeploymentWebviewController>;
        let main: sinon.SinonStubbedInstance<MainController>;
        let manager: sinon.SinonStubbedInstance<ConnectionManager>;
        let client: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
        let dacFx: sinon.SinonStubbedInstance<DacFxService>;
        let compatibility: sinon.SinonStubbedInstance<LocalDatabaseCompatibilityService>;
        let connectionUI: sinon.SinonStubbedInstance<ConnectionUI>;
        let output: vscode.OutputChannel;
        let state: AzureSqlDatabaseState;
        let service: LocalDatabaseDeploymentService;
        let request: LocalDatabaseDeploymentRequest;
        let directories: string[];
        let sourceCounts: string[][];
        let targetCounts: string[][];
        let targetHasObjects: boolean;
        let usedBytes: string;
        let connected: Set<string>;
        let createDatabase: sinon.SinonStub;
        let validateTarget: sinon.SinonStub;
        let progress: LocalDatabaseDeploymentProgress[];
        let objects: string[];
        let providerSettings: sinon.SinonStub;
        let telemetry: ReturnType<typeof stubTelemetry>;
        let backgroundTasks: BackgroundTasksService;
        const success: DacFxResult = { success: true, errorMessage: "", operationId: "operation" };

        setup(() => {
            sandbox = sinon.createSandbox();
            telemetry = stubTelemetry(sandbox);
            directories = [];
            objects = ["[dbo].[Inventory]"];
            progress = [];
            sourceCounts = [["[dbo].[Inventory]", "3"]];
            targetCounts = [["[dbo].[Inventory]", "3"]];
            targetHasObjects = false;
            usedBytes = "1024";
            connected = new Set(["selected-source"]);
            request = {
                deploymentId: "deployment-one",
                validationId: "validation-one",
                sourceId: "source-id",
                deploymentContent: "schemaOnly",
                target: {
                    subscriptionId: "subscription",
                    resourceGroup: "group",
                    serverName: "server",
                    databaseName: "CloudInventory",
                },
                tags: { project: "inventory" },
            };
            const credential = {
                getToken: sandbox
                    .stub()
                    .resolves({ token: "arm-token", expiresOnTimestamp: Date.now() + 3_600_000 }),
            };
            state = new AzureSqlDatabaseState({
                loadState: ApiStatus.Loaded,
                formState: {
                    accountId: "account",
                    tenantId: "tenant",
                    ...request.target,
                    authenticationType: AuthenticationType.SqlLogin,
                    userName: "admin",
                    password: "test-password",
                    savePassword: true,
                    freeLimitBehavior: KnownFreeLimitExhaustionBehavior.AutoPause,
                    profileName: "Cloud inventory",
                    groupId: "",
                    dataSource: "",
                    collation: "",
                    maintenanceConfig: "",
                    enableAlwaysEncrypted: false,
                    maxVcores: "2",
                },
                subscriptions: [
                    { ...mockSubscriptions[0], subscriptionId: "subscription", credential },
                ],
            });
            const controllerState = new DeploymentWebviewState();
            controllerState.deploymentType = DeploymentType.AzureSqlDatabase;
            controllerState.deploymentTypeState = state;
            controller = sandbox.createStubInstance(DeploymentWebviewController);
            sandbox.stub(controller, "state").value(controllerState);
            controller.validateDeploymentForm.resolves([]);
            main = sandbox.createStubInstance(MainController);
            controller.mainController = main;
            backgroundTasks = new BackgroundTasksService(() => {});
            main.backgroundTasksService = backgroundTasks;
            manager = sandbox.createStubInstance(ConnectionManager);
            sandbox.stub(main, "connectionManager").get(() => manager);
            dacFx = sandbox.createStubInstance(DacFxService);
            main.dacFxService = dacFx;
            const tasks = sandbox.createStubInstance(SqlTasksService);
            tasks.suppressTaskUI.callsFake(() => new vscode.Disposable(() => {}));
            main.sqlTasksService = tasks;
            connectionUI = sandbox.createStubInstance(ConnectionUI);
            sandbox.stub(manager, "connectionUI").get(() => connectionUI);
            connectionUI.saveProfile.callsFake(async (profile) => profile);
            const node = sandbox.createStubInstance(TreeNodeInfo);
            sandbox.stub(node, "sessionId").get(() => "object-explorer-session");
            main.createObjectExplorerSession.resolves(node);
            const source = new ConnectionInfo();
            source.credentials = Object.assign(new ConnectionProfile(), {
                id: "source-id",
                server: "localhost,1433",
                database: "Inventory",
            });
            sandbox.stub(manager, "activeConnections").get(() => ({ "selected-source": source }));
            manager.isConnected.callsFake((uri) => connected.has(uri));
            manager.connect.callsFake(async (uri) => {
                connected.add(uri);
                return true;
            });
            manager.disconnect.callsFake(async (uri) => {
                connected.delete(uri);
                return true;
            });
            client = sandbox.createStubInstance(SqlToolsServiceClient);
            client.sendRequest.callsFake(async (_type, params) => {
                const { queryString, ownerUri } = params as {
                    queryString: string;
                    ownerUri: string;
                };
                if (queryString.includes("used_bytes")) return rows([[usedBytes]]);
                if (queryString.includes("has_user_objects"))
                    return rows([[targetHasObjects ? "1" : "0"]]);
                if (queryString.includes("tables_cursor"))
                    return rows(ownerUri.includes("-source:") ? sourceCounts : targetCounts);
                if (queryString.includes("QUOTENAME")) return rows(objects.map((name) => [name]));
                throw new Error(`Unexpected verification query: ${queryString}`);
            });
            compatibility = sandbox.createStubInstance(LocalDatabaseCompatibilityService);
            compatibility.copyValidatedPackage.callsFake(async (validation, destination) => {
                directories.push(path.dirname(destination));
                await fs.writeFile(destination, "exact validated DACPAC");
                return {
                    ...validation,
                    database: "Inventory",
                    target: "AzureSqlDatabase",
                    status: "passed",
                    diagnostics: [],
                    schemaObjects: objects,
                    objectsValidated: objects.length,
                    snapshotCreatedAt: new Date().toISOString(),
                };
            });
            dacFx.deployDacpac.resolves(success);
            dacFx.importBacpac.resolves(success);
            dacFx.exportBacpac.callsFake(async (_database, packagePath) => {
                await fs.writeFile(packagePath, "exported schema and rows");
                return success;
            });
            validateTarget = sandbox
                .stub(VsCodeAzureHelper, "validateNewAzureSqlDatabase")
                .resolves({
                    location: "westus",
                    fullyQualifiedDomainName: "server.database.windows.net",
                });
            createDatabase = sandbox
                .stub(VsCodeAzureHelper, "createAzureSqlDatabase")
                .resolves({ location: "westus" });
            const settings = cloud.getCloudProviderSettings();
            providerSettings = sandbox.stub(cloud, "getCloudProviderSettings").returns(settings);
            output = {
                name: "Deployment test",
                appendLine: sandbox.stub(),
                append: sandbox.stub(),
                replace: sandbox.stub(),
                clear: sandbox.stub(),
                show: () => {},
                hide: sandbox.stub(),
                dispose: sandbox.stub(),
            };
            service = new LocalDatabaseDeploymentService(
                controller,
                compatibility,
                client,
                output,
                stubLogger(sandbox),
            );
        });

        teardown(async () => {
            await service.cancel(request.deploymentId);
            service.dispose();
            for (const directory of directories) {
                await fs.rm(directory, { recursive: true, force: true });
            }
            sandbox.restore();
        });

        const deploy = () => service.deploy(request, (value) => progress.push(value));
        const withData = () => {
            request.deploymentContent = "schemaAndData";
        };

        for (const deploymentContent of ["schemaOnly", "schemaAndData"] as const) {
            test(`continues ${deploymentContent} in Background Tasks when the wizard closes before package capture`, async () => {
                request.deploymentContent = deploymentContent;
                let release: () => void;
                let validating: () => void;
                const gate = new Promise<void>((resolve) => {
                    release = resolve;
                });
                const started = new Promise<void>((resolve) => {
                    validating = resolve;
                });
                controller.validateDeploymentForm.callsFake(async () => {
                    validating();
                    await gate;
                    return [];
                });
                const showOutput = sandbox.spy(output, "show");
                const deployment = deploy();
                await started;
                const task = backgroundTasks.tasks.find(
                    (task) => task.displayText === LocalToCloud.deployingDatabase("CloudInventory"),
                )!;
                try {
                    expect(task).to.include({
                        state: BackgroundTaskState.InProgress,
                        canCancel: true,
                        message: LocalToCloud.deploymentStages.validatingSettings,
                    });
                    service.dispose();
                    expect(compatibility.dispose).not.to.have.been.called;
                    expect(compatibility.copyValidatedPackage).not.to.have.been.called;
                } finally {
                    release();
                }
                const progressBeforeClose = [...progress];
                expect(await deployment).to.include({
                    status: "succeeded",
                    database: "CloudInventory",
                });
                expect(progress).to.deep.equal(progressBeforeClose);
                expect(compatibility.dispose).to.have.been.called;
                expect(main.createObjectExplorerSession).to.have.been.called;
                expect(backgroundTasks.tasks.find((entry) => entry.id === task.id)).to.include({
                    state: BackgroundTaskState.Succeeded,
                    canCancel: false,
                    message: LocalToCloud.deploymentSucceeded,
                });
                expect(
                    backgroundTasks.getTaskLog(task.id)?.entries.map((entry) => entry.message),
                ).to.include.members([
                    LocalToCloud.deploymentStages[
                        deploymentContent === "schemaOnly" ? "publishingSchema" : "importingData"
                    ],
                    LocalToCloud.deploymentStages.verifying,
                    LocalToCloud.deploymentStages.savingConnection,
                ]);
                await backgroundTasks.openTask(task.id);
                expect(showOutput).to.have.been.calledWith(true);
                for (const directory of directories) {
                    expect(
                        await fs.stat(directory).then(
                            () => true,
                            () => false,
                        ),
                    ).to.equal(false);
                }
            });
        }

        test("cleans up compatibility immediately when the wizard closes without a deployment", () => {
            service.dispose();
            expect(compatibility.dispose).to.have.been.called;
        });

        test("copies the deployed connection without a password or application name", async () => {
            await deploy();
            const details = {
                options: { server: "server.database.windows.net", database: "CloudInventory" },
            };
            manager.createConnectionDetails.returns(details);
            manager.getConnectionString.resolves(
                "Server=server.database.windows.net;Database=CloudInventory;",
            );
            const write = sandbox.stub().resolves();
            sandbox.stub(vscode.env, "clipboard").value({ writeText: write });
            await service.performAction(request.deploymentId, "copyConnectionString");
            expect(manager.getConnectionString).to.have.been.calledWith(details, false, false);
            expect(manager.createConnectionDetails.firstCall.args[0]).to.include({
                server: "server.database.windows.net",
                database: "CloudInventory",
            });
            expect(write).to.have.been.calledWith(
                "Server=server.database.windows.net;Database=CloudInventory;",
            );
            expect(telemetry.sendActionEvent).to.have.been.calledWith(
                TelemetryViews.LocalToCloudDeployment,
                TelemetryActions.LocalToCloudPostDeploymentAction,
                sinon.match({
                    additionalProps: { action: "copyConnectionString", status: "succeeded" },
                }),
            );
        });

        test("opens the captured database in the configured cloud portal", async () => {
            const settings = cloud.getCloudProviderSettings();
            providerSettings.returns({
                ...settings,
                portalEndpoint: "https://portal.azure.us/",
            });
            request.target.databaseName = state.formState.databaseName = "Cloud Inventory";
            await deploy();
            state.formState.databaseName = "OtherDatabase";
            const open = sandbox.stub(vscode.env, "openExternal").resolves(true);
            await service.performAction(request.deploymentId, "openPortal");
            expect(open.firstCall.args[0]).to.include({
                scheme: "https",
                authority: "portal.azure.us",
            });
            expect(open.firstCall.args[0].fragment).to.equal(
                "resource/subscriptions/subscription/resourceGroups/group/providers/Microsoft.Sql/servers/server/databases/Cloud Inventory",
            );
            expect(telemetry.sendActionEvent).to.have.been.calledWith(
                TelemetryViews.LocalToCloudDeployment,
                TelemetryActions.LocalToCloudPostDeploymentAction,
                sinon.match({ additionalProps: { action: "openPortal", status: "succeeded" } }),
            );
        });

        test("surfaces portal and clipboard failures instead of reporting success", async () => {
            await deploy();
            sandbox.stub(vscode.env, "openExternal").resolves(false);
            let error: unknown;
            try {
                await service.performAction(request.deploymentId, "openPortal");
            } catch (value) {
                error = value;
            }
            expect(error).to.be.instanceOf(Error);
            expect((error as Error).message).to.equal(LocalToCloud.deploymentPortalFailed);
            manager.getConnectionString.rejects(new Error("Connection string unavailable"));
            try {
                await service.performAction(request.deploymentId, "copyConnectionString");
            } catch (value) {
                error = value;
            }
            expect((error as Error).message).to.equal("Connection string unavailable");
            for (const action of ["openPortal", "copyConnectionString"]) {
                expect(telemetry.sendErrorEvent).to.have.been.calledWith(
                    TelemetryViews.LocalToCloudDeployment,
                    TelemetryActions.LocalToCloudPostDeploymentAction,
                    sinon.match({
                        errorType: "PostDeploymentActionFailed",
                        includeErrorMessage: false,
                        additionalProps: { action, status: "error" },
                    }),
                );
            }
        });

        test("does not allow success actions for failed or unknown deployments", async () => {
            dacFx.deployDacpac.resolves({ ...success, success: false });
            await deploy();
            const open = sandbox.stub(vscode.env, "openExternal").resolves(true);
            for (const id of [request.deploymentId, "unknown"]) {
                let error: unknown;
                try {
                    await service.performAction(id, "openPortal");
                } catch (value) {
                    error = value;
                }
                expect(error).to.be.instanceOf(Error);
                expect((error as Error).message).to.equal(LocalToCloud.invalidDeployment);
            }
            expect(open).not.to.have.been.called;
        });

        test("returns deployment script settings from the captured destination without credentials", async () => {
            state.formState.collation = "Latin1_General_100_CI_AS";
            state.formState.maxVcores = "4";
            state.formState.maintenanceConfig = "/maintenance/config";
            state.formState.enableAlwaysEncrypted = true;
            const result = await deploy();
            expect(result.scriptSettings).to.deep.equal({
                databaseName: "CloudInventory",
                serverName: "server",
                resourceGroup: "group",
                serverResourceId:
                    "/subscriptions/subscription/resourceGroups/group/providers/Microsoft.Sql/servers/server",
                location: "westus",
                collation: "Latin1_General_100_CI_AS",
                maxVcores: "4",
                freeLimitBehavior: KnownFreeLimitExhaustionBehavior.AutoPause,
                maintenanceConfig: "/maintenance/config",
                enableAlwaysEncrypted: true,
                tags: { project: "inventory" },
            });
            expect(JSON.stringify(result)).not.to.include("test-password");
        });

        test("publishes the exact validated DACPAC, verifies schema, then saves and connects the profile", async () => {
            dacFx.deployDacpac.callsFake(async (packagePath) => {
                expect(await fs.readFile(packagePath, "utf8")).to.equal("exact validated DACPAC");
                expect(connectionUI.saveProfile).not.to.have.been.called;
                return success;
            });
            const result = await deploy();
            expect(result).to.include({
                status: "succeeded",
                database: "CloudInventory",
                server: "server.database.windows.net",
                sourceDatabase: "Inventory",
                objectsDeployed: 1,
            });
            expect(dacFx.deployDacpac).to.have.been.calledWith(
                sinon.match.string,
                "CloudInventory",
                true,
                sinon.match(/^mssql-local-to-cloud-target:/),
                TaskExecutionMode.execute,
            );
            expect(dacFx.exportBacpac).not.to.have.been.called;
            expect(dacFx.importBacpac).not.to.have.been.called;
            expect(connectionUI.saveProfile).to.have.been.calledWith(
                sinon.match({
                    server: result.server,
                    database: result.database,
                    user: "admin",
                    savePassword: true,
                }),
            );
            expect(createDatabase).to.have.been.calledWith(
                sinon.match.any,
                "group",
                "server",
                "CloudInventory",
                sinon.match({ useFreeLimit: true, tags: request.tags }),
                sinon.match({ requireNew: true }),
            );
            expect(progress.map((item) => item.stage)).to.deep.equal([
                "authenticating",
                "validatingSettings",
                "creatingDatabase",
                "connecting",
                "publishingSchema",
                "verifying",
                "savingConnection",
            ]);
            expect(connected).to.deep.equal(new Set(["selected-source"]));
            expect(
                await fs.stat(directories[0]).then(
                    () => true,
                    () => false,
                ),
            ).to.equal(false);
        });

        test("exports and imports a BACPAC without publishing schema first, and verifies rows", async () => {
            withData();
            usedBytes = String(32 * 1024 ** 3);
            const result = await deploy();
            expect(result.status).to.equal("succeeded");
            expect(dacFx.exportBacpac).to.have.been.calledWith(
                "Inventory",
                sinon.match(/database\.bacpac$/),
                sinon.match(/^mssql-local-to-cloud-source:/),
                TaskExecutionMode.execute,
            );
            expect(dacFx.importBacpac).to.have.been.calledWith(
                sinon.match(/database\.bacpac$/),
                "CloudInventory",
                sinon.match(/^mssql-local-to-cloud-target:/),
                TaskExecutionMode.execute,
            );
            expect(dacFx.deployDacpac).not.to.have.been.called;
            expect(progress.map((item) => item.stage)).to.include.members([
                "exportingData",
                "importingData",
                "verifying",
            ]);
            expect(connected).to.deep.equal(new Set(["selected-source"]));
            expect(
                await fs.stat(directories[0]).then(
                    () => true,
                    () => false,
                ),
            ).to.equal(false);
        });

        test("allows a table and a user-defined type with the same qualified name", async () => {
            withData();
            objects.push("[dbo].[Inventory]");
            expect(await deploy()).to.include({ status: "succeeded", objectsDeployed: 2 });
        });

        test("rejects an existing Azure database before exporting or creating resources", async () => {
            withData();
            validateTarget.rejects(new Error(LocalToCloud.targetDatabaseExists));
            const result = await deploy();
            expect(result).to.include({
                status: "error",
                resourcesMayRemain: false,
                errorMessage: LocalToCloud.targetDatabaseExists,
            });
            expect(createDatabase).not.to.have.been.called;
            expect(dacFx.exportBacpac).not.to.have.been.called;
        });

        test("rejects oversized sources before provisioning", async () => {
            withData();
            usedBytes = String(33 * 1024 ** 3);
            expect(await deploy()).to.include({
                status: "error",
                errorMessage: LocalToCloud.sourceTooLarge,
            });
            expect(createDatabase).not.to.have.been.called;
            expect(dacFx.exportBacpac).not.to.have.been.called;
        });

        test("rejects source row changes during export before creating Azure resources", async () => {
            withData();
            dacFx.exportBacpac.callsFake(async (_database, packagePath) => {
                await fs.writeFile(packagePath, "package");
                sourceCounts = [["[dbo].[Inventory]", "4"]];
                return success;
            });
            expect(await deploy()).to.include({
                status: "error",
                errorMessage: LocalToCloud.sourceChanged,
            });
            expect(createDatabase).not.to.have.been.called;
            expect(dacFx.importBacpac).not.to.have.been.called;
        });

        test("never imports into a nonempty target and preserves created resources on failure", async () => {
            withData();
            targetHasObjects = true;
            expect(await deploy()).to.include({
                status: "error",
                resourcesMayRemain: true,
                errorMessage: LocalToCloud.targetDatabaseExists,
            });
            expect(dacFx.importBacpac).not.to.have.been.called;
            expect(connectionUI.saveProfile).not.to.have.been.called;
        });

        test("does not report success or save a profile when target row counts differ", async () => {
            withData();
            targetCounts = [["[dbo].[Inventory]", "2"]];
            expect(await deploy()).to.include({
                status: "error",
                resourcesMayRemain: true,
                errorMessage: LocalToCloud.deploymentVerificationFailed,
            });

            expect(connectionUI.saveProfile).not.to.have.been.called;
            expect(main.createObjectExplorerSession).not.to.have.been.called;
        });

        test("rejects malformed row-count metadata instead of reporting a successful migration", async () => {
            withData();
            sourceCounts = [["[dbo].[Inventory]"]];
            targetCounts = [["[dbo].[Inventory]"]];
            expect(await deploy()).to.include({
                status: "error",
                errorMessage: LocalToCloud.deploymentQueryFailed,
            });
            expect(createDatabase).not.to.have.been.called;
        });

        test("returns the same operation for repeated start requests without creating twice", async () => {
            const first = deploy();
            expect(deploy()).to.equal(first);
            const result = await first;
            const events = telemetry.sendActionEvent.getCalls().map((call) => call.args);
            const tasks = backgroundTasks.tasks;
            expect(await deploy()).to.equal(result);
            expect(telemetry.sendActionEvent.getCalls().map((call) => call.args)).to.deep.equal(
                events,
            );
            expect(backgroundTasks.tasks).to.deep.equal(tasks);
            expect(createDatabase.getCalls().map((call) => call.args[3])).to.deep.equal([
                "CloudInventory",
            ]);
        });

        test("records the selected mode, measured stages and final verified result for both deployment modes", async () => {
            for (const deploymentContent of ["schemaOnly", "schemaAndData"] as const) {
                request = { ...request, deploymentId: deploymentContent, deploymentContent };
                const result = await deploy();
                expect(result.status).to.equal("succeeded");
                expect(telemetry.sendActionEvent).to.have.been.calledWith(
                    TelemetryViews.LocalToCloudDeployment,
                    TelemetryActions.StartLocalToCloudDeployment,
                    { additionalProps: { deploymentContent } },
                );
                expect(telemetry.sendActionEvent).to.have.been.calledWith(
                    TelemetryViews.LocalToCloudDeployment,
                    TelemetryActions.LocalToCloudDeploymentStage,
                    sinon.match({
                        additionalProps: {
                            deploymentContent,
                            stage:
                                deploymentContent === "schemaOnly"
                                    ? "publishingSchema"
                                    : "importingData",
                            status: "succeeded",
                        },
                        additionalMeasurements: { durationInMs: sinon.match.number },
                    }),
                );
                expect(telemetry.sendActionEvent).to.have.been.calledWith(
                    TelemetryViews.LocalToCloudDeployment,
                    TelemetryActions.FinishLocalToCloudDeployment,
                    sinon.match({
                        additionalProps: {
                            deploymentContent,
                            status: "succeeded",
                            stage: "savingConnection",
                            resourcesMayRemain: "true",
                        },
                        additionalMeasurements: {
                            durationInMs: sinon.match.number,
                            completedStageCount: deploymentContent === "schemaOnly" ? 7 : 8,
                            objectsDeployed: 1,
                        },
                    }),
                );
            }
        });

        test("reports the failing stage without recording customer data or raw errors", async () => {
            const privateMessage =
                "private-user-data CloudInventory server.database.windows.net subscription test-password";
            dacFx.deployDacpac.rejects(new Error(privateMessage));
            const result = await deploy();
            expect(result.status).to.equal("error");
            expect(
                backgroundTasks.tasks.find((task) => task.state === BackgroundTaskState.Failed),
            ).to.include({ message: result.errorMessage });
            expect(telemetry.sendErrorEvent).to.have.been.calledWith(
                TelemetryViews.LocalToCloudDeployment,
                TelemetryActions.FinishLocalToCloudDeployment,
                sinon.match({
                    errorType: "LocalToCloudDeploymentFailed",
                    includeErrorMessage: false,
                    additionalProps: {
                        deploymentContent: "schemaOnly",
                        status: "error",
                        stage: "publishingSchema",
                        resourcesMayRemain: "true",
                    },
                    additionalMeasurements: {
                        durationInMs: sinon.match.number,
                        completedStageCount: 4,
                    },
                }),
            );
            for (const event of [telemetry.sendActionEvent, telemetry.sendErrorEvent].flatMap(
                (stub) => stub.getCalls(),
            )) {
                const payload = event.args[2];
                expect(payload).not.to.have.property("error");
                expect(Object.keys(payload.additionalProps)).to.satisfy((keys: string[]) =>
                    keys.every((key) =>
                        ["deploymentContent", "stage", "status", "resourcesMayRemain"].includes(
                            key,
                        ),
                    ),
                );
                expect(Object.values(payload.additionalMeasurements ?? {})).to.satisfy(
                    (values: unknown[]) =>
                        values.every(
                            (value) =>
                                typeof value === "number" && Number.isFinite(value) && value >= 0,
                        ),
                );
                const text = JSON.stringify(payload);
                for (const value of [
                    "private-user-data",
                    "CloudInventory",
                    "server.database.windows.net",
                    "subscription",
                    "test-password",
                    "source-id",
                    "[dbo].[Inventory]",
                    ...directories,
                ]) {
                    expect(text).not.to.include(value);
                }
            }
        });

        test("records cleanup failures as errors rather than successful deployments", async () => {
            sandbox
                .stub(fs, "rm")
                .callThrough()
                .onFirstCall()
                .rejects(new Error("private cleanup path"));
            expect((await deploy()).status).to.equal("error");
            expect(
                backgroundTasks.tasks.find((task) => task.state === BackgroundTaskState.Failed),
            ).to.include({ message: LocalToCloud.deploymentCleanupFailed });
            expect(telemetry.sendErrorEvent).to.have.been.calledWith(
                TelemetryViews.LocalToCloudDeployment,
                TelemetryActions.FinishLocalToCloudDeployment,
                sinon.match({ additionalProps: { status: "error", stage: "cleanup" } }),
            );
            expect(telemetry.sendActionEvent).not.to.have.been.calledWith(
                TelemetryViews.LocalToCloudDeployment,
                TelemetryActions.FinishLocalToCloudDeployment,
                sinon.match({ additionalProps: { status: "succeeded" } }),
            );
        });

        test("prevents another wizard from deploying to the same Azure resource concurrently", async () => {
            let release: () => void;
            let creating: () => void;
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });
            const started = new Promise<void>((resolve) => {
                creating = resolve;
            });
            createDatabase.callsFake(async () => {
                creating();
                await gate;
                return { location: "westus" };
            });
            const first = deploy();
            await started;
            const other = new LocalDatabaseDeploymentService(
                controller,
                compatibility,
                client,
                output,
                stubLogger(sandbox),
            );
            try {
                expect(
                    await other.deploy(
                        { ...request, deploymentId: "competing-deployment" },
                        () => {},
                    ),
                ).to.include({
                    status: "error",
                    resourcesMayRemain: false,
                    errorMessage: LocalToCloud.invalidDeployment,
                });
            } finally {
                release();
                await first;
                other.dispose();
            }
        });

        test("uses a settings snapshot and refuses a stale reviewed destination", async () => {
            request.target.databaseName = "unexpected-target";
            expect(await deploy()).to.include({
                status: "error",
                errorMessage: LocalToCloud.invalidAzureSettings,
            });
            expect(createDatabase).not.to.have.been.called;
            request = {
                ...request,
                deploymentId: "snapshot-deployment",
                target: { ...request.target, databaseName: "CloudInventory" },
            };
            controller.validateDeploymentForm.callsFake(async () => {
                state.formState.databaseName = "ChangedElsewhere";
                return [];
            });
            expect(await deploy()).to.include({ status: "succeeded", database: "CloudInventory" });
            expect(createDatabase).to.have.been.calledWith(
                sinon.match.any,
                "group",
                "server",
                "CloudInventory",
            );
        });

        test("keeps Entra account identity when saving the connected profile", async () => {
            state.formState.authenticationType = AuthenticationType.AzureMFA;
            state.formState.userName = "";
            state.formState.password = "";
            sandbox.stub(entra, "acquireTokenFromVscodeAccountForResource").resolves({
                account: { id: "account", label: "SQL account" },
                tenantId: "tenant",
                session: {
                    id: "session",
                    account: { id: "account", label: "SQL account" },
                    accessToken: "sql-token",
                    scopes: [],
                },
                token: {
                    key: "account",
                    token: "sql-token",
                    tokenType: "Bearer",
                    expiresOn: Date.now() / 1000 + 3600,
                },
            });
            expect(await deploy()).to.include({ status: "succeeded" });
            expect(connectionUI.saveProfile).to.have.been.calledWith(
                sinon.match({
                    authenticationType: AuthenticationType.AzureMFA,
                    user: "SQL account",
                    accountId: "account",
                    tenantId: "tenant",
                    azureAccountToken: "sql-token",
                    password: "",
                }),
            );
        });

        test("does not claim saved-and-connected success if Object Explorer cannot connect", async () => {
            main.createObjectExplorerSession.resolves(undefined);
            expect(await deploy()).to.include({
                status: "error",
                errorMessage: LocalToCloud.deploymentProfileFailed,
                resourcesMayRemain: true,
            });
            expect(output.appendLine).not.to.have.been.calledWith(LocalToCloud.deploymentSucceeded);
        });

        test("surfaces package-task errors in the deployment log even when STS returns an empty error", async () => {
            dacFx.deployDacpac.callsFake(async () => {
                const task = {
                    taskId: "publish-task",
                    serverName: "server.database.windows.net",
                    databaseName: "CloudInventory",
                    operationName: Constants.operationIdDeployDacpac,
                } as TaskInfo;
                taskCreatedEmitter.fire(task);
                taskProgressEmitter.fire({
                    taskId: task.taskId,
                    status: TaskStatus.Failed,
                    message: "The schema could not be published.",
                });
                return { ...success, success: false };
            });
            expect(await deploy()).to.include({
                status: "error",
                errorMessage: "The schema could not be published.",
            });
            expect(output.appendLine).to.have.been.calledWith("The schema could not be published.");
            expect(connectionUI.saveProfile).not.to.have.been.called;
        });

        test("cancels the in-flight import from Background Tasks after closing the wizard and leaves Azure intact", async () => {
            withData();
            let finishImport: (value: DacFxResult) => void;
            let started: () => void;
            const importing = new Promise<void>((resolve) => {
                started = resolve;
            });
            dacFx.importBacpac.callsFake(
                () =>
                    new Promise<DacFxResult>((resolve) => {
                        finishImport = resolve;
                        taskCreatedEmitter.fire({
                            taskId: "import-task",
                            serverName: "server.database.windows.net,1433",
                            databaseName: "CloudInventory",
                            operationName: Constants.operationIdImportBacpac,
                        } as TaskInfo);
                        started();
                    }),
            );
            client.sendRequest
                .withArgs(sinon.match({ method: "tasks/canceltask" }), { taskId: "import-task" })
                .callsFake(async () => {
                    finishImport({ ...success, success: false });
                    return true;
                });
            const deployment = deploy();
            await importing;
            service.dispose();
            const task = backgroundTasks.tasks.find(
                (task) => task.state === BackgroundTaskState.InProgress,
            )!;
            await backgroundTasks.cancelTask(task.id);
            expect(await deployment).to.include({ status: "cancelled", resourcesMayRemain: true });
            expect(backgroundTasks.tasks.find((entry) => entry.id === task.id)).to.include({
                state: BackgroundTaskState.Canceled,
                canCancel: false,
                message: LocalToCloud.deploymentCancelled,
            });
            expect(connectionUI.saveProfile).not.to.have.been.called;
            expect(connected).to.deep.equal(new Set(["selected-source"]));
            expect(telemetry.sendActionEvent).to.have.been.calledWith(
                TelemetryViews.LocalToCloudDeployment,
                TelemetryActions.FinishLocalToCloudDeployment,
                sinon.match({
                    additionalProps: {
                        deploymentContent: "schemaAndData",
                        status: "cancelled",
                        stage: "importingData",
                        resourcesMayRemain: "true",
                    },
                }),
            );
            expect(telemetry.sendErrorEvent).not.to.have.been.called;
        });
    });

    //#endregion
});
