/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import { themeType } from "../../common/utils";

const warning = require("./icons/overlay-warning.svg");
const criticalWarning = require("./icons/badge_critical_warning.svg");
const parallelismBadge = require("./icons/overlay-parallelism.svg");

export function getBadgePaths() {
    return {
        warning: warning,

        criticalWarning: criticalWarning,

        parallelism: parallelismBadge,
    };
}

export function getCollapseExpandPaths(colorTheme: ColorThemeKind) {
    const theme = themeType(colorTheme);
    return {
        expand:
            theme === "light"
                ? require("./icons/expand_light.svg")
                : require("./icons/expand_dark.svg"),

        collapse:
            theme === "light"
                ? require("./icons/collapse_light.svg")
                : require("./icons/collapse_dark.svg"),
    };
}
