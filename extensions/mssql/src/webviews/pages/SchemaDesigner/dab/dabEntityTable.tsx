/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Checkbox,
    createTableColumn,
    Table,
    TableBody,
    TableCell,
    Text,
    TableHeader,
    TableHeaderCell,
    TableColumnDefinition,
    TableColumnSizingOptions,
    TableRow,
    Tooltip,
    makeStyles,
    mergeClasses,
    tokens,
    useArrowNavigationGroup,
    useTableColumnSizing_unstable,
    useTableFeatures,
} from "@fluentui/react-components";
import {
    ArrowSortDown16Filled,
    ArrowSortUp16Filled,
    ChevronDown16Regular,
    ChevronRight16Regular,
    ErrorCircle16Regular,
    Folder16Regular,
    Settings16Regular,
    Table16Regular,
    Warning16Regular,
} from "@fluentui/react-icons";
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Dab } from "../../../../sharedInterfaces/dab";
import { locConstants } from "../../../common/locConstants";
import { PrimaryKeyIcon } from "../../../common/icons/primaryKey";
import { StoredProcedureIcon16Regular } from "../../../common/icons/storedProcedure";
import { ViewIcon16Regular } from "../../../common/icons/view";
import { useDabContext } from "./dabContext";
import { DabEntitySettingsDialog } from "./dabEntitySettingsDialog";
import { DabEntityFilters, doesEntityMatchDabFilters } from "./dabEntityFilters";
import {
    DabCountPill,
    getDabApiTypePillClassName,
    getDabPermissionPillClassName,
} from "./dabPills";
import "./dabEntityTable.css";

const TYPE_INDENT = 20;
const ENTITY_INDENT = 40;
const COLUMN_INDENT = 60;

// ── Flat-row type for virtualized rendering ──

type FlatRow =
    | {
          type: "schema";
          id: string;
          schemaName: string;
          entities: Dab.DabEntityConfig[];
          enabledEntityCount: number;
          isExpanded: boolean;
      }
    | {
          type: "objectGroup";
          id: string;
          schemaName: string;
          sourceType: Dab.EntitySourceType;
          entities: Dab.DabEntityConfig[];
          enabledEntityCount: number;
          isExpanded: boolean;
      }
    | {
          type: "entity";
          id: string;
          entity: Dab.DabEntityConfig;
          isExpanded: boolean;
      }
    | {
          type: "column";
          id: string;
          entity: Dab.DabEntityConfig;
          column: Dab.DabColumnConfig;
      }
    | {
          type: "parameter";
          id: string;
          entity: Dab.DabEntityConfig;
          parameter: Dab.DabParameterConfig;
      }
    | {
          type: "emptyChildren";
          id: string;
          entity: Dab.DabEntityConfig;
      };

type SettingsInitialTab = "identity" | "permissions" | "rest" | "graphql" | "mcp" | "schema";

// ── Helpers ──

function getSourceTypeLabel(sourceType?: Dab.EntitySourceType): string {
    switch (sourceType ?? Dab.EntitySourceType.Table) {
        case Dab.EntitySourceType.View:
            return locConstants.schemaDesigner.view;
        case Dab.EntitySourceType.StoredProcedure:
            return locConstants.schemaDesigner.storedProcedure;
        case Dab.EntitySourceType.Table:
            return locConstants.schemaDesigner.table;
    }
}

function formatUnsupportedReasons(entity: Dab.DabEntityConfig): string {
    const sourceTypeLabel = getSourceTypeLabel(entity.sourceType);
    return (entity.unsupportedReasons ?? [])
        .map((reason) => {
            switch (reason.type) {
                case "noPrimaryKey":
                    return locConstants.schemaDesigner.unsupportedNoPrimaryKey(sourceTypeLabel);
                case "unsupportedDataTypes":
                    return locConstants.schemaDesigner.unsupportedDataTypes(
                        reason.columns,
                        sourceTypeLabel,
                    );
            }
        })
        .join("; ");
}

function getSchemaGroupKey(schemaName: string): string {
    return schemaName.trim().toLowerCase();
}

function createDefaultExpandedRows(config?: Dab.DabConfig | null): Set<string> {
    if (!config) {
        return new Set<string>();
    }

    const expanded = new Set<string>();
    for (const entity of config.entities) {
        const schemaKey = getSchemaGroupKey(entity.schemaName);
        expanded.add(`schema-${schemaKey}`);
        expanded.add(`schema-${schemaKey}-${entity.sourceType ?? Dab.EntitySourceType.Table}`);
    }
    return expanded;
}

function getUnsupportedReasonText(entity: Dab.DabEntityConfig): string {
    if (!entity.isSupported && entity.unsupportedReasons) {
        return formatUnsupportedReasons(entity);
    }
    if (Dab.hasFixableKeyWarning(entity)) {
        return formatUnsupportedReasons(entity);
    }
    return "";
}

function getUnsupportedDataTypeText(entity: Dab.DabEntityConfig): string {
    const sourceTypeLabel = getSourceTypeLabel(entity.sourceType);
    return (entity.unsupportedReasons ?? [])
        .filter((reason) => reason.type === "unsupportedDataTypes")
        .map((reason) =>
            locConstants.schemaDesigner.unsupportedDataTypes(reason.columns, sourceTypeLabel),
        )
        .join("; ");
}

