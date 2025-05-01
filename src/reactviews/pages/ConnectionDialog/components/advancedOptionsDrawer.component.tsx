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
import { FormField } from "../../../common/forms/form.component";
import { ConnectionDialogContext } from "../connectionDialogStateProvider";
import {
    ConnectionComponentGroup,
    ConnectionDialogContextProps,
    ConnectionDialogFormItemSpec,
    ConnectionDialogWebviewState,
    IConnectionDialogProfile,
} from "../../../../sharedInterfaces/connectionDialog";

export const AdvancedOptionsDrawer = ({
    isAdvancedDrawerOpen,
    setIsAdvancedDrawerOpen,
}: {
    isAdvancedDrawerOpen: boolean;
    setIsAdvancedDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
    const context = useContext(ConnectionDialogContext);
    const [searchSettingsText, setSearchSettingText] = useState<string>("");
    const [userOpenedSections, setUserOpenedSections] = useState<string[]>(["General"]);

    if (context === undefined) {
        return undefined;
    }

    const doesGroupHaveVisibleOptions = (group: ConnectionComponentGroup) => {
        return group.options.some((optionName) => {
            if (context.state.formComponents[optionName]?.hidden === true) {
                return false;
            }
            if (searchSettingsText) {
                return optionName.toLowerCase().includes(searchSettingsText.toLowerCase());
            } else {
                return true;
            }
        });
    };

    const isOptionVisible = (optionName: keyof IConnectionDialogProfile) => {
        if (context.state.formComponents[optionName]?.hidden === true) {
            return false;
        }
        if (searchSettingsText) {
            return optionName.toLowerCase().includes(searchSettingsText.toLowerCase());
        } else {
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
                    {locConstants.connectionDialog.advancedConnectionSettings}
                </DrawerHeaderTitle>
            </DrawerHeader>

            <DrawerBody>
                <SearchBox
                    size="medium"
                    style={{ width: "100%", maxWidth: "100%" }}
                    placeholder={locConstants.connectionDialog.searchSettings}
                    onChange={(_e, data) => {
                        setSearchSettingText(data.value ?? "");
                    }}
                    value={searchSettingsText}
                />
                <div style={{ margin: "20px 0px" }}>
                    {context.state.connectionComponents.topAdvancedOptions
                        .filter((optionName) => isOptionVisible(optionName))
                        .map((optionName, idx) => {
                            return (
                                <FormField<
                                    IConnectionDialogProfile,
                                    ConnectionDialogWebviewState,
                                    ConnectionDialogFormItemSpec,
                                    ConnectionDialogContextProps
                                >
                                    key={idx}
                                    context={context}
                                    component={context.state.formComponents[optionName]!}
                                    idx={idx}
                                />
                            );
                        })}
                </div>
                <Accordion
                    multiple
                    collapsible
                    onToggle={(_e, data) => {
                        if (searchSettingsText) {
                            // We don't support expanding/collapsing sections when searching
                            return;
                        } else {
                            setUserOpenedSections(data.openItems as string[]);
                        }
                    }}
                    openItems={
                        /**
                         * If the user is searching, we keep all sections open
                         * If the user is not searching, we only open the sections that the user has opened
                         */
                        searchSettingsText
                            ? context.state.connectionComponents.groupedAdvancedOptions.map(
                                  (group) => group.groupName,
                              )
                            : userOpenedSections
                    }>
                    {context.state.connectionComponents.groupedAdvancedOptions
                        .filter((group) => doesGroupHaveVisibleOptions(group))
                        .map((group, groupIndex) => {
                            return (
                                <AccordionItem value={group.groupName} key={groupIndex}>
                                    <AccordionHeader>{group.groupName}</AccordionHeader>
                                    <AccordionPanel>
                                        {group.options
                                            .filter((optionName) => isOptionVisible(optionName))
                                            .map((optionName, idx) => {
                                                return (
                                                    <FormField<
                                                        IConnectionDialogProfile,
                                                        ConnectionDialogWebviewState,
                                                        ConnectionDialogFormItemSpec,
                                                        ConnectionDialogContextProps
                                                    >
                                                        key={idx}
                                                        context={context}
                                                        component={
                                                            context.state.formComponents[
                                                                optionName
                                                            ]!
                                                        }
                                                        idx={idx}
                                                    />
                                                );
                                            })}
                                    </AccordionPanel>
                                </AccordionItem>
                            );
                        })}
                </Accordion>
            </DrawerBody>
        </OverlayDrawer>
    );
};
