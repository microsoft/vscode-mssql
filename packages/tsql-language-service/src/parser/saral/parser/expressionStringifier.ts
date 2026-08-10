/*
 * Derived from SaralSQL commit e95951c1ba48c41c026a1244ac23cedc2ced7fb7.
 * Copyright (c) Saral Simon Stalin. Licensed under the MIT License.
 * See packages/tsql-language-service/third-party/saralsql/LICENSE and NOTICE.md.
 */

import { type Expression } from "../ast/types.js";

export function stringifyExpression(expr: Expression | null): string {
    if (!expr) {
        return "<missing>";
    }

    switch (expr.type) {
        case "WildcardExpression": {
            if (expr.tablePrefix) {
                return `${stringifyExpression(expr.tablePrefix)}.*`;
            }
            return "*";
        }

        case "Literal":
            return expr.variant === "string" ? `'${expr.value}'` : String(expr.value);

        case "Identifier":
            return expr.name;

        case "Variable":
            return expr.name;

        case "BuiltInArgument":
            return expr.value;

        case "SubqueryExpression":
            return "derived_table";

        case "ValuesTableExpression":
            return "values_table";

        case "BinaryExpression": {
            const left = stringifyExpression(expr.left);
            const right = stringifyExpression(expr.right);

            if (!expr.right && expr.incomplete) {
                return `${left} ${expr.operator}`;
            }

            return `${left} ${expr.operator} ${right}`;
        }

        case "UnaryExpression": {
            const rightSide = stringifyExpression(expr.right);
            const isPostfix = ["IS NULL", "IS NOT NULL"].includes(expr.operator.toUpperCase());

            if (!expr.right && expr.incomplete) {
                return isPostfix ? expr.operator : `${expr.operator}`;
            }

            return isPostfix ? `${rightSide} ${expr.operator}` : `${expr.operator} ${rightSide}`;
        }

        case "BetweenExpression": {
            const left = stringifyExpression(expr.left);
            const lower = stringifyExpression(expr.lowerBound);
            const upper = stringifyExpression(expr.upperBound);

            return `${left} ${expr.isNot ? "NOT " : ""}BETWEEN ${lower} AND ${upper}`;
        }

        case "FunctionCall":
            return `${expr.name}(${expr.args.map((a) => stringifyExpression(a)).join(", ")})`;

        case "GroupingExpression":
            return `(${stringifyExpression(expr.expression)})`;

        case "CaseExpression":
            return "CASE ... END";

        case "InExpression": {
            const left = stringifyExpression(expr.left);

            if (expr.subquery) {
                return `${left} ${expr.isNot ? "NOT " : ""}IN (subquery)`;
            }

            const list = expr.list?.length
                ? expr.list.map((x) => stringifyExpression(x)).join(", ")
                : "";

            return `${left} ${expr.isNot ? "NOT " : ""}IN (${list})`;
        }

        case "MemberExpression":
            return expr.name || `${stringifyExpression(expr.object)}.${expr.property}`;

        case "OverExpression":
            return `${stringifyExpression(expr.expression)} OVER (...)`;

        default:
            return "";
    }
}
