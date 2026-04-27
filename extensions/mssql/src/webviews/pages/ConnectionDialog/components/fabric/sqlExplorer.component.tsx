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
import { Status } from "../../../../../sharedInterfaces/webview";

export const SqlExplorer = ({
    onSignIntoMicrosoftAccount,
    onSelectAccountId,
    onSelectTenantId,
    onSelectWorkspace,
    onSelectDatabase,
    workspaces: workspacesProp,
    workspacesLoadStatus,
    workspaceListLabel,
    workspaceSearchPlaceholder,
    noWorkspacesFoundMessage,
    loadingWorkspacesMessage,
    errorLoadingWorkspacesMessage,
    loadingDatabasesMessage,
    errorLoadingDatabasesMessage,
    noDatabasesInWorkspaceMessage,
    selectWorkspaceMessage,
    showTypeFilter,
    showResourceGroupColumn,
    favoritedIds,
    onToggleFavorite,
}: SqlExplorerProps) => {
    const sqlCollections = useConnectionDialogSelector((s) => s.sqlCollections);

    // Use prop override if provided, otherwise fall back to store
    const workspaces = workspacesProp ?? sqlCollections;

    const sqlStyles = useSqlExplorerStyles();

    const [searchFilter, setSearchFilter] = useState<string>("");

    const [selectedCollectionId, setSelectedCollectionId] = useState<string | undefined>(undefined);

    const selectedCollection = useMemo(() => {
        if (workspaces.length === 0 || !selectedCollectionId) {
            return undefined;
        }

        return workspaces.find((w) => w.id === selectedCollectionId);
    }, [workspaces, selectedCollectionId]);

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
                    workspaces={workspaces}
                    selectedWorkspace={selectedCollection}
                    onSelectWorkspace={handleCollectionSelected}
                    loadStatus={workspacesLoadStatus}
                    listLabel={workspaceListLabel}
                    searchPlaceholder={workspaceSearchPlaceholder}
                    noItemsFoundMessage={noWorkspacesFoundMessage}
                    loadingMessage={loadingWorkspacesMessage}
                    errorMessage={errorLoadingWorkspacesMessage}
                    favoritedIds={favoritedIds}
                    onToggleFavorite={onToggleFavorite}
                />
                <SqlCollectionContentsList
                    selectedWorkspace={selectedCollection}
                    searchFilter={searchFilter}
                    onSelectDatabase={handleDatabaseSelected}
                    loadStatus={workspacesLoadStatus}
                    selectWorkspaceMessage={selectWorkspaceMessage}
                    loadingWorkspacesMessage={loadingWorkspacesMessage}
                    errorLoadingWorkspacesMessage={errorLoadingWorkspacesMessage}
                    loadingDatabasesMessage={loadingDatabasesMessage}
                    errorLoadingDatabasesMessage={errorLoadingDatabasesMessage}
                    noDatabasesInWorkspaceMessage={noDatabasesInWorkspaceMessage}
                    showTypeFilter={showTypeFilter}
                    showResourceGroupColumn={showResourceGroupColumn}
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
    /** Override workspaces (instead of reading from store) */
    workspaces?: SqlCollectionInfo[];
    /** Override workspace list load status (instead of reading from store) */
    workspacesLoadStatus?: Status;
    /** aria-label for the workspace list */
    workspaceListLabel?: string;
    /** Placeholder for the workspace search input */
    workspaceSearchPlaceholder?: string;
    /** Message when no workspaces are found */
    noWorkspacesFoundMessage?: string;
    /** Message when no workspace is selected */
    selectWorkspaceMessage?: string;
    /** Message while workspace list is loading */
    loadingWorkspacesMessage?: string;
    /** Message on workspace list load error */
    errorLoadingWorkspacesMessage?: string;
    /** Message while databases/servers are loading (receives workspace displayName) */
    loadingDatabasesMessage?: (workspaceName?: string) => string;
    /** Message on database/server load error */
    errorLoadingDatabasesMessage?: string;
    /** Message when no databases/servers are found (receives workspace displayName) */
    noDatabasesInWorkspaceMessage?: (workspaceName?: string) => string;
    /** Whether to show the type filter menu button (default: true) */
    showTypeFilter?: boolean;
    /** Whether to show the Resource Group column (default: false) */
    showResourceGroupColumn?: boolean;
    /** IDs of favorited collections (sorted to top with filled star) */
    favoritedIds?: string[];
    /** Called when the user clicks the star for a collection */
    onToggleFavorite?: (collectionId: string) => void;
}
