/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    makeStyles,
    shorthands,
    Table,
    TableHeader,
    TableBody,
    TableRow,
    TableHeaderCell,
    TableCell,
    Button,
    createTableColumn,
    TableColumnDefinition,
    useTableFeatures,
    useTableColumnSizing_unstable,
    TableColumnSizingOptions,
} from "@fluentui/react-components";
import { FabricSqlServerInfo } from "../../../../sharedInterfaces/connectionDialog";
import { useState, useEffect, useMemo } from "react";
import { ChevronDoubleLeftFilled, ChevronDoubleRightFilled } from "@fluentui/react-icons";

interface Props {
    fabricServerInfo: FabricSqlServerInfo[];
}

type WorkspacesListProps = {
    workspaces: { name: string; id: string }[];
    onWorkspaceSelect: (workspace: { name: string; id: string }) => void;
    selectedWorkspace?: { name: string; id: string };
};

type ServerItem = {
    name: string;
    type: string;
    location: string;
};

const useStyles = makeStyles({
    container: {
        display: "flex",
        height: "400px", // Fixed height that will fit well in the dialog
        width: "100%",
        ...shorthands.gap("10px"),
        overflow: "hidden", // Prevent container from causing scrollbars
        marginTop: "10px",
    },
    workspaceExplorer: {
        display: "flex",
        flexDirection: "column",
        width: "160px", // Slightly narrower for better proportions
        minWidth: "160px", // Ensure it doesn't shrink below this width
        height: "100%",
        borderRight: "1px solid var(--vscode-panel-border)",
        ...shorthands.padding("4px"),
        transition: "width 0.2s ease-in-out",
        overflow: "auto", // Allow scrolling within the workspace list if needed
        backgroundColor: "var(--vscode-sideBar-background)",
    },
    workspaceExplorerCollapsed: {
        width: "28px",
        minWidth: "28px",
        ...shorthands.overflow("visible"),
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-start",
        alignItems: "center",
        paddingTop: "4px",
        borderRight: "1px solid var(--vscode-panel-border)",
        backgroundColor: "var(--vscode-sideBar-background)",
    },
    workspaceGrid: {
        flexGrow: 1,
        overflow: "hidden", // Changed to hidden to control overflow properly
        ...shorthands.padding("8px"),
        height: "100%", // Fill the available height
        display: "flex",
        flexDirection: "column",
    },
    workspaceTitle: {
        fontSize: "14px",
        fontWeight: "600",
        marginBottom: "8px",
        paddingLeft: "8px",
        paddingTop: "4px",
    },
    workspaceItem: {
        ...shorthands.padding("4px", "8px"),
        cursor: "pointer",
        borderRadius: "2px",
        marginBottom: "1px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        fontSize: "13px",
        height: "24px",
        lineHeight: "24px",
        "&:hover": {
            backgroundColor: "var(--vscode-list-hoverBackground)",
        },
    },
    workspaceItemSelected: {
        backgroundColor: "var(--vscode-list-activeSelectionBackground)",
        color: "var(--vscode-list-activeSelectionForeground)",
        "&:hover": {
            backgroundColor: "var(--vscode-list-activeSelectionBackground)",
        },
    },
    collapseButton: {
        minWidth: "24px",
        height: "24px",
        alignSelf: "flex-end",
        marginBottom: "8px",
    },
    collapseButtonIcon: {
        fontSize: "12px",
    },
    tableContainer: {
        width: "100%",
        height: "100%", // Fill the available height
        display: "flex",
        flexDirection: "column",
        border: "1px solid var(--vscode-panel-border)",
        borderRadius: "4px",
        backgroundColor: "var(--vscode-editor-background)",
        "& tr:not(:last-child)": {
            borderBottom: "1px solid var(--vscode-panel-border)",
        },
        "& td, & th": {
            borderRight: "1px solid var(--vscode-panel-border)",
            height: "22px !important",
            maxHeight: "22px !important",
        },
        "& td:last-child, & th:last-child": {
            borderRight: "none",
        },
        "& tr": {
            height: "22px !important",
            maxHeight: "22px !important",
        },
    },
    headerRow: {
        backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)",
        height: "22px",
        minHeight: "22px",
        maxHeight: "22px",
    },
    tableRow: {
        height: "22px",
        minHeight: "22px",
        maxHeight: "22px",
        "&:hover": {
            backgroundColor: "var(--vscode-list-hoverBackground)",
        },
        "&:nth-child(odd)": {
            backgroundColor: "rgba(0, 0, 0, 0.1)",
        },
    },
});

