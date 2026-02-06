/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Spinner } from "@fluentui/react-components";
import { CSSProperties } from "react";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { locConstants } from "../../../common/locConstants";
import { useConnectionDialogSelector } from "../connectionDialogSelector";

export const ConnectButtonId = "connectButton";

export const ConnectButton = ({
    style,
    className,
}: {
    style?: CSSProperties;
    className?: string;
}) => {
    // Narrow selectors: only re-render when these 2 fields change
    const connectionStatus = useConnectionDialogSelector((s) => s.connectionStatus);
    const readyToConnect = useConnectionDialogSelector((s) => s.readyToConnect);

    return (
        <Button
            id={ConnectButtonId}
            type="submit"
            appearance="primary"
            disabled={
                connectionStatus === ApiStatus.Loading ||
                !readyToConnect
            }
            className={className}
            style={style}
            iconPosition="after"
            icon={
                connectionStatus === ApiStatus.Loading ? (
                    <Spinner size="tiny" />
                ) : undefined
            }>
            {locConstants.connectionDialog.connect}
        </Button>
    );
};
