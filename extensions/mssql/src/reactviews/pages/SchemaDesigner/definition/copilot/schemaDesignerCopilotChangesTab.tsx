/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Tooltip,
    makeStyles,
    mergeClasses,
} from "@fluentui/react-components";
import {
    AddRegular,
    ArrowUndo16Regular,
    Checkmark24Regular,
    CheckmarkCircle16Filled,
    DeleteRegular,
    EditRegular,
} from "@fluentui/react-icons";
import { useVirtualizer } from "@tanstack/react-virtual";
import { locConstants } from "../../../../common/locConstants";
import { SchemaDesignerDefinitionPanelTab } from "../schemaDesignerDefinitionPanelContext";
import { useCopilotChangesContext } from "./copilotChangesContext";
import { CopilotChange, CopilotOperation } from "./copilotLedger";
import { SchemaDesigner } from "../../../../../sharedInterfaces/schemaDesigner";
import { SchemaDesignerChangesEmptyState } from "../changes/schemaDesignerChangesEmptyState";
import { SchemaDesignerChangeDetailsPopover } from "../changes/schemaDesignerChangeDetailsPopover";
import { ChangeAction, ChangeCategory, PropertyChange, SchemaChange } from "../../diff/diffUtils";

type CopilotAction = "add" | "modify" | "delete";
type CopilotEntity = "table" | "column" | "foreignKey";
const CARD_WIDTH_PX = 200;
const CARD_GAP_PX = 16;
const LIST_PADDING_PX = 12;
const VIRTUAL_OVERSCAN = 4;

const useStyles = makeStyles({
    container: {
        height: "100%",
        width: "100%",
        minHeight: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--vscode-editor-background)",
    },
    list: {
        overflowY: "hidden",
        overflowX: "auto",
        minHeight: 0,
        height: "100%",
        padding: `${LIST_PADDING_PX}px`,
        position: "relative",
    },
    virtualTrack: {
        position: "relative",
        height: "100%",
        minHeight: "156px",
    },
    virtualCard: {
        position: "absolute",
        top: 0,
        left: 0,
        boxSizing: "border-box",
        paddingRight: `${CARD_GAP_PX}px`,
    },
    card: {
        border: "1px solid var(--vscode-editorWidget-border)",
        borderRadius: "8px",
        backgroundColor: "var(--vscode-editorWidget-background)",
        padding: "12px 14px",
        cursor: "pointer",
        outline: "none",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        minHeight: "140px",
        transition: "border-color 0.15s ease, box-shadow 0.15s ease",
        "&:hover": {
            border: "1px solid var(--vscode-focusBorder)",
        },
        width: "100%",
        boxSizing: "border-box",
    },
    cardActive: {
        border: "1px solid var(--vscode-focusBorder)",
        boxShadow: "0 0 0 1px var(--vscode-focusBorder) inset",
    },
    cardHeader: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        minWidth: 0,
    },
    cardIcon: {
        flexShrink: 0,
    },
    actionIconAdd: {
        color: "var(--vscode-charts-green)",
    },
    actionIconDelete: {
        color: "var(--vscode-charts-red)",
    },
    actionIconModify: {
        color: "var(--vscode-charts-yellow)",
    },
    actionText: {
        color: "var(--vscode-descriptionForeground)",
        fontSize: "11px",
        lineHeight: "14px",
        textTransform: "capitalize",
    },
    objectName: {
        color: "var(--vscode-foreground)",
        fontWeight: 600,
        fontSize: "13px",
        lineHeight: "16px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    properties: {
        color: "var(--vscode-descriptionForeground)",
        fontSize: "11px",
        lineHeight: "14px",
        width: "fit-content",
        maxWidth: "100%",
        borderRadius: "999px",
        padding: "2px 8px",
        border: "1px solid var(--vscode-gitDecoration-modifiedResourceForeground)",
        backgroundColor:
            "color-mix(in srgb, var(--vscode-gitDecoration-modifiedResourceForeground) 14%, transparent)",
        cursor: "pointer",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    propertiesBadgeButton: {
        width: "100%",
        height: "100%",
        padding: 0,
        borderRadius: "999px",
        border: "none",
        backgroundColor: "transparent",
        color: "inherit",
        minWidth: "unset",
        fontSize: "11px",
        lineHeight: "14px",
        justifyContent: "flex-start",
        "& .fui-ToolbarButton__icon": {
            display: "none",
        },
    },
    cardFooter: {
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "center",
        gap: "6px",
        marginTop: "auto",
    },
    actionButton: {
        minWidth: "26px",
        width: "26px",
        height: "26px",
        borderRadius: "999px",
        padding: 0,
    },
});

