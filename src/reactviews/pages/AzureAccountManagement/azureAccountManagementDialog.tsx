/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
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
    Spinner,
} from "@fluentui/react-components";
import { AzureAccountManagementContext } from "./azureAccountManagementStateProvider";
import { locConstants as Loc } from "../../common/locConstants";
import { AzureFilterCombobox } from "../ConnectionDialog/AzureFilterCombobox.component";

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

    const handleClose = () => {
        context.closeDialog();
    };

    const [accounts, setAccounts] = useState<string[]>([]);
    const [selectedAccount, setSelectedAccount] = useState<string | undefined>(undefined);
    const [accountValue, setAccountValue] = useState<string>("");

    // subscriptions
    useEffect(() => {
        const accounts = context.state.accounts.map((acc) => acc.displayName);
        // const subs = removeDuplicates(
        //     context.state.azureSubscriptions.map((sub) => `${sub.name} (${sub.id})`),
        // );
        setAccounts(accounts.sort());

        // updateComboboxSelection(
        //     selectedAccount,
        //     setSelectedAccount,
        //     setAccountValue,
        //     subs,
        //     DefaultSelectionMode.AlwaysSelectNone,
        // );
    }, [context.state.accounts]);

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
                                            <AzureFilterCombobox
                                                label="Azure Accounts"
                                                clearable
                                                content={{
                                                    valueList: accounts,
                                                    value: accountValue,
                                                    setValue: setAccountValue,
                                                    selection: selectedAccount,
                                                    setSelection: (acc) => {
                                                        setSelectedAccount(acc);
                                                        context.selectAccount(acc as string);
                                                    },
                                                    placeholder: "Select an Azure account",
                                                    invalidOptionErrorMessage:
                                                        "Invalid account selected",
                                                }}
                                            />
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
