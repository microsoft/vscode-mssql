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
    /** Called when the cancel button or the dialog's dismiss (X) is triggered. */
    onCancel?: () => void;
    /** Width of the dialog surface, e.g. "600px". Defaults to Fluent UI's built-in size. */
    width?: string;
    /**
     * Controlled mode: the caller owns the open state.
     * When omitted the dialog uses uncontrolled mode via `trigger`.
     */
    open?: boolean;
    onClose?: () => void;
    /**
     * Uncontrolled mode: the element that opens the dialog.
     * Rendered as a `DialogTrigger` so no external state is needed.
     */
    trigger?: React.ReactElement;
}

/**
 * A generic confirmation dialog that supports both:
 *  - **Uncontrolled** (pass `trigger`): the trigger button and dialog are co-located;
 *    no `open`/`onClose` state needed in the parent.
 *  - **Controlled** (pass `open` + `onClose`): the caller drives visibility,
 *    e.g. when the dialog should only appear under certain conditions.
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
    trigger,
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

    // Uncontrolled: trigger and dialog are co-located; no external state needed.
    if (open === undefined && React.isValidElement(trigger)) {
        return (
            <Dialog inertTrapFocus>
                <DialogTrigger disableButtonEnhancement>{trigger}</DialogTrigger>
                {surface}
            </Dialog>
        );
    }

    // Controlled: caller drives open/close via props.
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
