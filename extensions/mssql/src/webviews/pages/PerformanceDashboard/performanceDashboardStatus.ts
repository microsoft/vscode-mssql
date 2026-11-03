/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type PerformanceRead,
    type PerformanceUnavailable,
} from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import type { ExtensionRequestState } from "../../common/useExtensionRequest";
import type { SettingsSection } from "./performanceDashboardRoutes";

export interface StatusMessage {
    readonly intent: "info" | "warning" | "error";
    /** A title before the text, for a message that replaces the page, such as Query Store off. */
    readonly title?: string;
    readonly text: string;
    /** A page that explains how to fix the cause, for a link after the text. */
    readonly learnMore?: { readonly text: string; readonly url: string };
    /** The settings section that can fix the cause, for a link in the message. */
    readonly settingsSection?: SettingsSection;
}

/** How to turn on Query Store, on Microsoft Learn. */
const enableQueryStoreUrl =
    "https://learn.microsoft.com/sql/relational-databases/performance/monitoring-performance-by-using-the-query-store#enable-the-query-store";

/**
 * The message for a read that has nothing to show: the database cannot be read, Query Store is
 * off, the platform does not record the data, a permission is missing, or the read failed.
 * Undefined while the read runs, and when it has data or no rows.
 */
export function readStatusMessage(
    state: ExtensionRequestState<PerformanceRead<unknown>>,
): StatusMessage | undefined {
    const text = loc.performanceDashboard;
    if (state.stale) {
        return undefined;
    }
    if (state.errorMessage) {
        return { intent: "error", text: text.readFailed(state.errorMessage) };
    }
    const result = state.result;
    if (!result) {
        return undefined;
    }
    if (result.status === "unavailable") {
        return unavailableMessage(result);
    }
    const errorText = result.error?.message ?? "";
    switch (result.status) {
        case "notConfigured":
            return {
                intent: "warning",
                title: text.queryStoreOffTitle,
                text: text.queryStoreOff,
                learnMore: { text: text.enableQueryStoreLink, url: enableQueryStoreUrl },
                settingsSection: "queryStore",
            };
        case "unsupported":
            return { intent: "info", text: text.metricUnsupported };
        case "permissionMissing":
            return { intent: "warning", text: text.permissionMissing };
        case "temporarilyUnavailable":
            return { intent: "warning", text: text.temporarilyUnavailable(errorText) };
        case "failed":
            return { intent: "error", text: text.readFailed(errorText) };
        default:
            return undefined;
    }
}

function unavailableMessage(unavailable: PerformanceUnavailable): StatusMessage {
    const text = loc.performanceDashboard;
    switch (unavailable.reason) {
        case "dataPlaneDisabled":
            return { intent: "info", text: text.dataPlaneDisabled };
        case "reloadRequired":
            return { intent: "info", text: text.reloadRequired };
        case "dataPlaneUnavailable":
            return { intent: "error", text: text.dataPlaneUnavailable };
        case "connectionNotFound":
            return { intent: "warning", text: text.connectionNotFound };
        case "authenticationUnsupported":
            return { intent: "warning", text: text.authenticationUnsupported };
        default:
            return {
                intent: "error",
                text: text.connectionFailed(unavailable.detail ?? unavailable.reason),
            };
    }
}
