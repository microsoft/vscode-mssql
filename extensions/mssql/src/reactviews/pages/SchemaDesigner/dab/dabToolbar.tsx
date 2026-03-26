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
    Tooltip,
} from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { Dismiss16Regular, Search16Regular } from "@fluentui/react-icons";
import { useCallback, useEffect, useRef, useState } from "react";
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
    apiTypeWarning: {
        fontSize: "12px",
        color: tokens.colorPaletteRedForeground1,
    },
});

interface DabToolbarProps {
    showDiscovery: boolean;
    onNavigateToSchema?: () => void;
    onViewConfig?: () => void;
}

export function DabToolbar({ showDiscovery, onNavigateToSchema, onViewConfig }: DabToolbarProps) {
    const classes = useStyles();
    const context = useDabContext();
    const {
        dabConfig,
        isDabDeploymentSupported,
        updateDabApiTypes,
        dabTextFilter,
        setDabTextFilter,
        openDabDeploymentDialog,
    } = context;

    const [showApiTypeWarning, setShowApiTypeWarning] = useState(false);
    const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showMinApiTypeWarning = useCallback(() => {
        setShowApiTypeWarning(true);
        if (warningTimerRef.current) {
            clearTimeout(warningTimerRef.current);
        }
        warningTimerRef.current = setTimeout(() => {
            setShowApiTypeWarning(false);
            warningTimerRef.current = null;
        }, 3000);
    }, []);

    useEffect(() => {
        return () => {
            if (warningTimerRef.current) {
                clearTimeout(warningTimerRef.current);
            }
        };
    }, []);

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
    const hasApiTypes = dabConfig.apiTypes.length > 0;
    const isDeployDisabled = !isDabDeploymentSupported || !hasApiTypes;

    const getDeployTooltip = (): string => {
        if (!isDabDeploymentSupported) {
            return locConstants.schemaDesigner.dabDeploymentNotSupported;
        }
        if (!hasApiTypes) {
            return locConstants.schemaDesigner.atLeastOneApiTypeRequired;
        }
        return locConstants.schemaDesigner.deploy;
    };

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
                        icon={<FluentIcons.Eye16Regular />}
                        size="small"
                        title={locConstants.schemaDesigner.viewConfig}
                        onClick={onViewConfig}>
                        {locConstants.schemaDesigner.viewConfig}
                    </Button>
                    {isDeployDisabled ? (
                        <Tooltip content={getDeployTooltip()} relationship="label">
                            <span>
                                <Button
                                    appearance="primary"
                                    icon={<FluentIcons.Play16Filled />}
                                    size="small"
                                    disabled>
                                    {locConstants.schemaDesigner.deploy}
                                </Button>
                            </span>
                        </Tooltip>
                    ) : (
                        <Button
                            appearance="primary"
                            icon={<FluentIcons.Play16Filled />}
                            size="small"
                            onClick={openDabDeploymentDialog}>
                            {locConstants.schemaDesigner.deploy}
                        </Button>
                    )}
                </div>
            </div>

            {/* API Type selection row */}
            <div className={classes.apiTypeRow}>
                <Text className={classes.apiTypeLabel}>{locConstants.schemaDesigner.apiType}</Text>
                <div className={classes.apiTypeCheckboxes}>
                    {apiTypeOptions.map(({ type, label }) => {
                        const isSelected = dabConfig.apiTypes.includes(type);
                        return (
                            <Checkbox
                                key={type}
                                label={label}
                                checked={isSelected}
                                onChange={(_, data) => {
                                    const updated = data.checked
                                        ? [...dabConfig.apiTypes, type]
                                        : dabConfig.apiTypes.filter((t) => t !== type);
                                    if (updated.length === 0) {
                                        showMinApiTypeWarning();
                                        return;
                                    }
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
                            if (!data.checked) {
                                showMinApiTypeWarning();
                                return;
                            }
                            updateDabApiTypes(allApiTypes);
                        }}
                    />
                </div>
                {showApiTypeWarning && (
                    <Text className={classes.apiTypeWarning}>
                        {locConstants.schemaDesigner.atLeastOneApiTypeRequired}
                    </Text>
                )}
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
