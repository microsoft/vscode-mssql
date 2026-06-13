/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Field,
    Input,
    Text,
    makeStyles,
    shorthands,
    tokens,
} from "@fluentui/react-components";
import { Dismiss16Regular } from "@fluentui/react-icons";
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { FluentResultGridCloseOverlayOptions } from "./fluentResultGridProviderTypes";
import type { FluentResultGridResizeDialogOverlayState } from "./fluentResultGridOverlays";
import type { FluentResultGridStrings } from "../types/fluentResultGridStrings";

const defaultMinColumnWidth = 50;
const popupWidth = 220;

const useStyles = makeStyles({
    root: {
        position: "fixed",
        zIndex: 100000,
        width: `${popupWidth}px`,
        display: "flex",
        flexDirection: "column",
        ...shorthands.padding(tokens.spacingVerticalS, tokens.spacingHorizontalS),
        backgroundColor: tokens.colorNeutralBackground1,
        boxShadow: `${tokens.shadow28}, 0 0 0 1px ${tokens.colorNeutralStroke2}`,
        color: tokens.colorNeutralForeground1,
        ...shorthands.border("1px", "solid", tokens.colorTransparentStroke),
        gap: tokens.spacingVerticalS,
    },
    titleBar: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        minHeight: "16px",
    },
    closeButton: {
        width: "16px",
        height: "16px",
    },
    sectionHeading: {
        fontSize: tokens.fontSizeBase100,
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorNeutralForeground1,
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        lineHeight: "16px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    divider: {
        height: "1px",
        backgroundColor: tokens.colorNeutralStroke2,
    },
    input: {
        width: "100%",
    },
    actions: {
        display: "flex",
        columnGap: tokens.spacingHorizontalXS,
        flexWrap: "nowrap",
    },
    actionButton: {
        flexGrow: 1,
        minWidth: 0,
    },
});

export interface FluentResultGridResizeDialogProps {
    overlay: FluentResultGridResizeDialogOverlayState;
    strings: FluentResultGridStrings;
    closeOverlay: (options?: FluentResultGridCloseOverlayOptions) => void;
}

function parseColumnWidth(value: string): number {
    return Number.parseInt(value, 10);
}

function isColumnWidthValid(value: string, minWidth: number): boolean {
    const parsedWidth = parseColumnWidth(value);
    return Number.isFinite(parsedWidth) && parsedWidth >= minWidth;
}

function getResizeOverlayPosition({
    anchorRect,
    popupHeight,
}: {
    anchorRect: FluentResultGridResizeDialogOverlayState["anchorRect"];
    popupHeight: number;
}) {
    const horizontalMargin = 8;
    const verticalMargin = 8;
    const gap = 4;
    let left = anchorRect.left;
    const spaceOnRight = window.innerWidth - anchorRect.left;

    if (spaceOnRight < popupWidth + horizontalMargin) {
        left = Math.max(horizontalMargin, anchorRect.right - popupWidth);
    }

    left = Math.max(
        horizontalMargin,
        Math.min(left, window.innerWidth - popupWidth - horizontalMargin),
    );

    const spaceBelow = window.innerHeight - anchorRect.bottom;
    const spaceAbove = anchorRect.top;
    let top: number;

    if (spaceBelow >= popupHeight + gap) {
        top = anchorRect.bottom + gap;
    } else if (spaceAbove >= popupHeight + gap) {
        top = anchorRect.top - popupHeight - gap;
    } else {
        top = anchorRect.bottom + gap;
        top = Math.min(top, window.innerHeight - popupHeight - verticalMargin);
        top = Math.max(top, verticalMargin);
    }

    return { left, top };
}

