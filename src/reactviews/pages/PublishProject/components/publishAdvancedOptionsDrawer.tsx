/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Accordion,
    AccordionHeader,
    AccordionItem,
    AccordionPanel,
    Button,
    Checkbox,
    DrawerBody,
    DrawerHeader,
    DrawerHeaderTitle,
    InfoLabel,
    OverlayDrawer,
    SearchBox,
    makeStyles,
} from "@fluentui/react-components";
import { Dismiss24Regular } from "@fluentui/react-icons";
import { useContext, useState } from "react";
import { FormField } from "../../../common/forms/form.component";
import { PublishProjectContext } from "../publishProjectStateProvider";
import {
    IPublishForm,
    PublishDialogFormItemSpec,
    PublishDialogWebviewState,
} from "../../../../sharedInterfaces/publishDialog";
import { FormContextProps } from "../../../../sharedInterfaces/form";
import { locConstants } from "../../../common/locConstants";
import { useAccordionStyles } from "../../../common/styles";

const useStyles = makeStyles({
    checkboxRow: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: "8px",
        width: "100%",
        // Target fluent checkbox root
        '> div[role="checkbox"]': {
            flex: "0 0 auto",
            marginLeft: "4px",
        },
        ".checkboxLabel": {
            flex: 1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
    },
    searchBox: {
        width: "100%",
        margin: "4px 0 8px 0",
        "> div": {
            width: "100%",
        },
    },
});

type AdvancedOptionGroup = { groupName?: string; options: (keyof IPublishForm)[] };

export const PublishAdvancedOptionsDrawer = ({
    isOpen,
    onDismiss,
}: {
    isOpen: boolean;
    onDismiss: () => void;
}) => {
    const context = useContext(PublishProjectContext) as
        | FormContextProps<IPublishForm, PublishDialogWebviewState, PublishDialogFormItemSpec>
        | undefined;
    const [searchSettingsText, setSearchSettingsText] = useState<string>("");
    const [userOpenedSections, setUserOpenedSections] = useState<string[]>([]);
    const accordionStyles = useAccordionStyles();
    const styles = useStyles();

    if (!context || !context.state) {
        return undefined;
    }

    const groupedOptions: AdvancedOptionGroup[] =
        context.state.connectionComponents?.groupedAdvancedOptions ?? [];

    const isOptionVisible = (option: PublishDialogFormItemSpec) => {
        if (!searchSettingsText) {
            return true;
        }
        const text = searchSettingsText.toLowerCase();
        return (
            option.label.toLowerCase().includes(text) ||
            String(option.propertyName).toLowerCase().includes(text)
        );
    };

    const doesGroupHaveVisibleOptions = (group: AdvancedOptionGroup) =>
        group.options.some((name) =>
            isOptionVisible(context.state.formComponents[name] as PublishDialogFormItemSpec),
        );

    return (
        <OverlayDrawer
            position="end"
            size="medium"
            open={isOpen}
            onOpenChange={(_, { open }) => !open && onDismiss()}>
            <DrawerHeader>
                <DrawerHeaderTitle
                    action={
                        <Button
                            appearance="subtle"
                            aria-label="Close"
                            icon={<Dismiss24Regular />}
                            onClick={() => onDismiss()}
                        />
                    }>
                    {locConstants.publishProject.advancedOptions}
                </DrawerHeaderTitle>
            </DrawerHeader>
            <DrawerBody>
                <div className={styles.searchBox}>
                    <SearchBox
                        size="medium"
                        style={{ width: "100%", maxWidth: "100%" }}
                        placeholder={locConstants.connectionDialog.searchSettings}
                        onChange={(_e, data) => setSearchSettingsText(data.value ?? "")}
                        value={searchSettingsText}
                    />
                </div>
                <Accordion
                    multiple
                    collapsible
                    onToggle={(_e, data) => {
                        if (!searchSettingsText) {
                            setUserOpenedSections(data.openItems as string[]);
                        }
                    }}
                    openItems={
                        searchSettingsText
                            ? groupedOptions.map((g) => g.groupName)
                            : userOpenedSections
                    }>
                    {groupedOptions
                        .filter(doesGroupHaveVisibleOptions)
                        .sort((a, b) => (a.groupName ?? "").localeCompare(b.groupName ?? ""))
                        .map((group, groupIndex) => (
                            <AccordionItem
                                key={groupIndex}
                                value={group.groupName}
                                className={accordionStyles.accordionItem}>
                                <AccordionHeader>{group.groupName}</AccordionHeader>
                                <AccordionPanel>
                                    {group.options
                                        .filter((name) =>
                                            isOptionVisible(
                                                context.state.formComponents[
                                                    name
                                                ] as PublishDialogFormItemSpec,
                                            ),
                                        )
                                        .sort((aName, bName) => {
                                            const aLabel = (
                                                context.state.formComponents[aName]!.label ?? ""
                                            ).toString();
                                            const bLabel = (
                                                context.state.formComponents[bName]!.label ?? ""
                                            ).toString();
                                            return aLabel.localeCompare(bLabel);
                                        })
                                        .map((name, idx) => {
                                            const component = context.state.formComponents[
                                                name
                                            ] as PublishDialogFormItemSpec;
                                            if (component.type === "checkbox") {
                                                const checked = Boolean(
                                                    context.state.formState[component.propertyName],
                                                );
                                                const id = `adv-${String(component.propertyName)}`;
                                                const labelContent = (
                                                    <span
                                                        className="checkboxLabel"
                                                        dangerouslySetInnerHTML={{
                                                            __html: component.label,
                                                        }}
                                                    />
                                                );
                                                return (
                                                    <div className={styles.checkboxRow} key={idx}>
                                                        <Checkbox
                                                            id={id}
                                                            checked={checked}
                                                            onChange={(_, data) =>
                                                                context.formAction({
                                                                    propertyName:
                                                                        component.propertyName,
                                                                    isAction: false,
                                                                    value: data.checked,
                                                                })
                                                            }
                                                            aria-labelledby={`${id}-lbl`}
                                                        />
                                                        {component.tooltip ? (
                                                            <InfoLabel
                                                                id={`${id}-lbl`}
                                                                info={component.tooltip}
                                                                className="checkboxLabel">
                                                                {labelContent}
                                                            </InfoLabel>
                                                        ) : (
                                                            labelContent
                                                        )}
                                                    </div>
                                                );
                                            }
                                            return (
                                                <FormField<
                                                    IPublishForm,
                                                    PublishDialogWebviewState,
                                                    PublishDialogFormItemSpec,
                                                    FormContextProps<
                                                        IPublishForm,
                                                        PublishDialogWebviewState,
                                                        PublishDialogFormItemSpec
                                                    >
                                                >
                                                    key={idx}
                                                    context={context}
                                                    component={component}
                                                    idx={idx}
                                                />
                                            );
                                        })}
                                </AccordionPanel>
                            </AccordionItem>
                        ))}
                </Accordion>
            </DrawerBody>
        </OverlayDrawer>
    );
};
