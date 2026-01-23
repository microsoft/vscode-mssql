/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Divider,
    makeStyles,
    Menu,
    MenuButton,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    mergeClasses,
    Text,
    Tooltip,
} from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
import { Handle, NodeProps, Position } from "@xyflow/react";
import { useContext, useRef, useEffect, useState, cloneElement } from "react";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import eventBus from "../schemaDesignerEvents";
import { LAYOUT_CONSTANTS } from "../schemaDesignerUtils";
import * as l10n from "@vscode/l10n";
import { ForeignKeyIcon } from "../../../common/icons/foreignKey";
import { PrimaryKeyIcon } from "../../../common/icons/primaryKey";
import {
    useTableDiffIndicator,
    useColumnDiffIndicator,
    useDeletedColumns,
    useDiffViewer,
} from "../diffViewer/diffViewerContext";
import "../diffViewer/diffViewer.css";

// Custom hook to detect text overflow
const useTextOverflow = (text: string) => {
    const [isOverflowing, setIsOverflowing] = useState(false);
    const textRef = useRef<HTMLElement>(null);

    useEffect(() => {
        const checkOverflow = () => {
            if (textRef.current) {
                const isTextOverflowing = textRef.current.scrollWidth > textRef.current.clientWidth;
                setIsOverflowing(isTextOverflowing);
            }
        };

        // Use requestAnimationFrame to ensure the element is fully rendered
        const rafId = requestAnimationFrame(checkOverflow);

        // Check overflow on window resize
        window.addEventListener("resize", checkOverflow);

        return () => {
            cancelAnimationFrame(rafId);
            window.removeEventListener("resize", checkOverflow);
        };
    }, [text]); // Re-run when text changes

    return { isOverflowing, textRef };
};

// ConditionalTooltip component that only shows tooltip when text overflows
const ConditionalTooltip = ({
    content,
    children,
    ...props
}: {
    content: string;
    children: React.ReactElement;
    [key: string]: any;
}) => {
    const { isOverflowing, textRef } = useTextOverflow(content);

    // Clone the child element and add the ref
    const childWithRef = cloneElement(children, {
        ref: textRef,
        ...children.props,
    });

    if (isOverflowing) {
        return (
            <Tooltip relationship={"label"} content={content} {...props}>
                {childWithRef}
            </Tooltip>
        );
    }

    return childWithRef;
};

