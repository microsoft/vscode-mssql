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
    loadPropertiesTabData?: boolean;
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
});

export const DesignerTable = ({
    component,
    model,
    componentPath,
    UiArea,
    loadPropertiesTabData = true,
}: DesignerTableProps) => {
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
                renderHeaderCell: () => <>{colProps?.componentProperties.title ?? column}</>,
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

    const getTableCell = (
        row: fluentui.TableRowData<designer.DesignerTableComponentDataItem>,
        columnId: fluentui.TableColumnId,
        rowIndex: number,
    ) => {
        const colProps = tableProps.itemProperties?.find((item) => item.propertyName === columnId);
        const value = row.item[columnId];
        switch (columnId) {
            case "dragHandle":
                return (
                    <div className={classes.tableCell}>
                        {tableProps.canMoveRows && (
                            <fluentui.Button
                                appearance="subtle"
                                size="small"
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
                        )}
                    </div>
                );
            case "remove":
                return (
                    <fluentui.Button
                        disabled={row.item.canBeDeleted ? !row.item.canBeDeleted : false}
                        appearance="subtle"
                        size="small"
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
            case "properties":
                return (
                    <fluentui.Button
                        appearance="subtle"
                        size="small"
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
                            <div className={classes.tableCell}>
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
            <div
                style={{
                    maxWidth: "calc(100% - 20px)",
                    width: "fit-content",
                    overflowX: "auto",
                    paddingBottom: "5px",
                    paddingRight: "5px",
                    paddingLeft: "5px",
                }}>
                <fluentui.Table
                    as="table"
                    size="extra-small"
                    {...columnSizing_unstable.getTableProps()}
                    ref={tableRef}
                    style={{
                        marginRight: "5px",
                        width:
                            Object.keys(columnSizingOptions).reduce((acc, curr) => {
                                return acc + columnSizingOptions[curr].idealWidth! + 22;
                            }, 0) - 20,
                    }}>
                    <fluentui.TableHeader
                        style={{
                            marginBottom: "5px",
                            backgroundColor: "var(--vscode-keybindingTable-headerBackground)",
                        }}>
                        <fluentui.TableRow>
                            {columnsDef.map((column) => {
                                return (
                                    <fluentui.TableHeaderCell
                                        {...columnSizing_unstable.getTableHeaderCellProps(
                                            column.columnId,
                                        )}
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
                                        marginTop: rowError ? "5px" : "",
                                    }}
                                    onFocus={(_event) => {
                                        setFocusedRowId(index);
                                    }}
                                    key={componentPath.join(".") + index}>
                                    {columnsDef.map((column, columnIndex) => {
                                        return (
                                            <fluentui.TableCell
                                                key={componentPath.join(".") + index + columnIndex}
                                                {...columnSizing_unstable.getTableCellProps(
                                                    column.columnId,
                                                )}
                                                id={`table-cell-${context?.state.tableInfo?.id}-${componentPath.join("-")}_${index}-${columnIndex}`}
                                                style={{
                                                    height: "30px",
                                                    paddingBottom: "5px",
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
