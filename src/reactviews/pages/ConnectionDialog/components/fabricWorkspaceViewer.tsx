/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    DataGrid,
    DataGridHeader,
    DataGridHeaderCell,
    DataGridBody,
    DataGridRow,
    DataGridCell,
    Button,
    TableColumnDefinition,
    createTableColumn,
    Text,
    List,
    ListItem,
    Label,
    Spinner,
    Tooltip,
} from "@fluentui/react-components";
import {
    FabricWorkspaceInfo,
    SqlArtifactTypes,
} from "../../../../sharedInterfaces/connectionDialog";
import { useState, useEffect, useMemo } from "react";
import {
    ChevronDoubleLeftFilled,
    ChevronDoubleRightFilled,
    ErrorCircleRegular,
    PeopleTeamRegular,
} from "@fluentui/react-icons";
import { locConstants as Loc } from "../../../common/locConstants";
import { Keys } from "../../../common/keys";
import { useStyles } from "./fabricWorkspaceViewer.styles";
import { ApiStatus } from "../../../../sharedInterfaces/webview";

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

interface Props {
    selectFabricWorkspace: (workspaceId: string) => void;
    fabricWorkspacesLoadStatus: ApiStatus;
    fabricWorkspaces: FabricWorkspaceInfo[];
    searchFilter?: string;
    typeFilter?: string[];
}

type WorkspacesListProps = {
    workspaces: FabricWorkspaceInfo[];
    onWorkspaceSelect: (workspace: FabricWorkspaceInfo) => void;
    selectedWorkspace?: FabricWorkspaceInfo;
};

type SqlDbItem = {
    id: string;
    name: string;
    typeDisplayName: string;
    type: string;
    location: string;
};

const WorkspacesList = ({
    workspaces,
    onWorkspaceSelect,
    selectedWorkspace,
}: WorkspacesListProps) => {
    const styles = useStyles();

    if (!workspaces || workspaces.length === 0) {
        return <Label>{Loc.connectionDialog.noWorkspacesAvailable}</Label>;
    }

    return (
        <List role="listbox" aria-label={Loc.connectionDialog.workspaces}>
            {workspaces.map((workspace) => (
                <ListItem
                    key={workspace.id}
                    className={`${styles.workspaceItem} ${
                        selectedWorkspace?.id === workspace.id ? styles.workspaceItemSelected : ""
                    }`}
                    onClick={() => onWorkspaceSelect(workspace)}
                    onKeyDown={(e) => {
                        if (e.key === Keys.Enter || e.key === Keys.Space) {
                            onWorkspaceSelect(workspace);
                            e.preventDefault();
                        }
                    }}
                    tabIndex={0}
                    role="option"
                    aria-selected={selectedWorkspace?.id === workspace.id}
                    title={workspace.displayName}>
                    <div style={{ display: "flex", alignItems: "center", minHeight: "20px" }}>
                        {/* Icon container with consistent styling */}
                        <div
                            style={{
                                width: "16px",
                                height: "16px",
                                marginRight: "8px",
                                flexShrink: 0,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                            }}>
                            {/* display error if workspace status is errored */}
                            {workspace.status === ApiStatus.Error && (
                                <Tooltip
                                    content={workspace.errorMessage ?? ""}
                                    relationship="label">
                                    <ErrorCircleRegular style={{ width: "100%", height: "100%" }} />
                                </Tooltip>
                            )}
                            {/* display loading spinner */}
                            {workspace.status === ApiStatus.Loading && (
                                <Spinner
                                    size="extra-tiny"
                                    style={{ width: "100%", height: "100%" }}
                                />
                            )}
                            {/* display workspace icon */}
                            {(workspace.status === ApiStatus.Loaded ||
                                workspace.status === ApiStatus.NotStarted) && (
                                <PeopleTeamRegular style={{ width: "100%", height: "100%" }} />
                            )}
                        </div>

                        <Text
                            style={{
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                flex: 1,
                            }}>
                            {workspace.displayName}
                        </Text>
                    </div>
                </ListItem>
            ))}
        </List>
    );
};

