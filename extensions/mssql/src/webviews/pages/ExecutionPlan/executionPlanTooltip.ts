/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ExecutionPlanGraphElementProperty,
    ExecutionPlanNode,
    InternalExecutionPlanEdge,
} from "../../../sharedInterfaces/executionPlan";

export interface ExecutionPlanTooltipMetric {
    name: string;
    value: string;
    isSql: boolean;
}

export interface ExecutionPlanTooltipContent {
    titleLines: string[];
    description?: string;
    metrics: ExecutionPlanTooltipMetric[];
    footer: ExecutionPlanTooltipMetric[];
}

const MAXIMUM_TITLE_LENGTH = 50;
const MAXIMUM_FOOTER_LENGTH = 100;
const SQL_PROPERTY_NAME_PATTERN =
    /(?:statement|predicate|residual|defined values|output list|scalar string)/i;

function truncate(value: string, maximumLength: number): string {
    return value.length > maximumLength ? `${value.slice(0, maximumLength).trimEnd()}...` : value;
}

function flattenPropertyValue(property: ExecutionPlanGraphElementProperty): string {
    if (typeof property.value === "string") {
        return property.displayValue || property.value;
    }

    return property.value
        .map((child) => `${child.name}: ${flattenPropertyValue(child)}`)
        .join(", ");
}

function formatProperties(
    properties: readonly ExecutionPlanGraphElementProperty[],
    skipFirst: boolean,
    includeFooter: boolean,
): Pick<ExecutionPlanTooltipContent, "metrics" | "footer"> {
    const metrics: ExecutionPlanTooltipMetric[] = [];
    const footer: ExecutionPlanTooltipMetric[] = [];

    const orderedProperties = [...properties]
        .filter((candidate) => candidate.showInTooltip)
        .sort((left, right) => left.displayOrder - right.displayOrder);

    for (const property of orderedProperties.slice(skipFirst ? 1 : 0)) {
        if (property.positionAtBottom && !includeFooter) {
            continue;
        }
        const isSql = SQL_PROPERTY_NAME_PATTERN.test(property.name);
        const propertyValue = flattenPropertyValue(property);
        const item = {
            name: property.name,
            value: truncate(
                isSql ? propertyValue.trim() : propertyValue.replace(/\s+/g, " ").trim(),
                property.positionAtBottom || isSql
                    ? MAXIMUM_FOOTER_LENGTH
                    : Number.MAX_SAFE_INTEGER,
            ),
            isSql,
        };
        (property.positionAtBottom ? footer : metrics).push(item);
    }

    return { metrics, footer };
}

export function formatExecutionPlanNodeTooltip(
    node: ExecutionPlanNode,
): ExecutionPlanTooltipContent {
    const titleLines = node.name
        .split(/\r\n|\r|\n/)
        .filter(Boolean)
        .map((line) => truncate(line, MAXIMUM_TITLE_LENGTH));
    return {
        titleLines,
        description: node.description,
        ...formatProperties(node.properties, true, true),
    };
}

export function formatExecutionPlanEdgeTooltip(
    edge: InternalExecutionPlanEdge,
): ExecutionPlanTooltipContent {
    return {
        titleLines: [],
        ...formatProperties(edge.properties, false, false),
    };
}
