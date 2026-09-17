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
    InstallAgentSkillsPluginRequest,
    InstallDevContainersExtensionRequest,
    OpenFolderRequest,
    OverviewOpenSource,
    OverviewTelemetryEvent,
    ReopenInContainerRequest,
    SendOverviewTelemetryRequest,
    SendOverviewTelemetryRequestParams,
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
import {
    ActivityObject,
    ActivityStatus,
    TelemetryActions,
    TelemetryViews,
} from "../sharedInterfaces/telemetry";
import { WebviewPanelController } from "./webviewPanelController";
import { ChangelogActionId } from "../sharedInterfaces/changelog";
import { changelogConfig } from "../configurations/changelog";
import { resolveChangelogAction } from "../configurations/changelogActions";
import { DeploymentType } from "../sharedInterfaces/deployment";
import { RecentSqlFilesStore, ResolvedRecentSqlFile } from "../models/recentSqlFilesStore";
import { sendActionEvent, startActivity } from "extension-toolkit/vscode";
import * as os from "os";
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

/**
 * Telemetry action each in-page event is reported as. Partial because the events that open a
 * flow are handled as activities instead of single actions.
 */
const overviewTelemetryActions: Partial<Record<OverviewTelemetryEvent, TelemetryActions>> = {
    [OverviewTelemetryEvent.PromptCopied]: TelemetryActions.PromptCopied,
    [OverviewTelemetryEvent.PromptViewed]: TelemetryActions.PromptViewed,
    [OverviewTelemetryEvent.WalkthroughOpened]: TelemetryActions.WalkthroughOpened,
    [OverviewTelemetryEvent.DiscoverCardOpened]: TelemetryActions.DiscoverCardOpened,
};

/** GitHub source for the Azure SQL agent skills plugin, as `owner/repo`. */
const AGENT_SKILLS_PLUGIN_SOURCE = "microsoft/azure-sql-database-container";

/**
 * Setting VS Code appends to when a plugin marketplace is installed. It is only ever appended
 * to -- uninstalling leaves the entry behind -- so it is a signal to re-check on, never the
 * answer to whether the plugin is installed right now.
 */
const CHAT_PLUGIN_MARKETPLACES_SETTING = "chat.plugins.marketplaces";

/**
 * Manifest VS Code keeps of installed agent plugins, under the CLI home directory rather than
 * the user data profile. Its `installed` entries are the authoritative list: the cloned source
 * survives an uninstall, so the directory's presence proves nothing on its own.
 *
 * This is VS Code's internal layout rather than a public API, so every failure to read it is
 * treated as "not installed" instead of surfacing an error.
 */
const AGENT_PLUGINS_DIR = "agent-plugins";
const AGENT_PLUGINS_MANIFEST = "installed.json";

/**
 * How long to keep watching for a plugin install to land, and how often to look. The install
 * runs in VS Code behind a trust prompt, so nothing tells us when it finishes -- the manifest
 * simply changes at some point, or the user cancels and it never does.
 */
const AGENT_SKILLS_POLL_INTERVAL_MS = 1500;
const AGENT_SKILLS_POLL_TIMEOUT_MS = 120_000;

/** CLI home directories to look in, covering stable and Insiders. */
const VS_CODE_HOME_DIRS = [".vscode", ".vscode-insiders"];

