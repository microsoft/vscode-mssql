/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Checkbox,
    Divider,
    Input,
    makeStyles,
    Text,
    tokens,
} from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { Dismiss16Regular, Search16Regular } from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
import { Dab } from "../../../../sharedInterfaces/dab";
import { useDabContext } from "./dabContext";
import { SchemaDesignerWebviewCopilotChatEntry } from "../copilot/schemaDesignerWebviewCopilotChatEntry";

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
    apiTypeCheckboxes: {
        display: "flex",
        alignItems: "center",
        gap: "4px",
    },
    filterRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
    },
    searchInput: {
        minWidth: "180px",
        maxWidth: "300px",
    },
    enabledCount: {
        fontSize: "12px",
        color: tokens.colorNeutralForeground3,
    },
});

interface DabToolbarProps {
    showDiscovery: boolean;
    onNavigateToSchema?: () => void;
}

export function DabToolbar({ showDiscovery, onNavigateToSchema }: DabToolbarProps) {
    const classes = useStyles();
    const context = useDabContext();
    const {
        dabConfig,
        updateDabApiTypes,
        dabTextFilter,
        setDabTextFilter,
        generateDabConfig,
        openDabDeploymentDialog,
    } = context;

    if (!dabConfig) {
        return null;
    }

    const enabledCount = dabConfig.entities.filter((e) => e.isEnabled).length;
    const totalCount = dabConfig.entities.length;

    const apiTypeOptions = [
        { type: Dab.ApiType.Rest, label: locConstants.schemaDesigner.restApi },
        { type: Dab.ApiType.GraphQL, label: locConstants.schemaDesigner.graphql },
        { type: Dab.ApiType.Mcp, label: locConstants.schemaDesigner.mcp },
    ];

    const allApiTypes = apiTypeOptions.map((o) => o.type);
    const allApiTypesSelected = allApiTypes.every((t) => dabConfig.apiTypes.includes(t));
    const noneApiTypesExtraSelected = dabConfig.apiTypes.length <= 1;

    return (
        <div className={classes.toolbarContainer}>
            {/* Header row with title and action buttons */}
            <div className={classes.headerRow}>
                <div className={classes.titleSection}>
                    <Button
                        appearance="subtle"
                        size="small"
                        icon={<FluentIcons.ArrowLeft16Regular />}
                        onClick={onNavigateToSchema}>
                        {locConstants.schemaDesigner.backToSchema}
                    </Button>
                    <Divider vertical style={{ height: "20px" }} />
                    <Text className={classes.title}>{locConstants.schemaDesigner.dabTitle}</Text>
                </div>
                <div className={classes.actionsSection}>
                    <SchemaDesignerWebviewCopilotChatEntry
                        scenario="dab"
                        entryPoint="dabToolbar"
                        discoveryTitle={locConstants.schemaDesigner.dabCopilotDiscoveryTitle}
                        discoveryBody={locConstants.schemaDesigner.dabCopilotDiscoveryBody}
                        showDiscovery={showDiscovery}
                    />
                    <Button
                        appearance="subtle"
                        icon={<FluentIcons.DocumentCopy16Regular />}
                        size="small"
                        title={locConstants.schemaDesigner.generateConfig}
                        onClick={() => void generateDabConfig()}>
                        {locConstants.schemaDesigner.generateConfig}
                    </Button>
                    <Button
                        appearance="primary"
                        icon={<FluentIcons.Play16Filled />}
                        size="small"
                        title={locConstants.schemaDesigner.deploy}
                        onClick={openDabDeploymentDialog}>
                        {locConstants.schemaDesigner.deploy}
                    </Button>
                </div>
            </div>

            {/* API Type selection row */}
            <div className={classes.apiTypeRow}>
                <Text className={classes.apiTypeLabel}>{locConstants.schemaDesigner.apiType}</Text>
                <div className={classes.apiTypeCheckboxes}>
                    {apiTypeOptions.map(({ type, label }) => {
                        const isSelected = dabConfig.apiTypes.includes(type);
                        const isLastSelected = isSelected && dabConfig.apiTypes.length === 1;
                        return (
                            <Checkbox
                                key={type}
                                label={label}
                                checked={isSelected}
                                disabled={isLastSelected}
                                onChange={(_, data) => {
                                    const updated = data.checked
                                        ? [...dabConfig.apiTypes, type]
                                        : dabConfig.apiTypes.filter((t) => t !== type);
                                    updateDabApiTypes(updated);
                                }}
                            />
                        );
                    })}
                    <Divider vertical style={{ height: "20px" }} />
                    <Checkbox
                        label={locConstants.schemaDesigner.all}
                        checked={
                            allApiTypesSelected ? true : noneApiTypesExtraSelected ? false : "mixed"
                        }
                        onChange={(_, data) => {
                            const updated = data.checked ? allApiTypes : [allApiTypes[0]];
                            updateDabApiTypes(updated);
                        }}
                    />
                </div>
            </div>

            {/* Filter row */}
            <div className={classes.filterRow}>
                <Input
                    className={classes.searchInput}
                    size="small"
                    placeholder={locConstants.schemaDesigner.filterEntities}
                    aria-label={locConstants.schemaDesigner.filterEntities}
                    value={dabTextFilter}
                    onChange={(_, data) => setDabTextFilter(data.value)}
                    contentBefore={<Search16Regular />}
                    contentAfter={
                        dabTextFilter ? (
                            <Button
                                appearance="transparent"
                                icon={<Dismiss16Regular />}
                                size="small"
                                aria-label={locConstants.common.clear}
                                onClick={() => setDabTextFilter("")}
                                style={{ minWidth: "auto", padding: 0 }}
                            />
                        ) : null
                    }
                />
                <Text className={classes.enabledCount}>
                    {locConstants.schemaDesigner.nOfMEnabled(enabledCount, totalCount)}
                </Text>
            </div>
        </div>
    );
}
