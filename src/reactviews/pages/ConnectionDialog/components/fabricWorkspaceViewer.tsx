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
} from "../../../../sharedInterfaces/connectionDialog";
import { useState, useMemo } from "react";
import { ErrorCircleRegular } from "@fluentui/react-icons";
import { locConstants as Loc } from "../../../common/locConstants";
import { Keys } from "../../../common/keys";
import { useFabricBrowserStyles } from "./fabricWorkspaceViewer.styles";
import { ApiStatus, Status } from "../../../../sharedInterfaces/webview";

// Icon imports for database types
const sqlDatabaseIcon = require("../../../../reactviews/media/sql_db.svg");
const sqlAnalyticsEndpointIcon = require("../../../../reactviews/media/data_warehouse.svg");

export const WorkspaceContentsList = ({
    onSelectDatabase,
    fabricWorkspacesLoadStatus,
    selectedWorkspace,
    searchFilter = "",
    typeFilter = [],
}: WorkspaceContentsList) => {
    const styles = useFabricBrowserStyles();
    const [selectedRowId, setSelectedRowId] = useState<string | undefined>(undefined);

    //#region Hooks

    const databasesForSelectedWorkspace = useMemo(() => {
        return selectedWorkspace?.databases || [];
    }, [selectedWorkspace?.id, selectedWorkspace?.loadStatus]);

    const items = useMemo(() => {
        const result: FabricSqlGridItem[] = [];
        if (databasesForSelectedWorkspace && databasesForSelectedWorkspace.length > 0) {
            databasesForSelectedWorkspace.forEach((db) => {
                result.push({
                    ...db,
                    typeDisplayName: getTypeDisplayName(db.type),
                });
            });
        }

        let filteredResult = result;

        if (searchFilter.trim()) {
            const searchTerm = searchFilter.toLowerCase();
            filteredResult = filteredResult.filter(
                (item) =>
                    item.displayName.toLowerCase().includes(searchTerm) ||
                    item.typeDisplayName.toLowerCase().includes(searchTerm) ||
                    item.workspaceName.toLowerCase().includes(searchTerm),
            );
        }

        if (typeFilter.length > 0 && !typeFilter.includes("Show All")) {
            filteredResult = filteredResult.filter((item) =>
                typeFilter.includes(item.typeDisplayName),
            );
        }

        return filteredResult;
    }, [databasesForSelectedWorkspace, searchFilter, typeFilter]);

    const columns = useMemo(
        (): TableColumnDefinition<FabricSqlGridItem>[] => [
            createTableColumn<FabricSqlGridItem>({
                columnId: "name",
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
                                src={getItemIcon(item.type)}
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
                renderHeaderCell: () => `${Loc.connectionDialog.typeColumnHeader}`,
                renderCell: (item) => (
                    <DataGridCell>
                        <Text truncate className={styles.hideTextOverflowCell}>
                            {item.typeDisplayName}
                        </Text>
                    </DataGridCell>
                ),
            }),
        ],
        [],
    );

    function handleServerSelected(database: FabricSqlGridItem) {
        setSelectedRowId(database.id);
        onSelectDatabase(database);
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
            if (databasesForSelectedWorkspace.length === 0) {
                return renderNoDatabasesFound();
            } else {
                return renderDataGrid();
            }
        }

        return (
            <>
                <Label>Unexpected state:</Label>
                <Label>FabricWorkspaceLoadStatus: {fabricWorkspacesLoadStatus.status}</Label>
                <Label>SelectedWorkspace: {selectedWorkspace?.id}</Label>
                <Label>SelectedWorkspace.Status: {selectedWorkspace?.loadStatus.status}</Label>
                <Label>SelectedWorkspace.Databases: {selectedWorkspace?.databases.length}</Label>
            </>
        );
    };

    const renderLoadingWorkspaces = () => (
        <div className={styles.gridMessageContainer} role="status" aria-live="polite">
            <Spinner size="medium" />
            <Text className={styles.messageText}>{Loc.connectionDialog.loadingWorkspaces}</Text>
        </div>
    );

    const renderWorkspacesError = () => (
        <div className={styles.gridMessageContainer} role="alert" aria-live="polite">
            <ErrorCircleRegular className={styles.errorIcon} />
            <Text className={styles.messageText}>
                {fabricWorkspacesLoadStatus.message || Loc.connectionDialog.errorLoadingWorkspaces}
            </Text>
        </div>
    );

    const renderNoSelectedWorkspace = (message: string | undefined) => (
        <div className={styles.gridMessageContainer} role="alert" aria-live="polite">
            {message || Loc.connectionDialog.selectAWorkspaceToViewDatabases}
        </div>
    );

    const renderLoadingDatabases = () => (
        <div className={styles.gridMessageContainer} role="status" aria-live="polite">
            <Spinner size="medium" />
            <Text className={styles.messageText}>
                {Loc.connectionDialog.loadingDatabasesInWorkspace(selectedWorkspace?.displayName)}
            </Text>
        </div>
    );

    const renderDatabasesError = () => (
        <div className={styles.gridMessageContainer} role="alert" aria-live="polite">
            <ErrorCircleRegular className={styles.errorIcon} />
            <Text className={styles.messageText}>
                {selectedWorkspace!.loadStatus.message ||
                    Loc.connectionDialog.errorLoadingDatabases}
            </Text>
        </div>
    );

    const renderNoDatabasesFound = () => (
        <div className={styles.gridMessageContainer} role="alert" aria-live="polite">
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
            resizableColumns={true}
            columnSizingOptions={columnSizingOptions}
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

    return (
        <div className={styles.container}>
            <div className={styles.workspaceGrid}>{renderGridContent()}</div>
        </div>
    );
};

function getItemIcon(artifactType: string): string {
    switch (artifactType) {
        case SqlArtifactTypes.SqlDatabase:
            return sqlDatabaseIcon;
        case SqlArtifactTypes.SqlAnalyticsEndpoint:
            return sqlAnalyticsEndpointIcon;
        default:
            return sqlDatabaseIcon;
    }
}

function getTypeDisplayName(artifactType: string): string {
    switch (artifactType) {
        case SqlArtifactTypes.SqlDatabase:
            return Loc.connectionDialog.sqlDatabase;
        case SqlArtifactTypes.SqlAnalyticsEndpoint:
            return Loc.connectionDialog.sqlAnalyticsEndpoint;
        default:
            return artifactType;
    }
}

interface WorkspaceContentsList {
    onSelectDatabase: (database: FabricSqlDbInfo) => void;
    fabricWorkspacesLoadStatus: Status;
    selectedWorkspace: FabricWorkspaceInfo | undefined;
    searchFilter?: string;
    typeFilter?: string[];
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
    location: {
        minWidth: 60,
        defaultWidth: 70,
    },
};
