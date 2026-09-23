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
    DevContainerPrerequisitesChangedNotification,
    DevContainerTemplateId,
    OverviewOpenSource,
    PrerequisiteStatus,
} from "../../src/sharedInterfaces/overview";
import * as constants from "../../src/constants/constants";
import * as telemetry from "extension-toolkit/vscode/telemetry";
import { TelemetryActions } from "../../src/sharedInterfaces/telemetry";
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
    let globalStateValues: Map<string, unknown>;
    let globalStorageRoot: string;

    function createController(): OverviewWebviewController {
        const created = new OverviewWebviewController(
            {
                extensionUri: vscode.Uri.parse("file:///extension"),
                extensionPath: "extension",
                globalStorageUri: vscode.Uri.file(globalStorageRoot),
                // Backs the remembered parent folder for dev container scaffolding.
                globalState: {
                    get: (key: string) => globalStateValues.get(key),
                    update: (key: string, value: unknown) => {
                        globalStateValues.set(key, value);
                        return Promise.resolve();
                    },
                },
            } as unknown as vscode.ExtensionContext,
            {
                getRecentFiles: recentFilesStub,
                onDidChange: storeChangeEvent.event,
            } as unknown as RecentSqlFilesStore,
            {
                isInstalled: agentSkillsInstalledStub,
                install: agentSkillsInstallStub,
            } as unknown as AgentPluginsInstaller,
            {
                isInstalled: sinon.stub().resolves(false),
                install: sinon.stub().resolves(true),
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
        globalStateValues = new Map<string, unknown>();
        globalStorageRoot = "globalStorage";
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
                // Prefixed the way the real CLI reports them -- "./.gitattributes", not
                // ".gitattributes" -- so the stub cannot pass paths the real one never sends.
                return `${JSON.stringify({ files: Object.keys(files).map((file) => `./${file}`) })}\n`;
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

    test("tells the setup dialog when a prerequisite changes outside the page", async () => {
        controller = createController();
        controller["_lastPrerequisites"] = {
            docker: PrerequisiteStatus.Missing,
            devContainersExtension: PrerequisiteStatus.Missing,
        };
        const notify = sandbox.stub(controller, "sendNotification").resolves();
        // State pushes share the channel, so only the prerequisite notifications are counted.
        const prerequisiteNotifications = () =>
            notify
                .getCalls()
                .filter(
                    (call) => call.args[0] === DevContainerPrerequisitesChangedNotification.type,
                )
                .map((call) => call.args[1]);

        // Installed from its page in the Extensions view.
        (vscode.extensions.getExtension as sinon.SinonStub).returns({});
        await controller["publishPrerequisites"]();

        expect(prerequisiteNotifications()).to.deep.equal([
            {
                docker: PrerequisiteStatus.Missing,
                devContainersExtension: PrerequisiteStatus.Ready,
            },
        ]);

        // Nothing moved since, so there is nothing to tell.
        await controller["publishPrerequisites"]();
        expect(prerequisiteNotifications()).to.have.length(1);

        // The extension went from missing to ready, which is counted as an install.
        const installs = (telemetry.sendActionEvent as sinon.SinonStub)
            .getCalls()
            .filter((call) => call.args[1] === TelemetryActions.PrerequisiteInstalled)
            .map((call) => call.args[2]?.additionalProps);
        expect(installs).to.deep.equal([{ prerequisite: "devContainersExtension" }]);
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

        expect(result).to.deep.equal({
            applied: true,
            usedPicker: false,
            targetPath: workspaceRoot,
            // Written into the folder already open, so nothing has to be opened afterwards.
            opensNewFolder: false,
        });
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

        expect(result).to.deep.equal({
            applied: true,
            usedPicker: false,
            targetPath: workspaceRoot,
            // Written into the folder already open, so nothing has to be opened afterwards.
            opensNewFolder: false,
        });
        expect(await fs.promises.readFile(tasksPath, "utf8")).to.equal("template tasks");
    });

    test("rejects a template file reached through a symlinked parent directory", async () => {
        const workspaceRoot = await createTemporaryDirectory("mssql-overview-symlink-");
        const outside = await createTemporaryDirectory("mssql-overview-outside-");
        await fs.promises.writeFile(path.join(outside, "secret.txt"), "not the template's to give");
        sandbox
            .stub(vscode.workspace, "workspaceFolders")
            .value([{ index: 0, name: "workspace", uri: vscode.Uri.file(workspaceRoot) }]);
        controller = createController();

        // The path stays inside the staging root lexically, and its last component is a real
        // file, so neither the prefix check nor lstat on that component objects. Only resolving
        // `link` catches that the read lands outside the staging tree.
        sandbox
            .stub(controller as unknown as Record<string, unknown>, "findDevContainersCli")
            .returns("/fake/devContainersSpecCLI.js");
        sandbox
            .stub(controller as unknown as Record<string, unknown>, "runDevContainersCli")
            .callsFake(async (_cliPath: string, args: string[]) => {
                const stagingDirectory = args[args.indexOf("--workspace-folder") + 1];
                await fs.promises.symlink(outside, path.join(stagingDirectory, "link"), "dir");
                return `${JSON.stringify({ files: ["link/secret.txt"] })}\n`;
            });

        const result = await controller["applyDevContainerTemplate"](DevContainerTemplateId.DotNet);

        expect(result.applied).to.equal(false);
        expect(result.error).to.match(/escapes the staging directory/);
        expect(fs.existsSync(path.join(workspaceRoot, "link", "secret.txt"))).to.be.false;
    });

    test("refuses to write a template file through a symlinked workspace directory", async () => {
        const workspaceRoot = await createTemporaryDirectory("mssql-overview-writelink-");
        const outside = await createTemporaryDirectory("mssql-overview-writeout-");
        // A workspace whose `.vscode` points elsewhere. Joining the destination lexically and
        // writing it follows the link, putting a template file outside the chosen folder.
        await fs.promises.symlink(outside, path.join(workspaceRoot, ".vscode"), "dir");
        sandbox
            .stub(vscode.workspace, "workspaceFolders")
            .value([{ index: 0, name: "workspace", uri: vscode.Uri.file(workspaceRoot) }]);
        controller = createController();
        stubTemplateApplication({ ".vscode/tasks.json": "template tasks" });

        const result = await controller["applyDevContainerTemplate"](DevContainerTemplateId.DotNet);

        expect(result.applied).to.equal(false);
        expect(result.error).to.match(/escapes the workspace folder/);
        expect(fs.existsSync(path.join(outside, "tasks.json"))).to.be.false;
    });

    test("refuses to write through a dangling workspace symlink", async () => {
        const workspaceRoot = await createTemporaryDirectory("mssql-overview-brokenlink-");
        const outsideParent = await createTemporaryDirectory("mssql-overview-outside-");
        const outside = path.join(outsideParent, "missing");
        await fs.promises.symlink(outside, path.join(workspaceRoot, ".vscode"), "dir");
        sandbox
            .stub(vscode.workspace, "workspaceFolders")
            .value([{ index: 0, name: "workspace", uri: vscode.Uri.file(workspaceRoot) }]);
        controller = createController();
        stubTemplateApplication({ ".vscode/tasks.json": "template tasks" });

        const result = await controller["applyDevContainerTemplate"](DevContainerTemplateId.DotNet);

        expect(result.applied).to.equal(false);
        expect(fs.existsSync(path.join(outside, "tasks.json"))).to.be.false;
    });

    test("accepts nested template destinations under a filesystem-root workspace", async () => {
        controller = createController();
        const root = path.parse(process.cwd()).root;

        const destinations = await controller["resolveTemplateDestinations"](
            vscode.Uri.file(root),
            ["mssql-overview-new/nested/tasks.json"],
        );

        expect(destinations[0].directory).to.equal(path.join(root, "mssql-overview-new", "nested"));
    });

    suite("post-update trigger", () => {
        const LAST_VERSION_KEY = "changelog/lastChangeLogVersion";

        /**
         * A context whose global state is a plain map, plus the extension version and the
         * setting the trigger gates on.
         */
        function stubUpdateEnvironment(options: {
            lastShownVersion?: string;
            currentVersion?: string;
            settingValue?: boolean;
        }) {
            const state = new Map<string, unknown>();
            if (options.lastShownVersion !== undefined) {
                state.set(LAST_VERSION_KEY, options.lastShownVersion);
            }
            const update = sinon.stub().callsFake((key: string, value: unknown) => {
                state.set(key, value);
                return Promise.resolve();
            });

            (vscode.extensions.getExtension as sinon.SinonStub)
                .withArgs(constants.extensionId)
                .returns({
                    packageJSON: { version: options.currentVersion ?? "1.46.0" },
                } as unknown as vscode.Extension<unknown>);
            sandbox.stub(vscode.workspace, "getConfiguration").returns({
                inspect: () => ({ globalValue: options.settingValue }),
            } as unknown as vscode.WorkspaceConfiguration);

            return {
                update,
                context: {
                    globalState: { get: (key: string) => state.get(key), update },
                } as unknown as vscode.ExtensionContext,
            };
        }

        test("opens the page with the post-update payload and records the version", async () => {
            const { context, update } = stubUpdateEnvironment({ settingValue: true });

            await OverviewWebviewController.showWelcomeOnExtensionUpdate(context);

            expect(vscode.commands.executeCommand).to.have.been.calledWithExactly(
                constants.cmdOpenOverview,
                { openWhatsNew: true, source: OverviewOpenSource.PostUpdate },
            );
            expect(update).to.have.been.calledWithExactly(LAST_VERSION_KEY, "1.46.0");
        });

        test("does not open the page again for a version already shown", async () => {
            const { context, update } = stubUpdateEnvironment({
                lastShownVersion: "1.46.0",
                currentVersion: "1.46.0",
                settingValue: true,
            });

            await OverviewWebviewController.showWelcomeOnExtensionUpdate(context);

            expect(vscode.commands.executeCommand).to.not.have.been.called;
            expect(update).to.not.have.been.called;
        });

        test("does not open the page when the user turned the setting off", async () => {
            const { context, update } = stubUpdateEnvironment({ settingValue: false });

            await OverviewWebviewController.showWelcomeOnExtensionUpdate(context);

            expect(vscode.commands.executeCommand).to.not.have.been.called;
            // The version stays unrecorded, so turning the setting back on still shows the
            // notes for this version rather than silently skipping it.
            expect(update).to.not.have.been.called;
        });
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

        expect(result).to.deep.equal({
            applied: true,
            usedPicker: false,
            targetPath: workspaceRoot,
            // Written into the folder already open, so nothing has to be opened afterwards.
            opensNewFolder: false,
        });
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

        expect(result).to.deep.equal({
            applied: true,
            usedPicker: false,
            targetPath: workspaceRoot,
            // Written into the folder already open, so nothing has to be opened afterwards.
            opensNewFolder: false,
        });
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

    suite("configuration stored outside the folder", () => {
        /**
         * Writes a configuration into the Dev Containers extension's store the way it does:
         * a folder named after the workspace, holding a marker naming the folder it belongs to.
         */
        async function storeUserDataConfig(
            storageParent: string,
            entryName: string,
            rootFolder: string,
        ): Promise<void> {
            const directory = path.join(
                storageParent,
                "ms-vscode-remote.remote-containers",
                "configs",
                entryName,
            );
            await fs.promises.mkdir(directory, { recursive: true });
            await fs.promises.writeFile(
                path.join(directory, ".devcontainer-internal.json"),
                // Byte for byte what the extension writes, including the line comment that
                // swallows the opening brace.
                `// Maintained by the Dev Container extension ${JSON.stringify(
                    { rootFolder },
                    undefined,
                    "\t",
                )}`,
            );
        }

        /** The storage folder holding both extensions' directories as siblings. */
        async function createStorageParent(): Promise<string> {
            const parent = await createTemporaryDirectory("mssql-overview-storage-");
            globalStorageRoot = path.join(parent, "ms-mssql.mssql");
            return parent;
        }

        test("finds a configuration the Dev Containers extension holds for the folder", async () => {
            const workspaceRoot = await createTemporaryDirectory("mssql-overview-userdata-");
            const storageParent = await createStorageParent();
            await storeUserDataConfig(storageParent, path.basename(workspaceRoot), workspaceRoot);
            controller = createController();

            const found = await controller["findUserDataDevContainerConfig"](workspaceRoot);

            expect(found).to.be.true;
        });

        test("matches a configuration stored under a collision suffix", async () => {
            const workspaceRoot = await createTemporaryDirectory("mssql-overview-suffix-");
            const storageParent = await createStorageParent();
            // Another folder of the same name claimed the unsuffixed entry first.
            await storeUserDataConfig(
                storageParent,
                path.basename(workspaceRoot),
                "/somewhere/else",
            );
            await storeUserDataConfig(
                storageParent,
                `${path.basename(workspaceRoot)}-2`,
                workspaceRoot,
            );
            controller = createController();

            expect(await controller["findUserDataDevContainerConfig"](workspaceRoot)).to.be.true;
        });

        test("ignores a configuration belonging to a different folder", async () => {
            const workspaceRoot = await createTemporaryDirectory("mssql-overview-other-");
            const storageParent = await createStorageParent();
            // Same last path segment, different folder: the marker is what tells them apart.
            await storeUserDataConfig(
                storageParent,
                path.basename(workspaceRoot),
                path.join("/elsewhere", path.basename(workspaceRoot)),
            );
            controller = createController();

            expect(await controller["findUserDataDevContainerConfig"](workspaceRoot)).to.be.false;
        });

        test("reports nothing when no configuration has ever been stored", async () => {
            const workspaceRoot = await createTemporaryDirectory("mssql-overview-nostore-");
            await createStorageParent();
            controller = createController();

            expect(await controller["findUserDataDevContainerConfig"](workspaceRoot)).to.be.false;
        });

        test("reports a folder as configured when only the stored copy exists", async () => {
            const workspaceRoot = await createTemporaryDirectory("mssql-overview-state-");
            const storageParent = await createStorageParent();
            await storeUserDataConfig(storageParent, path.basename(workspaceRoot), workspaceRoot);
            sandbox
                .stub(vscode.workspace, "workspaceFolders")
                .value([{ index: 0, name: "workspace", uri: vscode.Uri.file(workspaceRoot) }]);
            controller = createController();

            // Nothing in the folder itself, so the old check said there was no dev container.
            const found = await controller["findDevContainerConfig"]([
                { index: 0, name: "workspace", uri: vscode.Uri.file(workspaceRoot) },
            ] as vscode.WorkspaceFolder[]);

            expect(found).to.be.true;
        });
    });

    suite("scaffolding location", () => {
        test("proposes the open folder when there is one", async () => {
            const workspaceRoot = await createTemporaryDirectory("mssql-overview-target-open-");
            sandbox
                .stub(vscode.workspace, "workspaceFolders")
                .value([{ index: 0, name: "workspace", uri: vscode.Uri.file(workspaceRoot) }]);
            controller = createController();

            const target = await controller["getDevContainerTarget"](DevContainerTemplateId.DotNet);

            expect(target.workspaceFolders).to.deep.equal([
                { name: "workspace", path: workspaceRoot },
            ]);
            // The other option is proposed too, so choosing it needs no second round trip.
            expect(target.newFolderPath).to.be.a("string").and.not.equal(workspaceRoot);
        });

        test("proposes a new folder under the remembered parent when nothing is open", async () => {
            const parent = await createTemporaryDirectory("mssql-overview-target-parent-");
            sandbox.stub(vscode.workspace, "workspaceFolders").value(undefined);
            controller = createController();
            globalStateValues.set("mssql.overview.devContainerTargetParent", parent);

            const target = await controller["getDevContainerTarget"](DevContainerTemplateId.DotNet);

            // Named after the template's own folder, so the four templates do not collide.
            expect(target.newFolderPath).to.equal(path.join(parent, "dotnet"));
            expect(target.workspaceFolders).to.deep.equal([]);
        });

        test("offers every open workspace folder in a multi-root window", async () => {
            const first = await createTemporaryDirectory("mssql-overview-target-first-");
            const second = await createTemporaryDirectory("mssql-overview-target-second-");
            sandbox.stub(vscode.workspace, "workspaceFolders").value([
                { index: 0, name: "first", uri: vscode.Uri.file(first) },
                { index: 1, name: "second", uri: vscode.Uri.file(second) },
            ]);
            controller = createController();
            stubTemplateApplication({ ".devcontainer/devcontainer.json": "{}" });

            const target = await controller["getDevContainerTarget"](DevContainerTemplateId.DotNet);
            expect(target.workspaceFolders).to.deep.equal([
                { name: "first", path: first },
                { name: "second", path: second },
            ]);

            const result = await controller["applyDevContainerTemplate"](
                DevContainerTemplateId.DotNet,
                {},
                second,
            );
            expect(result.applied).to.be.true;
            expect(result.opensNewFolder).to.be.true;
            expect(
                await fs.promises.readFile(
                    path.join(second, ".devcontainer", "devcontainer.json"),
                    "utf8",
                ),
            ).to.equal("{}");
            expect(
                await fs.promises.stat(path.join(first, ".devcontainer")).then(
                    () => true,
                    () => false,
                ),
            ).to.be.false;
        });

        test("steps past a proposed folder that already exists", async () => {
            const parent = await createTemporaryDirectory("mssql-overview-target-taken-");
            await fs.promises.mkdir(path.join(parent, "dotnet"));
            sandbox.stub(vscode.workspace, "workspaceFolders").value(undefined);
            controller = createController();
            globalStateValues.set("mssql.overview.devContainerTargetParent", parent);

            const target = await controller["getDevContainerTarget"](DevContainerTemplateId.DotNet);

            expect(target.newFolderPath).to.equal(path.join(parent, "dotnet-2"));
        });

        test("creates the chosen folder and writes the template into it", async () => {
            const parent = await createTemporaryDirectory("mssql-overview-target-create-");
            const destination = path.join(parent, "new-project");
            sandbox.stub(vscode.workspace, "workspaceFolders").value(undefined);
            controller = createController();
            stubTemplateApplication({
                ".devcontainer/devcontainer.json": '{ "name": "Azure SQL" }',
            });

            const result = await controller["applyDevContainerTemplate"](
                DevContainerTemplateId.DotNet,
                {},
                destination,
            );

            expect(result.applied).to.be.true;
            expect(result.targetPath).to.equal(destination);
            // Nothing is open, so this is a folder the user will have to be taken to.
            expect(result.opensNewFolder).to.be.true;
            expect(
                await fs.promises.readFile(
                    path.join(destination, ".devcontainer", "devcontainer.json"),
                    "utf8",
                ),
            ).to.equal('{ "name": "Azure SQL" }');
        });

        test("takes back a folder it created when the template cannot be applied", async () => {
            const parent = await createTemporaryDirectory("mssql-overview-discard-");
            const destination = path.join(parent, "project");
            sandbox.stub(vscode.workspace, "workspaceFolders").value(undefined);
            controller = createController();
            sandbox
                .stub(controller as unknown as Record<string, unknown>, "findDevContainersCli")
                .returns("/fake/devContainersSpecCLI.js");
            sandbox
                .stub(controller as unknown as Record<string, unknown>, "runDevContainersCli")
                .rejects(new Error("apply failed"));

            const result = await controller["applyDevContainerTemplate"](
                DevContainerTemplateId.DotNet,
                {},
                destination,
            );

            expect(result.applied).to.be.false;
            // Otherwise every failed attempt leaves an empty folder, and the next proposal
            // steps past it: dotnet, dotnet-2, dotnet-3.
            expect(
                await fs.promises
                    .stat(destination)
                    .then(() => true)
                    .catch(() => false),
            ).to.be.false;
        });

        test("leaves a folder the user already had, even when the apply fails", async () => {
            const parent = await createTemporaryDirectory("mssql-overview-keep-");
            const destination = path.join(parent, "existing");
            await fs.promises.mkdir(destination);
            sandbox.stub(vscode.workspace, "workspaceFolders").value(undefined);
            controller = createController();
            sandbox
                .stub(controller as unknown as Record<string, unknown>, "findDevContainersCli")
                .returns("/fake/devContainersSpecCLI.js");
            sandbox
                .stub(controller as unknown as Record<string, unknown>, "runDevContainersCli")
                .rejects(new Error("apply failed"));

            await controller["applyDevContainerTemplate"](
                DevContainerTemplateId.DotNet,
                {},
                destination,
            );

            expect(
                await fs.promises
                    .stat(destination)
                    .then(() => true)
                    .catch(() => false),
            ).to.be.true;
        });

        test("refuses a location that is not an absolute path", async () => {
            sandbox.stub(vscode.workspace, "workspaceFolders").value(undefined);
            controller = createController();
            stubTemplateApplication({ ".devcontainer/devcontainer.json": "{}" });

            const result = await controller["applyDevContainerTemplate"](
                DevContainerTemplateId.DotNet,
                {},
                "relative/path",
            );

            // A relative path would resolve against the extension host's working directory.
            expect(result.applied).to.be.false;
            expect(result.error).to.contain("absolute");
        });

        test("confines the write to the chosen folder, not to the workspace", async () => {
            const parent = await createTemporaryDirectory("mssql-overview-target-symlink-");
            const destination = path.join(parent, "project");
            const outside = path.join(parent, "outside");
            await fs.promises.mkdir(destination);
            await fs.promises.mkdir(outside);
            // A template directory that is a link out of the chosen folder: the containment
            // check has to anchor to that folder, since there is no workspace here at all.
            await fs.promises.symlink(outside, path.join(destination, ".devcontainer"));
            sandbox.stub(vscode.workspace, "workspaceFolders").value(undefined);
            controller = createController();
            stubTemplateApplication({ ".devcontainer/devcontainer.json": "{}" });

            const result = await controller["applyDevContainerTemplate"](
                DevContainerTemplateId.DotNet,
                {},
                destination,
            );

            expect(result.applied).to.be.false;
            expect(
                await fs.promises
                    .stat(path.join(outside, "devcontainer.json"))
                    .then(() => true)
                    .catch(() => false),
            ).to.be.false;
        });

        test("remembers the parent of a folder the user chose", async () => {
            const parent = await createTemporaryDirectory("mssql-overview-target-remember-");
            const destination = path.join(parent, "project");
            sandbox.stub(vscode.workspace, "workspaceFolders").value(undefined);
            controller = createController();
            stubTemplateApplication({ ".devcontainer/devcontainer.json": "{}" });

            await controller["applyDevContainerTemplate"](
                DevContainerTemplateId.DotNet,
                {},
                destination,
            );

            expect(globalStateValues.get("mssql.overview.devContainerTargetParent")).to.equal(
                parent,
            );
        });

        test("does not remember anything when scaffolding into the open folder", async () => {
            const workspaceRoot = await createTemporaryDirectory("mssql-overview-target-ws-");
            sandbox
                .stub(vscode.workspace, "workspaceFolders")
                .value([{ index: 0, name: "workspace", uri: vscode.Uri.file(workspaceRoot) }]);
            controller = createController();
            stubTemplateApplication({ ".devcontainer/devcontainer.json": "{}" });

            const result = await controller["applyDevContainerTemplate"](
                DevContainerTemplateId.DotNet,
            );

            // The siblings of a folder they already had open say nothing about where they keep
            // new projects.
            expect(globalStateValues.has("mssql.overview.devContainerTargetParent")).to.be.false;
            expect(result.opensNewFolder).to.be.false;
        });
    });

    suite("template options", () => {
        /** Stubs the metadata call with a document shaped like the registry's own. */
        function stubTemplateMetadata(metadata: unknown): sinon.SinonStub {
            sandbox
                .stub(controller as unknown as Record<string, unknown>, "findDevContainersCli")
                .returns("/fake/devContainersSpecCLI.js");
            return sandbox
                .stub(controller as unknown as Record<string, unknown>, "runDevContainersCli")
                .resolves(`${JSON.stringify(metadata)}\n`);
        }

        test("offers only the string options that carry a choice", async () => {
            controller = createController();
            stubTemplateMetadata({
                options: {
                    imageVariant: {
                        type: "string",
                        description: ".NET version:",
                        proposals: ["10.0-noble", "8.0-noble"],
                        default: "10.0-noble",
                    },
                    // One value is not a choice.
                    onlyOne: { type: "string", proposals: ["sole"], default: "sole" },
                    // Booleans have no control in the dialog yet.
                    installAzd: { type: "boolean", default: true },
                    // A closed list is offered the same way a suggested one is.
                    edition: { type: "string", enum: ["developer", "express"] },
                },
            });

            const options = await controller["getDevContainerTemplateOptions"](
                DevContainerTemplateId.DotNet,
            );

            expect(options).to.deep.equal([
                {
                    id: "imageVariant",
                    label: ".NET version:",
                    defaultValue: "10.0-noble",
                    values: ["10.0-noble", "8.0-noble"],
                },
                {
                    // No description, so the key stands in as the label.
                    id: "edition",
                    label: "edition",
                    defaultValue: "developer",
                    values: ["developer", "express"],
                },
            ]);
        });

        test("falls back to the first value when the declared default is not one of them", async () => {
            controller = createController();
            stubTemplateMetadata({
                options: {
                    imageVariant: {
                        type: "string",
                        proposals: ["10.0-noble", "8.0-noble"],
                        default: "9.0-retired",
                    },
                },
            });

            const options = await controller["getDevContainerTemplateOptions"](
                DevContainerTemplateId.DotNet,
            );

            expect(options[0].defaultValue).to.equal("10.0-noble");
        });

        test("reports no options when the metadata cannot be read", async () => {
            controller = createController();
            sandbox
                .stub(controller as unknown as Record<string, unknown>, "findDevContainersCli")
                .returns("/fake/devContainersSpecCLI.js");
            sandbox
                .stub(controller as unknown as Record<string, unknown>, "runDevContainersCli")
                .rejects(new Error("offline"));

            const options = await controller["getDevContainerTemplateOptions"](
                DevContainerTemplateId.DotNet,
            );

            // Applying with defaults still works, so an unreadable registry costs the dropdown
            // rather than the flow.
            expect(options).to.deep.equal([]);
        });

        test("reads a template's metadata once", async () => {
            controller = createController();
            const run = stubTemplateMetadata({
                options: {
                    imageVariant: { type: "string", proposals: ["a", "b"], default: "a" },
                },
            });

            await controller["getDevContainerTemplateOptions"](DevContainerTemplateId.DotNet);
            await controller["getDevContainerTemplateOptions"](DevContainerTemplateId.DotNet);

            expect(run).to.have.been.calledOnce;
        });

        test("keeps only the values the template declares", async () => {
            controller = createController();
            stubTemplateMetadata({
                options: {
                    imageVariant: {
                        type: "string",
                        proposals: ["10.0-noble", "8.0-noble"],
                        default: "10.0-noble",
                    },
                },
            });

            const resolved = await controller["resolveTemplateOptions"](
                DevContainerTemplateId.DotNet,
                {
                    imageVariant: "8.0-noble",
                    // Not declared by the template.
                    somethingElse: "value",
                },
            );

            expect(resolved).to.deep.equal({ imageVariant: "8.0-noble" });
        });

        test("drops a value the template does not list", async () => {
            controller = createController();
            stubTemplateMetadata({
                options: {
                    imageVariant: {
                        type: "string",
                        proposals: ["10.0-noble", "8.0-noble"],
                        default: "10.0-noble",
                    },
                },
            });

            // The values are substituted into the template's files, so an unlisted one is
            // refused rather than passed through; the option keeps its default.
            const resolved = await controller["resolveTemplateOptions"](
                DevContainerTemplateId.DotNet,
                { imageVariant: "$(whoami)" },
            );

            expect(resolved).to.deep.equal({});
        });

        test("passes the chosen options to the CLI as template arguments", async () => {
            const workspaceRoot = await createTemporaryDirectory("mssql-overview-args-");
            sandbox
                .stub(vscode.workspace, "workspaceFolders")
                .value([{ index: 0, name: "workspace", uri: vscode.Uri.file(workspaceRoot) }]);
            controller = createController();
            const run = stubTemplateApplication({
                ".devcontainer/devcontainer.json": '{ "name": "Azure SQL" }',
            });

            await controller["applyDevContainerTemplate"](DevContainerTemplateId.DotNet, {
                imageVariant: "8.0-noble",
            });

            const args = run.firstCall.args[1] as string[];
            expect(args[args.indexOf("--template-args") + 1]).to.equal(
                JSON.stringify({ imageVariant: "8.0-noble" }),
            );
        });

        test("passes an empty argument object when nothing was chosen", async () => {
            const workspaceRoot = await createTemporaryDirectory("mssql-overview-noargs-");
            sandbox
                .stub(vscode.workspace, "workspaceFolders")
                .value([{ index: 0, name: "workspace", uri: vscode.Uri.file(workspaceRoot) }]);
            controller = createController();
            const run = stubTemplateApplication({
                ".devcontainer/devcontainer.json": '{ "name": "Azure SQL" }',
            });

            await controller["applyDevContainerTemplate"](DevContainerTemplateId.DotNet);

            const args = run.firstCall.args[1] as string[];
            expect(args[args.indexOf("--template-args") + 1]).to.equal("{}");
        });
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
            const destinations = await controller["resolveTemplateDestinations"](
                vscode.Uri.file(workspaceRoot),
                [relativePath],
            );
            await controller["copyTemplateFiles"](stagingRoot, destinations, new Map());
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
