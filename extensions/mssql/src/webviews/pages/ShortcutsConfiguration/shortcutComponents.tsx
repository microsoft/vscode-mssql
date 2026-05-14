/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef, useState } from "react";
import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Field,
    Input,
    Spinner,
    Tooltip,
} from "@fluentui/react-components";
import { Checkmark12Regular, Keyboard24Regular } from "@fluentui/react-icons";
import { CollapsibleSection } from "../../common/collapsibleSection";
import { locConstants } from "../../common/locConstants";
import { SegmentedControl } from "../../common/segmentedControl";
import { VscodeEditor } from "../../common/vscodeMonaco";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import {
    QuickQueryConnectionMode,
    QuickQueryExecutionMode,
    QuickQuerySlot,
} from "../../../sharedInterfaces/shortcutsConfiguration";
import { ShortcutItem } from "./shortcutDefinitions";
import {
    formatShortcut,
    HighlightedText,
    shortcutFromKeyboardEvent,
} from "./shortcutKeyboardUtils";

export type SaveState = "idle" | "saving" | "saved";

const executionOptions = [
    { value: QuickQueryExecutionMode.Open, labelKey: "openOnly" },
    { value: QuickQueryExecutionMode.OpenAndRun, labelKey: "openAndRun" },
] as const;

const connectionOptions = [
    { value: QuickQueryConnectionMode.Prompt, labelKey: "prompt" },
    { value: QuickQueryConnectionMode.ActiveOrPrompt, labelKey: "activeOrPrompt" },
] as const;

export const SaveIndicator = ({ state }: { state: SaveState }) => {
    if (state === "idle") {
        return null;
    }

    return (
        <div className="mssql-config-save-indicator">
            {state === "saving" ? (
                <>
                    <Spinner size="tiny" />
                    <span>{locConstants.shortcutsConfiguration.saving}</span>
                </>
            ) : (
                <>
                    <Checkmark12Regular />
                    <span>{locConstants.shortcutsConfiguration.saved}</span>
                </>
            )}
        </div>
    );
};

