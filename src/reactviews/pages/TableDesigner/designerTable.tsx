/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as designer from "../../../sharedInterfaces/tableDesigner";
import * as fluentui from "@fluentui/react-components";
import * as l10n from "@vscode/l10n";

import {
    AddFilled,
    ArrowSortDownFilled,
    ArrowSortUpFilled,
    DeleteRegular,
    ReorderRegular,
    SettingsRegular,
} from "@fluentui/react-icons";
import { useContext, useState } from "react";

import { DesignerCheckbox } from "./designerCheckbox";
import { DesignerDropdown } from "./designerDropdown";
import { DesignerInputBox } from "./designerInputBox";
import { TableDesignerContext } from "./tableDesignerStateProvider";
import { locConstants } from "../../common/locConstants";

export type DesignerTableProps = {
    component: designer.DesignerDataPropertyInfo;
    model: designer.DesignerTableProperties;
    componentPath: (string | number)[];
    UiArea: designer.DesignerUIArea;
};

export type ErrorPopupProps = {
    message: string | undefined;
};

const useStyles = fluentui.makeStyles({
    tableCell: {
        display: "flex",
        flexDirection: "row",
    },
    tableActionIcon: {
        height: "14px",
        width: "14px",
    },
    tableHeaderCellText: {
        fontWeight: "600",
        textAlign: "center",
        width: "100%",
    },
    tableCellButton: {
        height: "100%",
    },
    table: {
        border: "1px solid var(--vscode-panel-border)",
        borderCollapse: "collapse",
    },
    tableHeaderCell: {
        borderRight: "1px solid var(--vscode-panel-border)",
        borderBottom: "1px solid var(--vscode-panel-border)",
        "&:last-child": {
            borderRight: "none",
        },
    },
    tableCellWithBorder: {
        borderRight: "1px solid var(--vscode-panel-border)",
        borderBottom: "1px solid var(--vscode-panel-border)",
        "&:last-child": {
            borderRight: "none",
        },
    },
});