export const FabricWorkspaceViewer = ({
    selectFabricWorkspace,
    fabricWorkspacesLoadStatus,
    fabricWorkspaces,
    searchFilter = "",
    typeFilter = [],
}: Props) => {
    const styles = useStyles();
    const [isExplorerCollapsed, setIsExplorerCollapsed] = useState(false);
    const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | undefined>(undefined);
    const [selectedRowId, setSelectedRowId] = useState<string | undefined>(undefined);

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
        const result: SqlDbItem[] = [];
        if (databasesForSelectedWorkspace && databasesForSelectedWorkspace.length > 0) {
            databasesForSelectedWorkspace.forEach((db) => {
                result.push({
                    id: db.database,
                    name: db.displayName,
                    type: db.type,
                    typeDisplayName: getTypeDisplayName(db.type),
                    location: db.workspaceName,
                });
            });
        }

        let filteredResult = result;

        if (searchFilter.trim()) {
            const searchTerm = searchFilter.toLowerCase();
            filteredResult = filteredResult.filter(
                (item) =>
                    item.name.toLowerCase().includes(searchTerm) ||
                    item.typeDisplayName.toLowerCase().includes(searchTerm) ||
                    item.location.toLowerCase().includes(searchTerm),
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
        (): TableColumnDefinition<SqlDbItem>[] => [
            createTableColumn<SqlDbItem>({
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
                                {item.name}
                            </Text>
                        </div>
                    </DataGridCell>
                ),
            }),
            createTableColumn<SqlDbItem>({
                columnId: "type",
                renderHeaderCell: () => `${Loc.connectionDialog.typeColumnHeader}`,
                renderCell: (item) => (
                    <DataGridCell>
                        <Text truncate>{item.typeDisplayName}</Text>
                    </DataGridCell>
                ),
            }),
            createTableColumn<SqlDbItem>({
                columnId: "location",
                renderHeaderCell: () => `${Loc.connectionDialog.locationColumnHeader}`,
                renderCell: (item) => (
                    <DataGridCell>
                        <Text truncate>{item.location}</Text>
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
                        <div className={styles.collapseButton}>
                            <Text style={{ fontWeight: "600" }}>
                                {Loc.connectionDialog.explorer}
                            </Text>
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
                        <div className={styles.workspaceTitle}>
                            {Loc.connectionDialog.workspaces}
                        </div>
                        {fabricWorkspacesLoadStatus === ApiStatus.Loading && (
                            <div>
                                <Spinner size="medium" />
                            </div>
                        )}
                        {fabricWorkspacesLoadStatus === ApiStatus.Loaded && (
                            <WorkspacesList
                                workspaces={fabricWorkspaces}
                                onWorkspaceSelect={handleWorkspaceSelect}
                                selectedWorkspace={selectedWorkspace}
                            />
                        )}
                    </>
                )}
            </div>

            <div className={styles.workspaceGrid}>
                {fabricWorkspacesLoadStatus === ApiStatus.Loading ? (
                    <div
                        style={{
                            padding: "16px",
                            color: "var(--vscode-descriptionForeground)",
                            height: "100%",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "12px",
                        }}
                        role="status"
                        aria-live="polite">
                        <Spinner size="medium" />
                        <Text>{Loc.connectionDialog.loadingWorkspaces}</Text>
                    </div>
                ) : fabricWorkspacesLoadStatus === ApiStatus.Loaded &&
                  fabricWorkspaces.length === 0 ? (
                    <div
                        style={{
                            padding: "16px",
                            textAlign: "center",
                            color: "var(--vscode-descriptionForeground)",
                            height: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                        role="alert"
                        aria-live="polite">
                        {Loc.connectionDialog.noWorkspacesFound}
                    </div>
                ) : selectedWorkspace && selectedWorkspace.status === ApiStatus.Loading ? (
                    <div
                        style={{
                            padding: "16px",
                            color: "var(--vscode-descriptionForeground)",
                            height: "100%",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "12px",
                        }}
                        role="status"
                        aria-live="polite">
                        <Spinner size="medium" />
                        <Text>
                            {Loc.connectionDialog.loadingDatabasesInWorkspace(
                                selectedWorkspace?.displayName,
                            )}
                        </Text>
                    </div>
                ) : selectedWorkspace &&
                  selectedWorkspace.status === ApiStatus.Loaded &&
                  items.length === 0 ? (
                    <div
                        style={{
                            padding: "16px",
                            textAlign: "center",
                            color: "var(--vscode-descriptionForeground)",
                            height: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                        role="alert"
                        aria-live="polite">
                        {Loc.connectionDialog.noDatabasesFoundInWorkspace(
                            selectedWorkspace?.displayName,
                        )}
                    </div>
                ) : (
                    <DataGrid
                        items={items}
                        columns={columns}
                        getRowId={(item) => item.id}
                        size="small"
                        focusMode="composite"
                        style={{
                            flexGrow: 0,
                            height: "auto",
                            marginTop: "-8px",
                        }}>
                        <DataGridHeader>
                            <DataGridRow>
                                {({ renderHeaderCell }) => (
                                    <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>
                                )}
                            </DataGridRow>
                        </DataGridHeader>
                        <DataGridBody<SqlDbItem>>
                            {({ item, rowId }) => (
                                <DataGridRow<SqlDbItem>
                                    key={rowId}
                                    className={
                                        selectedRowId === item.id
                                            ? styles.selectedDataGridRow
                                            : undefined
                                    }
                                    onClick={() => {
                                        setSelectedRowId(item.id);
                                    }}
                                    onKeyDown={(e: React.KeyboardEvent) => {
                                        if (e.key === Keys.Enter || e.key === Keys.Space) {
                                            setSelectedRowId(item.id);
                                            e.preventDefault();
                                        }
                                    }}>
                                    {({ renderCell }) => <>{renderCell(item)}</>}
                                </DataGridRow>
                            )}
                        </DataGridBody>
                    </DataGrid>
                )}
            </div>
        </div>
    );
};
