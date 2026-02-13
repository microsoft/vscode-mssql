/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import * as os from "os";
import * as sqlServerContainer from "../../src/deployment/sqlServerContainer";
import { LocalContainers } from "../../src/constants/locConstants";
import * as childProcess from "child_process";
import { Platform } from "../../src/constants/constants";
import { stubTelemetry } from "./utils";
import { ConnectionNode } from "../../src/objectExplorer/nodes/connectionNode";
import { ObjectExplorerService } from "../../src/objectExplorer/objectExplorerService";
import * as dockerodeClient from "../../src/docker/dockerodeClient";
import { PassThrough } from "stream";

chai.use(sinonChai);

suite("SQL Server Container", () => {
    let sandbox: sinon.SinonSandbox;
    let node: ConnectionNode;
    let mockObjectExplorerService: ObjectExplorerService;

    const createDockerClientMock = (
        overrides: Partial<{
            listContainers: sinon.SinonStub;
            createContainer: sinon.SinonStub;
            pull: sinon.SinonStub;
            getContainer: sinon.SinonStub;
            followProgress: sinon.SinonStub;
            demuxStream: sinon.SinonStub;
        }> = {},
    ) => ({
        listContainers: overrides.listContainers ?? sandbox.stub().resolves([]),
        createContainer: overrides.createContainer ?? sandbox.stub(),
        pull: overrides.pull ?? sandbox.stub(),
        getContainer: overrides.getContainer ?? sandbox.stub(),
        modem: {
            followProgress: overrides.followProgress ?? sandbox.stub(),
            demuxStream:
                overrides.demuxStream ??
                sandbox
                    .stub()
                    .callsFake(
                        (
                            _stream: NodeJS.ReadableStream,
                            stdout: NodeJS.WritableStream,
                            _stderr: NodeJS.WritableStream,
                        ) => {
                            const output = stdout as PassThrough;
                            queueMicrotask(() => output.end());
                        },
                    ),
        },
    });

    type SpawnProcessOptions = {
        stdoutOutput?: string;
        stderrOutput?: string;
        closeCode?: number;
        emitError?: Error;
        includePipe?: boolean;
        includeStdin?: boolean;
        dataDelayMs?: number;
        closeDelayMs?: number;
    };

    const createSpawnProcess = (options: SpawnProcessOptions = {}) => {
        const {
            stdoutOutput = "",
            stderrOutput = "",
            closeCode,
            emitError,
            includePipe = false,
            includeStdin = false,
            dataDelayMs = 0,
            closeDelayMs = 5,
        } = options;

        const stdout = {
            on: sinon.stub().callsFake((event, callback) => {
                if (event === "data") {
                    setTimeout(() => callback(stdoutOutput), dataDelayMs);
                }
            }),
            ...(includePipe ? { pipe: sinon.stub() } : {}),
        };

        const stderr = {
            on: sinon.stub().callsFake((event, callback) => {
                if (event === "data") {
                    setTimeout(() => callback(stderrOutput), dataDelayMs);
                }
            }),
        };

        return {
            stdout,
            stderr,
            ...(includeStdin ? { stdin: { end: sinon.stub() } } : {}),
            on: sinon.stub().callsFake((event, callback) => {
                if (event === "close" && closeCode !== undefined) {
                    setTimeout(() => callback(closeCode), closeDelayMs);
                }
                if (event === "error" && emitError) {
                    setTimeout(() => callback(emitError), dataDelayMs);
                }
            }),
        } as any;
    };

    const createSpawnSuccessProcess = (
        stdoutOutput: string = "",
        options: Omit<SpawnProcessOptions, "stdoutOutput" | "closeCode" | "emitError"> = {},
    ) => createSpawnProcess({ stdoutOutput, closeCode: 0, ...options });

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
        const steps = sqlServerContainer.initializeDockerSteps();

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

    test("validateSqlServerPassword: should validate password complexity and length", () => {
        // Too short
        const shortResult = sqlServerContainer.validateSqlServerPassword("<0>");
        expect(shortResult, "Should return length error").to.equal(
            LocalContainers.passwordLengthError,
        );

        // Too long
        const longResult = sqlServerContainer.validateSqlServerPassword("<0>".repeat(129));
        expect(longResult, "Should return length error").to.equal(
            LocalContainers.passwordLengthError,
        );

        // Valid length but not enough complexity (only lowercase)
        const lowComplexityResult = sqlServerContainer.validateSqlServerPassword("<placeholder>");
        expect(lowComplexityResult, "Should return complexity error").to.equal(
            LocalContainers.passwordComplexityError,
        );

        // Valid: meets 3 categories (uppercase, lowercase, number)
        const result1 = sqlServerContainer.validateSqlServerPassword("Placeholder1");
        expect(result1, "Should return empty string for valid password").to.equal("");

        // Valid: meets 4 categories (uppercase, lowercase, number, special char)
        const result2 = sqlServerContainer.validateSqlServerPassword("<Placeholder1>");
        expect(result2, "Should return empty string for valid password").to.equal("");

        // Only 2 categories (lowercase and digit)
        const invalidCategoryResult = sqlServerContainer.validateSqlServerPassword("<hidden>");
        expect(invalidCategoryResult, "Should return complexity error").to.equal(
            LocalContainers.passwordComplexityError,
        );
    });

    test("startSqlServerDockerContainer: success and failure cases", async () => {
        const containerName = "testContainer";
        const version = "2019";
        const hostname = "localhost";
        const port = 1433;
        const startStub = sandbox.stub().resolves();
        const createContainerStub = sandbox.stub().resolves({ start: startStub });
        const dockerClientMock = createDockerClientMock({
            createContainer: createContainerStub,
        });
        sandbox.stub(dockerodeClient, "getDockerodeClient").returns(dockerClientMock as any);

        const resultSuccess = await sqlServerContainer.startSqlServerDockerContainer(
            containerName,
            "Xf9!uDq7@LmB2#cV",
            version,
            hostname,
            port,
        );

        expect(createContainerStub).to.have.been.calledOnce;
        expect(startStub).to.have.been.calledOnce;
        expect(resultSuccess).to.deep.equal({
            success: true,
            port,
        });

        // Failure case: spawn returns failing process
        createContainerStub.resetHistory();
        createContainerStub.rejects(new Error(LocalContainers.startSqlServerContainerError));

        const resultFailure = await sqlServerContainer.startSqlServerDockerContainer(
            containerName,
            "Xf9!uDq7@LmB2#cV",
            version,
            hostname,
            port,
        );

        expect(createContainerStub).to.have.been.calledOnce;
        expect(resultFailure.success).to.equal(false);
        expect(resultFailure.error).to.equal(LocalContainers.startSqlServerContainerError);
        expect(resultFailure.fullErrorText).to.equal(LocalContainers.startSqlServerContainerError);
        expect(resultFailure.port).to.equal(undefined);
    });

    test("restartContainer: should restart the container and return success or error", async () => {
        // Stub platform and dependent modules
        sandbox.stub(os, "platform").returns(Platform.Linux);
        const spawnStub = sandbox.stub(childProcess, "spawn");
        // Stub telemetry method
        const { sendActionEvent } = stubTelemetry(sandbox);
        const containerName = "testContainer";

        const listContainersStub = sandbox.stub();
        const inspectStub = sandbox.stub();
        const startStub = sandbox.stub().resolves();
        const logsStub = sandbox.stub();

        const rawLogsStream = new PassThrough();
        logsStub.resolves(rawLogsStream);
        const containerStub = {
            inspect: inspectStub,
            start: startStub,
            logs: logsStub,
        };
        const getContainerStub = sandbox.stub().returns(containerStub);

        const demuxStreamStub = sandbox
            .stub()
            .callsFake(
                (
                    _stream: NodeJS.ReadableStream,
                    stdout: NodeJS.WritableStream,
                    _stderr: NodeJS.WritableStream,
                ) => {
                    const output = stdout as PassThrough;
                    queueMicrotask(() => {
                        output.write("Recovery is ");
                        output.end("complete");
                    });
                },
            );

        const dockerClientMock = createDockerClientMock({
            listContainers: listContainersStub,
            getContainer: getContainerStub,
            demuxStream: demuxStreamStub,
        });
        sandbox.stub(dockerodeClient, "getDockerodeClient").returns(dockerClientMock as any);

        spawnStub.callsFake((command: string, args?: ReadonlyArray<string>) => {
            if (command === "docker" && args?.[0] === "info") {
                return createSpawnSuccessProcess("Docker is running");
            }

            return createSpawnSuccessProcess("");
        });

        // Case 1: Container is already running, should return success
        listContainersStub
            .onCall(0)
            .resolves([{ Id: "container-id", Names: [`/${containerName}`] }]); // checkContainerExists
        listContainersStub
            .onCall(1)
            .resolves([{ Id: "container-id", Names: [`/${containerName}`] }]); // isDockerContainerRunning
        inspectStub.onFirstCall().resolves({ State: { Running: true } });

        let result = await sqlServerContainer.restartContainer(
            containerName,
            node,
            mockObjectExplorerService,
        );
        expect(result, "Should return success when container is already running").to.be.true;
        listContainersStub.resetHistory();
        inspectStub.resetHistory();

        // Case 2: Container is not running, should restart, send telemetry, and return success
        listContainersStub
            .onCall(0)
            .resolves([{ Id: "container-id", Names: [`/${containerName}`] }]); // checkContainerExists
        listContainersStub
            .onCall(1)
            .resolves([{ Id: "container-id", Names: [`/${containerName}`] }]); // isDockerContainerRunning
        listContainersStub
            .onCall(2)
            .resolves([{ Id: "container-id", Names: [`/${containerName}`] }]); // restart
        listContainersStub
            .onCall(3)
            .resolves([{ Id: "container-id", Names: [`/${containerName}`] }]); // readiness
        inspectStub.onFirstCall().resolves({ State: { Running: false } });

        result = await sqlServerContainer.restartContainer(
            containerName,
            node,
            mockObjectExplorerService,
        );
        expect(result, "Should return success when container is restarted successfully").to.be.true;
        expect(sendActionEvent).to.have.been.calledThrice;
        expect(startStub).to.have.been.calledOnce;
        expect(logsStub).to.have.been.calledOnce;
    });

    test("checkIfContainerIsReadyForConnections: should return true if container is ready, false otherwise", async () => {
        const rawLogsStream = new PassThrough();
        const logsStub = sandbox.stub().resolves(rawLogsStream);
        const listContainersStub = sandbox.stub().resolves([{ Id: "container-id" }]);
        const getContainerStub = sandbox.stub().returns({
            logs: logsStub,
        });
        const demuxStreamStub = sandbox
            .stub()
            .callsFake(
                (
                    _stream: NodeJS.ReadableStream,
                    stdout: NodeJS.WritableStream,
                    _stderr: NodeJS.WritableStream,
                ) => {
                    const output = stdout as PassThrough;
                    queueMicrotask(() => {
                        output.write("Recovery is ");
                        output.end("complete");
                    });
                },
            );

        const dockerClientMock = createDockerClientMock({
            listContainers: listContainersStub,
            getContainer: getContainerStub,
            demuxStream: demuxStreamStub,
        });
        sandbox.stub(dockerodeClient, "getDockerodeClient").returns(dockerClientMock as any);

        let result =
            await sqlServerContainer.checkIfContainerIsReadyForConnections("testContainer");
        expect(result.success, "Should return success when container is ready for connections").to
            .be.true;
        expect(logsStub).to.have.been.calledOnce;
    });

    test("pullSqlServerContainerImage: should pull the container image from the docker registry", async () => {
        const followProgressStub = sandbox
            .stub()
            .callsFake(
                (
                    _stream: NodeJS.ReadableStream,
                    callback: (error: Error | null, result: unknown[]) => void,
                ) => callback(null, []),
            );
        const pullStub = sandbox.stub().resolves(new PassThrough());
        const dockerClientMock = createDockerClientMock({
            pull: pullStub,
            followProgress: followProgressStub,
        });
        sandbox.stub(dockerodeClient, "getDockerodeClient").returns(dockerClientMock as any);

        let result = await sqlServerContainer.pullSqlServerContainerImage("2025");
        expect(pullStub).to.have.been.calledOnce;

        expect(result.success).to.be.true;
    });
});
