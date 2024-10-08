/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { ConnectionDialogContext } from "../connectionDialogStateProvider";
import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Link,
    MessageBar,
} from "@fluentui/react-components";

import { locConstants } from "../../../common/locConstants";
import { connectionCertValidationReadMoreUrl } from "../connectionConstants";
import { ConnectionInputMode } from "../../../../sharedInterfaces/connectionDialog";

export const TrustServerCertificateDialog = ({}) => {
    const context = useContext(ConnectionDialogContext)!;

    return (
        <Dialog open={context.state.trustServerCertError !== undefined}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>
                        {locConstants.connectionDialog.connectionErrorTitle}
                    </DialogTitle>
                    <DialogContent>
                        <MessageBar
                            intent="error"
                            style={{ paddingRight: "12px" }}
                        >
                            {context.state.trustServerCertError}
                        </MessageBar>
                        <br />
                        {locConstants.connectionDialog.trustServerCertMessage}
                        <br />
                        <br />
                        {locConstants.connectionDialog.trustServerCertPrompt}
                        {" " /* extra space before the 'Read More' link*/}
                        <Link href={connectionCertValidationReadMoreUrl}>
                            {locConstants.connectionDialog.readMore}
                        </Link>
                    </DialogContent>
                    <DialogActions>
                        <Button
                            appearance="primary"
                            onClick={() => {
                                context.cancelTrustServerCertDialog();
                                if (
                                    context.state.selectedInputMode ===
                                    ConnectionInputMode.ConnectionString
                                ) {
                                    context.formAction({
                                        propertyName: "connectionString",
                                        value: setConnectionStringProperty(
                                            context.state.formState
                                                .connectionString ?? "",
                                            "trustServerCertificate",
                                            true,
                                        ),
                                        isAction: false,
                                    });
                                } else {
                                    context.formAction({
                                        propertyName: "trustServerCertificate",
                                        value: true,
                                        isAction: false,
                                    });
                                }
                                context.connect();
                            }}
                        >
                            {
                                locConstants.connectionDialog
                                    .enableTrustServerCertificateButton
                            }
                        </Button>
                        <Button
                            appearance="secondary"
                            onClick={() => {
                                context.cancelTrustServerCertDialog();
                            }}
                        >
                            {locConstants.connectionDialog.close}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};

function setConnectionStringProperty(
    connectionString: string,
    propertyName: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: any,
): string {
    const regex = new RegExp(`${propertyName}\\s*=`); // check for existence of the property
    if (regex.test(connectionString)) {
        const valueRegex = new RegExp(`${propertyName}\\s*=\\s*[^;]*`); // grab the entirety of "propertyName=value"
        return connectionString.replace(valueRegex, `${propertyName}=${value}`);
    } else {
        return `${connectionString};${propertyName}=${value}`;
    }
}
