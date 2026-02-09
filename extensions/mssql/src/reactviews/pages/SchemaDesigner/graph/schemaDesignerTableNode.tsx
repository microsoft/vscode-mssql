/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
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
import { useCallback, useContext, useRef, useEffect, useState, cloneElement } from "react";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import eventBus from "../schemaDesignerEvents";
import { LAYOUT_CONSTANTS } from "../schemaDesignerUtils";
import * as l10n from "@vscode/l10n";
import { ForeignKeyIcon } from "../../../common/icons/foreignKey";
import { PrimaryKeyIcon } from "../../../common/icons/primaryKey";
import { mergeColumnsWithDeleted } from "../diff/deletedVisualUtils";
import { ChangeAction, ChangeCategory, type SchemaChange } from "../diff/diffUtils";
import { PendingAiItem } from "../aiLedger/operations";

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
        position: "relative",
        overflow: "visible",
    },
    tableNodeDiffAdded: {
        boxShadow: "0 0 0 2px var(--vscode-gitDecoration-addedResourceForeground)",
    },
    tableNodeDeleted: {
        boxShadow: "0 0 0 2px var(--vscode-gitDecoration-deletedResourceForeground)",
    },
    tableNodeDiffModified: {
        boxShadow: "0 0 0 2px var(--vscode-gitDecoration-modifiedResourceForeground)",
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
        marginBottom: "4px",
    },
    tableHeaderDiffModified: {
        backgroundColor:
            "var(--vscode-editorWarning-background, var(--vscode-inputValidation-warningBackground, var(--vscode-diffEditor-modifiedTextBackground)))",
        boxShadow: "inset 0 0 0 1px var(--vscode-editorWarning-foreground)",
        borderRadius: "3px",
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
            "var(--vscode-editorWarning-background, var(--vscode-inputValidation-warningBackground, var(--vscode-diffEditor-modifiedTextBackground)))",
        boxShadow: "inset 0 0 0 1px var(--vscode-gitDecoration-modifiedResourceForeground)",
        borderRadius: "3px",
    },
    columnDiffModifiedOther: {
        backgroundColor:
            "var(--vscode-editorWarning-background, var(--vscode-inputValidation-warningBackground, var(--vscode-diffEditor-modifiedTextBackground)))",
        boxShadow: "inset 0 0 0 1px var(--vscode-editorWarning-foreground)",
        borderRadius: "3px",
    },
    columnDiffDeleted: {
        backgroundColor:
            "var(--vscode-diffEditor-removedTextBackground, var(--vscode-inputValidation-errorBackground))",
        boxShadow: "inset 0 0 0 1px var(--vscode-gitDecoration-deletedResourceForeground)",
        borderRadius: "3px",
    },
    columnUndoButtonWrapper: {
        position: "absolute",
        top: "50%",
        right: "-22px",
        transform: "translateY(-50%)",
        zIndex: 2,
        padding: "10px",
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
        gap: "2px",
        flexDirection: "column",
    },
    tableDiffOldValue: {
        textDecorationLine: "line-through",
        opacity: 0.7,
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
    tableContentDisabled: {
        pointerEvents: "none",
        userSelect: "none",
        filter: "grayscale(0.6)",
        opacity: 0.75,
    },
    undoButtonWrapper: {
        position: "absolute",
        top: "-25px",
        right: "-25px",
        zIndex: 11,
        padding: "16px",
    },
    aiActionsToolbar: {
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "2px",
        backgroundColor: "var(--vscode-editorWidget-background)",
        border: "1px solid var(--vscode-editorWidget-border)",
        borderRadius: "6px",
    },
    aiIndicator: {
        display: "inline-flex",
        alignItems: "center",
        marginLeft: "2px",
        marginRight: "2px",
    },
    aiTableIndicator: {
        position: "absolute",
        left: "-18px",
        top: "8px",
        zIndex: 12,
        color: "#d4af37",
        pointerEvents: "none",
    },
    aiColumnIndicator: {
        position: "absolute",
        left: "-16px",
        top: "50%",
        transform: "translateY(-50%)",
        zIndex: 3,
        color: "#d4af37",
        pointerEvents: "none",
    },
});

