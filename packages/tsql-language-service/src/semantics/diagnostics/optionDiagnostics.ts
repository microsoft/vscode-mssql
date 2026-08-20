/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SyntaxKind, SyntaxNode } from "../../syntax/index.js";
import {
    containsSyntaxError,
    descendantsOwnedByKind,
    directChildrenOfKind,
    firstDescendantOfKind,
    parentOfKind,
} from "../../syntax/treeUtilities.js";
import {
    multipartIdentifierPartRange,
    multipartIdentifierParts,
    normalizeIdentifier,
} from "../identifiers.js";
import { rowsetNameNode, rowsetNameOwnerKinds } from "../model/nameNodes.js";
import type { DiagnosticFamilyContext } from "./contracts.js";

const viewOptions = new Set(["ENCRYPTION", "SCHEMABINDING", "VIEW_METADATA"]);
const legacyCreateIndexOptionNames = new Set([
    "DROP_EXISTING",
    "IGNORE_DUP_KEY",
    "PAD_INDEX",
    "SORT_IN_TEMPDB",
    "STATISTICS_NORECOMPUTE",
]);
const recognizedModuleOptions = new Set([
    "ENCRYPTION",
    "RESULT SETS",
    "NATIVE_COMPILATION",
    "RECOMPILE",
    "SCHEMABINDING",
    "VIEW_METADATA",
]);
const moduleOptionNames = new Set([
    "CALLED ON NULL INPUT",
    "ENCRYPTION",
    "EXECUTE AS",
    "INLINE",
    "NATIVE_COMPILATION",
    "RECOMPILE",
    "RETURNS NULL ON NULL INPUT",
    "SCHEMABINDING",
    "VIEW_METADATA",
]);
const moduleOptionStatements: readonly {
    readonly clause: SyntaxKind;
    readonly option: SyntaxKind;
    readonly allowed: ReadonlySet<string>;
    readonly code: string;
    readonly message: string;
}[] = [
    {
        clause: "ProcedureWithClause",
        option: "ProcedureOption",
        allowed: new Set([
            "ENCRYPTION",
            "EXECUTE AS",
            "NATIVE_COMPILATION",
            "RECOMPILE",
            "SCHEMABINDING",
        ]),
        code: "InvalidOptionInCreateProcedure",
        message: 'An invalid option was specified for the statement "CREATE/ALTER PROCEDURE".',
    },
    {
        clause: "TriggerWithClause",
        option: "TriggerOption",
        allowed: new Set(["ENCRYPTION", "EXECUTE AS", "NATIVE_COMPILATION", "SCHEMABINDING"]),
        code: "InvalidOptionInCreateTrigger",
        message: 'An invalid option was specified for the statement "CREATE/ALTER TRIGGER".',
    },
];

const defaultKillVariant = ["STATS", "JOB"] as const;
const killVariantWords: readonly (readonly string[])[] = [
    defaultKillVariant,
    ["QUERY", "NOTIFICATION", "SUBSCRIPTION"],
];
const partitionScopedOptionNames = new Set(["DATA_COMPRESSION", "XML_COMPRESSION"]);

