/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as chai from "chai";
import { IStatusView } from "../../src/languageservice/interfaces";
import ServiceDownloadProvider from "../../src/languageservice/serviceDownloadProvider";
import HttpClient from "../../src/languageservice/httpClient";
import DecompressProvider from "../../src/languageservice/decompressProvider";
import ConfigUtils from "../../src/configurations/configUtils";
import { Runtime } from "../../src/models/platform";
import * as path from "path";
import { Logger } from "../../src/models/logger";
import * as fs from "fs/promises";
import { expect } from "chai";

chai.use(sinonChai);

class StubStatusView implements IStatusView {
    installingService(): void {}
    serviceInstalled(): void {}
    serviceInstallationFailed(): void {}
    updateServiceDownloadingProgress(_downloadPercentage: number): void {}
}

interface IFixture {
    downloadUrl?: string;
    downloadProvider?: ServiceDownloadProvider;
    downloadResult: Promise<void>;
    decompressResult: Promise<void>;
}

suite("ServiceDownloadProvider Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let config: sinon.SinonStubbedInstance<ConfigUtils>;
    let statusView: StubStatusView;
    let statusViewStubs: {
        installingService: sinon.SinonStub;
        serviceInstalled: sinon.SinonStub;
        serviceInstallationFailed: sinon.SinonStub;
        updateServiceDownloadingProgress: sinon.SinonStub;
    };
    let testHttpClient: sinon.SinonStubbedInstance<HttpClient>;
    let testDecompressProvider: sinon.SinonStubbedInstance<DecompressProvider>;
    let testLogger: sinon.SinonStubbedInstance<Logger>;

    setup(() => {
        sandbox = sinon.createSandbox();
        config = sandbox.createStubInstance(ConfigUtils);
        statusView = new StubStatusView();
        statusViewStubs = {
            installingService: sandbox.stub(statusView, "installingService"),
            serviceInstalled: sandbox.stub(statusView, "serviceInstalled"),
            serviceInstallationFailed: sandbox.stub(statusView, "serviceInstallationFailed"),
            updateServiceDownloadingProgress: sandbox.stub(
                statusView,
                "updateServiceDownloadingProgress",
            ),
        };
        testHttpClient = sandbox.createStubInstance(HttpClient);
        testDecompressProvider = sandbox.createStubInstance(DecompressProvider);
        testLogger = sandbox.createStubInstance(Logger);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("getInstallDirectory should return the exact value from config if the path is absolute", async () => {
        const expectedPathFromConfig = __dirname;
        const expectedVersionFromConfig = "0.0.4";
        const expected = expectedPathFromConfig;
        config.getSqlToolsInstallDirectory.returns(expectedPathFromConfig);
        config.getSqlToolsPackageVersion.returns(expectedVersionFromConfig);
        const downloadProvider = new ServiceDownloadProvider(
            config,
            undefined,
            statusView,
            testHttpClient,
            testDecompressProvider,
        );
        const actual = await downloadProvider.getOrMakeInstallDirectory(Runtime.OSX_10_11_64);
        expect(actual).to.equal(expected);
    });

    test("getInstallDirectory should add the version to the path given the path with the version template key", async () => {
        const expectedPathFromConfig = `${__dirname}/{#version#}`;
        const expectedVersionFromConfig = "0.0.4";
        const expected = `${__dirname}/0.0.4`;
        config.getSqlToolsInstallDirectory.returns(expectedPathFromConfig);
        config.getSqlToolsPackageVersion.returns(expectedVersionFromConfig);
        const downloadProvider = new ServiceDownloadProvider(
            config,
            undefined,
            statusView,
            testHttpClient,
            testDecompressProvider,
        );
        const actual = await downloadProvider.getOrMakeInstallDirectory(Runtime.OSX_10_11_64);
        expect(actual).to.equal(expected);
    });

    test("getInstallDirectory should add the platform to the path given the path with the platform template key", async () => {
        const rootPath = path.resolve(__dirname);
        const expectedPathFromConfig = path.join(rootPath, "{#version#}", "{#platform#}");
        const expectedVersionFromConfig = "0.0.4";
        const expected = path.join(rootPath, "0.0.4", "OSX");
        config.getSqlToolsInstallDirectory.returns(expectedPathFromConfig);
        config.getSqlToolsPackageVersion.returns(expectedVersionFromConfig);
        const downloadProvider = new ServiceDownloadProvider(
            config,
            undefined,
            statusView,
            testHttpClient,
            testDecompressProvider,
        );
        const actual = await downloadProvider.getOrMakeInstallDirectory(Runtime.OSX_10_11_64);
        expect(actual).to.equal(expected);
    });

    test("getDownloadFileName should return the expected file name given a runtime", () => {
        const expectedName = "expected";
        const fileNamesJson = { Windows_64: expectedName };
        config.getSqlToolsConfigValue.withArgs("downloadFileNames").returns(fileNamesJson);
        const downloadProvider = new ServiceDownloadProvider(
            config,
            undefined,
            statusView,
            testHttpClient,
            testDecompressProvider,
        );
        const actual = downloadProvider.getDownloadFileName(Runtime.Windows_64);
        expect(actual).to.equal(expectedName);
    });

    async function createDownloadProvider(fixture: IFixture): Promise<IFixture> {
        const fileName = "fileName";
        const baseDownloadUrl = "baseDownloadUrl/{#version#}/{#fileName#}";
        const version = "1.0.0";
        const installFolder = path.join(__dirname, "testService");
        const fileNamesJson = { Windows_64: fileName };
        const downloadUrl = "baseDownloadUrl/1.0.0/fileName";
        try {
            await fs.rmdir(installFolder);
        } catch (err) {
            console.error(err);
        }

        config.getSqlToolsInstallDirectory.returns(installFolder);
        config.getSqlToolsConfigValue.withArgs("downloadFileNames").returns(fileNamesJson);
        config.getSqlToolsServiceDownloadUrl.returns(baseDownloadUrl);
        config.getSqlToolsPackageVersion.returns(version);
        statusViewStubs.installingService.returns();
        statusViewStubs.serviceInstalled.returns();
        testLogger.append.returns();
        testLogger.appendLine.returns();

        testDecompressProvider.decompress.callsFake(() => {
            return fixture.decompressResult;
        });
        testHttpClient.downloadFile.callsFake(() => {
            return fixture.downloadResult;
        });
        const downloadProvider = new ServiceDownloadProvider(
            config,
            testLogger,
            statusView,
            testHttpClient,
            testDecompressProvider,
        );
        fixture.downloadUrl = downloadUrl;
        fixture.downloadProvider = downloadProvider;
        return fixture;
    }

    test("installSQLToolsService should download and decompress the service and update the status", async () => {
        let fixture: IFixture = {
            downloadUrl: undefined,
            downloadProvider: undefined,
            downloadResult: Promise.resolve(),
            decompressResult: Promise.resolve(),
        };

        fixture = await createDownloadProvider(fixture);
        await fixture.downloadProvider!.installSQLToolsService(Runtime.Windows_64);

        expect(testHttpClient.downloadFile).to.have.been.calledOnce;
        expect(testHttpClient.downloadFile.firstCall.args[0]).to.equal(fixture.downloadUrl);
        expect(testDecompressProvider.decompress).to.have.been.calledOnce;
        expect(statusViewStubs.installingService).to.have.been.calledOnce;
        expect(statusViewStubs.serviceInstalled).to.have.been.calledOnce;
    });

    // @cssuh 10/22 - commented this test because it was throwing some random undefined errors
    test.skip("installSQLToolsService should not call decompress if download fails", async () => {
        let fixture: IFixture = {
            downloadUrl: undefined,
            downloadProvider: undefined,
            downloadResult: Promise.reject("download failed"),
            decompressResult: Promise.resolve(),
        };

        fixture = await createDownloadProvider(fixture);
        return fixture.downloadProvider!.installSQLToolsService(Runtime.Windows_64).catch((_) => {
            expect(testHttpClient.downloadFile).to.have.been.calledOnce;
            expect(testHttpClient.downloadFile.firstCall.args[0]).to.equal(fixture.downloadUrl);
            expect(testDecompressProvider.decompress).to.not.have.been.called;
            expect(statusViewStubs.installingService).to.not.have.been.called;
            expect(statusViewStubs.serviceInstalled).to.not.have.been.called;
        });
    });

    test.skip("installSQLToolsService should not update status to installed decompress fails", async () => {
        let fixture: IFixture = {
            downloadUrl: undefined,
            downloadProvider: undefined,
            downloadResult: Promise.resolve(),
            decompressResult: Promise.reject("download failed"),
        };

        fixture = await createDownloadProvider(fixture);
        return fixture.downloadProvider!.installSQLToolsService(Runtime.Windows_64).catch((_) => {
            expect(testHttpClient.downloadFile).to.have.been.calledOnce;
            expect(testHttpClient.downloadFile.firstCall.args[0]).to.equal(fixture.downloadUrl);
            expect(testDecompressProvider.decompress).to.have.been.calledOnce;
            expect(statusViewStubs.installingService).to.have.been.calledOnce;
            expect(statusViewStubs.serviceInstalled).to.not.have.been.called;
        });
    });
});
