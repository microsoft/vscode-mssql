/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Combobox,
    Field,
    InfoLabel,
    LabelProps,
    Option,
    Spinner,
} from "@fluentui/react-components";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useFormStyles } from "../../../common/forms/form.component";
import {
    AuthenticationType,
    ConnectionDialogFormItemSpec,
    IConnectionDialogProfile,
} from "../../../../sharedInterfaces/connectionDialog";
import { ConnectionDialogContext } from "../connectionDialogStateProvider";
import { ApiStatus } from "../../../../sharedInterfaces/webview";

const DEFAULT_DATABASE_OPTION = "<default>";

const getDatabaseOptionsKey = (connectionProfile: IConnectionDialogProfile): string => {
    return [
        connectionProfile.authenticationType ?? "",
        connectionProfile.server ?? "",
        connectionProfile.user ?? "",
        connectionProfile.password ?? "",
        connectionProfile.accountId ?? "",
        connectionProfile.tenantId ?? "",
    ].join("|");
};

const canLoadDatabases = (connectionProfile: IConnectionDialogProfile): boolean => {
    const hasServer = !!connectionProfile.server;
    if (!hasServer) {
        return false;
    }

    switch (connectionProfile.authenticationType) {
        case AuthenticationType.SqlLogin:
            return !!connectionProfile.user && !!connectionProfile.password;
        case AuthenticationType.AzureMFA:
        case AuthenticationType.AzureMFAAndUser:
            return !!connectionProfile.accountId;
        default:
            return true;
    }
};

const ensureDefaultOption = (options: string[]): string[] => {
    const trimmed = options.map((option) => option.trim()).filter((option) => option.length > 0);
    const uniqueOptions = Array.from(new Set(trimmed));

    if (!uniqueOptions.includes(DEFAULT_DATABASE_OPTION)) {
        uniqueOptions.unshift(DEFAULT_DATABASE_OPTION);
    } else if (uniqueOptions[0] !== DEFAULT_DATABASE_OPTION) {
        uniqueOptions.splice(uniqueOptions.indexOf(DEFAULT_DATABASE_OPTION), 1);
        uniqueOptions.unshift(DEFAULT_DATABASE_OPTION);
    }

    return uniqueOptions;
};

const filterOptions = (options: string[], query: string): string[] => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery || normalizedQuery === DEFAULT_DATABASE_OPTION) {
        return options;
    }

    return options.filter((option) => option.toLowerCase().includes(normalizedQuery));
};

export const DatabaseCombobox = ({
    component,
    idx,
}: {
    component: ConnectionDialogFormItemSpec;
    idx: number;
}) => {
    const context = useContext(ConnectionDialogContext);
    const formStyles = useFormStyles();
    const [inputValue, setInputValue] = useState("");
    const [isFiltering, setIsFiltering] = useState(false);

    const connectionProfile = context?.state.formState ?? ({} as IConnectionDialogProfile);
    const isLoading = context?.state.databaseOptionsStatus === ApiStatus.Loading;
    const options = useMemo(
        () => ensureDefaultOption(context?.state.databaseOptions ?? [DEFAULT_DATABASE_OPTION]),
        [context?.state.databaseOptions],
    );

    const filteredOptions = useMemo(
        () => filterOptions(options, isFiltering ? inputValue : ""),
        [options, inputValue, isFiltering],
    );

    useEffect(() => {
        setInputValue(connectionProfile.database ?? "");
        setIsFiltering(false);
    }, [connectionProfile.database]);

    const loadDatabaseOptions = useCallback(async () => {
        if (!context || !canLoadDatabases(connectionProfile)) {
            return;
        }

        const requestKey = getDatabaseOptionsKey(connectionProfile);
        const isLoadingSameKey =
            context.state.databaseOptionsStatus === ApiStatus.Loading &&
            context.state.databaseOptionsKey === requestKey;
        const isLoadedSameKey =
            context.state.databaseOptionsStatus === ApiStatus.Loaded &&
            context.state.databaseOptionsKey === requestKey;

        if (isLoadingSameKey || isLoadedSameKey) {
            return;
        }

        await context.listDatabases(connectionProfile);
    }, [connectionProfile, context]);

    const updateDatabaseValue = (value: string, updateValidation: boolean) => {
        context?.formAction({
            propertyName: component.propertyName as keyof IConnectionDialogProfile,
            isAction: false,
            value: value,
            updateValidation: updateValidation,
        });
    };

    const selectedOption = options.includes(inputValue) ? inputValue : undefined;

    return (
        <div className={formStyles.formComponentDiv} key={idx}>
            <Field
                validationMessage={component.validation?.validationMessage ?? ""}
                orientation="horizontal"
                validationState={
                    component.validation
                        ? component.validation.isValid
                            ? "none"
                            : "error"
                        : "none"
                }
                required={component.required}
                label={
                    component.tooltip ? (
                        {
                            children: (_: unknown, slotProps: LabelProps) => (
                                <InfoLabel {...slotProps} info={component.tooltip}>
                                    <span
                                        style={{
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: "6px",
                                        }}>
                                        <span
                                            dangerouslySetInnerHTML={{
                                                __html: component.label,
                                            }}
                                        />
                                        {isLoading ? <Spinner size="tiny" /> : undefined}
                                    </span>
                                </InfoLabel>
                            ),
                        }
                    ) : (
                        <span
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                            }}>
                            <span
                                dangerouslySetInnerHTML={{
                                    __html: component.label,
                                }}
                            />
                            {isLoading ? <Spinner size="tiny" /> : undefined}
                        </span>
                    )
                }>
                <Combobox
                    size="small"
                    freeform
                    value={inputValue}
                    selectedOptions={selectedOption ? [selectedOption] : []}
                    placeholder={DEFAULT_DATABASE_OPTION}
                    onFocus={() => {
                        void loadDatabaseOptions();
                        setIsFiltering(false);
                    }}
                    onClick={() => {
                        void loadDatabaseOptions();
                        setIsFiltering(false);
                    }}
                    onOptionSelect={(_event, data) => {
                        const nextValue = data.optionValue ?? "";
                        setInputValue(nextValue);
                        setIsFiltering(false);
                        updateDatabaseValue(nextValue, true);
                    }}
                    onChange={(event) => {
                        const nextValue = event.currentTarget.value;
                        setInputValue(nextValue);
                        setIsFiltering(true);
                        updateDatabaseValue(nextValue, false);
                        void loadDatabaseOptions();
                    }}
                    onBlur={() => {
                        updateDatabaseValue(inputValue, true);
                        setIsFiltering(false);
                    }}>
                    {filteredOptions.map((option) => (
                        <Option key={option} value={option}>
                            {option}
                        </Option>
                    ))}
                </Combobox>
            </Field>
        </div>
    );
};
