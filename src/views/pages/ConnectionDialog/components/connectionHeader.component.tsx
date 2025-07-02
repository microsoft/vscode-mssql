/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Image, Text } from "@fluentui/react-components";

import { ConnectionDialogContext } from "../connectionDialogStateProvider";
import { locConstants } from "../../../common/locConstants";
import { useContext } from "react";
import { ColorThemeKind } from "../../../../shared/webview";

const databaseIconLight = require("../../../../../media/database_light.svg");
const databaseIconDark = require("../../../../../media/database_dark.svg");

export const ConnectionHeader = () => {
    const connectionDialogContext = useContext(ConnectionDialogContext);
    return (
        <div
            style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
            }}>
            <Image
                style={{
                    padding: "10px",
                }}
                src={
                    connectionDialogContext?.themeKind === ColorThemeKind.Light
                        ? databaseIconLight
                        : databaseIconDark
                }
                alt={locConstants.connectionDialog.connectToDatabase}
                height={60}
                width={60}
            />
            <Text
                size={500}
                style={{
                    lineHeight: "60px",
                }}
                weight="medium">
                {locConstants.connectionDialog.connectToDatabase}
            </Text>
        </div>
    );
};
