/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
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
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { FormField } from "../../common/forms/form.component";
import { FormItemSpec } from "../../common/forms/form";
import { IConnectionDialogProfile } from "../../../sharedInterfaces/connectionDialog";
import { ConnectButton } from "./connectButton";
import { locConstants } from "../../common/locConstants";

export const ConnectionFormPage = () => {
    const connectionDialogContext = useContext(ConnectionDialogContext);
    const [isAdvancedDrawerOpen, setIsAdvancedDrawerOpen] = useState(false);

    if (connectionDialogContext === undefined) {
        return undefined;
    }

    return (
        <div>
            {(connectionDialogContext.state.connectionComponents.mainOptions).map(
                (inputName, idx) => {
                    const component = connectionDialogContext.state.connectionComponents.components[inputName as keyof IConnectionDialogProfile];
                    if (component.hidden === true) {
                        return undefined;
                    }

                    return (
                        <FormField
                            key={idx}
                            context={connectionDialogContext}
                            component={component as FormItemSpec<IConnectionDialogProfile>}
                            idx={idx}
                            props={{ orientation: 'horizontal' }}
                        />
                    );
                }
            )}

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
                        {
                            connectionDialogContext.state.connectionComponents.topAdvancedOptions.map((optionName, idx) => {
                                return (
                                    <FormField
                                        key={idx}
                                        context={connectionDialogContext}
                                        component={connectionDialogContext.state.connectionComponents.components[optionName] as FormItemSpec<IConnectionDialogProfile>}
                                        idx={idx}
                                    />
                                );
                            })
                        }
                    </div>
                    <Accordion multiple collapsible>
                        {Object.keys(connectionDialogContext.state.connectionComponents.groupedAdvancedOptions).map((group, groupIndex) => {
                            return (
                                    <AccordionItem value={group} key={groupIndex}>
                                        <AccordionHeader>{group}</AccordionHeader>
                                            <AccordionPanel>
                                                {connectionDialogContext.state.connectionComponents.groupedAdvancedOptions[group].map((optionName, idx) => {
                                                if (connectionDialogContext.state.connectionComponents.components[optionName].hidden === true) {
                                                    return undefined;
                                                }
                                                return (
                                                    <FormField
                                                        key={idx}
                                                        context={connectionDialogContext}
                                                        component={connectionDialogContext.state.connectionComponents.components[optionName] as FormItemSpec<IConnectionDialogProfile>}
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
            <div style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
            }}>
                <Button
                    shape="square"
                    onClick={(_event) => {
                        setIsAdvancedDrawerOpen(!isAdvancedDrawerOpen);
                    }}
                    style={{
                        width: "150px",
                        alignSelf: "center",
                        margin: "0px 10px",
                    }}
                >
                    {locConstants.connectionDialog.advancedSettings}
                </Button>
                <div style={{ display: "flex", marginLeft: "auto" }}>
                <Button
                    shape="square"
                    onClick={(_event) => {
                        // TODO: connectionDialogContext.testConnection();
                    }}
                    style={{
                        width: "150px",
                        alignSelf: "center",
                        margin: "0px 10px",
                    }}
                >
                    {locConstants.connectionDialog.testConnection}
                </Button>
                <ConnectButton />
                </div>
            </div>
        </div>
    );
};
