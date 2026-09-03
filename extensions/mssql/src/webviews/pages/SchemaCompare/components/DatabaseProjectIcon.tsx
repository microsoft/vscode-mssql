/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ColorThemeKind } from "../../../../sharedInterfaces/webview";
import {
    SchemaCompareReducers,
    SchemaCompareWebViewState,
} from "../../../../sharedInterfaces/schemaCompare";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";

const databaseProjectIconLight = require("../../../../../images/databaseProjects/light/databaseProject.svg");
const databaseProjectIconDark = require("../../../../../images/databaseProjects/dark/databaseProject.svg");

interface Props {
    className?: string;
}

export const DatabaseProjectIcon = ({ className }: Props) => {
    const { themeKind } = useVscodeWebview<SchemaCompareWebViewState, SchemaCompareReducers>();
    const isLightTheme =
        themeKind === ColorThemeKind.Light || themeKind === ColorThemeKind.HighContrastLight;

    return (
        <img
            className={className}
            src={isLightTheme ? databaseProjectIconLight : databaseProjectIconDark}
            alt=""
            aria-hidden="true"
        />
    );
};
