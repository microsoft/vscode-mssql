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

export const GlobalSearchFilters: React.FC = React.memo(() => {
    const classes = useStyles();
    const context = useGlobalSearchContext();

    // State selectors
    const selectedDatabase = useGlobalSearchSelector((s) => s.selectedDatabase);
    const availableDatabases = useGlobalSearchSelector((s) => s.availableDatabases);
    const objectTypeFilters = useGlobalSearchSelector((s) => s.objectTypeFilters);
    const availableSchemas = useGlobalSearchSelector((s) => s.availableSchemas);
    const selectedSchemas = useGlobalSearchSelector((s) => s.selectedSchemas);

    // Create a Set for O(1) lookup of selected schemas
    const selectedSchemaSet = React.useMemo(() => new Set(selectedSchemas), [selectedSchemas]);

    const handleDatabaseChange = (_event: React.SyntheticEvent, data: { optionValue?: string }) => {
        if (data.optionValue) {
            context.setDatabase(data.optionValue);
        }
    };

    const handleFilterToggle = (filterKey: keyof ObjectTypeFilters) => {
        context.toggleObjectTypeFilter(filterKey);
    };

    const handleSchemaToggle = (schema: string) => {
        context.toggleSchemaFilter(schema);
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
                        checked={objectTypeFilters.tables}
                        onChange={() => handleFilterToggle("tables")}
                        label={
                            <span className={classes.checkboxLabel}>
                                <TableRegular className={classes.typeIcon} />
                                {loc.globalSearch.tables}
                            </span>
                        }
                    />
                    <Checkbox
                        checked={objectTypeFilters.views}
                        onChange={() => handleFilterToggle("views")}
                        label={
                            <span className={classes.checkboxLabel}>
                                <EyeRegular className={classes.typeIcon} />
                                {loc.globalSearch.views}
                            </span>
                        }
                    />
                    <Checkbox
                        checked={objectTypeFilters.storedProcedures}
                        onChange={() => handleFilterToggle("storedProcedures")}
                        label={
                            <span className={classes.checkboxLabel}>
                                <CodeRegular className={classes.typeIcon} />
                                {loc.globalSearch.storedProcedures}
                            </span>
                        }
                    />
                    <Checkbox
                        checked={objectTypeFilters.functions}
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
