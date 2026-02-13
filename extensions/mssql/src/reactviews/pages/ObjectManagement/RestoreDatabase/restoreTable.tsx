/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useMemo, useState } from "react";
import {
    Checkbox,
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
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { locConstants } from "../../../common/locConstants";
import { RestoreDatabaseContext } from "./restoreDatabaseStateProvider";
import { useRestoreDatabaseSelector } from "./restoreDatabaseSelector";
import {
    RestoreDatabaseFileInfo,
    RestoreDatabaseViewModel,
    RestorePlanTableType,
} from "../../../../sharedInterfaces/restore";

const useStyles = makeStyles({
    outerDiv: {
        margin: "20px",
        marginLeft: "0px",
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
        whiteSpace: "nowrap",
    },

    sectionText: {
        padding: "8px 0",
        fontSize: "14px",
        maxWidth: "800px",
        marginLeft: "10px",
        color: tokens.colorNeutralForeground1,
    },
});

type RestorePlanTableItem = {
    rowId: string;
    cells: RestorePlanTableCell[];
};

type RestorePlanTableCell = {
    columnId: TableColumnId;
    value: string | boolean;
};

export const RestorePlanTableContainer = ({
    restoreTableType,
}: {
    restoreTableType: RestorePlanTableType;
}) => {
    const classes = useStyles();
    const context = useContext(RestoreDatabaseContext);

    if (!context) return null;

    const loadState = useRestoreDatabaseSelector(
        (s) => (s.viewModel.model as RestoreDatabaseViewModel).restorePlanStatus,
    );
    const errorMessage = useRestoreDatabaseSelector(
        (s) => (s.viewModel.model as RestoreDatabaseViewModel).errorMessage,
    );

    const renderMainContent = () => {
        switch (loadState) {
            case ApiStatus.NotStarted:
            case ApiStatus.Loading:
                return (
                    <Spinner
                        label={locConstants.restoreDatabase.loadingRestorePlan}
                        labelPosition="below"
                        size="small"
                    />
                );

            case ApiStatus.Loaded:
                switch (restoreTableType) {
                    case RestorePlanTableType.DatabaseFiles:
                        return <RestoreFilesTable />;
                    case RestorePlanTableType.BackupSets:
                        return (
                            <div>
                                <Text className={classes.sectionText}>
                                    {locConstants.restoreDatabase.backupSetsToRestore}{" "}
                                </Text>
                                <RestorePlanTable />
                            </div>
                        );
                    default:
                        return renderErrorContent(locConstants.restoreDatabase.invalidTableType);
                }

            case ApiStatus.Error:
                return renderErrorContent(errorMessage ?? "");

            default:
                return null; // optional: handle unexpected loadState values
        }
    };

    return <div className={classes.outerDiv}>{renderMainContent()}</div>;
};

export const RestorePlanTable = () => {
    const classes = useStyles();
    const context = useContext(RestoreDatabaseContext);

    if (!context) return null;

    const backupSets = useRestoreDatabaseSelector(
        (s) => (s.viewModel.model as RestoreDatabaseViewModel).restorePlan?.backupSetsToRestore,
    );

    if (!backupSets || backupSets.length === 0) {
        return renderErrorContent(locConstants.restoreDatabase.noBackupSets);
    }

    // Initial selected backup sets based on the restore plan data
    const [selectedBackupSets, setSelectedBackupSets] = useState<number[]>(
        backupSets
            .map((backupSet, index) => (backupSet.isSelected ? index : -1))
            .filter((index) => index !== -1),
    );

    const columns: TableColumnDefinition<RestorePlanTableItem>[] = useMemo(() => {
        const dynamicColumns =
            backupSets[0]?.properties.map((property) =>
                createTableColumn<RestorePlanTableItem>({
                    columnId: property.propertyName,
                    renderHeaderCell: () => (
                        <Text className={classes.columnText}>{property.propertyDisplayName}</Text>
                    ),
                }),
            ) ?? [];

        const checkboxColumn = createTableColumn<RestorePlanTableItem>({
            columnId: locConstants.restoreDatabase.restore,
            renderHeaderCell: () => (
                <Text className={classes.columnText}>{locConstants.restoreDatabase.restore}</Text>
            ),
        });

        return [checkboxColumn, ...dynamicColumns];
    }, [backupSets]);

    const items: RestorePlanTableItem[] = useMemo(() => {
        return backupSets.map((backupSet, rowIndex) => {
            // First column: checkbox
            const checkboxCell = {
                columnId: locConstants.restoreDatabase.restore,
                value: backupSet.isSelected,
            };

            // Remaining dynamic property columns
            const propertyCells = backupSet.properties.map((property) => ({
                columnId: property.propertyName,
                value: property.propertyValueDisplayName ?? property.propertyValue ?? "",
            }));

            return {
                rowId: `row-${rowIndex}`,
                cells: [checkboxCell, ...propertyCells],
            };
        });
    }, [backupSets]);

    const columnSizingOptions: TableColumnSizingOptions = useMemo(() => {
        const sizes: TableColumnSizingOptions = {};
        columns.forEach((column) => {
            sizes[column.columnId] = {
                defaultWidth: 100,
                minWidth: 25,
            };
        });
        return sizes;
    }, [columns]);

    const tableFeatures = useTableFeatures<RestorePlanTableItem>(
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
                                    {typeof cell.value === "string" ? (
                                        <Text className={classes.cellText}>{cell.value}</Text>
                                    ) : (
                                        <Checkbox
                                            checked={selectedBackupSets.includes(rowIndex)}
                                            onChange={(e) => {
                                                const checked = e.target.checked;

                                                // Remove from selectedBackupSets if unchecked
                                                let updatedSelectedBackupSets = selectedBackupSets;
                                                if (
                                                    selectedBackupSets.includes(rowIndex) &&
                                                    !checked
                                                ) {
                                                    updatedSelectedBackupSets =
                                                        updatedSelectedBackupSets.filter(
                                                            (index) => index !== rowIndex,
                                                        );
                                                }
                                                // add to selectedBackupSets if checked
                                                else if (
                                                    !selectedBackupSets.includes(rowIndex) &&
                                                    checked
                                                ) {
                                                    updatedSelectedBackupSets = [
                                                        ...updatedSelectedBackupSets,
                                                        rowIndex,
                                                    ];
                                                }

                                                context.updateSelectedBackupSets(
                                                    updatedSelectedBackupSets,
                                                );
                                                setSelectedBackupSets(updatedSelectedBackupSets);
                                            }}
                                        />
                                    )}
                                </TableCell>
                            ))}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
};

