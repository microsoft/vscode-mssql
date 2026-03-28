/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button } from "@fluentui/react-components";
import { ReactNode } from "react";
import { DialogPageShell, DialogPageShellContentWidth } from "./dialogPageShell";
import { Info16Regular, Code16Regular } from "@fluentui/react-icons";

export interface ObjectManagementDialogProps {
    icon?: ReactNode;
    title?: string;
    subtitle?: string;
    description?: string;
    errorMessage?: string;
    loadingMessage?: string;
    maxContentWidth?: DialogPageShellContentWidth;
    primaryLabel: string;
    cancelLabel: string;
    helpLabel?: string;
    scriptLabel?: string;
    primaryDisabled?: boolean;
    scriptDisabled?: boolean;
    onPrimary?: () => void | Promise<void>;
    onCancel?: () => void | Promise<void>;
    onHelp?: () => void | Promise<void>;
    onScript?: () => void | Promise<void>;
    children?: ReactNode;
}

export const ObjectManagementDialog = ({
    icon,
    title,
    subtitle,
    description,
    errorMessage,
    loadingMessage,
    maxContentWidth,
    primaryLabel,
    cancelLabel,
    helpLabel,
    scriptLabel,
    primaryDisabled,
    scriptDisabled,
    onPrimary,
    onCancel,
    onHelp,
    onScript,
    children,
}: ObjectManagementDialogProps) => {
    return (
        <DialogPageShell
            icon={icon}
            title={title}
            subtitle={subtitle ?? description}
            errorMessage={errorMessage}
            loadingMessage={loadingMessage}
            maxContentWidth={maxContentWidth ?? "medium"}
            footerStart={
                <>
                    {helpLabel && (
                        <Button
                            size="medium"
                            appearance="secondary"
                            icon={<Info16Regular />}
                            disabled={!onHelp}
                            onClick={() => onHelp?.()}>
                            {helpLabel}
                        </Button>
                    )}
                    {scriptLabel && (
                        <Button
                            size="medium"
                            appearance="secondary"
                            icon={<Code16Regular />}
                            disabled={!onScript || scriptDisabled}
                            onClick={() => onScript?.()}>
                            {scriptLabel}
                        </Button>
                    )}
                </>
            }
            footerEnd={
                <>
                    <Button size="medium" appearance="secondary" onClick={() => onCancel?.()}>
                        {cancelLabel}
                    </Button>
                    <Button
                        size="medium"
                        appearance="primary"
                        disabled={primaryDisabled}
                        onClick={() => onPrimary?.()}>
                        {primaryLabel}
                    </Button>
                </>
            }>
            {children}
        </DialogPageShell>
    );
};
