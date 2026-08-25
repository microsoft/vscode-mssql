/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, ButtonProps, makeStyles, mergeClasses } from "@fluentui/react-components";
import { ComponentPropsWithoutRef, PropsWithChildren, forwardRef } from "react";

const useStyles = makeStyles({
    widget: {
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        minHeight: "34px",
        padding: "4px",
        gap: "3px",
        border: "1px solid var(--vscode-editorWidget-border, transparent)",
        borderRadius: "4px",
        backgroundColor: "var(--vscode-editorWidget-background)",
        boxShadow: "0 2px 8px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.36))",
        color: "var(--vscode-editorWidget-foreground)",
        fontFamily: "var(--vscode-font-family)",
        fontSize: "12px",
    },
    action: {
        width: "20px",
        minWidth: "20px",
        height: "20px",
        minHeight: "20px",
        padding: 0,
        flexShrink: 0,
        borderRadius: "5px",
    },
});

type FloatingWidgetProps = PropsWithChildren<ComponentPropsWithoutRef<"div">>;

export const VscodeFloatingWidget = forwardRef<HTMLDivElement, FloatingWidgetProps>(
    ({ className, children, ...props }, ref) => {
        const classes = useStyles();
        return (
            <div ref={ref} className={mergeClasses(classes.widget, className)} {...props}>
                {children}
            </div>
        );
    },
);
VscodeFloatingWidget.displayName = "VscodeFloatingWidget";

export const VscodeFloatingWidgetAction = forwardRef<HTMLButtonElement, ButtonProps>(
    ({ appearance, className, size, ...props }, ref) => {
        const classes = useStyles();
        return (
            <Button
                ref={ref}
                appearance={appearance ?? "subtle"}
                size={size ?? "small"}
                className={mergeClasses(classes.action, className)}
                {...props}
            />
        );
    },
);
VscodeFloatingWidgetAction.displayName = "VscodeFloatingWidgetAction";
