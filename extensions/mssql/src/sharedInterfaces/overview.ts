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
    FocusConnections = "focusConnections",
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
     * Whether the What's new drawer starts open. Set only when the page is opened by the
     * post-update trigger; a page the user opens themselves always starts with it closed.
     */
    openWhatsNewOnLoad: boolean;
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
    /**
     * Whether the Azure SQL agent skills plugin is installed. Read from the chat plugin
     * marketplaces setting, which VS Code writes when a marketplace plugin is installed.
     */
    hasAgentSkillsPlugin: boolean;
}

/** Reducers (actions that change state) the Overview controller supports. */
export interface OverviewReducers {
    /** Persists the `mssql.showChangelogOnUpdate` setting from the header checkbox. */
    setShowChangelogOnUpdate: { value: boolean };
}

export interface OverviewLinkRequestParams {
    url: string;
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

/** How the user reached the Welcome page. */
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
    /** A prompt card's prompt was opened in the dialog. */
    PromptViewed = "promptViewed",
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
    /** Failure reason, when the configuration could not be written. */
    error?: string;
}

/** Writes the chosen template's configuration into the open folder. */
export namespace AddDevContainerConfigurationRequest {
    export const type = new RequestType<
        AddDevContainerConfigurationRequestParams,
        AddDevContainerConfigurationResult,
        void
    >("overview/addDevContainerConfiguration");
}

/**
 * Hands VS Code its own plugin install flow with the Azure SQL skills source pre-filled. The
 * install itself, including the trust prompt, is VS Code's.
 */
export namespace InstallAgentSkillsPluginRequest {
    export const type = new RequestType<void, void, void>("overview/installAgentSkillsPlugin");
}

/** Rebuilds and reattaches the window inside the folder's dev container. */
export namespace ReopenInContainerRequest {
    export const type = new RequestType<void, void, void>("overview/reopenInContainer");
}
