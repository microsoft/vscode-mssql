/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, Text, tokens } from "@fluentui/react-components";
import * as React from "react";
import { DiagnosticEvent } from "../../../../cloudDeploy/diagnostics/types";
import { locConstants } from "../../../common/locConstants";

const useStyles = makeStyles({
    table: {
        width: "100%",
        borderCollapse: "collapse",
        fontSize: "12px",
    },
    th: {
        textAlign: "left",
        padding: "4px 8px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        color: tokens.colorNeutralForeground3,
        fontWeight: 600,
    },
    td: {
        padding: "4px 8px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
        verticalAlign: "top",
    },
    mono: {
        fontFamily: "var(--vscode-editor-font-family), monospace",
        whiteSpace: "nowrap",
    },
    details: {
        fontFamily: "var(--vscode-editor-font-family), monospace",
        wordBreak: "break-all",
    },
    empty: {
        color: tokens.colorNeutralForeground3,
        fontSize: "13px",
    },
});

/**
 * Renders the diagnostic events captured in a run's artifact as a chronological
 * table. Resolves D3-Part-2 feature B (event timeline / replay). Times are
 * shown relative to the first event so the reader sees how the run unfolded.
 */
export const EventTimeline: React.FC<{ events: readonly DiagnosticEvent[] }> = ({ events }) => {
    const classes = useStyles();
    const strings = locConstants.cloudDeployHub;

    if (events.length === 0) {
        return <Text className={classes.empty}>{strings.timelineEmpty}</Text>;
    }

    const baseMs = events[0].timestampMs;

    return (
        <table className={classes.table}>
            <thead>
                <tr>
                    <th className={classes.th}>{strings.timelineColTime}</th>
                    <th className={classes.th}>{strings.timelineColCategory}</th>
                    <th className={classes.th}>{strings.timelineColType}</th>
                    <th className={classes.th}>{strings.timelineColDetails}</th>
                </tr>
            </thead>
            <tbody>
                {events.map((event) => (
                    <tr key={event.id}>
                        <td className={`${classes.td} ${classes.mono}`}>
                            {strings.timelineRelativeMs(Math.max(0, event.timestampMs - baseMs))}
                        </td>
                        <td className={classes.td}>{event.source}</td>
                        <td className={classes.td}>{event.type}</td>
                        <td className={`${classes.td} ${classes.details}`}>
                            {summarizePayload(event)}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
};

/**
 * Renders an event's payload as a compact `key=value` string. Diagnostic
 * payloads are flat id/count bags, so a shallow projection reads cleanly
 * without a per-event-type renderer.
 */
function summarizePayload(event: DiagnosticEvent): string {
    const payload = (event as { readonly payload?: Record<string, unknown> }).payload;
    if (payload === undefined || payload === null) {
        return "";
    }
    return Object.entries(payload)
        .map(([key, value]) => `${key}=${formatValue(value)}`)
        .join("  ");
}

function formatValue(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.length}]`;
    }
    if (typeof value === "object" && value !== null) {
        return JSON.stringify(value);
    }
    return String(value);
}
