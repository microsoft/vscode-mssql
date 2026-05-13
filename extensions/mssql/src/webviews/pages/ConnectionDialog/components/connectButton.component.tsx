/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    SplitButton,
    Spinner,
    Tooltip,
} from "@fluentui/react-components";
import { CSSProperties, MouseEvent, useContext, useState } from "react";
import { CheckmarkCircleRegular } from "@fluentui/react-icons";
import { ConnectionDialogContext } from "./../connectionDialogStateProvider";
import { useConnectionDialogSelector } from "../connectionDialogSelector";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { ConnectionSubmitAction } from "../../../../sharedInterfaces/connectionDialog";
import { locConstants } from "../../../common/locConstants";

export const ConnectButtonId = "connectButton";

export const ConnectButton = ({
    style,
    className,
    form,
}: {
    style?: CSSProperties;
    className?: string;
    form?: string;
}) => {
    const context = useContext(ConnectionDialogContext);
    const connectionStatus = useConnectionDialogSelector((s) => s.connectionStatus);
    const connectionAction = useConnectionDialogSelector((s) => s.connectionAction);
    const readyToConnect = useConnectionDialogSelector((s) => s.readyToConnect);
    const testConnectionSucceeded = useConnectionDialogSelector((s) => s.testConnectionSucceeded);
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    if (!context) {
        return undefined;
    }

    const isLoading = connectionStatus === ApiStatus.Loading;
    const isTesting = isLoading && connectionAction === ConnectionSubmitAction.TestConnection;

    const connectButtonText =
        isLoading && !isTesting
            ? locConstants.connectionDialog.connecting
            : locConstants.connectionDialog.connect;

    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
            }}>
            {isLoading ? (
                <Spinner size="tiny" />
            ) : testConnectionSucceeded ? (
                <Tooltip
                    content={locConstants.connectionDialog.testConnectionSucceeded}
                    relationship="description">
                    <CheckmarkCircleRegular
                        style={{
                            color: "var(--vscode-testing-iconPassed, #73c991)",
                            fontSize: "20px",
                        }}
                    />
                </Tooltip>
            ) : undefined}
            <Tooltip
                content={locConstants.connectionDialog.testConnectionTooltip}
                relationship="description">
                <Button
                    appearance="secondary"
                    disabled={isLoading || !readyToConnect}
                    onClick={() => context.testConnection()}>
                    {isTesting
                        ? locConstants.connectionDialog.testing
                        : locConstants.connectionDialog.testConnection}
                </Button>
            </Tooltip>
            <Menu
                positioning="below-end"
                open={isMenuOpen}
                onOpenChange={(_event, data) => {
                    setIsMenuOpen(data.open);
                }}>
                <MenuTrigger disableButtonEnhancement>
                    <Tooltip
                        content={locConstants.connectionDialog.connectTooltip}
                        relationship="description"
                        positioning="above-start">
                        <SplitButton
                            type="button"
                            appearance="primary"
                            disabled={isLoading || !readyToConnect}
                            className={className}
                            style={style}
                            iconPosition="after"
                            icon={undefined}
                            menuButton={{
                                "aria-label": locConstants.connectionDialog.connectActions,
                            }}
                            primaryActionButton={{
                                id: ConnectButtonId,
                                type: form ? "submit" : "button",
                                form,
                                onClick: (event: MouseEvent<HTMLButtonElement>) => {
                                    event.stopPropagation();
                                    setIsMenuOpen(false);
                                    if (!form) {
                                        context.connect();
                                    }
                                },
                            }}>
                            {connectButtonText}
                        </SplitButton>
                    </Tooltip>
                </MenuTrigger>
                <MenuPopover>
                    <MenuList>
                        <Tooltip
                            content={locConstants.connectionDialog.saveWithoutConnectingTooltip}
                            relationship="description"
                            positioning="before">
                            <MenuItem
                                onClick={() => {
                                    context.saveWithoutConnecting();
                                }}>
                                {locConstants.connectionDialog.saveWithoutConnecting}
                            </MenuItem>
                        </Tooltip>
                    </MenuList>
                </MenuPopover>
            </Menu>
        </div>
    );
};
