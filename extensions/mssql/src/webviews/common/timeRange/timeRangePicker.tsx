/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Caption1,
    Divider,
    Field,
    makeStyles,
    MenuItemRadio,
    MenuList,
    Popover,
    PopoverSurface,
    PopoverTrigger,
    shorthands,
    Text,
    tokens,
} from "@fluentui/react-components";
import { DatePicker } from "@fluentui/react-datepicker-compat";
import { TimePicker, formatDateToTimeString } from "@fluentui/react-timepicker-compat";
import { ChevronDown16Regular } from "@fluentui/react-icons";
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
    surface: {
        width: "320px",
        ...shorthands.padding("4px", "0", "12px"),
    },
    presets: {
        ...shorthands.padding("0", "4px"),
    },
    partial: {
        color: tokens.colorNeutralForeground3,
    },
    custom: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("8px"),
        ...shorthands.padding("8px", "12px", "0"),
    },
    customTitle: {
        color: tokens.colorBrandForegroundLink,
    },
    dateTime: {
        display: "grid",
        gridTemplateColumns: "3fr 2fr",
        ...shorthands.gap("8px"),
    },
    picker: {
        minWidth: 0,
    },
    available: {
        color: tokens.colorNeutralForeground3,
    },
    actions: {
        display: "flex",
        ...shorthands.gap("8px"),
        marginTop: "4px",
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
                    size="small"
                    icon={<ChevronDown16Regular />}
                    iconPosition="after"
                    aria-label={loc.timeRange.timeRangeLabel(label)}>
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
                                className={partial ? classes.partial : undefined}
                                secondaryContent={partial ? loc.timeRange.partialData : undefined}
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
                {draft && (
                    <div className={classes.custom}>
                        <Text weight="semibold" className={classes.customTitle}>
                            {loc.timeRange.customize}
                        </Text>
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
                            validationMessage={custom ? undefined : loc.timeRange.invalidRange}
                            onChange={(to) => setDraft({ ...draft, to })}
                        />
                        {availableFrom && (
                            <Caption1 className={classes.available}>
                                {loc.timeRange.available(
                                    dateTimeFormat.format(availableFrom),
                                    dateTimeFormat.format(now),
                                )}
                            </Caption1>
                        )}
                        <div className={classes.actions}>
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
                            <Button size="small" onClick={() => openChanged(false)}>
                                {loc.common.cancel}
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
    readonly validationMessage?: string;
    readonly onChange: (value: Date) => void;
}

/** A Fluent date picker and time picker for one local date and time. */
const DateTimeField = ({
    label,
    dateLabel,
    timeLabel,
    value,
    minDate,
    maxDate,
    validationMessage,
    onChange,
}: DateTimeFieldProps) => {
    const classes = useStyles();
    // The time can be typed, so its text is kept until it is a valid time.
    const [timeText, setTimeText] = useState(formatDateToTimeString(value));

    return (
        <Field label={label} validationMessage={validationMessage}>
            <div className={classes.dateTime}>
                <DatePicker
                    className={classes.picker}
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
            </div>
        </Field>
    );
};
