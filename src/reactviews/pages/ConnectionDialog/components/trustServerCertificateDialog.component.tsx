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
import { TrustServerCertDialogProps } from "../../../../sharedInterfaces/connectionDialog";

export const TrustServerCertificateDialog = ({
    dialogProps,
}: {
    dialogProps: TrustServerCertDialogProps;
}) => {
    const context = useContext(ConnectionDialogContext)!;

    if (context.state.dialog?.type !== "trustServerCert") {
        return undefined;
    }

    return (
        <Dialog open={dialogProps.type === "trustServerCert"}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>{locConstants.connectionDialog.connectionErrorTitle}</DialogTitle>
                    <DialogContent>
                        <MessageBar intent="error" style={{ paddingRight: "12px" }}>
                            {dialogProps.message}
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
                                context.closeDialog();

                                context.formAction({
                                    propertyName: "trustServerCertificate",
                                    value: true,
                                    isAction: false,
                                });

                                context.connect();
                            }}>
                            {locConstants.connectionDialog.enableTrustServerCertificateButton}
                        </Button>
                        <Button
                            appearance="secondary"
                            onClick={() => {
                                context.closeDialog();
                            }}>
                            {locConstants.common.cancel}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
