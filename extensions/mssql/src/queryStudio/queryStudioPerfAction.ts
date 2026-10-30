/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Pure validation for the PERF_MODE-only Query Studio activation command. */

import {
    QsActivatableTab,
    QsActivateTabRequest,
    QsPerfInteractionAction,
    QsVectorPerfAction,
} from "../sharedInterfaces/queryStudio";
import {
    QueryStudioCore as QueryStudioCoreLoc,
    VectorWorkbenchMessages as VectorWorkbenchLoc,
} from "../constants/locConstants";
import { VECTOR_SEARCH_MAX_K, VECTOR_SEARCH_MIN_K } from "../sharedInterfaces/vectorSearch";

export interface NormalizedQueryStudioPerfActivateTabArgs {
    readonly uri?: string;
    readonly activation: QsActivateTabRequest;
}

export type QueryStudioPerfActivateTabNormalization =
    | { readonly value: NormalizedQueryStudioPerfActivateTabArgs }
    | { readonly error: string };

export interface NormalizedQueryStudioPerfInteractionArgs {
    readonly uri?: string;
    readonly action: QsPerfInteractionAction;
}

export type QueryStudioPerfInteractionNormalization =
    | { readonly value: NormalizedQueryStudioPerfInteractionArgs }
    | { readonly error: string };

const ACTIVATABLE_TABS: ReadonlySet<string> = new Set([
    "results",
    "messages",
    "queryPlan",
    "vector",
]);
const PERF_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_IDENTIFIER_LENGTH = 128;

