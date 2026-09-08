/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LocConstants } from "../../common/locConstants";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
    Badge,
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Dropdown,
    Input,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    Option,
    Spinner,
    Text,
    Textarea,
    Tooltip,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import {
    Add16Regular,
    ArrowClockwise16Regular,
    ArrowLeft16Regular,
    ArrowRedo16Regular,
    ArrowRight16Regular,
    ArrowUndo16Regular,
    Dismiss16Regular,
    Filter16Regular,
    Save16Regular,
    Code16Regular,
} from "@fluentui/react-icons";
import {
    createDomElement,
    type Column,
    type GridOption,
    type SlickgridReactInstance,
    Editors,
} from "slickgrid-react";
import {
    createFluentAutoResizeOptions,
    FluentSlickGrid,
} from "../../common/FluentSlickGrid/FluentSlickGrid";

import {
    ColumnFilter,
    FilterOperator,
    needsDocumentEditor,
    parseTableEditorPasteValue,
    operatorTakesValue,
    type TableEditorPasteCell,
    type SubmittedTableValue,
} from "../../../sharedInterfaces/tableEditor";
import { TableEditorContext } from "./tableEditorStateProvider";
import { useTableEditorSelector } from "./tableEditorSelector";

const useStyles = makeStyles({
    root: { display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" },
    toolbar: {
        display: "flex",
        alignItems: "center",
        columnGap: "6px",
        flexWrap: "wrap",
        rowGap: "6px",
        padding: "6px 12px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    divider: {
        width: "1px",
        height: "20px",
        margin: "0 4px",
        backgroundColor: tokens.colorNeutralStroke2,
    },
    spacer: { flexGrow: 1 },
    statusBar: {
        display: "flex",
        alignItems: "center",
        columnGap: "14px",
        rowGap: "4px",
        flexWrap: "wrap",
        padding: "4px 12px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground2,
        color: tokens.colorNeutralForeground3,
    },
    messages: { padding: "8px 12px", display: "flex", flexDirection: "column", rowGap: "6px" },
    evidence: {
        display: "flex",
        flexDirection: "column",
        rowGap: "6px",
        overflowX: "auto",
    },
    evidenceTable: {
        borderCollapse: "collapse",
        width: "100%",
        "& th, & td": {
            padding: "3px 6px",
            borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
            textAlign: "left",
            verticalAlign: "top",
        },
        "& th": { fontWeight: tokens.fontWeightSemibold },
    },
    body: { flexGrow: 1, minHeight: 0, display: "flex", flexDirection: "column" },
    gridWrap: { flexGrow: 1, minHeight: 0, overflow: "auto" },
    grid: { minHeight: "180px", height: "100%" },
    insertionBar: {
        position: "sticky",
        bottom: 0,
        zIndex: 2,
        display: "flex",
        alignItems: "center",
        gap: "8px",
        minHeight: "36px",
        padding: "4px 12px",
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground2,
    },

    // Sticky headers need separate borders: with collapsed borders the table's own border layer
    // paints over the sticky cell and rows show through it while scrolling.
    table: {
        borderCollapse: "separate",
        borderSpacing: 0,
        width: "100%",
        fontSize: tokens.fontSizeBase200,
    },
    th: {
        position: "sticky",
        top: 0,
        zIndex: 1,
        textAlign: "left",
        whiteSpace: "nowrap",
        backgroundColor: tokens.colorNeutralBackground3,
        color: tokens.colorNeutralForeground2,
        fontWeight: tokens.fontWeightSemibold,
        padding: "6px 10px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
        cursor: "pointer",
        userSelect: "none",
    },
    thReadOnly: { color: tokens.colorNeutralForeground4 },
    rowActions: { width: "72px", whiteSpace: "nowrap" },
    td: {
        padding: "0",
        borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
        maxWidth: "360px",
    },
    cellInput: {
        width: "100%",
        border: "none",
        background: "transparent",
        color: tokens.colorNeutralForeground1,
        padding: "4px 10px",
        font: "inherit",
        outline: "none",
        ":focus": { backgroundColor: tokens.colorNeutralBackground1Selected },
    },
    cellEditor: { display: "flex", alignItems: "center", minWidth: 0 },
    cellReadOnly: {
        padding: "4px 10px",
        color: tokens.colorNeutralForeground3,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        display: "block",
    },
    cellButton: {
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "4px 10px",
        border: "none",
        background: "transparent",
        color: tokens.colorNeutralForeground1,
        font: "inherit",
        cursor: "pointer",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
    },
    cellDirty: { backgroundColor: tokens.colorPaletteYellowBackground2 },
    cellNull: { color: tokens.colorNeutralForeground3 },
    rowNew: { backgroundColor: tokens.colorPaletteGreenBackground1 },
    rowDeleted: { opacity: 0.65, textDecoration: "line-through" },
    rowFailed: { backgroundColor: tokens.colorPaletteRedBackground1 },
    empty: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "180px",
        color: tokens.colorNeutralForeground3,
    },
    filterRow: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        flexWrap: "wrap",
    },
    script: {
        maxHeight: "240px",
        overflow: "auto",
        padding: "8px 12px",
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground3,
        fontFamily: tokens.fontFamilyMonospace,
        whiteSpace: "pre-wrap",
    },
    inspector: {
        display: "flex",
        flexDirection: "column",
        rowGap: "6px",
        maxHeight: "220px",
        overflow: "auto",
        padding: "8px 12px",
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground2,
    },
    inspectorList: {
        margin: 0,
        paddingLeft: "20px",
    },
    documentEditor: { width: "100%", minHeight: "240px" },
});

const NULL_TOKEN = "NULL";

interface TableEditorGridItem {
    id?: number;
    __deleted?: boolean;
}

interface TableEditorBeforeEditCellArgs {
    item?: TableEditorGridItem;
    cell?: number;
}

