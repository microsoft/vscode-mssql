/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from "chai";
import * as sinon from "sinon";
import { PlatformInformation, Runtime } from "../../src/models/platform";
import ServerProvider from "../../src/languageservice/server";
import ServiceDownloadProvider from "../../src/languageservice/serviceDownloadProvider";
import DecompressProvider from "../../src/languageservice/decompressProvider";
import HttpClient from "../../src/languageservice/httpClient";
import ConfigUtils from "../../src/configurations/configUtils";
import { ServerStatusView } from "../../src/languageservice/serverStatus";
import { Logger, LogLevel } from "../../src/models/logger";

suite("Stub Status View tests", () => {
    let sandbox: sinon.SinonSandbox;
    let stubStatusView: sinon.SinonStubbedInstance<ServerStatusView>;
    let logStub: sinon.SinonSpy;

    setup(() => {
        sandbox = sinon.createSandbox();
        logStub = sandbox.stub();
        stubStatusView = sandbox.createStubInstance(ServerStatusView);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("Test installing service method", () => {
        stubStatusView.installingService();
        assert.isTrue(logStub.calledWith("..."), "Should print expected output to console");
    });

    test("Test service installed method", () => {
        stubStatusView.serviceInstalled();
        assert.isTrue(
            logStub.calledWith("Service installed"),
            "Should print expected output to console",
        );
    });

    test("Test service installation failed method", () => {
        stubStatusView.serviceInstallationFailed();
        assert.isTrue(
            logStub.calledWith("Service installation failed"),
            "Should print expected output to console",
        );
    });

    test("Test update service downloading progress method", () => {
        stubStatusView.updateServiceDownloadingProgress(100);
        assert.isTrue(logStub.calledWith("100%"), "Should print expected output to console");
    });
});

suite("Logger tests", () => {
    let sandbox: sinon.SinonSandbox;
    let stubLogger: Logger;
    let logStub: sinon.SinonSpy;

    setup(() => {
        sandbox = sinon.createSandbox();
        logStub = sandbox.stub();
        stubLogger = new Logger(logStub, LogLevel.All, false /** PII logging */);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("Test logdebug method", () => {
        stubLogger.logDebug("test");
        assert.isTrue(logStub.calledWith("test"), "Should print expected output to console");
    });

    test("Test increaseIndent method", () => {
        stubLogger.increaseIndent();
        assert.isTrue(logStub.notCalled, "Should not have printed anything to console");
    });

    test("Test decreaseIndent method", () => {
        stubLogger.decreaseIndent();
        assert.isTrue(logStub.notCalled, "Should not have printed anything to console");
    });

    test("Test append method", () => {
        stubLogger.append("test");
        assert.isTrue(logStub.calledWith("test"), "Should print expected output to console");
    });

    test("Test appendLine method", () => {
        stubLogger.appendLine("test");
        assert.isTrue(logStub.calledWith("test"), "Should print expected output to console");
    });
});

suite("Test Service Installer Util functions", () => {
    let sandbox: sinon.SinonSandbox;

    let downloadProvider: ServiceDownloadProvider;
    let config: ConfigUtils;
    let statusView: sinon.SinonStubbedInstance<ServerStatusView>;

    setup(() => {
        sandbox = sinon.createSandbox();

        config = new ConfigUtils();
        statusView = sandbox.createStubInstance(ServerStatusView);
        const logger = sandbox.createStubInstance(Logger);
        const httpClient = new HttpClient();
        const decompressProvider = new DecompressProvider();

        downloadProvider = new ServiceDownloadProvider(
            config,
            logger,
            statusView,
            httpClient,
            decompressProvider,
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    test("Test getServiceInstallDirectoryRoot function", () => {
        function getServiceInstallDirectoryRoot(): string {
            let directoryPath: string = downloadProvider.getInstallDirectoryRoot();
            directoryPath = directoryPath.replace("\\{#version#}\\{#platform#}", "");
            directoryPath = directoryPath.replace("/{#version#}/{#platform#}", "");
            return directoryPath;
        }

        let path = getServiceInstallDirectoryRoot();
        assert.isNotNull(path, "Service install directory root should not be null");
    });

    // test('Test getgetServiceInstallDirectory function', async () => {
    //     let dir = await getServiceInstallDirectory(undefined);
    //     assert.isNotNull(dir, 'Service install directory should not be null');
    // });

    test("Test installService function", async () => {
        let serverProvider = new ServerProvider(downloadProvider, config, statusView);

        async function installService(runtime: Runtime): Promise<String> {
            if (runtime === undefined) {
                const platformInfo = await PlatformInformation.getCurrent();
                if (platformInfo.isValidRuntime) {
                    return serverProvider.getOrDownloadServer(platformInfo.runtimeId);
                } else {
                    throw new Error("unsupported runtime");
                }
            } else {
                return serverProvider.getOrDownloadServer(runtime);
            }
        }

        let installedPath = await installService(undefined);
        assert.isNotNull(installedPath, "Service installed path should not be null");
    });
});
