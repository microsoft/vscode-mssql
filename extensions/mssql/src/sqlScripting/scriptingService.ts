/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SqlScriptingService facade (design 05 §13.1, B12/LS-4): routes a script
 * request to the right emitter by object kind + operation over ONE pinned
 * metadata view (a request never mixes generations, §4.3):
 *
 *   modules (view/procedure/functions) → ModuleEmitter over the lazily
 *     fetched catalog definition (sys.sql_modules through the provider
 *     seam's sanctioned getDefinition); CREATE OR ALTER gated on the
 *     server capability (2016 SP1+ programmability, §1.2);
 *   tables → CreateTableEmitter (F1→F2 as metadata allows);
 *   DML templates → DmlTemplateEmitter (F0).
 *
 * Encrypted / permission-hidden / not-loaded definitions produce an HONEST
 * result: explanatory comment text + unavailableReason, never a fabricated
 * body. Pure: no vscode, no node builtins, no I/O beyond getDefinition
 * (lint-enforced).
 */

import { IPinnedMetadataView, LangObjectInfo, LangObjectKind } from "../sqlLanguage/provider/types";
import {
    ScriptOperation,
    ScriptRequest,
    ScriptResult,
    ScriptTarget,
    ScriptUnavailableReason,
    SqlScriptingService,
} from "./api";
import { emitCreateTable } from "./createTableEmitter";
import {
    emitDelete,
    emitExecute,
    emitInsert,
    emitSelectTop,
    emitUpdate,
} from "./dmlTemplateEmitter";
import { emitModuleScript, moduleOperations } from "./moduleEmitter";

const MODULE_KINDS: ReadonlySet<LangObjectKind> = new Set([
    "view",
    "procedure",
    "scalarFunction",
    "tableFunction",
]);

export class SqlScriptingEngine implements SqlScriptingService {
    constructor(private readonly pinned: IPinnedMetadataView) {}

    capabilities(target: ScriptTarget): readonly ScriptOperation[] {
        const info = this.pinned.getObject(target.ref);
        if (info === undefined) {
            return [];
        }
        const createOrAlter = this.pinned.env.capabilities.createOrAlterProgrammability;
        switch (info.kind) {
            case "table":
                return ["create", "selectTop", "insert", "update", "delete"];
            case "view":
                return [...moduleOperations(createOrAlter), "selectTop"];
            case "procedure":
                return [...moduleOperations(createOrAlter), "execute"];
            case "scalarFunction":
                return moduleOperations(createOrAlter);
            case "tableFunction":
                return [...moduleOperations(createOrAlter), "selectTop"];
            case "synonym":
            default:
                return []; // target metadata not hydrated — nothing honest to offer
        }
    }

    async script(request: ScriptRequest): Promise<ScriptResult> {
        const info = this.pinned.getObject(request.target.ref);
        if (info === undefined) {
            return this.unavailable(request, undefined, "notLoaded", [
                "the object is not present in the pinned metadata generation",
            ]);
        }
        const operation = request.operation;
        if (operation === "create" || operation === "alter" || operation === "createOrAlter") {
            if (info.kind === "table") {
                return operation === "create"
                    ? this.scriptTable(request, info)
                    : this.unavailable(request, info, "unsupported", [
                          "tables support create scripting only (no stored definition to rewrite)",
                      ]);
            }
            if (MODULE_KINDS.has(info.kind)) {
                return this.scriptModule(request, info, operation);
            }
            return this.unavailable(request, info, "unsupported", [
                "synonym targets are not hydrated — definition scripting unavailable",
            ]);
        }
        switch (operation) {
            case "selectTop":
            case "insert":
            case "update":
            case "delete":
                return this.scriptDmlTemplate(request, info, operation);
            case "execute":
                return this.scriptExecute(request, info);
            case "drop":
            case "dropAndCreate":
            default:
                return this.unavailable(request, info, "unsupported", [
                    `operation '${operation}' is not implemented by the scripting engine yet`,
                ]);
        }
    }

    private async scriptModule(
        request: ScriptRequest,
        info: LangObjectInfo,
        operation: "create" | "alter" | "createOrAlter",
    ): Promise<ScriptResult> {
        if (this.pinned.getDefinition === undefined) {
            return this.unavailable(request, info, "offline", [
                "no metadata connection — module definitions cannot be read",
            ]);
        }
        const definition = await this.pinned.getDefinition(info.ref);
        if (definition.text === undefined) {
            const reason: ScriptUnavailableReason =
                definition.unavailableReason === "encrypted"
                    ? "encrypted"
                    : definition.unavailableReason === "permission"
                      ? "permission"
                      : definition.unavailableReason === "unsupported"
                        ? "unsupported"
                        : "notLoaded";
            return this.unavailable(request, info, reason, [moduleUnavailableNote(reason)]);
        }
        const emitted = emitModuleScript({
            info,
            definitionText: definition.text,
            operation,
            createOrAlterSupported: this.pinned.env.capabilities.createOrAlterProgrammability,
        });
        return {
            text: emitted.text,
            anchors: emitted.anchors,
            fidelityNotes: emitted.fidelityNotes,
            fidelity: "F2",
            source: "catalogDefinition",
            metadataGeneration: this.pinned.generation,
            operation,
            objectKind: info.kind,
            ...(emitted.unavailable !== undefined
                ? { unavailableReason: emitted.unavailable }
                : {}),
        };
    }

    private scriptTable(request: ScriptRequest, info: LangObjectInfo): ScriptResult {
        const columns = this.readyColumns(info);
        if (columns === undefined) {
            return this.unavailable(request, info, "notLoaded", [
                "column metadata is not fully ready — a partial table script would mislead",
            ]);
        }
        const emitted = emitCreateTable(info, columns, this.pinned);
        return {
            text: emitted.text,
            anchors: emitted.anchors,
            fidelityNotes: emitted.fidelityNotes,
            fidelity: emitted.fidelity,
            source: "synthesized",
            metadataGeneration: this.pinned.generation,
            operation: request.operation,
            objectKind: info.kind,
        };
    }

    private scriptDmlTemplate(
        request: ScriptRequest,
        info: LangObjectInfo,
        operation: "selectTop" | "insert" | "update" | "delete",
    ): ScriptResult {
        if (info.kind !== "table" && !(info.kind === "view" && operation === "selectTop")) {
            return this.unavailable(request, info, "unsupported", [
                `'${operation}' templates are not offered for ${info.kind} objects`,
            ]);
        }
        const columns = this.readyColumns(info);
        if (columns === undefined) {
            return this.unavailable(request, info, "notLoaded", [
                "column metadata is not fully ready — templates need trustworthy columns",
            ]);
        }
        const emitted =
            operation === "selectTop"
                ? emitSelectTop(info, columns)
                : operation === "insert"
                  ? emitInsert(info, columns)
                  : operation === "update"
                    ? emitUpdate(info, columns)
                    : emitDelete(info, columns);
        return {
            text: emitted.text,
            anchors: emitted.anchors,
            fidelityNotes: emitted.fidelityNotes,
            fidelity: "F0",
            source: "template",
            metadataGeneration: this.pinned.generation,
            operation,
            objectKind: info.kind,
        };
    }

    private scriptExecute(request: ScriptRequest, info: LangObjectInfo): ScriptResult {
        if (info.kind !== "procedure") {
            return this.unavailable(request, info, "unsupported", [
                "execute templates are offered for procedures only",
            ]);
        }
        const parameters =
            this.pinned.readiness.parameters === "ready"
                ? this.pinned.getParameters(info.ref)
                : undefined;
        const emitted = emitExecute(info, parameters);
        return {
            text: emitted.text,
            anchors: emitted.anchors,
            fidelityNotes: emitted.fidelityNotes,
            fidelity: "F0",
            source: "template",
            metadataGeneration: this.pinned.generation,
            operation: request.operation,
            objectKind: info.kind,
        };
    }

    /** Columns only when the section is fully ready (never a partial claim). */
    private readyColumns(info: LangObjectInfo) {
        if (this.pinned.readiness.columns !== "ready") {
            return undefined;
        }
        const columns = this.pinned.getColumns(info.ref);
        return columns === undefined || columns.length === 0 ? undefined : columns;
    }

    private unavailable(
        request: ScriptRequest,
        info: LangObjectInfo | undefined,
        reason: ScriptUnavailableReason,
        notes: readonly string[],
    ): ScriptResult {
        const label = info !== undefined ? `${info.schema}.${info.name}` : "the requested object";
        return {
            text: `-- Cannot script ${label}: ${notes[0] ?? reason}.\r\n`,
            anchors: [],
            fidelityNotes: notes,
            fidelity: "F0",
            source: "synthesized",
            metadataGeneration: this.pinned.generation,
            operation: request.operation,
            objectKind: info?.kind ?? "table",
            unavailableReason: reason,
        };
    }
}

function moduleUnavailableNote(reason: ScriptUnavailableReason): string {
    switch (reason) {
        case "encrypted":
            return "the module is encrypted (WITH ENCRYPTION) — its definition cannot be read";
        case "permission":
            return "the definition is not visible to this login (VIEW DEFINITION permission)";
        case "unsupported":
            return "this object kind has no readable module definition";
        default:
            return "the module definition has not been loaded";
    }
}
