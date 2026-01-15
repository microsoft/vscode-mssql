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
} from "@fluentui/react-components";
import {
    TableRegular,
    EyeRegular,
    CodeRegular,
    MathFormulaRegular,
} from "@fluentui/react-icons";
import { useGlobalSearchSelector } from "./globalSearchSelector";
import { useGlobalSearchContext } from "./GlobalSearchStateProvider";
import { ObjectTypeFilters } from "../../../sharedInterfaces/globalSearch";

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
});

export const GlobalSearchFilters: React.FC = () => {
    const classes = useStyles();
    const context = useGlobalSearchContext();

    // State selectors
    const selectedDatabase = useGlobalSearchSelector((s) => s.selectedDatabase);
    const availableDatabases = useGlobalSearchSelector((s) => s.availableDatabases);
    const objectTypeFilters = useGlobalSearchSelector((s) => s.objectTypeFilters);

    const handleDatabaseChange = (
        _event: React.SyntheticEvent,
        data: { optionValue?: string },
    ) => {
        if (data.optionValue) {
            context.setDatabase(data.optionValue);
        }
    };

    const handleFilterToggle = (filterKey: keyof ObjectTypeFilters) => {
        context.toggleObjectTypeFilter(filterKey);
    };

    return (
        <div className={classes.container}>
            {/* Database Selector */}
            <div className={classes.section}>
                <Label className={classes.sectionTitle}>Database</Label>
                <Dropdown
                    className={classes.dropdown}
                    value={selectedDatabase}
                    selectedOptions={[selectedDatabase]}
                    onOptionSelect={handleDatabaseChange}
                    size="small"
                >
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
                <Label className={classes.sectionTitle}>Object Types</Label>
                <div className={classes.checkboxGroup}>
                    <Checkbox
                        checked={objectTypeFilters.tables}
                        onChange={() => handleFilterToggle("tables")}
                        label={
                            <span className={classes.checkboxLabel}>
                                <TableRegular className={classes.typeIcon} />
                                Tables
                            </span>
                        }
                    />
                    <Checkbox
                        checked={objectTypeFilters.views}
                        onChange={() => handleFilterToggle("views")}
                        label={
                            <span className={classes.checkboxLabel}>
                                <EyeRegular className={classes.typeIcon} />
                                Views
                            </span>
                        }
                    />
                    <Checkbox
                        checked={objectTypeFilters.storedProcedures}
                        onChange={() => handleFilterToggle("storedProcedures")}
                        label={
                            <span className={classes.checkboxLabel}>
                                <CodeRegular className={classes.typeIcon} />
                                Stored Procedures
                            </span>
                        }
                    />
                    <Checkbox
                        checked={objectTypeFilters.functions}
                        onChange={() => handleFilterToggle("functions")}
                        label={
                            <span className={classes.checkboxLabel}>
                                <MathFormulaRegular className={classes.typeIcon} />
                                Functions
                            </span>
                        }
                    />
                </div>
            </div>
        </div>
    );
};
