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
import * as Extension from "../../src/extension";
import { stubExtensionContext } from "./utils";
import { ChangelogWebviewController } from "../../src/controllers/changelogWebviewController";
import * as LocalizationCache from "../../src/controllers/localizationCache";
import { VscodeHttpClient } from "extension-toolkit/vscode";
import { UserSurvey } from "../../src/nps/userSurvey";
import SqlToolsServerClient from "../../src/languageservice/serviceclient";
import * as UriOwnershipInitialization from "../../src/uriOwnership/uriOwnershipInitialization";
import { IconUtils } from "../../src/utils/iconUtils";
import { UriOwnershipCoordinator } from "../../src/uriOwnership/uriOwnershipCore";
import { PrivatePreviewContextKey } from "../../src/previews/previewService";

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
        sandbox.stub(vscode.extensions, "getExtension").returns(undefined);
        sandbox.stub(vscode.chat, "createChatParticipant").returns(chatParticipant);
        sandbox.stub(ChangelogWebviewController, "showChangelogOnExtensionUpdate").resolves();
        sandbox.stub(LocalizationCache, "initializeWebviewLocalizationCache").returns();
        sandbox.stub(IconUtils, "initialize").returns();
        sandbox.stub(UserSurvey, "createInstance").returns();
        sandbox.stub(VscodeHttpClient.prototype, "warnOnInvalidProxySettings").returns();
        sandbox.stub(MainController.prototype, "activate").resolves(true);

        const sqlToolsClient: sinon.SinonStubbedInstance<SqlToolsServerClient> =
            sandbox.createStubInstance(SqlToolsServerClient);
        sandbox.stub(sqlToolsClient, "sqlToolsServicePath").get(() => "test/sqltoolsservice");
        sqlToolsClient.onNotification.returns(disposable); // handler stub necessary depending on test execution order

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
        expect(Object.keys(vscodeMssql)).to.deep.equal(["connectionSharing", "uriOwnershipApi"]);
        expect(vscodeMssql.connectionSharing).to.equal(mainController.connectionSharingService);
        expect(vscodeMssql.uriOwnershipApi).to.equal(
            Extension.uriOwnershipCoordinator.uriOwnershipApi,
        );
    });

    test("publishes the activation snapshot used to gate SQL Data Plane UI", () => {
        expect(vscode.commands.executeCommand).to.have.been.calledWith(
            "setContext",
            PrivatePreviewContextKey.SqlDataPlaneActive,
            false,
        );
    });

    test("publishes the default-off activation snapshot used to gate AI completion UI", () => {
        expect(vscode.commands.executeCommand).to.have.been.calledWith(
            "setContext",
            PrivatePreviewContextKey.AiInlineCompletionsActive,
            false,
        );
    });
});
