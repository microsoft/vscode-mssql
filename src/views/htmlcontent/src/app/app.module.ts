import { NgModule }      from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';

import { AppComponent }  from './app.component';
import { SlickGrid } from './slickgrid/SlickGrid';
import { HttpModule, JsonpModule } from '@angular/http';

@NgModule({
  imports: [
              BrowserModule,
              HttpModule,
              JsonpModule
           ],
  declarations: [ AppComponent, SlickGrid ],
  bootstrap:    [ AppComponent ]
})
export class AppModule { }
