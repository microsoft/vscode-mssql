/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, Text, tokens } from "@fluentui/react-components";
import * as React from "react";
import { DiagnosticEvent } from "../../../../cloudDeploy/diagnostics/types";
import { locConstants } from "../../../common/locConstants";
import { describeEvent } from "./humanize";

const useStyles = makeStyles({
    table: {
        width: "100%",
        borderCollapse: "collapse",
        fontSize: "13px",
    },
    th: {
        textAlign: "left",
        padding: "5px 10px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        color: tokens.colorNeutralForeground3,
        fontWeight: 600,
        fontSize: "11px",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
    },
    td: {
        padding: "6px 10px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
        verticalAlign: "middle",
    },
    time: {
        fontFamily: "var(--vscode-editor-font-family), monospace",
        whiteSpace: "nowrap",
        color: tokens.colorNeutralForeground3,
    },
    marker: {
        display: "inline-block",
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        marginRight: "8px",
        verticalAlign: "middle",
    },
    empty: {
        color: tokens.colorNeutralForeground3,
        fontSize: "13px",
    },
});

/**
 * Color for the timeline dot, keyed off the event's outcome where it carries
 * one, so a reader can scan the column and spot the failure at a glance.
 */
function markerColor(event: DiagnosticEvent): string {
    const status = (event as { readonly payload?: { status?: string } }).payload?.status;
    switch (status) {
        case "passed":
            return tokens.colorPaletteGreenForeground1;
        case "failed":
        case "errored":
            return tokens.colorPaletteRedForeground1;
        case "warning":
            return tokens.colorPaletteYellowForeground1;
        case "skipped":
        case "cancelled":
            return tokens.colorNeutralForeground4;
        default:
            return tokens.colorBrandForeground1;
    }
}

/**
 * Renders the diagnostic events captured in a run's artifact as a chronological,
 * plain-English timeline. Times are shown relative to the first event so the
 * reader sees how the run unfolded, and each row reads like a sentence rather
 * than a raw event type plus a key=value bag.
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
                    <th className={classes.th}>{strings.timelineColEvent}</th>
                </tr>
            </thead>
            <tbody>
                {events.map((event) => (
                    <tr key={event.id}>
                        <td className={`${classes.td} ${classes.time}`}>
                            {strings.timelineRelativeMs(Math.max(0, event.timestampMs - baseMs))}
                        </td>
                        <td className={classes.td}>
                            <span
                                className={classes.marker}
                                style={{ backgroundColor: markerColor(event) }}
                            />
                            {describeEvent(event)}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
};