// Styles for the table node components
const useStyles = makeStyles({
    tableNodeContainer: {
        width: `${LAYOUT_CONSTANTS.NODE_WIDTH}px`,
        backgroundColor: "var(--vscode-editor-background)",
        borderRadius: "5px",
        display: "flex",
        flexDirection: "column",
        gap: "5px",
        boxSizing: "border-box",
    },
    // Diff indicator styles for colored borders
    diffIndicatorAdded: {
        border: "2px solid var(--vscode-gitDecoration-addedResourceForeground, #73c991)",
        boxShadow: "0 0 6px var(--vscode-gitDecoration-addedResourceForeground, #73c991)",
    },
    diffIndicatorModified: {
        border: "2px solid var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d)",
        boxShadow: "0 0 6px var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d)",
    },
    diffIndicatorDeleted: {
        border: "2px solid var(--vscode-gitDecoration-deletedResourceForeground, #c74e39)",
        boxShadow: "0 0 6px var(--vscode-gitDecoration-deletedResourceForeground, #c74e39)",
    },
    tableHeader: {
        width: "100%",
        display: "flex",
        minHeight: "50px",
        flexDirection: "column",
    },
    tableHeaderRow: {
        width: "100%",
        display: "flex",
        height: "30px",
        flexDirection: "row",
        alignItems: "center",
        gap: "5px",
        paddingTop: "10px",
    },
    tableIcon: {
        padding: "0 5px",
        width: "20px",
        height: "20px",
    },
    tableTitle: {
        flexGrow: 1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        fontWeight: "600",
    },
    tableTitleExporting: {
        flexGrow: 1,
        fontWeight: "600",
        overflowWrap: "anywhere",
        whiteSpace: "normal",
        hyphens: "auto",
    },
    tableSubtitle: {
        fontSize: "11px",
        paddingLeft: "35px",
    },
    columnName: {
        flexGrow: 1,
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    columnNameExporting: {
        flexGrow: 1,
    },
    columnType: {
        fontSize: "12px",
        color: "var(--vscode-descriptionForeground)",
    },
    handleLeft: {
        marginLeft: "2px",
    },
    handleRight: {
        marginRight: "2px",
    },
    keyIcon: {
        padding: "0 5px",
        width: "16px",
        height: "16px",
    },
    actionButton: {
        marginLeft: "auto",
    },
    collapseButton: {
        width: "100%",
    },
    tableOverlay: {
        position: "absolute",
        inset: 0,
        backgroundColor: "var(--vscode-editor-background)",
        opacity: 0.4,
        pointerEvents: "none",
        zIndex: 10,
    },
});

// TableHeaderActions component for the edit button and menu
const TableHeaderActions = ({ table }: { table: SchemaDesigner.Table }) => {
    const context = useContext(SchemaDesignerContext);
    const styles = useStyles();

    const handleEditTable = () => {
        const schema = context.extractSchema();
        const foundTable = schema.tables.find((t) => t.id === table.id);

        if (!foundTable) {
            return;
        }

        const tableCopy = { ...table };
        eventBus.emit("editTable", tableCopy, schema);
    };

    const handleDeleteTable = () => {
        void context.deleteTable(table);
    };

    const handleManageRelationships = () => {
        const schema = context.extractSchema();
        const foundTable = schema.tables.find((t) => t.id === table.id);

        if (!foundTable) {
            return;
        }

        const tableCopy = { ...table };
        eventBus.emit("editTable", tableCopy, schema, true);
    };

    return (
        <>
            <Button
                appearance="subtle"
                icon={<FluentIcons.EditRegular />}
                onClick={handleEditTable}
                className={styles.actionButton}
                size="small"
            />
            <Menu>
                <MenuTrigger disableButtonEnhancement>
                    <MenuButton
                        icon={<FluentIcons.MoreVerticalRegular />}
                        className={styles.actionButton}
                        size="small"
                        appearance="subtle"
                    />
                </MenuTrigger>

                <MenuPopover>
                    <MenuList>
                        <MenuItem
                            icon={<FluentIcons.FlowRegular />}
                            onClick={handleManageRelationships}>
                            {locConstants.schemaDesigner.manageRelationships}
                        </MenuItem>
                        <MenuItem icon={<FluentIcons.DeleteRegular />} onClick={handleDeleteTable}>
                            {locConstants.schemaDesigner.delete}
                        </MenuItem>
                    </MenuList>
                </MenuPopover>
            </Menu>
        </>
    );
};

// TableHeader component for the table title and subtitle
const TableHeader = ({
    table,
    isGhostNode = false,
    renameInfo,
}: {
    table: SchemaDesigner.Table;
    isGhostNode?: boolean;
    renameInfo?: SchemaDesigner.RenameDisplayInfo;
}) => {
    const styles = useStyles();
    const context = useContext(SchemaDesignerContext);

    // Function to highlight text based on search
    const highlightText = (text: string) => {
        if (!context.findTableText || context.findTableText.trim() === "") {
            return <span>{text}</span>;
        }

        // Case insensitive search
        const regex = new RegExp(
            `(${context.findTableText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
            "gi",
        );
        const parts = text.split(regex);

        return (
            <>
                {parts.map((part, index) => {
                    // Check if this part matches the search text (case insensitive)
                    const isMatch = part.toLowerCase() === context.findTableText.toLowerCase();
                    return isMatch ? (
                        <span
                            key={index}
                            style={{
                                backgroundColor: "var(--vscode-editor-findMatchBackground)",
                                color: "var(--vscode-editor-background)",
                                padding: "0 2px",
                                borderRadius: "3px",
                            }}>
                            {part}
                        </span>
                    ) : (
                        <span key={index}>{part}</span>
                    );
                })}
            </>
        );
    };

    // Render table name with rename visualization (T038, T040)
    const renderTableName = () => {
        const currentName = `${table.schema}.${table.name}`;

        // If ghost node, show as deleted
        if (isGhostNode) {
            return (
                <span className="table-name--old" style={{ marginRight: 0 }}>
                    {currentName}
                </span>
            );
        }

        // If table was renamed, show old name with strikethrough
        if (renameInfo) {
            return (
                <span className="table-name--rename-container">
                    <span className="table-name--old">{renameInfo.oldDisplayName}</span>
                    <span className="table-name--rename-arrow">→</span>
                    <span className="table-name--new">
                        {context.isExporting ? currentName : highlightText(currentName)}
                    </span>
                </span>
            );
        }

        // Normal display
        return context.isExporting ? currentName : highlightText(currentName);
    };

    return (
        <div className={styles.tableHeader}>
            <div className={styles.tableHeaderRow}>
                <FluentIcons.TableRegular className={styles.tableIcon} />
                <ConditionalTooltip
                    content={
                        renameInfo
                            ? `${renameInfo.oldDisplayName} → ${table.schema}.${table.name}`
                            : `${table.schema}.${table.name}`
                    }
                    relationship="label">
                    <Text
                        className={
                            context.isExporting ? styles.tableTitleExporting : styles.tableTitle
                        }>
                        {renderTableName()}
                    </Text>
                </ConditionalTooltip>
                {!context.isExporting && !isGhostNode && <TableHeaderActions table={table} />}
            </div>
            <div className={styles.tableSubtitle}>
                {locConstants.schemaDesigner.tableNodeSubText(table.columns.length)}
            </div>
        </div>
    );
};

/**
 * Get the CSS class for a column diff indicator based on change type
 */
function getColumnIndicatorClass(
    changeType: SchemaDesigner.SchemaChangeType | undefined,
): string | undefined {
    if (!changeType) {
        return undefined;
    }
    switch (changeType) {
        case SchemaDesigner.SchemaChangeType.Addition:
            return "column-diff-indicator column-diff-indicator--addition";
        case SchemaDesigner.SchemaChangeType.Modification:
            return "column-diff-indicator column-diff-indicator--modification";
        case SchemaDesigner.SchemaChangeType.Deletion:
            return "column-diff-indicator column-diff-indicator--deletion";
        default:
            return undefined;
    }
}

// TableColumn component for rendering a single column
const TableColumn = ({
    column,
    table,
    isDeleted = false,
}: {
    column: SchemaDesigner.Column;
    table: SchemaDesigner.Table;
    isDeleted?: boolean;
}) => {
    const styles = useStyles();
    const context = useContext(SchemaDesignerContext);

    // Check if this column is a foreign key
    const isForeignKey = table.foreignKeys.some((fk) => fk.columns.includes(column.name));

    // Get diff indicator state for this column
    const { showIndicator, changeType } = useColumnDiffIndicator(table.id, column.name);
    const indicatorClass = getColumnIndicatorClass(changeType);

    // Build class for the column container
    const columnClassName = mergeClasses("column", isDeleted && "column--deleted");

    return (
        <div className={columnClassName} key={column.name}>
            <Handle
                type="source"
                position={Position.Left}
                id={`left-${column.name}`}
                isConnectable={true}
                className={styles.handleLeft}
            />

            {/* Diff indicator dot */}
            {showIndicator && indicatorClass && <span className={indicatorClass} />}

            {column.isPrimaryKey && <PrimaryKeyIcon className={styles.keyIcon} />}
            {!column.isPrimaryKey && isForeignKey && <ForeignKeyIcon className={styles.keyIcon} />}

            <ConditionalTooltip content={column.name} relationship="label">
                <Text
                    className={mergeClasses(
                        context.isExporting ? styles.columnNameExporting : styles.columnName,
                        "columnName",
                    )}
                    style={{
                        paddingLeft:
                            column.isPrimaryKey || isForeignKey || showIndicator ? "0px" : "30px",
                    }}>
                    {column.name}
                </Text>
            </ConditionalTooltip>

            <Text className={mergeClasses(styles.columnType, "columnType")}>
                {column.isComputed ? "COMPUTED" : column.dataType?.toUpperCase()}
            </Text>

            <Handle
                type="source"
                position={Position.Right}
                id={`right-${column.name}`}
                isConnectable={true}
                className={styles.handleRight}
            />
        </div>
    );
};

// DeletedColumn component for rendering a deleted column inline
const DeletedColumn = ({
    columnInfo,
    table: _table,
}: {
    columnInfo: { name: string; dataType: string; isPrimaryKey: boolean; originalIndex: number };
    table: SchemaDesigner.Table;
}) => {
    const styles = useStyles();
    const context = useContext(SchemaDesignerContext);

    // Check if this column was a foreign key (we can't know for sure since it's deleted)
    const isForeignKey = false;

    return (
        <div className="column column--deleted" key={`deleted-${columnInfo.name}`}>
            <Handle
                type="source"
                position={Position.Left}
                id={`left-${columnInfo.name}`}
                isConnectable={false}
                className={styles.handleLeft}
                style={{ visibility: "hidden" }}
            />

            {/* Deletion indicator dot */}
            <span className="column-diff-indicator column-diff-indicator--deletion" />

            {columnInfo.isPrimaryKey && <PrimaryKeyIcon className={styles.keyIcon} />}
            {!columnInfo.isPrimaryKey && isForeignKey && (
                <ForeignKeyIcon className={styles.keyIcon} />
            )}

            <ConditionalTooltip content={columnInfo.name} relationship="label">
                <Text
                    className={mergeClasses(
                        context.isExporting ? styles.columnNameExporting : styles.columnName,
                        "columnName",
                    )}
                    style={{ paddingLeft: columnInfo.isPrimaryKey ? "0px" : "0px" }}>
                    {columnInfo.name}
                </Text>
            </ConditionalTooltip>

            <Text className={mergeClasses(styles.columnType, "columnType")}>
                {columnInfo.dataType?.toUpperCase() || "UNKNOWN"}
            </Text>

            <Handle
                type="source"
                position={Position.Right}
                id={`right-${columnInfo.name}`}
                isConnectable={false}
                className={styles.handleRight}
                style={{ visibility: "hidden" }}
            />
        </div>
    );
};

// ConsolidatedHandles component for rendering invisible handles of hidden columns
const ConsolidatedHandles = ({ hiddenColumns }: { hiddenColumns: SchemaDesigner.Column[] }) => {
    return (
        <div
            style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                height: "32px", // Approximate height of the collapse button
                pointerEvents: "none",
                zIndex: 1,
            }}>
            {hiddenColumns.map((column) => (
                <div key={column.name}>
                    <Handle
                        type="source"
                        position={Position.Left}
                        id={`left-${column.name}`}
                        isConnectable={true}
                        style={{
                            visibility: "hidden",
                            position: "absolute",
                            left: 0,
                            top: "50%",
                            transform: "translateY(-50%)",
                        }}
                    />
                    <Handle
                        type="source"
                        position={Position.Right}
                        id={`right-${column.name}`}
                        isConnectable={true}
                        style={{
                            visibility: "hidden",
                            position: "absolute",
                            right: 0,
                            top: "50%",
                            transform: "translateY(-50%)",
                        }}
                    />
                </div>
            ))}
        </div>
    );
};

// TableColumns component for rendering all columns
const TableColumns = ({
    columns,
    table,
    isCollapsed,
    onToggleCollapse,
}: {
    columns: SchemaDesigner.Column[];
    table: SchemaDesigner.Table;
    isCollapsed: boolean;
    onToggleCollapse: () => void;
}) => {
    const styles = useStyles();
    const context = useContext(SchemaDesignerContext);

    // Get deleted columns for this table
    const deletedColumnsList = useDeletedColumns(table.id);

    // Get setting from webview state, default to true if not set
    const expandCollapseEnabled = context.state?.enableExpandCollapseButtons ?? true;

    // Create a merged list of current and deleted columns
    // Deleted columns are inserted at their original positions
    type MergedColumn =
        | { type: "current"; column: SchemaDesigner.Column; index: number }
        | {
              type: "deleted";
              columnInfo: {
                  name: string;
                  dataType: string;
                  isPrimaryKey: boolean;
                  originalIndex: number;
              };
          };

    const mergedColumns: MergedColumn[] = [];

    // Add current columns with their indices
    columns.forEach((column, index) => {
        mergedColumns.push({ type: "current", column, index });
    });

    // Insert deleted columns at their original positions
    deletedColumnsList.forEach((deletedCol) => {
        mergedColumns.push({ type: "deleted", columnInfo: deletedCol });
    });

    // Sort by original index (deleted columns) or current index (existing columns)
    // Deleted columns should appear near their original position
    mergedColumns.sort((a, b) => {
        const aIndex = a.type === "deleted" ? a.columnInfo.originalIndex : a.index;
        const bIndex = b.type === "deleted" ? b.columnInfo.originalIndex : b.index;
        // If indices are equal, deleted columns go after current columns
        if (aIndex === bIndex) {
            return a.type === "deleted" ? 1 : -1;
        }
        return aIndex - bIndex;
    });

    const showCollapseButton = expandCollapseEnabled && mergedColumns.length > 10;
    const visibleMergedColumns =
        showCollapseButton && isCollapsed ? mergedColumns.slice(0, 10) : mergedColumns;
    const hiddenCurrentColumns =
        showCollapseButton && isCollapsed
            ? columns.filter((_, index) => {
                  // Find all current columns that would be hidden
                  const mergedIndex = mergedColumns.findIndex(
                      (m) => m.type === "current" && m.index === index,
                  );
                  return mergedIndex >= 10;
              })
            : [];

    const EXPAND = l10n.t("Expand");
    const COLLAPSE = l10n.t("Collapse");

    return (
        <div style={{ position: "relative" }}>
            {/* Always render all column handles for consistency */}
            {hiddenCurrentColumns.length > 0 && (
                <ConsolidatedHandles hiddenColumns={hiddenCurrentColumns} />
            )}

            {visibleMergedColumns.map((item, index) =>
                item.type === "current" ? (
                    <TableColumn
                        key={`${index}-${item.column.name}`}
                        column={item.column}
                        table={table}
                    />
                ) : (
                    <DeletedColumn
                        key={`deleted-${index}-${item.columnInfo.name}`}
                        columnInfo={item.columnInfo}
                        table={table}
                    />
                ),
            )}

            {showCollapseButton && (
                <Button
                    className={styles.collapseButton}
                    onClick={onToggleCollapse}
                    appearance="subtle"
                    icon={
                        isCollapsed ? (
                            <FluentIcons.ChevronDownRegular />
                        ) : (
                            <FluentIcons.ChevronUpRegular />
                        )
                    }
                    tabIndex={0}>
                    {isCollapsed ? <span>{EXPAND}</span> : <span>{COLLAPSE}</span>}
                </Button>
            )}
        </div>
    );
};

/**
 * Get the diff indicator class based on the aggregate state
 */
function getDiffIndicatorClass(
    styles: ReturnType<typeof useStyles>,
    aggregateState: SchemaDesigner.SchemaChangeType | undefined,
): string | undefined {
    if (!aggregateState) {
        return undefined;
    }

    switch (aggregateState) {
        case SchemaDesigner.SchemaChangeType.Addition:
            return styles.diffIndicatorAdded;
        case SchemaDesigner.SchemaChangeType.Modification:
            return styles.diffIndicatorModified;
        case SchemaDesigner.SchemaChangeType.Deletion:
            return styles.diffIndicatorDeleted;
        default:
            return undefined;
    }
}

// Main SchemaDesignerTableNode component
export const SchemaDesignerTableNode = (props: NodeProps) => {
    const styles = useStyles();
    const table = props.data as SchemaDesigner.Table;
    // Default to collapsed state if table has more than 10 columns
    const [isCollapsed, setIsCollapsed] = useState(table.columns.length > 10);

    // Get ghost node and rename info from data (T016, T038)
    const isGhostNode = (props.data as { isGhostNode?: boolean })?.isGhostNode ?? false;
    const renameInfo = (props.data as { renameInfo?: SchemaDesigner.RenameDisplayInfo })
        ?.renameInfo;

    // Get diff indicator state for this table
    const { showIndicator, aggregateState } = useTableDiffIndicator(table.id);

    // Get reveal highlight state from diff viewer context
    const { state: diffState, clearRevealHighlight } = useDiffViewer();
    const isHighlighted =
        diffState?.highlightedElementId === table.id &&
        diffState?.highlightedElementType === "table";

    const handleToggleCollapse = () => {
        setIsCollapsed(!isCollapsed);
    };

    const handleAnimationEnd = () => {
        if (isHighlighted) {
            clearRevealHighlight();
        }
    };

    // Build class names for the container (T017)
    const containerClassName = mergeClasses(
        styles.tableNodeContainer,
        showIndicator && getDiffIndicatorClass(styles, aggregateState),
        isHighlighted && "schema-node--revealed",
        isGhostNode && "schema-node--ghost",
    );

    return (
        <div className={containerClassName} onAnimationEnd={handleAnimationEnd}>
            {(props.data?.dimmed as boolean) && <div className={styles.tableOverlay} />}
            {isGhostNode && <div className={styles.tableOverlay} style={{ opacity: 0.5 }} />}
            <TableHeader table={table} isGhostNode={isGhostNode} renameInfo={renameInfo} />
            <Divider />
            <TableColumns
                columns={table.columns}
                table={table}
                isCollapsed={isCollapsed}
                onToggleCollapse={handleToggleCollapse}
            />
        </div>
    );
};
