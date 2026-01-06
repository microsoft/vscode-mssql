/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import {
    BackupDatabaseFormState,
    BackupDatabaseProvider,
    BackupDatabaseReducers,
    BackupDatabaseState,
} from "../../../sharedInterfaces/objectManagement";
import { FormEvent } from "../../../sharedInterfaces/form";
import { ReactNode, createContext, useMemo } from "react";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { getCoreRPCs2 } from "../../common/utils";
import { WebviewRpc } from "../../common/rpc";

export interface BackupDatabaseContextProps extends BackupDatabaseProvider {
    extensionRpc: WebviewRpc<BackupDatabaseReducers>;
}

const BackupDatabaseContext = createContext<BackupDatabaseContextProps | undefined>(undefined);

interface BackupDatabaseProviderProps {
    children: ReactNode;
}

const BackupDatabaseStateProvider: React.FC<BackupDatabaseProviderProps> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview2<BackupDatabaseState, BackupDatabaseReducers>();

    const value = useMemo<BackupDatabaseContextProps>(
        () => ({
            ...getCoreRPCs2(extensionRpc),
            formAction: (event: FormEvent<BackupDatabaseFormState>) =>
                extensionRpc.action("formAction", { event }),
            backupDatabase: () => extensionRpc.action("backupDatabase"),
            extensionRpc,
        }),
        [extensionRpc],
    );

    return (
        <BackupDatabaseContext.Provider value={value}>{children}</BackupDatabaseContext.Provider>
    );
};

export { BackupDatabaseContext, BackupDatabaseStateProvider };
