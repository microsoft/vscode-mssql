/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DOMParser, Element } from "@xmldom/xmldom";
import { ExecutionPlanGraph, ExecutionPlanNode } from "../sharedInterfaces/executionPlan";

function children(element: Element): Element[] {
    return Array.from(element.childNodes).filter((child): child is Element => child.nodeType === 1);
}

function numberAttribute(element: Element, name: string): number | undefined {
    const text = element.getAttribute(name);
    if (!text?.trim()) {
        return undefined;
    }
    const value = Number(text);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Relational children, stopping at operators and nested statement/query-plan boundaries. */
function childOperators(element: Element): Element[] {
    return children(element).flatMap((child) => {
        if (child.localName === "RelOp") {
            return [child];
        }
        if (child.localName === "QueryPlan" || child.localName?.startsWith("Stmt")) {
            return [];
        }
        return childOperators(child);
    });
}

/**
 * Reads invariant counters from XML instead of parsing translated property display text. STS's
 * current elapsedTimeInMs loses whole seconds; the XML retains the full operator duration.
 * Unsupported statement shapes are left alone rather than assigning counters to the wrong node.
 */
export function addLiveExecutionPlanStatistics(graph: ExecutionPlanGraph): ExecutionPlanGraph {
    const xml = graph.graphFile?.graphFileContent;
    if (!xml) {
        return graph;
    }
    try {
        const document = new DOMParser({
            onError: () => {
                throw new Error("Invalid live plan XML");
            },
        }).parseFromString(xml, "text/xml");
        // Lightweight live plans may omit StatementText entirely, even though their operator
        // counters are present. Preserve their position among statements when matching STS graphs.
        const statements = Array.from(document.getElementsByTagNameNS("*", "*")).filter(
            (element) =>
                element.localName?.startsWith("Stmt") && element.hasAttribute("StatementId"),
        );
        const indexedStatement = statements[graph.graphFile.planIndexInFile ?? 0];
        const matchingStatements = statements.filter(
            (element) => element.getAttribute("StatementText") === graph.query,
        );
        const statement =
            indexedStatement &&
            (!indexedStatement.hasAttribute("StatementText") ||
                !graph.query ||
                indexedStatement.getAttribute("StatementText") === graph.query)
                ? indexedStatement
                : matchingStatements.length === 1
                  ? matchingStatements[0]
                  : undefined;
        const queryPlan =
            statement && children(statement).find((child) => child.localName === "QueryPlan");
        const operator =
            queryPlan && children(queryPlan).find((child) => child.localName === "RelOp");
        if (!queryPlan || !operator || graph.root.children.length !== 1) {
            return graph;
        }

        let weightedProgress = 0;
        let totalCost = 0;
        let observedCounters = false;
        let maximumElapsed: number | undefined;
        const annotate = (node: ExecutionPlanNode, relOp: Element): ExecutionPlanNode => {
            const operators = childOperators(relOp);
            if (operators.length !== node.children.length) {
                throw new Error("Live plan operator topology differs from its graph");
            }
            const estimatedPerExecution = numberAttribute(relOp, "EstimateRows");
            const executions =
                1 +
                (numberAttribute(relOp, "EstimateRebinds") ?? 0) +
                (numberAttribute(relOp, "EstimateRewinds") ?? 0);
            const estimatedTotal =
                estimatedPerExecution === undefined
                    ? undefined
                    : estimatedPerExecution * executions;
            const estimatedRows =
                estimatedTotal !== undefined && Number.isFinite(estimatedTotal)
                    ? Math.round(estimatedTotal)
                    : undefined;
            const runtime = children(relOp).find(
                (child) => child.localName === "RunTimeInformation",
            );
            const counters = runtime
                ? children(runtime).filter(
                      (child) => child.localName === "RunTimeCountersPerThread",
                  )
                : [];
            let actualRows: bigint | undefined;
            let elapsedTimeInMs: number | undefined;
            for (const counter of counters) {
                const rows = counter.getAttribute("ActualRows");
                if (rows && /^\d+$/.test(rows)) {
                    actualRows = (actualRows ?? 0n) + BigInt(rows);
                }
                const elapsed = numberAttribute(counter, "ActualElapsedms");
                if (elapsed !== undefined) {
                    elapsedTimeInMs = Math.max(elapsedTimeInMs ?? 0, elapsed);
                }
            }
            if (elapsedTimeInMs !== undefined) {
                maximumElapsed = Math.max(maximumElapsed ?? 0, elapsedTimeInMs);
            }
            if (estimatedRows !== undefined && estimatedRows > 0) {
                const cost = Number.isFinite(node.cost) && node.cost > 0 ? node.cost : 0;
                totalCost += cost;
                if (actualRows !== undefined) {
                    observedCounters = true;
                    weightedProgress += cost * Math.min(Number(actualRows) / estimatedRows, 1);
                }
            }
            return {
                ...node,
                liveQueryStatistics: {
                    actualRows: actualRows?.toString(),
                    estimatedRows,
                    elapsedTimeInMs,
                },
                children: node.children.map((child, index) => annotate(child, operators[index])),
            };
        };
        const rootOperator = annotate(graph.root.children[0], operator);
        const timeStats = children(queryPlan).find((child) => child.localName === "QueryTimeStats");
        const queryElapsed = timeStats && numberAttribute(timeStats, "ElapsedTime");
        const elapsedTimeInMs =
            queryElapsed === undefined && maximumElapsed === undefined
                ? undefined
                : Math.max(queryElapsed ?? 0, maximumElapsed ?? 0);
        return {
            ...graph,
            root: {
                ...graph.root,
                liveQueryStatistics: { elapsedTimeInMs },
                children: [rootOperator],
            },
            liveQueryStatistics: {
                // Row estimates can be wrong, and an operator producing its estimated rows does
                // not prove completion. A running query never displays 100% overall.
                estimatedProgress:
                    observedCounters && totalCost > 0
                        ? Math.min(99, (100 * weightedProgress) / totalCost)
                        : undefined,
                elapsedTimeInMs,
            },
        };
    } catch {
        return graph;
    }
}
