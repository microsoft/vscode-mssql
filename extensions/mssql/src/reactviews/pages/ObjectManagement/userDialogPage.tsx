/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useRef, useState } from "react";
import { makeStyles, Spinner } from "@fluentui/react-components";
import {
    ObjectManagementCancelNotification,
    ObjectManagementDialogType,
    ObjectManagementHelpNotification,
    ObjectManagementScriptRequest,
    ObjectManagementSearchRequest,
    ObjectManagementSubmitRequest,
    ObjectManagementSearchParams,
    ObjectManagementSearchResult,
    UserParams,
    UserViewModel,
    UserType,
} from "../../../sharedInterfaces/objectManagement";
import { locConstants } from "../../common/locConstants";
import { ObjectManagementDialog } from "../../common/objectManagementDialog";
import { ObjectManagementContext } from "./objectManagementStateProvider";
import { UserForm, UserFormState } from "./userForm";

const useStyles = makeStyles({
    loadingPage: {
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        width: "100%",
        flexDirection: "column",
        backgroundColor: "var(--vscode-editor-background)",
    },
});

const isValidSqlPassword = (password: string, userName: string) => {
    const containsUserName =
        password && userName && password.toUpperCase().includes(userName.toUpperCase());
    const hasUpperCase = /[A-Z]/.test(password) ? 1 : 0;
    const hasLowerCase = /[a-z]/.test(password) ? 1 : 0;
    const hasNumbers = /\d/.test(password) ? 1 : 0;
    const hasNonAlphas = /\W/.test(password) ? 1 : 0;
    return (
        !containsUserName &&
        password.length >= 8 &&
        password.length <= 128 &&
        hasUpperCase + hasLowerCase + hasNumbers + hasNonAlphas >= 3
    );
};

export interface UserDialogPageProps {
    model?: UserViewModel;
    isLoading: boolean;
    dialogTitle?: string;
}

