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
    git: PrerequisiteStatus;
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
    /** Whether the Overview page opens automatically on startup. */
    showOnStartup: boolean;
    /** Recently opened SQL files, newest first. */
    recentFiles: RecentSqlFile[];
    /** Release-note content for the What's new dialog; the same entries the Changelog page shows. */
    changelog: ChangelogWebviewState;
    /** Command keybindings contributed by the extension, for the shortcuts dialog. */
    commandShortcuts: CommandShortcut[];
    /** Dev container prerequisite status, refreshed when the setup dialog opens. */
    prerequisites: DevContainerPrerequisites;
}

/** Reducers (actions that change state) the Overview controller supports. */
export interface OverviewReducers {
    /** Persist the "Show welcome page on start up" checkbox. */
    setShowOnStartup: { showOnStartup: boolean };
    /** Re-run all dev container prerequisite checks. */
    checkPrerequisites: {};
    /** Install the Dev Containers extension, then re-check prerequisites. */
    installDevContainersExtension: {};
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

/** Hands off to the Dev Containers extension to add a configuration for the chosen template. */
export namespace AddDevContainerConfigurationRequest {
    export const type = new RequestType<AddDevContainerConfigurationRequestParams, void, void>(
        "overview/addDevContainerConfiguration",
    );
}
