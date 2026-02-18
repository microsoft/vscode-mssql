/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Image, Text } from "@fluentui/react-components";
import { ColorThemeKind } from "../../sharedInterfaces/webview";

interface DialogHeaderProps {
    iconLight: string;
    iconDark: string;
    title: string;
    themeKind?: ColorThemeKind;
}

export const DialogHeader = ({ iconLight, iconDark, title, themeKind }: DialogHeaderProps) => {
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
                src={themeKind === ColorThemeKind.Light ? iconLight : iconDark}
                alt={title}
                height={60}
                width={60}
            />
            <Text
                size={500}
                style={{
                    lineHeight: "60px",
                }}
                weight="medium">
                {title}
            </Text>
        </div>
    );
};
