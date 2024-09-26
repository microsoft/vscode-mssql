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
} from "@fluentui/react-components";
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
    const connectionDialogContext = useContext(ConnectionDialogContext);
    const formStyles = useFormStyles();

    if (!connectionDialogContext?.state) {
        return undefined;
    }

    return (
        <div className={formStyles.formRoot}>
            <ConnectionHeader />

            <div className={formStyles.formDiv}>
                {connectionDialogContext?.state.formError && (
                    <MessageBar intent="error">
                        {connectionDialogContext.state.formError}
                    </MessageBar>
                )}
                <FormField
                    context={connectionDialogContext}
                    component={
                        connectionDialogContext.state.connectionComponents
                            .components[
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
                                connectionDialogContext.setConnectionInputType(
                                    data.value as ConnectionInputMode,
                                );
                            }}
                            value={
                                connectionDialogContext.state.selectedInputMode
                            }
                        >
                            <Radio
                                value={ConnectionInputMode.Parameters}
                                label={locConstants.connectionDialog.parameters}
                            />
                            <Radio
                                value={ConnectionInputMode.ConnectionString}
                                label={
                                    locConstants.connectionDialog
                                        .connectionString
                                }
                            />
                            <Radio
                                value={ConnectionInputMode.AzureBrowse}
                                label={
                                    locConstants.connectionDialog.browseAzure
                                }
                            />
                        </RadioGroup>
                    </Field>
                </div>
                <div style={{ overflow: "auto" }}>
                    {renderContent(connectionDialogContext)}
                </div>
            </div>
        </div>
    );
};