const getMeta = (
    operation: CopilotOperation,
): {
    action: CopilotAction;
    entity: CopilotEntity;
} => {
    switch (operation) {
        case CopilotOperation.AddTable:
            return { action: "add", entity: "table" };
        case CopilotOperation.DropTable:
            return { action: "delete", entity: "table" };
        case CopilotOperation.SetTable:
            return { action: "modify", entity: "table" };
        case CopilotOperation.AddColumn:
            return { action: "add", entity: "column" };
        case CopilotOperation.DropColumn:
            return { action: "delete", entity: "column" };
        case CopilotOperation.SetColumn:
            return { action: "modify", entity: "column" };
        case CopilotOperation.AddForeignKey:
            return { action: "add", entity: "foreignKey" };
        case CopilotOperation.DropForeignKey:
            return { action: "delete", entity: "foreignKey" };
        case CopilotOperation.SetForeignKey:
            return { action: "modify", entity: "foreignKey" };
    }
};

const formatObjectName = (change: CopilotChange): string => {
    const value = (change.after ?? change.before) as
        | SchemaDesigner.Table
        | SchemaDesigner.Column
        | SchemaDesigner.ForeignKey
        | undefined;
    if (!value) {
        return locConstants.schemaDesigner.copilotUnknown;
    }

    const { entity } = getMeta(change.operation);
    if (entity === "table") {
        const table = value as SchemaDesigner.Table;
        return `[${table.schema}].[${table.name}]`;
    }

    return value.name ?? locConstants.schemaDesigner.copilotUnknown;
};

const propertyLabel = (propertyName: string): string => {
    switch (propertyName) {
        case "onDeleteAction":
            return locConstants.schemaDesigner.copilotOnDelete;
        case "onUpdateAction":
            return locConstants.schemaDesigner.copilotOnUpdate;
        case "referencedTableId":
            return locConstants.schemaDesigner.copilotReferencedTable;
        case "referencedColumnIds":
            return locConstants.schemaDesigner.copilotReferencedColumns;
        case "foreignKeys":
            return locConstants.schemaDesigner.copilotForeignKeys;
        case "dataType":
            return locConstants.schemaDesigner.copilotDataType;
        case "isPrimaryKey":
            return locConstants.schemaDesigner.copilotPrimaryKey;
        case "allowNull":
            return locConstants.schemaDesigner.copilotAllowNull;
        default:
            return propertyName;
    }
};

const getPropertySummary = (change: CopilotChange): string | undefined => {
    const propertyChanges = getPropertyChanges(change);
    if (propertyChanges.length === 0) {
        return undefined;
    }

    if (propertyChanges.length === 1) {
        return propertyChanges[0].displayName;
    }
    return locConstants.schemaDesigner.copilotPropertySummaryMore(
        propertyChanges[0].displayName,
        propertyChanges.length - 1,
    );
};

const getPropertyChanges = (change: CopilotChange): PropertyChange[] => {
    const { action } = getMeta(change.operation);
    if (action !== "modify" || !change.before || !change.after) {
        return [];
    }

    const simpleKeysByEntity: Record<CopilotEntity, string[]> = {
        table: ["name", "schema"],
        column: [
            "name",
            "dataType",
            "allowNull",
            "isNullable",
            "isPrimaryKey",
            "defaultValue",
            "length",
            "precision",
            "scale",
            "isIdentity",
            "identitySeed",
            "identityIncrement",
            "isComputed",
            "computedFormula",
            "computedPersisted",
        ],
        foreignKey: ["name", "onDeleteAction", "onUpdateAction"],
    };

    const isSimpleValue = (value: unknown): boolean =>
        value === undefined ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean";

    const before = change.before as Record<string, unknown>;
    const after = change.after as Record<string, unknown>;
    const { entity } = getMeta(change.operation);
    const keys = simpleKeysByEntity[entity];

    return keys
        .filter((key) => isSimpleValue(before[key]) && isSimpleValue(after[key]))
        .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
        .map((property) => ({
            property,
            displayName: propertyLabel(property),
            oldValue: before[property],
            newValue: after[property],
        }));
};

