/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useState } from "react";
import {
    Button,
    Dialog,
    DialogSurface,
    DialogBody,
    DialogTitle,
    DialogContent,
    DialogActions,
    Field,
    Input,
    Dropdown,
    Option,
    Text,
    makeStyles,
    MessageBar,
} from "@fluentui/react-components";
import type {
    QueryStoreConfiguration,
    QueryStoreReadiness,
} from "sql-feature/diagnostics/querystore";
import { LocConstants } from "../../common/locConstants";

const useStyles = makeStyles({
    form: { display: "flex", flexDirection: "column", gap: "12px", minWidth: "360px" },
});
const numericFields = [
    "runtimeIntervalMinutes",
    "flushIntervalSeconds",
    "maxStorageMb",
    "retentionDays",
] as const;
const enumFields = {
    operationMode: ["READ_WRITE", "READ_ONLY"],
    captureMode: ["AUTO", "ALL", "NONE"],
    cleanupMode: ["AUTO", "OFF"],
    waitCaptureMode: ["ON", "OFF"],
} as const;

function numericValidation(
    key: (typeof numericFields)[number],
    value: number | undefined,
    loc: ReturnType<typeof LocConstants.getInstance>["queryStoreSettings"],
): string | undefined {
    if (value === undefined) return undefined;
    const minimum = key === "retentionDays" ? 0 : 1;
    if (!Number.isSafeInteger(value) || value < minimum || value > 2147483647) {
        return loc.invalidValue;
    }
    if (key === "runtimeIntervalMinutes" && ![1, 5, 10, 15, 30, 60, 1440].includes(value)) {
        return loc.invalidRuntimeInterval;
    }
    return undefined;
}

export function QueryStoreSettings({
    state,
    close,
    review,
    busy,
    error,
}: {
    state: QueryStoreReadiness;
    close: () => void;
    busy: boolean;
    error?: string;
    review: (patch: QueryStoreConfiguration) => void;
}) {
    const [patch, setPatch] = useState<QueryStoreConfiguration>(
        state.status === "off" ? { operationMode: "READ_WRITE" } : {},
    );
    const styles = useStyles();
    const loc = LocConstants.getInstance().queryStoreSettings;
    return (
        <Dialog
            open
            onOpenChange={(_, data) => {
                if (!data.open) close();
            }}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>{loc.title}</DialogTitle>
                    <DialogContent className={styles.form}>
                        {error && <MessageBar intent="error">{error}</MessageBar>}
                        <Text>{loc.preserve}</Text>
                        {(Object.keys(enumFields) as (keyof typeof enumFields)[]).map((key) => {
                            if (key === "waitCaptureMode" && state.waitCaptureMode === undefined)
                                return undefined;
                            const current =
                                key === "operationMode"
                                    ? state.desiredState === 2
                                        ? "READ_WRITE"
                                        : state.desiredState === 1
                                          ? "READ_ONLY"
                                          : undefined
                                    : state[key];
                            return (
                                <Field key={key} label={loc[key]}>
                                    <Dropdown
                                        aria-label={loc[key]}
                                        value={
                                            patch[key]
                                                ? loc.options[patch[key]!]
                                                : `${loc.keep}${current ? ` (${loc.options[current] ?? current})` : ""}`
                                        }
                                        selectedOptions={[patch[key] ?? ""]}
                                        onOptionSelect={(_, data) =>
                                            setPatch((old) => ({
                                                ...old,
                                                [key]: data.optionValue || undefined,
                                            }))
                                        }>
                                        <Option value="">{loc.keep}</Option>
                                        {enumFields[key].map((value) => (
                                            <Option key={value} value={value}>
                                                {loc.options[value]}
                                            </Option>
                                        ))}
                                    </Dropdown>
                                    {patch[key] !== undefined && (
                                        <Text size={200}>
                                            {loc.change(
                                                current
                                                    ? (loc.options[current] ?? current)
                                                    : loc.notReported,
                                                loc.options[patch[key]!] ?? patch[key]!,
                                            )}
                                        </Text>
                                    )}
                                </Field>
                            );
                        })}
                        {numericFields.map((key) => (
                            <Field
                                key={key}
                                label={loc[key]}
                                validationMessage={numericValidation(key, patch[key], loc)}>
                                <Input
                                    type="number"
                                    aria-label={loc[key]}
                                    min={key === "retentionDays" ? 0 : 1}
                                    max={2147483647}
                                    step={1}
                                    placeholder={
                                        state[key] === undefined ? loc.keep : String(state[key])
                                    }
                                    value={patch[key] === undefined ? "" : String(patch[key])}
                                    onChange={(_, data) =>
                                        setPatch((old) => ({
                                            ...old,
                                            [key]:
                                                data.value === "" ? undefined : Number(data.value),
                                        }))
                                    }
                                />
                                {patch[key] !== undefined && (
                                    <Text size={200}>
                                        {loc.change(
                                            state[key] === undefined
                                                ? loc.notReported
                                                : String(state[key]),
                                            String(patch[key]),
                                        )}
                                    </Text>
                                )}
                            </Field>
                        ))}
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={close}>{LocConstants.getInstance().common.close}</Button>
                        <Button
                            appearance="primary"
                            disabled={
                                busy ||
                                !Object.values(patch).some((value) => value !== undefined) ||
                                numericFields.some(
                                    (key) => numericValidation(key, patch[key], loc) !== undefined,
                                )
                            }
                            onClick={() => review(patch)}>
                            {loc.review}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
}
