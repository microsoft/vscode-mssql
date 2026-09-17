/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as constants from "../constants/constants";
import * as dockerUtils from "../docker/dockerUtils";

import { Overview } from "../constants/locConstants";
import {
    AddDevContainerConfigurationRequest,
    AddDevContainerConfigurationRequestParams,
    DevContainerTemplateId,
    OpenRecentSqlFileRequest,
    OpenRecentSqlFileRequestParams,
    OverviewActionId,
    AddDevContainerConfigurationResult,
    CheckDevContainerPrerequisitesRequest,
    DevContainerPrerequisites,
    InstallDevContainersExtensionRequest,
    OpenFolderRequest,
    ReopenInContainerRequest,
    OverviewLinkRequest,
    OverviewLinkRequestParams,
    OverviewReducers,
    OverviewWebviewState,
    PrerequisiteStatus,
    RecentSqlFile,
    RunChangelogActionFromOverviewRequest,
    RunOverviewActionRequest,
    CommandShortcut,
} from "../sharedInterfaces/overview";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { WebviewPanelController } from "./webviewPanelController";
import { ChangelogActionId } from "../sharedInterfaces/changelog";
import { changelogConfig } from "../configurations/changelog";
import { resolveChangelogAction } from "../configurations/changelogActions";
import { DeploymentType } from "../sharedInterfaces/deployment";
import { RecentSqlFilesStore, ResolvedRecentSqlFile } from "../models/recentSqlFilesStore";
import { sendActionEvent } from "extension-toolkit/vscode";
import * as path from "path";
import { spawn } from "child_process";
import * as fs from "fs";

/** Identifier of the Dev Containers extension that owns dev container configuration. */
const DEV_CONTAINERS_EXTENSION_ID = "ms-vscode-remote.remote-containers";

/**
 * The Dev Containers extension's own "Add Dev Container Configuration Files..." command. It takes
 * no arguments and always opens its own picker, which lists the upstream templates rather than
 * ours, so it is only a fallback for when the bundled CLI cannot be found.
 */
const DEV_CONTAINERS_CREATE_CONFIG_COMMAND = "remote-containers.createDevContainerFile";

/** The extension's command to rebuild and reattach the window inside the container. */
const DEV_CONTAINERS_REOPEN_COMMAND = "remote-containers.reopenInContainer";

/** `vscode.env.remoteName` when the window is attached to a dev container. */
const DEV_CONTAINER_REMOTE_NAME = "dev-container";

/**
 * Relative path to the dev container spec CLI the Dev Containers extension bundles. This is an
 * implementation detail of that extension rather than a supported API, so its absence is handled
 * by falling back to {@link DEV_CONTAINERS_CREATE_CONFIG_COMMAND}.
 */
const DEV_CONTAINERS_CLI_RELATIVE_PATH = path.join("dist", "spec-node", "devContainersSpecCLI.js");

/** Config file names that mark a folder as already having a dev container. */
const DEV_CONTAINER_CONFIG_GLOB = "{.devcontainer/devcontainer.json,.devcontainer.json}";

/** The same two locations as concrete relative paths, for a direct existence check. */
const DEV_CONTAINER_CONFIG_PATHS = [[".devcontainer", "devcontainer.json"], [".devcontainer.json"]];

/** Most recent SQL files shown in the Overview page's right rail. */
const RECENT_FILE_LIMIT = 5;

/** Global state key recording the version whose release notes have already been shown. */
const GLOBAL_STATE_LAST_CHANGELOG_VERSION_KEY = "changelog/lastChangeLogVersion";

/** How the Welcome page was opened, which decides whether it greets the user with release notes. */
export interface OverviewOpenOptions {
    /** Opens the What's new drawer straight away; set only by the post-update trigger. */
    openWhatsNew?: boolean;
}

