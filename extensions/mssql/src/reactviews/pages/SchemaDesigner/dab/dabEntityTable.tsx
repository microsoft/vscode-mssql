/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Checkbox,
    DataGrid,
    DataGridBody,
    DataGridCell,
    DataGridHeader,
    DataGridHeaderCell,
    DataGridRow,
    TableColumnDefinition,
    TableColumnSizingOptions,
    createTableColumn,
    makeStyles,
    Text,
    tokens,
} from "@fluentui/react-components";
import {
    ChevronDown16Regular,
    ChevronRight16Regular,
    Settings16Regular,
} from "@fluentui/react-icons";
import { useCallback, useMemo, useState } from "react";
import { locConstants } from "../../../common/locConstants";
import { DabEntitySettingsDialog } from "./dabEntitySettingsDialog";
import { Dab } from "../../../../sharedInterfaces/dab";
import { useDabContext } from "./dabContext";

export type DabTableRow =
    | { type: "schema"; schemaName: string; entities: Dab.DabEntityConfig[] }
    | { type: "entity"; entity: Dab.DabEntityConfig };

const useStyles = makeStyles({
    grid: {
        width: "100%",
    },
    header: {
        position: "sticky",
        top: 0,
        zIndex: 2,
        backgroundColor: tokens.colorNeutralBackground1,
    },
    schemaRow: {
        backgroundColor: tokens.colorNeutralBackground3,
        cursor: "pointer",
    },
    schemaCell: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "8px 12px",
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
    rowNoHighlight: {
        ":hover": {
            backgroundColor: "transparent",
        },
        ":active": {
            backgroundColor: "transparent",
        },
    },
    entityCheckboxCell: {
        paddingLeft: "28px",
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
    emptyState: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "200px",
        color: tokens.colorNeutralForeground3,
    },
});

