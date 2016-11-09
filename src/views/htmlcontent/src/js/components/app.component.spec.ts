import { AppComponent } from './app.component';
import { SlickGrid } from 'angular2-slickgrid';
import { ScrollDirective } from './../directives/scroll.directive';
import { MouseDownDirective } from './../directives/mousedown.directive';
import { ContextMenu } from './contextmenu.component';
import { HttpModule, JsonpModule } from '@angular/http';

import { async, ComponentFixture, TestBed } from '@angular/core/testing';

////////  SPECS  /////////////
describe('AppComponent', function (): void {
  let comp: AppComponent;
  let fixture: ComponentFixture<AppComponent>;

  beforeEach(async(() => {
   TestBed.configureTestingModule({
      declarations: [ AppComponent, SlickGrid, ScrollDirective, MouseDownDirective, ContextMenu],
      imports: [ HttpModule, JsonpModule ]
    })
    .compileComponents().catch(e => {
      console.log(e);
    });
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(AppComponent);
    comp = fixture.componentInstance;
  });

  it('should create component', () => {
    console.log('testing');
    expect(comp).toBeDefined();
  });
});
