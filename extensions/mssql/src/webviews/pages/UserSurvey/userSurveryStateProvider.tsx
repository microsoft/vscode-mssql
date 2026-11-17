/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { createContext, useMemo } from "react";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import {
    Answers,
    FeatureHintCloseOutcome,
    FeatureHintSource,
    GetFeatureHintsRequest,
    IsCopilotFeatureHintAvailableRequest,
    UserSurveyContextProps,
    UserSurveyState,
    UserSurveyReducers,
} from "../../../sharedInterfaces/userSurvey";
import { getCoreRPCs } from "../../common/utils";

const UserSurveyContext = createContext<UserSurveyContextProps | undefined>(undefined);

interface UserSurveyProviderProps {
    children: React.ReactNode;
}

const UserSurveyStateProvider: React.FC<UserSurveyProviderProps> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview<UserSurveyState, UserSurveyReducers>();

    const commands = useMemo<UserSurveyContextProps>(
        () => ({
            ...getCoreRPCs(extensionRpc),
            submit: async (answers: Record<string, string>) => {
                await extensionRpc.action("submit", {
                    answers: answers,
                });
            },
            cancel: async () => {
                await extensionRpc.action("cancel");
            },
            openPrivacyStatement: async () => {
                await extensionRpc.action("openPrivacyStatement");
            },
            getFeatureHints: (answers: Answers, source: FeatureHintSource) =>
                extensionRpc.sendRequest(GetFeatureHintsRequest.type, { answers, source }),
            isCopilotFeatureHintAvailable: () =>
                extensionRpc.sendRequest(IsCopilotFeatureHintAvailableRequest.type),
            openFeatureHintDocs: async (hintId: string, source: FeatureHintSource) => {
                await extensionRpc.action("openFeatureHintDocs", { hintId, source });
            },
            tryFeatureHint: async (hintId: string, source: FeatureHintSource) => {
                await extensionRpc.action("tryFeatureHint", { hintId, source });
            },
            closeFeatureHints: async (
                hintIds: string[],
                source: FeatureHintSource,
                outcome: FeatureHintCloseOutcome,
            ) => {
                await extensionRpc.action("closeFeatureHints", { hintIds, source, outcome });
            },
        }),
        [extensionRpc],
    );

    return <UserSurveyContext.Provider value={commands}>{children}</UserSurveyContext.Provider>;
};

export { UserSurveyContext, UserSurveyStateProvider };
