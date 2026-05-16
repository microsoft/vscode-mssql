/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Checkbox,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    makeStyles,
} from "@fluentui/react-components";
import { ReactElement, ReactNode } from "react";
import Markdown from "react-markdown";
import { useMarkdownStyles } from "./styles";

const useStyles = makeStyles({
    surface: {
        width: "800px",
        maxWidth: "800px",
        height: "640px",
        maxHeight: "calc(100vh - 64px)",
    },
    body: {
        height: "100%",
        maxHeight: "100%",
        display: "flex",
        flexDirection: "column",
    },
    content: {
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
    },
    actions: {
        flexShrink: 0,
        position: "sticky",
        bottom: 0,
        backgroundColor: "var(--vscode-editor-background)",
        borderTop: "1px solid var(--vscode-editorWidget-border)",
        paddingTop: "12px",
    },
    reportLayout: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
    },
    reportScroll: {
        width: "100%",
        flex: 1,
        minHeight: 0,
        overflow: "auto",
    },
    markdownFill: {
        minHeight: "calc(100% - 16px)",
        boxSizing: "border-box",
    },
    stickyConfirmation: {
        flexShrink: 0,
        position: "sticky",
        bottom: 0,
        padding: "8px 0",
        backgroundColor: "var(--vscode-editor-background)",
        borderTop: "1px solid var(--vscode-editorWidget-border)",
        display: "flex",
        alignItems: "center",
        outline: "none",
    },
    confirmationCheckbox: {
        display: "inline-flex",
        alignItems: "center",
        width: "fit-content",
        maxWidth: "100%",
        paddingRight: "4px",
        flexGrow: 0,
        alignSelf: "center",
    },
    centeredContent: {
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
    },
});

export interface PublishDialogFrameProps {
    trigger: ReactElement;
    title: string;
    content: ReactNode;
    actions?: ReactNode;
    open?: boolean;
    inertTrapFocus?: boolean;
    onOpenChange?: (open: boolean) => void;
}

export function PublishDialogFrame({
    trigger,
    title,
    content,
    actions,
    open,
    inertTrapFocus,
    onOpenChange,
}: PublishDialogFrameProps) {
    const classes = useStyles();

    return (
        <Dialog
            open={open}
            inertTrapFocus={inertTrapFocus}
            onOpenChange={(_event, data) => onOpenChange?.(data.open)}>
            {trigger}
            <DialogSurface className={classes.surface}>
                <DialogBody className={classes.body}>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogContent className={classes.content}>{content}</DialogContent>
                    {actions && (
                        <DialogActions className={classes.actions}>{actions}</DialogActions>
                    )}
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
}

export interface PublishDialogReportProps {
    markdown: string;
    header?: ReactNode;
    confirmationLabel?: string;
    confirmationChecked?: boolean;
    onConfirmationChange?: (checked: boolean) => void;
}

export function PublishDialogReport({
    markdown,
    header,
    confirmationLabel,
    confirmationChecked,
    onConfirmationChange,
}: PublishDialogReportProps) {
    const classes = useStyles();
    const markdownClasses = useMarkdownStyles();

    return (
        <div className={classes.reportLayout}>
            {header}
            <div className={classes.reportScroll}>
                <div className={`${markdownClasses.markdownPage} ${classes.markdownFill}`}>
                    <Markdown>{markdown}</Markdown>
                </div>
            </div>
            {confirmationLabel && (
                <div className={classes.stickyConfirmation}>
                    <Checkbox
                        className={classes.confirmationCheckbox}
                        label={confirmationLabel}
                        required
                        checked={confirmationChecked}
                        onChange={(_event, data) => {
                            onConfirmationChange?.(data.checked as boolean);
                        }}
                        autoFocus
                    />
                </div>
            )}
        </div>
    );
}

export function PublishDialogCenteredContent({ children }: { children: ReactNode }) {
    const classes = useStyles();

    return <div className={classes.centeredContent}>{children}</div>;
}
