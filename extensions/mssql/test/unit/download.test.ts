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

chai.use(sinonChai);

interface IFixture {
    downloadUrl?: string;
    downloadProvider?: ServiceDownloadProvider;
    downloadResult: Promise<void>;
    decompressResult: Promise<void>;
}

async function writeRequiredServiceFiles(
    installDirectory: string,
    runtime: Runtime,
): Promise<void> {
    const fileExtension =
        runtime === Runtime.Portable
            ? ".dll"
            : runtime === Runtime.Windows_64 || runtime === Runtime.Windows_ARM64
              ? ".exe"
              : "";

    await fs.writeFile(
        path.join(installDirectory, `MicrosoftSqlToolsServiceLayer${fileExtension}`),
        "",
    );
    await fs.writeFile(
        path.join(installDirectory, `SqlToolsResourceProviderService${fileExtension}`),
        "",
    );
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

    test("tryGetInstallDirectory returns undefined when portable install folder exists but required files are missing", async () => {
        const installRoot = path.join(__dirname, "testServicePortableMissing");
        const installDirectory = path.join(installRoot, "1.0.0", "Portable");

        await fs.rm(installRoot, { recursive: true, force: true });
        try {
            await fs.mkdir(installDirectory, { recursive: true });

            config.getSqlToolsInstallDirectory.returns(
                path.join(installRoot, "{#version#}", "{#platform#}"),
            );
            config.getSqlToolsPackageVersion.returns("1.0.0");

            const downloadProvider = new ServiceDownloadProvider(
                config,
                testLogger,
                statusView,
                testDownloadHelper,
                testDecompressProvider,
            );

            const actual = await downloadProvider.tryGetInstallDirectory(Runtime.Portable);

            expect(actual).to.be.undefined;
        } finally {
            await fs.rm(installRoot, { recursive: true, force: true });
        }
    });

    test("tryGetInstallDirectory returns the folder when portable required files are present", async () => {
        const installRoot = path.join(__dirname, "testServicePortablePresent");
        const installDirectory = path.join(installRoot, "1.0.0", "Portable");

        await fs.rm(installRoot, { recursive: true, force: true });
        try {
            await fs.mkdir(installDirectory, { recursive: true });
            await writeRequiredServiceFiles(installDirectory, Runtime.Portable);

            config.getSqlToolsInstallDirectory.returns(
                path.join(installRoot, "{#version#}", "{#platform#}"),
            );
            config.getSqlToolsPackageVersion.returns("1.0.0");

            const downloadProvider = new ServiceDownloadProvider(
                config,
                testLogger,
                statusView,
                testDownloadHelper,
                testDecompressProvider,
            );

            const actual = await downloadProvider.tryGetInstallDirectory(Runtime.Portable);

            expect(actual).to.equal(installDirectory);
        } finally {
            await fs.rm(installRoot, { recursive: true, force: true });
        }
    });

    test("tryGetInstallDirectory returns the folder when Windows required files are present", async () => {
        const installRoot = path.join(__dirname, "testServiceWindowsPresent");
        const installDirectory = path.join(installRoot, "1.0.0", "Windows");

        await fs.rm(installRoot, { recursive: true, force: true });
        try {
            await fs.mkdir(installDirectory, { recursive: true });
            await writeRequiredServiceFiles(installDirectory, Runtime.Windows_64);

            config.getSqlToolsInstallDirectory.returns(
                path.join(installRoot, "{#version#}", "{#platform#}"),
            );
            config.getSqlToolsPackageVersion.returns("1.0.0");

            const downloadProvider = new ServiceDownloadProvider(
                config,
                testLogger,
                statusView,
                testDownloadHelper,
                testDecompressProvider,
            );

            const actual = await downloadProvider.tryGetInstallDirectory(Runtime.Windows_64);

            expect(actual).to.equal(installDirectory);
        } finally {
            await fs.rm(installRoot, { recursive: true, force: true });
        }
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
});
