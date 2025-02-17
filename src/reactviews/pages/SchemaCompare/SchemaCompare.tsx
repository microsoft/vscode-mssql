/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";

import ActionsToolbar from "./components/ActionsToolbar";
import SchemaSelectorDrawer from "./components/SchemaSelectorDrawer";
import SelectionPanel from "./components/SelectionPanel";
import { makeStyles } from "@fluentui/react-components";
import { schemaCompareContext } from "./SchemaCompareStateProvider";

const useStyles = makeStyles({
    positionItemsHorizontally: {
        display: "flex",
    },

    maxHeight: {
        height: "100vh",
        flex: "1 1 auto",
    },
});

export const SchemaComparePage = () => {
    const classes = useStyles();
    const context = useContext(schemaCompareContext);

    return (
        <>
            <div className={classes.positionItemsHorizontally}>
                <div className={classes.maxHeight}>
                    <ActionsToolbar />
                    <SelectionPanel />
                </div>
                {context.selectSourceDrawer.open && <SchemaSelectorDrawer />}
            </div>
        </>
    );
};
