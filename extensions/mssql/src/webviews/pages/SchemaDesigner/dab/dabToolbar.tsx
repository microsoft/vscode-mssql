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
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Text,
    tokens,
    Tooltip,
} from "@fluentui/react-components";
import {
    ArrowLeft16Regular as ArrowLeftIcon,
    CheckboxChecked16Regular as CheckboxCheckedIcon,
    CheckboxUnchecked16Regular as CheckboxUncheckedIcon,
    ChevronDown16Regular as ChevronDownIcon,
    Column16Regular as ColumnIcon,
    Dismiss16Regular,
    Eye16Regular as EyeIcon,
    Play16Filled as PlayIcon,
    Search16Regular,
    TableEdit16Regular as TableEditIcon,
} from "@fluentui/react-icons";
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
        toggleDabEntity,
        toggleDabEntityAction,
        toggleDabColumnExposure,
    } = context;

    const [showApiTypeWarning, setShowApiTypeWarning] = useState(false);
    const warningTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const showMinApiTypeWarning = useCallback(() => {
        setShowApiTypeWarning(true);
        if (warningTimerRef.current) {
            clearTimeout(warningTimerRef.current);
        }
        warningTimerRef.current = setTimeout(() => {
            setShowApiTypeWarning(false);
            warningTimerRef.current = undefined;
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
        return <></>;
    }

    const supportedEntities = dabConfig.entities.filter((e) => e.isSupported);
    const enabledCount = dabConfig.entities.filter((e) => e.isEnabled).length;
    const totalCount = dabConfig.entities.length;

    const allActions = [
        Dab.EntityAction.Create,
        Dab.EntityAction.Read,
        Dab.EntityAction.Update,
        Dab.EntityAction.Delete,
    ];

    const handleEnableAll = () => {
        for (const entity of supportedEntities) {
            if (!entity.isEnabled) {
                toggleDabEntity(entity.id, true);
            }
        }
    };

    const handleDisableAll = () => {
        for (const entity of supportedEntities) {
            if (entity.isEnabled) {
                toggleDabEntity(entity.id, false);
            }
        }
    };

    const handleMakeReadOnly = () => {
        for (const entity of supportedEntities) {
            if (!entity.isEnabled) {
                toggleDabEntity(entity.id, true);
            }
            for (const action of allActions) {
                const shouldEnableAction = action === Dab.EntityAction.Read;
                const hasActionEnabled = entity.enabledActions.includes(action);

                if (shouldEnableAction && !hasActionEnabled) {
                    toggleDabEntityAction(entity.id, action, true);
                } else if (!shouldEnableAction && hasActionEnabled) {
                    toggleDabEntityAction(entity.id, action, false);
                }
            }
        }
    };

    const handleEnableAllCruds = () => {
        for (const entity of supportedEntities) {
            if (!entity.isEnabled) {
                toggleDabEntity(entity.id, true);
            }
            for (const action of allActions) {
                if (!entity.enabledActions.includes(action)) {
                    toggleDabEntityAction(entity.id, action, true);
                }
            }
        }
    };

    const handleIncludeAllColumns = () => {
        for (const entity of supportedEntities) {
            for (const column of entity.columns) {
                if (!column.isExposed) {
                    toggleDabColumnExposure(entity.id, column.id, true);
                }
            }
        }
    };

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
                        icon={<ArrowLeftIcon />}
                        onClick={onNavigateToSchema}>
                        {locConstants.schemaDesigner.backToSchema}
                    </Button>
                    <Divider vertical style={{ height: "20px" }} />
                    <Text className={classes.title}>{locConstants.schemaDesigner.dabTitle}</Text>
                </div>
                <div className={classes.actionsSection}>
                    <Menu>
                        <MenuTrigger disableButtonEnhancement>
                            <Button appearance="subtle" icon={<ChevronDownIcon />} size="small">
                                {locConstants.schemaDesigner.bulkActions}
                            </Button>
                        </MenuTrigger>
                        <MenuPopover>
                            <MenuList>
                                <MenuItem icon={<CheckboxCheckedIcon />} onClick={handleEnableAll}>
                                    {locConstants.schemaDesigner.enableAllEntities}
                                </MenuItem>
                                <MenuItem
                                    icon={<CheckboxUncheckedIcon />}
                                    onClick={handleDisableAll}>
                                    {locConstants.schemaDesigner.disableAllEntities}
                                </MenuItem>
                                <MenuItem icon={<EyeIcon />} onClick={handleMakeReadOnly}>
                                    {locConstants.schemaDesigner.makeReadOnly}
                                </MenuItem>
                                <MenuItem icon={<TableEditIcon />} onClick={handleEnableAllCruds}>
                                    {locConstants.schemaDesigner.enableAllCruds}
                                </MenuItem>
                                <MenuItem icon={<ColumnIcon />} onClick={handleIncludeAllColumns}>
                                    {locConstants.schemaDesigner.includeAllColumns}
                                </MenuItem>
                            </MenuList>
                        </MenuPopover>
                    </Menu>
                    <SchemaDesignerWebviewCopilotChatEntry
                        scenario="dab"
                        entryPoint="dabToolbar"
                        discoveryTitle={locConstants.schemaDesigner.dabCopilotDiscoveryTitle}
                        discoveryBody={locConstants.schemaDesigner.dabCopilotDiscoveryBody}
                        showDiscovery={showDiscovery}
                    />
                    <Button
                        appearance="subtle"
                        icon={<EyeIcon />}
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
                                    icon={<PlayIcon />}
                                    size="small"
                                    disabled>
                                    {locConstants.schemaDesigner.deploy}
                                </Button>
                            </span>
                        </Tooltip>
                    ) : (
                        <Button
                            appearance="primary"
                            icon={<PlayIcon />}
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
                        ) : undefined
                    }
                />
                <Text className={classes.enabledCount}>
                    {locConstants.schemaDesigner.nOfMEnabled(enabledCount, totalCount)}
                </Text>
            </div>
        </div>
    );
}
