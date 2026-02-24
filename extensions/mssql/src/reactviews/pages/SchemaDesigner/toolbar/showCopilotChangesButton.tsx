/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Button, Tooltip, makeStyles } from "@fluentui/react-components";
import { Sparkle20Regular } from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
import {
    SchemaDesignerDefinitionPanelTab,
    useSchemaDesignerDefinitionPanelContext,
} from "../definition/schemaDesignerDefinitionPanelContext";
import { useCopilotChangesContext } from "../definition/copilot/copilotChangesContext";

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

export function ShowCopilotChangesButton() {
    const { toggleDefinitionPanel } = useSchemaDesignerDefinitionPanelContext();
    const { trackedChanges } = useCopilotChangesContext();
    const classes = useStyles();
    const changeCount = trackedChanges.length;

    return (
        <Tooltip
            content={locConstants.schemaDesigner.showCopilotChangesButtonLabel}
            relationship="label">
            <span className={classes.container}>
                <Button
                    appearance="subtle"
                    size="small"
                    icon={<Sparkle20Regular />}
                    onClick={() => {
                        toggleDefinitionPanel(SchemaDesignerDefinitionPanelTab.CopilotChanges);
                    }}>
                    {locConstants.schemaDesigner.showCopilotChangesButtonLabel}
                </Button>
                {changeCount > 0 && (
                    <Badge size="small" className={classes.badge}>
                        {changeCount}
                    </Badge>
                )}
            </span>
        </Tooltip>
    );
}
