/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, createContext } from "react";
import { makeStyles } from "@fluentui/react-components";

// Define the context type
interface PublishProjectState {
    message?: string;
}

interface PublishProjectContextType {
    state: PublishProjectState;
}

// Create a typed context with a default value
const PublishProjectContext = createContext<PublishProjectContextType>({
    state: { message: undefined },
});

const useStyles = makeStyles({
    container: {
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
        padding: "20px",
    },
    message: {
        fontSize: "14px",
        color: "#333",
    },
});

export let PublishProjectPage = () => {
    const classes = useStyles();
    const context = useContext(PublishProjectContext);
    return (
        <div className={classes.container}>
            <h1>Publish Database Project</h1>
            <div className={classes.message}>
                {context.state.message || "Publish Project Dialog - Ready to configure"}
            </div>
        </div>
    );
};
