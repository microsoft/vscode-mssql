/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * A summary of a showplan: the facts that explain a plan, small enough for a language model or a
 * tooltip. Query Store keeps estimated plans, so the rows are estimates.
 */

/** An operator of a plan, with its own estimated cost. */
export interface PlanOperatorSummary {
    readonly nodeId: number;
    readonly physicalOp: string;
    readonly logicalOp?: string;
    /** `database.schema.table.index`, when the operator reads or writes an object. */
    readonly object?: string;
    readonly estimatedRows?: number;
    /** The rows that the operator reads to return its rows, for scans and seeks with a residual. */
    readonly estimatedRowsRead?: number;
    /** The cost of the operator without its inputs. */
    readonly selfCost: number;
    /** `selfCost` as a part of the statement cost, from 0 to 1. */
    readonly costShare: number;
    readonly executionMode?: string;
    readonly parallel: boolean;
    /** The predicate or seek predicate, shortened. */
    readonly predicate?: string;
    readonly warnings: readonly string[];
}

export interface MissingIndexSummary {
    /** The estimated improvement, from 0 to 100. */
    readonly impact?: number;
    /** `database.schema.table`. */
    readonly table: string;
    readonly equality: readonly string[];
    readonly inequality: readonly string[];
    readonly include: readonly string[];
}

export interface PlanParameterSummary {
    readonly name: string;
    /** The value that the plan was compiled for. */
    readonly compiledValue?: string;
}

export interface PlanStatementSummary {
    readonly statementText?: string;
    readonly statementType?: string;
    readonly estimatedCost?: number;
    readonly estimatedRows?: number;
    /** `TRIVIAL` or `FULL`. */
    readonly optimizationLevel?: string;
    /** Why the optimizer stopped early, for example `TimeOut` or `MemoryLimitExceeded`. */
    readonly earlyAbortReason?: string;
    readonly cardinalityEstimationModelVersion?: number;
    readonly degreeOfParallelism?: number;
    /** The memory that the plan asks for, in KB. */
    readonly memoryGrantKb?: number;
    readonly compileTimeMs?: number;
    readonly compileCpuMs?: number;
    readonly compileMemoryKb?: number;
    /** Statement warnings, for example a convert that affects the plan. */
    readonly warnings: readonly string[];
    readonly missingIndexes: readonly MissingIndexSummary[];
    readonly parameters: readonly PlanParameterSummary[];
    readonly operatorCount: number;
    /** The operators with the highest own cost, highest first. */
    readonly topOperators: readonly PlanOperatorSummary[];
}

export interface PlanSummary {
    readonly statements: readonly PlanStatementSummary[];
    /** The statements left out after the limit. */
    readonly omittedStatements: number;
}

export interface PlanSummaryOptions {
    /** Default 5. */
    readonly maxStatements?: number;
    /** Default 8. */
    readonly maxOperators?: number;
}

const maxTextLength = 500;
const maxPredicateLength = 300;

/**
 * Summarizes showplan XML. Returns undefined when the text is not a showplan. The parser reads
 * elements and attributes only, which is all that showplan uses.
 */
export function summarizePlan(
    planXml: string,
    options: PlanSummaryOptions = {},
): PlanSummary | undefined {
    const root = parseXml(planXml);
    if (!root || root.name !== "ShowPlanXML") {
        return undefined;
    }
    const maxStatements = options.maxStatements ?? 5;
    const statements = descendants(root, "StmtSimple").filter((statement) =>
        statement.children.some((child) => child.name === "QueryPlan"),
    );
    return {
        statements: statements
            .slice(0, maxStatements)
            .map((statement) => summarizeStatement(statement, options.maxOperators ?? 8)),
        omittedStatements: Math.max(0, statements.length - maxStatements),
    };
}

