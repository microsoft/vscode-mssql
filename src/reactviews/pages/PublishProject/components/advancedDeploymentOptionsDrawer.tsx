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
    Checkbox,
    InfoLabel,
    makeStyles,
} from "@fluentui/react-components";
import { Dismiss24Regular } from "@fluentui/react-icons";
import React, { useState, useContext, useMemo, useEffect, useCallback } from "react";
import { LocConstants } from "../../../common/locConstants";
import { PublishProjectContext } from "../publishProjectStateProvider";
import { usePublishDialogSelector } from "../publishDialogSelector";
import { useAccordionStyles } from "../../../common/styles";

const useStyles = makeStyles({
    optionsList: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
    },
    drawerContent: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
    },
    scrollableContent: {
        flex: 1,
        overflow: "auto",
        paddingBottom: "16px",
    },
    stickyFooter: {
        position: "sticky",
        bottom: "0",
        backgroundColor: "var(--colorNeutralBackground1)",
        borderTop: "1px solid var(--colorNeutralStroke2)",
        padding: "16px 0",
        display: "flex",
        justifyContent: "flex-end",
        gap: "8px",
        marginTop: "auto",
    },
});

export const AdvancedDeploymentOptionsDrawer = ({
    isAdvancedDrawerOpen,
    setIsAdvancedDrawerOpen,
}: {
    isAdvancedDrawerOpen: boolean;
    setIsAdvancedDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
    const styles = useStyles();
    const accordionStyles = useAccordionStyles();
    const context = useContext(PublishProjectContext);
    const [searchText, setSearchText] = useState<string>("");
    const [userOpenedSections, setUserOpenedSections] = useState<string[]>(["General"]);
    const loc = LocConstants.getInstance();
    const state = usePublishDialogSelector((s) => s);
    const [localChanges, setLocalChanges] = useState<Array<{ optionName: string; value: boolean }>>(
        [],
    );

    // Clear local changes when deploymentOptions change (e.g., from profile loading)
    useEffect(() => {
        setLocalChanges([]);
    }, [state.deploymentOptions]);

    const getCurrentValue = useCallback(
        (optionName: string, baseValue: boolean): boolean => {
            const localChange = localChanges.find((change) => change.optionName === optionName);
            return localChange ? localChange.value : baseValue;
        },
        [localChanges],
    );

    // Create option groups from base deployment options, applying local changes
    const optionGroups = useMemo(() => {
        if (!state.deploymentOptions) return [];

        const groups: Array<{
            key: string;
            label: string;
            entries: Array<{
                key: string;
                displayName: string;
                description: string;
                value: boolean;
            }>;
        }> = [];

        // Process boolean options and split into General and Ignore groups
        if (state.deploymentOptions.booleanOptionsDictionary) {
            const allBooleanEntries = Object.entries(
                state.deploymentOptions.booleanOptionsDictionary,
            ).map(([key, option]) => ({
                key,
                displayName: option.displayName,
                description: option.description,
                value: getCurrentValue(key, option.value),
            }));

            const generalEntries = allBooleanEntries
                .filter((entry) => !entry.displayName.startsWith("Ignore"))
                .sort((a, b) => a.displayName.localeCompare(b.displayName));

            const ignoreEntries = allBooleanEntries
                .filter((entry) => entry.displayName.startsWith("Ignore"))
                .sort((a, b) => a.displayName.localeCompare(b.displayName));

            // Add General Options group
            if (generalEntries.length > 0) {
                groups.push({
                    key: "General",
                    label: loc.publishProject.generalOptions,
                    entries: generalEntries,
                });
            }

            // Add Ignore Options group
            if (ignoreEntries.length > 0) {
                groups.push({
                    key: "Ignore",
                    label: loc.publishProject.ignoreOptions,
                    entries: ignoreEntries,
                });
            }
        }

        // Exclude Object Types group
        if (state.deploymentOptions.objectTypesDictionary) {
            const baseExcludedTypes = state.deploymentOptions.excludeObjectTypes?.value || [];
            const excludeEntries = Object.entries(state.deploymentOptions.objectTypesDictionary)
                .map(([key, displayName]) => {
                    const baseExcluded = baseExcludedTypes.some(
                        (excludedType) => excludedType.toLowerCase() === key.toLowerCase(),
                    );

                    return {
                        key,
                        displayName: displayName || key,
                        description: "",
                        value: getCurrentValue(key, baseExcluded),
                    };
                })
                .filter((entry) => entry.displayName)
                .sort((a, b) => a.displayName.localeCompare(b.displayName));

            if (excludeEntries.length > 0) {
                groups.push({
                    key: "Exclude",
                    label: loc.publishProject.excludeObjectTypes,
                    entries: excludeEntries,
                });
            }
        }

        return groups;
    }, [state.deploymentOptions, getCurrentValue, loc]);

    // Options change handler, inserts and removes the changed option in localChanges
    const handleOptionChange = (optionName: string, checked: boolean) => {
        setLocalChanges((prev) => {
            const existingChange = prev.find((change) => change.optionName === optionName);
            if (existingChange) {
                return prev.filter((change) => change.optionName !== optionName);
            } else {
                return [...prev, { optionName, value: checked }];
            }
        });
    };

    const isResetDisabled = localChanges.length === 0;

    // Options reset handler, clears all local changes (reset to base deployment options)
    const handleReset = () => {
        setLocalChanges([]);
    };

    // Handle ok button click, Apply local changes and close drawer
    const handleOk = () => {
        if (!state.deploymentOptions || localChanges.length === 0) {
            setIsAdvancedDrawerOpen(false);
            return;
        }

        const updatedOptions = structuredClone(state.deploymentOptions);

        // Apply each local change to the deployment options
        localChanges.forEach(({ optionName, value }) => {
            // Case 1: Boolean deployment option
            if (updatedOptions.booleanOptionsDictionary?.[optionName]) {
                updatedOptions.booleanOptionsDictionary[optionName].value = value;
                return;
            }

            // Case 2: Exclude object type
            if (
                updatedOptions.objectTypesDictionary?.[optionName] &&
                updatedOptions.excludeObjectTypes
            ) {
                updateExcludedObjectTypes(
                    updatedOptions.excludeObjectTypes.value,
                    optionName,
                    value,
                );
            }
        });

        // Send updated options back to parent component
        context?.updateDeploymentOptions(updatedOptions);
        setIsAdvancedDrawerOpen(false);
    };

    // Add or remove object type from exclude objects exclusion list
    const updateExcludedObjectTypes = (
        excludedTypes: string[],
        optionName: string,
        shouldExclude: boolean,
    ) => {
        const isCurrentlyExcluded = excludedTypes.some(
            (type) => type.toLowerCase() === optionName.toLowerCase(),
        );

        if (shouldExclude && !isCurrentlyExcluded) {
            // Add to exclusion list
            excludedTypes.push(optionName);
        } else if (!shouldExclude && isCurrentlyExcluded) {
            // Remove from exclusion list
            const index = excludedTypes.findIndex(
                (type) => type.toLowerCase() === optionName.toLowerCase(),
            );
            if (index !== -1) {
                excludedTypes.splice(index, 1);
            }
        }
    };

    // Clear local changes and close drawer
    const handleCancel = () => {
        setLocalChanges([]);
        setIsAdvancedDrawerOpen(false);
    };

    const isOptionVisible = (option: {
        key: string;
        displayName: string;
        description: string;
        value: boolean;
    }) => {
        if (!searchText) return true;

        const lowerSearch = searchText.toLowerCase();
        return option.displayName.toLowerCase().includes(lowerSearch);
    };

    // Render a single option
    const renderOption = (option: {
        key: string;
        displayName: string;
        description: string;
        value: boolean;
    }) => {
        return (
            <Checkbox
                key={option.key}
                checked={option.value}
                onChange={(_, data) => handleOptionChange(option.key, data.checked === true)}
                label={
                    option.description ? (
                        <InfoLabel info={option.description}>{option.displayName}</InfoLabel>
                    ) : (
                        option.displayName
                    )
                }
            />
        );
    };

    if (!context) {
        return undefined;
    }

    return (
        <OverlayDrawer
            position="end"
            size="medium"
            open={isAdvancedDrawerOpen}
            onOpenChange={(_, { open }) => !open && handleCancel()}>
            <DrawerHeader>
                <DrawerHeaderTitle
                    action={
                        <Button
                            appearance="subtle"
                            aria-label="Close"
                            icon={<Dismiss24Regular />}
                            onClick={handleCancel}
                        />
                    }>
                    {loc.publishProject.advancedPublishSettings}
                </DrawerHeaderTitle>
            </DrawerHeader>

            <DrawerBody>
                <div className={styles.drawerContent}>
                    <div className={styles.scrollableContent}>
                        <SearchBox
                            size="medium"
                            style={{ width: "100%", maxWidth: "100%", marginBottom: "16px" }}
                            placeholder={loc.connectionDialog.searchSettings}
                            onChange={(_e, data) => setSearchText(data.value ?? "")}
                            value={searchText}
                        />

                        <Accordion
                            multiple
                            collapsible
                            onToggle={(_e, data) => {
                                if (!searchText) {
                                    setUserOpenedSections(data.openItems as string[]);
                                }
                            }}
                            openItems={
                                searchText ? optionGroups.map((g) => g.key) : userOpenedSections
                            }>
                            {optionGroups
                                .filter((group) =>
                                    group.entries.some((option) => isOptionVisible(option)),
                                )
                                .map((group) => (
                                    <AccordionItem
                                        key={group.key}
                                        value={group.key}
                                        className={accordionStyles.accordionItem}>
                                        <AccordionHeader>{group.label}</AccordionHeader>
                                        <AccordionPanel>
                                            <div className={styles.optionsList}>
                                                {group.entries
                                                    .filter((option) => isOptionVisible(option))
                                                    .map((option) => renderOption(option))}
                                            </div>
                                        </AccordionPanel>
                                    </AccordionItem>
                                ))}
                        </Accordion>
                    </div>

                    <div className={styles.stickyFooter}>
                        <Button
                            appearance="secondary"
                            onClick={handleReset}
                            disabled={isResetDisabled}>
                            {loc.schemaCompare.reset}
                        </Button>
                        <Button appearance="primary" onClick={handleOk}>
                            {loc.objectExplorerFiltering.ok}
                        </Button>
                    </div>
                </div>
            </DrawerBody>
        </OverlayDrawer>
    );
};
