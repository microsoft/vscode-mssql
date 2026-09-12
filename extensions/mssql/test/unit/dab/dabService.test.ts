/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import { expect } from "chai";
import { DabService } from "../../../src/services/dabService";
import { Dab } from "../../../src/sharedInterfaces/dab";
import * as dockerUtils from "../../../src/docker/dockerUtils";
import * as dabContainer from "../../../src/dab/dabContainer";
import * as dabCliProcess from "../../../src/dab/dabCliProcess";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DefaultSqlPortNumber } from "../../../src/constants/constants";

function createTestEntity(overrides?: Partial<Dab.DabEntityConfig>): Dab.DabEntityConfig {
    return {
        id: "test-id-1",
        tableName: "Users",
        schemaName: "dbo",
        isEnabled: true,
        isSupported: true,
        enabledActions: [
            Dab.EntityAction.Create,
            Dab.EntityAction.Read,
            Dab.EntityAction.Update,
            Dab.EntityAction.Delete,
        ],
        columns: [],
        advancedSettings: {
            entityName: "Users",
            authorizationRole: Dab.AuthorizationRole.Anonymous,
        },
        ...overrides,
    };
}

function createTestConfig(overrides?: Partial<Dab.DabConfig>): Dab.DabConfig {
    return {
        apiTypes: [Dab.ApiType.Rest],
        entities: [createTestEntity()],
        ...overrides,
    };
}

function createTestDeploymentRecord(): Dab.DabDeploymentRecord {
    return {
        id: "deployment-1",
        target: Dab.DabDeploymentTarget.DabCli,
        name: "dab-cli-1",
        port: 5001,
        apiTypes: [Dab.ApiType.Rest],
        configHash: "hash-1",
        createdUtc: "2026-09-02T10:00:00.000Z",
        deployedUtc: "2026-09-02T10:00:00.000Z",
        processId: 4242,
    };
}

const defaultConnectionInfo: Dab.DabConnectionInfo = {
    connectionString: "Server=localhost;Database=TestDb;Trusted_Connection=true;",
};

