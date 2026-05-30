/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useFormStyles } from "../../../common/forms/form.component";
import {
    Button,
    DrawerBody,
    DrawerHeader,
    DrawerHeaderTitle,
    Dropdown,
    Field,
    Input,
    Label,
    MessageBar,
    Option,
    OverlayDrawer,
    Spinner,
    Text,
} from "@fluentui/react-components";
import { AddRegular, DeleteRegular, Dismiss24Regular } from "@fluentui/react-icons";
import { locConstants as Loc } from "../../../common/locConstants";
import { CreateResourceGroupDrawerState } from "../../../../sharedInterfaces/azureSqlDatabase";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { useRef, useState } from "react";
import { hasDuplicateTagKeys, TagEntry } from "./azureSqlDatabaseDeploymentWizard";

export const CreateResourceGroupDrawer = ({
    state,
    onSubmit,
    onClose,
}: {
    state: CreateResourceGroupDrawerState;
    onSubmit: (resourceGroupName: string, location: string, tags: Record<string, string>) => void;
    onClose: () => void;
}) => {
    const formStyles = useFormStyles();
    const [resourceGroupName, setResourceGroupName] = useState("");
    const [selectedLocation, setSelectedLocation] = useState("");
    const [tags, setTags] = useState<TagEntry[]>([]);
    const [tagError, setTagError] = useState<string | undefined>(undefined);
    const tagIdCounter = useRef(0);

    const isLocationsLoading = state.locationsLoadState === ApiStatus.Loading;
    const isCreating = state.createLoadState === ApiStatus.Loading;

    function isReadyToSubmit(): boolean {
        return (
            resourceGroupName.trim() !== "" &&
            selectedLocation !== "" &&
            !isCreating &&
            !hasDuplicateTagKeys(tags)
        );
    }

    function handleSubmit(e?: React.FormEvent) {
        if (e) e.preventDefault();
        if (isReadyToSubmit()) {
            const tagsRecord: Record<string, string> = {};
            for (const tag of tags) {
                const trimmedKey = tag.key.trim();
                if (trimmedKey) {
                    tagsRecord[trimmedKey] = tag.value;
                }
            }
            onSubmit(resourceGroupName.trim(), selectedLocation, tagsRecord);
        }
    }

    const handleAddTag = () => {
        setTagError(undefined);
        setTags([...tags, { id: tagIdCounter.current++, key: "", value: "" }]);
    };

    const handleRemoveTag = (index: number) => {
        setTagError(undefined);
        setTags(tags.filter((_, i) => i !== index));
    };

    const handleTagChange = (index: number, field: "key" | "value", newValue: string) => {
        setTagError(undefined);
        const updated = tags.map((tag, i) => (i === index ? { ...tag, [field]: newValue } : tag));

        if (hasDuplicateTagKeys(updated)) {
            setTagError(Loc.azureSqlDatabase.duplicateTagKeys);
        }

        setTags(updated);
    };

    const locationLabel = isLocationsLoading ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
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
                    {Loc.azureSqlDatabase.createNewResourceGroup}
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

                        {/* Tags section */}
                        <div style={{ marginTop: "8px" }}>
                            <Label
                                weight="semibold"
                                style={{ marginBottom: "8px", display: "block" }}>
                                {Loc.azureSqlDatabase.tags}
                            </Label>

                            {tags.map((tag, index) => (
                                <div
                                    key={tag.id}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "8px",
                                        marginBottom: "8px",
                                    }}>
                                    <Input
                                        style={{ flex: 1 }}
                                        size="small"
                                        placeholder={Loc.azureSqlDatabase.tagKeyPlaceholder}
                                        value={tag.key}
                                        disabled={isCreating}
                                        onChange={(_, data) =>
                                            handleTagChange(index, "key", data.value)
                                        }
                                    />
                                    <Input
                                        style={{ flex: 1 }}
                                        size="small"
                                        placeholder={Loc.azureSqlDatabase.tagValuePlaceholder}
                                        value={tag.value}
                                        disabled={isCreating}
                                        onChange={(_, data) =>
                                            handleTagChange(index, "value", data.value)
                                        }
                                    />
                                    <Button
                                        appearance="subtle"
                                        icon={<DeleteRegular />}
                                        size="small"
                                        aria-label={Loc.azureSqlDatabase.removeTag}
                                        disabled={isCreating}
                                        onClick={() => handleRemoveTag(index)}
                                    />
                                </div>
                            ))}

                            {tagError && (
                                <Field
                                    validationMessage={tagError}
                                    validationState="error"
                                    style={{ marginBottom: "8px" }}
                                />
                            )}

                            <Button
                                appearance="outline"
                                icon={<AddRegular fontSize={12} />}
                                size="small"
                                disabled={isCreating}
                                onClick={handleAddTag}
                                style={{
                                    paddingLeft: 0,
                                    paddingRight: 8,
                                    paddingTop: 2,
                                    paddingBottom: 2,
                                }}>
                                {Loc.azureSqlDatabase.addTag}
                            </Button>
                        </div>
                    </form>
                </div>
                <div
                    style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        gap: "8px",
                        paddingBottom: "16px",
                    }}>
                    <Button
                        appearance="primary"
                        onClick={() => handleSubmit()}
                        disabled={!isReadyToSubmit()}
                        icon={isCreating ? <Spinner size="tiny" /> : undefined}>
                        {isCreating
                            ? Loc.azureSqlDatabase.creatingResourceGroup
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
