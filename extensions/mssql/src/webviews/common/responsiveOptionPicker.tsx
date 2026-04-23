/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Dropdown,
    makeStyles,
    Option,
    OptionOnSelectData,
    SelectionEvents,
} from "@fluentui/react-components";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { SegmentedControl } from "./segmentedControl";

const HYSTERESIS = 10;

const useStyles = makeStyles({
    root: {
        flex: "1 1 auto",
        minWidth: 0,
        maxWidth: "100%",
        flexShrink: 1,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
    },
    visible: {
        marginLeft: "auto",
        minWidth: 0,
        maxWidth: "100%",
        display: "flex",
        alignItems: "center",
    },
    segmented: {
        minWidth: "max-content",
        flexShrink: 0,
    },
    measure: {
        position: "absolute",
        visibility: "hidden",
        pointerEvents: "none",
        whiteSpace: "nowrap",
    },
    dropdown: {
        minWidth: "140px",
        maxWidth: "100%",
    },
});

export interface ResponsiveOptionPickerOption<T extends string> {
    value: T;
    label: string;
}

interface ResponsiveOptionPickerProps<T extends string> {
    ariaLabel: string;
    options: ResponsiveOptionPickerOption<T>[];
    selectedValue: T;
    onValueChange: (value: T) => void;
}

/**
 * A responsive option picker that switches between a segmented control and a dropdown
 * based on the available width.
 * @param param0 The props for the responsive option picker.
 * @returns A React element representing the responsive option picker.
 */
export function ResponsiveOptionPicker<T extends string>({
    ariaLabel,
    options,
    selectedValue,
    onValueChange,
}: ResponsiveOptionPickerProps<T>) {
    const classes = useStyles();
    const rootRef = useRef<HTMLDivElement | null>(null);
    const measureRef = useRef<HTMLDivElement | null>(null);
    const fullWidthRef = useRef(0);
    const [isCompact, setIsCompact] = useState(false);

    const selectedLabel = useMemo(
        () => options.find((option) => option.value === selectedValue)?.label ?? "",
        [options, selectedValue],
    );

    useLayoutEffect(() => {
        const root = rootRef.current;
        if (!root) {
            return;
        }

        const check = () => {
            fullWidthRef.current =
                measureRef.current?.getBoundingClientRect().width ?? fullWidthRef.current;

            if (isCompact) {
                if (root.clientWidth >= fullWidthRef.current + HYSTERESIS) {
                    setIsCompact(false);
                }
                return;
            }

            if (fullWidthRef.current > root.clientWidth + 1) {
                setIsCompact(true);
            }
        };

        check();

        const observer = new ResizeObserver(check);
        observer.observe(root);
        return () => observer.disconnect();
    }, [isCompact]);

    const handleDropdownSelect = (_event: SelectionEvents, data: OptionOnSelectData) => {
        const nextValue = data.optionValue as T | undefined;
        if (nextValue) {
            onValueChange(nextValue);
        }
    };

    return (
        <div className={classes.root} ref={rootRef}>
            <div aria-hidden="true" className={classes.measure} ref={measureRef}>
                <SegmentedControl
                    ariaLabel={ariaLabel}
                    className={classes.segmented}
                    options={options}
                    value={selectedValue}
                    onValueChange={() => {}}
                />
            </div>
            <div className={classes.visible}>
                {isCompact ? (
                    <Dropdown
                        aria-label={ariaLabel}
                        className={classes.dropdown}
                        selectedOptions={[selectedValue]}
                        value={selectedLabel}
                        onOptionSelect={handleDropdownSelect}>
                        {options.map((option) => (
                            <Option key={option.value} value={option.value} text={option.label}>
                                {option.label}
                            </Option>
                        ))}
                    </Dropdown>
                ) : (
                    <SegmentedControl
                        ariaLabel={ariaLabel}
                        className={classes.segmented}
                        options={options}
                        value={selectedValue}
                        onValueChange={onValueChange}
                    />
                )}
            </div>
        </div>
    );
}
