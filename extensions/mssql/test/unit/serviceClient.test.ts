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
import {
    Common as CommonLoc,
    Formatter as FormatterLoc,
    ServiceClient as ServiceClientLoc,
} from "../../src/constants/locConstants";
import ServerProvider from "../../src/languageservice/server";
import SqlToolsServiceClient, {
    configureSqlDataPlaneLaunchArgs,
    MINIMUM_STS2_SERVICE_VERSION,
    supportsSqlDataPlaneLaunch,
} from "../../src/languageservice/serviceclient";
import DotnetRuntimeProvider from "../../src/languageservice/dotnetRuntimeProvider";
import { PlatformInformation, Runtime } from "../../src/models/platform";
import StatusView from "../../src/views/statusView";
import * as LanguageServiceContracts from "../../src/models/contracts/languageService";
import { Logger } from "../../src/models/logger";
import { TelemetryActions, TelemetryViews } from "../../src/sharedInterfaces/telemetry";
import { stubMessageBoxes, stubTelemetry, stubVscodeEnv } from "./utils";
import {
    LanguageClient,
    DidOpenTextDocumentNotification,
    DidChangeTextDocumentNotification,
    DidCloseTextDocumentNotification,
    CompletionRequest,
    HoverRequest,
    SignatureHelpRequest,
} from "vscode-languageclient/node";

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
    let testStatusView: sinon.SinonStubbedInstance<StatusView>;
    let loggerShowStub: sinon.SinonStub;
    let loggerErrorStub: sinon.SinonStub;
    let dotnetRuntimeProvider: sinon.SinonStubbedInstance<DotnetRuntimeProvider>;
    let sendActionEvent: sinon.SinonStub;
    let originalStsOverride: string | undefined;

    setup(() => {
        sandbox = sinon.createSandbox();
        testServiceProvider = sandbox.createStubInstance(ServerProvider);
        testStatusView = sandbox.createStubInstance(StatusView);
        loggerShowStub = sandbox.stub(Logger.prototype, "show");
        loggerErrorStub = sandbox.stub(Logger.prototype, "error");
        dotnetRuntimeProvider = sandbox.createStubInstance(DotnetRuntimeProvider);
        ({ sendActionEvent } = stubTelemetry(sandbox));
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
            testStatusView,
            dotnetRuntimeProvider,
        );
    }

    suite("embedded notebook SQL documents", () => {
        test("synchronizes a private SQL document without opening an editor", async () => {
            const languageClient = sandbox.createStubInstance(LanguageClient);
            languageClient.isRunning.returns(true);
            languageClient.sendNotification.resolves();
            sandbox
                .stub(languageClient, "onDidChangeState")
                .get(() => () => new vscode.Disposable(() => undefined));
            const service = createServiceClient();
            service["client"] = languageClient;
            const uri = vscode.Uri.parse("mssql-python-notebook-sql:/owned.sql");
            const opened = sandbox.stub(vscode.workspace, "openTextDocument");
            const document = await service.openEmbeddedSqlDocument(uri, "SELECT 1", 1);
            await document.update("SELECT 2", 2);
            document.dispose();
            expect(languageClient.sendNotification).to.have.been.calledWith(
                DidOpenTextDocumentNotification.type,
                {
                    textDocument: {
                        uri: uri.toString(),
                        languageId: "sql",
                        version: 1,
                        text: "SELECT 1",
                    },
                },
            );
            expect(languageClient.sendNotification).to.have.been.calledWith(
                DidChangeTextDocumentNotification.type,
                {
                    textDocument: { uri: uri.toString(), version: 2 },
                    contentChanges: [
                        {
                            range: {
                                start: { line: 0, character: 0 },
                                end: { line: 0, character: 8 },
                            },
                            text: "SELECT 2",
                        },
                    ],
                },
            );
            expect(languageClient.sendNotification).to.have.been.calledWith(
                DidCloseTextDocumentNotification.type,
                { textDocument: { uri: uri.toString() } },
            );
            expect(opened).not.to.have.been.called;
        });

        test("tracks replacement ranges across multiline, UTF-16, and empty projections", async () => {
            const languageClient = sandbox.createStubInstance(LanguageClient);
            languageClient.isRunning.returns(true);
            languageClient.sendNotification.resolves();
            sandbox
                .stub(languageClient, "onDidChangeState")
                .get(() => () => new vscode.Disposable(() => undefined));
            const service = createServiceClient();
            service["client"] = languageClient;
            const uri = vscode.Uri.parse("mssql-python-notebook-sql:/changing.sql");
            const document = await service.openEmbeddedSqlDocument(
                uri,
                "\r\nSELECT N'\u{1f680}'",
                1,
            );
            const changes = [
                { text: "\nSELECT 2\n", end: { line: 1, character: 12 } },
                { text: "", end: { line: 2, character: 0 } },
                { text: "SELECT 3", end: { line: 0, character: 0 } },
                { text: "\nSELECT 4", end: { line: 0, character: 8 } },
            ];
            try {
                for (const [index, change] of changes.entries()) {
                    await document.update("obsolete text", 1);
                    await document.update(change.text, index + 2);
                    expect(languageClient.sendNotification).to.have.been.calledWith(
                        DidChangeTextDocumentNotification.type,
                        {
                            textDocument: { uri: uri.toString(), version: index + 2 },
                            contentChanges: [
                                {
                                    range: {
                                        start: { line: 0, character: 0 },
                                        end: change.end,
                                    },
                                    text: change.text,
                                },
                            ],
                        },
                    );
                }
            } finally {
                document.dispose();
            }
        });

        test("forwards cancellation and maps completion and signature trigger kinds", async () => {
            const languageClient = sandbox.createStubInstance(LanguageClient);
            languageClient.isRunning.returns(true);
            languageClient.sendNotification.resolves();
            sandbox
                .stub(languageClient, "onDidChangeState")
                .get(() => () => new vscode.Disposable(() => undefined));
            languageClient.sendRequest.resolves(null);
            const service = createServiceClient();
            service["client"] = languageClient;
            const uri = vscode.Uri.parse("mssql-python-notebook-sql:/requests.sql");
            const document = await service.openEmbeddedSqlDocument(uri, "\nSELECT ", 1);
            const source = new vscode.CancellationTokenSource();
            try {
                await document.completion(
                    new vscode.Position(1, 7),
                    {
                        triggerKind: vscode.CompletionTriggerKind.Invoke,
                        triggerCharacter: undefined,
                    },
                    source.token,
                );
                await document.hover(new vscode.Position(1, 2), source.token);
                await document.signatureHelp(
                    new vscode.Position(1, 7),
                    {
                        triggerKind: vscode.SignatureHelpTriggerKind.Invoke,
                        isRetrigger: false,
                        triggerCharacter: undefined,
                        activeSignatureHelp: undefined,
                    },
                    source.token,
                );
                for (const type of [
                    CompletionRequest.type,
                    HoverRequest.type,
                    SignatureHelpRequest.type,
                ]) {
                    expect(languageClient.sendRequest).to.have.been.calledWith(
                        type,
                        sinon.match({ textDocument: { uri: uri.toString() } }),
                        source.token,
                    );
                }
                expect(languageClient.sendRequest).to.have.been.calledWith(
                    CompletionRequest.type,
                    sinon.match({ context: { triggerKind: 1 } }),
                    source.token,
                );
                expect(languageClient.sendRequest).to.have.been.calledWith(
                    SignatureHelpRequest.type,
                    sinon.match({ context: { triggerKind: 1 } }),
                    source.token,
                );
                await document.completion(
                    new vscode.Position(1, 7),
                    {
                        triggerKind: vscode.CompletionTriggerKind.TriggerCharacter,
                        triggerCharacter: ".",
                    },
                    source.token,
                );
                await document.signatureHelp(
                    new vscode.Position(1, 7),
                    {
                        triggerKind: vscode.SignatureHelpTriggerKind.TriggerCharacter,
                        triggerCharacter: ",",
                        isRetrigger: true,
                        activeSignatureHelp: undefined,
                    },
                    source.token,
                );
                expect(languageClient.sendRequest).to.have.been.calledWith(
                    CompletionRequest.type,
                    sinon.match({ context: { triggerKind: 2, triggerCharacter: "." } }),
                    source.token,
                );
                expect(languageClient.sendRequest).to.have.been.calledWith(
                    SignatureHelpRequest.type,
                    sinon.match({
                        context: { triggerKind: 2, triggerCharacter: ",", isRetrigger: true },
                    }),
                    source.token,
                );
            } finally {
                document.dispose();
                source.dispose();
            }
        });

        test("converts rich SQL authoring results without losing insertion or parameter metadata", async () => {
            const languageClient = sandbox.createStubInstance(LanguageClient);
            languageClient.isRunning.returns(true);
            languageClient.sendNotification.resolves();
            sandbox
                .stub(languageClient, "onDidChangeState")
                .get(() => () => new vscode.Disposable(() => undefined));
            const converters = new LanguageClient(
                "notebook-test",
                "Notebook Test",
                { command: "unused" },
                { documentSelector: [] },
            );
            sandbox
                .stub(languageClient, "protocol2CodeConverter")
                .get(() => converters.protocol2CodeConverter);
            const range = { start: { line: 1, character: 7 }, end: { line: 1, character: 8 } };
            languageClient.sendRequest.withArgs(sinon.match.same(CompletionRequest.type)).resolves({
                isIncomplete: true,
                items: [
                    {
                        label: "catalog_column",
                        detail: "int",
                        kind: 5,
                        insertTextFormat: 2,
                        textEdit: { newText: "${1:catalog_column}", insert: range, replace: range },
                        commitCharacters: [","],
                        data: { owner: "private" },
                    },
                ],
            });
            languageClient.sendRequest.withArgs(sinon.match.same(HoverRequest.type)).resolves({
                contents: { kind: "markdown", value: "**catalog_column** int" },
                range,
            });
            languageClient.sendRequest
                .withArgs(sinon.match.same(SignatureHelpRequest.type))
                .resolves({
                    signatures: [
                        {
                            label: "SUBSTRING(expression, start, length)",
                            documentation: null,
                            parameters: [
                                { label: "expression", documentation: null },
                                { label: "start", documentation: null },
                                { label: "length", documentation: null },
                            ],
                        },
                    ],
                    activeSignature: 0,
                    activeParameter: 1,
                });
            const service = createServiceClient();
            service["client"] = languageClient;
            const document = await service.openEmbeddedSqlDocument(
                vscode.Uri.parse("mssql-python-notebook-sql:/rich.sql"),
                "\nSELECT x",
                1,
            );
            const source = new vscode.CancellationTokenSource();
            try {
                const result = await document.completion(
                    new vscode.Position(1, 8),
                    {
                        triggerKind: vscode.CompletionTriggerKind.Invoke,
                        triggerCharacter: undefined,
                    },
                    source.token,
                );
                expect(result).to.be.instanceOf(vscode.CompletionList);
                const list = result as vscode.CompletionList;
                expect(list.isIncomplete).to.equal(true);
                expect(list.items[0].insertText).to.be.instanceOf(vscode.SnippetString);
                expect(list.items[0].range).to.deep.equal({
                    inserting: new vscode.Range(1, 7, 1, 8),
                    replacing: new vscode.Range(1, 7, 1, 8),
                });
                expect(list.items[0].commitCharacters).to.deep.equal([","]);
                const hover = await document.hover(new vscode.Position(1, 8), source.token);
                expect(hover?.range).to.deep.equal(new vscode.Range(1, 7, 1, 8));
                expect((hover?.contents[0] as vscode.MarkdownString).value).to.equal(
                    "**catalog_column** int",
                );
                const signature = await document.signatureHelp(
                    new vscode.Position(1, 8),
                    {
                        triggerKind: vscode.SignatureHelpTriggerKind.Invoke,
                        triggerCharacter: undefined,
                        isRetrigger: false,
                        activeSignatureHelp: undefined,
                    },
                    source.token,
                );
                expect(signature?.activeParameter).to.equal(1);
                expect(signature?.signatures[0].parameters[1].label).to.equal("start");
            } finally {
                document.dispose();
                source.dispose();
                await converters.dispose();
            }
        });
    });

    function outputChannelShowStub(): sinon.SinonStub {
        return loggerShowStub;
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

    test("forwards SQL Tools Service telemetry", () => {
        const serviceClient = createServiceClient();
        const event: LanguageServiceContracts.SqlToolsServiceTelemetryParams = {
            params: {
                eventName: TelemetryActions.FormatCode,
                properties: { FormatterImplementation: "ScriptDom" },
                measures: { FormatterDurationMs: 12.5 },
            },
        };

        serviceClient.handleSqlToolsServiceTelemetryNotification()(event);

        expect(sendActionEvent).to.have.been.calledWithExactly(
            TelemetryViews.QueryEditor,
            TelemetryActions.FormatCode,
            {
                additionalProps: event.params.properties,
                additionalMeasurements: event.params.measures,
            },
        );
    });

    test("forwards SQL Tools Service telemetry without optional data", () => {
        const serviceClient = createServiceClient();

        serviceClient.handleSqlToolsServiceTelemetryNotification()({
            params: { eventName: TelemetryActions.PeekDefinitionRequested },
        });

        expect(sendActionEvent).to.have.been.calledWithExactly(
            TelemetryViews.QueryEditor,
            TelemetryActions.PeekDefinitionRequested,
            { additionalProps: {}, additionalMeasurements: {} },
        );
    });

    function formattingFailedEvent(): LanguageServiceContracts.FormattingFailedParams {
        return {
            ownerUri: "file:///query.sql",
            formatType: "Document",
            reason: "ParseError",
            parseErrorCount: 1,
        };
    }

    function stubFormatterNotificationConfiguration(enabled = true): sinon.SinonStub {
        const update = sandbox.stub().resolves();
        sandbox.stub(vscode.workspace, "getConfiguration").returns({
            get: sandbox.stub().returns(enabled),
            update,
        } as unknown as vscode.WorkspaceConfiguration);
        return update;
    }

    test("opens formatter feedback from a parse-error notification", async () => {
        const serviceClient = createServiceClient();
        stubFormatterNotificationConfiguration();
        const showWarningMessage = stubMessageBoxes(sandbox).showWarningMessage.resolves(
            FormatterLoc.sendFeedback,
        );
        const openExternal = stubVscodeEnv(sandbox).openExternal.resolves(true);

        await serviceClient.showFormattingFailedNotification(formattingFailedEvent());

        expect(showWarningMessage).to.have.been.calledWith(
            FormatterLoc.parseError,
            FormatterLoc.sendFeedback,
            CommonLoc.dontShowAgain,
        );
        expect(openExternal).to.have.been.calledWith(vscode.Uri.parse(Constants.feedbackUrl));
        expect(sendActionEvent).to.have.been.calledWith(
            TelemetryViews.QueryEditor,
            TelemetryActions.FormatterParseErrorSendFeedback,
        );
    });

    test("persists formatter parse-error notification suppression", async () => {
        const serviceClient = createServiceClient();
        const update = stubFormatterNotificationConfiguration();
        stubMessageBoxes(sandbox).showWarningMessage.resolves(CommonLoc.dontShowAgain);

        await serviceClient.showFormattingFailedNotification(formattingFailedEvent());

        expect(update).to.have.been.calledWith(
            "format.showParseErrorNotification",
            false,
            vscode.ConfigurationTarget.Global,
        );
        expect(sendActionEvent).to.have.been.calledWith(
            TelemetryViews.QueryEditor,
            TelemetryActions.FormatterParseErrorDontShowAgain,
        );
    });

    test("logs formatter notification handling failures", async () => {
        const serviceClient = createServiceClient();
        const error = new Error("notification failed");
        sandbox.stub(serviceClient, "showFormattingFailedNotification").rejects(error);

        serviceClient.handleFormattingFailedNotification()(formattingFailedEvent());
        await new Promise((resolve) => setImmediate(resolve));

        expect(loggerErrorStub).to.have.been.calledWith(
            "Failed to handle formatting failure notification.",
            error.message,
        );
    });

    test("does not show a suppressed formatter parse-error notification", async () => {
        const serviceClient = createServiceClient();
        stubFormatterNotificationConfiguration(false);
        const showWarningMessage = stubMessageBoxes(sandbox).showWarningMessage;

        await serviceClient.showFormattingFailedNotification(formattingFailedEvent());

        expect(showWarningMessage).not.to.have.been.called;
    });

    test("allows only one formatter parse-error prompt at a time", async () => {
        const serviceClient = createServiceClient();
        stubFormatterNotificationConfiguration();
        let resolvePrompt: (action: string | undefined) => void;
        const promptResult = new Promise<string | undefined>((resolve) => {
            resolvePrompt = resolve;
        });
        const showWarningMessage =
            stubMessageBoxes(sandbox).showWarningMessage.returns(promptResult);

        const firstPrompt = serviceClient.showFormattingFailedNotification(formattingFailedEvent());
        const secondPrompt =
            serviceClient.showFormattingFailedNotification(formattingFailedEvent());

        expect(showWarningMessage).to.have.been.calledOnce;
        resolvePrompt(undefined);
        await Promise.all([firstPrompt, secondPrompt]);
    });

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
            expect(outputChannelShowStub()).to.not.have.been.called;
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
            expect(outputChannelShowStub()).to.have.been.calledWith(true);
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
            const openExternalStub = stubVscodeEnv(sandbox).openExternal.resolves(true);

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
            expect(outputChannelShowStub()).to.have.been.calledWith(true);
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
            expect(dotnetRuntimeProvider.acquireDotnetRuntime).to.have.been.calledWith(
                "MicrosoftSqlToolsServiceLayer.runtimeconfig.json",
            );
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

    suite("SQL Data Plane launch arguments", () => {
        test("does not enable STS v2 by default", () => {
            const args = ["--parallel-message-processing"];

            configureSqlDataPlaneLaunchArgs(args, false);

            expect(args).to.deep.equal(["--parallel-message-processing"]);
        });

        test("enables the STS v2 lane when the preview and compatible service are enabled", () => {
            const args = ["--parallel-message-processing"];

            configureSqlDataPlaneLaunchArgs(args, true, MINIMUM_STS2_SERVICE_VERSION);

            expect(args).to.deep.equal(["--parallel-message-processing", "--enable-sts2"]);
        });

        test("does not pass the STS v2 flag to an older service that would reject it", () => {
            const args = ["--parallel-message-processing"];

            configureSqlDataPlaneLaunchArgs(args, true, "6.0.20260810.1");

            expect(args).to.deep.equal(["--parallel-message-processing"]);
        });

        test("compares generated STS versions numerically", () => {
            expect(supportsSqlDataPlaneLaunch("6.0.20260825.2")).to.equal(true);
            expect(supportsSqlDataPlaneLaunch("6.0.20260825.10")).to.equal(true);
            expect(supportsSqlDataPlaneLaunch("6.0.20260825.1")).to.equal(false);
            expect(supportsSqlDataPlaneLaunch("not-a-version")).to.equal(false);
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
