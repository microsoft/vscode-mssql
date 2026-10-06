/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ExecutionPlanGraphElementProperty,
    ExecutionPlanGraphElementPropertyBetterValue,
    ExecutionPlanGraphElementPropertyDataType,
} from "../../../../sharedInterfaces/executionPlan";
import {
    CompareExecutionPlanGraphsResult,
    ExecutionPlanComparisonMatch,
} from "../../../../sharedInterfaces/executionPlanComparison";

export type ComparisonSide = "primary" | "secondary";
export type ComparisonOrientation = "horizontal" | "vertical";
export const comparisonSides: readonly ComparisonSide[] = ["primary", "secondary"];

export function otherSide(side: ComparisonSide): ComparisonSide {
    return side === "primary" ? "secondary" : "primary";
}

export type ExecutionPlanPropertyComparison = "equal" | "different" | "greater" | "less";
export type ExecutionPlanComparisonPropertySort =
    | "importance"
    | "alphabetical"
    | "reverseAlphabetical";

/** Number of outline colors for similar areas; see `.execution-plan-comparison-group-*`. */
export const EXECUTION_PLAN_COMPARISON_COLOR_SLOTS = 4;

export interface ExecutionPlanComparisonMaps {
    primaryMatches: ReadonlyMap<string, readonly string[]>;
    secondaryMatches: ReadonlyMap<string, readonly string[]>;
    /** Root node of each similar area in the primary plan, mapped to the area's color slot. */
    primaryGroupRoots: ReadonlyMap<string, number>;
    /** Root node of each similar area in the secondary plan, mapped to the area's color slot. */
    secondaryGroupRoots: ReadonlyMap<string, number>;
}

export interface ExecutionPlanComparisonPropertyRow {
    id: string;
    name: string;
    primaryValue: string;
    secondaryValue: string;
    /** False when the primary operator has no such property, as opposed to an empty value. */
    inPrimary: boolean;
    /** False when the secondary operator has no such property, as opposed to an empty value. */
    inSecondary: boolean;
    comparison: ExecutionPlanPropertyComparison;
    /** True when this row or any row nested in it differs. */
    hasDifference: boolean;
    level: number;
    children: readonly ExecutionPlanComparisonPropertyRow[];
}

export function normalizeComparisonNodeId(id: string | number): string {
    const value = String(id);
    return value.startsWith("element-") ? value : `element-${value}`;
}

function populateComparisonMaps(
    nodes: readonly ExecutionPlanComparisonMatch[],
    matches: Map<string, readonly string[]>,
    groupRoots: Map<string, number>,
    colorSlots: Map<number, number>,
): void {
    const seenGroups = new Set<number>();
    for (const node of nodes) {
        const id = normalizeComparisonNodeId(node.nodeId);
        matches.set(id, node.matchingNodeIds.map(normalizeComparisonNodeId));
        // Nodes arrive in pre-order, so the first node of an area is the root of its subtree.
        if (seenGroups.has(node.groupIndex)) {
            continue;
        }
        seenGroups.add(node.groupIndex);
        let slot = colorSlots.get(node.groupIndex);
        if (slot === undefined) {
            slot = colorSlots.size % EXECUTION_PLAN_COMPARISON_COLOR_SLOTS;
            colorSlots.set(node.groupIndex, slot);
        }
        groupRoots.set(id, slot);
    }
}

/**
 * Indexes the matches of a comparison. Similar areas get color slots in the order they first
 * appear in the primary plan, so an area has the same color in both panes and neighboring areas
 * differ even when the service's group numbers are sparse.
 */
export function buildExecutionPlanComparisonMaps(
    result: CompareExecutionPlanGraphsResult | undefined,
): ExecutionPlanComparisonMaps {
    const primaryMatches = new Map<string, readonly string[]>();
    const secondaryMatches = new Map<string, readonly string[]>();
    const primaryGroupRoots = new Map<string, number>();
    const secondaryGroupRoots = new Map<string, number>();
    const colorSlots = new Map<number, number>();

    if (result) {
        populateComparisonMaps(result.primary, primaryMatches, primaryGroupRoots, colorSlots);
        populateComparisonMaps(result.secondary, secondaryMatches, secondaryGroupRoots, colorSlots);
    }

    return {
        primaryMatches,
        secondaryMatches,
        primaryGroupRoots,
        secondaryGroupRoots,
    };
}

/** Orders names like people read them, so list items run [1], [2], ... [10], not [1], [10], [2]. */
function compareNames(left: string, right: string): number {
    return left.localeCompare(right, undefined, { numeric: true });
}

function compareProperties(
    primary: ExecutionPlanGraphElementProperty | undefined,
    secondary: ExecutionPlanGraphElementProperty | undefined,
): ExecutionPlanPropertyComparison {
    if (!primary || !secondary) {
        return "different";
    }
    if (primary.displayValue === secondary.displayValue) {
        return "equal";
    }
    if (
        primary.dataType !== ExecutionPlanGraphElementPropertyDataType.Number ||
        primary.betterValue === ExecutionPlanGraphElementPropertyBetterValue.None
    ) {
        return "different";
    }

    const primaryNumber = Number.parseFloat(primary.displayValue);
    const secondaryNumber = Number.parseFloat(secondary.displayValue);
    if (!Number.isFinite(primaryNumber) || !Number.isFinite(secondaryNumber)) {
        return "different";
    }
    return primaryNumber > secondaryNumber ? "greater" : "less";
}

