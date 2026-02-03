/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as os from "os";
import * as dockerUtils from "../../src/deployment/mssqlDockerUtils";
import { LocalContainers } from "../../src/constants/locConstants";
import * as childProcess from "child_process";
import { defaultContainerName, Platform } from "../../src/constants/constants";
import * as path from "path";
import { stubTelemetry } from "./utils";
import { ConnectionNode } from "../../src/objectExplorer/nodes/connectionNode";
import { ObjectExplorerService } from "../../src/objectExplorer/objectExplorerService";
import * as dockerClient from "../../src/docker/dockerClient";
import * as dockerOperations from "../../src/docker/dockerOperations";
import * as osCommands from "../../src/docker/osCommands";

chai.use(sinonChai);

/**
 * Tests for SQL Server-specific Docker utilities in mssqlDockerUtils.ts
 * 
 * Note: Generic Docker operations are tested in:
 * - test/unit/docker/dockerClient.test.ts
 * - test/unit/docker/dockerOperations.test.ts
 * - test/unit/docker/osCommands.test.ts
 */
suite("MSSQL Docker Utilities", () => {
    let sandbox: sinon.SinonSandbox;
    let node: ConnectionNode;
    let mockObjectExplorerService: ObjectExplorerService;

    // Mock Docker client
    let mockDockerClient: {
        version: sinon.SinonStub;
        ping: sinon.SinonStub;
        info: sinon.SinonStub;
        listContainers: sinon.SinonStub;
        getContainer: sinon.SinonStub;
        createContainer: sinon.SinonStub;
        pull: sinon.SinonStub;
        modem: { followProgress: sinon.SinonStub };
    };

    setup(async () => {
        sandbox = sinon.createSandbox();
        node = {
            connectionProfile: {
                containerName: "testContainer",
                savePassword: true,
            },
            loadingLabel: "",
        } as unknown as ConnectionNode;

        mockObjectExplorerService = {
            _refreshCallback: sandbox.stub(),
            setLoadingUiForNode: sandbox.stub(),
            removeNode: sandbox.stub(),
        } as unknown as ObjectExplorerService;

        // Create mock Docker client
        mockDockerClient = {
            version: sandbox.stub(),
            ping: sandbox.stub(),
            info: sandbox.stub(),
            listContainers: sandbox.stub(),
            getContainer: sandbox.stub(),
            createContainer: sandbox.stub(),
            pull: sandbox.stub(),
            modem: { followProgress: sandbox.stub() },
        };

        // Stub getDockerClient to return our mock
        sandbox.stub(dockerClient, "getDockerClient").returns(mockDockerClient as any);

        // Also stub getDockerInfo for checkEngine tests
        sandbox.stub(dockerClient, "getDockerInfo").callsFake(async () => {
            return mockDockerClient.info();
        });
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("Docker Deployment Steps", () => {
        test("initializeDockerSteps: should return correct Docker deployment steps", async () => {
            const steps = dockerUtils.initializeDockerSteps();

            expect(steps.length, "Should return 7 steps").to.equal(7);

            expect(steps[0].headerText).to.equal(LocalContainers.dockerInstallHeader);
            expect(steps[0].bodyText).to.equal(LocalContainers.dockerInstallBody);
            expect(steps[0].errorLink).to.equal("https://www.docker.com/products/docker-desktop/");
            expect(steps[0].errorLinkText).to.equal(LocalContainers.installDocker);
            expect(typeof steps[0].stepAction, "stepAction should be a function").to.equal(
                "function",
            );

            expect(steps[1].headerText).to.equal(LocalContainers.startDockerHeader);
            expect(steps[1].bodyText).to.equal(LocalContainers.startDockerBody);
            expect(typeof steps[1].stepAction).to.equal("function");

            expect(steps[2].headerText).to.equal(LocalContainers.startDockerEngineHeader);
            expect(steps[2].bodyText).to.equal(LocalContainers.startDockerEngineBody);
            expect(typeof steps[2].stepAction).to.equal("function");

            expect(steps[3].headerText).to.equal(LocalContainers.pullImageHeader);
            expect(steps[3].bodyText).to.equal(LocalContainers.pullImageBody);
            expect(steps[3].argNames).to.deep.equal(["version"]);
            expect(typeof steps[3].stepAction).to.equal("function");

            expect(steps[4].headerText).to.equal(LocalContainers.creatingContainerHeader);
            expect(steps[4].bodyText).to.equal(LocalContainers.creatingContainerBody);
            expect(steps[4].argNames).to.deep.equal([
                "containerName",
                "password",
                "version",
                "hostname",
                "port",
            ]);
            expect(typeof steps[4].stepAction).to.equal("function");

            expect(steps[5].headerText).to.equal(LocalContainers.settingUpContainerHeader);
            expect(steps[5].bodyText).to.equal(LocalContainers.settingUpContainerBody);
            expect(steps[5].argNames).to.deep.equal(["containerName"]);
            expect(typeof steps[5].stepAction).to.equal("function");

            expect(steps[6].headerText).to.equal(LocalContainers.connectingToContainerHeader);
            expect(steps[6].bodyText).to.equal(LocalContainers.connectingToContainerBody);
            expect(steps[6].stepAction).to.equal(undefined);
        });
    });

    suite("Error Text Sanitization", () => {
        test("sanitizeErrorText: should sanitize SA_PASSWORD", () => {
            const errorWithPassword =
                "Connection failed: SA_PASSWORD={testtesttest} something broke";
            const sanitized = dockerUtils.sanitizeErrorText(errorWithPassword);
            expect(sanitized.includes("SA_PASSWORD=******"), "SA_PASSWORD value should be masked")
                .to.be.true;
            expect(
                !sanitized.includes("testtesttest"),
                "Original password should not appear in sanitized output",
            ).to.be.true;
        });
    });

    suite("Password Validation", () => {
        test("validateSqlServerPassword: should validate password length", () => {
            // Too short
            const shortResult = dockerUtils.validateSqlServerPassword("<0>");
            expect(shortResult, "Should return length error").to.equal(
                LocalContainers.passwordLengthError,
            );

            // Too long
            const longResult = dockerUtils.validateSqlServerPassword("<0>".repeat(129));
            expect(longResult, "Should return length error").to.equal(
                LocalContainers.passwordLengthError,
            );
        });

        test("validateSqlServerPassword: should validate password complexity", () => {
            // Valid length but not enough complexity (only lowercase)
            const lowComplexityResult = dockerUtils.validateSqlServerPassword("<placeholder>");
            expect(lowComplexityResult, "Should return complexity error").to.equal(
                LocalContainers.passwordComplexityError,
            );

            // Only 2 categories (lowercase and digit)
            const invalidCategoryResult = dockerUtils.validateSqlServerPassword("<hidden>");
            expect(invalidCategoryResult, "Should return complexity error").to.equal(
                LocalContainers.passwordComplexityError,
            );
        });

        test("validateSqlServerPassword: should accept valid passwords", () => {
            // Valid: meets 3 categories (uppercase, lowercase, number)
            const result1 = dockerUtils.validateSqlServerPassword("Placeholder1");
            expect(result1, "Should return empty string for valid password").to.equal("");

            // Valid: meets 4 categories (uppercase, lowercase, number, special char)
            const result2 = dockerUtils.validateSqlServerPassword("<Placeholder1>");
            expect(result2, "Should return empty string for valid password").to.equal("");
        });
    });

    suite("Docker Installation Check", () => {
        test("checkDockerInstallation: should return success when Docker is installed", async () => {
            mockDockerClient.version.resolves({ Version: "24.0.0" });

            const result = await dockerUtils.checkDockerInstallation();

            expect(result.success, "Should return success when Docker is installed").to.be.true;
            expect(result.error).to.equal(undefined);
            expect(mockDockerClient.version).to.have.been.calledOnce;
        });

        test("checkDockerInstallation: should return error when Docker is not installed", async () => {
            mockDockerClient.version.rejects(new Error("Docker is not installed"));

            const result = await dockerUtils.checkDockerInstallation();

            expect(!result.success, "Should return failure when Docker is not installed").to.be
                .true;
            expect(result.error).to.equal(LocalContainers.dockerInstallError);
            expect(result.fullErrorText).to.equal("Docker is not installed");
        });
    });

    suite("Docker Engine Check", () => {
        test("checkEngine: should succeed on Linux platform with x64 architecture", async () => {
            sandbox.stub(os, "platform").returns(Platform.Linux);
            sandbox.stub(os, "arch").returns("x64");
            mockDockerClient.listContainers.resolves([]);

            const result = await dockerUtils.checkEngine();
            expect(result.success).to.be.true;
        });

        test("checkEngine: should switch engine on Windows when user confirms", async () => {
            sandbox.stub(os, "platform").returns(Platform.Windows);
            sandbox.stub(os, "arch").returns("x64");
            const spawnStub = sandbox.stub(childProcess, "spawn");
            sandbox.stub(vscode.window, "showInformationMessage").resolves("Yes" as any);
            sandbox.stub(osCommands, "execCommand").resolves("");

            const createSuccessProcess = (output: string) => ({
                stdout: {
                    on: sinon.stub().callsFake((event, callback) => {
                        if (event === "data") setTimeout(() => callback(output), 0);
                    }),
                    pipe: sinon.stub(),
                },
                stderr: {
                    on: sinon.stub().callsFake((event, callback) => {
                        if (event === "data") setTimeout(() => callback(""), 0);
                    }),
                },
                stdin: { end: sinon.stub() },
                on: sinon.stub().callsFake((event, callback) => {
                    if (event === "close") setTimeout(() => callback(0), 5);
                }),
            });

            spawnStub.returns(
                createSuccessProcess(
                    "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
                ) as any,
            );
            mockDockerClient.info.resolves({ OSType: Platform.Windows });

            const result = await dockerUtils.checkEngine();
            expect(result.success).to.be.true;
        });

        test("checkEngine: should fail when Windows user cancels engine switch", async () => {
            sandbox.stub(os, "platform").returns(Platform.Windows);
            sandbox.stub(os, "arch").returns("x64");
            const spawnStub = sandbox.stub(childProcess, "spawn");
            sandbox.stub(vscode.window, "showInformationMessage").resolves(undefined);

            const createSuccessProcess = (output: string) => ({
                stdout: {
                    on: sinon.stub().callsFake((event, callback) => {
                        if (event === "data") setTimeout(() => callback(output), 0);
                    }),
                    pipe: sinon.stub(),
                },
                stderr: {
                    on: sinon.stub().callsFake((event, callback) => {
                        if (event === "data") setTimeout(() => callback(""), 0);
                    }),
                },
                stdin: { end: sinon.stub() },
                on: sinon.stub().callsFake((event, callback) => {
                    if (event === "close") setTimeout(() => callback(0), 5);
                }),
            });

            spawnStub.returns(
                createSuccessProcess(
                    "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
                ) as any,
            );
            mockDockerClient.info.resolves({ OSType: Platform.Windows });

            const result = await dockerUtils.checkEngine();
            expect(!result.success).to.be.true;
            expect(result.fullErrorText).to.equal(LocalContainers.switchToLinuxContainersCanceled);
        });

        test("checkEngine: should fail on unsupported architecture", async () => {
            sandbox.stub(os, "platform").returns(Platform.Windows);
            sandbox.stub(os, "arch").returns("arm");

            const result = await dockerUtils.checkEngine();
            expect(!result.success).to.be.true;
            expect(result.error).to.equal(
                LocalContainers.unsupportedDockerArchitectureError("arm"),
            );
        });

        test("checkEngine: should handle Linux Docker permissions error", async () => {
            sandbox.stub(os, "platform").returns(Platform.Linux);
            sandbox.stub(os, "arch").returns("x64");
            mockDockerClient.listContainers.rejects(new Error("Permission denied"));

            const result = await dockerUtils.checkEngine();
            expect(!result.success).to.be.true;
            expect(result.fullErrorText).to.equal("Permission denied");
            expect(result.error).to.equal(LocalContainers.linuxDockerPermissionsError);
        });

        test("checkEngine: should handle Mac ARM Rosetta error", async () => {
            sandbox.stub(os, "platform").returns(Platform.Mac);
            sandbox.stub(os, "arch").returns("arm");
            sandbox.stub(osCommands, "execCommandWithPipe").rejects(new Error("Rosetta not Enabled"));

            const result = await dockerUtils.checkEngine();
            expect(!result.success).to.be.true;
            expect(result.fullErrorText).to.equal("Rosetta not Enabled");
            expect(result.error).to.equal(LocalContainers.rosettaError);
        });

        test("checkEngine: should succeed on Intel Mac without Rosetta check", async () => {
            sandbox.stub(os, "platform").returns(Platform.Mac);
            sandbox.stub(os, "arch").returns("x64");

            const result = await dockerUtils.checkEngine();
            expect(result.success).to.be.true;
        });
    });

    suite("Container Name Validation", () => {
        test("validateContainerName: handles various input scenarios", async () => {
            const makeContainerInfo = (names: string[]) =>
                names.map((n) => ({ Names: [`/${n}`] }));

            // Empty name => generate defaultContainerName_2
            mockDockerClient.listContainers.resolves(
                makeContainerInfo([defaultContainerName, `${defaultContainerName}_1`]),
            );
            let result = await dockerUtils.validateContainerName("");
            expect(result).to.equal(`${defaultContainerName}_2`);

            // Valid name, not taken => return as-is
            mockDockerClient.listContainers.resolves(makeContainerInfo(["existing_one", "used"]));
            result = await dockerUtils.validateContainerName("new_valid");
            expect(result).to.equal("new_valid");

            // Invalid name (regex fails) => return empty string
            mockDockerClient.listContainers.resolves([]);
            result = await dockerUtils.validateContainerName("!invalid*name");
            expect(result).to.equal("");

            // Valid name, but already taken => return empty string
            mockDockerClient.listContainers.resolves(makeContainerInfo(["taken_name"]));
            result = await dockerUtils.validateContainerName("taken_name");
            expect(result).to.equal("");
        });
    });

    suite("Docker Desktop Startup", () => {
        test("startDocker: should return success when Docker is already running", async () => {
            sandbox.stub(dockerClient, "pingDocker").resolves(true);

            const result = await dockerUtils.startDocker();
            expect(result.success).to.be.true;
        });

        test("startDocker: should start Docker successfully on Windows when not running", async () => {
            sandbox.stub(os, "platform").returns(Platform.Windows);
            const spawnStub = sandbox.stub(childProcess, "spawn");
            const pingDockerStub = sandbox.stub(dockerClient, "pingDocker");
            pingDockerStub.onFirstCall().resolves(false);
            pingDockerStub.onSecondCall().resolves(true);

            const dockerPath = path.join(
                "C:",
                "Program Files",
                "Docker",
                "Docker",
                "resources",
                "bin",
                "docker.exe",
            );

            const createSuccessProcess = (output: string) => ({
                stdout: {
                    on: sinon.stub().callsFake((event, callback) => {
                        if (event === "data") setTimeout(() => callback(output), 0);
                    }),
                },
                stderr: { on: sinon.stub() },
                on: sinon.stub().callsFake((event, callback) => {
                    if (event === "close") setTimeout(() => callback(0), 5);
                }),
            });

            spawnStub.returns(createSuccessProcess(dockerPath) as any);
            sandbox.stub(osCommands, "execCommand").resolves("");

            const result = await dockerUtils.startDocker();
            expect(result.success).to.be.true;
        });

        test("startDocker: should start Docker successfully on Linux when not running", async () => {
            sandbox.stub(os, "platform").returns(Platform.Linux);
            const pingDockerStub = sandbox.stub(dockerClient, "pingDocker");
            pingDockerStub.onFirstCall().resolves(false);
            pingDockerStub.onSecondCall().resolves(true);
            sandbox.stub(osCommands, "execCommand").resolves("");

            const result = await dockerUtils.startDocker();
            expect(result.success).to.be.true;
        });

        test("startDocker: should fail on unsupported platform", async () => {
            sandbox.stub(os, "platform").returns("fakePlatform" as Platform);
            sandbox.stub(dockerClient, "pingDocker").resolves(false);

            const result = await dockerUtils.startDocker();
            expect(!result.success).to.be.true;
            expect(result.error).to.equal(
                LocalContainers.unsupportedDockerPlatformError("fakePlatform"),
            );
        });

        test("startDocker: should fail on Windows when Docker is not installed", async () => {
            sandbox.stub(os, "platform").returns(Platform.Windows);
            sandbox.stub(dockerClient, "pingDocker").resolves(false);
            sandbox.stub(osCommands, "getDockerExecutablePath").resolves("");

            const result = await dockerUtils.startDocker();
            expect(!result.success).to.be.true;
            expect(result.error).to.equal(LocalContainers.dockerDesktopPathError);
        });
    });

    suite("SQL Server Container Operations", () => {
        test("startSqlServerDockerContainer: success and failure cases", async () => {
            const containerName = "testContainer";
            const version = "2019";
            const hostname = "localhost";
            const port = 1433;

            const createAndStartContainerStub = sandbox.stub(
                dockerOperations,
                "createAndStartContainer",
            );

            // Success case
            const mockContainer = { id: "container123" };
            createAndStartContainerStub.resolves(mockContainer as any);

            const resultSuccess = await dockerUtils.startSqlServerDockerContainer(
                containerName,
                "Xf9!uDq7@LmB2#cV",
                version,
                hostname,
                port,
            );

            expect(createAndStartContainerStub).to.have.been.calledOnce;
            expect(resultSuccess).to.deep.equal({ success: true, port });

            createAndStartContainerStub.reset();

            // Failure case
            createAndStartContainerStub.rejects(
                new Error(LocalContainers.startSqlServerContainerError),
            );

            const resultFailure = await dockerUtils.startSqlServerDockerContainer(
                containerName,
                "Xf9!uDq7@LmB2#cV",
                version,
                hostname,
                port,
            );

            expect(resultFailure.success).to.equal(false);
            expect(resultFailure.error).to.equal(LocalContainers.startSqlServerContainerError);
        });

        test("pullSqlServerContainerImage: should pull the container image", async () => {
            const pullImageStub = sandbox.stub(dockerOperations, "pullImage");
            pullImageStub.resolves();

            const result = await dockerUtils.pullSqlServerContainerImage("2025");
            expect(pullImageStub).to.have.been.calledOnce;
            expect(result.success).to.be.true;
        });

        test("checkIfContainerIsReadyForConnections: should return success when container is ready", async () => {
            const streamContainerLogsStub = sandbox.stub(dockerOperations, "streamContainerLogs");
            streamContainerLogsStub.callsFake(async (_name, onData) => {
                onData("SQL Server 2022 started. Recovery is complete.");
                return () => {};
            });

            const result = await dockerUtils.checkIfContainerIsReadyForConnections("testContainer");
            expect(result.success).to.be.true;
        });
    });

    suite("Container Lifecycle Operations", () => {
        test("restartContainer: should restart the container and return success", async () => {
            sandbox.stub(os, "platform").returns(Platform.Linux);
            const { sendActionEvent } = stubTelemetry(sandbox);
            const containerName = "testContainer";

            sandbox.stub(dockerClient, "pingDocker").resolves(true);
            sandbox.stub(dockerOperations, "containerExists").resolves(true);

            const isContainerRunningStub = sandbox.stub(dockerOperations, "isContainerRunning");
            sandbox.stub(dockerOperations, "startContainer").resolves();

            const streamContainerLogsStub = sandbox.stub(dockerOperations, "streamContainerLogs");
            streamContainerLogsStub.callsFake(async (_name, onData) => {
                onData("Recovery is complete");
                return () => {};
            });

            // Case 1: Container is already running
            isContainerRunningStub.resolves(true);

            let result = await dockerUtils.restartContainer(
                containerName,
                node,
                mockObjectExplorerService,
            );
            expect(result).to.be.true;

            // Case 2: Container is not running
            isContainerRunningStub.resolves(false);

            result = await dockerUtils.restartContainer(
                containerName,
                node,
                mockObjectExplorerService,
            );
            expect(result).to.be.true;
            expect(sendActionEvent).to.have.been.called;
        });

        test("deleteContainer: should delete the container and return success or error", async () => {
            const { sendActionEvent, sendErrorEvent } = stubTelemetry(sandbox);

            const mockContainer = {
                stop: sandbox.stub().resolves(),
                remove: sandbox.stub().resolves(),
            };
            mockDockerClient.getContainer.returns(mockContainer as any);

            // Success case
            let result = await dockerUtils.deleteContainer("testContainer");
            expect(mockContainer.stop).to.have.been.calledOnce;
            expect(mockContainer.remove).to.have.been.calledOnce;
            expect(sendActionEvent).to.have.been.calledOnce;
            expect(result).to.be.true;

            mockContainer.stop.reset();
            mockContainer.remove.reset();

            // Failure case
            mockContainer.stop.resolves();
            mockContainer.remove.rejects(new Error("Couldn't delete container"));

            result = await dockerUtils.deleteContainer("testContainer");
            expect(sendErrorEvent).to.have.been.calledOnce;
            expect(!result).to.be.true;
        });

        test("stopContainer: should stop the container and return success or error", async () => {
            const { sendActionEvent, sendErrorEvent } = stubTelemetry(sandbox);

            const mockContainer = {
                stop: sandbox.stub().resolves(),
            };
            mockDockerClient.getContainer.returns(mockContainer as any);

            // Success case
            let result = await dockerUtils.stopContainer("testContainer");
            expect(mockContainer.stop).to.have.been.calledOnce;
            expect(sendActionEvent).to.have.been.calledOnce;
            expect(result).to.be.true;

            mockContainer.stop.reset();

            // Failure case
            mockContainer.stop.rejects(new Error("Couldn't stop container"));

            result = await dockerUtils.stopContainer("testContainer");
            expect(!result).to.be.true;
            expect(sendErrorEvent).to.have.been.calledOnce;
        });
    });

    suite("Container Connection Helpers", () => {
        test("checkIfConnectionIsDockerContainer: should return container name when found", async () => {
            mockDockerClient.listContainers.resolves([]);

            // Non-localhost or not found
            let result = await dockerUtils.checkIfConnectionIsDockerContainer("some.remote.host");
            expect(result).to.equal(undefined);

            // Container found
            mockDockerClient.listContainers.resolves([
                { Id: "container123", Names: ["/myContainer"] },
            ]);
            result = await dockerUtils.checkIfConnectionIsDockerContainer("container123");
            expect(result).to.equal("myContainer");
        });

        test("prepareForDockerContainerCommand: should prepare the command correctly", async () => {
            const containerName = "testContainer";
            sandbox.stub(os, "platform").returns(Platform.Linux);
            const showInformationMessageStub = sandbox.stub(
                vscode.window,
                "showInformationMessage",
            );
            sandbox.stub(vscode.window, "showErrorMessage");

            sandbox.stub(dockerClient, "pingDocker").resolves(true);
            const containerExistsStub = sandbox.stub(dockerOperations, "containerExists");

            // Docker is running, and container exists
            containerExistsStub.resolves(true);

            let result = await dockerUtils.prepareForDockerContainerCommand(
                containerName,
                node,
                mockObjectExplorerService,
            );
            expect(result.success).to.be.true;

            // Docker is running, container does not exist
            containerExistsStub.resolves(false);

            result = await dockerUtils.prepareForDockerContainerCommand(
                containerName,
                node,
                mockObjectExplorerService,
            );
            expect(!result.success).to.be.true;
            expect(result.error).to.equal(LocalContainers.containerDoesNotExistError);
            expect(showInformationMessageStub).to.have.been.calledOnce;
        });
    });

    suite("Engine Error Links", () => {
        test("getEngineErrorLink and getEngineErrorLinkText: should return correct values", () => {
            const platformStub = sandbox.stub(os, "platform");
            const archStub = sandbox.stub(os, "arch");

            // Windows platform, x64 architecture
            platformStub.returns(Platform.Windows);
            archStub.returns("x64");

            let errorLink = dockerUtils.getEngineErrorLink();
            let errorLinkText = dockerUtils.getEngineErrorLinkText();
            expect(errorLink).to.equal(dockerUtils.windowsContainersErrorLink);
            expect(errorLinkText).to.equal(LocalContainers.configureLinuxContainers);

            platformStub.resetBehavior();
            archStub.resetBehavior();

            // Mac platform, non x64 architecture
            platformStub.returns(Platform.Mac);
            archStub.returns("arm64");

            errorLink = dockerUtils.getEngineErrorLink();
            errorLinkText = dockerUtils.getEngineErrorLinkText();
            expect(errorLink).to.equal(dockerUtils.rosettaErrorLink);
            expect(errorLinkText).to.equal(LocalContainers.configureRosetta);

            platformStub.resetBehavior();

            // Linux platform
            platformStub.returns(Platform.Linux);
            errorLink = dockerUtils.getEngineErrorLink();
            errorLinkText = dockerUtils.getEngineErrorLinkText();
            expect(errorLink).to.equal(undefined);
            expect(errorLinkText).to.equal(undefined);
        });
    });
});
