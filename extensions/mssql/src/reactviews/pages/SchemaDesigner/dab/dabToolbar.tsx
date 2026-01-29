/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Dropdown,
    makeStyles,
    Option,
    Text,
    tokens,
    ToggleButton,
    Toolbar,
} from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { useContext } from "react";
import { locConstants } from "../../../common/locConstants";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { Dab } from "../../../../sharedInterfaces/dab";

const useStyles = makeStyles({
    toolbarContainer: {
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        padding: "10px 15px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    headerRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
    },
    titleSection: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
    },
    title: {
        fontWeight: 600,
        fontSize: "14px",
    },
    actionsSection: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
    },
    apiTypeRow: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
    },
    apiTypeLabel: {
        fontSize: "13px",
        color: tokens.colorNeutralForeground2,
    },
    apiTypeButtons: {
        display: "flex",
        gap: "4px",
    },
    filterRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
    },
    filterLeft: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
    },
    entityEndpointsLabel: {
        fontSize: "13px",
        fontWeight: 500,
    },
    schemaDropdown: {
        minWidth: "120px",
        maxWidth: "250px",
    },
    enabledCount: {
        fontSize: "12px",
        color: tokens.colorNeutralForeground3,
    },
});

export function DabToolbar() {
    const classes = useStyles();
    const context = useContext(SchemaDesignerContext);
    const { dabConfig, updateDabApiType, dabSchemaFilter, setDabSchemaFilter } = context;

    if (!dabConfig) {
        return null;
    }

    const enabledCount = dabConfig.entities.filter((e) => e.isEnabled).length;
    const totalCount = dabConfig.entities.length;

    // Get unique schemas from entities for the filter dropdown
    const availableSchemas = Array.from(
        new Set(dabConfig.entities.map((e) => e.schemaName)),
    ).sort();

    return (
        <div className={classes.toolbarContainer}>
            {/* Header row with title and action buttons */}
            <div className={classes.headerRow}>
                <div className={classes.titleSection}>
                    <Text className={classes.title}>{locConstants.schemaDesigner.dabTitle}</Text>
                </div>
                <div className={classes.actionsSection}>
                    <Button
                        appearance="subtle"
                        icon={<FluentIcons.DocumentCopy16Regular />}
                        size="small"
                        title={locConstants.schemaDesigner.viewConfig}>
                        {locConstants.schemaDesigner.viewConfig}
                    </Button>
                    <Button
                        appearance="primary"
                        icon={<FluentIcons.Play16Filled />}
                        size="small"
                        title={locConstants.schemaDesigner.generateAndRun}>
                        {locConstants.schemaDesigner.generateAndRun}
                    </Button>
                </div>
            </div>

            {/* API Type selection row */}
            <div className={classes.apiTypeRow}>
                <Text className={classes.apiTypeLabel}>{locConstants.schemaDesigner.apiType}</Text>
                <Toolbar size="small" className={classes.apiTypeButtons}>
                    <ToggleButton
                        appearance={dabConfig.apiType === Dab.ApiType.Rest ? "primary" : "subtle"}
                        size="small"
                        checked={dabConfig.apiType === Dab.ApiType.Rest}
                        onClick={() => updateDabApiType(Dab.ApiType.Rest)}>
                        {locConstants.schemaDesigner.restApi}
                    </ToggleButton>
                    <ToggleButton
                        appearance={
                            dabConfig.apiType === Dab.ApiType.GraphQL ? "primary" : "subtle"
                        }
                        size="small"
                        checked={dabConfig.apiType === Dab.ApiType.GraphQL}
                        onClick={() => updateDabApiType(Dab.ApiType.GraphQL)}>
                        {locConstants.schemaDesigner.graphql}
                    </ToggleButton>
                    <ToggleButton
                        appearance={dabConfig.apiType === Dab.ApiType.Both ? "primary" : "subtle"}
                        size="small"
                        checked={dabConfig.apiType === Dab.ApiType.Both}
                        onClick={() => updateDabApiType(Dab.ApiType.Both)}>
                        {locConstants.schemaDesigner.both}
                    </ToggleButton>
                </Toolbar>
            </div>

            {/* Entity Endpoints filter row */}
            <div className={classes.filterRow}>
                <div className={classes.filterLeft}>
                    <Text className={classes.entityEndpointsLabel}>
                        {locConstants.schemaDesigner.entityEndpoints}
                    </Text>
                    <Dropdown
                        className={classes.schemaDropdown}
                        size="small"
                        multiselect
                        button={{
                            style: {
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                            },
                        }}
                        value={
                            dabSchemaFilter.length === 0
                                ? locConstants.schemaDesigner.allSchemas
                                : dabSchemaFilter.join(", ")
                        }
                        selectedOptions={dabSchemaFilter}
                        onOptionSelect={(_, data) => {
                            setDabSchemaFilter(data.selectedOptions);
                        }}>
                        {availableSchemas.map((schema) => (
                            <Option key={schema} value={schema}>
                                {schema}
                            </Option>
                        ))}
                    </Dropdown>
                </div>
                <Text className={classes.enabledCount}>
                    {locConstants.schemaDesigner.nOfMEnabled(enabledCount, totalCount)}
                </Text>
            </div>
        </div>
    );
}
