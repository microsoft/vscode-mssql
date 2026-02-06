/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { createContext, useMemo } from "react";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import {
    UserSurveyContextProps,
    UserSurveyState,
    UserSurveyReducers,
} from "../../../sharedInterfaces/userSurvey";
import { getCoreRPCs2 } from "../../common/utils";

const UserSurveyContext = createContext<UserSurveyContextProps | undefined>(undefined);

interface UserSurveyProviderProps {
    children: React.ReactNode;
}

const UserSurveyStateProvider: React.FC<UserSurveyProviderProps> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview2<UserSurveyState, UserSurveyReducers>();

    const commands = useMemo<UserSurveyContextProps>(
        () => ({
            ...getCoreRPCs2(extensionRpc),
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
        }),
        [extensionRpc],
    );

    return (
        <UserSurveyContext.Provider value={commands}>{children}</UserSurveyContext.Provider>
    );
};

export { UserSurveyContext, UserSurveyStateProvider };
