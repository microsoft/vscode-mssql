/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-jsonrpc";
import { ChangelogActionId, ChangelogWebviewState } from "./changelog";

/**
 * Actions on the Overview page that map to an extension command. Kept as an enum rather than
 * raw command ids so the webview never has to know about command naming.
 */
export enum OverviewActionId {
    AddConnection = "addConnection",
    NewQuery = "newQuery",
    RunQuery = "runQuery",
    OpenSqlFile = "openSqlFile",
    NewDeployment = "newDeployment",
    NewLocalContainer = "newLocalContainer",
    NewFabricDatabase = "newFabricDatabase",
    NewAzureSqlDatabase = "newAzureSqlDatabase",
    NewNotebook = "newNotebook",
    NewTable = "newTable",
    ExecuteQuery = "executeQuery",
    OpenCopilotChat = "openCopilotChat",
    OpenShortcutsConfiguration = "openShortcutsConfiguration",
    OpenChangelog = "openChangelog",
}

/** Dev container templates offered under Build → Dev containers. */
export enum DevContainerTemplateId {
    DotNet = "dotnet",
    DotNetAspire = "dotnetAspire",
    Node = "node",
    Python = "python",
}

/** Result of a single dev container prerequisite check. */
export enum PrerequisiteStatus {
    /** Not checked yet. */
    Unknown = "unknown",
    /** A check is currently running. */
    Checking = "checking",
    /** The prerequisite is installed and usable. */
    Ready = "ready",
    /** The prerequisite is missing or unusable. */
    Missing = "missing",
}

/**
 * Prerequisites the guided dev container setup verifies before it can add a configuration.
 */
export interface DevContainerPrerequisites {
    docker: PrerequisiteStatus;
    devContainersExtension: PrerequisiteStatus;
}

/** A recently opened SQL file, projected for display on the Overview page. */
export interface RecentSqlFile {
    /** Filesystem path; also the identity used to reopen the file. */
    fsPath: string;
    /** File name with extension, e.g. "revenue-by-region.sql". */
    fileName: string;
    /** Containing folder, shown as secondary text to disambiguate same-named files. */
    folderLabel: string;
    /** Epoch milliseconds the file was last opened, or last modified if never opened here. */
    timestampMs: number;
}

/** A contributed command keybinding, resolved for display. */
export interface CommandShortcut {
    /** Human-readable command name. */
    label: string;
    /** Windows and Linux chord, e.g. "ctrl+shift+e". */
    windows: string;
    /** macOS chord, which falls back to the Windows chord when none is contributed. */
    mac: string;
}

/** State for the Overview webview. */
export interface OverviewWebviewState {
    /** Extension version shown beside the title, e.g. "1.46.0". */
    extensionVersion: string;
    /** Recently opened SQL files, newest first. */
    recentFiles: RecentSqlFile[];
    /** Release-note content for the What's new dialog; the same entries the Changelog page shows. */
    changelog: ChangelogWebviewState;
    /** Command keybindings contributed by the extension, for the shortcuts dialog. */
    commandShortcuts: CommandShortcut[];
    /**
     * Request generation for the What's new drawer. 0 means no request; each post-update trigger
     * increments it, so asking again reopens the drawer even after the user dismissed it (a plain
     * boolean would already be `true` and the webview would see no change). A page the user opens
     * themselves starts at 0.
     */
    openWhatsNewRequest: number;
    /** Current value of the `mssql.showChangelogOnUpdate` setting, shown as a header checkbox. */
    showChangelogOnUpdate: boolean;
    /**
     * Whether a folder is open. A dev container configuration can only be written into an open
     * folder, so the templates are unavailable until there is one.
     */
    hasWorkspaceFolder: boolean;
    /**
     * Whether the open folder already has a dev container configuration, in which case the useful
     * action is reopening in it rather than scaffolding another one.
     */
    hasDevContainerConfig: boolean;
    /** Whether this window is already running inside a dev container. */
    isInDevContainer: boolean;
    /** Whether the Azure SQL plugin is present and registered in `chat.pluginLocations`. */
    hasAgentSkillsPlugin: boolean;
    /** Whether the SQL migration plugin is present and registered in `chat.pluginLocations`. */
    hasMigrationSkillsPlugin: boolean;
}

/** Reducers (actions that change state) the Overview controller supports. */
export interface OverviewReducers {
    /** Persists the `mssql.showChangelogOnUpdate` setting from the header checkbox. */
    setShowChangelogOnUpdate: { value: boolean };
}

export interface OverviewLinkRequestParams {
    url: string;
}

/** A shipped skill displayed in the Azure SQL Skills catalog. */
export interface AgentSkillSummary {
    id: string;
    description: string;
    repositoryUrl: string;
}

