/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { ChevronDown16Regular, ChevronRight16Regular } from "@fluentui/react-icons";
import { ReactNode, useState } from "react";

const useStyles = makeStyles({
    root: {
        width: "100%",
        boxSizing: "border-box",
        borderRadius: "4px",
        border: "1px solid var(--vscode-editorWidget-border, var(--vscode-input-border, #2d2d2d))",
        overflow: "hidden",
    },
    toggleButton: {
        width: "100%",
        border: "none",
        backgroundColor: "transparent",
        color: tokens.colorNeutralForeground1,
        display: "flex",
        alignItems: "center",
        gap: "7px",
        padding: "9px 12px",
        cursor: "pointer",
        fontFamily: "inherit",
        textAlign: "left",
        fontSize: "13px",
        fontWeight: 600,
    },
    title: {
        display: "flex",
        alignItems: "center",
        gap: "7px",
    },
    chevron: {
        color: tokens.colorNeutralForeground3,
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
    },
    body: {
        borderTop:
            "1px solid var(--vscode-editorWidget-border, var(--vscode-input-border, #2d2d2d))",
        padding: "10px 12px 14px",
    },
});

export interface CollapsibleSectionProps {
    title: ReactNode;
    children: ReactNode;
    defaultOpen?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    className?: string;
    buttonClassName?: string;
    panelClassName?: string;
}

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
    title,
    children,
    defaultOpen = false,
    open,
    onOpenChange,
    className,
    buttonClassName,
    panelClassName,
}) => {
    const classes = useStyles();
    const [internalOpen, setInternalOpen] = useState(defaultOpen);
    const isOpen = open ?? internalOpen;

    const setOpen = (nextOpen: boolean) => {
        if (open === undefined) {
            setInternalOpen(nextOpen);
        }
        onOpenChange?.(nextOpen);
    };

    return (
        <div className={mergeClasses(classes.root, className)}>
            <button
                type="button"
                className={mergeClasses(classes.toggleButton, buttonClassName)}
                onClick={() => setOpen(!isOpen)}
                aria-expanded={isOpen}>
                <span className={classes.chevron}>
                    {isOpen ? <ChevronDown16Regular /> : <ChevronRight16Regular />}
                </span>
                <span className={classes.title}>{title}</span>
            </button>
            {isOpen && <div className={mergeClasses(classes.body, panelClassName)}>{children}</div>}
        </div>
    );
};
