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
    TrustServerCertDialogProps,
} from "../../../sharedInterfaces/connectionDialog";
import {
    CREATE_NEW_GROUP_ID,
    CreateConnectionGroupDialogProps,
} from "../../../sharedInterfaces/connectionGroup";
import {
    Button,
    Field,
    Link,
    makeStyles,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    Radio,
    RadioGroup,
} from "@fluentui/react-components";
import { DismissRegular, Form20Regular } from "@fluentui/react-icons";
import { FormField, useFormStyles } from "../../common/forms/form.component";
import { ReactNode, useContext } from "react";

import { AzureBrowsePage } from "./azureBrowsePage";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { ConnectionFormPage } from "./connectionFormPage";
import { ConnectionHeader } from "./components/connectionHeader.component";
import { TrustServerCertificateDialog } from "./components/trustServerCertificateDialog.component";
import { ConnectionStringDialog } from "./components/connectionStringDialog.component";
import { locConstants } from "../../common/locConstants";
import { AddFirewallRuleDialog } from "../AddFirewallRule/addFirewallRule.component";
import { ConnectionGroupDialog } from "../ConnectionGroup/connectionGroup.component";
import { SearchableDropdownOptions } from "../../common/searchableDropdown.component";
import { FabricBrowsePage } from "./fabricBrowsePage";
import { AzureIcon, AzureIcon2 } from "../../common/icons/azure";
import { FabricIcon } from "../../common/icons/fabric";

function renderContent(connectionDialogContext: ConnectionDialogContextProps): ReactNode {
    switch (connectionDialogContext?.state.selectedInputMode) {
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
    const formStyles = useFormStyles();
    const styles = useStyles();

    function handleConnect(event: React.FormEvent) {
        event.preventDefault();
        context.connect();
    }

    return (
        <form onSubmit={handleConnect} className={formStyles.formRoot}>
            <ConnectionHeader />

            <div className={formStyles.formDiv} style={{ overflow: "auto" }}>
                {context.state.formError && (
                    <MessageBar intent="error" style={{ minHeight: "min-content" }}>
                        <MessageBarBody style={{ padding: "8px 0" }}>
                            {context.state.formError}
                        </MessageBarBody>
                        <MessageBarActions
                            containerAction={
                                <Button
                                    onClick={context.closeMessage}
                                    aria-label={locConstants.common.dismiss}
                                    appearance="transparent"
                                    icon={<DismissRegular />}
                                />
                            }
                        />
                    </MessageBar>
                )}

                {context.state.dialog?.type === "trustServerCert" && (
                    <TrustServerCertificateDialog
                        dialogProps={context.state.dialog as TrustServerCertDialogProps}
                    />
                )}
                {context.state.dialog?.type === "addFirewallRule" && (
                    <AddFirewallRuleDialog
                        state={(context.state.dialog as AddFirewallRuleDialogProps).props}
                        addFirewallRule={context.addFirewallRule}
                        closeDialog={context.closeDialog}
                        signIntoAzure={context.signIntoAzureForFirewallRule}
                    />
                )}
                {context.state.dialog?.type === "loadFromConnectionString" && (
                    <ConnectionStringDialog
                        dialogProps={context.state.dialog as ConnectionStringDialogProps}
                    />
                )}
                {context.state.dialog?.type === "createConnectionGroup" && (
                    <ConnectionGroupDialog
                        state={(context.state.dialog as CreateConnectionGroupDialogProps).props}
                        saveConnectionGroup={context.createConnectionGroup}
                        closeDialog={context.closeDialog}
                    />
                )}

                <FormField<
                    IConnectionDialogProfile,
                    ConnectionDialogWebviewState,
                    ConnectionDialogFormItemSpec,
                    ConnectionDialogContextProps
                >
                    context={context}
                    component={
                        context.state.formComponents["profileName"] as ConnectionDialogFormItemSpec
                    }
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
                    component={
                        context.state.formComponents["groupId"] as ConnectionDialogFormItemSpec
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
                    }}
                />

                <div className={formStyles.formComponentDiv}>
                    <Field label="Input type" orientation="horizontal">
                        <RadioGroup
                            onChange={(_, data) => {
                                context.setConnectionInputType(data.value as ConnectionInputMode);
                            }}
                            value={context.state.selectedInputMode}>
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
                                        <AzureIcon2
                                            height="20px"
                                            width="20px"
                                            style={{ marginRight: "8px" }}
                                        />
                                        {locConstants.connectionDialog.browseAzure}
                                    </div>
                                }
                            />
                            <Radio
                                value={ConnectionInputMode.FabricBrowse}
                                label={
                                    <div className={styles.inputLink}>
                                        <FabricIcon
                                            alt={"Fabric"}
                                            height="20px"
                                            width="20px"
                                            style={{ marginRight: "8px" }}
                                        />
                                        {locConstants.connectionDialog.browseFabric}
                                    </div>
                                }
                            />
                        </RadioGroup>
                    </Field>
                </div>
                {renderContent(context)}
            </div>
        </form>
    );
};
