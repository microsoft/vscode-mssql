/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Button, Tooltip, makeStyles } from "@fluentui/react-components";
import { BranchCompare16Regular } from "@fluentui/react-icons";
import { useSchemaDesignerSelector } from "../schemaDesignerSelector";
import { locConstants } from "../../../common/locConstants";
import {
    SchemaDesignerDefinitionPanelTab,
    useSchemaDesignerDefinitionPanelContext,
} from "../definition/schemaDesignerDefinitionPanelContext";
import { useSchemaDesignerChangeContext } from "../definition/changes/schemaDesignerChangeContext";

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
    const changeContext = useSchemaDesignerChangeContext();
    const { toggleDefinitionPanel } = useSchemaDesignerDefinitionPanelContext();
    const enableDAB = useSchemaDesignerSelector((s) => s?.enableDAB);
    const classes = useStyles();
    const isDabEnabled = enableDAB ?? false;

    if (!isDabEnabled) {
        return <></>;
    }

    return (
        <Tooltip
            content={locConstants.schemaDesigner.showChangesButtonLabel(
                changeContext.schemaChangesCount,
            )}
            relationship="label">
            <span className={classes.container}>
                <Button
                    appearance="subtle"
                    size="small"
                    onClick={() => {
                        toggleDefinitionPanel(SchemaDesignerDefinitionPanelTab.Changes);
                    }}
                    icon={<BranchCompare16Regular />}>
                    {locConstants.schemaDesigner.showChangesButtonLabel(
                        changeContext.schemaChangesCount,
                    )}
                </Button>
                {changeContext.schemaChangesCount > 0 && (
                    <Badge size="small" className={classes.badge}>
                        {changeContext.schemaChangesCount}
                    </Badge>
                )}
            </span>
        </Tooltip>
    );
}
