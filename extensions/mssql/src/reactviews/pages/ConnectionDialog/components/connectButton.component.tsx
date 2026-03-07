/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    SplitButton,
    Spinner,
    Tooltip,
} from "@fluentui/react-components";
import { CSSProperties, MouseEvent, useContext } from "react";
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
}: {
    style?: CSSProperties;
    className?: string;
}) => {
    const context = useContext(ConnectionDialogContext);
    const connectionStatus = useConnectionDialogSelector((s) => s.connectionStatus);
    const connectionAction = useConnectionDialogSelector((s) => s.connectionAction);
    const readyToConnect = useConnectionDialogSelector((s) => s.readyToConnect);
    const testConnectionSucceeded = useConnectionDialogSelector((s) => s.testConnectionSucceeded);

    if (!context) {
        return undefined;
    }

    const buttonText =
        connectionStatus === ApiStatus.Loading
            ? connectionAction === ConnectionSubmitAction.TestConnection
                ? locConstants.connectionDialog.testing
                : locConstants.connectionDialog.connecting
            : locConstants.connectionDialog.connect;

    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
            }}>
            {testConnectionSucceeded && (
                <Tooltip
                    content={locConstants.connectionDialog.testConnectionSucceeded}
                    relationship="description">
                    <CheckmarkCircleRegular
                        style={{
                            color: "var(--vscode-testing-iconPassed, #73c991)",
                        }}
                    />
                </Tooltip>
            )}
            <Menu positioning="below-end">
                <MenuTrigger disableButtonEnhancement>
                    <SplitButton
                        id={ConnectButtonId}
                        type="button"
                        appearance="primary"
                        disabled={connectionStatus === ApiStatus.Loading || !readyToConnect}
                        className={className}
                        style={style}
                        iconPosition="after"
                        icon={
                            connectionStatus === ApiStatus.Loading ? (
                                <Spinner size="tiny" />
                            ) : undefined
                        }
                        menuButton={{
                            "aria-label": locConstants.connectionDialog.connectActions,
                        }}
                        onClick={(event: MouseEvent<HTMLElement>) => {
                            const target = event.target as HTMLElement;
                            if (target.closest('[aria-haspopup="menu"]')) {
                                return;
                            }

                            context.connect();
                        }}>
                        {buttonText}
                    </SplitButton>
                </MenuTrigger>
                <MenuPopover>
                    <MenuList>
                        <MenuItem
                            onClick={() => {
                                context.testConnection();
                            }}>
                            {locConstants.connectionDialog.testConnection}
                        </MenuItem>
                        <MenuItem
                            onClick={() => {
                                context.saveWithoutConnecting();
                            }}>
                            {locConstants.connectionDialog.saveWithoutConnecting}
                        </MenuItem>
                    </MenuList>
                </MenuPopover>
            </Menu>
        </div>
    );
};
