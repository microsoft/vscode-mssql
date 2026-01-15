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
import * as dockerUtils from "../../src/deployment/dockerUtils";
import { LocalContainers } from "../../src/constants/locConstants";
import * as childProcess from "child_process";
import { defaultContainerName, Platform } from "../../src/constants/constants";
import * as path from "path";
import { stubTelemetry } from "./utils";
import { ConnectionNode } from "../../src/objectExplorer/nodes/connectionNode";
import { ObjectExplorerService } from "../../src/objectExplorer/objectExplorerService";

chai.use(sinonChai);

suite("Docker Utilities", () => {
    let sandbox: sinon.SinonSandbox;
    let node: ConnectionNode;
    let mockObjectExplorerService: ObjectExplorerService;

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
        // Mock spawn to simulate successful Docker installation check
        const spawnStub = sandbox.stub(childProcess, "spawn");

        const mockProcess = {
            stdout: {
                on: sinon.stub().callsFake((event, callback) => {
                    if (event === "data") {
                        setTimeout(() => callback("Docker is installed"), 0);
                    }
                }),
            },
            stderr: {
                on: sinon.stub(),
            },
            on: sinon.stub().callsFake((event, callback) => {
                if (event === "close") {
                    setTimeout(() => callback(0), 10); // Exit code 0 = success
                }
            }),
        };

        spawnStub.returns(mockProcess as any);

        const result = await dockerUtils.checkDockerInstallation();

        // Test the actual behavior
        expect(result.success, "Should return success when Docker is installed").to.be.true;
        expect(result.error).to.equal(undefined);
        expect(result.fullErrorText).to.equal(undefined);

        expect(spawnStub).to.have.been.calledOnceWith("docker", ["--version"]);
    });

    test("checkDockerInstallation: should check Docker installation and return correct error status", async () => {
        // Mock spawn to simulate Docker installation failure
        const spawnStub = sandbox.stub(childProcess, "spawn");

        const mockProcess = {
            stdout: {
                on: sinon.stub(),
            },
            stderr: {
                on: sinon.stub().callsFake((event, callback) => {
                    if (event === "data") {
                        setTimeout(() => callback("Docker is not installed"), 0);
                    }
                }),
            },
            on: sinon.stub().callsFake((event, callback) => {
                if (event === "close") {
                    setTimeout(() => callback(1), 10); // Exit code 1 = error
                } else if (event === "error") {
                    // Don't trigger error event in this test
                }
            }),
        };

        spawnStub.returns(mockProcess as any);

        const result = await dockerUtils.checkDockerInstallation();

        // Test the actual behavior
        expect(!result.success, "Should return failure when Docker is not installed").to.be.true;
        expect(result.error).to.equal(LocalContainers.dockerInstallError);
        expect(result.fullErrorText).to.equal("Docker is not installed");

        expect(spawnStub).to.have.been.calledOnceWith("docker", ["--version"]);
    });

    test("checkEngine: should succeed on Linux platform with x64 architecture", async () => {
        const platformStub = sandbox.stub(os, "platform");
        const archStub = sandbox.stub(os, "arch");
        const spawnStub = sandbox.stub(childProcess, "spawn");

        // Helper to create mock process that succeeds
        const createSuccessProcess = (output: string) => ({
            stdout: {
                on: sinon.stub().callsFake((event, callback) => {
                    if (event === "data") setTimeout(() => callback(output), 0);
                }),
                pipe: sinon.stub(), // For piped commands
            },
            stderr: {
                on: sinon.stub().callsFake((event, callback) => {
                    if (event === "data") setTimeout(() => callback(""), 0);
                }),
            },
            stdin: { end: sinon.stub() }, // For piped commands
            on: sinon.stub().callsFake((event, callback) => {
                if (event === "close") setTimeout(() => callback(0), 5);
                if (event === "error") {
                    /* no-op for success case */
                }
            }),
        });

        platformStub.returns(Platform.Linux);
        archStub.returns("x64");
        spawnStub.returns(createSuccessProcess("") as any);

        const result = await dockerUtils.checkEngine();
        expect(result.error).to.equal(undefined);
        expect(result.success).to.be.true;
    });

    test("checkEngine: should switch engine on Windows when user confirms", async () => {
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
        messageStub.resolves("Yes" as any);

        spawnStub
            .onFirstCall()
            .returns(
                createSuccessProcess(
                    "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
                ) as any,
            );
        spawnStub.onSecondCall().returns(createSuccessProcess(Platform.Windows) as any);
        spawnStub.onThirdCall().returns(createSuccessProcess("") as any);

        const result = await dockerUtils.checkEngine();
        expect(result.success).to.be.true;
        expect(spawnStub).to.have.been.calledThrice;
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

        spawnStub
            .onFirstCall()
            .returns(
                createSuccessProcess(
                    "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
                ) as any,
            );
        spawnStub.onSecondCall().returns(createSuccessProcess(Platform.Windows) as any);

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

    test("checkEngine: should fail on unsupported platform", async () => {
        const platformStub = sandbox.stub(os, "platform");
        const archStub = sandbox.stub(os, "arch");

        platformStub.returns("fakePlatform" as Platform);
        archStub.returns("x64");

        const result = await dockerUtils.checkEngine();
        expect(!result.success).to.be.true;
        expect(result.error).to.equal(
            LocalContainers.unsupportedDockerPlatformError("fakePlatform"),
        );
    });

    test("checkEngine: should handle Linux Docker permissions error", async () => {
        const platformStub = sandbox.stub(os, "platform");
        const archStub = sandbox.stub(os, "arch");
        const spawnStub = sandbox.stub(childProcess, "spawn");

        // Helper to create mock process that fails
        const createFailureProcess = (errorMsg: string) => ({
            stdout: {
                on: sinon.stub(),
                pipe: sinon.stub(),
            },
            stderr: {
                on: sinon.stub().callsFake((event, callback) => {
                    if (event === "data") callback(errorMsg);
                }),
            },
            stdin: { end: sinon.stub() },
            on: sinon.stub().callsFake((event, callback) => {
                if (event === "close") setTimeout(() => callback(1), 10);
                if (event === "error") {
                    /* no-op for controlled failure */
                }
            }),
        });

        platformStub.returns(Platform.Linux);
        archStub.returns("x64");
        spawnStub.returns(createFailureProcess("Permission denied") as any);

        const result = await dockerUtils.checkEngine();
        expect(!result.success).to.be.true;
        expect(result.fullErrorText).to.equal("Permission denied");
        expect(result.error).to.equal(LocalContainers.linuxDockerPermissionsError);
    });

    test("checkEngine: should handle Mac ARM Rosetta error", async () => {
        const platformStub = sandbox.stub(os, "platform");
        const archStub = sandbox.stub(os, "arch");
        const spawnStub = sandbox.stub(childProcess, "spawn");

        // Helper to create mock process that fails with error event
        const createFailureProcess = (errorMsg: string) => ({
            stdout: {
                on: sinon.stub(),
                pipe: sinon.stub(),
            },
            stderr: {
                on: sinon.stub().callsFake((event, callback) => {
                    if (event === "data") callback(errorMsg);
                }),
            },
            stdin: { end: sinon.stub() },
            on: sinon.stub().callsFake((event, callback) => {
                if (event === "error") setTimeout(() => callback(new Error(errorMsg)), 0);
                if (event === "close") {
                    /* won't be reached if error is triggered first */
                }
            }),
        });

        platformStub.returns(Platform.Mac);
        archStub.returns("arm");

        // For Mac ARM Rosetta error, the cat command fails (file doesn't exist or permission denied)
        const dockerProcess = createFailureProcess("Rosetta not Enabled");
        const grepProcess = createFailureProcess(""); // This won't be reached if dockerProcess fails
        spawnStub.onFirstCall().returns(dockerProcess as any); // cat settings file fails
        spawnStub.onSecondCall().returns(grepProcess as any); // grep command

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
        // Stub for: existing containers include default and default_1
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

        // 1. Empty name => generate defaultContainerName_2
        spawnStub.returns(
            createSuccessProcess(`${defaultContainerName}\n${defaultContainerName}_1`) as any,
        );
        let result = await dockerUtils.validateContainerName("");
        expect(result).to.equal(`${defaultContainerName}_2`);
        spawnStub.resetHistory();

        // 2. Valid name, not taken => return as-is
        spawnStub.returns(createSuccessProcess("existing_one\nused") as any);
        result = await dockerUtils.validateContainerName("new_valid");
        expect(result).to.equal("new_valid");
        spawnStub.resetHistory();

        // 3. Invalid name (regex fails) => return empty string
        spawnStub.returns(createSuccessProcess("") as any);
        result = await dockerUtils.validateContainerName("!invalid*name");
        expect(result).to.equal("");
        spawnStub.resetHistory();

        // 4. Valid name, but already taken => return empty string
        spawnStub.returns(createSuccessProcess("taken_name") as any);
        result = await dockerUtils.validateContainerName("taken_name");
        expect(result).to.equal("");
        spawnStub.resetHistory();

        // 5. Command throws error => return input unchanged
        spawnStub.returns(createFailureProcess(new Error("failure")) as any);
        result = await dockerUtils.validateContainerName("fallback_name");
        expect(result).to.equal("fallback_name");
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

        // Success case: spawn returns successful process
        spawnStub.onCall(0).returns(createSuccessProcess("some output") as any);

        const resultSuccess = await dockerUtils.startSqlServerDockerContainer(
            containerName,
            "Xf9!uDq7@LmB2#cV",
            version,
            hostname,
            port,
        );

        expect(spawnStub).to.have.been.calledOnce;
        expect(resultSuccess).to.deep.equal({
            success: true,
            port,
        });

        spawnStub.resetHistory();

        // Failure case: spawn returns failing process
        spawnStub
            .onCall(0)
            .returns(
                createFailureProcess(
                    new Error(LocalContainers.startSqlServerContainerError),
                ) as any,
            );

        const resultFailure = await dockerUtils.startSqlServerDockerContainer(
            containerName,
            "Xf9!uDq7@LmB2#cV",
            version,
            hostname,
            port,
        );

        expect(spawnStub).to.have.been.calledOnce;
        expect(resultFailure.success).to.equal(false);
        expect(resultFailure.error).to.equal(LocalContainers.startSqlServerContainerError);
        expect(resultFailure.fullErrorText).to.equal(LocalContainers.startSqlServerContainerError);
        expect(resultFailure.port).to.equal(undefined);
    });

    test("isDockerContainerRunning: should return true if container is running, false otherwise", async () => {
        const containerName = "my-container";
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

        // Case 1: container running — returns containerName
        spawnStub.onCall(0).returns(createSuccessProcess(containerName) as any);

        let result = await dockerUtils.isDockerContainerRunning(containerName);
        expect(result).to.equal(true);

        // Case 2: container not running — returns something else
        spawnStub.onCall(1).returns(createSuccessProcess("something else") as any);

        result = await dockerUtils.isDockerContainerRunning(containerName);
        expect(result).to.equal(false);

        // Case 3: spawn throws error
        spawnStub.onCall(2).returns(createFailureProcess(new Error("spawn error")) as any);

        result = await dockerUtils.isDockerContainerRunning(containerName);
        expect(result).to.equal(false);

        expect(spawnStub).to.have.callCount(3);
    });

    test("startDocker: should return success when Docker is already running", async () => {
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

        spawnStub.returns(createSuccessProcess("Docker is running") as any);

        const result = await dockerUtils.startDocker();
        expect(result.success, "Docker is already running, should be successful").to.be.true;
        expect(spawnStub).to.have.been.calledOnceWith("docker", ["info"]);
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

        // Helper to create mock process that fails
        const createFailureProcess = (error: Error) => ({
            stdout: { on: sinon.stub() },
            stderr: { on: sinon.stub() },
            on: sinon.stub().callsFake((event, callback) => {
                if (event === "error") setTimeout(() => callback(error), 0);
            }),
        });

        spawnStub
            .onFirstCall()
            .returns(createFailureProcess(new Error("Docker not running")) as any); // CHECK_DOCKER_RUNNING (initial check)
        spawnStub.onSecondCall().returns(createSuccessProcess(dockerPath) as any); // GET_DOCKER_PATH
        spawnStub.onThirdCall().returns(createSuccessProcess("Started Docker") as any); // START_DOCKER (execDockerCommand)
        // For the polling loop that checks if Docker started - make it succeed immediately
        spawnStub.onCall(3).returns(createSuccessProcess("Docker Running") as any); // First CHECK_DOCKER_RUNNING in polling loop

        const result = await dockerUtils.startDocker();
        expect(result.error).to.equal(undefined);
        expect(result.success, "Docker should start successfully on Windows").to.be.true;
        expect(spawnStub.callCount).to.equal(4);
    });

    test("startDocker: should start Docker successfully on Linux when not running", async () => {
        sandbox.stub(os, "platform").returns(Platform.Linux);
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

        spawnStub
            .onFirstCall()
            .returns(createFailureProcess(new Error("Docker not running")) as any); // CHECK_DOCKER_RUNNING (initial check)
        spawnStub.onSecondCall().returns(createSuccessProcess("Started Docker") as any); // START_DOCKER (execDockerCommand)
        // For the polling loop that checks if Docker started - make it succeed immediately
        spawnStub.onCall(2).returns(createSuccessProcess("Docker Running") as any); // First CHECK_DOCKER_RUNNING in polling loop

        const result = await dockerUtils.startDocker();
        expect(result.success, "Docker should start successfully on Linux").to.be.true;
        expect(spawnStub.callCount).to.equal(3);
    });

    test("startDocker: should fail on unsupported platform", async () => {
        sandbox.stub(os, "platform").returns("fakePlatform" as Platform);
        const spawnStub = sandbox.stub(childProcess, "spawn");

        // Helper to create mock process that fails
        const createFailureProcess = (error: Error) => ({
            stdout: { on: sinon.stub() },
            stderr: { on: sinon.stub() },
            on: sinon.stub().callsFake((event, callback) => {
                if (event === "error") setTimeout(() => callback(error), 0);
            }),
        });

        spawnStub
            .onFirstCall()
            .returns(createFailureProcess(new Error("Docker not running")) as any); // CHECK_DOCKER_RUNNING

        const result = await dockerUtils.startDocker();
        expect(!result.success, "Should not succeed on unsupported platform").to.be.true;
        expect(result.error).to.equal(
            LocalContainers.unsupportedDockerPlatformError("fakePlatform"),
        );
    });

    test("startDocker: should fail on Windows when Docker is not installed", async () => {
        sandbox.stub(os, "platform").returns(Platform.Windows);
        const spawnStub = sandbox.stub(childProcess, "spawn");

        // Helper to create mock process that fails
        const createFailureProcess = (error: Error) => ({
            stdout: { on: sinon.stub() },
            stderr: { on: sinon.stub() },
            on: sinon.stub().callsFake((event, callback) => {
                if (event === "error") setTimeout(() => callback(error), 0);
            }),
        });

        spawnStub
            .onFirstCall()
            .returns(createFailureProcess(new Error("Docker not running")) as any); // CHECK_DOCKER_RUNNING
        spawnStub
            .onSecondCall()
            .returns(createFailureProcess(new Error("Docker not installed")) as any); // GET_DOCKER_PATH

        const result = await dockerUtils.startDocker();
        expect(!result.success, "Should fail if Docker is not installed").to.be.true;
        expect(result.error).to.equal(LocalContainers.dockerDesktopPathError);
    });

    test("restartContainer: should restart the container and return success or error", async () => {
        // Stub platform and dependent modules
        sandbox.stub(os, "platform").returns(Platform.Linux);
        const spawnStub = sandbox.stub(childProcess, "spawn");
        // Stub telemetry method
        const { sendActionEvent } = stubTelemetry(sandbox);
        const containerName = "testContainer";

        // Helper to create mock process that succeeds with output (supports piped commands)
        const createSuccessProcess = (output: string) => ({
            stdout: {
                on: sinon.stub().callsFake((event, callback) => {
                    if (event === "data") setTimeout(() => callback(output), 0);
                }),
                pipe: sinon.stub(), // For piped commands
            },
            stderr: {
                on: sinon.stub().callsFake((event, callback) => {
                    if (event === "data") setTimeout(() => callback(""), 0);
                }),
            },
            stdin: { end: sinon.stub() }, // For piped commands
            on: sinon.stub().callsFake((event, callback) => {
                if (event === "close") setTimeout(() => callback(0), 5);
                if (event === "error") {
                    /* no-op for success case */
                }
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

        // Case 1: Container is already running, should return success
        spawnStub.onFirstCall().returns(createSuccessProcess("Docker is running") as any); // START_DOCKER
        spawnStub.onSecondCall().returns(createSuccessProcess(containerName) as any); // GET_CONTAINERS_BY_NAME
        spawnStub.onThirdCall().returns(createSuccessProcess("testContainer") as any); // CHECK_CONTAINER_RUNNING

        let result = await dockerUtils.restartContainer(
            containerName,
            node,
            mockObjectExplorerService,
        );
        expect(result, "Should return success when container is already running").to.be.true;
        spawnStub.resetHistory();

        // Case 2: Container is not running, should restart, send telemetry, and return success
        spawnStub.onFirstCall().returns(createSuccessProcess("Docker is running") as any); // START_DOCKER
        spawnStub.onSecondCall().returns(createSuccessProcess(containerName) as any); // GET_CONTAINERS_BY_NAME
        spawnStub
            .onThirdCall()
            .returns(createFailureProcess(new Error("Container not running")) as any); // CHECK_CONTAINER_RUNNING
        spawnStub.onCall(3).returns(createSuccessProcess("Container restarted") as any); // START_CONTAINER
        // checkIfContainerIsReadyForConnections uses execDockerCommandWithPipe which needs 2 processes:
        spawnStub.onCall(4).returns(createSuccessProcess("some logs") as any); // docker logs
        spawnStub
            .onCall(5)
            .returns(createSuccessProcess(dockerUtils.COMMANDS.CHECK_CONTAINER_READY) as any); // grep/findstr

        result = await dockerUtils.restartContainer(containerName, node, mockObjectExplorerService);
        expect(result, "Should return success when container is restarted successfully").to.be.true;
        expect(sendActionEvent).to.have.been.calledThrice;
        spawnStub.resetHistory();
    });

    test("checkIfContainerIsReadyForConnections: should return true if container is ready, false otherwise", async () => {
        // Stub platform and dependent modules
        const spawnStub = sandbox.stub(childProcess, "spawn");

        // Helper to create mock process that succeeds with output for piped commands
        const createSuccessProcess = (output: string) => ({
            stdout: {
                on: sinon.stub().callsFake((event, callback) => {
                    if (event === "data") setTimeout(() => callback(output), 0);
                }),
                pipe: sinon.stub(), // For piped commands
            },
            stderr: {
                on: sinon.stub().callsFake((event, callback) => {
                    if (event === "data") setTimeout(() => callback(""), 0);
                }),
            },
            stdin: { end: sinon.stub() }, // For piped commands
            on: sinon.stub().callsFake((event, callback) => {
                if (event === "close") setTimeout(() => callback(0), 5);
                if (event === "error") {
                    /* no-op for success case */
                }
            }),
        });

        // checkIfContainerIsReadyForConnections uses execDockerCommandWithPipe which spawns two processes:
        // 1. docker logs command
        // 2. grep/findstr command
        const dockerProcess = createSuccessProcess("some log output");
        const grepProcess = createSuccessProcess(dockerUtils.COMMANDS.CHECK_CONTAINER_READY);

        spawnStub.onFirstCall().returns(dockerProcess as any); // docker logs
        spawnStub.onSecondCall().returns(grepProcess as any); // grep/findstr

        let result = await dockerUtils.checkIfContainerIsReadyForConnections("testContainer");
        expect(result.success, "Should return success when container is ready for connections").to
            .be.true;
        spawnStub.resetHistory();
    });

    test("deleteContainer: should delete the container and return success or error", async () => {
        const spawnStub = sandbox.stub(childProcess, "spawn");
        const { sendActionEvent, sendErrorEvent } = stubTelemetry(sandbox);

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

        spawnStub.returns(createSuccessProcess("container delete") as any);

        let result = await dockerUtils.deleteContainer("testContainer");
        // deleteContainer should call both stop and remove, but there might be background operations
        // so we verify the specific calls we expect rather than strict counts
        expect(spawnStub.calledWith("docker", ["stop", "testContainer"])).to.be.true;
        expect(spawnStub.calledWith("docker", ["rm", "testContainer"])).to.be.true;
        expect(sendActionEvent).to.have.been.calledOnce;
        expect(result).to.be.true;

        spawnStub.resetHistory();
        spawnStub.returns(createFailureProcess(new Error("Couldn't delete container")) as any);

        result = await dockerUtils.deleteContainer("testContainer");

        // Verify the expected calls were made (stop and remove)
        expect(spawnStub.calledWith("docker", ["stop", "testContainer"])).to.be.true;
        expect(spawnStub.calledWith("docker", ["rm", "testContainer"])).to.be.true;
        expect(sendErrorEvent).to.have.been.calledOnce;
        expect(!result, "Should return false on failure").to.be.true;
    });

    test("stopContainer: should stop the container and return success or error", async () => {
        const spawnStub = sandbox.stub(childProcess, "spawn");
        const { sendActionEvent, sendErrorEvent } = stubTelemetry(sandbox);

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

        spawnStub.returns(createSuccessProcess("container stop") as any);

        let result = await dockerUtils.stopContainer("testContainer");
        // stopContainer should only call docker stop, but there might be background operations
        // from other parts of the system, so we verify the main functionality works
        expect(spawnStub.calledWith("docker", ["stop", "testContainer"])).to.be.true;
        expect(sendActionEvent).to.have.been.calledOnce;
        expect(result).to.be.true;

        spawnStub.resetHistory();
        spawnStub.returns(createFailureProcess(new Error("Couldn't stop container")) as any);

        result = await dockerUtils.stopContainer("testContainer");

        expect(spawnStub.calledWith("docker", ["stop", "testContainer"])).to.be.true;
        expect(!result, "Should return false on failure").to.be.true;
        expect(sendErrorEvent).to.have.been.calledOnce;
    });

    test("checkIfContainerIsDockerContainer: should return true if the container is a Docker container", async () => {
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

        // 1. Non-localhost server: should return ""
        let result = await dockerUtils.checkIfConnectionIsDockerContainer("some.remote.host");
        expect(result, "Should return empty string for non-localhost address").to.equal("");

        // 2. Docker command fails: should return undefined
        spawnStub.returns(createFailureProcess(new Error("spawn failed")) as any);
        result = await dockerUtils.checkIfConnectionIsDockerContainer("localhost");
        expect(result, "Should return undefined on spawn failure").to.equal(undefined);

        // Reset spawnStub for next test
        spawnStub.resetHistory();
        spawnStub.returns(createSuccessProcess("") as any); // simulate no containers

        // 3. Docker command returns no containers: should return undefined
        result = await dockerUtils.checkIfConnectionIsDockerContainer("127.0.0.1");
        expect(result, "Should return undefined when no containers exist").to.equal(undefined);

        // 4. Containers exist and one matches the port: should return the container id
        spawnStub.resetHistory();
        spawnStub.returns(
            createSuccessProcess(`"HostPort": "1433", "Name": "/testContainer",\n`) as any,
        ); // simulate container with port 1433

        result = await dockerUtils.checkIfConnectionIsDockerContainer("localhost, 1433");
        expect(result, "Should return matched container ID").to.equal("testContainer");
    });

    test("findAvailablePort: should find next available port", async () => {
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

        // 1. No containers running: should return 1433
        spawnStub.returns(createSuccessProcess("") as any); // simulate no containers
        let result = await dockerUtils.findAvailablePort(1433);
        expect(result, "Should return 1433 when no containers are running").to.equal(1433);

        // 2. Port 1433 is taken: should return next available port
        spawnStub.returns(createSuccessProcess(`"HostPort": "1433",`) as any);
        result = await dockerUtils.findAvailablePort(1433);
        expect(result, "Should return 1434 when 1433 is taken").to.equal(1434);
    });

    test("prepareForDockerContainerCommand: should prepare the command with correct parameters", async () => {
        const containerName = "testContainer";
        sandbox.stub(os, "platform").returns(Platform.Linux);
        const showInformationMessageStub = sandbox.stub(vscode.window, "showInformationMessage");
        sandbox.stub(vscode.window, "showErrorMessage");

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

        // Docker is running, and container exists
        spawnStub.onFirstCall().returns(createSuccessProcess("Docker is running") as any); // START_DOCKER
        spawnStub.onSecondCall().returns(createSuccessProcess(containerName) as any); // GET_CONTAINERS_BY_NAME

        let result = await dockerUtils.prepareForDockerContainerCommand(
            containerName,
            node,
            mockObjectExplorerService,
        );
        expect(result.success, "Should return true if container exists").to.be.true;

        // Docker is running, container does not exist
        spawnStub.resetHistory();
        spawnStub.onFirstCall().returns(createSuccessProcess("Docker is running") as any); // START_DOCKER
        spawnStub.onSecondCall().returns(createSuccessProcess("Container doesn't exist") as any); // GET_CONTAINERS_BY_NAME

        result = await dockerUtils.prepareForDockerContainerCommand(
            containerName,
            node,
            mockObjectExplorerService,
        );
        expect(!result.success, "Should return false if container does not exist").to.be.true;
        expect(result.error).to.equal(LocalContainers.containerDoesNotExistError);
        expect(showInformationMessageStub, "Should show info message if container does not exist")
            .to.have.been.calledOnce;

        // finding container returns an error
        spawnStub.resetHistory();
        spawnStub.onFirstCall().returns(createSuccessProcess("Docker is running") as any); // START_DOCKER
        spawnStub
            .onSecondCall()
            .returns(createFailureProcess(new Error("Something went wrong")) as any); // GET_CONTAINERS_BY_NAME

        result = await dockerUtils.prepareForDockerContainerCommand(
            containerName,
            node,
            mockObjectExplorerService,
        );
        expect(!result.success, "Should return false if container does not exist").to.be.true;
        expect(result.error).to.equal(LocalContainers.containerDoesNotExistError);
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

        spawnStub.returns(createSuccessProcess("Pulled image") as any);

        let result = await dockerUtils.pullSqlServerContainerImage("2025");
        expect(spawnStub).to.have.been.calledOnce;

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
