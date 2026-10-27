/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Caption1,
    Divider,
    Label,
    makeStyles,
    mergeClasses,
    MenuItemRadio,
    MenuList,
    Popover,
    PopoverSurface,
    PopoverTrigger,
    shorthands,
    Text,
    tokens,
    useId,
} from "@fluentui/react-components";
import { DatePicker } from "@fluentui/react-datepicker-compat";
import { TimePicker, formatDateToTimeString } from "@fluentui/react-timepicker-compat";
import { ChevronDown16Regular, Clock16Regular } from "@fluentui/react-icons";
import { useState } from "react";
import { locConstants as loc } from "../locConstants";
import {
    TimeRangePreset,
    TimeRangeValue,
    clampTimeRange,
    resolveTimeRange,
    startsBeforeAvailable,
    withDate,
    withTime,
} from "./timeRange";

const useStyles = makeStyles({
    trigger: {
        flexShrink: 0,
        fontWeight: tokens.fontWeightRegular,
        ...shorthands.gap("6px"),
    },
    clock: {
        flexShrink: 0,
        color: tokens.colorNeutralForeground2,
    },
    surface: {
        width: "300px",
        ...shorthands.padding("4px", "0", "12px"),
    },
    presets: {
        ...shorthands.padding("0", "4px"),
    },
    preset: {
        "&[aria-checked='true']": {
            backgroundColor: "var(--vscode-list-activeSelectionBackground)",
            color: "var(--vscode-list-activeSelectionForeground)",
            fontWeight: tokens.fontWeightSemibold,
        },
    },
    note: {
        display: "block",
        color: tokens.colorNeutralForeground3,
        ...shorthands.padding("8px", "12px"),
    },
    custom: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("10px"),
        ...shorthands.padding("12px", "12px", "0"),
    },
    fields: {
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 3fr) minmax(0, 2fr)",
        alignItems: "center",
        columnGap: "8px",
        rowGap: "8px",
    },
    picker: {
        minWidth: 0,
    },
    // The date opens its calendar on click, so it needs no calendar icon.
    date: {
        "& .fui-Input__contentAfter": {
            display: "none",
        },
    },
    error: {
        gridColumn: "2 / -1",
        color: tokens.colorPaletteRedForeground1,
    },
    actions: {
        display: "flex",
        justifyContent: "flex-end",
        ...shorthands.gap("8px"),
        marginTop: "2px",
    },
});

export interface TimeRangePickerProps {
    readonly presets: readonly TimeRangePreset[];
    readonly value: TimeRangeValue;
    readonly onChange: (value: TimeRangeValue) => void;
    /**
     * The oldest time with data. Shows the available range, marks the presets that start
     * earlier, and keeps a custom range inside the data.
     */
    readonly availableFrom?: Date;
}

interface Draft {
    readonly from: Date;
    readonly to: Date;
}

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
});
const dateFormat = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
});

