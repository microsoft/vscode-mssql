/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import * as os from "os";
import * as dabContainer from "../../../src/dab/dabContainer";
import * as dockerodeClient from "../../../src/docker/dockerodeClient";
import { PassThrough } from "stream";
import * as fs from "fs";
import * as path from "path";

chai.use(sinonChai);

suite("DAB Container", () => {
    let sandbox: sinon.SinonSandbox;

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

    setup(async () => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("pullDabContainerImage: should pull the DAB container image from the docker registry", async () => {
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

        const result = await dabContainer.pullDabContainerImage();
        expect(pullStub).to.have.been.calledOnce;
        expect(result.success).to.be.true;

        // Verify platform is passed to pull for cross-platform compatibility (DAB only publishes linux/amd64)
        const pullArgs = pullStub.firstCall.args;
        expect(pullArgs[1]).to.deep.equal({ platform: "linux/amd64" });
    });

    test("pullDabContainerImage: should return error when pull fails", async () => {
        const pullStub = sandbox.stub().rejects(new Error("Network error"));
        const dockerClientMock = createDockerClientMock({
            pull: pullStub,
        });
        sandbox.stub(dockerodeClient, "getDockerodeClient").returns(dockerClientMock as any);

        const result = await dabContainer.pullDabContainerImage();
        expect(result.success).to.be.false;
        expect(result.error).to.include("Failed to pull DAB container image");
        expect(result.fullErrorText).to.include("Network error");
    });

    test("startDabDockerContainer: should start a DAB container successfully", async () => {
        const startStub = sandbox.stub().resolves();
        // putArchive must consume the stream before resolving to avoid ENOENT errors
        // when the temp file is cleaned up before tar finishes reading
        const putArchiveStub = sandbox.stub().callsFake((stream: NodeJS.ReadableStream) => {
            return new Promise<void>((resolve) => {
                stream.on("end", resolve);
                stream.on("error", resolve);
                stream.resume(); // Consume the stream
            });
        });
        const createContainerStub = sandbox.stub().resolves({
            start: startStub,
            putArchive: putArchiveStub,
        });
        const dockerClientMock = createDockerClientMock({
            createContainer: createContainerStub,
        });
        sandbox.stub(dockerodeClient, "getDockerodeClient").returns(dockerClientMock as any);

        // Create a real temp file since tar.create is non-configurable and can't be stubbed
        const { configFilePath, tempDir } = createTempFile();

        try {
            const result = await dabContainer.startDabDockerContainer(
                "test-dab-container",
                5000,
                configFilePath,
            );

            expect(createContainerStub).to.have.been.calledOnce;
            expect(putArchiveStub).to.have.been.calledOnce;
            expect(startStub).to.have.been.calledOnce;
            expect(result.success).to.be.true;
            expect(result.port).to.equal(5000);

            // Verify the container creation options
            const createOptions = createContainerStub.firstCall.args[0];
            expect(createOptions.name).to.equal("test-dab-container");
            expect(createOptions.Cmd).to.deep.equal(["--ConfigFileName", "/App/dab-config.json"]);
        } finally {
            // Cleanup temp files
            fs.unlinkSync(configFilePath);
            fs.rmdirSync(tempDir);
        }
    });

    test("startDabDockerContainer: should return error when container creation fails", async () => {
        const createContainerStub = sandbox.stub().rejects(new Error("Container creation failed"));
        const dockerClientMock = createDockerClientMock({
            createContainer: createContainerStub,
        });
        sandbox.stub(dockerodeClient, "getDockerodeClient").returns(dockerClientMock as any);

        // Create a real temp file since tar.create is non-configurable and can't be stubbed
        const { configFilePath, tempDir } = createTempFile();

        try {
            const result = await dabContainer.startDabDockerContainer(
                "test-dab-container",
                5000,
                configFilePath,
            );

            expect(result.success).to.be.false;
            expect(result.error).to.include("Failed to start DAB container");
            expect(result.fullErrorText).to.include("Container creation failed");
        } finally {
            // Cleanup temp files
            fs.unlinkSync(configFilePath);
            fs.rmdirSync(tempDir);
        }
    });

    test("checkIfDabContainerIsReady: should return success when container responds", async () => {
        // Mock fetch to return successful response
        const originalFetch = global.fetch;
        global.fetch = sandbox.stub().resolves({
            status: 200,
        } as Response);

        const result = await dabContainer.checkIfDabContainerIsReady("test-dab-container", 5000);

        expect(result.success).to.be.true;
        expect(result.port).to.equal(5000);

        // Restore original fetch
        global.fetch = originalFetch;
    });

    test("checkIfDabContainerIsReady: should handle various HTTP status codes", async () => {
        // Mock fetch to return 404 (which is still considered "running")
        const originalFetch = global.fetch;
        global.fetch = sandbox.stub().resolves({
            status: 404,
        } as Response);

        const result = await dabContainer.checkIfDabContainerIsReady("test-dab-container", 5000);

        expect(result.success).to.be.true;

        // Restore original fetch
        global.fetch = originalFetch;
    });

    test("stopAndRemoveDabContainer: should stop and remove a DAB container successfully", async () => {
        const stopStub = sandbox.stub().resolves();
        const removeStub = sandbox.stub().resolves();
        const listContainersStub = sandbox.stub().resolves([{ Id: "container-id" }]);
        const dockerClientMock = createDockerClientMock({
            listContainers: listContainersStub,
            getContainer: sandbox.stub().returns({
                stop: stopStub,
                remove: removeStub,
            }),
        });
        sandbox.stub(dockerodeClient, "getDockerodeClient").returns(dockerClientMock as any);

        const result = await dabContainer.stopAndRemoveDabContainer("test-dab-container");

        expect(stopStub).to.have.been.calledOnce;
        expect(removeStub).to.have.been.calledOnce;
        expect(result.success).to.be.true;
    });

    test("stopAndRemoveDabContainer: should return success if container does not exist", async () => {
        const listContainersStub = sandbox.stub().resolves([]);
        const dockerClientMock = createDockerClientMock({
            listContainers: listContainersStub,
        });
        sandbox.stub(dockerodeClient, "getDockerodeClient").returns(dockerClientMock as any);

        const result = await dabContainer.stopAndRemoveDabContainer("nonexistent-container");

        expect(result.success).to.be.true;
    });

    test("stopAndRemoveDabContainer: should handle already stopped container", async () => {
        const stopStub = sandbox.stub().rejects(new Error("Container already stopped"));
        const removeStub = sandbox.stub().resolves();
        const listContainersStub = sandbox.stub().resolves([{ Id: "container-id" }]);
        const dockerClientMock = createDockerClientMock({
            listContainers: listContainersStub,
            getContainer: sandbox.stub().returns({
                stop: stopStub,
                remove: removeStub,
            }),
        });
        sandbox.stub(dockerodeClient, "getDockerodeClient").returns(dockerClientMock as any);

        const result = await dabContainer.stopAndRemoveDabContainer("test-dab-container");

        // Should succeed even if stop fails (container already stopped)
        expect(removeStub).to.have.been.calledOnce;
        expect(result.success).to.be.true;
    });

    test("stopAndRemoveDabContainer: should return error when remove fails", async () => {
        const stopStub = sandbox.stub().resolves();
        const removeStub = sandbox.stub().rejects(new Error("Remove failed"));
        const listContainersStub = sandbox.stub().resolves([{ Id: "container-id" }]);
        const dockerClientMock = createDockerClientMock({
            listContainers: listContainersStub,
            getContainer: sandbox.stub().returns({
                stop: stopStub,
                remove: removeStub,
            }),
        });
        sandbox.stub(dockerodeClient, "getDockerodeClient").returns(dockerClientMock as any);

        const result = await dabContainer.stopAndRemoveDabContainer("test-dab-container");

        expect(result.success).to.be.false;
        expect(result.error).to.include("Failed to stop and remove DAB container");
    });

    test("validateDabContainerName: should use DAB default container name", async () => {
        const listContainersStub = sandbox.stub();
        const dockerClientMock = createDockerClientMock({
            listContainers: listContainersStub,
        });
        sandbox.stub(dockerodeClient, "getDockerodeClient").returns(dockerClientMock as any);

        // When dab-container already exists, should generate dab-container_2
        listContainersStub.resolves([{ Names: ["/dab-container"] }]);
        const result = await dabContainer.validateDabContainerName("");
        expect(result).to.equal("dab-container_2");
    });

    test("validateDabContainerName: should return valid name when not taken", async () => {
        const listContainersStub = sandbox.stub();
        const dockerClientMock = createDockerClientMock({
            listContainers: listContainersStub,
        });
        sandbox.stub(dockerodeClient, "getDockerodeClient").returns(dockerClientMock as any);

        listContainersStub.resolves([]);
        const result = await dabContainer.validateDabContainerName("my-dab-api");
        expect(result).to.equal("my-dab-api");
    });

    test("validateDabContainerName: should return empty string for invalid name", async () => {
        const listContainersStub = sandbox.stub();
        const dockerClientMock = createDockerClientMock({
            listContainers: listContainersStub,
        });
        sandbox.stub(dockerodeClient, "getDockerodeClient").returns(dockerClientMock as any);

        listContainersStub.resolves([]);
        const result = await dabContainer.validateDabContainerName("!invalid@name");
        expect(result).to.equal("");
    });

    test("findAvailableDabPort: should return default DAB port when available", async () => {
        const listContainersStub = sandbox.stub();
        const dockerClientMock = createDockerClientMock({
            listContainers: listContainersStub,
        });
        sandbox.stub(dockerodeClient, "getDockerodeClient").returns(dockerClientMock as any);

        listContainersStub.resolves([]);
        const result = await dabContainer.findAvailableDabPort();
        expect(result).to.equal(5000); // Dab.DAB_DEFAULT_PORT
    });

    test("findAvailableDabPort: should find next available port when default is taken", async () => {
        const listContainersStub = sandbox.stub();
        const inspectStub = sandbox.stub();
        const dockerClientMock = createDockerClientMock({
            listContainers: listContainersStub,
            getContainer: sandbox.stub().returns({
                inspect: inspectStub,
            }),
        });
        sandbox.stub(dockerodeClient, "getDockerodeClient").returns(dockerClientMock as any);

        listContainersStub.resolves([{ Id: "container-id" }]);
        inspectStub.resolves({
            NetworkSettings: {
                Ports: {
                    "5000/tcp": null,
                },
            },
            HostConfig: {
                PortBindings: {
                    "5000/tcp": [{ HostPort: "5000" }],
                },
            },
        });

        const result = await dabContainer.findAvailableDabPort();
        expect(result).to.equal(5001);
    });

    test("findAvailableDabPort: should accept custom preferred port", async () => {
        const listContainersStub = sandbox.stub();
        const dockerClientMock = createDockerClientMock({
            listContainers: listContainersStub,
        });
        sandbox.stub(dockerodeClient, "getDockerodeClient").returns(dockerClientMock as any);

        listContainersStub.resolves([]);
        const result = await dabContainer.findAvailableDabPort(8080);
        expect(result).to.equal(8080);
    });
});

function createTempFile() {
    const tempDir = path.join(os.tmpdir(), `dab-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const configFilePath = path.join(tempDir, "dab-config.json");
    fs.writeFileSync(configFilePath, JSON.stringify({ test: true }));
    return { configFilePath, tempDir };
}
