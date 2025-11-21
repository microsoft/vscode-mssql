/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
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

    assert.strictEqual(steps.length, 7, "Should return 7 steps");

    assert.strictEqual(
      steps[0].headerText,
      LocalContainers.dockerInstallHeader,
    );
    assert.strictEqual(steps[0].bodyText, LocalContainers.dockerInstallBody);
    assert.strictEqual(
      steps[0].errorLink,
      "https://www.docker.com/products/docker-desktop/",
    );
    assert.strictEqual(steps[0].errorLinkText, LocalContainers.installDocker);
    assert.strictEqual(
      typeof steps[0].stepAction,
      "function",
      "stepAction should be a function",
    );

    assert.strictEqual(steps[1].headerText, LocalContainers.startDockerHeader);
    assert.strictEqual(steps[1].bodyText, LocalContainers.startDockerBody);
    assert.strictEqual(typeof steps[1].stepAction, "function");

    assert.strictEqual(
      steps[2].headerText,
      LocalContainers.startDockerEngineHeader,
    );
    assert.strictEqual(
      steps[2].bodyText,
      LocalContainers.startDockerEngineBody,
    );
    assert.strictEqual(typeof steps[2].stepAction, "function");

    assert.strictEqual(steps[3].headerText, LocalContainers.pullImageHeader);
    assert.strictEqual(steps[3].bodyText, LocalContainers.pullImageBody);
    assert.deepStrictEqual(steps[3].argNames, ["version"]);
    assert.strictEqual(typeof steps[3].stepAction, "function");

    assert.strictEqual(
      steps[4].headerText,
      LocalContainers.creatingContainerHeader,
    );
    assert.strictEqual(
      steps[4].bodyText,
      LocalContainers.creatingContainerBody,
    );
    assert.deepStrictEqual(steps[4].argNames, [
      "containerName",
      "password",
      "version",
      "hostname",
      "port",
    ]);
    assert.strictEqual(typeof steps[4].stepAction, "function");

    assert.strictEqual(
      steps[5].headerText,
      LocalContainers.settingUpContainerHeader,
    );
    assert.strictEqual(
      steps[5].bodyText,
      LocalContainers.settingUpContainerBody,
    );
    assert.deepStrictEqual(steps[5].argNames, ["containerName"]);
    assert.strictEqual(typeof steps[5].stepAction, "function");

    assert.strictEqual(
      steps[6].headerText,
      LocalContainers.connectingToContainerHeader,
    );
    assert.strictEqual(
      steps[6].bodyText,
      LocalContainers.connectingToContainerBody,
    );
    assert.strictEqual(steps[6].stepAction, undefined);
  });

  test("sanitizeErrorText: should truncate long error messages and sanitize SA_PASSWORD", () => {
    // Test sanitization
    const errorWithPassword =
      "Connection failed: SA_PASSWORD={testtesttest} something broke";
    const sanitized = dockerUtils.sanitizeErrorText(errorWithPassword);
    assert.ok(
      sanitized.includes("SA_PASSWORD=******"),
      "SA_PASSWORD value should be masked",
    );
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
      LocalContainers.passwordLengthError,
      "Should return length error",
    );

    // Too long
    const longResult = dockerUtils.validateSqlServerPassword("<0>".repeat(129));
    assert.strictEqual(
      longResult,
      LocalContainers.passwordLengthError,
      "Should return length error",
    );

    // Valid length but not enough complexity (only lowercase)
    const lowComplexityResult =
      dockerUtils.validateSqlServerPassword("<placeholder>");
    assert.strictEqual(
      lowComplexityResult,
      LocalContainers.passwordComplexityError,
      "Should return complexity error",
    );

    // Valid: meets 3 categories (uppercase, lowercase, number)
    const result1 = dockerUtils.validateSqlServerPassword("Placeholder1");
    assert.strictEqual(
      result1,
      "",
      "Should return empty string for valid password",
    );

    // Valid: meets 4 categories (uppercase, lowercase, number, special char)
    const result2 = dockerUtils.validateSqlServerPassword("<Placeholder1>");
    assert.strictEqual(
      result2,
      "",
      "Should return empty string for valid password",
    );

    // Only 2 categories (lowercase and digit)
    const invalidCategoryResult =
      dockerUtils.validateSqlServerPassword("<hidden>");
    assert.strictEqual(
      invalidCategoryResult,
      LocalContainers.passwordComplexityError,
      "Should return complexity error",
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
    assert.ok(result.success, "Should return success when Docker is installed");
    assert.strictEqual(result.error, undefined);
    assert.strictEqual(result.fullErrorText, undefined);

    sinon.assert.calledOnce(spawnStub);
    sinon.assert.calledWith(spawnStub, "docker", ["--version"]);
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
    assert.ok(
      !result.success,
      "Should return failure when Docker is not installed",
    );
    assert.strictEqual(result.error, LocalContainers.dockerInstallError);
    assert.strictEqual(result.fullErrorText, "Docker is not installed");

    sinon.assert.calledOnce(spawnStub);
    sinon.assert.calledWith(spawnStub, "docker", ["--version"]);
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
    assert.strictEqual(result.error, undefined);
    assert.ok(result.success);
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
    spawnStub
      .onSecondCall()
      .returns(createSuccessProcess(Platform.Windows) as any);
    spawnStub.onThirdCall().returns(createSuccessProcess("") as any);

    const result = await dockerUtils.checkEngine();
    assert.ok(result.success);
    sinon.assert.calledThrice(spawnStub);
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
    spawnStub
      .onSecondCall()
      .returns(createSuccessProcess(Platform.Windows) as any);

    const result = await dockerUtils.checkEngine();
    assert.ok(!result.success);
    assert.strictEqual(
      result.fullErrorText,
      LocalContainers.switchToLinuxContainersCanceled,
    );
  });

  test("checkEngine: should fail on unsupported architecture", async () => {
    const platformStub = sandbox.stub(os, "platform");
    const archStub = sandbox.stub(os, "arch");

    platformStub.returns(Platform.Windows);
    archStub.returns("arm");

    const result = await dockerUtils.checkEngine();
    assert.ok(!result.success);
    assert.strictEqual(
      result.error,
      LocalContainers.unsupportedDockerArchitectureError("arm"),
    );
  });

  test("checkEngine: should fail on unsupported platform", async () => {
    const platformStub = sandbox.stub(os, "platform");
    const archStub = sandbox.stub(os, "arch");

    platformStub.returns("fakePlatform" as Platform);
    archStub.returns("x64");

    const result = await dockerUtils.checkEngine();
    assert.ok(!result.success);
    assert.strictEqual(
      result.error,
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
    assert.ok(!result.success);
    assert.strictEqual(result.fullErrorText, "Permission denied");
    assert.strictEqual(
      result.error,
      LocalContainers.linuxDockerPermissionsError,
    );
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
        if (event === "error")
          setTimeout(() => callback(new Error(errorMsg)), 0);
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
    assert.ok(!result.success);
    assert.strictEqual(result.fullErrorText, "Rosetta not Enabled");
    assert.strictEqual(result.error, LocalContainers.rosettaError);
  });

  test("checkEngine: should succeed on Intel Mac without Rosetta check", async () => {
    const platformStub = sandbox.stub(os, "platform");
    const archStub = sandbox.stub(os, "arch");

    platformStub.returns(Platform.Mac);
    archStub.returns("x64");

    const result = await dockerUtils.checkEngine();
    assert.ok(result.success);
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
      createSuccessProcess(
        `${defaultContainerName}\n${defaultContainerName}_1`,
      ) as any,
    );
    let result = await dockerUtils.validateContainerName("");
    assert.strictEqual(result, `${defaultContainerName}_2`);
    spawnStub.resetHistory();

    // 2. Valid name, not taken => return as-is
    spawnStub.returns(createSuccessProcess("existing_one\nused") as any);
    result = await dockerUtils.validateContainerName("new_valid");
    assert.strictEqual(result, "new_valid");
    spawnStub.resetHistory();

    // 3. Invalid name (regex fails) => return empty string
    spawnStub.returns(createSuccessProcess("") as any);
    result = await dockerUtils.validateContainerName("!invalid*name");
    assert.strictEqual(result, "");
    spawnStub.resetHistory();

    // 4. Valid name, but already taken => return empty string
    spawnStub.returns(createSuccessProcess("taken_name") as any);
    result = await dockerUtils.validateContainerName("taken_name");
    assert.strictEqual(result, "");
    spawnStub.resetHistory();

    // 5. Command throws error => return input unchanged
    spawnStub.returns(createFailureProcess(new Error("failure")) as any);
    result = await dockerUtils.validateContainerName("fallback_name");
    assert.strictEqual(result, "fallback_name");
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
    assert.strictEqual(
      result1,
      expectedValidResult,
      "Should return the constructed Docker path",
    );

    // Case 2: Invalid Docker path structure
    const invalidPath = path.join("C:", "No", "Docker", "Here", "docker.exe");
    spawnStub.onCall(1).returns(createSuccessProcess(invalidPath) as any);

    const result2 = await dockerUtils.getDockerPath(executable);
    assert.strictEqual(
      result2,
      "",
      "Should return empty string for invalid path structure",
    );

    // Case 3: execCommand throws error
    spawnStub
      .onCall(2)
      .returns(createFailureProcess(new Error("Command failed")) as any);

    const result3 = await dockerUtils.getDockerPath(executable);
    assert.strictEqual(
      result3,
      "",
      "Should return empty string when command fails",
    );

    sinon.assert.calledThrice(spawnStub);
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

    sinon.assert.calledOnce(spawnStub);
    assert.deepEqual(resultSuccess, {
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

    sinon.assert.calledOnce(spawnStub);
    assert.strictEqual(resultFailure.success, false);
    assert.strictEqual(
      resultFailure.error,
      LocalContainers.startSqlServerContainerError,
    );
    assert.strictEqual(
      resultFailure.fullErrorText,
      LocalContainers.startSqlServerContainerError,
    );
    assert.strictEqual(resultFailure.port, undefined);
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
    assert.strictEqual(result, true);

    // Case 2: container not running — returns something else
    spawnStub.onCall(1).returns(createSuccessProcess("something else") as any);

    result = await dockerUtils.isDockerContainerRunning(containerName);
    assert.strictEqual(result, false);

    // Case 3: spawn throws error
    spawnStub
      .onCall(2)
      .returns(createFailureProcess(new Error("spawn error")) as any);

    result = await dockerUtils.isDockerContainerRunning(containerName);
    assert.strictEqual(result, false);

    sinon.assert.callCount(spawnStub, 3);
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
    assert.ok(
      result.success,
      "Docker is already running, should be successful",
    );
    sinon.assert.calledOnce(spawnStub);
    sinon.assert.calledWith(spawnStub, "docker", ["info"]);
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
    spawnStub
      .onThirdCall()
      .returns(createSuccessProcess("Started Docker") as any); // START_DOCKER (execDockerCommand)
    // For the polling loop that checks if Docker started - make it succeed immediately
    spawnStub.onCall(3).returns(createSuccessProcess("Docker Running") as any); // First CHECK_DOCKER_RUNNING in polling loop

    const result = await dockerUtils.startDocker();
    assert.equal(result.error, undefined);
    assert.ok(result.success, "Docker should start successfully on Windows");
    assert.strictEqual(spawnStub.callCount, 4);
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
    spawnStub
      .onSecondCall()
      .returns(createSuccessProcess("Started Docker") as any); // START_DOCKER (execDockerCommand)
    // For the polling loop that checks if Docker started - make it succeed immediately
    spawnStub.onCall(2).returns(createSuccessProcess("Docker Running") as any); // First CHECK_DOCKER_RUNNING in polling loop

    const result = await dockerUtils.startDocker();
    assert.ok(result.success, "Docker should start successfully on Linux");
    assert.strictEqual(spawnStub.callCount, 3);
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
    assert.ok(!result.success, "Should not succeed on unsupported platform");
    assert.strictEqual(
      result.error,
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
    assert.ok(!result.success, "Should fail if Docker is not installed");
    assert.strictEqual(result.error, LocalContainers.dockerDesktopPathError);
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
    spawnStub
      .onFirstCall()
      .returns(createSuccessProcess("Docker is running") as any); // START_DOCKER
    spawnStub
      .onSecondCall()
      .returns(createSuccessProcess(containerName) as any); // GET_CONTAINERS_BY_NAME
    spawnStub
      .onThirdCall()
      .returns(createSuccessProcess("testContainer") as any); // CHECK_CONTAINER_RUNNING

    let result = await dockerUtils.restartContainer(
      containerName,
      node,
      mockObjectExplorerService,
    );
    assert.ok(
      result,
      "Should return success when container is already running",
    );
    spawnStub.resetHistory();

    // Case 2: Container is not running, should restart, send telemetry, and return success
    spawnStub
      .onFirstCall()
      .returns(createSuccessProcess("Docker is running") as any); // START_DOCKER
    spawnStub
      .onSecondCall()
      .returns(createSuccessProcess(containerName) as any); // GET_CONTAINERS_BY_NAME
    spawnStub
      .onThirdCall()
      .returns(createFailureProcess(new Error("Container not running")) as any); // CHECK_CONTAINER_RUNNING
    spawnStub
      .onCall(3)
      .returns(createSuccessProcess("Container restarted") as any); // START_CONTAINER
    // checkIfContainerIsReadyForConnections uses execDockerCommandWithPipe which needs 2 processes:
    spawnStub.onCall(4).returns(createSuccessProcess("some logs") as any); // docker logs
    spawnStub
      .onCall(5)
      .returns(
        createSuccessProcess(dockerUtils.COMMANDS.CHECK_CONTAINER_READY) as any,
      ); // grep/findstr

    result = await dockerUtils.restartContainer(
      containerName,
      node,
      mockObjectExplorerService,
    );
    assert.ok(
      result,
      "Should return success when container is restarted successfully",
    );
    sinon.assert.calledThrice(sendActionEvent);
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
    const grepProcess = createSuccessProcess(
      dockerUtils.COMMANDS.CHECK_CONTAINER_READY,
    );

    spawnStub.onFirstCall().returns(dockerProcess as any); // docker logs
    spawnStub.onSecondCall().returns(grepProcess as any); // grep/findstr

    let result =
      await dockerUtils.checkIfContainerIsReadyForConnections("testContainer");
    assert.ok(
      result.success,
      "Should return success when container is ready for connections",
    );
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
    assert.ok(spawnStub.calledWith("docker", ["stop", "testContainer"]));
    assert.ok(spawnStub.calledWith("docker", ["rm", "testContainer"]));
    sinon.assert.calledOnce(sendActionEvent);
    assert.ok(result);

    spawnStub.resetHistory();
    spawnStub.returns(
      createFailureProcess(new Error("Couldn't delete container")) as any,
    );

    result = await dockerUtils.deleteContainer("testContainer");

    // Verify the expected calls were made (stop and remove)
    assert.ok(spawnStub.calledWith("docker", ["stop", "testContainer"]));
    assert.ok(spawnStub.calledWith("docker", ["rm", "testContainer"]));
    sinon.assert.calledOnce(sendErrorEvent);
    assert.ok(!result, "Should return false on failure");
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
    assert.ok(spawnStub.calledWith("docker", ["stop", "testContainer"]));
    sinon.assert.calledOnce(sendActionEvent);
    assert.ok(result);

    spawnStub.resetHistory();
    spawnStub.returns(
      createFailureProcess(new Error("Couldn't stop container")) as any,
    );

    result = await dockerUtils.stopContainer("testContainer");

    assert.ok(spawnStub.calledWith("docker", ["stop", "testContainer"]));
    assert.ok(!result, "Should return false on failure");
    sinon.assert.calledOnce(sendErrorEvent);
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
    let result =
      await dockerUtils.checkIfConnectionIsDockerContainer("some.remote.host");
    assert.strictEqual(
      result,
      "",
      "Should return empty string for non-localhost address",
    );

    // 2. Docker command fails: should return undefined
    spawnStub.returns(createFailureProcess(new Error("spawn failed")) as any);
    result = await dockerUtils.checkIfConnectionIsDockerContainer("localhost");
    assert.strictEqual(
      result,
      undefined,
      "Should return undefined on spawn failure",
    );

    // Reset spawnStub for next test
    spawnStub.resetHistory();
    spawnStub.returns(createSuccessProcess("") as any); // simulate no containers

    // 3. Docker command returns no containers: should return undefined
    result = await dockerUtils.checkIfConnectionIsDockerContainer("127.0.0.1");
    assert.strictEqual(
      result,
      undefined,
      "Should return undefined when no containers exist",
    );

    // 4. Containers exist and one matches the port: should return the container id
    spawnStub.resetHistory();
    spawnStub.returns(
      createSuccessProcess(
        `"HostPort": "1433", "Name": "/testContainer",\n`,
      ) as any,
    ); // simulate container with port 1433

    result =
      await dockerUtils.checkIfConnectionIsDockerContainer("localhost, 1433");
    assert.strictEqual(
      result,
      "testContainer",
      "Should return matched container ID",
    );
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
    assert.strictEqual(
      result,
      1433,
      "Should return 1433 when no containers are running",
    );

    // 2. Port 1433 is taken: should return next available port
    spawnStub.returns(createSuccessProcess(`"HostPort": "1433",`) as any);
    result = await dockerUtils.findAvailablePort(1433);
    assert.strictEqual(result, 1434, "Should return 1434 when 1433 is taken");
  });

  test("prepareForDockerContainerCommand: should prepare the command with correct parameters", async () => {
    const containerName = "testContainer";
    sandbox.stub(os, "platform").returns(Platform.Linux);
    const showInformationMessageStub = sandbox.stub(
      vscode.window,
      "showInformationMessage",
    );
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
    spawnStub
      .onFirstCall()
      .returns(createSuccessProcess("Docker is running") as any); // START_DOCKER
    spawnStub
      .onSecondCall()
      .returns(createSuccessProcess(containerName) as any); // GET_CONTAINERS_BY_NAME

    let result = await dockerUtils.prepareForDockerContainerCommand(
      containerName,
      node,
      mockObjectExplorerService,
    );
    assert.ok(result.success, "Should return true if container exists");

    // Docker is running, container does not exist
    spawnStub.resetHistory();
    spawnStub
      .onFirstCall()
      .returns(createSuccessProcess("Docker is running") as any); // START_DOCKER
    spawnStub
      .onSecondCall()
      .returns(createSuccessProcess("Container doesn't exist") as any); // GET_CONTAINERS_BY_NAME

    result = await dockerUtils.prepareForDockerContainerCommand(
      containerName,
      node,
      mockObjectExplorerService,
    );
    assert.ok(
      !result.success,
      "Should return false if container does not exist",
    );
    assert.strictEqual(
      result.error,
      LocalContainers.containerDoesNotExistError,
    );
    assert.strictEqual(
      showInformationMessageStub.callCount,
      1,
      "Should show info message if container does not exist",
    );

    // finding container returns an error
    spawnStub.resetHistory();
    spawnStub
      .onFirstCall()
      .returns(createSuccessProcess("Docker is running") as any); // START_DOCKER
    spawnStub
      .onSecondCall()
      .returns(createFailureProcess(new Error("Something went wrong")) as any); // GET_CONTAINERS_BY_NAME

    result = await dockerUtils.prepareForDockerContainerCommand(
      containerName,
      node,
      mockObjectExplorerService,
    );
    assert.ok(
      !result.success,
      "Should return false if container does not exist",
    );
    assert.strictEqual(
      result.error,
      LocalContainers.containerDoesNotExistError,
    );
  });

  test("sanitizeContainerInput: should properly sanitize container input", () => {
    // Test with valid input
    let result = dockerUtils.sanitizeContainerInput("valid-container");
    assert.strictEqual(
      result,
      "valid-container",
      "Valid name should remain unchanged",
    );

    // Test with alphanumeric and allowed special characters
    result = dockerUtils.sanitizeContainerInput("test_container.1-2");
    assert.strictEqual(
      result,
      "test_container.1-2",
      "Name with allowed special chars should remain unchanged",
    );

    // Test with disallowed special characters
    result = dockerUtils.sanitizeContainerInput("test@container!");
    assert.strictEqual(
      result,
      "testcontainer",
      "Disallowed special chars should be removed",
    );

    // Test with SQL injection attempt
    result = dockerUtils.sanitizeContainerInput(
      "container';DROP TABLE users;--",
    );
    assert.strictEqual(
      result,
      "containerDROPTABLEusers--",
      "SQL injection chars should be removed",
    );

    // Test with command injection attempt
    result = dockerUtils.sanitizeContainerInput('container" && echo Injected');
    assert.strictEqual(
      result,
      "containerechoInjected",
      "Command injection chars should be removed",
    );

    // Test with command injection attempt
    result = dockerUtils.sanitizeContainerInput('container"; rm -rf /');
    assert.strictEqual(
      result,
      "containerrm-rf",
      "Command injection chars should be removed",
    );

    // Test with empty string
    result = dockerUtils.sanitizeContainerInput("");
    assert.strictEqual(result, "", "Empty string should remain empty");

    // Test with only disallowed characters
    result = dockerUtils.sanitizeContainerInput("@#$%^&*()");
    assert.strictEqual(
      result,
      "",
      "String with only disallowed chars should become empty",
    );

    // Test with command injection attempts
    const sanitizedInjection = dockerUtils.sanitizeContainerInput(
      'container"; rm -rf / #',
    );
    assert.strictEqual(
      sanitizedInjection,
      "containerrm-rf",
      "Command injection characters should be removed",
    );

    // Test with invalid characters (should be removed)
    const sanitizedInvalid = dockerUtils.sanitizeContainerInput(
      "my container/with\\invalid:chars",
    );
    assert.strictEqual(
      sanitizedInvalid,
      "mycontainerwithinvalidchars",
      "Invalid characters should be removed",
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
    sinon.assert.calledOnce(spawnStub);

    assert.ok(result);
  });

  test("getEngineErrorLink and getEngineErrorLinkText: should return correct error link and text", () => {
    const platformStub = sandbox.stub(os, "platform");
    const archStub = sandbox.stub(os, "arch");

    // 1. Windows platform, x64 architecture
    platformStub.returns(Platform.Windows);
    archStub.returns("x64");

    let errorLink = dockerUtils.getEngineErrorLink();
    let errorLinkText = dockerUtils.getEngineErrorLinkText();
    assert.strictEqual(
      errorLink,
      dockerUtils.windowsContainersErrorLink,
      "Error link should match",
    );
    assert.strictEqual(
      errorLinkText,
      LocalContainers.configureLinuxContainers,
      "Error link text should match",
    );
    platformStub.resetBehavior();
    archStub.resetBehavior();

    // 2. Mac platform, non x64 architecture
    platformStub.returns(Platform.Mac);
    archStub.returns("arm64");

    errorLink = dockerUtils.getEngineErrorLink();
    errorLinkText = dockerUtils.getEngineErrorLinkText();
    assert.strictEqual(
      errorLink,
      dockerUtils.rosettaErrorLink,
      "Error link should match",
    );
    assert.strictEqual(
      errorLinkText,
      LocalContainers.configureRosetta,
      "Error link text should match",
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
