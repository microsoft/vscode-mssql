/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReactNode, useContext } from "react";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import {
    Field,
    MessageBar,
    Radio,
    RadioGroup,
    Image,
    Theme,
} from "@fluentui/react-components";
import { SlideText20Regular, Form20Regular } from "@fluentui/react-icons";
import {
    ConnectionDialogContextProps,
    IConnectionDialogProfile,
    ConnectionInputMode,
} from "../../../sharedInterfaces/connectionDialog";
import "./sqlServerRotation.css";

import { ConnectionHeader } from "./components/connectionHeader.component";
import { ConnectionFormPage } from "./connectionFormPage";
import { ConnectionStringPage } from "./connectionStringPage";
import { FormField, useFormStyles } from "../../common/forms/form.component";
import { FormItemSpec } from "../../common/forms/form";
import { locConstants } from "../../common/locConstants";
import { AzureBrowsePage } from "./azureBrowsePage";
import { TrustServerCertificateDialog } from "./components/trustServerCertificateDialog.component";
import { themeType } from "../../common/utils";

function renderContent(
    connectionDialogContext: ConnectionDialogContextProps,
): ReactNode {
    switch (connectionDialogContext?.state.selectedInputMode) {
        case ConnectionInputMode.Parameters:
            return <ConnectionFormPage />;
        case ConnectionInputMode.ConnectionString:
            return <ConnectionStringPage />;
        case ConnectionInputMode.AzureBrowse:
            return <AzureBrowsePage />;
    }
}

export const ConnectionInfoFormContainer = () => {
    const context = useContext(ConnectionDialogContext)!;
    const formStyles = useFormStyles();

    function azureIcon(colorTheme: Theme) {
        const theme = themeType(colorTheme);
        const saveIcon =
            theme === "dark"
                ? require("../../media/azure-inverse.svg")
                : require("../../media/azure.svg");
        return saveIcon;
    }

    return (
        <div className={formStyles.formRoot}>
            <ConnectionHeader />

            <div className={formStyles.formDiv} style={{ overflow: "auto" }}>
                {context.state.formError && (
                    <MessageBar intent="error">
                        {context.state.formError}
                    </MessageBar>
                )}
                <TrustServerCertificateDialog />
                <FormField
                    context={context}
                    component={
                        context.state.connectionComponents.components[
                            "profileName"
                        ] as FormItemSpec<IConnectionDialogProfile>
                    }
                    idx={0}
                    props={{ orientation: "horizontal" }}
                />

                <div className={formStyles.formComponentDiv}>
                    <Field label="Input type" orientation="horizontal">
                        <RadioGroup
                            onChange={(_, data) => {
                                context.setConnectionInputType(
                                    data.value as ConnectionInputMode,
                                );
                            }}
                            value={context.state.selectedInputMode}
                        >
                            <Radio
                                value={ConnectionInputMode.Parameters}
                                label={
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                        }}
                                    >
                                        <Form20Regular
                                            style={{ marginRight: "8px" }}
                                        />
                                        {
                                            locConstants.connectionDialog
                                                .parameters
                                        }
                                    </div>
                                }
                            />
                            <Radio
                                value={ConnectionInputMode.ConnectionString}
                                label={
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                        }}
                                    >
                                        <SlideText20Regular
                                            style={{ marginRight: "8px" }}
                                        />
                                        {
                                            locConstants.connectionDialog
                                                .connectionString
                                        }
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
                                        }}
                                    >
                                        <Image
                                            src={azureIcon(context.theme)}
                                            alt="Azure"
                                            height={20}
                                            width={20}
                                            style={{ marginRight: "8px" }}
                                        />
                                        {
                                            locConstants.connectionDialog
                                                .browseAzure
                                        }
                                    </div>
                                }
                            />
                        </RadioGroup>
                    </Field>
                </div>
                {renderContent(context)}
            </div>
        </div>
    );
};