/** Maps an Overview action to the command it runs, plus any fixed arguments. */
const actionCommands: Record<OverviewActionId, { command: string; args?: unknown[] }> = {
    [OverviewActionId.AddConnection]: { command: constants.cmdAddObjectExplorer },
    // "New query" opens a blank SQL document rather than running the active editor.
    [OverviewActionId.NewQuery]: { command: constants.cmdNewQuery },
    [OverviewActionId.RunQuery]: { command: constants.cmdNewQuery },
    [OverviewActionId.OpenSqlFile]: { command: "workbench.action.files.openFile" },
    [OverviewActionId.ExecuteQuery]: { command: constants.cmdRunQuery },
    // Reveals the SQL Server container so the user can pick a database for the next step.
    [OverviewActionId.FocusConnections]: {
        command: "workbench.view.extension.objectExplorer",
    },
    [OverviewActionId.OpenCopilotChat]: { command: constants.cmdOpenGithubChat },
    [OverviewActionId.NewDeployment]: { command: constants.cmdDeployNewDatabase },
    // Passing a deployment type skips the chooser page and opens that wizard directly.
    [OverviewActionId.NewLocalContainer]: {
        command: constants.cmdDeployNewDatabase,
        args: [{ deploymentType: DeploymentType.LocalContainers }],
    },
    [OverviewActionId.NewFabricDatabase]: {
        command: constants.cmdDeployNewDatabase,
        args: [{ deploymentType: DeploymentType.FabricProvisioning }],
    },
    [OverviewActionId.NewAzureSqlDatabase]: {
        command: constants.cmdDeployNewDatabase,
        args: [{ deploymentType: DeploymentType.AzureSqlDatabase }],
    },
    [OverviewActionId.NewNotebook]: { command: constants.cmdNotebooksCreate },
    [OverviewActionId.NewTable]: { command: constants.cmdNewTable },
    [OverviewActionId.OpenShortcutsConfiguration]: {
        command: constants.cmdOpenShortcutsConfiguration,
    },
    [OverviewActionId.OpenChangelog]: { command: constants.cmdOpenChangelog },
};

/**
 * Repository folders backing each dev container template, used to open the template's source
 * when the user asks to learn more about it.
 */
const templateRepositoryFolders: Record<DevContainerTemplateId, string> = {
    [DevContainerTemplateId.DotNet]: "dotnet",
    [DevContainerTemplateId.DotNetAspire]: "dotnet-aspire",
    // The repository folder and registry id are "javascript-node", not "node".
    [DevContainerTemplateId.Node]: "javascript-node",
    [DevContainerTemplateId.Python]: "python",
};

/** OCI registry publishing the templates, whose ids match the repository folder names. */
const TEMPLATE_REGISTRY = "ghcr.io/microsoft/azuresql-devcontainers";

function templateRegistryId(templateId: DevContainerTemplateId): string {
    return `${TEMPLATE_REGISTRY}/${templateRepositoryFolders[templateId]}`;
}

/** Projects a resolved file into the shape the Overview page renders. */
function toRecentSqlFile(file: ResolvedRecentSqlFile): RecentSqlFile {
    return {
        fsPath: file.fsPath,
        fileName: path.basename(file.fsPath),
        folderLabel: path.basename(path.dirname(file.fsPath)),
        timestampMs: file.timestampMs,
    };
}

export class OverviewWebviewController extends WebviewPanelController<
    OverviewWebviewState,
    OverviewReducers
