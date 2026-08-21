/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { firstDescendantOfKind, parentOfKind } from "../../syntax/treeUtilities.js";
import type { TextRange } from "../../text/index.js";
import { isNamedRoutineArgumentLabel } from "../routineCall.js";
import type { DiagnosticFamilyContext } from "./contracts.js";

export interface VariableDiagnosticContext extends DiagnosticFamilyContext {
    fold(value: string): string;
    variableDeclarations(): readonly {
        readonly name: string;
        readonly node: TextRange;
        readonly scope: string;
    }[];
    variableDeclaredAt(name: string, offset: number, requireTable: boolean): boolean;
}

/** Validates declaration uniqueness and variable visibility within parser-owned scopes. */
export function validateVariables(context: VariableDiagnosticContext): void {
    const declarations = context.variableDeclarations();
    const declarationsByScope = new Map<string, Map<string, (typeof declarations)[number]>>();
    for (const declaration of declarations) {
        const names =
            declarationsByScope.get(declaration.scope) ??
            new Map<string, (typeof declarations)[number]>();
        const key = context.fold(declaration.name);
        if (names.has(key)) {
            context.add(
                "VariableNameNotUnique",
                `The variable name '${declaration.name}' has already been declared.Variable names must be unique within a query batch or stored procedure.`,
                declaration.node,
            );
        } else {
            names.set(key, declaration);
        }
        declarationsByScope.set(declaration.scope, names);
    }

    const declarationRanges = new Set(declarations.map(({ node }) => `${node.start}:${node.end}`));
    for (const variable of context.nodes("Variable")) {
        if (declarationRanges.has(`${variable.start}:${variable.end}`)) continue;
        const name = context.source(variable);
        if (name.startsWith("@@")) continue;
        if (parentOfKind(variable, "VariableTableSource")) continue;
        const namedArgument = parentOfKind(variable, "NamedExecuteArgument");
        if (
            namedArgument &&
            variable.start === firstDescendantOfKind(namedArgument, "Variable")?.start
        ) {
            continue;
        }
        if (isNamedRoutineArgumentLabel(variable)) continue;
        if (!context.variableDeclaredAt(name, variable.start, false)) {
            context.add(
                "ScalarVariableRequired",
                `Must declare the scalar variable "${name}".`,
                variable,
            );
        }
    }
}
