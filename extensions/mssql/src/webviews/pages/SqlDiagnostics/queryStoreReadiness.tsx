/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useState } from "react";
import { Button, MessageBar, Text, makeStyles, tokens } from "@fluentui/react-components";
import type { QueryStoreReadiness } from "sql-feature/diagnostics/querystore";
import { LocConstants } from "../../common/locConstants";

const useStyles = makeStyles({
    root: {
        padding: "12px",
        display: "flex",
        flexDirection: "column",
        rowGap: "8px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    actions: { display: "flex", gap: "8px", flexWrap: "wrap" },
});

export function QueryStoreReadinessPanel({
    state,
    busy,
    recheck,
    review,
    chooseDatabase,
    database,
}: {
    state: QueryStoreReadiness;
    busy: boolean;
    recheck: () => void;
    review: () => void;
    chooseDatabase: () => void;
    database?: string;
}) {
    const styles = useStyles();
    const loc = LocConstants.getInstance().queryStoreReadiness;
    const settingsLoc = LocConstants.getInstance().queryStoreSettings;
    const [copyStatus, setCopyStatus] = useState<"copied" | "failed" | undefined>(undefined);
    const needsAdminHandoff =
        state.canConfigure === false ||
        state.access === "denied" ||
        state.access === "inconclusive";
    const copyAdminRequest = async () => {
        setCopyStatus(undefined);
        try {
            await navigator.clipboard.writeText(loc.adminRequest(database ?? loc.unknownDatabase));
            setCopyStatus("copied");
        } catch {
            setCopyStatus("failed");
        }
    };
    return (
        <section
            className={styles.root}
            aria-label={LocConstants.getInstance().sqlFeatures.querystore}>
            <MessageBar
                intent={
                    state.access === "denied" ||
                    state.access === "inconclusive" ||
                    state.status === "error" ||
                    state.status === "readOnlyUnexpected"
                        ? "warning"
                        : "info"
                }>
                {loc.status[state.status]}
            </MessageBar>
            {(state.access === "denied" || state.access === "inconclusive") && (
                <Text>{loc.access.resolution}</Text>
            )}
            {state.access === "denied" && <Text>{loc.access.denied}</Text>}
            {state.access === "inconclusive" && state.status === "unknown" && (
                <Text>{loc.access.inconclusive}</Text>
            )}
            {state.error && <Text>{state.error}</Text>}
            {state.readonlyReasons.length > 0 && (
                <ul>
                    {state.readonlyReasons.map((reason) => (
                        <li key={reason}>{loc.reasons[reason]}</li>
                    ))}
                </ul>
            )}
            {state.unknownReasonBits > 0 && (
                <Text>{loc.unknownReasons(state.unknownReasonBits)}</Text>
            )}
            {state.captureMode && <Text>{loc.capture(state.captureMode)}</Text>}
            {state.captureMode && state.captureMode !== "ALL" && (
                <Text>{loc.captureEligibility}</Text>
            )}
            {state.waitCaptureMode && <Text>{loc.waitCapture(state.waitCaptureMode)}</Text>}
            {state.waitCaptureMode && state.waitCaptureMode !== "ON" && (
                <Text>{loc.waitCaptureUnavailable}</Text>
            )}
            {state.actualState !== undefined && (
                <Text>
                    {loc.actual(
                        state.actualState === 2
                            ? settingsLoc.options.READ_WRITE
                            : state.actualState === 1
                              ? settingsLoc.options.READ_ONLY
                              : String(state.actualState),
                    )}
                </Text>
            )}
            {state.desiredState !== undefined && (
                <Text>
                    {loc.desired(
                        state.desiredState === 2
                            ? settingsLoc.options.READ_WRITE
                            : state.desiredState === 1
                              ? settingsLoc.options.READ_ONLY
                              : String(state.desiredState),
                    )}
                </Text>
            )}
            {state.captureMode === "NONE" && <Text>{loc.restricted}</Text>}
            {state.currentStorageMb !== undefined && state.maxStorageMb !== undefined && (
                <Text>{loc.storage(state.currentStorageMb, state.maxStorageMb)}</Text>
            )}
            {state.canConfigure === false && <Text>{loc.admin}</Text>}
            {copyStatus === "copied" && (
                <MessageBar intent="success">{loc.adminRequestCopied}</MessageBar>
            )}
            {copyStatus === "failed" && (
                <MessageBar intent="error">{loc.adminRequestCopyFailed}</MessageBar>
            )}
            <div className={styles.actions}>
                <Button disabled={busy} onClick={chooseDatabase}>
                    {loc.chooseDatabase}
                </Button>
                {state.status !== "unsupported" &&
                    state.access !== "denied" &&
                    state.access !== "inconclusive" && (
                        <Button disabled={busy} onClick={review}>
                            {loc.review}
                        </Button>
                    )}
                {needsAdminHandoff && (
                    <Button disabled={busy} onClick={() => void copyAdminRequest()}>
                        {loc.copyAdminRequest}
                    </Button>
                )}
                <Button disabled={busy} onClick={recheck}>
                    {loc.recheck}
                </Button>
            </div>
        </section>
    );
}
