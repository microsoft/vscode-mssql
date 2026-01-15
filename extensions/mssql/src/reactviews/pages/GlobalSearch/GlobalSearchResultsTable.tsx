/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from "react";
import {
    makeStyles,
    shorthands,
    tokens,
    DataGrid,
    DataGridBody,
    DataGridCell,
    DataGridHeader,
    DataGridHeaderCell,
    DataGridRow,
    TableCellLayout,
    TableColumnDefinition,
    createTableColumn,
    Menu,
    MenuTrigger,
    MenuPopover,
    MenuList,
    MenuItem,
    Button,
    Body1,
} from "@fluentui/react-components";
import {
    MoreHorizontalRegular,
    TableRegular,
    EyeRegular,
    CodeRegular,
    MathFormulaRegular,
    CopyRegular,
    DocumentRegular,
    PlayRegular,
} from "@fluentui/react-icons";
import { SearchResultItem } from "../../../sharedInterfaces/globalSearch";
import { MetadataType } from "../../../sharedInterfaces/metadata";
import { useGlobalSearchContext } from "./GlobalSearchStateProvider";

const useStyles = makeStyles({
    container: {
        width: "100%",
        height: "100%",
    },
    grid: {
        width: "100%",
    },
    emptyState: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "200px",
        color: "var(--vscode-descriptionForeground)",
        ...shorthands.gap("8px"),
    },
    typeCell: {
        display: "flex",
        alignItems: "center",
        ...shorthands.gap("8px"),
    },
    typeIcon: {
        fontSize: "16px",
    },
    row: {
        "&:hover": {
            backgroundColor: "var(--vscode-list-hoverBackground)",
        },
    },
    headerCell: {
        fontWeight: tokens.fontWeightSemibold,
    },
});

interface GlobalSearchResultsTableProps {
    results: SearchResultItem[];
}

const getTypeIcon = (type: MetadataType): React.ReactNode => {
    switch (type) {
        case MetadataType.Table:
            return <TableRegular />;
        case MetadataType.View:
            return <EyeRegular />;
        case MetadataType.SProc:
            return <CodeRegular />;
        case MetadataType.Function:
            return <MathFormulaRegular />;
        default:
            return <DocumentRegular />;
    }
};

export const GlobalSearchResultsTable: React.FC<GlobalSearchResultsTableProps> = React.memo(({ results }) => {
    const classes = useStyles();
    const context = useGlobalSearchContext();

    // Empty state
    if (results.length === 0) {
        return (
            <div className={classes.emptyState}>
                <DocumentRegular style={{ fontSize: "48px" }} />
                <Body1>No objects found</Body1>
                <Body1>Try adjusting your search or filters</Body1>
            </div>
        );
    }

    const columns: TableColumnDefinition<SearchResultItem>[] = [
        createTableColumn<SearchResultItem>({
            columnId: "name",
            compare: (a, b) => a.name.localeCompare(b.name),
            renderHeaderCell: () => <span className={classes.headerCell}>Name</span>,
            renderCell: (item) => (
                <TableCellLayout truncate title={item.fullName}>
                    {item.name}
                </TableCellLayout>
            ),
        }),
        createTableColumn<SearchResultItem>({
            columnId: "schema",
            compare: (a, b) => a.schema.localeCompare(b.schema),
            renderHeaderCell: () => <span className={classes.headerCell}>Schema</span>,
            renderCell: (item) => (
                <TableCellLayout truncate title={item.schema}>
                    {item.schema}
                </TableCellLayout>
            ),
        }),
        createTableColumn<SearchResultItem>({
            columnId: "type",
            compare: (a, b) => a.typeName.localeCompare(b.typeName),
            renderHeaderCell: () => <span className={classes.headerCell}>Type</span>,
            renderCell: (item) => (
                <TableCellLayout>
                    <span className={classes.typeCell}>
                        {getTypeIcon(item.type)}
                        {item.typeName}
                    </span>
                </TableCellLayout>
            ),
        }),
        createTableColumn<SearchResultItem>({
            columnId: "actions",
            renderHeaderCell: () => <span className={classes.headerCell}>Actions</span>,
            renderCell: (item) => <ActionsMenu item={item} context={context} />,
        }),
    ];

    return (
        <div className={classes.container}>
            <DataGrid
                className={classes.grid}
                items={results}
                columns={columns}
                sortable
                resizableColumns
                size="small"
                getRowId={(item) => item.fullName}
            >
                <DataGridHeader>
                    <DataGridRow>
                        {({ renderHeaderCell }) => (
                            <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>
                        )}
                    </DataGridRow>
                </DataGridHeader>
                <DataGridBody<SearchResultItem>>
                    {({ item, rowId }) => (
                        <DataGridRow<SearchResultItem>
                            key={rowId}
                            className={classes.row}
                        >
                            {({ renderCell }) => (
                                <DataGridCell>{renderCell(item)}</DataGridCell>
                            )}
                        </DataGridRow>
                    )}
                </DataGridBody>
            </DataGrid>
        </div>
    );
});

interface ActionsMenuProps {
    item: SearchResultItem;
    context: ReturnType<typeof useGlobalSearchContext>;
}

const ActionsMenu: React.FC<ActionsMenuProps> = ({ item, context }) => {
    const isTableOrView =
        item.type === MetadataType.Table || item.type === MetadataType.View;

    return (
        <Menu>
            <MenuTrigger disableButtonEnhancement>
                <Button
                    appearance="subtle"
                    icon={<MoreHorizontalRegular />}
                    size="small"
                    aria-label="Actions"
                />
            </MenuTrigger>
            <MenuPopover>
                <MenuList>
                    {isTableOrView && (
                        <MenuItem
                            icon={<PlayRegular />}
                            onClick={() => context.scriptObject(item, "SELECT")}
                        >
                            Select Top 1000
                        </MenuItem>
                    )}
                    <MenuItem
                        icon={<DocumentRegular />}
                        onClick={() => context.scriptObject(item, "CREATE")}
                    >
                        Script as CREATE
                    </MenuItem>
                    <MenuItem
                        icon={<DocumentRegular />}
                        onClick={() => context.scriptObject(item, "DROP")}
                    >
                        Script as DROP
                    </MenuItem>
                    <MenuItem
                        icon={<CopyRegular />}
                        onClick={() => context.copyObjectName(item)}
                    >
                        Copy Object Name
                    </MenuItem>
                </MenuList>
            </MenuPopover>
        </Menu>
    );
};
