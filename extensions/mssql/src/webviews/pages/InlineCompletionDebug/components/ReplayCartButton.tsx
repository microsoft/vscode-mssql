/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Tooltip, makeStyles, shorthands } from "@fluentui/react-components";
import { ArrowSyncRegular } from "@fluentui/react-icons";
import { useInlineCompletionDebugSelector } from "../inlineCompletionDebugSelector";
import { useInlineCompletionDebugContext } from "../inlineCompletionDebugStateProvider";

const useStyles = makeStyles({
    button: {
        height: "28px",
        minWidth: "auto",
        ...shorthands.padding("0", "10px"),
    },
    activeButton: {
        backgroundColor: "var(--vscode-button-background)",
        color: "var(--vscode-button-foreground)",
        ":hover": {
            backgroundColor: "var(--vscode-button-hoverBackground)",
            color: "var(--vscode-button-foreground)",
        },
    },
    count: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: "18px",
        height: "18px",
        marginLeft: "6px",
        ...shorthands.padding("0", "5px"),
        ...shorthands.borderRadius("999px"),
        backgroundColor: "color-mix(in srgb, var(--vscode-focusBorder) 20%, transparent)",
        color: "var(--vscode-focusBorder)",
        fontFamily: "var(--vscode-editor-font-family, Consolas, monospace)",
        fontSize: "11px",
        lineHeight: "18px",
    },
    activeCount: {
        backgroundColor: "color-mix(in srgb, var(--vscode-button-foreground) 22%, transparent)",
        color: "var(--vscode-button-foreground)",
    },
});

export function ReplayCartButton() {
    const classes = useStyles();
    const replay = useInlineCompletionDebugSelector((state) => state.replay);
    const { openReplayBuilder } = useInlineCompletionDebugContext();
    const activeRun = replay.runs.find((run) => run.id === replay.activeRunId);
    const runIsActive =
        !!activeRun && (activeRun.status === "queued" || activeRun.status === "running");
    const disabled = replay.cart.length === 0 && !runIsActive;
    const label = runIsActive
        ? `Replay running ${activeRun.completedEvents}/${activeRun.totalEvents}`
        : "Replay";
    const tooltip = runIsActive
        ? "Open the replay trace builder while the current run continues"
        : replay.cart.length > 0
          ? "Open the replay trace builder"
          : "Add events to the replay trace first";

    return (
        <Tooltip content={tooltip} relationship="label">
            <Button
                className={`${classes.button} ${runIsActive ? classes.activeButton : ""}`}
                appearance={runIsActive ? "primary" : "secondary"}
                size="small"
                disabled={disabled}
                icon={<ArrowSyncRegular />}
                onClick={openReplayBuilder}>
                {label}
                <span className={`${classes.count} ${runIsActive ? classes.activeCount : ""}`}>
                    {replay.cart.length}
                </span>
            </Button>
        </Tooltip>
    );
}
