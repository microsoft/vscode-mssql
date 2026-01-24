/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChangeAction, ChangeCategory, type SchemaChangesSummary } from "./diffUtils";

export interface ModifiedColumnHighlight {
    nameChange?: {
        oldValue: string;
        newValue: string;
    };
    dataTypeChange?: {
        oldValue: string;
        newValue: string;
    };
    hasOtherChanges: boolean;
}

export interface ModifiedTableHighlight {
    nameChange?: {
        oldValue: string;
        newValue: string;
    };
    schemaChange?: {
        oldValue: string;
        newValue: string;
    };
}

export function getNewTableIds(summary: SchemaChangesSummary | undefined): Set<string> {
    if (!summary) {
        return new Set();
    }

    return new Set(
        summary.groups.filter((group) => group.isNew).map((group) => group.tableId),
    );
}

export function getNewColumnIds(summary: SchemaChangesSummary | undefined): Set<string> {
    if (!summary) {
        return new Set();
    }

    const addedColumns = new Set<string>();
    for (const group of summary.groups) {
        if (group.isNew) {
            continue;
        }
        for (const change of group.changes) {
            if (
                change.category === ChangeCategory.Column &&
                change.action === ChangeAction.Add &&
                change.objectId
            ) {
                addedColumns.add(change.objectId);
            }
        }
    }
    return addedColumns;
}

export function getNewForeignKeyIds(summary: SchemaChangesSummary | undefined): Set<string> {
    if (!summary) {
        return new Set();
    }

    const addedForeignKeys = new Set<string>();
    for (const group of summary.groups) {
        for (const change of group.changes) {
            if (
                change.category === ChangeCategory.ForeignKey &&
                change.action === ChangeAction.Add &&
                change.objectId
            ) {
                addedForeignKeys.add(change.objectId);
            }
        }
    }
    return addedForeignKeys;
}

const toTextValue = (value: unknown): string => {
    if (value === null || value === undefined) {
        return "";
    }
    return typeof value === "string" ? value : String(value);
};

export function getModifiedColumnHighlights(
    summary: SchemaChangesSummary | undefined,
): Map<string, ModifiedColumnHighlight> {
    if (!summary) {
        return new Map();
    }

    const highlights = new Map<string, ModifiedColumnHighlight>();

    for (const group of summary.groups) {
        if (group.isNew) {
            continue;
        }

        for (const change of group.changes) {
            if (change.category !== ChangeCategory.Column || change.action !== ChangeAction.Modify) {
                continue;
            }

            if (!change.objectId || !change.propertyChanges) {
                continue;
            }

            const highlight = highlights.get(change.objectId) ?? {
                hasOtherChanges: false,
            };

            for (const propertyChange of change.propertyChanges) {
                if (propertyChange.property === "name") {
                    highlight.nameChange = {
                        oldValue: toTextValue(propertyChange.oldValue),
                        newValue: toTextValue(propertyChange.newValue),
                    };
                    continue;
                }

                if (propertyChange.property === "dataType") {
                    highlight.dataTypeChange = {
                        oldValue: toTextValue(propertyChange.oldValue),
                        newValue: toTextValue(propertyChange.newValue),
                    };
                    continue;
                }

                highlight.hasOtherChanges = true;
            }

            highlights.set(change.objectId, highlight);
        }
    }

    return highlights;
}

export function getModifiedTableHighlights(
    summary: SchemaChangesSummary | undefined,
): Map<string, ModifiedTableHighlight> {
    if (!summary) {
        return new Map();
    }

    const highlights = new Map<string, ModifiedTableHighlight>();

    for (const group of summary.groups) {
        if (group.isNew) {
            continue;
        }

        for (const change of group.changes) {
            if (change.category !== ChangeCategory.Table || change.action !== ChangeAction.Modify) {
                continue;
            }

            if (!change.tableId || !change.propertyChanges) {
                continue;
            }

            const highlight = highlights.get(change.tableId) ?? {};

            for (const propertyChange of change.propertyChanges) {
                if (propertyChange.property === "name") {
                    highlight.nameChange = {
                        oldValue: toTextValue(propertyChange.oldValue),
                        newValue: toTextValue(propertyChange.newValue),
                    };
                    continue;
                }

                if (propertyChange.property === "schema") {
                    highlight.schemaChange = {
                        oldValue: toTextValue(propertyChange.oldValue),
                        newValue: toTextValue(propertyChange.newValue),
                    };
                    continue;
                }
            }

            if (highlight.nameChange || highlight.schemaChange) {
                highlights.set(change.tableId, highlight);
            }
        }
    }

    return highlights;
}
