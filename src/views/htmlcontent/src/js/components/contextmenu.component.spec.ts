import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { ContextMenu } from './contextmenu.component';
import { ShortcutService } from './../services/shortcuts.service';

class MockShortCutService {
    private keyToString = {
        'event.saveAsCSV': 'ctrl+s',
        'event.saveAsJSON': 'ctrl+shift+s',
        'event.selectAll': 'ctrl+a'
    };
    public stringCodeFor(value: string): Promise<string> {
        return Promise.resolve(this.keyToString[value]);
    }
}

describe('context Menu', () => {

    beforeEach(async(() => {
        TestBed.configureTestingModule({
            declarations: [ ContextMenu ]
        }).overrideComponent(ContextMenu, {
            set: {
                providers: [
                    {
                        provide: ShortcutService,
                        useClass: MockShortCutService
                    }
                ]
            }
        });
    }));

    describe('initilization', () => {
        let fixture: ComponentFixture<ContextMenu>;
        let comp: ContextMenu;
        let ele: HTMLElement;

        beforeEach(() => {
            fixture = TestBed.createComponent<ContextMenu>(ContextMenu);
            fixture.detectChanges();
            comp = fixture.componentInstance;
            ele = fixture.nativeElement;
        });

        it('should be hidden', () => {
            expect(ele.firstElementChild.className.indexOf('hidden')).not.toEqual(-1);
        });
    });

    describe('basic behavior', () => {
        let fixture: ComponentFixture<ContextMenu>;
        let comp: ContextMenu;
        let ele: HTMLElement;

        beforeEach(() => {
            fixture = TestBed.createComponent<ContextMenu>(ContextMenu);
            fixture.detectChanges();
            comp = fixture.componentInstance;
            ele = fixture.nativeElement;
        });

        it('shows correctly', () => {
            comp.show(0, 0, 0, 0, 0, []);
            fixture.detectChanges();
            expect(ele.firstElementChild.className.indexOf('hidden')).toEqual(-1);
            expect(ele.firstElementChild.childElementCount).toEqual(3);
        });

        it('hides correctly', () => {
            ele.click();
            fixture.detectChanges();
            expect(ele.firstElementChild.className.indexOf('hidden')).not.toEqual(-1);
        });

        it('emits correct event', (done) => {
            comp.clickEvent.subscribe((result) => {
                expect(result.type).toEqual('savecsv');
                expect(result.batchId).toEqual(0);
                expect(result.resultId).toEqual(0);
                expect(result.index).toEqual(0);
                expect(result.selection).toEqual([]);
                done();
            });
            comp.show(0, 0, 0, 0, 0, []);
            fixture.detectChanges();
            let firstLi = <HTMLElement> ele.firstElementChild.firstElementChild;
            firstLi.click();
            fixture.detectChanges();
        });
    });

});
