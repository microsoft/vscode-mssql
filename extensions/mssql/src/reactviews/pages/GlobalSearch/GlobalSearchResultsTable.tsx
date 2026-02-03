/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
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
import {
    SearchResultItem,
    ScriptType,
    ObjectTypeFilters,
} from "../../../sharedInterfaces/globalSearch";
import { MetadataType } from "../../../sharedInterfaces/metadata";
import { useGlobalSearchContext } from "./GlobalSearchStateProvider";
import { useGlobalSearchSelector } from "./globalSearchSelector";
import { locConstants as loc } from "../../common/locConstants";
import { ColumnHeaderFilter } from "./ColumnHeaderFilter";

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

// Helper to convert ObjectTypeFilters to type name array
const objectTypeFiltersToTypeNames = (filters: ObjectTypeFilters): string[] => {
    const typeNames: string[] = [];
    if (filters.tables) typeNames.push(loc.globalSearch.typeTable);
    if (filters.views) typeNames.push(loc.globalSearch.typeView);
    if (filters.storedProcedures) typeNames.push(loc.globalSearch.typeStoredProcedure);
    if (filters.functions) typeNames.push(loc.globalSearch.typeFunction);
    return typeNames;
};

// Helper to convert type name array to ObjectTypeFilters
const typeNamesToObjectTypeFilters = (typeNames: string[]): ObjectTypeFilters => {
    return {
        tables: typeNames.includes(loc.globalSearch.typeTable),
        views: typeNames.includes(loc.globalSearch.typeView),
        storedProcedures: typeNames.includes(loc.globalSearch.typeStoredProcedure),
        functions: typeNames.includes(loc.globalSearch.typeFunction),
    };
};

// Helper to detect search prefix and return the corresponding type name
const getTypeFromSearchPrefix = (searchTerm: string): string | null => {
    const trimmed = searchTerm.trim().toLowerCase();
    if (trimmed.startsWith("t:")) return loc.globalSearch.typeTable;
    if (trimmed.startsWith("v:")) return loc.globalSearch.typeView;
    if (trimmed.startsWith("f:")) return loc.globalSearch.typeFunction;
    if (trimmed.startsWith("sp:")) return loc.globalSearch.typeStoredProcedure;
    return null;
};

export const GlobalSearchResultsTable: React.FC<GlobalSearchResultsTableProps> = React.memo(
    ({ results }) => {
        const classes = useStyles();
        const context = useGlobalSearchContext();

        // Read filter state from global state
        const selectedSchemas = useGlobalSearchSelector((s) => s.selectedSchemas);
        const availableSchemasFromState = useGlobalSearchSelector((s) => s.availableSchemas);
        const objectTypeFilters = useGlobalSearchSelector((s) => s.objectTypeFilters);
        const searchTerm = useGlobalSearchSelector((s) => s.searchTerm);

        // Local name filter (kept local since search term has different semantics with prefix support)
        const [nameFilter, setNameFilter] = useState<string>("");

        // Store nameFilter in a ref so we can access it without triggering the sync effect
        const nameFilterRef = useRef(nameFilter);
        nameFilterRef.current = nameFilter;

        // Clear local name filter when global searchTerm is cleared (e.g., by refresh button)
        // Only depends on searchTerm - we use a ref for nameFilter to avoid
        // triggering this effect when the user is typing (which would clear their input)
        useEffect(() => {
            if (searchTerm === "" && nameFilterRef.current !== "") {
                setNameFilter("");
            }
        }, [searchTerm]);

        // Check if search has a type prefix - if so, that overrides the panel type filters
        const searchPrefixType = useMemo(() => getTypeFromSearchPrefix(searchTerm), [searchTerm]);

        // Convert global type filters to type names for the column filter
        // If a search prefix is active, show only that type as selected
        const typeColumnFilter = useMemo(() => {
            if (searchPrefixType) {
                return [searchPrefixType];
            }
            return objectTypeFiltersToTypeNames(objectTypeFilters);
        }, [objectTypeFilters, searchPrefixType]);

        // Available types based on what types are enabled (all 4 types)
        const availableTypes = useMemo(() => {
            return [
                loc.globalSearch.typeTable,
                loc.globalSearch.typeView,
                loc.globalSearch.typeStoredProcedure,
                loc.globalSearch.typeFunction,
            ];
        }, []);

        // Handlers to update global state
        const handleSchemaFilterChange = useCallback(
            (schemas: string[]) => {
                context.setSchemaFilters(schemas);
            },
            [context],
        );

        const handleTypeFilterChange = useCallback(
            (typeNames: string[]) => {
                // If a search prefix is active, don't allow changing type filters from the grid
                // (the prefix takes precedence)
                if (searchPrefixType) {
                    return;
                }
                const filters = typeNamesToObjectTypeFilters(typeNames);
                context.setObjectTypeFilters(filters);
            },
            [context, searchPrefixType],
        );

        // Apply only name filter locally (schema and type are handled globally)
        const filteredResults = useMemo(() => {
            let filtered = results;
            if (nameFilter) {
                filtered = filtered.filter((r) =>
                    r.name.toLowerCase().includes(nameFilter.toLowerCase()),
                );
            }
            return filtered;
        }, [results, nameFilter]);

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
                    <ColumnHeaderFilter
                        type="text"
                        label={loc.globalSearch.name}
                        value={nameFilter}
                        onChange={setNameFilter}
                        placeholder={loc.globalSearch.filterByName}
                    />
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
                    <ColumnHeaderFilter
                        type="multiselect"
                        label={loc.globalSearch.schema}
                        options={availableSchemasFromState}
                        selectedValues={selectedSchemas}
                        onChange={handleSchemaFilterChange}
                    />
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
                    <ColumnHeaderFilter
                        type="multiselect"
                        label={loc.globalSearch.type}
                        options={availableTypes}
                        selectedValues={typeColumnFilter}
                        onChange={handleTypeFilterChange}
                    />
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
                    items={filteredResults}
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
                {/* Empty state - shown below grid headers when no results */}
                {filteredResults.length === 0 && (
                    <div className={classes.emptyState}>
                        <DocumentRegular style={{ fontSize: "48px" }} />
                        <Body1>{loc.globalSearch.noObjectsFound}</Body1>
                        <Body1>{loc.globalSearch.tryAdjustingFilters}</Body1>
                    </div>
                )}
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
