/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Tooltip } from "@fluentui/react-components";
import { forwardRef } from "react";
import { GithubCopilot16Regular } from "../icons/fluentIcons";

export interface CopilotChatButtonProps {
    label: string;
    tooltip: string;
    onClick: () => void | Promise<void>;
}

export const CopilotChatButton = forwardRef<HTMLButtonElement, CopilotChatButtonProps>(
    ({ label, tooltip, onClick }, ref) => {
        return (
            <Tooltip content={tooltip} relationship="label">
                <Button
                    ref={ref}
                    appearance="subtle"
                    size="small"
                    icon={<GithubCopilot16Regular />}
                    title={tooltip}
                    aria-label={tooltip}
                    onClick={() => void onClick()}>
                    {label}
                </Button>
            </Tooltip>
        );
    },
);

CopilotChatButton.displayName = "CopilotChatButton";