function highlightText(text: string, searchText: string, highlightClassName: string): ReactNode {
    const trimmedSearch = searchText.trim();
    if (!trimmedSearch) {
        return text;
    }

    const escapedSearch = trimmedSearch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${escapedSearch})`, "gi");
    const parts = text.split(regex);

    if (parts.length === 1) {
        return text;
    }

    return parts.map((part, index) =>
        part.toLowerCase() === trimmedSearch.toLowerCase() ? (
            <span key={index} className={highlightClassName}>
                {part}
            </span>
        ) : (
            part
        ),
    );
}

// ── Styles ──

const ROW_HEIGHT = 32;
const VIRTUAL_OVERSCAN = 10;

const useStyles = makeStyles({
    container: {
        display: "flex",
        flexDirection: "column",
        flex: "1 1 auto",
        minHeight: 0,
        height: "100%",
        width: "100%",
    },
    header: {
        backgroundColor: "var(--vscode-editor-background)",
        position: "sticky",
        top: 0,
        zIndex: 2,
    },
    headerRow: {
        backgroundColor: "var(--vscode-editor-background)",
    },
    headerCell: {
        minWidth: 0,
        overflow: "hidden",
        fontWeight: 600,
        fontSize: "12px",
        backgroundColor: "var(--vscode-editor-background)",
        zIndex: 3,
        borderBottom: `1px solid var(--vscode-editorWidget-border)`,
    },
    row: {
        borderBottom: `1px solid var(--vscode-editorWidget-border)`,
        outline: "none",
        "&:hover": {
            backgroundColor: "var(--vscode-list-hoverBackground)",
        },
        "&:focus-visible": {
            outline: `1px solid var(--vscode-focusBorder)`,
            outlineOffset: "-1px",
        },
    },
    schemaRow: {
        backgroundColor: "var(--vscode-sideBar-background, var(--vscode-editor-background))",
        fontWeight: 600,
    },
    objectGroupRow: {
        backgroundColor: "var(--vscode-editor-background)",
        fontWeight: 600,
    },
    entityRow: {
        backgroundColor: "var(--vscode-editor-background)",
    },
    columnRow: {
        backgroundColor: "var(--vscode-editor-background)",
        fontSize: "12px",
    },
    scrollContainer: {
        flex: "1 1 auto",
        minHeight: 0,
        overflow: "auto",
    },
    body: {
        position: "relative",
        minWidth: "100%",
    },
    cell: {
        minWidth: 0,
        overflow: "hidden",
        height: `${ROW_HEIGHT}px`,
        maxHeight: `${ROW_HEIGHT}px`,
        paddingTop: 0,
        paddingBottom: 0,
    },
    virtualRow: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        width: "100%",
    },
    expandButton: {
        minWidth: "20px",
        width: "20px",
        height: "20px",
        padding: 0,
    },
    expandPlaceholder: {
        display: "inline-block",
        width: "20px",
        height: "20px",
        flexShrink: 0,
    },
    nameCell: {
        display: "flex",
        alignItems: "center",
        gap: "4px",
        minWidth: 0,
        overflow: "hidden",
    },
    nameLabel: {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        minWidth: 0,
    },
    searchHighlight: {
        backgroundColor: "var(--vscode-editor-findMatchBackground)",
        padding: "0 2px",
        borderRadius: "3px",
    },
    nameCellContent: {
        display: "flex",
        alignItems: "center",
        gap: "4px",
        minWidth: 0,
        overflow: "hidden",
    },
    sourceCell: {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        color: tokens.colorNeutralForeground3,
        fontSize: "12px",
    },
    centeredCell: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
    },
    dataTypeLabel: {
        color: tokens.colorNeutralForeground4,
        fontSize: "11px",
        fontStyle: "italic",
        fontWeight: 300,
        flexShrink: 0,
    },
    mutedMetadataTag: {
        color: tokens.colorNeutralForeground3,
        fontSize: "11px",
        fontFamily: tokens.fontFamilyMonospace,
        fontWeight: tokens.fontWeightRegular,
    },
    requiredMarker: {
        color: "var(--vscode-errorForeground)",
        fontSize: "12px",
        fontFamily: tokens.fontFamilyMonospace,
        fontWeight: tokens.fontWeightSemibold,
        lineHeight: "1",
    },
    metadataDetailsCell: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "center",
        rowGap: "1px",
        minWidth: 0,
        overflow: "hidden",
    },
    metadataDetailText: {
        color: tokens.colorNeutralForeground3,
        fontSize: "12px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        minWidth: 0,
    },
    emptyChildText: {
        color: tokens.colorNeutralForeground4,
        fontSize: "12px",
        fontStyle: "italic",
    },
    primaryKeyIcon: {
        color: "var(--vscode-symbolIcon-keywordForeground, var(--vscode-editorWarning-foreground))",
        flexShrink: 0,
        width: "16px",
        height: "16px",
    },
    actionCell: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    headerActionCell: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
    },
    sortableHeader: {
        display: "flex",
        alignItems: "center",
        gap: "4px",
        cursor: "pointer",
        userSelect: "none",
        width: "100%",
        "&:hover": {
            color: tokens.colorNeutralForeground1,
        },
    },
    sortIcon: {
        flexShrink: 0,
        color: tokens.colorNeutralForeground3,
    },
    settingsCell: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
    },
    settingsButton: {
        minWidth: "24px",
        width: "24px",
        height: "24px",
        padding: 0,
    },
    pillCell: {
        display: "flex",
        alignItems: "center",
        gap: "4px",
        overflow: "hidden",
        flexWrap: "wrap",
    },
    pillButton: {
        minWidth: "unset",
        height: "22px",
        padding: "0 9px",
        borderRadius: "999px",
        fontSize: tokens.fontSizeBase100,
        fontWeight: tokens.fontWeightSemibold,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: "var(--vscode-badge-background, var(--vscode-editorWidget-background))",
        color: "var(--vscode-badge-foreground, var(--vscode-foreground))",
        "&:hover": {
            backgroundColor: "var(--vscode-list-hoverBackground)",
            color: "var(--vscode-foreground)",
        },
    },
    warningIcon: {
        color: "var(--vscode-editorWarning-foreground)",
        flexShrink: 0,
    },
    errorIcon: {
        color: "var(--vscode-errorForeground)",
        flexShrink: 0,
    },
    indicatorButton: {
        minWidth: "20px",
        width: "20px",
        height: "20px",
        padding: 0,
    },
    emptyState: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "1 1 auto",
        minHeight: "220px",
        color: tokens.colorNeutralForeground3,
    },
    tableWrapper: {
        display: "flex",
        flexDirection: "column",
        flex: "1 1 auto",
        minHeight: 0,
        border: `1px solid var(--vscode-editorWidget-border)`,
        borderRadius: "4px",
        overflow: "hidden",
    },
    table: {
        minWidth: "100%",
        width: "max-content",
    },
    blankCell: {
        width: "100%",
        height: "100%",
    },
    columnIcon: {
        color: "var(--vscode-symbolIcon-fieldForeground, var(--vscode-descriptionForeground))",
        width: "14px",
        height: "14px",
        flexShrink: 0,
    },
});

// ── Component ──

interface DabEntityTableProps {
    entityFilters: DabEntityFilters;
}

export const DabEntityTable = ({ entityFilters }: DabEntityTableProps) => {
    const classes = useStyles();
    const keyboardNavAttr = useArrowNavigationGroup({ axis: "grid" });
    const context = useDabContext();
    const { dabConfig, toggleDabEntity, updateDabEntityConfig, updateDabApiTypes, dabTextFilter } =
        context;

    const [expandedRows, setExpandedRows] = useState<Set<string>>(() =>
        createDefaultExpandedRows(dabConfig),
    );
    const [settingsEntityId, setSettingsEntityId] = useState<string | undefined>(undefined);
    const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsInitialTab | undefined>(
        undefined,
    );
    const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
    const settingsButtonRefs = useRef<Map<string, HTMLElement | null>>(new Map());
    const pendingSettingsFocusEntityIdRef = useRef<string | undefined>(undefined);
    const hasInitializedExpandedRows = useRef(Boolean(dabConfig));
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!dabConfig) {
            return;
        }

        if (!hasInitializedExpandedRows.current) {
            setExpandedRows(createDefaultExpandedRows(dabConfig));
            hasInitializedExpandedRows.current = true;
        }
    }, [dabConfig]);

    const sourceTypeLabels: Record<Dab.EntitySourceType, string> = useMemo(
        () => ({
            [Dab.EntitySourceType.Table]: locConstants.schemaDesigner.tables,
            [Dab.EntitySourceType.View]: locConstants.schemaDesigner.views,
            [Dab.EntitySourceType.StoredProcedure]: locConstants.schemaDesigner.storedProcedures,
        }),
        [],
    );

    // ── Filtering ──

    const filteredEntities = useMemo(() => {
        if (!dabConfig) {
            return [];
        }
        const loweredFilter = dabTextFilter.toLowerCase().trim();
        return dabConfig.entities.filter((entity) => {
            if (!doesEntityMatchDabFilters(entity, entityFilters)) {
                return false;
            }

            if (!loweredFilter) {
                return true;
            }

            const entityName = entity.advancedSettings.entityName.toLowerCase();
            const schemaName = entity.schemaName.toLowerCase();
            const source =
                `${entity.schemaName}.${entity.sourceName ?? entity.tableName}`.toLowerCase();
            const sourceType = (entity.sourceType ?? Dab.EntitySourceType.Table).toLowerCase();
            const columnNames = entity.columns.map((column) => column.name.toLowerCase());

            return (
                entityName.includes(loweredFilter) ||
                schemaName.includes(loweredFilter) ||
                source.includes(loweredFilter) ||
                sourceType.includes(loweredFilter) ||
                columnNames.some((columnName) => columnName.includes(loweredFilter))
            );
        });
    }, [dabConfig, dabTextFilter, entityFilters]);

    // ── Grouped by schema and sorted ──

    const entitiesBySchema = useMemo(() => {
        const groups: Record<string, { schemaName: string; entities: Dab.DabEntityConfig[] }> = {};
        for (const entity of filteredEntities) {
            const schemaKey = getSchemaGroupKey(entity.schemaName);
            if (!groups[schemaKey]) {
                groups[schemaKey] = {
                    schemaName: entity.schemaName,
                    entities: [],
                };
            }
            groups[schemaKey].entities.push(entity);
        }

        const dir = sortDirection === "asc" ? 1 : -1;
        return Object.values(groups)
            .sort((a, b) => a.schemaName.localeCompare(b.schemaName) * dir)
            .map(
                ({ schemaName, entities }) =>
                    [
                        schemaName,
                        [...entities].sort((a, b) => {
                            const supportDiff = Number(!a.isSupported) - Number(!b.isSupported);
                            if (supportDiff !== 0) {
                                return supportDiff;
                            }
                            return (
                                a.advancedSettings.entityName.localeCompare(
                                    b.advancedSettings.entityName,
                                ) * dir
                            );
                        }),
                    ] as const,
            );
    }, [filteredEntities, sortDirection]);

    // ── Flatten into a single list for virtualization ──

    const flatRows = useMemo<FlatRow[]>(() => {
        const rows: FlatRow[] = [];

        for (const [schemaName, entities] of entitiesBySchema) {
            const schemaKey = getSchemaGroupKey(schemaName);
            const schemaId = `schema-${schemaKey}`;
            const schemaExpanded = expandedRows.has(schemaId);
            const enabledEntityCount = entities.filter((e) => Dab.isEntityExposed(e)).length;

            rows.push({
                type: "schema",
                id: schemaId,
                schemaName,
                entities,
                enabledEntityCount,
                isExpanded: schemaExpanded,
            });

            if (schemaExpanded) {
                const groups = [
                    Dab.EntitySourceType.Table,
                    Dab.EntitySourceType.View,
                    Dab.EntitySourceType.StoredProcedure,
                ]
                    .map((sourceType) => ({
                        sourceType,
                        entities: entities.filter(
                            (entity) =>
                                (entity.sourceType ?? Dab.EntitySourceType.Table) === sourceType,
                        ),
                    }))
                    .filter((group) => group.entities.length > 0);

                for (const group of groups) {
                    const groupId = `schema-${schemaKey}-${group.sourceType}`;
                    const groupExpanded = expandedRows.has(groupId);
                    rows.push({
                        type: "objectGroup",
                        id: groupId,
                        schemaName,
                        sourceType: group.sourceType,
                        entities: group.entities,
                        enabledEntityCount: group.entities.filter((e) => Dab.isEntityExposed(e))
                            .length,
                        isExpanded: groupExpanded,
                    });

                    if (groupExpanded) {
                        for (const entity of group.entities) {
                            const entityExpanded =
                                entity.isSupported && expandedRows.has(entity.id);
                            rows.push({
                                type: "entity",
                                id: entity.id,
                                entity,
                                isExpanded: entityExpanded,
                            });

                            if (entityExpanded) {
                                if (entity.sourceType === Dab.EntitySourceType.StoredProcedure) {
                                    const parameters = entity.parameters ?? [];
                                    if (parameters.length === 0) {
                                        rows.push({
                                            type: "emptyChildren",
                                            id: `${entity.id}-empty-parameters`,
                                            entity,
                                        });
                                    }
                                    for (const parameter of parameters) {
                                        rows.push({
                                            type: "parameter",
                                            id: `${entity.id}-${parameter.name}`,
                                            entity,
                                            parameter,
                                        });
                                    }
                                } else {
                                    if (entity.columns.length === 0) {
                                        rows.push({
                                            type: "emptyChildren",
                                            id: `${entity.id}-empty-columns`,
                                            entity,
                                        });
                                    }
                                    for (const column of entity.columns) {
                                        rows.push({
                                            type: "column",
                                            id: `${entity.id}-${column.id}`,
                                            entity,
                                            column,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        return rows;
    }, [entitiesBySchema, expandedRows]);

    // ── Toggle expand/collapse ──

    const toggleExpanded = useCallback((id: string) => {
        setExpandedRows((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    // ── Settings dialog ──

    const settingsEntity = useMemo(() => {
        if (!settingsEntityId || !dabConfig) {
            return undefined;
        }
        return dabConfig.entities.find((e) => e.id === settingsEntityId);
    }, [dabConfig, settingsEntityId]);

    const restoreSettingsTriggerFocus = useCallback((entityId?: string) => {
        if (!entityId) {
            return;
        }

        requestAnimationFrame(() => {
            settingsButtonRefs.current.get(entityId)?.focus();
        });
    }, []);

    const closeSettingsDialog = useCallback(
        (entityId?: string) => {
            setSettingsEntityId(undefined);
            setSettingsInitialTab(undefined);
            restoreSettingsTriggerFocus(entityId ?? pendingSettingsFocusEntityIdRef.current);
        },
        [restoreSettingsTriggerFocus],
    );

    const openSettingsDialog = useCallback((entityId: string, initialTab?: SettingsInitialTab) => {
        pendingSettingsFocusEntityIdRef.current = entityId;
        setSettingsInitialTab(initialTab);
        setSettingsEntityId(entityId);
    }, []);

    const getIncludeCheckboxState = useCallback(
        (entities: Dab.DabEntityConfig[]): boolean | "mixed" => {
            const toggleableEntities = entities.filter((entity) => entity.isSupported);
            if (toggleableEntities.length === 0) {
                return false;
            }

            const enabledCount = toggleableEntities.filter((entity) =>
                Dab.isEntityExposed(entity),
            ).length;
            if (enabledCount === 0) {
                return false;
            }

            return enabledCount === toggleableEntities.length ? true : "mixed";
        },
        [],
    );

    const toggleEntities = useCallback(
        (entities: Dab.DabEntityConfig[], isEnabled: boolean) => {
            for (const entity of entities) {
                if (entity.isSupported) {
                    toggleDabEntity(entity.id, isEnabled);
                }
            }
        },
        [toggleDabEntity],
    );

    // ── Row renderers ──

    const renderBlankContent = useCallback(
        () => <div aria-hidden className={classes.blankCell} />,
        [classes.blankCell],
    );

    const getRowIndent = useCallback((row: FlatRow) => {
        switch (row.type) {
            case "entity":
                return ENTITY_INDENT;
            case "objectGroup":
                return TYPE_INDENT;
            case "column":
            case "parameter":
            case "emptyChildren":
                return COLUMN_INDENT;
            default:
                return 0;
        }
    }, []);

    const renderExpandContent = useCallback(
        (row: FlatRow) => {
            if (row.type === "schema" || row.type === "objectGroup") {
                return (
                    <div className={classes.centeredCell}>
                        <Button
                            appearance="subtle"
                            size="small"
                            icon={
                                row.isExpanded ? (
                                    <ChevronDown16Regular />
                                ) : (
                                    <ChevronRight16Regular />
                                )
                            }
                            className={classes.expandButton}
                            onClick={() => toggleExpanded(row.id)}
                            aria-label={
                                row.isExpanded
                                    ? locConstants.common.collapse
                                    : locConstants.common.expand
                            }
                        />
                    </div>
                );
            }

            if (row.type === "entity") {
                return (
                    <div className={classes.centeredCell}>
                        <Button
                            appearance="subtle"
                            size="small"
                            icon={
                                row.isExpanded ? (
                                    <ChevronDown16Regular />
                                ) : (
                                    <ChevronRight16Regular />
                                )
                            }
                            className={classes.expandButton}
                            disabled={!row.entity.isSupported}
                            onClick={() => {
                                if (row.entity.isSupported) {
                                    toggleExpanded(row.entity.id);
                                }
                            }}
                            aria-label={
                                row.isExpanded
                                    ? locConstants.common.collapse
                                    : locConstants.common.expand
                            }
                        />
                    </div>
                );
            }

            return <span className={classes.expandPlaceholder} aria-hidden />;
        },
        [classes.centeredCell, classes.expandButton, classes.expandPlaceholder, toggleExpanded],
    );

    const renderNameContent = useCallback(
        (row: FlatRow) => {
            if (row.type === "schema") {
                return (
                    <div
                        className={classes.nameCellContent}
                        style={{ paddingInlineStart: `${getRowIndent(row)}px` }}>
                        <Folder16Regular className="dab-icon-schema" />
                        <span className={classes.nameLabel}>
                            {highlightText(row.schemaName, dabTextFilter, classes.searchHighlight)}
                        </span>
                        <DabCountPill>
                            {row.enabledEntityCount}/{row.entities.length}
                        </DabCountPill>
                    </div>
                );
            }

            if (row.type === "objectGroup") {
                return (
                    <div
                        className={classes.nameCellContent}
                        style={{ paddingInlineStart: `${getRowIndent(row)}px` }}>
                        <Folder16Regular className="dab-icon-schema" />
                        <span className={classes.nameLabel}>
                            {highlightText(
                                sourceTypeLabels[row.sourceType],
                                dabTextFilter,
                                classes.searchHighlight,
                            )}
                        </span>
                        <DabCountPill>
                            {row.enabledEntityCount}/{row.entities.length}
                        </DabCountPill>
                    </div>
                );
            }

            if (row.type === "entity") {
                const keyWarningText = Dab.hasFixableKeyWarning(row.entity)
                    ? getUnsupportedReasonText(row.entity)
                    : "";
                const unsupportedDataTypeText = getUnsupportedDataTypeText(row.entity);
                const sourceType = row.entity.sourceType ?? Dab.EntitySourceType.Table;

                const nameContent = (
                    <div
                        className={classes.nameCellContent}
                        style={{ paddingInlineStart: `${getRowIndent(row)}px` }}>
                        {sourceType === Dab.EntitySourceType.View ? (
                            <ViewIcon16Regular className="dab-icon-view" />
                        ) : sourceType === Dab.EntitySourceType.StoredProcedure ? (
                            <StoredProcedureIcon16Regular className="dab-icon-procedure" />
                        ) : (
                            <Table16Regular className="dab-icon-table" />
                        )}
                        <span className={classes.nameLabel}>
                            {highlightText(
                                row.entity.advancedSettings.entityName,
                                dabTextFilter,
                                classes.searchHighlight,
                            )}
                        </span>
                        {sourceType !== Dab.EntitySourceType.StoredProcedure && (
                            <DabCountPill>
                                {row.entity.columns.filter((c) => c.isExposed).length}/
                                {row.entity.columns.length}
                            </DabCountPill>
                        )}
                        {keyWarningText && (
                            <Tooltip content={keyWarningText} relationship="description">
                                <Button
                                    appearance="subtle"
                                    size="small"
                                    className={classes.indicatorButton}
                                    icon={<Warning16Regular className={classes.warningIcon} />}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        openSettingsDialog(row.entity.id, "schema");
                                    }}
                                    aria-label={keyWarningText}
                                />
                            </Tooltip>
                        )}
                        {unsupportedDataTypeText && (
                            <Tooltip content={unsupportedDataTypeText} relationship="description">
                                <ErrorCircle16Regular className={classes.errorIcon} />
                            </Tooltip>
                        )}
                    </div>
                );

                return nameContent;
            }

            if (row.type === "parameter") {
                return (
                    <div
                        className={classes.nameCellContent}
                        style={{ paddingInlineStart: `${getRowIndent(row)}px` }}>
                        <span className={classes.nameLabel}>
                            {highlightText(
                                `@${row.parameter.name.replace(/^@/, "")}`,
                                dabTextFilter,
                                classes.searchHighlight,
                            )}
                        </span>
                        {row.parameter.dataType && (
                            <span className={classes.dataTypeLabel}>{row.parameter.dataType}</span>
                        )}
                        {row.parameter.isRequired !== false && (
                            <Tooltip
                                content={locConstants.schemaDesigner.requiredParameter}
                                relationship="description">
                                <span className={classes.requiredMarker}>*</span>
                            </Tooltip>
                        )}
                        {row.parameter.defaultValue !== undefined && (
                            <span className={classes.dataTypeLabel}>
                                {locConstants.schemaDesigner.defaultValue}:{" "}
                                {String(row.parameter.defaultValue)}
                            </span>
                        )}
                    </div>
                );
            }

            if (row.type === "emptyChildren") {
                const emptyText =
                    row.entity.sourceType === Dab.EntitySourceType.StoredProcedure
                        ? locConstants.schemaDesigner.noParametersDiscovered
                        : locConstants.schemaDesigner.noColumnsDiscovered;
                return (
                    <div
                        className={classes.nameCellContent}
                        style={{ paddingInlineStart: `${getRowIndent(row)}px` }}>
                        <span className={classes.emptyChildText}>{emptyText}</span>
                    </div>
                );
            }

            const isLogicalKey = Dab.isLogicalKeyColumn(row.entity, row.column);
            const unsupportedText = !row.column.isSupported
                ? locConstants.schemaDesigner.unsupportedDataTypes(
                      `${row.column.name} (${row.column.dataType})`,
                      getSourceTypeLabel(row.entity.sourceType),
                  )
                : "";

            return (
                <div
                    className={classes.nameCellContent}
                    style={{ paddingInlineStart: `${getRowIndent(row)}px` }}>
                    <svg
                        className={classes.columnIcon}
                        viewBox="0 0 16 16"
                        fill="currentColor"
                        focusable={false}
                        aria-hidden="true">
                        <path d="M3.25 2C4.22 2 5 2.78 5 3.75v8.5C5 13.22 4.22 14 3.25 14H2.5a.5.5 0 0 1 0-1h.75c.41 0 .75-.34.75-.75v-8.5A.75.75 0 0 0 3.25 3H2.5a.5.5 0 0 1 0-1h.75ZM8.5 2c.83 0 1.5.67 1.5 1.5v9c0 .83-.67 1.5-1.5 1.5h-1A1.5 1.5 0 0 1 6 12.5v-9C6 2.67 6.67 2 7.5 2h1Zm5 0a.5.5 0 0 1 0 1h-.75a.75.75 0 0 0-.75.75v8.5c0 .41.34.75.75.75h.75a.5.5 0 0 1 0 1h-.75c-.97 0-1.75-.78-1.75-1.75v-8.5c0-.97.78-1.75 1.75-1.75h.75Zm-6 1a.5.5 0 0 0-.5.5v9c0 .28.22.5.5.5h1a.5.5 0 0 0 .5-.5v-9a.5.5 0 0 0-.5-.5h-1Z" />
                    </svg>
                    <span className={classes.nameLabel}>
                        {highlightText(row.column.name, dabTextFilter, classes.searchHighlight)}
                    </span>
                    {isLogicalKey && (
                        <Tooltip
                            content={locConstants.schemaDesigner.primaryKey}
                            relationship="label">
                            <PrimaryKeyIcon className={classes.primaryKeyIcon} />
                        </Tooltip>
                    )}
                    <span className={classes.dataTypeLabel}>{row.column.dataType}</span>
                    {unsupportedText && (
                        <Tooltip content={unsupportedText} relationship="description">
                            <ErrorCircle16Regular className={classes.errorIcon} />
                        </Tooltip>
                    )}
                </div>
            );
        },
        [
            classes.columnIcon,
            classes.dataTypeLabel,
            classes.emptyChildText,
            classes.errorIcon,
            classes.indicatorButton,
            classes.nameCellContent,
            classes.nameLabel,
            classes.primaryKeyIcon,
            classes.requiredMarker,
            classes.searchHighlight,
            dabTextFilter,
            getRowIndent,
            openSettingsDialog,
        ],
    );

    const renderIncludeContent = useCallback(
        (row: FlatRow) => {
            if (row.type === "schema" || row.type === "objectGroup") {
                const toggleableEntities = row.entities.filter((entity) => entity.isSupported);
                return (
                    <div className={classes.centeredCell}>
                        <Checkbox
                            checked={getIncludeCheckboxState(row.entities)}
                            disabled={toggleableEntities.length === 0}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(_, data) => {
                                toggleEntities(row.entities, data.checked === true);
                            }}
                            aria-label={locConstants.schemaDesigner.toggleAllEntitiesInSchema(
                                row.type === "schema"
                                    ? row.schemaName
                                    : sourceTypeLabels[row.sourceType],
                            )}
                        />
                    </div>
                );
            }

            if (row.type === "entity") {
                const isIncluded = Dab.isEntityExposed(row.entity);
                return (
                    <div className={classes.centeredCell}>
                        <Checkbox
                            checked={isIncluded}
                            disabled={!row.entity.isSupported}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(_, data) => toggleDabEntity(row.entity.id, !!data.checked)}
                            aria-label={locConstants.schemaDesigner.includeEntity(
                                row.entity.advancedSettings.entityName,
                            )}
                        />
                    </div>
                );
            }

            return <span className={classes.expandPlaceholder} aria-hidden />;
        },
        [
            classes.centeredCell,
            classes.expandPlaceholder,
            getIncludeCheckboxState,
            sourceTypeLabels,
            toggleDabEntity,
            toggleEntities,
        ],
    );

    const renderSourceContent = useCallback(
        (row: FlatRow) => {
            if (row.type === "column") {
                return renderBlankContent();
            }

            if (row.type === "parameter") {
                return renderBlankContent();
            }

            if (row.type !== "entity") {
                return renderBlankContent();
            }

            return (
                <span className={classes.sourceCell}>
                    {highlightText(
                        `${row.entity.schemaName}.${row.entity.sourceName ?? row.entity.tableName}`,
                        dabTextFilter,
                        classes.searchHighlight,
                    )}
                </span>
            );
        },
        [classes.searchHighlight, classes.sourceCell, dabTextFilter, renderBlankContent],
    );

    const renderExposedContent = useCallback(
        (row: FlatRow) => {
            if (row.type === "column") {
                const isLogicalKey = Dab.isLogicalKeyColumn(row.entity, row.column);
                return (
                    <div className={classes.pillCell}>
                        <span className={classes.mutedMetadataTag}>
                            {isLogicalKey || row.column.isExposed
                                ? locConstants.schemaDesigner.exposed
                                : locConstants.schemaDesigner.hidden}
                        </span>
                    </div>
                );
            }

            if (row.type === "parameter") {
                return row.parameter.defaultValue !== undefined ? (
                    <Text className={classes.dataTypeLabel}>
                        {locConstants.schemaDesigner.defaultValue}:{" "}
                        {String(row.parameter.defaultValue)}
                    </Text>
                ) : (
                    renderBlankContent()
                );
            }

            if (row.type !== "entity") {
                return renderBlankContent();
            }

            const apiTypes = [
                Dab.isEntityRestEnabled(row.entity) ? Dab.ApiType.Rest : undefined,
                Dab.isEntityGraphQLEnabled(row.entity) ? Dab.ApiType.GraphQL : undefined,
                Dab.isEntityMcpEnabled(row.entity) ? Dab.ApiType.Mcp : undefined,
            ].filter((apiType): apiType is Dab.ApiType => !!apiType);

            if (apiTypes.length === 0) {
                return (
                    <Text className={classes.dataTypeLabel}>
                        {locConstants.schemaDesigner.notExposed}
                    </Text>
                );
            }

            const labels: Record<Dab.ApiType, string> = {
                [Dab.ApiType.Rest]: locConstants.schemaDesigner.rest,
                [Dab.ApiType.GraphQL]: "GQL",
                [Dab.ApiType.Mcp]: locConstants.schemaDesigner.mcp,
            };
            const tabs: Record<Dab.ApiType, SettingsInitialTab> = {
                [Dab.ApiType.Rest]: "rest",
                [Dab.ApiType.GraphQL]: "graphql",
                [Dab.ApiType.Mcp]: "mcp",
            };

            return (
                <div className={classes.pillCell}>
                    {apiTypes.map((apiType) => (
                        <Button
                            key={apiType}
                            appearance="subtle"
                            size="small"
                            className={mergeClasses(
                                classes.pillButton,
                                getDabApiTypePillClassName(apiType),
                            )}
                            onClick={() => openSettingsDialog(row.entity.id, tabs[apiType])}>
                            {labels[apiType]}
                        </Button>
                    ))}
                </div>
            );
        },
        [
            classes.dataTypeLabel,
            classes.pillButton,
            classes.pillCell,
            classes.mutedMetadataTag,
            openSettingsDialog,
            renderBlankContent,
        ],
    );

    const renderPermissionsContent = useCallback(
        (row: FlatRow) => {
            if (row.type === "column") {
                const field = Dab.getFieldForColumn(row.entity, row.column.name);
                const alias = field?.alias?.trim();
                const description = field?.description?.trim();
                return alias || description ? (
                    <div className={classes.metadataDetailsCell}>
                        {alias && (
                            <Tooltip
                                content={`${locConstants.schemaDesigner.alias}: ${alias}`}
                                relationship="description">
                                <span className={classes.metadataDetailText}>
                                    {locConstants.schemaDesigner.alias}: {alias}
                                </span>
                            </Tooltip>
                        )}
                        {description && (
                            <Tooltip
                                content={`${locConstants.schemaDesigner.description}: ${description}`}
                                relationship="description">
                                <span className={classes.metadataDetailText}>{description}</span>
                            </Tooltip>
                        )}
                    </div>
                ) : (
                    renderBlankContent()
                );
            }

            if (row.type === "parameter") {
                return row.parameter.description ? (
                    <Tooltip
                        content={`${locConstants.schemaDesigner.description}: ${row.parameter.description}`}
                        relationship="description">
                        <Text className={classes.sourceCell}>{row.parameter.description}</Text>
                    </Tooltip>
                ) : (
                    renderBlankContent()
                );
            }

            if (row.type !== "entity") {
                return renderBlankContent();
            }

            if (!Dab.isEntityExposed(row.entity)) {
                return renderBlankContent();
            }

            const permissions = Dab.getEntityPermissions(row.entity).filter(
                (permission) => permission.actions.length > 0,
            );
            if (!permissions.length) {
                return (
                    <Text className={classes.dataTypeLabel}>
                        {locConstants.schemaDesigner.noPermissions}
                    </Text>
                );
            }

            const roleLabels: Record<Dab.AuthorizationRole, string> = {
                [Dab.AuthorizationRole.Anonymous]: locConstants.schemaDesigner.anonymousShort,
                [Dab.AuthorizationRole.Authenticated]:
                    locConstants.schemaDesigner.authenticatedShort,
            };
            const actionLabels: Record<Dab.EntityAction, string> = {
                [Dab.EntityAction.Create]: "C",
                [Dab.EntityAction.Read]: "R",
                [Dab.EntityAction.Update]: "U",
                [Dab.EntityAction.Delete]: "D",
                [Dab.EntityAction.Execute]: locConstants.schemaDesigner.executeShort,
            };

            return (
                <div className={classes.pillCell}>
                    {permissions.map((permission) => (
                        <Button
                            key={permission.role}
                            appearance="subtle"
                            size="small"
                            className={mergeClasses(
                                classes.pillButton,
                                getDabPermissionPillClassName(permission.role),
                            )}
                            onClick={() => openSettingsDialog(row.entity.id, "permissions")}>
                            {roleLabels[permission.role]}:{" "}
                            {permission.actions.map((action) => actionLabels[action]).join("")}
                        </Button>
                    ))}
                </div>
            );
        },
        [
            classes.dataTypeLabel,
            classes.metadataDetailsCell,
            classes.metadataDetailText,
            classes.pillButton,
            classes.pillCell,
            classes.sourceCell,
            openSettingsDialog,
            renderBlankContent,
        ],
    );

    const renderSettingsContent = useCallback(
        (row: FlatRow) => {
            if (row.type !== "entity") {
                return renderBlankContent();
            }

            return (
                <div className={classes.settingsCell}>
                    <Tooltip
                        content={locConstants.schemaDesigner.settingsForEntity(
                            row.entity.advancedSettings.entityName,
                        )}
                        relationship="label">
                        <Button
                            appearance="subtle"
                            size="small"
                            icon={<Settings16Regular />}
                            className={classes.settingsButton}
                            disabled={!row.entity.isSupported}
                            ref={(el: HTMLElement | null) => {
                                settingsButtonRefs.current.set(row.entity.id, el);
                            }}
                            onClick={() => openSettingsDialog(row.entity.id)}
                        />
                    </Tooltip>
                </div>
            );
        },
        [classes.settingsButton, classes.settingsCell, openSettingsDialog, renderBlankContent],
    );

    const columns = useMemo<TableColumnDefinition<FlatRow>[]>(
        () => [
            createTableColumn<FlatRow>({
                columnId: "expand",
                renderHeaderCell: () => <span />,
                renderCell: renderExpandContent,
            }),
            createTableColumn<FlatRow>({
                columnId: "include",
                renderHeaderCell: () => (
                    <div className={classes.headerActionCell}>
                        <Checkbox
                            checked={getIncludeCheckboxState(filteredEntities)}
                            disabled={!filteredEntities.some((entity) => entity.isSupported)}
                            onChange={(_, data) => {
                                toggleEntities(filteredEntities, data.checked === true);
                            }}
                            aria-label={locConstants.schemaDesigner.selectAllEntities}
                        />
                    </div>
                ),
                renderCell: renderIncludeContent,
            }),
            createTableColumn<FlatRow>({
                columnId: "name",
                renderHeaderCell: () => (
                    <span
                        className={classes.sortableHeader}
                        onClick={() => setSortDirection((d) => (d === "asc" ? "desc" : "asc"))}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
                            }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-label={locConstants.schemaDesigner.entityName}
                        aria-sort={sortDirection === "asc" ? "ascending" : "descending"}>
                        {locConstants.schemaDesigner.entityName}
                        {sortDirection === "asc" ? (
                            <ArrowSortUp16Filled className={classes.sortIcon} />
                        ) : (
                            <ArrowSortDown16Filled className={classes.sortIcon} />
                        )}
                    </span>
                ),
                renderCell: renderNameContent,
            }),
            createTableColumn<FlatRow>({
                columnId: "source",
                renderHeaderCell: () => <span>{locConstants.schemaDesigner.source}</span>,
                renderCell: renderSourceContent,
            }),
            createTableColumn<FlatRow>({
                columnId: "exposed",
                renderHeaderCell: () => <span>{locConstants.schemaDesigner.exposedVia}</span>,
                renderCell: renderExposedContent,
            }),
            createTableColumn<FlatRow>({
                columnId: "permissions",
                renderHeaderCell: () => (
                    <span>{locConstants.schemaDesigner.authorizationRole}</span>
                ),
                renderCell: renderPermissionsContent,
            }),
            createTableColumn<FlatRow>({
                columnId: "settings",
                renderHeaderCell: () => <span />,
                renderCell: renderSettingsContent,
            }),
        ],
        [
            classes.sortIcon,
            classes.sortableHeader,
            classes.headerActionCell,
            filteredEntities,
            getIncludeCheckboxState,
            renderExpandContent,
            renderExposedContent,
            renderIncludeContent,
            renderNameContent,
            renderPermissionsContent,
            renderSettingsContent,
            renderSourceContent,
            sortDirection,
            toggleEntities,
        ],
    );

    const columnSizingOptions = useMemo<TableColumnSizingOptions>(
        () => ({
            expand: { defaultWidth: 24, minWidth: 24, idealWidth: 24 },
            include: { defaultWidth: 32, minWidth: 32, idealWidth: 32 },
            name: { defaultWidth: 420, minWidth: 220, idealWidth: 420 },
            source: { defaultWidth: 200, minWidth: 140, idealWidth: 200 },
            exposed: { defaultWidth: 160, minWidth: 120, idealWidth: 160 },
            permissions: { defaultWidth: 220, minWidth: 160, idealWidth: 220 },
            settings: { defaultWidth: 32, minWidth: 32, idealWidth: 32 },
        }),
        [],
    );

    const { getRows, columnSizing_unstable, tableRef } = useTableFeatures(
        {
            columns,
            items: flatRows,
        },
        [
            useTableColumnSizing_unstable({
                columnSizingOptions,
                autoFitColumns: false,
                containerWidthOffset: 0,
            }),
        ],
    );
    const rows = getRows();
    const rowVirtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => scrollContainerRef.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: VIRTUAL_OVERSCAN,
    });
    const virtualRows = rowVirtualizer.getVirtualItems();

    if (filteredEntities.length === 0) {
        return (
            <div className={classes.emptyState}>
                <Text>{locConstants.schemaDesigner.noEntitiesFound}</Text>
            </div>
        );
    }

    return (
        <>
            <div className={classes.container}>
                <div className={classes.tableWrapper}>
                    <div className={classes.scrollContainer} ref={scrollContainerRef}>
                        <Table
                            noNativeElements
                            {...keyboardNavAttr}
                            size="extra-small"
                            {...columnSizing_unstable.getTableProps()}
                            ref={tableRef}
                            className={classes.table}
                            role="grid"
                            aria-rowcount={rows.length + 1}
                            aria-label={locConstants.schemaDesigner.entityName}>
                            <TableHeader className={classes.header}>
                                <TableRow aria-rowindex={1} className={classes.headerRow}>
                                    {columns.map((column) => (
                                        <TableHeaderCell
                                            {...columnSizing_unstable.getTableHeaderCellProps(
                                                column.columnId,
                                            )}
                                            className={classes.headerCell}
                                            key={String(column.columnId)}>
                                            {column.renderHeaderCell()}
                                        </TableHeaderCell>
                                    ))}
                                </TableRow>
                            </TableHeader>
                            <TableBody
                                className={classes.body}
                                style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
                                {virtualRows.map((virtualRow) => {
                                    const row = rows[virtualRow.index];
                                    if (!row) {
                                        return undefined;
                                    }

                                    const rowClass = mergeClasses(
                                        classes.row,
                                        row.item.type === "schema"
                                            ? classes.schemaRow
                                            : row.item.type === "objectGroup"
                                              ? classes.objectGroupRow
                                              : row.item.type === "entity"
                                                ? classes.entityRow
                                                : classes.columnRow,
                                    );

                                    return (
                                        <TableRow
                                            key={row.item.id}
                                            aria-rowindex={virtualRow.index + 2}
                                            aria-expanded={
                                                row.item.type === "schema"
                                                    ? row.item.isExpanded
                                                    : row.item.type === "objectGroup"
                                                      ? row.item.isExpanded
                                                      : row.item.type === "entity" &&
                                                          row.item.entity.isSupported
                                                        ? row.item.isExpanded
                                                        : undefined
                                            }
                                            className={mergeClasses(rowClass, classes.virtualRow)}
                                            style={{
                                                transform: `translateY(${virtualRow.start}px)`,
                                            }}>
                                            {columns.map((column) => (
                                                <TableCell
                                                    {...columnSizing_unstable.getTableCellProps(
                                                        column.columnId,
                                                    )}
                                                    className={classes.cell}
                                                    key={`${row.item.id}-${String(column.columnId)}`}>
                                                    {column.renderCell?.(row.item)}
                                                </TableCell>
                                            ))}
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                </div>
            </div>

            {settingsEntity && dabConfig && (
                <DabEntitySettingsDialog
                    entity={settingsEntity}
                    existingEntityNames={dabConfig.entities
                        .filter((entity) => entity.id !== settingsEntity.id)
                        .map((entity) => entity.advancedSettings.entityName)}
                    isRestEnabled={dabConfig.apiTypes.includes(Dab.ApiType.Rest)}
                    isGraphQLEnabled={dabConfig.apiTypes.includes(Dab.ApiType.GraphQL)}
                    isMcpEnabled={dabConfig.apiTypes.includes(Dab.ApiType.Mcp)}
                    initialTab={settingsInitialTab}
                    onEnableApiType={(apiType) =>
                        updateDabApiTypes(Array.from(new Set([...dabConfig.apiTypes, apiType])))
                    }
                    open={!!settingsEntity}
                    onOpenChange={(open) => {
                        if (!open) {
                            closeSettingsDialog(settingsEntity.id);
                        }
                    }}
                    onApply={(updatedEntity) => {
                        updateDabEntityConfig(updatedEntity);
                        closeSettingsDialog(settingsEntity.id);
                    }}
                />
            )}
        </>
    );
};
