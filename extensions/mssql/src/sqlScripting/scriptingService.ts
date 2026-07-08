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
import { quoteIdentifier } from "../sqlLanguage/core/quote";
import {
    ScriptMetadataProvenance,
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
import { ScriptWriter } from "./scriptWriter";

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
                return ["create", "drop", "selectTop", "insert", "update", "delete"];
            case "view":
                return [...moduleOperations(createOrAlter), "drop", "selectTop"];
            case "procedure":
                return [...moduleOperations(createOrAlter), "drop", "execute"];
            case "scalarFunction":
                return [...moduleOperations(createOrAlter), "drop"];
            case "tableFunction":
                return [...moduleOperations(createOrAlter), "drop", "selectTop"];
            case "synonym":
                return ["drop"];
            default:
                return []; // target metadata not hydrated — nothing honest to offer
        }
    }

    async script(request: ScriptRequest): Promise<ScriptResult> {
        // CACHE-6 strict gate (base §10.3, addendum §7.5): the host's
        // ensureFresh verdict arrives as request data. "unavailable" means
        // the policy's freshness bar was not met — refuse honestly (the B12
        // pattern) BEFORE consulting the pinned snapshot, which may be
        // retained but unproven (addendum C-7).
        const provenance = request.provenance;
        if (provenance !== undefined && provenance.freshness === "unavailable") {
            const info = this.pinned.getObject(request.target.ref);
            const refusal =
                provenance.source === "offline"
                    ? this.unavailable(request, info, "offline", [
                          "offline mode is active and no metadata snapshot is available for this database",
                      ])
                    : this.unavailable(request, info, "notValidated", [
                          "live metadata refresh failed or timed out — retry after a successful refresh, or enable mssql.metadataCache.offlineMode to script from the retained snapshot",
                      ]);
            return withProvenance(refusal, provenance);
        }
        return withProvenance(await this.scriptCore(request), provenance);
    }

    private async scriptCore(request: ScriptRequest): Promise<ScriptResult> {
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
                return this.scriptDrop(request, info);
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

    private scriptDrop(request: ScriptRequest, info: LangObjectInfo): ScriptResult {
        const keyword = dropKeyword(info.kind);
        const writer = new ScriptWriter();
        writer.anchored({ kind: "header" }, `DROP ${keyword}`);
        writer.append(` ${quoteIdentifier(info.schema)}.`);
        writer.anchored({ kind: "objectName" }, quoteIdentifier(info.name));
        writer.append(";\r\n");
        return {
            text: writer.text,
            anchors: writer.anchors,
            fidelityNotes: [],
            fidelity: "F0",
            source: "template",
            metadataGeneration: this.pinned.generation,
            operation: request.operation,
            objectKind: info.kind,
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

function dropKeyword(kind: LangObjectKind): string {
    switch (kind) {
        case "table":
            return "TABLE";
        case "view":
            return "VIEW";
        case "procedure":
            return "PROCEDURE";
        case "scalarFunction":
        case "tableFunction":
            return "FUNCTION";
        case "synonym":
            return "SYNONYM";
    }
}

/**
 * Echo the request provenance onto the result (ONE source of truth), and —
 * only when a script was actually produced from an offline snapshot — render
 * the base §16.3 offline banner from the SAME fields. Refusals never carry
 * the banner (their comment text already tells the truth), but they keep
 * the provenance so telemetry stays coherent.
 */
function withProvenance(
    result: ScriptResult,
    provenance: ScriptMetadataProvenance | undefined,
): ScriptResult {
    if (provenance === undefined) {
        return result;
    }
    const stamped: ScriptResult = { ...result, provenance };
    if (provenance.source !== "offline" || stamped.unavailableReason !== undefined) {
        return stamped;
    }
    return prependBanner(stamped, offlineBannerLines(provenance));
}

/** Base §16.3 scripting header, verbatim — derived only from provenance. */
function offlineBannerLines(provenance: ScriptMetadataProvenance): readonly string[] {
    return [
        "-- Generated from offline metadata snapshot.",
        provenance.capturedAtUtc !== undefined
            ? `-- Snapshot captured at ${provenance.capturedAtUtc}.`
            : "-- Snapshot capture time is unknown.",
        "-- Live drift validation was not performed.",
    ];
}

/** Prepend header comment lines, shifting every anchor exactly. */
function prependBanner(result: ScriptResult, banner: readonly string[]): ScriptResult {
    const prefix = banner.join("\r\n") + "\r\n";
    return {
        ...result,
        text: prefix + result.text,
        anchors: result.anchors.map((anchor) => ({
            ...anchor,
            span: {
                start: anchor.span.start + prefix.length,
                end: anchor.span.end + prefix.length,
            },
            line: anchor.line + banner.length,
        })),
    };
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