export const DesignerTable = ({ component, model, componentPath, UiArea }: DesignerTableProps) => {
    const tableProps = component.componentProperties as designer.DesignerTableProperties;
    const context = useContext(TableDesignerContext);
    if (!context) {
        return undefined;
    }
    const classes = useStyles();

    const MOVE_UP = l10n.t("Move Up");
    const MOVE_DOWN = l10n.t("Move Down");

    const columnsDef: fluentui.TableColumnDefinition<designer.DesignerTableComponentDataItem>[] =
        tableProps.columns!.map((column) => {
            const colProps = tableProps.itemProperties?.find(
                (item) => item.propertyName === column,
            );
            return fluentui.createTableColumn({
                columnId: column,
                renderHeaderCell: () => (
                    <fluentui.Text className={classes.tableHeaderCellText}>
                        {colProps?.componentProperties.title ?? column}
                    </fluentui.Text>
                ),
            });
        });
    if (UiArea !== "PropertiesView") {
        columnsDef.push(
            fluentui.createTableColumn({
                columnId: "properties",
                renderHeaderCell: () => <></>,
            }),
        );
    }
    if (tableProps.canMoveRows) {
        columnsDef.unshift(
            fluentui.createTableColumn({
                columnId: "dragHandle",
                renderHeaderCell: () => <></>,
            }),
        );
    }

    if (tableProps.canRemoveRows) {
        columnsDef.push(
            fluentui.createTableColumn({
                columnId: "remove",
                renderHeaderCell: () => {
                    const DELETE = l10n.t("Delete");
                    return <>{DELETE}</>;
                },
            }),
        );
    }

    const items: designer.DesignerTableComponentDataItem[] =
        model.data?.map((row) => {
            return row;
        }) ?? [];

    const [columns] =
        useState<fluentui.TableColumnDefinition<designer.DesignerTableComponentDataItem>[]>(
            columnsDef,
        );

    const getColumnSizingOptions = (): fluentui.TableColumnSizingOptions => {
        const result = {} as fluentui.TableColumnSizingOptions;
        tableProps.columns!.forEach((column) => {
            const colProps = tableProps.itemProperties?.find(
                (item) => item.propertyName === column,
            );
            if (!colProps) {
                return;
            }
            result[column] = {
                minWidth: colProps?.componentProperties.width ?? 70,
                idealWidth: colProps?.componentProperties.width ?? 70,
                defaultWidth: colProps?.componentProperties.width ?? 70,
            };
        });
        if (UiArea !== "PropertiesView") {
            result["properties"] = {
                minWidth: 24,
                idealWidth: 24,
                defaultWidth: 24,
            };
        }
        if (tableProps.canMoveRows) {
            result["dragHandle"] = {
                minWidth: 15,
                idealWidth: 15,
                defaultWidth: 15,
            };
        }
        if (tableProps.canRemoveRows) {
            result["remove"] = {
                minWidth: 35,
                idealWidth: 35,
                defaultWidth: 35,
            };
        }
        return result;
    };
    const [columnSizingOptions] =
        useState<fluentui.TableColumnSizingOptions>(getColumnSizingOptions());

    const { getRows, columnSizing_unstable, tableRef } = fluentui.useTableFeatures(
        {
            columns,
            items,
        },
        [
            fluentui.useTableColumnSizing_unstable({
                columnSizingOptions,
                autoFitColumns: false,
                containerWidthOffset: 20,
            }),
        ],
    );

    const rows = getRows();

    const moveRows = (from: number, to: number) => {
        context.processTableEdit({
            type: designer.DesignerEditType.Move,
            path: [...componentPath, from],
            value: to,
            source: UiArea,
        });

        // Focus on the first cell of the moved row
        const firstCellElementId = context?.getComponentId([
            ...componentPath,
            to,
            columns[1].columnId,
        ]);
        const element = context.elementRefs.current[firstCellElementId];
        element?.focus();
    };

    const getRowError = (index: number): string | undefined => {
        const issue = context?.state.issues?.find((i) => {
            if (!i.propertyPath) {
                return false;
            }
            return i.propertyPath!.join(".") === [...componentPath, index].join(".");
        });
        return issue?.description ?? undefined;
    };

    const renderDragHandle = (rowIndex: number) => {
        return (
            <fluentui.Button
                appearance="subtle"
                size="small"
                className={classes.tableCellButton}
                icon={<ReorderRegular />}
                draggable={true}
                onDragEnter={() => {
                    setDraggedOverRowId(rowIndex);
                }}
                onDragEnd={() => {
                    if (draggedRowId === -1 || draggedOverRowId === -1) {
                        return;
                    }
                    moveRows(draggedRowId, draggedOverRowId);
                    setDraggedRowId(-1);
                    setDraggedOverRowId(-1);
                }}
                onDrag={() => {
                    setDraggedRowId(rowIndex);
                }}
                onDragStart={() => {
                    setDraggedOverRowId(-1);
                    setDraggedRowId(rowIndex);
                }}
            />
        );
    };

    const renderRemoveButton = (
        row: fluentui.TableRowData<designer.DesignerTableComponentDataItem>,
    ) => {
        return (
            <fluentui.Button
                disabled={row.item.canBeDeleted ? !row.item.canBeDeleted : false}
                appearance="subtle"
                size="small"
                className={classes.tableCellButton}
                icon={<DeleteRegular />}
                onClick={async () => {
                    context.processTableEdit({
                        path: [...componentPath, row.rowId],
                        source: UiArea,
                        type: designer.DesignerEditType.Remove,
                        value: undefined,
                    });
                }}
                title={locConstants.tableDesigner.remove(tableProps.objectTypeDisplayName!)}
            />
        );
    };

    const renderPropertiesButton = (
        row: fluentui.TableRowData<designer.DesignerTableComponentDataItem>,
        rowIndex: number,
    ) => {
        return (
            <fluentui.Button
                appearance="subtle"
                size="small"
                className={classes.tableCellButton}
                icon={<SettingsRegular />}
                title={locConstants.tableDesigner.propertiesPaneTitle(
                    tableProps.objectTypeDisplayName ?? "",
                )}
                onClick={() => {
                    context?.setPropertiesComponents({
                        componentPath: [...componentPath, row.rowId],
                        component: component,
                        model: model,
                    });
                    setFocusedRowId(rowIndex);
                }}
            />
        );
    };

    const getTableCell = (
        row: fluentui.TableRowData<designer.DesignerTableComponentDataItem>,
        columnId: fluentui.TableColumnId,
        rowIndex: number,
    ) => {
        const colProps = tableProps.itemProperties?.find((item) => item.propertyName === columnId);
        const value = row.item[columnId];
        switch (columnId) {
            case "dragHandle":
                return renderDragHandle(rowIndex);
            case "remove":
                return renderRemoveButton(row);
            case "properties":
                return renderPropertiesButton(row, rowIndex);
            default: {
                switch (colProps?.componentType) {
                    case "input":
                        return (
                            <DesignerInputBox
                                component={colProps}
                                model={value as designer.InputBoxProperties}
                                componentPath={[...componentPath, row.rowId, columnId]}
                                UiArea={UiArea}
                                showLabel={false}
                                showError={false}
                            />
                        );
                    case "dropdown":
                        return (
                            <div
                                className={classes.tableCell}
                                style={{
                                    marginTop: "2px",
                                }}>
                                <DesignerDropdown
                                    component={colProps}
                                    model={value as designer.DropDownProperties}
                                    componentPath={[...componentPath, row.rowId, columnId]}
                                    UiArea={"TabsView"}
                                    showLabel={false}
                                    showError={false}
                                />
                            </div>
                        );
                    case "checkbox": {
                        return (
                            <div className={classes.tableCell}>
                                <DesignerCheckbox
                                    component={colProps}
                                    model={value as designer.CheckBoxProperties}
                                    componentPath={[...componentPath, row.rowId, columnId]}
                                    UiArea={UiArea}
                                    showLabel={false}
                                />
                            </div>
                        );
                    }
                    default:
                        return "Unknown component type";
                }
            }
        }
    };

    const [draggedRowId, setDraggedRowId] = useState<number>(-1);
    const [draggedOverRowId, setDraggedOverRowId] = useState<number>(-1);
    const [focusedRowId, setFocusedRowId] = useState<number | undefined>(undefined);

    return (
        <div>
            <fluentui.Toolbar size="small">
                {tableProps.canAddRows && (
                    <fluentui.Button
                        appearance="transparent"
                        icon={<AddFilled className={classes.tableActionIcon} />}
                        onClick={() => {
                            context.processTableEdit({
                                path: [...componentPath, rows.length],
                                source: UiArea,
                                type: designer.DesignerEditType.Add,
                                value: undefined,
                            });
                        }}
                        size="small">
                        {tableProps.labelForAddNewButton}
                    </fluentui.Button>
                )}
                {tableProps.canMoveRows && (
                    <fluentui.Button
                        icon={<ArrowSortUpFilled className={classes.tableActionIcon} />}
                        onClick={(event) => {
                            (event.target as HTMLElement).focus();
                            moveRows(focusedRowId!, focusedRowId! - 1);
                        }}
                        disabled={focusedRowId === undefined || focusedRowId === 0}
                        size="small"
                        appearance="transparent">
                        {MOVE_UP}
                    </fluentui.Button>
                )}
                {tableProps.canMoveRows && (
                    <fluentui.Button
                        icon={<ArrowSortDownFilled className={classes.tableActionIcon} />}
                        onClick={(event) => {
                            (event.target as HTMLElement).focus();
                            moveRows(focusedRowId!, focusedRowId! + 1);
                        }}
                        disabled={focusedRowId === undefined || focusedRowId === rows.length - 1}
                        size="small"
                        appearance="transparent">
                        {MOVE_DOWN}
                    </fluentui.Button>
                )}
            </fluentui.Toolbar>
            <div>
                <fluentui.Table
                    as="table"
                    size="extra-small"
                    {...columnSizing_unstable.getTableProps()}
                    ref={tableRef}
                    className={classes.table}
                    style={{
                        width:
                            Object.keys(columnSizingOptions).reduce((acc, curr) => {
                                return acc + columnSizingOptions[curr].idealWidth! + 22;
                            }, 0) - 20,
                    }}>
                    <fluentui.TableHeader
                        style={{
                            backgroundColor: "var(--vscode-keybindingTable-headerBackground)",
                        }}>
                        <fluentui.TableRow>
                            {columnsDef.map((column) => {
                                return (
                                    <fluentui.TableHeaderCell
                                        {...columnSizing_unstable.getTableHeaderCellProps(
                                            column.columnId,
                                        )}
                                        className={classes.tableHeaderCell}
                                        key={column.columnId}>
                                        {column.renderHeaderCell()}
                                    </fluentui.TableHeaderCell>
                                );
                            })}
                        </fluentui.TableRow>
                    </fluentui.TableHeader>
                    <fluentui.TableBody>
                        {rows.map((row, index) => {
                            const rowError = getRowError(index);
                            let backgroundColor =
                                focusedRowId === index
                                    ? "var(--vscode-list-hoverBackground)"
                                    : "var(--vscode-editor-background)";
                            let border = rowError ? "1px solid var(--vscode-errorForeground)" : "";
                            let draggedOverBorder = "3px solid var(--vscode-focusBorder)";
                            return (
                                <fluentui.TableRow
                                    style={{
                                        backgroundColor: backgroundColor,
                                        width: "calc(100% - 10px)",
                                        borderTop:
                                            draggedOverRowId === index &&
                                            draggedRowId !== index &&
                                            draggedRowId > index
                                                ? draggedOverBorder
                                                : border,
                                        borderBottom:
                                            draggedOverRowId === index &&
                                            draggedRowId !== index &&
                                            draggedRowId < index
                                                ? draggedOverBorder
                                                : border,
                                        borderLeft: border,
                                        borderRight: border,
                                    }}
                                    onFocus={(_event) => {
                                        setFocusedRowId(index);
                                        // If properties pane is already open, update its content to show this row's properties
                                        if (
                                            context.state.propertiesPaneData &&
                                            UiArea !== "PropertiesView"
                                        ) {
                                            context?.setPropertiesComponents({
                                                componentPath: [...componentPath, index],
                                                component: component,
                                                model: model,
                                            });
                                        }
                                    }}
                                    key={componentPath.join(".") + index}>
                                    {columnsDef.map((column, columnIndex) => {
                                        return (
                                            <fluentui.TableCell
                                                key={componentPath.join(".") + index + columnIndex}
                                                {...columnSizing_unstable.getTableCellProps(
                                                    column.columnId,
                                                )}
                                                className={classes.tableCellWithBorder}
                                                id={`table-cell-${context?.state.tableInfo?.id}-${componentPath.join("-")}_${index}-${columnIndex}`}
                                                style={{
                                                    height: "30px",
                                                    maxHeight: "30px",
                                                }}>
                                                {getTableCell(row, column.columnId, index)}
                                            </fluentui.TableCell>
                                        );
                                    })}
                                </fluentui.TableRow>
                            );
                        })}
                    </fluentui.TableBody>
                </fluentui.Table>
            </div>
        </div>
    );
};