function summarizeStatement(statement: XmlElement, maxOperators: number): PlanStatementSummary {
    const attributes = statement.attributes;
    const queryPlan = statement.children.find((child) => child.name === "QueryPlan")!;
    const memory = queryPlan.children.find((child) => child.name === "MemoryGrantInfo");
    const operators = topLevelRelOps(queryPlan).flatMap(collectOperators);
    const estimatedCost = number(attributes.StatementSubTreeCost);
    const totalCost =
        estimatedCost ?? operators.reduce((sum, operator) => sum + operator.selfCost, 0);
    return {
        statementText: shorten(attributes.StatementText, maxTextLength),
        statementType: attributes.StatementType,
        estimatedCost,
        estimatedRows: number(attributes.StatementEstRows),
        optimizationLevel: attributes.StatementOptmLevel,
        earlyAbortReason: attributes.StatementOptmEarlyAbortReason,
        cardinalityEstimationModelVersion: number(attributes.CardinalityEstimationModelVersion),
        degreeOfParallelism: number(queryPlan.attributes.DegreeOfParallelism),
        memoryGrantKb: number(
            memory?.attributes.SerialDesiredMemory ?? queryPlan.attributes.MemoryGrant,
        ),
        compileTimeMs: number(queryPlan.attributes.CompileTime),
        compileCpuMs: number(queryPlan.attributes.CompileCPU),
        compileMemoryKb: number(queryPlan.attributes.CompileMemory),
        warnings: warningsOf(queryPlan),
        missingIndexes: descendants(queryPlan, "MissingIndexGroup").map(missingIndexOf),
        parameters: (
            queryPlan.children.find((child) => child.name === "ParameterList")?.children ?? []
        )
            .filter((child) => child.name === "ColumnReference")
            .map((parameter) => ({
                name: parameter.attributes.Column ?? "",
                ...(parameter.attributes.ParameterCompiledValue !== undefined
                    ? { compiledValue: parameter.attributes.ParameterCompiledValue }
                    : {}),
            })),
        operatorCount: operators.length,
        topOperators: [...operators]
            .sort((left, right) => right.selfCost - left.selfCost)
            .slice(0, maxOperators)
            .map((operator) => ({
                ...operator,
                costShare: totalCost > 0 ? operator.selfCost / totalCost : 0,
            })),
    };
}

/** Each operator under a RelOp, the RelOp first, with its own cost and no share yet. */
function collectOperators(relOp: XmlElement): Omit<PlanOperatorSummary, "costShare">[] {
    const attributes = relOp.attributes;
    const inputs = childRelOps(relOp);
    const subtreeCost = number(attributes.EstimatedTotalSubtreeCost) ?? 0;
    const inputCost = inputs.reduce(
        (sum, input) => sum + (number(input.attributes.EstimatedTotalSubtreeCost) ?? 0),
        0,
    );
    const own = ownElements(relOp);
    const object = own.find((element) => element.name === "Object");
    const predicate = own.find(
        (element) => element.name === "Predicate" || element.name === "SeekPredicates",
    );
    const scalar = predicate
        ? [predicate, ...descendantsOutsideRelOps(predicate)].find(
              (element) => element.attributes.ScalarString !== undefined,
          )
        : undefined;
    const warnings = relOp.children.find((child) => child.name === "Warnings");
    return [
        {
            nodeId: number(attributes.NodeId) ?? 0,
            physicalOp: attributes.PhysicalOp ?? "",
            ...(attributes.LogicalOp ? { logicalOp: attributes.LogicalOp } : {}),
            ...(object ? { object: objectName(object) } : {}),
            estimatedRows: number(attributes.EstimateRows),
            estimatedRowsRead: number(attributes.EstimatedRowsRead),
            selfCost: Math.max(0, subtreeCost - inputCost),
            executionMode: attributes.EstimatedExecutionMode,
            parallel: attributes.Parallel === "1" || attributes.Parallel === "true",
            ...(scalar
                ? { predicate: shorten(scalar.attributes.ScalarString, maxPredicateLength) }
                : {}),
            warnings: warnings ? warningsIn(warnings) : [],
        },
        ...inputs.flatMap(collectOperators),
    ];
}

function warningsOf(queryPlan: XmlElement): string[] {
    const warnings = queryPlan.children.find((child) => child.name === "Warnings");
    return warnings ? warningsIn(warnings) : [];
}

