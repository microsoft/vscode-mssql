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
} from "@fluentui/react-components";
import { Dismiss24Regular } from "@fluentui/react-icons";

import { locConstants } from "../../../common/locConstants";
import { useContext } from "react";
import { FormField } from "../../../common/forms/form.component";
import { ConnectionDialogContext } from "../connectionDialogStateProvider";
import { FormItemSpec } from "../../../common/forms/form";
import { IConnectionDialogProfile } from "../../../../sharedInterfaces/connectionDialog";

export const AdvancedOptionsDrawer = ({
    isAdvancedDrawerOpen,
    setIsAdvancedDrawerOpen,
}: {
    isAdvancedDrawerOpen: boolean;
    setIsAdvancedDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
    const context = useContext(ConnectionDialogContext);

    if (context === undefined) {
        return undefined;
    }

    return (
        <OverlayDrawer
            position="end"
            size="medium"
            open={isAdvancedDrawerOpen}
            onOpenChange={(_, { open }) => setIsAdvancedDrawerOpen(open)}
        >
            <DrawerHeader>
                <DrawerHeaderTitle
                    action={
                        <Button
                            appearance="subtle"
                            aria-label="Close"
                            icon={<Dismiss24Regular />}
                            onClick={() => setIsAdvancedDrawerOpen(false)}
                        />
                    }
                >
                    {locConstants.connectionDialog.advancedConnectionSettings}
                </DrawerHeaderTitle>
            </DrawerHeader>

            <DrawerBody>
                <div style={{ margin: "20px 0px" }}>
                    {context.state.connectionComponents.topAdvancedOptions.map(
                        (optionName, idx) => {
                            return (
                                <FormField
                                    key={idx}
                                    context={context}
                                    component={
                                        context.state.connectionComponents
                                            .components[
                                            optionName
                                        ] as FormItemSpec<IConnectionDialogProfile>
                                    }
                                    idx={idx}
                                />
                            );
                        },
                    )}
                </div>
                <Accordion multiple collapsible>
                    {context.state.connectionComponents.groupedAdvancedOptions.map(
                        (group, groupIndex) => {
                            return (
                                <AccordionItem
                                    value={group.groupName}
                                    key={groupIndex}
                                >
                                    <AccordionHeader>
                                        {group.groupName}
                                    </AccordionHeader>
                                    <AccordionPanel>
                                        {group.options.map(
                                            (optionName, idx) => {
                                                if (
                                                    context.state
                                                        .connectionComponents
                                                        .components[optionName]
                                                        ?.hidden === true
                                                ) {
                                                    return undefined;
                                                }
                                                return (
                                                    <FormField
                                                        key={idx}
                                                        context={context}
                                                        component={
                                                            context.state
                                                                .connectionComponents
                                                                .components[
                                                                optionName
                                                            ] as FormItemSpec<IConnectionDialogProfile>
                                                        }
                                                        idx={idx}
                                                    />
                                                );
                                            },
                                        )}
                                    </AccordionPanel>
                                </AccordionItem>
                            );
                        },
                    )}
                </Accordion>
            </DrawerBody>
        </OverlayDrawer>
    );
};
