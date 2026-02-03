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
    TableColumnSizingOptions,
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
    EditRegular,
    DeleteRegular,
    TableEditRegular,
} from "@fluentui/react-icons";
import { SearchResultItem, ScriptType } from "../../../sharedInterfaces/globalSearch";
import { MetadataType } from "../../../sharedInterfaces/metadata";
import { useGlobalSearchContext } from "./GlobalSearchStateProvider";
import { locConstants as loc } from "../../common/locConstants";

const useStyles = makeStyles({
    container: {
        width: "100%",
        height: "100%",
        overflowX: "hidden",
        overflowY: "auto",
    },
    grid: {
        width: "100%",
    },
    header: {
        position: "sticky",
        top: 0,
        zIndex: 1,
        backgroundColor: "var(--vscode-editor-background)",
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

const iconStyle = { fontSize: "16px", color: "var(--vscode-foreground)" };

const getTypeIcon = (type: MetadataType): JSX.Element => {
    switch (type) {
        case MetadataType.Table:
            return <TableRegular style={iconStyle} />;
        case MetadataType.View:
            return <EyeRegular style={iconStyle} />;
        case MetadataType.SProc:
            return <CodeRegular style={iconStyle} />;
        case MetadataType.Function:
            return <MathFormulaRegular style={iconStyle} />;
        default:
            return <DocumentRegular style={iconStyle} />;
    }
};

export const GlobalSearchResultsTable: React.FC<GlobalSearchResultsTableProps> = React.memo(
    ({ results }) => {
        const classes = useStyles();
        const context = useGlobalSearchContext();

        const columnSizingOptions: TableColumnSizingOptions = {
            icon: {
                minWidth: 32,
                defaultWidth: 32,
                idealWidth: 32,
            },
            name: {
                minWidth: 200,
                defaultWidth: 250,
            },
            schema: {
                minWidth: 80,
                defaultWidth: 100,
            },
            type: {
                minWidth: 120,
                defaultWidth: 160,
            },
            actions: {
                minWidth: 80,
                defaultWidth: 80,
            },
        };

        // Empty state
        if (results.length === 0) {
            return (
                <div className={classes.emptyState}>
                    <DocumentRegular style={{ fontSize: "48px" }} />
                    <Body1>{loc.globalSearch.noObjectsFound}</Body1>
                    <Body1>{loc.globalSearch.tryAdjustingFilters}</Body1>
                </div>
            );
        }

        const columns: TableColumnDefinition<SearchResultItem>[] = [
            createTableColumn<SearchResultItem>({
                columnId: "icon",
                renderHeaderCell: () => null,
                renderCell: (item) => <TableCellLayout>{getTypeIcon(item.type)}</TableCellLayout>,
            }),
            createTableColumn<SearchResultItem>({
                columnId: "name",
                compare: (a, b) => a.name.localeCompare(b.name),
                renderHeaderCell: () => (
                    <span className={classes.headerCell}>{loc.globalSearch.name}</span>
                ),
                renderCell: (item) => (
                    <TableCellLayout truncate title={item.fullName}>
                        {item.name}
                    </TableCellLayout>
                ),
            }),
            createTableColumn<SearchResultItem>({
                columnId: "schema",
                compare: (a, b) => a.schema.localeCompare(b.schema),
                renderHeaderCell: () => (
                    <span className={classes.headerCell}>{loc.globalSearch.schema}</span>
                ),
                renderCell: (item) => (
                    <TableCellLayout truncate title={item.schema}>
                        {item.schema}
                    </TableCellLayout>
                ),
            }),
            createTableColumn<SearchResultItem>({
                columnId: "type",
                compare: (a, b) => a.typeName.localeCompare(b.typeName),
                renderHeaderCell: () => (
                    <span className={classes.headerCell}>{loc.globalSearch.type}</span>
                ),
                renderCell: (item) => <TableCellLayout truncate>{item.typeName}</TableCellLayout>,
            }),
            createTableColumn<SearchResultItem>({
                columnId: "actions",
                renderHeaderCell: () => (
                    <span className={classes.headerCell}>{loc.globalSearch.actions}</span>
                ),
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
                    columnSizingOptions={columnSizingOptions}
                    size="small"
                    getRowId={(item) => item.fullName}>
                    <DataGridHeader className={classes.header}>
                        <DataGridRow>
                            {({ renderHeaderCell }) => (
                                <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>
                            )}
                        </DataGridRow>
                    </DataGridHeader>
                    <DataGridBody<SearchResultItem>>
                        {({ item, rowId }) => (
                            <DataGridRow<SearchResultItem> key={rowId} className={classes.row}>
                                {({ renderCell }) => (
                                    <DataGridCell>{renderCell(item)}</DataGridCell>
                                )}
                            </DataGridRow>
                        )}
                    </DataGridBody>
                </DataGrid>
            </div>
        );
    },
);

/**
 * Determines which script actions are available for a given object type
 */
const getAvailableActions = (item: SearchResultItem): ScriptType[] => {
    const actions: ScriptType[] = [];

    switch (item.type) {
        case MetadataType.Table:
            // Tables: Select, Create, Drop
            actions.push("SELECT", "CREATE", "DROP");
            break;
        case MetadataType.View:
            // Views: Select, Create, Drop, Alter
            actions.push("SELECT", "CREATE", "DROP", "ALTER");
            break;
        case MetadataType.SProc:
            // Stored Procedures: Create, Drop, Alter, Execute
            actions.push("CREATE", "DROP", "ALTER", "EXECUTE");
            break;
        case MetadataType.Function:
            // Functions: Create, Drop, Alter
            actions.push("CREATE", "DROP", "ALTER");
            break;
        default:
            // Default fallback
            actions.push("CREATE", "DROP");
    }

    return actions;
};

interface ActionsMenuProps {
    item: SearchResultItem;
    context: ReturnType<typeof useGlobalSearchContext>;
}

const ActionsMenu: React.FC<ActionsMenuProps> = ({ item, context }) => {
    const availableActions = getAvailableActions(item);

    return (
        <Menu>
            <MenuTrigger disableButtonEnhancement>
                <Button
                    appearance="subtle"
                    icon={<MoreHorizontalRegular />}
                    size="small"
                    aria-label={loc.globalSearch.actions}
                />
            </MenuTrigger>
            <MenuPopover>
                <MenuList>
                    {availableActions.includes("SELECT") && (
                        <MenuItem
                            icon={<PlayRegular />}
                            onClick={() => context.scriptObject(item, "SELECT")}>
                            {loc.globalSearch.selectTop1000}
                        </MenuItem>
                    )}
                    {availableActions.includes("CREATE") && (
                        <MenuItem
                            icon={<DocumentRegular />}
                            onClick={() => context.scriptObject(item, "CREATE")}>
                            {loc.globalSearch.scriptAsCreate}
                        </MenuItem>
                    )}
                    {availableActions.includes("DROP") && (
                        <MenuItem
                            icon={<DeleteRegular />}
                            onClick={() => context.scriptObject(item, "DROP")}>
                            {loc.globalSearch.scriptAsDrop}
                        </MenuItem>
                    )}
                    {availableActions.includes("ALTER") && (
                        <MenuItem
                            icon={<EditRegular />}
                            onClick={() => context.scriptObject(item, "ALTER")}>
                            {loc.globalSearch.scriptAsAlter}
                        </MenuItem>
                    )}
                    {availableActions.includes("EXECUTE") && (
                        <MenuItem
                            icon={<PlayRegular />}
                            onClick={() => context.scriptObject(item, "EXECUTE")}>
                            {loc.globalSearch.scriptAsExecute}
                        </MenuItem>
                    )}
                    {item.type === MetadataType.Table && (
                        <MenuItem
                            icon={<TableEditRegular />}
                            onClick={() => context.editData(item)}>
                            {loc.globalSearch.editData}
                        </MenuItem>
                    )}
                    {item.type === MetadataType.Table && (
                        <MenuItem icon={<TableRegular />} onClick={() => context.modifyTable(item)}>
                            {loc.globalSearch.modifyTable}
                        </MenuItem>
                    )}
                    <MenuItem icon={<CopyRegular />} onClick={() => context.copyObjectName(item)}>
                        {loc.globalSearch.copyObjectName}
                    </MenuItem>
                </MenuList>
            </MenuPopover>
        </Menu>
    );
};
