/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Divider,
    makeStyles,
    mergeClasses,
    Menu,
    MenuButton,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
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
        const timeoutId = setTimeout(checkOverflow, 0);

        // Check overflow on window resize
        window.addEventListener("resize", checkOverflow);

        return () => {
            clearTimeout(timeoutId);
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
    },
    tableNodeDiffAdded: {
        boxShadow: "0 0 0 2px var(--vscode-gitDecoration-addedResourceForeground)",
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
    columnDiffAdded: {
        backgroundColor: "var(--vscode-diffEditor-insertedTextBackground)",
        boxShadow: "inset 0 0 0 1px var(--vscode-gitDecoration-addedResourceForeground)",
        borderRadius: "3px",
    },
    columnDiffModified: {
        backgroundColor:
            "var(--vscode-editorGutter-modifiedBackground, var(--vscode-diffEditor-modifiedTextBackground))",
        boxShadow: "inset 0 0 0 1px var(--vscode-gitDecoration-modifiedResourceForeground)",
        borderRadius: "3px",
    },
    columnDiffModifiedOther: {
        backgroundColor:
            "var(--vscode-editorWarning-background, var(--vscode-inputValidation-warningBackground, var(--vscode-diffEditor-modifiedTextBackground)))",
        boxShadow: "inset 0 0 0 1px var(--vscode-editorWarning-foreground)",
        borderRadius: "3px",
    },
    columnDiffValueGroup: {
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
    },
    columnDiffOldValue: {
        textDecorationLine: "line-through",
        opacity: 0.7,
    },
    tableDiffValueGroup: {
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
    },
    tableDiffOldValue: {
        textDecorationLine: "line-through",
        opacity: 0.7,
    },
    tableTitleDiffModified: {
        backgroundColor:
            "var(--vscode-editorWarning-background, var(--vscode-inputValidation-warningBackground, var(--vscode-diffEditor-modifiedTextBackground)))",
        boxShadow: "inset 0 0 0 1px var(--vscode-editorWarning-foreground)",
        borderRadius: "3px",
        padding: "0 4px",
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
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
const TableHeader = ({ table }: { table: SchemaDesigner.Table }) => {
    const styles = useStyles();
    const context = useContext(SchemaDesignerContext);
    const tableHighlight = context.modifiedTableHighlights.get(table.id);
    const showQualifiedDiff =
        context.isChangesPanelVisible &&
        (Boolean(tableHighlight?.schemaChange) || Boolean(tableHighlight?.nameChange));

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

    const tooltipContent = `${table.schema}.${table.name}`;
    const oldSchema = tableHighlight?.schemaChange?.oldValue ?? table.schema;
    const newSchema = tableHighlight?.schemaChange?.newValue ?? table.schema;
    const oldName = tableHighlight?.nameChange?.oldValue ?? table.name;
    const newName = tableHighlight?.nameChange?.newValue ?? table.name;
    const oldQualified = `${oldSchema}.${oldName}`;
    const newQualified = `${newSchema}.${newName}`;

    return (
        <div className={styles.tableHeader}>
            <div className={styles.tableHeaderRow}>
                <FluentIcons.TableRegular className={styles.tableIcon} />
                <ConditionalTooltip content={tooltipContent} relationship="label">
                    <Text
                        className={mergeClasses(
                            context.isExporting ? styles.tableTitleExporting : styles.tableTitle,
                            showQualifiedDiff && styles.tableTitleDiffModified,
                        )}>
                        {context.isExporting ? (
                            tooltipContent
                        ) : showQualifiedDiff ? (
                            <span className={styles.tableDiffValueGroup}>
                                <span className={styles.tableDiffOldValue}>{oldQualified}</span>
                                <span>{newQualified}</span>
                            </span>
                        ) : (
                            highlightText(tooltipContent)
                        )}
                    </Text>
                </ConditionalTooltip>
                {!context.isExporting && <TableHeaderActions table={table} />}
            </div>
            <div className={styles.tableSubtitle}>
                {locConstants.schemaDesigner.tableNodeSubText(table.columns.length)}
            </div>
        </div>
    );
};

// TableColumn component for rendering a single column
const TableColumn = ({
    column,
    table,
}: {
    column: SchemaDesigner.Column;
    table: SchemaDesigner.Table;
}) => {
    const styles = useStyles();
    const context = useContext(SchemaDesignerContext);

    // Check if this column is a foreign key
    const isForeignKey = table.foreignKeys.some((fk) => fk.columns.includes(column.name));
    const showAddedDiff = context.isChangesPanelVisible && context.newColumnIds.has(column.id);
    const modifiedHighlight = context.modifiedColumnHighlights.get(column.id);
    const hasNameChange = Boolean(modifiedHighlight?.nameChange);
    const hasDataTypeChange = Boolean(modifiedHighlight?.dataTypeChange);
    const showNameDiff = context.isChangesPanelVisible && hasNameChange;
    const showDataTypeDiff = context.isChangesPanelVisible && hasDataTypeChange;
    const showModifiedDiff = showNameDiff || showDataTypeDiff;
    const showModifiedOther =
        context.isChangesPanelVisible && !showModifiedDiff && modifiedHighlight?.hasOtherChanges;

    const renderName = () => {
        if (!showNameDiff || !modifiedHighlight?.nameChange) {
            return column.name;
        }

        return (
            <span className={styles.columnDiffValueGroup}>
                <span className={styles.columnDiffOldValue}>
                    {modifiedHighlight.nameChange.oldValue}
                </span>
                <span>{modifiedHighlight.nameChange.newValue}</span>
            </span>
        );
    };

    const renderDataType = () => {
        if (column.isComputed) {
            return "COMPUTED";
        }

        if (!showDataTypeDiff || !modifiedHighlight?.dataTypeChange) {
            return column.dataType?.toUpperCase();
        }

        return (
            <span className={styles.columnDiffValueGroup}>
                <span className={styles.columnDiffOldValue}>
                    {modifiedHighlight.dataTypeChange.oldValue.toUpperCase()}
                </span>
                <span>{modifiedHighlight.dataTypeChange.newValue.toUpperCase()}</span>
            </span>
        );
    };

    return (
        <div
            className={mergeClasses(
                "column",
                showAddedDiff && styles.columnDiffAdded,
                showModifiedDiff && styles.columnDiffModified,
                showModifiedOther && styles.columnDiffModifiedOther,
            )}
            key={column.name}>
            <Handle
                type="source"
                position={Position.Left}
                id={`left-${column.id}`}
                isConnectable={true}
                className={styles.handleLeft}
            />

            {column.isPrimaryKey && <PrimaryKeyIcon className={styles.keyIcon} />}
            {!column.isPrimaryKey && isForeignKey && <ForeignKeyIcon className={styles.keyIcon} />}

            <ConditionalTooltip content={column.name} relationship="label">
                <Text
                    className={context.isExporting ? styles.columnNameExporting : styles.columnName}
                    style={{ paddingLeft: column.isPrimaryKey || isForeignKey ? "0px" : "30px" }}>
                    {renderName()}
                </Text>
            </ConditionalTooltip>

            <Text className={styles.columnType}>{renderDataType()}</Text>

            <Handle
                type="source"
                position={Position.Right}
                id={`right-${column.id}`}
                isConnectable={true}
                className={styles.handleRight}
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
                <div key={column.id}>
                    <Handle
                        type="source"
                        position={Position.Left}
                        id={`left-${column.id}`}
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
                        id={`right-${column.id}`}
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

    // Get setting from webview state, default to true if not set
    const expandCollapseEnabled = context.state?.enableExpandCollapseButtons ?? true;

    const showCollapseButton = expandCollapseEnabled && columns.length > 10;
    const visibleColumns = showCollapseButton && isCollapsed ? columns.slice(0, 10) : columns;
    const hiddenColumns = showCollapseButton && isCollapsed ? columns.slice(10) : [];

    const EXPAND = l10n.t("Expand");
    const COLLAPSE = l10n.t("Collapse");

    return (
        <div style={{ position: "relative" }}>
            {/* Always render all column handles for consistency */}
            {hiddenColumns.length > 0 && <ConsolidatedHandles hiddenColumns={hiddenColumns} />}

            {visibleColumns.map((column, index) => (
                <TableColumn key={`${index}-${column.name}`} column={column} table={table} />
            ))}

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

// Main SchemaDesignerTableNode component
export const SchemaDesignerTableNode = (props: NodeProps) => {
    const styles = useStyles();
    const context = useContext(SchemaDesignerContext);
    const table = props.data as SchemaDesigner.Table;
    // Default to collapsed state if table has more than 10 columns
    const [isCollapsed, setIsCollapsed] = useState(table.columns.length > 10);

    const handleToggleCollapse = () => {
        setIsCollapsed(!isCollapsed);
    };

    const showAddedDiff = context.isChangesPanelVisible && context.newTableIds.has(table.id);

    return (
        <div
            className={mergeClasses(
                styles.tableNodeContainer,
                showAddedDiff && styles.tableNodeDiffAdded,
            )}>
            {(props.data?.dimmed as boolean) && <div className={styles.tableOverlay} />}
            <TableHeader table={table} />
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