/** Validates index, module, view, execution, and principal option contracts. */
export function validateOptions(context: DiagnosticFamilyContext): void {
    for (const clause of context.nodes("LegacyCreateIndexWithClause")) {
        for (const option of directChildrenOfKind(clause, "LegacyCreateIndexOption")) {
            const nameNode = [...option.children()][0];
            if (!nameNode) continue;
            const displayName = context.source(nameNode).trim();
            const name = normalizeIdentifier(displayName).toUpperCase();
            const assigned = firstDescendantOfKind(option, "Equal") !== undefined;
            const valid =
                (name === "FILLFACTOR" && assigned) ||
                (!assigned && legacyCreateIndexOptionNames.has(name));
            if (valid) continue;
            context.add(
                "InvalidUsageOfIndexOption",
                `Invalid usage of the option ${displayName} in the CREATE INDEX statement.`,
                nameNode,
            );
        }
    }

    for (const clause of context.nodes("ExecuteWithClause")) {
        if (containsSyntaxError(clause)) continue;
        for (const option of directChildrenOfKind(clause, "ExecuteOption")) {
            const invalid = firstDescendantOfKind(option, "InvalidExecuteModuleOption");
            if (!invalid) continue;
            context.add(
                "InvalidExecuteOption",
                'An invalid option was specified for the statement "EXECUTE".',
                invalid,
            );
        }
    }

    for (const hint of context.nodes("TableHint")) {
        const nameNode = firstDescendantOfKind(hint, "TableHintName");
        if (!nameNode) continue;
        const displayName = normalizeIdentifier(context.source(nameNode));
        if (validTableHintNames.has(displayName.toUpperCase())) continue;
        context.add(
            "InvalidTableHint",
            `${displayName} is not a recognized table hints option. If it is intended as a parameter to a table-valued function, ensure that your database compatibility mode is set to 90.`,
            nameNode,
        );
    }

    for (const module of moduleOptionStatements) {
        for (const clause of context.nodes(module.clause)) {
            if (containsSyntaxError(clause)) continue;
            const seen = new Set<string>();
            for (const option of directChildrenOfKind(clause, module.option)) {
                const name = moduleOptionDisplayName(context.source(option));
                if (name !== "EXECUTE AS" && !recognizedModuleOptions.has(name)) {
                    context.add(
                        "OptionNotRecognized",
                        `'${name}' is not a recognized option.`,
                        option,
                    );
                } else if (!module.allowed.has(name)) {
                    context.add(module.code, module.message, option);
                } else if (seen.has(name)) {
                    context.add(
                        "OptionSpecifiedMultipleTimes",
                        `Option '${name}' is specified more than once.`,
                        option,
                    );
                }
                seen.add(name);
            }
        }
    }

    const duplicateGroups: SyntaxNode[][] = [];
    for (const clause of [
        ...context.nodes("FunctionWithClause"),
        ...context.nodes("ExecuteWithClause"),
    ]) {
        duplicateGroups.push(
            [...clause.children()].filter(
                (child) => child.kind === "FunctionOption" || child.kind === "ExecuteOption",
            ),
        );
    }
    for (const clause of context.nodes("ViewOptionClause")) {
        const options = directChildrenOfKind(clause, "IdentifierName");
        duplicateGroups.push(options);
        for (const option of options) {
            const name = normalizeIdentifier(context.source(option)).toUpperCase();
            if (viewOptions.has(name)) continue;
            if (moduleOptionNames.has(name)) {
                context.add(
                    "InvalidOptionInCreateView",
                    'An invalid option was specified for the statement "CREATE/ALTER VIEW".',
                    option,
                );
            } else {
                context.add("OptionNotRecognized", `'${name}' is not a recognized option.`, option);
            }
        }
    }
    for (const group of duplicateGroups) validateDuplicateOptions(context, group);

    for (const clause of context.nodes("LoginCreationClause")) {
        const modifiers = directChildrenOfKind(clause, "LoginPasswordModifier");
        validateDuplicateOptions(context, modifiers);
        const hashed = modifiers.find(
            (modifier) => firstWord(context.source(modifier)).toUpperCase() === "HASHED",
        );
        if (hashed && modifiers.some((modifier) => modifier.start < hashed.start)) {
            context.add(
                "IncorrectOptionOrder",
                "'HASHED' is specified at incorrect location.",
                hashed,
            );
        }
        validateDuplicateOptions(context, [
            ...directChildrenOfKind(clause, "LoginPasswordOption"),
            ...directChildrenOfKind(clause, "PrincipalOption"),
        ]);
    }
}