export const ShortcutRecorder = ({
    current,
    onSave,
    onClose,
}: {
    current: string;
    onSave: (value: string) => void;
    onClose: () => void;
}) => {
    const [recording, setRecording] = useState(true);
    const [preview, setPreview] = useState("");

    useEffect(() => {
        if (!recording) {
            return undefined;
        }

        const onKeyDown = (event: KeyboardEvent) => {
            event.preventDefault();
            event.stopPropagation();

            if (event.key === "Escape") {
                setRecording(false);
                setPreview(current);
                return;
            }

            const shortcut = shortcutFromKeyboardEvent(event);
            if (shortcut) {
                setPreview(shortcut);
                setRecording(false);
            }
        };

        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [current, recording]);

    const hasPreview = preview.trim().length > 0;

    return (
        <Dialog open modalType="modal">
            <DialogSurface className="mssql-config-recorder">
                <DialogBody>
                    <DialogTitle>{locConstants.shortcutsConfiguration.recordShortcut}</DialogTitle>
                    <DialogContent>
                        <div className="mssql-config-recorder-subtitle">
                            {locConstants.shortcutsConfiguration.recordShortcutDescription}
                        </div>
                        <div className="mssql-config-recorder-body">
                            <div
                                className={`mssql-config-key-display ${
                                    recording
                                        ? "mssql-config-key-display-recording"
                                        : hasPreview
                                          ? "mssql-config-key-display-done"
                                          : ""
                                }`}>
                                {recording ? (
                                    <div className="mssql-config-recording-copy">
                                        <span className="mssql-config-pulse" />
                                        <span>
                                            {locConstants.shortcutsConfiguration.recordingShortcut}
                                        </span>
                                    </div>
                                ) : hasPreview ? (
                                    <span className="mssql-config-shortcut-preview">
                                        {formatShortcut(preview)}
                                    </span>
                                ) : (
                                    <span className="mssql-config-empty">
                                        {locConstants.shortcutsConfiguration.noShortcut}
                                    </span>
                                )}
                            </div>
                            {hasPreview && !recording && (
                                <Button
                                    appearance="transparent"
                                    className="mssql-config-link-button"
                                    onClick={() => {
                                        setPreview("");
                                        setRecording(true);
                                    }}>
                                    {locConstants.shortcutsConfiguration.rerecord}
                                </Button>
                            )}
                        </div>
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="secondary" onClick={onClose}>
                            {locConstants.common.cancel}
                        </Button>
                        {hasPreview ? (
                            <Button
                                appearance="primary"
                                onClick={() => {
                                    onSave(preview);
                                    onClose();
                                }}>
                                {locConstants.common.save}
                            </Button>
                        ) : (
                            <Button
                                appearance="secondary"
                                onClick={() => {
                                    onSave("");
                                    onClose();
                                }}>
                                {locConstants.shortcutsConfiguration.clearShortcut}
                            </Button>
                        )}
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};

export const ShortcutDisplay = ({ value }: { value: string }) => (
    <div className={`mssql-config-shortcut-display ${value ? "" : "mssql-config-empty"}`}>
        {formatShortcut(value) || locConstants.shortcutsConfiguration.noShortcut}
    </div>
);

export const ShortcutChip = ({
    value,
    onRecord,
    recordLabel,
}: {
    value: string;
    onRecord: () => void;
    recordLabel: string;
}) => (
    <div className="mssql-config-shortcut-chip-row">
        <ShortcutDisplay value={value} />
        <Tooltip content={recordLabel} relationship="label">
            <Button
                appearance="secondary"
                icon={<Keyboard24Regular />}
                aria-label={recordLabel}
                onClick={onRecord}
            />
        </Tooltip>
    </div>
);

export const QuickQueryRow = ({
    slot,
    shortcut,
    expanded,
    onToggle,
    onChange,
    onRecord,
    themeKind,
    loc,
}: {
    slot: QuickQuerySlot;
    shortcut: string;
    expanded: boolean;
    onToggle: () => void;
    onChange: (value: QuickQuerySlot, shouldSave?: boolean) => void;
    onRecord: () => void;
    themeKind: ColorThemeKind;
    loc: typeof locConstants.shortcutsConfiguration;
}) => {
    const slotRef = useRef(slot);
    const onChangeRef = useRef(onChange);
    slotRef.current = slot;
    onChangeRef.current = onChange;

    const query = slot.query.trim();
    const preview = query.length > 60 ? `${query.slice(0, 60)}...` : query;

    return (
        <CollapsibleSection
            className="mssql-config-query-row"
            buttonClassName="mssql-config-query-summary"
            panelClassName="mssql-config-query-editor"
            open={expanded}
            onOpenChange={onToggle}
            title={
                <span className="mssql-config-query-summary-content">
                    <span className="mssql-config-query-title">
                        <span>{slot.name}</span>
                        {preview ? (
                            <span className="mssql-config-query-preview">{preview}</span>
                        ) : (
                            <span className="mssql-config-query-empty">{loc.noQuerySet}</span>
                        )}
                    </span>
                    <ShortcutDisplay value={shortcut} />
                </span>
            }>
            <Field className="mssql-config-field mssql-config-name-field" label={loc.name}>
                <Input
                    value={slot.name}
                    onChange={(_event, data) =>
                        onChange({
                            ...slot,
                            name: data.value,
                        })
                    }
                />
            </Field>
            <div className="mssql-config-controls-row">
                <Field
                    className="mssql-config-field mssql-config-shortcut-field"
                    label={loc.shortcut}>
                    <ShortcutChip
                        value={shortcut}
                        onRecord={onRecord}
                        recordLabel={`${loc.recordShortcut}: ${slot.name}`}
                    />
                </Field>
                <Field className="mssql-config-field" label={loc.execution}>
                    <SegmentedControl<QuickQueryExecutionMode>
                        className="mssql-config-segmented-control"
                        value={slot.executionMode}
                        ariaLabel={loc.execution}
                        options={executionOptions.map((option) => ({
                            value: option.value,
                            label: loc[option.labelKey],
                        }))}
                        onValueChange={(value) =>
                            onChange({
                                ...slot,
                                executionMode: value,
                            })
                        }
                    />
                </Field>
                <Field className="mssql-config-field" label={loc.connection}>
                    <SegmentedControl<QuickQueryConnectionMode>
                        className="mssql-config-segmented-control"
                        value={slot.connectionMode}
                        ariaLabel={loc.connection}
                        options={connectionOptions.map((option) => ({
                            value: option.value,
                            label: loc[option.labelKey],
                        }))}
                        onValueChange={(value) =>
                            onChange({
                                ...slot,
                                connectionMode: value,
                            })
                        }
                    />
                </Field>
            </div>
            <Field className="mssql-config-field" label={loc.query}>
                <div className="mssql-config-monaco-shell">
                    <VscodeEditor
                        height="100%"
                        width="100%"
                        language="sql"
                        themeKind={themeKind}
                        value={slot.query}
                        options={{
                            minimap: { enabled: false },
                            scrollBeyondLastLine: false,
                            wordWrap: "on",
                            lineNumbers: "on",
                            glyphMargin: false,
                            folding: false,
                            lineDecorationsWidth: 8,
                            overviewRulerLanes: 0,
                            renderLineHighlight: "line",
                            automaticLayout: true,
                        }}
                        onChange={(value) => onChange({ ...slot, query: value ?? "" }, false)}
                        onMount={(editor) => {
                            const disposable = editor.onDidBlurEditorWidget(() => {
                                onChangeRef.current(
                                    {
                                        ...slotRef.current,
                                        query: editor.getValue(),
                                    },
                                    true,
                                );
                            });
                            editor.onDidDispose(() => disposable.dispose());
                        }}
                    />
                </div>
            </Field>
        </CollapsibleSection>
    );
};

export const WebviewShortcutRow = ({
    item,
    value,
    onRecord,
    loc,
    searchTerm,
}: {
    item: ShortcutItem;
    value: string;
    onRecord: () => void;
    loc: typeof locConstants.shortcutsConfiguration;
    searchTerm: string;
}) => (
    <div className="mssql-config-webview-shortcut-row">
        <div>
            <div className="mssql-config-row-label">
                <HighlightedText
                    text={loc.webviewShortcutLabels[item.action]}
                    searchTerm={searchTerm}
                />
            </div>
            <div className="mssql-config-row-description">
                <HighlightedText
                    text={loc.webviewShortcutDescriptions[item.action]}
                    searchTerm={searchTerm}
                />
            </div>
        </div>
        <ShortcutChip
            value={value}
            onRecord={onRecord}
            recordLabel={`${loc.recordShortcut}: ${loc.webviewShortcutLabels[item.action]}`}
        />
    </div>
);
