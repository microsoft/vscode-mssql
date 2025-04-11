/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import { ConnectionDialogContext } from "../connectionDialogStateProvider";
import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Textarea,
    MessageBar,
} from "@fluentui/react-components";
import { Copy24Regular, ClipboardPaste24Regular } from "@fluentui/react-icons";

import { locConstants } from "../../../common/locConstants";
import { ConnectionStringDialogProps } from "../../../../sharedInterfaces/connectionDialog";

export const ConnectionStringDialog = ({
    dialogProps,
}: {
    dialogProps: ConnectionStringDialogProps;
}) => {
    const context = useContext(ConnectionDialogContext)!;
    const [connectionString, setConnectionString] = useState(dialogProps.connectionString || "");

    if (context.state.dialog?.type !== "loadFromConnectionString") {
        return undefined;
    }

    const handleCopyConnectionString = async () => {
        try {
            await navigator.clipboard.writeText(connectionString);
        } catch (error) {
            console.error("Failed to copy connection string: ", error);
        }
    };

    const handlePasteConnectionString = async () => {
        try {
            const text = await navigator.clipboard.readText();
            setConnectionString(text);
        } catch (error) {
            console.error("Failed to paste connection string: ", error);
        }
    };

    return (
        <Dialog open={dialogProps.type === "loadFromConnectionString"}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>
                        {locConstants.connectionDialog.connectionStringDialogTitle}
                    </DialogTitle>
                    <DialogContent>
                        {dialogProps.connectionStringError && (
                            <>
                                <MessageBar intent="error" style={{ paddingRight: "12px" }}>
                                    {dialogProps.connectionStringError}
                                </MessageBar>
                                <br />
                            </>
                        )}
                        <div>{locConstants.connectionDialog.connectionStringDialogPrompt}</div>
                        <div
                            style={{ display: "flex", flexDirection: "column", marginTop: "10px" }}>
                            {" "}
                            <Textarea
                                value={connectionString}
                                onChange={(_e, data) => setConnectionString(data.value)}
                                resize="none"
                                style={{
                                    height: "200px",
                                }}
                            />
                            <div
                                style={{
                                    display: "flex",
                                    justifyContent: "flex-end",
                                    marginTop: "5px",
                                    gap: "5px",
                                }}>
                                <Button
                                    icon={<Copy24Regular />}
                                    onClick={handleCopyConnectionString}
                                    title={locConstants.connectionDialog.copyConnectionString}>
                                    {locConstants.connectionDialog.copy}
                                </Button>
                                <Button
                                    icon={<ClipboardPaste24Regular />}
                                    onClick={handlePasteConnectionString}
                                    title={locConstants.connectionDialog.pasteConnectionString}>
                                    {locConstants.connectionDialog.paste}
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                    <DialogActions>
                        <Button
                            appearance="primary"
                            onClick={() => {
                                context.closeDialog();
                                context.formAction({
                                    propertyName: "connectionString",
                                    value: connectionString,
                                    isAction: false,
                                });
                                context.loadFromConnectionString();
                            }}>
                            {locConstants.common.load}
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
