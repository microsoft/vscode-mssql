/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from "react";
import { createContext, useMemo } from "react";
import {
    MssqlConfigurationContextProps,
    MssqlConfigurationReducers,
    MssqlConfigurationWebviewState,
    SaveMssqlConfigurationPayload,
} from "../../../sharedInterfaces/mssqlConfiguration";
import { getCoreRPCs } from "../../common/utils";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";

const MssqlConfigurationContext = createContext<MssqlConfigurationContextProps | undefined>(
    undefined,
);

const MssqlConfigurationStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview<
        MssqlConfigurationWebviewState,
        MssqlConfigurationReducers
    >();

    const commands = useMemo<MssqlConfigurationContextProps>(
        () => ({
            ...getCoreRPCs(extensionRpc),
            saveConfiguration: (payload: SaveMssqlConfigurationPayload) =>
                extensionRpc.action("saveConfiguration", payload),
            reloadConfiguration: () => extensionRpc.action("reloadConfiguration", {}),
            closeDialog: () => extensionRpc.action("closeDialog", {}),
        }),
        [extensionRpc],
    );

    return (
        <MssqlConfigurationContext.Provider value={commands}>
            {children}
        </MssqlConfigurationContext.Provider>
    );
};

export { MssqlConfigurationContext, MssqlConfigurationStateProvider };
