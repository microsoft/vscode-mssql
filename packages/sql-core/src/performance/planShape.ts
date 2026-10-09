/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * A short summary of a showplan XML plan, for a plan list. It reads the tags with a small
 * tokenizer and does not need an XML parser. Truncated or malformed XML gives the operators that
 * were read before the problem.
 */

export interface PlanShapeOperator {
    /** `PhysicalOp`, for example Index Seek. */
    readonly physicalOp: string;
    /** `LogicalOp`, for example Inner Join. */
    readonly logicalOp?: string;
    /** Index or table name without brackets, for example IX_Orders_CustomerID or PK_Orders. */
    readonly object?: string;
    /** The estimated cost of the operator alone: its subtree cost minus the subtree costs of its children. */
    readonly ownCost: number;
}

export interface PlanShape {
    /**
     * Up to maxOperators (default 3) operators with the highest own cost (subtree cost minus the
     * children's subtree costs), in plan order (depth-first).
     */
    readonly operators: readonly PlanShapeOperator[];
    /** True when a RelOp has Parallel="1"/"true" or the plan's DegreeOfParallelism is above 1. */
    readonly parallel: boolean;
    /** For example "Index Seek IX_Orders_CustomerID → Key Lookup PK_Orders". Empty when the XML has no RelOp. */
    readonly summary: string;
}

export const defaultPlanShapeOperators = 3;

interface ParsedOperator {
    readonly physicalOp: string;
    readonly logicalOp?: string;
    readonly subtreeCost: number;
    readonly parent?: number;
    object?: string;
    childCost: number;
}

/**
 * Comments, CDATA sections, and processing instructions are skipped. An unterminated one runs to
 * the end of the text. A tag is `<name attributes>`, `</name>`, or `<name attributes/>`, and its
 * attribute values are quoted, so a `>` in a value does not end the tag.
 */
const tokenPattern =
    /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<[?!][\s\S]*?(?:>|$)|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;

const attributePattern = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * Returns the most expensive operators of the first statement's `QueryPlan`, and whether the plan
 * is parallel. It does not throw for truncated or malformed XML. Throws a `RangeError` when
 * `maxOperators` is not a whole number above 0.
 */