/** Validates deliberately permissive grammar tails after the parser has established ownership. */
export function validatePermissiveKeywordTails(context: DiagnosticFamilyContext): void {
    for (const statement of context.nodes("KillStatement")) {
        if (containsSyntaxError(statement)) continue;
        const words = directChildrenOfKind(statement, "IdentifierName");
        if (words.length < 2) continue;
        const spellings = words.map((word) => context.source(word).trim().toUpperCase());
        const variant =
            killVariantWords.find((candidate) => candidate[0] === spellings[0]) ??
            defaultKillVariant;
        for (const [index, word] of words.entries()) {
            const expected = variant[index] ?? variant[variant.length - 1];
            if (expected === spellings[index]) continue;
            context.add(
                "ExpectedTokenNotFound",
                `Expected ${expected} but encountered ${context.source(word).trim()} instead.`,
                word,
            );
            break;
        }
    }

    for (const clause of context.nodes("OptionPartitionsClause")) {
        const option = clause.parent();
        if (!option || containsSyntaxError(option)) continue;
        const nameNode = firstDescendantOfKind(option, "GenericOptionName");
        if (!nameNode) continue;
        const name = normalizeIdentifier(context.source(nameNode)).toUpperCase();
        if (partitionScopedOptionNames.has(name)) continue;
        const near = firstDescendantOfKind(clause, "On") ?? clause;
        context.add(
            "IncorrectSyntaxNear",
            `Incorrect syntax near '${context.source(near).trim()}'.`,
            clause,
        );
    }

    for (const option of context.nodes("FunctionOption")) {
        if (containsSyntaxError(option)) continue;
        const nameNode = directChildrenOfKind(option, "IdentifierName")[0];
        if (!nameNode) continue;
        const spelling = context.source(nameNode).trim();
        if (normalizeIdentifier(spelling).toUpperCase() === "INLINE") continue;
        context.add("IncorrectSyntaxNear", `Incorrect syntax near '${spelling}'.`, nameNode);
    }

    for (const nameNode of context.nodes("GenericOptionName")) {
        const spelling = context.source(nameNode).trim();
        if (!spelling.toUpperCase().startsWith("SERVER ")) continue;
        const enclosing = parentOfKind(nameNode.parent() ?? nameNode, "GenericOption");
        const owner = enclosing ? firstDescendantOfKind(enclosing, "GenericOptionName") : undefined;
        const ownerName = owner ? normalizeIdentifier(context.source(owner)).toUpperCase() : "";
        if (ownerName === "ENCRYPTION") continue;
        context.add(
            "IncorrectSyntaxNear",
            `Incorrect syntax near '${firstWord(spelling)}'.`,
            nameNode,
        );
    }

    const overLongReported = new Set<string>();
    for (const owner of rowsetNameOwnerKinds.flatMap((kind) => [...context.nodes(kind)])) {
        const nameNode = rowsetNameNode(owner);
        if (!nameNode || containsSyntaxError(nameNode)) continue;
        const key = `${nameNode.start}:${nameNode.end}`;
        if (overLongReported.has(key)) continue;
        overLongReported.add(key);
        const spelling = context.source(nameNode);
        const parts = multipartIdentifierParts(spelling);
        if (parts.length <= 4) continue;
        context.add(
            "IncorrectSyntaxNear",
            `Incorrect syntax near '${parts[4]}'.`,
            multipartIdentifierPartRange(spelling, nameNode.start, 4, nameNode),
        );
    }

    for (const option of context.nodes("GenericOption")) {
        if (containsSyntaxError(option)) continue;
        const executeAs = directChildrenOfKind(option, "Execute")[0];
        if (!executeAs) continue;
        const enclosing = parentOfKind(option, "GenericOption");
        const owner = enclosing ? firstDescendantOfKind(enclosing, "GenericOptionName") : undefined;
        const ownerName = owner ? normalizeIdentifier(context.source(owner)).toUpperCase() : "";
        if (ownerName === "ACTIVATION") continue;
        context.add("IncorrectSyntaxNear", "Incorrect syntax near 'EXECUTE'.", executeAs);
    }

    for (const definition of [
        ...context.nodes("InlineIndexDefinition"),
        ...context.nodes("ColumnInlineIndexDefinition"),
    ]) {
        if (containsSyntaxError(definition)) continue;
        if (firstDescendantOfKind(definition, "Columnstore")) continue;
        for (const nameNode of descendantsOwnedByKind(
            definition,
            "GenericOptionName",
            definition,
        )) {
            const spelling = context.source(nameNode).trim();
            if (normalizeIdentifier(spelling).toUpperCase() !== "COMPRESSION_DELAY") continue;
            context.add("IncorrectSyntaxNear", `Incorrect syntax near '${spelling}'.`, nameNode);
        }
    }
}

const validTableHintNames = new Set([
    "FASTFIRSTROW",
    "FORCESEEK",
    "FORCESCAN",
    "FORCE_ANN_ONLY",
    "HOLDLOCK",
    "INDEX",
    "IGNORE_CONSTRAINTS",
    "IGNORE_TRIGGERS",
    "KEEPIDENTITY",
    "KEEPDEFAULTS",
    "NOEXPAND",
    "NOLOCK",
    "NOWAIT",
    "PAGLOCK",
    "READCOMMITTED",
    "READCOMMITTEDLOCK",
    "READPAST",
    "READUNCOMMITTED",
    "REPEATABLEREAD",
    "ROWLOCK",
    "SERIALIZABLE",
    "SNAPSHOT",
    "SPATIAL_WINDOW_MAX_CELLS",
    "TABLOCK",
    "TABLOCKX",
    "UPDLOCK",
    "XLOCK",
]);

function validateDuplicateOptions(
    context: DiagnosticFamilyContext,
    options: readonly SyntaxNode[],
): void {
    const seen = new Set<string>();
    for (const option of options) {
        const name = optionName(context, option);
        if (!name) continue;
        if (seen.has(name)) {
            context.add(
                "OptionSpecifiedMultipleTimes",
                `Option '${name}' is specified more than once.`,
                option,
            );
        }
        seen.add(name);
    }
}

function optionName(context: DiagnosticFamilyContext, option: SyntaxNode): string | undefined {
    const named =
        firstDescendantOfKind(option, "GenericOptionName") ??
        firstDescendantOfKind(option, "IdentifierName") ??
        [...option.children()][0];
    return named ? firstWord(context.source(named)).toUpperCase() : undefined;
}

function moduleOptionDisplayName(source: string): string {
    const value = source.trim();
    const upper = value.toUpperCase();
    if (upper.startsWith("EXECUTE AS")) return "EXECUTE AS";
    if (upper.startsWith("RESULT SETS")) return "RESULT SETS";
    return normalizeIdentifier(value).toUpperCase();
}

// Called only with one parser-owned option/name node; splitting on trivia is lexical, not a second
// statement parser.
function firstWord(source: string): string {
    return source.trim().split(/\s+/u, 1)[0] ?? "";
}