> {
    constructor(
        context: vscode.ExtensionContext,
        private _recentSqlFilesStore: RecentSqlFilesStore,
        options: OverviewOpenOptions = {},
    ) {
        super(
            context,
            "overview",
            "overview",
            OverviewWebviewController.buildInitialState(options),
            {
                title: Overview.OverviewDocumentTitle,
                viewColumn: vscode.ViewColumn.Active,
                iconPath: {
                    dark: vscode.Uri.joinPath(context.extensionUri, "media", "rocket_dark.svg"),
                    light: vscode.Uri.joinPath(context.extensionUri, "media", "rocket_light.svg"),
                },
            },
        );

        void this.refreshRecentFiles();

        // Registered on the controller so the listener dies with the panel rather than
        // accumulating one per panel on the extension context.
        this.registerDisposable(
            vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refreshWorkspaceState()),
        );

        // Our own scaffolding writes the configuration, so the page has to notice it appear while
        // it is on screen rather than only at load.
        const configWatcher = vscode.workspace.createFileSystemWatcher(DEV_CONTAINER_CONFIG_GLOB);
        this.registerDisposable(configWatcher);
        this.registerDisposable(configWatcher.onDidCreate(() => void this.refreshWorkspaceState()));
        this.registerDisposable(configWatcher.onDidDelete(() => void this.refreshWorkspaceState()));

        void this.refreshWorkspaceState();

        this.initialize();
    }

    private static buildInitialState(options: OverviewOpenOptions): OverviewWebviewState {
        return {
            extensionVersion:
                vscode.extensions.getExtension(constants.extensionId)?.packageJSON.version ?? "",
            recentFiles: [],
            changelog: changelogConfig,
            commandShortcuts: OverviewWebviewController.getCommandShortcuts(),
            hasWorkspaceFolder: (vscode.workspace.workspaceFolders?.length ?? 0) > 0,
            // Resolved asynchronously right after construction; see refreshWorkspaceState.
            hasDevContainerConfig: false,
            isInDevContainer: vscode.env.remoteName === DEV_CONTAINER_REMOTE_NAME,
            openWhatsNewOnLoad: options.openWhatsNew === true,
            showChangelogOnUpdate: OverviewWebviewController.shouldShowChangelogOnUpdate(),
        };
    }

    /** Opens the What's new drawer on a page that is already showing. */
    public openWhatsNew(): void {
        this.updateState({ ...this.state, openWhatsNewOnLoad: true });
    }

    private initialize(): void {
        this.registerReducer("setShowChangelogOnUpdate", async (state, payload) => {
            await vscode.workspace
                .getConfiguration()
                .update(
                    constants.configShowChangelogOnUpdate,
                    payload.value,
                    vscode.ConfigurationTarget.Global,
                );
            sendActionEvent(TelemetryViews.OverviewPage, TelemetryActions.ChangelogDontShowAgain, {
                additionalProps: {
                    showChangelogOnUpdate: String(payload.value),
                },
            });
            return { ...state, showChangelogOnUpdate: payload.value };
        });

        this.onRequest(CheckDevContainerPrerequisitesRequest.type, async () =>
            this.getDevContainerPrerequisites(),
        );

        this.onRequest(InstallDevContainersExtensionRequest.type, async () => {
            try {
                await vscode.commands.executeCommand(
                    "workbench.extensions.installExtension",
                    DEV_CONTAINERS_EXTENSION_ID,
                );
            } catch (error) {
                this.logger.error("Failed to install the Dev Containers extension", error);
                return this.getDevContainerPrerequisites();
            }

            sendActionEvent(
                TelemetryViews.OverviewPage,
                TelemetryActions.InstallDevContainersExtension,
            );

            return {
                docker: await this.checkDocker(),
                devContainersExtension: await this.waitForDevContainersExtension(),
            };
        });

        this.onRequest(OpenFolderRequest.type, async () => {
            // macOS has a single picker for files and folders; every other platform separates them.
            const command =
                process.platform === "darwin"
                    ? "workbench.action.files.openFileFolder"
                    : "workbench.action.files.openFolder";
            await vscode.commands.executeCommand(command);
            sendActionEvent(TelemetryViews.OverviewPage, TelemetryActions.ExecuteCommand, {
                additionalProps: { command },
            });
        });

        this.onRequest(OverviewLinkRequest.type, async (params: OverviewLinkRequestParams) => {
            await vscode.env.openExternal(vscode.Uri.parse(params.url));
            sendActionEvent(TelemetryViews.OverviewPage, TelemetryActions.OpenLink, {
                additionalProps: { url: params.url },
            });
        });

        this.onRequest(RunOverviewActionRequest.type, async (action: OverviewActionId) => {
            const target = actionCommands[action];
            if (!target) {
                throw new Error(`Unknown overview action: ${action}`);
            }
            await vscode.commands.executeCommand(target.command, ...(target.args ?? []));
            sendActionEvent(TelemetryViews.OverviewPage, TelemetryActions.ExecuteCommand, {
                additionalProps: { command: target.command },
            });
        });

        this.onRequest(
            OpenRecentSqlFileRequest.type,
            async (params: OpenRecentSqlFileRequestParams) => {
                const document = await vscode.workspace.openTextDocument(
                    vscode.Uri.file(params.fsPath),
                );
                await vscode.window.showTextDocument(document);
                sendActionEvent(TelemetryViews.OverviewPage, TelemetryActions.OpenRecentSqlFile);
            },
        );

        this.onRequest(
            RunChangelogActionFromOverviewRequest.type,
            async (action: ChangelogActionId) => {
                const { command, args } = resolveChangelogAction(action);
                await vscode.commands.executeCommand(command, ...args);
                sendActionEvent(TelemetryViews.OverviewPage, TelemetryActions.ExecuteCommand, {
                    additionalProps: { command },
                });
            },
        );

        this.onRequest(
            AddDevContainerConfigurationRequest.type,
            async (
                params: AddDevContainerConfigurationRequestParams,
            ): Promise<AddDevContainerConfigurationResult> => {
                const result = await this.applyDevContainerTemplate(params.templateId);
                sendActionEvent(
                    TelemetryViews.OverviewPage,
                    TelemetryActions.AddDevContainerConfiguration,
                    {
                        additionalProps: {
                            template: params.templateId,
                            repositoryFolder: templateRepositoryFolders[params.templateId],
                            applied: String(result.applied),
                            usedPicker: String(result.usedPicker),
                        },
                    },
                );
                return result;
            },
        );

        this.onRequest(ReopenInContainerRequest.type, async () => {
            // This path skips the prerequisite dialog, so the extension it depends on is checked
            // here rather than letting the command fail with "command not found".
            if (this.checkDevContainersExtension() !== PrerequisiteStatus.Ready) {
                const install = Overview.InstallDevContainersExtension;
                const choice = await vscode.window.showWarningMessage(
                    Overview.DevContainersExtensionRequired,
                    install,
                );
                if (choice === install) {
                    await vscode.commands.executeCommand(
                        "workbench.extensions.installExtension",
                        DEV_CONTAINERS_EXTENSION_ID,
                    );
                }
                return;
            }

            await vscode.commands.executeCommand(DEV_CONTAINERS_REOPEN_COMMAND);
            sendActionEvent(TelemetryViews.OverviewPage, TelemetryActions.ExecuteCommand, {
                additionalProps: { command: DEV_CONTAINERS_REOPEN_COMMAND },
            });
        });
    }

    /**
     * Commands surfaced in the keyboard shortcuts dialog, in display order. Their chords come
     * from the extension's contributed keybindings rather than being restated here.
     */
    private static readonly shortcutCommands: { command: string; label: string }[] = [
        { command: constants.cmdRunQuery, label: Overview.ShortcutExecuteQuery },
        { command: constants.cmdConnect, label: Overview.ShortcutConnect },
        { command: constants.cmdDisconnect, label: Overview.ShortcutDisconnect },
        {
            command: "workbench.view.extension.objectExplorer",
            label: Overview.ShortcutFocusObjectExplorer,
        },
        { command: constants.cmdCopyObjectName, label: Overview.ShortcutCopyObjectName },
    ];

    private static getCommandShortcuts(): CommandShortcut[] {
        const contributed: { command: string; key?: string; mac?: string }[] =
            vscode.extensions.getExtension(constants.extensionId)?.packageJSON?.contributes
                ?.keybindings ?? [];

        return OverviewWebviewController.shortcutCommands.flatMap(({ command, label }) => {
            const binding = contributed.find((entry) => entry.command === command);
            if (!binding?.key) {
                return [];
            }
            return [{ label, windows: binding.key, mac: binding.mac ?? binding.key }];
        });
    }

    /**
     * Loads the recent SQL file list and pushes it to the webview. Resolving the list touches the
     * filesystem, so it runs after the initial state is sent rather than blocking construction.
     */
    private async refreshRecentFiles(): Promise<void> {
        const files = await this._recentSqlFilesStore.getRecentFiles(RECENT_FILE_LIMIT);
        if (this.isDisposed) {
            return;
        }
        this.updateState({ ...this.state, recentFiles: files.map(toRecentSqlFile) });
    }

    /** Re-resolves the folder-dependent state the Dev containers tab keys off. */
    private async refreshWorkspaceState(): Promise<void> {
        if (this.isDisposed) {
            return;
        }
        const folders = vscode.workspace.workspaceFolders ?? [];
        const hasWorkspaceFolder = folders.length > 0;
        const hasDevContainerConfig = await this.findDevContainerConfig(folders);

        if (this.isDisposed) {
            return;
        }
        this.updateState({ ...this.state, hasWorkspaceFolder, hasDevContainerConfig });
    }

    /** Stats the two known configuration locations directly, so no exclude setting can hide them. */
    private async findDevContainerConfig(
        folders: readonly vscode.WorkspaceFolder[],
    ): Promise<boolean> {
        for (const folder of folders) {
            for (const segments of DEV_CONTAINER_CONFIG_PATHS) {
                try {
                    await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder.uri, ...segments));
                    return true;
                } catch {
                    // Not present at this location; try the next.
                }
            }
        }
        return false;
    }

    /**
     * Writes the chosen template's configuration into the open folder.
     *
     * The Dev Containers extension exposes no way to apply a named template — its command takes no
     * arguments and always opens a picker listing the upstream templates rather than ours — so this
     * drives the spec CLI the extension bundles, the same way the extension drives it. If that CLI
     * is not where we expect, the extension's own picker is opened instead.
     */
    private async applyDevContainerTemplate(
        templateId: DevContainerTemplateId,
    ): Promise<AddDevContainerConfigurationResult> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            // The webview disables the templates without a folder; this covers a race.
            await vscode.commands.executeCommand(DEV_CONTAINERS_CREATE_CONFIG_COMMAND);
            return { applied: false, usedPicker: true };
        }

        const cliPath = this.findDevContainersCli();
        if (!cliPath) {
            this.logger.warn(
                "Dev Containers CLI not found in the extension; falling back to its template picker.",
            );
            await vscode.commands.executeCommand(DEV_CONTAINERS_CREATE_CONFIG_COMMAND);
            return { applied: false, usedPicker: true };
        }

        try {
            await this.runDevContainersCli(cliPath, [
                "templates",
                "apply",
                "--template-id",
                templateRegistryId(templateId),
                "--workspace-folder",
                workspaceFolder.uri.fsPath,
            ]);
            await this.refreshWorkspaceState();
            return { applied: true, usedPicker: false };
        } catch (error) {
            this.logger.error("Failed to apply the dev container template", error);
            // Reported inline in the dialog rather than as a toast, so it sits with the step.
            return {
                applied: false,
                usedPicker: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /** Resolves the bundled spec CLI, or undefined when the extension no longer ships it there. */
    private findDevContainersCli(): string | undefined {
        const extension = vscode.extensions.getExtension(DEV_CONTAINERS_EXTENSION_ID);
        if (!extension) {
            return undefined;
        }
        const cliPath = path.join(extension.extensionPath, DEV_CONTAINERS_CLI_RELATIVE_PATH);
        return fs.existsSync(cliPath) ? cliPath : undefined;
    }

    /**
     * Runs the bundled CLI using VS Code's own executable as the Node runtime, which is what the
     * Dev Containers extension does locally. That keeps this working for users with no `node`
     * on their PATH.
     */
    private runDevContainersCli(cliPath: string, args: string[]): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const child = spawn(process.argv[0], [cliPath, ...args], {
                env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
            });

            let stderr = "";
            child.stderr?.on("data", (chunk) => {
                stderr += String(chunk);
            });
            child.on("error", reject);
            child.on("close", (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(stderr.trim() || `Exited with code ${code}`));
                }
            });
        });
    }

    private async getDevContainerPrerequisites(): Promise<DevContainerPrerequisites> {
        return {
            docker: await this.checkDocker(),
            devContainersExtension: this.checkDevContainersExtension(),
        };
    }

    private async checkDocker(): Promise<PrerequisiteStatus> {
        try {
            const installed = await dockerUtils.checkDockerInstallation();
            if (!installed.success) {
                return PrerequisiteStatus.Missing;
            }
            const engine = await dockerUtils.checkEngine();
            return engine.success ? PrerequisiteStatus.Ready : PrerequisiteStatus.Missing;
        } catch (error) {
            this.logger.error("Failed to check Docker prerequisites", error);
            return PrerequisiteStatus.Missing;
        }
    }

    /**
     * Waits for a freshly installed extension to show up in the registry. `installExtension`
     * resolves before the extension host has re-registered it, so reading the registry straight
     * after the command reports the extension as missing on a perfectly good install.
     */
    private async waitForDevContainersExtension(timeoutMs = 20000): Promise<PrerequisiteStatus> {
        if (this.checkDevContainersExtension() === PrerequisiteStatus.Ready) {
            return PrerequisiteStatus.Ready;
        }

        return new Promise<PrerequisiteStatus>((resolve) => {
            let settled = false;
            const finish = (status: PrerequisiteStatus) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                changeSubscription.dispose();
                resolve(status);
            };

            const changeSubscription = vscode.extensions.onDidChange(() => {
                if (this.checkDevContainersExtension() === PrerequisiteStatus.Ready) {
                    finish(PrerequisiteStatus.Ready);
                }
            });

            const timer = setTimeout(() => finish(this.checkDevContainersExtension()), timeoutMs);
        });
    }

    private checkDevContainersExtension(): PrerequisiteStatus {
        return vscode.extensions.getExtension(DEV_CONTAINERS_EXTENSION_ID)
            ? PrerequisiteStatus.Ready
            : PrerequisiteStatus.Missing;
    }

    /**
     * After an extension update, greets the user with the Welcome page and its release notes.
     * Runs at most once per version, and only while the user has left the setting on.
     */
    public static async showWelcomeOnExtensionUpdate(context: vscode.ExtensionContext) {
        const globalState = context?.globalState;
        if (!globalState) {
            return;
        }

        const lastChangeLogVersion = globalState.get(GLOBAL_STATE_LAST_CHANGELOG_VERSION_KEY);

        const currentVersion = vscode.extensions.getExtension(constants.extensionId)?.packageJSON
            .version;

        const isShownOnCurrentVersion = lastChangeLogVersion === currentVersion;

        if (!isShownOnCurrentVersion && this.shouldShowChangelogOnUpdate()) {
            await vscode.commands.executeCommand(constants.cmdOpenOverview, {
                openWhatsNew: true,
            });
            await globalState.update(GLOBAL_STATE_LAST_CHANGELOG_VERSION_KEY, currentVersion);
        }
    }

    /**
     * Whether release notes should greet the user after an update. A user who has never touched
     * the setting gets the contributed default.
     */
    public static shouldShowChangelogOnUpdate(): boolean {
        const vscodeConfig = vscode.workspace.getConfiguration();
        const configValues = vscodeConfig.inspect<boolean>(constants.configShowChangelogOnUpdate);

        return configValues?.globalValue ?? configValues?.defaultValue ?? true;
    }
}
