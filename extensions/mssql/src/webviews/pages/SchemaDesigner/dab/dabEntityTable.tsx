/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Button,
    Checkbox,
    Text,
    Tooltip,
    makeStyles,
    mergeClasses,
    tokens,
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
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Dab } from "../../../../sharedInterfaces/dab";
import { locConstants } from "../../../common/locConstants";
import { useDabContext } from "./dabContext";
import { DabEntitySettingsDialog } from "./dabEntitySettingsDialog";
import "./dabEntityTable.css";

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
        display: "grid",
        alignItems: "center",
        height: `${ROW_HEIGHT}px`,
        borderBottom: `1px solid var(--vscode-editorWidget-border)`,
        backgroundColor: "var(--vscode-editor-background)",
        paddingInlineStart: "8px",
        position: "sticky",
        top: 0,
        zIndex: 1,
        fontWeight: 600,
        fontSize: "12px",
    },
    scrollContainer: {
        flex: "1 1 auto",
        overflow: "auto",
        minHeight: 0,
    },
    virtualList: {
        width: "100%",
        position: "relative",
    },
    row: {
        display: "grid",
        alignItems: "center",
        height: `${ROW_HEIGHT}px`,
        paddingInlineStart: "8px",
        boxSizing: "border-box",
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
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
    sourceCell: {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        color: tokens.colorNeutralForeground3,
        fontSize: "12px",
    },
    dataTypeLabel: {
        color: tokens.colorNeutralForeground4,
        fontSize: "11px",
        fontStyle: "italic",
        fontWeight: 300,
        flexShrink: 0,
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
        overflow: "hidden",
    },
    sortableHeader: {
        display: "flex",
        alignItems: "center",
        gap: "4px",
        cursor: "pointer",
        userSelect: "none",
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
    },
    settingsButton: {
        minWidth: "24px",
        width: "24px",
        height: "24px",
        padding: 0,
    },
    disabled: {
        opacity: 0.6,
    },
    unsupported: {
        opacity: 0.4,
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
    columnIcon: {
        color: "var(--vscode-symbolIcon-fieldForeground, var(--vscode-descriptionForeground))",
        width: "14px",
        height: "14px",
        flexShrink: 0,
    },
});

// Grid template shared between header and rows
const GRID_TEMPLATE =
    "32px 20px minmax(200px, 2fr) minmax(160px, 1fr) 100px 100px 100px 100px 40px";

// ── Component ──

