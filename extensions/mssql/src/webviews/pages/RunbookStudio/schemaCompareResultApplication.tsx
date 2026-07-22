/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
    RunbookSchemaCompareDocument,
    RunbookSchemaCompareItem,
} from "../../../sharedInterfaces/runbookSchemaCompare";
import { HostedResultApplication } from "../../common/HostedResultApplication/HostedResultApplication";
import { locConstants } from "../../common/locConstants";
import { VscodeDiffEditor } from "../../common/vscodeMonaco";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";

export function parseRunbookSchemaCompareDocument(
    raw: unknown,
): RunbookSchemaCompareDocument | undefined {
    if (typeof raw !== "string") {
        return undefined;
    }
    try {
        const value = JSON.parse(raw) as Partial<RunbookSchemaCompareDocument>;
        if (
            value.schemaVersion !== 1 ||
            !value.source ||
            value.source.kind !== "dacpac" ||
            typeof value.source.label !== "string" ||
            !value.target ||
            value.target.kind !== "database" ||
            typeof value.target.label !== "string" ||
            typeof value.areEqual !== "boolean" ||
            !Number.isSafeInteger(value.totalDifferences) ||
            !Array.isArray(value.items) ||
            typeof value.truncated !== "boolean" ||
            !Number.isSafeInteger(value.omittedCount) ||
            !value.items.every(isSchemaCompareItem)
        ) {
            return undefined;
        }
        return value as RunbookSchemaCompareDocument;
    } catch {
        return undefined;
    }
}

function isSchemaCompareItem(value: unknown): value is RunbookSchemaCompareItem {
    if (!value || typeof value !== "object") {
        return false;
    }
    const item = value as Partial<RunbookSchemaCompareItem>;
    return (
        typeof item.id === "string" &&
        ["add", "change", "delete", "unknown"].includes(String(item.action)) &&
        typeof item.objectType === "string" &&
        (item.sourceName === undefined || typeof item.sourceName === "string") &&
        (item.targetName === undefined || typeof item.targetName === "string") &&
        (item.sourceSql === undefined || typeof item.sourceSql === "string") &&
        (item.targetSql === undefined || typeof item.targetSql === "string")
    );
}

export function SchemaCompareResultApplication({
    document,
}: {
    document: RunbookSchemaCompareDocument;
}) {
    const loc = locConstants.runbookStudio;
    const schemaLoc = locConstants.schemaCompare;
    const { themeKind } = useVscodeWebview<unknown, unknown>();
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);
    const virtualizer = useVirtualizer({
        count: document.items.length,
        getScrollElement: () => listRef.current,
        estimateSize: () => 48,
        overscan: 8,
    });
    useEffect(() => {
        if (selectedIndex >= document.items.length) {
            setSelectedIndex(Math.max(0, document.items.length - 1));
        }
    }, [document.items.length, selectedIndex]);
    const selected = document.items[selectedIndex];

    const select = (index: number) => {
        const bounded = Math.max(0, Math.min(document.items.length - 1, index));
        setSelectedIndex(bounded);
        virtualizer.scrollToIndex(bounded, { align: "auto" });
    };
    const onListKeyDown = (event: React.KeyboardEvent) => {
        switch (event.key) {
            case "ArrowDown":
                event.preventDefault();
                select(selectedIndex + 1);
                break;
            case "ArrowUp":
                event.preventDefault();
                select(selectedIndex - 1);
                break;
            case "Home":
                event.preventDefault();
                select(0);
                break;
            case "End":
                event.preventDefault();
                select(document.items.length - 1);
                break;
        }
    };

    return (
        <HostedResultApplication
            ariaLabel={loc.schemaCompareResult}
            readOnlyLabel={loc.readOnlyChip}
            summary={loc.schemaCompareEndpoints(document.source.label, document.target.label)}>
            {document.items.length === 0 ? (
                <div className="rbs-hosted-empty">{loc.noSchemaChanges}</div>
            ) : (
                <div className="rbs-schema-compare-app">
                    <div className="rbs-schema-compare-list-pane">
                        <div className="rbs-schema-compare-list-heading">
                            {loc.schemaCompareDifferenceCount(document.totalDifferences)}
                        </div>
                        <div
                            ref={listRef}
                            className="rbs-schema-compare-list"
                            role="listbox"
                            aria-label={loc.schemaChanges}
                            aria-activedescendant={selected ? `rbs-${selected.id}` : undefined}
                            tabIndex={0}
                            onKeyDown={onListKeyDown}>
                            <div
                                className="rbs-schema-compare-list-content"
                                style={{ height: virtualizer.getTotalSize() }}>
                                {virtualizer.getVirtualItems().map((row) => {
                                    const item = document.items[row.index];
                                    const name =
                                        item.targetName || item.sourceName || loc.schemaObject;
                                    return (
                                        <button
                                            id={`rbs-${item.id}`}
                                            key={item.id}
                                            type="button"
                                            role="option"
                                            aria-selected={row.index === selectedIndex}
                                            className={`rbs-schema-compare-row ${row.index === selectedIndex ? "selected" : ""}`}
                                            style={{
                                                height: row.size,
                                                transform: `translateY(${row.start}px)`,
                                            }}
                                            onClick={() => select(row.index)}>
                                            <span
                                                className={`rbs-schema-action rbs-schema-action-${item.action}`}>
                                                {actionLabel(item.action, schemaLoc)}
                                            </span>
                                            <span className="rbs-schema-compare-row-text">
                                                <span className="rbs-schema-compare-name rbs-mono">
                                                    {name}
                                                </span>
                                                <span className="rbs-muted">{item.objectType}</span>
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        {document.truncated ? (
                            <div className="rbs-schema-compare-omitted">
                                {loc.schemaCompareOmitted(document.omittedCount)}
                            </div>
                        ) : null}
                    </div>
                    <div className="rbs-schema-compare-diff-pane">
                        <div className="rbs-schema-compare-diff-heading">
                            <span>{loc.schemaCompareSource(document.source.label)}</span>
                            <span>{loc.schemaCompareTarget(document.target.label)}</span>
                        </div>
                        {selected ? (
                            <VscodeDiffEditor
                                height="100%"
                                language="sql"
                                original={selected.sourceSql ?? ""}
                                modified={selected.targetSql ?? ""}
                                themeKind={themeKind}
                                options={{
                                    readOnly: true,
                                    renderSideBySide: true,
                                    renderOverviewRuler: true,
                                    overviewRulerLanes: 0,
                                    minimap: { enabled: false },
                                    automaticLayout: true,
                                }}
                            />
                        ) : (
                            <div className="rbs-hosted-empty">
                                {loc.schemaCompareSelectDifference}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </HostedResultApplication>
    );
}

function actionLabel(
    action: RunbookSchemaCompareItem["action"],
    loc: { add: string; change: string; delete: string },
): string {
    switch (action) {
        case "add":
            return loc.add;
        case "change":
            return loc.change;
        case "delete":
            return loc.delete;
        default:
            return "—";
    }
}
