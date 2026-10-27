/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import "mocha";
import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
import { IExtension } from "vscode-mssql";
import MainController from "../../src/controllers/mainController";
import ConnectionManager from "../../src/controllers/connectionManager";
import * as Extension from "../../src/extension";
import { stubExtensionContext } from "./utils";
import { OverviewWebviewController } from "../../src/controllers/overviewWebviewController";
import * as LocalizationCache from "../../src/controllers/localizationCache";
import { VscodeHttpClient } from "extension-toolkit/vscode";
import { UserSurvey } from "../../src/nps/userSurvey";
import SqlToolsServerClient from "../../src/languageservice/serviceclient";
import * as UriOwnershipInitialization from "../../src/uriOwnership/uriOwnershipInitialization";
import { IconUtils } from "../../src/utils/iconUtils";
import { UriOwnershipCoordinator } from "../../src/uriOwnership/uriOwnershipCore";
import { PrivatePreviewContextKey } from "../../src/previews/previewService";
import { SharedConnectionsService } from "../../src/connectionSharing/sharedConnectionsService";
import * as DataWorkspaceRegistration from "../../src/dataWorkspace/dataWorkspaceRegistration";
import * as DatabaseProjectsExtension from "../../src/databaseProjects/extension";
import * as DatabaseProjectsServiceLocator from "../../src/databaseProjects/serviceLocator";
import { ProjectProviderRegistry } from "../../src/dataWorkspace/common/projectProviderRegistry";
import { IExtension as IDataWorkspaceExtension } from "dataworkspace";

const { expect } = chai;

chai.use(sinonChai);

