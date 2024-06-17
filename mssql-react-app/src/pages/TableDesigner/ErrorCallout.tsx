import { Callout, DefaultButton, IconButton, Stack } from "@fluentui/react"
import { useBoolean, useId } from "@fluentui/react-hooks";
import { useContext } from "react";
import { TableDesignerContext } from "./TableDesignerStateProvider";
import { DesignerPropertyPath } from "./tableDesignerInterfaces";

export type errorCalloutProps = {
    componentPath?: DesignerPropertyPath,
    message: string
}
export const ErrorCallout = ({ componentPath, message }: errorCalloutProps) => {
    const [isCalloutVisible, { toggle: toggleIsCalloutVisible }] = useBoolean(false);
	const state = useContext(TableDesignerContext);
    let iconButtonId: string | undefined = useId('errorButton');
    if(componentPath){
        iconButtonId = state?.provider.getComponentId(componentPath);
    }
    const descriptionId: string = useId('description');

    return <Stack>
        <IconButton
            id={iconButtonId}
            iconProps={{
                iconName: 'ErrorBadge',
                style: { color: 'red' }
            }}
            title={message}
            ariaLabel= {message}
            onClick={toggleIsCalloutVisible}
            styles={{
                root: { marginBottom: -3 }
            }}
        />
        {isCalloutVisible && <Callout
            target={'#' + iconButtonId}
            setInitialFocus
            onDismiss={toggleIsCalloutVisible}
            ariaDescribedBy={descriptionId}
            role="alertdialog"
        >
            <Stack tokens={{
                childrenGap: 4,
                maxWidth: 300,
            }} horizontalAlign="start" styles={{
                root: { padding: 20 }
            }}>
                <span id={descriptionId}>{message}</span>
                <DefaultButton onClick={toggleIsCalloutVisible}>Close</DefaultButton>
            </Stack>
        </Callout>}
    </Stack>

}
