/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Accordion,
    AccordionHeader,
    AccordionItem,
    AccordionPanel,
    Button,
    DrawerBody,
    DrawerHeader,
    DrawerHeaderTitle,
    OverlayDrawer,
    SearchBox,
} from "@fluentui/react-components";
import { Dismiss24Regular } from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
import { useContext, useState } from "react";
import { FormFieldNoState } from "../../../common/forms/form.component";
import { useAccordionStyles } from "../../../common/styles";
import { BackupDatabaseContext, BackupDatabaseContextProps } from "./backupDatabaseStateProvider";
import { BackupDatabaseViewModel, BackupType, MediaSet } from "../../../../sharedInterfaces/backup";
import {
    ObjectManagementFormItemSpec,
    ObjectManagementFormState,
    ObjectManagementWebviewState,
} from "../../../../sharedInterfaces/objectManagement";
import { useBackupDatabaseSelector } from "./backupDatabaseSelector";

export const AdvancedOptionsDrawer = ({
    isAdvancedDrawerOpen,
    setIsAdvancedDrawerOpen,
}: {
    isAdvancedDrawerOpen: boolean;
    setIsAdvancedDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
    const context = useContext(BackupDatabaseContext);
    const viewModel = useBackupDatabaseSelector((s) => s.viewModel);
    const formComponents = useBackupDatabaseSelector((s) => s.formComponents);
    const formState = useBackupDatabaseSelector((s) => s.formState);

    if (!context || !viewModel) {
        return;
    }

    const [searchSettingsText, setSearchSettingText] = useState<string>("");
    const [userOpenedSections, setUserOpenedSections] = useState<string[]>([]);
    const accordionStyles = useAccordionStyles();

    const backupViewModel = viewModel.model as BackupDatabaseViewModel;

    const advancedOptionsByGroup: Record<string, ObjectManagementFormItemSpec[]> = Object.values(
        formComponents,
    )
        .filter((component): component is ObjectManagementFormItemSpec =>
            Boolean(component && component.isAdvancedOption),
        )
        .reduce(
            (acc, component) => {
                const group = component.groupName ?? locConstants.common.general;
                if (!acc[group]) {
                    acc[group] = [];
                }
                acc[group].push(component);
                return acc;
            },
            {} as Record<string, ObjectManagementFormItemSpec[]>,
        );

    function isOptionVisible(option: ObjectManagementFormItemSpec) {
        if (searchSettingsText) {
            return (
                option.label.toLowerCase().includes(searchSettingsText.toLowerCase()) ||
                option.propertyName.toLowerCase().includes(searchSettingsText.toLowerCase())
            );
        } else {
            return true;
        }
    }

    const shouldShowGroup = (groupName: string): boolean => {
        switch (groupName) {
            case locConstants.backupDatabase.transactionLog:
                return formState.backupType === BackupType.TransactionLog;
            case locConstants.backupDatabase.encryption:
                return backupViewModel.backupEncryptors.length > 0;
            default:
                return true;
        }
    };

    const shouldShowComponent = (componentName: string): boolean => {
        switch (componentName) {
            case "mediaSetName":
            case "mediaSetDescription":
                return formState.mediaSet == MediaSet.Create;
            case "encryptionAlgorithm":
            case "encryptorName":
                return formState.encryptionEnabled;
            default:
                return true;
        }
    };

    return (
        <OverlayDrawer
            position="end"
            size="medium"
            open={isAdvancedDrawerOpen}
            onOpenChange={(_, { open }) => setIsAdvancedDrawerOpen(open)}>
            <DrawerHeader>
                <DrawerHeaderTitle
                    action={
                        <Button
                            appearance="subtle"
                            aria-label="Close"
                            icon={<Dismiss24Regular />}
                            onClick={() => setIsAdvancedDrawerOpen(false)}
                        />
                    }>
                    {locConstants.backupDatabase.advancedBackupOptions}
                </DrawerHeaderTitle>
            </DrawerHeader>

            <DrawerBody>
                <SearchBox
                    size="medium"
                    style={{ width: "100%", maxWidth: "100%" }}
                    placeholder={locConstants.backupDatabase.searchOptions}
                    onChange={(_e, data) => {
                        setSearchSettingText(data.value ?? "");
                    }}
                    value={searchSettingsText}
                />
                <Accordion
                    multiple
                    collapsible
                    onToggle={(_e, data) => {
                        if (searchSettingsText) {
                            return;
                        } else {
                            setUserOpenedSections(data.openItems as string[]);
                        }
                    }}
                    openItems={
                        searchSettingsText
                            ? Object.keys(advancedOptionsByGroup)
                            : userOpenedSections
                    }>
                    {Object.entries(advancedOptionsByGroup)
                        .filter(([_advancedGroupName, options]) =>
                            options.some((option) => isOptionVisible(option)),
                        )
                        .map(
                            ([advancedGroupName, options], groupIndex) =>
                                shouldShowGroup(advancedGroupName) && (
                                    <AccordionItem
                                        value={advancedGroupName}
                                        key={groupIndex}
                                        className={accordionStyles.accordionItem}>
                                        <AccordionHeader>{advancedGroupName}</AccordionHeader>
                                        <AccordionPanel>
                                            {options
                                                .filter((option) => isOptionVisible(option))
                                                .map(
                                                    (option, idx) =>
                                                        shouldShowComponent(
                                                            option.propertyName,
                                                        ) && (
                                                            <FormFieldNoState<
                                                                ObjectManagementFormState,
                                                                ObjectManagementWebviewState,
                                                                ObjectManagementFormItemSpec,
                                                                BackupDatabaseContextProps
                                                            >
                                                                key={idx}
                                                                context={context}
                                                                formState={formState}
                                                                component={option}
                                                                props={option.componentProps ?? {}}
                                                                idx={idx}
                                                            />
                                                        ),
                                                )}
                                        </AccordionPanel>
                                    </AccordionItem>
                                ),
                        )}
                </Accordion>
            </DrawerBody>
        </OverlayDrawer>
    );
};
