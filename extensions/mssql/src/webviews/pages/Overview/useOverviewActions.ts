/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useMemo } from "react";
import {
    AddDevContainerConfigurationRequest,
    DevContainerTemplateId,
    OpenRecentSqlFileRequest,
    RunChangelogActionFromOverviewRequest,
    OverviewActionId,
    OverviewLinkRequest,
    RunOverviewActionRequest,
} from "../../../sharedInterfaces/overview";
import { ChangelogActionId } from "../../../sharedInterfaces/changelog";
import { useOverviewContext } from "./overviewStateProvider";

/**
 * The Overview page's side-effecting operations, wrapped so components call intent-named
 * functions rather than assembling RPC requests themselves.
 */
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

    const runChangelogAction = useCallback(
        (action: ChangelogActionId) => {
            void extensionRpc.sendRequest(RunChangelogActionFromOverviewRequest.type, action);
        },
        [extensionRpc],
    );

    const addDevContainerConfiguration = useCallback(
        (templateId: DevContainerTemplateId) => {
            void extensionRpc.sendRequest(AddDevContainerConfigurationRequest.type, { templateId });
        },
        [extensionRpc],
    );

    const setShowOnStartup = useCallback(
        (showOnStartup: boolean) => {
            extensionRpc.action("setShowOnStartup", { showOnStartup });
        },
        [extensionRpc],
    );

    const checkPrerequisites = useCallback(() => {
        extensionRpc.action("checkPrerequisites", {});
    }, [extensionRpc]);

    const installDevContainersExtension = useCallback(() => {
        extensionRpc.action("installDevContainersExtension", {});
    }, [extensionRpc]);

    return useMemo(
        () => ({
            runAction,
            openLink,
            openRecentSqlFile,
            runChangelogAction,
            addDevContainerConfiguration,
            setShowOnStartup,
            checkPrerequisites,
            installDevContainersExtension,
        }),
        [
            runAction,
            openLink,
            openRecentSqlFile,
            runChangelogAction,
            addDevContainerConfiguration,
            setShowOnStartup,
            checkPrerequisites,
            installDevContainersExtension,
        ],
    );
}