suite("DabService Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let dabService: DabService;

    setup(() => {
        sandbox = sinon.createSandbox();
        dabService = new DabService();
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("generateConfig", () => {
        test("should return success: true for valid input", () => {
            const result = dabService.generateConfig(createTestConfig(), defaultConnectionInfo);
            expect(result.success).to.equal(true);
            expect(result.error).to.be.undefined;
        });

        test("should return valid JSON in configContent", () => {
            const result = dabService.generateConfig(createTestConfig(), defaultConnectionInfo);
            const parsed = JSON.parse(result.configContent);
            expect(parsed).to.be.an("object");
        });

        test("should delegate to DabConfigFileBuilder for config content", () => {
            const result = dabService.generateConfig(createTestConfig(), defaultConnectionInfo);
            const parsed = JSON.parse(result.configContent);
            expect(parsed).to.have.property("$schema");
            expect(parsed).to.have.property("data-source");
            expect(parsed).to.have.property("runtime");
            expect(parsed).to.have.property("entities");
        });
    });

    suite("transformConnectionInfoForDocker", () => {
        function transform(
            connectionString: string,
            sqlServerContainerName?: string,
        ): Dab.DabConnectionInfo {
            return (dabService as any).transformConnectionInfoForDocker({
                connectionString,
                sqlServerContainerName,
            });
        }

        // --- No transformation needed ---

        suite("should not transform non-localhost addresses", () => {
            test("remote hostname", () => {
                const result = transform("Server=myserver.database.windows.net;Database=TestDb;");
                expect(result.connectionString).to.include("myserver.database.windows.net");
                expect(result.connectionString).to.not.include("host.docker.internal");
            });

            test("IP address that is not 127.0.0.1", () => {
                const result = transform("Server=192.168.1.100,1433;Database=TestDb;");
                expect(result.connectionString).to.include("192.168.1.100,1433");
                expect(result.connectionString).to.not.include("host.docker.internal");
            });

            test("already host.docker.internal", () => {
                const result = transform("Server=host.docker.internal,1433;Database=TestDb;");
                expect(result.connectionString).to.include("Server=host.docker.internal,1433");
            });

            test("no Server or Data Source key", () => {
                const result = transform("Database=TestDb;Trusted_Connection=true;");
                expect(result.connectionString).to.equal(
                    "Database=TestDb;Trusted_Connection=true;",
                );
            });
        });

        // --- Localhost variants for host SQL Server (no container name) ---

        suite("should replace localhost variants with host.docker.internal", () => {
            test("localhost", () => {
                const result = transform("Server=localhost;Database=TestDb;");
                expect(result.connectionString).to.include("Server=host.docker.internal");
                expect(result.connectionString).to.not.include("localhost");
            });

            test("127.0.0.1", () => {
                const result = transform("Server=127.0.0.1;Database=TestDb;");
                expect(result.connectionString).to.include("Server=host.docker.internal");
                expect(result.connectionString).to.not.include("127.0.0.1");
            });

            test("(local)", () => {
                const result = transform("Server=(local);Database=TestDb;");
                expect(result.connectionString).to.include("Server=host.docker.internal");
                expect(result.connectionString).to.not.include("(local)");
            });

            test(".", () => {
                const result = transform("Server=.;Database=TestDb;");
                expect(result.connectionString).to.include("Server=host.docker.internal");
            });

            test("case-insensitive LOCALHOST", () => {
                const result = transform("Server=LOCALHOST;Database=TestDb;");
                expect(result.connectionString).to.include("host.docker.internal");
                expect(result.connectionString).to.not.match(/localhost/i);
            });
        });

        // --- Preserving port and instance name ---

        suite("should preserve port and instance name", () => {
            test("localhost with port", () => {
                const result = transform("Server=localhost,1433;Database=TestDb;");
                expect(result.connectionString).to.include("Server=host.docker.internal,1433");
            });

            test("localhost with instance name", () => {
                const result = transform("Server=localhost\\SQLEXPRESS;Database=TestDb;");
                expect(result.connectionString).to.include(
                    "Server=host.docker.internal\\SQLEXPRESS",
                );
            });

            test("localhost with instance name and port", () => {
                const result = transform("Server=localhost\\SQLEXPRESS,1433;Database=TestDb;");
                expect(result.connectionString).to.include(
                    "Server=host.docker.internal\\SQLEXPRESS,1433",
                );
            });

            test("127.0.0.1 with port", () => {
                const result = transform("Server=127.0.0.1,1434;Database=TestDb;");
                expect(result.connectionString).to.include("Server=host.docker.internal,1434");
            });
        });

        // --- Data Source format ---

        suite("should handle Data Source format", () => {
            test("Data Source=localhost with port", () => {
                const result = transform("Data Source=localhost,1433;Database=TestDb;");
                expect(result.connectionString).to.include("Data Source=host.docker.internal,1433");
            });

            test("Data Source=tcp:localhost with port", () => {
                const result = transform("Data Source=tcp:localhost,1433;Database=TestDb;");
                expect(result.connectionString).to.include(
                    "Data Source=tcp:host.docker.internal,1433",
                );
                expect(result.connectionString).to.not.include("tcp:localhost");
            });

            test("case-insensitive data source", () => {
                const result = transform("data source=127.0.0.1;Database=TestDb;");
                expect(result.connectionString).to.include("host.docker.internal");
                expect(result.connectionString).to.not.include("127.0.0.1");
            });

            test("quoted Data Source=localhost with spaced port", () => {
                const result = transform('Data Source="localhost, 1433";Database=TestDb;');
                expect(result.connectionString).to.include("Data Source=host.docker.internal,1433");
                expect(result.connectionString).to.not.include('"localhost');
            });

            test("single-quoted Server=localhost with spaced port", () => {
                const result = transform("Server='localhost, 1433';Database=TestDb;");
                expect(result.connectionString).to.include("Server=host.docker.internal,1433");
                expect(result.connectionString).to.not.include("'localhost");
            });
        });

        // --- Containerized SQL Server (with container name) ---

        suite("should use host.docker.internal for containerized SQL Server", () => {
            test("localhost with container name discards container name", () => {
                const result = transform("Server=localhost;Database=TestDb;", "my-sql-container");
                expect(result.connectionString).to.include("Server=host.docker.internal");
                expect(result.connectionString).to.not.include("my-sql-container");
                expect(result.connectionString).to.not.include("localhost");
            });

            test("localhost with container name and port preserves port", () => {
                const result = transform(
                    "Server=localhost,1433;Database=TestDb;",
                    "my-sql-container",
                );
                expect(result.connectionString).to.include("Server=host.docker.internal,1433");
                expect(result.connectionString).to.not.include("my-sql-container");
            });

            test("127.0.0.1 with container name and port preserves port", () => {
                const result = transform("Server=127.0.0.1,1434;Database=TestDb;", "sql-dev");
                expect(result.connectionString).to.include("Server=host.docker.internal,1434");
                expect(result.connectionString).to.not.include("sql-dev");
            });

            test("should not add container name when server is not localhost", () => {
                const result = transform(
                    "Server=remotehost.example.com;Database=TestDb;",
                    "my-sql-container",
                );
                expect(result.connectionString).to.include("remotehost.example.com");
                expect(result.connectionString).to.not.include("host.docker.internal");
            });

            test("should discard existing instance name for containerized SQL Server", () => {
                const result = transform(
                    "Server=localhost\\SQLEXPRESS;Database=TestDb;",
                    "my-container",
                );
                expect(result.connectionString).to.include("Server=host.docker.internal");
                expect(result.connectionString).to.not.include("SQLEXPRESS");
                expect(result.connectionString).to.not.include("my-container");
            });

            test("should discard existing instance name and preserve port", () => {
                const result = transform(
                    "Server=localhost\\SQLEXPRESS,1433;Database=TestDb;",
                    "my-container",
                );
                expect(result.connectionString).to.include("Server=host.docker.internal,1433");
                expect(result.connectionString).to.not.include("SQLEXPRESS");
                expect(result.connectionString).to.not.include("my-container");
            });
        });

        // --- Default port injection ---

        suite("should add default SQL Server port when port is missing", () => {
            test("localhost without port gets default port", () => {
                const result = transform("Server=localhost;Database=TestDb;");
                expect(result.connectionString).to.include(
                    `Server=host.docker.internal,${DefaultSqlPortNumber}`,
                );
            });

            test("127.0.0.1 without port gets default port", () => {
                const result = transform("Server=127.0.0.1;Database=TestDb;");
                expect(result.connectionString).to.include(
                    `Server=host.docker.internal,${DefaultSqlPortNumber}`,
                );
            });

            test("localhost with instance name but no port gets default port", () => {
                const result = transform("Server=localhost\\SQLEXPRESS;Database=TestDb;");
                expect(result.connectionString).to.include(
                    `Server=host.docker.internal\\SQLEXPRESS,${DefaultSqlPortNumber}`,
                );
            });

            test("localhost with container name but no port gets default port", () => {
                const result = transform("Server=localhost;Database=TestDb;", "my-sql-container");
                expect(result.connectionString).to.include(
                    `Server=host.docker.internal,${DefaultSqlPortNumber}`,
                );
            });

            test("Data Source without port gets default port", () => {
                const result = transform("data source=127.0.0.1;Database=TestDb;");
                expect(result.connectionString).to.include(
                    `host.docker.internal,${DefaultSqlPortNumber}`,
                );
            });

            test("should not add default port when port is already specified", () => {
                const result = transform("Server=localhost,1434;Database=TestDb;");
                expect(result.connectionString).to.include("Server=host.docker.internal,1434");
                expect(result.connectionString).to.not.include(`,${DefaultSqlPortNumber}`);
            });

            test("should not add default port for non-localhost addresses", () => {
                const result = transform("Server=remote-server;Database=TestDb;");
                expect(result.connectionString).to.not.include(`,${DefaultSqlPortNumber}`);
            });
        });

        // --- Edge cases ---

        suite("edge cases", () => {
            test("should preserve remaining connection string properties", () => {
                const result = transform(
                    "Server=localhost,1433;Database=TestDb;User Id=sa;Password=Secret123;Encrypt=false;",
                );
                expect(result.connectionString).to.include("Database=TestDb");
                expect(result.connectionString).to.include("User Id=sa");
                expect(result.connectionString).to.include("Password=Secret123");
                expect(result.connectionString).to.include("Encrypt=false");
            });

            test("should treat undefined sqlServerContainerName same as no container", () => {
                const result = transform("Server=localhost;Database=TestDb;", undefined);
                expect(result.connectionString).to.include("Server=host.docker.internal");
                expect(result.connectionString).to.not.include("\\");
            });

            test("should handle Server key with spaces around equals sign", () => {
                const result = transform("Server = localhost,1433;Database=TestDb;");
                expect(result.connectionString).to.include("host.docker.internal,1433");
            });

            test("should return original connectionInfo when no transformation needed", () => {
                const input: Dab.DabConnectionInfo = {
                    connectionString: "Server=remote-server;Database=TestDb;",
                    sqlServerContainerName: "some-container",
                };
                const result = (dabService as any).transformConnectionInfoForDocker(input);
                expect(result).to.equal(input);
            });
        });
    });

    suite("generateConfig - Docker connection string transformation", () => {
        function getConnectionStringFromConfig(configContent: string): string {
            const parsed = JSON.parse(configContent);
            return parsed["data-source"]?.["connection-string"] ?? "";
        }

        test("should transform localhost to host.docker.internal in generated config", () => {
            const result = dabService.generateConfig(createTestConfig(), {
                connectionString: "Server=localhost,1433;Database=TestDb;",
            });
            expect(result.success).to.be.true;
            const connStr = getConnectionStringFromConfig(result.configContent);
            expect(connStr).to.include("host.docker.internal,1433");
            expect(connStr).to.not.include("localhost");
        });

        test("should transform with container name in generated config", () => {
            const result = dabService.generateConfig(createTestConfig(), {
                connectionString: "Server=localhost,1433;Database=TestDb;",
                sqlServerContainerName: "my-sql",
            });
            expect(result.success).to.be.true;
            const connStr = getConnectionStringFromConfig(result.configContent);
            expect(connStr).to.include("host.docker.internal,1433");
            expect(connStr).to.not.include("my-sql");
        });

        test("should not transform remote server in generated config", () => {
            const result = dabService.generateConfig(createTestConfig(), {
                connectionString: "Server=prod-server.example.com;Database=TestDb;",
            });
            expect(result.success).to.be.true;
            const connStr = getConnectionStringFromConfig(result.configContent);
            expect(connStr).to.include("prod-server.example.com");
        });
    });

    suite("runDeploymentStep", () => {
        test("should run dockerInstallation step successfully", async () => {
            sandbox.stub(dockerUtils, "checkDockerInstallation").resolves({ success: true });

            const result = await dabService.runDeploymentStep(
                Dab.DabDeploymentStepOrder.dockerInstallation,
            );

            expect(result.success).to.be.true;
        });

        test("should return error with errorLink for failed dockerInstallation step", async () => {
            sandbox
                .stub(dockerUtils, "checkDockerInstallation")
                .resolves({ success: false, error: "Docker not installed" });

            const result = await dabService.runDeploymentStep(
                Dab.DabDeploymentStepOrder.dockerInstallation,
            );

            expect(result.success).to.be.false;
            expect(result.error).to.equal("Docker not installed");
            expect(result.errorLink).to.equal(dockerUtils.dockerInstallErrorLink);
        });

        test("should run startDockerDesktop step successfully", async () => {
            sandbox.stub(dockerUtils, "startDocker").resolves({ success: true });

            const result = await dabService.runDeploymentStep(
                Dab.DabDeploymentStepOrder.startDockerDesktop,
            );

            expect(result.success).to.be.true;
        });

        test("should run checkDockerEngine step successfully", async () => {
            sandbox.stub(dockerUtils, "checkEngine").resolves({ success: true });

            const result = await dabService.runDeploymentStep(
                Dab.DabDeploymentStepOrder.checkDockerEngine,
            );

            expect(result.success).to.be.true;
        });

        test("should run pullImage step successfully", async () => {
            sandbox.stub(dabContainer, "pullDabContainerImage").resolves({ success: true });

            const result = await dabService.runDeploymentStep(Dab.DabDeploymentStepOrder.pullImage);

            expect(result.success).to.be.true;
        });

        test("should return error when pullImage fails", async () => {
            sandbox
                .stub(dabContainer, "pullDabContainerImage")
                .resolves({ success: false, error: "Network error" });

            const result = await dabService.runDeploymentStep(Dab.DabDeploymentStepOrder.pullImage);

            expect(result.success).to.be.false;
            expect(result.error).to.equal("Network error");
        });

        test("should run startContainer step successfully with valid params", async () => {
            sandbox
                .stub(dabContainer, "startDabDockerContainer")
                .resolves({ success: true, port: 5000 });

            const params: Dab.DabDeploymentParams = {
                containerName: "test-container",
                port: 5000,
            };

            const result = await dabService.runDeploymentStep(
                Dab.DabDeploymentStepOrder.startContainer,
                params,
                createTestConfig(),
                defaultConnectionInfo,
            );

            expect(result.success).to.be.true;
            expect(result.apiUrl).to.equal("http://localhost:5000");
        });

        test("should return error when startContainer is called without params", async () => {
            const result = await dabService.runDeploymentStep(
                Dab.DabDeploymentStepOrder.startContainer,
                undefined,
                createTestConfig(),
                defaultConnectionInfo,
            );

            expect(result.success).to.be.false;
            expect(result.error).to.include("required");
        });

        test("should return error when startContainer is called without config", async () => {
            const params: Dab.DabDeploymentParams = {
                containerName: "test-container",
                port: 5000,
            };

            const result = await dabService.runDeploymentStep(
                Dab.DabDeploymentStepOrder.startContainer,
                params,
                undefined,
                defaultConnectionInfo,
            );

            expect(result.success).to.be.false;
            expect(result.error).to.include("required");
        });

        test("should expose startContainer full error text as frontend log content", async () => {
            sandbox.stub(dabContainer, "startDabDockerContainer").resolves({
                success: false,
                error: "Failed to start DAB container. Please check the Docker logs for details.",
                fullErrorText: "Container exited immediately",
            });

            const params: Dab.DabDeploymentParams = {
                containerName: "test-container",
                port: 5000,
            };

            const result = await dabService.runDeploymentStep(
                Dab.DabDeploymentStepOrder.startContainer,
                params,
                createTestConfig(),
                defaultConnectionInfo,
            );

            expect(result.success).to.be.false;
            expect(result.containerLogs).to.equal("Container exited immediately");
        });

        test("should run checkContainer step successfully", async () => {
            sandbox
                .stub(dabContainer, "checkIfDabContainerIsReady")
                .resolves({ success: true, port: 5000 });

            const params: Dab.DabDeploymentParams = {
                containerName: "test-container",
                port: 5000,
            };

            const result = await dabService.runDeploymentStep(
                Dab.DabDeploymentStepOrder.checkContainer,
                params,
            );

            expect(result.success).to.be.true;
            expect(result.apiUrl).to.equal("http://localhost:5000");
        });

        test("should return failure logs for checkContainer failures", async () => {
            const checkIfReadyStub = sandbox
                .stub(dabContainer, "checkIfDabContainerIsReady")
                .resolves({
                    success: false,
                    error: "Unable to launch the Data API builder engine.",
                    fullErrorText: "fail: startup failed",
                    containerLogs: "fail: startup failed",
                });

            const params: Dab.DabDeploymentParams = {
                containerName: "test-container",
                port: 5000,
            };

            const result = await dabService.runDeploymentStep(
                Dab.DabDeploymentStepOrder.checkContainer,
                params,
            );

            expect(result.success).to.be.false;
            expect(checkIfReadyStub).to.have.been.calledOnce;
            expect(result.containerLogs).to.equal("fail: startup failed");
        });

        test("should return error when checkContainer is called without params", async () => {
            const result = await dabService.runDeploymentStep(
                Dab.DabDeploymentStepOrder.checkContainer,
            );

            expect(result.success).to.be.false;
            expect(result.error).to.include("required");
        });

        test("should return error for unknown deployment step", async () => {
            const result = await dabService.runDeploymentStep(999 as Dab.DabDeploymentStepOrder);

            expect(result.success).to.be.false;
            expect(result.error).to.include("Unknown deployment step");
        });
    });

    suite("validateDeploymentParams", () => {
        test("should return valid result when both container name and port are available", async () => {
            sandbox.stub(dabContainer, "validateDabContainerName").resolves("my-dab-container");
            sandbox.stub(dabContainer, "findAvailableDabPort").resolves(5000);

            const result = await dabService.validateDeploymentParams("my-dab-container", 5000);

            expect(result.isContainerNameValid).to.be.true;
            expect(result.validatedContainerName).to.equal("my-dab-container");
            expect(result.containerNameError).to.be.undefined;
            expect(result.isPortValid).to.be.true;
            expect(result.suggestedPort).to.equal(5000);
            expect(result.portError).to.be.undefined;
        });

        test("should return invalid result when container name is already taken", async () => {
            sandbox.stub(dabContainer, "validateDabContainerName").resolves("my-dab-container_2");
            sandbox.stub(dabContainer, "findAvailableDabPort").resolves(5000);

            const result = await dabService.validateDeploymentParams("my-dab-container", 5000);

            expect(result.isContainerNameValid).to.be.false;
            expect(result.validatedContainerName).to.equal("my-dab-container_2");
            expect(result.containerNameError).to.include("invalid or already in use");
        });

        test("should return invalid result when port is already in use", async () => {
            sandbox.stub(dabContainer, "validateDabContainerName").resolves("my-dab-container");
            sandbox.stub(dabContainer, "findAvailableDabPort").resolves(5001);

            const result = await dabService.validateDeploymentParams("my-dab-container", 5000);

            expect(result.isPortValid).to.be.false;
            expect(result.suggestedPort).to.equal(5001);
            expect(result.portError).to.include("already in use");
        });

        test("should return both invalid when container name and port are unavailable", async () => {
            sandbox.stub(dabContainer, "validateDabContainerName").resolves("dab-container_3");
            sandbox.stub(dabContainer, "findAvailableDabPort").resolves(5002);

            const result = await dabService.validateDeploymentParams("dab-container", 5000);

            expect(result.isContainerNameValid).to.be.false;
            expect(result.validatedContainerName).to.equal("dab-container_3");
            expect(result.isPortValid).to.be.false;
            expect(result.suggestedPort).to.equal(5002);
        });

        test("should handle empty container name for auto-generation", async () => {
            sandbox.stub(dabContainer, "validateDabContainerName").resolves("dab-container");
            sandbox.stub(dabContainer, "findAvailableDabPort").resolves(5000);

            const result = await dabService.validateDeploymentParams("", 5000);

            // Empty string != "dab-container", so isContainerNameValid is false
            expect(result.isContainerNameValid).to.be.false;
            expect(result.validatedContainerName).to.equal("dab-container");
        });
    });

    suite("stopDeployment", () => {
        test("should stop and remove container successfully", async () => {
            sandbox.stub(dabContainer, "stopAndRemoveDabContainer").resolves({ success: true });

            const result = await dabService.stopDeployment("test-container");

            expect(result.success).to.be.true;
            expect(result.error).to.be.undefined;
        });

        test("should return error when stop fails", async () => {
            sandbox
                .stub(dabContainer, "stopAndRemoveDabContainer")
                .resolves({ success: false, error: "Container not found" });

            const result = await dabService.stopDeployment("nonexistent-container");

            expect(result.success).to.be.false;
            expect(result.error).to.equal("Container not found");
        });

        test("should handle undefined success as false", async () => {
            sandbox
                .stub(dabContainer, "stopAndRemoveDabContainer")
                .resolves({ success: undefined as any });

            const result = await dabService.stopDeployment("test-container");

            expect(result.success).to.be.false;
        });
    });
    suite("computeConfigHash", () => {
        test("should be stable for the same configuration", () => {
            const config = createTestConfig();

            expect(dabService.computeConfigHash(config)).to.equal(
                dabService.computeConfigHash(createTestConfig()),
            );
        });

        test("should ignore entity ordering", () => {
            const first = createTestEntity({ id: "id-1", tableName: "Users" });
            const second = createTestEntity({
                id: "id-2",
                tableName: "Orders",
                advancedSettings: {
                    entityName: "Orders",
                    authorizationRole: Dab.AuthorizationRole.Anonymous,
                },
            });

            expect(
                dabService.computeConfigHash(createTestConfig({ entities: [first, second] })),
                "Reordering entities does not change what DAB serves",
            ).to.equal(
                dabService.computeConfigHash(createTestConfig({ entities: [second, first] })),
            );
        });

        test("should change when the exposed API types change", () => {
            expect(
                dabService.computeConfigHash(createTestConfig({ apiTypes: [Dab.ApiType.Rest] })),
            ).to.not.equal(
                dabService.computeConfigHash(
                    createTestConfig({ apiTypes: [Dab.ApiType.Rest, Dab.ApiType.GraphQL] }),
                ),
            );
        });

        test("should change when an entity's actions change", () => {
            const readOnly = createTestEntity({ enabledActions: [Dab.EntityAction.Read] });
            const readWrite = createTestEntity({
                enabledActions: [Dab.EntityAction.Read, Dab.EntityAction.Create],
            });

            expect(
                dabService.computeConfigHash(createTestConfig({ entities: [readOnly] })),
            ).to.not.equal(
                dabService.computeConfigHash(createTestConfig({ entities: [readWrite] })),
            );
        });
    });

    suite("container lifecycle", () => {
        test("getContainerStatus should report the container state", async () => {
            sandbox
                .stub(dabContainer, "getDabContainerStatus")
                .resolves(Dab.DabDeploymentContainerStatus.Running);

            expect(await dabService.getContainerStatus("dab-container")).to.equal(
                Dab.DabDeploymentContainerStatus.Running,
            );
        });

        test("startContainer should surface the failure reason", async () => {
            sandbox
                .stub(dabContainer, "startDabContainer")
                .resolves({ success: false, error: "Container no longer exists." });

            const result = await dabService.startContainer("dab-container");

            expect(result.success).to.be.false;
            expect(result.error).to.equal("Container no longer exists.");
        });

        test("startContainer should treat an undefined success as failure", async () => {
            sandbox.stub(dabContainer, "startDabContainer").resolves({ success: undefined as any });

            expect((await dabService.startContainer("dab-container")).success).to.be.false;
        });

        test("stopContainer should report success", async () => {
            sandbox.stub(dabContainer, "stopDabContainer").resolves({ success: true });

            expect((await dabService.stopContainer("dab-container")).success).to.be.true;
        });

        test("isPortAvailable should defer to the host port probe", async () => {
            const isDabPortAvailableStub = sandbox
                .stub(dabContainer, "isDabPortAvailable")
                .resolves(false);

            expect(await dabService.isPortAvailable(5000)).to.be.false;
            expect(isDabPortAvailableStub.calledOnceWithExactly(5000)).to.be.true;
        });
    });
    suite("DAB CLI target", () => {
        test("generateCliConfig keeps the connection string out of the file", () => {
            const result = dabService.generateCliConfig(createTestConfig());

            expect(result.success).to.be.true;
            expect(result.configContent).to.contain(
                `@env('${Dab.DAB_CLI_CONNECTION_STRING_ENV_VAR}')`,
            );
            expect(
                result.configContent,
                "A credential must never reach the generated file",
            ).to.not.contain("Password");
        });

        test("generateCliConfig does not rewrite the host for Docker", () => {
            const result = dabService.generateCliConfig(createTestConfig());

            expect(
                result.configContent,
                "The engine runs on the host, so localhost needs no rewriting",
            ).to.not.contain("host.docker.internal");
        });

        test("getCliDeploymentStatus reports Running when the port answers", async () => {
            sandbox.stub(dabCliProcess, "isDabCliEngineResponding").resolves(true);

            const status = await dabService.getCliDeploymentStatus({
                ...createTestDeploymentRecord(),
                configPath: undefined,
            });

            expect(status).to.equal(Dab.DabDeploymentContainerStatus.Running);
        });

        test("getCliDeploymentStatus reports Missing when nothing answers and no config remains", async () => {
            sandbox.stub(dabCliProcess, "isDabCliEngineResponding").resolves(false);

            const status = await dabService.getCliDeploymentStatus({
                ...createTestDeploymentRecord(),
                configPath: undefined,
            });

            expect(status).to.equal(Dab.DabDeploymentContainerStatus.Missing);
        });

        test("getCliDeploymentStatus reports Missing when the config file is gone", async () => {
            sandbox.stub(dabCliProcess, "isDabCliEngineResponding").resolves(false);

            const status = await dabService.getCliDeploymentStatus({
                ...createTestDeploymentRecord(),
                configPath: path.join(os.tmpdir(), "dab-cli-test-missing", "dab-config.json"),
            });

            expect(status).to.equal(Dab.DabDeploymentContainerStatus.Missing);
        });

        test("getCliDeploymentStatus reports Stopped when the config survives", async () => {
            sandbox.stub(dabCliProcess, "isDabCliEngineResponding").resolves(false);
            const configDirectory = await fs.promises.mkdtemp(
                path.join(os.tmpdir(), "dab-cli-status-"),
            );
            const configPath = path.join(configDirectory, "dab-config.json");
            await fs.promises.writeFile(configPath, "{}", "utf8");

            try {
                const status = await dabService.getCliDeploymentStatus({
                    ...createTestDeploymentRecord(),
                    configPath,
                });

                expect(
                    status,
                    "A saved config is what makes a stopped deployment startable",
                ).to.equal(Dab.DabDeploymentContainerStatus.Stopped);
            } finally {
                await fs.promises.rm(configDirectory, { recursive: true, force: true });
            }
        });

        test("stopCliDeployment succeeds when no process was recorded", async () => {
            const stopStub = sandbox.stub(dabCliProcess, "stopDabCliEngine");

            const result = await dabService.stopCliDeployment({
                ...createTestDeploymentRecord(),
                processId: undefined,
            });

            expect(result.success).to.be.true;
            expect(stopStub.called, "Nothing to stop means no kill is attempted").to.be.false;
        });

        test("stopCliDeployment stops the recorded process", async () => {
            const stopStub = sandbox
                .stub(dabCliProcess, "stopDabCliEngine")
                .resolves({ success: true });

            const result = await dabService.stopCliDeployment({
                ...createTestDeploymentRecord(),
                processId: 4242,
            });

            expect(result.success).to.be.true;
            expect(stopStub.calledOnceWithExactly(4242)).to.be.true;
        });

        test("CLI steps report a clear failure without a storage context", async () => {
            const serviceWithoutStorage = new DabService();

            const result = await serviceWithoutStorage.runCliDeploymentStep(
                Dab.DabDeploymentStepOrder.acquireDabCli,
            );

            expect(result.success).to.be.false;
            expect(result.error).to.be.a("string").and.not.empty;
        });
    });
});
