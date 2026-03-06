/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import "./sqlServerRotation.css";

import {
    AddFirewallRuleDialogProps,
    BrowseConnectionDialogProps,
    ConnectionDialogContextProps,
    ConnectionDialogFormItemSpec,
    ConnectionDialogWebviewState,
    ConnectionStringDialogProps,
    IConnectionDialogProfile,
    ChangePasswordDialogProps,
    TrustServerCertDialogProps,
} from "../../../sharedInterfaces/connectionDialog";
import {
    CREATE_NEW_GROUP_ID,
    CreateConnectionGroupDialogProps,
} from "../../../sharedInterfaces/connectionGroup";
import { Button, makeStyles } from "@fluentui/react-components";
import { FormField, useFormStyles } from "../../common/forms/form.component";
import { useContext, useState } from "react";

import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { useConnectionDialogSelector } from "./connectionDialogSelector";
import { ConnectionFormPage } from "./connectionFormPage";
import { AdvancedOptionsDrawer } from "./components/advancedOptionsDrawer.component";
import { BrowseConnectionDialog } from "./components/browseConnectionDialog.component";
import { ConnectButton } from "./components/connectButton.component";
import { TrustServerCertificateDialog } from "./components/trustServerCertificateDialog.component";
import { ConnectionStringDialog } from "./components/connectionStringDialog.component";
import { locConstants } from "../../common/locConstants";
import { AddFirewallRuleDialog } from "../AddFirewallRule/addFirewallRule.component";
import { ConnectionGroupDialog } from "../ConnectionGroup/connectionGroup.component";
import { DialogPageShell } from "../../common/dialogPageShell";
import {
    renderColorSwatch,
    SearchableDropdownOptions,
} from "../../common/searchableDropdown.component";
import { ConnectionDialogIcon } from "../../common/icons/connectionDialog";
import { ChangePasswordDialog } from "../ChangePassword/changePasswordDialog";
import { DialogMessage } from "../../common/dialogMessage";

const useStyles = makeStyles({
    content: {
        width: "100%",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        "> *": {
            margin: "5px",
        },
    },
});

export const ConnectionInfoFormContainer = () => {
    const context = useContext(ConnectionDialogContext)!;
    const dialog = useConnectionDialogSelector((s) => s.dialog);
    const formMessage = useConnectionDialogSelector((s) => s.formMessage);
    const formState = useConnectionDialogSelector((s) => s.formState);
    const formComponents = useConnectionDialogSelector((s) => s.formComponents);
    const formStyles = useFormStyles();
    const styles = useStyles();
    const [isAdvancedDrawerOpen, setIsAdvancedDrawerOpen] = useState(false);

    const changePasswordDialogState =
        dialog?.type === "changePassword" ? (dialog as ChangePasswordDialogProps).props : undefined;
    const browseDialogState =
        dialog?.type === "browseConnection" ? (dialog as BrowseConnectionDialogProps) : undefined;
    const showFooter = dialog?.type !== "browseConnection";
    const dialogTitle = locConstants.connectionDialog.connectToDatabase;

    function handleConnect(event: React.FormEvent) {
        event.preventDefault();
        context.connect();
    }

    return (
        <form onSubmit={handleConnect} className={formStyles.formRoot}>
            <DialogPageShell
                icon={<ConnectionDialogIcon aria-label={dialogTitle} />}
                title={dialogTitle}
                maxContentWidth={650}
                footerStart={
                    showFooter ? (
                        <Button
                            type="button"
                            onClick={() => {
                                setIsAdvancedDrawerOpen(!isAdvancedDrawerOpen);
                            }}
                            className={formStyles.formNavTrayButton}>
                            {locConstants.connectionDialog.advancedSettings}
                        </Button>
                    ) : undefined
                }
                footerEnd={
                    showFooter ? (
                        <ConnectButton className={formStyles.formNavTrayButton} />
                    ) : undefined
                }>
                <AdvancedOptionsDrawer
                    isAdvancedDrawerOpen={isAdvancedDrawerOpen}
                    setIsAdvancedDrawerOpen={setIsAdvancedDrawerOpen}
                />

                {dialog?.type === "trustServerCert" && (
                    <TrustServerCertificateDialog
                        dialogProps={dialog as TrustServerCertDialogProps}
                    />
                )}
                {dialog?.type === "addFirewallRule" && (
                    <AddFirewallRuleDialog
                        mode="modal"
                        state={(dialog as AddFirewallRuleDialogProps).props}
                        addFirewallRule={context.addFirewallRule}
                        closeDialog={context.closeDialog}
                        signIntoAzure={context.signIntoAzureForFirewallRule}
                    />
                )}
                {dialog?.type === "changePassword" && (
                    <ChangePasswordDialog
                        mode="modal"
                        serverName={changePasswordDialogState?.server}
                        userName={changePasswordDialogState?.userName}
                        onSubmit={context.changePassword}
                        onClose={context.closeDialog}
                    />
                )}
                {dialog?.type === "browseConnection" && browseDialogState && (
                    <BrowseConnectionDialog dialogProps={browseDialogState} />
                )}
                {dialog?.type === "loadFromConnectionString" && (
                    <ConnectionStringDialog dialogProps={dialog as ConnectionStringDialogProps} />
                )}
                {dialog?.type === "createConnectionGroup" && (
                    <ConnectionGroupDialog
                        mode="modal"
                        state={(dialog as CreateConnectionGroupDialogProps).props}
                        saveConnectionGroup={context.createConnectionGroup}
                        closeDialog={context.closeDialog}
                    />
                )}

                <div className={styles.content}>
                    {formMessage && (
                        <DialogMessage
                            message={formMessage}
                            onMessageButtonClicked={context.messageButtonClicked}
                            onCloseMessage={context.closeMessage}
                        />
                    )}

                    <FormField<
                        IConnectionDialogProfile,
                        ConnectionDialogWebviewState,
                        ConnectionDialogFormItemSpec,
                        ConnectionDialogContextProps
                    >
                        context={context}
                        formState={formState}
                        component={formComponents["profileName"] as ConnectionDialogFormItemSpec}
                        idx={0}
                        props={{ orientation: "horizontal" }}
                    />

                    <FormField<
                        IConnectionDialogProfile,
                        ConnectionDialogWebviewState,
                        ConnectionDialogFormItemSpec,
                        ConnectionDialogContextProps
                    >
                        context={context}
                        formState={formState}
                        component={formComponents["groupId"] as ConnectionDialogFormItemSpec}
                        idx={0}
                        props={{ orientation: "horizontal" }}
                        componentProps={{
                            onSelect: (option: SearchableDropdownOptions) => {
                                if (option.value === CREATE_NEW_GROUP_ID) {
                                    context.openCreateConnectionGroupDialog();
                                } else {
                                    context.formAction({
                                        propertyName: "groupId",
                                        isAction: false,
                                        value: option.value,
                                    });
                                }
                            },
                            renderDecoration: (option: SearchableDropdownOptions) => {
                                return renderColorSwatch(option.color);
                            },
                        }}
                    />
                    <ConnectionFormPage />
                </div>
            </DialogPageShell>
        </form>
    );
};
