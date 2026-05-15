/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    DataGridHeader,
    DataGridHeaderCell,
    TableColumnDefinition,
    createTableColumn,
    Text,
    Spinner,
    TableRowData,
    Label,
    TableColumnSizingOptions,
    Menu,
    MenuTrigger,
    Tooltip,
    MenuButton,
    MenuList,
    MenuPopover,
    MenuItemRadio,
    MenuCheckedValueChangeEvent,
    MenuCheckedValueChangeData,
} from "@fluentui/react-components";
import {
    DataGridBody,
    DataGrid,
    DataGridRow,
    DataGridCell,
} from "@fluentui-contrib/react-data-grid-react-window";
import {
    SqlDbInfo,
    SqlCollectionInfo,
    SqlArtifactTypes,
} from "../../../../../sharedInterfaces/fabric";
import { useState, useMemo } from "react";
import {
    ErrorCircleRegular,
    ChevronRight16Regular,
    ChevronDown16Regular,
    DatabaseRegular,
} from "@fluentui/react-icons";
import { locConstants as Loc } from "../../../../common/locConstants";
import { KeyCode } from "../../../../common/keys";
import { useSqlExplorerStyles } from "./sqlExplorer.styles";
import { ApiStatus, ColorThemeKind, Status } from "../../../../../sharedInterfaces/webview";
import { themeType } from "../../../../common/utils";
import { FilterIcon } from "../../../../common/icons/filter";
import { useConnectionDialogSelector } from "../../connectionDialogSelector";
import { useVscodeWebview } from "../../../../common/vscodeWebviewProvider";

