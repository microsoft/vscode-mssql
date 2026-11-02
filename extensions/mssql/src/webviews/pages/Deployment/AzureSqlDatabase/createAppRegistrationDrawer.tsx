/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    DrawerBody,
    DrawerHeader,
    DrawerHeaderTitle,
    Field,
    Input,
    MessageBar,
    MessageBarBody,
    OverlayDrawer,
    Spinner,
} from "@fluentui/react-components";
import { Dismiss24Regular } from "@fluentui/react-icons";
import { useState } from "react";
import { useFormStyles } from "../../../common/forms/form.component";
import { locConstants } from "../../../common/locConstants";

export const CreateAppRegistrationDrawer = ({
    tenantName,
    isCreating,
    error,
    onSubmit,
    onClose,
}: {
    tenantName: string;
    isCreating: boolean;
    error?: string;
    onSubmit: (displayName: string) => void;
    onClose: () => void;
}) => {
    const formStyles = useFormStyles();
    const loc = locConstants.azureSqlContainer;
    const [displayName, setDisplayName] = useState("");
    const canSubmit = !!displayName.trim() && !isCreating;
    const submit = () => {
        if (canSubmit) {
            onSubmit(displayName.trim());
        }
    };

    return (
        <OverlayDrawer
            position="end"
            size="medium"
            open
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
                            aria-label={locConstants.common.close}
                            icon={<Dismiss24Regular />}
                            onClick={onClose}
                            disabled={isCreating}
                        />
                    }>
                    {loc.createAppRegistration}
                </DrawerHeaderTitle>
            </DrawerHeader>
            <DrawerBody style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ flex: 1 }}>
                    {error && (
                        <MessageBar intent="error">
                            <MessageBarBody>{error}</MessageBarBody>
                        </MessageBar>
                    )}
                    <form
                        onSubmit={(event) => {
                            event.preventDefault();
                            submit();
                        }}>
                        <Field
                            className={formStyles.formComponentDiv}
                            label={loc.appRegistrationName}
                            required>
                            <Input
                                value={displayName}
                                placeholder={loc.enterAppRegistrationName}
                                disabled={isCreating}
                                onChange={(_, data) => setDisplayName(data.value)}
                            />
                        </Field>
                        <Field
                            className={formStyles.formComponentDiv}
                            label={locConstants.azure.tenant}>
                            <Input value={tenantName} readOnly />
                        </Field>
                    </form>
                </div>
                <div
                    style={{
                        display: "flex",
                        gap: "8px",
                        paddingBottom: "16px",
                    }}>
                    <Button
                        appearance="primary"
                        disabled={!canSubmit}
                        onClick={submit}
                        icon={isCreating ? <Spinner size="tiny" /> : undefined}>
                        {isCreating
                            ? loc.creatingAppRegistration
                            : locConstants.azureSqlDatabase.create}
                    </Button>
                    <Button appearance="secondary" disabled={isCreating} onClick={onClose}>
                        {locConstants.common.cancel}
                    </Button>
                </div>
            </DrawerBody>
        </OverlayDrawer>
    );
};
