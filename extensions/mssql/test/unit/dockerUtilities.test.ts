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

suite("Docker Utilities", () => {
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

    test("initializeDockerSteps: should return correct Docker deployment steps", async () => {
        const steps = dockerUtils.initializeDockerSteps();

        expect(steps.length, "Should return 7 steps").to.equal(7);

        expect(steps[0].headerText).to.equal(LocalContainers.dockerInstallHeader);
        expect(steps[0].bodyText).to.equal(LocalContainers.dockerInstallBody);
        expect(steps[0].errorLink).to.equal("https://www.docker.com/products/docker-desktop/");
        expect(steps[0].errorLinkText).to.equal(LocalContainers.installDocker);
        expect(typeof steps[0].stepAction, "stepAction should be a function").to.equal("function");

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

    test("sanitizeErrorText: should truncate long error messages and sanitize SA_PASSWORD", () => {
        // Test sanitization
        const errorWithPassword = "Connection failed: SA_PASSWORD={testtesttest} something broke";
        const sanitized = dockerUtils.sanitizeErrorText(errorWithPassword);
        expect(sanitized.includes("SA_PASSWORD=******"), "SA_PASSWORD value should be masked").to.be
            .true;
        expect(
            !sanitized.includes("testtesttest"),
            "Original password should not appear in sanitized output",
        ).to.be.true;
    });

    test("validateSqlServerPassword: should validate password complexity and length", () => {
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

        // Valid length but not enough complexity (only lowercase)
        const lowComplexityResult = dockerUtils.validateSqlServerPassword("<placeholder>");
        expect(lowComplexityResult, "Should return complexity error").to.equal(
            LocalContainers.passwordComplexityError,
        );

        // Valid: meets 3 categories (uppercase, lowercase, number)
        const result1 = dockerUtils.validateSqlServerPassword("Placeholder1");
        expect(result1, "Should return empty string for valid password").to.equal("");

        // Valid: meets 4 categories (uppercase, lowercase, number, special char)
        const result2 = dockerUtils.validateSqlServerPassword("<Placeholder1>");
        expect(result2, "Should return empty string for valid password").to.equal("");

        // Only 2 categories (lowercase and digit)
        const invalidCategoryResult = dockerUtils.validateSqlServerPassword("<hidden>");
        expect(invalidCategoryResult, "Should return complexity error").to.equal(
            LocalContainers.passwordComplexityError,
        );
    });

    test("checkDockerInstallation: should check Docker installation and return correct status", async () => {
        // Mock dockerode version() to simulate successful Docker installation check
        mockDockerClient.version.resolves({ Version: "24.0.0" });

        const result = await dockerUtils.checkDockerInstallation();

        // Test the actual behavior
        expect(result.success, "Should return success when Docker is installed").to.be.true;
        expect(result.error).to.equal(undefined);
        expect(result.fullErrorText).to.equal(undefined);

        expect(mockDockerClient.version).to.have.been.calledOnce;
    });

    test("checkDockerInstallation: should check Docker installation and return correct error status", async () => {
        // Mock dockerode version() to simulate Docker installation failure
        mockDockerClient.version.rejects(new Error("Docker is not installed"));

        const result = await dockerUtils.checkDockerInstallation();

        // Test the actual behavior
        expect(!result.success, "Should return failure when Docker is not installed").to.be.true;
        expect(result.error).to.equal(LocalContainers.dockerInstallError);
        expect(result.fullErrorText).to.equal("Docker is not installed");

        expect(mockDockerClient.version).to.have.been.calledOnce;
    });

    test("checkEngine: should succeed on Linux platform with x64 architecture", async () => {
        const platformStub = sandbox.stub(os, "platform");
        const archStub = sandbox.stub(os, "arch");

        platformStub.returns(Platform.Linux);
        archStub.returns("x64");

        // Mock dockerode listContainers for Linux check
        mockDockerClient.listContainers.resolves([]);

        const result = await dockerUtils.checkEngine();
        expect(result.error).to.equal(undefined);
        expect(result.success).to.be.true;
    });

    test("checkEngine: should switch engine on Windows when user confirms", async () => {
        const platformStub = sandbox.stub(os, "platform");
        const archStub = sandbox.stub(os, "arch");
        const spawnStub = sandbox.stub(childProcess, "spawn");
        const messageStub = sandbox.stub(vscode.window, "showInformationMessage");
        const execCommandStub = sandbox.stub(osCommands, "execCommand");

        // Helper to create mock process that succeeds
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
                if (event === "error") {
                    /* no-op for success case */
                }
            }),
        });

        platformStub.returns(Platform.Windows);
        archStub.returns("x64");
        messageStub.resolves("Yes" as any);

        // Mock getDockerExecutablePath via spawn
        spawnStub.returns(
            createSuccessProcess(
                "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
            ) as any,
        );

        // Mock dockerode info() to return Windows OS type (needs engine switch)
        mockDockerClient.info.resolves({ OSType: Platform.Windows });

        // Mock execCommand for engine switch
        execCommandStub.resolves("");

        const result = await dockerUtils.checkEngine();
        expect(result.success).to.be.true;
    });

    test("checkEngine: should fail when Windows user cancels engine switch", async () => {
        const platformStub = sandbox.stub(os, "platform");
        const archStub = sandbox.stub(os, "arch");
        const spawnStub = sandbox.stub(childProcess, "spawn");
        const messageStub = sandbox.stub(vscode.window, "showInformationMessage");

        // Helper to create mock process that succeeds
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
                if (event === "error") {
                    /* no-op for success case */
                }
            }),
        });

        platformStub.returns(Platform.Windows);
        archStub.returns("x64");
        messageStub.resolves(undefined); // User cancels

        // Mock getDockerExecutablePath via spawn
        spawnStub.returns(
            createSuccessProcess(
                "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
            ) as any,
        );

        // Mock dockerode info() to return Windows OS type (needs engine switch)
        mockDockerClient.info.resolves({ OSType: Platform.Windows });

        const result = await dockerUtils.checkEngine();
        expect(!result.success).to.be.true;
        expect(result.fullErrorText).to.equal(LocalContainers.switchToLinuxContainersCanceled);
    });

    test("checkEngine: should fail on unsupported architecture", async () => {
        const platformStub = sandbox.stub(os, "platform");
        const archStub = sandbox.stub(os, "arch");

        platformStub.returns(Platform.Windows);
        archStub.returns("arm");

        const result = await dockerUtils.checkEngine();
        expect(!result.success).to.be.true;
        expect(result.error).to.equal(LocalContainers.unsupportedDockerArchitectureError("arm"));
    });

    test("checkEngine: should fail on unsupported platform (treated as Linux)", async () => {
        const platformStub = sandbox.stub(os, "platform");
        const archStub = sandbox.stub(os, "arch");

        platformStub.returns("fakePlatform" as Platform);
        archStub.returns("x64");

        // Mock dockerode listContainers to fail since platform is unsupported
        // Unknown platforms are treated like Linux and fall through to the else clause
        mockDockerClient.listContainers.rejects(new Error("unsupported platform"));

        const result = await dockerUtils.checkEngine();
        expect(!result.success).to.be.true;
        // Unknown platform falls through to Linux else clause, which returns windowsContainersError on failure
        // (since it's neither Platform.Linux nor Platform.Mac in the error handler)
        expect(result.error).to.equal(LocalContainers.windowsContainersError);
    });

    test("checkEngine: should handle Linux Docker permissions error", async () => {
        const platformStub = sandbox.stub(os, "platform");
        const archStub = sandbox.stub(os, "arch");

        platformStub.returns(Platform.Linux);
        archStub.returns("x64");

        // Mock dockerode listContainers to fail with permission error
        mockDockerClient.listContainers.rejects(new Error("Permission denied"));

        const result = await dockerUtils.checkEngine();
        expect(!result.success).to.be.true;
        expect(result.fullErrorText).to.equal("Permission denied");
        expect(result.error).to.equal(LocalContainers.linuxDockerPermissionsError);
    });

    test("checkEngine: should handle Mac ARM Rosetta error", async () => {
        const platformStub = sandbox.stub(os, "platform");
        const archStub = sandbox.stub(os, "arch");
        const execCommandWithPipeStub = sandbox.stub(osCommands, "execCommandWithPipe");

        platformStub.returns(Platform.Mac);
        archStub.returns("arm");

        // For Mac ARM Rosetta error, the pipe command fails
        execCommandWithPipeStub.rejects(new Error("Rosetta not Enabled"));

        const result = await dockerUtils.checkEngine();
        expect(!result.success).to.be.true;
        expect(result.fullErrorText).to.equal("Rosetta not Enabled");
        expect(result.error).to.equal(LocalContainers.rosettaError);
    });

    test("checkEngine: should succeed on Intel Mac without Rosetta check", async () => {
        const platformStub = sandbox.stub(os, "platform");
        const archStub = sandbox.stub(os, "arch");

        platformStub.returns(Platform.Mac);
        archStub.returns("x64");

        const result = await dockerUtils.checkEngine();
        expect(result.success).to.be.true;
    });

    test("validateContainerName: handles various input scenarios", async () => {
        // Mock listContainers to return container info
        const makeContainerInfo = (names: string[]) =>
            names.map((n) => ({ Names: [`/${n}`] }));

        // 1. Empty name => generate defaultContainerName_2
        mockDockerClient.listContainers.resolves(
            makeContainerInfo([defaultContainerName, `${defaultContainerName}_1`]),
        );
        let result = await dockerUtils.validateContainerName("");
        expect(result).to.equal(`${defaultContainerName}_2`);

        // 2. Valid name, not taken => return as-is
        mockDockerClient.listContainers.resolves(makeContainerInfo(["existing_one", "used"]));
        result = await dockerUtils.validateContainerName("new_valid");
        expect(result).to.equal("new_valid");

        // 3. Invalid name (regex fails) => return empty string
        mockDockerClient.listContainers.resolves([]);
        result = await dockerUtils.validateContainerName("!invalid*name");
        expect(result).to.equal("");

        // 4. Valid name, but already taken => return empty string
        mockDockerClient.listContainers.resolves(makeContainerInfo(["taken_name"]));
        result = await dockerUtils.validateContainerName("taken_name");
        expect(result).to.equal("");
    });

    test("getDockerPath: handles success, invalid path, and failure cases", async () => {
        const executable = "DockerCli.exe";
        const spawnStub = sandbox.stub(childProcess, "spawn");

        // Helper to create mock process that succeeds with output
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

        // Helper to create mock process that fails
        const createFailureProcess = (error: Error) => ({
            stdout: { on: sinon.stub() },
            stderr: { on: sinon.stub() },
            on: sinon.stub().callsFake((event, callback) => {
                if (event === "error") setTimeout(() => callback(error), 0);
            }),
        });

        // Case 1: Valid Docker path
        const validPath = path.join(
            "C:",
            "Program Files",
            "Docker",
            "Docker",
            "resources",
            "bin",
            "docker.exe",
        );
        spawnStub.onCall(0).returns(createSuccessProcess(validPath) as any);

        const expectedValidResult = path.join(
            "C:",
            "Program Files",
            "Docker",
            "Docker",
            executable,
        );
        const result1 = await dockerUtils.getDockerPath(executable);
        expect(result1, "Should return the constructed Docker path").to.equal(expectedValidResult);

        // Case 2: Invalid Docker path structure
        const invalidPath = path.join("C:", "No", "Docker", "Here", "docker.exe");
        spawnStub.onCall(1).returns(createSuccessProcess(invalidPath) as any);

        const result2 = await dockerUtils.getDockerPath(executable);
        expect(result2, "Should return empty string for invalid path structure").to.equal("");

        // Case 3: execCommand throws error
        spawnStub.onCall(2).returns(createFailureProcess(new Error("Command failed")) as any);

        const result3 = await dockerUtils.getDockerPath(executable);
        expect(result3, "Should return empty string when command fails").to.equal("");

        expect(spawnStub).to.have.been.calledThrice;
    });

    test("startSqlServerDockerContainer: success and failure cases", async () => {
        const containerName = "testContainer";
        const version = "2019";
        const hostname = "localhost";
        const port = 1433;

        // Mock createAndStartContainer
        const createAndStartContainerStub = sandbox.stub(dockerOperations, "createAndStartContainer");

        // Success case: createAndStartContainer resolves
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
        expect(resultSuccess).to.deep.equal({
            success: true,
            port,
        });

        createAndStartContainerStub.reset();

        // Failure case: createAndStartContainer rejects
        createAndStartContainerStub.rejects(new Error(LocalContainers.startSqlServerContainerError));

        const resultFailure = await dockerUtils.startSqlServerDockerContainer(
            containerName,
            "Xf9!uDq7@LmB2#cV",
            version,
            hostname,
            port,
        );

        expect(createAndStartContainerStub).to.have.been.calledOnce;
        expect(resultFailure.success).to.equal(false);
        expect(resultFailure.error).to.equal(LocalContainers.startSqlServerContainerError);
        expect(resultFailure.fullErrorText).to.equal(LocalContainers.startSqlServerContainerError);
        expect(resultFailure.port).to.equal(undefined);
    });

    test("isDockerContainerRunning: should return true if container is running, false otherwise", async () => {
        const containerName = "my-container";

        // Mock isContainerRunning from dockerOperations
        const isContainerRunningStub = sandbox.stub(dockerOperations, "isContainerRunning");

        // Case 1: container running
        isContainerRunningStub.resolves(true);
        let result = await dockerUtils.isDockerContainerRunning(containerName);
        expect(result).to.equal(true);

        // Case 2: container not running
        isContainerRunningStub.resolves(false);
        result = await dockerUtils.isDockerContainerRunning(containerName);
        expect(result).to.equal(false);

        expect(isContainerRunningStub).to.have.been.calledTwice;
    });

    test("startDocker: should return success when Docker is already running", async () => {
        // Mock pingDocker to return true (Docker is already running)
        sandbox.stub(dockerClient, "pingDocker").resolves(true);

        const result = await dockerUtils.startDocker();
        expect(result.success, "Docker is already running, should be successful").to.be.true;
    });

    test("startDocker: should start Docker successfully on Windows when not running", async () => {
        sandbox.stub(os, "platform").returns(Platform.Windows);
        const spawnStub = sandbox.stub(childProcess, "spawn");

        const dockerPath = path.join(
            "C:",
            "Program Files",
            "Docker",
            "Docker",
            "resources",
            "bin",
            "docker.exe",
        );
        // Helper to create mock process that succeeds with output
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

        // Mock pingDocker: first call returns false (not running), subsequent calls return true (started)
        const pingDockerStub = sandbox.stub(dockerClient, "pingDocker");
        pingDockerStub.onFirstCall().resolves(false);
        pingDockerStub.onSecondCall().resolves(true);

        // Mock getDockerExecutablePath via spawn
        spawnStub.returns(createSuccessProcess(dockerPath) as any);

        // Mock execCommand
        sandbox.stub(osCommands, "execCommand").resolves("");

        const result = await dockerUtils.startDocker();
        expect(result.error).to.equal(undefined);
        expect(result.success, "Docker should start successfully on Windows").to.be.true;
    });

    test("startDocker: should start Docker successfully on Linux when not running", async () => {
        sandbox.stub(os, "platform").returns(Platform.Linux);

        // Mock pingDocker: first call returns false (not running), subsequent calls return true (started)
        const pingDockerStub = sandbox.stub(dockerClient, "pingDocker");
        pingDockerStub.onFirstCall().resolves(false);
        pingDockerStub.onSecondCall().resolves(true);

        // Mock execCommand
        sandbox.stub(osCommands, "execCommand").resolves("");

        const result = await dockerUtils.startDocker();
        expect(result.success, "Docker should start successfully on Linux").to.be.true;
    });

    test("startDocker: should fail on unsupported platform", async () => {
        sandbox.stub(os, "platform").returns("fakePlatform" as Platform);

        // Mock pingDocker: returns false (not running)
        sandbox.stub(dockerClient, "pingDocker").resolves(false);

        const result = await dockerUtils.startDocker();
        expect(!result.success, "Should not succeed on unsupported platform").to.be.true;
        expect(result.error).to.equal(
            LocalContainers.unsupportedDockerPlatformError("fakePlatform"),
        );
    });

    test("startDocker: should fail on Windows when Docker is not installed", async () => {
        sandbox.stub(os, "platform").returns(Platform.Windows);

        // Mock pingDocker: returns false (not running)
        sandbox.stub(dockerClient, "pingDocker").resolves(false);

        // Mock getDockerExecutablePath to return empty (Docker not found)
        sandbox.stub(osCommands, "getDockerExecutablePath").resolves("");

        const result = await dockerUtils.startDocker();
        expect(!result.success, "Should fail if Docker is not installed").to.be.true;
        expect(result.error).to.equal(LocalContainers.dockerDesktopPathError);
    });

    test("restartContainer: should restart the container and return success or error", async () => {
        // Stub platform and dependent modules
        sandbox.stub(os, "platform").returns(Platform.Linux);
        // Stub telemetry method
        const { sendActionEvent } = stubTelemetry(sandbox);
        const containerName = "testContainer";

        // Mock pingDocker to return true (Docker is running)
        sandbox.stub(dockerClient, "pingDocker").resolves(true);

        // Mock containerExists
        const containerExistsStub = sandbox.stub(dockerOperations, "containerExists");
        containerExistsStub.resolves(true);

        // Mock isContainerRunning
        const isContainerRunningStub = sandbox.stub(dockerOperations, "isContainerRunning");

        // Mock startContainer
        const startContainerStub = sandbox.stub(dockerOperations, "startContainer");
        startContainerStub.resolves();

        // Mock getContainerLogs for checkIfContainerIsReadyForConnections
        const getContainerLogsStub = sandbox.stub(dockerOperations, "getContainerLogs");
        getContainerLogsStub.resolves("Recovery is complete");

        // Case 1: Container is already running, should return success
        isContainerRunningStub.resolves(true);

        let result = await dockerUtils.restartContainer(
            containerName,
            node,
            mockObjectExplorerService,
        );
        expect(result, "Should return success when container is already running").to.be.true;

        // Case 2: Container is not running, should restart, send telemetry, and return success
        isContainerRunningStub.resolves(false);

        result = await dockerUtils.restartContainer(containerName, node, mockObjectExplorerService);
        expect(result, "Should return success when container is restarted successfully").to.be.true;
        expect(sendActionEvent).to.have.been.called;
    });

    test("checkIfContainerIsReadyForConnections: should return true if container is ready, false otherwise", async () => {
        // Mock getContainerLogs from dockerOperations
        const getContainerLogsStub = sandbox.stub(dockerOperations, "getContainerLogs");

        // Case: container is ready - logs contain "Recovery is complete"
        getContainerLogsStub.resolves("SQL Server 2022 started. Recovery is complete.");

        let result = await dockerUtils.checkIfContainerIsReadyForConnections("testContainer");
        expect(result.success, "Should return success when container is ready for connections").to
            .be.true;
    });

    test("deleteContainer: should delete the container and return success or error", async () => {
        const { sendActionEvent, sendErrorEvent } = stubTelemetry(sandbox);

        // Mock the docker container operations via mockDockerClient
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

        // Reset stubs
        mockContainer.stop.reset();
        mockContainer.remove.reset();

        // Failure case
        mockContainer.stop.resolves();
        mockContainer.remove.rejects(new Error("Couldn't delete container"));

        result = await dockerUtils.deleteContainer("testContainer");
        expect(sendErrorEvent).to.have.been.calledOnce;
        expect(!result, "Should return false on failure").to.be.true;
    });

    test("stopContainer: should stop the container and return success or error", async () => {
        const { sendActionEvent, sendErrorEvent } = stubTelemetry(sandbox);

        // Mock the docker container operations via mockDockerClient
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
        expect(!result, "Should return false on failure").to.be.true;
        expect(sendErrorEvent).to.have.been.calledOnce;
    });

    test("checkIfConnectionIsDockerContainer: should return container name if the connection is to a Docker container", async () => {
        // Mock listContainers for getContainerNameById
        mockDockerClient.listContainers.resolves([]);

        // Non-localhost or not found: should return undefined
        let result = await dockerUtils.checkIfConnectionIsDockerContainer("some.remote.host");
        expect(result, "Should return undefined for non-localhost address").to.equal(undefined);

        // Container found
        mockDockerClient.listContainers.resolves([{ Id: "container123", Names: ["/myContainer"] }]);
        result = await dockerUtils.checkIfConnectionIsDockerContainer("container123");
        expect(result, "Should return container name").to.equal("myContainer");
    });

    test("findAvailablePort: should find next available port", async () => {
        // Mock listContainers to return port info
        // 1. No containers running: should return 1433
        mockDockerClient.listContainers.resolves([]);
        let result = await dockerUtils.findAvailablePort(1433);
        expect(result, "Should return 1433 when no containers are running").to.equal(1433);

        // 2. Port 1433 is taken: should return next available port
        mockDockerClient.listContainers.resolves([
            { Ports: [{ PublicPort: 1433 }] },
        ]);
        result = await dockerUtils.findAvailablePort(1433);
        expect(result, "Should return 1434 when 1433 is taken").to.equal(1434);
    });

    test("prepareForDockerContainerCommand: should prepare the command with correct parameters", async () => {
        const containerName = "testContainer";
        sandbox.stub(os, "platform").returns(Platform.Linux);
        const showInformationMessageStub = sandbox.stub(vscode.window, "showInformationMessage");
        sandbox.stub(vscode.window, "showErrorMessage");

        // Mock pingDocker to return true (Docker is running)
        sandbox.stub(dockerClient, "pingDocker").resolves(true);

        // Mock containerExists
        const containerExistsStub = sandbox.stub(dockerOperations, "containerExists");

        // Docker is running, and container exists
        containerExistsStub.resolves(true);

        let result = await dockerUtils.prepareForDockerContainerCommand(
            containerName,
            node,
            mockObjectExplorerService,
        );
        expect(result.success, "Should return true if container exists").to.be.true;

        // Docker is running, container does not exist
        containerExistsStub.resolves(false);

        result = await dockerUtils.prepareForDockerContainerCommand(
            containerName,
            node,
            mockObjectExplorerService,
        );
        expect(!result.success, "Should return false if container does not exist").to.be.true;
        expect(result.error).to.equal(LocalContainers.containerDoesNotExistError);
        expect(showInformationMessageStub, "Should show info message if container does not exist")
            .to.have.been.calledOnce;
    });

    test("sanitizeContainerInput: should properly sanitize container input", () => {
        // Test with valid input
        let result = dockerUtils.sanitizeContainerInput("valid-container");
        expect(result, "Valid name should remain unchanged").to.equal("valid-container");

        // Test with alphanumeric and allowed special characters
        result = dockerUtils.sanitizeContainerInput("test_container.1-2");
        expect(result, "Name with allowed special chars should remain unchanged").to.equal(
            "test_container.1-2",
        );

        // Test with disallowed special characters
        result = dockerUtils.sanitizeContainerInput("test@container!");
        expect(result, "Disallowed special chars should be removed").to.equal("testcontainer");

        // Test with SQL injection attempt
        result = dockerUtils.sanitizeContainerInput("container';DROP TABLE users;--");
        expect(result, "SQL injection chars should be removed").to.equal(
            "containerDROPTABLEusers--",
        );

        // Test with command injection attempt
        result = dockerUtils.sanitizeContainerInput('container" && echo Injected');
        expect(result, "Command injection chars should be removed").to.equal(
            "containerechoInjected",
        );

        // Test with command injection attempt
        result = dockerUtils.sanitizeContainerInput('container"; rm -rf /');
        expect(result, "Command injection chars should be removed").to.equal("containerrm-rf");

        // Test with empty string
        result = dockerUtils.sanitizeContainerInput("");
        expect(result, "Empty string should remain empty").to.equal("");

        // Test with only disallowed characters
        result = dockerUtils.sanitizeContainerInput("@#$%^&*()");
        expect(result, "String with only disallowed chars should become empty").to.equal("");

        // Test with command injection attempts
        const sanitizedInjection = dockerUtils.sanitizeContainerInput('container"; rm -rf / #');
        expect(sanitizedInjection, "Command injection characters should be removed").to.equal(
            "containerrm-rf",
        );

        // Test with invalid characters (should be removed)
        const sanitizedInvalid = dockerUtils.sanitizeContainerInput(
            "my container/with\\invalid:chars",
        );
        expect(sanitizedInvalid, "Invalid characters should be removed").to.equal(
            "mycontainerwithinvalidchars",
        );
    });

    test("pullSqlServerContainerImage: should pull the container image from the docker registry", async () => {
        // Mock pullImage from dockerOperations
        const pullImageStub = sandbox.stub(dockerOperations, "pullImage");
        pullImageStub.resolves();

        let result = await dockerUtils.pullSqlServerContainerImage("2025");
        expect(pullImageStub).to.have.been.calledOnce;

        expect(result.success).to.be.true;
    });

    test("getEngineErrorLink and getEngineErrorLinkText: should return correct error link and text", () => {
        const platformStub = sandbox.stub(os, "platform");
        const archStub = sandbox.stub(os, "arch");

        // 1. Windows platform, x64 architecture
        platformStub.returns(Platform.Windows);
        archStub.returns("x64");

        let errorLink = dockerUtils.getEngineErrorLink();
        let errorLinkText = dockerUtils.getEngineErrorLinkText();
        expect(errorLink, "Error link should match").to.equal(
            dockerUtils.windowsContainersErrorLink,
        );
        expect(errorLinkText, "Error link text should match").to.equal(
            LocalContainers.configureLinuxContainers,
        );
        platformStub.resetBehavior();
        archStub.resetBehavior();

        // 2. Mac platform, non x64 architecture
        platformStub.returns(Platform.Mac);
        archStub.returns("arm64");

        errorLink = dockerUtils.getEngineErrorLink();
        errorLinkText = dockerUtils.getEngineErrorLinkText();
        expect(errorLink, "Error link should match").to.equal(dockerUtils.rosettaErrorLink);
        expect(errorLinkText, "Error link text should match").to.equal(
            LocalContainers.configureRosetta,
        );
        platformStub.resetBehavior();
        archStub.resetBehavior();

        // 3. Linux platform
        platformStub.returns(Platform.Linux);
        errorLink = dockerUtils.getEngineErrorLink();
        errorLinkText = dockerUtils.getEngineErrorLinkText();
        platformStub.resetBehavior();
    });
});
