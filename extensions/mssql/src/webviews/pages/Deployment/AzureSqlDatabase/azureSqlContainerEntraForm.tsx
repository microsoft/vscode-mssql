/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Field,
    Input,
    makeStyles,
    MessageBar,
    MessageBarBody,
} from "@fluentui/react-components";
import { FolderOpen16Regular } from "@fluentui/react-icons";
import { useEffect, useRef, useState } from "react";
import {
    AzureSqlContainerForm,
    AzureSqlContainerFormErrors,
    AzureSqlDatabaseRequests,
    ContainerEntraOption,
} from "../../../../sharedInterfaces/azureSqlDatabase";
import {
    DeploymentReducers,
    DeploymentWebviewState,
} from "../../../../sharedInterfaces/deployment";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import { FormContextProps, FormItemSpec, FormItemType } from "../../../../sharedInterfaces/form";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { FormField } from "../../../common/forms/form.component";
import { locConstants } from "../../../common/locConstants";
import { getCoreRPCs } from "../../../common/utils";

type EntraProperty = "accountId" | "tenantId";

interface EntraFormState {
    formState: AzureSqlContainerForm;
    formComponents: Partial<Record<keyof AzureSqlContainerForm, EntraFormItemSpec>>;
}

type EntraFormItemSpec = FormItemSpec<AzureSqlContainerForm, EntraFormState, EntraFormItemSpec>;

const useStyles = makeStyles({
    fields: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        border: "none",
        margin: 0,
        padding: 0,
        minWidth: 0,
        width: "100%",
        "> div > .fui-Field": {
            margin: 0,
        },
    },
});