interface TableEditorPasteCommand {
    clippedRange: string[][];
    activeRow: number;
    activeCell: number;
    destH: number;
    destW: number;
    oneCellToMultiple: boolean;
    execute: () => void;
}

const TableEditorPage: React.FC = () => {
    const context = useContext(TableEditorContext);
    if (!context) {
        throw new Error("TableEditorPage must be rendered inside TableEditorStateProvider");
    }

    const styles = useStyles();
    const tableLoc = LocConstants.getInstance().tableEditor;
    const cellLoc = LocConstants.getInstance().tableCellEditor;
    const state = useTableEditorSelector((currentState) => currentState);
    const {
        databaseName,
        schemaName,
        tableName,
        isLoading,
        loadError,
        columns,
        rows,
        key: keyStrategy,
        staged,
        canUndo,
        canRedo,
        saveState,
        saveError,
        failedRowId,
        issues,
        filters,
        pageIndex,
        hasNextPage,
        totalRows,
        script,
        showScript,
        openCell,
        conflicts,
        reconciliation,
    } = state;
    const dirtyCount = Object.keys(staged).length;
    const newRows = rows.filter((row) => row.isNew);
    const activeInsert = newRows.find((row) => staged[row.id] === undefined);
    const pendingInsertCount = newRows.filter((row) => staged[row.id]?.kind === "insert").length;
    const canInsertUsingDefaults =
        columns
            .filter((column) => column.isWritable)
            .every((column) => column.hasDefault || column.isNullable) &&
        columns.some((column) => column.isWritable || column.hasDefault);
    const openCellColumn = openCell
        ? columns.find((column) => column.name === openCell.column)
        : undefined;
    const canEdit = keyStrategy?.canEdit ?? false;
    const canMutate =
        canEdit &&
        saveState !== "saving" &&
        saveState !== "unknown" &&
        saveState !== "conflict" &&
        saveState !== "savedReloadFailed" &&
        saveState !== "savedReconciliationFailed";
    const gridRef = useRef<SlickgridReactInstance | undefined>(undefined);
    const currentEditStateRef = useRef({
        columns,
        rows,
        staged,
        canMutate,
        isLoading,
        openCell,
    });
    currentEditStateRef.current = {
        columns,
        rows,
        staged,
        canMutate,
        isLoading,
        openCell,
    };
    const contextRef = useRef(context);
    contextRef.current = context;
    const pasteInProgressRef = useRef(false);
    const pendingCellChangeRef = useRef<Promise<void> | undefined>(undefined);
    const beforeEditCellHandlerRef = useRef(
        (_event: unknown, args: TableEditorBeforeEditCellArgs): boolean => {
            const current = currentEditStateRef.current;
            if (!current.canMutate || current.isLoading) {
                return false;
            }

            const rowId = args.item?.id;
            const field =
                typeof args.cell === "number"
                    ? gridRef.current?.slickGrid.getVisibleColumns()[args.cell]?.field
                    : undefined;
            if (typeof rowId !== "number" || typeof field !== "string" || field === "__action") {
                return false;
            }

            const row = current.rows.find((candidate) => candidate.id === rowId);
            const stagedRow = current.staged[rowId];
            if (!row || args.item?.__deleted || stagedRow?.kind === "delete") {
                return false;
            }

            const column = current.columns.find((candidate) => candidate.name === field);
            if (!column?.isWritable) {
                return false;
            }

            if (row.incompleteColumns.includes(field)) {
                const openCell = current.openCell;
                if (openCell?.rowId !== rowId || openCell.column !== field) {
                    contextRef.current.openCell(rowId, field);
                }
                return false;
            }

            return true;
        },
    );
    const [showFilters, setShowFilters] = useState(false);
    const [draftFilters, setDraftFilters] = useState<ColumnFilter[]>(filters);
    const [documentDraft, setDocumentDraft] = useState("");
    const [inspector, setInspector] = useState<"changes" | "issues" | undefined>();
    const [pasteError, setPasteError] = useState<string>();

    const formatSubmittedValue = (value: SubmittedTableValue | undefined): string => {
        if (value === undefined) return tableLoc.notAvailable;
        if (value === null) return cellLoc.nullValue;
        if (typeof value === "object" && value.$t === "default") {
            return cellLoc.defaultValue;
        }
        return typeof value === "string"
            ? value === ""
                ? tableLoc.emptyString
                : value
            : tableLoc.notAvailable;
    };

    const buildPasteCells = (
        command: TableEditorPasteCommand,
    ): TableEditorPasteCell[] | undefined => {
        const grid = gridRef.current?.slickGrid;
        const dataView = gridRef.current?.dataView;
        if (!grid || !dataView || !canMutate) {
            return undefined;
        }

        const allColumns = grid.getColumns();
        const cells: TableEditorPasteCell[] = [];
        let destinationWidth = command.destW;
        for (let rowOffset = 0; rowOffset < command.destH; rowOffset++) {
            let sourceColumnOffset = 0;
            for (let columnOffset = 0; columnOffset < destinationWidth; columnOffset++) {
                const column = allColumns[command.activeCell + columnOffset];
                if (!column) {
                    break;
                }
                if (column.hidden) {
                    destinationWidth += 1;
                    sourceColumnOffset += 1;
                    continue;
                }

                const rowIndex = command.activeRow + rowOffset;
                const item = dataView.getItem(rowIndex) as { id?: number } | undefined;
                const row =
                    typeof item?.id === "number"
                        ? rows.find((candidate) => candidate.id === item.id)
                        : undefined;
                const field = column.field;
                const columnInfo =
                    typeof field === "string"
                        ? columns.find((candidate) => candidate.name === field)
                        : undefined;
                if (
                    !row ||
                    !columnInfo?.isWritable ||
                    typeof field !== "string" ||
                    field === "__action" ||
                    row.incompleteColumns.includes(field) ||
                    staged[row.id]?.kind === "delete"
                ) {
                    return undefined;
                }

                const sourceColumn = columnOffset - sourceColumnOffset;
                const rawValue = command.oneCellToMultiple
                    ? (command.clippedRange[0]?.[0] ?? "")
                    : (command.clippedRange[rowOffset]?.[sourceColumn] ?? "");
                const value = parseTableEditorPasteValue(rawValue, columnInfo);
                if (value === undefined) return undefined;
                cells.push({ rowId: row.id, column: field, value });
            }
        }
        return cells.length > 0 ? cells : undefined;
    };

    useEffect(() => {
        setDraftFilters(filters);
    }, [filters]);

    useEffect(() => {
        setDocumentDraft(openCell?.value ?? "");
    }, [openCell?.column, openCell?.rowId, openCell?.status, openCell?.value]);

    const saveWithActiveEdit = async () => {
        const editorLock = gridRef.current?.slickGrid.getEditorLock();
        if (editorLock && !editorLock.commitCurrentEdit()) {
            return;
        }
        // SlickGrid emits onCellChange while committing, but staging is an asynchronous RPC.
        // Let that request finish before the save snapshot is captured.
        await Promise.resolve();
        const pendingCellChange = pendingCellChangeRef.current;
        if (pendingCellChange) {
            try {
                await pendingCellChange;
            } catch {
                return;
            }
        }
        await context.save();
    };

    const gridDataset = useMemo(() => {
        return rows.map((row) => {
            const edit = staged[row.id];
            const defaultColumns = new Set(edit?.defaultColumns ?? []);
            const dirtyColumns = new Set([...Object.keys(edit?.values ?? {}), ...defaultColumns]);
            const semantic: Record<string, string | undefined> = {};
            const values: Record<string, string | null> = {};
            for (const column of columns) {
                const value =
                    edit && column.name in edit.values
                        ? edit.values[column.name]
                        : (row.values[column.name] ?? null);
                values[column.name] = value;
                semantic[column.name] = defaultColumns.has(column.name)
                    ? cellLoc.defaultValue
                    : row.isNew && !dirtyColumns.has(column.name)
                      ? !column.isWritable
                          ? cellLoc.generatedValue
                          : column.hasDefault
                            ? cellLoc.defaultValue
                            : column.isNullable
                              ? cellLoc.nullValue
                              : cellLoc.requiredValue
                      : undefined;
            }
            return {
                id: row.id,
                __new: row.isNew === true,
                __deleted: edit?.kind === "delete",
                __failed: failedRowId === row.id,
                __action: edit ? "revert" : "delete",
                __dirtyColumns: dirtyColumns,
                __defaultColumns: defaultColumns,
                __semantic: semantic,
                __incompleteColumns: new Set(row.incompleteColumns),
                ...values,
            };
        });
    }, [cellLoc, columns, failedRowId, rows, staged]);

    const gridColumns = useMemo<Column[]>(() => {
        const actionColumn: Column = {
            id: "actions",
            name: "",
            field: "__action",
            width: 72,
            minWidth: 72,
            maxWidth: 72,
            resizable: false,
            formatter: (_row, _cell, _value, _column, item) => {
                const action = item.__action === "revert" ? "revert" : "delete";
                const label = action === "revert" ? tableLoc.revertRow : tableLoc.deleteRow;
                const icon = action === "revert" ? "arrow-undo" : "delete";
                const button = createDomElement("button", {
                    type: "button",
                    className: "table-editor-grid-action",
                    ariaLabel: label,
                    title: label,
                    dataset: {
                        tableEditorAction: action,
                        tableEditorRow: String(item.id),
                    },
                });
                createDomElement("i", { className: `fi fi-${icon}` }, button);
                return button;
            },
        };
        const dataColumns = columns.map(
            (column): Column => ({
                id: column.name,
                name: column.name,
                field: column.name,
                sortable: true,
                filterable: false,
                resizable: true,
                minWidth: 140,
                type: "string",
                ...(column.isWritable &&
                !needsDocumentEditor(column.editorKind) &&
                !column.isLargeValue
                    ? {
                          editor:
                              column.editorKind === "boolean"
                                  ? {
                                        model: Editors.singleSelect,
                                        collection: [
                                            { value: "true", label: cellLoc.trueValue },
                                            { value: "false", label: cellLoc.falseValue },
                                            ...(column.isNullable
                                                ? [{ value: NULL_TOKEN, label: cellLoc.nullValue }]
                                                : []),
                                        ],
                                    }
                                  : { model: Editors.text },
                      }
                    : {}),
                formatter: (_row, _cell, value, _column, item) => {
                    const dirty = item.__dirtyColumns.has(column.name);
                    const semantic = item.__semantic[column.name];
                    const text =
                        semantic ??
                        (value === null
                            ? NULL_TOKEN
                            : value === "" && dirty
                              ? tableLoc.emptyString
                              : String(value ?? ""));
                    const classes = [
                        dirty ? "table-editor-cell-dirty" : "",
                        item.__new ? "table-editor-cell-new" : "",
                        item.__deleted ? "table-editor-cell-deleted" : "",
                        item.__failed ? "table-editor-cell-failed" : "",
                        value === null ? "table-editor-cell-null" : "",
                    ]
                        .filter(Boolean)
                        .join(" ");
                    return createDomElement("span", {
                        className: classes,
                        title: item.__incompleteColumns.has(column.name)
                            ? cellLoc.incompleteValue
                            : text,
                        style: {
                            backgroundColor: dirty
                                ? tokens.colorPaletteYellowBackground2
                                : item.__failed
                                  ? tokens.colorPaletteRedBackground1
                                  : undefined,
                            color: value === null ? tokens.colorNeutralForeground3 : undefined,
                        },
                        textContent: text,
                    });
                },
                toolTip:
                    column.declaredTypeName && column.declaredTypeName !== column.typeName
                        ? `${column.declaredTypeSchema ? `${column.declaredTypeSchema}.` : ""}${column.declaredTypeName} (${column.typeName})`
                        : column.typeName,
            }),
        );
        return [actionColumn, ...dataColumns];
    }, [cellLoc, columns, tableLoc]);

    const gridOptions = useMemo<GridOption>(
        () => ({
            autoEdit: false,
            autoCommitEdit: true,
            editable: true,
            enableSorting: true,
            multiColumnSort: false,
            enableFiltering: false,
            enablePagination: false,
            enableColumnPicker: true,
            enableHeaderMenu: true,
            enableGridMenu: true,
            enableContextMenu: true,
            excelCopyBufferOptions: {
                newRowCreator: () => undefined,
                clipboardCommandHandler: (command: unknown) => {
                    const cells = buildPasteCells(command as TableEditorPasteCommand);
                    if (!cells) {
                        setPasteError(tableLoc.pasteRejected);
                        return;
                    }
                    setPasteError(undefined);
                    pasteInProgressRef.current = true;
                    try {
                        (command as TableEditorPasteCommand).execute();
                        context.applyPaste(cells);
                    } finally {
                        pasteInProgressRef.current = false;
                    }
                },
            },
            contextMenu: {
                commandTitle: cellLoc.actions,
                commandItems: [
                    {
                        command: "table-editor-set-null",
                        title: cellLoc.setNull,
                        iconCssClass: "fi fi-dismiss",
                        itemUsabilityOverride: (args) => {
                            const field = args.column?.field;
                            const column =
                                typeof field === "string"
                                    ? columns.find((candidate) => candidate.name === field)
                                    : undefined;
                            return Boolean(
                                currentEditStateRef.current.canMutate &&
                                    column?.isWritable &&
                                    column.isNullable &&
                                    !args.dataContext?.__incompleteColumns?.has(field) &&
                                    args.dataContext?.__deleted !== true,
                            );
                        },
                    },
                    {
                        command: "table-editor-use-default",
                        title: cellLoc.defaultValue,
                        iconCssClass: "fi fi-arrow-reset",
                        itemUsabilityOverride: (args) => {
                            const field = args.column?.field;
                            const column =
                                typeof field === "string"
                                    ? columns.find((candidate) => candidate.name === field)
                                    : undefined;
                            return Boolean(
                                currentEditStateRef.current.canMutate &&
                                    column?.isWritable &&
                                    column.hasDefault &&
                                    !args.dataContext?.__incompleteColumns?.has(field) &&
                                    args.dataContext?.__deleted !== true,
                            );
                        },
                    },
                    {
                        command: "table-editor-revert-cell",
                        title: cellLoc.revert,
                        iconCssClass: "fi fi-arrow-undo",
                        itemUsabilityOverride: (args) => {
                            const field = args.column?.field;
                            return Boolean(
                                currentEditStateRef.current.canMutate &&
                                    typeof field === "string" &&
                                    !args.dataContext?.__incompleteColumns?.has(field) &&
                                    args.dataContext?.__dirtyColumns?.has(field),
                            );
                        },
                    },
                ],
                onCommand: (_event, args) => {
                    const field = args.column?.field;
                    const rowId = args.dataContext?.id;
                    if (
                        typeof field !== "string" ||
                        typeof rowId !== "number" ||
                        !currentEditStateRef.current.canMutate
                    ) {
                        return;
                    }
                    const column = columns.find((candidate) => candidate.name === field);
                    if (
                        !column?.isWritable ||
                        args.dataContext?.__deleted === true ||
                        args.dataContext?.__incompleteColumns?.has(field)
                    ) {
                        return;
                    }
                    if (args.command === "table-editor-set-null" && column.isNullable) {
                        void context.editCell(rowId, field, null);
                    } else if (args.command === "table-editor-use-default" && column.hasDefault) {
                        context.setCellDefault(rowId, field);
                    } else if (args.command === "table-editor-revert-cell") {
                        void context.revertCell(rowId, field);
                    }
                },
            },
            enableAutoResize: true,
            autoResize: createFluentAutoResizeOptions("#table-editor-grid", {
                autoHeight: false,
                minHeight: 180,
                bottomPadding: 8,
            }),
            rowHeight: 30,
        }),
        [buildPasteCells, cellLoc, columns, context, tableLoc.pasteRejected],
    );

    const renderGrid = () => {
        if (isLoading && rows.length === 0) {
            return (
                <div className={styles.empty}>
                    <Spinner label={tableLoc.loadingRows} />
                </div>
            );
        }
        if (rows.length === 0 && columns.length === 0) {
            return <div className={styles.empty}>{tableLoc.noRows}</div>;
        }
        return (
            <div id="table-editor-grid" className={styles.grid}>
                <FluentSlickGrid
                    gridId="tableEditorGrid"
                    columns={gridColumns}
                    options={gridOptions}
                    dataset={gridDataset}
                    onReactGridCreated={(event) => {
                        gridRef.current = event.detail;
                        event.detail.slickGrid.onBeforeEditCell.subscribe(
                            beforeEditCellHandlerRef.current,
                        );
                    }}
                    onCellChange={(event) => {
                        if (pasteInProgressRef.current) return;
                        const args = event.detail.args as {
                            item: { id: number; [key: string]: unknown };
                            column: { id?: string; field?: string };
                        };
                        const field = args.column.field;
                        if (!field || field === "__action") return;
                        const value = args.item[field];
                        const column = columns.find((candidate) => candidate.name === field);
                        if (!column?.isWritable) return;
                        const editedValue = parseTableEditorPasteValue(String(value ?? ""), column);
                        if (value === null && !column.isNullable) return;
                        if (editedValue === undefined) return;
                        const pendingCellChange = context.editCell(
                            args.item.id,
                            field,
                            editedValue,
                        );
                        pendingCellChangeRef.current = pendingCellChange;
                        void pendingCellChange.then(
                            () => {
                                if (pendingCellChangeRef.current === pendingCellChange) {
                                    pendingCellChangeRef.current = undefined;
                                }
                            },
                            () => {
                                if (pendingCellChangeRef.current === pendingCellChange) {
                                    pendingCellChangeRef.current = undefined;
                                }
                            },
                        );
                    }}
                    onClick={(event) => {
                        const target = event.detail.eventData.target as HTMLElement | null;
                        const action = target?.closest<HTMLElement>("[data-table-editor-action]");
                        if (!action) return;
                        const rowId = Number(action.dataset.tableEditorRow);
                        if (!Number.isSafeInteger(rowId)) return;
                        if (action.dataset.tableEditorAction === "revert") {
                            context.revertRow(rowId);
                        } else {
                            context.deleteRow(rowId);
                        }
                    }}
                    onDblClick={(event) => {
                        const args = event.detail.args;
                        const item = args.grid.getDataItem(args.row) as { id: number } | undefined;
                        const column = args.grid.getVisibleColumns()[args.cell];
                        const columnInfo = columns.find(
                            (candidate) => candidate.name === column?.field,
                        );
                        if (
                            item &&
                            columnInfo &&
                            (needsDocumentEditor(columnInfo.editorKind) ||
                                columnInfo.isLargeValue ||
                                rows
                                    .find((row) => row.id === item.id)
                                    ?.incompleteColumns.includes(columnInfo.name))
                        ) {
                            context.openCell(item.id, columnInfo.name);
                        }
                    }}
                    onSort={(event) => {
                        const args = event.detail.args as {
                            sortCol?: { id?: string };
                            sortAsc?: boolean;
                        };
                        const column = args.sortCol?.id;
                        if (column && column !== "actions") {
                            context.setSort([{ column, descending: args.sortAsc === false }]);
                        }
                    }}
                    onSortCleared={() => context.setSort([])}
                />
                <div className={styles.insertionBar} role="region" aria-label={tableLoc.newRow}>
                    <Button
                        appearance="subtle"
                        icon={<Add16Regular />}
                        disabled={!canMutate}
                        onClick={() => context.addRow()}>
                        {tableLoc.newRow}
                    </Button>
                    <Text size={200}>
                        {activeInsert ? tableLoc.insertionActive : tableLoc.insertionHint}
                    </Text>
                    {pendingInsertCount > 0 && (
                        <Text size={200}>{tableLoc.pendingInserts(pendingInsertCount)}</Text>
                    )}
                    {activeInsert && canInsertUsingDefaults && (
                        <Button
                            appearance="outline"
                            size="small"
                            disabled={!canMutate}
                            onClick={() => context.insertUsingDefaults(activeInsert.id)}>
                            {tableLoc.insertUsingDefaults}
                        </Button>
                    )}
                </div>
            </div>
        );
    };

    /*
                            aria-label={cellLoc.setNull}
                            disabled={isDeleted || !canMutate}
                            onClick={() => void context.editCell(row.id, column.name, null)}
                        />
                    </Tooltip>
                )}
            </span>
        );
    };

    const renderGrid = () => {
        if (isLoading && rows.length === 0) {
            return (
                <div className={styles.empty}>
                    <Spinner label={tableLoc.loadingRows} />
                </div>
            );
        }
        if (rows.length === 0) {
            return (
                <div className={styles.empty}>
                    {filters.length > 0 ? tableLoc.noRowsMatch : tableLoc.noRows}
                </div>
            );
        }

        return (
            <table className={styles.table}>
                <thead>
                    <tr>
                        <th className={`${styles.th} ${styles.rowActions}`}>&nbsp;</th>
                        {columns.map((c) => {
                            const sorted = sort.find((s) => s.column === c.name);
                            return (
                                <th
                                    key={c.name}
                                    className={`${styles.th} ${c.isWritable ? "" : styles.thReadOnly}`}
                                    onClick={() => toggleSort(c.name)}
                                    title={`${c.typeName}${c.readOnlyReason ? ` — ${c.readOnlyReason}` : ""}`}>
                                    {c.name}
                                    {sorted ? (sorted.descending ? " ↓" : " ↑") : ""}
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => {
                        const edit = staged[row.id];
                        const rowClass = [
                            row.isNew ? styles.rowNew : "",
                            edit?.kind === "delete" ? styles.rowDeleted : "",
                            failedRowId === row.id ? styles.rowFailed : "",
                        ]
                            .filter(Boolean)
                            .join(" ");
                        return (
                            <tr key={row.id} className={rowClass}>
                                <td className={`${styles.td} ${styles.rowActions}`}>
                                    <Button
                                        appearance="subtle"
                                        size="small"
                                        icon={<Delete16Regular />}
                                        disabled={!canMutate}
                                        aria-label={tableLoc.deleteRow}
                                        onClick={() => context.deleteRow(row.id)}
                                    />
                                    <Button
                                        appearance="subtle"
                                        size="small"
                                        icon={<ArrowUndo16Regular />}
                                        disabled={edit === undefined || saveState === "saving"}
                                        aria-label={tableLoc.revertRow}
                                        onClick={() => context.revertRow(row.id)}
                                    />
                                </td>
                                {columns.map((c) => (
                                    <td key={c.name} className={styles.td}>
                                        {renderCell(row, c)}
                                    </td>
                                ))}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        );
    };

*/

    return (
        <div className={styles.root}>
            <div className={styles.toolbar}>
                <Button
                    appearance="primary"
                    icon={<Save16Regular />}
                    disabled={
                        dirtyCount === 0 ||
                        saveState === "saving" ||
                        saveState === "unknown" ||
                        saveState === "conflict" ||
                        saveState === "savedReconciliationFailed" ||
                        isLoading ||
                        !canEdit
                    }
                    onClick={saveWithActiveEdit}>
                    {saveState === "saving"
                        ? tableLoc.saving
                        : dirtyCount > 0
                          ? tableLoc.saveChanges(dirtyCount)
                          : tableLoc.save}
                </Button>
                <Button
                    appearance="subtle"
                    icon={<ArrowUndo16Regular />}
                    disabled={dirtyCount === 0 || !canMutate}
                    onClick={() => context.discardAll()}>
                    {tableLoc.discard}
                </Button>
                <Tooltip content={tableLoc.undo} relationship="label">
                    <Button
                        appearance="subtle"
                        icon={<ArrowUndo16Regular />}
                        disabled={!canUndo || !canMutate}
                        aria-label={tableLoc.undo}
                        onClick={() => context.undo()}
                    />
                </Tooltip>
                <Tooltip content={tableLoc.redo} relationship="label">
                    <Button
                        appearance="subtle"
                        icon={<ArrowRedo16Regular />}
                        disabled={!canRedo || !canMutate}
                        aria-label={tableLoc.redo}
                        onClick={() => context.redo()}
                    />
                </Tooltip>

                <div className={styles.divider} />

                <Button
                    appearance="subtle"
                    icon={<Add16Regular />}
                    disabled={!canMutate}
                    onClick={() => context.addRow()}>
                    {tableLoc.newRow}
                </Button>
                <Button
                    appearance="subtle"
                    icon={<ArrowClockwise16Regular />}
                    disabled={isLoading || saveState === "saving"}
                    onClick={() => context.refresh()}>
                    {tableLoc.refresh}
                </Button>
                <Button
                    appearance={showFilters ? "outline" : "subtle"}
                    icon={<Filter16Regular />}
                    onClick={() => {
                        setDraftFilters(filters.length > 0 ? filters : []);
                        setShowFilters(!showFilters);
                    }}>
                    {filters.length > 0 ? tableLoc.filter(filters.length) : tableLoc.filterLabel}
                </Button>
                <Button
                    appearance={showScript ? "outline" : "subtle"}
                    icon={<Code16Regular />}
                    onClick={() => context.toggleScript()}>
                    {tableLoc.script}
                </Button>
                <Button
                    appearance={inspector === "changes" ? "outline" : "subtle"}
                    disabled={dirtyCount === 0}
                    onClick={() => setInspector(inspector === "changes" ? undefined : "changes")}>
                    {tableLoc.changes(dirtyCount)}
                </Button>
                <Button
                    appearance={inspector === "issues" ? "outline" : "subtle"}
                    disabled={issues.length === 0}
                    onClick={() => setInspector(inspector === "issues" ? undefined : "issues")}>
                    {tableLoc.issuesCount(issues.length)}
                </Button>

                <div className={styles.spacer} />

                <Button
                    appearance="subtle"
                    size="small"
                    icon={<ArrowLeft16Regular />}
                    disabled={pageIndex === 0 || isLoading || !canMutate}
                    aria-label={tableLoc.previousPage}
                    onClick={() => context.previousPage()}
                />
                <Text size={200}>{tableLoc.page(pageIndex + 1)}</Text>
                <Button
                    appearance="subtle"
                    size="small"
                    icon={<ArrowRight16Regular />}
                    disabled={!hasNextPage || isLoading || !canMutate}
                    aria-label={tableLoc.nextPage}
                    onClick={() => context.nextPage()}
                />
            </div>

            <div className={styles.statusBar}>
                <Text size={200}>
                    {databaseName} · {schemaName}.{tableName}
                </Text>
                {keyStrategy && (
                    <Tooltip content={keyStrategy.explanation} relationship="description">
                        <Badge
                            appearance="outline"
                            color={keyStrategy.isAmbiguous ? "warning" : "informative"}>
                            {keyStrategy.kind === "primaryKey"
                                ? tableLoc.primaryKey
                                : keyStrategy.kind === "uniqueIndex"
                                  ? tableLoc.uniqueIndex
                                  : keyStrategy.kind === "allColumns"
                                    ? tableLoc.noKey
                                    : tableLoc.notEditable}
                        </Badge>
                    </Tooltip>
                )}
                <Text size={200}>{tableLoc.rowsOnPage(rows.length)}</Text>
                {totalRows === undefined ? (
                    <Button
                        appearance="transparent"
                        size="small"
                        onClick={() => context.countRows()}>
                        {tableLoc.countAllRows}
                    </Button>
                ) : (
                    <Text size={200}>{tableLoc.matchingRows(totalRows.toLocaleString())}</Text>
                )}
                {isLoading && <Spinner size="tiny" />}
            </div>

            {(loadError ||
                saveError ||
                pasteError ||
                (keyStrategy && !keyStrategy.canEdit) ||
                (keyStrategy?.isAmbiguous && canEdit)) && (
                <div className={styles.messages}>
                    {loadError && <MessageBar intent="error">{loadError}</MessageBar>}
                    {pasteError && <MessageBar intent="warning">{pasteError}</MessageBar>}
                    {saveError && (
                        <MessageBar
                            intent={
                                saveState === "unknown" ||
                                saveState === "conflict" ||
                                saveState === "savedReconciliationFailed"
                                    ? "warning"
                                    : saveState === "saved" || saveState === "savedReloadFailed"
                                      ? "success"
                                      : "error"
                            }>
                            <MessageBarBody>
                                {saveState === "failed" && tableLoc.rollbackFailure}
                                {saveState === "conflict" && tableLoc.conflict}
                                {saveState === "unknown" && tableLoc.unknownOutcome}
                                {saveState === "saved" && tableLoc.saved}
                                {saveState === "savedReloadFailed" && saveError}
                                {saveState === "savedReconciliationFailed" &&
                                    tableLoc.savedReconciliationFailed}
                                {saveState !== "failed" &&
                                    saveState !== "conflict" &&
                                    saveState !== "unknown" &&
                                    saveState !== "saved" &&
                                    saveState !== "savedReloadFailed" &&
                                    saveState !== "savedReconciliationFailed" &&
                                    saveError}
                                {issues.length > 0 && (
                                    <ul>
                                        {issues.map((issue, index) => (
                                            <li
                                                key={`${issue.rowId ?? "table"}-${issue.column ?? "issue"}-${index}`}>
                                                {issue.message}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </MessageBarBody>
                            {(saveState === "unknown" ||
                                saveState === "failed" ||
                                saveState === "conflict" ||
                                saveState === "savedReloadFailed" ||
                                saveState === "savedReconciliationFailed") && (
                                <MessageBarActions>
                                    {saveState === "unknown" ? (
                                        <Button size="small" onClick={() => context.reconcile()}>
                                            {tableLoc.reconcile}
                                        </Button>
                                    ) : (
                                        <>
                                            <Button size="small" onClick={() => context.refresh()}>
                                                {saveState === "savedReloadFailed"
                                                    ? tableLoc.savedReload
                                                    : saveState === "savedReconciliationFailed"
                                                      ? tableLoc.savedReload
                                                      : tableLoc.refreshDraft}
                                            </Button>
                                            {saveState === "savedReconciliationFailed" && (
                                                <Button
                                                    size="small"
                                                    appearance="secondary"
                                                    onClick={() => context.acceptReconciliation()}>
                                                    {tableLoc.acceptReconciliation}
                                                </Button>
                                            )}
                                        </>
                                    )}
                                </MessageBarActions>
                            )}
                            {saveState === "conflict" && conflicts && conflicts.length > 0 && (
                                <div className={styles.evidence}>
                                    <Text weight="semibold">{tableLoc.conflictComparison}</Text>
                                    {conflicts.map((conflict) => {
                                        const columnsToShow = [
                                            ...new Set([
                                                ...Object.keys(conflict.original),
                                                ...Object.keys(conflict.proposed),
                                                ...Object.keys(conflict.serverValues ?? {}),
                                            ]),
                                        ];
                                        return (
                                            <div key={conflict.rowId}>
                                                <Text size={200}>
                                                    {tableLoc.rowEvidence(conflict.rowId)}
                                                </Text>
                                                <table className={styles.evidenceTable}>
                                                    <thead>
                                                        <tr>
                                                            <th>{tableLoc.column}</th>
                                                            <th>{tableLoc.originalValue}</th>
                                                            <th>{tableLoc.serverValue}</th>
                                                            <th>{tableLoc.proposedValue}</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {columnsToShow.map((column) => (
                                                            <tr key={column}>
                                                                <th scope="row">{column}</th>
                                                                <td>
                                                                    {formatSubmittedValue(
                                                                        conflict.original[column],
                                                                    )}
                                                                </td>
                                                                <td>
                                                                    {conflict.serverValues
                                                                        ? (conflict.serverValues[
                                                                              column
                                                                          ] ?? cellLoc.nullValue)
                                                                        : tableLoc.notAvailable}
                                                                </td>
                                                                <td>
                                                                    {formatSubmittedValue(
                                                                        conflict.proposed[column],
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                                <div className={styles.filterRow}>
                                                    <Button
                                                        size="small"
                                                        onClick={() =>
                                                            context.keepServer(conflict.rowId)
                                                        }
                                                        disabled={
                                                            conflict.serverState === "unavailable"
                                                        }>
                                                        {tableLoc.keepServer}
                                                    </Button>
                                                    <Button
                                                        size="small"
                                                        appearance="primary"
                                                        onClick={() =>
                                                            context.reapplyConflict(conflict.rowId)
                                                        }
                                                        disabled={
                                                            conflict.serverState !== "available" ||
                                                            !conflict.serverValues ||
                                                            (conflict.serverIncompleteColumns
                                                                ?.length ?? 0) > 0
                                                        }>
                                                        {tableLoc.reapplyConflict}
                                                    </Button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            {(saveState === "unknown" ||
                                saveState === "savedReconciliationFailed") &&
                                reconciliation &&
                                reconciliation.length > 0 && (
                                    <div className={styles.evidence}>
                                        <Text weight="semibold">
                                            {tableLoc.reconciliationEvidence}
                                        </Text>
                                        <ul>
                                            {reconciliation.map((item) => (
                                                <li key={item.rowId}>
                                                    {tableLoc.rowEvidence(item.rowId)} {item.detail}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                        </MessageBar>
                    )}
                    {keyStrategy && !keyStrategy.canEdit && (
                        <MessageBar intent="warning">{keyStrategy.explanation}</MessageBar>
                    )}
                    {keyStrategy?.isAmbiguous && canEdit && (
                        <MessageBar intent="info">{keyStrategy.explanation}</MessageBar>
                    )}
                </div>
            )}

            {showFilters && (
                <div className={styles.messages}>
                    {draftFilters.map((filter, index) => (
                        <div key={index} className={styles.filterRow}>
                            <Dropdown
                                value={filter.column}
                                selectedOptions={[filter.column]}
                                onOptionSelect={(_, d) =>
                                    setDraftFilters(
                                        draftFilters.map((f, i) =>
                                            i === index ? { ...f, column: d.optionValue! } : f,
                                        ),
                                    )
                                }>
                                {columns.map((c) => (
                                    <Option key={c.name} value={c.name}>
                                        {c.name}
                                    </Option>
                                ))}
                            </Dropdown>
                            <Dropdown
                                value={tableLoc.operators[filter.operator]}
                                selectedOptions={[filter.operator]}
                                onOptionSelect={(_, d) =>
                                    setDraftFilters(
                                        draftFilters.map((f, i) =>
                                            i === index
                                                ? {
                                                      ...f,
                                                      operator: d.optionValue as FilterOperator,
                                                  }
                                                : f,
                                        ),
                                    )
                                }>
                                {(Object.keys(tableLoc.operators) as FilterOperator[]).map((op) => (
                                    <Option key={op} value={op} text={tableLoc.operators[op]}>
                                        {tableLoc.operators[op]}
                                    </Option>
                                ))}
                            </Dropdown>
                            {operatorTakesValue(filter.operator) && (
                                <Input
                                    value={filter.value ?? ""}
                                    onChange={(_, d) =>
                                        setDraftFilters(
                                            draftFilters.map((f, i) =>
                                                i === index ? { ...f, value: d.value } : f,
                                            ),
                                        )
                                    }
                                />
                            )}
                            <Button
                                appearance="subtle"
                                icon={<Dismiss16Regular />}
                                aria-label={tableLoc.removeFilter}
                                onClick={() =>
                                    setDraftFilters(draftFilters.filter((_, i) => i !== index))
                                }
                            />
                        </div>
                    ))}
                    <div className={styles.filterRow}>
                        <Button
                            size="small"
                            icon={<Add16Regular />}
                            disabled={columns.length === 0}
                            onClick={() =>
                                setDraftFilters([
                                    ...draftFilters,
                                    { column: columns[0].name, operator: "equals", value: "" },
                                ])
                            }>
                            {tableLoc.addFilter}
                        </Button>
                        <Button
                            size="small"
                            appearance="primary"
                            disabled={saveState === "saving"}
                            onClick={() => context.setFilters(draftFilters)}>
                            {tableLoc.applyFilter}
                        </Button>
                        <Button
                            size="small"
                            onClick={() => {
                                setDraftFilters([]);
                                context.setFilters([]);
                            }}>
                            {tableLoc.clearFilter}
                        </Button>
                    </div>
                </div>
            )}

            <div className={styles.body}>
                <div className={styles.gridWrap}>{renderGrid()}</div>
                {showScript && (
                    <div className={styles.script}>{script ?? tableLoc.defaultScript}</div>
                )}
            </div>

            {inspector === "changes" && (
                <div
                    className={styles.inspector}
                    role="region"
                    aria-label={tableLoc.inspectorChanges}>
                    <Text weight="semibold">{tableLoc.inspectorChanges}</Text>
                    {dirtyCount === 0 ? (
                        <Text size={200}>{tableLoc.noChanges}</Text>
                    ) : (
                        <ul className={styles.inspectorList}>
                            {Object.values(staged).map((edit) => {
                                const changedColumns = [
                                    ...Object.keys(edit.values),
                                    ...(edit.defaultColumns ?? []),
                                ];
                                const row = state.draftRows.find(
                                    (candidate) => candidate.id === edit.rowId,
                                );
                                return (
                                    <li key={edit.rowId}>
                                        {tableLoc.rowChange(
                                            edit.rowId,
                                            tableLoc.operations[edit.kind],
                                            row?.isNew
                                                ? `${changedColumns.join(", ")} (${tableLoc.newRow})`
                                                : changedColumns.join(", "),
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            )}
            {inspector === "issues" && (
                <div
                    className={styles.inspector}
                    role="region"
                    aria-label={tableLoc.inspectorIssues}>
                    <Text weight="semibold">{tableLoc.inspectorIssues}</Text>
                    {issues.length === 0 ? (
                        <Text size={200}>{tableLoc.noIssues}</Text>
                    ) : (
                        <ul className={styles.inspectorList}>
                            {issues.map((issue, index) => (
                                <li
                                    key={`${issue.rowId ?? "table"}-${issue.column ?? "issue"}-${index}`}>
                                    {issue.message}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            <Dialog
                open={openCell !== undefined}
                onOpenChange={(_, d) => {
                    if (!d.open) {
                        context.closeCell();
                    }
                }}>
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>{openCell?.column}</DialogTitle>
                        <DialogContent>
                            {openCell?.status === "loading" && <Spinner label={cellLoc.loading} />}
                            {openCell?.status === "error" && (
                                <MessageBar intent="error">
                                    <MessageBarBody>
                                        {cellLoc.failed} {openCell.error}
                                    </MessageBarBody>
                                    <MessageBarActions>
                                        <Button
                                            onClick={() =>
                                                context.openCell(openCell.rowId, openCell.column)
                                            }>
                                            {cellLoc.retry}
                                        </Button>
                                    </MessageBarActions>
                                </MessageBar>
                            )}
                            <Textarea
                                disabled={!canMutate || openCell?.status !== "ready"}
                                className={styles.documentEditor}
                                resize="vertical"
                                value={documentDraft}
                                onChange={(_, d) => setDocumentDraft(d.value)}
                            />
                        </DialogContent>
                        <DialogActions>
                            {openCellColumn?.isWritable && openCellColumn.isNullable && (
                                <Button
                                    appearance="secondary"
                                    disabled={!canMutate || openCell?.status !== "ready"}
                                    onClick={() => {
                                        if (openCell) {
                                            void context.editCell(
                                                openCell.rowId,
                                                openCell.column,
                                                null,
                                            );
                                        }
                                        context.closeCell();
                                    }}>
                                    {cellLoc.setNull}
                                </Button>
                            )}
                            <Button appearance="secondary" onClick={() => context.closeCell()}>
                                {cellLoc.cancel}
                            </Button>
                            <Button
                                disabled={!canMutate || openCell?.status !== "ready"}
                                appearance="primary"
                                onClick={() => {
                                    if (openCell) {
                                        void context.editCell(
                                            openCell.rowId,
                                            openCell.column,
                                            documentDraft,
                                        );
                                    }
                                    context.closeCell();
                                }}>
                                {cellLoc.apply}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
        </div>
    );
};

export default TableEditorPage;
