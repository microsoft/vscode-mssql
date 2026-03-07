/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import { ConnectionDialogContext } from "../connectionDialogStateProvider";
import { useConnectionDialogSelector } from "../connectionDialogSelector";
import { Copy24Regular, ClipboardPaste24Regular } from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
import { ConnectionStringDialogProps } from "../../../../sharedInterfaces/connectionDialog";
import { TextViewDialog } from "../../../common/textViewDialog";
import { CodeDefinitionIcon16Regular } from "../../../common/icons/fluentIcons";

export const ConnectionStringDialog = ({
    dialogProps,
}: {
    dialogProps: ConnectionStringDialogProps;
}) => {
    const context = useContext(ConnectionDialogContext)!;
    const dialog = useConnectionDialogSelector((s) => s.dialog);
    const [connectionString, setConnectionString] = useState(dialogProps.connectionString || "");

    if (dialog?.type !== "loadFromConnectionString") {
        return undefined;
    }

    const handleCopyConnectionString = async () => {
        try {
            await navigator.clipboard.writeText(connectionString);
        } catch (error) {
            console.error("Failed to copy connection string:", error);
        }
    };

    const handlePasteConnectionString = async () => {
        try {
            const text = await navigator.clipboard.readText();
            setConnectionString(text);
        } catch (error) {
            console.error("Failed to paste connection string:", error);
        }
    };

    return (
        <TextViewDialog
            isOpen={dialogProps.type === "loadFromConnectionString"}
            onClose={() => context.closeDialog()}
            title={
                <>
                    <CodeDefinitionIcon16Regular />
                    {locConstants.connectionDialog.loadFromConnectionString}
                </>
            }
            text={connectionString}
            onTextChange={setConnectionString}
            readOnly={false}
            textareaHeight="200px"
            autoFocus={true}
            ariaLabel={locConstants.connectionDialog.loadFromConnectionString}
            errorMessage={dialogProps.connectionStringError}
            headerButtons={[
                {
                    icon: <Copy24Regular />,
                    title: locConstants.connectionDialog.copyConnectionString,
                    onClick: handleCopyConnectionString,
                },
                {
                    icon: <ClipboardPaste24Regular />,
                    title: locConstants.connectionDialog.pasteConnectionString,
                    onClick: handlePasteConnectionString,
                },
            ]}
            actions={[
                {
                    label: locConstants.common.cancel,
                    appearance: "secondary",
                    onClick: () => context.closeDialog(),
                },
                {
                    label: locConstants.common.load,
                    appearance: "primary",
                    onClick: () => context.loadFromConnectionString(connectionString),
                },
            ]}
        />
    );
};
