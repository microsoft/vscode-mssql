/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useMemo } from "react";
import {
    AddDevContainerConfigurationRequest,
    AgentSkillPluginName,
    DevContainerTemplateId,
    CheckDevContainerPrerequisitesRequest,
    DevContainerPrerequisites,
    DevContainerTarget,
    DevContainerTemplateOption,
    BrowseForDevContainerTargetRequest,
    GetAgentSkillsCatalogRequest,
    GetDevContainerTargetRequest,
    GetDevContainerTemplateOptionsRequest,
    InstallAgentSkillsPluginRequest,
    ManageAgentSkillsPluginRequest,
    OpenPromptInChatRequest,
    DevContainerPrerequisitesChangedNotification,
    OpenExtensionRequest,
    OpenFolderRequest,
    OverviewExtensionId,
    OverviewTelemetryEvent,
    ReopenInContainerRequest,
    SendOverviewTelemetryRequest,
    ShowOverviewLogRequest,
    OpenRecentSqlFileRequest,
    RunChangelogActionFromOverviewRequest,
    OverviewActionId,
    OverviewLinkRequest,
    RunOverviewActionRequest,
} from "../../../sharedInterfaces/overview";
import { ChangelogActionId } from "../../../sharedInterfaces/changelog";
import { useOverviewContext } from "./overviewStateProvider";

export function useOverviewActions() {
    const { extensionRpc } = useOverviewContext();

    const runAction = useCallback(
        (action: OverviewActionId) => {
            void extensionRpc.sendRequest(RunOverviewActionRequest.type, action);
        },
        [extensionRpc],
    );

    const openLink = useCallback(
        (url: string) => {
            void extensionRpc.sendRequest(OverviewLinkRequest.type, { url });
        },
        [extensionRpc],
    );

    const openRecentSqlFile = useCallback(
        (fsPath: string) => {
            void extensionRpc.sendRequest(OpenRecentSqlFileRequest.type, { fsPath });
        },
        [extensionRpc],
    );

    const installAgentSkillsPlugin = useCallback(
        (pluginName: AgentSkillPluginName) =>
            extensionRpc.sendRequest(InstallAgentSkillsPluginRequest.type, { pluginName }),
        [extensionRpc],
    );

    const getAgentSkillsCatalog = useCallback(
        () => extensionRpc.sendRequest(GetAgentSkillsCatalogRequest.type, undefined),
        [extensionRpc],
    );

    const manageAgentSkillsPlugin = useCallback(
        (pluginName: AgentSkillPluginName) =>
            extensionRpc.sendRequest(ManageAgentSkillsPluginRequest.type, { pluginName }),
        [extensionRpc],
    );

    const openPromptInChat = useCallback(
        (prompt: string) => extensionRpc.sendRequest(OpenPromptInChatRequest.type, { prompt }),
        [extensionRpc],
    );

    const sendTelemetry = useCallback(
        (event: OverviewTelemetryEvent, target?: string) => {
            void extensionRpc.sendRequest(SendOverviewTelemetryRequest.type, { event, target });
        },
        [extensionRpc],
    );

    const openFolder = useCallback(() => {
        void extensionRpc.sendRequest(OpenFolderRequest.type, undefined);
    }, [extensionRpc]);

    const runChangelogAction = useCallback(
        (action: ChangelogActionId) => {
            void extensionRpc.sendRequest(RunChangelogActionFromOverviewRequest.type, action);
        },
        [extensionRpc],
    );

    const addDevContainerConfiguration = useCallback(
        (
            templateId: DevContainerTemplateId,
            options?: Record<string, string>,
            targetPath?: string,
        ) =>
            extensionRpc.sendRequest(AddDevContainerConfigurationRequest.type, {
                templateId,
                options,
                targetPath,
            }),
        [extensionRpc],
    );

    const getDevContainerTarget = useCallback(
        (templateId: DevContainerTemplateId): Promise<DevContainerTarget> =>
            extensionRpc.sendRequest(GetDevContainerTargetRequest.type, { templateId }),
        [extensionRpc],
    );

    const browseForDevContainerTarget = useCallback(
        (currentPath?: string): Promise<string | undefined> =>
            extensionRpc.sendRequest(BrowseForDevContainerTargetRequest.type, { currentPath }),
        [extensionRpc],
    );

    const getDevContainerTemplateOptions = useCallback(
        (templateId: DevContainerTemplateId): Promise<DevContainerTemplateOption[]> =>
            extensionRpc.sendRequest(GetDevContainerTemplateOptionsRequest.type, { templateId }),
        [extensionRpc],
    );

    const showLog = useCallback(() => {
        void extensionRpc.sendRequest(ShowOverviewLogRequest.type, undefined);
    }, [extensionRpc]);

    const reopenInContainer = useCallback(
        (folderPath?: string) => {
            void extensionRpc.sendRequest(ReopenInContainerRequest.type, { folderPath });
        },
        [extensionRpc],
    );

    const checkPrerequisites = useCallback(
        (): Promise<DevContainerPrerequisites> =>
            extensionRpc.sendRequest(CheckDevContainerPrerequisitesRequest.type, undefined),
        [extensionRpc],
    );

    const openExtension = useCallback(
        (extensionId: OverviewExtensionId) => {
            void extensionRpc.sendRequest(OpenExtensionRequest.type, { extensionId });
        },
        [extensionRpc],
    );

    const onPrerequisitesChanged = useCallback(
        (handler: (prerequisites: DevContainerPrerequisites) => void) => {
            const subscription = extensionRpc.onNotification(
                DevContainerPrerequisitesChangedNotification.type,
                handler,
            );
            return () => subscription.dispose();
        },
        [extensionRpc],
    );

    const setShowChangelogOnUpdate = useCallback(
        (value: boolean) => {
            extensionRpc.action("setShowChangelogOnUpdate", { value });
        },
        [extensionRpc],
    );

    return useMemo(
        () => ({
            runAction,
            openLink,
            openRecentSqlFile,
            openFolder,
            installAgentSkillsPlugin,
            manageAgentSkillsPlugin,
            getAgentSkillsCatalog,
            openPromptInChat,
            sendTelemetry,
            runChangelogAction,
            addDevContainerConfiguration,
            getDevContainerTemplateOptions,
            getDevContainerTarget,
            browseForDevContainerTarget,
            showLog,
            reopenInContainer,
            checkPrerequisites,
            openExtension,
            onPrerequisitesChanged,
            setShowChangelogOnUpdate,
        }),
        [
            runAction,
            openLink,
            openRecentSqlFile,
            openFolder,
            installAgentSkillsPlugin,
            manageAgentSkillsPlugin,
            getAgentSkillsCatalog,
            openPromptInChat,
            sendTelemetry,
            runChangelogAction,
            addDevContainerConfiguration,
            getDevContainerTemplateOptions,
            getDevContainerTarget,
            browseForDevContainerTarget,
            showLog,
            reopenInContainer,
            checkPrerequisites,
            openExtension,
            onPrerequisitesChanged,
            setShowChangelogOnUpdate,
        ],
    );
}