/** Each warning as its name and its attributes, for example `SpillToTempDb SpillLevel=1`. */
function warningsIn(warnings: XmlElement): string[] {
    const list = Object.entries(warnings.attributes)
        .filter(([, value]) => value === "1" || value === "true")
        .map(([name]) => name);
    for (const warning of warnings.children) {
        const details = Object.entries(warning.attributes)
            .map(([name, value]) => `${name}=${shorten(value, 120)}`)
            .join(" ");
        list.push(details ? `${warning.name} ${details}` : warning.name);
    }
    return list;
}

function missingIndexOf(group: XmlElement): MissingIndexSummary {
    const index = group.children.find((child) => child.name === "MissingIndex");
    const columns = (usage: string) =>
        (index?.children ?? [])
            .filter((child) => child.name === "ColumnGroup" && child.attributes.Usage === usage)
            .flatMap((columnGroup) => columnGroup.children)
            .map((column) => unquote(column.attributes.Name ?? ""));
    return {
        impact: number(group.attributes.Impact),
        table: [index?.attributes.Database, index?.attributes.Schema, index?.attributes.Table]
            .filter((part): part is string => !!part)
            .map(unquote)
            .join("."),
        equality: columns("EQUALITY"),
        inequality: columns("INEQUALITY"),
        include: columns("INCLUDE"),
    };
}

function objectName(object: XmlElement): string {
    return ["Database", "Schema", "Table", "Index"]
        .map((name) => object.attributes[name])
        .filter((part): part is string => !!part)
        .map(unquote)
        .join(".");
}

/** The RelOps right under the plan, outside other RelOps. */
function topLevelRelOps(element: XmlElement): XmlElement[] {
    return element.children.flatMap((child) =>
        child.name === "RelOp" ? [child] : topLevelRelOps(child),
    );
}

/** The inputs of an operator: the nearest RelOps below it. */
function childRelOps(relOp: XmlElement): XmlElement[] {
    return relOp.children.flatMap(topLevelRelOpsOf);
}

function topLevelRelOpsOf(element: XmlElement): XmlElement[] {
    return element.name === "RelOp" ? [element] : element.children.flatMap(topLevelRelOpsOf);
}

/** The elements of an operator, without those of its inputs. */
function ownElements(relOp: XmlElement): XmlElement[] {
    return relOp.children.flatMap((child) =>
        child.name === "RelOp" ? [] : [child, ...descendantsOutsideRelOps(child)],
    );
}

function descendantsOutsideRelOps(element: XmlElement): XmlElement[] {
    return element.children.flatMap((child) =>
        child.name === "RelOp" ? [] : [child, ...descendantsOutsideRelOps(child)],
    );
}

function descendants(element: XmlElement, name: string): XmlElement[] {
    return element.children.flatMap((child) => [
        ...(child.name === name ? [child] : []),
        ...descendants(child, name),
    ]);
}

