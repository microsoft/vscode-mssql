/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as utils from "../../src/utils/utils";
import * as dockerUtils from "../../src/docker/dockerUtils";
import { OverviewWebviewController } from "../../src/controllers/overviewWebviewController";
import { RecentSqlFilesStore, ResolvedRecentSqlFile } from "../../src/models/recentSqlFilesStore";
import { AgentPluginsInstaller } from "../../src/agentPlugins/agentPluginsInstaller";
import {
    DevContainerTemplateId,
    OverviewOpenSource,
    PrerequisiteStatus,
} from "../../src/sharedInterfaces/overview";
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
    let agentSkillsInstalledStub: sinon.SinonStub;
    let agentSkillsInstallStub: sinon.SinonStub;
    let temporaryDirectories: string[];

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
            {
                isInstalled: agentSkillsInstalledStub,
                install: agentSkillsInstallStub,
            } as unknown as AgentPluginsInstaller,
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
        agentSkillsInstalledStub = sinon.stub().resolves(false);
        agentSkillsInstallStub = sinon.stub().resolves(true);
        temporaryDirectories = [];
        sandbox.stub(vscode.commands, "executeCommand").resolves();
    });

    teardown(async () => {
        controller?.dispose();
        controller = undefined;
        storeChangeEvent.dispose();
        sandbox.restore();
        await Promise.all(
            temporaryDirectories.map((directory) =>
                fs.promises.rm(directory, { recursive: true, force: true }),
            ),
        );
    });

    async function createTemporaryDirectory(prefix: string): Promise<string> {
        const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
        temporaryDirectories.push(directory);
        return directory;
    }

    function stubTemplateApplication(files: Record<string, string>): sinon.SinonStub {
        sandbox
            .stub(controller as unknown as Record<string, unknown>, "findDevContainersCli")
            .returns("/fake/devContainersSpecCLI.js");
        return sandbox
            .stub(controller as unknown as Record<string, unknown>, "runDevContainersCli")
            .callsFake(async (_cliPath: string, args: string[]) => {
                const workspaceArgument = args.indexOf("--workspace-folder");
                const stagingDirectory = args[workspaceArgument + 1];
                for (const [relativePath, contents] of Object.entries(files)) {
                    const destination = path.join(stagingDirectory, ...relativePath.split("/"));
                    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
                    await fs.promises.writeFile(destination, contents);
                }
                return `${JSON.stringify({ files: Object.keys(files) })}\n`;
            });
    }

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

    test("does not copy any template files when conflict resolution is canceled", async () => {
        const workspaceRoot = await createTemporaryDirectory("mssql-overview-conflict-");
        const tasksPath = path.join(workspaceRoot, ".vscode", "tasks.json");
        const attributesPath = path.join(workspaceRoot, ".gitattributes");
        await fs.promises.mkdir(path.dirname(tasksPath), { recursive: true });
        await fs.promises.writeFile(tasksPath, "user tasks");
        await fs.promises.writeFile(attributesPath, "user attributes");
        sandbox
            .stub(vscode.workspace, "workspaceFolders")
            .value([{ index: 0, name: "workspace", uri: vscode.Uri.file(workspaceRoot) }]);
        controller = createController();
        sandbox
            .stub(vscode.window, "showWarningMessage")
            .onFirstCall()
            .resolves("Overwrite" as never)
            .onSecondCall()
            .resolves(undefined);
        stubTemplateApplication({
            ".devcontainer/devcontainer.json": '{ "name": "Azure SQL" }',
            ".vscode/tasks.json": "template tasks",
            ".gitattributes": "template attributes",
        });

        const result = await controller["applyDevContainerTemplate"](DevContainerTemplateId.DotNet);

        expect(result).to.include({ applied: false, usedPicker: false, conflict: true });
        expect(await fs.promises.readFile(tasksPath, "utf8")).to.equal("user tasks");
        expect(await fs.promises.readFile(attributesPath, "utf8")).to.equal("user attributes");
        expect(fs.existsSync(path.join(workspaceRoot, ".devcontainer", "devcontainer.json"))).to.be
            .false;
    });

    test("skips an existing template file when the user chooses Skip", async () => {
        const workspaceRoot = await createTemporaryDirectory("mssql-overview-skip-");
        const tasksPath = path.join(workspaceRoot, ".vscode", "tasks.json");
        await fs.promises.mkdir(path.dirname(tasksPath), { recursive: true });
        await fs.promises.writeFile(tasksPath, "user tasks");
        sandbox
            .stub(vscode.workspace, "workspaceFolders")
            .value([{ index: 0, name: "workspace", uri: vscode.Uri.file(workspaceRoot) }]);
        controller = createController();
        sandbox.stub(vscode.window, "showWarningMessage").resolves("Skip" as never);
        stubTemplateApplication({
            ".devcontainer/devcontainer.json": '{ "name": "Azure SQL" }',
            ".vscode/tasks.json": "template tasks",
        });

        const result = await controller["applyDevContainerTemplate"](DevContainerTemplateId.DotNet);

        expect(result).to.deep.equal({ applied: true, usedPicker: false });
        expect(await fs.promises.readFile(tasksPath, "utf8")).to.equal("user tasks");
        expect(
            await fs.promises.readFile(
                path.join(workspaceRoot, ".devcontainer", "devcontainer.json"),
                "utf8",
            ),
        ).to.equal('{ "name": "Azure SQL" }');
    });

    test("overwrites only the template file explicitly approved by the user", async () => {
        const workspaceRoot = await createTemporaryDirectory("mssql-overview-overwrite-");
        const tasksPath = path.join(workspaceRoot, ".vscode", "tasks.json");
        await fs.promises.mkdir(path.dirname(tasksPath), { recursive: true });
        await fs.promises.writeFile(tasksPath, "user tasks");
        sandbox
            .stub(vscode.workspace, "workspaceFolders")
            .value([{ index: 0, name: "workspace", uri: vscode.Uri.file(workspaceRoot) }]);
        controller = createController();
        sandbox.stub(vscode.window, "showWarningMessage").resolves("Overwrite" as never);
        stubTemplateApplication({
            ".devcontainer/devcontainer.json": '{ "name": "Azure SQL" }',
            ".vscode/tasks.json": "template tasks",
        });

        const result = await controller["applyDevContainerTemplate"](DevContainerTemplateId.DotNet);

        expect(result).to.deep.equal({ applied: true, usedPicker: false });
        expect(await fs.promises.readFile(tasksPath, "utf8")).to.equal("template tasks");
    });

    test("overwrites every remaining conflict after Overwrite All, with one prompt", async () => {
        const workspaceRoot = await createTemporaryDirectory("mssql-overview-overwrite-all-");
        const tasksPath = path.join(workspaceRoot, ".vscode", "tasks.json");
        const attributesPath = path.join(workspaceRoot, ".gitattributes");
        const devcontainerPath = path.join(workspaceRoot, ".devcontainer", "devcontainer.json");
        await fs.promises.mkdir(path.dirname(tasksPath), { recursive: true });
        await fs.promises.mkdir(path.dirname(devcontainerPath), { recursive: true });
        await fs.promises.writeFile(devcontainerPath, "user devcontainer");
        await fs.promises.writeFile(tasksPath, "user tasks");
        await fs.promises.writeFile(attributesPath, "user attributes");
        sandbox
            .stub(vscode.workspace, "workspaceFolders")
            .value([{ index: 0, name: "workspace", uri: vscode.Uri.file(workspaceRoot) }]);
        controller = createController();
        const prompt = sandbox
            .stub(vscode.window, "showWarningMessage")
            .resolves("Overwrite All" as never);
        stubTemplateApplication({
            ".devcontainer/devcontainer.json": "template devcontainer",
            ".vscode/tasks.json": "template tasks",
            ".gitattributes": "template attributes",
        });

        const result = await controller["applyDevContainerTemplate"](DevContainerTemplateId.DotNet);

        expect(result).to.deep.equal({ applied: true, usedPicker: false });
        expect(prompt).to.have.been.calledOnce;
        expect(await fs.promises.readFile(devcontainerPath, "utf8")).to.equal(
            "template devcontainer",
        );
        expect(await fs.promises.readFile(tasksPath, "utf8")).to.equal("template tasks");
        expect(await fs.promises.readFile(attributesPath, "utf8")).to.equal("template attributes");
    });

    test("does not offer Overwrite All for the only conflicting file", async () => {
        const workspaceRoot = await createTemporaryDirectory("mssql-overview-single-conflict-");
        const tasksPath = path.join(workspaceRoot, ".vscode", "tasks.json");
        await fs.promises.mkdir(path.dirname(tasksPath), { recursive: true });
        await fs.promises.writeFile(tasksPath, "user tasks");
        sandbox
            .stub(vscode.workspace, "workspaceFolders")
            .value([{ index: 0, name: "workspace", uri: vscode.Uri.file(workspaceRoot) }]);
        controller = createController();
        const prompt = sandbox
            .stub(vscode.window, "showWarningMessage")
            .resolves("Overwrite" as never);
        stubTemplateApplication({
            ".devcontainer/devcontainer.json": '{ "name": "Azure SQL" }',
            ".vscode/tasks.json": "template tasks",
        });

        await controller["applyDevContainerTemplate"](DevContainerTemplateId.DotNet);

        expect(prompt.firstCall.args).to.not.include("Overwrite All");
    });

    test("copies all template files when every destination is new", async () => {
        const workspaceRoot = await createTemporaryDirectory("mssql-overview-apply-");
        sandbox
            .stub(vscode.workspace, "workspaceFolders")
            .value([{ index: 0, name: "workspace", uri: vscode.Uri.file(workspaceRoot) }]);
        controller = createController();
        stubTemplateApplication({
            ".devcontainer/devcontainer.json": '{ "name": "Azure SQL" }',
            ".vscode/tasks.json": "template tasks",
        });

        const result = await controller["applyDevContainerTemplate"](DevContainerTemplateId.DotNet);

        expect(result).to.deep.equal({ applied: true, usedPicker: false });
        expect(
            await fs.promises.readFile(
                path.join(workspaceRoot, ".devcontainer", "devcontainer.json"),
                "utf8",
            ),
        ).to.equal('{ "name": "Azure SQL" }');
        expect(
            await fs.promises.readFile(path.join(workspaceRoot, ".vscode", "tasks.json"), "utf8"),
        ).to.equal("template tasks");
    });

    test("exclusive copy refuses a destination created after the preflight check", async () => {
        const workspaceRoot = await createTemporaryDirectory("mssql-overview-race-workspace-");
        const stagingRoot = await createTemporaryDirectory("mssql-overview-race-staging-");
        const relativePath = ".vscode/tasks.json";
        const destination = path.join(workspaceRoot, relativePath);
        const source = path.join(stagingRoot, relativePath);
        await fs.promises.mkdir(path.dirname(destination), { recursive: true });
        await fs.promises.mkdir(path.dirname(source), { recursive: true });
        await fs.promises.writeFile(destination, "user tasks");
        await fs.promises.writeFile(source, "template tasks");
        controller = createController();

        let copyError: unknown;
        try {
            await controller["copyTemplateFiles"](
                stagingRoot,
                vscode.Uri.file(workspaceRoot),
                [relativePath],
                new Map(),
            );
        } catch (error) {
            copyError = error;
        }

        expect(copyError).to.be.instanceOf(Error);
        expect(await fs.promises.readFile(destination, "utf8")).to.equal("user tasks");
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

    test("ignores a superseded refresh that resolves after a newer one", async () => {
        controller = createController();
        await waitForRecentFiles();

        // Hold both refreshes open so the first one can be made to finish last.
        const resolvers: ((files: ResolvedRecentSqlFile[]) => void)[] = [];
        recentFilesStub.callsFake(
            () => new Promise<ResolvedRecentSqlFile[]>((resolve) => resolvers.push(resolve)),
        );

        storeChangeEvent.fire();
        storeChangeEvent.fire();
        expect(resolvers).to.have.lengthOf(2);

        resolvers[1]([{ fsPath: "/work/newest.sql", timestampMs: 2 }]);
        resolvers[0]([{ fsPath: "/work/stale.sql", timestampMs: 1 }]);
        await waitForRecentFiles();

        expect(controller.state.recentFiles.map((file) => file.fsPath)).to.deep.equal([
            "/work/newest.sql",
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
