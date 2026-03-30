/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as chai from "chai";
import { expect } from "chai";
import * as vscode from "vscode";
import * as Constants from "../../src/constants/constants";
import { ServiceClient as ServiceClientLoc } from "../../src/constants/locConstants";
import ServerProvider from "../../src/languageservice/server";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import DotnetRuntimeProvider from "../../src/languageservice/dotnetRuntimeProvider";
import { Logger } from "../../src/models/logger";
import { PlatformInformation, Runtime } from "../../src/models/platform";
import StatusView from "../../src/views/statusView";
import * as LanguageServiceContracts from "../../src/models/contracts/languageService";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { stubTelemetry, stubVscodeWrapper } from "./utils";

chai.use(sinonChai);

interface IFixture {
    platformInfo: PlatformInformation;
    platformServerPath?: string;
    portableServerPath?: string;
    downloadedPortableServerPath?: string;
    downloadedPlatformServerPath?: string;
}

interface ILaunchAttempt {
    serverFolder: string;
    runtime: Runtime;
    context: vscode.ExtensionContext | undefined;
}

suite("Service Client tests", () => {
    let sandbox: sinon.SinonSandbox;
    let testServiceProvider: sinon.SinonStubbedInstance<ServerProvider>;
    let logger: sinon.SinonStubbedInstance<Logger>;
    let testStatusView: sinon.SinonStubbedInstance<StatusView>;
    let vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let dotnetRuntimeProvider: sinon.SinonStubbedInstance<DotnetRuntimeProvider>;
    let originalStsOverride: string | undefined;

    setup(() => {
        sandbox = sinon.createSandbox();
        testServiceProvider = sandbox.createStubInstance(ServerProvider);
        logger = sandbox.createStubInstance(Logger);
        testStatusView = sandbox.createStubInstance(StatusView);
        vscodeWrapper = stubVscodeWrapper(sandbox);
        dotnetRuntimeProvider = sandbox.createStubInstance(DotnetRuntimeProvider);
        stubTelemetry(sandbox);
        originalStsOverride = process.env.MSSQL_SQLTOOLSSERVICE;
        delete process.env.MSSQL_SQLTOOLSSERVICE;
    });

    teardown(() => {
        if (originalStsOverride === undefined) {
            delete process.env.MSSQL_SQLTOOLSSERVICE;
        } else {
            process.env.MSSQL_SQLTOOLSSERVICE = originalStsOverride;
        }
        sandbox.restore();
    });

    function createServiceClient(): SqlToolsServiceClient {
        return new SqlToolsServiceClient(
            testServiceProvider,
            logger,
            testStatusView,
            vscodeWrapper,
            dotnetRuntimeProvider,
        );
    }

    function setupMocks(fixture: IFixture): void {
        testServiceProvider.tryGetServerInstallFolder.callsFake(async (runtime: Runtime) => {
            switch (runtime) {
                case fixture.platformInfo.runtimeId:
                    return fixture.platformServerPath;
                case Runtime.Portable:
                    return fixture.portableServerPath;
                default:
                    return undefined;
            }
        });

        testServiceProvider.downloadAndGetServerInstallFolder.callsFake(
            async (runtime: Runtime) => {
                switch (runtime) {
                    case Runtime.Portable:
                        if (fixture.downloadedPortableServerPath === undefined) {
                            throw new Error(
                                "downloadServerFiles should not be called for portable",
                            );
                        }
                        return fixture.downloadedPortableServerPath;
                    case fixture.platformInfo.runtimeId:
                        if (fixture.downloadedPlatformServerPath === undefined) {
                            throw new Error(
                                "downloadServerFiles should not be called for platform",
                            );
                        }
                        return fixture.downloadedPlatformServerPath;
                    default:
                        throw new Error(`Unexpected runtime: ${runtime}`);
                }
            },
        );
    }

    function stubLaunches(
        serviceClient: SqlToolsServiceClient,
        launchImpl?: (attempt: ILaunchAttempt) => Promise<void>,
    ): sinon.SinonStub {
        const mockClient = {
            onReady: sandbox.stub().resolves(),
        };

        return sandbox
            .stub(serviceClient as never, "initializeLanguageClient" as never)
            .callsFake(
                async (
                    serverFolder: string,
                    runtime: Runtime,
                    context: vscode.ExtensionContext | undefined,
                ) => {
                    if (launchImpl) {
                        await launchImpl({ serverFolder, runtime, context });
                    }
                    (serviceClient as unknown as { _client: typeof mockClient })._client =
                        mockClient;
                },
            );
    }

    suite("initializeForPlatform", () => {
        test("throws for unsupported platforms before trying to launch", async () => {
            const fixture: IFixture = {
                platformInfo: new PlatformInformation("invalid platform", "x86_64", undefined),
            };

            setupMocks(fixture);
            const serviceClient = createServiceClient();

            try {
                await serviceClient.initializeForPlatform(fixture.platformInfo, undefined);
                expect.fail("Expected initializeForPlatform to throw for an invalid platform");
            } catch (error) {
                expect((error as Error).message).to.equal(
                    "Unsupported platform: invalid platform and architecture: x86_64",
                );
            }

            expect(testServiceProvider.tryGetServerInstallFolder.notCalled).to.be.true;
            expect(testServiceProvider.downloadAndGetServerInstallFolder.notCalled).to.be.true;
        });

        test("uses the STS override path and skips install lookup", async () => {
            const fixture: IFixture = {
                platformInfo: new PlatformInformation("win32", "x86_64", undefined),
            };
            process.env.MSSQL_SQLTOOLSSERVICE = "/tmp/sqltools-override";

            setupMocks(fixture);
            const serviceClient = createServiceClient();
            const launchStub = stubLaunches(serviceClient);

            await serviceClient.initializeForPlatform(fixture.platformInfo, undefined);

            expect(serviceClient.sqlToolsServicePath).to.equal("/tmp/sqltools-override");
            expect(launchStub).to.have.been.calledWithMatch(
                "/tmp/sqltools-override",
                Runtime.Portable,
                undefined,
            );
            expect(testServiceProvider.tryGetServerInstallFolder.notCalled).to.be.true;
            expect(testServiceProvider.downloadAndGetServerInstallFolder.notCalled).to.be.true;
        });

        test("does not fall back when the STS override path fails", async () => {
            const fixture: IFixture = {
                platformServerPath: "installed-platform-service",
                downloadedPortableServerPath: "downloaded-portable-service",
                downloadedPlatformServerPath: "downloaded-platform-service",
                platformInfo: new PlatformInformation("win32", "x86_64", undefined),
            };
            process.env.MSSQL_SQLTOOLSSERVICE = "/tmp/sqltools-override";

            setupMocks(fixture);
            const serviceClient = createServiceClient();
            stubLaunches(serviceClient, async (attempt) => {
                if (attempt.serverFolder === "/tmp/sqltools-override") {
                    throw new Error("override launch failed");
                }
            });

            try {
                await serviceClient.initializeForPlatform(fixture.platformInfo, undefined);
                expect.fail("Expected initializeForPlatform to rethrow the override failure");
            } catch (error) {
                expect((error as Error).message).to.equal("override launch failed");
            }

            expect(testServiceProvider.tryGetServerInstallFolder.notCalled).to.be.true;
            expect(testServiceProvider.downloadAndGetServerInstallFolder.notCalled).to.be.true;
        });

        test("uses the installed platform service before any portable fallback", async () => {
            const fixture: IFixture = {
                platformServerPath: "installed-platform-service",
                portableServerPath: "installed-portable-service",
                downloadedPortableServerPath: "downloaded-portable-service",
                platformInfo: new PlatformInformation("win32", "x86_64", undefined),
            };

            setupMocks(fixture);
            const serviceClient = createServiceClient();
            const launchStub = stubLaunches(serviceClient);

            await serviceClient.initializeForPlatform(fixture.platformInfo, undefined);

            expect(serviceClient.sqlToolsServicePath).to.equal("installed-platform-service");
            expect(launchStub).to.have.been.calledWithMatch(
                "installed-platform-service",
                Runtime.Windows_64,
                undefined,
            );
            expect(testServiceProvider.tryGetServerInstallFolder.calledWith(Runtime.Windows_64)).to
                .be.true;
            expect(testServiceProvider.downloadAndGetServerInstallFolder.notCalled).to.be.true;
        });

        test("falls back to an installed portable service when the platform service is missing", async () => {
            const fixture: IFixture = {
                portableServerPath: "installed-portable-service",
                platformInfo: new PlatformInformation("win32", "x86_64", undefined),
            };

            setupMocks(fixture);
            const serviceClient = createServiceClient();
            const launchStub = stubLaunches(serviceClient);

            await serviceClient.initializeForPlatform(fixture.platformInfo, undefined);

            expect(serviceClient.sqlToolsServicePath).to.equal("installed-portable-service");
            expect(launchStub).to.have.been.calledWithMatch(
                "installed-portable-service",
                Runtime.Portable,
                undefined,
            );
            expect(testServiceProvider.tryGetServerInstallFolder.calledWith(Runtime.Portable)).to.be
                .true;
            expect(testServiceProvider.downloadAndGetServerInstallFolder.notCalled).to.be.true;
        });

        test("downloads the portable service when nothing is already installed", async () => {
            const fixture: IFixture = {
                downloadedPortableServerPath: "downloaded-portable-service",
                platformInfo: new PlatformInformation("win32", "x86_64", undefined),
            };

            setupMocks(fixture);
            const serviceClient = createServiceClient();
            const launchStub = stubLaunches(serviceClient);

            await serviceClient.initializeForPlatform(fixture.platformInfo, undefined);

            expect(serviceClient.sqlToolsServicePath).to.equal("downloaded-portable-service");
            expect(testServiceProvider.downloadAndGetServerInstallFolder).to.have.been.calledWith(
                Runtime.Portable,
            );
            expect(launchStub).to.have.been.calledWithMatch(
                "downloaded-portable-service",
                Runtime.Portable,
                undefined,
            );
        });

        test("falls back to downloading the platform service when the portable launch fails", async () => {
            const fixture: IFixture = {
                downloadedPortableServerPath: "downloaded-portable-service",
                downloadedPlatformServerPath: "downloaded-platform-service",
                platformInfo: new PlatformInformation("win32", "x86_64", undefined),
            };

            setupMocks(fixture);
            const serviceClient = createServiceClient();
            const launchStub = stubLaunches(serviceClient, async (attempt) => {
                if (attempt.serverFolder === "downloaded-portable-service") {
                    throw new Error("portable launch failed");
                }
            });

            await serviceClient.initializeForPlatform(fixture.platformInfo, undefined);

            expect(serviceClient.sqlToolsServicePath).to.equal("downloaded-platform-service");
            expect(testServiceProvider.downloadAndGetServerInstallFolder).to.have.been.calledWith(
                Runtime.Portable,
            );
            expect(testServiceProvider.downloadAndGetServerInstallFolder).to.have.been.calledWith(
                Runtime.Windows_64,
            );
            expect(launchStub).to.have.been.calledWithMatch(
                "downloaded-platform-service",
                Runtime.Windows_64,
                undefined,
            );
        });

        test("shows the offline VSIX link prompt and opens the offline download when every launch strategy fails", async () => {
            const fixture: IFixture = {
                platformInfo: new PlatformInformation("win32", "x86_64", undefined),
            };
            const showErrorMessageStub = sandbox.stub(
                vscode.window,
                "showErrorMessage",
            ) as sinon.SinonStub;
            showErrorMessageStub.resolves(ServiceClientLoc.downloadOfflineVsix);
            const openExternalStub = sandbox.stub(vscode.env, "openExternal").resolves(true);

            setupMocks(fixture);
            const serviceClient = createServiceClient();

            try {
                await serviceClient.initializeForPlatform(fixture.platformInfo, undefined);
                expect.fail(
                    "Expected initializeForPlatform to throw when all launch strategies fail",
                );
            } catch (error) {
                expect((error as Error).message).to.contain(
                    "downloadServerFiles should not be called for platform",
                );
            }

            expect(showErrorMessageStub).to.have.been.calledWithMatch(
                sinon.match("downloadServerFiles should not be called for platform"),
                ServiceClientLoc.downloadOfflineVsix,
                ServiceClientLoc.copyLinkToClipboard,
            );
            expect(openExternalStub).to.have.been.calledWith(
                sinon.match((uri: vscode.Uri) => uri.toString() === Constants.offlineVsixUrl),
            );
        });
    });

    suite("launchCommandAndArgs", () => {
        test("uses the acquired dotnet runtime for dll services", async () => {
            const serviceClient = createServiceClient();
            dotnetRuntimeProvider.acquireDotnetRuntime.resolves("/usr/local/bin/dotnet");

            const launchInfo = await (
                serviceClient as unknown as {
                    launchCommandAndArgs(
                        executablePath: string,
                    ): Promise<{ command: string; args: string[] }>;
                }
            ).launchCommandAndArgs("MicrosoftSqlToolsServiceLayer.dll");

            expect(launchInfo).to.deep.equal({
                command: "/usr/local/bin/dotnet",
                args: ["MicrosoftSqlToolsServiceLayer.dll"],
            });
        });

        test("uses the executable path directly for self-contained services", async () => {
            const serviceClient = createServiceClient();

            const launchInfo = await (
                serviceClient as unknown as {
                    launchCommandAndArgs(
                        executablePath: string,
                    ): Promise<{ command: string; args: string[] }>;
                }
            ).launchCommandAndArgs("/tmp/MicrosoftSqlToolsServiceLayer");

            expect(launchInfo).to.deep.equal({
                command: "/tmp/MicrosoftSqlToolsServiceLayer",
                args: [],
            });
            expect(dotnetRuntimeProvider.acquireDotnetRuntime.notCalled).to.be.true;
        });

        test("rethrows dotnet runtime acquisition failures without wrapping", async () => {
            const serviceClient = createServiceClient();
            dotnetRuntimeProvider.acquireDotnetRuntime.rejects(new Error("runtime missing"));

            try {
                await (
                    serviceClient as unknown as {
                        launchCommandAndArgs(
                            executablePath: string,
                        ): Promise<{ command: string; args: string[] }>;
                    }
                ).launchCommandAndArgs("MicrosoftSqlToolsServiceLayer.dll");
                expect.fail("Expected launchCommandAndArgs to throw when dotnet acquisition fails");
            } catch (error) {
                expect((error as Error).message).to.equal("runtime missing");
            }
        });
    });

    test("handleLanguageServiceStatusNotification should change the UI status", () => {
        const testFile = "file:///my/test/file.sql";
        const status = "new status";
        const serviceClient = createServiceClient();
        const statusChangeParams = new LanguageServiceContracts.StatusChangeParams();
        statusChangeParams.ownerUri = testFile;
        statusChangeParams.status = status;

        serviceClient.handleLanguageServiceStatusNotification()(statusChangeParams);

        expect(testStatusView.languageServiceStatusChanged).to.have.been.calledWithExactly(
            testFile,
            status,
        );
    });
});
