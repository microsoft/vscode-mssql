/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { createContext, useContext, useMemo } from "react";
import {
    GlobalSearchWebViewState,
    GlobalSearchReducers,
    GlobalSearchContextProps,
    SearchResultItem,
    ObjectTypeFilters,
    ScriptType,
} from "../../../sharedInterfaces/globalSearch";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { getCoreRPCs2 } from "../../common/utils";

const GlobalSearchContext = createContext<GlobalSearchContextProps>(
    {} as GlobalSearchContextProps,
);

export const GlobalSearchStateProvider: React.FC<{
    children: React.ReactNode;
}> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview2<GlobalSearchWebViewState, GlobalSearchReducers>();

    const commands = useMemo<GlobalSearchContextProps>(
        () => ({
            ...getCoreRPCs2(extensionRpc),

            // Search
            search: (searchTerm: string): void => {
                extensionRpc.action("search", { searchTerm });
            },

            clearSearch: (): void => {
                extensionRpc.action("clearSearch", {});
            },

            // Filters
            setDatabase: (database: string): void => {
                extensionRpc.action("setDatabase", { database });
            },

            toggleObjectTypeFilter: (objectType: keyof ObjectTypeFilters): void => {
                extensionRpc.action("toggleObjectTypeFilter", { objectType });
            },

            toggleSchemaFilter: (schema: string): void => {
                extensionRpc.action("toggleSchemaFilter", { schema });
            },

            selectAllSchemas: (): void => {
                extensionRpc.action("selectAllSchemas", {});
            },

            clearSchemaSelection: (): void => {
                extensionRpc.action("clearSchemaSelection", {});
            },

            // Object Actions
            scriptObject: (object: SearchResultItem, scriptType: ScriptType): void => {
                extensionRpc.action("scriptObject", { object, scriptType });
            },

            editData: (object: SearchResultItem): void => {
                extensionRpc.action("editData", { object });
            },

            copyObjectName: (object: SearchResultItem): void => {
                extensionRpc.action("copyObjectName", { object });
            },

            // Data refresh
            refreshDatabases: (): void => {
                extensionRpc.action("refreshDatabases", {});
            },

            refreshResults: (): void => {
                extensionRpc.action("refreshResults", {});
            },
        }),
        [extensionRpc],
    );

    return (
        <GlobalSearchContext.Provider value={commands}>{children}</GlobalSearchContext.Provider>
    );
};

export const useGlobalSearchContext = (): GlobalSearchContextProps => {
    const context = useContext(GlobalSearchContext);
    return context;
};
