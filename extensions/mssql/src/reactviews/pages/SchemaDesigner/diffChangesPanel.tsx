/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useMemo, useState } from "react";
import { Button, Text, Tooltip } from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { SchemaDesignerContext } from "./schemaDesignerStateProvider";
import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";
import * as l10n from "@vscode/l10n";
import eventBus from "./schemaDesignerEvents";

// Localized strings
const LOC = {
    panelTitle: l10n.t("Schema Changes"),
    noChanges: l10n.t("No changes detected"),
    undoChange: l10n.t("Undo this change"),
    tableAdded: l10n.t("Table added"),
    tableDeleted: l10n.t("Table deleted"),
    tableModified: l10n.t("Table modified"),
    columnAdded: l10n.t("Column added"),
    columnDeleted: l10n.t("Column deleted"),
    columnModified: l10n.t("Column modified"),
    fkAdded: l10n.t("Foreign key added"),
    fkDeleted: l10n.t("Foreign key deleted"),
    fkModified: l10n.t("Foreign key modified"),
    tablesLabel: l10n.t("Tables"),
    columnsLabel: l10n.t("Columns"),
    fksLabel: l10n.t("Foreign Keys"),
};

/**
 * Badge component for showing change type
 */
const ChangeBadge = ({ status }: { status: SchemaDesigner.DiffStatus }) => {
    let badgeClass = "";
    let icon: React.ReactNode = undefined;

    switch (status) {
        case SchemaDesigner.DiffStatus.Added:
            badgeClass = "diff-badge diff-badge-added";
            icon = <FluentIcons.AddCircleRegular fontSize={12} />;
            break;
        case SchemaDesigner.DiffStatus.Modified:
            badgeClass = "diff-badge diff-badge-modified";
            icon = <FluentIcons.EditRegular fontSize={12} />;
            break;
        case SchemaDesigner.DiffStatus.Deleted:
            badgeClass = "diff-badge diff-badge-deleted";
            icon = <FluentIcons.DeleteRegular fontSize={12} />;
            break;
        default:
            return undefined;
    }

    return <span className={badgeClass}>{icon}</span>;
};

/**
 * Single change entry item component
 */
const ChangeItem = ({
    entry,
    onUndo,
    onNavigate,
}: {
    entry: SchemaDesigner.ChangeEntry;
    onUndo: () => void;
    onNavigate: () => void;
}) => {
    return (
        <div className="diff-change-item">
            <div className="diff-change-item-header">
                <ChangeBadge status={entry.changeType} />
                <Tooltip content={entry.label} relationship="label">
                    <Text
                        className="diff-change-item-label"
                        onClick={onNavigate}
                        style={{ cursor: "pointer" }}>
                        {entry.label}
                    </Text>
                </Tooltip>
                <Tooltip content={LOC.undoChange} relationship="label">
                    <Button
                        appearance="subtle"
                        size="small"
                        icon={<FluentIcons.ArrowUndoRegular />}
                        onClick={onUndo}
                    />
                </Tooltip>
            </div>
            <Text className="diff-change-item-description">{entry.description}</Text>

            {/* Show property changes for modified items */}
            {entry.propertyChanges && entry.propertyChanges.length > 0 && (
                <div style={{ marginTop: "4px" }}>
                    {entry.propertyChanges.slice(0, 3).map((change, idx) => (
                        <div key={idx} className="diff-property-change">
                            <span className="diff-property-change-name">{change.propertyName}</span>
                            : {formatValue(change.originalValue)} → {formatValue(change.newValue)}
                        </div>
                    ))}
                    {entry.propertyChanges.length > 3 && (
                        <Text size={200} style={{ color: "var(--vscode-descriptionForeground)" }}>
                            +{entry.propertyChanges.length - 3} more changes
                        </Text>
                    )}
                </div>
            )}
        </div>
    );
};

/**
 * Format a value for display
 */
const formatValue = (value: unknown): string => {
    if (value === undefined) return "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "string") return value || '""';
    if (typeof value === "number") return String(value);
    return JSON.stringify(value);
};

/**
 * Collapsible section component for grouping changes
 */
