/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
import * as utils from "../../src/utils/utils";
import * as Constants from "../../src/constants/constants";
import * as Loc from "../../src/constants/locConstants";
import { ShortcutsConfigurationWebviewController } from "../../src/controllers/shortcutsConfigurationWebviewController";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { parseKeybindingsText } from "../../src/keybindings/keybindingsService";
import {
    getQuickQueryCommandId,
    SaveShortcutsConfigurationPayload,
    SaveShortcutsConfigurationResult,
    ShortcutsConfigurationData,
    normalizeQuickQueries,
    QuickQueryExecutionMode,
} from "../../src/sharedInterfaces/shortcutsConfiguration";
import { WebviewAction } from "../../src/sharedInterfaces/webview";
import { stubTelemetry, stubVscodeWrapper, stubWebviewPanel } from "./utils";

const { expect } = chai;
chai.use(sinonChai);

suite("shortcutsConfiguration Webview Controller", () => {
    let sandbox: sinon.SinonSandbox;
    let controller: ShortcutsConfigurationWebviewController;
    let vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let updateConfigurationStub: sinon.SinonStub;
    let keybindingsText: string;
    let tempUserDataPath: string;
    let quickQueriesSetting: unknown;
    let webviewShortcutsSetting: Record<string, string>;
    let shortcutsInspectValue: Partial<vscode.WorkspaceConfiguration>;
    let webviewPanel: vscode.WebviewPanel;

    setup(() => {
        sandbox = sinon.createSandbox();
        stubTelemetry(sandbox);
        sandbox.stub(utils, "getNonce").returns("test-nonce");
        webviewPanel = stubWebviewPanel(sandbox);
        sandbox.stub(vscode.window, "createWebviewPanel").returns(webviewPanel);
        sandbox.stub(vscode.workspace, "onDidChangeConfiguration").returns({
            dispose: sandbox.stub(),
        });

        keybindingsText = "[]";
        tempUserDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "mssql-config-test-"));
        const globalStoragePath = path.join(tempUserDataPath, "globalStorage", "ms-mssql.mssql");
        fs.mkdirSync(globalStoragePath, { recursive: true });
        sandbox.stub(vscode.workspace.fs, "readFile").callsFake(async (uri) => {
            if (uri.scheme === "vscode-userdata" && uri.path === "/User/keybindings.json") {
                return new TextEncoder().encode(keybindingsText);
            }
            throw new Error(`Unexpected readFile URI: ${uri.toString()}`);
        });
        sandbox.stub(vscode.workspace.fs, "writeFile").callsFake(async (uri, content) => {
            if (uri.scheme === "vscode-userdata" && uri.path === "/User/keybindings.json") {
                keybindingsText = new TextDecoder("utf-8").decode(content);
                return;
            }
            throw new Error(`Unexpected writeFile URI: ${uri.toString()}`);
        });

        quickQueriesSetting = normalizeQuickQueries(undefined);
        webviewShortcutsSetting = {};
        shortcutsInspectValue = {};
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
            inspect: sandbox.stub().callsFake((section: string) => {
                if (section === Constants.configShortcuts) {
                    return shortcutsInspectValue;
                }
                return {};
            }),
        } as unknown as vscode.WorkspaceConfiguration);

        sandbox.stub(vscode.commands, "executeCommand").resolves();

        vscodeWrapper = stubVscodeWrapper(sandbox);
        controller = new ShortcutsConfigurationWebviewController(
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

    function getControllerSaveMethods() {
        return controller as unknown as {
            readConfiguration: () => Promise<ShortcutsConfigurationData>;
            saveConfiguration: (
                payload: SaveShortcutsConfigurationPayload,
            ) => Promise<SaveShortcutsConfigurationResult>;
            saveAndCloseConfiguration: (
                payload: SaveShortcutsConfigurationPayload,
            ) => Promise<SaveShortcutsConfigurationResult>;
        };
    }

    test("saveConfiguration persists normalized Quick Queries and webview shortcuts", async () => {
        const commandId = getQuickQueryCommandId(1);
        const saveMethods = getControllerSaveMethods();

        const result = await saveMethods.saveConfiguration({
            quickQueries: [
                {
                    name: "  Health Check  ",
                    query: "select 1",
                    executionMode: QuickQueryExecutionMode.Open,
                },
            ],
            quickQueryKeybindings: {
                [commandId]: "ctrl+alt+1",
            },
            webviewShortcuts: {
                [WebviewAction.ResultGridSelectAll]: "ctrl+shift+a",
            },
        });

        expect(updateConfigurationStub).to.have.been.calledWith(
            Constants.configQuickQueries,
            sinon.match.array,
            vscode.ConfigurationTarget.Global,
        );
        expect(updateConfigurationStub).to.have.been.calledWith(
            Constants.configShortcuts,
            { [WebviewAction.ResultGridSelectAll]: "ctrl+shift+a" },
            vscode.ConfigurationTarget.Global,
        );
        const quickQueries = normalizeQuickQueries(quickQueriesSetting);
        expect(quickQueries[0]).to.deep.equal({
            name: "Health Check",
            query: "select 1",
            executionMode: QuickQueryExecutionMode.Open,
        });
        expect(result.message).to.equal(Loc.shortcutsConfigurationSaved);
        expect(result.errorMessage).to.equal(undefined);
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
        const saveMethods = getControllerSaveMethods();

        const result = await saveMethods.saveConfiguration({
            quickQueries: normalizeQuickQueries(undefined),
            quickQueryKeybindings: {
                [commandId]: "",
            },
            webviewShortcuts: {
                [WebviewAction.ResultGridCopySelection]: "ctrl+c",
            },
        });

        expect(result.errorMessage).to.equal(undefined);
        expect(parseKeybindingsText(keybindingsText)).to.deep.equal([
            {
                key: "ctrl+k",
                command: "workbench.action.keep",
            },
        ]);
    });

    test("saveConfiguration writes webview shortcuts to workspace when workspace setting is effective", async () => {
        shortcutsInspectValue = { workspaceValue: webviewShortcutsSetting };
        const saveMethods = getControllerSaveMethods();

        await saveMethods.saveConfiguration({
            quickQueries: normalizeQuickQueries(undefined),
            quickQueryKeybindings: {},
            webviewShortcuts: {
                [WebviewAction.ResultGridSelectAll]: "ctrl+shift+a",
            },
            changedSections: {
                webviewShortcuts: true,
            },
        });

        expect(updateConfigurationStub).to.have.been.calledWith(
            Constants.configShortcuts,
            { [WebviewAction.ResultGridSelectAll]: "ctrl+shift+a" },
            vscode.ConfigurationTarget.Workspace,
        );
    });

    test("saveAndCloseConfiguration disposes the panel after a successful save", async () => {
        const saveMethods = getControllerSaveMethods();

        const result = await saveMethods.saveAndCloseConfiguration({
            quickQueries: normalizeQuickQueries(undefined),
            quickQueryKeybindings: {},
            webviewShortcuts: {
                [WebviewAction.ResultGridCopySelection]: "ctrl+c",
            },
            changedSections: {
                webviewShortcuts: true,
            },
        });

        expect(result.errorMessage).to.equal(undefined);
        expect(webviewPanel.dispose).to.have.been.called;
    });

    test("readConfiguration returns persisted Quick Queries, keybindings, and webview shortcuts", async () => {
        const commandId = getQuickQueryCommandId(1);
        quickQueriesSetting = normalizeQuickQueries([
            {
                name: "Health Check",
                query: "select 1",
                executionMode: QuickQueryExecutionMode.Open,
            },
        ]);
        webviewShortcutsSetting = {
            [WebviewAction.ResultGridSelectAll]: "ctrl+shift+a",
        };
        keybindingsText = `[
    {
        "key": "ctrl+alt+1",
        "command": "${commandId}"
    }
]`;
        const saveMethods = getControllerSaveMethods();

        const result = await saveMethods.readConfiguration();

        expect(result.quickQueries[0]).to.deep.equal({
            name: "Health Check",
            query: "select 1",
            executionMode: QuickQueryExecutionMode.Open,
        });
        expect(result.quickQueryKeybindings).to.deep.equal({
            [commandId]: "ctrl+alt+1",
            [getQuickQueryCommandId(2)]: "",
            [getQuickQueryCommandId(3)]: "",
            [getQuickQueryCommandId(4)]: "",
            [getQuickQueryCommandId(5)]: "",
            [getQuickQueryCommandId(6)]: "",
            [getQuickQueryCommandId(7)]: "",
            [getQuickQueryCommandId(8)]: "",
            [getQuickQueryCommandId(9)]: "",
            [getQuickQueryCommandId(10)]: "",
        });
        expect(result.webviewShortcuts).to.deep.equal(webviewShortcutsSetting);
    });
});
