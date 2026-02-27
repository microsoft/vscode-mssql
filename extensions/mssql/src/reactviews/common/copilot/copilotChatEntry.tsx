/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useState } from "react";
import { CopilotChatButton } from "./copilotChatButton";
import { FeatureDiscoveryPopover } from "./featureDiscoveryPopover";

interface CopilotChatDiscoveryProps {
    open: boolean;
    title: string;
    body: string;
    primaryActionLabel: string;
    secondaryActionLabel: string;
    onDismiss: () => void;
}

export interface CopilotChatEntryProps {
    label: string;
    tooltip: string;
    onOpenChat: () => void | Promise<void>;
    discovery?: CopilotChatDiscoveryProps;
}

export function CopilotChatEntry({ label, tooltip, onOpenChat, discovery }: CopilotChatEntryProps) {
    const [target, setTarget] = useState<HTMLButtonElement | null>(null);

    const handleOpenChat = async () => {
        if (discovery?.open) {
            discovery.onDismiss();
        }
        await onOpenChat();
    };

    return (
        <>
            <CopilotChatButton
                ref={setTarget}
                label={label}
                tooltip={tooltip}
                onClick={handleOpenChat}
            />
            {discovery && (
                <FeatureDiscoveryPopover
                    open={discovery.open}
                    target={target}
                    title={discovery.title}
                    body={discovery.body}
                    primaryActionLabel={discovery.primaryActionLabel}
                    secondaryActionLabel={discovery.secondaryActionLabel}
                    onPrimaryAction={handleOpenChat}
                    onDismiss={discovery.onDismiss}
                />
            )}
        </>
    );
}
