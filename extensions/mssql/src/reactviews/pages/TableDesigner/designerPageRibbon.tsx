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

const useStyles = makeStyles({
    separator: {
        ...shorthands.margin("0px", "-20px", "0px", "0px"),
        ...shorthands.padding("0px"),
        fontSize: "5px",
    },
});

export const DesignerPageRibbon = () => {
    const designerContext = useContext(TableDesignerContext);
    const classes = useStyles();
    if (!designerContext) {
        return undefined;
    }

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
                    title={locConstants.schemaDesigner.definition}
                    onClick={() => designerContext.toggleDefinitionPane()}>
                    {locConstants.schemaDesigner.definition}
                </Button>
            </Toolbar>
            <Divider className={classes.separator} />
        </div>
    );
};
