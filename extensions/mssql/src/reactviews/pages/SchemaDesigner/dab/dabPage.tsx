/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Checkbox, makeStyles, Spinner, Text, tokens } from "@fluentui/react-components";
import {
    ChevronDown16Regular,
    ChevronRight16Regular,
    Settings16Regular,
} from "@fluentui/react-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { locConstants } from "../../../common/locConstants";
import { DabToolbar } from "./dabToolbar";
import { DabDefinitionsPanel } from "./dabDefinitionsPanel";
import { DabDeploymentDialog } from "./deployment/dabDeploymentDialog";
import { DabEntitySettingsDialog } from "./dabEntitySettingsDialog";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { Dab } from "../../../../sharedInterfaces/dab";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useDabContext } from "./dabContext";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        overflow: "hidden",
    },
    content: {
        flex: 1,
        overflow: "auto",
        padding: "0 15px 15px",
    },
    entityTable: {
        display: "grid",
        gridTemplateColumns: "68px minmax(120px, 2fr) minmax(120px, 3fr) auto auto auto auto 40px",
        alignItems: "center",
        width: "100%",
    },
    headerRow: {
        gridColumn: "1 / -1",
        display: "grid",
        gridTemplateColumns: "subgrid",
        alignItems: "center",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        position: "sticky" as const,
        top: 0,
        backgroundColor: tokens.colorNeutralBackground1,
        zIndex: 2,
    },
    headerCell: {
        padding: "6px 12px",
        fontSize: "12px",
        fontWeight: 600,
        color: tokens.colorNeutralForeground3,
    },
    headerCellCenter: {
        padding: "6px 12px",
        fontSize: "12px",
        fontWeight: 600,
        color: tokens.colorNeutralForeground3,
        textAlign: "center" as const,
    },
    schemaRow: {
        gridColumn: "1 / -1",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "8px 12px",
        backgroundColor: tokens.colorNeutralBackground3,
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        cursor: "pointer",
    },
    schemaLabel: {
        fontSize: "14px",
        fontWeight: 600,
        color: tokens.colorNeutralForeground1,
    },
    schemaCount: {
        fontSize: "11px",
        color: tokens.colorNeutralForeground3,
        backgroundColor: tokens.colorNeutralBackground1,
        padding: "1px 6px",
        borderRadius: "10px",
    },
    schemaDivider: {
        flex: 1,
    },
    entityRow: {
        gridColumn: "1 / -1",
        display: "grid",
        gridTemplateColumns: "subgrid",
        alignItems: "center",
        borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    },
    entityCell: {
        padding: "6px 12px",
    },
    entityCheckboxCell: {
        padding: "6px 12px 6px 36px",
    },
    entityCellCenter: {
        padding: "6px 12px",
        display: "flex",
        justifyContent: "center",
    },
    entityCellDisabled: {
        opacity: 0.6,
    },
    entityName: {
        fontWeight: 600,
        fontSize: "13px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    sourceText: {
        fontSize: "12px",
        color: tokens.colorNeutralForeground3,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    settingsButton: {
        minWidth: "auto",
    },
    loadingContainer: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        gap: "12px",
    },
    emptyState: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "200px",
        color: tokens.colorNeutralForeground3,
    },
    resizeHandle: {
        height: "2px",
        backgroundColor: "var(--vscode-editorWidget-border)",
    },
});

interface DabPageProps {
    activeView?: SchemaDesigner.SchemaDesignerActiveView;
}

