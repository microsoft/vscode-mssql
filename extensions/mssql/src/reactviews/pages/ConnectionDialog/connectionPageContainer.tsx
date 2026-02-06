/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import "./sqlServerRotation.css";

import {
    AddFirewallRuleDialogProps,
    ConnectionDialogContextProps,
    ConnectionDialogFormItemSpec,
    ConnectionDialogWebviewState,
    ConnectionInputMode,
    ConnectionStringDialogProps,
    IConnectionDialogProfile,
    ChangePasswordDialogProps,
    TrustServerCertDialogProps,
} from "../../../sharedInterfaces/connectionDialog";
import {
    CREATE_NEW_GROUP_ID,
    CreateConnectionGroupDialogProps,
} from "../../../sharedInterfaces/connectionGroup";
import { Field, Link, makeStyles, Radio, RadioGroup } from "@fluentui/react-components";
import { Form20Regular } from "@fluentui/react-icons";
import { FormFieldNoState, useFormStyles } from "../../common/forms/form.component";
import { ReactNode, useContext } from "react";

import { AzureBrowsePage } from "./azureBrowsePage";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { useConnectionDialogSelector } from "./connectionDialogSelector";
import { ConnectionFormPage } from "./connectionFormPage";
import { ConnectionHeader } from "./components/connectionHeader.component";
import { TrustServerCertificateDialog } from "./components/trustServerCertificateDialog.component";
import { ConnectionStringDialog } from "./components/connectionStringDialog.component";
import { locConstants } from "../../common/locConstants";
import { AddFirewallRuleDialog } from "../AddFirewallRule/addFirewallRule.component";
import { ConnectionGroupDialog } from "../ConnectionGroup/connectionGroup.component";
import {
    renderColorSwatch,
    SearchableDropdownOptions,
} from "../../common/searchableDropdown.component";
import { FabricBrowsePage } from "./fabricBrowsePage";
import { AzureIcon20, FabricIcon20 } from "../../common/icons/fluentIcons";
import { ChangePasswordDialog } from "../ChangePassword/changePasswordDialog";
import { DialogMessage } from "../../common/dialogMessage";

function renderContent(selectedInputMode: ConnectionInputMode): ReactNode {
    switch (selectedInputMode) {
        case ConnectionInputMode.Parameters:
            return <ConnectionFormPage />;
        case ConnectionInputMode.AzureBrowse:
            return <AzureBrowsePage />;
        case ConnectionInputMode.FabricBrowse:
            return <FabricBrowsePage />;
    }
}

const useStyles = makeStyles({
    inputLink: {
        display: "flex",
        alignItems: "center",
    },
});

export const ConnectionInfoFormContainer = () => {
    const context = useContext(ConnectionDialogContext)!;
    const dialog = useConnectionDialogSelector((s) => s.dialog);
    const formMessage = useConnectionDialogSelector((s) => s.formMessage);
    const formState = useConnectionDialogSelector((s) => s.formState);
    const formComponents = useConnectionDialogSelector((s) => s.formComponents);
    const selectedInputMode = useConnectionDialogSelector((s) => s.selectedInputMode);
    const formStyles = useFormStyles();
    const styles = useStyles();

    const changePasswordDialogState =
        dialog?.type === "changePassword"
            ? (dialog as ChangePasswordDialogProps).props
            : undefined;

    function handleConnect(event: React.FormEvent) {
        event.preventDefault();
        context.connect();
    }

    return (
        <form onSubmit={handleConnect} className={formStyles.formRoot}>
            <ConnectionHeader />

            <div className={formStyles.formDiv} style={{ overflow: "auto" }}>
                {formMessage && (
                    <DialogMessage
                        message={formMessage}
                        onMessageButtonClicked={context.messageButtonClicked}
                        onCloseMessage={context.closeMessage}
                    />
                )}

                {dialog?.type === "trustServerCert" && (
                    <TrustServerCertificateDialog
                        dialogProps={dialog as TrustServerCertDialogProps}
                    />
                )}
                {dialog?.type === "addFirewallRule" && (
                    <AddFirewallRuleDialog
                        state={(dialog as AddFirewallRuleDialogProps).props}
                        addFirewallRule={context.addFirewallRule}
                        closeDialog={context.closeDialog}
                        signIntoAzure={context.signIntoAzureForFirewallRule}
                    />
                )}
                {dialog?.type === "changePassword" && (
                    <ChangePasswordDialog
                        serverName={changePasswordDialogState?.server}
                        userName={changePasswordDialogState?.userName}
                        onSubmit={context.changePassword}
                        onClose={context.closeDialog}
                    />
                )}
                {dialog?.type === "loadFromConnectionString" && (
                    <ConnectionStringDialog
                        dialogProps={dialog as ConnectionStringDialogProps}
                    />
                )}
                {dialog?.type === "createConnectionGroup" && (
                    <ConnectionGroupDialog
                        state={(dialog as CreateConnectionGroupDialogProps).props}
                        saveConnectionGroup={context.createConnectionGroup}
                        closeDialog={context.closeDialog}
                    />
                )}

                <FormFieldNoState<
                    IConnectionDialogProfile,
                    ConnectionDialogWebviewState,
                    ConnectionDialogFormItemSpec,
                    ConnectionDialogContextProps
                >
                    context={context}
                    formState={formState}
                    component={
                        formComponents["profileName"] as ConnectionDialogFormItemSpec
                    }
                    idx={0}
                    props={{ orientation: "horizontal" }}
                />

                <FormFieldNoState<
                    IConnectionDialogProfile,
                    ConnectionDialogWebviewState,
                    ConnectionDialogFormItemSpec,
                    ConnectionDialogContextProps
                >
                    context={context}
                    formState={formState}
                    component={
                        formComponents["groupId"] as ConnectionDialogFormItemSpec
                    }
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

                <div className={formStyles.formComponentDiv}>
                    <Field label="Input type" orientation="horizontal">
                        <RadioGroup
                            onChange={(_, data) => {
                                context.setConnectionInputType(data.value as ConnectionInputMode);
                            }}
                            value={selectedInputMode}>
                            <Radio
                                value={ConnectionInputMode.Parameters}
                                label={
                                    <div className={styles.inputLink}>
                                        <Form20Regular style={{ marginRight: "8px" }} />
                                        {locConstants.connectionDialog.parameters}
                                        <span style={{ margin: "0 8px" }} />
                                        <Link
                                            onClick={() => {
                                                context.openConnectionStringDialog();
                                            }}
                                            inline>
                                            {locConstants.connectionDialog.loadFromConnectionString}
                                        </Link>
                                    </div>
                                }
                            />
                            <Radio
                                value={ConnectionInputMode.AzureBrowse}
                                label={
                                    <div className={styles.inputLink}>
                                        <AzureIcon20 style={{ marginRight: "8px" }} />
                                        {locConstants.connectionDialog.browseAzure}
                                    </div>
                                }
                            />
                            <Radio
                                value={ConnectionInputMode.FabricBrowse}
                                label={
                                    <div className={styles.inputLink}>
                                        <FabricIcon20 style={{ marginRight: "8px" }} />
                                        {locConstants.connectionDialog.browseFabric}
                                    </div>
                                }
                            />
                        </RadioGroup>
                    </Field>
                </div>
                {renderContent(selectedInputMode)}
            </div>
        </form>
    );
};
