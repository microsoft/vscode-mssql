/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
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
    Folder16Regular,
    Settings16Regular,
    Table16Regular,
    Warning16Regular,
} from "@fluentui/react-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Dab } from "../../../../sharedInterfaces/dab";
import { locConstants } from "../../../common/locConstants";
import { PrimaryKeyIcon } from "../../../common/icons/primaryKey";
import { useDabContext } from "./dabContext";
import { DabEntitySettingsDialog } from "./dabEntitySettingsDialog";
import "./dabEntityTable.css";

const ENTITY_INDENT = 20;
const COLUMN_INDENT = 40;

type FlatRowColumnId =
    | "select"
    | "expand"
    | "name"
    | "source"
    | "create"
    | "read"
    | "update"
    | "delete"
    | "settings";

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
      };

type CheckedState = "checked" | "mixed" | "unchecked";

// ── Helpers ──

function formatUnsupportedReasons(reasons: Dab.DabUnsupportedReason[]): string {
    return reasons
        .map((reason) => {
            switch (reason.type) {
                case "noPrimaryKey":
                    return locConstants.schemaDesigner.unsupportedNoPrimaryKey;
                case "unsupportedDataTypes":
                    return locConstants.schemaDesigner.unsupportedDataTypes(reason.columns);
            }
        })
        .join("; ");
}

function getEntityFullName(entity: Dab.DabEntityConfig): string {
    return `${entity.schemaName}.${entity.tableName}`;
}

function getCheckedState(total: number, checked: number): CheckedState {
    if (total > 0 && checked === total) {
        return "checked";
    }
    return checked > 0 ? "mixed" : "unchecked";
}

function toNativeChecked(state: CheckedState): boolean | "mixed" {
    if (state === "mixed") {
        return "mixed";
    }
    return state === "checked";
}

