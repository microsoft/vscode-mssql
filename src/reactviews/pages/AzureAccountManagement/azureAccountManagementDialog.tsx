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
                                                        ? [state.selectedAccount]
                                                        : []
                                                }
                                                onOptionSelect={handleAccountSelect}>
                                                {state.accounts.length > 0 ? (
                                                    state.accounts.map((account) => (
                                                        <Option key={account} value={account}>
                                                            {account}
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
