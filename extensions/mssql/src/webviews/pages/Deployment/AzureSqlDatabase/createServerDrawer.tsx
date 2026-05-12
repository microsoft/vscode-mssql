/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useFormStyles } from "../../../common/forms/form.component";
import {
    Button,
    Checkbox,
    DrawerBody,
    DrawerHeader,
    DrawerHeaderTitle,
    Dropdown,
    Field,
    Input,
    MessageBar,
    Option,
    OverlayDrawer,
    Spinner,
    Text,
} from "@fluentui/react-components";
import { Dismiss24Regular, EyeOffRegular, EyeRegular } from "@fluentui/react-icons";
import { locConstants as Loc } from "../../../common/locConstants";
import {
    CreateServerDrawerState,
    CreateServerSpec,
} from "../../../../sharedInterfaces/azureSqlDatabase";
import { AuthenticationType } from "../../../../sharedInterfaces/connectionDialog";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { useEffect, useState } from "react";

export const CreateServerDrawer = ({
    state,
    onSubmit,
    onClose,
}: {
    state: CreateServerDrawerState;
    onSubmit: (spec: CreateServerSpec) => void;
    onClose: () => void;
}) => {
    const formStyles = useFormStyles();
    const [serverName, setServerName] = useState("");
    const [selectedLocation, setSelectedLocation] = useState("");
    const [authType, setAuthType] = useState<string>(AuthenticationType.AzureMFA);
    const [adminLogin, setAdminLogin] = useState("");
    const [adminPassword, setAdminPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [savePassword, setSavePassword] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    const isLocationsLoading = state.locationsLoadState === ApiStatus.Loading;
    const isCreating = state.createLoadState === ApiStatus.Loading;
    const needsSqlAuth =
        authType === AuthenticationType.SqlLogin || authType === AuthenticationType.AzureMFAAndUser;
    const passwordsMatch = adminPassword === confirmPassword;

    // Pre-select the resource group's location as default once locations finish loading
    useEffect(() => {
        if (
            state.locationsLoadState === ApiStatus.Loaded &&
            !selectedLocation &&
            state.defaultLocation
        ) {
            const match = state.locationOptions.find((l) => l.name === state.defaultLocation);
            if (match) {
                setSelectedLocation(match.name);
            }
        }
    }, [state.locationsLoadState, state.defaultLocation, state.locationOptions, selectedLocation]);

    function isReadyToSubmit(): boolean {
        if (serverName.trim() === "" || selectedLocation === "" || isCreating) {
            return false;
        }
        if (needsSqlAuth) {
            return adminLogin.trim() !== "" && adminPassword !== "" && passwordsMatch;
        }
        return true;
    }

    function handleSubmit(e?: React.FormEvent) {
        if (e) e.preventDefault();
        if (isReadyToSubmit()) {
            onSubmit({
                serverName: serverName.trim(),
                location: selectedLocation,
                authenticationType: authType,
                adminLogin: needsSqlAuth ? adminLogin.trim() : undefined,
                adminPassword: needsSqlAuth ? adminPassword : undefined,
                savePassword: needsSqlAuth ? savePassword : undefined,
            });
        }
    }

    const locationLabel = isLocationsLoading ? (
        <span
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
            }}>
            <Text>{Loc.azureSqlDatabase.location}</Text>
            <Spinner size="extra-tiny" style={{ transform: "scale(0.8)" }} />
        </span>
    ) : (
        Loc.azureSqlDatabase.location
    );

    return (
        <OverlayDrawer
            position="end"
            size="medium"
            open={true}
            onOpenChange={(_, { open }) => {
                if (!open && !isCreating) {
                    onClose();
                }
            }}>
            <DrawerHeader>
                <DrawerHeaderTitle
                    action={
                        <Button
                            appearance="subtle"
                            aria-label={Loc.common.close}
                            icon={<Dismiss24Regular />}
                            onClick={onClose}
                            disabled={isCreating}
                        />
                    }>
                    {Loc.azureSqlDatabase.createNewServer}
                </DrawerHeaderTitle>
            </DrawerHeader>

            <DrawerBody style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ flex: 1 }}>
                    {state.message && (
                        <>
                            <MessageBar intent="error" style={{ paddingRight: "12px" }}>
                                {state.message}
                            </MessageBar>
                            <br />
                        </>
                    )}
                    <form onSubmit={handleSubmit}>
                        <Field
                            className={formStyles.formComponentDiv}
                            label={Loc.azureSqlDatabase.serverName}
                            required>
                            <Input
                                value={serverName}
                                onChange={(_e, data) => {
                                    setServerName(data.value);
                                }}
                                required
                                disabled={isCreating}
                                placeholder={Loc.azureSqlDatabase.enterServerName}
                            />
                        </Field>
                        <Field
                            className={formStyles.formComponentDiv}
                            label={locationLabel}
                            required>
                            <Dropdown
                                disabled={isLocationsLoading || isCreating}
                                value={
                                    state.locationOptions.find((l) => l.name === selectedLocation)
                                        ?.displayName || ""
                                }
                                selectedOptions={selectedLocation ? [selectedLocation] : []}
                                onOptionSelect={(_e, data) => {
                                    setSelectedLocation(data.optionValue || "");
                                }}
                                placeholder={
                                    isLocationsLoading
                                        ? Loc.azureSqlDatabase.loadingLocations
                                        : Loc.azureSqlDatabase.selectLocation
                                }>
                                {state.locationOptions.map((loc) => (
                                    <Option key={loc.name} value={loc.name}>
                                        {loc.displayName}
                                    </Option>
                                ))}
                            </Dropdown>
                        </Field>
                        <Field
                            className={formStyles.formComponentDiv}
                            label={Loc.azureSqlDatabase.authenticationType}
                            required>
                            <Dropdown
                                disabled={isCreating}
                                value={
                                    authType === AuthenticationType.SqlLogin
                                        ? Loc.azureSqlDatabase.sqlLogin
                                        : authType === AuthenticationType.AzureMFA
                                          ? Loc.azureSqlDatabase.azureMFA
                                          : Loc.azureSqlDatabase.azureMFAAndUser
                                }
                                selectedOptions={[authType]}
                                onOptionSelect={(_e, data) => {
                                    setAuthType(data.optionValue || AuthenticationType.AzureMFA);
                                }}>
                                <Option value={AuthenticationType.AzureMFA}>
                                    {Loc.azureSqlDatabase.azureMFA}
                                </Option>
                                <Option value={AuthenticationType.SqlLogin}>
                                    {Loc.azureSqlDatabase.sqlLogin}
                                </Option>
                                <Option value={AuthenticationType.AzureMFAAndUser}>
                                    {Loc.azureSqlDatabase.azureMFAAndUser}
                                </Option>
                            </Dropdown>
                        </Field>
                        {needsSqlAuth && (
                            <>
                                <Field
                                    className={formStyles.formComponentDiv}
                                    label={Loc.azureSqlDatabase.adminLogin}
                                    required>
                                    <Input
                                        value={adminLogin}
                                        onChange={(_e, data) => setAdminLogin(data.value)}
                                        disabled={isCreating}
                                        placeholder={Loc.azureSqlDatabase.enterAdminLogin}
                                    />
                                </Field>
                                <Field
                                    className={formStyles.formComponentDiv}
                                    label={Loc.azureSqlDatabase.adminPassword}
                                    required>
                                    <Input
                                        type={showPassword ? "text" : "password"}
                                        value={adminPassword}
                                        onChange={(_e, data) => setAdminPassword(data.value)}
                                        disabled={isCreating}
                                        placeholder={Loc.azureSqlDatabase.enterAdminPassword}
                                        contentAfter={
                                            <Button
                                                onClick={() => setShowPassword(!showPassword)}
                                                icon={
                                                    showPassword ? (
                                                        <EyeRegular />
                                                    ) : (
                                                        <EyeOffRegular />
                                                    )
                                                }
                                                appearance="transparent"
                                                size="small"
                                                aria-label={
                                                    showPassword
                                                        ? Loc.common.hidePassword
                                                        : Loc.common.showPassword
                                                }
                                            />
                                        }
                                    />
                                </Field>
                                <Field
                                    className={formStyles.formComponentDiv}
                                    label={Loc.azureSqlDatabase.confirmPassword}
                                    required
                                    validationMessage={
                                        confirmPassword && !passwordsMatch
                                            ? Loc.azureSqlDatabase.passwordsDoNotMatch
                                            : undefined
                                    }
                                    validationState={
                                        confirmPassword && !passwordsMatch ? "error" : undefined
                                    }>
                                    <Input
                                        type={showConfirmPassword ? "text" : "password"}
                                        value={confirmPassword}
                                        onChange={(_e, data) => setConfirmPassword(data.value)}
                                        disabled={isCreating}
                                        placeholder={Loc.azureSqlDatabase.enterConfirmPassword}
                                        contentAfter={
                                            <Button
                                                onClick={() =>
                                                    setShowConfirmPassword(!showConfirmPassword)
                                                }
                                                icon={
                                                    showConfirmPassword ? (
                                                        <EyeRegular />
                                                    ) : (
                                                        <EyeOffRegular />
                                                    )
                                                }
                                                appearance="transparent"
                                                size="small"
                                                aria-label={
                                                    showConfirmPassword
                                                        ? Loc.common.hidePassword
                                                        : Loc.common.showPassword
                                                }
                                            />
                                        }
                                    />
                                </Field>
                                <Checkbox
                                    checked={savePassword}
                                    onChange={(_e, data) => setSavePassword(!!data.checked)}
                                    disabled={isCreating}
                                    label={Loc.azureSqlDatabase.savePasswordForConnection}
                                />
                            </>
                        )}
                    </form>
                </div>
                <div
                    style={{
                        display: "flex",
                        justifyContent: "flex-start",
                        gap: "8px",
                        paddingBottom: "16px",
                    }}>
                    <Button
                        appearance="primary"
                        onClick={() => handleSubmit()}
                        disabled={!isReadyToSubmit()}
                        icon={isCreating ? <Spinner size="tiny" /> : undefined}>
                        {isCreating
                            ? Loc.azureSqlDatabase.creatingServer
                            : Loc.azureSqlDatabase.create}
                    </Button>
                    <Button appearance="secondary" onClick={onClose} disabled={isCreating}>
                        {Loc.common.cancel}
                    </Button>
                </div>
            </DrawerBody>
        </OverlayDrawer>
    );
};
