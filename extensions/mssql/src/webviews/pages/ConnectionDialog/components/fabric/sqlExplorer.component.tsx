/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useMemo, useState } from "react";
import { useConnectionDialogSelector } from "../../connectionDialogSelector";
import SqlExplorerHeader from "./sqlExplorerHeader.component";
import { SqlCollectionContentsList } from "./sqlCollectionContentsList.component";
import { SqlCollectionList } from "./sqlCollectionList.component";
import { SqlDbInfo, SqlCollectionInfo } from "../../../../../sharedInterfaces/fabric";
import { useSqlExplorerStyles } from "./sqlExplorer.styles";

export const SqlExplorer = ({
    onSignIntoMicrosoftAccount,
    onSelectAccountId,
    onSelectTenantId,
    onSelectWorkspace,
    onSelectDatabase,
}: SqlExplorerProps) => {
    const sqlCollections = useConnectionDialogSelector((s) => s.sqlCollections);

    const sqlStyles = useSqlExplorerStyles();

    const [searchFilter, setSearchFilter] = useState<string>("");

    const [selectedCollectionId, setSelectedCollectionId] = useState<string | undefined>(undefined);

    const selectedCollection = useMemo(() => {
        if (sqlCollections.length === 0 || !selectedCollectionId) {
            return undefined;
        }

        return sqlCollections.find((w) => w.id === selectedCollectionId);
    }, [sqlCollections, selectedCollectionId]);

    function handleSignIntoMicrosoftAccount() {
        onSignIntoMicrosoftAccount();
    }

    function handleSelectAccountId(accountId: string) {
        onSelectAccountId(accountId);
    }

    function handleSelectTenantId(tenantId: string) {
        onSelectTenantId(tenantId);
    }

    function handleCollectionSelected(collection: SqlCollectionInfo) {
        setSelectedCollectionId(collection.id);
        onSelectWorkspace(collection);
    }

    function handleDatabaseSelected(database: SqlDbInfo) {
        onSelectDatabase(database);
    }
    function handleSearchValueChanged(searchValue: string) {
        setSearchFilter(searchValue);
    }

    return (
        <>
            <SqlExplorerHeader
                searchValue={searchFilter}
                onSignIntoMicrosoftAccount={handleSignIntoMicrosoftAccount}
                onSelectAccountId={handleSelectAccountId}
                onSelectTenantId={handleSelectTenantId}
                onSearchValueChanged={handleSearchValueChanged}
            />
            <div className={sqlStyles.workspaceExplorer}>
                <SqlCollectionList
                    workspaces={sqlCollections}
                    selectedWorkspace={selectedCollection}
                    onSelectWorkspace={handleCollectionSelected}
                />
                <SqlCollectionContentsList
                    selectedWorkspace={selectedCollection}
                    searchFilter={searchFilter}
                    onSelectDatabase={handleDatabaseSelected}
                />
            </div>
        </>
    );
};

export interface SqlExplorerProps {
    onSignIntoMicrosoftAccount: () => void;
    onSelectAccountId: (accountId: string) => void;
    onSelectTenantId: (tenantId: string) => void;
    onSelectWorkspace: (collection: SqlCollectionInfo) => void;
    onSelectDatabase: (database: SqlDbInfo) => void;
}
