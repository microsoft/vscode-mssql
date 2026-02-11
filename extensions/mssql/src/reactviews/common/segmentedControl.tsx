/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ToggleButton, makeStyles, mergeClasses, ButtonProps } from "@fluentui/react-components";
import { ReactNode } from "react";

const useStyles = makeStyles({
    root: {
        display: "inline-flex",
        alignItems: "center",
        border: "1px solid var(--vscode-toolbar-hoverBackground)",
        borderRadius: "4px",
        overflow: "hidden",
    },
    button: {
        borderRadius: 0,
    },
});

export interface SegmentedControlOption<T extends string = string> {
    value: T;
    label: ReactNode;
    disabled?: boolean;
}

interface SegmentedControlProps<T extends string = string> {
    value: T;
    options: SegmentedControlOption<T>[];
    onValueChange: (value: T) => void;
    size?: ButtonProps["size"];
    className?: string;
    buttonClassName?: string;
}

export function SegmentedControl<T extends string = string>({
    value,
    options,
    onValueChange,
    size = "small",
    className,
    buttonClassName,
}: SegmentedControlProps<T>) {
    const classes = useStyles();

    return (
        <div className={mergeClasses(classes.root, className)}>
            {options.map((option) => (
                <ToggleButton
                    key={option.value}
                    size={size}
                    checked={value === option.value}
                    disabled={option.disabled}
                    appearance={value === option.value ? "primary" : "subtle"}
                    className={mergeClasses(classes.button, buttonClassName)}
                    onClick={() => onValueChange(option.value)}>
                    {option.label}
                </ToggleButton>
            ))}
        </div>
    );
}
