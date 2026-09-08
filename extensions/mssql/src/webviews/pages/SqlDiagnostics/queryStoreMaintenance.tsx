/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useState } from "react";
import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Text,
    MessageBar,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import type {
    QueryStoreInterventionCapabilities,
    QueryStoreMaintenanceAction,
} from "sql-feature/diagnostics/querystore";
import { LocConstants } from "../../common/locConstants";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "12px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    actions: { display: "flex", gap: "8px", flexWrap: "wrap" },
});

export function QueryStoreMaintenance({
    capabilities,
    busy,
    outcome,
    run,
}: {
    capabilities: QueryStoreInterventionCapabilities;
    busy: boolean;
    outcome?: {
        action: QueryStoreMaintenanceAction;
        outcome: "verified" | "acceptedUnverified";
    };
    run: (action: QueryStoreMaintenanceAction) => void;
}) {
    const styles = useStyles();
    const loc = LocConstants.getInstance().queryStoreReadiness;
    const [pending, setPending] = useState<QueryStoreMaintenanceAction>();
    const actions: QueryStoreMaintenanceAction[] = ["flush", "clearHistory", "disable"];
    return (
        <section className={styles.root} aria-label={loc.maintenanceTitle}>
            <Text weight="semibold">{loc.maintenanceTitle}</Text>
            <Text size={200}>{loc.maintenanceDescription}</Text>
            {outcome && (
                <MessageBar intent={outcome.outcome === "verified" ? "success" : "warning"}>
                    {outcome.outcome === "verified"
                        ? loc.maintenanceVerified(loc.maintenance[outcome.action])
                        : loc.maintenanceAcceptedUnverified(loc.maintenance[outcome.action])}
                </MessageBar>
            )}
            <div className={styles.actions}>
                {actions.map((action) =>
                    capabilities.maintenance[action] ? (
                        <Button key={action} disabled={busy} onClick={() => setPending(action)}>
                            {loc.maintenance[action]}
                        </Button>
                    ) : null,
                )}
            </div>
            <Dialog
                open={pending !== undefined}
                onOpenChange={(_, data) => !data.open && setPending(undefined)}>
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>
                            {pending && loc.maintenanceReview(loc.maintenance[pending])}
                        </DialogTitle>
                        <DialogContent>
                            {pending && loc.maintenanceConfirm(loc.maintenance[pending])}
                        </DialogContent>
                        <DialogActions>
                            <Button onClick={() => setPending(undefined)}>
                                {LocConstants.getInstance().common.cancel}
                            </Button>
                            <Button
                                appearance="primary"
                                disabled={busy || pending === undefined}
                                onClick={() => {
                                    if (pending) run(pending);
                                    setPending(undefined);
                                }}>
                                {LocConstants.getInstance().common.apply}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
        </section>
    );
}
