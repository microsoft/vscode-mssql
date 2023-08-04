/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { NgModule, ValueProvider }      from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule }   from '@angular/forms';
import { AppComponent }  from './components/app.component';
import { ButtonComponent } from './components/button.component';
import { ComponentHostDirective } from './directives/componentHost.directive';
import { ModelComponentWrapper } from './components/modelComponentWrapper.component';
import { InputBoxComponent } from './components/inputBox.component';

/**
 * Top level angular module, no actual content here
 */
const WINDOW_PROVIDER: ValueProvider = {
    provide: Window,
    useValue: window
};

@NgModule({
  imports: [
              BrowserModule,
              FormsModule
           ],
  providers: [
    WINDOW_PROVIDER
  ],
  declarations: [ AppComponent, ButtonComponent, InputBoxComponent, ModelComponentWrapper, ComponentHostDirective ],
  entryComponents: [ ButtonComponent, InputBoxComponent ],
  bootstrap:    [ AppComponent ]
})
export class AppModule { }
