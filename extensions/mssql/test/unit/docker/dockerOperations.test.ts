/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import * as dockerClient from "../../../src/docker/dockerClient";
import * as dockerOperations from "../../../src/docker/dockerOperations";
import { defaultContainerName } from "../../../src/constants/constants";

chai.use(sinonChai);

suite("Docker Operations", () => {
    let sandbox: sinon.SinonSandbox;

    // Mock Docker client
    let mockDockerClient: {
        listContainers: sinon.SinonStub;
        getContainer: sinon.SinonStub;
        createContainer: sinon.SinonStub;
        pull: sinon.SinonStub;
        modem: { followProgress: sinon.SinonStub };
    };

    setup(async () => {
        sandbox = sinon.createSandbox();

        // Reset docker client before each test
        dockerClient.resetDockerClient();

        // Create mock Docker client
        mockDockerClient = {
            listContainers: sandbox.stub(),
            getContainer: sandbox.stub(),
            createContainer: sandbox.stub(),
            pull: sandbox.stub(),
            modem: { followProgress: sandbox.stub() },
        };

        // Stub getDockerClient to return our mock
        sandbox.stub(dockerClient, "getDockerClient").returns(mockDockerClient as any);
    });

    teardown(() => {
        sandbox.restore();
        dockerClient.resetDockerClient();
    });

    suite("sanitizeContainerName", () => {
        test("should preserve valid container names", () => {
            const result = dockerOperations.sanitizeContainerName("valid-container");
            expect(result, "Valid name should remain unchanged").to.equal("valid-container");
        });

        test("should preserve alphanumeric and allowed special characters", () => {
            const result = dockerOperations.sanitizeContainerName("test_container.1-2");
            expect(result, "Name with allowed special chars should remain unchanged").to.equal(
                "test_container.1-2",
            );
        });

        test("should remove disallowed special characters", () => {
            const result = dockerOperations.sanitizeContainerName("test@container!");
            expect(result, "Disallowed special chars should be removed").to.equal("testcontainer");
        });

        test("should sanitize SQL injection attempts", () => {
            const result = dockerOperations.sanitizeContainerName("container';DROP TABLE users;--");
            expect(result, "SQL injection chars should be removed").to.equal(
                "containerDROPTABLEusers--",
            );
        });

        test("should sanitize command injection attempts", () => {
            const result = dockerOperations.sanitizeContainerName('container" && echo Injected');
            expect(result, "Command injection chars should be removed").to.equal(
                "containerechoInjected",
            );
        });

        test("should sanitize path traversal attempts", () => {
            const result = dockerOperations.sanitizeContainerName('container"; rm -rf /');
            expect(result, "Path traversal chars should be removed").to.equal("containerrm-rf");
        });

        test("should handle empty string", () => {
            const result = dockerOperations.sanitizeContainerName("");
            expect(result, "Empty string should remain empty").to.equal("");
        });

        test("should handle string with only disallowed characters", () => {
            const result = dockerOperations.sanitizeContainerName("@#$%^&*()");
            expect(result, "String with only disallowed chars should become empty").to.equal("");
        });

        test("should remove slashes and colons", () => {
            const result = dockerOperations.sanitizeContainerName(
                "my container/with\\invalid:chars",
            );
            expect(result, "Invalid characters should be removed").to.equal(
                "mycontainerwithinvalidchars",
            );
        });
    });

    suite("isContainerRunning", () => {
        test("should return true when container is running", async () => {
            mockDockerClient.listContainers.resolves([{ Names: ["/test-container"] }]);

            const result = await dockerOperations.isContainerRunning("test-container");
            expect(result).to.be.true;
            expect(mockDockerClient.listContainers).to.have.been.calledWith({
                filters: { name: ["test-container"], status: ["running"] },
            });
        });

        test("should return false when container is not running", async () => {
            mockDockerClient.listContainers.resolves([]);

            const result = await dockerOperations.isContainerRunning("test-container");
            expect(result).to.be.false;
        });

        test("should return false when container has a different name", async () => {
            mockDockerClient.listContainers.resolves([{ Names: ["/other-container"] }]);

            const result = await dockerOperations.isContainerRunning("test-container");
            expect(result).to.be.false;
        });
    });

    suite("containerExists", () => {
        test("should return true when container exists", async () => {
            mockDockerClient.listContainers.resolves([{ Names: ["/test-container"] }]);

            const result = await dockerOperations.containerExists("test-container");
            expect(result).to.be.true;
            expect(mockDockerClient.listContainers).to.have.been.calledWith({ all: true });
        });

        test("should return false when container does not exist", async () => {
            mockDockerClient.listContainers.resolves([]);

            const result = await dockerOperations.containerExists("test-container");
            expect(result).to.be.false;
        });
    });

    suite("startContainer", () => {
        test("should start the container", async () => {
            const mockContainer = {
                start: sandbox.stub().resolves(),
            };
            mockDockerClient.getContainer.returns(mockContainer as any);

            await dockerOperations.startContainer("test-container");

            expect(mockDockerClient.getContainer).to.have.been.calledWith("test-container");
            expect(mockContainer.start).to.have.been.calledOnce;
        });
    });

    suite("stopContainer", () => {
        test("should stop the container", async () => {
            const mockContainer = {
                stop: sandbox.stub().resolves(),
            };
            mockDockerClient.getContainer.returns(mockContainer as any);

            await dockerOperations.stopContainer("test-container");

            expect(mockDockerClient.getContainer).to.have.been.calledWith("test-container");
            expect(mockContainer.stop).to.have.been.calledOnce;
        });
    });

    suite("removeContainer", () => {
        test("should remove the container", async () => {
            const mockContainer = {
                remove: sandbox.stub().resolves(),
            };
            mockDockerClient.getContainer.returns(mockContainer as any);

            await dockerOperations.removeContainer("test-container");

            expect(mockDockerClient.getContainer).to.have.been.calledWith("test-container");
            expect(mockContainer.remove).to.have.been.calledOnce;
        });
    });

    suite("getContainerNameById", () => {
        test("should return container name when found", async () => {
            mockDockerClient.listContainers.resolves([
                { Id: "container123", Names: ["/myContainer"] },
            ]);

            const result = await dockerOperations.getContainerNameById("container123");
            expect(result).to.equal("myContainer");
        });

        test("should return undefined when container not found", async () => {
            mockDockerClient.listContainers.resolves([]);

            const result = await dockerOperations.getContainerNameById("nonexistent");
            expect(result).to.equal(undefined);
        });
    });

    suite("findAvailablePort", () => {
        test("should return requested port when no containers are using it", async () => {
            mockDockerClient.listContainers.resolves([]);

            const result = await dockerOperations.findAvailablePort(1433);
            expect(result).to.equal(1433);
        });

        test("should return next available port when requested port is taken", async () => {
            mockDockerClient.listContainers.resolves([{ Ports: [{ PublicPort: 1433 }] }]);

            const result = await dockerOperations.findAvailablePort(1433);
            expect(result).to.equal(1434);
        });

        test("should skip multiple used ports", async () => {
            mockDockerClient.listContainers.resolves([
                { Ports: [{ PublicPort: 1433 }] },
                { Ports: [{ PublicPort: 1434 }] },
                { Ports: [{ PublicPort: 1435 }] },
            ]);

            const result = await dockerOperations.findAvailablePort(1433);
            expect(result).to.equal(1436);
        });
    });

    suite("validateContainerName", () => {
        test("should return name when valid and not taken", async () => {
            mockDockerClient.listContainers.resolves([{ Names: ["/other-container"] }]);

            const result = await dockerOperations.validateContainerName("new-container");
            expect(result).to.equal("new-container");
        });

        test("should return empty string when name is taken", async () => {
            mockDockerClient.listContainers.resolves([{ Names: ["/taken-container"] }]);

            const result = await dockerOperations.validateContainerName("taken-container");
            expect(result).to.equal("");
        });

        test("should return empty string for invalid name format", async () => {
            mockDockerClient.listContainers.resolves([]);

            const result = await dockerOperations.validateContainerName("!invalid*name");
            expect(result).to.equal("");
        });
    });

    suite("generateUniqueContainerName", () => {
        test("should return base name when not taken", async () => {
            mockDockerClient.listContainers.resolves([]);

            const result = await dockerOperations.generateUniqueContainerName(defaultContainerName);
            expect(result).to.equal(defaultContainerName);
        });

        test("should return name with suffix when base name is taken", async () => {
            mockDockerClient.listContainers.resolves([{ Names: [`/${defaultContainerName}`] }]);

            const result = await dockerOperations.generateUniqueContainerName(defaultContainerName);
            // Uses ++counter starting from 1, so first suffix is _2
            expect(result).to.equal(`${defaultContainerName}_2`);
        });

        test("should increment suffix until unique name found", async () => {
            mockDockerClient.listContainers.resolves([
                { Names: [`/${defaultContainerName}`] },
                { Names: [`/${defaultContainerName}_2`] },
            ]);

            const result = await dockerOperations.generateUniqueContainerName(defaultContainerName);
            expect(result).to.equal(`${defaultContainerName}_3`);
        });
    });

    suite("pullImage", () => {
        test("should pull the image and call progress callback", async () => {
            const mockStream = {};
            // pull uses callback style: pull(imageTag, opts, callback)
            mockDockerClient.pull.callsFake((imageTag, opts, callback) => {
                callback(null, mockStream);
            });
            mockDockerClient.modem.followProgress.callsFake((stream, callback, progressCb) => {
                if (progressCb) {
                    progressCb({ status: "Pulling" });
                    progressCb({ status: "Downloading", progress: "50%" });
                }
                callback(null);
            });

            const progressCalls: any[] = [];
            await dockerOperations.pullImage("test-image:latest", (event) => {
                progressCalls.push(event);
            });

            expect(mockDockerClient.pull).to.have.been.calledWith(
                "test-image:latest",
                {},
                sinon.match.func,
            );
            expect(progressCalls).to.have.length(2);
            expect(progressCalls[0].status).to.equal("Pulling");
        });
    });

    suite("createAndStartContainer", () => {
        test("should create and start a container", async () => {
            const mockContainer = {
                id: "container123",
                start: sandbox.stub().resolves(),
            };
            mockDockerClient.createContainer.resolves(mockContainer as any);

            const config = {
                Image: "test-image:latest",
                name: "test-container",
            };

            const result = await dockerOperations.createAndStartContainer(config);

            expect(mockDockerClient.createContainer).to.have.been.calledWith(config);
            expect(mockContainer.start).to.have.been.calledOnce;
            expect(result.id).to.equal("container123");
        });
    });

    suite("streamContainerLogs", () => {
        test("should stream logs and call onData callback", async () => {
            const mockStream = {
                on: sandbox.stub(),
                removeAllListeners: sandbox.stub(),
            };

            const mockContainer = {
                logs: sandbox.stub().resolves(mockStream),
            };
            mockDockerClient.getContainer.returns(mockContainer as any);

            // Simulate data event
            mockStream.on.withArgs("data").callsFake((event, callback) => {
                setTimeout(() => callback(Buffer.from("test log")), 0);
            });

            const dataCalls: string[] = [];
            const cleanup = await dockerOperations.streamContainerLogs(
                "test-container",
                (chunk) => {
                    dataCalls.push(chunk);
                },
            );

            expect(typeof cleanup).to.equal("function");
            expect(mockContainer.logs).to.have.been.calledWith({
                stdout: true,
                stderr: true,
                since: undefined,
                follow: true,
            });
        });
    });

    suite("getContainerLogs", () => {
        test("should return container logs as string", async () => {
            const mockContainer = {
                logs: sandbox.stub().resolves(Buffer.from("test logs\nmore logs")),
            };
            mockDockerClient.getContainer.returns(mockContainer as any);

            const result = await dockerOperations.getContainerLogs("test-container");

            expect(result).to.equal("test logs\nmore logs");
            expect(mockContainer.logs).to.have.been.calledWith({
                stdout: true,
                stderr: true,
                since: undefined,
                follow: false,
            });
        });

        test("should pass since parameter", async () => {
            const mockContainer = {
                logs: sandbox.stub().resolves(Buffer.from("")),
            };
            mockDockerClient.getContainer.returns(mockContainer as any);

            await dockerOperations.getContainerLogs("test-container", 1234567890);

            expect(mockContainer.logs).to.have.been.calledWith({
                stdout: true,
                stderr: true,
                since: 1234567890,
                follow: false,
            });
        });
    });
});