export const DabEntityTable = () => {
    const classes = useStyles();
    const context = useDabContext();

    const {
        dabConfig,
        toggleDabEntity,
        toggleDabEntityAction,
        updateDabEntitySettings,
        dabTextFilter,
    } = context;

    const [collapsedSchemas, setCollapsedSchemas] = useState<Set<string>>(new Set());
    const [settingsEntityId, setSettingsEntityId] = useState<string | null>(null);

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

    // Build flattened row list for DataGrid
    const tableRows = useMemo<DabTableRow[]>(() => {
        const rows: DabTableRow[] = [];
        for (const [schemaName, entities] of entitiesBySchema) {
            rows.push({ type: "schema", schemaName, entities });
            if (!collapsedSchemas.has(schemaName)) {
                for (const entity of entities) {
                    rows.push({ type: "entity", entity });
                }
            }
        }
        return rows;
    }, [entitiesBySchema, collapsedSchemas]);

    // Look up settings entity from config to stay fresh
    const settingsEntity = useMemo(() => {
        if (!settingsEntityId || !dabConfig) {
            return null;
        }
        return dabConfig.entities.find((e) => e.id === settingsEntityId) ?? null;
    }, [settingsEntityId, dabConfig]);

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

    const columnSizingOptions = useMemo<TableColumnSizingOptions>(
        () => ({
            checkbox: { minWidth: 68, defaultWidth: 68 },
            entityName: { minWidth: 150, defaultWidth: 280 },
            source: { minWidth: 150, defaultWidth: 380 },
            create: { minWidth: 80, defaultWidth: 90 },
            read: { minWidth: 80, defaultWidth: 90 },
            update: { minWidth: 80, defaultWidth: 90 },
            delete: { minWidth: 80, defaultWidth: 90 },
            settings: { minWidth: 40, defaultWidth: 50 },
        }),
        [],
    );

    const renderActionHeaderCell = useCallback(
        (action: Dab.EntityAction) => {
            const enabledEntities = filteredEntities.filter((e) => e.isEnabled);
            const withAction = enabledEntities.filter((e) => e.enabledActions.includes(action));
            const allHave =
                enabledEntities.length > 0 && withAction.length === enabledEntities.length;
            const noneHave = withAction.length === 0;
            return (
                <Checkbox
                    checked={allHave ? true : noneHave ? false : "mixed"}
                    label={actionLabels[action]}
                    aria-label={locConstants.schemaDesigner.selectAllAction(actionLabels[action])}
                    onChange={(_, data) => {
                        const enable = data.checked === true || data.checked === "mixed";
                        for (const entity of enabledEntities) {
                            toggleDabEntityAction(entity.id, action, enable);
                        }
                    }}
                />
            );
        },
        [filteredEntities, actionLabels, toggleDabEntityAction],
    );

    const renderActionCell = useCallback(
        (entity: Dab.DabEntityConfig, action: Dab.EntityAction) => {
            return (
                <Checkbox
                    checked={entity.enabledActions.includes(action)}
                    disabled={!entity.isEnabled}
                    aria-label={locConstants.schemaDesigner.actionForEntity(
                        actionLabels[action],
                        entity.advancedSettings.entityName,
                    )}
                    onChange={(_, data) =>
                        toggleDabEntityAction(entity.id, action, data.checked === true)
                    }
                />
            );
        },
        [actionLabels, toggleDabEntityAction],
    );

    const renderSchemaRow = useCallback(
        (rowId: string | number, schemaName: string, entities: Dab.DabEntityConfig[]) => {
            const enabledCount = entities.filter((e) => e.isEnabled).length;
            const allChecked = enabledCount === entities.length;
            const noneChecked = enabledCount === 0;
            const isCollapsed = collapsedSchemas.has(schemaName);
            return (
                <DataGridRow
                    key={rowId}
                    className={`${classes.schemaRow} ${classes.rowNoHighlight}`}
                    onClick={() => toggleSchemaCollapsed(schemaName)}>
                    {({ columnId }) => {
                        if (columnId !== "checkbox") {
                            return <DataGridCell style={{ display: "none" }} />;
                        }
                        return (
                            <DataGridCell
                                className={classes.schemaCell}
                                style={{ flex: "1 1 100%", maxWidth: "none" }}>
                                {isCollapsed ? <ChevronRight16Regular /> : <ChevronDown16Regular />}
                                <Checkbox
                                    checked={allChecked ? true : noneChecked ? false : "mixed"}
                                    aria-label={locConstants.schemaDesigner.toggleAllEntitiesInSchema(
                                        schemaName,
                                    )}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(_, data) => {
                                        const enable =
                                            data.checked === true || data.checked === "mixed";
                                        for (const entity of entities) {
                                            toggleDabEntity(entity.id, enable);
                                        }
                                    }}
                                />
                                <Text className={classes.schemaLabel}>{schemaName}</Text>
                                <Text className={classes.schemaCount}>
                                    {enabledCount}/{entities.length}
                                </Text>
                                <div className={classes.schemaDivider} />
                            </DataGridCell>
                        );
                    }}
                </DataGridRow>
            );
        },
        [classes, collapsedSchemas, toggleSchemaCollapsed, toggleDabEntity],
    );

    const columns = useMemo<TableColumnDefinition<DabTableRow>[]>(
        () => [
            createTableColumn<DabTableRow>({
                columnId: "checkbox",
                renderHeaderCell: () => null,
                renderCell: (item) => {
                    if (item.type !== "entity") {
                        return null;
                    }
                    return (
                        <div className={classes.entityCheckboxCell}>
                            <Checkbox
                                checked={item.entity.isEnabled}
                                aria-label={locConstants.schemaDesigner.enableEntity(
                                    item.entity.advancedSettings.entityName,
                                )}
                                onChange={(_, data) =>
                                    toggleDabEntity(item.entity.id, data.checked === true)
                                }
                            />
                        </div>
                    );
                },
            }),
            createTableColumn<DabTableRow>({
                columnId: "entityName",
                renderHeaderCell: () => locConstants.schemaDesigner.entityName,
                renderCell: (item) => {
                    if (item.type !== "entity") {
                        return null;
                    }
                    const disabledClass = !item.entity.isEnabled ? classes.entityCellDisabled : "";
                    return (
                        <div className={disabledClass}>
                            <Text className={classes.entityName}>
                                {item.entity.advancedSettings.entityName}
                            </Text>
                        </div>
                    );
                },
            }),
            createTableColumn<DabTableRow>({
                columnId: "source",
                renderHeaderCell: () => locConstants.schemaDesigner.sourceTable,
                renderCell: (item) => {
                    if (item.type !== "entity") {
                        return null;
                    }
                    const disabledClass = !item.entity.isEnabled ? classes.entityCellDisabled : "";
                    return (
                        <div className={disabledClass}>
                            <Text className={classes.sourceText}>
                                {item.entity.schemaName}.{item.entity.tableName}
                            </Text>
                        </div>
                    );
                },
            }),
            ...allActions.map((action) =>
                createTableColumn<DabTableRow>({
                    columnId: action,
                    renderHeaderCell: () => renderActionHeaderCell(action),
                    renderCell: (item) => {
                        if (item.type !== "entity") {
                            return null;
                        }
                        const disabledClass = !item.entity.isEnabled
                            ? classes.entityCellDisabled
                            : "";
                        return (
                            <div className={disabledClass}>
                                {renderActionCell(item.entity, action)}
                            </div>
                        );
                    },
                }),
            ),
            createTableColumn<DabTableRow>({
                columnId: "settings",
                renderHeaderCell: () => null,
                renderCell: (item) => {
                    if (item.type !== "entity") {
                        return null;
                    }
                    return (
                        <Button
                            appearance="subtle"
                            icon={<Settings16Regular />}
                            size="small"
                            className={classes.settingsButton}
                            disabled={!item.entity.isEnabled}
                            onClick={() => setSettingsEntityId(item.entity.id)}
                            title={locConstants.schemaDesigner.settingsForEntity(
                                item.entity.advancedSettings.entityName,
                            )}
                            aria-label={locConstants.schemaDesigner.settingsForEntity(
                                item.entity.advancedSettings.entityName,
                            )}
                        />
                    );
                },
            }),
        ],
        [
            classes,
            allActions,
            toggleDabEntity,
            renderActionHeaderCell,
            renderActionCell,
            setSettingsEntityId,
        ],
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
            <DataGrid
                className={classes.grid}
                items={tableRows}
                columns={columns}
                columnSizingOptions={columnSizingOptions}
                resizableColumns
                focusMode="composite"
                size="small"
                getRowId={(item) =>
                    item.type === "schema" ? `schema-${item.schemaName}` : item.entity.id
                }>
                <DataGridHeader className={classes.header}>
                    <DataGridRow>
                        {({ renderHeaderCell }) => (
                            <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>
                        )}
                    </DataGridRow>
                </DataGridHeader>
                <DataGridBody<DabTableRow>>
                    {({ item, rowId }) => {
                        if (item.type === "schema") {
                            return renderSchemaRow(rowId, item.schemaName, item.entities);
                        }
                        return (
                            <DataGridRow key={rowId} className={classes.rowNoHighlight}>
                                {({ renderCell }) => (
                                    <DataGridCell>{renderCell(item)}</DataGridCell>
                                )}
                            </DataGridRow>
                        );
                    }}
                </DataGridBody>
            </DataGrid>

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
