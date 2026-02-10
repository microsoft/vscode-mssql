/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, ToolbarButton, Tooltip, makeStyles } from "@fluentui/react-components";
import { Sparkle16Regular } from "@fluentui/react-icons";
import { useContext } from "react";
import eventBus from "../schemaDesignerEvents";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { locConstants } from "../../../common/locConstants";
import { getVisiblePendingAiSchemaChanges } from "../aiLedger/ledgerUtils";

const useStyles = makeStyles({
    container: {
        position: "relative",
        display: "inline-flex",
    },
    badge: {
        position: "absolute",
        right: "-5px",
        top: "0px",
        padding: "0 3px",
        borderRadius: "7px",
        border: "1px solid var(--vscode-panel-background)",
        boxSizing: "border-box",
        pointerEvents: "none",
    },
});

export function ShowPendingAiChangesButton() {
    const context = useContext(SchemaDesignerContext);
    const classes = useStyles();
    const pendingAiCount = getVisiblePendingAiSchemaChanges(context.aiLedger).length;
    if (pendingAiCount === 0) {
        return null;
    }

    return (
        <Tooltip
            content={locConstants.schemaDesigner.pendingAiChangesButtonLabel(pendingAiCount)}
            relationship="label">
            <span className={classes.container}>
                <ToolbarButton
                    onClick={() => {
                        eventBus.emit("openChangesPanel", "pendingAi");
                    }}
                    icon={<Sparkle16Regular />}
                />
                <Badge size="small" className={classes.badge}>
                    {pendingAiCount}
                </Badge>
            </span>
        </Tooltip>
    );
}