export const SqlCollectionContentsList = ({
    onSelectDatabase,
    selectedWorkspace,
    searchFilter = "",
    loadStatus: loadStatusProp,
    showTypeFilter = true,
    showResourceGroupColumn = false,
    expandableServers = false,
    selectWorkspaceMessage,
    loadingWorkspacesMessage,
    errorLoadingWorkspacesMessage,
    loadingDatabasesMessage,
    errorLoadingDatabasesMessage,
    noDatabasesInWorkspaceMessage,
}: SqlCollectionContentsListProps) => {
    const styles = useSqlExplorerStyles();
    const fabricWorkspacesLoadStatus = useConnectionDialogSelector(
        (s) => s.fabricWorkspacesLoadStatus,
    );
    const { themeKind: theme } = useVscodeWebview();
    const [selectedRowId, setSelectedRowId] = useState<string | undefined>(undefined);
    const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>(
        ArtifactTypeFilter.ShowAll,
    );
    const [expandedServerIds, setExpandedServerIds] = useState<Set<string>>(new Set());

    // Use prop override if provided, otherwise fall back to store
    const effectiveCollectionsLoadStatus = loadStatusProp ?? fabricWorkspacesLoadStatus;

    //#region Hooks

    // Hook to update the list of items based on selected collection and search query
    const items = useMemo(() => {
        if (!selectedWorkspace?.databases) {
            return [];
        }

        const servers = selectedWorkspace.databases;
        const q = searchFilter.trim().toLowerCase();

        if (expandableServers) {
            const result: SqlDbGridItem[] = [];
            for (const s of servers) {
                const serverNameMatch =
                    !q ||
                    s.displayName.toLowerCase().includes(q) ||
                    (s.resourceGroup?.toLowerCase().includes(q) ?? false);
                const matchingDbs = q
                    ? s.databases.filter((db) => db.toLowerCase().includes(q))
                    : s.databases;

                if (!serverNameMatch && matchingDbs.length === 0) {
                    continue;
                }

                const isExpanded =
                    expandedServerIds.has(s.id) ||
                    (q.length > 0 && matchingDbs.length > 0 && !serverNameMatch);

                result.push({
                    ...s,
                    typeDisplayName: getTypeDisplayName(s.type),
                    isServerRow: true,
                    isExpanded,
                });

                if (isExpanded) {
                    const dbsToShow = serverNameMatch ? s.databases : matchingDbs;
                    const sortedDbs = [...dbsToShow].sort((a, b) => {
                        if (a.toLowerCase() === "master") return -1;
                        if (b.toLowerCase() === "master") return 1;
                        return a.localeCompare(b);
                    });
                    for (const dbName of sortedDbs) {
                        result.push({
                            id: `${s.id}::${dbName}`,
                            server: s.server,
                            displayName: dbName,
                            databases: [dbName],
                            type: s.type,
                            typeDisplayName: Loc.connectionDialog.databaseLabel,
                            collectionId: s.collectionId,
                            collectionName: s.collectionName,
                            tenantId: s.tenantId,
                            resourceGroup: s.resourceGroup,
                            isDatabaseRow: true,
                            parentServer: s,
                        });
                    }
                }
            }
            return result;
        }

        // Flat mode (Fabric / default)
        let result: SqlDbGridItem[] = [];
        servers.forEach((db) => {
            result.push({
                ...db,
                typeDisplayName: getTypeDisplayName(db.type),
            });
        });

        if (selectedTypeFilter !== ArtifactTypeFilter.ShowAll) {
            result = result.filter((item) => item.type === selectedTypeFilter);
        }

        if (q) {
            result = result.filter(
                (item) =>
                    item.displayName.toLowerCase().includes(q) ||
                    item.typeDisplayName.toLowerCase().includes(q) ||
                    (item.resourceGroup?.toLowerCase().includes(q) ?? false),
            );
        }

        return result;
    }, [
        selectedWorkspace?.id,
        selectedWorkspace?.loadStatus,
        selectedWorkspace?.databases,
        searchFilter,
        selectedTypeFilter,
        expandableServers,
        expandedServerIds,
    ]);

    // Memo for creating the column definitions when the component first mounts
    const columns = useMemo((): TableColumnDefinition<SqlDbGridItem>[] => {
        const cols: TableColumnDefinition<SqlDbGridItem>[] = [
            createTableColumn<SqlDbGridItem>({
                columnId: "name",
                compare: (a, b) => {
                    return a.displayName.localeCompare(b.displayName);
                },
                renderHeaderCell: () => `${Loc.connectionDialog.nameColumnHeader}`,
                renderCell: (item) => (
                    <DataGridCell>
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                width: "100%",
                                minWidth: 0,
                                paddingLeft: item.isDatabaseRow ? "28px" : 0,
                            }}>
                            {item.isServerRow ? (
                                item.isExpanded ? (
                                    <ChevronDown16Regular
                                        style={{ marginRight: "4px", flexShrink: 0 }}
                                    />
                                ) : (
                                    <ChevronRight16Regular
                                        style={{ marginRight: "4px", flexShrink: 0 }}
                                    />
                                )
                            ) : null}
                            {item.isDatabaseRow ? (
                                <DatabaseRegular
                                    style={{
                                        width: "20px",
                                        height: "20px",
                                        marginRight: "8px",
                                        flexShrink: 0,
                                    }}
                                />
                            ) : (
                                <img
                                    src={getItemIcon(item.type, theme)}
                                    alt={item.typeDisplayName}
                                    style={{
                                        width: "20px",
                                        height: "20px",
                                        marginRight: "8px",
                                        flexShrink: 0,
                                    }}
                                />
                            )}
                            <Text truncate className={styles.hideTextOverflowCell}>
                                {item.displayName}
                            </Text>
                        </div>
                    </DataGridCell>
                ),
            }),
        ];

        if (!expandableServers) {
            cols.push(
                createTableColumn<SqlDbGridItem>({
                    columnId: "type",
                    compare: (a, b) => {
                        return a.typeDisplayName.localeCompare(b.typeDisplayName);
                    },
                    renderHeaderCell: () =>
                        showTypeFilter ? (
                            <div>
                                {Loc.connectionDialog.typeColumnHeader}
                                <Menu>
                                    <MenuTrigger>
                                        <Tooltip
                                            content={Loc.connectionDialog.filterByType}
                                            relationship="label">
                                            <MenuButton
                                                icon={<FilterIcon />}
                                                appearance="transparent"
                                                onClick={(e) => e.stopPropagation()}
                                            />
                                        </Tooltip>
                                    </MenuTrigger>
                                    <MenuPopover onClick={(e) => e.stopPropagation()}>
                                        <MenuList
                                            checkedValues={{ sqlType: [selectedTypeFilter] }}
                                            onCheckedValueChange={handleFilterOptionChanged}>
                                            <MenuItemRadio
                                                name="sqlType"
                                                value={ArtifactTypeFilter.ShowAll}>
                                                {Loc.connectionDialog.showAll}
                                            </MenuItemRadio>
                                            <MenuItemRadio
                                                name="sqlType"
                                                value={ArtifactTypeFilter.SqlDatabase}>
                                                {Loc.connectionDialog.sqlDatabase}
                                            </MenuItemRadio>
                                            <MenuItemRadio
                                                name="sqlType"
                                                value={ArtifactTypeFilter.SqlAnalyticsEndpoint}>
                                                {Loc.connectionDialog.sqlAnalyticsEndpoint}
                                            </MenuItemRadio>
                                        </MenuList>
                                    </MenuPopover>
                                </Menu>
                            </div>
                        ) : (
                            `${Loc.connectionDialog.typeColumnHeader}`
                        ),
                    renderCell: (item) => (
                        <DataGridCell>
                            <Text truncate className={styles.hideTextOverflowCell}>
                                {item.typeDisplayName}
                            </Text>
                        </DataGridCell>
                    ),
                }),
            );
        }

        if (showResourceGroupColumn) {
            cols.push(
                createTableColumn<SqlDbGridItem>({
                    columnId: "resourceGroup",
                    compare: (a, b) => {
                        return (a.resourceGroup ?? "").localeCompare(b.resourceGroup ?? "");
                    },
                    renderHeaderCell: () => `${Loc.connectionDialog.resourceGroupColumnHeader}`,
                    renderCell: (item) => (
                        <DataGridCell>
                            <Text truncate className={styles.hideTextOverflowCell}>
                                {item.isDatabaseRow ? "" : (item.resourceGroup ?? "")}
                            </Text>
                        </DataGridCell>
                    ),
                }),
            );
        }

        return cols;
    }, [theme, selectedTypeFilter, showTypeFilter, showResourceGroupColumn, expandableServers]);

    function handleServerSelected(database: SqlDbGridItem) {
        setSelectedRowId(database.id);
        onSelectDatabase(database);
    }

    function toggleServerExpanded(serverId: string) {
        setExpandedServerIds((prev) => {
            const next = new Set(prev);
            if (next.has(serverId)) {
                next.delete(serverId);
            } else {
                next.add(serverId);
            }
            return next;
        });
    }

    function handleRowActivated(item: SqlDbGridItem) {
        if (item.isServerRow) {
            toggleServerExpanded(item.id);
            return;
        }
        // Database row (or flat-mode row): select it
        handleServerSelected(item);
    }

    function handleFilterOptionChanged(
        _event: MenuCheckedValueChangeEvent,
        data: MenuCheckedValueChangeData,
    ) {
        setSelectedTypeFilter(data.checkedItems[0]);
    }

    //#endregion Hooks

    //#region Render helper methods

    const renderGridContent = (): React.ReactNode => {
        // Workspace list states
        if (effectiveCollectionsLoadStatus.status === ApiStatus.NotStarted) {
            return undefined;
        }

        if (effectiveCollectionsLoadStatus.status === ApiStatus.Loading) {
            return renderLoadingWorkspaces();
        }

        if (effectiveCollectionsLoadStatus.status === ApiStatus.Error) {
            return renderWorkspacesError();
        }

        if (effectiveCollectionsLoadStatus.status === ApiStatus.Loaded && !selectedWorkspace) {
            return renderNoSelectedWorkspace(effectiveCollectionsLoadStatus.message);
        }

        // Workspace selection states
        if (!selectedWorkspace || selectedWorkspace.loadStatus.status === ApiStatus.NotStarted) {
            // should only hit this state between renders while the state settles
            return undefined;
        }

        if (selectedWorkspace.loadStatus.status === ApiStatus.Loading) {
            return renderLoadingDatabases();
        }

        if (selectedWorkspace.loadStatus.status === ApiStatus.Error) {
            return renderDatabasesError();
        }

        if (selectedWorkspace.loadStatus.status === ApiStatus.Loaded) {
            if (selectedWorkspace.databases.length === 0) {
                return renderNoDatabasesFound();
            } else {
                return renderDataGrid();
            }
        }

        return (
            <>
                {/* Debugging information; not expected to be seen by user */}
                <Label>Unexpected state:</Label>
                <Label>SqlCollectionsLoadStatus: {effectiveCollectionsLoadStatus.status}</Label>
                <Label>SelectedWorkspace: {selectedWorkspace?.id}</Label>
                <Label>SelectedWorkspace.Status: {selectedWorkspace?.loadStatus.status}</Label>
                <Label>SelectedWorkspace.Databases: {selectedWorkspace?.databases.length}</Label>
            </>
        );
    };

    const renderLoadingWorkspaces = () => (
        <div className={styles.workspaceContentMessageContainer} role="status" aria-live="polite">
            <Spinner size="medium" />
            <Text className={styles.messageText}>
                {loadingWorkspacesMessage ?? Loc.connectionDialog.loadingCollections}
            </Text>
        </div>
    );

    const renderWorkspacesError = () => (
        <div className={styles.workspaceContentMessageContainer} role="alert" aria-live="polite">
            <ErrorCircleRegular className={styles.errorIcon} />
            <Text className={styles.messageText}>
                {effectiveCollectionsLoadStatus.message ??
                    errorLoadingWorkspacesMessage ??
                    Loc.connectionDialog.errorLoadingCollections}
            </Text>
        </div>
    );

    const renderNoSelectedWorkspace = (message: string | undefined) => (
        <div className={styles.workspaceContentMessageContainer} role="alert" aria-live="polite">
            {message ??
                selectWorkspaceMessage ??
                Loc.connectionDialog.selectACollectionToViewDatabases}
        </div>
    );

    const renderLoadingDatabases = () => (
        <div className={styles.workspaceContentMessageContainer} role="status" aria-live="polite">
            <Spinner size="medium" />
            <Text className={styles.messageText}>
                {loadingDatabasesMessage
                    ? loadingDatabasesMessage(selectedWorkspace?.displayName)
                    : Loc.connectionDialog.loadingDatabasesInCollection(
                          selectedWorkspace?.displayName,
                      )}
            </Text>
        </div>
    );

    const renderDatabasesError = () => (
        <div className={styles.workspaceContentMessageContainer} role="alert" aria-live="polite">
            <ErrorCircleRegular className={styles.errorIcon} />
            <Text className={styles.messageText}>
                {selectedWorkspace!.loadStatus.message ??
                    errorLoadingDatabasesMessage ??
                    Loc.connectionDialog.errorLoadingCollectionDatabases}
            </Text>
        </div>
    );

    const renderNoDatabasesFound = () => (
        <div className={styles.workspaceContentMessageContainer} role="alert" aria-live="polite">
            {noDatabasesInWorkspaceMessage
                ? noDatabasesInWorkspaceMessage(selectedWorkspace?.displayName)
                : Loc.connectionDialog.noDatabasesFoundInCollection(selectedWorkspace?.displayName)}
        </div>
    );

    const renderDataGrid = () => (
        <DataGrid
            items={items}
            columns={columns}
            getRowId={(item: SqlDbGridItem) => item.id}
            size="small"
            focusMode="composite"
            resizableColumns
            columnSizingOptions={
                showResourceGroupColumn ? columnSizingOptionsWithResourceGroup : columnSizingOptions
            }
            sortable={!expandableServers}
            style={{
                flexGrow: 1,
                height: "100%",
                width: "100%",
                minWidth: 0,
                overflow: "hidden",
            }}>
            <DataGridHeader>
                <DataGridRow>
                    {({ renderHeaderCell }: { renderHeaderCell: () => React.ReactNode }) => (
                        <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>
                    )}
                </DataGridRow>
            </DataGridHeader>
            <DataGridBody<SqlDbGridItem> itemSize={30} height={360} width={"100%"}>
                {renderRow}
            </DataGridBody>
        </DataGrid>
    );

    function renderRow(
        { item, rowId }: TableRowData<SqlDbGridItem>,
        style: React.CSSProperties,
    ): React.ReactNode {
        const isSelectable = !item.isServerRow;
        const isSelected = isSelectable && selectedRowId === item.id;
        return (
            <DataGridRow<SqlDbGridItem>
                key={rowId}
                className={isSelected ? styles.selectedDataGridRow : undefined}
                style={style}
                onClick={() => {
                    handleRowActivated(item);
                }}
                onKeyDown={(e: React.KeyboardEvent) => {
                    if (e.code === KeyCode.Enter || e.code === KeyCode.Space) {
                        handleRowActivated(item);
                        e.preventDefault();
                    }
                }}>
                {({ renderCell }: { renderCell: (item: SqlDbGridItem) => React.ReactNode }) => (
                    <>{renderCell(item)}</>
                )}
            </DataGridRow>
        );
    }

    //#endregion Helper Methods

    //#region Icons

    function getItemIcon(artifactType: string, theme: ColorThemeKind): string {
        switch (artifactType) {
            case SqlArtifactTypes.SqlDatabase:
                return sqlDatabaseIcon(theme);
            case SqlArtifactTypes.SqlAnalyticsEndpoint:
                return sqlAnalyticsEndpointIcon(theme);
            case "AzureSqlServer":
                return sqlDatabaseIcon(theme);
            default:
                console.error(`Unknown artifact type for getItemIcon(): ${artifactType}`);
                return sqlDatabaseIcon(theme);
        }
    }

    function sqlDatabaseIcon(colorTheme: ColorThemeKind) {
        const theme = themeType(colorTheme);
        const saveIcon =
            theme === "dark"
                ? require("../../../../media/sqlDb-inverse.svg")
                : require("../../../../media/sqlDb.svg");
        return saveIcon;
    }

    function sqlAnalyticsEndpointIcon(colorTheme: ColorThemeKind) {
        const theme = themeType(colorTheme);
        const saveIcon =
            theme === "dark"
                ? require("../../../../media/dataWarehouse-inverse.svg")
                : require("../../../../media/dataWarehouse.svg");
        return saveIcon;
    }

    //#endregion

    return <div className={styles.workspaceContentList}>{renderGridContent()}</div>;
};

