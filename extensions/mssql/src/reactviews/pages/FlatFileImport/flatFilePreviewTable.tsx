/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useMemo, useState } from "react";
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
import { FlatFileColumnSettings } from "./flatFileColumnSettings";
import { FlatFileForm } from "./flatFileForm";

const useStyles = makeStyles({
    outerDiv: {
        height: "100%",
        width: "100%",
        position: "relative",
        overflowY: "auto",
        overflowX: "unset",
    },

    spinnerDiv: {
        height: "100%",
        width: "100%",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        padding: "20px",
    },

    errorIcon: {
        fontSize: "100px",
        opacity: 0.5,
    },

    button: {
        height: "32px",
        width: "120px",
        margin: "5px",
    },

    bottomDiv: {
        bottom: 0,
        paddingBottom: "25px",
    },

    tableDiv: {
        overflow: "auto",
        position: "relative",
        width: "85%",
        margin: "20px 20px 20px 0px",
    },

    table: {
        tableLayout: "fixed",
        marginLeft: "20px",
        marginRight: "20px",
        width: "100%",
        height: "100%",
    },

    tableHeader: {
        position: "sticky",
        top: 0,
        zIndex: 1,
        opacity: 1,
    },

    tableHeaderCell: {
        overflow: "hidden",
        backgroundColor: tokens.colorNeutralBackground6,
        opacity: 1,
    },

    tableBodyCell: {
        overflow: "hidden",
    },

    cellText: {
        fontWeight: 400,
        fontSize: "12px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        display: "block",
        width: "100%",
    },

    columnText: {
        fontWeight: 600,
        overflow: "hidden",
        textOverflow: "ellipsis",
    },

    operationText: {
        whiteSpace: "wrap",
        margin: "20px",
    },
});

type Item = {
    rowId: string;
    cells: Cell[];
};

type Cell = {
    columnId: TableColumnId;
    value: string;
};

export const FlatFilePreviewTablePage = () => {
    const classes = useStyles();
    const context = useContext(FlatFileContext);
    const state = context?.state;

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
    const state = context?.state;

    if (!context || !state) return null;

    const [showNext, setShowNext] = useState<boolean>(false);
    const [showPrevious, setShowPrevious] = useState<boolean>(false);

    const columns: TableColumnDefinition<Item>[] = useMemo(() => {
        return (
            state.tablePreview?.columnInfo.map((column) =>
                createTableColumn<Item>({
                    columnId: column.name,
                    renderHeaderCell: () => (
                        <Text className={classes.columnText}>{column.name}</Text>
                    ),
                }),
            ) || []
        );
    }, [state.tablePreview?.columnInfo]);

    const items: Item[] = useMemo(() => {
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
            sizes[column.columnId] = { defaultWidth: 50, minWidth: 20 };
        });
        return sizes;
    }, [state.tablePreview?.dataPreview, columns]);

    const tableFeatures = useTableFeatures<Item>(
        {
            columns,
            items,
        },
        [
            useTableColumnSizing_unstable({
                columnSizingOptions,
                autoFitColumns: false,
                containerWidthOffset: 20,
            }),
        ],
    );

    return showPrevious ? (
        <FlatFileForm />
    ) : showNext ? (
        <FlatFileColumnSettings />
    ) : (
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
                    onClick={() => setShowPrevious(true)}
                    appearance="secondary">
                    {locConstants.common.previous}
                </Button>
                <Button
                    className={classes.button}
                    type="submit"
                    onClick={() => setShowNext(true)}
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
