/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
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
        sandbox.stub(vscode.commands, "executeCommand").resolves();
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

    test("checkPrerequisites reports missing dependencies when nothing is installed", async () => {
        controller = createController();

        const reducer = controller["_reducerHandlers"].get("checkPrerequisites")!;
        const nextState = (await reducer(controller.state, {})) as OverviewWebviewState;

        // vscode.extensions.getExtension is stubbed to return undefined for every id.
        expect(nextState.prerequisites.git).to.equal(PrerequisiteStatus.Missing);
        expect(nextState.prerequisites.devContainersExtension).to.equal(PrerequisiteStatus.Missing);
    });
});
