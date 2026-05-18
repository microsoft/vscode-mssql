/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useRef, useState } from "react";
import {
    Button,
    Card,
    DrawerBody,
    DrawerHeader,
    DrawerHeaderTitle,
    Input,
    Label,
    OverlayDrawer,
} from "@fluentui/react-components";
import {
    AddRegular,
    CheckmarkCircleFilled,
    DeleteRegular,
    Dismiss24Regular,
} from "@fluentui/react-icons";
import { FormField, useFormStyles } from "../../../common/forms/form.component";
import { locConstants as Loc } from "../../../common/locConstants";
import {
    AzureSqlDatabaseContextProps,
    AzureSqlDatabaseFormItemSpec,
    AzureSqlDatabaseFormState,
    AzureSqlDatabaseState,
} from "../../../../sharedInterfaces/azureSqlDatabase";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { hasDuplicateTagKeys, TagEntry } from "./azureSqlDatabaseDeploymentWizard";

export const AdvancedOptionsDrawer = ({
    open,
    onClose,
    context,
    formState,
    formComponents,
    azureComponentStatuses,
    hostIp,
    tags,
    onTagsChange,
}: {
    open: boolean;
    onClose: () => void;
    context: AzureSqlDatabaseContextProps;
    formState: AzureSqlDatabaseFormState;
    formComponents: Partial<Record<keyof AzureSqlDatabaseFormState, AzureSqlDatabaseFormItemSpec>>;
    azureComponentStatuses: Record<string, ApiStatus>;
    hostIp: string;
    tags: TagEntry[];
    onTagsChange: (tags: TagEntry[]) => void;
}) => {
    const formStyles = useFormStyles();
    const [tagError, setTagError] = useState<string | undefined>(undefined);
    const tagIdCounter = useRef(0);

    const advancedComponents = Object.values(formComponents).filter(
        (component): component is AzureSqlDatabaseFormItemSpec =>
            !!component && !!component.isAdvancedOption,
    );

    // Map component property names to their loading text
    const loadingTextMap: Record<string, string> = {
        maintenanceConfig: Loc.azureSqlDatabase.loadingMaintenanceConfigs,
    };

    // Compute derived components with loading state instead of mutating originals
    const derivedAdvancedComponents = advancedComponents.map((component) => {
        const status = azureComponentStatuses[component.propertyName];
        if (status === undefined) {
            return component;
        }
        const isLoading = status === ApiStatus.Loading || status === ApiStatus.NotStarted;
        return {
            ...component,
            loadStatus: { status: isLoading ? ApiStatus.Loading : ApiStatus.Loaded },
            ...(isLoading && {
                placeholder: loadingTextMap[component.propertyName] ?? component.placeholder,
            }),
        };
    });

    const handleAddTag = () => {
        setTagError(undefined);
        onTagsChange([...tags, { id: tagIdCounter.current++, key: "", value: "" }]);
    };

    const handleRemoveTag = (index: number) => {
        setTagError(undefined);
        onTagsChange(tags.filter((_, i) => i !== index));
    };

    const handleTagChange = (index: number, field: "key" | "value", newValue: string) => {
        setTagError(undefined);
        const updated = tags.map((tag, i) => (i === index ? { ...tag, [field]: newValue } : tag));

        // Validate for duplicate keys
        if (hasDuplicateTagKeys(updated)) {
            setTagError(Loc.azureSqlDatabase.duplicateTagKeys);
        }

        onTagsChange(updated);
    };

    return (
        <OverlayDrawer
            position="end"
            size="medium"
            open={open}
            onOpenChange={(_, { open }) => {
                if (!open) {
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
                        />
                    }>
                    {Loc.azureSqlDatabase.advanced}
                </DrawerHeaderTitle>
            </DrawerHeader>

            <DrawerBody style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ flex: 1 }} className={formStyles.formComponentDiv}>
                    <div>
                        <Label weight="semibold" style={{ marginBottom: "8px", display: "block" }}>
                            {Loc.azureSqlDatabase.firewall}
                        </Label>
                        <Card
                            style={{
                                display: "flex",
                                flexDirection: "row",
                                alignItems: "center",
                                backgroundColor: "var(--colorStatusSuccessBackground1)",
                                borderLeft: "3px solid var(--colorStatusSuccessForeground1)",
                                padding: "10px 12px",
                                gap: "10px",
                                marginLeft: "2px",
                            }}>
                            <CheckmarkCircleFilled
                                style={{
                                    color: "var(--colorStatusSuccessForeground1)",
                                    fontSize: "20px",
                                    flexShrink: 0,
                                }}
                            />
                            <span>{Loc.azureSqlDatabase.firewallDescription(hostIp)}</span>
                        </Card>
                    </div>
                    {derivedAdvancedComponents.map((component, idx) => (
                        <div
                            key={component.propertyName}
                            style={{ width: component.componentWidth || "100%" }}>
                            <FormField<
                                AzureSqlDatabaseFormState,
                                AzureSqlDatabaseState,
                                AzureSqlDatabaseFormItemSpec,
                                AzureSqlDatabaseContextProps
                            >
                                context={context}
                                formState={formState}
                                component={component}
                                idx={idx}
                            />
                        </div>
                    ))}

                    {/* Tags section */}
                    <div style={{ margin: "5px", marginLeft: "10px" }}>
                        <Label weight="semibold" style={{ marginBottom: "8px", display: "block" }}>
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
                                    onChange={(_, data) =>
                                        handleTagChange(index, "key", data.value)
                                    }
                                />
                                <Input
                                    style={{ flex: 1 }}
                                    size="small"
                                    placeholder={Loc.azureSqlDatabase.tagValuePlaceholder}
                                    value={tag.value}
                                    onChange={(_, data) =>
                                        handleTagChange(index, "value", data.value)
                                    }
                                />
                                <Button
                                    appearance="subtle"
                                    icon={<DeleteRegular />}
                                    size="small"
                                    aria-label={Loc.azureSqlDatabase.removeTag}
                                    onClick={() => handleRemoveTag(index)}
                                />
                            </div>
                        ))}

                        {tagError && (
                            <Label
                                style={{
                                    color: "var(--vscode-errorForeground)",
                                    fontSize: "12px",
                                }}>
                                {tagError}
                            </Label>
                        )}

                        <Button
                            appearance="outline"
                            icon={<AddRegular fontSize={12} />}
                            size="small"
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
                </div>
                <div
                    style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        gap: "8px",
                        paddingBottom: "16px",
                    }}>
                    <Button appearance="secondary" onClick={onClose}>
                        {Loc.common.close}
                    </Button>
                </div>
            </DrawerBody>
        </OverlayDrawer>
    );
};
