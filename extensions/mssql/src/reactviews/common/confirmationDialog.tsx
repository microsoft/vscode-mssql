/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from "react";
import { Button } from "@fluentui/react-components";
import {
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    DialogTrigger,
} from "@fluentui/react-dialog";

export interface ConfirmationDialogAction {
    label: string;
    appearance?: "primary" | "secondary" | "subtle";
    /** Called when this action button is clicked (dialog auto-closes after). */
    onClick?: () => void;
    disabled?: boolean;
}

export interface ConfirmationDialogProps {
    title: string;
    message: string | React.ReactNode;
    /** Action buttons shown before the optional cancel button. */
    actions?: ConfirmationDialogAction[];
    /** When provided, a cancel button is rendered as the last action. */
    cancelLabel?: string;
    cancelAppearance?: "primary" | "secondary" | "subtle";
    /**
     * Called when the cancel button is clicked.
     * Escape/backdrop dismissal does NOT invoke this; use onClose for that.
     * */
    onCancel?: () => void;
    /** Width of the dialog surface, e.g. "600px". Defaults to Fluent UI's built-in size. */
    width?: string;
    /** Whether the dialog is open. */
    open: boolean;
    /** Called when the dialog requests to be closed (Escape, backdrop, action buttons). */
    onClose?: () => void;
}

/**
 * A generic confirmation dialog. The caller owns the open state — pass `open`
 * and toggle it from the outside to show/hide the dialog.
 *
 * Every action button (including the optional cancel) automatically closes
 * the dialog via `DialogTrigger action="close"`.
 */
export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
    title,
    message,
    actions = [],
    cancelLabel,
    cancelAppearance = "subtle",
    onCancel,
    width,
    open,
    onClose,
}) => {
    const surface = (
        <DialogSurface style={width ? { width, maxWidth: width } : undefined}>
            <DialogBody>
                <DialogTitle>{title}</DialogTitle>
                <DialogContent>{message}</DialogContent>
                {(actions.length > 0 || cancelLabel) && (
                    <DialogActions>
                        {actions.map((action, i) => (
                            <DialogTrigger key={i} action="close">
                                <Button
                                    appearance={action.appearance ?? "primary"}
                                    disabled={action.disabled}
                                    onClick={action.onClick}>
                                    {action.label}
                                </Button>
                            </DialogTrigger>
                        ))}
                        {cancelLabel && (
                            <DialogTrigger action="close">
                                <Button appearance={cancelAppearance} onClick={onCancel}>
                                    {cancelLabel}
                                </Button>
                            </DialogTrigger>
                        )}
                    </DialogActions>
                )}
            </DialogBody>
        </DialogSurface>
    );

    return (
        <Dialog
            inertTrapFocus
            open={open}
            onOpenChange={(_e: unknown, data: { open: boolean }) => {
                if (!data.open) {
                    onClose?.();
                }
            }}>
            {surface}
        </Dialog>
    );
};
