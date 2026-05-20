/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Checkbox,
    CounterBadge,
    Divider,
    Input,
    makeStyles,
    mergeClasses,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Popover,
    PopoverSurface,
    PopoverTrigger,
    Text,
    ToggleButton,
    tokens,
    Tooltip,
} from "@fluentui/react-components";
import {
    ArrowLeft16Regular as ArrowLeftIcon,
    CheckboxChecked16Regular as CheckboxCheckedIcon,
    CheckboxUnchecked16Regular as CheckboxUncheckedIcon,
    ChevronDown16Regular as ChevronDownIcon,
    Column16Regular as ColumnIcon,
    Dismiss12Regular,
    Dismiss16Regular,
    Eye16Regular as EyeIcon,
    Filter16Regular,
    Play16Filled as PlayIcon,
    Search16Regular,
    TableEdit16Regular as TableEditIcon,
} from "@fluentui/react-icons";
import { Dispatch, SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { locConstants } from "../../../common/locConstants";
import { Dab } from "../../../../sharedInterfaces/dab";
import { useDabContext } from "./dabContext";
import { SchemaDesignerWebviewCopilotChatEntry } from "../copilot/schemaDesignerWebviewCopilotChatEntry";
import {
    DabEntityFilters,
    DabEntityStatusFilter,
    defaultDabEntityFilters,
    getDabEntityFilterCount,
    toggleDabEntityFilterValue,
} from "./dabEntityFilters";

const SCHEMA_FILTER_ROW_HEIGHT = 22;
const SCHEMA_FILTER_VISIBLE_ROWS = 4;

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
    filterControls: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        minWidth: 0,
    },
    searchInput: {
        minWidth: "180px",
        maxWidth: "300px",
    },
    filterButtonActive: {
        color: "var(--vscode-textLink-foreground)",
    },
    filterButtonBadge: {
        marginLeft: "6px",
    },
    filterSurface: {
        minWidth: "260px",
        padding: "10px",
        backgroundColor: "var(--vscode-editorWidget-background)",
        border: "1px solid var(--vscode-editorWidget-border)",
        borderRadius: "8px",
        boxShadow: "var(--vscode-widget-shadow)",
    },
    filterPopupHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
    },
    filterPopupTitle: {
        fontSize: "13px",
        fontWeight: 600,
        color: "var(--vscode-foreground)",
    },
    closeButton: {
        minWidth: "24px",
        width: "24px",
        height: "24px",
        borderRadius: "6px",
    },
    filterDivider: {
        height: "1px",
        backgroundColor: "var(--vscode-editorWidget-border)",
        opacity: 0.7,
        margin: "6px 0 8px",
    },
    filterPopupBody: {
        display: "flex",
        flexDirection: "column",
        gap: "10px",
    },
    filterSection: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
    },
    filterSectionTitle: {
        fontSize: "11px",
        fontWeight: 600,
        color: tokens.colorNeutralForeground3,
    },
    filterChipRow: {
        display: "flex",
        flexWrap: "wrap",
        gap: "6px",
    },
    filterChip: {
        borderRadius: "999px",
        fontSize: "12px",
        minWidth: "unset",
    },
    filterChipSelected: {
        border: "1px solid var(--vscode-textLink-foreground)",
        color: "var(--vscode-textLink-foreground)",
        backgroundColor: "color-mix(in srgb, var(--vscode-textLink-foreground) 20%, transparent)",
    },
    schemaList: {
        position: "relative",
        overflowY: "auto",
        overflowX: "hidden",
        padding: "0 4px",
    },
    schemaSelectAllRow: {
        position: "sticky",
        top: 0,
        zIndex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        minHeight: `${SCHEMA_FILTER_ROW_HEIGHT}px`,
        height: `${SCHEMA_FILTER_ROW_HEIGHT}px`,
        padding: "0 4px 0 0",
        backgroundColor: "var(--vscode-editorWidget-background)",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    schemaListContent: {
        position: "relative",
        width: "100%",
    },
    schemaOption: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "6px",
        minHeight: "22px",
        height: "22px",
        cursor: "pointer",
        "&:hover": {
            backgroundColor: tokens.colorNeutralBackground1Hover,
        },
    },
    schemaCheckbox: {
        minWidth: 0,
        minHeight: "22px",
        height: "22px",
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
        "& .fui-Checkbox__indicator": {
            width: "12px",
            height: "12px",
            fontSize: "10px",
            flexShrink: 0,
            alignSelf: "center",
        },
        "& .fui-Checkbox__label": {
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
    },
    schemaName: {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontFamily: "var(--vscode-editor-font-family)",
        fontSize: tokens.fontSizeBase200,
    },
    schemaCount: {
        color: tokens.colorNeutralForeground4,
        fontSize: tokens.fontSizeBase100,
        lineHeight: tokens.lineHeightBase100,
        flexShrink: 0,
        paddingRight: "4px",
    },
    filterFooter: {
        display: "flex",
        gap: "6px",
        marginTop: "10px",
    },
    filterFooterButton: {
        flex: 1,
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
    entityFilters: DabEntityFilters;
    setEntityFilters: Dispatch<SetStateAction<DabEntityFilters>>;
}

export function DabToolbar({
    showDiscovery,
    onNavigateToSchema,
    onViewConfig,
    entityFilters,
    setEntityFilters,
}: DabToolbarProps) {
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
    const [filterOpen, setFilterOpen] = useState(false);
    const warningTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const schemaListRef = useRef<HTMLDivElement | null>(null);

    const schemaOptions = Object.entries(
        (dabConfig?.entities ?? []).reduce<Record<string, number>>((accumulator, entity) => {
            accumulator[entity.schemaName] = (accumulator[entity.schemaName] ?? 0) + 1;
            return accumulator;
        }, {}),
    ).sort(([a], [b]) => a.localeCompare(b));

    const schemaVirtualizer = useVirtualizer({
        count: schemaOptions.length,
        getScrollElement: () => schemaListRef.current,
        estimateSize: () => SCHEMA_FILTER_ROW_HEIGHT,
        overscan: 4,
    });

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
    const activeFilterCount = getDabEntityFilterCount(entityFilters);
    const hasActiveFilters = activeFilterCount > 0;
    const schemaFilterState =
        entityFilters.schemas.length === 0 || entityFilters.schemas.length === schemaOptions.length
            ? true
            : "mixed";
    const schemaFilterListHeight =
        (Math.min(schemaOptions.length, SCHEMA_FILTER_VISIBLE_ROWS) + 1) * SCHEMA_FILTER_ROW_HEIGHT;

    const sourceTypeLabels: Record<Dab.EntitySourceType, string> = {
        [Dab.EntitySourceType.Table]: locConstants.schemaDesigner.tables,
        [Dab.EntitySourceType.View]: locConstants.schemaDesigner.views,
        [Dab.EntitySourceType.StoredProcedure]: locConstants.schemaDesigner.storedProcedures,
    };

    const sourceTypes = new Set(
        dabConfig.entities.map((entity) => entity.sourceType ?? Dab.EntitySourceType.Table),
    );
    const sourceTypeOptions = [
        Dab.EntitySourceType.Table,
        Dab.EntitySourceType.View,
        Dab.EntitySourceType.StoredProcedure,
    ].filter((sourceType) => sourceTypes.has(sourceType));

    const clearFilters = () => {
        setEntityFilters({ ...defaultDabEntityFilters });
    };

    const toggleSchemaFilter = (schemaName: string) => {
        setEntityFilters((prev) => ({
            ...prev,
            schemas: toggleDabEntityFilterValue(prev.schemas, schemaName),
        }));
    };

    const toggleSourceTypeFilter = (sourceType: Dab.EntitySourceType) => {
        setEntityFilters((prev) => ({
            ...prev,
            sourceTypes: toggleDabEntityFilterValue(prev.sourceTypes, sourceType),
        }));
    };

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
            if (entity.sourceType === Dab.EntitySourceType.StoredProcedure) {
                continue;
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
            if (entity.sourceType === Dab.EntitySourceType.StoredProcedure) {
                continue;
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
                <div className={classes.filterControls}>
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
                    <Popover
                        withArrow
                        positioning="below-start"
                        open={filterOpen}
                        onOpenChange={(_, data) => setFilterOpen(data.open)}>
                        <PopoverTrigger disableButtonEnhancement>
                            <Button
                                appearance="subtle"
                                icon={<Filter16Regular />}
                                className={mergeClasses(
                                    hasActiveFilters && classes.filterButtonActive,
                                )}>
                                {locConstants.schemaDesigner.filter(0)}
                                {hasActiveFilters && (
                                    <CounterBadge
                                        className={classes.filterButtonBadge}
                                        size="small"
                                        count={activeFilterCount}
                                        color="brand"
                                    />
                                )}
                            </Button>
                        </PopoverTrigger>
                        <PopoverSurface className={classes.filterSurface}>
                            <div className={classes.filterPopupHeader}>
                                <Text className={classes.filterPopupTitle}>
                                    {locConstants.schemaDesigner.filterEntitiesTitle}
                                </Text>
                                <Button
                                    appearance="subtle"
                                    size="small"
                                    icon={<Dismiss12Regular />}
                                    className={classes.closeButton}
                                    aria-label={locConstants.common.close}
                                    onClick={() => setFilterOpen(false)}
                                />
                            </div>
                            <div className={classes.filterDivider} />
                            <div className={classes.filterPopupBody}>
                                <div className={classes.filterSection}>
                                    <Text className={classes.filterSectionTitle}>
                                        {locConstants.schemaDesigner.status}
                                    </Text>
                                    <div className={classes.filterChipRow}>
                                        {Object.values(DabEntityStatusFilter).map((status) => (
                                            <ToggleButton
                                                key={status}
                                                shape="circular"
                                                size="small"
                                                className={mergeClasses(
                                                    classes.filterChip,
                                                    entityFilters.status === status &&
                                                        classes.filterChipSelected,
                                                )}
                                                checked={entityFilters.status === status}
                                                onClick={() =>
                                                    setEntityFilters((prev) => ({
                                                        ...prev,
                                                        status,
                                                    }))
                                                }>
                                                {locConstants.schemaDesigner.entityStatusFilterLabel(
                                                    status,
                                                )}
                                            </ToggleButton>
                                        ))}
                                    </div>
                                </div>
                                <div className={classes.filterSection}>
                                    <Text className={classes.filterSectionTitle}>
                                        {locConstants.schemaDesigner.schema}
                                    </Text>
                                    <div
                                        ref={schemaListRef}
                                        className={classes.schemaList}
                                        style={{
                                            height: `${schemaFilterListHeight}px`,
                                        }}>
                                        <div className={classes.schemaSelectAllRow}>
                                            <Checkbox
                                                className={classes.schemaCheckbox}
                                                checked={schemaFilterState}
                                                onChange={() =>
                                                    setEntityFilters((prev) => ({
                                                        ...prev,
                                                        schemas: [],
                                                    }))
                                                }
                                                label={locConstants.schemaDesigner.allSchemas}
                                            />
                                            <span className={classes.schemaCount}>
                                                {schemaOptions.length}
                                            </span>
                                        </div>
                                        <div
                                            className={classes.schemaListContent}
                                            style={{
                                                height: `${schemaVirtualizer.getTotalSize()}px`,
                                            }}>
                                            {schemaVirtualizer
                                                .getVirtualItems()
                                                .map((virtualItem) => {
                                                    const option = schemaOptions[virtualItem.index];
                                                    if (!option) {
                                                        return undefined;
                                                    }

                                                    const [schemaName, count] = option;
                                                    return (
                                                        <div
                                                            className={classes.schemaOption}
                                                            key={schemaName}
                                                            style={{
                                                                height: `${virtualItem.size}px`,
                                                                transform: `translateY(${virtualItem.start}px)`,
                                                            }}>
                                                            <Checkbox
                                                                className={classes.schemaCheckbox}
                                                                checked={entityFilters.schemas.includes(
                                                                    schemaName,
                                                                )}
                                                                onChange={() =>
                                                                    toggleSchemaFilter(schemaName)
                                                                }
                                                                label={
                                                                    <span
                                                                        className={
                                                                            classes.schemaName
                                                                        }>
                                                                        {schemaName}
                                                                    </span>
                                                                }
                                                            />
                                                            <span className={classes.schemaCount}>
                                                                {count}
                                                            </span>
                                                        </div>
                                                    );
                                                })}
                                        </div>
                                    </div>
                                </div>
                                <div className={classes.filterSection}>
                                    <Text className={classes.filterSectionTitle}>
                                        {locConstants.schemaDesigner.objectType}
                                    </Text>
                                    <div className={classes.filterChipRow}>
                                        {sourceTypeOptions.map((sourceType) => (
                                            <ToggleButton
                                                key={sourceType}
                                                shape="circular"
                                                size="small"
                                                className={mergeClasses(
                                                    classes.filterChip,
                                                    entityFilters.sourceTypes.includes(
                                                        sourceType,
                                                    ) && classes.filterChipSelected,
                                                )}
                                                checked={entityFilters.sourceTypes.includes(
                                                    sourceType,
                                                )}
                                                onClick={() => toggleSourceTypeFilter(sourceType)}>
                                                {sourceTypeLabels[sourceType]}
                                            </ToggleButton>
                                        ))}
                                    </div>
                                </div>
                            </div>
                            <div className={classes.filterDivider} />
                            <div className={classes.filterFooter}>
                                <Button
                                    size="small"
                                    appearance="outline"
                                    className={classes.filterFooterButton}
                                    disabled={!hasActiveFilters}
                                    onClick={clearFilters}>
                                    {locConstants.schemaDesigner.clearAllFilters}
                                </Button>
                                <Button
                                    size="small"
                                    appearance="primary"
                                    className={classes.filterFooterButton}
                                    onClick={() => setFilterOpen(false)}>
                                    {locConstants.schemaDesigner.applyFilter}
                                </Button>
                            </div>
                        </PopoverSurface>
                    </Popover>
                </div>
                <Text className={classes.enabledCount}>
                    {locConstants.schemaDesigner.nOfMEnabled(enabledCount, totalCount)}
                </Text>
            </div>
        </div>
    );
}
