/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as chai from "chai";
import { IStatusView } from "../../src/languageservice/interfaces";
import ServiceDownloadProvider from "../../src/languageservice/serviceDownloadProvider";
import DownloadHelper from "../../src/languageservice/downloadHelper";
import DecompressProvider from "../../src/languageservice/decompressProvider";
import ConfigUtils from "../../src/configurations/configUtils";
import { Runtime } from "../../src/models/platform";
import * as path from "path";
import { Logger } from "../../src/models/logger";
import * as fs from "fs/promises";
import { expect } from "chai";
import { ServerStatusView } from "../../src/languageservice/serverStatus";
import * as signatureVerifier from "../../src/languageservice/signatureVerifier";

chai.use(sinonChai);

interface IFixture {
    downloadUrl?: string;
    downloadProvider?: ServiceDownloadProvider;
    downloadResult: Promise<void>;
    decompressResult: Promise<void>;
}

suite("ServiceDownloadProvider Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let config: sinon.SinonStubbedInstance<ConfigUtils>;
    let statusView: sinon.SinonStubbedInstance<IStatusView>;
    let testDownloadHelper: sinon.SinonStubbedInstance<DownloadHelper>;
    let testDecompressProvider: sinon.SinonStubbedInstance<DecompressProvider>;
    let testLogger: sinon.SinonStubbedInstance<Logger>;

    setup(() => {
        sandbox = sinon.createSandbox();
        config = sandbox.createStubInstance(ConfigUtils);
        statusView = sandbox.createStubInstance(ServerStatusView);
        testDownloadHelper = sandbox.createStubInstance(DownloadHelper);
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
            testLogger,
            statusView,
            testDownloadHelper,
            testDecompressProvider,
        );
        const actual = await downloadProvider.getOrCreateInstallDirectory(Runtime.OSX);
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
            testLogger,
            statusView,
            testDownloadHelper,
            testDecompressProvider,
        );
        const actual = await downloadProvider.getOrCreateInstallDirectory(Runtime.OSX);
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
            testLogger,
            statusView,
            testDownloadHelper,
            testDecompressProvider,
        );
        const actual = await downloadProvider.getOrCreateInstallDirectory(Runtime.OSX);
        expect(actual).to.equal(expected);
    });

    async function createDownloadProvider(fixture: IFixture): Promise<IFixture> {
        const fileName = "fileName";
        const baseDownloadUrl = "baseDownloadUrl/{#version#}/{#fileName#}";
        const version = "1.0.0";
        const installFolder = path.join(__dirname, "testService");
        const fileNamesJson = { Windows_64: fileName };
        const downloadUrl = "baseDownloadUrl/1.0.0/fileName";
        await fs.rm(installFolder, { recursive: true, force: true });

        config.getSqlToolsInstallDirectory.returns(installFolder);
        config.getSqlToolsConfigValue.withArgs("downloadFileNames").returns(fileNamesJson);
        config.getSqlToolsServiceDownloadUrl.returns(baseDownloadUrl);
        config.getSqlToolsPackageVersion.returns(version);
        testLogger.append.returns();
        testLogger.appendLine.returns();

        testDecompressProvider.decompress.callsFake(() => {
            return fixture.decompressResult;
        });
        testDownloadHelper.downloadFile.callsFake(() => {
            return fixture.downloadResult;
        });
        // Stub out signature verification by default — unit tests should not shell out to
        // PowerShell or codesign. Individual tests that specifically test validation behaviour
        // replace this stub as needed.
        sandbox.stub(signatureVerifier, "validateExtractedBinaries").resolves();
        const downloadProvider = new ServiceDownloadProvider(
            config,
            testLogger,
            statusView,
            testDownloadHelper,
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
        await fixture.downloadProvider!.downloadAndInstallService(Runtime.Windows_64);

        expect(testDownloadHelper.downloadFile).to.have.been.calledWith(fixture.downloadUrl);
        expect(testDecompressProvider.decompress).to.have.been.called;
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
        return fixture
            .downloadProvider!.downloadAndInstallService(Runtime.Windows_64)
            .catch((_) => {
                expect(testDownloadHelper.downloadFile).to.have.been.calledWith(
                    fixture.downloadUrl,
                );
                expect(testDecompressProvider.decompress).to.not.have.been.called;
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
        return fixture
            .downloadProvider!.downloadAndInstallService(Runtime.Windows_64)
            .catch((_) => {
                expect(testDownloadHelper.downloadFile).to.have.been.calledWith(
                    fixture.downloadUrl,
                );
                expect(testDecompressProvider.decompress).to.have.been.called;
            });
    });

    test("installSQLToolsService should delete install directory and throw when signature validation fails", async () => {
        let fixture: IFixture = {
            downloadUrl: undefined,
            downloadProvider: undefined,
            downloadResult: Promise.resolve(),
            decompressResult: Promise.resolve(),
        };

        fixture = await createDownloadProvider(fixture);

        // Stub signature validation to simulate a failure.
        sandbox
            .stub(signatureVerifier, "validateExtractedBinaries")
            .rejects(new Error("Signature is not valid for MicrosoftSqlToolsServiceLayer.exe"));

        // Stub fs.rm to verify it is called with the install directory.
        const rmStub = sandbox.stub(fs, "rm").resolves();

        try {
            await fixture.downloadProvider!.downloadAndInstallService(Runtime.Windows_64);
            expect.fail("Expected an error to be thrown");
        } catch (err: any) {
            expect(err.message).to.include("did not pass Microsoft signature validation");
            expect(err.message).to.include("removed for safety");
        }

        expect(rmStub).to.have.been.calledWithMatch(
            sinon.match.any,
            sinon.match({ recursive: true, force: true }),
        );
    });
});