function getUnsupportedReasonText(entity: Dab.DabEntityConfig): string {
    if (!entity.isSupported && entity.unsupportedReasons) {
        return formatUnsupportedReasons(entity.unsupportedReasons);
    }
    return "";
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
    },
    headerCell: {
        minWidth: 0,
        overflow: "hidden",
        fontWeight: 600,
        fontSize: "12px",
        backgroundColor: "var(--vscode-editor-background)",
        position: "sticky",
        top: 0,
        zIndex: 1,
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
    warningIcon: {
        color: "var(--vscode-editorWarning-foreground)",
        flexShrink: 0,
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

export const DabEntityTable = () => {
    const classes = useStyles();
    const keyboardNavAttr = useArrowNavigationGroup({ axis: "grid" });
    const context = useDabContext();
    const {
        dabConfig,
        toggleDabEntity,
        toggleDabEntityAction,
        toggleDabColumnExposure,
        updateDabEntitySettings,
        dabTextFilter,
        currentFilteredTables,
    } = context;

    const [expandedRows, setExpandedRows] = useState<Set<string>>(() => {
        // Schemas expanded by default
        if (!dabConfig) {
            return new Set<string>();
        }
        const schemas = new Set<string>();
        for (const entity of dabConfig.entities) {
            schemas.add(`schema-${entity.schemaName}`);
        }
        return schemas;
    });
    const [settingsEntityId, setSettingsEntityId] = useState<string | undefined>(undefined);
    const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
    const settingsButtonRefs = useRef<Map<string, HTMLElement | null>>(new Map());
    const pendingSettingsFocusEntityIdRef = useRef<string | undefined>(undefined);
    const scrollContainerRef = useRef<HTMLDivElement | undefined>(undefined);

    const initialEnabledEntities = useRef<Set<string>>(
        new Set(
            dabConfig?.entities.filter((e) => e.isEnabled).map((e) => getEntityFullName(e)) ?? [],
        ),
    );

    useEffect(() => {
        if (!dabConfig) {
            return;
        }

        const tablesToCheck: Set<string> =
            currentFilteredTables.length > 0
                ? new Set(currentFilteredTables)
                : initialEnabledEntities.current;

        dabConfig.entities.forEach((entity) => {
            const fullName = getEntityFullName(entity);
            const shouldCheck = tablesToCheck.has(fullName);

            if (initialEnabledEntities.current.has(fullName) && shouldCheck !== entity.isEnabled) {
                toggleDabEntity(entity.id, shouldCheck);
            }
        });
    }, [currentFilteredTables]);

    const allActions = useMemo(
        () => [
            Dab.EntityAction.Create,
            Dab.EntityAction.Read,
            Dab.EntityAction.Update,
            Dab.EntityAction.Delete,
        ],
        [],
    );

    const actionLabels: Record<Dab.EntityAction, string> = useMemo(
        () => ({
            [Dab.EntityAction.Create]: locConstants.schemaDesigner.create,
            [Dab.EntityAction.Read]: locConstants.schemaDesigner.read,
            [Dab.EntityAction.Update]: locConstants.schemaDesigner.update,
            [Dab.EntityAction.Delete]: locConstants.common.delete,
        }),
        [],
    );

    // ── Filtering ──

    const filteredEntities = useMemo(() => {
        if (!dabConfig) {
            return [];
        }
        if (!dabTextFilter.trim()) {
            return dabConfig.entities;
        }

        const loweredFilter = dabTextFilter.toLowerCase().trim();
        return dabConfig.entities.filter((entity) => {
            const entityName = entity.advancedSettings.entityName.toLowerCase();
            const schemaName = entity.schemaName.toLowerCase();
            const source = `${entity.schemaName}.${entity.tableName}`.toLowerCase();
            const columnNames = entity.columns.map((column) => column.name.toLowerCase());

            return (
                entityName.includes(loweredFilter) ||
                schemaName.includes(loweredFilter) ||
                source.includes(loweredFilter) ||
                columnNames.some((columnName) => columnName.includes(loweredFilter))
            );
        });
    }, [dabConfig, dabTextFilter]);

    // ── Grouped by schema and sorted ──

    const entitiesBySchema = useMemo(() => {
        const groups: Record<string, Dab.DabEntityConfig[]> = {};
        for (const entity of filteredEntities) {
            if (!groups[entity.schemaName]) {
                groups[entity.schemaName] = [];
            }
            groups[entity.schemaName].push(entity);
        }

        const dir = sortDirection === "asc" ? 1 : -1;
        return Object.entries(groups)
            .sort(([a], [b]) => a.localeCompare(b) * dir)
            .map(
                ([schemaName, entities]) =>
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
            const schemaId = `schema-${schemaName}`;
            const schemaExpanded = expandedRows.has(schemaId);
            const enabledEntityCount = entities.filter((e) => e.isEnabled).length;

            rows.push({
                type: "schema",
                id: schemaId,
                schemaName,
                entities,
                enabledEntityCount,
                isExpanded: schemaExpanded,
            });

            if (schemaExpanded) {
                for (const entity of entities) {
                    const entityExpanded = entity.isSupported && expandedRows.has(entity.id);
                    rows.push({
                        type: "entity",
                        id: entity.id,
                        entity,
                        isExpanded: entityExpanded,
                    });

                    if (entityExpanded) {
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

    // ── Bulk header action toggles ──

    const headerActionState = useCallback(
        (action: Dab.EntityAction): CheckedState => {
            const enabledEntities = filteredEntities.filter((e) => e.isSupported && e.isEnabled);
            const withAction = enabledEntities.filter((e) => e.enabledActions.includes(action));
            return getCheckedState(enabledEntities.length, withAction.length);
        },
        [filteredEntities],
    );

    const toggleHeaderAction = useCallback(
        (action: Dab.EntityAction) => {
            const enabledEntities = filteredEntities.filter((e) => e.isSupported && e.isEnabled);
            if (enabledEntities.length === 0) {
                return;
            }

            const shouldEnable = headerActionState(action) !== "checked";
            for (const entity of enabledEntities) {
                toggleDabEntityAction(entity.id, action, shouldEnable);
            }
        },
        [filteredEntities, headerActionState, toggleDabEntityAction],
    );

    // ── Schema-level checkbox ──

    const toggleSchemaEntities = useCallback(
        (entities: Dab.DabEntityConfig[]) => {
            const supported = entities.filter((e) => e.isSupported);
            const enabledCount = supported.filter((e) => e.isEnabled).length;
            const shouldEnable = getCheckedState(supported.length, enabledCount) !== "checked";
            for (const entity of supported) {
                toggleDabEntity(entity.id, shouldEnable);
            }
        },
        [toggleDabEntity],
    );

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
            restoreSettingsTriggerFocus(entityId ?? pendingSettingsFocusEntityIdRef.current);
        },
        [restoreSettingsTriggerFocus],
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
            case "column":
                return COLUMN_INDENT;
            default:
                return 0;
        }
    }, []);

    const renderSelectContent = useCallback(
        (row: FlatRow) => {
            if (row.type === "schema") {
                const supported = row.entities.filter((e) => e.isSupported);
                const enabledCount = supported.filter((e) => e.isEnabled).length;
                const checkState = getCheckedState(supported.length, enabledCount);

                return (
                    <div className={classes.centeredCell}>
                        <Checkbox
                            checked={toNativeChecked(checkState)}
                            disabled={supported.length === 0}
                            onChange={() => toggleSchemaEntities(row.entities)}
                            aria-label={locConstants.schemaDesigner.toggleAllEntitiesInSchema(
                                row.schemaName,
                            )}
                        />
                    </div>
                );
            }

            if (row.type === "entity") {
                const checkbox = (
                    <Checkbox
                        checked={row.entity.isEnabled}
                        disabled={!row.entity.isSupported}
                        onChange={() => toggleDabEntity(row.entity.id, !row.entity.isEnabled)}
                        aria-label={locConstants.schemaDesigner.enableEntity(
                            row.entity.advancedSettings.entityName,
                        )}
                    />
                );

                return (
                    <div className={classes.centeredCell}>
                        {row.entity.isSupported ? (
                            checkbox
                        ) : (
                            <Tooltip
                                content={getUnsupportedReasonText(row.entity)}
                                relationship="description">
                                <span>{checkbox}</span>
                            </Tooltip>
                        )}
                    </div>
                );
            }

            const isPrimaryKeyColumn = row.column.isPrimaryKey;
            const checkbox = (
                <Checkbox
                    checked={row.column.isExposed}
                    disabled={!row.entity.isSupported || isPrimaryKeyColumn}
                    onChange={() =>
                        toggleDabColumnExposure(row.entity.id, row.column.id, !row.column.isExposed)
                    }
                    aria-label={
                        isPrimaryKeyColumn
                            ? locConstants.schemaDesigner.primaryKeyColumnExposureLocked(
                                  row.column.name,
                              )
                            : locConstants.schemaDesigner.exposeColumn(row.column.name)
                    }
                />
            );

            return (
                <div className={classes.centeredCell}>
                    {isPrimaryKeyColumn ? (
                        <Tooltip
                            content={locConstants.schemaDesigner.primaryKeyColumnExposureLocked(
                                row.column.name,
                            )}
                            relationship="label">
                            <span>{checkbox}</span>
                        </Tooltip>
                    ) : (
                        checkbox
                    )}
                </div>
            );
        },
        [classes.centeredCell, toggleDabColumnExposure, toggleDabEntity, toggleSchemaEntities],
    );

    const renderExpandContent = useCallback(
        (row: FlatRow) => {
            if (row.type === "schema") {
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
                        <span className={classes.nameLabel}>{row.schemaName}</span>
                        <Badge appearance="filled" size="small" color="informative">
                            {row.enabledEntityCount}/{row.entities.length}
                        </Badge>
                    </div>
                );
            }

            if (row.type === "entity") {
                const unsupportedText = getUnsupportedReasonText(row.entity);

                const nameContent = (
                    <div
                        className={classes.nameCellContent}
                        style={{ paddingInlineStart: `${getRowIndent(row)}px` }}>
                        <Table16Regular className="dab-icon-table" />
                        <span className={classes.nameLabel}>
                            {row.entity.advancedSettings.entityName}
                        </span>
                        <Badge appearance="filled" size="small" color="informative">
                            {row.entity.columns.filter((c) => c.isExposed).length}/
                            {row.entity.columns.length}
                        </Badge>
                        {unsupportedText && (
                            <Tooltip content={unsupportedText} relationship="description">
                                <Warning16Regular className={classes.warningIcon} />
                            </Tooltip>
                        )}
                    </div>
                );

                return unsupportedText ? (
                    <Tooltip content={unsupportedText} relationship="description">
                        {nameContent}
                    </Tooltip>
                ) : (
                    nameContent
                );
            }

            const unsupportedText = !row.column.isSupported
                ? locConstants.schemaDesigner.unsupportedDataTypes(
                      `${row.column.name} (${row.column.dataType})`,
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
                    <span className={classes.nameLabel}>{row.column.name}</span>
                    {row.column.isPrimaryKey && (
                        <Tooltip
                            content={locConstants.schemaDesigner.primaryKey}
                            relationship="label">
                            <PrimaryKeyIcon className={classes.primaryKeyIcon} />
                        </Tooltip>
                    )}
                    <span className={classes.dataTypeLabel}>{row.column.dataType}</span>
                    {unsupportedText && (
                        <Tooltip content={unsupportedText} relationship="description">
                            <Warning16Regular className={classes.warningIcon} />
                        </Tooltip>
                    )}
                </div>
            );
        },
        [
            classes.columnIcon,
            classes.dataTypeLabel,
            classes.nameCellContent,
            classes.nameLabel,
            classes.primaryKeyIcon,
            classes.warningIcon,
            getRowIndent,
        ],
    );

    const renderSourceContent = useCallback(
        (row: FlatRow) => {
            if (row.type !== "entity") {
                return renderBlankContent();
            }

            return (
                <span className={classes.sourceCell}>
                    {row.entity.schemaName}.{row.entity.tableName}
                </span>
            );
        },
        [classes.sourceCell, renderBlankContent],
    );

    const renderActionContent = useCallback(
        (row: FlatRow, action: Dab.EntityAction) => {
            if (row.type !== "entity") {
                return renderBlankContent();
            }

            const isActionChecked =
                row.entity.isEnabled && row.entity.enabledActions.includes(action);

            return (
                <div className={classes.actionCell}>
                    <Checkbox
                        checked={isActionChecked}
                        disabled={!row.entity.isEnabled || !row.entity.isSupported}
                        onChange={() =>
                            toggleDabEntityAction(
                                row.entity.id,
                                action,
                                !row.entity.enabledActions.includes(action),
                            )
                        }
                        aria-label={locConstants.schemaDesigner.actionForEntity(
                            actionLabels[action],
                            row.entity.advancedSettings.entityName,
                        )}
                    />
                </div>
            );
        },
        [actionLabels, classes.actionCell, renderBlankContent, toggleDabEntityAction],
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
                            disabled={!row.entity.isEnabled}
                            ref={(el) => {
                                settingsButtonRefs.current.set(row.entity.id, el);
                            }}
                            onClick={() => {
                                pendingSettingsFocusEntityIdRef.current = row.entity.id;
                                setSettingsEntityId(row.entity.id);
                            }}
                        />
                    </Tooltip>
                </div>
            );
        },
        [classes.settingsButton, classes.settingsCell, renderBlankContent],
    );

    const columns = useMemo<TableColumnDefinition<FlatRow>[]>(
        () => [
            createTableColumn<FlatRow>({
                columnId: "select",
                renderHeaderCell: () => <span />,
                renderCell: renderSelectContent,
            }),
            createTableColumn<FlatRow>({
                columnId: "expand",
                renderHeaderCell: () => <span />,
                renderCell: renderExpandContent,
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
                renderHeaderCell: () => <span>{locConstants.schemaDesigner.sourceTable}</span>,
                renderCell: renderSourceContent,
            }),
            ...allActions.map((action) =>
                createTableColumn<FlatRow>({
                    columnId: action.toLowerCase() as FlatRowColumnId,
                    renderHeaderCell: () => (
                        <div className={classes.headerActionCell}>
                            <Checkbox
                                checked={toNativeChecked(headerActionState(action))}
                                disabled={
                                    filteredEntities.filter((e) => e.isSupported && e.isEnabled)
                                        .length === 0
                                }
                                onChange={() => toggleHeaderAction(action)}
                                aria-label={locConstants.schemaDesigner.selectAllAction(
                                    actionLabels[action],
                                )}
                                label={actionLabels[action]}
                            />
                        </div>
                    ),
                    renderCell: (row) => renderActionContent(row, action),
                }),
            ),
            createTableColumn<FlatRow>({
                columnId: "settings",
                renderHeaderCell: () => <span />,
                renderCell: renderSettingsContent,
            }),
        ],
        [
            actionLabels,
            allActions,
            classes.headerActionCell,
            classes.sortIcon,
            classes.sortableHeader,
            filteredEntities,
            headerActionState,
            renderActionContent,
            renderExpandContent,
            renderNameContent,
            renderSelectContent,
            renderSettingsContent,
            renderSourceContent,
            sortDirection,
            toggleHeaderAction,
        ],
    );

    const columnSizingOptions = useMemo<TableColumnSizingOptions>(
        () => ({
            select: { defaultWidth: 32, minWidth: 32, idealWidth: 32 },
            expand: { defaultWidth: 24, minWidth: 24, idealWidth: 24 },
            name: { defaultWidth: 420, minWidth: 220, idealWidth: 420 },
            source: { defaultWidth: 200, minWidth: 140, idealWidth: 200 },
            create: { defaultWidth: 84, minWidth: 72, idealWidth: 84 },
            read: { defaultWidth: 84, minWidth: 72, idealWidth: 84 },
            update: { defaultWidth: 84, minWidth: 72, idealWidth: 84 },
            delete: { defaultWidth: 84, minWidth: 72, idealWidth: 84 },
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
                                <TableRow aria-rowindex={1}>
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

            {settingsEntity && (
                <DabEntitySettingsDialog
                    entity={settingsEntity}
                    open={!!settingsEntity}
                    onOpenChange={(open) => {
                        if (!open) {
                            closeSettingsDialog(settingsEntity.id);
                        }
                    }}
                    onApply={(settings) => {
                        updateDabEntitySettings(settingsEntity.id, settings);
                        closeSettingsDialog(settingsEntity.id);
                    }}
                />
            )}
        </>
    );
};