/** A repository-defined group of shipped Azure SQL skills. */
export interface AgentSkillGroup {
    id: string;
    title: string;
    skills: AgentSkillSummary[];
}

/** Opens an external URL in the user's browser. */
export namespace OverviewLinkRequest {
    export const type = new RequestType<OverviewLinkRequestParams, void, void>("overview/openLink");
}

/** Runs the extension command mapped to an {@link OverviewActionId}. */
export namespace RunOverviewActionRequest {
    export const type = new RequestType<OverviewActionId, void, void>("overview/runAction");
}

export interface OpenRecentSqlFileRequestParams {
    /** {@link RecentSqlFile.fsPath} of the file to open. */
    fsPath: string;
}

/** Opens a recently used SQL file in the editor. */
export namespace OpenRecentSqlFileRequest {
    export const type = new RequestType<OpenRecentSqlFileRequestParams, void, void>(
        "overview/openRecentSqlFile",
    );
}

/** Runs the command behind a What's new entry's action. */
export namespace RunChangelogActionFromOverviewRequest {
    export const type = new RequestType<ChangelogActionId, void, void>(
        "overview/runChangelogAction",
    );
}

export interface AddDevContainerConfigurationRequestParams {
    templateId: DevContainerTemplateId;
    /**
     * Folder the template is written into. Created when it does not exist yet, which is what
     * lets the flow run with no folder open. Defaults to the open folder when omitted.
     */
    targetPath?: string;
    /**
     * Chosen value for each of the template's options, keyed by {@link
     * DevContainerTemplateOption.id}. Omitted options take the template's own default. The
     * controller re-validates these against the template's metadata before they reach the CLI.
     */
    options?: Record<string, string>;
}

/**
 * One value a dev container template lets the caller choose, narrowed to what the dialog renders.
 *
 * Templates may declare boolean and free-form string options too; only string options with more
 * than one suggested value are worth a control, so the controller filters the rest out.
 */
export interface DevContainerTemplateOption {
    /** The option's key in the template, passed back as a `--template-args` field. */
    id: string;
    /** The template's own label for it, such as ".NET version:". */
    label: string;
    /** Value applied when the user chooses nothing. Always one of {@link values}. */
    defaultValue: string;
    /** Values the template suggests, in the order it lists them. */
    values: string[];
}

export interface GetDevContainerTemplateOptionsRequestParams {
    templateId: DevContainerTemplateId;
}

/**
 * Reads the options a template declares, so the dialog can offer them before scaffolding.
 *
 * Answers with an empty list when the metadata cannot be read -- it is a registry fetch, and an
 * offline user should still be able to apply the template with its defaults.
 */
export namespace GetDevContainerTemplateOptionsRequest {
    export const type = new RequestType<
        GetDevContainerTemplateOptionsRequestParams,
        DevContainerTemplateOption[],
        void
    >("overview/getDevContainerTemplateOptions");
}

/** Re-runs the dev container prerequisite checks and reports where each one stands. */
export namespace CheckDevContainerPrerequisitesRequest {
    export const type = new RequestType<void, DevContainerPrerequisites, void>(
        "overview/checkDevContainerPrerequisites",
    );
}

/**
 * Installs the Dev Containers extension and waits for it to register, answering with the
 * prerequisite status once it has settled.
 */
export namespace InstallDevContainersExtensionRequest {
    export const type = new RequestType<void, DevContainerPrerequisites, void>(
        "overview/installDevContainersExtension",
    );
}

/** How the user reached the Getting Started page. */
export enum OverviewOpenSource {
    TreeNode = "treeNode",
    CommandPalette = "commandPalette",
    PostUpdate = "postUpdate",
}

/**
 * Things worth counting that happen inside the page. A closed set, so telemetry never carries a
 * free-form string out of the webview.
 */
export enum OverviewTelemetryEvent {
    /** A prompt card's prompt was copied. */
    PromptCopied = "promptCopied",
    /** A prompt card's prompt was handed to Copilot Chat. */
    PromptOpenedInChat = "promptOpenedInChat",
    /** A walkthrough was opened. */
    WalkthroughOpened = "walkthroughOpened",
    /** A Discover card was opened: explore, shortcuts, what's new, or the dev hub. */
    DiscoverCardOpened = "discoverCardOpened",
    /** A dev container template was chosen, before its prerequisites are checked. */
    DevContainerTemplateSelected = "devContainerTemplateSelected",
}

export interface SendOverviewTelemetryRequestParams {
    event: OverviewTelemetryEvent;
    /** Stable id of what the event was about, taken from the page's own content. */
    target?: string;
}