export const DabPage = ({ activeView }: DabPageProps) => {
    const classes = useStyles();
    const context = useDabContext();

    const {
        dabConfig,
        initializeDabConfig,
        syncDabConfigWithSchema,
        isInitialized,
        toggleDabEntity,
        toggleDabEntityAction,
        updateDabEntitySettings,
        dabTextFilter,
    } = context;

    const [collapsedSchemas, setCollapsedSchemas] = useState<Set<string>>(new Set());
    const [settingsEntityId, setSettingsEntityId] = useState<string | null>(null);

    const handleGridKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (
            e.key !== "ArrowUp" &&
            e.key !== "ArrowDown" &&
            e.key !== "ArrowLeft" &&
            e.key !== "ArrowRight"
        ) {
            return;
        }

        const target = e.target as HTMLElement;
        const cell = target.closest("[data-grid-row]") as HTMLElement;
        if (!cell) {
            return;
        }

        const row = parseInt(cell.dataset.gridRow!);
        const col = parseInt(cell.dataset.gridCol!);
        let nextRow = row;
        let nextCol = col;

        switch (e.key) {
            case "ArrowUp":
                nextRow--;
                break;
            case "ArrowDown":
                nextRow++;
                break;
            case "ArrowLeft":
                nextCol--;
                break;
            case "ArrowRight":
                nextCol++;
                break;
        }

        e.preventDefault();
        const grid = e.currentTarget as HTMLElement;

        let nextCell: HTMLElement | null = null;
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            const delta = e.key === "ArrowDown" ? 1 : -1;
            for (let r = nextRow; r >= 0; r += delta) {
                nextCell = grid.querySelector(`[data-grid-row="${r}"][data-grid-col="${nextCol}"]`);
                if (nextCell) {
                    break;
                }
            }
        } else {
            nextCell = grid.querySelector(
                `[data-grid-row="${nextRow}"][data-grid-col="${nextCol}"]`,
            );
        }

        if (nextCell) {
            const focusable = nextCell.querySelector("input, button") as HTMLElement;
            if (focusable) {
                focusable.focus();
            }
        }
    }, []);

    const toggleSchemaCollapsed = useCallback((schemaName: string) => {
        setCollapsedSchemas((prev) => {
            const next = new Set(prev);
            if (next.has(schemaName)) {
                next.delete(schemaName);
            } else {
                next.add(schemaName);
            }
            return next;
        });
    }, []);

    // Initialize DAB config when schema is first initialized
    useEffect(() => {
        if (isInitialized && !dabConfig) {
            initializeDabConfig();
        }
    }, [isInitialized, dabConfig, initializeDabConfig]);

    // Sync DAB config with schema when switching to DAB tab
    useEffect(() => {
        const isDabTabActive = activeView === SchemaDesigner.SchemaDesignerActiveView.Dab;

        if (isInitialized && isDabTabActive && dabConfig) {
            // Incremental sync: add new tables, remove deleted ones, keep existing settings
            syncDabConfigWithSchema();
        }
    }, [activeView]);

    // Filter entities based on text filter
    const filteredEntities = useMemo(() => {
        if (!dabConfig) {
            return [];
        }
        if (!dabTextFilter.trim()) {
            return dabConfig.entities;
        }
        const lower = dabTextFilter.toLowerCase().trim();
        return dabConfig.entities.filter((e) => {
            const entityName = e.advancedSettings.entityName.toLowerCase();
            const schemaName = e.schemaName.toLowerCase();
            const source = `${e.schemaName}.${e.tableName}`.toLowerCase();
            return (
                entityName.includes(lower) || schemaName.includes(lower) || source.includes(lower)
            );
        });
    }, [dabConfig, dabTextFilter]);

    // Group filtered entities by schema
    const entitiesBySchema = useMemo(() => {
        const groups: Record<string, typeof filteredEntities> = {};
        for (const entity of filteredEntities) {
            if (!groups[entity.schemaName]) {
                groups[entity.schemaName] = [];
            }
            groups[entity.schemaName].push(entity);
        }
        return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
    }, [filteredEntities]);

    // Look up settings entity from config to stay fresh
    const settingsEntity = useMemo(() => {
        if (!settingsEntityId || !dabConfig) {
            return null;
        }
        return dabConfig.entities.find((e) => e.id === settingsEntityId) ?? null;
    }, [settingsEntityId, dabConfig]);

    // Show loading state while schema is being initialized
    if (!isInitialized) {
        return (
            <div className={classes.root}>
                <div className={classes.loadingContainer}>
                    <Spinner size="medium" />
                    <Text>{locConstants.schemaDesigner.loading}</Text>
                </div>
            </div>
        );
    }

    // Show loading state while DAB config is being initialized
    if (!dabConfig) {
        return (
            <div className={classes.root}>
                <div className={classes.loadingContainer}>
                    <Spinner size="medium" />
                    <Text>{locConstants.schemaDesigner.initializingDabConfig}</Text>
                </div>
            </div>
        );
    }

    const allActions = [
        Dab.EntityAction.Create,
        Dab.EntityAction.Read,
        Dab.EntityAction.Update,
        Dab.EntityAction.Delete,
    ];

    const actionLabels: Record<Dab.EntityAction, string> = {
        [Dab.EntityAction.Create]: locConstants.schemaDesigner.create,
        [Dab.EntityAction.Read]: locConstants.schemaDesigner.read,
        [Dab.EntityAction.Update]: locConstants.schemaDesigner.update,
        [Dab.EntityAction.Delete]: locConstants.common.delete,
    };

    let gridRowIndex = 0;

    return (
        <div className={classes.root}>
            <DabDeploymentDialog />
            <PanelGroup direction="vertical">
                <Panel defaultSize={100}>
                    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
                        <DabToolbar />
                        <div className={classes.content}>
                            {filteredEntities.length === 0 ? (
                                <div className={classes.emptyState}>
                                    <Text>{locConstants.schemaDesigner.noEntitiesFound}</Text>
                                </div>
                            ) : (
                                <div
                                    className={classes.entityTable}
                                    role="grid"
                                    onKeyDown={handleGridKeyDown}>
                                    {/* Column Headers */}
                                    <div className={classes.headerRow} role="row">
                                        <div role="columnheader" />
                                        <div className={classes.headerCell} role="columnheader">
                                            {locConstants.schemaDesigner.entityName}
                                        </div>
                                        <div className={classes.headerCell} role="columnheader">
                                            {locConstants.schemaDesigner.sourceTable}
                                        </div>
                                        {allActions.map((action, actionIndex) => {
                                            const enabledEntities = filteredEntities.filter(
                                                (e) => e.isEnabled,
                                            );
                                            const withAction = enabledEntities.filter((e) =>
                                                e.enabledActions.includes(action),
                                            );
                                            const allHave =
                                                enabledEntities.length > 0 &&
                                                withAction.length === enabledEntities.length;
                                            const noneHave = withAction.length === 0;
                                            return (
                                                <div
                                                    key={action}
                                                    className={classes.headerCellCenter}
                                                    role="columnheader"
                                                    data-grid-row={0}
                                                    data-grid-col={actionIndex + 1}>
                                                    <Checkbox
                                                        checked={
                                                            allHave
                                                                ? true
                                                                : noneHave
                                                                  ? false
                                                                  : "mixed"
                                                        }
                                                        label={actionLabels[action]}
                                                        onChange={(_, data) => {
                                                            const enable =
                                                                data.checked === true ||
                                                                data.checked === "mixed";
                                                            for (const entity of enabledEntities) {
                                                                toggleDabEntityAction(
                                                                    entity.id,
                                                                    action,
                                                                    enable,
                                                                );
                                                            }
                                                        }}
                                                    />
                                                </div>
                                            );
                                        })}
                                        <div role="columnheader" />
                                    </div>

                                    {/* Schema groups with entity rows */}
                                    {entitiesBySchema.map(([schemaName, entities]) => {
                                        const enabledCount = entities.filter(
                                            (e) => e.isEnabled,
                                        ).length;
                                        const allChecked = enabledCount === entities.length;
                                        const noneChecked = enabledCount === 0;
                                        const isCollapsed = collapsedSchemas.has(schemaName);

                                        return (
                                            <>
                                                {/* Schema separator row */}
                                                <div
                                                    key={`schema-${schemaName}`}
                                                    className={classes.schemaRow}
                                                    role="row"
                                                    data-grid-row={++gridRowIndex}
                                                    data-grid-col={0}
                                                    onClick={() =>
                                                        toggleSchemaCollapsed(schemaName)
                                                    }>
                                                    {isCollapsed ? (
                                                        <ChevronRight16Regular />
                                                    ) : (
                                                        <ChevronDown16Regular />
                                                    )}
                                                    <Checkbox
                                                        checked={
                                                            allChecked
                                                                ? true
                                                                : noneChecked
                                                                  ? false
                                                                  : "mixed"
                                                        }
                                                        onClick={(e) => e.stopPropagation()}
                                                        onChange={(_, data) => {
                                                            const enable =
                                                                data.checked === true ||
                                                                data.checked === "mixed";
                                                            for (const entity of entities) {
                                                                toggleDabEntity(entity.id, enable);
                                                            }
                                                        }}
                                                    />
                                                    <Text className={classes.schemaLabel}>
                                                        {schemaName}
                                                    </Text>
                                                    <Text className={classes.schemaCount}>
                                                        {enabledCount}/{entities.length}
                                                    </Text>
                                                    <div className={classes.schemaDivider} />
                                                </div>

                                                {/* Entity rows (hidden when collapsed) */}
                                                {!isCollapsed &&
                                                    entities.map((entity) => {
                                                        const disabledClass = !entity.isEnabled
                                                            ? classes.entityCellDisabled
                                                            : "";
                                                        const rowIdx = ++gridRowIndex;
                                                        return (
                                                            <div
                                                                key={entity.id}
                                                                className={classes.entityRow}
                                                                role="row">
                                                                <div
                                                                    className={
                                                                        classes.entityCheckboxCell
                                                                    }
                                                                    role="gridcell"
                                                                    data-grid-row={rowIdx}
                                                                    data-grid-col={0}>
                                                                    <Checkbox
                                                                        checked={entity.isEnabled}
                                                                        onChange={(_, data) =>
                                                                            toggleDabEntity(
                                                                                entity.id,
                                                                                data.checked ===
                                                                                    true,
                                                                            )
                                                                        }
                                                                    />
                                                                </div>
                                                                <div
                                                                    role="gridcell"
                                                                    className={`${classes.entityCell} ${disabledClass}`}>
                                                                    <Text
                                                                        className={
                                                                            classes.entityName
                                                                        }>
                                                                        {
                                                                            entity.advancedSettings
                                                                                .entityName
                                                                        }
                                                                    </Text>
                                                                </div>
                                                                <div
                                                                    role="gridcell"
                                                                    className={`${classes.entityCell} ${disabledClass}`}>
                                                                    <Text
                                                                        className={
                                                                            classes.sourceText
                                                                        }>
                                                                        {entity.schemaName}.
                                                                        {entity.tableName}
                                                                    </Text>
                                                                </div>
                                                                {allActions.map(
                                                                    (action, actionIndex) => (
                                                                        <div
                                                                            key={action}
                                                                            role="gridcell"
                                                                            data-grid-row={rowIdx}
                                                                            data-grid-col={
                                                                                actionIndex + 1
                                                                            }
                                                                            className={`${classes.entityCellCenter} ${disabledClass}`}>
                                                                            <Checkbox
                                                                                checked={entity.enabledActions.includes(
                                                                                    action,
                                                                                )}
                                                                                disabled={
                                                                                    !entity.isEnabled
                                                                                }
                                                                                onChange={(
                                                                                    _,
                                                                                    data,
                                                                                ) =>
                                                                                    toggleDabEntityAction(
                                                                                        entity.id,
                                                                                        action,
                                                                                        data.checked ===
                                                                                            true,
                                                                                    )
                                                                                }
                                                                            />
                                                                        </div>
                                                                    ),
                                                                )}
                                                                <div
                                                                    className={classes.entityCell}
                                                                    role="gridcell"
                                                                    data-grid-row={rowIdx}
                                                                    data-grid-col={5}>
                                                                    <Button
                                                                        appearance="subtle"
                                                                        icon={<Settings16Regular />}
                                                                        size="small"
                                                                        className={
                                                                            classes.settingsButton
                                                                        }
                                                                        disabled={!entity.isEnabled}
                                                                        onClick={() =>
                                                                            setSettingsEntityId(
                                                                                entity.id,
                                                                            )
                                                                        }
                                                                        title={
                                                                            locConstants
                                                                                .schemaCompare
                                                                                .settings
                                                                        }
                                                                    />
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                            </>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </Panel>
                <PanelResizeHandle className={classes.resizeHandle} />
                <DabDefinitionsPanel />
            </PanelGroup>

            {/* Single settings dialog instance */}
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
        </div>
    );
};
