import { Lexer } from "../../src/parser/saral/parser/lexer.js";
import { Parser } from "../../src/parser/saral/parser/parser.js";
import {
    type SelectNode,
    type InsertNode,
    type UpdateNode,
    type DeleteNode,
    type DeclareNode,
    type SetNode,
    type CreateNode,
    type DropNode,
    type IfNode,
    type BlockNode,
    type IdentifierNode,
    type TableReference,
} from "../../src/parser/saral/ast/types.js";

// ===============================
// Core helpers
// ===============================

export function parseResult(sql: string) {
    return new Parser(new Lexer(sql)).parse();
}

export function parseAst(sql: string) {
    return parseResult(sql).ast;
}

export function parseOne<T = any>(sql: string): T {
    return parseAst(sql).body[0] as T;
}

export function parseBody(sql: string) {
    return parseAst(sql).body;
}

// ===============================
// Typed helpers
// ===============================

export const select = (sql: string) => parseOne<SelectNode>(sql);

export const insert = (sql: string) => parseOne<InsertNode>(sql);

export const update = (sql: string) => parseOne<UpdateNode>(sql);

export const del = (sql: string) => parseOne<DeleteNode>(sql);

export const declareStmt = (sql: string) => parseOne<DeclareNode>(sql);

export const setStmt = (sql: string) => parseOne<SetNode>(sql);

export const createStmt = (sql: string) => parseOne<CreateNode>(sql);

export const dropStmt = (sql: string) => parseOne<DropNode>(sql);

export const ifStmt = (sql: string) => parseOne<IfNode>(sql);

export const blockStmt = (sql: string) => parseOne<BlockNode>(sql);

// ===============================
// Serializer (copy from current tests)
// ===============================

export function toSql(expr: any): string {
    if (!expr) return "";

    if (typeof expr === "string") {
        if (
            expr === "derived_table" ||
            expr === "SelectStatement" ||
            expr.includes("JSON.stringify")
        ) {
            return "SelectStatement";
        }

        return expr;
    }

    switch (expr.type) {
        case "Literal":
            return expr.variant === "string" ? `'${expr.value}'` : String(expr.value);

        case "Identifier":
            return expr.tablePrefix ? `${expr.tablePrefix}.${expr.name}` : expr.name;

        case "Variable":
            return expr.name;

        case "BuiltInArgument":
            return expr.value;

        case "BinaryExpression":
            return `${toSql(expr.left)} ${expr.operator} ${toSql(expr.right)}`;

        case "UnaryExpression": {
            const op = expr.operator.toUpperCase();
            const isPostfix = op.includes("NULL");

            return isPostfix
                ? `${toSql(expr.right)} ${expr.operator}`
                : `${expr.operator} ${toSql(expr.right)}`;
        }

        case "GroupingExpression":
            return `(${toSql(expr.expression)})`;

        case "FunctionCall":
            return `${expr.name}(${expr.args.map(toSql).join(", ")})`;

        case "InExpression": {
            const inner = expr.subquery
                ? "SelectStatement"
                : expr.list
                  ? expr.list.map(toSql).join(", ")
                  : "";

            return `${toSql(expr.left)} ${expr.isNot ? "NOT " : ""}IN (${inner})`;
        }

        case "BetweenExpression":
            return `${toSql(expr.left)} ${expr.isNot ? "NOT " : ""}BETWEEN ${toSql(expr.lowerBound)} AND ${toSql(expr.upperBound)}`;

        case "CaseExpression": {
            let res = "CASE";

            if (expr.input) {
                res += " " + toSql(expr.input);
            }

            expr.branches.forEach((b: any) => {
                res += ` WHEN ${toSql(b.when)} THEN ${toSql(b.then)}`;
            });

            if (expr.elseBranch) {
                res += ` ELSE ${toSql(expr.elseBranch)}`;
            }

            return res + " END";
        }

        case "SubqueryExpression":
            return "SelectStatement";

        case "ValuesTableExpression":
            return "ValuesTable";

        case "ExistsExpression":
            return `EXISTS (${toSql(expr.query)})`;

        default:
            return expr.type ? `[Unhandled Node: ${expr.type}]` : "";
    }
}

export function getTableName(expr: any): string {
    if (!expr) return "";

    if (expr.type === "Identifier") {
        return expr.parts.join(".");
    }

    if (expr.type === "MemberExpression") {
        return expr.name;
    }

    if (expr.type === "SubqueryExpression") {
        return "SUBQUERY";
    }

    if (expr.type === "ValuesTableExpression") {
        return "VALUES";
    }

    return "";
}

// ===============================
// Assertion helpers
// ===============================

export const sql = (node: any) => toSql(node);
export const table = (node: any) => getTableName(node);

export function expectSql(node: any, expected: string) {
    expect(sql(node)).toBe(expected);
}

export function expectTable(node: any, expected: string) {
    expect(table(node)).toBe(expected);
}

// convenience
export function firstFrom(sqlText: string): TableReference {
    return select(sqlText).from![0] as TableReference;
}

export function id(node: any): IdentifierNode {
    return node as IdentifierNode;
}
