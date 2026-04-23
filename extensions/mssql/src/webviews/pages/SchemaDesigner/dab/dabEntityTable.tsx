/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { treeFormatter, type TreeToggleStateChange } from "@slickgrid-universal/common";
import { Text } from "@fluentui/react-components";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Column, type Formatter, type GridOption, htmlEncode } from "slickgrid-react";
import { Dab } from "../../../../sharedInterfaces/dab";
import {
    baseFluentReadOnlyGridOption,
    createFluentAutoResizeOptions,
    FluentSlickGrid,
} from "../../../common/FluentSlickGrid/FluentSlickGrid";
import { locConstants } from "../../../common/locConstants";
import { useDabContext } from "./dabContext";
import { DabEntitySettingsDialog } from "./dabEntitySettingsDialog";
import "./dabEntityTable.css";

type DabTreeRow =
    | {
          id: string;
          rowType: "schema";
          entityName: string;
          source: string;
          schemaName: string;
          entities: Dab.DabEntityConfig[];
          enabledEntityCount: number;
          hasChildren: boolean;
          children: DabTreeRow[];
          __collapsed: boolean;
      }
    | {
          id: string;
          rowType: "entity";
          entityName: string;
          source: string;
          entity: Dab.DabEntityConfig;
          hasChildren: boolean;
          children: DabTreeRow[];
          __collapsed: boolean;
      }
    | {
          id: string;
          rowType: "column";
          entityName: string;
          source: string;
          entity: Dab.DabEntityConfig;
          column: Dab.DabColumnConfig;
      };

type ToggleVisualState = "checked" | "mixed" | "unchecked";

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

function getToggleState(totalCount: number, checkedCount: number): ToggleVisualState {
    if (totalCount > 0 && checkedCount === totalCount) {
        return "checked";
    }
    if (checkedCount > 0) {
        return "mixed";
    }
    return "unchecked";
}

function getToggleSymbol(state: ToggleVisualState): string {
    switch (state) {
        case "checked":
            return "x";
        case "mixed":
            return "-";
        default:
            return "&nbsp;";
    }
}

function getEntityToneClass(entity: Dab.DabEntityConfig): string {
    if (!entity.isSupported) {
        return "dab-tone-unsupported";
    }
    if (!entity.isEnabled) {
        return "dab-tone-disabled";
    }
    return "";
}

function renderToggleButtonHtml(options: {
    state: ToggleVisualState;
    label: string;
    disabled?: boolean;
    extraClassName?: string;
    dataAttributes?: Record<string, string>;
}): string {
    const classes = ["dab-grid-toggle", `is-${options.state}`, options.extraClassName]
        .filter(Boolean)
        .join(" ");
    const ariaChecked =
        options.state === "mixed" ? "mixed" : options.state === "checked" ? "true" : "false";
    const disabledAttributes = options.disabled ? ' disabled aria-disabled="true"' : "";
    const dataAttributes = Object.entries(options.dataAttributes ?? {})
        .map(([key, value]) => ` data-${key}="${htmlEncode(value)}"`)
        .join("");

    return `<button type="button" class="${classes}" role="checkbox" aria-checked="${ariaChecked}" aria-label="${htmlEncode(options.label)}" title="${htmlEncode(options.label)}"${disabledAttributes}${dataAttributes}>${getToggleSymbol(options.state)}</button>`;
}

function renderTextCellHtml(text: string, className: string, title?: string): string {
    return `<span class="${className}" title="${htmlEncode(title ?? text)}">${htmlEncode(text)}</span>`;
}

function renderSettingsButtonHtml(label: string, disabled: boolean): string {
    const disabledAttributes = disabled ? ' disabled aria-disabled="true"' : "";
    return `<button type="button" class="dab-grid-icon-button" data-dab-role="settings" aria-label="${htmlEncode(label)}" title="${htmlEncode(label)}"${disabledAttributes}>...</button>`;
}