function number(value: string | undefined): number | undefined {
    if (value === undefined || value.trim() === "") {
        return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function shorten(value: string | undefined, length: number): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    // Each run of whitespace, such as a line break and its indent, becomes one space.
    const text = value.replace(/\s+/g, " ").trim();
    return text.length > length ? `${text.slice(0, length)}…` : text;
}

function unquote(name: string): string {
    return name.startsWith("[") && name.endsWith("]") ? name.slice(1, -1) : name;
}

/** @internal An XML element: its local name, attributes, and child elements. */
export interface XmlElement {
    readonly name: string;
    readonly attributes: Readonly<Record<string, string>>;
    readonly children: XmlElement[];
}

/** The markup that holds no elements, by how it starts and ends. */
const skippedMarkup: readonly (readonly [start: string, end: string])[] = [
    ["<!--", "-->"],
    ["<![CDATA[", "]]>"],
    ["<?", "?>"],
    // A document type declaration. Showplan has none with an internal subset.
    ["<!", ">"],
];

/**
 * @internal Parses the elements and attributes of an XML document. Text, comments, processing
 * instructions, and CDATA are skipped. Returns undefined for text that is not well formed.
 */
export function parseXml(xml: string): XmlElement | undefined {
    const stack: XmlElement[] = [];
    let root: XmlElement | undefined;
    let position = xml.indexOf("<");
    while (position >= 0) {
        const skipped = skippedMarkup.find(([start]) => xml.startsWith(start, position));
        if (skipped) {
            const end = xml.indexOf(skipped[1], position + skipped[0].length);
            if (end < 0) {
                return undefined;
            }
            position = xml.indexOf("<", end + skipped[1].length);
            continue;
        }
        const tag = readTag(xml, position);
        if (!tag) {
            return undefined;
        }
        position = xml.indexOf("<", tag.end);
        if (tag.closing) {
            const open = stack.pop();
            if (!open || open.name !== tag.name) {
                return undefined;
            }
            continue;
        }
        const element: XmlElement = { name: tag.name, attributes: tag.attributes, children: [] };
        const parent = stack[stack.length - 1];
        if (parent) {
            parent.children.push(element);
        } else if (root) {
            return undefined;
        } else {
            root = element;
        }
        if (!tag.empty) {
            stack.push(element);
        }
    }
    return stack.length === 0 ? root : undefined;
}

interface XmlTag {
    readonly name: string;
    readonly attributes: Record<string, string>;
    /** `</name>`. */
    readonly closing: boolean;
    /** `<name />`, which has no children and no end tag. */
    readonly empty: boolean;
    /** The position after the tag's `>`. */
    readonly end: number;
}

/** Reads the start or end tag at `<`, or returns undefined when it is not well formed. */
function readTag(xml: string, start: number): XmlTag | undefined {
    let position = start + 1;
    const closing = xml[position] === "/";
    if (closing) {
        position++;
    }
    const nameStart = position;
    while (position < xml.length && !isNameEnd(xml[position])) {
        position++;
    }
    const name = localName(xml.slice(nameStart, position));
    if (!name) {
        return undefined;
    }
    const attributes: Record<string, string> = {};
    for (;;) {
        position = skipSpace(xml, position);
        if (xml[position] === ">") {
            return { name, attributes, closing, empty: false, end: position + 1 };
        }
        if (!closing && xml.startsWith("/>", position)) {
            return { name, attributes, closing, empty: true, end: position + 2 };
        }
        if (closing || position >= xml.length) {
            return undefined;
        }
        // An attribute: name = "value" or name = 'value'.
        const attributeStart = position;
        while (position < xml.length && !isNameEnd(xml[position]) && xml[position] !== "=") {
            position++;
        }
        const attribute = xml.slice(attributeStart, position);
        position = skipSpace(xml, position);
        if (!attribute || xml[position] !== "=") {
            return undefined;
        }
        position = skipSpace(xml, position + 1);
        const quote = xml[position];
        const valueEnd = quote === '"' || quote === "'" ? xml.indexOf(quote, position + 1) : -1;
        if (valueEnd < 0) {
            return undefined;
        }
        // Namespace declarations are left out: names are read without their prefix.
        if (!attribute.startsWith("xmlns")) {
            attributes[localName(attribute)] = decodeEntities(xml.slice(position + 1, valueEnd));
        }
        position = valueEnd + 1;
    }
}

function isSpace(character: string | undefined): boolean {
    return character === " " || character === "\t" || character === "\n" || character === "\r";
}

/** Whether a character ends a tag or attribute name. */
function isNameEnd(character: string): boolean {
    return isSpace(character) || character === ">" || character === "/";
}

function skipSpace(xml: string, position: number): number {
    while (isSpace(xml[position])) {
        position++;
    }
    return position;
}

function localName(name: string): string {
    const colon = name.indexOf(":");
    return colon >= 0 ? name.slice(colon + 1) : name;
}

const namedEntities: Readonly<Record<string, string>> = {
    lt: "<",
    gt: ">",
    amp: "&",
    quot: '"',
    apos: "'",
};

/**
 * Replaces the entities of an attribute value with their characters. The pattern matches `&`, then
 * a hexadecimal (`#x3C`) or decimal (`#60`) character reference or one of the five named
 * entities, then `;`. The callback gets the part between `&` and `;`.
 */
function decodeEntities(value: string): string {
    return value.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (entity, code: string) => {
        if (code.startsWith("#x")) {
            return String.fromCodePoint(parseInt(code.slice(2), 16));
        }
        if (code.startsWith("#")) {
            return String.fromCodePoint(parseInt(code.slice(1), 10));
        }
        return namedEntities[code] ?? entity;
    });
}