suite("Extension API Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let context: vscode.ExtensionContext;
    let vscodeMssql: IExtension;
    let mainController: MainController;

    setup(async () => {
        sandbox = sinon.createSandbox();
        context = stubExtensionContext(sandbox, { version: "1.0.0" });

        const disposable = { dispose: sandbox.stub() } as vscode.Disposable;
        // Activation registers the connection-sharing authentication provider, which keeps its
        // session in secret storage.
        (context as { secrets: vscode.SecretStorage }).secrets = {
            get: sandbox.stub().resolves(undefined),
            store: sandbox.stub().resolves(),
            delete: sandbox.stub().resolves(),
            keys: sandbox.stub().resolves([]),
            onDidChange: sandbox.stub().returns(disposable),
        } as unknown as vscode.SecretStorage;
        sandbox.stub(vscode.authentication, "registerAuthenticationProvider").returns(disposable);
        const outputChannel = {
            name: "MSSQL",
            logLevel: vscode.LogLevel.Info,
            onDidChangeLogLevel: sandbox.stub().returns(disposable),
            append: sandbox.stub(),
            appendLine: sandbox.stub(),
            clear: sandbox.stub(),
            show: sandbox.stub(),
            replace: sandbox.stub(),
            hide: sandbox.stub(),
            trace: sandbox.stub(),
            debug: sandbox.stub(),
            info: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
            dispose: sandbox.stub(),
        } as unknown as vscode.LogOutputChannel;
        const configuration = {
            get: sandbox.stub().returns(false),
            update: sandbox.stub().resolves(),
            has: sandbox.stub().returns(false),
            inspect: sandbox.stub().returns(undefined),
        } as unknown as vscode.WorkspaceConfiguration;
        const chatParticipant = {
            dispose: sandbox.stub(),
            onDidReceiveFeedback: sandbox.stub().returns(disposable),
        } as unknown as vscode.ChatParticipant;

        sandbox.stub(vscode.window, "createOutputChannel").returns(outputChannel);
        sandbox.stub(vscode.workspace, "getConfiguration").returns(configuration);
        sandbox.stub(vscode.commands, "executeCommand").resolves(undefined);
        sandbox.stub(vscode.commands, "registerCommand").returns(disposable);
        sandbox.stub(vscode.window, "registerCustomEditorProvider").returns(disposable);
        sandbox.stub(vscode.extensions, "getExtension").returns(undefined);
        sandbox.stub(vscode.chat, "createChatParticipant").returns(chatParticipant);
        sandbox.stub(OverviewWebviewController, "showWelcomeOnExtensionUpdate").resolves();
        sandbox.stub(LocalizationCache, "initializeWebviewLocalizationCache").returns();
        sandbox.stub(IconUtils, "initialize").returns();
        sandbox.stub(UserSurvey, "createInstance").returns();
        sandbox.stub(VscodeHttpClient.prototype, "warnOnInvalidProxySettings").returns();
        sandbox.stub(MainController.prototype, "activate").resolves(true);
        sandbox.stub(DataWorkspaceRegistration, "registerDataWorkspace").returns({
            refreshProjectsTree: sandbox.stub(),
        } as unknown as IDataWorkspaceExtension);
        sandbox.stub(DatabaseProjectsServiceLocator, "initializeDatabaseProjectsServices");
        sandbox
            .stub(DatabaseProjectsExtension, "registerDatabaseProjects")
            .resolves(
                {} as unknown as Awaited<
                    ReturnType<typeof DatabaseProjectsExtension.registerDatabaseProjects>
                >,
            );
        sandbox.stub(ProjectProviderRegistry, "registerProvider").returns(disposable);

        const sqlToolsClient: sinon.SinonStubbedInstance<SqlToolsServerClient> =
            sandbox.createStubInstance(SqlToolsServerClient);
        sandbox.stub(sqlToolsClient, "sqlToolsServicePath").get(() => "test/sqltoolsservice");
        sqlToolsClient.onNotification.returns(disposable); // handler stub necessary depending on test execution order
        // activate() is stubbed, so supply the connection manager it would otherwise create.
        sandbox.stub(MainController.prototype, "connectionManager").get(
            () =>
                ({
                    client: sqlToolsClient,
                    isConnected: () => false,
                    onConnectionsChanged: () => disposable,
                    onDidChangeDatabaseContext: () => disposable,
                }) as unknown as ConnectionManager,
        );

        sandbox.stub(UriOwnershipInitialization, "createUriOwnershipCoordinator").returns({
            uriOwnershipApi: {},
            onCoordinatingOwnershipChanged: sandbox.stub().returns(disposable),
            isActiveEditorOwnedByOtherExtensionWithWarning: () => false,
        } as unknown as UriOwnershipCoordinator);
        sandbox.stub(UriOwnershipInitialization, "initializeUriOwnershipCoordinator").returns();

        vscodeMssql = await Extension.activate(context);
        mainController = await Extension.getController();
    });

    teardown(() => {
        try {
            /* eslint-disable @typescript-eslint/no-explicit-any */
            (Extension as any).controller = undefined;
            (Extension as any).uriOwnershipCoordinator = undefined;
            /* eslint-enable @typescript-eslint/no-explicit-any */
        } finally {
            sandbox.restore();
        }
    });

    test("only exports the supported public APIs", () => {
        expect(Object.keys(vscodeMssql)).to.deep.equal([
            "connectionSharing",
            "getSharedConnectionsApi",
            "uriOwnershipApi",
        ]);
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        expect(vscodeMssql.connectionSharing).to.equal(mainController.connectionSharingService);
        expect(vscodeMssql.uriOwnershipApi).to.equal(
            Extension.uriOwnershipCoordinator.uriOwnershipApi,
        );
    });

    test("exposes only the shared connections API's public members", () => {
        const api = vscodeMssql.getSharedConnectionsApi(1);

        expect(api).not.to.be.instanceOf(SharedConnectionsService);
        expect(Object.isFrozen(api)).to.be.true;
        expect(Object.keys(api)).to.have.members([
            "authenticationProviderId",
            "onDidChangeActiveEditorConnection",
            "getActiveEditorConnectionId",
            "getActiveDatabase",
            "getDatabaseForConnectionId",
            "connect",
            "disconnect",
            "isConnected",
            "executeSimpleQuery",
            "cancelQuery",
            "getServerInfo",
            "listDatabases",
            "scriptObject",
            "getConnectionString",
        ]);
    });

    test("rejects a shared connections API version it doesn't support", () => {
        const getApi = vscodeMssql.getSharedConnectionsApi as (version: number) => unknown;

        expect(() => getApi(2)).to.throw(/Version 2 of the shared connections API/);
    });

    test("publishes activation snapshots used to gate private-preview UI", () => {
        expect(vscode.commands.executeCommand).to.have.been.calledWith(
            "setContext",
            PrivatePreviewContextKey.SqlDataPlaneActive,
            false,
        );
        expect(vscode.commands.executeCommand).to.have.been.calledWith(
            "setContext",
            PrivatePreviewContextKey.DebugConsoleActive,
            false,
        );
        expect(vscode.commands.executeCommand).to.have.been.calledWith(
            "setContext",
            PrivatePreviewContextKey.SessionDiagnosticsActive,
            false,
        );
    });

    test("does not register diagnostics commands when their activation gates are off", () => {
        for (const commandId of [
            "mssql.openDebugConsole",
            "mssql.sessionDiag.enable",
            "mssql.sessionDiag.disable",
            "mssql.sessionDiag.elevateCapture",
            "mssql.sessionDiag.clear",
            "mssql.sessionDiag.openStorageFolder",
        ]) {
            expect(vscode.commands.registerCommand).to.not.have.been.calledWith(commandId);
        }
    });

    test("publishes the default-off activation snapshot used to gate AI completion UI", () => {
        expect(vscode.commands.executeCommand).to.have.been.calledWith(
            "setContext",
            PrivatePreviewContextKey.AiInlineCompletionsActive,
            false,
        );
    });
});
