/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Image, Text } from "@fluentui/react-components";

import { ColorThemeKind } from "../../../common/vscodeWebviewProvider";
import { ConnectionDialogContext } from "../connectionDialogStateProvider";
import { locConstants } from "../../../common/locConstants";
import { useContext } from "react";

const sqlServerImage = require("../../../../../media/sqlServer_light.svg");
const sqlServerImageDark = require("../../../../../media/sqlServer_dark.svg");

export const ConnectionHeader = () => {
    const connectionDialogContext = useContext(ConnectionDialogContext);
    return (
        <div
            style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
            }}
        >
            <Image
                style={{
                    padding: "10px",
                }}
                src={
                    connectionDialogContext?.themeKind === ColorThemeKind.Light
                        ? sqlServerImage
                        : sqlServerImageDark
                }
                alt="SQL Server"
                height={60}
                width={60}
            />
            <Text
                size={500}
                style={{
                    lineHeight: "60px",
                }}
                weight="medium"
            >
                {locConstants.connectionDialog.connectToSQLServer}
            </Text>
        </div>
    );
};
