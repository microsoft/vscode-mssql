/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { MetadataView, ObjectResolution } from "../../metadata/index.js";
import type { SyntaxNode, SyntaxToken } from "../../syntax/index.js";
import {
    containsSyntaxError,
    directChildrenOfKind,
    firstDescendantOfKind,
} from "../../syntax/treeUtilities.js";
import type { TextRange } from "../../text/index.js";
import {
    compactMultipartName,
    multipartIdentifierPartRange,
    multipartIdentifierParts,
} from "../identifiers.js";
import type { DiagnosticFamilyContext } from "./contracts.js";

export interface TriggerDiagnosticContext extends DiagnosticFamilyContext {
    readonly metadata: MetadataView;
    equal(left: string, right: string): boolean;
    significantTokens(range: TextRange, limit: number): readonly SyntaxToken[];
    localRelationKnownAt(parts: readonly string[], offset: number): boolean;
}

/** Validates DML triggers against target metadata and loaded trigger/foreign-key state. */
export function validateTriggerCatalog(context: TriggerDiagnosticContext): void {
    for (const kind of ["CreateTriggerStatement", "AlterTriggerStatement"] as const) {
        for (const statement of context.nodes(kind)) {
            if (containsSyntaxError(statement)) continue;
            validateTriggerStatement(context, statement, kind === "AlterTriggerStatement");
        }
    }
}

function validateTriggerStatement(
    context: TriggerDiagnosticContext,
    statement: SyntaxNode,
    alterOnly: boolean,
): void {
    const nameNode = firstDescendantOfKind(statement, "MultipartIdentifier");
    const targetNode = firstDescendantOfKind(statement, "TriggerTarget");
    const targetNameNode = targetNode && firstDescendantOfKind(targetNode, "MultipartIdentifier");
    if (!nameNode || !targetNameNode) return;
    const triggerName = compactMultipartName(context.source(nameNode));
    const triggerParts = multipartIdentifierParts(triggerName);
    const targetName = compactMultipartName(context.source(targetNameNode));
    const targetParts = multipartIdentifierParts(targetName);
    if (targetParts.at(-1)?.startsWith("#")) return;
    if (context.localRelationKnownAt(targetParts, targetNameNode.start)) return;

    const triggerSchema = triggerParts.length >= 2 ? triggerParts.at(-2)! : undefined;
    const declaredTarget = context.metadata.resolveObject(targetParts);
    if (declaredTarget.kind !== "resolved") return;
    const target = declaredTarget.object;
    const activation = triggerActivation(context, statement);
    const ownerResolution = triggerOwnerResolution(
        context,
        targetParts,
        triggerSchema,
        alterOnly,
        declaredTarget,
    );
    const owner = ownerResolution?.kind === "resolved" ? ownerResolution.object : undefined;
    const targetTriggers = context.metadata.triggerState(target.ref);
    const existingHere =
        targetTriggers.kind === "loaded"
            ? targetTriggers.value.find((candidate) =>
                  context.equal(candidate.name, triggerParts.at(-1)!),
              )
            : undefined;
    let carriedOut = false;

    if (alterOnly) {
        if (owner !== undefined && owner.ref.id !== target.ref.id) {
            context.add(
                "TriggerDoesNotBelongToTarget",
                `Cannot alter trigger '${triggerName}' on '${targetName}' because this trigger does not belong to this object. Specify the correct trigger name or the correct target object name.`,
                nameNode,
            );
        } else if (targetTriggers.kind === "loaded" && existingHere) carriedOut = true;
    } else if (targetTriggers.kind === "loaded") {
        if (triggerSchema !== undefined && owner !== undefined && owner.ref.id !== target.ref.id) {
            context.add(
                "InvalidTriggerSchema",
                `Cannot create trigger '${triggerName}' because its schema is different from the schema of the target table or view.`,
                multipartIdentifierPartRange(
                    context.source(nameNode),
                    nameNode.start,
                    triggerParts.length - 2,
                    nameNode,
                ),
            );
        } else if (!existingHere) carriedOut = true;
    }

    if (target.kind === "view") {
        if (!activation.insteadOf) {
            context.add(
                "RequiredInsteadOfTriggerOnView",
                `Cannot create trigger '${triggerName}' on '${targetName}'. Only INSTEAD OF triggers are valid on views.`,
                nameNode,
            );
        }
        if (target.checkOption === true) {
            context.add(
                "CannotCreateTriggerOnViewWithCheckOption",
                `Cannot create trigger '${triggerName}' on '${targetName}' because the view is defined with CHECK OPTION.`,
                nameNode,
            );
        }
    } else if (carriedOut && activation.insteadOf) {
        const foreignKeys = context.metadata.foreignKeyState(target.ref);
        if (foreignKeys.kind === "loaded") {
            for (const action of ["UPDATE", "DELETE"] as const) {
                if (!activation[action === "UPDATE" ? "update" : "delete"]) continue;
                const cascades = foreignKeys.value.some(
                    (key) =>
                        (action === "UPDATE" ? key.updateAction : key.deleteAction) === "cascade",
                );
                if (!cascades) continue;
                context.add(
                    "CannotCreateInsteadOfTriggerOnTableWithCascade",
                    `Cannot create INSTEAD OF ${action} trigger '${triggerName}' on '${targetName}'. This is because table has a FOREIGN KEY with cascading ${action}.`,
                    nameNode,
                );
            }
        }
    }

    if (!carriedOut || !activation.insteadOf || targetTriggers.kind !== "loaded") return;
    for (const action of ["DELETE", "INSERT", "UPDATE"] as const) {
        const flag = action === "DELETE" ? "delete" : action === "INSERT" ? "insert" : "update";
        if (!activation[flag]) continue;
        const conflict = targetTriggers.value.some(
            (candidate) =>
                candidate !== existingHere && candidate.insteadOf === true && candidate[flag],
        );
        if (!conflict) continue;
        context.add(
            "DuplicateInsteadOfTrigger",
            `Cannot create trigger '${triggerName}' on '${targetName}' because an INSTEAD OF ${action} trigger already exists on this object.`,
            nameNode,
        );
    }
}

function triggerOwnerResolution(
    context: TriggerDiagnosticContext,
    targetParts: readonly string[],
    triggerSchema: string | undefined,
    alterOnly: boolean,
    declaredTarget: ObjectResolution,
): ObjectResolution | undefined {
    if (triggerSchema === undefined && !alterOnly) return declaredTarget;
    const objectName = targetParts.at(-1)!;
    const database = targetParts.length >= 3 ? [targetParts.at(-3)!] : [];
    return context.metadata.resolveObject(
        triggerSchema === undefined
            ? [...database, objectName]
            : [...database, triggerSchema, objectName],
    );
}

function triggerActivation(
    context: TriggerDiagnosticContext,
    statement: SyntaxNode,
): { insteadOf: boolean; insert: boolean; update: boolean; delete: boolean } {
    const events = firstDescendantOfKind(statement, "TriggerEventList");
    const actions = new Set(
        events
            ? directChildrenOfKind(events, "TriggerEvent").map((event) =>
                  context.source(event).trim().toUpperCase(),
              )
            : [],
    );
    const prefix = events
        ? context
              .significantTokens({ start: statement.start, end: events.start }, 16)
              .map((token) => token.text.toUpperCase())
        : [];
    return {
        insteadOf: prefix.at(-2) === "INSTEAD" && prefix.at(-1) === "OF",
        insert: actions.has("INSERT"),
        update: actions.has("UPDATE"),
        delete: actions.has("DELETE"),
    };
}
