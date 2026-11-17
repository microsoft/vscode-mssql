/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { createContext, useMemo } from "react";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import {
    Answers,
    FeatureHintCloseOutcome,
    GetFeatureHintsRequest,
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
            getFeatureHints: (answers: Answers) =>
                extensionRpc.sendRequest(GetFeatureHintsRequest.type, { answers }),
            openFeatureHintDocs: async (hintId: string) => {
                await extensionRpc.action("openFeatureHintDocs", { hintId });
            },
            tryFeatureHint: async (hintId: string) => {
                await extensionRpc.action("tryFeatureHint", { hintId });
            },
            closeFeatureHints: async (hintIds: string[], outcome: FeatureHintCloseOutcome) => {
                await extensionRpc.action("closeFeatureHints", { hintIds, outcome });
            },
        }),
        [extensionRpc],
    );

    return <UserSurveyContext.Provider value={commands}>{children}</UserSurveyContext.Provider>;
};

export { UserSurveyContext, UserSurveyStateProvider };
