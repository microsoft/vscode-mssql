/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Checkbox, Dropdown, Field, Input, Option, Text } from "@fluentui/react-components";
import { createJobScheduleSql, JobSchedule } from "sql-feature/agent";
import { LocConstants } from "../../common/locConstants";

export function validJobSchedule(value: JobSchedule | undefined): boolean {
    if (!value) return true;
    try {
        createJobScheduleSql(value);
        return true;
    } catch {
        return false;
    }
}

export function JobScheduleEditor({
    value,
    onChange,
}: {
    value: JobSchedule | undefined;
    onChange: (value: JobSchedule | undefined) => void;
}) {
    const loc = LocConstants.getInstance().agentSchedule;
    const kinds = {
        manual: loc.manual,
        once: loc.once,
        daily: loc.daily,
        weekly: loc.weekly,
        monthly: loc.monthly,
    };
    const patch = (change: Partial<JobSchedule>) => {
        if (value) onChange({ ...value, ...change });
    };
    return (
        <fieldset>
            <legend>{loc.title}</legend>
            <Field label={loc.frequency}>
                <Dropdown
                    selectedOptions={[value?.kind ?? "manual"]}
                    value={kinds[value?.kind ?? "manual"]}
                    onOptionSelect={(_, data) => {
                        if (data.optionValue === "manual") onChange(undefined);
                        else if (
                            ["once", "daily", "weekly", "monthly"].includes(data.optionValue ?? "")
                        )
                            onChange({
                                name: "",
                                startDate: "",
                                startTime: "00:00",
                                every: 1,
                                weekdays: [1],
                                monthDay: 1,
                                ...value,
                                kind: data.optionValue as JobSchedule["kind"],
                                endDate: data.optionValue === "once" ? undefined : value?.endDate,
                                repeat: data.optionValue === "once" ? undefined : value?.repeat,
                            });
                    }}>
                    {Object.entries(kinds).map(([id, label]) => (
                        <Option key={id} value={id}>
                            {label}
                        </Option>
                    ))}
                </Dropdown>
            </Field>
            {value && (
                <>
                    <Text>{loc.timeBasis}</Text>
                    <Field label={loc.name} required>
                        <Input
                            value={value.name}
                            onChange={(_, data) => patch({ name: data.value })}
                        />
                    </Field>
                    <Field label={loc.startDate} required>
                        <Input
                            type="date"
                            value={value.startDate}
                            onChange={(_, data) => patch({ startDate: data.value })}
                        />
                    </Field>
                    <Field label={loc.startTime} required>
                        <Input
                            type="time"
                            step={1}
                            value={value.startTime}
                            onChange={(_, data) => patch({ startTime: data.value })}
                        />
                    </Field>
                    {value.kind !== "once" && (
                        <>
                            <Field
                                label={
                                    value.kind === "monthly"
                                        ? loc.everyMonths
                                        : value.kind === "weekly"
                                          ? loc.everyWeeks
                                          : loc.everyDays
                                }
                                required>
                                <Input
                                    type="number"
                                    min={1}
                                    step={1}
                                    value={String(value.every ?? 1)}
                                    onChange={(_, data) => patch({ every: Number(data.value) })}
                                />
                            </Field>
                            <Field label={loc.endDate}>
                                <Input
                                    type="date"
                                    value={value.endDate ?? ""}
                                    onChange={(_, data) =>
                                        patch({ endDate: data.value || undefined })
                                    }
                                />
                            </Field>
                        </>
                    )}
                    {value.kind === "monthly" && (
                        <>
                            <Field label={loc.monthDay} required>
                                <Input
                                    type="number"
                                    min={1}
                                    max={31}
                                    step={1}
                                    value={String(value.monthDay ?? 1)}
                                    onChange={(_, data) => patch({ monthDay: Number(data.value) })}
                                />
                            </Field>
                            <Text>{loc.monthEnd}</Text>
                        </>
                    )}
                    {value.kind !== "once" && (
                        <>
                            <Checkbox
                                label={loc.repeat}
                                checked={!!value.repeat}
                                onChange={(_, data) =>
                                    patch({
                                        repeat: data.checked
                                            ? { unit: "minutes", every: 15, endTime: "23:59:59" }
                                            : undefined,
                                    })
                                }
                            />
                            {value.repeat && (
                                <>
                                    <Field label={loc.repeatEvery} required>
                                        <Input
                                            type="number"
                                            min={value.repeat.unit === "seconds" ? 10 : 1}
                                            step={1}
                                            value={String(value.repeat.every)}
                                            onChange={(_, data) =>
                                                patch({
                                                    repeat: {
                                                        ...value.repeat!,
                                                        every: Number(data.value),
                                                    },
                                                })
                                            }
                                        />
                                    </Field>
                                    <Field label={loc.repeatUnit}>
                                        <Dropdown
                                            selectedOptions={[value.repeat.unit]}
                                            value={loc.units[value.repeat.unit]}
                                            onOptionSelect={(_, data) => {
                                                if (
                                                    ["seconds", "minutes", "hours"].includes(
                                                        data.optionValue ?? "",
                                                    )
                                                )
                                                    patch({
                                                        repeat: {
                                                            ...value.repeat!,
                                                            unit: data.optionValue as
                                                                | "seconds"
                                                                | "minutes"
                                                                | "hours",
                                                        },
                                                    });
                                            }}>
                                            {Object.entries(loc.units).map(([unit, label]) => (
                                                <Option key={unit} value={unit}>
                                                    {label}
                                                </Option>
                                            ))}
                                        </Dropdown>
                                    </Field>
                                    <Field label={loc.endTime} required>
                                        <Input
                                            type="time"
                                            step={1}
                                            value={value.repeat.endTime}
                                            onChange={(_, data) =>
                                                patch({
                                                    repeat: {
                                                        ...value.repeat!,
                                                        endTime: data.value,
                                                    },
                                                })
                                            }
                                        />
                                    </Field>
                                </>
                            )}
                        </>
                    )}
                    {value.kind === "weekly" && (
                        <Field label={loc.weekdays} required>
                            {loc.days.map((label, day) => (
                                <Checkbox
                                    key={day}
                                    label={label}
                                    checked={value.weekdays?.includes(day) ?? false}
                                    onChange={(_, data) =>
                                        patch({
                                            weekdays: data.checked
                                                ? [...(value.weekdays ?? []), day]
                                                : (value.weekdays ?? []).filter(
                                                      (existing) => existing !== day,
                                                  ),
                                        })
                                    }
                                />
                            ))}
                        </Field>
                    )}
                    {!validJobSchedule(value) && <Text role="status">{loc.invalid}</Text>}
                </>
            )}
        </fieldset>
    );
}
