/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Field,
    Input,
    Link,
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
import { CreateAppRegistrationDrawer } from "./createAppRegistrationDrawer";

type EntraProperty = "accountId" | "tenantId" | "applicationId";

interface EntraFormState {
    formState: AzureSqlContainerForm;
    formComponents: Partial<Record<keyof AzureSqlContainerForm, EntraFormItemSpec>>;
}

type EntraFormItemSpec = FormItemSpec<AzureSqlContainerForm, EntraFormState, EntraFormItemSpec>;

const useStyles = makeStyles({
    fieldRow: {
        display: "flex",
        alignItems: "flex-end",
        gap: "8px",
        width: "100%",
    },
    field: {
        flex: 1,
        minWidth: 0,
        "> div > .fui-Field": {
            margin: 0,
        },
    },
    fieldAction: {
        fontSize: "12px",
        textDecoration: "none",
        whiteSpace: "nowrap",
        marginBottom: "4px",
        flexShrink: 0,
    },
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
    const [applications, setApplications] = useState<ContainerEntraOption[]>([]);
    const [loadingAccounts, setLoadingAccounts] = useState(true);
    const [loadingTenants, setLoadingTenants] = useState(false);
    const [loadingApplications, setLoadingApplications] = useState(false);
    const [selectingPfx, setSelectingPfx] = useState(false);
    const [generatingPfx, setGeneratingPfx] = useState(false);
    const [pfxAction, setPfxAction] = useState<"browse" | "generate">("browse");
    const [showCreateApp, setShowCreateApp] = useState(false);
    const [creatingApp, setCreatingApp] = useState(false);
    const [createAppError, setCreateAppError] = useState<string>();
    const [loadErrors, setLoadErrors] = useState<
        Partial<Record<EntraProperty | "pfxFilePath", string>>
    >({});
    const error = Object.values(loadErrors).find(Boolean);
    const [refresh, setRefresh] = useState(0);
    const [refreshApplications, setRefreshApplications] = useState(0);
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
                            applicationId: undefined,
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
                        latest.current.onChange({
                            tenantId: options[0].value,
                            applicationId: undefined,
                        });
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

    useEffect(() => {
        let cancelled = false;
        setApplications([]);
        setLoadingApplications(false);
        setLoadErrors((current) => ({ ...current, applicationId: undefined }));
        if (
            !form.accountId ||
            !form.tenantId ||
            loadingAccounts ||
            loadingTenants ||
            loadErrors.accountId ||
            loadErrors.tenantId
        ) {
            return;
        }
        setLoadingApplications(true);
        void extensionRpc
            .sendRequest(AzureSqlDatabaseRequests.ContainerEntraApplications, {
                accountId: form.accountId,
                tenantId: form.tenantId,
            })
            .then((options) => {
                if (!cancelled) {
                    setApplications(options);
                    if (
                        !options.some(
                            (option) => option.value === latest.current.form.applicationId,
                        ) &&
                        latest.current.form.applicationId !== options[0]?.value
                    ) {
                        latest.current.onChange({ applicationId: options[0]?.value });
                    }
                }
            })
            .catch((failure) => {
                const message = failure instanceof Error ? failure.message : String(failure);
                extensionRpc.log.error("Failed to load Azure SQL container app registrations", {
                    message,
                    stack: failure instanceof Error ? failure.stack : undefined,
                });
                if (!cancelled) {
                    setLoadErrors((current) => ({
                        ...current,
                        applicationId: message,
                    }));
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoadingApplications(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [
        extensionRpc,
        form.accountId,
        form.tenantId,
        loadingAccounts,
        loadingTenants,
        loadErrors.accountId,
        loadErrors.tenantId,
        refreshApplications,
    ]);

    const signIn = async () => {
        setLoadingAccounts(true);
        setLoadErrors((current) => ({ ...current, accountId: undefined }));
        try {
            const options = await extensionRpc.sendRequest(
                AzureSqlDatabaseRequests.ContainerEntraAccounts,
                { signIn: true },
            );
            setAccounts(options);
            const added = options.find(
                (option) => !accounts.some((account) => account.value === option.value),
            );
            if (added) {
                latest.current.onChange({
                    accountId: added.value,
                    tenantId: undefined,
                    applicationId: undefined,
                });
            }
        } catch (failure) {
            setLoadErrors((current) => ({
                ...current,
                accountId: failure instanceof Error ? failure.message : String(failure),
            }));
        } finally {
            setLoadingAccounts(false);
        }
    };

    const browsePfx = async () => {
        setPfxAction("browse");
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

    const generatePfx = async () => {
        setPfxAction("generate");
        setGeneratingPfx(true);
        setLoadErrors((current) => ({ ...current, pfxFilePath: undefined }));
        try {
            const files = await extensionRpc.sendRequest(
                AzureSqlDatabaseRequests.GenerateContainerCertificateFiles,
                undefined,
            );
            if (mounted.current && files) {
                latest.current.onChange({ pfxFilePath: files.pfxFilePath });
            }
        } catch (failure) {
            const message = failure instanceof Error ? failure.message : String(failure);
            extensionRpc.log.error("Failed to generate Azure SQL container certificate files", {
                message,
                stack: failure instanceof Error ? failure.stack : undefined,
            });
            if (mounted.current) {
                setLoadErrors((current) => ({ ...current, pfxFilePath: message }));
            }
        } finally {
            if (mounted.current) {
                setGeneratingPfx(false);
            }
        }
    };

    const createApp = async (displayName: string, accountId: string, tenantId: string) => {
        setCreatingApp(true);
        setCreateAppError(undefined);
        try {
            const application = await extensionRpc.sendRequest(
                AzureSqlDatabaseRequests.CreateContainerEntraApplication,
                { displayName, accountId, tenantId },
            );
            if (
                mounted.current &&
                latest.current.form.accountId === accountId &&
                latest.current.form.tenantId === tenantId
            ) {
                setApplications((current) => [...current, application]);
                setLoadErrors((current) => ({ ...current, applicationId: undefined }));
                latest.current.onChange({ applicationId: application.value });
                setShowCreateApp(false);
            }
        } catch (failure) {
            const message = failure instanceof Error ? failure.message : String(failure);
            extensionRpc.log.error("Failed to create Azure SQL container app registration", {
                message,
                stack: failure instanceof Error ? failure.stack : undefined,
            });
            if (mounted.current) {
                setCreateAppError(message);
            }
        } finally {
            if (mounted.current) {
                setCreatingApp(false);
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
                (event.propertyName === "accountId" ||
                    event.propertyName === "tenantId" ||
                    event.propertyName === "applicationId")
            ) {
                onChange({
                    [event.propertyName]: event.value || undefined,
                    ...(event.propertyName === "accountId" ? { tenantId: undefined } : {}),
                    ...(event.propertyName !== "applicationId" ? { applicationId: undefined } : {}),
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
        const prerequisiteReady =
            property === "accountId" ||
            (property === "tenantId"
                ? !!form.accountId
                : !!form.accountId &&
                  !!form.tenantId &&
                  !loadingAccounts &&
                  !loadingTenants &&
                  !loadErrors.accountId &&
                  !loadErrors.tenantId);
        const component: EntraFormItemSpec = {
            propertyName: property,
            label: title,
            required: true,
            type:
                property === "applicationId"
                    ? FormItemType.SearchableDropdown
                    : FormItemType.Dropdown,
            ...(property === "applicationId" && {
                searchBoxPlaceholder: loc.searchAppRegistrations,
            }),
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
                componentProps={{
                    disabled: disabled || loading || !prerequisiteReady,
                }}
            />
        );
    };

    const { accountId, tenantId } = form;
    const selectedTenant = tenants.find((tenant) => tenant.value === tenantId);
    return (
        <>
            {showCreateApp && accountId && tenantId && selectedTenant && (
                <CreateAppRegistrationDrawer
                    tenantName={selectedTenant.displayName}
                    isCreating={creatingApp}
                    error={createAppError}
                    onSubmit={(displayName) => void createApp(displayName, accountId, tenantId)}
                    onClose={() => setShowCreateApp(false)}
                />
            )}
            {error && (
                <MessageBar intent="error">
                    <MessageBarBody>
                        {error}
                        <Button
                            appearance="subtle"
                            disabled={disabled || selectingPfx || generatingPfx}
                            onClick={() => {
                                if (loadErrors.accountId || loadErrors.tenantId) {
                                    setRefresh((current) => current + 1);
                                } else if (loadErrors.applicationId) {
                                    setRefreshApplications((current) => current + 1);
                                } else if (pfxAction === "generate") {
                                    void generatePfx();
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
                <div className={classes.fieldRow}>
                    <div className={classes.field}>
                        {renderField(
                            "applicationId",
                            loc.appRegistration,
                            applications,
                            loadingApplications,
                            loc.selectAppRegistration,
                            loc.loadingAppRegistrations,
                        )}
                    </div>
                    <Link
                        as="button"
                        type="button"
                        className={classes.fieldAction}
                        disabled={
                            disabled ||
                            creatingApp ||
                            loadingApplications ||
                            loadingAccounts ||
                            loadingTenants ||
                            !accountId ||
                            !selectedTenant ||
                            !!loadErrors.accountId ||
                            !!loadErrors.tenantId
                        }
                        onClick={() => {
                            setCreateAppError(undefined);
                            setShowCreateApp(true);
                        }}>
                        {loc.createAppRegistration}
                    </Link>
                </div>
                <div className={classes.fieldRow}>
                    <Field
                        className={classes.field}
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
                            disabled={disabled || selectingPfx || generatingPfx}
                            onChange={(_, data) => {
                                setLoadErrors((current) => ({
                                    ...current,
                                    pfxFilePath: undefined,
                                }));
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
                                    disabled={disabled || selectingPfx || generatingPfx}
                                    onClick={() => void browsePfx()}
                                />
                            }
                        />
                    </Field>
                    <Link
                        as="button"
                        type="button"
                        className={classes.fieldAction}
                        disabled={disabled || selectingPfx || generatingPfx}
                        onClick={() => void generatePfx()}>
                        {generatingPfx ? loc.generatingPfxFile : loc.generatePfxFile}
                    </Link>
                </div>
            </fieldset>
        </>
    );
};