/** Reports an in-page event. The extension owns the mapping to a telemetry action. */
export namespace SendOverviewTelemetryRequest {
    export const type = new RequestType<SendOverviewTelemetryRequestParams, void, void>(
        "overview/sendTelemetry",
    );
}

/**
 * Reveals the extension's output channel.
 *
 * The dialog reports that scaffolding failed without the underlying message, which names paths
 * and is not localized. This is how the user reaches the reason behind that.
 */
export namespace ShowOverviewLogRequest {
    export const type = new RequestType<void, void, void>("overview/showLog");
}

/** Opens VS Code's folder picker, so a dev container configuration has somewhere to go. */
export namespace OpenFolderRequest {
    export const type = new RequestType<void, void, void>("overview/openFolder");
}

/** Outcome of scaffolding a dev container configuration. */
export interface AddDevContainerConfigurationResult {
    /** Whether a configuration was written into the folder. */
    applied: boolean;
    /**
     * True when the chosen template could not be applied directly and the Dev Containers
     * extension's own template picker was opened instead.
     */
    usedPicker: boolean;
    /** True when setup was canceled while resolving an existing template file. */
    conflict?: boolean;
    /** Failure reason, when the configuration could not be written. */
    error?: string;
    /** Folder the configuration was written into, when one was. */
    targetPath?: string;
    /** True when {@link targetPath} is not a folder currently open in the window. */
    opensNewFolder?: boolean;
}

/** Writes the chosen template's configuration into the open folder. */
export namespace AddDevContainerConfigurationRequest {
    export const type = new RequestType<
        AddDevContainerConfigurationRequestParams,
        AddDevContainerConfigurationResult,
        void
    >("overview/addDevContainerConfiguration");
}

export interface AgentSkillsPluginRequestParams {
    pluginName: "azure-sql" | "sql-migration";
}

/** Installs the selected plugin from the SQL agent skills marketplace. */
export namespace InstallAgentSkillsPluginRequest {
    export const type = new RequestType<AgentSkillsPluginRequestParams, void, void>(
        "overview/installAgentSkillsPlugin",
    );
}

export interface OpenPromptInChatRequestParams {
    /** Text handed to Copilot Chat verbatim, the same text Copy puts on the clipboard. */
    prompt: string;
}

/** Opens Copilot Chat with a prompt card's prompt already entered. */
export namespace OpenPromptInChatRequest {
    export const type = new RequestType<OpenPromptInChatRequestParams, void, void>(
        "overview/openPromptInChat",
    );
}

/** Reveals the installed plugin in the Extensions view so the user can manage it. */
export namespace ManageAgentSkillsPluginRequest {
    export const type = new RequestType<AgentSkillsPluginRequestParams, void, void>(
        "overview/manageAgentSkillsPlugin",
    );
}

/** Loads the current shipped-skill catalog from the Azure SQL Skills repository. */
export namespace GetAgentSkillsCatalogRequest {
    export const type = new RequestType<void, AgentSkillGroup[], void>(
        "overview/getAgentSkillsCatalog",
    );
}

export interface ReopenInContainerRequestParams {
    /**
     * Folder to open in a container. A single open folder can reattach the current window;
     * another folder, or a selected root from a multi-root workspace, opens directly.
     */
    folderPath?: string;
}

/** Rebuilds and reattaches the window inside the folder's dev container. */
export namespace ReopenInContainerRequest {
    export const type = new RequestType<ReopenInContainerRequestParams, void, void>(
        "overview/reopenInContainer",
    );
}

/** The places a template could be written, for the dialog to offer as a choice. */
export interface DevContainerTarget {
    /** Open folders in display order. The user chooses one when the window has multiple roots. */
    workspaceFolders: { name: string; path: string }[];
    /**
     * A folder that does not exist yet, named after the template under the parent last used.
     * Always proposed, so switching to "create a new folder" needs no second round trip.
     */
    newFolderPath: string;
}

export interface GetDevContainerTargetRequestParams {
    templateId: DevContainerTemplateId;
}

/**
 * Proposes where a template should go: any open folder, or a new folder named after the template
 * under the last place the user chose.
 */
export namespace GetDevContainerTargetRequest {
    export const type = new RequestType<
        GetDevContainerTargetRequestParams,
        DevContainerTarget,
        void
    >("overview/getDevContainerTarget");
}

export interface BrowseForDevContainerTargetRequestParams {
    /** Folder the picker opens on, usually whatever the field currently shows. */
    currentPath?: string;
}

/** Opens VS Code's folder picker, answering with the chosen path or undefined if dismissed. */
export namespace BrowseForDevContainerTargetRequest {
    export const type = new RequestType<
        BrowseForDevContainerTargetRequestParams,
        string | undefined,
        void
    >("overview/browseForDevContainerTarget");
}