const toPendingAiSchemaChange = (item: PendingAiItem): SchemaChange => ({
    id: `ai-${item.key}`,
    action: item.action,
    category: item.category,
    tableId: item.tableId,
    tableName: item.currentTableName ?? item.tableName,
    tableSchema: item.currentTableSchema ?? item.tableSchema,
    objectId: item.objectId,
    objectName: item.objectName,
    propertyChanges: item.propertyChanges,
});

const getPropertyChange = (
    change: SchemaChange | undefined,
    property: string,
): { oldValue: string; newValue: string } | undefined => {
    const propertyChange = change?.propertyChanges?.find((entry) => entry.property === property);
    if (!propertyChange) {
        return undefined;
    }

    return {
        oldValue:
            propertyChange.oldValue === null || propertyChange.oldValue === undefined
                ? ""
                : String(propertyChange.oldValue),
        newValue:
            propertyChange.newValue === null || propertyChange.newValue === undefined
                ? ""
                : String(propertyChange.newValue),
    };
};

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
    isPendingAiMode,
    pendingAiTableChange,
}: {
    table: SchemaDesigner.TableWithDeletedFlag;
    isPendingAiMode: boolean;
    pendingAiTableChange?: SchemaChange;
}) => {
    const styles = useStyles();
    const context = useContext(SchemaDesignerContext);
    const isDeletedTable = table.isDeleted === true;
    const tableHighlight = context.modifiedTableHighlights.get(table.id);
    const aiSchemaChange = getPropertyChange(pendingAiTableChange, "schema");
    const aiNameChange = getPropertyChange(pendingAiTableChange, "name");
    const showAiQualifiedDiff =
        isPendingAiMode &&
        pendingAiTableChange?.action === ChangeAction.Modify &&
        (Boolean(aiSchemaChange) || Boolean(aiNameChange));
    const showQualifiedDiff =
        !isDeletedTable &&
        context.showChangesHighlight &&
        (showAiQualifiedDiff ||
            (!isPendingAiMode &&
                (Boolean(tableHighlight?.schemaChange) || Boolean(tableHighlight?.nameChange))));

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
    const oldSchema = showAiQualifiedDiff
        ? (aiSchemaChange?.oldValue ?? table.schema)
        : (tableHighlight?.schemaChange?.oldValue ?? table.schema);
    const newSchema = showAiQualifiedDiff
        ? (aiSchemaChange?.newValue ?? table.schema)
        : (tableHighlight?.schemaChange?.newValue ?? table.schema);
    const oldName = showAiQualifiedDiff
        ? (aiNameChange?.oldValue ?? table.name)
        : (tableHighlight?.nameChange?.oldValue ?? table.name);
    const newName = showAiQualifiedDiff
        ? (aiNameChange?.newValue ?? table.name)
        : (tableHighlight?.nameChange?.newValue ?? table.name);
    const oldQualified = `${oldSchema}.${oldName}`;
    const newQualified = `${newSchema}.${newName}`;

    return (
        <div
            className={mergeClasses(
                styles.tableHeader,
                showQualifiedDiff && styles.tableHeaderDiffModified,
            )}>
            <div className={styles.tableHeaderRow}>
                <FluentIcons.TableRegular className={styles.tableIcon} />
                <ConditionalTooltip content={tooltipContent} relationship="label">
                    <Text
                        className={mergeClasses(
                            context.isExporting ? styles.tableTitleExporting : styles.tableTitle,
                        )}>
                        {context.isExporting ? (
                            tooltipContent
                        ) : showQualifiedDiff ? (
                            <span className={styles.tableDiffValueGroup}>
                                <span>{newQualified}</span>
                                <span className={styles.tableDiffOldValue}>{oldQualified}</span>
                            </span>
                        ) : (
                            highlightText(tooltipContent)
                        )}
                    </Text>
                </ConditionalTooltip>
                {!context.isExporting && !isDeletedTable && <TableHeaderActions table={table} />}
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
    isTableDeleted,
    isPendingAiMode,
    pendingAiChange,
    suppressPendingAiColumnVisuals,
    isApplyingPendingAiAction,
    onKeepPendingAiChange,
    onUndoPendingAiChange,
    onRequestUndo,
}: {
    column: SchemaDesigner.ColumnWithDeletedFlag;
    table: SchemaDesigner.TableWithDeletedFlag;
    isTableDeleted: boolean;
    isPendingAiMode: boolean;
    pendingAiChange?: SchemaChange;
    suppressPendingAiColumnVisuals: boolean;
    isApplyingPendingAiAction: boolean;
    onKeepPendingAiChange: (change: SchemaChange) => void;
    onUndoPendingAiChange: (change: SchemaChange) => Promise<void>;
    onRequestUndo: (change: SchemaChange) => void;
}) => {
    const styles = useStyles();
    const context = useContext(SchemaDesignerContext);
    const undoWrapperRef = useRef<HTMLDivElement | null>(null);
    const [isHovered, setIsHovered] = useState(false);
    const isDeletedColumn = column.isDeleted === true;
    const isConnectable = !isDeletedColumn && !isTableDeleted;

    // Check if this column is a foreign key
    const isForeignKey = table.foreignKeys.some((fk) => fk.columns.includes(column.name));
    const showBaselineHighlights = context.showChangesHighlight && !isPendingAiMode;
    const effectivePendingAiChange =
        isPendingAiMode && suppressPendingAiColumnVisuals ? undefined : pendingAiChange;
    const aiNameChange = getPropertyChange(effectivePendingAiChange, "name");
    const aiDataTypeChange = getPropertyChange(effectivePendingAiChange, "dataType");
    const showDeletedDiff = isPendingAiMode
        ? effectivePendingAiChange?.action === ChangeAction.Delete
        : showBaselineHighlights && isDeletedColumn;
    const showAddedDiff = isPendingAiMode
        ? effectivePendingAiChange?.action === ChangeAction.Add
        : !isDeletedColumn &&
          !isTableDeleted &&
          showBaselineHighlights &&
          context.newColumnIds.has(column.id);
    const modifiedHighlight =
        !isDeletedColumn && !isTableDeleted
            ? context.modifiedColumnHighlights.get(column.id)
            : undefined;
    const hasNameChange = Boolean(modifiedHighlight?.nameChange);
    const hasDataTypeChange = Boolean(modifiedHighlight?.dataTypeChange);
    const showNameDiff = isPendingAiMode
        ? effectivePendingAiChange?.action === ChangeAction.Modify && Boolean(aiNameChange)
        : showBaselineHighlights && hasNameChange;
    const showDataTypeDiff = isPendingAiMode
        ? effectivePendingAiChange?.action === ChangeAction.Modify && Boolean(aiDataTypeChange)
        : showBaselineHighlights && hasDataTypeChange;
    const showModifiedDiff = isPendingAiMode
        ? effectivePendingAiChange?.action === ChangeAction.Modify
        : showNameDiff || showDataTypeDiff;
    const showModifiedOther =
        !isPendingAiMode &&
        showBaselineHighlights &&
        !showModifiedDiff &&
        modifiedHighlight?.hasOtherChanges;
    const columnChangeAction = showAddedDiff
        ? ChangeAction.Add
        : showDeletedDiff
          ? ChangeAction.Delete
          : showModifiedDiff || showModifiedOther
            ? ChangeAction.Modify
            : undefined;
    const canShowUndo =
        !isTableDeleted &&
        !context.isExporting &&
        Boolean(columnChangeAction) &&
        showBaselineHighlights;
    const columnChange = columnChangeAction
        ? ({
              id: `column:${columnChangeAction}:${table.id}:${column.id}`,
              action: columnChangeAction,
              category: ChangeCategory.Column,
              tableId: table.id,
              tableName: table.name,
              tableSchema: table.schema,
              objectId: column.id,
              objectName: column.name,
          } satisfies SchemaChange)
        : undefined;
    const revertInfo =
        isHovered && columnChange ? context.canRevertChange(columnChange) : undefined;
    const canShowPendingAiActions =
        isPendingAiMode &&
        isHovered &&
        !context.isExporting &&
        !isTableDeleted &&
        !!effectivePendingAiChange;

    const renderName = () => {
        if (isPendingAiMode && showNameDiff && aiNameChange) {
            return (
                <span className={styles.columnDiffValueGroup}>
                    <span className={styles.columnDiffOldValue}>{aiNameChange.oldValue}</span>
                    <span>{aiNameChange.newValue}</span>
                </span>
            );
        }

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

        if (isPendingAiMode && showDataTypeDiff && aiDataTypeChange) {
            return (
                <span className={styles.columnDiffValueGroup}>
                    <span className={styles.columnDiffOldValue}>
                        {aiDataTypeChange.oldValue.toUpperCase()}
                    </span>
                    <span>{aiDataTypeChange.newValue.toUpperCase()}</span>
                </span>
            );
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
                showDeletedDiff && styles.columnDiffDeleted,
            )}
            key={column.name}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={(event) => {
                if (undoWrapperRef.current?.contains(event.relatedTarget as Node)) {
                    return;
                }
                setIsHovered(false);
            }}>
            {isPendingAiMode && effectivePendingAiChange && (
                <span className={styles.aiColumnIndicator} aria-hidden="true">
                    <FluentIcons.Sparkle16Regular />
                </span>
            )}
            <Handle
                type="source"
                position={Position.Left}
                id={`left-${column.id}`}
                isConnectable={isConnectable}
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

            {canShowUndo && isHovered && columnChange && (
                <div
                    className={styles.columnUndoButtonWrapper}
                    ref={undoWrapperRef}
                    onMouseEnter={() => setIsHovered(true)}
                    onMouseLeave={() => setIsHovered(false)}>
                    <Tooltip
                        content={
                            revertInfo?.canRevert
                                ? locConstants.schemaDesigner.undo
                                : (revertInfo?.reason ?? "")
                        }
                        relationship="label">
                        <Button
                            appearance="primary"
                            size="small"
                            icon={<FluentIcons.ArrowUndo16Regular />}
                            disabled={revertInfo ? !revertInfo.canRevert : false}
                            onClick={(event) => {
                                event.stopPropagation();
                                if (revertInfo && !revertInfo.canRevert) {
                                    return;
                                }
                                onRequestUndo(columnChange);
                            }}
                        />
                    </Tooltip>
                </div>
            )}
            {canShowPendingAiActions && effectivePendingAiChange && (
                <div className={styles.columnUndoButtonWrapper}>
                    <div className={styles.aiActionsToolbar}>
                        <Tooltip content={"Keep"} relationship="label">
                            <Button
                                appearance="primary"
                                size="small"
                                icon={<FluentIcons.Checkmark16Regular />}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onKeepPendingAiChange(effectivePendingAiChange);
                                }}
                                disabled={isApplyingPendingAiAction}
                            />
                        </Tooltip>
                        <Tooltip content={locConstants.schemaDesigner.undo} relationship="label">
                            <Button
                                appearance="subtle"
                                size="small"
                                icon={<FluentIcons.ArrowUndo16Regular />}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    void onUndoPendingAiChange(effectivePendingAiChange);
                                }}
                                disabled={isApplyingPendingAiAction}
                            />
                        </Tooltip>
                    </div>
                </div>
            )}

            <Handle
                type="source"
                position={Position.Right}
                id={`right-${column.id}`}
                isConnectable={isConnectable}
                className={styles.handleRight}
            />
        </div>
    );
};

