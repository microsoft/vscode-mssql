/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import { ConnectionDialogContext } from "../connectionDialogStateProvider";
import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Field,
    Input,
    Label,
    Link,
    makeStyles,
    MessageBar,
    Radio,
    RadioGroup,
} from "@fluentui/react-components";

import { locConstants as Loc } from "../../../common/locConstants";
import { addFirewallRuleReadMoreUrl } from "../connectionConstants";
import { AddFirewallRuleDialogProps } from "../../../../sharedInterfaces/connectionDialog";
import { useFormStyles } from "../../../common/forms/form.component";

enum IpSelectionMode {
    SpecificIp = "specificIp",
    IpRange = "ipRange",
}

const useStyles = makeStyles({
    ipInputBox: {
        marginLeft: "8px",
        marginRight: "8px",
        width: "120px",
    },
});

export const AddFirewallRuleDialog = ({
    dialogProps,
}: {
    dialogProps: AddFirewallRuleDialogProps;
}) => {
    const context = useContext(ConnectionDialogContext)!;
    const styles = useStyles();
    const formStyles = useFormStyles();

    const [ruleName, setRuleName] = useState(
        "ClientIPAddress_" + formatDate(new Date()),
    );

    const [ipSelectionMode, setIpSelectionMode] = useState(
        IpSelectionMode.SpecificIp,
    );

    const [startIp, setStartIp] = useState(
        dialogProps.clientIp.replace(/\.[0-9]+$/g, ".0"), // replace last octet with 0
    );
    const [endIp, setEndIp] = useState(
        dialogProps.clientIp.replace(/\.[0-9]+$/g, ".255"), // replace last octet with 255
    );

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
                        <div style={{ marginTop: "12px" }}>
                            <Field
                                label="Rule name"
                                className={formStyles.formComponentDiv}
                            >
                                <Input
                                    value={ruleName}
                                    onChange={(_ev, data) => {
                                        setRuleName(data.value);
                                    }}
                                    id="ruleName"
                                />
                            </Field>
                            <Field className={formStyles.formComponentDiv}>
                                <RadioGroup
                                    value={ipSelectionMode}
                                    onChange={(_, data) =>
                                        setIpSelectionMode(
                                            data.value as IpSelectionMode,
                                        )
                                    }
                                >
                                    <Radio
                                        label={`Add my client IP (${dialogProps.clientIp})`}
                                        value={IpSelectionMode.SpecificIp}
                                    />
                                    <Radio
                                        label="Add my subnet IP range"
                                        value={IpSelectionMode.IpRange}
                                    />
                                </RadioGroup>
                            </Field>
                            <div
                                className={formStyles.formComponentDiv}
                                style={{ marginLeft: "40px" }}
                            >
                                <Label>From</Label>
                                <Input
                                    value={startIp}
                                    onChange={(_ev, data) => {
                                        setStartIp(data.value);
                                    }}
                                    id="startIpInput"
                                    disabled={
                                        ipSelectionMode ===
                                        IpSelectionMode.SpecificIp
                                    }
                                    className={styles.ipInputBox}
                                />
                                <Label>To</Label>
                                <Input
                                    value={endIp}
                                    onChange={(_ev, data) => {
                                        setEndIp(data.value);
                                    }}
                                    id="endIpInput"
                                    disabled={
                                        ipSelectionMode ===
                                        IpSelectionMode.SpecificIp
                                    }
                                    className={styles.ipInputBox}
                                />
                            </div>
                        </div>
                    </DialogContent>
                    <DialogActions>
                        <Button
                            appearance="primary"
                            onClick={() => {
                                context.closeDialog();
                                context.addFirewallRule(
                                    ruleName,
                                    startIp,
                                    ipSelectionMode === IpSelectionMode.IpRange
                                        ? endIp
                                        : undefined,
                                );
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

function padTo2Digits(num: number) {
    return num.toString().padStart(2, "0");
}

// format as "YYYY-MM-DD_hh-mm-ss" (default Azure rulename format)
function formatDate(date: Date) {
    return (
        [
            date.getFullYear(),
            padTo2Digits(date.getMonth() + 1),
            padTo2Digits(date.getDate()),
        ].join("-") +
        "_" +
        [
            padTo2Digits(date.getHours()),
            padTo2Digits(date.getMinutes()),
            padTo2Digits(date.getSeconds()),
        ].join("-")
    );
}
