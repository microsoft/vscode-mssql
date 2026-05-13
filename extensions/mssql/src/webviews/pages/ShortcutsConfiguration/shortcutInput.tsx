/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Input, makeStyles, Tooltip } from "@fluentui/react-components";
import { Keyboard24Regular } from "@fluentui/react-icons";
import { useState } from "react";
import { locConstants } from "../../common/locConstants";

const useStyles = makeStyles({
    root: {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        gap: "8px",
        alignItems: "center",
    },
    recordButton: {
        minWidth: "32px",
    },
});

function normalizeKey(key: string): string | undefined {
    if (["Control", "Shift", "Alt", "Meta"].includes(key)) {
        return undefined;
    }

    if (key.length === 1) {
        return key === " " ? "space" : key.toLowerCase();
    }

    const keyMap: Record<string, string> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
        Escape: "escape",
        Enter: "enter",
        Tab: "tab",
        Backspace: "backspace",
        Delete: "delete",
        PageUp: "pageup",
        PageDown: "pagedown",
    };

    return keyMap[key] ?? key.toLowerCase();
}

function shortcutFromKeyboardEvent(event: React.KeyboardEvent): string | undefined {
    const key = normalizeKey(event.key);
    if (!key) {
        return undefined;
    }

    const parts: string[] = [];
    if (event.ctrlKey) {
        parts.push("ctrl");
    }
    if (event.metaKey) {
        parts.push("cmd");
    }
    if (event.altKey) {
        parts.push("alt");
    }
    if (event.shiftKey) {
        parts.push("shift");
    }
    parts.push(key);
    return parts.join("+");
}

export const ShortcutInput = ({
    value,
    onChange,
    ariaLabel,
}: {
    value: string;
    onChange: (value: string) => void;
    ariaLabel: string;
}) => {
    const classes = useStyles();
    const loc = locConstants.shortcutsConfiguration;
    const [recording, setRecording] = useState(false);

    return (
        <div className={classes.root}>
            <Input
                aria-label={ariaLabel}
                value={value}
                placeholder={loc.shortcutPlaceholder}
                onChange={(_event, data) => onChange(data.value)}
                onKeyDown={(event) => {
                    if (!recording) {
                        return;
                    }

                    event.preventDefault();
                    event.stopPropagation();
                    const shortcut = shortcutFromKeyboardEvent(event);
                    if (shortcut) {
                        onChange(shortcut);
                        setRecording(false);
                    }
                }}
            />
            <Tooltip content={recording ? loc.stopRecording : loc.record} relationship="label">
                <Button
                    className={classes.recordButton}
                    aria-label={recording ? loc.stopRecording : loc.record}
                    appearance={recording ? "primary" : "secondary"}
                    icon={<Keyboard24Regular />}
                    onClick={() => setRecording((current) => !current)}
                />
            </Tooltip>
        </div>
    );
};
