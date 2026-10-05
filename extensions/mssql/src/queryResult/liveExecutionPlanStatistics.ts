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

interface ProgressOperator {
    physicalOp: string;
    estimatedRows: number;
    refinedRows: number;
    actualRows?: number;
    cost: number;
    finished: boolean;
    started: boolean;
    children: ProgressOperator[];
}

interface ProgressPipeline {
    nodes: ProgressOperator[];
    drivers: ProgressOperator[];
    parent?: ProgressPipeline;
    cost: number;
}

/**
 * Estimate work from pipeline inputs, rather than every intermediate output. In a nested-loop
 * cross join, one input row can produce millions of output rows; weighting those outputs by
 * optimizer costs makes progress appear stuck when cardinality estimates are too large.
 * Sorts, spool materialization, and hash builds separate pipelines. Completed inputs and observed
 * selectivity refine their costs; this follows the driver-input approach used by SQL Server LQS.
 */
function estimatePipelineProgress(root: ProgressOperator): number | undefined {
    const pipelines: ProgressPipeline[] = [];
    const createPipeline = (parent?: ProgressPipeline): ProgressPipeline => {
        const pipeline: ProgressPipeline = { nodes: [], drivers: [], parent, cost: 0 };
        pipelines.push(pipeline);
        return pipeline;
    };
    const visit = (operator: ProgressOperator, pipeline: ProgressPipeline): ProgressOperator[] => {
        pipeline.nodes.push(operator);
        const inputs = operator.children.map((child, index) => {
            const blocks =
                operator.physicalOp === "Sort" ||
                operator.physicalOp === "Table Spool" ||
                (operator.physicalOp === "Hash Match" && index === 0);
            if (blocks) {
                const childPipeline = createPipeline(pipeline);
                childPipeline.drivers = visit(child, childPipeline);
                return [];
            }
            return visit(child, pipeline);
        });
        const drivers = inputs.find((input) => input.length > 0);
        const combinesInputs =
            operator.physicalOp === "Merge Join" ||
            operator.physicalOp === "Concatenation" ||
            // Repeated leaf scans on the inner side also drive work. Their estimates already
            // include rebinds/rewinds; inner subtrees and spools are driven by the outer input.
            (operator.physicalOp === "Nested Loops" && operator.children[1]?.children.length === 0);
        return combinesInputs && drivers ? inputs.flat() : (drivers ?? [operator]);
    };
    const rootPipeline = createPipeline();
    rootPipeline.drivers = visit(root, rootPipeline);

    for (const pipeline of pipelines) {
        for (const operator of pipeline.nodes) {
            // Keep scan IO costs intact. For other operators, adjust the estimated work using
            // completed inputs and observed output/input ratios, without changing displayed rows.
            const originalWork =
                operator.estimatedRows +
                operator.children.reduce((sum, child) => sum + child.estimatedRows, 0);
            const refinedWork =
                operator.refinedRows +
                operator.children.reduce((sum, child) => sum + child.refinedRows, 0);
            const scale =
                operator.children.length > 0 && originalWork > 0 ? refinedWork / originalWork : 1;
            pipeline.cost += operator.cost * scale;
        }
    }

    // Use the most expensive chain of dependent pipelines, plus any other pipelines currently
    // executing. Independent branches don't all contribute to the query's critical path.
    let longestPath: ProgressPipeline[] = [];
    let longestCost = -1;
    for (const pipeline of pipelines) {
        const path: ProgressPipeline[] = [];
        for (
            let current: ProgressPipeline | undefined = pipeline;
            current;
            current = current.parent
        ) {
            path.push(current);
        }
        const cost = path.reduce((sum, current) => sum + current.cost, 0);
        if (cost > longestCost) {
            longestCost = cost;
            longestPath = path;
        }
    }
    const active = new Set(longestPath);
    for (const pipeline of pipelines) {
        if (
            pipeline.nodes.some((operator) => operator.started) &&
            !pipeline.nodes.every((operator) => operator.finished)
        ) {
            active.add(pipeline);
        }
    }
    let weightedProgress = 0;
    let totalCost = 0;
    let observed = false;
    for (const pipeline of active) {
        const estimated = pipeline.drivers.reduce((sum, driver) => sum + driver.refinedRows, 0);
        const actual = pipeline.drivers.reduce((sum, driver) => sum + (driver.actualRows ?? 0), 0);
        const finished = pipeline.nodes.every((operator) => operator.finished);
        observed ||= pipeline.drivers.some((driver) => driver.actualRows !== undefined);
        if (estimated <= 0 && !finished) {
            continue;
        }
        const progress = finished ? 1 : Math.min(actual / estimated, 1);
        totalCost += pipeline.cost;
        weightedProgress += pipeline.cost * progress;
    }
    return observed && totalCost > 0
        ? Math.min(99, (100 * weightedProgress) / totalCost)
        : undefined;
}

