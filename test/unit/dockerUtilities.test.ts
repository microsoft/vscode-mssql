/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as os from "os";
import * as dockerUtils from "../../src/containerDeployment/dockerUtils";
import { ContainerDeployment } from "../../src/constants/locConstants";
import * as childProcess from "child_process";
import { defaultContainerName, Platform } from "../../src/constants/constants";
import * as path from "path";
import { stubTelemetry } from "./utils";

suite("Docker Utilities", () => {
    let sandbox: sinon.SinonSandbox;

    setup(async () => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("initializeDockerSteps: should return correct Docker deployment steps", async () => {
        const steps = dockerUtils.initializeDockerSteps();

        assert.strictEqual(steps.length, 6, "Should return 6 steps");

        assert.strictEqual(steps[0].headerText, ContainerDeployment.dockerInstallHeader);
        assert.strictEqual(steps[0].bodyText, ContainerDeployment.dockerInstallBody);
        assert.strictEqual(steps[0].errorLink, "https://docs.docker.com/engine/install/");
        assert.strictEqual(steps[0].errorLinkText, ContainerDeployment.installDocker);
        assert.strictEqual(
            typeof steps[0].stepAction,
            "function",
            "stepAction should be a function",
        );

        assert.strictEqual(steps[1].headerText, ContainerDeployment.startDockerHeader);
        assert.strictEqual(steps[1].bodyText, ContainerDeployment.startDockerBody);
        assert.strictEqual(typeof steps[1].stepAction, "function");

        assert.strictEqual(steps[2].headerText, ContainerDeployment.startDockerEngineHeader);
        assert.strictEqual(steps[2].bodyText, ContainerDeployment.startDockerEngineBody);
        assert.strictEqual(typeof steps[2].stepAction, "function");

        assert.strictEqual(steps[3].headerText, ContainerDeployment.creatingContainerHeader);
        assert.strictEqual(steps[3].bodyText, ContainerDeployment.creatingContainerBody);
        assert.deepStrictEqual(steps[3].argNames, [
            "containerName",
            "password",
            "version",
            "hostname",
            "port",
        ]);
        assert.strictEqual(typeof steps[3].stepAction, "function");

        assert.strictEqual(steps[4].headerText, ContainerDeployment.settingUpContainerHeader);
        assert.strictEqual(steps[4].bodyText, ContainerDeployment.settingUpContainerBody);
        assert.deepStrictEqual(steps[4].argNames, ["containerName"]);
        assert.strictEqual(typeof steps[4].stepAction, "function");

        assert.strictEqual(steps[5].headerText, ContainerDeployment.connectingToContainerHeader);
        assert.strictEqual(steps[5].bodyText, ContainerDeployment.connectingToContainerBody);
        assert.strictEqual(steps[5].stepAction, undefined);
    });
    test("sanitizeErrorText: should truncate long error messages and sanitize SA_PASSWORD", () => {
        // Test sanitization
        const errorWithPassword = "Connection failed: SA_PASSWORD={testtesttest} something broke";
        const sanitized = dockerUtils.sanitizeErrorText(errorWithPassword);
        assert.ok(sanitized.includes("SA_PASSWORD=******"), "SA_PASSWORD value should be masked");
        assert.ok(
            !sanitized.includes("testtesttest"),
            "Original password should not appear in sanitized output",
        );
    });

    test("validateSqlServerPassword: should validate password complexity and length", () => {
        // Too short
        const shortResult = dockerUtils.validateSqlServerPassword("<0>");
        assert.strictEqual(
            shortResult,
            ContainerDeployment.passwordLengthError,
            "Should return length error",
        );

        // Too long
        const longResult = dockerUtils.validateSqlServerPassword("<0>".repeat(129));
        assert.strictEqual(
            longResult,
            ContainerDeployment.passwordLengthError,
            "Should return length error",
        );

        // Valid length but not enough complexity (only lowercase)
        const lowComplexityResult = dockerUtils.validateSqlServerPassword("<placeholder>");
        assert.strictEqual(
            lowComplexityResult,
            ContainerDeployment.passwordComplexityError,
            "Should return complexity error",
        );

        // Valid: meets 3 categories (uppercase, lowercase, number)
        const result1 = dockerUtils.validateSqlServerPassword("Placeholder1");
        assert.strictEqual(result1, "", "Should return empty string for valid password");

        // Valid: meets 4 categories (uppercase, lowercase, number, special char)
        const result2 = dockerUtils.validateSqlServerPassword("<Placeholder1>");
        assert.strictEqual(result2, "", "Should return empty string for valid password");

        // Only 2 categories (lowercase and digit)
        const invalidCategoryResult = dockerUtils.validateSqlServerPassword("<hidden>");
        assert.strictEqual(
            invalidCategoryResult,
            ContainerDeployment.passwordComplexityError,
            "Should return complexity error",
        );
    });

    test("checkDockerInstallation: should check Docker installation and return correct status", async () => {
        const execStub = sandbox
            .stub(childProcess, "exec")
            .yields(undefined, "Docker is installed");

        let result = await dockerUtils.checkDockerInstallation();
        sinon.assert.calledOnce(execStub);
        assert.ok(result.success);
        assert.strictEqual(result.error, undefined);
        assert.strictEqual(result.fullErrorText, undefined);

        execStub.restore();

        const execErrorStub = sandbox
            .stub(childProcess, "exec")
            .yields(new Error("Docker is not installed"), undefined);

        result = await dockerUtils.checkDockerInstallation();

        sinon.assert.calledOnce(execErrorStub);
        assert.ok(!result.success);
        assert.strictEqual(result.error, ContainerDeployment.dockerInstallError);
        assert.strictEqual(result.fullErrorText, "Docker is not installed");

        execErrorStub.restore();
    });

    test("checkEngine: combined test covering multiple scenarios", async () => {
        // Stub platform and dependent modules
        const platformStub = sandbox.stub(os, "platform");
        const archStub = sandbox.stub(os, "arch");
        const execStub = sandbox.stub(childProcess, "exec");
        const messageStub = sandbox.stub(vscode.window, "showInformationMessage");
        archStub.returns("x64");

        // 1. Linux - success path
        platformStub.returns(Platform.Linux);
        execStub.resetBehavior();
        execStub.yields(null, `'${Platform.Linux}'`);

        let result = await dockerUtils.checkEngine();
        assert.strictEqual(result.error, undefined, "This should not have an error");
        assert.ok(result.success, "Linux platform should return success");

        // 2. Windows - engine needs switching, user confirms
        platformStub.returns(Platform.Windows);
        execStub.resetHistory();
        execStub.onFirstCall().yields(null, "dockerPath"); // GET_DOCKER_PATH
        execStub.onFirstCall().yields(null, `'windows'`); // CHECK_ENGINE
        execStub.onSecondCall().yields(null, ""); // SWITCH_ENGINE
        messageStub.resolves("Yes" as any);

        result = await dockerUtils.checkEngine();
        assert.ok(result.success, "Windows with confirmation should switch engine and succeed");
        sinon.assert.calledThrice(execStub);

        // 3. Windows - engine needs switching, user cancels
        execStub.resetHistory();
        execStub.onFirstCall().yields(null, `'${Platform.Windows}'`);
        messageStub.resolves(undefined); // User cancels

        result = await dockerUtils.checkEngine();
        assert.ok(!result.success, "User cancels engine switch");
        assert.strictEqual(
            result.fullErrorText,
            ContainerDeployment.switchToLinuxContainersCanceled,
        );

        // 4. Windows- arm architecture, should gracefully error
        archStub.returns("arm");
        result = await dockerUtils.checkEngine();
        assert.ok(!result.success, "Should fail on unsupported architecture");
        assert.strictEqual(
            result.error,
            ContainerDeployment.unsupportedDockerArchitectureError("arm"),
        );

        // 5. Unsupported platform
        archStub.returns("x64");
        platformStub.returns("fakePlatform" as Platform); // Fake unsupported platform

        result = await dockerUtils.checkEngine();
        assert.ok(!result.success);
        assert.strictEqual(
            result.error,
            ContainerDeployment.unsupportedDockerPlatformError("fakePlatform"),
        );

        // 6. Command fails on Linux (e.g., permissions error)
        platformStub.returns(Platform.Linux);
        execStub.resetBehavior();
        execStub.yields(new Error("Permission denied"), undefined);

        result = await dockerUtils.checkEngine();
        assert.ok(!result.success);
        assert.strictEqual(result.fullErrorText, "Permission denied");
        assert.strictEqual(result.error, ContainerDeployment.linuxDockerPermissionsError);

        // 7. Command fails on Mac (e.g., permissions error)
        platformStub.returns(Platform.Mac);
        archStub.returns("arm");
        execStub.resetBehavior();
        execStub.yields(new Error("Rosetta not Enabled"), undefined);

        result = await dockerUtils.checkEngine();
        assert.ok(!result.success);
        assert.strictEqual(result.fullErrorText, "Rosetta not Enabled");
        assert.strictEqual(result.error, ContainerDeployment.rosettaError);

        // 8. Intel Mac, command succeeds
        archStub.returns("x64");
        execStub.resetBehavior();
        result = await dockerUtils.checkEngine();
        assert.ok(result.success);
    });

    test("validateContainerName: handles various input scenarios", async () => {
        // Stub for: existing containers include default and default_1
        const execStub = sandbox.stub(childProcess, "exec");

        // 1. Empty name => generate defaultContainerName_2
        execStub.yields(null, `${defaultContainerName}\n${defaultContainerName}_1`);
        let result = await dockerUtils.validateContainerName("");
        assert.strictEqual(result, `${defaultContainerName}_2`);
        execStub.resetHistory();

        // 2. Valid name, not taken => return as-is
        execStub.yields(null, "existing_one\nused");
        result = await dockerUtils.validateContainerName("new_valid");
        assert.strictEqual(result, "new_valid");
        execStub.resetHistory();

        // 3. Invalid name (regex fails) => return empty string
        execStub.yields(null, "");
        result = await dockerUtils.validateContainerName("!invalid*name");
        assert.strictEqual(result, "");
        execStub.resetHistory();

        // 4. Valid name, but already taken => return empty string
        execStub.yields(null, "taken_name");
        result = await dockerUtils.validateContainerName("taken_name");
        assert.strictEqual(result, "");
        execStub.resetHistory();

        // 5. Command throws error => return input unchanged
        execStub.yields(new Error("failure"), null);
        result = await dockerUtils.validateContainerName("fallback_name");
        assert.strictEqual(result, "fallback_name");
    });

    test("getDockerPath: handles success, invalid path, and failure cases", async () => {
        const executable = "DockerCli.exe";

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
        const execStub = sandbox.stub(childProcess, "exec");
        execStub.onCall(0).yields(null, validPath);

        const expectedValidResult = path.join(
            "C:",
            "Program Files",
            "Docker",
            "Docker",
            executable,
        );
        const result1 = await dockerUtils.getDockerPath(executable);
        assert.strictEqual(
            result1,
            expectedValidResult,
            "Should return the constructed Docker path",
        );

        // Case 2: Invalid Docker path structure
        const invalidPath = path.join("C:", "No", "Docker", "Here", "docker.exe");
        execStub.onCall(1).yields(null, invalidPath);

        const result2 = await dockerUtils.getDockerPath(executable);
        assert.strictEqual(result2, "", "Should return empty string for invalid path structure");

        // Case 3: execCommand throws error
        execStub.onCall(2).yields(new Error("Command failed"), null);

        const result3 = await dockerUtils.getDockerPath(executable);
        assert.strictEqual(result3, "", "Should return empty string when command fails");

        sinon.assert.calledThrice(execStub);
    });

    test("startSqlServerDockerContainer: success and failure cases", async () => {
        const containerName = "testContainer";
        const version = "2019";
        const hostname = "localhost";
        const port = 1433;

        const execStub = sandbox.stub(childProcess, "exec");

        // Success case: exec yields (null error, stdout)
        execStub.onCall(0).yields(null, "some output");

        const resultSuccess = await dockerUtils.startSqlServerDockerContainer(
            containerName,
            "Xf9!uDq7@LmB2#cV",
            version,
            hostname,
            port,
        );

        sinon.assert.calledOnce(execStub);
        assert.deepEqual(resultSuccess, {
            success: true,
            port,
        });

        execStub.resetHistory();

        // Failure case: exec yields (error, null stdout)
        execStub
            .onCall(0)
            .yields(new Error(ContainerDeployment.startSqlServerContainerError), null);

        const resultFailure = await dockerUtils.startSqlServerDockerContainer(
            containerName,
            "Xf9!uDq7@LmB2#cV",
            version,
            hostname,
            port,
        );

        sinon.assert.calledOnce(execStub);
        assert.strictEqual(resultFailure.success, false);
        assert.strictEqual(resultFailure.error, ContainerDeployment.startSqlServerContainerError);
        assert.strictEqual(
            resultFailure.fullErrorText,
            ContainerDeployment.startSqlServerContainerError,
        );
        assert.strictEqual(resultFailure.port, undefined);
    });

    test("isDockerContainerRunning: should return true if container is running, false otherwise", async () => {
        const containerName = "my-container";
        const execStub = sandbox.stub(childProcess, "exec");

        // Case 1: container running — yields (null error, stdout = containerName)
        execStub.onCall(0).yields(null, containerName);

        let result = await dockerUtils.isDockerContainerRunning(containerName);
        assert.strictEqual(result, true);

        // Case 2: container not running — yields (null error, stdout = something else)
        execStub.onCall(1).yields(null, "something else");

        result = await dockerUtils.isDockerContainerRunning(containerName);
        assert.strictEqual(result, false);

        // Case 3: exec throws error — yields (error, null)
        execStub.onCall(2).yields(new Error("exec error"), null);

        result = await dockerUtils.isDockerContainerRunning(containerName);
        assert.strictEqual(result, false);

        sinon.assert.callCount(execStub, 3);
    });

    test("startDocker: tests both success and failure cases", async () => {
        // Stub platform and dependent modules
        const platformStub = sandbox.stub(os, "platform");
        const execStub = sandbox.stub(childProcess, "exec");

        // Docker is already started
        execStub.resetBehavior();
        execStub.yields(null, "Docker is running");

        let result = await dockerUtils.startDocker();
        assert.ok(result.success, "Docker is already running, should be successful");

        // 2. Windows platform, docker is not running
        platformStub.returns(Platform.Windows);
        execStub.resetHistory();
        execStub.onFirstCall().yields(new Error("Docker not running"), null); // CHECK_DOCKER_RUNNING
        execStub.onFirstCall().yields(null, "dockerPath"); // GET_DOCKER_PATH
        execStub.onSecondCall().yields(null, "Started Docker"); // START_DOCKER
        execStub.onThirdCall().yields(new Error("Docker not running"), null); // CHECK_DOCKER_RUNNING
        execStub.onCall(4).yields(null, "Docker Running"); // CHECK_DOCKER_RUNNING

        result = await dockerUtils.startDocker();
        assert.ok(result.success, "Docker should start successfully on Windows");
        execStub.resetBehavior();
        platformStub.resetBehavior();

        // 3. Linux platform, docker is not running
        platformStub.returns(Platform.Linux);
        execStub.resetHistory();
        execStub.onFirstCall().yields(new Error("Docker not running"), null); // CHECK_DOCKER_RUNNING
        execStub.onSecondCall().yields(null, "Started Docker"); // START_DOCKER
        execStub.onThirdCall().yields(new Error("Docker not running"), null); // CHECK_DOCKER_RUNNING
        execStub.onCall(4).yields(null, "Docker Running"); // CHECK_DOCKER_RUNNING

        result = await dockerUtils.startDocker();
        assert.ok(result.success, "Docker should start successfully on Linux");
        execStub.resetBehavior();
        platformStub.resetBehavior();

        // 4. Try to start Docker on unsupported platform
        platformStub.returns("fakePlatform" as Platform); // Fake unsupported platform
        execStub.resetHistory();
        execStub.onFirstCall().yields(new Error("Docker not running"), null); // CHECK_DOCKER_RUNNING
        result = await dockerUtils.startDocker();
        assert.ok(!result.success, "Should not succeed on unsupported platform");
        assert.strictEqual(
            result.error,
            ContainerDeployment.unsupportedDockerPlatformError("fakePlatform"),
        );
        execStub.resetBehavior();
        platformStub.resetBehavior();

        // 5. Windows platform, docker not installed
        platformStub.returns(Platform.Windows);
        execStub.resetHistory();
        execStub.onFirstCall().yields(new Error("Docker not running"), null); // CHECK_DOCKER_RUNNING
        execStub.onSecondCall().yields(new Error("Docker not installed"), null); // GET_DOCKER_PATH
        result = await dockerUtils.startDocker();
        assert.ok(!result.success, "Should fail if Docker is not installed");
        assert.strictEqual(result.error, ContainerDeployment.dockerDesktopPathError);
        execStub.resetBehavior();
        platformStub.resetBehavior();
    });

    test("restartContainer: should restart the container and return success or error", async () => {
        // Stub platform and dependent modules
        sandbox.stub(os, "platform").returns(Platform.Linux);
        const execStub = sandbox.stub(childProcess, "exec");
        // Stub telemetry method
        const { sendActionEvent } = stubTelemetry(sandbox);

        // Case 1: Container is already running, should return success
        execStub.onFirstCall().yields(null, "testContainer"); // CHECK_CONTAINER_RUNNING
        let result = await dockerUtils.restartContainer("testContainer");
        assert.ok(result, "Should return success when container is already running");
        execStub.resetHistory();

        // Case 2: Container is not running, should restart, send telemetry, and return success
        execStub.onFirstCall().yields(new Error("Container not running"), null); // CHECK_CONTAINER_RUNNING
        execStub.onSecondCall().yields(null, "Container restarted"); // START_CONTAINER
        execStub.onThirdCall().yields(null, dockerUtils.COMMANDS.CHECK_CONTAINER_READY); // START_CONTAINER
        result = await dockerUtils.restartContainer("testContainer");
        assert.ok(result, "Should return success when container is restarted successfully");
        sinon.assert.calledTwice(sendActionEvent);
        execStub.resetHistory();
    });

    test("checkIfContainerIsReadyForConnections: should return true if container is ready, false otherwise", async () => {
        // Stub platform and dependent modules
        const execStub = sandbox.stub(childProcess, "exec");
        execStub.onFirstCall().yields(null, dockerUtils.COMMANDS.CHECK_CONTAINER_READY); // START_CONTAINER
        let result = await dockerUtils.checkIfContainerIsReadyForConnections("testContainer");
        assert.ok(result, "Should return success when container is ready for connections");
        execStub.resetHistory();
    });

    test("deleteContainer: should delete the container and return success or error", async () => {
        const execStub = sandbox.stub(childProcess, "exec").yields(undefined, "container delete");
        const { sendActionEvent, sendErrorEvent } = stubTelemetry(sandbox);

        let result = await dockerUtils.deleteContainer("testContainer");
        sinon.assert.calledOnce(execStub);
        sinon.assert.calledOnce(sendActionEvent);

        assert.ok(result);

        execStub.restore();

        const execErrorStub = sandbox
            .stub(childProcess, "exec")
            .yields(new Error("Couldn't delete container"), undefined);

        result = await dockerUtils.deleteContainer("testContainer");

        sinon.assert.calledOnce(execErrorStub);
        sinon.assert.calledOnce(sendErrorEvent);

        assert.ok(!result, "Should return false on failure");

        execErrorStub.restore();
    });

    test("stopContainer: should stop the container and return success or error", async () => {
        const execStub = sandbox.stub(childProcess, "exec").yields(undefined, "container stop");
        const { sendActionEvent, sendErrorEvent } = stubTelemetry(sandbox);

        let result = await dockerUtils.stopContainer("testContainer");
        sinon.assert.calledOnce(execStub);
        sinon.assert.calledOnce(sendActionEvent);

        assert.ok(result);

        execStub.restore();

        const execErrorStub = sandbox
            .stub(childProcess, "exec")
            .yields(new Error("Couldn't stop container"), undefined);

        result = await dockerUtils.stopContainer("testContainer");

        sinon.assert.calledOnce(execErrorStub);

        assert.ok(!result, "Should return false on failure");
        sinon.assert.calledOnce(sendErrorEvent);

        execErrorStub.restore();
    });

    test("checkIfContainerIsDockerContainer: should return true if the container is a Docker container", async () => {
        const execStub = sandbox.stub(childProcess, "exec");
        // 1. Non-localhost server: should return ""
        let result = await dockerUtils.checkIfConnectionIsDockerContainer("some.remote.host");
        assert.strictEqual(result, "", "Should return empty string for non-localhost address");

        // 2. Docker command fails: should return undefined
        execStub.yields(new Error("exec failed"), null);
        result = await dockerUtils.checkIfConnectionIsDockerContainer("localhost");
        assert.strictEqual(result, undefined, "Should return undefined on exec failure");

        // Reset execStub for next test
        execStub.resetBehavior();
        execStub.yields(null, ""); // simulate no containers

        // 3. Docker command returns no containers: should return undefined
        result = await dockerUtils.checkIfConnectionIsDockerContainer("127.0.0.1");
        assert.strictEqual(result, undefined, "Should return undefined when no containers exist");

        // 4. Containers exist and one matches the port: should return the container id
        execStub.resetBehavior();
        execStub.yields(null, `"HostPort": "1433", "Name": "/testContainer",\n`); // simulate container with port 1433

        result = await dockerUtils.checkIfConnectionIsDockerContainer("localhost, 1433");
        assert.strictEqual(result, "testContainer", "Should return matched container ID");

        execStub.resetBehavior();
    });

    test("findAvailablePort: should find next available port", async () => {
        const execStub = sandbox.stub(childProcess, "exec");
        // 1. No containers running: should return 1433
        execStub.yields(null, ""); // simulate no containers
        let result = await dockerUtils.findAvailablePort(1433);
        assert.strictEqual(result, 1433, "Should return 1433 when no containers are running");

        // 2. Port 1433 is taken: should return next available port
        execStub.yields(null, `"HostPort": "1433",`);
        result = await dockerUtils.findAvailablePort(1433);
        assert.strictEqual(result, 1434, "Should return 1434 when 1433 is taken");

        execStub.resetBehavior();
    });

    test("prepareForDockerContainerCommand: should prepare the command with correct parameters", async () => {
        const containerName = "testContainer";
        sandbox.stub(os, "platform").returns(Platform.Linux);
        const execStub = sandbox.stub(childProcess, "exec");

        // Docker is running, and container exists
        execStub.onFirstCall().yields(null, "Docker is running"); // START_DOCKER
        execStub.onSecondCall().yields(null, containerName); // GET_CONTAINERS_BY_NAME

        let result = await dockerUtils.prepareForDockerContainerCommand(containerName);
        assert.ok(result.success, "Should return true if container exists");

        // Docker is running, container does not exist
        execStub.resetBehavior();
        execStub.resetHistory();

        execStub.onFirstCall().yields(null, "Docker is running"); // START_DOCKER
        execStub.onSecondCall().yields(null, "Container doesn't exist"); // GET_CONTAINERS_BY_NAME

        result = await dockerUtils.prepareForDockerContainerCommand(containerName);
        assert.ok(!result.success, "Should return false if container does not exist");
        assert.strictEqual(result.error, ContainerDeployment.containerDoesNotExistError);

        // finding container returns an error
        execStub.resetBehavior();
        execStub.resetHistory();
        execStub.onFirstCall().yields(null, "Docker is running"); // START_DOCKER
        execStub.onSecondCall().yields(new Error("Something went wrong"), null); // GET_CONTAINERS_BY_NAME

        result = await dockerUtils.prepareForDockerContainerCommand(containerName);
        assert.ok(!result.success, "Should return false if container does not exist");
        assert.strictEqual(result.error, ContainerDeployment.containerDoesNotExistError);
        execStub.resetBehavior();
    });

    test("sanitizeContainerName: should properly sanitize container names", () => {
        // Test with valid input
        let result = dockerUtils.sanitizeContainerName("valid-container");
        assert.strictEqual(result, "valid-container", "Valid name should remain unchanged");

        // Test with alphanumeric and allowed special characters
        result = dockerUtils.sanitizeContainerName("test_container.1-2");
        assert.strictEqual(
            result,
            "test_container.1-2",
            "Name with allowed special chars should remain unchanged",
        );

        // Test with disallowed special characters
        result = dockerUtils.sanitizeContainerName("test@container!");
        assert.strictEqual(result, "testcontainer", "Disallowed special chars should be removed");

        // Test with SQL injection attempt
        result = dockerUtils.sanitizeContainerName("container';DROP TABLE users;--");
        assert.strictEqual(
            result,
            "containerDROPTABLEusers--",
            "SQL injection chars should be removed",
        );

        // Test with command injection attempt
        result = dockerUtils.sanitizeContainerName('container" && echo Injected');
        assert.strictEqual(
            result,
            "containerechoInjected",
            "Command injection chars should be removed",
        );

        // Test with empty string
        result = dockerUtils.sanitizeContainerName("");
        assert.strictEqual(result, "", "Empty string should remain empty");

        // Test with only disallowed characters
        result = dockerUtils.sanitizeContainerName("@#$%^&*()");
        assert.strictEqual(result, "", "String with only disallowed chars should become empty");

        // Test with command injection attempts
        const sanitizedInjection = dockerUtils.sanitizeContainerName('container"; rm -rf / #');
        assert.strictEqual(
            sanitizedInjection,
            "containerrm-rf",
            "Command injection characters should be removed",
        );

        // Test with invalid characters (should be removed)
        const sanitizedInvalid = dockerUtils.sanitizeContainerName(
            "my container/with\\invalid:chars",
        );
        assert.strictEqual(
            sanitizedInvalid,
            "mycontainerwithinvalidchars",
            "Invalid characters should be removed",
        );
    });
});
