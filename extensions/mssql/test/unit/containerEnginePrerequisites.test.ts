/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, use } from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as os from "os";
import { CancellationToken } from "vscode-jsonrpc";
import {
    ContainerEngine,
    ContainerEnginePrerequisite,
    getContainerEnginePrerequisites,
    AzureSqlDatabaseRequests,
} from "../../src/sharedInterfaces/azureSqlDatabase";
import {
    checkContainerEnginePrerequisite,
    detectContainerEngines,
    registerAzureSqlRpcHandlers,
} from "../../src/deployment/azureSqlHelpers";
import * as containerEngine from "../../src/docker/containerEngine";
import * as dockerUtils from "../../src/docker/dockerUtils";
import { DeploymentWebviewController } from "../../src/deployment/deploymentWebviewController";

use(sinonChai);

suite("Container engine prerequisites", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => sandbox.restore());

    for (const platform of ["win32", "darwin", "linux"] as const) {
        test(`accepts ARM64 Docker prerequisites through the Azure SQL RPC on ${platform}`, async () => {
            sandbox.stub(os, "platform").returns(platform);
            sandbox.stub(os, "arch").returns("arm64");
            const legacyCheck = sandbox
                .stub(dockerUtils, "checkEngine")
                .rejects(new Error("SQL Server-only architecture and Rosetta checks must not run"));
            const execute = sandbox
                .stub(containerEngine, "executeContainerEngineCommand")
                .callsFake(async (command) => ({
                    stdout: command.args.includes("--format") ? "linux\r\n" : "Docker is available",
                    stderr: "",
                }));
            const controller = sandbox.createStubInstance(DeploymentWebviewController);
            registerAzureSqlRpcHandlers(controller);
            const check = controller.onRequest.withArgs(
                AzureSqlDatabaseRequests.CheckContainerEnginePrerequisite,
            ).firstCall.args[1];

            for (const prerequisite of getContainerEnginePrerequisites(ContainerEngine.Docker)) {
                expect(
                    await check(
                        { engine: ContainerEngine.Docker, prerequisite },
                        CancellationToken.None,
                    ),
                ).to.deep.equal({ success: true });
            }

            expect(execute).to.have.been.calledWith(
                { executable: "docker", args: ["info", "--format", "{{.OSType}}"] },
                15_000,
            );
            expect(legacyCheck).not.to.have.been.called;
        });
    }

    test("still rejects Docker configured for Windows containers on ARM64", async () => {
        sandbox.stub(os, "platform").returns("win32");
        sandbox.stub(os, "arch").returns("arm64");
        sandbox
            .stub(containerEngine, "executeContainerEngineCommand")
            .resolves({ stdout: "windows\r\n", stderr: "" });

        const result = await checkContainerEnginePrerequisite(
            ContainerEngine.Docker,
            ContainerEnginePrerequisite.Configuration,
        );

        expect(result.success).to.equal(false);
        expect(result.error).to.include("windows");
        expect(result.error).to.include("Linux");
    });

    test("surfaces Docker configuration command failures on ARM64", async () => {
        sandbox.stub(os, "platform").returns("win32");
        sandbox.stub(os, "arch").returns("arm64");
        sandbox
            .stub(containerEngine, "executeContainerEngineCommand")
            .rejects(new Error("Cannot connect to the Docker daemon"));

        expect(
            await checkContainerEnginePrerequisite(
                ContainerEngine.Docker,
                ContainerEnginePrerequisite.Configuration,
            ),
        ).to.deep.equal({ success: false, error: "Cannot connect to the Docker daemon" });
    });

    test("includes the configuration check for Docker", () => {
        expect(getContainerEnginePrerequisites(ContainerEngine.Docker)).to.deep.equal([
            ContainerEnginePrerequisite.Installation,
            ContainerEnginePrerequisite.Running,
            ContainerEnginePrerequisite.Configuration,
        ]);
    });

    for (const engine of [
        ContainerEngine.Podman,
        ContainerEngine.Containerd,
        ContainerEngine.AppleContainer,
        ContainerEngine.WslContainer,
    ]) {
        test(`does not include a separate configuration check for ${engine}`, () => {
            expect(getContainerEnginePrerequisites(engine)).to.deep.equal([
                ContainerEnginePrerequisite.Installation,
                ContainerEnginePrerequisite.Running,
            ]);
        });
    }

    test("detects engines using only the installation prerequisite", async () => {
        const checkedEngines: ContainerEngine[] = [];
        const detectedEngine = ContainerEngine.Podman;

        const results = await detectContainerEngines(async (engine, prerequisite) => {
            expect(prerequisite).to.equal(ContainerEnginePrerequisite.Installation);
            checkedEngines.push(engine);
            return { success: engine === detectedEngine };
        });

        expect(checkedEngines).to.have.members(Object.values(ContainerEngine));
        expect(results[detectedEngine].success).to.be.true;
        expect(results[ContainerEngine.Docker].success).to.be.false;
    });
});
