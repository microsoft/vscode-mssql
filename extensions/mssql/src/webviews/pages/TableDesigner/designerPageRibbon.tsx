/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toolbar } from "@fluentui/react-toolbar";
import { Button, Divider, makeStyles, shorthands } from "@fluentui/react-components";
import { useContext } from "react";
import { TableDesignerContext } from "./tableDesignerStateProvider";
import { DesignerChangesPreviewButton } from "./designerChangesPreviewButton";
import { locConstants } from "../../common/locConstants";
import { CodeDefinitionIcon16Regular } from "../../common/icons/fluentIcons";
import { DesignerResultPaneTabs } from "../../../sharedInterfaces/tableDesigner";
import { useTableDesignerSelector } from "./tableDesignerSelector";

const useStyles = makeStyles({
    separator: {
        ...shorthands.margin("0px", "-20px", "0px", "0px"),
        ...shorthands.padding("0px"),
        fontSize: "5px",
    },
});

export const DesignerPageRibbon = () => {
    const designerContext = useContext(TableDesignerContext);
    const resultPaneTab = useTableDesignerSelector((s) => s?.tabStates?.resultPaneTab);
    const classes = useStyles();
    if (!designerContext) {
        return undefined;
    }

    const definitionLabel =
        designerContext.isDefinitionPaneVisible && resultPaneTab === DesignerResultPaneTabs.Script
            ? locConstants.schemaDesigner.hideDefinition
            : locConstants.schemaDesigner.showDefinition;

    return (
        <div>
            <Toolbar
                size="small"
                style={{
                    paddingTop: "5px",
                    paddingBottom: "5px",
                }}>
                <DesignerChangesPreviewButton />
                <Button
                    size="small"
                    appearance="subtle"
                    icon={<CodeDefinitionIcon16Regular />}
                    title={definitionLabel}
                    onClick={() => designerContext.toggleDefinitionPane()}>
                    {definitionLabel}
                </Button>
            </Toolbar>
            <Divider className={classes.separator} />
        </div>
    );
};
