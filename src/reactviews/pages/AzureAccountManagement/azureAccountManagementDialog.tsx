/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    makeStyles,
    Text,
    Link,
    Dropdown,
    Option,
    Spinner,
} from "@fluentui/react-components";
import { AzureAccountManagementContext } from "./azureAccountManagementStateProvider";
import { locConstants as Loc } from "../../common/locConstants";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        maxWidth: "100%",
        maxHeight: "100%",
    },
    welcomeContainer: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        textAlign: "center",
    },
    accountContainer: {
        marginTop: "20px",
        width: "100%",
    },
    signInContainer: {
        marginTop: "16px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "8px",
    },
    dropdownContainer: {
        marginTop: "16px",
    },
    tenantContainer: {
        marginTop: "16px",
    },
    infoText: {
        marginTop: "8px",
        fontSize: "12px",
        fontStyle: "italic",
    },
});

export const AzureAccountManagementDialog = () => {
    const classes = useStyles();
    const context = useContext(AzureAccountManagementContext);

    if (!context) {
        return undefined;
    }

    const state = context.state;

    const handleSignIn = () => {
        context.signIntoAzureAccount();
    };

    const handleAccountSelect = (_: any, data: { selectedOptions: string[] }) => {
        if (data.selectedOptions.length > 0) {
            context.selectAccount(data.selectedOptions[0]);
        }
    };

    const handleTenantSelect = (_: any, data: { selectedOptions: string[] }) => {
        if (data.selectedOptions.length > 0) {
            context.selectTenant(data.selectedOptions[0]);
        }
    };

    const handleClose = () => {
        context.closeDialog();
    };

    return (
        <Dialog open={true}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>Azure Account Management</DialogTitle>
                    <DialogContent>
                        <div className={classes.welcomeContainer}>
                            <Text size={300} weight="semibold">
                                {state.message || "Welcome to Azure Account Management"}
                            </Text>
                            <Text size={200} style={{ marginTop: "10px" }}>
                                This dialog will help you manage your Azure accounts.
                            </Text>

                            <div className={classes.accountContainer}>
                                {state.isLoading ? (
                                    <Spinner size="small" label="Loading accounts..." />
                                ) : (
                                    <>
                                        <div className={classes.signInContainer}>
                                            <Link onClick={handleSignIn}>
                                                Sign into an Azure account
                                            </Link>
                                        </div>

                                        <div className={classes.dropdownContainer}>
                                            <Dropdown
                                                placeholder="Select an account"
                                                disabled={state.accounts.length === 0}
                                                selectedOptions={
                                                    state.selectedAccount
                                                        ? [state.selectedAccount.accountId]
                                                        : []
                                                }
                                                onOptionSelect={handleAccountSelect}>
                                                {state.accounts.length > 0 ? (
                                                    state.accounts.map((account) => (
                                                        <Option
                                                            key={account.accountId}
                                                            value={account.accountId}>
                                                            {account.displayName}
                                                        </Option>
                                                    ))
                                                ) : (
                                                    <Option
                                                        key="no-accounts"
                                                        value="no-accounts"
                                                        disabled>
                                                        No accounts available
                                                    </Option>
                                                )}
                                            </Dropdown>
                                            {state.accounts.length === 0 && (
                                                <Text className={classes.infoText}>
                                                    You need to sign in to an Azure account first.
                                                </Text>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* Tenant Selection Section */}
                            {state.selectedAccount && (
                                <div className={classes.tenantContainer}>
                                    <Text
                                        size={200}
                                        weight="semibold"
                                        style={{ marginBottom: "8px" }}>
                                        Tenants for {state.selectedAccount.displayName}
                                    </Text>
                                    {state.isLoadingTenants ? (
                                        <Spinner size="small" label="Loading tenants..." />
                                    ) : (
                                        <Dropdown
                                            placeholder="Select a tenant"
                                            disabled={state.tenants.length === 0}
                                            selectedOptions={
                                                state.selectedTenant
                                                    ? [state.selectedTenant.tenantId]
                                                    : []
                                            }
                                            onOptionSelect={handleTenantSelect}>
                                            {state.tenants.length > 0 ? (
                                                state.tenants.map((tenant) => (
                                                    <Option
                                                        key={tenant.tenantId}
                                                        value={tenant.tenantId}>
                                                        {`${tenant.displayName} (${tenant.tenantId})`}
                                                    </Option>
                                                ))
                                            ) : (
                                                <Option
                                                    key="no-tenants"
                                                    value="no-tenants"
                                                    disabled>
                                                    No tenants available
                                                </Option>
                                            )}
                                        </Dropdown>
                                    )}
                                    {state.tenants.length === 0 && !state.isLoadingTenants && (
                                        <Text className={classes.infoText}>
                                            No tenants found for this account.
                                        </Text>
                                    )}
                                </div>
                            )}

                            {/* Subscription Selection Section */}
                            {state.selectedTenant && state.subscriptions.length > 0 && (
                                <div className={classes.tenantContainer}>
                                    <Text
                                        size={200}
                                        weight="semibold"
                                        style={{ marginBottom: "8px" }}>
                                        Subscriptions for {state.selectedTenant.displayName}
                                    </Text>
                                    <Dropdown
                                        placeholder="Select a subscription"
                                        disabled={state.subscriptions.length === 0}
                                        selectedOptions={
                                            state.selectedSubscription
                                                ? [state.selectedSubscription.subscriptionId]
                                                : []
                                        }
                                        onOptionSelect={(
                                            _: any,
                                            data: { selectedOptions: string[] },
                                        ) => {
                                            if (data.selectedOptions.length > 0) {
                                                context.selectSubscription(data.selectedOptions[0]);
                                            }
                                        }}>
                                        {state.subscriptions.length > 0 ? (
                                            state.subscriptions.map((sub) => (
                                                <Option
                                                    key={sub.subscriptionId}
                                                    value={sub.subscriptionId}>
                                                    {`${sub.displayName} (${sub.subscriptionId})`}
                                                </Option>
                                            ))
                                        ) : (
                                            <Option key="no-subs" value="no-subs" disabled>
                                                No subscriptions available
                                            </Option>
                                        )}
                                    </Dropdown>
                                    {state.subscriptions.length === 0 && (
                                        <Text className={classes.infoText}>
                                            No subscriptions found for this tenant.
                                        </Text>
                                    )}
                                </div>
                            )}
                        </div>
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="secondary" onClick={handleClose}>
                            {Loc.common.close}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
