/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import {
    FormItemSpec,
    FormReducers,
    FormState,
} from "../reactviews/common/forms/form";
import { MssqlWebviewPanelOptions } from "../sharedInterfaces/webview";

export abstract class FormWebviewController<
    TForm,
    TState extends FormState<TForm, TState, TFormItemSpec>,
    TFormItemSpec extends FormItemSpec<TForm, TState, TFormItemSpec>,
    TReducers extends FormReducers<TForm>,
> extends ReactWebviewPanelController<TState, TReducers> {
    constructor(
        context,
        vscodeWrapper,
        sourceFile: string,
        _viewId: string,
        initialData: TState,
        options: MssqlWebviewPanelOptions,
    ) {
        super(
            context,
            vscodeWrapper,
            sourceFile,
            _viewId,
            initialData,
            options,
        );

        this.registerFormRpcHandlers();
    }

    private registerFormRpcHandlers() {
        this.registerReducer("formAction", async (state, payload) => {
            if (payload.event.isAction) {
                const component = this.getFormComponent(
                    this.state,
                    payload.event.propertyName,
                );
                if (component && component.actionButtons) {
                    const actionButton = component.actionButtons.find(
                        (b) => b.id === payload.event.value,
                    );
                    if (actionButton?.callback) {
                        await actionButton.callback();
                    }
                }
            } else {
                (this.state.formState[
                    payload.event.propertyName
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ] as any) = payload.event.value;
                await this.validateForm(
                    this.state.formState,
                    payload.event.propertyName,
                );
                await this.afterSetFormProperty(payload.event.propertyName);
            }
            await this.updateItemVisibility();

            return state;
        });
    }

    /**
     * Runs validation across the form fields
     * @param formTarget
     * @param propertyName
     * @returns array of fields with errors
     */
    protected async validateForm(
        formTarget: TForm,
        propertyName?: keyof TForm,
    ): Promise<string[]> {
        const erroredInputs = [];
        if (propertyName) {
            const component = this.state.formComponents[propertyName];
            if (component && component.validate) {
                component.validation = component.validate(
                    this.state,
                    formTarget[propertyName] as string | boolean | number,
                );
                if (!component.validation.isValid) {
                    erroredInputs.push(component.propertyName);
                }
            }
        } else {
            this.getActiveFormComponents(this.state)
                .map((x) => this.state.formComponents[x])
                .forEach((c) => {
                    if (c.hidden) {
                        c.validation = {
                            isValid: true,
                            validationMessage: "",
                        };
                        return;
                    } else {
                        if (c.validate) {
                            c.validation = c.validate(
                                this.state,
                                formTarget[c.propertyName] as
                                    | string
                                    | boolean
                                    | number,
                            );
                            if (!c.validation.isValid) {
                                erroredInputs.push(c.propertyName);
                            }
                        }
                    }
                });
        }

        return erroredInputs;
    }

    /**
     * Method called after a form value has been set and validated.
     * Override to perform additional actions after setting a form property.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async afterSetFormProperty(propertyName: keyof TForm): Promise<void> {
        return;
    }

    /** Updates the `hidden` property of each form component based on the current selections */
    abstract updateItemVisibility(): Promise<void>;

    /** Gets the property names of the active form components */
    protected abstract getActiveFormComponents(state: TState): (keyof TForm)[];

    /** Gets a specific form component */
    protected getFormComponent(
        state: TState,
        propertyName: keyof TForm,
    ): FormItemSpec<TForm, TState, TFormItemSpec> {
        return this.getActiveFormComponents(state).includes(propertyName)
            ? state.formComponents[propertyName]
            : undefined;
    }
}
