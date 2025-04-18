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
import { Field, Image, Link, MessageBar, Radio, RadioGroup } from "@fluentui/react-components";
import { Form20Regular } from "@fluentui/react-icons";
import { FormField, useFormStyles } from "../../common/forms/form.component";
import { ReactNode, useContext } from "react";

import { AzureBrowsePage } from "./azureBrowsePage";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { ConnectionFormPage } from "./connectionFormPage";
import { ConnectionHeader } from "./components/connectionHeader.component";
import { TrustServerCertificateDialog } from "./components/trustServerCertificateDialog.component";
import { ConnectionStringDialog } from "./components/connectionStringDialog.component";
import { locConstants } from "../../common/locConstants";
import { themeType } from "../../common/utils";
import { AddFirewallRuleDialog } from "../AddFirewallRule/addFirewallRule.component";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";

function renderContent(connectionDialogContext: ConnectionDialogContextProps): ReactNode {
    switch (connectionDialogContext?.state.selectedInputMode) {
        case ConnectionInputMode.Parameters:
            return <ConnectionFormPage />;
        case ConnectionInputMode.AzureBrowse:
            return <AzureBrowsePage />;
    }
}

export const ConnectionInfoFormContainer = () => {
    const context = useContext(ConnectionDialogContext)!;
    const formStyles = useFormStyles();

    function azureIcon(colorTheme: ColorThemeKind) {
        const theme = themeType(colorTheme);
        const saveIcon =
            theme === "dark"
                ? require("../../media/azure-inverse.svg")
                : require("../../media/azure.svg");
        return saveIcon;
    }

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
                        {context.state.formError}
                    </MessageBar>
                )}

                {context.state.dialog?.type === "trustServerCert" && (
                    <TrustServerCertificateDialog
                        dialogProps={context.state.dialog as TrustServerCertDialogProps}
                    />
                )}
                {context.state.dialog?.type === "addFirewallRule" && (
                    <AddFirewallRuleDialog
                        dialogProps={context.state.dialog as AddFirewallRuleDialogProps}
                        addFirewallRule={context.addFirewallRule}
                        closeDialog={context.closeDialog}
                    />
                )}
                {context.state.dialog?.type === "loadFromConnectionString" && (
                    <ConnectionStringDialog
                        dialogProps={context.state.dialog as ConnectionStringDialogProps}
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
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                        }}>
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
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                        }}>
                                        <Image
                                            src={azureIcon(context.themeKind)}
                                            alt="Azure"
                                            height={20}
                                            width={20}
                                            style={{ marginRight: "8px" }}
                                        />
                                        {locConstants.connectionDialog.browseAzure}
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
