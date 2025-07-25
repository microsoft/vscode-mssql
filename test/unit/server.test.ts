/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as TypeMoq from "typemoq";
import * as assert from "assert";
import ServiceDownloadProvider from "../../src/languageservice/serviceDownloadProvider";
import ServerProvider from "../../src/languageservice/server";
import { ServerStatusView } from "../../src/languageservice/serverStatus";
import Config from "../../src/configurations/configUtils";
import { Runtime } from "../../src/models/platform";
import { IConfig, IStatusView } from "../../src/languageservice/interfaces";

interface IFixture {
    executableFileName: string;
    executablesFromConfig: string[];
    runtime: Runtime;
    installDir: string;
}

suite("Server tests", () => {
    let testDownloadProvider: TypeMoq.IMock<ServiceDownloadProvider>;
    let testStatusView: TypeMoq.IMock<IStatusView>;
    let testConfig: TypeMoq.IMock<IConfig>;

    setup(() => {
        testDownloadProvider = TypeMoq.Mock.ofType(
            ServiceDownloadProvider,
            TypeMoq.MockBehavior.Strict,
        );
        testStatusView = TypeMoq.Mock.ofType(ServerStatusView, TypeMoq.MockBehavior.Strict);
        testConfig = TypeMoq.Mock.ofType(Config, TypeMoq.MockBehavior.Strict);
    });

    function setupMocks(fixture: IFixture): void {
        testConfig
            .setup((x) => x.getSqlToolsExecutableFiles())
            .returns(() => fixture.executablesFromConfig);
        testDownloadProvider
            .setup((x) => x.getOrMakeInstallDirectory(fixture.runtime))
            .returns(() => Promise.resolve(fixture.installDir));
        testDownloadProvider
            .setup((x) => x.installSQLToolsService(fixture.runtime))
            .callback(() => {
                fixture.executablesFromConfig = [
                    fixture.executableFileName.replace(fixture.installDir, ""),
                ];
            })
            .returns(() => {
                return Promise.resolve(true);
            });
    }

    test("findServerPath should return error given a folder with no installed service", () => {
        let fixture: IFixture = {
            executableFileName: "",
            runtime: Runtime.Windows_64,
            installDir: __dirname,
            executablesFromConfig: ["exeFile1", "exeFile2"],
        };

        setupMocks(fixture);
        let server = new ServerProvider(
            testDownloadProvider.object,
            testConfig.object,
            testStatusView.object,
        );

        return server.findServerPath(fixture.installDir).then((result) => {
            assert.equal(result, undefined);
        });
    });

    test("findServerPath should return the file path given a file that exists", () => {
        let fixture: IFixture = {
            executableFileName: __filename,
            runtime: Runtime.Windows_64,
            installDir: __dirname,
            executablesFromConfig: undefined,
        };
        setupMocks(fixture);
        let server = new ServerProvider(
            testDownloadProvider.object,
            testConfig.object,
            testStatusView.object,
        );

        return server.findServerPath(fixture.executableFileName).then((result) => {
            assert.equal(result, fixture.executableFileName);
        });
    });

    test("findServerPath should not return the given file path if does not exist", () => {
        let fixture: IFixture = {
            executableFileName: __filename,
            runtime: Runtime.Windows_64,
            installDir: __dirname,
            executablesFromConfig: ["exeFile1", "exeFile2"],
        };
        setupMocks(fixture);
        let server = new ServerProvider(
            testDownloadProvider.object,
            testConfig.object,
            testStatusView.object,
        );

        return server.findServerPath(fixture.installDir).then((result) => {
            assert.equal(result, undefined);
        });
    });

    test("findServerPath should return a valid file path given a folder with installed service", () => {
        let fixture: IFixture = {
            executableFileName: __filename,
            runtime: Runtime.Windows_64,
            installDir: __dirname,
            executablesFromConfig: ["exeFile1", __filename],
        };
        setupMocks(fixture);
        let server = new ServerProvider(
            testDownloadProvider.object,
            testConfig.object,
            testStatusView.object,
        );

        return server.findServerPath(fixture.executableFileName).then((result) => {
            assert.equal(result, fixture.executableFileName);
        });
    });

    test("getOrDownloadServer should download the service if not exist and return the valid service file path", () => {
        let fixture: IFixture = {
            executableFileName: __filename,
            runtime: Runtime.Windows_64,
            installDir: __dirname,
            executablesFromConfig: ["exeFile1"],
        };

        setupMocks(fixture);
        let server = new ServerProvider(
            testDownloadProvider.object,
            testConfig.object,
            testStatusView.object,
        );

        return server.getOrDownloadServer(fixture.runtime).then((result) => {
            assert.equal(result, fixture.executableFileName);
        });
    });

    test("getOrDownloadServer should not download the service if already exist", () => {
        let fixture: IFixture = {
            executableFileName: __filename,
            runtime: Runtime.Windows_64,
            installDir: __dirname,
            executablesFromConfig: [__filename.replace(__dirname, "")],
        };

        setupMocks(fixture);

        let server = new ServerProvider(
            testDownloadProvider.object,
            testConfig.object,
            testStatusView.object,
        );

        return server.getOrDownloadServer(fixture.runtime).then((result) => {
            assert.equal(result, fixture.executableFileName);
        });
    });
});
