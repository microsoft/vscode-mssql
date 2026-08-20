/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LanguageServiceRuntime } from "../runtime/index.js";
import { CatalogFeatureContext } from "./catalogFeatureContext.js";
import { qualifiedCatalogName } from "./catalogPresentation.js";
import type { SignatureHelp } from "./contracts.js";
import { assertDocumentOffset } from "./featureSnapshotUtilities.js";
import { localRelationColumnsForName } from "./querySources.js";
import {
    builtInSignatureHelp,
    insertSignatureHelp,
    localRoutineAt,
    routineSignatureHelp,
    signatureContext,
} from "./signatureHelp.js";

/** Signature help over one published semantic snapshot and its pinned metadata generation. */
export class SignatureFeatureProvider {
    public constructor(
        private readonly _runtime: LanguageServiceRuntime,
        private readonly _catalog: CatalogFeatureContext,
    ) {}

    public signatureHelp(uri: string, version: number, offset: number): SignatureHelp | undefined {
        const snapshot = this._runtime.snapshot(uri, version);
        assertDocumentOffset(snapshot, offset);
        const view = snapshot.metadata;
        const context = signatureContext(snapshot, offset);
        if (!context) return undefined;

        if (context.kind === "insert") {
            const resolution = view.resolveObject(context.target);
            const columns =
                resolution.kind === "resolved"
                    ? this._catalog.columns(view, resolution.object, "signatureHelp")
                    : {
                          value: localRelationColumnsForName(snapshot, context.target, offset),
                          incomplete: resolution.kind === "unknown",
                      };
            if (!columns.value) return undefined;
            const selected = context.columns
                ? context.columns.map(
                      (name) =>
                          columns.value!.find((column) =>
                              view.nameComparison.equals(column.name, name),
                          ) ?? { name },
                  )
                : columns.value.filter((column) => !column.identity && !column.computed);
            return selected.length > 0 ? insertSignatureHelp(context, selected) : undefined;
        }

        const local = localRoutineAt(snapshot, view, context.target, offset, context.kind);
        if (local) return routineSignatureHelp(context, local.displayName, local.parameters);

        const resolution = view.resolveObject(context.target);
        const expectedKinds =
            context.kind === "execute" ? ["procedure"] : ["scalarFunction", "tableFunction"];
        if (resolution.kind === "resolved" && expectedKinds.includes(resolution.object.kind)) {
            const state = view.parameterState(resolution.object.ref);
            if (state.kind === "loaded") {
                this._catalog.noteResident(
                    {
                        section: "parameters",
                        object: resolution.object.ref,
                        priority: "interactive",
                    },
                    "signatureHelp",
                );
            } else {
                this._catalog.hydrate(
                    {
                        section: "parameters",
                        object: resolution.object.ref,
                        priority: "interactive",
                    },
                    "signatureHelp",
                );
                if (state.kind !== "failed" || !state.previous) return undefined;
            }
            const parameters = [...(state.kind === "loaded" ? state.value : (state.previous ?? []))]
                .filter((parameter) => parameter.ordinal > 0)
                .sort((left, right) => left.ordinal - right.ordinal);
            return routineSignatureHelp(
                context,
                qualifiedCatalogName(resolution.object),
                parameters,
                resolution.object.extendedProcedure === true,
            );
        }

        return context.kind === "function"
            ? builtInSignatureHelp(context, snapshot.syntax.profile)
            : undefined;
    }
}