interface AgentPluginsManifest {
    installed?: { marketplace?: string; pluginUri?: string }[];
}

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
    /** How the page was reached, recorded once when it opens. */
    source?: OverviewOpenSource;
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
    /** Guards against stacking manifest watches when install is pressed more than once. */
    private _agentSkillsWatchActive = false;

    /**
     * Setting up a dev container runs across several requests -- pick a template, check the
     * prerequisites, write the configuration, reopen -- so one activity spans them and each step
     * reports against it. That gives the steps a correlation id and the whole flow a duration.
     */
    private _devContainerActivity: ActivityObject | undefined;

    /** The in-flight agent skills install, ended by the manifest watch. */
    private _agentSkillsActivity: ActivityObject | undefined;

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

        // Installing writes that setting, so it is a prompt cue to re-check the moment one lands.
        this.registerDisposable(
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration(CHAT_PLUGIN_MARKETPLACES_SETTING)) {
                    void this.refreshAgentSkillsState();
                }
            }),
        );

        // Uninstalling happens elsewhere in VS Code and writes nothing we can listen for, so the
        // check is re-run whenever the user comes back to this page.
        this.registerDisposable(
            this.panel.onDidChangeViewState(() => {
                if (this.panel.visible) {
                    void this.refreshAgentSkillsState();
                }
            }),
        );

        void this.refreshAgentSkillsState();

        void this.refreshWorkspaceState();

        // Closing the page mid-flow is the abandonment we most want to see, so an activity that
        // is still open when the panel goes away is closed out rather than left dangling.
        this.registerDisposable(
            this.panel.onDidDispose(() => {
                this._devContainerActivity?.end(ActivityStatus.Canceled, {
                    additionalProps: { reason: "pageClosed" },
                });
                this._devContainerActivity = undefined;
                this._agentSkillsActivity?.end(ActivityStatus.Canceled, {
                    additionalProps: { reason: "pageClosed" },
                });
                this._agentSkillsActivity = undefined;
            }),
        );

        sendActionEvent(TelemetryViews.OverviewPage, TelemetryActions.OverviewPageOpened, {
            additionalProps: {
                source: options.source ?? OverviewOpenSource.CommandPalette,
                openedWithWhatsNew: String(options.openWhatsNew === true),
            },
        });

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
            // Resolved asynchronously right after construction; see refreshAgentSkillsState.
            hasAgentSkillsPlugin: false,
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

        this.onRequest(CheckDevContainerPrerequisitesRequest.type, async () => {
            const prerequisites = await this.getDevContainerPrerequisites();
            this._devContainerActivity?.update({
                additionalProps: {
                    step: "prerequisitesChecked",
                    docker: prerequisites.docker,
                    devContainersExtension: prerequisites.devContainersExtension,
                },
            });
            return prerequisites;
        });

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

        this.onRequest(InstallAgentSkillsPluginRequest.type, async () => {
            // VS Code's own handler: it shows the trust prompt, clones, and installs. Using the
            // command instead would make the user type the source themselves.
            const uri = vscode.Uri.parse(
                `${vscode.env.uriScheme}://chat-plugin/install?source=${encodeURIComponent(
                    AGENT_SKILLS_PLUGIN_SOURCE,
                )}`,
            );
            await vscode.env.openExternal(uri);
            this._agentSkillsActivity?.end(ActivityStatus.Canceled);
            this._agentSkillsActivity = startActivity(
                TelemetryViews.OverviewPage,
                TelemetryActions.InstallAgentSkills,
                { additionalProps: { source: AGENT_SKILLS_PLUGIN_SOURCE } },
            );

            // Handing off to VS Code tells us nothing about the outcome, so watch for the
            // manifest to change and let the page settle itself.
            void this.watchForAgentSkillsInstall();
        });

        this.onRequest(
            SendOverviewTelemetryRequest.type,
            async (params: SendOverviewTelemetryRequestParams) => {
                if (params.event === OverviewTelemetryEvent.DevContainerTemplateSelected) {
                    // Starts the setup flow the later steps report against.
                    this._devContainerActivity?.end(ActivityStatus.Canceled);
                    this._devContainerActivity = startActivity(
                        TelemetryViews.OverviewPage,
                        TelemetryActions.DevContainerSetup,
                        { additionalProps: { template: params.target ?? "" } },
                    );
                    return;
                }

                const action = overviewTelemetryActions[params.event];
                if (!action) {
                    return;
                }
                sendActionEvent(
                    TelemetryViews.OverviewPage,
                    action,
                    params.target ? { additionalProps: { target: params.target } } : undefined,
                );
            },
        );

        this.onRequest(OpenFolderRequest.type, async () => {
            // macOS has a single picker for files and folders; every other platform separates them.
            const command =
                process.platform === "darwin"
                    ? "workbench.action.files.openFileFolder"
                    : "workbench.action.files.openFolder";
            await vscode.commands.executeCommand(command);
            sendActionEvent(TelemetryViews.OverviewPage, TelemetryActions.OpenFolder);
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
            sendActionEvent(TelemetryViews.OverviewPage, TelemetryActions.RunOverviewAction, {
                additionalProps: { action },
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
                sendActionEvent(TelemetryViews.OverviewPage, TelemetryActions.RunChangelogAction, {
                    additionalProps: { action },
                });
            },
        );

        this.onRequest(
            AddDevContainerConfigurationRequest.type,
            async (
                params: AddDevContainerConfigurationRequestParams,
            ): Promise<AddDevContainerConfigurationResult> => {
                const result = await this.applyDevContainerTemplate(params.templateId);
                const props = {
                    step: "configurationWritten",
                    template: params.templateId,
                    repositoryFolder: templateRepositoryFolders[params.templateId],
                    applied: String(result.applied),
                    usedPicker: String(result.usedPicker),
                };

                if (result.applied) {
                    this._devContainerActivity?.update({ additionalProps: props });
                } else {
                    // Nothing was written, so the flow stops here rather than reaching a container.
                    // The CLI's message is deliberately not passed: it embeds the workspace path,
                    // and passing it would leave the send one boolean away from reporting it.
                    this._devContainerActivity?.endFailed(
                        undefined,
                        false,
                        undefined,
                        result.usedPicker ? "pickerFallback" : "applyFailed",
                        props,
                    );
                    this._devContainerActivity = undefined;
                }
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
            this._devContainerActivity?.end(ActivityStatus.Succeeded, {
                additionalProps: { step: "reopenedInContainer" },
            });
            this._devContainerActivity = undefined;
            sendActionEvent(TelemetryViews.OverviewPage, TelemetryActions.ReopenInContainer);
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

    /**
     * Watches for an install started by {@link InstallAgentSkillsPluginRequest} to land. Gives up
     * after a timeout, since the user may well have dismissed the trust prompt.
     */
    private async watchForAgentSkillsInstall(): Promise<void> {
        if (this._agentSkillsWatchActive) {
            return;
        }
        this._agentSkillsWatchActive = true;
        try {
            const deadline = Date.now() + AGENT_SKILLS_POLL_TIMEOUT_MS;
            while (Date.now() < deadline && !this.isDisposed) {
                await new Promise((resolve) => setTimeout(resolve, AGENT_SKILLS_POLL_INTERVAL_MS));
                if (this.isDisposed) {
                    return;
                }
                if (await this.hasAgentSkillsPlugin()) {
                    await this.refreshAgentSkillsState();
                    this._agentSkillsActivity?.end(ActivityStatus.Succeeded);
                    this._agentSkillsActivity = undefined;
                    return;
                }
            }
            // Fell out of the loop: the trust prompt was most likely dismissed.
            this._agentSkillsActivity?.end(ActivityStatus.Canceled, {
                additionalProps: { reason: "timedOut" },
            });
            this._agentSkillsActivity = undefined;
        } finally {
            this._agentSkillsWatchActive = false;
        }
    }

    /** Re-runs the agent skills check and pushes the result to the page. */
    private async refreshAgentSkillsState(): Promise<void> {
        if (this.isDisposed) {
            return;
        }
        const hasAgentSkillsPlugin = await this.hasAgentSkillsPlugin();
        if (this.isDisposed) {
            return;
        }
        this.updateState({ ...this.state, hasAgentSkillsPlugin });
    }

    /**
     * Whether the Azure SQL skills plugin is installed, read from VS Code's own manifest of
     * installed agent plugins. The marketplaces setting is never cleaned up on uninstall and the
     * cloned source is left on disk, so neither of those answers the question -- this manifest is
     * what VS Code rewrites as plugins come and go.
     */
    private async hasAgentSkillsPlugin(): Promise<boolean> {
        for (const manifestUri of this.getAgentPluginManifestCandidates()) {
            let manifest: AgentPluginsManifest;
            try {
                const bytes = await vscode.workspace.fs.readFile(manifestUri);
                manifest = JSON.parse(Buffer.from(bytes).toString("utf8")) as AgentPluginsManifest;
            } catch {
                continue; // Absent for this install flavour, or not readable.
            }

            const source = AGENT_SKILLS_PLUGIN_SOURCE.toLowerCase();
            const installed = manifest.installed?.some(
                (entry) =>
                    entry.marketplace?.toLowerCase() === source ||
                    entry.pluginUri?.toLowerCase().includes(`/${source}`),
            );
            if (installed) {
                return true;
            }
        }
        return false;
    }

    /**
     * Manifest locations to try, most specific first. Our own extension normally lives in
     * `<home>/extensions`, which pins the right flavour; a development host does not, so the
     * known homes are tried as well.
     */
    private getAgentPluginManifestCandidates(): vscode.Uri[] {
        const candidates: vscode.Uri[] = [];
        const add = (base: vscode.Uri) =>
            candidates.push(vscode.Uri.joinPath(base, AGENT_PLUGINS_DIR, AGENT_PLUGINS_MANIFEST));

        // extensionUri is <home>/extensions/<extension id> for an installed extension.
        add(vscode.Uri.joinPath(this._context.extensionUri, "..", ".."));
        for (const home of VS_CODE_HOME_DIRS) {
            add(vscode.Uri.joinPath(vscode.Uri.file(os.homedir()), home));
        }
        return candidates;
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
                source: OverviewOpenSource.PostUpdate,
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
