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
    FabricSqlDbInfo,
    FabricWorkspaceInfo,
    SqlArtifactTypes,
} from "../../../../../sharedInterfaces/fabric";
import { useState, useMemo } from "react";
import { ErrorCircleRegular } from "@fluentui/react-icons";
import { locConstants as Loc } from "../../../../common/locConstants";
import { Keys } from "../../../../common/keys";
import { useFabricExplorerStyles } from "./fabricExplorer.styles";
import { ApiStatus, ColorThemeKind, Status } from "../../../../../sharedInterfaces/webview";
import { themeType } from "../../../../common/utils";

export const FabricWorkspaceContentsList = ({
    onSelectDatabase,
    fabricWorkspacesLoadStatus,
    selectedWorkspace,
    searchFilter = "",
    theme,
}: WorkspaceContentsList) => {
    const styles = useFabricExplorerStyles();
    const [selectedRowId, setSelectedRowId] = useState<string | undefined>(undefined);
    const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>(
        ArtifactTypeFilter.ShowAll,
    );

    //#region Hooks

    // Hook to update the list of items based on selected workspace and search query
    const items = useMemo(() => {
        if (!selectedWorkspace?.databases) {
            return [];
        }

        let result: FabricSqlGridItem[] = [];
        if (selectedWorkspace?.databases && selectedWorkspace.databases.length > 0) {
            selectedWorkspace.databases.forEach((db) => {
                result.push({
                    ...db,
                    typeDisplayName: getTypeDisplayName(db.type),
                });
            });
        }

        if (selectedTypeFilter !== ArtifactTypeFilter.ShowAll) {
            result = result.filter((item) => item.type === selectedTypeFilter);
        }

        if (searchFilter.trim()) {
            const searchTerm = searchFilter.toLowerCase();
            result = result.filter(
                (item) =>
                    item.displayName.toLowerCase().includes(searchTerm) ||
                    item.typeDisplayName.toLowerCase().includes(searchTerm),
            );
        }

        return result;
    }, [selectedWorkspace?.id, selectedWorkspace?.loadStatus, searchFilter, selectedTypeFilter]);

    // Memo for creating the column definitions when the component first mounts
    const columns = useMemo(
        (): TableColumnDefinition<FabricSqlGridItem>[] => [
            createTableColumn<FabricSqlGridItem>({
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
                            }}>
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
                            <Text truncate className={styles.hideTextOverflowCell}>
                                {item.displayName}
                            </Text>
                        </div>
                    </DataGridCell>
                ),
            }),
            createTableColumn<FabricSqlGridItem>({
                columnId: "type",
                compare: (a, b) => {
                    return a.typeDisplayName.localeCompare(b.typeDisplayName);
                },
                renderHeaderCell: () => (
                    <div>
                        {Loc.connectionDialog.typeColumnHeader}
                        <Menu>
                            <MenuTrigger>
                                <Tooltip
                                    content={Loc.connectionDialog.filterByType}
                                    relationship="label">
                                    <MenuButton
                                        icon={
                                            <img
                                                src={filterIcon(theme)}
                                                alt={Loc.connectionDialog.filter}
                                                className={styles.filterIcon}
                                            />
                                        }
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
                ),
                renderCell: (item) => (
                    <DataGridCell>
                        <Text truncate className={styles.hideTextOverflowCell}>
                            {item.typeDisplayName}
                        </Text>
                    </DataGridCell>
                ),
            }),
        ],
        [theme, selectedTypeFilter],
    );

    function handleServerSelected(database: FabricSqlGridItem) {
        setSelectedRowId(database.id);
        onSelectDatabase(database);
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
        if (fabricWorkspacesLoadStatus.status === ApiStatus.NotStarted) {
            return undefined;
        }

        if (fabricWorkspacesLoadStatus.status === ApiStatus.Loading) {
            return renderLoadingWorkspaces();
        }

        if (fabricWorkspacesLoadStatus.status === ApiStatus.Error) {
            return renderWorkspacesError();
        }

        if (fabricWorkspacesLoadStatus.status === ApiStatus.Loaded && !selectedWorkspace) {
            return renderNoSelectedWorkspace(fabricWorkspacesLoadStatus.message);
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
                <Label>FabricWorkspaceLoadStatus: {fabricWorkspacesLoadStatus.status}</Label>
                <Label>SelectedWorkspace: {selectedWorkspace?.id}</Label>
                <Label>SelectedWorkspace.Status: {selectedWorkspace?.loadStatus.status}</Label>
                <Label>SelectedWorkspace.Databases: {selectedWorkspace?.databases.length}</Label>
            </>
        );
    };

    const renderLoadingWorkspaces = () => (
        <div className={styles.workspaceContentMessageContainer} role="status" aria-live="polite">
            <Spinner size="medium" />
            <Text className={styles.messageText}>{Loc.connectionDialog.loadingWorkspaces}</Text>
        </div>
    );

    const renderWorkspacesError = () => (
        <div className={styles.workspaceContentMessageContainer} role="alert" aria-live="polite">
            <ErrorCircleRegular className={styles.errorIcon} />
            <Text className={styles.messageText}>
                {fabricWorkspacesLoadStatus.message || Loc.connectionDialog.errorLoadingWorkspaces}
            </Text>
        </div>
    );

    const renderNoSelectedWorkspace = (message: string | undefined) => (
        <div className={styles.workspaceContentMessageContainer} role="alert" aria-live="polite">
            {message || Loc.connectionDialog.selectAWorkspaceToViewDatabases}
        </div>
    );

    const renderLoadingDatabases = () => (
        <div className={styles.workspaceContentMessageContainer} role="status" aria-live="polite">
            <Spinner size="medium" />
            <Text className={styles.messageText}>
                {Loc.connectionDialog.loadingDatabasesInWorkspace(selectedWorkspace?.displayName)}
            </Text>
        </div>
    );

    const renderDatabasesError = () => (
        <div className={styles.workspaceContentMessageContainer} role="alert" aria-live="polite">
            <ErrorCircleRegular className={styles.errorIcon} />
            <Text className={styles.messageText}>
                {selectedWorkspace!.loadStatus.message ||
                    Loc.connectionDialog.errorLoadingDatabases}
            </Text>
        </div>
    );

    const renderNoDatabasesFound = () => (
        <div className={styles.workspaceContentMessageContainer} role="alert" aria-live="polite">
            {Loc.connectionDialog.noDatabasesFoundInWorkspace(selectedWorkspace?.displayName)}
        </div>
    );

    const renderDataGrid = () => (
        <DataGrid
            items={items}
            columns={columns}
            getRowId={(item: FabricSqlGridItem) => item.id}
            size="small"
            focusMode="composite"
            resizableColumns
            columnSizingOptions={columnSizingOptions}
            sortable
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
            <DataGridBody<FabricSqlGridItem> itemSize={30} height={360} width={"100%"}>
                {renderRow}
            </DataGridBody>
        </DataGrid>
    );

    function renderRow(
        { item, rowId }: TableRowData<FabricSqlGridItem>,
        style: React.CSSProperties,
    ): React.ReactNode {
        return (
            <DataGridRow<FabricSqlGridItem>
                key={rowId}
                className={selectedRowId === item.id ? styles.selectedDataGridRow : undefined}
                style={style}
                onClick={() => {
                    handleServerSelected(item);
                }}
                onKeyDown={(e: React.KeyboardEvent) => {
                    if (e.key === Keys.Enter || e.key === Keys.Space) {
                        handleServerSelected(item);
                        e.preventDefault();
                    }
                }}>
                {({ renderCell }: { renderCell: (item: FabricSqlGridItem) => React.ReactNode }) => (
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

    function filterIcon(colorTheme: ColorThemeKind) {
        const theme = themeType(colorTheme);
        const filterIcon =
            theme === "dark"
                ? require("../../../../media/filter_inverse.svg")
                : require("../../../../media/filter.svg");
        return filterIcon;
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
        default:
            console.error(`Unknown artifact type for getTypeDisplayName(): ${artifactType}`);
            return artifactType;
    }
}

const ArtifactTypeFilter = {
    ShowAll: "ShowAll",
    ...SqlArtifactTypes,
} as const;

interface WorkspaceContentsList {
    onSelectDatabase: (database: FabricSqlDbInfo) => void;
    fabricWorkspacesLoadStatus: Status;
    selectedWorkspace: FabricWorkspaceInfo | undefined;
    searchFilter?: string;
    typeFilter?: string[];
    theme: ColorThemeKind;
}

interface FabricSqlGridItem extends FabricSqlDbInfo {
    typeDisplayName: string;
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