/** A button that shows the time range, with presets and a custom range in local time. */
export const TimeRangePicker = ({
    presets,
    value,
    onChange,
    availableFrom,
}: TimeRangePickerProps) => {
    const classes = useStyles();
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<Draft | undefined>(undefined);

    const now = new Date();
    const resolved = resolveTimeRange(value, presets, now);
    const label =
        value.kind === "preset"
            ? (presets.find((preset) => preset.id === value.presetId) ?? presets[0]).label
            : loc.timeRange.range(
                  dateTimeFormat.format(value.from),
                  dateTimeFormat.format(value.to),
              );

    const openChanged = (isOpen: boolean) => {
        setOpen(isOpen);
        setDraft(isOpen ? { from: resolved.from, to: resolved.to } : undefined);
    };

    const custom = draft ? clampTimeRange(draft, availableFrom, now) : undefined;

    return (
        <Popover
            open={open}
            onOpenChange={(_event, data) => openChanged(data.open)}
            positioning="below-end"
            trapFocus>
            <PopoverTrigger disableButtonEnhancement>
                <Button
                    className={classes.trigger}
                    icon={<ChevronDown16Regular />}
                    iconPosition="after"
                    aria-label={loc.timeRange.timeRangeLabel(label)}>
                    <Clock16Regular className={classes.clock} />
                    {label}
                </Button>
            </PopoverTrigger>
            <PopoverSurface className={classes.surface}>
                <MenuList
                    className={classes.presets}
                    checkedValues={{
                        range: value.kind === "preset" ? [value.presetId] : [],
                    }}>
                    {presets.map((preset) => {
                        const partial = startsBeforeAvailable(preset, availableFrom, now);
                        return (
                            <MenuItemRadio
                                key={preset.id}
                                name="range"
                                value={preset.id}
                                className={classes.preset}
                                secondaryContent={partial ? loc.timeRange.partial : undefined}
                                onClick={() => {
                                    onChange({ kind: "preset", presetId: preset.id });
                                    openChanged(false);
                                }}>
                                {preset.label}
                            </MenuItemRadio>
                        );
                    })}
                </MenuList>
                <Divider />
                {availableFrom && (
                    <>
                        <Caption1 className={classes.note}>
                            {loc.timeRange.dataStarts(dateTimeFormat.format(availableFrom))}
                        </Caption1>
                        <Divider />
                    </>
                )}
                {draft && (
                    <div className={classes.custom}>
                        <Text weight="semibold">{loc.timeRange.customRange}</Text>
                        <div className={classes.fields}>
                            <DateTimeField
                                label={loc.timeRange.from}
                                dateLabel={loc.timeRange.fromDate}
                                timeLabel={loc.timeRange.fromTime}
                                value={draft.from}
                                minDate={availableFrom}
                                maxDate={now}
                                onChange={(from) => setDraft({ ...draft, from })}
                            />
                            <DateTimeField
                                label={loc.timeRange.to}
                                dateLabel={loc.timeRange.toDate}
                                timeLabel={loc.timeRange.toTime}
                                value={draft.to}
                                minDate={availableFrom}
                                maxDate={now}
                                onChange={(to) => setDraft({ ...draft, to })}
                            />
                            {!custom && (
                                <Caption1 role="alert" className={classes.error}>
                                    {loc.timeRange.invalidRange}
                                </Caption1>
                            )}
                        </div>
                        <div className={classes.actions}>
                            <Button size="small" onClick={() => openChanged(false)}>
                                {loc.common.cancel}
                            </Button>
                            <Button
                                appearance="primary"
                                size="small"
                                disabled={!custom}
                                onClick={() => {
                                    if (custom) {
                                        onChange({ kind: "custom", ...custom });
                                        openChanged(false);
                                    }
                                }}>
                                {loc.common.apply}
                            </Button>
                        </div>
                    </div>
                )}
            </PopoverSurface>
        </Popover>
    );
};

interface DateTimeFieldProps {
    readonly label: string;
    readonly dateLabel: string;
    readonly timeLabel: string;
    readonly value: Date;
    readonly minDate?: Date;
    readonly maxDate?: Date;
    readonly onChange: (value: Date) => void;
}

/** A label, a date picker, and a time picker for one local date and time: a row of the grid. */
const DateTimeField = ({
    label,
    dateLabel,
    timeLabel,
    value,
    minDate,
    maxDate,
    onChange,
}: DateTimeFieldProps) => {
    const classes = useStyles();
    const dateId = useId("time-range-date");
    // The time can be typed, so its text is kept until it is a valid time.
    const [timeText, setTimeText] = useState(formatDateToTimeString(value));

    return (
        <>
            <Label htmlFor={dateId}>{label}</Label>
            <DatePicker
                id={dateId}
                className={mergeClasses(classes.picker, classes.date)}
                inlinePopup
                aria-label={dateLabel}
                value={value}
                minDate={minDate}
                maxDate={maxDate}
                formatDate={(date) => (date ? dateFormat.format(date) : "")}
                onSelectDate={(date) => {
                    if (date) {
                        onChange(withDate(value, date));
                    }
                }}
            />
            <TimePicker
                className={classes.picker}
                inlinePopup
                freeform
                increment={30}
                expandIcon={null}
                aria-label={timeLabel}
                dateAnchor={value}
                selectedTime={value}
                value={timeText}
                onChange={(event) => setTimeText(event.target.value)}
                onTimeChange={(_event, data) => {
                    if (data.selectedTime) {
                        onChange(withTime(value, data.selectedTime));
                        setTimeText(formatDateToTimeString(data.selectedTime));
                    }
                }}
            />
        </>
    );
};