export function FluentResultGridResizeDialog({
    overlay,
    strings,
    closeOverlay,
}: FluentResultGridResizeDialogProps) {
    const styles = useStyles();
    const rootRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const closeButtonRef = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null);
    const submitButtonRef = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null);
    const cancelButtonRef = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null);
    const minWidth = overlay.minWidth ?? defaultMinColumnWidth;
    const [inputValue, setInputValue] = useState<string>(
        Math.round(overlay.initialWidth).toString(),
    );
    const [popupHeight, setPopupHeight] = useState(0);
    const isValid = isColumnWidthValid(inputValue, minWidth);

    useEffect(() => {
        setInputValue(Math.round(overlay.initialWidth).toString());
    }, [overlay.initialWidth]);

    useEffect(() => {
        const handleOutsideClick = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (target && rootRef.current?.contains(target)) {
                return;
            }
            closeOverlay();
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                closeOverlay();
            }
        };

        window.addEventListener("mousedown", handleOutsideClick, true);
        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.removeEventListener("mousedown", handleOutsideClick, true);
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [closeOverlay]);

    useEffect(() => {
        requestAnimationFrame(() => {
            const height = rootRef.current?.offsetHeight ?? 0;
            if (height > 0 && height !== popupHeight) {
                setPopupHeight(height);
            }
        });
    }, [inputValue, isValid, popupHeight]);

    useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, [overlay.anchorRect]);

    const position = useMemo(
        () =>
            getResizeOverlayPosition({
                anchorRect: overlay.anchorRect,
                popupHeight,
            }),
        [overlay.anchorRect, popupHeight],
    );

    const handleSubmit = useCallback(async () => {
        if (!isValid) {
            return;
        }

        await overlay.onSubmit(parseColumnWidth(inputValue));
        closeOverlay({ notifyDismiss: false });
    }, [closeOverlay, inputValue, isValid, overlay]);

    const handleRootKeyDown = useCallback((event: ReactKeyboardEvent) => {
        if (event.key !== "Tab") {
            return;
        }

        const target = event.target as HTMLElement;
        if (event.shiftKey && target === inputRef.current) {
            event.preventDefault();
            closeButtonRef.current?.focus();
        } else if (!event.shiftKey && target === closeButtonRef.current) {
            event.preventDefault();
            inputRef.current?.focus();
        } else if (event.shiftKey && target === closeButtonRef.current) {
            event.preventDefault();
            cancelButtonRef.current?.focus();
        } else if (!event.shiftKey && target === cancelButtonRef.current) {
            event.preventDefault();
            closeButtonRef.current?.focus();
        }
    }, []);

    return (
        <div
            ref={rootRef}
            className={styles.root}
            style={{ left: position.left, top: position.top }}
            role="dialog"
            aria-modal="true"
            aria-label={strings.resizeDialog.title(overlay.columnName)}
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={handleRootKeyDown}>
            <div className={styles.titleBar}>
                <Text className={styles.sectionHeading} title={overlay.columnName}>
                    {strings.resizeDialog.title(overlay.columnName)}
                </Text>
                <Button
                    ref={closeButtonRef}
                    appearance="subtle"
                    size="small"
                    icon={<Dismiss16Regular style={{ width: 10, height: 10 }} />}
                    onClick={() => closeOverlay()}
                    className={styles.closeButton}
                    title={strings.resizeDialog.cancel}
                    aria-label={strings.resizeDialog.cancel}
                />
            </div>
            <div className={styles.divider} />
            <Field
                label={strings.resizeDialog.widthLabel}
                validationMessage={
                    isValid ? undefined : strings.resizeDialog.validationError(minWidth)
                }>
                <Input
                    ref={inputRef}
                    className={styles.input}
                    type="number"
                    size="small"
                    value={inputValue}
                    min={minWidth}
                    onChange={(_, data) => setInputValue(data.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") {
                            event.preventDefault();
                            void handleSubmit();
                        }
                    }}
                />
            </Field>
            <div className={styles.actions}>
                <Button
                    ref={submitButtonRef}
                    className={styles.actionButton}
                    appearance="primary"
                    size="small"
                    onClick={handleSubmit}
                    disabled={!isValid}>
                    {strings.resizeDialog.submit}
                </Button>
                <Button
                    ref={cancelButtonRef}
                    className={styles.actionButton}
                    appearance="subtle"
                    size="small"
                    onClick={() => closeOverlay()}>
                    {strings.resizeDialog.cancel}
                </Button>
            </div>
        </div>
    );
}
