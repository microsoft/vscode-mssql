/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
    makeStyles,
    MessageBar,
    MessageBarBody,
} from "@fluentui/react-components";
import { useState } from "react";
import { EyeOffRegular, EyeRegular } from "@fluentui/react-icons";
import { ChangePasswordResult } from "../../../sharedInterfaces/changePassword";
import { locConstants } from "../../common/locConstants";

const useStyles = makeStyles({
    root: {
        minWidth: "550px",
        maxWidth: "550px",
    },
    title: {
        fontSize: "18px",
        fontWeight: "600",
    },
    content: {
        display: "flex",
        flexDirection: "column",
        gap: "16px",
    },
    apiErrorMessage: {
        marginBottom: "0",
    },
    description: {
        fontSize: "14px",
        color: "var(--colorNeutralForeground2)",
        lineHeight: "20px",
        marginBottom: "4px",
    },
    passwordField: {
        marginBottom: "0",
    },
    fieldGroup: {
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        marginTop: "4px",
    },
    actions: {
        marginTop: "4px",
    },
});

export const ChangePasswordDialog = ({
    onClose,
    onSubmit,
    serverName,
    userName,
}: {
    onClose?: () => void;
    onSubmit?: (password: string) => Promise<ChangePasswordResult | undefined>;
    errorMessage?: string;
    serverName?: string;
    userName?: string;
}) => {
    const styles = useStyles();
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [resultApiError, setResultApiError] = useState<string | undefined>(undefined);

    const passwordsMatch = password === confirmPassword;
    const isPasswordEmpty = password.trim() === "";
    const isConfirmPasswordEmpty = confirmPassword.trim() === "";
    const showPasswordMismatchError = !isConfirmPasswordEmpty && !passwordsMatch;
    const isSubmitDisabled = isPasswordEmpty || isConfirmPasswordEmpty || !passwordsMatch;

    return (
        <Dialog open={true} modalType="modal">
            <DialogSurface className={styles.root}>
                <DialogBody>
                    <DialogTitle className={styles.title}>
                        {locConstants.changePasswordDialog.title}
                    </DialogTitle>
                    <DialogContent>
                        <div className={styles.content}>
                            {resultApiError && (
                                <MessageBar intent={"error"} className={styles.apiErrorMessage}>
                                    <MessageBarBody>{resultApiError}</MessageBarBody>
                                </MessageBar>
                            )}
                            <div className={styles.description}>
                                {locConstants.changePasswordDialog.description(serverName ?? "")}
                            </div>
                            <div className={styles.fieldGroup}>
                                <Field
                                    size="medium"
                                    className={styles.passwordField}
                                    label={locConstants.changePasswordDialog.username}>
                                    <Input
                                        size="medium"
                                        disabled
                                        value={userName}
                                        onChange={(_, data) => setPassword(data.value)}
                                    />
                                </Field>
                                <Field
                                    size="medium"
                                    className={styles.passwordField}
                                    label={locConstants.changePasswordDialog.newPassword}
                                    required
                                    validationMessage={
                                        isPasswordEmpty && password !== ""
                                            ? locConstants.changePasswordDialog.passwordIsRequired
                                            : undefined
                                    }
                                    validationState={
                                        isPasswordEmpty && password !== "" ? "error" : "none"
                                    }>
                                    <Input
                                        size="medium"
                                        type={showPassword ? "text" : "password"}
                                        placeholder={
                                            locConstants.changePasswordDialog.newPasswordPlaceholder
                                        }
                                        required
                                        value={password}
                                        onChange={(_, data) => setPassword(data.value)}
                                        contentAfter={
                                            <Button
                                                size="small"
                                                onClick={() => setShowPassword(!showPassword)}
                                                appearance="transparent"
                                                title={
                                                    showPassword
                                                        ? locConstants.changePasswordDialog
                                                              .hideNewPassword
                                                        : locConstants.changePasswordDialog
                                                              .showNewPassword
                                                }
                                                icon={
                                                    showPassword ? (
                                                        <EyeRegular />
                                                    ) : (
                                                        <EyeOffRegular />
                                                    )
                                                }></Button>
                                        }
                                    />
                                </Field>
                                <Field
                                    size="medium"
                                    className={styles.passwordField}
                                    label={locConstants.changePasswordDialog.confirmPassword}
                                    required
                                    validationMessage={
                                        showPasswordMismatchError
                                            ? locConstants.changePasswordDialog.passwordsDoNotMatch
                                            : undefined
                                    }
                                    validationState={showPasswordMismatchError ? "error" : "none"}>
                                    <Input
                                        size="medium"
                                        type={showConfirmPassword ? "text" : "password"}
                                        placeholder={
                                            locConstants.changePasswordDialog
                                                .confirmPasswordPlaceholder
                                        }
                                        required
                                        value={confirmPassword}
                                        onChange={(_, data) => setConfirmPassword(data.value)}
                                        contentAfter={
                                            <Button
                                                size="small"
                                                onClick={() =>
                                                    setShowConfirmPassword(!showConfirmPassword)
                                                }
                                                appearance="transparent"
                                                title={
                                                    showConfirmPassword
                                                        ? locConstants.changePasswordDialog
                                                              .hideConfirmPassword
                                                        : locConstants.changePasswordDialog
                                                              .showConfirmPassword
                                                }
                                                icon={
                                                    showConfirmPassword ? (
                                                        <EyeRegular />
                                                    ) : (
                                                        <EyeOffRegular />
                                                    )
                                                }></Button>
                                        }
                                    />
                                </Field>
                            </div>
                        </div>
                    </DialogContent>
                    <DialogActions className={styles.actions}>
                        <Button
                            size="medium"
                            appearance="primary"
                            title={locConstants.changePasswordDialog.changePasswordButton}
                            disabled={isSubmitDisabled}
                            onClick={async () => {
                                if (onSubmit) {
                                    const result = await onSubmit(password);
                                    if (result?.errorMessage) {
                                        setResultApiError(result.errorMessage);
                                    }
                                }
                            }}>
                            {locConstants.changePasswordDialog.changePasswordButton}
                        </Button>
                        <Button
                            size="medium"
                            appearance="secondary"
                            title={locConstants.changePasswordDialog.cancelButton}
                            onClick={async () => {
                                void onClose?.();
                            }}>
                            {locConstants.changePasswordDialog.cancelButton}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
