/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useState, useCallback, useRef, useEffect } from "react";
import { makeStyles, Input } from "@fluentui/react-components";
import { Search20Regular, Dismiss20Regular } from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";

/**
 * Props for the QuickFilterInput component
 */
export interface QuickFilterInputProps {
    /** Current filter value */
    value: string;
    /** Callback when value changes (debounced) */
    onChange: (value: string) => void;
    /** Placeholder text */
    placeholder?: string;
}

const useStyles = makeStyles({
    root: {
        display: "flex",
        alignItems: "center",
        minWidth: "200px",
        maxWidth: "300px",
    },
    input: {
        width: "100%",
    },
});

/**
 * Maximum length for quick filter input (per spec)
 */
const MAX_LENGTH = 1000;

/**
 * Debounce delay in milliseconds
 */
const DEBOUNCE_DELAY_MS = 200;

/**
 * QuickFilterInput component provides a debounced text input for
 * filtering across all columns in the profiler grid.
 *
 * Features:
 * - RAF-based debounce (no setTimeout per webview constraints)
 * - Search icon prefix
 * - Clear button when input has value
 * - 1000 character max length
 * - Placeholder: "Quick filter all columns..."
 */
export const QuickFilterInput: React.FC<QuickFilterInputProps> = ({
    value,
    onChange,
    placeholder = locConstants.profiler.quickFilterPlaceholder,
}) => {
    const classes = useStyles();

    // Local state for immediate UI updates (not debounced)
    const [localValue, setLocalValue] = useState(value);

    // Track the pending debounced value
    const pendingValueRef = useRef<string | null>(null);
    const rafIdRef = useRef<number | null>(null);
    const lastCallTimeRef = useRef<number>(0);

    // Sync local value when external value changes (e.g., on clear all filters)
    useEffect(() => {
        setLocalValue(value);
    }, [value]);

    // Cleanup RAF on unmount
    useEffect(() => {
        return () => {
            if (rafIdRef.current !== null) {
                cancelAnimationFrame(rafIdRef.current);
            }
        };
    }, []);

    /**
     * RAF-based debounce implementation that respects the 200ms delay
     * without using setTimeout (per webview constraints).
     */
    const debouncedOnChange = useCallback(
        (newValue: string) => {
            pendingValueRef.current = newValue;

            const scheduleUpdate = (timestamp: number) => {
                const elapsed = timestamp - lastCallTimeRef.current;

                if (elapsed >= DEBOUNCE_DELAY_MS) {
                    // Enough time has passed, emit the change
                    if (pendingValueRef.current !== null) {
                        onChange(pendingValueRef.current);
                        pendingValueRef.current = null;
                    }
                    lastCallTimeRef.current = timestamp;
                } else {
                    // Not enough time, schedule another RAF
                    rafIdRef.current = requestAnimationFrame(scheduleUpdate);
                }
            };

            // Cancel any pending RAF
            if (rafIdRef.current !== null) {
                cancelAnimationFrame(rafIdRef.current);
            }

            // Start the debounce timer
            rafIdRef.current = requestAnimationFrame(scheduleUpdate);
        },
        [onChange],
    );

    // Handle input change
    const handleChange = useCallback(
        (event: React.ChangeEvent<HTMLInputElement>) => {
            const newValue = event.target.value;
            setLocalValue(newValue);
            debouncedOnChange(newValue);
        },
        [debouncedOnChange],
    );

    // Handle clear button click
    const handleClear = useCallback(() => {
        setLocalValue("");
        onChange(""); // Immediate clear, no debounce needed
        // Cancel any pending debounced calls
        if (rafIdRef.current !== null) {
            cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = null;
        }
        pendingValueRef.current = null;
    }, [onChange]);

    return (
        <div className={classes.root} role="search">
            <Input
                className={classes.input}
                value={localValue}
                onChange={handleChange}
                placeholder={placeholder}
                maxLength={MAX_LENGTH}
                contentBefore={<Search20Regular aria-hidden="true" />}
                contentAfter={
                    localValue ? (
                        <Dismiss20Regular
                            onClick={handleClear}
                            style={{ cursor: "pointer" }}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    handleClear();
                                }
                            }}
                            aria-label={locConstants.profiler.clearFilter}
                        />
                    ) : undefined
                }
                aria-label={placeholder}
            />
        </div>
    );
};

export default QuickFilterInput;
