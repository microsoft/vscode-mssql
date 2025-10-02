/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from "@fluentui/react-components";

export const stepPageStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        minWidth: "650px",
        minHeight: "fit-content",
        paddingBottom: "50px",
    },
    stepsDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        alignItems: "center",
        justifyContent: "center",
        height: "fit-content",
        width: "500px",
    },
    button: {
        height: "28px",
        width: "60px",
        marginTop: "20px",
    },
    stepsHeader: {
        fontSize: "24px",
        padding: "8px",
        alignItems: "unset",
        textAlign: "left",
    },
    stepsSubheader: {
        fontSize: "14px",
        alignItems: "unset",
        textAlign: "left",
        padding: "8px",
    },
    buttonDiv: {
        display: "flex",
        flexDirection: "row",
        justifyContent: "center",
        padding: "8px",
        gap: "5px",
    },
});
