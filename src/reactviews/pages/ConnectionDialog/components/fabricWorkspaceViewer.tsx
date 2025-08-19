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
import {
    FabricSqlDbInfo,
    FabricWorkspaceInfo,
} from "../../../../sharedInterfaces/connectionDialog";
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
                    <div style={{ display: "flex", alignItems: "center" }}>
                        <PeopleTeamRegular
                            style={{
                                marginRight: "8px",
                            }}
                        />
                        <Text>{workspace.displayName}</Text>
                    </div>
                </ListItem>
            ))}
        </List>
    );
};

export const FabricWorkspaceViewer = ({
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
                    type: `${Loc.connectionDialog.sqlDatabase}`,
                    location: "db.workspace.name",
                });
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
            createTableColumn<SqlDbItem>({
                columnId: "type",
                renderHeaderCell: () => `${Loc.connectionDialog.typeColumnHeader}`,
                renderCell: (item) => (
                    <DataGridCell>
                        <Text truncate>{item.type}</Text>
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
                            workspaces={fabricWorkspaces}
                            onWorkspaceSelect={handleWorkspaceSelect}
                            selectedWorkspace={selectedWorkspace}
                        />
                    </>
                )}
            </div>

            <div className={styles.workspaceGrid}>
                {fabricWorkspaces.length === 0 ? (
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