export function getTypeDisplayName(artifactType: string): string {
    switch (artifactType) {
        case SqlArtifactTypes.SqlDatabase:
            return Loc.connectionDialog.sqlDatabase;
        case SqlArtifactTypes.SqlAnalyticsEndpoint:
            return Loc.connectionDialog.sqlAnalyticsEndpoint;
        case "AzureSqlServer":
            return Loc.connectionDialog.azureSqlServer;
        default:
            console.error(`Unknown artifact type for getTypeDisplayName(): ${artifactType}`);
            return artifactType;
    }
}

const ArtifactTypeFilter = {
    ShowAll: "ShowAll",
    ...SqlArtifactTypes,
} as const;

export interface SqlCollectionContentsListProps {
    onSelectDatabase: (database: SqlDbInfo) => void;
    selectedWorkspace: SqlCollectionInfo | undefined;
    searchFilter?: string;
    typeFilter?: string[];
    /** Override the store's fabricWorkspacesLoadStatus */
    loadStatus?: Status;
    /** Whether to show the type filter menu button (default: true) */
    showTypeFilter?: boolean;
    /** Whether to show the Resource Group column (default: false) */
    showResourceGroupColumn?: boolean;
    /**
     * When true, each "database" (treated as a server in this mode) is rendered as an
     * expandable parent row whose children are the actual databases on that server.
     * Server rows toggle expansion on click and are not selectable; only the
     * revealed database rows are selectable. (default: false)
     */
    expandableServers?: boolean;
    /** Message to show when no workspace is selected */
    selectWorkspaceMessage?: string;
    /** Message to show while workspace list is loading */
    loadingWorkspacesMessage?: string;
    /** Message to show on workspace list load error */
    errorLoadingWorkspacesMessage?: string;
    /** Message to show while databases/servers are loading (receives workspace displayName) */
    loadingDatabasesMessage?: (workspaceName?: string) => string;
    /** Message to show on database/server load error */
    errorLoadingDatabasesMessage?: string;
    /** Message to show when no databases/servers are found (receives workspace displayName) */
    noDatabasesInWorkspaceMessage?: (workspaceName?: string) => string;
}

interface SqlDbGridItem extends SqlDbInfo {
    typeDisplayName: string;
    /** Expandable-mode: this row represents a server (parent). */
    isServerRow?: boolean;
    /** Expandable-mode: this row represents a single database (child). */
    isDatabaseRow?: boolean;
    /** Expandable-mode: whether the server row is currently expanded. */
    isExpanded?: boolean;
    /** Expandable-mode: backreference to the parent server's SqlDbInfo. */
    parentServer?: SqlDbInfo;
}

const columnSizingOptions: TableColumnSizingOptions = {
    name: {
        minWidth: 80,
        defaultWidth: 120,
    },
    type: {
        minWidth: 80,
        defaultWidth: 110,
    },
};

const columnSizingOptionsWithResourceGroup: TableColumnSizingOptions = {
    name: {
        minWidth: 80,
        defaultWidth: 120,
    },
    type: {
        minWidth: 80,
        defaultWidth: 110,
    },
    resourceGroup: {
        minWidth: 80,
        defaultWidth: 120,
    },
};
