/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Button, Tooltip, makeStyles } from "@fluentui/react-components";
import { locConstants } from "../../../common/locConstants";
import {
    SchemaDesignerDefinitionPanelTab,
    useSchemaDesignerDefinitionPanelContext,
} from "../definition/schemaDesignerDefinitionPanelContext";
import { useSchemaDesignerChangeContext } from "../definition/changes/schemaDesignerChangeContext";
import { useIsToolbarCompact } from "./schemaDesignerToolbarContext";
import { BranchCompareIcon16Regular } from "../../../common/icons/fluentIcons";

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
    const { activeTab, isDefinitionPanelVisible, toggleDefinitionPanel } =
        useSchemaDesignerDefinitionPanelContext();
    const classes = useStyles();
    const isCompact = useIsToolbarCompact();
    const buttonLabel =
        isDefinitionPanelVisible && activeTab === SchemaDesignerDefinitionPanelTab.Changes
            ? locConstants.schemaDesigner.hideChangesButtonLabel
            : locConstants.schemaDesigner.showChangesButtonLabel;

    return (
        <Tooltip content={buttonLabel} relationship="label">
            <span className={classes.container}>
                <Button
                    appearance="subtle"
                    size="small"
                    onClick={() => {
                        toggleDefinitionPanel(SchemaDesignerDefinitionPanelTab.Changes);
                    }}
                    icon={<BranchCompareIcon16Regular />}>
                    {!isCompact && buttonLabel}
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