const getChangeCategory = (change: CopilotChange): ChangeCategory => {
    const { entity } = getMeta(change.operation);
    if (entity === "table") {
        return ChangeCategory.Table;
    }
    if (entity === "column") {
        return ChangeCategory.Column;
    }
    return ChangeCategory.ForeignKey;
};

const toSchemaChange = (
    change: CopilotChange,
    propertyChanges: PropertyChange[],
): SchemaChange | undefined => {
    if (propertyChanges.length === 0) {
        return undefined;
    }

    const tableEntity =
        getMeta(change.operation).entity === "table" ? (change.after ?? change.before) : undefined;
    const table = tableEntity as SchemaDesigner.Table | undefined;
    const object = (change.after ?? change.before) as
        | SchemaDesigner.Column
        | SchemaDesigner.ForeignKey
        | undefined;

    return {
        id: `${change.operation}:${change.tableId ?? "unknown-table"}:${(object as { id?: string } | undefined)?.id ?? "unknown-object"}`,
        action: ChangeAction.Modify,
        category: getChangeCategory(change),
        tableId: change.tableId ?? table?.id ?? "unknown-table",
        tableName: table?.name ?? "",
        tableSchema: table?.schema ?? "",
        objectId: (object as { id?: string } | undefined)?.id,
        objectName: (object as { name?: string } | undefined)?.name,
        propertyChanges,
    };
};

const getActionText = (change: CopilotChange): string => {
    const meta = getMeta(change.operation);
    const actionText =
        meta.action === "add"
            ? locConstants.schemaDesigner.changesPanel.added
            : meta.action === "delete"
              ? locConstants.schemaDesigner.changesPanel.deleted
              : locConstants.schemaDesigner.changesPanel.modified;
    const entityText =
        meta.entity === "foreignKey"
            ? locConstants.schemaDesigner.changesPanel.foreignKeyCategory
            : meta.entity === "column"
              ? locConstants.schemaDesigner.changesPanel.columnCategory
              : locConstants.schemaDesigner.changesPanel.tableCategory;
    return `${actionText} ${entityText}`;
};

const getActionIcon = (change: CopilotChange) => {
    const { action } = getMeta(change.operation);
    if (action === "add") {
        return <AddRegular />;
    }
    if (action === "delete") {
        return <DeleteRegular />;
    }
    return <EditRegular />;
};

const getActionIconClass = (
    classes: ReturnType<typeof useStyles>,
    change: CopilotChange,
): string => {
    const { action } = getMeta(change.operation);
    if (action === "add") {
        return classes.actionIconAdd;
    }
    if (action === "delete") {
        return classes.actionIconDelete;
    }
    return classes.actionIconModify;
};

