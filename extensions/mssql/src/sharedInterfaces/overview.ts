/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType, RequestType } from "vscode-jsonrpc";
import { ChangelogActionId, ChangelogWebviewState } from "./changelog";

/**
 * Kept as an enum rather than raw command ids so the webview never has to know about command
 * naming.
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

export enum DevContainerTemplateId {
    DotNet = "dotnet",
    DotNetAspire = "dotnetAspire",
    Node = "node",
    Python = "python",
}

export enum PrerequisiteStatus {
    Unknown = "unknown",
    Checking = "checking",
    Ready = "ready",
    Missing = "missing",
}

export interface DevContainerPrerequisites {
    docker: PrerequisiteStatus;
    devContainersExtension: PrerequisiteStatus;
}

export interface RecentSqlFile {
    fsPath: string;
    fileName: string;
    /** Epoch milliseconds the file was last opened, or last modified if never opened here. */
    timestampMs: number;
}

export interface CommandShortcut {
    label: string;
    /** Windows and Linux chord, e.g. "ctrl+shift+e". */
    windows: string;
    /** macOS chord, which falls back to the Windows chord when none is contributed. */
    mac: string;
}

export interface OverviewWebviewState {
    extensionVersion: string;
    recentFiles: RecentSqlFile[];
    changelog: ChangelogWebviewState;
    commandShortcuts: CommandShortcut[];
    /**
     * Request generation for the What's new drawer. 0 means no request; each post-update trigger
     * increments it, so asking again reopens the drawer even after the user dismissed it (a plain
     * boolean would already be `true` and the webview would see no change). A page the user opens
     * themselves starts at 0.
     */
    openWhatsNewRequest: number;
    showChangelogOnUpdate: boolean;
    hasWorkspaceFolder: boolean;
    hasDevContainerConfig: boolean;
    isInDevContainer: boolean;
    /**
     * A plugin is absent from the map until its first check completes, which is why the entries
     * are optional rather than defaulted to false.
     */
    installedAgentSkillPlugins: Partial<Record<AgentSkillPluginName, boolean>>;
}

export interface OverviewReducers {
    setShowChangelogOnUpdate: { value: boolean };
}

export interface OverviewLinkRequestParams {
    url: string;
}

/**
 * Agent skill plugins the extension installs, named exactly as their manifests are -- the name is
 * the directory in the repository, the folder installed under global storage, and what the
 * Extensions view matches an `@agentPlugins` search against, so the three cannot be spelled
 * differently.
 */
export const AGENT_SKILL_PLUGINS = ["microsoft-sql-vscode", "microsoft-sql-migration"] as const;

export type AgentSkillPluginName = (typeof AGENT_SKILL_PLUGINS)[number];

export interface AgentSkillSummary {
    id: string;
    description: string;
    repositoryUrl: string;
}

export interface AgentSkillGroup {
    id: AgentSkillPluginName;
    skills: AgentSkillSummary[];
    repositoryUrl: string;
}

export namespace OverviewLinkRequest {
    export const type = new RequestType<OverviewLinkRequestParams, void, void>("overview/openLink");
}

export namespace RunOverviewActionRequest {
    export const type = new RequestType<OverviewActionId, void, void>("overview/runAction");
}

export interface OpenRecentSqlFileRequestParams {
    fsPath: string;
}

export namespace OpenRecentSqlFileRequest {
    export const type = new RequestType<OpenRecentSqlFileRequestParams, void, void>(
        "overview/openRecentSqlFile",
    );
}

export namespace RunChangelogActionFromOverviewRequest {
    export const type = new RequestType<ChangelogActionId, void, void>(
        "overview/runChangelogAction",
    );
}

