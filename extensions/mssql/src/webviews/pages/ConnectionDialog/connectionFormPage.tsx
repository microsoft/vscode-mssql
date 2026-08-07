/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { makeStyles } from "@fluentui/react-components";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { useConnectionDialogSelector } from "./connectionDialogSelector";
import { FormField } from "../../common/forms/form.component";
import {
    ConnectionDialogContextProps,
    ConnectionDialogFormItemSpec,
    ConnectionDialogWebviewState,
    IConnectionDialogProfile,
} from "../../../sharedInterfaces/connectionDialog";

const useStyles = makeStyles({
    serverPortRow: {
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-start",
        gap: "5px",
    },
    serverField: {
        flexGrow: 1,
        minWidth: 0,
    },
    // Calculate off of fluent's 33% width label column
    serverFieldLabelAlign: {
        gridTemplateColumns: "calc(33% + 40px) 1fr",
    },
    portField: {
        flexShrink: 0,
    },
});

const PORT_INPUT_WIDTH = "72px"; // Width of the port input box. Narrow since it only holds a port number
const DEFAULT_PORT_PLACEHOLDER = "1433";

export const ConnectionFormPage = () => {
    const styles = useStyles();
    const context = useContext(ConnectionDialogContext);
    const mainOptions = useConnectionDialogSelector((s) => s.connectionComponents.mainOptions);
    const formComponents = useConnectionDialogSelector((s) => s.formComponents);
    const formState = useConnectionDialogSelector((s) => s.formState);

    if (context === undefined) {
        return undefined;
    }

    const renderFormField = (
        component: ConnectionDialogFormItemSpec,
        idx: number,
        opts?: {
            fieldClassName?: string;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            componentProps?: any;
        },
    ) => (
        <FormField<
            IConnectionDialogProfile,
            ConnectionDialogWebviewState,
            ConnectionDialogFormItemSpec,
            ConnectionDialogContextProps
        >
            key={idx}
            context={context}
            formState={formState}
            component={component}
            idx={idx}
            props={{ orientation: "horizontal", className: opts?.fieldClassName }}
            componentProps={opts?.componentProps}
        />
    );

    return (
        <div>
            {mainOptions.map((inputName, idx) => {
                // The port field is rendered inline to the right of the server field.
                if (inputName === "port") {
                    return undefined;
                }

                const component = formComponents[inputName as keyof IConnectionDialogProfile];
                if (component?.hidden !== false) {
                    return undefined;
                }

                if (inputName === "server") {
                    const portComponent = formComponents["port"];
                    if (portComponent?.hidden === false) {
                        return (
                            <div key={idx} className={styles.serverPortRow}>
                                <div className={styles.serverField}>
                                    {renderFormField(component, idx, {
                                        fieldClassName: styles.serverFieldLabelAlign,
                                    })}
                                </div>
                                <div className={styles.portField}>
                                    {renderFormField(portComponent, mainOptions.length, {
                                        componentProps: {
                                            placeholder: DEFAULT_PORT_PLACEHOLDER,
                                            style: {
                                                width: PORT_INPUT_WIDTH,
                                                minWidth: PORT_INPUT_WIDTH,
                                            },
                                        },
                                    })}
                                </div>
                            </div>
                        );
                    }
                }

                return renderFormField(component, idx);
            })}
        </div>
    );
};
