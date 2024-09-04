/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import {
    Button,
    Divider,
    DrawerBody,
    DrawerHeader,
    DrawerHeaderTitle,
    MessageBar,
    OverlayDrawer,
    Spinner,
} from "@fluentui/react-components";
import { Dismiss24Regular } from "@fluentui/react-icons";

import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { FormField, useFormStyles } from "../../common/forms/form.component";
import { ApiStatus } from "../../../sharedInterfaces/webview";

export const ConnectionFormPage = () => {
    const connectionDialogContext = useContext(ConnectionDialogContext);
    const formStyles = useFormStyles();
    const [isAdvancedDrawerOpen, setIsAdvancedDrawerOpen] = useState(false);

    if (connectionDialogContext === undefined) {
        return undefined;
    }

    return (
        <div className={formStyles.formDiv}>
            {connectionDialogContext?.state.formError && (
                <MessageBar intent="error">
                    {connectionDialogContext.state.formError}
                </MessageBar>
            )}
            {connectionDialogContext.state.connectionFormComponents.mainComponents.map(
                (component, idx) => {
                    if (component.hidden === true) {
                        return undefined;
                    }
                    return (
                        <FormField
                            key={idx}
                            context={connectionDialogContext}
                            component={component}
                            idx={idx}
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
                        Advanced Connection Settings
                    </DrawerHeaderTitle>
                </DrawerHeader>

                <DrawerBody>
                    {Object.keys(
                        connectionDialogContext.state.connectionFormComponents
                            .advancedComponents
                    ).map((group, groupIndex) => {
                        return (
                            <div key={groupIndex} style={{ margin: "20px 0px" }}>
                                <Divider>{group}</Divider>
                                {connectionDialogContext.state.connectionFormComponents.advancedComponents[
                                    group
                                ].map((component, idx) => {
                                    if (component.hidden === true) {
                                        return undefined;
                                    }
                                    return (
                                        <FormField
                                            key={idx}
                                            context={connectionDialogContext}
                                            component={component}
                                            idx={idx}
                                        />
                                    );
                                })}
                            </div>
                        );
                    })}
                </DrawerBody>
            </OverlayDrawer>
            <Button
                shape="square"
                onClick={(_event) => {
                    setIsAdvancedDrawerOpen(!isAdvancedDrawerOpen);
                }}
                style={{
                    width: "200px",
                    alignSelf: "center",
                }}
            >
                Advanced
            </Button>
            <Button
                appearance="primary"
                disabled={
                    connectionDialogContext.state.connectionStatus === ApiStatus.Loading
                }
                shape="square"
                onClick={(_event) => {
                    connectionDialogContext.connect();
                }}
                style={{
                    width: "200px",
                    alignSelf: "center",
                }}
                iconPosition="after"
                icon={
                    connectionDialogContext.state.connectionStatus ===
                        ApiStatus.Loading ? (
                        <Spinner size="tiny" />
                    ) : undefined
                }
            >
                Connect
            </Button>
        </div>
    );
};
