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
import { OverviewOpenSource, PrerequisiteStatus } from "../../src/sharedInterfaces/overview";
import * as constants from "../../src/constants/constants";
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
    let storeChangeEvent: vscode.EventEmitter<void>;

    function createController(): OverviewWebviewController {
        const created = new OverviewWebviewController(
            {
                extensionUri: vscode.Uri.parse("file:///extension"),
                extensionPath: "extension",
                globalStorageUri: vscode.Uri.file("globalStorage"),
            } as vscode.ExtensionContext,
            {
                getRecentFiles: recentFilesStub,
                onDidChange: storeChangeEvent.event,
            } as unknown as RecentSqlFilesStore,
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
        storeChangeEvent = new vscode.EventEmitter<void>();
        sandbox.stub(vscode.commands, "executeCommand").resolves();
    });

    teardown(() => {
        controller?.dispose();
        controller = undefined;
        storeChangeEvent.dispose();
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

    test("prerequisite check reports missing dependencies when nothing is installed", async () => {
        controller = createController();

        const prerequisites = await controller["getDevContainerPrerequisites"]();

        // vscode.extensions.getExtension is stubbed to return undefined for every id.
        expect(prerequisites.devContainersExtension).to.equal(PrerequisiteStatus.Missing);
    });

    test("refreshes the recent file list when the store records a new open", async () => {
        controller = createController();
        await waitForRecentFiles();
        expect(controller.state.recentFiles).to.deep.equal([]);

        // A page left open has to follow later opens rather than keep its first snapshot.
        recentFiles = [{ fsPath: "/work/reports/new.sql", timestampMs: 5_000 }];
        storeChangeEvent.fire();
        await waitForRecentFiles();

        expect(controller.state.recentFiles.map((file) => file.fsPath)).to.deep.equal([
            "/work/reports/new.sql",
        ]);
    });

    test("reopening What's new bumps the request so a dismissed drawer reopens", () => {
        controller = createController();
        expect(controller.state.openWhatsNewRequest).to.equal(0);

        controller.openWhatsNew();
        const afterFirst = controller.state.openWhatsNewRequest;
        controller.openWhatsNew();

        // A boolean would stay `true` here and the webview would see no change.
        expect(afterFirst).to.equal(1);
        expect(controller.state.openWhatsNewRequest).to.equal(2);
    });

    suite("showWelcomeOnExtensionUpdate", () => {
        const currentVersion = "1.99.0";

        /** Builds a context whose globalState reports `storedVersion` as last greeted. */
        function stubContext(storedVersion: string | undefined) {
            const update = sinon.stub().resolves();
            const context = {
                globalState: {
                    get: sinon.stub().returns(storedVersion),
                    update,
                },
            } as unknown as vscode.ExtensionContext;
            return { context, update };
        }

        /** Points the setting's resolved value at `enabled`. */
        function stubChangelogSetting(enabled: boolean | undefined) {
            sandbox.stub(vscode.workspace, "getConfiguration").returns({
                inspect: () => ({ globalValue: enabled, defaultValue: true }),
            } as unknown as vscode.WorkspaceConfiguration);
        }

        setup(() => {
            (vscode.extensions.getExtension as sinon.SinonStub).returns({
                packageJSON: { version: currentVersion },
            });
        });

        test("opens the Welcome page with release notes and records the version", async () => {
            stubChangelogSetting(true);
            const { context, update } = stubContext("1.98.0");

            await OverviewWebviewController.showWelcomeOnExtensionUpdate(context);

            expect(vscode.commands.executeCommand).to.have.been.calledOnceWithExactly(
                constants.cmdOpenOverview,
                { openWhatsNew: true, source: OverviewOpenSource.PostUpdate },
            );
            // Recorded so the greeting is shown at most once per version.
            expect(update).to.have.been.calledOnceWithExactly(
                "changelog/lastChangeLogVersion",
                currentVersion,
            );
        });

        test("does nothing when this version was already greeted", async () => {
            stubChangelogSetting(true);
            const { context, update } = stubContext(currentVersion);

            await OverviewWebviewController.showWelcomeOnExtensionUpdate(context);

            expect(vscode.commands.executeCommand).to.not.have.been.called;
            expect(update).to.not.have.been.called;
        });

        test("does nothing when the user turned the setting off", async () => {
            stubChangelogSetting(false);
            const { context, update } = stubContext("1.98.0");

            await OverviewWebviewController.showWelcomeOnExtensionUpdate(context);

            expect(vscode.commands.executeCommand).to.not.have.been.called;
            expect(update).to.not.have.been.called;
        });

        test("greets a user who has never touched the setting", async () => {
            // No global value set, so the contributed default applies.
            stubChangelogSetting(undefined);
            const { context } = stubContext("1.98.0");

            await OverviewWebviewController.showWelcomeOnExtensionUpdate(context);

            expect(vscode.commands.executeCommand).to.have.been.calledOnce;
        });
    });
});
