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
    Tooltip,
    makeStyles,
    shorthands,
} from "@fluentui/react-components";
import { Dismiss24Regular, InfoRegular } from "@fluentui/react-icons";
import { useContext, useState } from "react";
import { LocConstants } from "../../../common/locConstants";
import { PublishProjectContext } from "../publishProjectStateProvider";
import { usePublishDialogSelector } from "../publishDialogSelector";
import { useAccordionStyles } from "../../../common/styles";

const useStyles = makeStyles({
    optionsList: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
    },
    optionItem: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        ...shorthands.padding("4px", "0px"),
    },
    optionLabel: {
        flex: 1,
        cursor: "pointer",
    },
    infoIcon: {
        color: "var(--colorNeutralForeground3)",
        cursor: "help",
    },
});

export const AdvancedDeploymentOptionsDrawer = ({
    isAdvancedDrawerOpen,
    setIsAdvancedDrawerOpen,
}: {
    isAdvancedDrawerOpen: boolean;
    setIsAdvancedDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
    const classes = useStyles();
    const accordionStyles = useAccordionStyles();
    const context = useContext(PublishProjectContext);
    const [searchText, setSearchText] = useState<string>("");
    const [userOpenedSections, setUserOpenedSections] = useState<string[]>(["General"]);
    const loc = LocConstants.getInstance();

    // Get grouped options from state (prepared by controller)
    const optionGroups = usePublishDialogSelector((s) => s.groupedAdvancedOptions ?? []);

    const handleOptionChange = (optionName: string, checked: boolean) => {
        context?.updateDeploymentOption(optionName, checked);
    };

    // Helper to check if option matches search
    const isOptionVisible = (option: {
        key: string;
        displayName: string;
        description: string;
        value: boolean;
    }) => {
        if (!searchText) return true;

        const lowerSearch = searchText.toLowerCase();
        return (
            option.displayName.toLowerCase().includes(lowerSearch) ||
            option.key.toLowerCase().includes(lowerSearch) ||
            option.description.toLowerCase().includes(lowerSearch)
        );
    };

    // Render a single option (same for all groups)
    const renderOption = (option: {
        key: string;
        displayName: string;
        description: string;
        value: boolean;
    }) => {
        return (
            <div key={option.key} className={classes.optionItem}>
                <Checkbox
                    checked={option.value}
                    onChange={(_, data) => handleOptionChange(option.key, data.checked === true)}
                    label={
                        <span
                            className={classes.optionLabel}
                            onClick={() => handleOptionChange(option.key, !option.value)}>
                            {option.displayName}
                        </span>
                    }
                />
                {option.description && (
                    <Tooltip content={option.description} relationship="description">
                        <InfoRegular className={classes.infoIcon} />
                    </Tooltip>
                )}
            </div>
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
                    {loc.publishProject.advancedPublishSettings}
                </DrawerHeaderTitle>
            </DrawerHeader>

            <DrawerBody>
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
                    openItems={searchText ? optionGroups.map((g) => g.key) : userOpenedSections}>
                    {optionGroups.map((group) => (
                        <AccordionItem
                            key={group.key}
                            value={group.key}
                            className={accordionStyles.accordionItem}>
                            <AccordionHeader>{group.label}</AccordionHeader>
                            <AccordionPanel>
                                <div className={classes.optionsList}>
                                    {group.entries
                                        .filter((option) => isOptionVisible(option))
                                        .map((option) => renderOption(option))}
                                </div>
                            </AccordionPanel>
                        </AccordionItem>
                    ))}
                </Accordion>
            </DrawerBody>
        </OverlayDrawer>
    );
};
