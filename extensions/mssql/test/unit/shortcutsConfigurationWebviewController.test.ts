/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
import * as utils from "../../src/utils/utils";
import * as Constants from "../../src/constants/constants";
import * as Loc from "../../src/constants/locConstants";
import { ShortcutsConfigurationWebviewController } from "../../src/controllers/shortcutsConfigurationWebviewController";
import {
    getQuickQueryCommandId,
    SaveShortcutsConfigurationPayload,
    SaveShortcutsConfigurationResult,
    ShortcutsConfigurationData,
    normalizeQuickQueries,
} from "../../src/sharedInterfaces/shortcutsConfiguration";
import { WebviewAction } from "../../src/sharedInterfaces/webview";
import { stubTelemetry, stubWebviewPanel } from "./utils";

const { expect } = chai;
chai.use(sinonChai);

suite("shortcutsConfiguration Webview Controller", () => {
    let sandbox: sinon.SinonSandbox;
    let controller: ShortcutsConfigurationWebviewController;
    let updateConfigurationStub: sinon.SinonStub;
    let quickQueriesSetting: unknown;
    let webviewShortcutsSetting: Record<string, string>;
    let shortcutsInspectValue: Partial<vscode.WorkspaceConfiguration>;
    let webviewPanel: vscode.WebviewPanel;
    let executeCommandStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        stubTelemetry(sandbox);
        sandbox.stub(utils, "getNonce").returns("test-nonce");
        webviewPanel = stubWebviewPanel(sandbox);
        sandbox.stub(vscode.window, "createWebviewPanel").returns(webviewPanel);
        sandbox.stub(vscode.workspace, "onDidChangeConfiguration").returns({
            dispose: sandbox.stub(),
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

        executeCommandStub = sandbox.stub(vscode.commands, "executeCommand").resolves();
        controller = new ShortcutsConfigurationWebviewController({
            extensionUri: vscode.Uri.parse("file:///extension"),
            extensionPath: "extension",
            globalStorageUri: vscode.Uri.file("globalStorage"),
        } as vscode.ExtensionContext);
    });

    teardown(() => {
        controller?.dispose();
        sandbox.restore();
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
            openQuickQueryKeybinding: (commandId: string) => Promise<void>;
            openQuickQueryKeybindings: () => Promise<void>;
            openKeymapCommandKeybinding: (commandId: string) => Promise<void>;
            openKeymapCommandKeybindings: () => Promise<void>;
        };
    }

    test("saveConfiguration persists normalized Quick Queries and webview shortcuts", async () => {
        const saveMethods = getControllerSaveMethods();

        const result = await saveMethods.saveConfiguration({
            quickQueries: [
                {
                    name: "  Health Check  ",
                    query: "select 1",
                },
            ],
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
        });
        expect(result.message).to.equal(Loc.shortcutsConfigurationSaved);
        expect(result.errorMessage).to.equal(undefined);
    });

    test("saveConfiguration writes webview shortcuts to workspace when workspace setting is effective", async () => {
        shortcutsInspectValue = { workspaceValue: webviewShortcutsSetting };
        const saveMethods = getControllerSaveMethods();

        await saveMethods.saveConfiguration({
            quickQueries: normalizeQuickQueries(undefined),
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

    test("openQuickQueryKeybinding opens Keyboard Shortcuts filtered to the command", async () => {
        const commandId = getQuickQueryCommandId(1);
        const saveMethods = getControllerSaveMethods();

        await saveMethods.openQuickQueryKeybinding(commandId);

        expect(executeCommandStub).to.have.been.calledWith(
            "workbench.action.openGlobalKeybindings",
            `@command:${commandId}`,
        );
    });

    test("openQuickQueryKeybinding ignores non-Quick Query commands", async () => {
        const saveMethods = getControllerSaveMethods();

        await saveMethods.openQuickQueryKeybinding("workbench.action.closeActiveEditor");

        expect(executeCommandStub).to.not.have.been.calledWith(
            "workbench.action.openGlobalKeybindings",
            sinon.match.string,
        );
    });

    test("openQuickQueryKeybindings opens Keyboard Shortcuts filtered to Quick Query commands", async () => {
        const saveMethods = getControllerSaveMethods();

        await saveMethods.openQuickQueryKeybindings();

        expect(executeCommandStub).to.have.been.calledWith(
            "workbench.action.openGlobalKeybindings",
            "mssql.quickQueries.run",
        );
    });

    test("openKeymapCommandKeybinding opens Keyboard Shortcuts filtered to the command", async () => {
        const saveMethods = getControllerSaveMethods();

        await saveMethods.openKeymapCommandKeybinding("mssql.runQuery");

        expect(executeCommandStub).to.have.been.calledWith(
            "workbench.action.openGlobalKeybindings",
            "@command:mssql.runQuery",
        );
    });

    test("openKeymapCommandKeybinding ignores non-configurable commands", async () => {
        const saveMethods = getControllerSaveMethods();

        await saveMethods.openKeymapCommandKeybinding("workbench.action.closeActiveEditor");

        expect(executeCommandStub).to.not.have.been.calledWith(
            "workbench.action.openGlobalKeybindings",
            sinon.match.string,
        );
    });

    test("openKeymapCommandKeybindings opens Keyboard Shortcuts filtered to MSSQL commands", async () => {
        const saveMethods = getControllerSaveMethods();

        await saveMethods.openKeymapCommandKeybindings();

        expect(executeCommandStub).to.have.been.calledWith(
            "workbench.action.openGlobalKeybindings",
            "mssql",
        );
    });

    test("readConfiguration returns persisted Quick Queries and webview shortcuts", async () => {
        quickQueriesSetting = normalizeQuickQueries([
            {
                name: "Health Check",
                query: "select 1",
            },
        ]);
        webviewShortcutsSetting = {
            [WebviewAction.ResultGridSelectAll]: "ctrl+shift+a",
        };
        const saveMethods = getControllerSaveMethods();

        const result = await saveMethods.readConfiguration();

        expect(result.quickQueries[0]).to.deep.equal({
            name: "Health Check",
            query: "select 1",
        });
        expect(result.webviewShortcuts).to.deep.equal(webviewShortcutsSetting);
    });

    test("removes ignored legacy execution modes when saving Quick Query edits", async () => {
        quickQueriesSetting = [
            { name: "Legacy auto run", query: "select 1", executionMode: "openAndRun" },
        ];
        const saveMethods = getControllerSaveMethods();

        await saveMethods.saveConfiguration({
            quickQueries: [{ name: "Updated", query: "select 2" }],
            webviewShortcuts: {},
            changedSections: { quickQueries: true },
        });

        expect((quickQueriesSetting as Array<Record<string, unknown>>)[0]).to.deep.equal({
            name: "Updated",
            query: "select 2",
        });
    });
});
