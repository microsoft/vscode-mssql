/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as path from "path";
import ServiceDownloadProvider from "../../src/languageservice/serviceDownloadProvider";
import ServerProvider from "../../src/languageservice/server";
import { ServerStatusView } from "../../src/languageservice/serverStatus";
import ConfigUtils from "../../src/configurations/configUtils";
import { Runtime } from "../../src/models/platform";
import { IConfigUtils, IStatusView } from "../../src/languageservice/interfaces";

chai.use(sinonChai);

suite("Server tests", () => {
    let sandbox: sinon.SinonSandbox;
    let downloadProvider: sinon.SinonStubbedInstance<ServiceDownloadProvider>;
    let statusView: sinon.SinonStubbedInstance<IStatusView>;
    let configUtils: sinon.SinonStubbedInstance<IConfigUtils>;

    setup(() => {
        sandbox = sinon.createSandbox();
        downloadProvider = sandbox.createStubInstance(ServiceDownloadProvider);
        statusView = sandbox.createStubInstance(ServerStatusView);
        configUtils = sandbox.createStubInstance(ConfigUtils);
    });

    teardown(() => {
        sandbox.restore();
    });

    function createServer(fixture: IFixture): ServerProvider {
        configUtils.getSqlToolsExecutableFiles.callsFake(() => fixture.executablesFromConfig);
        downloadProvider.getOrMakeInstallDirectory.callsFake(async () => fixture.installDir);
        downloadProvider.installService.callsFake(async () => {
            if (fixture.executablesFromConfig) {
                fixture.executablesFromConfig = [
                    fixture.executableFileName.replace(fixture.installDir, ""),
                ];
            }
            return true;
        });
        return new ServerProvider(downloadProvider, configUtils, statusView);
    }

    test("findServerPath should return error given a folder with no installed service", async () => {
        const fixture: IFixture = {
            executableFileName: "",
            runtime: Runtime.Windows_64,
            installDir: __dirname,
            executablesFromConfig: ["exeFile1", "exeFile2"],
        };

        const server = createServer(fixture);
        const result = await server.findServerPath(fixture.installDir);
        expect(result).to.be.undefined;
    });

    test("findServerPath should return the file path given a file that exists", async () => {
        const fixture: IFixture = {
            executableFileName: __filename,
            runtime: Runtime.Windows_64,
            installDir: __dirname,
            executablesFromConfig: undefined,
        };
        const server = createServer(fixture);
        const result = await server.findServerPath(fixture.executableFileName);
        expect(result).to.equal(fixture.executableFileName);
    });

    test("findServerPath should not return the given file path if does not exist", async () => {
        const fixture: IFixture = {
            executableFileName: __filename,
            runtime: Runtime.Windows_64,
            installDir: __dirname,
            executablesFromConfig: ["exeFile1", "exeFile2"],
        };
        const server = createServer(fixture);
        const result = await server.findServerPath(fixture.installDir);
        expect(result).to.be.undefined;
    });

    test("findServerPath should return a valid file path given a folder with installed service", async () => {
        const fixture: IFixture = {
            executableFileName: __filename,
            runtime: Runtime.Windows_64,
            installDir: __dirname,
            executablesFromConfig: ["exeFile1", __filename],
        };
        const server = createServer(fixture);
        const result = await server.findServerPath(fixture.executableFileName);
        expect(result).to.equal(fixture.executableFileName);
    });

    test("getOrDownloadServer should download the service if not exist and return the valid service file path", async () => {
        const fixture: IFixture = {
            executableFileName: __filename,
            runtime: Runtime.Windows_64,
            installDir: __dirname,
            executablesFromConfig: ["exeFile1"],
        };
        const server = createServer(fixture);
        const result = await server.getOrDownloadServer(fixture.runtime);
        expect(result).to.equal(fixture.executableFileName);
        expect(downloadProvider.installService).to.have.been.calledOnceWithExactly(
            Runtime.Windows_64,
        );
    });

    test("getOrDownloadServer should not download the service if already exist", async () => {
        const fixture: IFixture = {
            executableFileName: __filename,
            runtime: Runtime.Windows_64,
            installDir: __dirname,
            executablesFromConfig: [__filename.replace(__dirname, "")],
        };
        const server = createServer(fixture);
        const result = await server.getOrDownloadServer(fixture.runtime);
        expect(result).to.equal(fixture.executableFileName);
        expect(downloadProvider.installService).to.not.have.been.called;
    });

    suite("getServerPath priority order", () => {
        test("should return platform-specific path first when it exists", async () => {
            // Platform-specific dir has the file, portable dir does not
            const platformDir = __dirname;
            const portableDir = path.join(__dirname, "nonexistent_portable");
            configUtils.getSqlToolsExecutableFiles.returns([path.basename(__filename)]);
            downloadProvider.getOrMakeInstallDirectory
                .withArgs(Runtime.Windows_64)
                .resolves(platformDir);
            downloadProvider.getOrMakeInstallDirectory
                .withArgs(Runtime.Portable)
                .resolves(portableDir);

            const server = new ServerProvider(downloadProvider, configUtils, statusView);
            const result = await server.getServerPath(Runtime.Windows_64);

            // Should find the server in platform-specific directory first
            expect(result).to.equal(__filename);
            expect(downloadProvider.getOrMakeInstallDirectory).to.have.been.calledWith(
                Runtime.Windows_64,
            );
        });

        test("should fall back to portable directory when platform-specific path not found", async () => {
            const platformDir = path.join(__dirname, "nonexistent_platform");
            // Use the actual test directory as the "portable" directory so findServerPath succeeds
            const portableDir = __dirname;
            configUtils.getSqlToolsExecutableFiles.returns([path.basename(__filename)]);
            downloadProvider.getOrMakeInstallDirectory
                .withArgs(Runtime.Linux)
                .resolves(platformDir);
            downloadProvider.getOrMakeInstallDirectory
                .withArgs(Runtime.Portable)
                .resolves(portableDir);

            const server = new ServerProvider(downloadProvider, configUtils, statusView);
            const result = await server.getServerPath(Runtime.Linux);

            // findServerPath(platformDir) returns undefined because the dir doesn't exist,
            // then falls back to portable which finds the file
            expect(result).to.equal(__filename);
            expect(downloadProvider.getOrMakeInstallDirectory).to.have.been.calledWith(
                Runtime.Portable,
            );
        });

        test("should not double-check portable when runtime is already Portable", async () => {
            const portableDir = path.join(__dirname, "nonexistent");
            configUtils.getSqlToolsExecutableFiles.returns(["nonexistent.exe"]);
            downloadProvider.getOrMakeInstallDirectory
                .withArgs(Runtime.Portable)
                .resolves(portableDir);

            const server = new ServerProvider(downloadProvider, configUtils, statusView);
            const result = await server.getServerPath(Runtime.Portable);

            expect(result).to.be.undefined;
            // Should only call getOrMakeInstallDirectory once for Portable, not twice
            expect(downloadProvider.getOrMakeInstallDirectory).to.have.been.calledOnce;
        });

        test("should return undefined when neither platform nor portable has the server", async () => {
            const platformDir = path.join(__dirname, "nonexistent_platform");
            const portableDir = path.join(__dirname, "nonexistent_portable");
            configUtils.getSqlToolsExecutableFiles.returns(["nonexistent.exe"]);
            downloadProvider.getOrMakeInstallDirectory
                .withArgs(Runtime.Windows_64)
                .resolves(platformDir);
            downloadProvider.getOrMakeInstallDirectory
                .withArgs(Runtime.Portable)
                .resolves(portableDir);

            const server = new ServerProvider(downloadProvider, configUtils, statusView);
            const result = await server.getServerPath(Runtime.Windows_64);

            expect(result).to.be.undefined;
        });
    });

    suite("getOrDownloadServer downloads requested runtime", () => {
        test("should download the requested runtime when server not found anywhere", async () => {
            const platformDir = path.join(__dirname, "nonexistent_platform");
            const portableDir = path.join(__dirname, "nonexistent_portable");
            configUtils.getSqlToolsExecutableFiles.returns(["nonexistent.exe"]);
            downloadProvider.getOrMakeInstallDirectory
                .withArgs(Runtime.Windows_64)
                .resolves(platformDir);
            downloadProvider.getOrMakeInstallDirectory
                .withArgs(Runtime.Portable)
                .resolves(portableDir);
            downloadProvider.installService.resolves(true);

            const server = new ServerProvider(downloadProvider, configUtils, statusView);

            try {
                await server.getOrDownloadServer(Runtime.Windows_64);
            } catch {
                // Expected — the download will "succeed" but findServerPath still won't find files
            }

            // Should attempt to download the requested runtime
            expect(downloadProvider.installService).to.have.been.calledWith(Runtime.Windows_64);
        });
    });
});

interface IFixture {
    executableFileName: string;
    executablesFromConfig: string[] | undefined;
    runtime: Runtime;
    installDir: string;
}
