/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import ServiceDownloadProvider from "../../src/languageservice/serviceDownloadProvider";
import ServerProvider from "../../src/languageservice/server";
import { ServerStatusView } from "../../src/languageservice/serverStatus";
import { Runtime } from "../../src/models/platform";
import { IStatusView } from "../../src/languageservice/interfaces";

chai.use(sinonChai);

suite("Server tests", () => {
    let sandbox: sinon.SinonSandbox;
    let downloadProvider: sinon.SinonStubbedInstance<ServiceDownloadProvider>;
    let statusView: sinon.SinonStubbedInstance<IStatusView>;

    setup(() => {
        sandbox = sinon.createSandbox();
        downloadProvider = sandbox.createStubInstance(ServiceDownloadProvider);
        statusView = sandbox.createStubInstance(ServerStatusView);
    });

    teardown(() => {
        sandbox.restore();
    });

    function createServer(): ServerProvider {
        return new ServerProvider(downloadProvider, statusView);
    }

    async function withTempDir(
        callback: (tempDir: string) => Promise<void>,
        prefix: string = "server-test-",
    ): Promise<void> {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
        try {
            await callback(tempDir);
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    }

    test("tryGetExecutablePathInFolder should return undefined when the expected file is missing", async () => {
        await withTempDir(async (tempDir) => {
            const server = createServer();
            const result = await server.tryGetExecutablePathInFolder(
                tempDir,
                Runtime.Portable,
                "MicrosoftSqlToolsServiceLayer",
            );
            expect(result).to.be.undefined;
        });
    });

    test("tryGetExecutablePathInFolder should return the expected portable executable path", async () => {
        await withTempDir(async (tempDir) => {
            const expectedPath = path.join(tempDir, "MicrosoftSqlToolsServiceLayer.dll");
            await fs.writeFile(expectedPath, "");

            const server = createServer();
            const result = await server.tryGetExecutablePathInFolder(
                tempDir,
                Runtime.Portable,
                "MicrosoftSqlToolsServiceLayer",
            );

            expect(result).to.equal(expectedPath);
        });
    });

    test("tryGetExecutablePathInFolder should return the expected native executable path", async () => {
        await withTempDir(async (tempDir) => {
            const expectedFileName = "MicrosoftSqlToolsServiceLayer.exe";
            const expectedPath = path.join(tempDir, expectedFileName);
            await fs.writeFile(expectedPath, "");

            const server = createServer();
            const result = await server.tryGetExecutablePathInFolder(
                tempDir,
                Runtime.Windows_64,
                "MicrosoftSqlToolsServiceLayer",
            );

            expect(result).to.equal(expectedPath);
        });
    });

    test("tryGetServerInstallFolder should delegate to the download provider", async () => {
        const installDir = path.join(os.tmpdir(), "sqltools-install");
        downloadProvider.tryGetInstallDirectory.withArgs(Runtime.Windows_64).resolves(installDir);

        const server = createServer();
        const result = await server.tryGetServerInstallFolder(Runtime.Windows_64);

        expect(result).to.equal(installDir);
        expect(downloadProvider.tryGetInstallDirectory).to.have.been.calledWithExactly(
            Runtime.Windows_64,
        );
    });

    test("downloadAndGetServerInstallFolder should download the requested runtime and return the install folder", async () => {
        const installDir = path.join(os.tmpdir(), "sqltools-install");
        downloadProvider.getOrCreateInstallDirectory
            .withArgs(Runtime.Windows_64)
            .resolves(installDir);
        downloadProvider.downloadAndInstallService.withArgs(Runtime.Windows_64).resolves(true);

        const server = createServer();
        const result = await server.downloadAndGetServerInstallFolder(Runtime.Windows_64);

        expect(result).to.equal(installDir);
        expect(downloadProvider.getOrCreateInstallDirectory).to.have.been.calledWithExactly(
            Runtime.Windows_64,
        );
        expect(downloadProvider.downloadAndInstallService).to.have.been.calledWithExactly(
            Runtime.Windows_64,
        );
    });

    test("downloadAndGetServerInstallFolder should notify the status view when download fails", async () => {
        const expectedError = new Error("download failed");
        downloadProvider.getOrCreateInstallDirectory.withArgs(Runtime.Windows_64).resolves("/tmp");
        downloadProvider.downloadAndInstallService
            .withArgs(Runtime.Windows_64)
            .rejects(expectedError);

        const server = createServer();

        try {
            await server.downloadAndGetServerInstallFolder(Runtime.Windows_64);
            expect.fail("Expected downloadAndGetServerInstallFolder to throw");
        } catch (error) {
            expect(error).to.equal(expectedError);
        }

        expect(statusView.serviceInstallationFailed).to.have.been.called;
    });
});
