/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as utils from "../../src/utils/utils";
import * as Constants from "../../src/constants/constants";
import { MssqlConfigurationWebviewController } from "../../src/controllers/mssqlConfigurationWebviewController";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { parseKeybindingsText } from "../../src/keybindings/keybindingsService";
import {
    getQuickQueryCommandId,
    MssqlConfigurationReducers,
    MssqlConfigurationWebviewState,
    normalizeQuickQueries,
    QuickQueryConnectionMode,
    QuickQueryExecutionMode,
} from "../../src/sharedInterfaces/mssqlConfiguration";
import { WebviewAction } from "../../src/sharedInterfaces/webview";
import { stubTelemetry, stubVscodeWrapper, stubWebviewPanel } from "./utils";

suite("Mssql Configuration Webview Controller", () => {
    let sandbox: sinon.SinonSandbox;
    let controller: MssqlConfigurationWebviewController;
    let vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let updateConfigurationStub: sinon.SinonStub;
    let keybindingsText: string;
    let keybindingsFilePath: string;
    let tempUserDataPath: string;
    let quickQueriesSetting: unknown;
    let webviewShortcutsSetting: Record<string, string>;

    setup(() => {
        sandbox = sinon.createSandbox();
        stubTelemetry(sandbox);
        sandbox.stub(utils, "getNonce").returns("test-nonce");
        sandbox.stub(vscode.window, "createWebviewPanel").returns(stubWebviewPanel(sandbox));
        sandbox.stub(vscode.workspace, "onDidChangeConfiguration").returns({
            dispose: sandbox.stub(),
        });

        keybindingsText = "[]";
        tempUserDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "mssql-config-test-"));
        const globalStoragePath = path.join(tempUserDataPath, "globalStorage", "ms-mssql.mssql");
        fs.mkdirSync(globalStoragePath, { recursive: true });
        keybindingsFilePath = path.join(tempUserDataPath, "keybindings.json");
        fs.writeFileSync(keybindingsFilePath, keybindingsText);

        quickQueriesSetting = normalizeQuickQueries(undefined);
        webviewShortcutsSetting = {};
        updateConfigurationStub = sandbox.stub().callsFake((section: string, value: unknown) => {
            if (section === Constants.configQuickQueries) {
                quickQueriesSetting = value;
            }
            if (section === Constants.configShortcuts) {
                webviewShortcutsSetting = value as Record<string, string>;
            }
            return Promise.resolve();
        });

        sandbox.stub(vscode.workspace, "getConfiguration").returns({
            get: sandbox.stub().callsFake((section: string) => {
                if (section === Constants.configQuickQueries) {
                    return quickQueriesSetting;
                }
                if (section === Constants.configShortcuts) {
                    return webviewShortcutsSetting;
                }
                return undefined;
            }),
            update: updateConfigurationStub,
        } as unknown as vscode.WorkspaceConfiguration);

        sandbox.stub(vscode.commands, "executeCommand").resolves();

        vscodeWrapper = stubVscodeWrapper(sandbox);
        controller = new MssqlConfigurationWebviewController(
            {
                extensionUri: vscode.Uri.parse("file:///extension"),
                extensionPath: "extension",
                globalStorageUri: vscode.Uri.file(globalStoragePath),
            } as vscode.ExtensionContext,
            vscodeWrapper,
        );
    });

    teardown(() => {
        controller?.dispose();
        sandbox.restore();
        if (tempUserDataPath) {
            fs.rmSync(tempUserDataPath, { recursive: true, force: true });
        }
    });

    function getReducer<Method extends keyof MssqlConfigurationReducers>(method: Method) {
        return (
            controller as unknown as {
                _reducerHandlers: Map<
                    Method,
                    (
                        state: MssqlConfigurationWebviewState,
                        payload: MssqlConfigurationReducers[Method],
                    ) => Promise<MssqlConfigurationWebviewState>
                >;
            }
        )._reducerHandlers.get(method);
    }

    test("saveConfiguration persists normalized Quick Queries and webview shortcuts", async () => {
        const commandId = getQuickQueryCommandId(1);
        const reducer = getReducer("saveConfiguration");

        const result = await reducer(controller.state, {
            quickQueries: [
                {
                    name: "  Health Check  ",
                    query: "select 1",
                    executionMode: QuickQueryExecutionMode.Open,
                    connectionMode: QuickQueryConnectionMode.Prompt,
                },
            ],
            quickQueryKeybindings: {
                [commandId]: "ctrl+alt+1",
            },
            webviewShortcuts: {
                [WebviewAction.ResultGridSelectAll]: "ctrl+shift+a",
            },
            mssqlSettings: {},
        });

        expect(
            updateConfigurationStub.calledWith(
                Constants.configQuickQueries,
                sinon.match.array,
                vscode.ConfigurationTarget.Global,
            ),
        ).to.equal(true);
        expect(
            updateConfigurationStub.calledWith(
                Constants.configShortcuts,
                { [WebviewAction.ResultGridSelectAll]: "ctrl+shift+a" },
                vscode.ConfigurationTarget.Global,
            ),
        ).to.equal(true);
        keybindingsText = fs.readFileSync(keybindingsFilePath, "utf-8");

        const quickQueries = normalizeQuickQueries(quickQueriesSetting);
        expect(quickQueries[0]).to.deep.equal({
            name: "Health Check",
            query: "select 1",
            executionMode: QuickQueryExecutionMode.Open,
            connectionMode: QuickQueryConnectionMode.Prompt,
        });
        expect(result.message).to.equal("Configuration saved.");
        expect(result.webviewShortcuts).to.deep.equal({
            [WebviewAction.ResultGridSelectAll]: "ctrl+shift+a",
        });
        expect(parseKeybindingsText(keybindingsText)).to.deep.equal([
            {
                key: "ctrl+alt+1",
                command: commandId,
            },
        ]);
    });

    test("saveConfiguration clears removed Quick Query keybindings", async () => {
        const commandId = getQuickQueryCommandId(1);
        keybindingsText = `[
    {
        "key": "ctrl+alt+1",
        "command": "${commandId}"
    },
    {
        "key": "ctrl+k",
        "command": "workbench.action.keep"
    }
]`;
        fs.writeFileSync(keybindingsFilePath, keybindingsText);
        const reducer = getReducer("saveConfiguration");

        const result = await reducer(controller.state, {
            quickQueries: normalizeQuickQueries(undefined),
            quickQueryKeybindings: {
                [commandId]: "",
            },
            webviewShortcuts: {
                [WebviewAction.ResultGridCopySelection]: "ctrl+c",
            },
            mssqlSettings: {},
        });

        expect(result.errorMessage).to.equal(undefined);
        expect(result.webviewShortcuts).to.deep.equal({
            [WebviewAction.ResultGridCopySelection]: "ctrl+c",
        });
        keybindingsText = fs.readFileSync(keybindingsFilePath, "utf-8");
        expect(parseKeybindingsText(keybindingsText)).to.deep.equal([
            {
                key: "ctrl+k",
                command: "workbench.action.keep",
            },
        ]);
    });
});