const CollapsibleSection = ({
    title,
    count,
    children,
    defaultExpanded = true,
}: {
    title: string;
    count: number;
    children: React.ReactNode;
    defaultExpanded?: boolean;
}) => {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);

    if (count === 0) return undefined;

    return (
        <div className="diff-collapsible-section">
            <button
                className="diff-collapsible-header"
                onClick={() => setIsExpanded(!isExpanded)}
                aria-expanded={isExpanded}>
                {isExpanded ? (
                    <FluentIcons.ChevronDownRegular fontSize={12} />
                ) : (
                    <FluentIcons.ChevronRightRegular fontSize={12} />
                )}
                <Text size={200} weight="semibold">
                    {title}
                </Text>
                <span className="diff-section-count">{count}</span>
            </button>
            {isExpanded && <div className="diff-collapsible-content">{children}</div>}
        </div>
    );
};

/**
 * Main DiffChangesPanel component
 */
export const DiffChangesPanel = () => {
    const context = useContext(SchemaDesignerContext);
    const [refreshVersion, setRefreshVersion] = useState(0);

    useEffect(() => {
        const handler = () => setRefreshVersion((v) => v + 1);
        eventBus.on("getScript", handler);
        return () => {
            eventBus.off("getScript", handler);
        };
    }, []);

    // Get change entries
    const changeEntries = useMemo(() => {
        return context.getChangeEntries();
    }, [
        context.isDiffViewEnabled,
        context.originalSchema,
        context.schemaChangeVersion,
        refreshVersion,
    ]);

    // Don't render if diff view is not enabled
    if (!context.isDiffViewEnabled) {
        return undefined;
    }

    // Handle undo for a change entry
    const handleUndo = (entry: SchemaDesigner.ChangeEntry) => {
        switch (entry.entityType) {
            case "table":
                context.revertTableChange(entry.tableId, entry.changeType);
                break;
            case "column":
                if (entry.columnId) {
                    context.revertColumnChange(entry.tableId, entry.columnId, entry.changeType);
                }
                break;
            case "foreignKey":
                if (entry.foreignKeyId) {
                    context.revertForeignKeyChange(
                        entry.tableId,
                        entry.foreignKeyId,
                        entry.changeType,
                    );
                }
                break;
        }
    };

    // Navigate to the changed element
    const handleNavigate = (entry: SchemaDesigner.ChangeEntry) => {
        context.setCenter(entry.tableId, true);
    };

    // Group entries by type
    const tableEntries = changeEntries.filter((e) => e.entityType === "table");
    const columnEntries = changeEntries.filter((e) => e.entityType === "column");
    const fkEntries = changeEntries.filter((e) => e.entityType === "foreignKey");

    return (
        <div className="diff-changes-panel">
            {/* Header */}
            <div className="diff-changes-panel-header">
                <Text className="diff-changes-panel-title">
                    <FluentIcons.DocumentBulletListRegular
                        style={{ marginRight: "8px", verticalAlign: "middle" }}
                    />
                    {LOC.panelTitle}
                </Text>
                <Button
                    appearance="subtle"
                    size="small"
                    icon={<FluentIcons.DismissRegular />}
                    onClick={() => context.setDiffViewEnabled(false)}
                />
            </div>

            {/* Content */}
            <div className="diff-changes-panel-content">
                {changeEntries.length === 0 ? (
                    <div
                        style={{
                            padding: "20px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "8px",
                            color: "var(--vscode-descriptionForeground)",
                        }}>
                        <FluentIcons.CheckmarkCircleRegular fontSize={20} />
                        <Text>{LOC.noChanges}</Text>
                    </div>
                ) : (
                    <>
                        {/* Table changes */}
                        <CollapsibleSection title={LOC.tablesLabel} count={tableEntries.length}>
                            {tableEntries.map((entry) => (
                                <ChangeItem
                                    key={entry.id}
                                    entry={entry}
                                    onUndo={() => handleUndo(entry)}
                                    onNavigate={() => handleNavigate(entry)}
                                />
                            ))}
                        </CollapsibleSection>

                        {/* Column changes */}
                        <CollapsibleSection title={LOC.columnsLabel} count={columnEntries.length}>
                            {columnEntries.map((entry) => (
                                <ChangeItem
                                    key={entry.id}
                                    entry={entry}
                                    onUndo={() => handleUndo(entry)}
                                    onNavigate={() => handleNavigate(entry)}
                                />
                            ))}
                        </CollapsibleSection>

                        {/* Foreign key changes */}
                        <CollapsibleSection title={LOC.fksLabel} count={fkEntries.length}>
                            {fkEntries.map((entry) => (
                                <ChangeItem
                                    key={entry.id}
                                    entry={entry}
                                    onUndo={() => handleUndo(entry)}
                                    onNavigate={() => handleNavigate(entry)}
                                />
                            ))}
                        </CollapsibleSection>
                    </>
                )}
            </div>
        </div>
    );
};
