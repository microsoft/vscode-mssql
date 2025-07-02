/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toolbar } from "@fluentui/react-toolbar";
import { Divider, makeStyles, shorthands } from "@fluentui/react-components";
import { useContext } from "react";
import { TableDesignerContext } from "./tableDesignerStateProvider";
import { DesignerChangesPreviewButton } from "./designerChangesPreviewButton";

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
            <Toolbar size="small">
                <DesignerChangesPreviewButton />
            </Toolbar>
            <Divider className={classes.separator} />
        </div>
    );
};
