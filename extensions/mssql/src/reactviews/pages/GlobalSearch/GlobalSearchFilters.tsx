/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from "react";
import {
    makeStyles,
    shorthands,
    tokens,
    Dropdown,
    Option,
    Checkbox,
    Label,
    Divider,
    Link,
} from "@fluentui/react-components";
import { TableRegular, EyeRegular, CodeRegular, MathFormulaRegular } from "@fluentui/react-icons";
import { useGlobalSearchSelector } from "./globalSearchSelector";
import { useGlobalSearchContext } from "./GlobalSearchStateProvider";
import { ObjectTypeFilters } from "../../../sharedInterfaces/globalSearch";
import { locConstants as loc } from "../../common/locConstants";

const useStyles = makeStyles({
    container: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("16px"),
    },
    section: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("8px"),
    },
    sectionTitle: {
        fontSize: tokens.fontSizeBase300,
        fontWeight: tokens.fontWeightSemibold,
        color: "var(--vscode-foreground)",
        marginBottom: "4px",
    },
    dropdown: {
        width: "100%",
        minWidth: "100%",
        "& button": {
            width: "100%",
        },
    },
    checkboxGroup: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("4px"),
    },
    checkboxLabel: {
        display: "flex",
        alignItems: "center",
        ...shorthands.gap("8px"),
    },
    typeIcon: {
        fontSize: "16px",
        color: "var(--vscode-foreground)",
    },
    schemaSection: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("8px"),
    },
    schemaSectionHeader: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
    },
    schemaActions: {
        display: "flex",
        ...shorthands.gap("4px"),
    },
    schemaList: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("4px"),
    },
});

// Helper to detect if search has a type prefix
const hasTypePrefix = (searchTerm: string): boolean => {
    const trimmed = searchTerm.trim().toLowerCase();
    return (
        trimmed.startsWith("t:") ||
        trimmed.startsWith("v:") ||
        trimmed.startsWith("f:") ||
        trimmed.startsWith("sp:")
    );
};

// Helper to get which type is active from the search prefix
const getActiveTypeFromPrefix = (
    searchTerm: string,
): keyof ObjectTypeFilters | null => {
    const trimmed = searchTerm.trim().toLowerCase();
    if (trimmed.startsWith("t:")) return "tables";
    if (trimmed.startsWith("v:")) return "views";
    if (trimmed.startsWith("f:")) return "functions";
    if (trimmed.startsWith("sp:")) return "storedProcedures";
    return null;
};

export const GlobalSearchFilters: React.FC = React.memo(() => {
    const classes = useStyles();
    const context = useGlobalSearchContext();

    // State selectors
    const selectedDatabase = useGlobalSearchSelector((s) => s.selectedDatabase);
    const availableDatabases = useGlobalSearchSelector((s) => s.availableDatabases);
    const objectTypeFilters = useGlobalSearchSelector((s) => s.objectTypeFilters);
    const availableSchemas = useGlobalSearchSelector((s) => s.availableSchemas);
    const selectedSchemas = useGlobalSearchSelector((s) => s.selectedSchemas);
    const searchTerm = useGlobalSearchSelector((s) => s.searchTerm);

    // Check if search prefix is overriding type filters
    const searchHasTypePrefix = React.useMemo(() => hasTypePrefix(searchTerm), [searchTerm]);
    const activeTypeFromPrefix = React.useMemo(
        () => getActiveTypeFromPrefix(searchTerm),
        [searchTerm],
    );

    // Create a Set for O(1) lookup of selected schemas
    const selectedSchemaSet = React.useMemo(() => new Set(selectedSchemas), [selectedSchemas]);

    const handleDatabaseChange = (_event: React.SyntheticEvent, data: { optionValue?: string }) => {
        if (data.optionValue) {
            context.setDatabase(data.optionValue);
        }
    };

    const handleFilterToggle = (filterKey: keyof ObjectTypeFilters) => {
        // Don't toggle if search prefix is active (it overrides)
        if (searchHasTypePrefix) {
            return;
        }
        context.toggleObjectTypeFilter(filterKey);
    };

    const handleSchemaToggle = (schema: string) => {
        context.toggleSchemaFilter(schema);
    };

    // Helper to determine if a type checkbox should be checked
    // When search prefix is active, only that type shows as checked
    const isTypeChecked = (filterKey: keyof ObjectTypeFilters): boolean => {
        if (searchHasTypePrefix) {
            return activeTypeFromPrefix === filterKey;
        }
        return objectTypeFilters[filterKey];
    };

    return (
        <div className={classes.container}>
            {/* Database Selector */}
            <div className={classes.section}>
                <Label className={classes.sectionTitle}>{loc.globalSearch.database}</Label>
                <Dropdown
                    className={classes.dropdown}
                    value={selectedDatabase}
                    selectedOptions={[selectedDatabase]}
                    onOptionSelect={handleDatabaseChange}
                    size="small">
                    {availableDatabases.map((db) => (
                        <Option key={db} value={db}>
                            {db}
                        </Option>
                    ))}
                </Dropdown>
            </div>

            <Divider />

            {/* Object Type Filters */}
            <div className={classes.section}>
                <Label className={classes.sectionTitle}>{loc.globalSearch.objectTypes}</Label>
                <div className={classes.checkboxGroup}>
                    <Checkbox
                        checked={isTypeChecked("tables")}
                        disabled={searchHasTypePrefix}
                        onChange={() => handleFilterToggle("tables")}
                        label={
                            <span className={classes.checkboxLabel}>
                                <TableRegular className={classes.typeIcon} />
                                {loc.globalSearch.tables}
                            </span>
                        }
                    />
                    <Checkbox
                        checked={isTypeChecked("views")}
                        disabled={searchHasTypePrefix}
                        onChange={() => handleFilterToggle("views")}
                        label={
                            <span className={classes.checkboxLabel}>
                                <EyeRegular className={classes.typeIcon} />
                                {loc.globalSearch.views}
                            </span>
                        }
                    />
                    <Checkbox
                        checked={isTypeChecked("storedProcedures")}
                        disabled={searchHasTypePrefix}
                        onChange={() => handleFilterToggle("storedProcedures")}
                        label={
                            <span className={classes.checkboxLabel}>
                                <CodeRegular className={classes.typeIcon} />
                                {loc.globalSearch.storedProcedures}
                            </span>
                        }
                    />
                    <Checkbox
                        checked={isTypeChecked("functions")}
                        disabled={searchHasTypePrefix}
                        onChange={() => handleFilterToggle("functions")}
                        label={
                            <span className={classes.checkboxLabel}>
                                <MathFormulaRegular className={classes.typeIcon} />
                                {loc.globalSearch.functions}
                            </span>
                        }
                    />
                </div>
            </div>

            {availableSchemas.length > 0 && (
                <>
                    <Divider />

                    {/* Schema Filters */}
                    <div className={classes.schemaSection}>
                        <div className={classes.schemaSectionHeader}>
                            <Label className={classes.sectionTitle}>
                                {loc.globalSearch.schemas}
                            </Label>
                            <div className={classes.schemaActions}>
                                <Link onClick={() => context.selectAllSchemas()}>
                                    {loc.globalSearch.all}
                                </Link>
                                <Link onClick={() => context.clearSchemaSelection()}>
                                    {loc.globalSearch.none}
                                </Link>
                            </div>
                        </div>
                        <div className={classes.schemaList}>
                            {availableSchemas.map((schema) => (
                                <Checkbox
                                    key={schema}
                                    checked={selectedSchemaSet.has(schema)}
                                    onChange={() => handleSchemaToggle(schema)}
                                    label={schema}
                                />
                            ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
});
