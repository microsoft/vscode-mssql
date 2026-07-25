/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as chai from "chai";
import * as tmp from "tmp";
import { IPackage, IStatusView, PackageError } from "../../src/languageservice/interfaces";
import ServiceDownloadProvider from "../../src/languageservice/serviceDownloadProvider";
import DownloadHelper from "../../src/languageservice/downloadHelper";
import DecompressProvider from "../../src/languageservice/decompressProvider";
import ConfigUtils from "../../src/configurations/configUtils";
import { Runtime } from "../../src/models/platform";
import * as path from "path";
import { ILogger } from "../../src/sharedInterfaces/logger";
import * as fs from "fs/promises";
import { expect } from "chai";
import { ServerStatusView } from "../../src/languageservice/serverStatus";
import { createStubLogger } from "./utils";

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
    let testLogger: sinon.SinonStubbedInstance<ILogger>;

    setup(() => {
        sandbox = sinon.createSandbox();
        config = sandbox.createStubInstance(ConfigUtils);
        statusView = sandbox.createStubInstance(ServerStatusView);
        testDownloadHelper = sandbox.createStubInstance(DownloadHelper);
        testDecompressProvider = sandbox.createStubInstance(DecompressProvider);
        testLogger = createStubLogger(sandbox);
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
        testLogger.trace.returns();
        testLogger.info.returns();

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

suite("ServiceDownloadProvider temporary file lifecycle", () => {
    const installFolder = path.join(__dirname, "testServiceTempLifecycle");

    async function captureError(action: () => Promise<unknown>): Promise<Error | undefined> {
        try {
            await action();
            return undefined;
        } catch (error) {
            return error as Error;
        }
    }

    let sandbox: sinon.SinonSandbox;
    let config: sinon.SinonStubbedInstance<ConfigUtils>;
    let statusView: sinon.SinonStubbedInstance<IStatusView>;
    let testDownloadHelper: sinon.SinonStubbedInstance<DownloadHelper>;
    let testDecompressProvider: sinon.SinonStubbedInstance<DecompressProvider>;
    let testLogger: sinon.SinonStubbedInstance<ILogger>;
    let removeCallback: sinon.SinonStub;
    let downloadProvider: ServiceDownloadProvider;

    setup(async () => {
        sandbox = sinon.createSandbox();
        config = sandbox.createStubInstance(ConfigUtils);
        statusView = sandbox.createStubInstance(ServerStatusView);
        testDownloadHelper = sandbox.createStubInstance(DownloadHelper);
        testDecompressProvider = sandbox.createStubInstance(DecompressProvider);
        testLogger = createStubLogger(sandbox);
        removeCallback = sandbox.stub();

        await fs.rm(installFolder, { recursive: true, force: true });

        config.getSqlToolsInstallDirectory.returns(installFolder);
        config.getSqlToolsConfigValue
            .withArgs("downloadFileNames")
            .returns({ Windows_64: "fileName.zip" });
        config.getSqlToolsServiceDownloadUrl.returns("baseDownloadUrl/{#version#}/{#fileName#}");
        config.getSqlToolsPackageVersion.returns("1.0.0");

        // Descriptor 0 is a valid descriptor, so it is used here to guard against falsy checks.
        sandbox.stub(tmp, "file").callsFake(((
            _options: tmp.Options,
            callback: (err: unknown, path: string, fd: number, cleanupCallback: () => void) => void,
        ) => {
            callback(undefined, path.join(installFolder, "package-temp"), 0, removeCallback);
        }) as typeof tmp.file);

        downloadProvider = new ServiceDownloadProvider(
            config,
            testLogger,
            statusView,
            testDownloadHelper,
            testDecompressProvider,
        );
    });

    teardown(async () => {
        sandbox.restore();
        await fs.rm(installFolder, { recursive: true, force: true });
    });

    test("passes the temporary descriptor to the download helper even when it is zero", async () => {
        testDownloadHelper.downloadFile.resolves();
        testDecompressProvider.decompress.resolves();

        await downloadProvider.downloadAndInstallService(Runtime.Windows_64);

        const downloadedPackage = testDownloadHelper.downloadFile.firstCall.args[1] as IPackage;
        expect(testDownloadHelper.downloadFile.firstCall.args[0]).to.equal(
            "baseDownloadUrl/1.0.0/fileName.zip",
        );
        expect(downloadedPackage.installPath).to.equal(installFolder);
    });

    test("removes the temporary package file exactly once after a successful install", async () => {
        testDownloadHelper.downloadFile.resolves();
        testDecompressProvider.decompress.resolves();

        await downloadProvider.downloadAndInstallService(Runtime.Windows_64);

        expect(removeCallback).to.have.been.calledOnce;
    });

    test("clears the package temporary file reference after a successful install", async () => {
        testDownloadHelper.downloadFile.resolves();
        testDecompressProvider.decompress.resolves();

        await downloadProvider.downloadAndInstallService(Runtime.Windows_64);

        const downloadedPackage = testDownloadHelper.downloadFile.firstCall.args[1] as IPackage;
        expect(downloadedPackage.tmpFile).to.be.undefined;
    });

    test("removes the temporary package file when the download fails", async () => {
        testDownloadHelper.downloadFile.rejects(new Error("download failed"));

        const thrownError = await captureError(() =>
            downloadProvider.downloadAndInstallService(Runtime.Windows_64),
        );

        expect(thrownError?.message).to.equal("download failed");
        expect(removeCallback).to.have.been.calledOnce;
        expect(testDecompressProvider.decompress).to.not.have.been.called;
    });

    test("removes the temporary package file after an HTTP non-success response", async () => {
        testDownloadHelper.downloadFile.rejects(new PackageError("404"));

        const thrownError = await captureError(() =>
            downloadProvider.downloadAndInstallService(Runtime.Windows_64),
        );

        expect(thrownError?.message).to.equal("404");
        expect(removeCallback).to.have.been.calledOnce;
        expect(testDecompressProvider.decompress).to.not.have.been.called;
    });

    test("removes the temporary package file after a response-stream failure", async () => {
        testDownloadHelper.downloadFile.rejects(new PackageError("Response error: ECONNRESET"));

        const thrownError = await captureError(() =>
            downloadProvider.downloadAndInstallService(Runtime.Windows_64),
        );

        expect(thrownError?.message).to.equal("Response error: ECONNRESET");
        expect(removeCallback).to.have.been.calledOnce;
        expect(testDecompressProvider.decompress).to.not.have.been.called;
    });

    test("removes the temporary package file when decompression fails", async () => {
        testDownloadHelper.downloadFile.resolves();
        testDecompressProvider.decompress.rejects(new Error("decompress failed"));

        const thrownError = await captureError(() =>
            downloadProvider.downloadAndInstallService(Runtime.Windows_64),
        );

        expect(thrownError?.message).to.equal("decompress failed");
        expect(removeCallback).to.have.been.calledOnce;
    });

    test("logs a warning and still succeeds when temporary file cleanup throws", async () => {
        testDownloadHelper.downloadFile.resolves();
        testDecompressProvider.decompress.resolves();
        removeCallback.throws(new Error("cleanup failed"));

        const actual = await downloadProvider.downloadAndInstallService(Runtime.Windows_64);

        expect(actual).to.be.true;
        expect(testLogger.warn).to.have.been.calledWithMatch("cleanup failed");
    });
});
