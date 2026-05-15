/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useMemo, useRef, useState } from "react";
import { Label } from "@fluentui/react-components";
import { useConnectionDialogSelector } from "../../connectionDialogSelector";
import SqlExplorerHeader from "./sqlExplorerHeader.component";
import { SqlCollectionContentsList } from "./sqlCollectionContentsList.component";
import { SqlCollectionList } from "./sqlCollectionList.component";
import { SqlDbInfo, SqlCollectionInfo } from "../../../../../sharedInterfaces/fabric";
import { useSqlExplorerStyles } from "./sqlExplorer.styles";
import { ApiStatus, Status } from "../../../../../sharedInterfaces/webview";
import { locConstants as Loc } from "../../../../common/locConstants";

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
    expandableServers,
    favoritedIds,
    onToggleFavorite,
    title,
}: SqlExplorerProps) => {
    const fabricWorkspaces = useConnectionDialogSelector((s) => s.fabricWorkspaces);
    const fabricWorkspacesLoadStatus = useConnectionDialogSelector(
        (s) => s.fabricWorkspacesLoadStatus,
    );
    const loadingAzureTenantsStatus = useConnectionDialogSelector(
        (s) => s.loadingAzureTenantsStatus,
    );

    // Use prop override if provided, otherwise fall back to store
    const workspaces = workspacesProp ?? fabricWorkspaces;

    // When tenants are still loading, show a loading state in both panels
    // so the user doesn't see stale data from the previous account selection.
    const tenantsLoading = loadingAzureTenantsStatus === ApiStatus.Loading;
    const effectiveWorkspacesLoadStatus: Status = tenantsLoading
        ? { status: ApiStatus.Loading }
        : (workspacesLoadStatus ?? fabricWorkspacesLoadStatus);
    const effectiveLoadingMessage = tenantsLoading
        ? Loc.azure.loadingTenants
        : loadingWorkspacesMessage;

    const sqlStyles = useSqlExplorerStyles();

    const [searchFilter, setSearchFilter] = useState<string>("");
    const [selectedCollectionId, setSelectedCollectionId] = useState<string | undefined>(undefined);
    const [sidebarWidth, setSidebarWidth] = useState(250);

    const isDragging = useRef(false);
    const dragStartX = useRef(0);
    const dragStartWidth = useRef(0);

    function handleDragStart(e: React.MouseEvent) {
        isDragging.current = true;
        dragStartX.current = e.clientX;
        dragStartWidth.current = sidebarWidth;

        const onMouseMove = (ev: MouseEvent) => {
            if (!isDragging.current) return;
            const delta = ev.clientX - dragStartX.current;
            setSidebarWidth(Math.max(150, Math.min(500, dragStartWidth.current + delta)));
        };

        const onMouseUp = () => {
            isDragging.current = false;
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
        e.preventDefault();
    }

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
        <div className={sqlStyles.sqlExplorerWrapper}>
            {title && <Label className={sqlStyles.sqlExplorerTitle}>{title}</Label>}
            <SqlExplorerHeader
                searchValue={searchFilter}
                onSignIntoMicrosoftAccount={handleSignIntoMicrosoftAccount}
                onSelectAccountId={handleSelectAccountId}
                onSelectTenantId={handleSelectTenantId}
                onSearchValueChanged={handleSearchValueChanged}
            />
            <div className={sqlStyles.workspaceExplorer}>
                <SqlCollectionList
                    workspaces={tenantsLoading ? [] : workspaces}
                    selectedWorkspace={tenantsLoading ? undefined : selectedCollection}
                    onSelectWorkspace={handleCollectionSelected}
                    loadStatus={effectiveWorkspacesLoadStatus}
                    listLabel={workspaceListLabel}
                    searchPlaceholder={workspaceSearchPlaceholder}
                    noItemsFoundMessage={noWorkspacesFoundMessage}
                    loadingMessage={effectiveLoadingMessage}
                    errorMessage={errorLoadingWorkspacesMessage}
                    favoritedIds={favoritedIds}
                    onToggleFavorite={onToggleFavorite}
                    width={sidebarWidth}
                />
                <div className={sqlStyles.dragHandle} onMouseDown={handleDragStart} />
                <SqlCollectionContentsList
                    selectedWorkspace={tenantsLoading ? undefined : selectedCollection}
                    searchFilter={searchFilter}
                    onSelectDatabase={handleDatabaseSelected}
                    loadStatus={effectiveWorkspacesLoadStatus}
                    selectWorkspaceMessage={selectWorkspaceMessage}
                    loadingWorkspacesMessage={effectiveLoadingMessage}
                    errorLoadingWorkspacesMessage={errorLoadingWorkspacesMessage}
                    loadingDatabasesMessage={loadingDatabasesMessage}
                    errorLoadingDatabasesMessage={errorLoadingDatabasesMessage}
                    noDatabasesInWorkspaceMessage={noDatabasesInWorkspaceMessage}
                    showTypeFilter={showTypeFilter}
                    showResourceGroupColumn={showResourceGroupColumn}
                    expandableServers={expandableServers}
                />
            </div>
        </div>
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
    /**
     * When true, each server entry is rendered as an expandable parent row whose
     * children are the actual databases on that server. Server rows toggle expansion
     * on click and are not selectable; only the revealed database rows are selectable.
     * (default: false)
     */
    expandableServers?: boolean;
    /** Optional title label displayed above the explorer content */
    title?: string;
    /** IDs of favorited collections (sorted to top with filled star) */
    favoritedIds?: string[];
    /** Called when the user clicks the star for a collection */
    onToggleFavorite?: (collectionId: string) => void;
}
