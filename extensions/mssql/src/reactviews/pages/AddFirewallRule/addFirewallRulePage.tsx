/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from "@fluentui/react-components";
import { useContext } from "react";
import { AddFirewallRuleContext } from "./addFirewallRuleStateProvider";
import { AddFirewallRuleDialog } from "./addFirewallRule.component";
import { useAddFirewallRuleSelector } from "./addFirewallRuleSelector";

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
    const serverName = useAddFirewallRuleSelector((s) => s?.serverName);
    const message = useAddFirewallRuleSelector((s) => s?.message);
    const clientIp = useAddFirewallRuleSelector((s) => s?.clientIp);
    const isSignedIn = useAddFirewallRuleSelector((s) => s?.isSignedIn);
    const accounts = useAddFirewallRuleSelector((s) => s?.accounts);
    const tenants = useAddFirewallRuleSelector((s) => s?.tenants);
    const addFirewallRuleStatus = useAddFirewallRuleSelector((s) => s?.addFirewallRuleStatus);

    // If context isn't available yet, don't render
    if (!context || !accounts) {
        return undefined;
    }

    return (
        <div className={classes.root}>
            <AddFirewallRuleDialog
                state={{
                    serverName,
                    message: message!,
                    clientIp: clientIp!,
                    isSignedIn: isSignedIn!,
                    accounts,
                    tenants: tenants!,
                    addFirewallRuleStatus: addFirewallRuleStatus!,
                }}
                addFirewallRule={context.addFirewallRule}
                closeDialog={context.closeDialog}
                signIntoAzure={context.signIntoAzure}
            />
        </div>
    );
};
