/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, ToolbarButton, Tooltip, makeStyles } from "@fluentui/react-components";
import { BranchCompare20Regular } from "@fluentui/react-icons";
import { useContext } from "react";
import eventBus from "../schemaDesignerEvents";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { locConstants } from "../../../common/locConstants";

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

export function ShowChangesButton() {
    const context = useContext(SchemaDesignerContext);
    const classes = useStyles();
    const isDabEnabled = context?.state?.enableDAB ?? false;

    if (!isDabEnabled) {
        return <></>;
    }

    return (
        <Tooltip
            content={locConstants.schemaDesigner.showChangesButtonLabel(context.schemaChangesCount)}
            relationship="label">
            <span className={classes.container}>
                <ToolbarButton
                    onClick={() => {
                        eventBus.emit("toggleChangesPanel");
                    }}
                    icon={<BranchCompare20Regular />}
                />
                {context.schemaChangesCount > 0 && (
                    <Badge size="small" className={classes.badge}>{context.schemaChangesCount}</Badge>
                )}
            </span>
        </Tooltip>
    );
}