/** Adds counters and a running-query progress estimate to an in-flight plan. */
export function addLiveExecutionPlanStatistics(graph: ExecutionPlanGraph): ExecutionPlanGraph {
    return addExecutionPlanStatistics(graph, true);
}

/**
 * Reads invariant counters from XML instead of parsing translated property display text. STS's
 * current elapsedTimeInMs loses whole seconds; the XML retains the full operator duration.
 * Unsupported statement shapes are left alone rather than assigning counters to the wrong node.
 */
export function addExecutionPlanStatistics(
    graph: ExecutionPlanGraph,
    isLive = false,
): ExecutionPlanGraph {
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

        let progressRoot: ProgressOperator | undefined;
        let maximumElapsed: number | undefined;
        let hasRuntimeCounters = false;
        const annotate = (
            node: ExecutionPlanNode,
            relOp: Element,
            progressParent?: ProgressOperator,
        ): ExecutionPlanNode => {
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
                    ? estimatedTotal
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
            hasRuntimeCounters ||= actualRows !== undefined || elapsedTimeInMs !== undefined;
            if (elapsedTimeInMs !== undefined) {
                maximumElapsed = Math.max(maximumElapsed ?? 0, elapsedTimeInMs);
            }
            const activeCounters = counters.filter(
                (counter) => (numberAttribute(counter, "ActualExecutions") ?? 0) > 0,
            );
            // An inner scan can finish one iteration while its nested loop still has work.
            // Only use end-of-scan counters to refine single-execution inputs as completed.
            const finished =
                executions <= 1 &&
                activeCounters.length > 0 &&
                activeCounters.every(
                    (counter) =>
                        numberAttribute(counter, "ActualExecutions") === 1 &&
                        (numberAttribute(counter, "ActualEndOfScans") ?? 0) >= 1,
                );
            const progress: ProgressOperator = {
                physicalOp: relOp.getAttribute("PhysicalOp") ?? "",
                estimatedRows: estimatedRows ?? 0,
                refinedRows: estimatedRows ?? 0,
                actualRows: actualRows === undefined ? undefined : Number(actualRows),
                cost: Number.isFinite(node.cost) && node.cost > 0 ? node.cost : 0,
                finished,
                started: activeCounters.length > 0 || (actualRows ?? 0n) > 0n,
                children: [],
            };
            if (progressParent) {
                progressParent.children.push(progress);
            } else {
                progressRoot = progress;
            }
            const annotatedChildren = node.children.map((child, index) =>
                annotate(child, operators[index], progress),
            );
            const input = progress.children.at(-1);
            if (finished) {
                progress.refinedRows = progress.actualRows ?? progress.estimatedRows;
            } else if (input) {
                if (
                    progress.physicalOp === "Compute Scalar" ||
                    progress.physicalOp === "Parallelism"
                ) {
                    // Compute Scalar frequently has no runtime counters of its own.
                    progress.refinedRows = input.refinedRows;
                } else if ((input.actualRows ?? 0) > 0 && (progress.actualRows ?? 0) > 0) {
                    progress.refinedRows =
                        input.refinedRows * (progress.actualRows! / input.actualRows!);
                }
            }
            if (!Number.isFinite(progress.refinedRows)) {
                progress.refinedRows = progress.estimatedRows;
            }
            if (progress.estimatedRows > 0) {
                progress.refinedRows = Math.max(progress.refinedRows, progress.actualRows ?? 0);
            }
            return {
                ...node,
                liveQueryStatistics: {
                    actualRows: actualRows?.toString(),
                    estimatedRows,
                    elapsedTimeInMs,
                },
                children: annotatedChildren,
            };
        };
        const rootOperator = annotate(graph.root.children[0], operator);
        // An estimated plan has optimizer rows but no execution counters. Keep its usual labels.
        if (!hasRuntimeCounters) {
            return graph;
        }
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
                    isLive && progressRoot ? estimatePipelineProgress(progressRoot) : undefined,
                elapsedTimeInMs,
            },
        };
    } catch {
        return graph;
    }
}