export const RestoreFilesTable = () => {
    const classes = useStyles();
    const context = useContext(RestoreDatabaseContext);

    if (!context) return null;

    const dbFiles = useRestoreDatabaseSelector(
        (s) => (s.viewModel.model as RestoreDatabaseViewModel).restorePlan?.dbFiles,
    );

    if (!dbFiles || dbFiles.length === 0) {
        return renderErrorContent(locConstants.restoreDatabase.noDatabaseFiles);
    }

    const columnInfo = [
        { columnId: "logicalName", displayName: locConstants.restoreDatabase.logicalFileName },
        { columnId: "originalName", displayName: locConstants.restoreDatabase.originalFileName },
        { columnId: "type", displayName: locConstants.restoreDatabase.fileType },
        { columnId: "restoreAs", displayName: locConstants.restoreDatabase.restoreAs },
    ];

    const columns: TableColumnDefinition<RestorePlanTableItem>[] = useMemo(() => {
        return (
            columnInfo.map((col) =>
                createTableColumn<RestorePlanTableItem>({
                    columnId: col.columnId,
                    renderHeaderCell: () => (
                        <Text className={classes.columnText}>{col.displayName}</Text>
                    ),
                }),
            ) || []
        );
    }, []);

    const items: RestorePlanTableItem[] = useMemo(() => {
        return (
            dbFiles?.map((dbFile, rowIndex) => {
                const cells = Object.keys(dbFile).map((key, cellIndex) => ({
                    columnId: columns[cellIndex]?.columnId ?? "",
                    value: dbFile[key as keyof RestoreDatabaseFileInfo]?.toString() ?? "",
                }));
                return { rowId: `row-${rowIndex}`, cells };
            }) || []
        );
    }, [dbFiles, columns]);

    const columnSizingOptions: TableColumnSizingOptions = useMemo(() => {
        const sizes: TableColumnSizingOptions = {};
        columns.forEach((column, index) => {
            sizes[column.columnId] = {
                defaultWidth: index ? 60 : 30,
                minWidth: 25,
            };
        });
        return sizes;
    }, [dbFiles, columns]);

    const tableFeatures = useTableFeatures<RestorePlanTableItem>(
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
    );
};

export const renderErrorContent = (errorMessageText: string) => {
    return (
        <div
            style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: "8px",
                flexDirection: "column",
                margin: "20px",
            }}>
            <ErrorCircleRegular
                style={{
                    opacity: 0.5,
                    width: "10%",
                    height: "10%",
                }}
            />
            <Text size={300}>{errorMessageText}</Text>
        </div>
    );
};
