/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useState, useEffect } from "react";
import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Dropdown,
    Field,
    Input,
    Label,
    Link,
    makeStyles,
    MessageBar,
    Option,
    OptionOnSelectData,
    Radio,
    RadioGroup,
    SelectionEvents,
    Spinner,
} from "@fluentui/react-components";

import { locConstants as Loc } from "../../common/locConstants";
import { addFirewallRuleReadMoreUrl } from "../ConnectionDialog/connectionConstants";
import { useFormStyles } from "../../common/forms/form.component";
import { FirewallRuleSpec } from "../../../sharedInterfaces/firewallRule";
import { AddFirewallRuleState } from "../../../sharedInterfaces/addFirewallRule";

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
    state,
    addFirewallRule,
    closeDialog,
    signIntoAzure,
}: {
    state: AddFirewallRuleState;
    addFirewallRule: (firewallRuleSpec: FirewallRuleSpec) => void;
    closeDialog: () => void;
    signIntoAzure: () => void;
}) => {
    const styles = useStyles();
    const formStyles = useFormStyles();

    const [isProcessing, setIsProcessing] = useState(false);

    const [selectedTenantId, setSelectedTenantId] = useState<string>(
        state.tenants.length > 0 ? state.tenants[0].id : "",
    );

    const [tenantDisplayText, setTenantDisplayText] = useState(
        state.tenants.length > 0 ? formatTenant(state.tenants[0]) : "",
    );

    // Update selected tenant when state.tenants changes
    useEffect(() => {
        if (state.tenants.length > 0) {
            setSelectedTenantId(state.tenants[0].id);
            setTenantDisplayText(formatTenant(state.tenants[0]));
        }
    }, [state.tenants]);

    const [ruleName, setRuleName] = useState("ClientIPAddress_" + formatDate(new Date()));

    const [ipSelectionMode, setIpSelectionMode] = useState(IpSelectionMode.SpecificIp);

    const [startIp, setStartIp] = useState(
        state.clientIp.replace(/\.[0-9]+$/g, ".0"), // replace last octet with 0
    );
    const [endIp, setEndIp] = useState(
        state.clientIp.replace(/\.[0-9]+$/g, ".255"), // replace last octet with 255
    );

    const onTenantOptionSelect = (_: SelectionEvents, data: OptionOnSelectData) => {
        setSelectedTenantId(data.selectedOptions.length > 0 ? data.selectedOptions[0] : "");
        setTenantDisplayText(data.optionText ?? "");
    };

    return (
        <Dialog open={true /* standalone dialog always open*/}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>
                        {state.serverName
                            ? Loc.firewallRules.createNewFirewallRuleFor(state.serverName)
                            : Loc.firewallRules.createNewFirewallRule}
                    </DialogTitle>
                    <DialogContent>
                        <MessageBar intent="error" style={{ paddingRight: "12px" }}>
                            {state.message}
                        </MessageBar>
                        <br />
                        <div style={{ marginBottom: "12px" }}>
                            {Loc.firewallRules.firewallRuleNeededMessage}
                            {" " /* extra space before the 'Read More' link*/}
                            <Link href={addFirewallRuleReadMoreUrl}>
                                {Loc.connectionDialog.readMore}
                            </Link>
                        </div>

                        {!state.isSignedIn && (
                            <>
                                {"Sign into Azure in order to add a firewall rule."}
                                {" " /* extra space before the 'Sign in' link*/}
                                <Link
                                    onClick={() => {
                                        signIntoAzure();
                                    }}>
                                    {"Sign into Azure"}
                                </Link>
                            </>
                        )}
                        {state.isSignedIn && (
                            <>
                                {state.tenants.length > 0 && (
                                    <Field label="Tenant" className={formStyles.formComponentDiv}>
                                        <Dropdown
                                            value={tenantDisplayText}
                                            selectedOptions={[selectedTenantId]}
                                            onOptionSelect={onTenantOptionSelect}>
                                            {state.tenants.map((tenant) => {
                                                return (
                                                    <Option
                                                        text={formatTenant(tenant)}
                                                        value={tenant.id}
                                                        key={tenant.id}>
                                                        {formatTenant(tenant)}
                                                    </Option>
                                                );
                                            })}
                                        </Dropdown>
                                    </Field>
                                )}
                                <Field label="Rule name" className={formStyles.formComponentDiv}>
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
                                            setIpSelectionMode(data.value as IpSelectionMode)
                                        }>
                                        <Radio
                                            label={`Add my client IP (${state.clientIp})`}
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
                                    style={{ marginLeft: "40px" }}>
                                    <Label>From</Label>
                                    <Input
                                        value={startIp}
                                        onChange={(_ev, data) => {
                                            setStartIp(data.value);
                                        }}
                                        id="startIpInput"
                                        disabled={ipSelectionMode === IpSelectionMode.SpecificIp}
                                        className={styles.ipInputBox}
                                    />
                                    <Label>To</Label>
                                    <Input
                                        value={endIp}
                                        onChange={(_ev, data) => {
                                            setEndIp(data.value);
                                        }}
                                        id="endIpInput"
                                        disabled={ipSelectionMode === IpSelectionMode.SpecificIp}
                                        className={styles.ipInputBox}
                                    />
                                </div>
                            </>
                        )}
                    </DialogContent>
                    <DialogActions>
                        <Button
                            appearance="primary"
                            onClick={() => {
                                setIsProcessing(true);
                                addFirewallRule({
                                    name: ruleName,
                                    tenantId: selectedTenantId,
                                    ip:
                                        ipSelectionMode === IpSelectionMode.SpecificIp
                                            ? state.clientIp
                                            : { startIp, endIp },
                                });
                                // if adding the firewall rule is successful, it will attempt to reconnect
                                // otherwise, it will display an error at the top of the connection dialog
                            }}
                            disabled={!state.isSignedIn}
                            icon={isProcessing ? <Spinner size="tiny" /> : undefined}>
                            {Loc.firewallRules.addFirewallRule}
                        </Button>
                        <Button
                            appearance="secondary"
                            onClick={() => {
                                closeDialog();
                            }}>
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
        [date.getFullYear(), padTo2Digits(date.getMonth() + 1), padTo2Digits(date.getDate())].join(
            "-",
        ) +
        "_" +
        [
            padTo2Digits(date.getHours()),
            padTo2Digits(date.getMinutes()),
            padTo2Digits(date.getSeconds()),
        ].join("-")
    );
}

function formatTenant({ name, id }: { name: string; id: string }) {
    return `${name} (${id})`;
}
