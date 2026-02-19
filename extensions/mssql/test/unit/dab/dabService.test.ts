/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import { expect } from "chai";
import { DabService } from "../../../src/services/dabService";
import { Dab } from "../../../src/sharedInterfaces/dab";
import * as dockerUtils from "../../../src/deployment/dockerUtils";

function createTestEntity(overrides?: Partial<Dab.DabEntityConfig>): Dab.DabEntityConfig {
    return {
        id: "test-id-1",
        tableName: "Users",
        schemaName: "dbo",
        isEnabled: true,
        enabledActions: [
            Dab.EntityAction.Create,
            Dab.EntityAction.Read,
            Dab.EntityAction.Update,
            Dab.EntityAction.Delete,
        ],
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
                expect(result.connectionString).to.include("Server=host.docker.internal,1433");
            });

            test("case-insensitive data source", () => {
                const result = transform("data source=127.0.0.1;Database=TestDb;");
                expect(result.connectionString).to.include("host.docker.internal");
                expect(result.connectionString).to.not.include("127.0.0.1");
            });
        });

        // --- Containerized SQL Server (with container name) ---

        suite("should use host.docker.internal\\containerName for containerized SQL Server", () => {
            test("localhost with container name", () => {
                const result = transform("Server=localhost;Database=TestDb;", "my-sql-container");
                expect(result.connectionString).to.include(
                    "Server=host.docker.internal\\my-sql-container",
                );
                expect(result.connectionString).to.not.include("localhost");
            });

            test("localhost with container name and port", () => {
                const result = transform(
                    "Server=localhost,1433;Database=TestDb;",
                    "my-sql-container",
                );
                expect(result.connectionString).to.include(
                    "Server=host.docker.internal\\my-sql-container,1433",
                );
            });

            test("127.0.0.1 with container name and port", () => {
                const result = transform("Server=127.0.0.1,1434;Database=TestDb;", "sql-dev");
                expect(result.connectionString).to.include(
                    "Server=host.docker.internal\\sql-dev,1434",
                );
            });

            test("should not add container name when server is not localhost", () => {
                const result = transform(
                    "Server=remotehost.example.com;Database=TestDb;",
                    "my-sql-container",
                );
                expect(result.connectionString).to.include("remotehost.example.com");
                expect(result.connectionString).to.not.include("host.docker.internal");
            });

            test("should replace existing instance name with container name", () => {
                const result = transform(
                    "Server=localhost\\SQLEXPRESS;Database=TestDb;",
                    "my-container",
                );
                expect(result.connectionString).to.include(
                    "Server=host.docker.internal\\my-container",
                );
                expect(result.connectionString).to.not.include("SQLEXPRESS");
            });

            test("should replace existing instance name with container name and preserve port", () => {
                const result = transform(
                    "Server=localhost\\SQLEXPRESS,1433;Database=TestDb;",
                    "my-container",
                );
                expect(result.connectionString).to.include(
                    "Server=host.docker.internal\\my-container,1433",
                );
                expect(result.connectionString).to.not.include("SQLEXPRESS");
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
            expect(connStr).to.include("host.docker.internal\\my-sql,1433");
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
            sandbox.stub(dockerUtils, "pullDabContainerImage").resolves({ success: true });

            const result = await dabService.runDeploymentStep(Dab.DabDeploymentStepOrder.pullImage);

            expect(result.success).to.be.true;
        });

        test("should return error when pullImage fails", async () => {
            sandbox
                .stub(dockerUtils, "pullDabContainerImage")
                .resolves({ success: false, error: "Network error" });

            const result = await dabService.runDeploymentStep(Dab.DabDeploymentStepOrder.pullImage);

            expect(result.success).to.be.false;
            expect(result.error).to.equal("Network error");
        });

        test("should run startContainer step successfully with valid params", async () => {
            sandbox
                .stub(dockerUtils, "startDabDockerContainer")
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

        test("should run checkContainer step successfully", async () => {
            sandbox
                .stub(dockerUtils, "checkIfDabContainerIsReady")
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
            sandbox.stub(dockerUtils, "validateDabContainerName").resolves("my-dab-container");
            sandbox.stub(dockerUtils, "findAvailableDabPort").resolves(5000);

            const result = await dabService.validateDeploymentParams("my-dab-container", 5000);

            expect(result.isContainerNameValid).to.be.true;
            expect(result.validatedContainerName).to.equal("my-dab-container");
            expect(result.containerNameError).to.be.undefined;
            expect(result.isPortValid).to.be.true;
            expect(result.suggestedPort).to.equal(5000);
            expect(result.portError).to.be.undefined;
        });

        test("should return invalid result when container name is already taken", async () => {
            sandbox.stub(dockerUtils, "validateDabContainerName").resolves("my-dab-container_2");
            sandbox.stub(dockerUtils, "findAvailableDabPort").resolves(5000);

            const result = await dabService.validateDeploymentParams("my-dab-container", 5000);

            expect(result.isContainerNameValid).to.be.false;
            expect(result.validatedContainerName).to.equal("my-dab-container_2");
            expect(result.containerNameError).to.include("invalid or already in use");
        });

        test("should return invalid result when port is already in use", async () => {
            sandbox.stub(dockerUtils, "validateDabContainerName").resolves("my-dab-container");
            sandbox.stub(dockerUtils, "findAvailableDabPort").resolves(5001);

            const result = await dabService.validateDeploymentParams("my-dab-container", 5000);

            expect(result.isPortValid).to.be.false;
            expect(result.suggestedPort).to.equal(5001);
            expect(result.portError).to.include("already in use");
        });

        test("should return both invalid when container name and port are unavailable", async () => {
            sandbox.stub(dockerUtils, "validateDabContainerName").resolves("dab-container_3");
            sandbox.stub(dockerUtils, "findAvailableDabPort").resolves(5002);

            const result = await dabService.validateDeploymentParams("dab-container", 5000);

            expect(result.isContainerNameValid).to.be.false;
            expect(result.validatedContainerName).to.equal("dab-container_3");
            expect(result.isPortValid).to.be.false;
            expect(result.suggestedPort).to.equal(5002);
        });

        test("should handle empty container name for auto-generation", async () => {
            sandbox.stub(dockerUtils, "validateDabContainerName").resolves("dab-container");
            sandbox.stub(dockerUtils, "findAvailableDabPort").resolves(5000);

            const result = await dabService.validateDeploymentParams("", 5000);

            // Empty string != "dab-container", so isContainerNameValid is false
            expect(result.isContainerNameValid).to.be.false;
            expect(result.validatedContainerName).to.equal("dab-container");
        });
    });

    suite("stopDeployment", () => {
        test("should stop and remove container successfully", async () => {
            sandbox.stub(dockerUtils, "stopAndRemoveDabContainer").resolves({ success: true });

            const result = await dabService.stopDeployment("test-container");

            expect(result.success).to.be.true;
            expect(result.error).to.be.undefined;
        });

        test("should return error when stop fails", async () => {
            sandbox
                .stub(dockerUtils, "stopAndRemoveDabContainer")
                .resolves({ success: false, error: "Container not found" });

            const result = await dabService.stopDeployment("nonexistent-container");

            expect(result.success).to.be.false;
            expect(result.error).to.equal("Container not found");
        });

        test("should handle undefined success as false", async () => {
            sandbox
                .stub(dockerUtils, "stopAndRemoveDabContainer")
                .resolves({ success: undefined as any });

            const result = await dabService.stopDeployment("test-container");

            expect(result.success).to.be.false;
        });
    });
});
