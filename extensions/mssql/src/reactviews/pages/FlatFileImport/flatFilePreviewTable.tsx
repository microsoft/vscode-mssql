/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useMemo } from "react";
import {
    Button,
    createTableColumn,
    makeStyles,
    Spinner,
    Table,
    TableBody,
    TableCell,
    TableColumnDefinition,
    TableColumnId,
    TableColumnSizingOptions,
    TableHeader,
    TableHeaderCell,
    TableRow,
    Text,
    tokens,
    useTableColumnSizing_unstable,
    useTableFeatures,
} from "@fluentui/react-components";
import { ErrorCircleRegular } from "@fluentui/react-icons";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import { locConstants } from "../../common/locConstants";
import { FlatFileContext } from "./flatFileStateProvider";
import { FlatFileHeader } from "./flatFileHeader";
import { FlatFileStepType } from "../../../sharedInterfaces/flatFileImport";
import { useFlatFileSelector } from "./flatFileSelector";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        position: "relative",
        overflowY: "auto",
        padding: "12px", // smaller + responsive
        boxSizing: "border-box",
    },

    spinnerDiv: {
        height: "100%",
        width: "100%",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        padding: "16px",
    },

    errorIcon: {
        fontSize: "100px",
        opacity: 0.5,
    },

    button: {
        height: "30px",
        minWidth: "100px",
        marginRight: "8px",
    },

    bottomDiv: {
        paddingTop: "12px",
        marginLeft: "10px",
        display: "flex",
        flexWrap: "wrap",
        gap: "8px",
    },

    tableDiv: {
        maxWidth: "90vw",
        maxHeight: "60vh",
        overflow: "auto",
        minWidth: "150px",
        boxSizing: "border-box",
        scrollbarGutter: "stable",
        marginTop: "10px",
        marginBottom: "10px",
        marginLeft: "5px",
        width: "100%",
    },

    table: {
        borderCollapse: "collapse",
        width: "100%",
    },

    tableHeader: {
        position: "sticky",
        top: 0,
        zIndex: 1,
    },

    tableHeaderCell: {
        backgroundColor: tokens.colorNeutralBackground6,
        fontSize: "12px",
        fontWeight: 600,
    },

    tableBodyCell: {
        maxHeight: "20px",
        verticalAlign: "middle",
    },

    cellText: {
        fontSize: "12px",
        lineHeight: 1.4,
        overflow: "hidden",
        textOverflow: "ellipsis",
        display: "block",
        width: "100%",
        whiteSpace: "nowrap",
    },

    columnText: {
        fontWeight: 600,
        overflow: "hidden",
        textOverflow: "ellipsis",
    },

    operationText: {
        padding: "8px 0",
        marginLeft: "10px",
        fontSize: "13px",
        maxWidth: "800px",
    },
});

type FlatFileTableItem = {
    rowId: string;
    cells: FlatFileTableCell[];
};

type FlatFileTableCell = {
    columnId: TableColumnId;
    value: string;
};

export const FlatFilePreviewTablePage = () => {
    const classes = useStyles();
    const context = useContext(FlatFileContext);
    const state = useFlatFileSelector((s) => s);

    if (!context || !state) return null;

    const loadState = state.tablePreviewStatus;

    const renderMainContent = () => {
        switch (loadState) {
            case ApiStatus.Loading:
                return (
                    <div className={classes.spinnerDiv}>
                        <Spinner
                            label={locConstants.flatFileImport.loadingTablePreview}
                            labelPosition="below"
                        />
                    </div>
                );
            case ApiStatus.Loaded:
                return <FlatFilePreviewTable />;
            case ApiStatus.Error:
                return (
                    <div className={classes.spinnerDiv}>
                        <ErrorCircleRegular className={classes.errorIcon} />
                        <Text size={400}>{state?.errorMessage ?? ""}</Text>
                    </div>
                );
        }
    };

    return <div className={classes.outerDiv}>{renderMainContent()}</div>;
};

export const FlatFilePreviewTable = () => {
    const classes = useStyles();
    const context = useContext(FlatFileContext);
    const state = useFlatFileSelector((s) => s);

    if (!context || !state) return null;

    const columns: TableColumnDefinition<FlatFileTableItem>[] = useMemo(() => {
        return (
            state.tablePreview?.columnInfo.map((column) =>
                createTableColumn<FlatFileTableItem>({
                    columnId: column.name,
                    renderHeaderCell: () => (
                        <Text className={classes.columnText}>{column.name}</Text>
                    ),
                }),
            ) || []
        );
    }, [state.tablePreview?.columnInfo]);

    const items: FlatFileTableItem[] = useMemo(() => {
        return (
            state.tablePreview?.dataPreview.map((row, rowIndex) => {
                const cells = row.map((cell, cellIndex) => ({
                    columnId: columns[cellIndex]?.columnId ?? "",
                    value: cell,
                }));
                return { rowId: `row-${rowIndex}`, cells };
            }) || []
        );
    }, [state.tablePreview?.dataPreview, columns]);

    const columnSizingOptions: TableColumnSizingOptions = useMemo(() => {
        const sizes: TableColumnSizingOptions = {};
        columns.forEach((column) => {
            sizes[column.columnId] = {
                defaultWidth: 60,
                minWidth: 25,
            };
        });
        return sizes;
    }, [state.tablePreview?.dataPreview, columns]);

    const tableFeatures = useTableFeatures<FlatFileTableItem>(
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

    return (
        <div>
            <FlatFileHeader
                headerText={locConstants.flatFileImport.importFile}
                stepText={locConstants.flatFileImport.stepTwo}
            />

            <Text className={classes.operationText}>
                {locConstants.flatFileImport.operationPreviewText}
            </Text>

            <div className={classes.tableDiv}>
                <Table
                    className={classes.table}
                    size="small"
                    ref={tableFeatures.tableRef}
                    {...tableFeatures.columnSizing_unstable.getTableProps()}>
                    <TableHeader className={classes.tableHeader}>
                        <TableRow>
                            {columns.map((column) => (
                                <TableHeaderCell
                                    key={column.columnId}
                                    className={classes.tableHeaderCell}
                                    {...tableFeatures.columnSizing_unstable.getTableHeaderCellProps(
                                        column.columnId,
                                    )}>
                                    {column.renderHeaderCell()}
                                </TableHeaderCell>
                            ))}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {tableFeatures.getRows().map((row, rowIndex) => (
                            <TableRow key={rowIndex}>
                                {row.item.cells.map((cell, cellIndex) => (
                                    <TableCell
                                        key={cellIndex}
                                        className={classes.tableBodyCell}
                                        {...tableFeatures.columnSizing_unstable.getTableCellProps(
                                            cell.columnId,
                                        )}>
                                        <Text className={classes.cellText}>{cell.value}</Text>
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            <div className={classes.bottomDiv}>
                <Button
                    className={classes.button}
                    type="submit"
                    onClick={() => {
                        context.resetState(FlatFileStepType.TablePreview);
                    }}
                    appearance="secondary">
                    {locConstants.common.previous}
                </Button>
                <Button
                    className={classes.button}
                    type="submit"
                    onClick={() => context.setStep(FlatFileStepType.ColumnChanges)}
                    appearance="primary">
                    {locConstants.common.next}
                </Button>
                <Button
                    className={classes.button}
                    type="submit"
                    onClick={() => context.dispose()}
                    appearance="secondary">
                    {locConstants.common.cancel}
                </Button>
            </div>
        </div>
    );
};
