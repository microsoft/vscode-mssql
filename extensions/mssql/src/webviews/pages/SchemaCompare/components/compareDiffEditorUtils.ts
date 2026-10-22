/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as mssql from "vscode-mssql";
import { SchemaUpdateAction } from "../../../../sharedInterfaces/schemaCompare";

const DIFF_COLOR_PAIRS: ReadonlyArray<readonly [string, string]> = [
    ["diffEditor.insertedTextBackground", "diffEditor.removedTextBackground"],
    ["diffEditor.insertedLineBackground", "diffEditor.removedLineBackground"],
    ["diffEditor.insertedTextBorder", "diffEditor.removedTextBorder"],
    ["diffEditorGutter.insertedLineBackground", "diffEditorGutter.removedLineBackground"],
    ["diffEditorOverview.insertedForeground", "diffEditorOverview.removedForeground"],
];

export const reverseSchemaCompareDiffColors = (
    colors: Record<string, string>,
): Record<string, string> => {
    const reversedColors = { ...colors };

    for (const [insertedColor, removedColor] of DIFF_COLOR_PAIRS) {
        const insertedValue = colors[insertedColor];
        const removedValue = colors[removedColor];

        if (removedValue) {
            reversedColors[insertedColor] = removedValue;
        } else {
            delete reversedColors[insertedColor];
        }

        if (insertedValue) {
            reversedColors[removedColor] = insertedValue;
        } else {
            delete reversedColors[removedColor];
        }
    }

    return reversedColors;
};

/**
 * DacFx ObjectType TypeName values for the constraint kinds that can appear under a SqlTable
 * in a Schema Compare diff. These match exactly the strings emitted by
 * `SchemaComparisonExcludedObjectId(objectType, name).TypeName` in sqltoolsservice (see
 * CreateDiffEntry in SchemaCompareUtils). Used to filter the constraint banner above the
 * diff editor.
 */
export const CONSTRAINT_OBJECT_TYPE_SUFFIXES = [
    "PrimaryKeyConstraint",
    "ForeignKeyConstraint",
    "UniqueConstraint",
    "CheckConstraint",
    "DefaultConstraint",
];

/**
 * Returns true if the given DacFx ObjectType full type name represents a constraint kind
 * (PK / FK / UNIQUE / CHECK / DEFAULT). Returns false for undefined / empty input and for
 * non-constraint types (e.g. SqlColumn, SqlSimpleColumn, SqlIndex).
 */
export const isConstraintObjectType = (objectType: string | undefined): boolean => {
    if (!objectType) {
        return false;
    }
    return CONSTRAINT_OBJECT_TYPE_SUFFIXES.some((suffix) => objectType.endsWith(suffix));
};

/**
 * Format the display name for a child DiffEntry. Prefers the source name parts (joined
 * with "." to match the [schema].[name] convention) so Add/Change diffs read naturally; falls
 * back to target name parts so Drop-only diffs still produce a label; finally falls back to
 * `child.name`. Returns empty string if no name source is present.
 */
export const formatChildName = (child: mssql.DiffEntry): string => {
    const parts = (child.sourceValue?.length ? child.sourceValue : child.targetValue) ?? [];
    if (parts.length > 0) {
        return parts.join(".");
    }
    return child.name ?? "";
};

/**
 * Collect the hierarchical-child diffs that represent constraint changes (PK / FK / UNIQUE /
 * CHECK / DEFAULT) under the selected parent diff, grouped by SchemaUpdateAction. Used to
 * render the "Constraints added / dropped / changed" banner above the diff editor.
 *
 * Filtered to constraint object types only so column-change children (which are already part
 * of the parent table's CREATE / ALTER script) do not get listed here. Reads the source name
 * when present and falls back to the target name so that Drop-only diffs still produce a label.
 */
export const groupConstraintChildrenByAction = (
    diff: mssql.DiffEntry | undefined,
): { [action in SchemaUpdateAction]?: string[] } => {
    const grouped: { [action in SchemaUpdateAction]?: string[] } = {};
    if (!diff?.children) {
        return grouped;
    }
    for (const child of diff.children) {
        if (!isConstraintObjectType(child.sourceObjectType ?? child.targetObjectType)) {
            continue;
        }
        const name = formatChildName(child);
        if (!name) {
            continue;
        }
        const action = child.updateAction as SchemaUpdateAction;
        (grouped[action] ??= []).push(name);
    }
    return grouped;
};

/**
 * Walk a DiffEntry tree and concatenate the source or target scripts for the parent plus all
 * descendants. Mirrors the script-aggregation the diff editor performs so that selecting a
 * Fabric Warehouse table diff in the Monaco editor shows the parent's CREATE/ALTER followed
 * by each constraint's ALTER TABLE ... ADD CONSTRAINT script (which sqltoolsservice now
 * preserves under SqlDwUnified — see CreateDiffEntry in SchemaCompareUtils).
 *
 * Each non-empty script is separated by a blank line so the consolidated output remains
 * readable. Null diffs and missing scripts are skipped without error.
 */
export const getAggregatedScript = (
    diff: mssql.DiffEntry | undefined | null,
    getSourceScript: boolean,
): string => {
    if (!diff) {
        return "";
    }
    let script = "";
    const diffScript = getSourceScript ? diff.sourceScript : diff.targetScript;
    if (diffScript) {
        script += diffScript + "\n\n";
    }
    if (diff.children) {
        for (const child of diff.children) {
            script += getAggregatedScript(child, getSourceScript);
        }
    }
    return script;
};

/**
 * Builds Monaco's models in their visual order: source on the left as the original model and
 * target on the right as the modified model. Schema Compare supplies source-to-target colors
 * separately because Monaco's default inserted/removed colors describe original-to-modified.
 */
export const getDiffEditorModels = (
    diff: mssql.DiffEntry | undefined,
): { original: string; modified: string } => ({
    original: getAggregatedScript(diff, true),
    modified: getAggregatedScript(diff, false),
});
