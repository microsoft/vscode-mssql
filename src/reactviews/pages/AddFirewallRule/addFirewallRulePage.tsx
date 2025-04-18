/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Field,
    Input,
    Text,
    makeStyles,
    Combobox,
    Option,
} from "@fluentui/react-components";
import { useContext, useState } from "react";
import { AddFirewallRuleContext } from "./addFirewallRuleStateProvider";
import { ArrowClockwise16Filled } from "@fluentui/react-icons";

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
    title: {
        marginBottom: "20px",
    },
    footer: {
        display: "flex",
        justifyContent: "flex-end",
        marginTop: "20px",
    },
    buttonsContainer: {
        display: "flex",
        "> *": {
            marginLeft: "10px",
        },
    },
    flexRow: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
    },
    formField: {
        marginBottom: "15px",
        width: "100%",
    },
    infoText: {
        marginBottom: "20px",
    },
});

/**
 * Component for adding a firewall rule to an Azure SQL server
 */
export const AddFirewallRulePage = () => {
    const classes = useStyles();
    const context = useContext(AddFirewallRuleContext);

    // Form state
    const [ipAddress, setIpAddress] = useState("");
    const [ruleName, setRuleName] = useState("");
    const [selectedTenant, setSelectedTenant] = useState<string | undefined>("");

    // If context isn't available yet, don't render
    if (!context?.state) {
        return undefined;
    }

    // Placeholder for localized strings - will be replaced later
    const locStrings = {
        addFirewallRule: "Add Firewall Rule",
        addFirewallRuleDescription:
            "Add a firewall rule to allow access to your Azure SQL database from your current IP address.",
        ipAddress: "IP Address",
        enterIpAddress: "Enter IP address",
        refreshIpAddress: "Refresh IP address",
        ruleName: "Rule Name",
        enterRuleName: "Enter rule name",
        selectTenant: "Select Tenant",
        loading: "Loading...",
        cancel: "Cancel",
        add: "Add",
    };

    const tenants = context.state.tenants || [];

    return (
        <div className={classes.root}>
            <h2 className={classes.title}>{locStrings.addFirewallRule}</h2>

            <Text className={classes.infoText}>{locStrings.addFirewallRuleDescription}</Text>

            {/* Error message */}
            {context.state.errorMessage && (
                <Text weight="semibold" style={{ color: "var(--colorPaletteRedForeground1)" }}>
                    {context.state.errorMessage}
                </Text>
            )}

            {/* IP Address field */}
            <Field className={classes.formField} label={locStrings.ipAddress} required>
                <div className={classes.flexRow}>
                    <Input
                        value={ipAddress}
                        onChange={(_e, data) => setIpAddress(data.value)}
                        placeholder={locStrings.enterIpAddress}
                    />
                    <Button
                        icon={<ArrowClockwise16Filled />}
                        onClick={() => context.refreshIpAddress()}
                        title={locStrings.refreshIpAddress}
                    />
                </div>
            </Field>

            {/* Rule Name field */}
            <Field className={classes.formField} label={locStrings.ruleName} required>
                <Input
                    value={ruleName}
                    onChange={(_e, data) => setRuleName(data.value)}
                    placeholder={locStrings.enterRuleName}
                />
            </Field>

            {/* Tenant selection field */}
            {tenants.length > 0 && (
                <Field className={classes.formField} label={locStrings.selectTenant} required>
                    <Combobox
                        value={selectedTenant}
                        onOptionSelect={(_e, _data) => {
                            setSelectedTenant("Tenant");
                        }}>
                        {tenants.map((tenant) => {
                            const displayText = `${tenant.name} (${tenant.id})`;
                            return (
                                <Option key={tenant.id} text={displayText} value={tenant.id}>
                                    {displayText}
                                </Option>
                            );
                        })}
                    </Combobox>
                </Field>
            )}

            {/* Action buttons */}
            <div className={classes.footer}>
                <div className={classes.buttonsContainer}>
                    <Button onClick={() => context.cancel()}>{locStrings.cancel}</Button>
                    <Button
                        appearance="primary"
                        onClick={() => context.submit(ipAddress, ruleName, "test")}>
                        {locStrings.add}
                    </Button>
                </div>
            </div>
        </div>
    );
};
