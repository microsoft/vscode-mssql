/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import {
	Component, Input, Inject, forwardRef, ComponentFactoryResolver, ViewChild,
	ChangeDetectorRef, ReflectiveInjector, Injector, ComponentRef, AfterViewInit
} from '@angular/core';
import { ComponentHostDirective } from '../directives/componentHost.directive';
import { IComponentDescriptor, ModelComponentTypes } from './app.component';
import { ButtonComponent } from './button.component';
import { InputBoxComponent } from './inputBox.component';

@Component({
	selector: 'model-component-wrapper',
	template: `
		<template component-host>
		</template>
	`
})
export class ModelComponentWrapper implements AfterViewInit {
	@Input() descriptor: IComponentDescriptor;
	// @Input() modelStore: IModelStore;

	// @memoize
	// public get guid(): string {
	// 	return generateUuid();
	// }

	private _componentInstance: any; // IComponent;
	private _modelViewId: string;

	@ViewChild(ComponentHostDirective) componentHost: ComponentHostDirective;

	constructor(
		@Inject(forwardRef(() => ComponentFactoryResolver)) private _componentFactoryResolver: ComponentFactoryResolver,
		@Inject(forwardRef(() => ChangeDetectorRef)) private _changeref: ChangeDetectorRef,
		@Inject(forwardRef(() => Injector)) private _injector: Injector
	) {
		//super();
		// if (params && params.onLayoutRequested) {
		// 	this._modelViewId = params.modelViewId;
		// 	this._register(params.onLayoutRequested(layoutParams => {
		// 		if (layoutParams && (layoutParams.alwaysRefresh || layoutParams.modelViewId === this._modelViewId)) {
		// 			this.layout();
		// 		}
		// 	}));
		// }
	}

	ngAfterViewInit() {
		if (this.componentHost) {
			this.loadComponent();
		}
		this._changeref.detectChanges();
		this.layout();
	}

	public layout(): void {
		// if (this.componentInstance && this.componentInstance.layout) {
		// 	this.componentInstance.layout();
		// }
	}

	public get id(): string {
		return this._componentInstance.descriptor.id;
	}

	// private get componentConfig(): IComponentConfig {
	// 	return {
	// 		descriptor: this.descriptor,
	// 		modelStore: this.modelStore
	// 	};
	// }

	// private get componentInstance(): IComponent {
	// 	if (!this._componentInstance) {
	// 		this.loadComponent();
	// 	}
	// 	return this._componentInstance;
	// }

	private loadComponent(): void {
		if (!this.descriptor || !this.descriptor.type) {
			return;
		}

		// let selector = componentRegistry.getCtorFromId('this.descriptor.type');
		// if (selector === undefined) {
		// //	this.logService.error('No selector defined for type ', this.descriptor.type);
		// 	return;
		// }

		let componentFactory: any = undefined;
		if (this.descriptor.type === ModelComponentTypes.Button.toString()) {
			componentFactory = this._componentFactoryResolver.resolveComponentFactory(ButtonComponent);
		} else if (this.descriptor.type === ModelComponentTypes.InputBox.toString()) {
			componentFactory = this._componentFactoryResolver.resolveComponentFactory(InputBoxComponent);
		}

		if (!componentFactory) {
			return;
		}

		let viewContainerRef = this.componentHost.viewContainerRef;
		viewContainerRef.clear();

		//let injector = ReflectiveInjector.resolveAndCreate([{ provide: COMPONENT_CONFIG, useValue: this.componentConfig }], this._injector);
		//let componentRef: ComponentRef<IComponent>;
		let componentRef: any;
		try {
			//componentRef = viewContainerRef.createComponent(componentFactory, 0, injector);
			componentRef = viewContainerRef.createComponent(componentFactory, 0);
			this._componentInstance = componentRef.instance;
			this._componentInstance.descriptor = this.descriptor;
			// this._componentInstance.modelStore = this.modelStore;
			this._changeref.detectChanges();
		} catch (e) {
			// There's a possible race condition here where a component that is added is then immediately removed,
			// which then makes it so that while the changeRef isn't destroyed when we call detectChanges above
			// it becomes destroyed during the detectChanges call and thus eventually throws. So to avoid a pointless
			// error message in the console we just make sure that we aren't disposed before printing it out
			// if (!this.isDisposed) {
			// 	this.logService.error('Error rendering component: ', e);
			// }
			return;
		}
		let el = <HTMLElement>componentRef.location.nativeElement;

		// set widget styles to conform to its box
		el.style.overflow = 'hidden';
		el.style.position = 'relative';
	}
}