const SchemaDesignerCopilotChangesContent = () => {
    const classes = useStyles();
    const {
        trackedChanges,
        revealTrackedChange,
        acceptTrackedChange,
        undoTrackedChange,
        canUndoTrackedChange,
        reviewIndex,
        setReviewIndex,
    } = useCopilotChangesContext();
    const cardRefs = useRef<Array<HTMLDivElement | null>>([]);
    const listRef = useRef<HTMLDivElement>();
    const activeIndex = reviewIndex;
    const setActiveIndex = setReviewIndex;
    const [undoing, setUndoing] = useState<Record<number, boolean>>({});

    const orderedChanges = useMemo(
        () => trackedChanges.map((change, index) => ({ change, sourceIndex: index })),
        [trackedChanges],
    );
    const virtualizer = useVirtualizer({
        count: orderedChanges.length,
        horizontal: true,
        getScrollElement: () => listRef.current as HTMLDivElement | null,
        estimateSize: () => CARD_WIDTH_PX + CARD_GAP_PX,
        overscan: VIRTUAL_OVERSCAN,
    });
    const virtualItems = virtualizer.getVirtualItems();

    // Scroll the card list when the shared reviewIndex changes (e.g. via toolbar nav)
    useEffect(() => {
        if (activeIndex >= 0 && activeIndex < orderedChanges.length) {
            virtualizer.scrollToIndex(activeIndex, { align: "auto" });
            // Also reveal the corresponding table/FK in the diagram
            const item = orderedChanges[activeIndex];
            if (item) {
                revealTrackedChange(item.sourceIndex);
            }
        }
    }, [activeIndex, orderedChanges, revealTrackedChange, virtualizer]);

    const focusCard = useCallback(
        (index: number) => {
            const next = Math.max(0, Math.min(index, orderedChanges.length - 1));
            setActiveIndex(next);
            virtualizer.scrollToIndex(next, { align: "auto" });
            requestAnimationFrame(() => {
                cardRefs.current[next]?.focus();
            });
        },
        [orderedChanges.length, virtualizer],
    );

    const handleContainerKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLDivElement>) => {
            if (orderedChanges.length === 0) {
                return;
            }

            const target = event.target as HTMLElement;
            if (target.closest("button")) {
                return;
            }

            if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                const next = Math.min(activeIndex + 1, orderedChanges.length - 1);
                focusCard(next);
                return;
            }

            if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                const next = Math.max(activeIndex - 1, 0);
                focusCard(next);
                return;
            }

            if (event.key === "Home") {
                event.preventDefault();
                focusCard(0);
                return;
            }

            if (event.key === "End") {
                event.preventDefault();
                focusCard(orderedChanges.length - 1);
                return;
            }
        },
        [activeIndex, focusCard, orderedChanges.length],
    );

    const onUndo = useCallback(
        async (sourceIndex: number) => {
            setUndoing((current) => ({ ...current, [sourceIndex]: true }));
            try {
                await undoTrackedChange(sourceIndex);
            } finally {
                setUndoing((current) => ({ ...current, [sourceIndex]: false }));
            }
        },
        [undoTrackedChange],
    );

    if (trackedChanges.length === 0) {
        return (
            <SchemaDesignerChangesEmptyState
                icon={<Checkmark24Regular />}
                title={locConstants.schemaDesigner.noChangesYet}
                subtitle={locConstants.schemaDesigner.noChangesYetSubtitle}
            />
        );
    }

    return (
        <div className={classes.container} onKeyDown={handleContainerKeyDown}>
            <div
                className={classes.list}
                ref={(node) => {
                    listRef.current = node ?? undefined;
                }}>
                <div
                    className={classes.virtualTrack}
                    style={{ width: `${virtualizer.getTotalSize()}px` }}>
                    {virtualItems.map((virtualItem) => {
                        const displayIndex = virtualItem.index;
                        const item = orderedChanges[displayIndex];
                        if (!item) {
                            return undefined;
                        }
                        const { change, sourceIndex } = item;

                        const propertyChanges = getPropertyChanges(change);
                        const propertyChange = toSchemaChange(change, propertyChanges);
                        const propertySummary = getPropertySummary(change);
                        const isActive = displayIndex === activeIndex;
                        const canUndo = canUndoTrackedChange(sourceIndex) && !undoing[sourceIndex];

                        return (
                            <div
                                className={classes.virtualCard}
                                style={{
                                    width: `${CARD_WIDTH_PX + CARD_GAP_PX}px`,
                                    transform: `translateX(${virtualItem.start}px)`,
                                }}
                                key={`${change.groupId ?? "single"}:${sourceIndex}`}>
                                <div
                                    ref={(node) => {
                                        cardRefs.current[displayIndex] = node;
                                    }}
                                    role="button"
                                    tabIndex={isActive ? 0 : -1}
                                    className={mergeClasses(
                                        classes.card,
                                        isActive && classes.cardActive,
                                    )}
                                    onFocus={() => setActiveIndex(displayIndex)}
                                    onClick={() => {
                                        setActiveIndex(displayIndex);
                                        revealTrackedChange(sourceIndex);
                                    }}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") {
                                            event.preventDefault();
                                            revealTrackedChange(sourceIndex);
                                        }
                                    }}>
                                    <div className={classes.cardHeader}>
                                        <span
                                            className={mergeClasses(
                                                classes.cardIcon,
                                                getActionIconClass(classes, change),
                                            )}>
                                            {getActionIcon(change)}
                                        </span>
                                        <span className={classes.actionText}>
                                            {getActionText(change)}
                                        </span>
                                    </div>

                                    <div className={classes.objectName}>
                                        {formatObjectName(change)}
                                    </div>

                                    {propertySummary && propertyChange ? (
                                        <div
                                            className={classes.properties}
                                            onClick={(event) => event.stopPropagation()}>
                                            <SchemaDesignerChangeDetailsPopover
                                                change={propertyChange}
                                                title={formatObjectName(change)}
                                                badgeLetter={propertySummary}
                                                badgeClassName=""
                                                badgeButtonClassName={classes.propertiesBadgeButton}
                                            />
                                        </div>
                                    ) : undefined}

                                    <div className={classes.cardFooter}>
                                        <Tooltip
                                            content={locConstants.schemaDesigner.accept}
                                            relationship="label">
                                            <Button
                                                appearance="subtle"
                                                size="small"
                                                className={classes.actionButton}
                                                icon={<CheckmarkCircle16Filled />}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    acceptTrackedChange(sourceIndex);
                                                }}
                                            />
                                        </Tooltip>
                                        <Tooltip
                                            content={locConstants.schemaDesigner.undo}
                                            relationship="label">
                                            <Button
                                                appearance="subtle"
                                                size="small"
                                                className={classes.actionButton}
                                                icon={<ArrowUndo16Regular />}
                                                disabled={!canUndo}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    void onUndo(sourceIndex);
                                                }}
                                            />
                                        </Tooltip>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

