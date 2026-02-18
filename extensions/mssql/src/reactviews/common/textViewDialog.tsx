/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Textarea,
    MessageBar,
    makeStyles,
} from "@fluentui/react-components";
import { useRef, useEffect } from "react";

const useStyles = makeStyles({
    dialogTitle: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
    },
    headerButtons: {
        display: "flex",
        gap: "4px",
    },
    contentWrapper: {
        display: "flex",
        flexDirection: "column",
        marginTop: "10px",
    },
    errorMessageWrapper: {
        paddingRight: "12px",
        marginBottom: "10px",
    },
});

export interface TextViewDialogHeaderButton {
    icon: React.JSX.Element;
    title: string;
    onClick: () => void;
}

export interface TextViewDialogAction {
    label: string;
    appearance?: "primary" | "secondary" | "transparent";
    onClick: () => void;
}

export interface TextViewDialogProps {
    /** Whether the dialog is open */
    isOpen: boolean;
    /** Callback when dialog should close (ESC key, backdrop click, etc) */
    onClose: () => void;
    /** Dialog title */
    title: string;
    /** Text content to display */
    text: string;
    /** Callback when text changes (only for editable dialogs) */
    onTextChange?: (text: string) => void;
    /** Whether the textarea is read-only */
    readOnly?: boolean;
    /** Height of the textarea */
    textareaHeight?: string;
    /** Additional CSS class name for textarea */
    textareaClassName?: string;
    /** Error message to display above the textarea */
    errorMessage?: string;
    /** Custom header buttons (icons) to display in the title bar */
    headerButtons?: TextViewDialogHeaderButton[];
    /** Action buttons to display at the bottom of the dialog */
    actions: TextViewDialogAction[];
    /** Whether to auto-focus the textarea when dialog opens */
    autoFocus?: boolean;
    /** ARIA label for the textarea */
    ariaLabel?: string;
}

/**
 * Reusable generic dialog component for displaying and/or editing text content.
 * Used by SqlPackageCommandDialog and ConnectionStringDialog.
 */
export const TextViewDialog: React.FC<TextViewDialogProps> = ({
    isOpen,
    onClose,
    title,
    text,
    onTextChange,
    readOnly = false,
    textareaHeight = "200px",
    textareaClassName,
    errorMessage,
    headerButtons = [],
    actions,
    autoFocus = true,
    ariaLabel,
}) => {
    const styles = useStyles();
    // eslint-disable-next-line no-restricted-syntax -- Ref needs to be null, not undefined
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    // Automatically focus the textarea when the dialog opens
    useEffect(() => {
        if (autoFocus && isOpen && textareaRef.current) {
            // Small delay to ensure the dialog is fully rendered
            setTimeout(() => {
                textareaRef.current?.focus();
            }, 50);
        }
    }, [autoFocus, isOpen]);

    return (
        <Dialog open={isOpen} onOpenChange={(_, data) => !data.open && onClose()}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle className={styles.dialogTitle}>
                        <span>{title}</span>
                        {headerButtons.length > 0 && (
                            <div className={styles.headerButtons}>
                                {headerButtons.map((button, index) => (
                                    <Button
                                        key={index}
                                        appearance="transparent"
                                        size="small"
                                        icon={button.icon}
                                        onClick={button.onClick}
                                        title={button.title}
                                    />
                                ))}
                            </div>
                        )}
                    </DialogTitle>
                    <DialogContent>
                        {errorMessage && (
                            <MessageBar intent="error" className={styles.errorMessageWrapper}>
                                {errorMessage}
                            </MessageBar>
                        )}
                        <div className={styles.contentWrapper}>
                            <Textarea
                                ref={textareaRef}
                                value={text}
                                onChange={(_e, data) => onTextChange?.(data.value)}
                                readOnly={readOnly}
                                resize="none"
                                style={{ height: textareaHeight }}
                                className={textareaClassName}
                                aria-label={ariaLabel}
                            />
                        </div>
                    </DialogContent>
                    <DialogActions>
                        {actions.map((action, index) => (
                            <Button
                                key={index}
                                appearance={action.appearance || "secondary"}
                                onClick={action.onClick}>
                                {action.label}
                            </Button>
                        ))}
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
