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
    className?: string;
    panelClassName?: string;
}

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
    title,
    children,
    defaultOpen = false,
    className,
    panelClassName,
}) => {
    const classes = useStyles();
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div className={mergeClasses(classes.root, className)}>
            <button
                type="button"
                className={classes.toggleButton}
                onClick={() => setOpen((value) => !value)}
                aria-expanded={open}>
                <span className={classes.chevron}>
                    {open ? <ChevronDown16Regular /> : <ChevronRight16Regular />}
                </span>
                <span className={classes.title}>{title}</span>
            </button>
            {open && <div className={mergeClasses(classes.body, panelClassName)}>{children}</div>}
        </div>
    );
};