export function summarizePlanShape(
    showplanXml: string,
    maxOperators: number = defaultPlanShapeOperators,
): PlanShape {
    if (typeof maxOperators !== "number" || !Number.isInteger(maxOperators) || maxOperators < 1) {
        throw new RangeError(`${String(maxOperators)} is not a whole number above 0.`);
    }
    const text = typeof showplanXml === "string" ? showplanXml : "";
    const operators: ParsedOperator[] = [];
    const stack: number[] = [];
    let parallel = false;
    // Read only the first QueryPlan. Without one, read every RelOp.
    const hasQueryPlan = /<(?:[\w.-]+:)?QueryPlan[\s/>]/.test(text);
    let queryPlanDepth = 0;
    let queryPlanSeen = false;

    tokenPattern.lastIndex = 0;
    for (let match = tokenPattern.exec(text); match; match = tokenPattern.exec(text)) {
        const name = match[2];
        if (name === undefined) {
            continue;
        }
        const localName = name.includes(":") ? name.slice(name.indexOf(":") + 1) : name;
        const isEnd = match[1] === "/";
        const isEmpty = match[4] === "/";

        if (localName === "QueryPlan") {
            if (isEnd) {
                if (queryPlanDepth > 0) {
                    queryPlanDepth--;
                    if (queryPlanDepth === 0) {
                        break;
                    }
                }
                continue;
            }
            const attributes = parseAttributes(match[3]);
            if (!queryPlanSeen) {
                queryPlanSeen = true;
                if (Number(attributes.DegreeOfParallelism) > 1) {
                    parallel = true;
                }
            }
            if (isEmpty) {
                if (queryPlanDepth === 0) {
                    break;
                }
                continue;
            }
            queryPlanDepth++;
            continue;
        }
        // Skip what is outside the first QueryPlan, and in a QueryPlan inside it.
        if (hasQueryPlan && queryPlanDepth !== 1) {
            continue;
        }

        if (localName === "RelOp") {
            if (isEnd) {
                stack.pop();
                continue;
            }
            const attributes = parseAttributes(match[3]);
            if (isTrue(attributes.Parallel)) {
                parallel = true;
            }
            const cost = Number(attributes.EstimatedTotalSubtreeCost);
            const physicalOp = attributes.PhysicalOp ?? attributes.LogicalOp ?? "Unknown";
            operators.push({
                physicalOp,
                ...(attributes.LogicalOp !== undefined ? { logicalOp: attributes.LogicalOp } : {}),
                subtreeCost: Number.isFinite(cost) && cost > 0 ? cost : 0,
                ...(stack.length > 0 ? { parent: stack[stack.length - 1] } : {}),
                childCost: 0,
            });
            if (!isEmpty) {
                stack.push(operators.length - 1);
            }
            continue;
        }

        // The Object of an operator is in the operator, not in one of its child operators.
        if (localName === "Object" && !isEnd && stack.length > 0) {
            const operator = operators[stack[stack.length - 1]];
            if (operator.object === undefined) {
                const attributes = parseAttributes(match[3]);
                const object = unbracket(attributes.Index) ?? unbracket(attributes.Table);
                if (object !== undefined) {
                    operator.object = object;
                }
            }
        }
    }

    for (const operator of operators) {
        if (operator.parent !== undefined) {
            operators[operator.parent].childCost += operator.subtreeCost;
        }
    }
    const ranked = operators
        .map((operator, index) => ({
            index,
            // Twelve significant digits remove the noise of the subtraction.
            ownCost: Math.max(
                0,
                Number((operator.subtreeCost - operator.childCost).toPrecision(12)),
            ),
        }))
        .sort((left, right) => right.ownCost - left.ownCost || left.index - right.index)
        .slice(0, maxOperators)
        .sort((left, right) => left.index - right.index);
    const selected: PlanShapeOperator[] = ranked.map(({ index, ownCost }) => {
        const operator = operators[index];
        return {
            physicalOp: operator.physicalOp,
            ...(operator.logicalOp !== undefined ? { logicalOp: operator.logicalOp } : {}),
            ...(operator.object !== undefined ? { object: operator.object } : {}),
            ownCost,
        };
    });
    return {
        operators: selected,
        parallel,
        summary: selected
            .map((operator) =>
                operator.object ? `${operator.physicalOp} ${operator.object}` : operator.physicalOp,
            )
            .join(" → "),
    };
}

function parseAttributes(text: string | undefined): Record<string, string> {
    const attributes: Record<string, string> = {};
    if (!text) {
        return attributes;
    }
    attributePattern.lastIndex = 0;
    for (let match = attributePattern.exec(text); match; match = attributePattern.exec(text)) {
        attributes[match[1]] = decodeXmlText(match[2] ?? match[3] ?? "");
    }
    return attributes;
}

function decodeXmlText(value: string): string {
    return value.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (entity, code: string) => {
        switch (code) {
            case "amp":
                return "&";
            case "lt":
                return "<";
            case "gt":
                return ">";
            case "quot":
                return '"';
            case "apos":
                return "'";
        }
        const point = code.startsWith("#x")
            ? parseInt(code.slice(2), 16)
            : parseInt(code.slice(1), 10);
        return Number.isInteger(point) && point >= 0 && point <= 0x10ffff
            ? String.fromCodePoint(point)
            : entity;
    });
}

/** Removes the brackets of a delimited name, for example `[PK_Orders]`. */
function unbracket(name: string | undefined): string | undefined {
    const text = name?.trim();
    if (!text) {
        return undefined;
    }
    return text.startsWith("[") && text.endsWith("]") && text.length >= 2
        ? text.slice(1, -1).replace(/\]\]/g, "]")
        : text;
}

function isTrue(value: string | undefined): boolean {
    const text = value?.trim().toLowerCase();
    return text === "1" || text === "true";
}
