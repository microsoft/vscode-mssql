/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
import * as Constants from "../../src/constants/constants";
import * as utils from "../../src/utils/utils";
import * as dockerUtils from "../../src/docker/dockerUtils";
import { OverviewWebviewController } from "../../src/controllers/overviewWebviewController";
import { RecentSqlFilesStore, ResolvedRecentSqlFile } from "../../src/models/recentSqlFilesStore";
import { OverviewWebviewState, PrerequisiteStatus } from "../../src/sharedInterfaces/overview";
import { observeWebviewReady, stubTelemetry, stubWebviewPanel } from "./utils";

const { expect } = chai;
chai.use(sinonChai);

/** Lets the controller's asynchronous recent-file refresh settle. */
function waitForRecentFiles(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

suite("Overview Webview Controller", () => {
    let sandbox: sinon.SinonSandbox;
    let controller: OverviewWebviewController | undefined;
    let settings: Record<string, unknown>;
    let updateConfigurationStub: sinon.SinonStub;
    let executeCommandStub: sinon.SinonStub;
    let recentFiles: ResolvedRecentSqlFile[];
    let recentFilesStub: sinon.SinonStub;

    function createController(): OverviewWebviewController {
        const created = new OverviewWebviewController(
            {
                extensionUri: vscode.Uri.parse("file:///extension"),
                extensionPath: "extension",
                globalStorageUri: vscode.Uri.file("globalStorage"),
            } as vscode.ExtensionContext,
            { getRecentFiles: recentFilesStub } as unknown as RecentSqlFilesStore,
        );
        observeWebviewReady(created);
        return created;
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        stubTelemetry(sandbox);
        sandbox.stub(utils, "getNonce").returns("test-nonce");
        sandbox.stub(vscode.window, "createWebviewPanel").returns(stubWebviewPanel(sandbox));
        sandbox.stub(vscode.extensions, "getExtension").returns(undefined);
        // Keep prerequisite checks from shelling out to a real Docker install.
        sandbox.stub(dockerUtils, "checkDockerInstallation").resolves({ success: false });
        sandbox.stub(dockerUtils, "checkEngine").resolves({ success: false });

        recentFiles = [];
        recentFilesStub = sinon.stub().callsFake(() => Promise.resolve(recentFiles));
        settings = {
            [Constants.configEnableOverviewPage]: true,
            [Constants.configShowOverviewOnStartup]: true,
        };
        updateConfigurationStub = sandbox.stub().callsFake((section: string, value: unknown) => {
            settings[section] = value;
            return Promise.resolve();
        });
        sandbox.stub(vscode.workspace, "getConfiguration").returns({
            get: sandbox
                .stub()
                .callsFake((section: string, fallback?: unknown) =>
                    section in settings ? settings[section] : fallback,
                ),
            update: updateConfigurationStub,
            inspect: sandbox.stub().returns({}),
        } as unknown as vscode.WorkspaceConfiguration);

        executeCommandStub = sandbox.stub(vscode.commands, "executeCommand").resolves();
    });

    teardown(() => {
        controller?.dispose();
        controller = undefined;
        sandbox.restore();
    });

    test("projects recent SQL files into state with file and folder labels", async () => {
        recentFiles = [
            { fsPath: "/work/reports/revenue-by-region.sql", timestampMs: 2_000 },
            { fsPath: "/work/tuning/index-tuning.sql", timestampMs: 1_000 },
        ];

        controller = createController();
        await waitForRecentFiles();

        expect(controller.state.recentFiles).to.deep.equal([
            {
                fsPath: "/work/reports/revenue-by-region.sql",
                fileName: "revenue-by-region.sql",
                folderLabel: "reports",
                timestampMs: 2_000,
            },
            {
                fsPath: "/work/tuning/index-tuning.sql",
                fileName: "index-tuning.sql",
                folderLabel: "tuning",
                timestampMs: 1_000,
            },
        ]);
    });

    test("asks the store for at most five recent files", async () => {
        controller = createController();
        await waitForRecentFiles();

        expect(recentFilesStub).to.have.been.calledOnceWithExactly(5);
    });

    test("starts with an empty recent file list before the store resolves", () => {
        recentFiles = [{ fsPath: "/work/a.sql", timestampMs: 1 }];

        controller = createController();

        // The list is loaded asynchronously so construction never blocks on the filesystem.
        expect(controller.state.recentFiles).to.deep.equal([]);
    });

    test("setShowOnStartup persists the setting globally and updates state", async () => {
        controller = createController();

        const reducer = controller["_reducerHandlers"].get("setShowOnStartup")!;
        const nextState = (await reducer(controller.state, {
            showOnStartup: false,
        })) as OverviewWebviewState;

        expect(updateConfigurationStub).to.have.been.calledWith(
            Constants.configShowOverviewOnStartup,
            false,
            vscode.ConfigurationTarget.Global,
        );
        expect(nextState.showOnStartup).to.equal(false);
    });

    test("checkPrerequisites reports missing dependencies when nothing is installed", async () => {
        controller = createController();

        const reducer = controller["_reducerHandlers"].get("checkPrerequisites")!;
        const nextState = (await reducer(controller.state, {})) as OverviewWebviewState;

        // vscode.extensions.getExtension is stubbed to return undefined for every id.
        expect(nextState.prerequisites.git).to.equal(PrerequisiteStatus.Missing);
        expect(nextState.prerequisites.devContainersExtension).to.equal(PrerequisiteStatus.Missing);
    });

    test("showOverviewOnStartup opens the page when enabled and opted in", async () => {
        await OverviewWebviewController.showOverviewOnStartup();

        expect(executeCommandStub).to.have.been.calledWith(Constants.cmdOpenOverview);
    });

    test("showOverviewOnStartup does nothing while the page is preview-gated off", async () => {
        settings[Constants.configEnableOverviewPage] = false;

        await OverviewWebviewController.showOverviewOnStartup();

        expect(executeCommandStub).to.not.have.been.calledWith(Constants.cmdOpenOverview);
    });

    test("showOverviewOnStartup does nothing when the user opted out of startup", async () => {
        settings[Constants.configShowOverviewOnStartup] = false;

        await OverviewWebviewController.showOverviewOnStartup();

        expect(executeCommandStub).to.not.have.been.calledWith(Constants.cmdOpenOverview);
    });
});