// ConsolidatedHandles component for rendering invisible handles of hidden columns
const ConsolidatedHandles = ({
    hiddenColumns,
    isTableDeleted,
}: {
    hiddenColumns: SchemaDesigner.ColumnWithDeletedFlag[];
    isTableDeleted: boolean;
}) => {
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
                        isConnectable={!column.isDeleted && !isTableDeleted}
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
                        isConnectable={!column.isDeleted && !isTableDeleted}
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
    isDeletedTable,
    isPendingAiMode,
    pendingAiColumnChangesByColumnId,
    pendingAiDeletedColumns,
    suppressPendingAiColumnVisuals,
    isApplyingPendingAiAction,
    onKeepPendingAiChange,
    onUndoPendingAiChange,
    isCollapsed,
    onToggleCollapse,
    onRequestUndo,
}: {
    columns: SchemaDesigner.Column[];
    table: SchemaDesigner.TableWithDeletedFlag;
    isDeletedTable: boolean;
    isPendingAiMode: boolean;
    pendingAiColumnChangesByColumnId: Map<string, SchemaChange>;
    pendingAiDeletedColumns: SchemaDesigner.Column[];
    suppressPendingAiColumnVisuals: boolean;
    isApplyingPendingAiAction: boolean;
    onKeepPendingAiChange: (change: SchemaChange) => void;
    onUndoPendingAiChange: (change: SchemaChange) => Promise<void>;
    isCollapsed: boolean;
    onToggleCollapse: () => void;
    onRequestUndo: (change: SchemaChange) => void;
}) => {
    const styles = useStyles();
    const context = useContext(SchemaDesignerContext);

    // Get setting from webview state, default to true if not set
    const expandCollapseEnabled = context.state?.enableExpandCollapseButtons ?? true;
    const showBaselineHighlights = context.showChangesHighlight && !isPendingAiMode;

    const deletedColumns = showBaselineHighlights
        ? (context.deletedColumnsByTable.get(table.id) ?? [])
        : isPendingAiMode
          ? pendingAiDeletedColumns
          : [];
    const baselineOrder = context.baselineColumnOrderByTable.get(table.id) ?? [];
    const mergedColumns = mergeColumnsWithDeleted(columns, deletedColumns, baselineOrder);

    const showCollapseButton =
        !isDeletedTable && expandCollapseEnabled && mergedColumns.length > 10;
    const isCollapsedView = showCollapseButton && isCollapsed;
    const visibleColumns = isCollapsedView ? mergedColumns.slice(0, 10) : mergedColumns;
    const hiddenColumns = isCollapsedView ? mergedColumns.slice(10) : [];
    const hiddenHandleColumns = hiddenColumns;

    const EXPAND = l10n.t("Expand");
    const COLLAPSE = l10n.t("Collapse");

    return (
        <div style={{ position: "relative" }}>
            {/* Always render all column handles for consistency */}
            {hiddenHandleColumns.length > 0 && (
                <ConsolidatedHandles
                    hiddenColumns={hiddenHandleColumns}
                    isTableDeleted={isDeletedTable}
                />
            )}

            {visibleColumns.map((column, index) => (
                <TableColumn
                    key={`${index}-${column.name}`}
                    column={column}
                    table={table}
                    isTableDeleted={isDeletedTable}
                    isPendingAiMode={isPendingAiMode}
                    pendingAiChange={pendingAiColumnChangesByColumnId.get(column.id)}
                    suppressPendingAiColumnVisuals={suppressPendingAiColumnVisuals}
                    isApplyingPendingAiAction={isApplyingPendingAiAction}
                    onKeepPendingAiChange={onKeepPendingAiChange}
                    onUndoPendingAiChange={onUndoPendingAiChange}
                    onRequestUndo={onRequestUndo}
                />
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
    const table = props.data as SchemaDesigner.TableWithDeletedFlag;
    const isDeletedTable = table.isDeleted === true;
    // Default to collapsed state if table has more than 10 columns
    const [isCollapsed, setIsCollapsed] = useState(!isDeletedTable && table.columns.length > 10);
    const [isHovered, setIsHovered] = useState(false);
    const [isUndoDialogOpen, setIsUndoDialogOpen] = useState(false);
    const [pendingUndoChange, setPendingUndoChange] = useState<SchemaChange | null>(null);
    const [isApplyingPendingAiAction, setIsApplyingPendingAiAction] = useState(false);
    const undoWrapperRef = useRef<HTMLDivElement | null>(null);
    const pendingAiMode = context.isChangesPanelVisible && context.changesPanelTab === "pendingAi";

    const pendingAiGroup = pendingAiMode
        ? context.aiLedger.find((group) => group.tableId === table.id)
        : undefined;
    const pendingAiTableChange = pendingAiGroup
        ? (() => {
              const tableItem = pendingAiGroup.items.find(
                  (item) => item.category === ChangeCategory.Table,
              );
              return tableItem ? toPendingAiSchemaChange(tableItem) : undefined;
          })()
        : undefined;
    const pendingAiTableOrForeignKeyChange = pendingAiGroup
        ? (() => {
              if (pendingAiTableChange) {
                  return pendingAiTableChange;
              }
              const foreignKeyItem = pendingAiGroup.items.find(
                  (item) => item.category === ChangeCategory.ForeignKey,
              );
              return foreignKeyItem ? toPendingAiSchemaChange(foreignKeyItem) : undefined;
          })()
        : undefined;
    const pendingAiColumnChangesByColumnId = new Map<string, SchemaChange>(
        (pendingAiGroup?.items ?? [])
            .filter(
                (item) =>
                    item.category === ChangeCategory.Column && typeof item.objectId === "string",
            )
            .map((item) => [item.objectId as string, toPendingAiSchemaChange(item)]),
    );
    const pendingAiDeletedColumns = [
        ...new Map(
            (pendingAiGroup?.items ?? [])
                .filter(
                    (item) =>
                        item.category === ChangeCategory.Column &&
                        item.action === ChangeAction.Delete,
                )
                .map((item) => {
                    const deletedColumn = item.baselineSnapshot as SchemaDesigner.Column | null;
                    return [deletedColumn?.id ?? item.objectId ?? item.key, deletedColumn];
                }),
        ).values(),
    ].filter((column): column is SchemaDesigner.Column => Boolean(column));
    const hasPendingAiChanges = (pendingAiGroup?.items.length ?? 0) > 0;
    const isPendingAiNewTable = pendingAiTableChange?.action === ChangeAction.Add;
    const hasPendingAiNonTableChanges =
        pendingAiGroup?.items.some((item) => item.category !== ChangeCategory.Table) ?? false;

    const handleToggleCollapse = () => {
        setIsCollapsed(!isCollapsed);
    };
    const handleKeepPendingAiChange = useCallback(
        (change: SchemaChange) => {
            context.keepAiLedgerChange(change);
        },
        [context],
    );
    const handleUndoPendingAiChange = useCallback(
        async (change: SchemaChange) => {
            if (isApplyingPendingAiAction) {
                return;
            }
            setIsApplyingPendingAiAction(true);
            try {
                await context.undoAiLedgerChange(change);
            } finally {
                setIsApplyingPendingAiAction(false);
            }
        },
        [context, isApplyingPendingAiAction],
    );

    const showAddedDiff = pendingAiMode
        ? pendingAiTableChange?.action === ChangeAction.Add
        : !isDeletedTable && context.showChangesHighlight && context.newTableIds.has(table.id);
    const showDeletedDiff = pendingAiMode
        ? pendingAiTableChange?.action === ChangeAction.Delete
        : isDeletedTable && context.showChangesHighlight;
    const showModifiedDiff = pendingAiMode
        ? hasPendingAiChanges &&
          pendingAiTableChange?.action !== ChangeAction.Add &&
          pendingAiTableChange?.action !== ChangeAction.Delete &&
          (pendingAiTableChange?.action === ChangeAction.Modify || hasPendingAiNonTableChanges)
        : !isDeletedTable &&
          context.showChangesHighlight &&
          context.modifiedTableHighlights.has(table.id);
    const tableChangeAction = showDeletedDiff
        ? ChangeAction.Delete
        : showAddedDiff
          ? ChangeAction.Add
          : showModifiedDiff
            ? ChangeAction.Modify
            : undefined;
    const showUndoButton =
        !pendingAiMode &&
        Boolean(tableChangeAction) &&
        !context.isExporting &&
        (isHovered || isUndoDialogOpen);
    const showPendingAiTableActions =
        pendingAiMode &&
        Boolean(pendingAiTableOrForeignKeyChange) &&
        !context.isExporting &&
        isHovered;
    const tableChange = tableChangeAction
        ? ({
              id: `table:${tableChangeAction}:${table.id}`,
              action: tableChangeAction,
              category: ChangeCategory.Table,
              tableId: table.id,
              tableName: table.name,
              tableSchema: table.schema,
          } satisfies SchemaChange)
        : undefined;
    const revertInfo = tableChange ? context.canRevertChange(tableChange) : undefined;
    const handleUndo = () => {
        if (!pendingUndoChange) {
            return;
        }
        context.revertChange(pendingUndoChange);
    };
    const handleRequestUndo = (change: SchemaChange) => {
        setPendingUndoChange(change);
        setIsUndoDialogOpen(true);
    };

    return (
        <div
            className={mergeClasses(
                styles.tableNodeContainer,
                showAddedDiff && styles.tableNodeDiffAdded,
                showModifiedDiff && styles.tableNodeDiffModified,
                isDeletedTable && styles.tableNodeDeleted,
            )}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={(event) => {
                if (undoWrapperRef.current?.contains(event.relatedTarget as Node)) {
                    return;
                }
                setIsHovered(false);
            }}>
            {(props.data?.dimmed as boolean) && <div className={styles.tableOverlay} />}
            {showUndoButton && (
                <div
                    className={styles.undoButtonWrapper}
                    ref={undoWrapperRef}
                    onMouseEnter={() => setIsHovered(true)}
                    onMouseLeave={() => setIsHovered(false)}>
                    <Tooltip
                        content={
                            revertInfo?.canRevert
                                ? locConstants.schemaDesigner.undo
                                : (revertInfo?.reason ?? "")
                        }
                        relationship="label">
                        <Button
                            appearance="primary"
                            size="small"
                            icon={<FluentIcons.ArrowUndo16Regular />}
                            disabled={revertInfo ? !revertInfo.canRevert : false}
                            onClick={(event) => {
                                event.stopPropagation();
                                if (revertInfo && !revertInfo.canRevert) {
                                    return;
                                }
                                if (tableChange) {
                                    handleRequestUndo(tableChange);
                                }
                            }}
                        />
                    </Tooltip>
                </div>
            )}
            {showPendingAiTableActions && pendingAiTableOrForeignKeyChange && (
                <div
                    className={styles.undoButtonWrapper}
                    ref={undoWrapperRef}
                    onMouseEnter={() => setIsHovered(true)}
                    onMouseLeave={() => setIsHovered(false)}>
                    <div className={styles.aiActionsToolbar}>
                        <Tooltip content={"Keep"} relationship="label">
                            <Button
                                appearance="primary"
                                size="small"
                                icon={<FluentIcons.Checkmark16Regular />}
                                disabled={isApplyingPendingAiAction}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    handleKeepPendingAiChange(pendingAiTableOrForeignKeyChange);
                                }}
                            />
                        </Tooltip>
                        <Tooltip content={locConstants.schemaDesigner.undo} relationship="label">
                            <Button
                                appearance="subtle"
                                size="small"
                                icon={<FluentIcons.ArrowUndo16Regular />}
                                disabled={isApplyingPendingAiAction}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    void handleUndoPendingAiChange(
                                        pendingAiTableOrForeignKeyChange,
                                    );
                                }}
                            />
                        </Tooltip>
                    </div>
                </div>
            )}
            {pendingAiMode && pendingAiTableOrForeignKeyChange && (
                <span className={styles.aiTableIndicator} aria-hidden="true">
                    <FluentIcons.Sparkle16Regular />
                </span>
            )}
            <div className={mergeClasses(isDeletedTable && styles.tableContentDisabled)}>
                <TableHeader
                    table={table}
                    isPendingAiMode={pendingAiMode}
                    pendingAiTableChange={pendingAiTableChange}
                />
                <Divider />
                <TableColumns
                    columns={table.columns}
                    table={table}
                    isDeletedTable={isDeletedTable}
                    isPendingAiMode={pendingAiMode}
                    pendingAiColumnChangesByColumnId={pendingAiColumnChangesByColumnId}
                    pendingAiDeletedColumns={pendingAiDeletedColumns}
                    suppressPendingAiColumnVisuals={isPendingAiNewTable}
                    isApplyingPendingAiAction={isApplyingPendingAiAction}
                    onKeepPendingAiChange={handleKeepPendingAiChange}
                    onUndoPendingAiChange={handleUndoPendingAiChange}
                    isCollapsed={isCollapsed}
                    onToggleCollapse={handleToggleCollapse}
                    onRequestUndo={handleRequestUndo}
                />
            </div>
            <Dialog
                open={isUndoDialogOpen}
                onOpenChange={(_event, data) => {
                    setIsUndoDialogOpen(data.open);
                    if (!data.open) {
                        setPendingUndoChange(null);
                    }
                }}>
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>{locConstants.schemaDesigner.deleteConfirmation}</DialogTitle>
                        <DialogContent>
                            {locConstants.schemaDesigner.deleteConfirmationContent}
                        </DialogContent>
                        <DialogActions>
                            <Button
                                appearance="primary"
                                onClick={() => {
                                    handleUndo();
                                    setIsUndoDialogOpen(false);
                                }}>
                                {locConstants.schemaDesigner.undo}
                            </Button>
                            <Button
                                appearance="secondary"
                                onClick={() => setIsUndoDialogOpen(false)}>
                                {locConstants.schemaDesigner.cancel}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
        </div>
    );
};