export const AzureSqlContainerEntraForm = ({
    form,
    errors,
    disabled,
    onChange,
    children,
}: {
    form: AzureSqlContainerForm;
    errors: AzureSqlContainerFormErrors;
    disabled: boolean;
    onChange: (changes: Partial<AzureSqlContainerForm>) => void;
    children: React.ReactNode;
}) => {
    const classes = useStyles();
    const { extensionRpc } = useVscodeWebview<DeploymentWebviewState, DeploymentReducers>();
    const loc = locConstants.azureSqlContainer;
    const [accounts, setAccounts] = useState<ContainerEntraOption[]>([]);
    const [tenants, setTenants] = useState<ContainerEntraOption[]>([]);
    const [loadingAccounts, setLoadingAccounts] = useState(true);
    const [loadingTenants, setLoadingTenants] = useState(false);
    const [selectingPfx, setSelectingPfx] = useState(false);
    const [loadErrors, setLoadErrors] = useState<
        Partial<Record<EntraProperty | "pfxFilePath", string>>
    >({});
    const error = Object.values(loadErrors).find(Boolean);
    const [refresh, setRefresh] = useState(0);
    const latest = useRef({ form, onChange });
    latest.current = { form, onChange };
    const mounted = useRef(true);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        setLoadingAccounts(true);
        setLoadErrors((current) => ({ ...current, accountId: undefined }));
        void extensionRpc
            .sendRequest(AzureSqlDatabaseRequests.ContainerEntraAccounts, {})
            .then((options) => {
                if (!cancelled) {
                    setAccounts(options);
                    if (
                        options.length > 0 &&
                        !options.some((option) => option.value === latest.current.form.accountId)
                    ) {
                        latest.current.onChange({
                            accountId: options[0].value,
                            tenantId: undefined,
                        });
                    }
                }
            })
            .catch((failure) => {
                if (!cancelled) {
                    setLoadErrors((current) => ({
                        ...current,
                        accountId: failure instanceof Error ? failure.message : String(failure),
                    }));
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoadingAccounts(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [extensionRpc, refresh]);

    useEffect(() => {
        let cancelled = false;
        setTenants([]);
        setLoadingTenants(false);
        setLoadErrors((current) => ({ ...current, tenantId: undefined }));
        if (!form.accountId) {
            return;
        }
        setLoadingTenants(true);
        void extensionRpc
            .sendRequest(AzureSqlDatabaseRequests.ContainerEntraTenants, {
                accountId: form.accountId,
            })
            .then((options) => {
                if (!cancelled) {
                    setTenants(options);
                    if (
                        options.length > 0 &&
                        !options.some((option) => option.value === latest.current.form.tenantId)
                    ) {
                        latest.current.onChange({ tenantId: options[0].value });
                    }
                }
            })
            .catch((failure) => {
                if (!cancelled) {
                    setLoadErrors((current) => ({
                        ...current,
                        tenantId: failure instanceof Error ? failure.message : String(failure),
                    }));
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoadingTenants(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [extensionRpc, form.accountId, refresh]);

    const signIn = async () => {
        setLoadingAccounts(true);
        setLoadErrors((current) => ({ ...current, accountId: undefined }));
        try {
            const options = await extensionRpc.sendRequest(
                AzureSqlDatabaseRequests.ContainerEntraAccounts,
                { signIn: true },
            );
            if (!mounted.current) {
                return;
            }
            setAccounts(options);
            const added = options.find(
                (option) => !accounts.some((account) => account.value === option.value),
            );
            if (added) {
                latest.current.onChange({ accountId: added.value, tenantId: undefined });
            }
        } catch (failure) {
            if (mounted.current) {
                setLoadErrors((current) => ({
                    ...current,
                    accountId: failure instanceof Error ? failure.message : String(failure),
                }));
            }
        } finally {
            if (mounted.current) {
                setLoadingAccounts(false);
            }
        }
    };

    const browsePfx = async () => {
        setSelectingPfx(true);
        setLoadErrors((current) => ({ ...current, pfxFilePath: undefined }));
        try {
            const pfxFilePath = await extensionRpc.sendRequest(
                AzureSqlDatabaseRequests.SelectContainerPfxFile,
                undefined,
            );
            if (mounted.current && pfxFilePath !== undefined) {
                latest.current.onChange({ pfxFilePath });
            }
        } catch (failure) {
            const message = failure instanceof Error ? failure.message : String(failure);
            extensionRpc.log.error("Failed to select Azure SQL container PFX file", {
                message,
                stack: failure instanceof Error ? failure.stack : undefined,
            });
            if (mounted.current) {
                setLoadErrors((current) => ({ ...current, pfxFilePath: message }));
            }
        } finally {
            if (mounted.current) {
                setSelectingPfx(false);
            }
        }
    };

    const context: FormContextProps<AzureSqlContainerForm> = {
        ...getCoreRPCs(extensionRpc),
        formAction: (event) => {
            if (event.isAction) {
                void signIn();
            } else if (
                typeof event.value === "string" &&
                (event.propertyName === "accountId" || event.propertyName === "tenantId")
            ) {
                onChange({
                    [event.propertyName]: event.value || undefined,
                    ...(event.propertyName === "accountId" ? { tenantId: undefined } : {}),
                });
            }
        },
    };

    const renderField = (
        property: EntraProperty,
        title: string,
        options: ContainerEntraOption[],
        loading: boolean,
        placeholder: string,
        loadingPlaceholder: string,
    ) => {
        const validationMessage = errors[property] ?? loadErrors[property];
        const prerequisiteReady = property === "accountId" || !!form.accountId;
        const component: EntraFormItemSpec = {
            propertyName: property,
            label: title,
            required: true,
            type: FormItemType.Dropdown,
            options,
            placeholder: loading ? loadingPlaceholder : placeholder,
            loadStatus: {
                status: loading
                    ? ApiStatus.Loading
                    : loadErrors[property]
                      ? ApiStatus.Error
                      : prerequisiteReady
                        ? ApiStatus.Loaded
                        : ApiStatus.NotStarted,
                message: loadErrors[property],
            },
            validation: { isValid: !validationMessage, validationMessage: validationMessage ?? "" },
            ...(property === "accountId" && {
                actionButtons: [
                    {
                        id: "azureSignIn",
                        label: locConstants.connectionDialog.addAccount,
                        callback: signIn,
                    },
                ],
            }),
        };
        return (
            <FormField<
                AzureSqlContainerForm,
                EntraFormState,
                EntraFormItemSpec,
                FormContextProps<AzureSqlContainerForm>
            >
                context={context}
                formState={form}
                component={component}
                idx={0}
                componentProps={{ disabled: disabled || loading || !prerequisiteReady }}
            />
        );
    };

    return (
        <>
            {error && (
                <MessageBar intent="error">
                    <MessageBarBody>
                        {error}
                        <Button
                            appearance="subtle"
                            disabled={disabled || selectingPfx}
                            onClick={() => {
                                if (loadErrors.accountId || loadErrors.tenantId) {
                                    setRefresh((current) => current + 1);
                                } else {
                                    void browsePfx();
                                }
                            }}>
                            {locConstants.common.retry}
                        </Button>
                    </MessageBarBody>
                </MessageBar>
            )}
            {children}
            <fieldset className={classes.fields} disabled={disabled}>
                <fieldset className={classes.fields} disabled={loadingAccounts}>
                    {renderField(
                        "accountId",
                        locConstants.azure.azureAccount,
                        accounts,
                        loadingAccounts,
                        locConstants.connectionDialog.selectAnAccount,
                        locConstants.azureSqlDatabase.loadingAzureAccounts,
                    )}
                </fieldset>
                {renderField(
                    "tenantId",
                    locConstants.connectionDialog.tenantId,
                    tenants,
                    loadingTenants,
                    locConstants.azure.selectATenant,
                    locConstants.azureSqlDatabase.loadingTenants,
                )}
                <Field
                    label={loc.applicationClientId}
                    required
                    validationState={errors.applicationId ? "error" : "none"}
                    validationMessage={errors.applicationId}>
                    <Input
                        size="small"
                        value={form.applicationId ?? ""}
                        placeholder={loc.enterApplicationClientId}
                        disabled={disabled}
                        onChange={(_, data) => onChange({ applicationId: data.value.trim() })}
                    />
                </Field>
                <Field
                    label={loc.pfxFilePath}
                    required
                    validationState={
                        errors.pfxFilePath || loadErrors.pfxFilePath ? "error" : "none"
                    }
                    validationMessage={errors.pfxFilePath ?? loadErrors.pfxFilePath}>
                    <Input
                        size="small"
                        value={form.pfxFilePath ?? ""}
                        placeholder={loc.selectPfxFile}
                        disabled={disabled || selectingPfx}
                        onChange={(_, data) => {
                            setLoadErrors((current) => ({ ...current, pfxFilePath: undefined }));
                            onChange({ pfxFilePath: data.value });
                        }}
                        contentAfter={
                            <Button
                                type="button"
                                size="small"
                                appearance="transparent"
                                icon={<FolderOpen16Regular />}
                                aria-label={loc.browsePfxFile}
                                title={loc.browsePfxFile}
                                disabled={disabled || selectingPfx}
                                onClick={() => void browsePfx()}
                            />
                        }
                    />
                </Field>
            </fieldset>
        </>
    );
};
