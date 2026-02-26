/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Tooltip } from "@fluentui/react-components";
import { useContext } from "react";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { ExecuteCommandRequest } from "../../../../sharedInterfaces/webview";
import { GithubCopilot16Regular } from "../../../common/icons/fluentIcons";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { useSchemaDesignerSelector } from "../schemaDesignerSelector";
import { locConstants } from "../../../common/locConstants";

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
                icon={<GithubCopilot16Regular />}
                onClick={async () => {
                    await context.extensionRpc.sendRequest(ExecuteCommandRequest.type, {
                        command: SchemaDesigner.openCopilotAgentCommand,
                    });
                }}>
                {locConstants.schemaDesigner.openCopilotForSchemaDesigner}
            </Button>
        </Tooltip>
    );
}
