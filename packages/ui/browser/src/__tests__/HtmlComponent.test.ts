import 'reflect-metadata';
import {HtmlComponent} from '../ts/HtmlComponent';

describe('HtmlComponent', () => {
    it('handles visibility changes', async () => {
        const parent = HtmlComponent.create();
        const child = HtmlComponent.create();
        child.setParent(parent);

        const parentListener = jest.fn();
        parent.onVisibilityChange(parentListener);
        const childListener = jest.fn();
        child.onVisibilityChange(childListener);

        const assertBoth = (
            {visible, listenerCount}: { visible: boolean, listenerCount: number }
        ): void => {
            expect(parent.isVisible()).toBe(visible);
            expect(child.isVisible()).toBe(visible);

            if (listenerCount > 0) {
                expect(parentListener).lastCalledWith(visible);
                expect(childListener).lastCalledWith(visible);
            }

            expect(parentListener).toBeCalledTimes(listenerCount);
            expect(childListener).toBeCalledTimes(listenerCount);
        };

        // Components are not rendered yet -> both not visible
        assertBoth({
            visible: false,
            listenerCount: 0,
        });

        // now render them -> both visible
        await parent.renderTo('body');
        await child.renderTo('body');
        assertBoth({
            visible: true,
            listenerCount: 1,
        });

        // hiding the parent -> both not visible
        parent.hide();
        assertBoth({
            visible: false,
            listenerCount: 2,
        });

        // showing the parent again -> both visible
        parent.show();
        assertBoth({
            visible: true,
            listenerCount: 3,
        });

        // hide the child independently from the parent -> parent remains visible
        child.hide();
        expect(parent.isVisible()).toBe(true);
        expect(parentListener).lastCalledWith(true);
        expect(parentListener).toBeCalledTimes(3);
        expect(child.isVisible()).toBe(false);
        expect(childListener).lastCalledWith(false);
        expect(childListener).toBeCalledTimes(4);

        child.show();
        expect(parent.isVisible()).toBe(true);
        expect(parentListener).lastCalledWith(true);
        expect(parentListener).toBeCalledTimes(3);
        expect(child.isVisible()).toBe(true);
        expect(parentListener).lastCalledWith(true);
        expect(childListener).toBeCalledTimes(5);

        // destroy the components -> both not visible
        await parent.destroy();
        expect(parent.isVisible()).toBe(false);
        expect(parentListener).lastCalledWith(false);
        expect(parentListener).toBeCalledTimes(4);
        await child.destroy();
        expect(child.isVisible()).toBe(false);
        expect(parentListener).lastCalledWith(false);
        expect(childListener).toBeCalledTimes(6);
    });
});