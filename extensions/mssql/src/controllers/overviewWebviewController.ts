/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as constants from "../constants/constants";
import * as dockerUtils from "../docker/dockerUtils";

import { Common, Overview } from "../constants/locConstants";
import {
    AddDevContainerConfigurationRequest,
    AddDevContainerConfigurationRequestParams,
    DevContainerTemplateId,
    OpenRecentSqlFileRequest,
    OpenRecentSqlFileRequestParams,
    OverviewActionId,
    AddDevContainerConfigurationResult,
    BrowseForDevContainerTargetRequest,
    BrowseForDevContainerTargetRequestParams,
    CheckDevContainerPrerequisitesRequest,
    DevContainerPrerequisites,
    DevContainerTarget,
    DevContainerTemplateOption,
    GetDevContainerTargetRequest,
    GetDevContainerTargetRequestParams,
    GetDevContainerTemplateOptionsRequest,
    GetDevContainerTemplateOptionsRequestParams,
    GetAgentSkillsCatalogRequest,
    InstallAgentSkillsPluginRequest,
    ManageAgentSkillsPluginRequest,
    OpenPromptInChatRequest,
    OpenPromptInChatRequestParams,
    InstallDevContainersExtensionRequest,
    OpenFolderRequest,
    OverviewOpenSource,
    OverviewTelemetryEvent,
    ReopenInContainerRequest,
    SendOverviewTelemetryRequest,
    ShowOverviewLogRequest,
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
import {
    AgentPluginsInstaller,
    RemoteWindowUnsupportedError,
} from "../agentPlugins/agentPluginsInstaller";
import { sendActionEvent, startActivity } from "extension-toolkit/vscode";
import * as path from "path";
import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import { randomUUID } from "crypto";

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
 * Opens a given folder in its dev container. Passing the folder is what distinguishes this from
 * the command's own picker: with no argument it asks the user to choose one.
 */
const DEV_CONTAINERS_OPEN_FOLDER_COMMAND = "remote-containers.openFolder";

/**
 * Telemetry action each in-page event is reported as. Partial because the events that open a
 * flow are handled as activities instead of single actions.
 */
const overviewTelemetryActions: Partial<Record<OverviewTelemetryEvent, TelemetryActions>> = {
    [OverviewTelemetryEvent.PromptCopied]: TelemetryActions.PromptCopied,
    [OverviewTelemetryEvent.PromptOpenedInChat]: TelemetryActions.PromptOpenedInChat,
    [OverviewTelemetryEvent.WalkthroughOpened]: TelemetryActions.WalkthroughOpened,
    [OverviewTelemetryEvent.DiscoverCardOpened]: TelemetryActions.DiscoverCardOpened,
};

/**
 * Opens the Extensions view on a search term. Internal workbench commands rather than API, the
 * same footing as `chat.pluginLocations` which the install already depends on.
 */
const EXTENSIONS_SEARCH_COMMAND = "workbench.extensions.search";
/** Filter the Extensions view uses to list agent plugins, with no search term. */
const MANAGE_PLUGINS_COMMAND = "workbench.action.chat.managePlugins";
const AGENT_PLUGINS_FILTER = "@agentPlugins";

/** Source the agent skills are installed from, reported with the install telemetry. */
const AGENT_SKILLS_PLUGIN_SOURCE = "microsoft/azure-sql-database-container";

/** A staged template file and the resolved place in the workspace it will be written. */
interface TemplateFileDestination {
    /** Path relative to the staging root and to the workspace folder, as the CLI reported it. */
    relativePath: string;
    /** Directory the file lands in, with every component that already exists resolved. */
    directory: string;
    fileName: string;
}

/** Where a staged template file is written, built from its resolved directory. */
function templateFileUri(destination: TemplateFileDestination): vscode.Uri {
    return vscode.Uri.file(path.join(destination.directory, destination.fileName));
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

/**
 * Marker the Dev Containers extension drops beside a configuration it is holding on a folder's
 * behalf, naming the folder that configuration belongs to.
 */
const DEV_CONTAINER_MARKER_FILE = ".devcontainer-internal.json";

/** The same two locations as concrete relative paths, for a direct existence check. */
const DEV_CONTAINER_CONFIG_PATHS = [[".devcontainer", "devcontainer.json"], [".devcontainer.json"]];

/** Most recent SQL files shown in the Overview page's right rail. */
const RECENT_FILE_LIMIT = 5;

/** Global state key recording the version whose release notes have already been shown. */
const GLOBAL_STATE_LAST_CHANGELOG_VERSION_KEY = "changelog/lastChangeLogVersion";

/** How the page was opened, which decides whether it greets the user with release notes. */
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

/**
 * Reads the folder a stored configuration belongs to out of its marker file.
 *
 * The extension writes a JSON object behind a line comment that swallows the object's own
 * opening brace, so the file only parses under a comment-tolerant reader. Rather than depend on
 * one, the single field that matters is matched directly; the captured literal is handed to
 * `JSON.parse` so its escapes -- a Windows path's backslashes, above all -- are undone exactly
 * once and by the same rules that wrote them.
 */
function readMarkerRootFolder(contents: string): string | undefined {
    const match = /"rootFolder"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(contents);
    if (!match) {
        return undefined;
    }
    try {
        const parsed: unknown = JSON.parse(match[1]);
        return typeof parsed === "string" ? parsed : undefined;
    } catch {
        return undefined;
    }
}

/**
 * First free `<parent>/<name>`, adding `-2`, `-3` and so on rather than proposing a folder that
 * already has something in it. Gives up after a bounded number of tries so a parent full of
 * matching names cannot spin.
 */
async function uniqueFolderPath(parent: string, name: string): Promise<string> {
    for (let suffix = 1; suffix <= 100; suffix++) {
        const candidate = path.join(parent, suffix > 1 ? `${name}-${suffix}` : name);
        try {
            await fs.promises.stat(candidate);
        } catch {
            return candidate;
        }
    }
    // Every name is taken, so the plain one is proposed and the existing-file prompts apply.
    return path.join(parent, name);
}

/**
 * Pulls the renderable options out of a template's metadata document.
 *
 * The document comes from the registry, so every field is checked rather than assumed. The spec
 * gives string options either an `enum` (a closed list) or `proposals` (suggestions, with custom
 * values allowed); only the listed values are offered here, which is also what lets the applied
 * values be validated on the way back in.
 */
function parseTemplateOptions(metadata: unknown): DevContainerTemplateOption[] {
    const declared = (metadata as { options?: unknown } | undefined)?.options;
    // Falsy covers the absent and null cases the rule against a `null` literal rules out.
    if (!declared || typeof declared !== "object") {
        return [];
    }

    const options: DevContainerTemplateOption[] = [];
    for (const [id, value] of Object.entries(declared as Record<string, unknown>)) {
        const option = value as {
            type?: unknown;
            description?: unknown;
            enum?: unknown;
            proposals?: unknown;
            default?: unknown;
        };
        if (option?.type !== "string") {
            continue;
        }

        const listed = Array.isArray(option.enum) ? option.enum : option.proposals;
        const values = (Array.isArray(listed) ? listed : []).filter(
            (entry): entry is string => typeof entry === "string",
        );
        // One value is not a choice, so it gets no control and keeps its default.
        if (values.length < 2) {
            continue;
        }

        // A default outside the list would select nothing in the dropdown, so the first listed
        // value stands in; the template orders them, and puts its preferred value first.
        const declaredDefault = option.default;
        const defaultValue =
            typeof declaredDefault === "string" && values.includes(declaredDefault)
                ? declaredDefault
                : values[0];

        options.push({
            id,
            label: typeof option.description === "string" ? option.description : id,
            defaultValue,
            values,
        });
    }
    return options;
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
    /**
     * Setting up a dev container runs across several requests -- pick a template, check the
     * prerequisites, write the configuration, reopen -- so one activity spans them and each step
     * reports against it. That gives the steps a correlation id and the whole flow a duration.
     */
    private _devContainerActivity: ActivityObject | undefined;

    /** The in-flight agent skills install. */
    private _agentSkillsActivity: ActivityObject | undefined;

    /** Sequence number of the newest recent-file refresh; see refreshRecentFiles. */
    private _recentFilesRequest = 0;

    /** Sequence number of the newest workspace-state refresh; see refreshWorkspaceState. */
    private _workspaceStateRequest = 0;

    /** Sequence number of the newest agent skills refresh; see refreshAgentSkillsState. */
    private _agentSkillsRequest = 0;

    /**
     * Template metadata by registry id. Reading it is a registry fetch, and the dialog asks every
     * time it opens, so the answer is kept for the life of the page.
     */
    private _templateOptions = new Map<string, DevContainerTemplateOption[]>();

    /**
     * Parent folder the user last scaffolded into, so the second template does not start from
     * the home folder again. Global rather than per-workspace: the flow runs with no workspace.
     */
    private static readonly _lastTargetParentKey = "mssql.overview.devContainerTargetParent";

    constructor(
        context: vscode.ExtensionContext,
        private _recentSqlFilesStore: RecentSqlFilesStore,
        private _agentSkillsInstaller: AgentPluginsInstaller,
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

        // The store keeps recording opens after this panel was built, so follow it rather than
        // showing the snapshot taken when the page opened.
        this.registerDisposable(
            this._recentSqlFilesStore.onDidChange(() => void this.refreshRecentFiles()),
        );

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

        // Neither deleting the folder nor repointing the registration announces itself, and
        // either one means the skills are no longer ours to claim as installed, so the check is
        // simply re-run whenever the user comes back to this page. A tracked SQL file can be
        // deleted or moved while the page is hidden without the store hearing about it, so the
        // list is re-resolved on the way back in for the same reason.
        this.registerDisposable(
            this.panel.onDidChangeViewState(() => {
                if (this.panel.visible) {
                    void this.refreshAgentSkillsState();
                    void this.refreshRecentFiles();
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
            openWhatsNewRequest: options.openWhatsNew === true ? 1 : 0,
            showChangelogOnUpdate: OverviewWebviewController.shouldShowChangelogOnUpdate(),
        };
    }

    /** Opens the What's new drawer on a page that is already showing. */
    public openWhatsNew(): void {
        // Increment rather than set: the drawer may have been opened and dismissed already, and a
        // repeated identical value would not re-render the webview.
        this.updateState({
            ...this.state,
            openWhatsNewRequest: this.state.openWhatsNewRequest + 1,
        });
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
            this._agentSkillsActivity?.end(ActivityStatus.Canceled);
            this._agentSkillsActivity = startActivity(
                TelemetryViews.OverviewPage,
                TelemetryActions.InstallAgentSkills,
                { additionalProps: { source: AGENT_SKILLS_PLUGIN_SOURCE } },
            );

            try {
                await this._agentSkillsInstaller.install();
                this._agentSkillsActivity?.end(ActivityStatus.Succeeded);
            } catch (error) {
                const remoteUnsupported = error instanceof RemoteWindowUnsupportedError;
                if (!remoteUnsupported) {
                    this.logger.error("Failed to install the agent skills", error);
                }
                this._agentSkillsActivity?.endFailed(
                    error instanceof Error ? error : undefined,
                    false,
                    undefined,
                    remoteUnsupported ? "remoteWindow" : "downloadFailed",
                );
                // Surfaced as a notification rather than in the page: the button simply returns
                // to offering the install, which on its own looks like nothing happened.
                void vscode.window.showErrorMessage(
                    remoteUnsupported
                        ? Overview.InstallAgentSkillsRemoteUnsupported
                        : Overview.InstallAgentSkillsFailed,
                );
            } finally {
                this._agentSkillsActivity = undefined;
                await this.refreshAgentSkillsState();
            }
        });

        this.onRequest(ManageAgentSkillsPluginRequest.type, async () => {
            // The Extensions view matches this term against a plugin's name, description and
            // marketplace (agentPluginsView.ts, `show`). For a plugin installed from a local
            // folder, as ours is, `marketplace` comes from `fromMarketplace` and is undefined,
            // and `description` is the label of the install directory -- the repository URL is
            // in neither, so searching for it would select nothing. `name` resolves to the
            // manifest name, which is what identifies the plugin here.
            //
            // Once this ships through a marketplace, `marketplace` holds the repository URL and
            // becomes the more precise term, since a name can collide and a URL cannot.
            try {
                await vscode.commands.executeCommand(
                    EXTENSIONS_SEARCH_COMMAND,
                    `${AGENT_PLUGINS_FILTER} ${this._agentSkillsInstaller.pluginName}`,
                );
            } catch (error) {
                // Both are internal workbench commands, so a rename in a future VS Code lands
                // here rather than as an error the user has to read.
                this.logger.warn(
                    `Could not open the plugin in the Extensions view: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
                await vscode.commands
                    .executeCommand(MANAGE_PLUGINS_COMMAND)
                    .then(undefined, () => undefined);
            }
        });

        this.onRequest(GetAgentSkillsCatalogRequest.type, async () => {
            return this._agentSkillsInstaller.getSkillsCatalog();
        });

        this.onRequest(
            OpenPromptInChatRequest.type,
            async (params: OpenPromptInChatRequestParams) => {
                // Opens the chat view with the prompt entered but not sent, so the user can add
                // the specifics their project needs before Copilot acts on it.
                await vscode.commands.executeCommand(constants.cmdOpenGithubChat, params.prompt);
            },
        );

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

        this.onRequest(ShowOverviewLogRequest.type, async () => {
            this.logger.show();
        });

        this.onRequest(
            GetDevContainerTargetRequest.type,
            async (params: GetDevContainerTargetRequestParams): Promise<DevContainerTarget> =>
                this.getDevContainerTarget(params.templateId),
        );

        this.onRequest(
            BrowseForDevContainerTargetRequest.type,
            async (
                params: BrowseForDevContainerTargetRequestParams,
            ): Promise<string | undefined> => {
                const chosen = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    openLabel: Overview.SelectDevContainerFolder,
                    defaultUri: params.currentPath
                        ? vscode.Uri.file(params.currentPath)
                        : undefined,
                });
                return chosen?.[0]?.fsPath;
            },
        );

        this.onRequest(
            GetDevContainerTemplateOptionsRequest.type,
            async (
                params: GetDevContainerTemplateOptionsRequestParams,
            ): Promise<DevContainerTemplateOption[]> =>
                this.getDevContainerTemplateOptions(params.templateId),
        );

        this.onRequest(
            AddDevContainerConfigurationRequest.type,
            async (
                params: AddDevContainerConfigurationRequestParams,
            ): Promise<AddDevContainerConfigurationResult> => {
                const options = await this.resolveTemplateOptions(
                    params.templateId,
                    params.options,
                );
                const result = await this.applyDevContainerTemplate(
                    params.templateId,
                    options,
                    params.targetPath,
                );
                const props = {
                    step: "configurationWritten",
                    template: params.templateId,
                    repositoryFolder: templateRepositoryFolders[params.templateId],
                    // The option keys and values are the template's own, not free-form input:
                    // anything the template does not declare was dropped above.
                    options: JSON.stringify(options),
                    // Whether they scaffolded somewhere new, never which path they chose.
                    opensNewFolder: String(result.opensNewFolder === true),
                    applied: String(result.applied),
                    usedPicker: String(result.usedPicker),
                    conflict: String(result.conflict === true),
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
                        result.usedPicker
                            ? "pickerFallback"
                            : result.conflict
                              ? "fileConflict"
                              : "applyFailed",
                        props,
                    );
                    this._devContainerActivity = undefined;
                }
                return result;
            },
        );

        this.onRequest(ReopenInContainerRequest.type, async (params) => {
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

            // Reattaching is unambiguous only for a single-folder window. For any other target,
            // Dev Containers opens the selected folder directly when handed its URI.
            // Narrowed by type rather than compared against undefined: a caller with no folder
            // sends one that arrives as null, and `Uri.file(null)` throws.
            const folderPath =
                typeof params?.folderPath === "string" && params.folderPath.length > 0
                    ? params.folderPath
                    : undefined;
            // Dev Containers' reopen command chooses a root again in a multi-root window, or
            // reopens the .code-workspace file. Hand it the selected folder directly instead.
            const opensNewFolder =
                folderPath !== undefined &&
                !this.canReopenCurrentFolder(vscode.Uri.file(folderPath));
            if (folderPath !== undefined && opensNewFolder) {
                await vscode.commands.executeCommand(
                    DEV_CONTAINERS_OPEN_FOLDER_COMMAND,
                    vscode.Uri.file(folderPath),
                );
            } else {
                await vscode.commands.executeCommand(DEV_CONTAINERS_REOPEN_COMMAND);
            }
            this._devContainerActivity?.end(ActivityStatus.Succeeded, {
                additionalProps: {
                    step: "reopenedInContainer",
                    opensNewFolder: String(opensNewFolder),
                },
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
        // Now that every store change starts one of these, two can be in flight at once, and
        // resolving stats the filesystem so they can finish out of order. Only the newest request
        // writes, which keeps a slow earlier scan from replacing the list with an older one.
        const request = ++this._recentFilesRequest;
        const files = await this._recentSqlFilesStore.getRecentFiles(RECENT_FILE_LIMIT);
        if (this.isDisposed || request !== this._recentFilesRequest) {
            return;
        }
        this.updateState({ ...this.state, recentFiles: files.map(toRecentSqlFile) });
    }

    /** Re-resolves the folder-dependent state the Dev containers tab keys off. */
    private async refreshWorkspaceState(): Promise<void> {
        if (this.isDisposed) {
            return;
        }
        // Folder changes and the configuration watcher both start these, and resolving stats the
        // filesystem, so two can be in flight at once and finish out of order. Only the newest
        // writes, which keeps a slow check of the old folder from describing the new one.
        const request = ++this._workspaceStateRequest;
        const folders = vscode.workspace.workspaceFolders ?? [];
        const hasWorkspaceFolder = folders.length > 0;
        const hasDevContainerConfig = await this.findDevContainerConfig(folders);

        if (this.isDisposed || request !== this._workspaceStateRequest) {
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
            // A configuration can also sit outside the folder, which is the option the Dev
            // Containers extension offers to keep it out of source control. Missing it told
            // users with a working dev container that they had none.
            if (await this.findUserDataDevContainerConfig(folder.uri.fsPath)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Where the Dev Containers extension keeps configurations held on a folder's behalf.
     *
     * An extension's storage is private to it and VS Code exposes no path for another one, so
     * this is derived from ours: every extension's folder is a sibling under `globalStorage`.
     */
    private devContainersConfigStore(): string {
        return path.join(
            path.dirname(this._context.globalStorageUri.fsPath),
            DEV_CONTAINERS_EXTENSION_ID,
            "configs",
        );
    }

    /**
     * Looks for a configuration the Dev Containers extension is holding for this folder.
     *
     * It names each one after the folder's last path segment, with `-2`, `-3` and so on when
     * two folders share a name, and tells them apart by a marker file recording which folder
     * the configuration belongs to. That layout is the extension's own rather than an API, so
     * nothing here throws: a store that is absent, unreadable, or no longer shaped this way
     * reports no configuration, which is the answer the page already knows how to show.
     */
    private async findUserDataDevContainerConfig(folderPath: string): Promise<boolean> {
        const store = this.devContainersConfigStore();
        const folderName = path.basename(folderPath);

        let entries: string[];
        try {
            entries = await fs.promises.readdir(store);
        } catch {
            // No configuration has ever been stored this way on this machine.
            return false;
        }

        for (const entry of entries) {
            // `<name>` or `<name>-2`; anything else belongs to a different folder.
            const suffix = entry.startsWith(`${folderName}-`)
                ? entry.slice(folderName.length + 1)
                : undefined;
            if (entry !== folderName && !(suffix && /^\d+$/.test(suffix))) {
                continue;
            }

            try {
                const marker = await fs.promises.readFile(
                    path.join(store, entry, DEV_CONTAINER_MARKER_FILE),
                    "utf8",
                );
                if (readMarkerRootFolder(marker) === folderPath) {
                    return true;
                }
            } catch {
                // No marker, or unreadable: not a configuration we can attribute to this folder.
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
        options: Record<string, string> = {},
        targetPath?: string,
    ): Promise<AddDevContainerConfigurationResult> {
        let target: vscode.Uri;
        let createdTarget: boolean;
        try {
            ({ uri: target, created: createdTarget } = await this.prepareDevContainerTarget(
                templateId,
                targetPath,
            ));
        } catch (error) {
            this.logger.error("Could not prepare the dev container folder", error);
            return {
                applied: false,
                usedPicker: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
        const opensNewFolder = !this.canReopenCurrentFolder(target);

        const cliPath = this.findDevContainersCli();
        if (!cliPath) {
            this.logger.warn(
                "Dev Containers CLI not found in the extension; falling back to its template picker.",
            );
            await this.discardCreatedTarget(target, createdTarget);
            await vscode.commands.executeCommand(DEV_CONTAINERS_CREATE_CONFIG_COMMAND);
            return { applied: false, usedPicker: true };
        }

        const stagingDirectory = await fs.promises.mkdtemp(
            path.join(os.tmpdir(), "vscode-mssql-devcontainer-"),
        );

        try {
            const output = await this.runDevContainersCli(cliPath, [
                "templates",
                "apply",
                "--template-id",
                templateRegistryId(templateId),
                "--workspace-folder",
                stagingDirectory,
                // The same flag the Dev Containers extension passes when it applies a template.
                // An empty object is the CLI's own default, so every option keeps its default.
                "--template-args",
                JSON.stringify(options),
            ]);

            const files = this.parseAppliedTemplateFiles(output, stagingDirectory);
            // Anchored to the folder being written to, not to the workspace: with a target
            // outside any open folder, checking containment against the workspace would either
            // reject every path or, with no workspace at all, check nothing.
            const destinations = await this.resolveTemplateDestinations(target, files);
            const conflictChoices = await this.getTemplateFileConflictChoices(destinations);
            if (!conflictChoices) {
                this.logger.info("Dev container setup canceled while resolving file conflicts.");
                await this.discardCreatedTarget(target, createdTarget);
                return {
                    applied: false,
                    usedPicker: false,
                    conflict: true,
                    error: "Dev container setup was canceled.",
                };
            }

            await this.copyTemplateFiles(stagingDirectory, destinations, conflictChoices);
            await this.refreshWorkspaceState();
            await this.rememberTargetParent(target);
            return {
                applied: true,
                usedPicker: false,
                targetPath: target.fsPath,
                opensNewFolder,
            };
        } catch (error) {
            this.logger.error("Failed to apply the dev container template", error);
            await this.discardCreatedTarget(target, createdTarget);
            // Reported inline in the dialog rather than as a toast, so it sits with the step.
            return {
                applied: false,
                usedPicker: false,
                error: error instanceof Error ? error.message : String(error),
            };
        } finally {
            await fs.promises.rm(stagingDirectory, { recursive: true, force: true });
        }
    }

    /**
     * Reads the CLI's result and validates every returned path before it is used as a source or a
     * workspace destination. Templates are untrusted external input, so absolute paths, traversal,
     * symlinks, and non-files are rejected.
     */
    private parseAppliedTemplateFiles(output: string, stagingDirectory: string): string[] {
        const resultLine = output
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .at(-1);
        const result = resultLine ? (JSON.parse(resultLine) as { files?: unknown }) : undefined;
        if (!Array.isArray(result?.files) || result.files.length === 0) {
            throw new Error("The Dev Containers CLI did not report any template files.");
        }

        // Resolved through its own symlinks, so the containment check below compares like with
        // like: on macOS the temporary directory itself sits under a symlinked /var.
        const stagingRoot = fs.realpathSync(path.resolve(stagingDirectory));
        return result.files.map((file) => {
            if (typeof file !== "string" || file.length === 0 || file.includes("\0")) {
                throw new Error("The Dev Containers CLI returned an invalid template file path.");
            }

            // Collapsed before anything is built from it: the CLI reports its files as
            // `./.gitattributes`, and carrying that `.` through left a path segment that is
            // the directory it starts from, which the containment check below reads as an
            // escape. Normalizing also folds away any `..` before the checks see the path.
            const normalized = path.posix.normalize(file.replaceAll("\\", "/"));
            const sourcePath = path.resolve(stagingRoot, normalized);
            if (
                path.posix.isAbsolute(normalized) ||
                path.win32.isAbsolute(file) ||
                sourcePath === stagingRoot ||
                !sourcePath.startsWith(`${stagingRoot}${path.sep}`)
            ) {
                throw new Error(`Template file path escapes the staging directory: ${file}`);
            }

            // The check above is lexical, and `lstat` only describes the last component, so
            // neither notices a symlinked *parent*: for `link/file`, reading it follows `link`
            // first, which a template can point anywhere on the machine. Resolving every
            // component and re-checking containment is what actually confines the read.
            let realSource: string;
            try {
                realSource = fs.realpathSync(sourcePath);
            } catch {
                throw new Error(`Template file path could not be resolved: ${file}`);
            }
            if (!realSource.startsWith(`${stagingRoot}${path.sep}`)) {
                throw new Error(`Template file path escapes the staging directory: ${file}`);
            }

            const source = fs.lstatSync(sourcePath);
            if (!source.isFile() || source.isSymbolicLink()) {
                throw new Error(`Template path is not a regular file: ${file}`);
            }
            return normalized;
        });
    }

    /**
     * Works out where each staged file lands, with every existing path component resolved.
     *
     * `Uri.joinPath` is lexical, so a symlinked parent inside the workspace -- a `.vscode` that
     * points at a dotfiles repository, say -- is followed when the file is written, and a
     * template chooses the paths. Resolving each component that already exists, and checking the
     * result is still under the workspace, is what keeps the write inside the folder the user
     * picked. This is a check rather than a sandbox: a link swapped in afterwards would still be
     * followed, which needs local write access during the copy.
     */
    private async resolveTemplateDestinations(
        workspaceFolder: vscode.Uri,
        files: string[],
    ): Promise<TemplateFileDestination[]> {
        const workspaceRoot = await fs.promises.realpath(workspaceFolder.fsPath);
        const destinations: TemplateFileDestination[] = [];

        for (const relativePath of files) {
            const segments = relativePath.split("/");
            let directory = workspaceRoot;
            for (const segment of segments.slice(0, -1)) {
                // Paths arrive normalized, so these are already gone; skipped rather than
                // trusted, because a "." would resolve to the directory it starts from and
                // read as an escape from it.
                if (segment === "" || segment === ".") {
                    continue;
                }
                const child = path.join(directory, segment);
                // A component that does not exist yet cannot be a link to anywhere.
                directory = await fs.promises.realpath(child).catch(() => child);
                if (!directory.startsWith(`${workspaceRoot}${path.sep}`)) {
                    throw new Error(
                        `Template file path escapes the workspace folder: ${relativePath}`,
                    );
                }
            }
            destinations.push({
                relativePath,
                directory,
                fileName: segments[segments.length - 1],
            });
        }
        return destinations;
    }

    /**
     * Collects a decision for every destination that already exists before any workspace files are
     * changed.
     *
     * Every conflict is found first so the prompt can say how many are left and offer Overwrite
     * All, which a template that collides on most of its files otherwise turns into one modal per
     * file.
     */
    private async getTemplateFileConflictChoices(
        destinations: TemplateFileDestination[],
    ): Promise<Map<string, "skip" | "overwrite"> | undefined> {
        const conflicts: string[] = [];
        for (const destination of destinations) {
            if (await this.conflictsWithExistingFile(destination)) {
                conflicts.push(destination.relativePath);
            }
        }

        const choices = new Map<string, "skip" | "overwrite">();
        for (const [index, file] of conflicts.entries()) {
            const remaining = conflicts.length - index;
            // With one file left, Overwrite All would just be Overwrite under a louder name.
            const actions =
                remaining > 1
                    ? [
                          Overview.SkipTemplateFile,
                          Overview.OverwriteTemplateFile,
                          Overview.OverwriteAllTemplateFiles,
                      ]
                    : [Overview.SkipTemplateFile, Overview.OverwriteTemplateFile];

            const choice = await vscode.window.showWarningMessage(
                Overview.DevContainerTemplateFileConflict(file),
                {
                    modal: true,
                    detail:
                        remaining > 1
                            ? Overview.DevContainerTemplateFileConflictDetail(remaining)
                            : undefined,
                },
                ...actions,
                Common.cancel,
            );
            if (!choice || choice === Common.cancel) {
                return undefined;
            }
            if (choice === Overview.OverwriteAllTemplateFiles) {
                for (const pending of conflicts.slice(index)) {
                    choices.set(pending, "overwrite");
                }
                return choices;
            }
            choices.set(file, choice === Overview.OverwriteTemplateFile ? "overwrite" : "skip");
        }
        return choices;
    }

    /**
     * Whether the template would land on something already in the workspace.
     *
     * Any stat error other than a definite not-found result counts as a conflict, because
     * proceeding silently would risk overwriting a file the provider could not inspect.
     */
    private async conflictsWithExistingFile(
        destination: TemplateFileDestination,
    ): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(templateFileUri(destination));
            return true;
        } catch (error) {
            return !(error instanceof vscode.FileSystemError) || error.code !== "FileNotFound";
        }
    }

    /**
     * Copies staged template files without permitting replacement. The final rename asks the
     * workspace filesystem provider for an exclusive destination unless the user explicitly chose
     * Overwrite for that file. This also closes the race between conflict prompting and the write.
     */
    private async copyTemplateFiles(
        stagingDirectory: string,
        destinations: TemplateFileDestination[],
        conflictChoices: ReadonlyMap<string, "skip" | "overwrite">,
    ): Promise<void> {
        for (const entry of destinations) {
            const conflictChoice = conflictChoices.get(entry.relativePath);
            if (conflictChoice === "skip") {
                continue;
            }
            // Built from the resolved directory, so what was checked for containment is what is
            // written rather than a lexical path that could follow a link somewhere else.
            const destination = templateFileUri(entry);
            const destinationDirectory = vscode.Uri.file(entry.directory);
            const temporaryDestination = vscode.Uri.file(
                path.join(entry.directory, `.${entry.fileName}.vscode-mssql-${randomUUID()}.tmp`),
            );
            const contents = await fs.promises.readFile(
                path.join(stagingDirectory, ...entry.relativePath.split("/")),
            );

            await vscode.workspace.fs.createDirectory(destinationDirectory);
            try {
                await vscode.workspace.fs.writeFile(temporaryDestination, contents);
                await vscode.workspace.fs.rename(temporaryDestination, destination, {
                    overwrite: conflictChoice === "overwrite",
                });
            } finally {
                try {
                    await vscode.workspace.fs.delete(temporaryDestination);
                } catch {
                    // The successful rename already removed it, or a failed write never created it.
                }
            }
        }
    }

    /**
     * Proposes where a template should go.
     *
     * Every open folder is offered, so a multi-root window does not silently take the first.
     * With nothing open this is a new folder named after the template, under the last used parent.
     */
    private async getDevContainerTarget(
        templateId: DevContainerTemplateId,
    ): Promise<DevContainerTarget> {
        const parent =
            this._context.globalState.get<string>(OverviewWebviewController._lastTargetParentKey) ??
            os.homedir();
        // Falls back rather than joining `undefined` into the path, which would throw and leave
        // the page with no answer at all for a template id it does not recognise.
        const folderName = templateRepositoryFolders[templateId] ?? "azure-sql";
        return {
            workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
                name: folder.name,
                path: folder.uri.fsPath,
            })),
            newFolderPath: await uniqueFolderPath(parent, folderName),
        };
    }

    /**
     * Turns the requested path into a folder that exists, which is what the containment checks
     * downstream resolve against.
     *
     * The path comes from the page, so it is required to be absolute and to be a directory: a
     * relative path would resolve against whatever the extension host's working directory
     * happens to be, and a file would make every destination under it nonsense.
     */
    private async prepareDevContainerTarget(
        templateId: DevContainerTemplateId,
        targetPath: string | undefined,
    ): Promise<{ uri: vscode.Uri; created: boolean }> {
        const requested = targetPath?.trim();
        let resolved = requested;
        if (!resolved) {
            // The page always sends one; this is the default it would have been shown.
            const target = await this.getDevContainerTarget(templateId);
            resolved = target.workspaceFolders[0]?.path ?? target.newFolderPath;
        }

        if (!path.isAbsolute(resolved) || resolved.includes("\0")) {
            throw new Error(`Dev container folder is not an absolute path: ${resolved}`);
        }

        // Recorded so a failed apply can take back the folder it made. Without it, every
        // attempt that got this far left an empty directory behind -- and the next proposal
        // stepped past it, so retrying walked up `dotnet`, `dotnet-2`, `dotnet-3`.
        const existed = await fs.promises
            .stat(resolved)
            .then(() => true)
            .catch(() => false);

        await fs.promises.mkdir(resolved, { recursive: true });
        const stats = await fs.promises.stat(resolved);
        if (!stats.isDirectory()) {
            throw new Error(`Dev container folder is not a directory: ${resolved}`);
        }
        return { uri: vscode.Uri.file(resolved), created: !existed };
    }

    /**
     * Takes back a folder this run created, when nothing ended up in it.
     *
     * `rmdir` rather than a recursive delete, and only for a folder we made: it fails on a
     * directory with anything in it, so a partial write or a folder the user already had is
     * left alone rather than being cleaned up on their behalf.
     */
    private async discardCreatedTarget(target: vscode.Uri, created: boolean): Promise<void> {
        if (!created) {
            return;
        }
        try {
            await fs.promises.rmdir(target.fsPath);
        } catch {
            // Not empty, or already gone: either way there is nothing safe to remove.
        }
    }

    /** True when the target is one of the folders open in this window. */
    private isOpenWorkspaceFolder(target: vscode.Uri): boolean {
        return (vscode.workspace.workspaceFolders ?? []).some(
            (folder) => folder.uri.fsPath === target.fsPath,
        );
    }

    /** True only when Dev Containers' reopen command will use this exact folder. */
    private canReopenCurrentFolder(target: vscode.Uri): boolean {
        return (
            vscode.workspace.workspaceFile === undefined &&
            vscode.workspace.workspaceFolders?.length === 1 &&
            this.isOpenWorkspaceFolder(target)
        );
    }

    /**
     * Remembers where the user scaffolded, so the next template starts from the same place.
     *
     * Only for a folder they chose: remembering the parent of a workspace they already had open
     * would propose its siblings, which has nothing to do with where they keep new projects.
     */
    private async rememberTargetParent(target: vscode.Uri): Promise<void> {
        if (this.isOpenWorkspaceFolder(target)) {
            return;
        }
        await this._context.globalState.update(
            OverviewWebviewController._lastTargetParentKey,
            path.dirname(target.fsPath),
        );
    }

    /**
     * Reads the options a template declares, keeping only what the dialog can render: string
     * options with more than one suggested value. A single-valued option is not a choice, and
     * booleans and free-form strings have no control here yet.
     *
     * Failure is reported as "no options" rather than as an error. This is a registry fetch, so
     * it is unavailable offline, and the template still applies with its defaults -- losing the
     * dropdown is a smaller cost than losing the flow.
     */
    private async getDevContainerTemplateOptions(
        templateId: DevContainerTemplateId,
    ): Promise<DevContainerTemplateOption[]> {
        const registryId = templateRegistryId(templateId);
        const cached = this._templateOptions.get(registryId);
        if (cached) {
            return cached;
        }

        const cliPath = this.findDevContainersCli();
        if (!cliPath) {
            return [];
        }

        let metadata: unknown;
        try {
            const output = await this.runDevContainersCli(cliPath, [
                "templates",
                "metadata",
                registryId,
            ]);
            // The CLI writes its banner to stderr and the document to stdout, but it is read the
            // same way the apply output is: the last non-empty line, so a stray line cannot
            // break the parse.
            const line = output
                .split(/\r?\n/)
                .map((entry) => entry.trim())
                .filter(Boolean)
                .at(-1);
            metadata = line ? JSON.parse(line) : undefined;
        } catch (error) {
            this.logger.warn(
                `Could not read options for dev container template '${registryId}': ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
            return [];
        }

        const options = parseTemplateOptions(metadata);
        this._templateOptions.set(registryId, options);
        return options;
    }

    /**
     * Narrows what the page asked for to what the template actually declares.
     *
     * The values are substituted into the template's files, so they are checked against the
     * template's own list rather than trusted: an unknown key or an unlisted value is dropped and
     * that option keeps its default.
     */
    private async resolveTemplateOptions(
        templateId: DevContainerTemplateId,
        requested: Record<string, string> | undefined,
    ): Promise<Record<string, string>> {
        if (!requested || Object.keys(requested).length === 0) {
            return {};
        }

        const declared = await this.getDevContainerTemplateOptions(templateId);
        const resolved: Record<string, string> = {};
        for (const option of declared) {
            const value = requested[option.id];
            if (value !== undefined && option.values.includes(value)) {
                resolved[option.id] = value;
            }
        }
        return resolved;
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
    private runDevContainersCli(cliPath: string, args: string[]): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            const child = spawn(process.argv[0], [cliPath, ...args], {
                env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
            });

            let stderr = "";
            let stdout = "";
            child.stdout?.on("data", (chunk) => {
                stdout += String(chunk);
            });
            child.stderr?.on("data", (chunk) => {
                stderr += String(chunk);
            });
            child.on("error", reject);
            child.on("close", (code) => {
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(stderr.trim() || `Exited with code ${code}`));
                }
            });
        });
    }

    /** Re-runs the agent skills check and pushes the result to the page. */
    private async refreshAgentSkillsState(): Promise<void> {
        if (this.isDisposed) {
            return;
        }
        // Started from construction, from every reveal, and from the end of an install, and
        // `isInstalled` reads the filesystem and the settings, so these overlap. Only the newest
        // writes: an earlier `false` landing after the install's `true` would leave freshly
        // installed skills showing as missing.
        const request = ++this._agentSkillsRequest;
        const hasAgentSkillsPlugin = await this._agentSkillsInstaller.isInstalled();
        if (this.isDisposed || request !== this._agentSkillsRequest) {
            return;
        }
        this.updateState({ ...this.state, hasAgentSkillsPlugin });
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
     * After an extension update, greets the user with the Getting Started page and its release notes.
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