export const UserDialogPage = ({ model, isLoading, dialogTitle }: UserDialogPageProps) => {
    const styles = useStyles();
    const context = useContext(ObjectManagementContext);
    const [resultApiError, setResultApiError] = useState<string | undefined>(undefined);
    const [userForm, setUserForm] = useState<UserFormState | undefined>(undefined);
    const formInitialized = useRef(false);
    const originalPassword = useRef<string | undefined>(undefined);

    useEffect(() => {
        if (!model || formInitialized.current) {
            return;
        }

        const user = model.user;
        originalPassword.current = user.password ?? "";

        setUserForm({
            name: user.name ?? "",
            type: (user.type as UserType) ?? model.userTypes[0] ?? "LoginMapped",
            loginName: user.loginName ?? "",
            password: user.password ?? "",
            confirmPassword: user.password ?? "",
            defaultSchema: user.defaultSchema ?? "",
            ownedSchemas: user.ownedSchemas ?? [],
            databaseRoles: user.databaseRoles ?? [],
            defaultLanguage: user.defaultLanguage ?? "",
            securablePermissions: user.securablePermissions ?? [],
        });

        formInitialized.current = true;
    }, [model]);

    const fallbackType = model?.userTypes?.[0] ?? "LoginMapped";
    const safeViewModel: UserViewModel = model ?? {
        serverName: "",
        databaseName: "",
        isNewObject: true,
        user: {
            name: "",
            type: fallbackType,
            ownedSchemas: [],
            databaseRoles: [],
            securablePermissions: [],
        },
        userTypes: [fallbackType],
        schemas: [],
        logins: [],
        databaseRoles: [],
        languages: [],
        supportedSecurableTypes: [],
    };
    const formState: UserFormState = userForm ?? {
        name: safeViewModel.user.name ?? "",
        type: (safeViewModel.user.type as UserType) ?? fallbackType,
        loginName: safeViewModel.user.loginName ?? "",
        password: safeViewModel.user.password ?? "",
        confirmPassword: safeViewModel.user.password ?? "",
        defaultSchema: safeViewModel.user.defaultSchema ?? "",
        ownedSchemas: safeViewModel.user.ownedSchemas ?? [],
        databaseRoles: safeViewModel.user.databaseRoles ?? [],
        defaultLanguage: safeViewModel.user.defaultLanguage ?? "",
        securablePermissions: safeViewModel.user.securablePermissions ?? [],
    };

    const trimmedName = formState.name.trim();
    const isSqlAuth = formState.type === "SqlAuthentication";
    const isNewObject = safeViewModel.isNewObject;
    const passwordChanged =
        isSqlAuth && formState.password !== (originalPassword.current ?? "");
    const shouldValidatePassword = isSqlAuth && (isNewObject || passwordChanged);

    const isNameEmpty = trimmedName.length === 0;
    const showNameRequired = formState.name.length > 0 && isNameEmpty;
    const loginRequired =
        formState.type === "LoginMapped" && !formState.loginName?.trim();
    const passwordRequired = isSqlAuth && !formState.password?.length;
    const passwordMismatch = isSqlAuth && formState.password !== formState.confirmPassword;
    const passwordInvalid =
        isSqlAuth &&
        shouldValidatePassword &&
        !!formState.password &&
        !passwordMismatch &&
        !isValidSqlPassword(formState.password, trimmedName || "sa");

    const isSubmitDisabled =
        isLoading ||
        isNameEmpty ||
        loginRequired ||
        passwordRequired ||
        passwordMismatch ||
        passwordInvalid;

    const nameValidationMessage = showNameRequired
        ? locConstants.userDialog.nameRequired
        : undefined;
    const loginValidationMessage = loginRequired
        ? locConstants.userDialog.loginRequired
        : undefined;
    const passwordValidationMessage = passwordRequired
        ? locConstants.userDialog.passwordRequired
        : passwordInvalid
          ? locConstants.userDialog.passwordInvalid
          : undefined;
    const confirmPasswordValidationMessage = passwordMismatch
        ? locConstants.userDialog.passwordMismatch
        : undefined;

    if (isLoading) {
        return (
            <div className={styles.loadingPage}>
                <Spinner label={locConstants.userDialog.loading} labelPosition="below" />
            </div>
        );
    }

    const handleSearchSecurables = async (
        params: ObjectManagementSearchParams,
    ): Promise<ObjectManagementSearchResult> => {
        if (!context?.extensionRpc) {
            return {
                success: false,
                errorMessage: locConstants.userDialog.searchFailed,
            };
        }

        const result = await context.extensionRpc.sendRequest(ObjectManagementSearchRequest.type, {
            dialogType: ObjectManagementDialogType.User,
            params,
        });

        if (!result) {
            return {
                success: false,
                errorMessage: locConstants.userDialog.searchFailed,
            };
        }

        return result;
    };

    const buildUserParams = (): UserParams => {
        const params: UserParams = {
            name: trimmedName,
            type: formState.type,
            defaultSchema: formState.defaultSchema,
            ownedSchemas: formState.ownedSchemas,
            databaseRoles: formState.databaseRoles,
            defaultLanguage: formState.defaultLanguage,
            securablePermissions: formState.securablePermissions,
        };

        const trimmedLogin = formState.loginName?.trim();

        if (formState.type === "LoginMapped") {
            params.loginName = trimmedLogin ?? "";
        } else if (formState.type === "WindowsUser" && trimmedLogin) {
            params.loginName = trimmedLogin;
        }

        if (formState.type === "SqlAuthentication") {
            params.password = formState.password;
        }

        return params;
    };

    return (
        <ObjectManagementDialog
            title={
                dialogTitle ??
                (isNewObject
                    ? locConstants.userDialog.titleCreate
                    : locConstants.userDialog.titleEdit)
            }
            description={
                model
                    ? isNewObject
                        ? locConstants.userDialog.descriptionCreate(
                              model.databaseName,
                              model.serverName,
                          )
                        : locConstants.userDialog.descriptionEdit(
                              formState.name,
                              model.databaseName,
                              model.serverName,
                          )
                    : undefined
            }
            errorMessage={resultApiError}
            primaryLabel={
                isNewObject
                    ? locConstants.userDialog.createButton
                    : locConstants.userDialog.saveButton
            }
            cancelLabel={locConstants.userDialog.cancelButton}
            helpLabel={locConstants.userDialog.helpButton}
            scriptLabel={locConstants.userDialog.scriptButton}
            primaryDisabled={isSubmitDisabled}
            scriptDisabled={isSubmitDisabled}
            onPrimary={async () => {
                const result = await context?.extensionRpc?.sendRequest(
                    ObjectManagementSubmitRequest.type,
                    {
                        dialogType: ObjectManagementDialogType.User,
                        params: buildUserParams(),
                    },
                );
                if (result?.errorMessage) {
                    setResultApiError(result.errorMessage);
                }
            }}
            onScript={async () => {
                const result = await context?.extensionRpc?.sendRequest(
                    ObjectManagementScriptRequest.type,
                    {
                        dialogType: ObjectManagementDialogType.User,
                        params: buildUserParams(),
                    },
                );
                if (result?.errorMessage) {
                    setResultApiError(result.errorMessage);
                }
            }}
            onHelp={() => {
                void context?.extensionRpc?.sendNotification(ObjectManagementHelpNotification.type);
            }}
            onCancel={() => {
                void context?.extensionRpc?.sendNotification(
                    ObjectManagementCancelNotification.type,
                );
            }}>
            <UserForm
                value={formState}
                viewModel={safeViewModel}
                nameValidationMessage={nameValidationMessage}
                nameValidationState={showNameRequired ? "error" : "none"}
                loginValidationMessage={loginValidationMessage}
                loginValidationState={loginRequired ? "error" : "none"}
                passwordValidationMessage={passwordValidationMessage}
                passwordValidationState={
                    passwordRequired || passwordInvalid ? "error" : "none"
                }
                confirmPasswordValidationMessage={confirmPasswordValidationMessage}
                confirmPasswordValidationState={passwordMismatch ? "error" : "none"}
                onChange={(next) => setUserForm(next)}
                onSearchSecurables={handleSearchSecurables}
            />
        </ObjectManagementDialog>
    );
};
