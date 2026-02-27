/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { CopilotChat } from "../../../../sharedInterfaces/copilotChat";
import { ExecuteCommandRequest } from "../../../../sharedInterfaces/webview";
import { CopilotChatEntry } from "../../../common/copilot/copilotChatEntry";
import { locConstants } from "../../../common/locConstants";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { useSchemaDesignerSelector } from "../schemaDesignerSelector";

interface SchemaDesignerWebviewCopilotChatEntryProps {
    scenario: CopilotChat.Scenario;
    entryPoint: CopilotChat.EntryPoint;
    discoveryTitle: string;
    discoveryBody: string;
    showDiscovery: boolean;
}

export function SchemaDesignerWebviewCopilotChatEntry({
    scenario,
    entryPoint,
    discoveryTitle,
    discoveryBody,
    showDiscovery,
}: SchemaDesignerWebviewCopilotChatEntryProps) {
    const context = useContext(SchemaDesignerContext);
    const isCopilotChatInstalled =
        useSchemaDesignerSelector((s) => s?.isCopilotChatInstalled) ?? false;
    const isDiscoveryDismissed =
        useSchemaDesignerSelector((s) => s?.copilotChatDiscoveryDismissed?.[scenario]) ?? false;
    const [isDiscoveryOpen, setIsDiscoveryOpen] = useState(!isDiscoveryDismissed);
    const hasDismissedDiscoveryRef = useRef(isDiscoveryDismissed);

    if (!context || !isCopilotChatInstalled) {
        return null;
    }

    useEffect(() => {
        hasDismissedDiscoveryRef.current = isDiscoveryDismissed;
        setIsDiscoveryOpen(!isDiscoveryDismissed);
    }, [isDiscoveryDismissed]);

    const dismissDiscovery = useCallback(() => {
        setIsDiscoveryOpen(false);
        if (hasDismissedDiscoveryRef.current) {
            return;
        }

        hasDismissedDiscoveryRef.current = true;
        context.extensionRpc.action("dismissCopilotChatDiscovery", {
            scenario,
        });
    }, [context.extensionRpc, scenario]);

    const openChat = useCallback(async () => {
        await context.extensionRpc.sendRequest(ExecuteCommandRequest.type, {
            command: CopilotChat.openFromUiCommand,
            args: [{ scenario, entryPoint }],
        });
    }, [context.extensionRpc, entryPoint, scenario]);

    return (
        <CopilotChatEntry
            label={locConstants.schemaDesigner.openCopilotForSchemaDesigner}
            tooltip={locConstants.schemaDesigner.openCopilotForSchemaDesignerTooltip}
            onOpenChat={openChat}
            discovery={{
                open: isDiscoveryOpen && showDiscovery,
                title: discoveryTitle,
                body: discoveryBody,
                primaryActionLabel: locConstants.common.tryIt,
                secondaryActionLabel: locConstants.common.dismiss,
                onDismiss: dismissDiscovery,
            }}
        />
    );
}