const useStyles2 = makeStyles({
    headerActions: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
    },
});

const CopilotChangesHeaderActions: React.FC = () => {
    const { acceptAllTrackedChanges, undoAllTrackedChanges, isUndoingAll } =
        useCopilotChangesContext();
    const headerClasses = useStyles2();
    const [isUndoDialogOpen, setIsUndoDialogOpen] = useState(false);

    return (
        <>
            <div className={headerClasses.headerActions}>
                <Button
                    appearance="primary"
                    size="small"
                    disabled={isUndoingAll}
                    onClick={acceptAllTrackedChanges}>
                    {locConstants.schemaDesigner.acceptAll}
                </Button>
                <Button
                    appearance="secondary"
                    size="small"
                    disabled={isUndoingAll}
                    onClick={() => setIsUndoDialogOpen(true)}>
                    {locConstants.schemaDesigner.undoAll}
                </Button>
            </div>
            <Dialog
                open={isUndoDialogOpen}
                onOpenChange={(_event, data) => setIsUndoDialogOpen(data.open)}>
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>{locConstants.schemaDesigner.undoAllConfirmation}</DialogTitle>
                        <DialogContent>
                            {locConstants.schemaDesigner.undoAllConfirmationContent}
                        </DialogContent>
                        <DialogActions>
                            <Button
                                appearance="primary"
                                onClick={() => {
                                    setIsUndoDialogOpen(false);
                                    void undoAllTrackedChanges();
                                }}>
                                {locConstants.schemaDesigner.undoAll}
                            </Button>
                            <Button
                                appearance="secondary"
                                onClick={() => setIsUndoDialogOpen(false)}>
                                {locConstants.schemaDesigner.cancel}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
        </>
    );
};

export const useSchemaDesignerCopilotChangesCustomTab = () => {
    const { trackedChanges } = useCopilotChangesContext();
    const changeCount = trackedChanges.length;
    const hasChanges = changeCount > 0;

    return useMemo(
        () => ({
            id: SchemaDesignerDefinitionPanelTab.CopilotChanges,
            label: locConstants.schemaDesigner.copilotChangesPanelTitle(changeCount),
            headerActions: hasChanges ? <CopilotChangesHeaderActions /> : undefined,
            content: <SchemaDesignerCopilotChangesContent />,
        }),
        [changeCount, hasChanges],
    );
};
