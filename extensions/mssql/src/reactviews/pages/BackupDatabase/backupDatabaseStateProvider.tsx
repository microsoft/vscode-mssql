/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReactNode, createContext, useMemo } from "react";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { getCoreRPCs2 } from "../../common/utils";
import {
    BackupDatabaseProvider,
    BackupDatabaseReducers,
    BackupDatabaseWebviewState,
} from "../../../sharedInterfaces/backupDatabase";

export interface BackupDatabaseContextProps extends BackupDatabaseProvider {}

const BackupDatabaseContext = createContext<BackupDatabaseContextProps | undefined>(undefined);

interface BackupDatabaseProviderProps {
    children: ReactNode;
}

const BackupDatabaseStateProvider: React.FC<BackupDatabaseProviderProps> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview2<
        BackupDatabaseWebviewState,
        BackupDatabaseReducers
    >();

    const commands = useMemo<BackupDatabaseContextProps>(
        () => ({
            ...getCoreRPCs2(extensionRpc),
            getDatabase: function (): void {
                extensionRpc.action("getDatabase", {});
            },
        }),
        [extensionRpc],
    );

    return (
        <BackupDatabaseContext.Provider value={commands}>{children}</BackupDatabaseContext.Provider>
    );
};

export { BackupDatabaseContext, BackupDatabaseStateProvider };
