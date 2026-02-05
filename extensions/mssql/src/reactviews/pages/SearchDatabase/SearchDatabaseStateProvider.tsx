/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { createContext, useContext, useMemo } from "react";
import {
    SearchDatabaseWebViewState,
    SearchDatabaseReducers,
    SearchDatabaseContextProps,
    SearchResultItem,
    ObjectTypeFilters,
    ScriptType,
} from "../../../sharedInterfaces/searchDatabase";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { getCoreRPCs2 } from "../../common/utils";

const SearchDatabaseContext = createContext<SearchDatabaseContextProps>({} as SearchDatabaseContextProps);

export const SearchDatabaseStateProvider: React.FC<{
    children: React.ReactNode;
}> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview2<SearchDatabaseWebViewState, SearchDatabaseReducers>();

    const commands = useMemo<SearchDatabaseContextProps>(
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

            setObjectTypeFilters: (filters: ObjectTypeFilters): void => {
                extensionRpc.action("setObjectTypeFilters", { filters });
            },

            toggleSchemaFilter: (schema: string): void => {
                extensionRpc.action("toggleSchemaFilter", { schema });
            },

            setSchemaFilters: (schemas: string[]): void => {
                extensionRpc.action("setSchemaFilters", { schemas });
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

            modifyTable: (object: SearchResultItem): void => {
                extensionRpc.action("modifyTable", { object });
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

    return <SearchDatabaseContext.Provider value={commands}>{children}</SearchDatabaseContext.Provider>;
};

export const useSearchDatabaseContext = (): SearchDatabaseContextProps => {
    const context = useContext(SearchDatabaseContext);
    return context;
};
