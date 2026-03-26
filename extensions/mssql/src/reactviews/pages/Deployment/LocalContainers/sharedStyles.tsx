/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from "@fluentui/react-components";

export const stepPageStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        alignItems: "flex-start",
        justifyContent: "flex-start",
        width: "100%",
        minWidth: 0,
        minHeight: "fit-content",
        paddingBottom: "24px",
    },
    stepsDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "0",
        alignItems: "stretch",
        justifyContent: "flex-start",
        height: "fit-content",
        width: "100%",
        minWidth: 0,
    },
    button: {
        height: "28px",
        width: "60px",
        marginTop: "20px",
    },
    stepsHeader: {
        fontSize: "24px",
        padding: "0 0 8px",
        alignItems: "unset",
        textAlign: "left",
    },
    stepsSubheader: {
        fontSize: "14px",
        alignItems: "unset",
        textAlign: "left",
        padding: "0 0 16px",
    },
    buttonDiv: {
        display: "flex",
        flexDirection: "row",
        justifyContent: "center",
        padding: "8px",
        gap: "5px",
    },
});
