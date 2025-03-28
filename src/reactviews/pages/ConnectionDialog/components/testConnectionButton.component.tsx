/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button } from "@fluentui/react-components";
import { CSSProperties, useContext } from "react";
import { ConnectionDialogContext } from "../connectionDialogStateProvider";
import { locConstants } from "../../../common/locConstants";

export const TestConnectionButton = ({
    style,
    className,
}: {
    style?: CSSProperties;
    className?: string;
}) => {
    const connectionDialogContext = useContext(ConnectionDialogContext);

    if (!connectionDialogContext) {
        return undefined;
    }

    return (
        <Button
            onClick={(_event) => {
                // TODO: connectionDialogContext.testConnection();
            }}
            className={className}
            style={style}>
            {locConstants.connectionDialog.testConnection}
        </Button>
    );
};
