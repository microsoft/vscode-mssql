/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Tooltip } from "@fluentui/react-components";
import { Chat16Regular } from "@fluentui/react-icons";
import { useContext } from "react";
import { ExecuteCommandRequest } from "../../../../sharedInterfaces/webview";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { useSchemaDesignerSelector } from "../schemaDesignerSelector";
import { locConstants } from "../../../common/locConstants";

const schemaDesignerOpenCopilotAgentCommand = "mssql.schemaDesigner.openCopilotAgent";

export function OpenCopilotChatButton() {
    const context = useContext(SchemaDesignerContext);
    const isCopilotChatInstalled =
        useSchemaDesignerSelector((s) => s?.isCopilotChatInstalled) ?? false;

    if (!context || !isCopilotChatInstalled) {
        return undefined;
    }

    return (
        <Tooltip
            content={locConstants.schemaDesigner.openCopilotForSchemaDesignerTooltip}
            relationship="label">
            <Button
                appearance="subtle"
                size="small"
                icon={<Chat16Regular />}
                onClick={async () => {
                    await context.extensionRpc.sendRequest(ExecuteCommandRequest.type, {
                        command: schemaDesignerOpenCopilotAgentCommand,
                    });
                }}>
                {locConstants.schemaDesigner.openCopilotForSchemaDesigner}
            </Button>
        </Tooltip>
    );
}
