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

/** Identifier of the Dev Containers extension that owns dev container configuration. */
const DEV_CONTAINERS_EXTENSION_ID = "ms-vscode-remote.remote-containers";

/** Command contributed by the Dev Containers extension to scaffold a configuration. */
const DEV_CONTAINERS_CONFIGURE_COMMAND = "remote-containers.configure";

/** Most recent SQL files shown in the Overview page's right rail. */
const RECENT_FILE_LIMIT = 5;

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
    [DevContainerTemplateId.Node]: "node",
    [DevContainerTemplateId.Python]: "python",
};

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
    ) {
        super(context, "overview", "overview", OverviewWebviewController.buildInitialState(), {
            title: Overview.OverviewDocumentTitle,
            viewColumn: vscode.ViewColumn.Active,
            iconPath: {
                dark: vscode.Uri.joinPath(context.extensionUri, "media", "changelog_dark.svg"),
                light: vscode.Uri.joinPath(context.extensionUri, "media", "changelog_light.svg"),
            },
        });

        void this.refreshRecentFiles();

        this.initialize();
    }

    private static buildInitialState(): OverviewWebviewState {
        const config = vscode.workspace.getConfiguration();
        return {
            extensionVersion:
                vscode.extensions.getExtension(constants.extensionId)?.packageJSON.version ?? "",
            showOnStartup: config.get<boolean>(constants.configShowOverviewOnStartup, true),
            recentFiles: [],
            changelog: changelogConfig,
            commandShortcuts: OverviewWebviewController.getCommandShortcuts(),
            prerequisites: {
                git: PrerequisiteStatus.Unknown,
                docker: PrerequisiteStatus.Unknown,
                devContainersExtension: PrerequisiteStatus.Unknown,
            },
        };
    }

    private initialize(): void {
        this.registerReducer("setShowOnStartup", async (state, payload) => {
            await vscode.workspace
                .getConfiguration()
                .update(
                    constants.configShowOverviewOnStartup,
                    payload.showOnStartup,
                    vscode.ConfigurationTarget.Global,
                );
            sendActionEvent(TelemetryViews.OverviewPage, TelemetryActions.ShowOverviewOnStartup, {
                additionalProps: {
                    showOnStartup: String(payload.showOnStartup),
                },
            });
            return { ...state, showOnStartup: payload.showOnStartup };
        });

        this.registerReducer("checkPrerequisites", async (state) => {
            this.updateState({
                ...state,
                prerequisites: {
                    git: PrerequisiteStatus.Checking,
                    docker: PrerequisiteStatus.Checking,
                    devContainersExtension: PrerequisiteStatus.Checking,
                },
            });

            const [git, docker] = await Promise.all([this.checkGit(), this.checkDocker()]);
            return {
                ...this.state,
                prerequisites: {
                    git,
                    docker,
                    devContainersExtension: this.checkDevContainersExtension(),
                },
            };
        });

        this.registerReducer("installDevContainersExtension", async (state) => {
            await vscode.commands.executeCommand(
                "workbench.extensions.installExtension",
                DEV_CONTAINERS_EXTENSION_ID,
            );
            sendActionEvent(
                TelemetryViews.OverviewPage,
                TelemetryActions.InstallDevContainersExtension,
            );
            return {
                ...state,
                prerequisites: {
                    ...state.prerequisites,
                    devContainersExtension: this.checkDevContainersExtension(),
                },
            };
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
            async (params: AddDevContainerConfigurationRequestParams) => {
                await vscode.commands.executeCommand(DEV_CONTAINERS_CONFIGURE_COMMAND);
                sendActionEvent(
                    TelemetryViews.OverviewPage,
                    TelemetryActions.AddDevContainerConfiguration,
                    {
                        additionalProps: {
                            template: params.templateId,
                            repositoryFolder: templateRepositoryFolders[params.templateId],
                        },
                    },
                );
            },
        );
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

    private async checkGit(): Promise<PrerequisiteStatus> {
        // The built-in Git extension is present whenever VS Code found a usable git binary.
        const gitExtension = vscode.extensions.getExtension("vscode.git");
        return gitExtension ? PrerequisiteStatus.Ready : PrerequisiteStatus.Missing;
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

    private checkDevContainersExtension(): PrerequisiteStatus {
        return vscode.extensions.getExtension(DEV_CONTAINERS_EXTENSION_ID)
            ? PrerequisiteStatus.Ready
            : PrerequisiteStatus.Missing;
    }

    /**
     * Opens the Overview page on startup when the page is enabled and the user has opted in.
     */
    public static async showOverviewOnStartup(): Promise<void> {
        const config = vscode.workspace.getConfiguration();
        const isEnabled = config.get<boolean>(constants.configEnableOverviewPage, false);
        const showOnStartup = config.get<boolean>(constants.configShowOverviewOnStartup, true);
        if (isEnabled && showOnStartup) {
            await vscode.commands.executeCommand(constants.cmdOpenOverview);
        }
    }
}
