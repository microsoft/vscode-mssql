/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Pure validation for the PERF_MODE-only Query Studio activation command. */

import {
    QsActivatableTab,
    QsActivateTabRequest,
    QsPerfInteractionAction,
} from "../sharedInterfaces/queryStudio";
import { QueryStudioCore as QueryStudioCoreLoc } from "../constants/locConstants";

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

const ACTIVATABLE_TABS: ReadonlySet<string> = new Set(["results", "messages", "queryPlan"]);
function record(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
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
    return {
        value: {
            ...(rawUri ? { uri: rawUri as string } : {}),
            activation: { tab },
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
