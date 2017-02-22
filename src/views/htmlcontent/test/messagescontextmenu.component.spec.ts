import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { MessagesContextMenu } from './../src/js/components/messagescontextmenu.component';
import { ShortcutService } from './../src/js/services/shortcuts.service';
import { IRange } from './../src/js/interfaces';

class MockShortCutService {
    private keyToString = {
        'event.copySelection': 'ctrl+c'
    };
    public stringCodeFor(value: string): Promise<string> {
        return Promise.resolve(this.keyToString[value]);
    }
}

describe('Messages Context Menu', () => {

    beforeEach(async(() => {
        TestBed.configureTestingModule({
            declarations: [ MessagesContextMenu ]
        }).overrideComponent(MessagesContextMenu, {
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

    describe('initialization', () => {
        let fixture: ComponentFixture<MessagesContextMenu>;
        let comp: MessagesContextMenu;
        let ele: HTMLElement;

        beforeEach(() => {
            fixture = TestBed.createComponent<MessagesContextMenu>(MessagesContextMenu);
            fixture.detectChanges();
            comp = fixture.componentInstance;
            ele = fixture.nativeElement;
        });

        it('should be hidden', () => {
            expect(ele.firstElementChild.className.indexOf('hidden')).not.toEqual(-1);
        });
    });

    describe('basic behavior', () => {
        let fixture: ComponentFixture<MessagesContextMenu>;
        let comp: MessagesContextMenu;
        let ele: HTMLElement;

        beforeEach(() => {
            fixture = TestBed.createComponent<MessagesContextMenu>(MessagesContextMenu);
            fixture.detectChanges();
            comp = fixture.componentInstance;
            ele = fixture.nativeElement;
        });

        it('shows correctly', () => {
            comp.show(0, 0, <IRange>{});
            fixture.detectChanges();
            expect(ele.firstElementChild.className.indexOf('hidden')).toEqual(-1);
            expect(ele.firstElementChild.childElementCount).toEqual(1, 'expect 1 menu items to be present');
        });

        it('hides correctly', () => {
            ele.click();
            fixture.detectChanges();
            expect(ele.firstElementChild.className.indexOf('hidden')).not.toEqual(-1);
        });

        it('disables copy when range is empty', () => {
            comp.show(0, 0, <IRange> { toString: () => ''});
            fixture.detectChanges();

            // expect disabled element if toString is undefined
            let firstLi = <HTMLElement> ele.firstElementChild.firstElementChild;
            expect(firstLi.className.indexOf('disabled')).not.toEqual(-1);
        });

        it('enables copy when range has text', () => {
            comp.show(0, 0, <IRange>{ toString: () => 'text'});
            fixture.detectChanges();

            // expect disabled element if toString is undefined
            let firstLi = <HTMLElement> ele.firstElementChild.firstElementChild;
            expect(firstLi.className.indexOf('disabled')).toEqual(-1);
        });

        it('emits correct event', (done) => {
            let range = <IRange>{ toString: () => 'text' };
            comp.clickEvent.subscribe((result) => {
                expect(result.type).toEqual('copySelection');
                expect(result.selectedRange).toEqual(range);
                done();
            });
            comp.show(0, 0, range);
            fixture.detectChanges();
            let firstLi = <HTMLElement> ele.firstElementChild.firstElementChild;
            firstLi.click();
            fixture.detectChanges();
        });
    });

});
