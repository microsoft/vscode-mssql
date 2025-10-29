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
import { ApiStatus } from "../../../sharedInterfaces/webview";
import { IMssqlAzureTenant } from "../../../sharedInterfaces/azureAccountManagement";
import { addNewMicrosoftAccount } from "../../common/constants";

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
    loadingContainer: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
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

    const [selectedAccountId, setSelectedAccountId] = useState<string>(
        state.accounts.length > 0 ? state.accounts[0].accountId : "",
    );

    const [selectedAccountDisplayText, setSelectedAccountDisplayText] = useState(
        state.accounts.length > 0 ? state.accounts[0].displayName : "",
    );

    const [selectedTenantId, setSelectedTenantId] = useState<string>(
        selectedAccountId && state.tenants[selectedAccountId]?.length > 0
            ? state.tenants[selectedAccountId][0].tenantId
            : "",
    );

    const [tenantDisplayText, setTenantDisplayText] = useState(
        selectedAccountId && state.tenants[selectedAccountId]?.length > 0
            ? state.tenants[selectedAccountId][0].displayName
            : "",
    );

    // Update selected tenant when state.tenants changes
    useEffect(() => {
        if (state.accounts.length > 0) {
            if (
                selectedAccountId &&
                state.accounts.find((account) => account.accountId === selectedAccountId)
            ) {
                return; // Currently-selected account is still valid; no need to reset selections
            }

            const accountId = state.accounts[0].accountId;

            setSelectedAccountId(accountId);
            setSelectedAccountDisplayText(state.accounts[0].displayName);

            if (state.tenants[accountId]?.length > 0) {
                const tenant = state.tenants[accountId][0];
                setSelectedTenantId(tenant.tenantId);
                setTenantDisplayText(formatTenant(tenant));
            }
        }
    }, [JSON.stringify(state.accounts), JSON.stringify(state.tenants)]);

    useEffect(() => {
        if (state.clientIp) {
            setStartIp(replaceLastOctet(state.clientIp, 0));
            setEndIp(replaceLastOctet(state.clientIp, 255));
        }
    }, [state.clientIp]);

    const [ruleName, setRuleName] = useState("ClientIPAddress_" + formatDate(new Date()));

    const [ipSelectionMode, setIpSelectionMode] = useState(IpSelectionMode.SpecificIp);

    const [startIp, setStartIp] = useState(replaceLastOctet(state.clientIp, 0));
    const [endIp, setEndIp] = useState(replaceLastOctet(state.clientIp, 255));

    const onAccountOptionSelect = (_: SelectionEvents, data: OptionOnSelectData) => {
        if (data.optionValue === addNewMicrosoftAccount) {
            signIntoAzure();
        }

        setSelectedAccountId(data.optionValue ?? "");
        setSelectedAccountDisplayText(data.optionText ?? "");

        const accountId = data.optionValue;
        setSelectedTenantId(accountId ? (state.tenants[accountId]?.[0]?.tenantId ?? "") : "");
        setTenantDisplayText(
            accountId
                ? state.tenants[accountId]?.[0]
                    ? formatTenant(state.tenants[accountId][0])
                    : ""
                : "",
        );
    };

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
                        {state.loadingAzureAccountsStatus === ApiStatus.Loading ? (
                            <div className={styles.loadingContainer}>
                                <Spinner size="tiny" />
                                <span>{Loc.azure.loadingAzureAccounts}</span>
                            </div>
                        ) : (
                            <>
                                {!state.isSignedIn && (
                                    <>
                                        {Loc.firewallRules.signIntoAzureToAddFirewallRule}
                                        {" " /* extra space before the 'Sign in' link*/}
                                        <Link
                                            onClick={() => {
                                                signIntoAzure();
                                            }}>
                                            {Loc.azure.signIntoAzure}
                                        </Link>
                                    </>
                                )}
                                {state.isSignedIn && (
                                    <>
                                        {state.accounts.length > 0 && (
                                            <>
                                                <Field
                                                    label={Loc.azure.azureAccount}
                                                    className={formStyles.formComponentDiv}>
                                                    <Dropdown
                                                        value={selectedAccountDisplayText}
                                                        selectedOptions={[selectedAccountId]}
                                                        onOptionSelect={onAccountOptionSelect}>
                                                        <Option
                                                            text={Loc.azure.addAzureAccount}
                                                            key={addNewMicrosoftAccount}
                                                            value={addNewMicrosoftAccount}>
                                                            {Loc.azure.addAzureAccount}
                                                        </Option>
                                                        {state.accounts.map((account) => {
                                                            return (
                                                                <Option
                                                                    text={account.displayName}
                                                                    key={account.accountId}
                                                                    value={account.accountId}>
                                                                    {account.displayName}
                                                                </Option>
                                                            );
                                                        })}
                                                    </Dropdown>
                                                </Field>
                                                <Field
                                                    label={Loc.azure.tenant}
                                                    className={formStyles.formComponentDiv}>
                                                    <Dropdown
                                                        value={tenantDisplayText}
                                                        selectedOptions={[selectedTenantId]}
                                                        onOptionSelect={onTenantOptionSelect}>
                                                        {state.tenants[selectedAccountId]?.map(
                                                            (tenant) => {
                                                                return (
                                                                    <Option
                                                                        text={formatTenant(tenant)}
                                                                        key={tenant.tenantId}
                                                                        value={tenant.tenantId}>
                                                                        {formatTenant(tenant)}
                                                                    </Option>
                                                                );
                                                            },
                                                        )}
                                                    </Dropdown>
                                                </Field>
                                            </>
                                        )}

                                        <Field
                                            label={Loc.firewallRules.ruleName}
                                            className={formStyles.formComponentDiv}>
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
                                                }>
                                                <Radio
                                                    label={Loc.firewallRules.addMyClientIp(
                                                        state.clientIp,
                                                    )}
                                                    value={IpSelectionMode.SpecificIp}
                                                />
                                                <Radio
                                                    label={Loc.firewallRules.addMySubnetRange}
                                                    value={IpSelectionMode.IpRange}
                                                />
                                            </RadioGroup>
                                        </Field>
                                        <div
                                            className={`${formStyles.formComponentDiv}`}
                                            style={{ marginLeft: "40px" }}>
                                            <Label>From</Label>
                                            <Input
                                                value={startIp}
                                                onChange={(_ev, data) => {
                                                    setStartIp(data.value);
                                                }}
                                                id="startIpInput"
                                                disabled={
                                                    ipSelectionMode === IpSelectionMode.SpecificIp
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
                                                    ipSelectionMode === IpSelectionMode.SpecificIp
                                                }
                                                className={styles.ipInputBox}
                                            />
                                        </div>
                                    </>
                                )}
                            </>
                        )}
                    </DialogContent>
                    <DialogActions>
                        <Button
                            appearance="primary"
                            onClick={() => {
                                addFirewallRule({
                                    name: ruleName,
                                    azureAccountInfo: {
                                        accountId: selectedAccountId,
                                        tenantId: selectedTenantId,
                                    },
                                    ip:
                                        ipSelectionMode === IpSelectionMode.SpecificIp
                                            ? state.clientIp
                                            : { startIp, endIp },
                                });
                            }}
                            disabled={
                                !state.isSignedIn ||
                                state.addFirewallRuleStatus === ApiStatus.Loading ||
                                state.loadingAzureAccountsStatus === ApiStatus.Loading
                            }
                            icon={
                                state.addFirewallRuleStatus === ApiStatus.Loading ? (
                                    <Spinner size="tiny" />
                                ) : undefined
                            }>
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

function formatTenant(tenant: IMssqlAzureTenant) {
    return `${tenant.displayName} (${tenant.tenantId})`;
}

function replaceLastOctet(ip: string, newLastOctet: number) {
    return ip.replace(/\.[0-9]+$/g, `.${newLastOctet}`);
}