export interface AddDevContainerConfigurationRequestParams {
    templateId: DevContainerTemplateId;
    /**
     * Created when it does not exist yet, which is what lets the flow run with no folder open.
     * Defaults to the open folder when omitted.
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
 * Templates may declare boolean and free-form string options too; only string options with more
 * than one suggested value are worth a control, so the controller filters the rest out.
 */
export interface DevContainerTemplateOption {
    /** The option's key in the template, passed back as a `--template-args` field. */
    id: string;
    label: string;
    /** Always one of {@link values}. */
    defaultValue: string;
    values: string[];
}

export interface GetDevContainerTemplateOptionsRequestParams {
    templateId: DevContainerTemplateId;
}

/**
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

export namespace CheckDevContainerPrerequisitesRequest {
    export const type = new RequestType<void, DevContainerPrerequisites, void>(
        "overview/checkDevContainerPrerequisites",
    );
}

export enum OverviewExtensionId {
    DevContainers = "ms-vscode-remote.remote-containers",
    Keymap = "ms-mssql.mssql-database-management-keymap",
}

/**
 * The page learns of the install through DevContainerPrerequisitesChangedNotification, not the
 * reply.
 */
export namespace OpenExtensionRequest {
    export const type = new RequestType<{ extensionId: OverviewExtensionId }, void, void>(
        "overview/openExtension",
    );
}

/**
 * Pushed when a prerequisite may have changed outside the page -- an extension installed from the
 * Extensions view, or Docker installed while VS Code was in the background -- so the setup dialog
 * does not wait on the user to press Recheck.
 */
export namespace DevContainerPrerequisitesChangedNotification {
    export const type = new NotificationType<DevContainerPrerequisites>(
        "overview/devContainerPrerequisitesChanged",
    );
}

export enum OverviewOpenSource {
    TreeNode = "treeNode",
    CommandPalette = "commandPalette",
    PostUpdate = "postUpdate",
}

/**
 * A closed set, so telemetry never carries a free-form string out of the webview.
 */
export enum OverviewTelemetryEvent {
    PromptCopied = "promptCopied",
    PromptOpenedInChat = "promptOpenedInChat",
    WalkthroughOpened = "walkthroughOpened",
    DiscoverCardOpened = "discoverCardOpened",
    DevContainerTemplateSelected = "devContainerTemplateSelected",
    PrerequisitesRechecked = "prerequisitesRechecked",
}

export interface SendOverviewTelemetryRequestParams {
    event: OverviewTelemetryEvent;
    target?: string;
}

export namespace SendOverviewTelemetryRequest {
    export const type = new RequestType<SendOverviewTelemetryRequestParams, void, void>(
        "overview/sendTelemetry",
    );
}

/**
 * The dialog reports that scaffolding failed without the underlying message, which names paths
 * and is not localized. This is how the user reaches the reason behind that.
 */
export namespace ShowOverviewLogRequest {
    export const type = new RequestType<void, void, void>("overview/showLog");
}

export namespace OpenFolderRequest {
    export const type = new RequestType<void, void, void>("overview/openFolder");
}

export interface AddDevContainerConfigurationResult {
    applied: boolean;
    /**
     * True when the chosen template could not be applied directly and the Dev Containers
     * extension's own template picker was opened instead.
     */
    usedPicker: boolean;
    /** True when setup was canceled while resolving an existing template file. */
    conflict?: boolean;
    error?: string;
    targetPath?: string;
    opensNewFolder?: boolean;
}

export namespace AddDevContainerConfigurationRequest {
    export const type = new RequestType<
        AddDevContainerConfigurationRequestParams,
        AddDevContainerConfigurationResult,
        void
    >("overview/addDevContainerConfiguration");
}

export interface AgentSkillsPluginRequestParams {
    pluginName: AgentSkillPluginName;
}

export namespace InstallAgentSkillsPluginRequest {
    export const type = new RequestType<AgentSkillsPluginRequestParams, void, void>(
        "overview/installAgentSkillsPlugin",
    );
}

export interface OpenPromptInChatRequestParams {
    prompt: string;
}

export namespace OpenPromptInChatRequest {
    export const type = new RequestType<OpenPromptInChatRequestParams, void, void>(
        "overview/openPromptInChat",
    );
}

export namespace ManageAgentSkillsPluginRequest {
    export const type = new RequestType<AgentSkillsPluginRequestParams, void, void>(
        "overview/manageAgentSkillsPlugin",
    );
}

export namespace GetAgentSkillsCatalogRequest {
    export const type = new RequestType<void, AgentSkillGroup[], void>(
        "overview/getAgentSkillsCatalog",
    );
}

export interface ReopenInContainerRequestParams {
    /**
     * A single open folder can reattach the current window; another folder, or a selected root from
     * a multi-root workspace, opens directly.
     */
    folderPath?: string;
}

export namespace ReopenInContainerRequest {
    export const type = new RequestType<ReopenInContainerRequestParams, void, void>(
        "overview/reopenInContainer",
    );
}

export interface DevContainerTarget {
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

export namespace GetDevContainerTargetRequest {
    export const type = new RequestType<
        GetDevContainerTargetRequestParams,
        DevContainerTarget,
        void
    >("overview/getDevContainerTarget");
}

export interface BrowseForDevContainerTargetRequestParams {
    currentPath?: string;
}

export namespace BrowseForDevContainerTargetRequest {
    export const type = new RequestType<
        BrowseForDevContainerTargetRequestParams,
        string | undefined,
        void
    >("overview/browseForDevContainerTarget");
}
