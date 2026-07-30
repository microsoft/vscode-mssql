/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ExecutionGraphComparisonResult,
    ExecutionPlanComparisonResult,
    ExecutionPlanGraphElementProperty,
    ExecutionPlanGraphElementPropertyBetterValue,
    ExecutionPlanGraphElementPropertyDataType,
} from "../../../sharedInterfaces/executionPlan";

export type ExecutionPlanPropertyComparison = "equal" | "different" | "greater" | "less";

export interface ExecutionPlanComparisonMaps {
    primaryMatches: ReadonlyMap<string, readonly string[]>;
    secondaryMatches: ReadonlyMap<string, readonly string[]>;
    primaryGroupRoots: ReadonlyMap<string, number>;
    secondaryGroupRoots: ReadonlyMap<string, number>;
}

export interface ExecutionPlanComparisonPropertyRow {
    id: string;
    name: string;
    primaryValue: string;
    secondaryValue: string;
    comparison: ExecutionPlanPropertyComparison;
    level: number;
    children: readonly ExecutionPlanComparisonPropertyRow[];
}

export function normalizeComparisonNodeId(id: string | number): string {
    const value = String(id);
    return value.startsWith("element-") ? value : `element-${value}`;
}

function populateComparisonMaps(
    root: ExecutionGraphComparisonResult,
    matches: Map<string, readonly string[]>,
    groupRoots: Map<string, number>,
): void {
    const seenGroups = new Set<number>();
    const visit = (node: ExecutionGraphComparisonResult): void => {
        if (node.hasMatch) {
            const id = normalizeComparisonNodeId(node.baseNode.id);
            matches.set(
                id,
                (node.matchingNodesId ?? []).map((matchingId) =>
                    normalizeComparisonNodeId(matchingId),
                ),
            );
            if (!seenGroups.has(node.groupIndex)) {
                seenGroups.add(node.groupIndex);
                groupRoots.set(id, node.groupIndex);
            }
        }
        (node.children ?? []).forEach(visit);
    };
    visit(root);
}

export function buildExecutionPlanComparisonMaps(
    result: ExecutionPlanComparisonResult | undefined,
): ExecutionPlanComparisonMaps {
    const primaryMatches = new Map<string, readonly string[]>();
    const secondaryMatches = new Map<string, readonly string[]>();
    const primaryGroupRoots = new Map<string, number>();
    const secondaryGroupRoots = new Map<string, number>();

    if (result?.firstComparisonResult) {
        populateComparisonMaps(result.firstComparisonResult, primaryMatches, primaryGroupRoots);
    }
    if (result?.secondComparisonResult) {
        populateComparisonMaps(
            result.secondComparisonResult,
            secondaryMatches,
            secondaryGroupRoots,
        );
    }

    return {
        primaryMatches,
        secondaryMatches,
        primaryGroupRoots,
        secondaryGroupRoots,
    };
}

function oneLine(value: string | undefined): string {
    return (value ?? "").replace(/\r\n|\r|\n/g, " ");
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
                left.displayOrder - right.displayOrder || leftName.localeCompare(rightName),
        )
        .map(([name, value], index) => {
            const primaryChildren = Array.isArray(value.primary?.value)
                ? value.primary.value
                : undefined;
            const secondaryChildren = Array.isArray(value.secondary?.value)
                ? value.secondary.value
                : undefined;
            const id = `${parentId}/${index}-${name}`;
            return {
                id,
                name,
                primaryValue: oneLine(value.primary?.displayValue),
                secondaryValue: oneLine(value.secondary?.displayValue),
                comparison: compareProperties(value.primary, value.secondary),
                level,
                children: propertiesToRows(primaryChildren, secondaryChildren, id, level + 1),
            };
        });
}

export function buildExecutionPlanComparisonPropertyRows(
    primary: readonly ExecutionPlanGraphElementProperty[] | undefined,
    secondary: readonly ExecutionPlanGraphElementProperty[] | undefined,
): ExecutionPlanComparisonPropertyRow[] {
    return propertiesToRows(primary, secondary, "property", 0);
}
