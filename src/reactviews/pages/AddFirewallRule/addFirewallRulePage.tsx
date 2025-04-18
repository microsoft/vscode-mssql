/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from "@fluentui/react-components";
import { useContext } from "react";
import { AddFirewallRuleContext } from "./addFirewallRuleStateProvider";
import { AddFirewallRuleDialog } from "./addFirewallRule.component";

// Define styles for the component
const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        width: "600px",
        maxWidth: "calc(100% - 20px)",
        "> *": {
            marginBottom: "15px",
        },
        padding: "10px",
    },
});

/**
 * Component for adding a firewall rule to an Azure SQL server
 */
export const AddFirewallRulePage = () => {
    const classes = useStyles();
    const context = useContext(AddFirewallRuleContext);

    // If context isn't available yet, don't render
    if (!context?.state) {
        return undefined;
    }

    return (
        <div className={classes.root}>
            <AddFirewallRuleDialog
                state={context.state}
                addFirewallRule={context.addFirewallRule}
                closeDialog={context.closeDialog}
                signIntoAzure={context.signIntoAzure}
            />
        </div>
    );
};
