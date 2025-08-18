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
} from "@fluentui/react-components";
import { FabricSqlServerInfo } from "../../../../sharedInterfaces/connectionDialog";
import { useState, useEffect, useMemo } from "react";
import {
    ChevronDoubleLeftFilled,
    ChevronDoubleRightFilled,
    PeopleTeamRegular,
} from "@fluentui/react-icons";
import { locConstants as Loc } from "../../../common/locConstants";
import { Keys } from "../../../common/keys";
import { useStyles } from "./fabricWorkspaceViewer.styles";

// Icon imports for database types
const sqlDatabaseIcon = require("../../../../reactviews/media/sql_db.svg");
const sqlAnalyticsEndpointIcon = require("../../../../reactviews/media/data_warehouse.svg");

// Helper function to get the appropriate icon for each item type
const getItemIcon = (itemType: string): string => {
    switch (itemType) {
        case "SQL Database":
            return sqlDatabaseIcon;
        case "SQL Analytics Endpoint":
            return sqlAnalyticsEndpointIcon;
        default:
            return sqlDatabaseIcon;
    }
};

interface Props {
    fabricServerInfo: FabricSqlServerInfo[];
    searchFilter?: string;
    typeFilter?: string[];
}

type WorkspacesListProps = {
    workspaces: { name: string; id: string }[];
    onWorkspaceSelect: (workspace: { name: string; id: string }) => void;
    selectedWorkspace?: { name: string; id: string };
};

type ServerItem = {
    id: string;
    name: string;
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
                    title={workspace.name}>
                    <div style={{ display: "flex", alignItems: "center" }}>
                        <PeopleTeamRegular
                            style={{
                                marginRight: "8px",
                            }}
                        />
                        <Text>{workspace.name}</Text>
                    </div>
                </ListItem>
            ))}
        </List>
    );
};

export const FabricWorkspaceViewer = ({
    fabricServerInfo,
    searchFilter = "",
    typeFilter = [],
}: Props) => {
    const styles = useStyles();
    const [isExplorerCollapsed, setIsExplorerCollapsed] = useState(false);
    const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | undefined>(undefined);
    const [selectedRowId, setSelectedRowId] = useState<string | undefined>(undefined);

    const uniqueWorkspaces = useMemo(() => {
        return Array.from(
            new Map(
                fabricServerInfo.map((server) => [server.workspace.id, server.workspace]),
            ).values(),
        );
    }, [fabricServerInfo]);

    useEffect(() => {
        if (
            uniqueWorkspaces.length > 0 &&
            (!selectedWorkspaceId || !uniqueWorkspaces.some((w) => w.id === selectedWorkspaceId))
        ) {
            setSelectedWorkspaceId(uniqueWorkspaces[0].id);
        }
    }, [fabricServerInfo.length]);

    const selectedWorkspace = useMemo(() => {
        return uniqueWorkspaces.find((workspace) => workspace.id === selectedWorkspaceId);
    }, [uniqueWorkspaces, selectedWorkspaceId]);

    const filteredServers = useMemo(() => {
        return fabricServerInfo.filter((server) => selectedWorkspaceId === server.workspace.id);
    }, [fabricServerInfo, selectedWorkspaceId]);

    const items = useMemo(() => {
        const result: ServerItem[] = [];
        if (filteredServers && filteredServers.length > 0) {
            filteredServers.forEach((server) => {
                if (server.databases && server.databases.length > 0) {
                    server.databases.forEach((db, dbIndex) => {
                        result.push({
                            id: `${server.workspace.name}-db-${dbIndex}-${db}`,
                            name: db,
                            type: `${Loc.connectionDialog.sqlDatabase}`,
                            location: server.workspace.name,
                        });
                    });
                }

                if (server.sqlAnalyticsEndpoints && server.sqlAnalyticsEndpoints.length > 0) {
                    server.sqlAnalyticsEndpoints.forEach((endpoint, endpointIndex) => {
                        result.push({
                            id: `${server.workspace.name}-endpoint-${endpointIndex}-${endpoint}`,
                            name: endpoint,
                            type: `${Loc.connectionDialog.sqlAnalyticsEndpoint}`,
                            location: server.workspace.name,
                        });
                    });
                }
            });
        }

        let filteredResult = result;

        if (searchFilter.trim()) {
            const searchTerm = searchFilter.toLowerCase();
            filteredResult = filteredResult.filter(
                (item) =>
                    item.name.toLowerCase().includes(searchTerm) ||
                    item.type.toLowerCase().includes(searchTerm) ||
                    item.location.toLowerCase().includes(searchTerm),
            );
        }

        if (typeFilter.length > 0 && !typeFilter.includes("Show All")) {
            filteredResult = filteredResult.filter((item) => typeFilter.includes(item.type));
        }

        return filteredResult;
    }, [filteredServers, searchFilter, typeFilter]);

    const columns = useMemo(
        (): TableColumnDefinition<ServerItem>[] => [
            createTableColumn<ServerItem>({
                columnId: "name",
                renderHeaderCell: () => `${Loc.connectionDialog.nameColumnHeader}`,
                renderCell: (item) => (
                    <DataGridCell>
                        <div style={{ display: "flex", alignItems: "center" }}>
                            <img
                                src={getItemIcon(item.type)}
                                alt={item.type}
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
            createTableColumn<ServerItem>({
                columnId: "type",
                renderHeaderCell: () => `${Loc.connectionDialog.typeColumnHeader}`,
                renderCell: (item) => (
                    <DataGridCell>
                        <Text truncate>{item.type}</Text>
                    </DataGridCell>
                ),
            }),
            createTableColumn<ServerItem>({
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

    const handleWorkspaceSelect = (workspace: { name: string; id: string }) => {
        setSelectedWorkspaceId(workspace.id);
        setSelectedRowId(undefined); // Clear row selection when workspace changes
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
                        <WorkspacesList
                            workspaces={uniqueWorkspaces}
                            onWorkspaceSelect={handleWorkspaceSelect}
                            selectedWorkspace={selectedWorkspace}
                        />
                    </>
                )}
            </div>

            <div className={styles.workspaceGrid}>
                {fabricServerInfo.length === 0 ? (
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
                        {Loc.connectionDialog.noSqlServersFound}
                    </div>
                ) : items.length === 0 ? (
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
                        {Loc.connectionDialog.noDatabasesFound}
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
                        <DataGridBody<ServerItem>>
                            {({ item, rowId }) => (
                                <DataGridRow<ServerItem>
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
