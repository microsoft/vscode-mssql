/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { ConnectionDialogContext } from "../connectionDialogStateProvider";
import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Link,
    MessageBar,
} from "@fluentui/react-components";

import { locConstants as Loc } from "../../../common/locConstants";
import { addFirewallRuleReadMoreUrl } from "../connectionConstants";
import { AddFirewallRuleDialogProps } from "../../../../sharedInterfaces/connectionDialog";

export const AddFirewallRuleDialog = ({
    dialogProps,
}: {
    dialogProps: AddFirewallRuleDialogProps;
}) => {
    const context = useContext(ConnectionDialogContext)!;

    return (
        <Dialog open={dialogProps.type === "addFirewallRule"}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>
                        {Loc.connectionDialog.createNewFirewallRule}
                    </DialogTitle>
                    <DialogContent>
                        <MessageBar
                            intent="error"
                            style={{ paddingRight: "12px" }}
                        >
                            {dialogProps.message}
                        </MessageBar>
                        <br />
                        {Loc.connectionDialog.firewallRuleNeededMessage}
                        {" " /* extra space before the 'Read More' link*/}
                        <Link href={addFirewallRuleReadMoreUrl}>
                            {Loc.connectionDialog.readMore}
                        </Link>
                    </DialogContent>
                    <DialogActions>
                        <Button
                            appearance="primary"
                            onClick={() => {
                                context.closeDialog();
                                // context.formAction({
                                //     propertyName: "addFirewallRule",
                                //     value: true,
                                //     isAction: false,
                                // });
                                context.connect();
                            }}
                        >
                            {Loc.connectionDialog.addFirewallRule}
                        </Button>
                        <Button
                            appearance="secondary"
                            onClick={() => {
                                context.closeDialog();
                            }}
                        >
                            {Loc.common.cancel}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