function record(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function identifier(value: unknown): string | undefined {
    return typeof value === "string" &&
        value.length > 0 &&
        value.length <= MAX_IDENTIFIER_LENGTH &&
        PERF_IDENTIFIER.test(value)
        ? value
        : undefined;
}

function normalizeVectorAction(value: unknown): QsVectorPerfAction | undefined {
    const action = record(value);
    if (action?.["workspace"] === "projection") {
        return { workspace: "projection" };
    }
    if (action?.["workspace"] !== "search") {
        return undefined;
    }
    const search = record(action["search"]);
    const source = record(search?.["source"]);
    const target = record(search?.["target"]);
    const ordinal = source?.["ordinal"];
    const metric = search?.["metric"];
    const k = search?.["k"];
    const includeApprox = search?.["includeApprox"];
    const schema = identifier(target?.["schema"]);
    const table = identifier(target?.["table"]);
    const vectorColumn = identifier(target?.["vectorColumn"]);
    if (
        source?.["kind"] !== "selectedRow" ||
        !Number.isSafeInteger(ordinal) ||
        (ordinal as number) < 0 ||
        (metric !== "cosine" && metric !== "euclidean" && metric !== "dot") ||
        !Number.isInteger(k) ||
        (k as number) < VECTOR_SEARCH_MIN_K ||
        (k as number) > VECTOR_SEARCH_MAX_K ||
        typeof includeApprox !== "boolean" ||
        !schema ||
        !table ||
        !vectorColumn
    ) {
        return undefined;
    }
    return {
        workspace: "search",
        search: {
            source: { kind: "selectedRow", ordinal: ordinal as number },
            target: { schema, table, vectorColumn },
            metric,
            k: k as number,
            includeApprox,
        },
    };
}

/**
 * Reconstructs the supported command shape from unknown input. Unknown keys
 * are never forwarded, which keeps SQL/text/vector payloads out of the seam.
 */
export function normalizeQueryStudioPerfActivateTabArgs(
    input: unknown,
): QueryStudioPerfActivateTabNormalization {
    if (input === undefined) {
        return { value: { activation: { tab: "results" } } };
    }
    const args = record(input);
    if (!args) {
        return { error: QueryStudioCoreLoc.queryStudioTabActivationArgumentsMustBeAn };
    }
    const rawTab = args["tab"] ?? "results";
    if (typeof rawTab !== "string" || !ACTIVATABLE_TABS.has(rawTab)) {
        return { error: QueryStudioCoreLoc.queryStudioTabActivationRequestedAnUnsupportedTab };
    }
    const tab = rawTab as QsActivatableTab;
    const rawUri = args["uri"];
    if (rawUri !== undefined && (typeof rawUri !== "string" || rawUri.length === 0)) {
        return { error: QueryStudioCoreLoc.queryStudioTabActivationURIMustBeA };
    }
    let vector: QsVectorPerfAction | undefined;
    if (args["vector"] !== undefined) {
        if (tab !== "vector") {
            return { error: VectorWorkbenchLoc.aVectorActionRequiresTheVectorResultsTab };
        }
        vector = normalizeVectorAction(args["vector"]);
        if (!vector) {
            return {
                error: VectorWorkbenchLoc.queryStudioReceivedAnInvalidVectorPerformanceAction,
            };
        }
    }
    return {
        value: {
            ...(rawUri ? { uri: rawUri as string } : {}),
            activation: { tab, ...(vector ? { vector } : {}) },
        },
    };
}

export function normalizeQueryStudioPerfInteractionArgs(
    input: unknown,
): QueryStudioPerfInteractionNormalization {
    const args = record(input);
    const action = record(args?.["action"]);
    if (!args || !action) {
        return { error: QueryStudioCoreLoc.queryStudioInteractionArgumentsMustIncludeAnAction };
    }
    const rawUri = args["uri"];
    if (rawUri !== undefined && (typeof rawUri !== "string" || rawUri.length === 0)) {
        return { error: QueryStudioCoreLoc.queryStudioInteractionURIMustBeANon };
    }
    let normalized: QsPerfInteractionAction;
    if (action["kind"] === "copyMessages") {
        normalized = { kind: "copyMessages" };
    } else if (action["kind"] === "selectGrid" || action["kind"] === "copyGrid") {
        const resultSetIndex = action["resultSetIndex"];
        if (
            !Number.isSafeInteger(resultSetIndex) ||
            (resultSetIndex as number) < 0 ||
            (resultSetIndex as number) > 10_000 ||
            action["selection"] !== "all" ||
            (action["kind"] === "copyGrid" && typeof action["includeHeaders"] !== "boolean")
        ) {
            return { error: QueryStudioCoreLoc.queryStudioReceivedAnInvalidGridSelectionCopy };
        }
        normalized =
            action["kind"] === "copyGrid"
                ? {
                      kind: "copyGrid",
                      resultSetIndex: resultSetIndex as number,
                      selection: "all",
                      includeHeaders: action["includeHeaders"] as boolean,
                  }
                : {
                      kind: "selectGrid",
                      resultSetIndex: resultSetIndex as number,
                      selection: "all",
                  };
    } else if (action["kind"] === "scrollResultStack") {
        const target = action["target"];
        if (target !== "start" && target !== "middle" && target !== "end") {
            return {
                error: QueryStudioCoreLoc.queryStudioInteractionRequestedAnUnsupportedScrollTarget,
            };
        }
        normalized = { kind: "scrollResultStack", target };
    } else if (action["kind"] === "sweepResultStack") {
        const steps = action["steps"];
        if (!Number.isSafeInteger(steps) || (steps as number) < 2 || (steps as number) > 64) {
            return { error: QueryStudioCoreLoc.queryStudioReceivedAnInvalidResultStackSweep };
        }
        normalized = { kind: "sweepResultStack", steps: steps as number };
    } else if (action["kind"] === "scrollGrid") {
        const resultSetIndex = action["resultSetIndex"];
        const axis = action["axis"];
        const target = action["target"];
        if (
            !Number.isSafeInteger(resultSetIndex) ||
            (resultSetIndex as number) < 0 ||
            (resultSetIndex as number) > 10_000 ||
            (axis !== "vertical" && axis !== "horizontal") ||
            (target !== "start" && target !== "middle" && target !== "end")
        ) {
            return { error: QueryStudioCoreLoc.queryStudioReceivedAnInvalidGridScrollAction };
        }
        normalized = {
            kind: "scrollGrid",
            resultSetIndex: resultSetIndex as number,
            axis,
            target,
        };
    } else {
        return { error: QueryStudioCoreLoc.queryStudioInteractionRequestedAnUnsupportedAction };
    }
    return {
        value: {
            ...(rawUri ? { uri: rawUri as string } : {}),
            action: normalized,
        },
    };
}