export const DabEntityTable = () => {
    const classes = useStyles();
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
    const scrollContainerRef = useRef<HTMLDivElement>(undefined!);

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
                    const entityExpanded = expandedRows.has(entity.id);
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

    // ── Virtualization ──

    const virtualizer = useVirtualizer({
        count: flatRows.length,
        getScrollElement: () => scrollContainerRef.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: 10,
    });

    const [focusedRowIndex, setFocusedRowIndex] = useState(0);

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

    // ── Keyboard navigation ──

    const handleRowKeyDown = useCallback(
        (e: KeyboardEvent<HTMLDivElement>, rowIndex: number) => {
            const row = flatRows[rowIndex];
            let nextIndex = rowIndex;

            switch (e.key) {
                case "ArrowDown":
                    e.preventDefault();
                    nextIndex = Math.min(rowIndex + 1, flatRows.length - 1);
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    nextIndex = Math.max(rowIndex - 1, 0);
                    break;
                case "ArrowRight":
                    if (
                        row &&
                        (row.type === "schema" || row.type === "entity") &&
                        !row.isExpanded
                    ) {
                        e.preventDefault();
                        toggleExpanded(row.id);
                        return;
                    }
                    return;
                case "ArrowLeft":
                    if (row && (row.type === "schema" || row.type === "entity") && row.isExpanded) {
                        e.preventDefault();
                        toggleExpanded(row.id);
                        return;
                    }
                    return;
                case "Home":
                    e.preventDefault();
                    nextIndex = 0;
                    break;
                case "End":
                    e.preventDefault();
                    nextIndex = flatRows.length - 1;
                    break;
                default:
                    return;
            }

            if (nextIndex !== rowIndex) {
                setFocusedRowIndex(nextIndex);
                virtualizer.scrollToIndex(nextIndex, { align: "auto" });
                requestAnimationFrame(() => {
                    const el = scrollContainerRef.current?.querySelector<HTMLElement>(
                        `[data-row-index="${nextIndex}"]`,
                    );
                    if (el) {
                        el.focus();
                    }
                });
            }
        },
        [flatRows, toggleExpanded, virtualizer],
    );

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

    // ── Row renderers ──

    const renderSchemaRow = useCallback(
        (row: Extract<FlatRow, { type: "schema" }>) => {
            const supported = row.entities.filter((e) => e.isSupported);
            const enabledCount = supported.filter((e) => e.isEnabled).length;
            const checkState = getCheckedState(supported.length, enabledCount);

            return (
                <>
                    <Checkbox
                        checked={toNativeChecked(checkState)}
                        disabled={supported.length === 0}
                        onChange={() => toggleSchemaEntities(row.entities)}
                        aria-label={locConstants.schemaDesigner.toggleAllEntitiesInSchema(
                            row.schemaName,
                        )}
                    />
                    <Button
                        appearance="subtle"
                        size="small"
                        icon={row.isExpanded ? <ChevronDown16Regular /> : <ChevronRight16Regular />}
                        className={classes.expandButton}
                        onClick={() => toggleExpanded(row.id)}
                        aria-label={row.isExpanded ? "Collapse" : "Expand"}
                    />
                    <div className={classes.nameCell}>
                        <Folder16Regular className="dab-icon-schema" />
                        <span className={classes.nameLabel}>{row.schemaName}</span>
                        <Badge appearance="filled" size="small" color="informative">
                            {row.enabledEntityCount}/{row.entities.length}
                        </Badge>
                    </div>
                </>
            );
        },
        [classes, toggleSchemaEntities, toggleExpanded],
    );

    const renderEntityRow = useCallback(
        (row: Extract<FlatRow, { type: "entity" }>) => {
            const { entity } = row;
            const unsupportedText = getUnsupportedReasonText(entity);
            const toneClass = !entity.isSupported
                ? classes.unsupported
                : !entity.isEnabled
                  ? classes.disabled
                  : undefined;

            const nameContent = (
                <>
                    <Checkbox
                        checked={entity.isEnabled}
                        disabled={!entity.isSupported}
                        onChange={() => toggleDabEntity(entity.id, !entity.isEnabled)}
                        aria-label={locConstants.schemaDesigner.enableEntity(
                            entity.advancedSettings.entityName,
                        )}
                    />
                    <Button
                        appearance="subtle"
                        size="small"
                        icon={row.isExpanded ? <ChevronDown16Regular /> : <ChevronRight16Regular />}
                        className={classes.expandButton}
                        onClick={() => toggleExpanded(entity.id)}
                        aria-label={row.isExpanded ? "Collapse" : "Expand"}
                    />
                    <div className={mergeClasses(classes.nameCell, toneClass)}>
                        <Table16Regular className="dab-icon-table" />
                        <span className={classes.nameLabel}>
                            {entity.advancedSettings.entityName}
                        </span>
                        <Badge appearance="filled" size="small" color="informative">
                            {entity.columns.filter((c) => c.isExposed).length}/
                            {entity.columns.length}
                        </Badge>
                        {unsupportedText && (
                            <Tooltip content={unsupportedText} relationship="description">
                                <Warning16Regular className={classes.warningIcon} />
                            </Tooltip>
                        )}
                    </div>
                    <span className={mergeClasses(classes.sourceCell, toneClass)}>
                        {entity.schemaName}.{entity.tableName}
                    </span>
                    {allActions.map((action) => (
                        <div className={classes.actionCell} key={action}>
                            <Checkbox
                                checked={entity.enabledActions.includes(action)}
                                disabled={!entity.isEnabled || !entity.isSupported}
                                onChange={() =>
                                    toggleDabEntityAction(
                                        entity.id,
                                        action,
                                        !entity.enabledActions.includes(action),
                                    )
                                }
                                aria-label={locConstants.schemaDesigner.actionForEntity(
                                    actionLabels[action],
                                    entity.advancedSettings.entityName,
                                )}
                            />
                        </div>
                    ))}
                    <div className={classes.settingsCell}>
                        <Tooltip
                            content={locConstants.schemaDesigner.settingsForEntity(
                                entity.advancedSettings.entityName,
                            )}
                            relationship="label">
                            <Button
                                appearance="subtle"
                                size="small"
                                icon={<Settings16Regular />}
                                className={classes.settingsButton}
                                onClick={() => setSettingsEntityId(entity.id)}
                            />
                        </Tooltip>
                    </div>
                </>
            );

            return nameContent;
        },
        [allActions, actionLabels, classes, toggleDabEntity, toggleDabEntityAction, toggleExpanded],
    );

    const renderColumnRow = useCallback(
        (row: Extract<FlatRow, { type: "column" }>) => {
            const { entity, column } = row;
            const unsupportedText = !column.isSupported
                ? locConstants.schemaDesigner.unsupportedDataTypes(
                      `${column.name} (${column.dataType})`,
                  )
                : "";

            return (
                <>
                    <Checkbox
                        checked={column.isExposed}
                        disabled={!entity.isSupported}
                        onChange={() =>
                            toggleDabColumnExposure(entity.id, column.id, !column.isExposed)
                        }
                        aria-label={locConstants.schemaDesigner.exposeColumn(column.name)}
                    />
                    <span className={classes.expandPlaceholder} />
                    <div className={classes.nameCell}>
                        <svg
                            className={classes.columnIcon}
                            viewBox="0 0 16 16"
                            fill="currentColor"
                            focusable={false}
                            aria-hidden="true">
                            <path d="M3.25 2C4.22 2 5 2.78 5 3.75v8.5C5 13.22 4.22 14 3.25 14H2.5a.5.5 0 0 1 0-1h.75c.41 0 .75-.34.75-.75v-8.5A.75.75 0 0 0 3.25 3H2.5a.5.5 0 0 1 0-1h.75ZM8.5 2c.83 0 1.5.67 1.5 1.5v9c0 .83-.67 1.5-1.5 1.5h-1A1.5 1.5 0 0 1 6 12.5v-9C6 2.67 6.67 2 7.5 2h1Zm5 0a.5.5 0 0 1 0 1h-.75a.75.75 0 0 0-.75.75v8.5c0 .41.34.75.75.75h.75a.5.5 0 0 1 0 1h-.75c-.97 0-1.75-.78-1.75-1.75v-8.5c0-.97.78-1.75 1.75-1.75h.75Zm-6 1a.5.5 0 0 0-.5.5v9c0 .28.22.5.5.5h1a.5.5 0 0 0 .5-.5v-9a.5.5 0 0 0-.5-.5h-1Z" />
                        </svg>
                        <span className={classes.nameLabel}>{column.name}</span>
                        <span className={classes.dataTypeLabel}>{column.dataType}</span>
                        {unsupportedText && (
                            <Tooltip content={unsupportedText} relationship="description">
                                <Warning16Regular className={classes.warningIcon} />
                            </Tooltip>
                        )}
                    </div>
                </>
            );
        },
        [classes, toggleDabColumnExposure],
    );

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
                    {/* Header */}
                    <div
                        className={classes.header}
                        style={{ gridTemplateColumns: GRID_TEMPLATE }}
                        role="row"
                        aria-rowindex={1}>
                        <span />
                        <span />
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
                            role="columnheader"
                            aria-sort={sortDirection === "asc" ? "ascending" : "descending"}>
                            {locConstants.schemaDesigner.entityName}
                            {sortDirection === "asc" ? (
                                <ArrowSortUp16Filled className={classes.sortIcon} />
                            ) : (
                                <ArrowSortDown16Filled className={classes.sortIcon} />
                            )}
                        </span>
                        <span>{locConstants.schemaDesigner.sourceTable}</span>
                        {allActions.map((action) => (
                            <div className={classes.headerActionCell} key={action}>
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
                        ))}
                        <span />
                    </div>

                    {/* Virtualized body */}
                    <div className={classes.scrollContainer} ref={scrollContainerRef} role="grid">
                        <div
                            className={classes.virtualList}
                            style={{ height: `${virtualizer.getTotalSize()}px` }}>
                            {virtualizer.getVirtualItems().map((virtualRow) => {
                                const row = flatRows[virtualRow.index];
                                const rowClass = mergeClasses(
                                    classes.row,
                                    row.type === "schema"
                                        ? classes.schemaRow
                                        : row.type === "entity"
                                          ? classes.entityRow
                                          : classes.columnRow,
                                );

                                // Column rows use a narrower grid (no CRUD/settings cells)
                                const gridCols =
                                    row.type === "column"
                                        ? "32px 20px minmax(200px, 2fr)"
                                        : row.type === "schema"
                                          ? "32px 20px minmax(200px, 2fr)"
                                          : GRID_TEMPLATE;

                                return (
                                    <div
                                        key={row.id}
                                        className={rowClass}
                                        data-row-index={virtualRow.index}
                                        tabIndex={virtualRow.index === focusedRowIndex ? 0 : -1}
                                        onKeyDown={(e) => handleRowKeyDown(e, virtualRow.index)}
                                        onFocus={() => setFocusedRowIndex(virtualRow.index)}
                                        style={{
                                            gridTemplateColumns: gridCols,
                                            transform: `translateY(${virtualRow.start}px)`,
                                            paddingInlineStart:
                                                row.type === "column"
                                                    ? "48px"
                                                    : row.type === "entity"
                                                      ? "28px"
                                                      : "8px",
                                        }}
                                        role="row"
                                        aria-rowindex={virtualRow.index + 2}>
                                        {row.type === "schema" && renderSchemaRow(row)}
                                        {row.type === "entity" && renderEntityRow(row)}
                                        {row.type === "column" && renderColumnRow(row)}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {settingsEntity && (
                <DabEntitySettingsDialog
                    entity={settingsEntity}
                    open={!!settingsEntity}
                    onOpenChange={(open) => {
                        if (!open) {
                            setSettingsEntityId(undefined);
                        }
                    }}
                    onApply={(settings) => {
                        updateDabEntitySettings(settingsEntity.id, settings);
                        setSettingsEntityId(undefined);
                    }}
                />
            )}
        </>
    );
};