// Memoized WorkspacesList to prevent unnecessary re-renders
const WorkspacesList = ({
    workspaces,
    onWorkspaceSelect,
    selectedWorkspace,
}: WorkspacesListProps) => {
    const styles = useStyles();

    // Don't render if there are no workspaces
    if (!workspaces || workspaces.length === 0) {
        return <div>No workspaces available</div>;
    }

    return (
        <div>
            {workspaces.map((workspace) => (
                <div
                    key={workspace.id}
                    className={`${styles.workspaceItem} ${selectedWorkspace?.id === workspace.id ? styles.workspaceItemSelected : ""}`}
                    onClick={() => onWorkspaceSelect(workspace)}
                    title={workspace.name}>
                    {workspace.name}
                </div>
            ))}
        </div>
    );
};

export const FabricWorkspaceViewer = ({ fabricServerInfo }: Props) => {
    const styles = useStyles();
    const [isExplorerCollapsed, setIsExplorerCollapsed] = useState(false); // Ensure it's expanded by default
    const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | undefined>(undefined);

    // Extract unique workspaces from the server info - memoize to prevent unnecessary recalculations
    const uniqueWorkspaces = useMemo(() => {
        return Array.from(
            new Map(
                fabricServerInfo.map((server) => [server.workspace.id, server.workspace]),
            ).values(),
        );
    }, [fabricServerInfo]);

    // Initialize selected workspace only on first render or when fabricServerInfo changes
    useEffect(() => {
        // Only set the workspace ID if it's not already set or if it's no longer valid
        if (
            uniqueWorkspaces.length > 0 &&
            (!selectedWorkspaceId || !uniqueWorkspaces.some((w) => w.id === selectedWorkspaceId))
        ) {
            setSelectedWorkspaceId(uniqueWorkspaces[0].id);
        }
    }, [fabricServerInfo.length]); // Only depend on the length of fabricServerInfo

    // Get the selected workspace object - memoize to prevent recreation on every render
    const selectedWorkspace = useMemo(() => {
        return uniqueWorkspaces.find((workspace) => workspace.id === selectedWorkspaceId);
    }, [uniqueWorkspaces, selectedWorkspaceId]);

    // Filter servers by selected workspace - memoize to prevent recreation on every render
    const filteredServers = useMemo(() => {
        return fabricServerInfo.filter((server) => selectedWorkspaceId === server.workspace.id);
    }, [fabricServerInfo, selectedWorkspaceId]);

    // Create flattened items for the table - memoize to prevent recreation on every render
    const items = useMemo(() => {
        const result: ServerItem[] = [];
        if (filteredServers && filteredServers.length > 0) {
            filteredServers.forEach((server) => {
                if (server.databases && server.databases.length > 0) {
                    server.databases.forEach((db) => {
                        result.push({
                            name: db,
                            type: "SQL database",
                            location: server.workspace.name,
                        });
                    });
                }
            });
        }
        return result;
    }, [filteredServers]);

    // Define columns for the table - memoize to prevent recreation on every render
    const columns = useMemo(
        (): TableColumnDefinition<ServerItem>[] => [
            createTableColumn({
                columnId: "name",
                renderHeaderCell: () => "Name",
                renderCell: (item) => item.name,
            }),
            createTableColumn({
                columnId: "type",
                renderHeaderCell: () => "Type",
                renderCell: (item) => item.type,
            }),
            createTableColumn({
                columnId: "location",
                renderHeaderCell: () => "Location (Workspace)",
                renderCell: (item) => item.location,
            }),
        ],
        [],
    );

    // Column sizing options - memoize to prevent recreation on every render
    const columnSizingOptions = useMemo(
        (): TableColumnSizingOptions => ({
            name: { idealWidth: 250, minWidth: 150 },
            type: { idealWidth: 150, minWidth: 100 },
            location: { idealWidth: 200, minWidth: 150 },
        }),
        [],
    );

    // Use table features with memoized dependencies
    const { getRows, columnSizing_unstable, tableRef } = useTableFeatures(
        {
            columns,
            items,
        },
        [
            useTableColumnSizing_unstable({
                columnSizingOptions,
                autoFitColumns: false,
            }),
        ],
    );

    const rows = getRows();

    const handleWorkspaceSelect = (workspace: { name: string; id: string }) => {
        setSelectedWorkspaceId(workspace.id);
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
                    // When collapsed, render just the expand button prominently
                    <Button
                        appearance="subtle"
                        size="small"
                        icon={<ChevronDoubleRightFilled className={styles.collapseButtonIcon} />}
                        onClick={toggleExplorer}
                        title="Expand"
                        style={{
                            width: "24px",
                            height: "24px",
                            display: "flex",
                            justifyContent: "center",
                            alignItems: "center",
                            margin: "0 auto",
                        }}
                    />
                ) : (
                    // When expanded, render the collapse button and the workspace list
                    <>
                        <div className={styles.collapseButton}>
                            <Button
                                appearance="subtle"
                                size="small"
                                icon={
                                    <ChevronDoubleLeftFilled
                                        className={styles.collapseButtonIcon}
                                    />
                                }
                                onClick={toggleExplorer}
                                title="Collapse"
                            />
                        </div>
                        <div className={styles.workspaceTitle}>Workspaces</div>
                        <WorkspacesList
                            workspaces={uniqueWorkspaces}
                            onWorkspaceSelect={handleWorkspaceSelect}
                            selectedWorkspace={selectedWorkspace}
                        />
                    </>
                )}
            </div>

            <div className={styles.workspaceGrid}>
                <div className={styles.tableContainer}>
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
                            }}>
                            No SQL servers found. Please sign in to view available servers.
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
                            }}>
                            No databases found in the selected workspace.
                        </div>
                    ) : (
                        <div style={{ overflow: "auto", height: "100%" }}>
                            <Table
                                {...columnSizing_unstable.getTableProps()}
                                ref={tableRef}
                                size="small"
                                style={{
                                    flexGrow: 0,
                                    height: "auto",
                                    borderSpacing: "0",
                                    borderCollapse: "collapse",
                                    tableLayout: "fixed",
                                }}>
                                <TableHeader className={styles.headerRow}>
                                    <TableRow>
                                        {columns.map((column) => (
                                            <TableHeaderCell
                                                key={column.columnId}
                                                {...columnSizing_unstable.getTableHeaderCellProps(
                                                    column.columnId,
                                                )}
                                                style={{
                                                    height: "22px",
                                                    padding: "0 8px",
                                                    fontSize: "12px",
                                                }}>
                                                {column.renderHeaderCell()}
                                            </TableHeaderCell>
                                        ))}
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {rows.map((row, i) => (
                                        <TableRow key={i} className={styles.tableRow}>
                                            {columns.map((column) => (
                                                <TableCell
                                                    key={column.columnId}
                                                    {...columnSizing_unstable.getTableCellProps(
                                                        column.columnId,
                                                    )}
                                                    style={{
                                                        height: "22px",
                                                        maxHeight: "22px",
                                                        padding: "0 8px",
                                                        fontSize: "12px",
                                                        lineHeight: "22px",
                                                        verticalAlign: "middle",
                                                    }}>
                                                    {column.renderCell(row.item)}
                                                </TableCell>
                                            ))}
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
