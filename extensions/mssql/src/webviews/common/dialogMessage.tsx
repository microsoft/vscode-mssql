/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, MessageBar, MessageBarActions, MessageBarBody } from "@fluentui/react-components";
import { DialogMessageSpec } from "../../sharedInterfaces/dialogMessage";
import { DismissRegular } from "@fluentui/react-icons";
import { locConstants } from "./locConstants";

export const DialogMessage = ({
    message,
    onMessageButtonClicked,
    onCloseMessage,
}: DialogMessageProps) => {
    if (!message) {
        return undefined;
    }

    return (
        <MessageBar intent={message.intent ?? "error"}>
            <MessageBarBody>{message.message}</MessageBarBody>
            <MessageBarActions
                containerAction={
                    <Button
                        onClick={onCloseMessage}
                        aria-label={locConstants.common.dismiss}
                        appearance="transparent"
                        icon={<DismissRegular />}
                    />
                }>
                {message.buttons && (
                    <>
                        {message.buttons.map((button) => (
                            <Button
                                key={button.id}
                                onClick={() => {
                                    onMessageButtonClicked(button.id);
                                }}>
                                {button.label}
                            </Button>
                        ))}
                    </>
                )}
            </MessageBarActions>
        </MessageBar>
    );
};

interface DialogMessageProps {
    message: DialogMessageSpec;
    onMessageButtonClicked: (buttonId: string) => void;
    onCloseMessage: () => void;
}
