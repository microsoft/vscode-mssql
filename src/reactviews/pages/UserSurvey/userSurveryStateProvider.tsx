/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { createContext } from "react";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import {
    UserSurveyContextProps,
    UserSurveyState,
    UserSurveyReducers,
} from "../../../sharedInterfaces/userSurvey";

const UserSurveyContext = createContext<UserSurveyContextProps | undefined>(
    undefined,
);

interface UserSurveyProviderProps {
    children: React.ReactNode;
}

const UserSurveyStateProvider: React.FC<UserSurveyProviderProps> = ({
    children,
}) => {
    const vscodeWebviewProvider = useVscodeWebview<
        UserSurveyState,
        UserSurveyReducers
    >();
    return (
        <UserSurveyContext.Provider
            value={{
                state: vscodeWebviewProvider.state,
                submit: async (answers: Record<string, string>) => {
                    await vscodeWebviewProvider.extensionRpc.action("submit", {
                        answers: answers,
                    });
                },
                cancel: async () => {
                    await vscodeWebviewProvider.extensionRpc.action("cancel");
                },
                openPrivacyStatement: async () => {
                    await vscodeWebviewProvider.extensionRpc.action(
                        "openPrivacyStatement",
                    );
                },
            }}
        >
            {children}
        </UserSurveyContext.Provider>
    );
};

export { UserSurveyContext, UserSurveyStateProvider };
