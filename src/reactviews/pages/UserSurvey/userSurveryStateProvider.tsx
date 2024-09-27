/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { createContext } from "react";

const UserSurveyContext = createContext<any>(undefined);

interface UserSurveyProviderProps {
    children: React.ReactNode;
}

const UserSurveyStateProvider: React.FC<UserSurveyProviderProps> = ({
    children,
}) => {
    return (
        <UserSurveyContext.Provider value={{}}>
            {children}
        </UserSurveyContext.Provider>
    );
};

export { UserSurveyContext, UserSurveyStateProvider };
