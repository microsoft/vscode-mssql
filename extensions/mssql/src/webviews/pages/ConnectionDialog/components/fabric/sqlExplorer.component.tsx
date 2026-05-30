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
    onSelectCollection,
    onSelectDatabase,
    collections: collectionsProp,
    collectionsLoadStatus,
    strings,
    showTypeFilter,
    showResourceGroupColumn,
    expandableServers,
    favoritedIds,
    onToggleFavorite,
    onSignIntoTenant,
}: SqlExplorerProps) => {
    const fabricWorkspaces = useConnectionDialogSelector((s) => s.fabricWorkspaces);
    const fabricWorkspacesLoadStatus = useConnectionDialogSelector(
        (s) => s.fabricWorkspacesLoadStatus,
    );
    const loadingAzureTenantsStatus = useConnectionDialogSelector(
        (s) => s.loadingAzureTenantsStatus,
    );
    const notSignedInTenant = useConnectionDialogSelector((s) => s.notSignedInTenant);

    // Use prop override if provided, otherwise fall back to store
    const collections = collectionsProp ?? fabricWorkspaces;

    // When tenants are still loading, show a loading state in both panels
    // so the user doesn't see stale data from the previous account selection.
    const tenantsLoading = loadingAzureTenantsStatus === ApiStatus.Loading;

    const notSignedInErrorMessage = notSignedInTenant
        ? Loc.connectionDialog.notSignedIntoTenant(notSignedInTenant.name)
        : undefined;

    const effectiveCollectionsLoadStatus: Status = tenantsLoading
        ? { status: ApiStatus.Loading }
        : notSignedInTenant
          ? { status: ApiStatus.Error }
          : (collectionsLoadStatus ?? fabricWorkspacesLoadStatus);
    const effectiveLoadingMessage = tenantsLoading
        ? Loc.azure.loadingTenants
        : strings?.loadingCollectionsMessage;

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
        if (collections.length === 0 || !selectedCollectionId) {
            return undefined;
        }

        return collections.find((w) => w.id === selectedCollectionId);
    }, [collections, selectedCollectionId]);

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
        onSelectCollection(collection);
    }

    function handleDatabaseSelected(database: SqlDbInfo) {
        onSelectDatabase(database);
    }
    function handleSearchValueChanged(searchValue: string) {
        setSearchFilter(searchValue);
    }

    return (
        <div className={sqlStyles.sqlExplorerWrapper}>
            {strings?.title && (
                <Label className={sqlStyles.sqlExplorerTitle}>{strings.title}</Label>
            )}
            <SqlExplorerHeader
                searchValue={searchFilter}
                onSignIntoMicrosoftAccount={handleSignIntoMicrosoftAccount}
                onSelectAccountId={handleSelectAccountId}
                onSelectTenantId={handleSelectTenantId}
                onSearchValueChanged={handleSearchValueChanged}
            />
            <div className={sqlStyles.workspaceExplorer}>
                <SqlCollectionList
                    workspaces={tenantsLoading || notSignedInTenant ? [] : collections}
                    selectedWorkspace={
                        tenantsLoading || notSignedInTenant ? undefined : selectedCollection
                    }
                    onSelectWorkspace={handleCollectionSelected}
                    loadStatus={effectiveCollectionsLoadStatus}
                    listLabel={strings?.collectionListLabel}
                    searchPlaceholder={strings?.collectionSearchPlaceholder}
                    noItemsFoundMessage={strings?.noCollectionsFoundMessage}
                    loadingMessage={effectiveLoadingMessage}
                    errorMessage={
                        notSignedInErrorMessage ?? strings?.errorLoadingCollectionsMessage
                    }
                    favoritedIds={favoritedIds}
                    onToggleFavorite={onToggleFavorite}
                    width={sidebarWidth}
                    collapseLabel={strings?.collapseCollectionListLabel}
                    expandLabel={strings?.expandCollectionListLabel}
                />
                <div className={sqlStyles.dragHandle} onMouseDown={handleDragStart} />
                <SqlCollectionContentsList
                    selectedWorkspace={
                        tenantsLoading || notSignedInTenant ? undefined : selectedCollection
                    }
                    searchFilter={searchFilter}
                    onSelectDatabase={handleDatabaseSelected}
                    loadStatus={effectiveCollectionsLoadStatus}
                    selectCollectionMessage={strings?.selectCollectionMessage}
                    loadingCollectionsMessage={effectiveLoadingMessage}
                    errorLoadingCollectionsMessage={
                        notSignedInErrorMessage ?? strings?.errorLoadingCollectionsMessage
                    }
                    loadingDatabasesMessage={strings?.loadingDatabasesMessage}
                    errorLoadingDatabasesMessage={strings?.errorLoadingDatabasesMessage}
                    noDatabasesInCollectionMessage={strings?.noDatabasesInCollectionMessage}
                    showTypeFilter={showTypeFilter}
                    showResourceGroupColumn={showResourceGroupColumn}
                    expandableServers={expandableServers}
                    onSignIntoTenant={notSignedInTenant ? onSignIntoTenant : undefined}
                />
            </div>
        </div>
    );
};

export interface SqlExplorerStrings {
    /** Optional title label displayed above the explorer content */
    title?: string;
    /** aria-label for the collection list */
    collectionListLabel?: string;
    /** Placeholder for the collection search input */
    collectionSearchPlaceholder?: string;
    /** Message when no collections are found */
    noCollectionsFoundMessage?: string;
    /** Message when no collection is selected */
    selectCollectionMessage?: string;
    /** Message while collection list is loading */
    loadingCollectionsMessage?: string;
    /** Message on collection list load error */
    errorLoadingCollectionsMessage?: string;
    /** Message while databases/servers are loading (receives collection displayName) */
    loadingDatabasesMessage?: (collectionName?: string) => string;
    /** Message on database/server load error */
    errorLoadingDatabasesMessage?: string;
    /** Message when no databases/servers are found (receives collection displayName) */
    noDatabasesInCollectionMessage?: (collectionName?: string) => string;
    /** aria-label/title for the collapse sidebar button */
    collapseCollectionListLabel?: string;
    /** aria-label/title for the expand sidebar button */
    expandCollectionListLabel?: string;
}

export interface SqlExplorerProps {
    /** Override collections (instead of reading from store) */
    collections?: SqlCollectionInfo[];
    /** Override collection list load status (instead of reading from store) */
    collectionsLoadStatus?: Status;
    /** IDs of favorited collections (sorted to top with filled star) */
    favoritedIds?: string[];
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
    onSignIntoMicrosoftAccount: () => void;
    onSelectAccountId: (accountId: string) => void;
    onSelectTenantId: (tenantId: string) => void;
    onSelectCollection: (collection: SqlCollectionInfo) => void;
    onSelectDatabase: (database: SqlDbInfo) => void;
    /** Called when the user clicks the star for a collection */
    onToggleFavorite?: (collectionId: string) => void;
    /** Called when the user clicks "Sign in" from the not-signed-in error state */
    onSignIntoTenant?: () => void;
    /** UI strings bundle */
    strings: SqlExplorerStrings;
}
