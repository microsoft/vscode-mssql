/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useFormStyles } from "../../../common/forms/form.component";
import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Dropdown,
    Field,
    Input,
    MessageBar,
    Option,
    Spinner,
    Text,
} from "@fluentui/react-components";
import { locConstants as Loc } from "../../../common/locConstants";
import { CreateResourceGroupDialogState } from "../../../../sharedInterfaces/azureSqlDatabase";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { useState } from "react";
import { KeyCode } from "../../../common/keys";

export const CreateResourceGroupDialog = ({
    state,
    onSubmit,
    onClose,
}: {
    state: CreateResourceGroupDialogState;
    onSubmit: (resourceGroupName: string, location: string) => void;
    onClose: () => void;
}) => {
    const formStyles = useFormStyles();
    const [resourceGroupName, setResourceGroupName] = useState("");
    const [selectedLocation, setSelectedLocation] = useState("");

    const isLocationsLoading = state.locationsLoadState === ApiStatus.Loading;
    const isCreating = state.createLoadState === ApiStatus.Loading;

    function isReadyToSubmit(): boolean {
        return resourceGroupName.trim() !== "" && selectedLocation !== "" && !isCreating;
    }

    function handleSubmit(e?: React.FormEvent) {
        if (e) e.preventDefault();
        if (isReadyToSubmit()) {
            onSubmit(resourceGroupName.trim(), selectedLocation);
        }
    }

    const locationLabel = isLocationsLoading ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
            <Text>{Loc.azureSqlDatabase.location}</Text>
            <Spinner size="extra-tiny" style={{ transform: "scale(0.8)" }} />
        </span>
    ) : (
        Loc.azureSqlDatabase.location
    );

    return (
        <Dialog open={true}>
            <DialogSurface
                onKeyDown={(e: React.KeyboardEvent) => {
                    if (e.code === KeyCode.Escape && !isCreating) {
                        onClose();
                    }
                }}>
                <DialogBody>
                    <DialogTitle>{Loc.azureSqlDatabase.createNewResourceGroup}</DialogTitle>
                    <DialogContent>
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
                                label={Loc.azureSqlDatabase.resourceGroupName}
                                required>
                                <Input
                                    value={resourceGroupName}
                                    onChange={(_e, data) => {
                                        setResourceGroupName(data.value);
                                    }}
                                    required
                                    disabled={isCreating}
                                    placeholder={Loc.azureSqlDatabase.enterResourceGroupName}
                                />
                            </Field>
                            <Field
                                className={formStyles.formComponentDiv}
                                label={locationLabel}
                                required>
                                <Dropdown
                                    disabled={isLocationsLoading || isCreating}
                                    value={
                                        state.locationOptions.find(
                                            (l) => l.name === selectedLocation,
                                        )?.displayName || ""
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
                        </form>
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="secondary" onClick={onClose} disabled={isCreating}>
                            {Loc.common.cancel}
                        </Button>
                        <Button
                            appearance="primary"
                            onClick={() => handleSubmit()}
                            disabled={!isReadyToSubmit()}
                            icon={isCreating ? <Spinner size="tiny" /> : undefined}>
                            {isCreating
                                ? Loc.azureSqlDatabase.creatingResourceGroup
                                : Loc.azureSqlDatabase.create}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
