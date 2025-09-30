/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
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
        downloadProvider.installSQLToolsService.callsFake(async () => {
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
        expect(downloadProvider.installSQLToolsService).to.have.been.calledOnceWithExactly(
            fixture.runtime,
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
        expect(downloadProvider.installSQLToolsService).to.not.have.been.called;
    });
});

interface IFixture {
    executableFileName: string;
    executablesFromConfig: string[] | undefined;
    runtime: Runtime;
    installDir: string;
}