function propertiesToRows(
    primary: readonly ExecutionPlanGraphElementProperty[] | undefined,
    secondary: readonly ExecutionPlanGraphElementProperty[] | undefined,
    parentId: string,
    level: number,
): ExecutionPlanComparisonPropertyRow[] {
    const properties = new Map<
        string,
        {
            primary?: ExecutionPlanGraphElementProperty;
            secondary?: ExecutionPlanGraphElementProperty;
            displayOrder: number;
        }
    >();
    for (const property of primary ?? []) {
        properties.set(property.name, {
            primary: property,
            displayOrder: property.displayOrder,
        });
    }
    for (const property of secondary ?? []) {
        const existing = properties.get(property.name);
        properties.set(property.name, {
            ...existing,
            secondary: property,
            displayOrder: existing?.displayOrder ?? property.displayOrder,
        });
    }

    return [...properties.entries()]
        .sort(
            ([leftName, left], [rightName, right]) =>
                left.displayOrder - right.displayOrder || compareNames(leftName, rightName),
        )
        .map(([name, value], index) => {
            const primaryChildren = Array.isArray(value.primary?.value)
                ? value.primary.value
                : undefined;
            const secondaryChildren = Array.isArray(value.secondary?.value)
                ? value.secondary.value
                : undefined;
            const id = `${parentId}/${index}-${name}`;
            const comparison = compareProperties(value.primary, value.secondary);
            const children = propertiesToRows(primaryChildren, secondaryChildren, id, level + 1);
            return {
                id,
                name,
                primaryValue: value.primary?.displayValue ?? "",
                secondaryValue: value.secondary?.displayValue ?? "",
                inPrimary: value.primary !== undefined,
                inSecondary: value.secondary !== undefined,
                comparison,
                hasDifference:
                    comparison !== "equal" || children.some((child) => child.hasDifference),
                level,
                children,
            };
        });
}

/** Pairs the properties of two operators by name, in importance order, keeping their nesting. */
export function buildExecutionPlanComparisonPropertyRows(
    primary: readonly ExecutionPlanGraphElementProperty[] | undefined,
    secondary: readonly ExecutionPlanGraphElementProperty[] | undefined,
): ExecutionPlanComparisonPropertyRow[] {
    return propertiesToRows(primary, secondary, "property", 0);
}

function rowMatches(row: ExecutionPlanComparisonPropertyRow, needle: string): boolean {
    return (
        row.name.toLocaleLowerCase().includes(needle) ||
        row.primaryValue.toLocaleLowerCase().includes(needle) ||
        row.secondaryValue.toLocaleLowerCase().includes(needle)
    );
}

/**
 * Keeps the rows that match the filter with everything nested in them, and the ancestors of
 * nested matches so each match keeps the context of the property it belongs to.
 */
export function filterComparisonPropertyRows(
    rows: readonly ExecutionPlanComparisonPropertyRow[],
    filter: string,
): readonly ExecutionPlanComparisonPropertyRow[] {
    const needle = filter.trim().toLocaleLowerCase();
    if (!needle) {
        return rows;
    }
    const visit = (
        candidates: readonly ExecutionPlanComparisonPropertyRow[],
    ): ExecutionPlanComparisonPropertyRow[] =>
        candidates.flatMap((row) => {
            if (rowMatches(row, needle)) {
                return [row];
            }
            const children = visit(row.children);
            return children.length > 0 ? [{ ...row, children }] : [];
        });
    return visit(rows);
}

/** Sorts siblings at every level. Importance keeps the service's display order. */
export function sortComparisonPropertyRows(
    rows: readonly ExecutionPlanComparisonPropertyRow[],
    sort: ExecutionPlanComparisonPropertySort,
): readonly ExecutionPlanComparisonPropertyRow[] {
    if (sort === "importance") {
        return rows;
    }
    const direction = sort === "alphabetical" ? 1 : -1;
    const visit = (
        siblings: readonly ExecutionPlanComparisonPropertyRow[],
    ): ExecutionPlanComparisonPropertyRow[] =>
        [...siblings]
            .sort((left, right) => direction * compareNames(left.name, right.name))
            .map((row) =>
                row.children.length > 0 ? { ...row, children: visit(row.children) } : row,
            );
    return visit(rows);
}

/** Lists rows in display order, descending only into the rows that are expanded. */
export function flattenComparisonPropertyRows(
    rows: readonly ExecutionPlanComparisonPropertyRow[],
    isExpanded: (row: ExecutionPlanComparisonPropertyRow) => boolean,
): ExecutionPlanComparisonPropertyRow[] {
    return rows.flatMap((row) =>
        row.children.length > 0 && isExpanded(row)
            ? [row, ...flattenComparisonPropertyRows(row.children, isExpanded)]
            : [row],
    );
}
