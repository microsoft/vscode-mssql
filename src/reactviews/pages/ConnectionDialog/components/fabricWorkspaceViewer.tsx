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
import { useState, useEffect, useMemo } from "react";
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
    fabricWorkspaces,
    searchFilter = "",
    typeFilter = [],
}: WorkspaceContentsList) => {
    const styles = useFabricBrowserStyles();
    const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | undefined>(undefined);
    const [selectedRowId, setSelectedRowId] = useState<string | undefined>(undefined);

    //#region Hooks

    useEffect(() => {
        if (
            fabricWorkspaces.length > 0 &&
            (!selectedWorkspaceId || !fabricWorkspaces.some((w) => w.id === selectedWorkspaceId))
        ) {
            setSelectedWorkspaceId(fabricWorkspaces[0].id);
        }
    }, [fabricWorkspaces.length]);

    const selectedWorkspace = useMemo(() => {
        return fabricWorkspaces.find((w) => w.id === selectedWorkspaceId);
    }, [fabricWorkspaces, selectedWorkspaceId]);

    const databasesForSelectedWorkspace = useMemo(() => {
        return fabricWorkspaces.find((w) => w.id === selectedWorkspaceId)?.databases || [];
    }, [fabricWorkspaces, selectedWorkspaceId]);

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
                        <div style={{ display: "flex", alignItems: "center" }}>
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
                            <Text truncate style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
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
                        <Text truncate>{item.typeDisplayName}</Text>
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

    //#endregion Hooks

    return (
        <div className={styles.container}>
            <div className={styles.workspaceGrid}>
                {fabricWorkspacesLoadStatus.status === ApiStatus.Loading ? (
                    <div className={styles.gridMessageContainer} role="status" aria-live="polite">
                        <Spinner size="medium" />
                        <Text className={styles.messageText}>
                            {Loc.connectionDialog.loadingWorkspaces}
                        </Text>
                    </div>
                ) : fabricWorkspacesLoadStatus.status === ApiStatus.Error ? (
                    <div className={styles.gridMessageContainer} role="alert" aria-live="polite">
                        <ErrorCircleRegular className={styles.errorIcon} />
                        <Text className={styles.messageText}>
                            {fabricWorkspacesLoadStatus.message ||
                                Loc.connectionDialog.errorLoadingWorkspaces}
                        </Text>
                    </div>
                ) : fabricWorkspacesLoadStatus.status === ApiStatus.Loaded &&
                  fabricWorkspaces.length === 0 ? (
                    <div className={styles.gridMessageContainer} role="alert" aria-live="polite">
                        {Loc.connectionDialog.noWorkspacesFound}
                    </div>
                ) : selectedWorkspace &&
                  selectedWorkspace.loadStatus.status === ApiStatus.Loading ? (
                    <div className={styles.gridMessageContainer} role="status" aria-live="polite">
                        <Spinner size="medium" />
                        <Text className={styles.messageText}>
                            {Loc.connectionDialog.loadingDatabasesInWorkspace(
                                selectedWorkspace?.displayName,
                            )}
                        </Text>
                    </div>
                ) : selectedWorkspace && selectedWorkspace.loadStatus.status === ApiStatus.Error ? (
                    <div className={styles.gridMessageContainer} role="alert" aria-live="polite">
                        <ErrorCircleRegular className={styles.errorIcon} />
                        <Text className={styles.messageText}>
                            {selectedWorkspace.loadStatus.message ||
                                Loc.connectionDialog.errorLoadingDatabases}
                        </Text>
                    </div>
                ) : selectedWorkspace &&
                  selectedWorkspace.loadStatus.status === ApiStatus.Loaded &&
                  items.length === 0 ? (
                    <div className={styles.gridMessageContainer} role="alert" aria-live="polite">
                        {Loc.connectionDialog.noDatabasesFoundInWorkspace(
                            selectedWorkspace?.displayName,
                        )}
                    </div>
                ) : (
                    <DataGrid
                        items={items}
                        columns={columns}
                        getRowId={(item: FabricSqlGridItem) => item.id}
                        size="small"
                        focusMode="composite"
                        style={{
                            flexGrow: 1,
                            height: "100%",
                            overflow: "auto",
                        }}>
                        <DataGridHeader>
                            <DataGridRow>
                                {({
                                    renderHeaderCell,
                                }: {
                                    renderHeaderCell: () => React.ReactNode;
                                }) => <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>}
                            </DataGridRow>
                        </DataGridHeader>
                        <DataGridBody<FabricSqlGridItem> itemSize={30} height={360} width={"100%"}>
                            {renderRow}
                        </DataGridBody>
                    </DataGrid>
                )}
            </div>
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
    fabricWorkspaces: FabricWorkspaceInfo[];
    searchFilter?: string;
    typeFilter?: string[];
}

interface FabricSqlGridItem extends FabricSqlDbInfo {
    typeDisplayName: string;
}
