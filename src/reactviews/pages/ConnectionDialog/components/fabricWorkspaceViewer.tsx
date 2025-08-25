/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    DataGridHeader,
    DataGridHeaderCell,
    Button,
    TableColumnDefinition,
    createTableColumn,
    Text,
    Spinner,
    Input,
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
import { useState, useEffect, useMemo, BaseSyntheticEvent } from "react";
import {
    ChevronDoubleLeftFilled,
    ChevronDoubleRightFilled,
    DismissRegular,
    ErrorCircleRegular,
    SearchRegular,
} from "@fluentui/react-icons";
import { locConstants as Loc } from "../../../common/locConstants";
import { Keys } from "../../../common/keys";
import { useStyles } from "./fabricWorkspaceViewer.styles";
import { ApiStatus, Status } from "../../../../sharedInterfaces/webview";
import { WorkspacesList } from "./fabricWorkspacesList";

// Icon imports for database types
const sqlDatabaseIcon = require("../../../../reactviews/media/sql_db.svg");
const sqlAnalyticsEndpointIcon = require("../../../../reactviews/media/data_warehouse.svg");

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

interface WorkspacesListProps {
    selectFabricWorkspace: (workspaceId: string) => void;
    onSelectDatabase: (database: FabricSqlDbInfo) => void;
    fabricWorkspacesLoadStatus: Status;
    fabricWorkspaces: FabricWorkspaceInfo[];
    searchFilter?: string;
    typeFilter?: string[];
}

interface FabricSqlGridItem extends FabricSqlDbInfo {
    typeDisplayName: string;
}

export const FabricWorkspaceViewer = ({
    selectFabricWorkspace,
    onSelectDatabase,
    fabricWorkspacesLoadStatus,
    fabricWorkspaces,
    searchFilter = "",
    typeFilter = [],
}: WorkspacesListProps) => {
    const styles = useStyles();
    const [isExplorerCollapsed, setIsExplorerCollapsed] = useState(false);
    const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | undefined>(undefined);
    const [selectedRowId, setSelectedRowId] = useState<string | undefined>(undefined);
    const [workspaceSearchFilter, setWorkspaceSearchFilter] = useState("");

    useEffect(() => {
        if (
            fabricWorkspaces.length > 0 &&
            (!selectedWorkspaceId || !fabricWorkspaces.some((w) => w.id === selectedWorkspaceId))
        ) {
            setSelectedWorkspaceId(fabricWorkspaces[0].id);
        }
    }, [fabricWorkspaces.length]);

    const filteredWorkspaces = useMemo(() => {
        if (!workspaceSearchFilter.trim()) {
            return fabricWorkspaces;
        }
        const searchTerm = workspaceSearchFilter.toLowerCase();
        return fabricWorkspaces.filter((workspace) =>
            workspace.displayName.toLowerCase().includes(searchTerm),
        );
    }, [fabricWorkspaces, workspaceSearchFilter]);

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

    const handleWorkspaceSelect = (workspace: FabricWorkspaceInfo) => {
        setSelectedWorkspaceId(workspace.id);
        setSelectedRowId(undefined); // Clear row selection when workspace changes
        selectFabricWorkspace(workspace.id);
    };

    const toggleExplorer = () => {
        setIsExplorerCollapsed(!isExplorerCollapsed);
    };

    function handleServerSelected(database: FabricSqlGridItem) {
        setSelectedRowId(database.id);
        onSelectDatabase(database);
    }

    function handleClearWorkspaceSearch(e: BaseSyntheticEvent) {
        setWorkspaceSearchFilter("");
        e?.stopPropagation();
        // buttonRef.current?.focus();
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

    return (
        <div className={styles.container}>
            <div
                className={
                    isExplorerCollapsed
                        ? styles.workspaceExplorerCollapsed
                        : styles.workspaceExplorer
                }>
                {isExplorerCollapsed ? (
                    <Button
                        appearance="subtle"
                        size="small"
                        icon={<ChevronDoubleRightFilled className={styles.collapseButtonIcon} />}
                        onClick={toggleExplorer}
                        onKeyDown={(e) => {
                            if (e.key === Keys.Enter || e.key === Keys.Space) {
                                toggleExplorer();
                                e.preventDefault();
                            }
                        }}
                        aria-label={Loc.connectionDialog.expandWorkspaceExplorer}
                        title={Loc.connectionDialog.expand}
                        className={styles.collapsedExplorerButton}
                    />
                ) : (
                    <>
                        <div className={styles.workspaceHeader}>
                            <div className={styles.collapseButton}>
                                <div className={styles.workspaceSearchBox}>
                                    <Input
                                        placeholder={Loc.connectionDialog.searchWorkspaces}
                                        value={workspaceSearchFilter}
                                        onChange={(e) => setWorkspaceSearchFilter(e.target.value)}
                                        contentBefore={<SearchRegular />}
                                        contentAfter={
                                            <DismissRegular
                                                style={{
                                                    cursor: "pointer",
                                                    visibility: workspaceSearchFilter
                                                        ? "visible"
                                                        : "hidden",
                                                }}
                                                onClick={handleClearWorkspaceSearch}
                                                onKeyDown={(e) => {
                                                    if (e.key === Keys.Enter) {
                                                        handleClearWorkspaceSearch(e);
                                                    }
                                                }}
                                                aria-label={Loc.common.clear}
                                                title={Loc.common.clear}
                                                role="button"
                                                tabIndex={workspaceSearchFilter ? 0 : -1}
                                            />
                                        }
                                        size="small"
                                        style={{ width: "100%" }}
                                    />
                                </div>
                                <Button
                                    appearance="subtle"
                                    size="small"
                                    icon={
                                        <ChevronDoubleLeftFilled
                                            className={styles.collapseButtonIcon}
                                        />
                                    }
                                    onClick={toggleExplorer}
                                    onKeyDown={(e) => {
                                        if (e.key === Keys.Enter || e.key === Keys.Space) {
                                            toggleExplorer();
                                            e.preventDefault();
                                        }
                                    }}
                                    aria-label={Loc.connectionDialog.collapseWorkspaceExplorer}
                                    title={Loc.connectionDialog.collapse}
                                    style={{
                                        minWidth: "24px",
                                        display: "flex",
                                        justifyContent: "center",
                                        padding: "0 4px",
                                    }}
                                />
                            </div>
                        </div>
                        <div className={styles.workspaceListContainer}>
                            {fabricWorkspacesLoadStatus.status === ApiStatus.Loading && (
                                <div>
                                    <Spinner size="medium" />
                                </div>
                            )}
                            {fabricWorkspacesLoadStatus.status === ApiStatus.Loaded && (
                                <WorkspacesList
                                    workspaces={filteredWorkspaces}
                                    onWorkspaceSelect={handleWorkspaceSelect}
                                    selectedWorkspace={selectedWorkspace}
                                />
                            )}
                        </div>
                    </>
                )}
            </div>

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
