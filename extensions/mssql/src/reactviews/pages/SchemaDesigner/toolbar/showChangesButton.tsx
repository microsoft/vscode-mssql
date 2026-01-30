/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, ToolbarButton, Tooltip, makeStyles } from "@fluentui/react-components";
import { useContext } from "react";
import eventBus from "../schemaDesignerEvents";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { locConstants } from "../../../common/locConstants";
import * as FluentIcons from "@fluentui/react-icons";

const useStyles = makeStyles({
    iconWithBadge: {
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        paddingRight: "6px",
        paddingBottom: "6px",
    },
    badge: {
        position: "absolute",
        right: 0,
        bottom: 0,
        minWidth: "16px",
        height: "16px",
        fontSize: "10px",
        lineHeight: "16px",
        padding: "0 4px",
        borderRadius: "8px",
        backgroundColor: "var(--vscode-badge-background)",
        color: "var(--vscode-badge-foreground)",
        border: "1px solid var(--vscode-panel-background)",
        boxSizing: "border-box",
    },
});

export function ShowChangesButton() {
    const context = useContext(SchemaDesignerContext);
    const classes = useStyles();
    const isDabEnabled = context?.state?.enableDAB ?? false;

    if (!isDabEnabled) {
        return null;
    }

    return (
        <Tooltip
            content={locConstants.schemaDesigner.showChangesButtonLabel(context.schemaChangesCount)}
            relationship="label">
            <ToolbarButton
                icon={
                    <span className={classes.iconWithBadge}>
                        <FluentIcons.BranchCompare20Regular />
                        {context.schemaChangesCount > 0 && (
                            <Badge size="small" className={classes.badge}>
                                {context.schemaChangesCount}
                            </Badge>
                        )}
                    </span>
                }
                onClick={() => {
                    eventBus.emit("toggleChangesPanel");
                }}></ToolbarButton>
        </Tooltip>
    );
}