export const DabEntityTable = () => {
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

    const [collapsedRows, setCollapsedRows] = useState<Map<string, boolean>>(new Map());
    const [settingsEntityId, setSettingsEntityId] = useState<string | null>(null);

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

    const entitiesBySchema = useMemo(() => {
        const groups: Record<string, Dab.DabEntityConfig[]> = {};
        for (const entity of filteredEntities) {
            if (!groups[entity.schemaName]) {
                groups[entity.schemaName] = [];
            }
            groups[entity.schemaName].push(entity);
        }

        return Object.entries(groups)
            .sort(([leftSchema], [rightSchema]) => leftSchema.localeCompare(rightSchema))
            .map(
                ([schemaName, entities]) =>
                    [
                        schemaName,
                        [...entities].sort((left, right) => {
                            const supportComparison =
                                Number(!left.isSupported) - Number(!right.isSupported);
                            if (supportComparison !== 0) {
                                return supportComparison;
                            }
                            return left.advancedSettings.entityName.localeCompare(
                                right.advancedSettings.entityName,
                            );
                        }),
                    ] as const,
            );
    }, [filteredEntities]);

    const treeRows = useMemo<DabTreeRow[]>(() => {
        return entitiesBySchema.map(([schemaName, entities]) => {
            const schemaId = `schema-${schemaName}`;
            const entityRows: DabTreeRow[] = entities.map((entity) => ({
                id: entity.id,
                rowType: "entity",
                entityName: entity.advancedSettings.entityName,
                source: `${entity.schemaName}.${entity.tableName}`,
                entity,
                hasChildren: entity.columns.length > 0,
                children: entity.columns.map((column) => ({
                    id: `${entity.id}-${column.id}`,
                    rowType: "column",
                    entityName: column.name,
                    source: column.dataType,
                    entity,
                    column,
                })),
                __collapsed: collapsedRows.get(entity.id) ?? true,
            }));
            const enabledEntityCount = entities.filter((entity) => entity.isEnabled).length;

            return {
                id: schemaId,
                rowType: "schema",
                entityName: schemaName,
                source: "",
                schemaName,
                entities,
                enabledEntityCount,
                hasChildren: entityRows.length > 0,
                children: entityRows,
                __collapsed: collapsedRows.get(schemaId) ?? false,
            };
        });
    }, [collapsedRows, entitiesBySchema]);

    const settingsEntity = useMemo(() => {
        if (!settingsEntityId || !dabConfig) {
            return null;
        }
        return dabConfig.entities.find((entity) => entity.id === settingsEntityId) ?? null;
    }, [dabConfig, settingsEntityId]);

    const renderTreeTitle = useCallback<Formatter<DabTreeRow>>(
        (_row, _cell, value, _columnDef, item) => {
            if (!item) {
                return htmlEncode(String(value ?? ""));
            }

            if (item.rowType === "schema") {
                return `<span class="dab-tree-title dab-tree-title-schema"><span class="dab-tree-title-label">${htmlEncode(item.schemaName)}</span><span class="dab-tree-pill">${item.enabledEntityCount}/${item.entities.length}</span></span>`;
            }

            if (item.rowType === "entity") {
                const warningText =
                    !item.entity.isSupported && item.entity.unsupportedReasons
                        ? htmlEncode(formatUnsupportedReasons(item.entity.unsupportedReasons))
                        : "";
                const warningHtml = warningText
                    ? `<span class="dab-tree-warning" title="${warningText}" aria-hidden="true">!</span>`
                    : "";
                const toneClass = getEntityToneClass(item.entity);

                return `<span class="dab-tree-title dab-tree-title-entity ${toneClass}"><span class="dab-tree-title-label">${htmlEncode(item.entity.advancedSettings.entityName)}</span>${warningHtml}</span>`;
            }

            const warningText = !item.column.isSupported
                ? htmlEncode(
                      locConstants.schemaDesigner.unsupportedDataTypes(
                          `${item.column.name} (${item.column.dataType})`,
                      ),
                  )
                : "";
            const warningHtml = warningText
                ? `<span class="dab-tree-warning" title="${warningText}" aria-hidden="true">!</span>`
                : "";

            return `<span class="dab-tree-title dab-tree-title-column"><span class="dab-tree-title-label">${htmlEncode(item.column.name)}</span>${warningHtml}</span>`;
        },
        [],
    );

    const checkboxFormatter = useCallback<Formatter<DabTreeRow>>(
        (_row, _cell, _value, _columnDef, item) => {
            if (!item) {
                return "";
            }

            if (item.rowType === "schema") {
                const supportedEntities = item.entities.filter((entity) => entity.isSupported);
                const checkedCount = supportedEntities.filter((entity) => entity.isEnabled).length;
                return renderToggleButtonHtml({
                    state: getToggleState(supportedEntities.length, checkedCount),
                    label: locConstants.schemaDesigner.toggleAllEntitiesInSchema(item.schemaName),
                    disabled: supportedEntities.length === 0,
                    dataAttributes: { "dab-role": "checkbox" },
                });
            }

            if (item.rowType === "entity") {
                return renderToggleButtonHtml({
                    state: item.entity.isEnabled ? "checked" : "unchecked",
                    label: locConstants.schemaDesigner.enableEntity(
                        item.entity.advancedSettings.entityName,
                    ),
                    disabled: !item.entity.isSupported,
                    dataAttributes: { "dab-role": "checkbox" },
                });
            }

            return renderToggleButtonHtml({
                state: item.column.isExposed ? "checked" : "unchecked",
                label: locConstants.schemaDesigner.exposeColumn(item.column.name),
                disabled: !item.entity.isSupported,
                dataAttributes: { "dab-role": "checkbox" },
            });
        },
        [],
    );

    const sourceFormatter = useCallback<Formatter<DabTreeRow>>(
        (_row, _cell, _value, _columnDef, item) => {
            if (!item || item.rowType === "schema") {
                return "";
            }

            if (item.rowType === "entity") {
                const toneClass = getEntityToneClass(item.entity);
                return renderTextCellHtml(item.source, `dab-source-text ${toneClass}`.trim());
            }

            return renderTextCellHtml(item.source, "dab-source-text dab-source-type");
        },
        [],
    );

    const createActionHeader = useCallback(
        (action: Dab.EntityAction) => {
            if (typeof document === "undefined") {
                return actionLabels[action];
            }

            const enabledEntities = filteredEntities.filter(
                (entity) => entity.isSupported && entity.isEnabled,
            );
            const withAction = enabledEntities.filter((entity) =>
                entity.enabledActions.includes(action),
            );
            const state = getToggleState(enabledEntities.length, withAction.length);

            const wrapper = document.createElement("div");
            wrapper.className = "dab-action-header";

            const toggleButton = document.createElement("button");
            toggleButton.type = "button";
            toggleButton.className = `dab-grid-toggle dab-action-header-toggle is-${state}`;
            toggleButton.setAttribute("role", "checkbox");
            toggleButton.setAttribute(
                "aria-checked",
                state === "mixed" ? "mixed" : state === "checked" ? "true" : "false",
            );
            toggleButton.setAttribute(
                "aria-label",
                locConstants.schemaDesigner.selectAllAction(actionLabels[action]),
            );
            toggleButton.setAttribute(
                "title",
                locConstants.schemaDesigner.selectAllAction(actionLabels[action]),
            );
            toggleButton.textContent = state === "checked" ? "x" : state === "mixed" ? "-" : " ";
            toggleButton.disabled = enabledEntities.length === 0;
            toggleButton.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();

                const shouldEnable = state !== "checked";
                for (const entity of enabledEntities) {
                    toggleDabEntityAction(entity.id, action, shouldEnable);
                }
            });

            const label = document.createElement("span");
            label.className = "dab-action-header-label";
            label.textContent = actionLabels[action];

            wrapper.append(toggleButton, label);
            return wrapper;
        },
        [actionLabels, filteredEntities, toggleDabEntityAction],
    );

    const createActionFormatter = useCallback(
        (action: Dab.EntityAction): Formatter<DabTreeRow> =>
            (_row, _cell, _value, _columnDef, item) => {
                if (!item || item.rowType !== "entity") {
                    return "";
                }

                return renderToggleButtonHtml({
                    state: item.entity.enabledActions.includes(action) ? "checked" : "unchecked",
                    label: locConstants.schemaDesigner.actionForEntity(
                        actionLabels[action],
                        item.entity.advancedSettings.entityName,
                    ),
                    disabled: !item.entity.isEnabled || !item.entity.isSupported,
                    extraClassName: "dab-grid-action-toggle",
                    dataAttributes: {
                        "dab-role": "action",
                        "dab-action": action,
                    },
                });
            },
        [actionLabels],
    );

    const settingsFormatter = useCallback<Formatter<DabTreeRow>>(
        (_row, _cell, _value, _columnDef, item) => {
            if (!item || item.rowType !== "entity") {
                return "";
            }

            return renderSettingsButtonHtml(
                locConstants.schemaDesigner.settingsForEntity(
                    item.entity.advancedSettings.entityName,
                ),
                !item.entity.isEnabled,
            );
        },
        [],
    );

    const columns = useMemo<Column<DabTreeRow>[]>(
        () => [
            {
                id: "checkbox",
                field: "id",
                name: "",
                sortable: false,
                resizable: false,
                focusable: true,
                minWidth: 68,
                maxWidth: 68,
                formatter: checkboxFormatter,
                excludeFromColumnPicker: true,
                excludeFromGridMenu: true,
                excludeFromHeaderMenu: true,
                headerCssClass: "dab-header-cell-empty",
            },
            {
                id: "entityName",
                field: "entityName",
                name: locConstants.schemaDesigner.entityName,
                sortable: true,
                minWidth: 260,
                formatter: treeFormatter,
            },
            {
                id: "source",
                field: "source",
                name: locConstants.schemaDesigner.sourceTable,
                sortable: true,
                minWidth: 220,
                formatter: sourceFormatter,
            },
            ...allActions.map((action) => ({
                id: action,
                field: "id" as const,
                name: createActionHeader(action),
                sortable: false,
                resizable: false,
                minWidth: 108,
                maxWidth: 108,
                formatter: createActionFormatter(action),
                excludeFromColumnPicker: true,
                excludeFromGridMenu: true,
                excludeFromHeaderMenu: true,
            })),
            {
                id: "settings",
                field: "id",
                name: "",
                sortable: false,
                resizable: false,
                minWidth: 54,
                maxWidth: 54,
                formatter: settingsFormatter,
                excludeFromColumnPicker: true,
                excludeFromGridMenu: true,
                excludeFromHeaderMenu: true,
                headerCssClass: "dab-header-cell-empty",
            },
        ],
        [
            allActions,
            checkboxFormatter,
            createActionFormatter,
            createActionHeader,
            settingsFormatter,
            sourceFormatter,
        ],
    );

    const gridOptions = useMemo<GridOption>(
        () => ({
            ...baseFluentReadOnlyGridOption,
            autoResize: createFluentAutoResizeOptions("#dab-entity-grid-container", {
                autoHeight: false,
                bottomPadding: 8,
                minHeight: 220,
            }),
            enableAutoResize: true,
            enableCellNavigation: true,
            enableExcelCopyBuffer: false,
            enableSorting: true,
            multiColumnSort: false,
            rowHeight: 32,
            enableTreeData: true,
            treeDataOptions: {
                columnId: "entityName",
                childrenPropName: "children",
                collapsedPropName: "__collapsed",
                hasChildrenPropName: "hasChildren",
                titleFormatter: renderTreeTitle,
                indentMarginLeft: 16,
            },
        }),
        [renderTreeTitle],
    );

    const handleGridClick = useCallback(
        (event: Event, args: { dataContext?: DabTreeRow }) => {
            const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
                "[data-dab-role]",
            );
            const item = args.dataContext;

            if (!target || !item) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            if (target.dataset.dabRole === "checkbox") {
                if (item.rowType === "schema") {
                    const supportedEntities = item.entities.filter((entity) => entity.isSupported);
                    const enabledCount = supportedEntities.filter(
                        (entity) => entity.isEnabled,
                    ).length;
                    const shouldEnable =
                        getToggleState(supportedEntities.length, enabledCount) !== "checked";

                    for (const entity of supportedEntities) {
                        toggleDabEntity(entity.id, shouldEnable);
                    }
                    return;
                }

                if (item.rowType === "entity") {
                    toggleDabEntity(item.entity.id, !item.entity.isEnabled);
                    return;
                }

                toggleDabColumnExposure(item.entity.id, item.column.id, !item.column.isExposed);
                return;
            }

            if (target.dataset.dabRole === "action" && item.rowType === "entity") {
                const action = target.dataset.dabAction as Dab.EntityAction | undefined;
                if (!action) {
                    return;
                }

                toggleDabEntityAction(
                    item.entity.id,
                    action,
                    !item.entity.enabledActions.includes(action),
                );
                return;
            }

            if (target.dataset.dabRole === "settings" && item.rowType === "entity") {
                setSettingsEntityId(item.entity.id);
            }
        },
        [toggleDabColumnExposure, toggleDabEntity, toggleDabEntityAction],
    );

    const handleTreeItemToggled = useCallback(
        (_event: CustomEvent, change: TreeToggleStateChange) => {
            if (!Array.isArray(change.toggledItems)) {
                return;
            }

            setCollapsedRows((previous) => {
                const next = new Map(previous);
                for (const toggledItem of change.toggledItems ?? []) {
                    next.set(String(toggledItem.itemId), toggledItem.isCollapsed);
                }
                return next;
            });
        },
        [],
    );

    if (filteredEntities.length === 0) {
        return (
            <div className="dab-entity-grid-empty-state">
                <Text>{locConstants.schemaDesigner.noEntitiesFound}</Text>
            </div>
        );
    }

    return (
        <>
            <div id="dab-entity-grid-container" className="dab-entity-grid-container">
                <FluentSlickGrid
                    gridId="dab-entity-grid"
                    columns={columns}
                    dataset={[]}
                    datasetHierarchical={treeRows}
                    options={gridOptions}
                    onClick={handleGridClick}
                    onTreeItemToggled={handleTreeItemToggled}
                />
            </div>

            {settingsEntity && (
                <DabEntitySettingsDialog
                    entity={settingsEntity}
                    open={!!settingsEntity}
                    onOpenChange={(open) => {
                        if (!open) {
                            setSettingsEntityId(null);
                        }
                    }}
                    onApply={(settings) => {
                        updateDabEntitySettings(settingsEntity.id, settings);
                        setSettingsEntityId(null);
                    }}
                />
            )}
        </>
    );
};
