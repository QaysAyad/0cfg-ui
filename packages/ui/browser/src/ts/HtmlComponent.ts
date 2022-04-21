import {Destroyable} from './Destroyable';
import {randomString} from '@0cfg/utils-common/lib/randomString';
import {has} from '@0cfg/utils-common/lib/has';
import {RenderLocation} from './RenderLocation';
import {injectable} from 'inversify';
import {errStatus} from '@0cfg/reply-common/lib/Reply';

const timeoutBeforeWarning: number = 5000;

export class AlreadyRenderedError extends Error {
    public constructor() {
        super('The component was already rendered. Call .destroy() before rendering again.');
    }
}

export class UndefinedContainerElementError extends Error {
    public constructor() {
        super('The container element was undefined.');
    }
}

export class SelectorMissedError extends Error {
    public constructor(selector: string) {
        super(`Selector ${selector} points at no dom element.`);
    }
}

export class UnknownLocationError extends Error {
    public constructor(renderLocation: string) {
        super(`Unknown render location ${renderLocation}.`);
    }
}

/**
 * Location in the DOM to which a HtmlComponent can be rendered.
 * Note that a string selector always points to the first element which was found in the DOM/scope.
 * (See https://developer.mozilla.org/de/docs/Web/API/Document/querySelector for more information).
 */
export type HtmlComponentContainer = string | HTMLElement | HtmlComponent;

/**
 * In ms.
 * Don't forget to adjust the corresponging sass variables as well when changing this constant.
 */
export const animationDurationShort = 100;

/**
 * In ms.
 * Don't forget to adjust the corresponging sass variables as well when changing this constant.
 */
export const animationDurationLong = 300;

/**
 * Manages the lifecycle of a single html div element.
 * The div element can contain other arbitrary elements.
 * Those elements are either defined in the constructor by setting htmlContent
 * or by adding them dynamically in the {@link renderTo} method.
 */
@injectable()
export class HtmlComponent implements Destroyable {

    private resolveRendered?: (value?: void | PromiseLike<void>) => void;
    private renderedPromise: Promise<void> = new Promise(resolve => {
        this.resolveRendered = resolve;
    });
    private parent_?: HtmlComponent;
    private readonly visibilityChangeListeners: { lastState: boolean, listener: (visible: boolean) => void }[] = [];

    /**
     * Initialized to {@code false} because this component is not rendered yet.
     * Does not respect the parent's visibility state
     */
    private ownVisibilityState: boolean = false;
    /**
     * Set on render in {@link renderTo}.
     * Set to undefined in {@link destroy}.
     */
    private element?: HTMLElement;
    private hideWhenRendered: boolean = false;

    /**
     * Intended to be overridden by subclasses.
     * See: https://developer.mozilla.org/en-US/docs/Web/API/Element/innerHTML
     */
    protected readonly htmlContent?: string;

    /**
     * Intended to be overridden by subclasses.
     * See: https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/class
     */
    protected readonly classAttr?: string;

    /**
     * Intended to be overridden by subclasses.
     * See: https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/style
     */
    protected readonly styleAttr?: string

    /**
     * this component instance id, will be added as a class to our root.
     */
    protected readonly id = '_c_' + randomString();

    /**
     * Quite convenient for debugging, however this could be done with a watch expression as well
     */
    protected readonly type = this.constructor.name;
    protected renderedOnce: boolean = false;

    /**
     * Constructor intended for override but no direct usage.
     * Refer to {@link HtmlComponent.create()} to create HtmlComponents directly.
     */
    protected constructor() {
    }

    public static create(htmlContent?: string, classAttr?: string, styleAttr?: string): HtmlComponent {
        return new class extends HtmlComponent {
            protected readonly htmlContent?: string = htmlContent;
            protected readonly classAttr?: string = classAttr;
            protected readonly styleAttr?: string = styleAttr;
        };
    }

    protected set parent(parent: HtmlComponent | undefined) {
        this.parent_ = parent;
        if (has(this.parent) && this.visibilityChangeListeners.length > 0) {
            this.parent.onVisibilityChange(this.myParentVisibilityListener);
        }
    }

    protected get parent(): HtmlComponent | undefined {
        return this.parent_;
    }

    /**
     * Set the parent component of this component in order to propagate visibility changes bidirectionally.
     */
    public setParent(parent: HtmlComponent | undefined): this {
        if (has(parent)) {
            parent.onVisibilityChange(this.myParentVisibilityListener);
        }
        this.parent = parent;
        return this;
    }

    /**
     * Renders to a {@link HtmlComponentContainer}.
     */
    public async renderTo(
        container: HtmlComponentContainer,
        renderLocation = RenderLocation.IntoEnd
    ): Promise<this> {

        const renderStart = Date.now();

        if (!has(container)) {
            throw(new UndefinedContainerElementError());
        }
        if (this.isRendered()) {
            throw new AlreadyRenderedError();
        }
        if (!this.renderedOnce) {
            this.renderedOnce = true;
            await this.beforeFirstRender();
        }
        await this.beforeEveryRender();

        this.createElementAndApplyAttributes()
            .renderToTargetAndLocation(renderLocation, HtmlComponent.getRenderTarget(container));

        if (this.hideWhenRendered) {
            this.hide();
        } else {
            this.ownVisibilityState = true;
            this.fireVisibilityChange();
        }

        if ((Date.now() - renderStart) > timeoutBeforeWarning) {
            errStatus(`Component render took more than ${timeoutBeforeWarning} ms.`).log();
        }
        has(this.resolveRendered) && this.resolveRendered();
        await this.afterEveryRenderSync();
        this.afterEveryRender();
        return this;
    }

    private renderToTargetAndLocation(renderLocation: RenderLocation,
                                      renderTarget: HTMLElement): this {
        const parentNode = renderTarget.parentNode;
        switch (renderLocation) {
            case RenderLocation.IntoBeginning:
                renderTarget.prepend(this.element!);
                break;
            case RenderLocation.Before:
                if (has(parentNode)) {
                    parentNode.insertBefore(this.element!, renderTarget);
                } else {
                    document.insertBefore(this.element!, renderTarget);
                }
                break;
            case RenderLocation.After:
                if (has(parentNode)) {
                    parentNode.insertBefore(this.element!, renderTarget.nextSibling);
                } else {
                    document.insertBefore(this.element!, renderTarget.nextSibling);
                }
                break;
            case RenderLocation.IntoEnd:
                renderTarget.append(this.element!);
                break;
            default:
                this.element = undefined;
                throw new UnknownLocationError(renderLocation);
        }
        return this;
    }

    private createElementAndApplyAttributes(): this {
        this.element = document.createElement('div');
        if (has(this.htmlContent)) {
            this.element.innerHTML = this.htmlContent;
        }
        if (has(this.classAttr)) {
            this.element.setAttribute('class', this.classAttr);
        }
        this.element.classList.add(this.id);
        if (has(this.styleAttr)) {
            this.element.setAttribute('style', this.styleAttr);
        }
        return this;
    }

    private static getRenderTarget(container: HtmlComponentContainer): HTMLElement {
        if (typeof container === 'string') {
            const renderTarget = document.querySelector(container);
            if (!has(renderTarget)) {
                throw new SelectorMissedError(container);
            }
            return <HTMLElement>renderTarget;
        }
        return 'getRootElement' in container ? container.getRootElement() : container;
    }

    /**
     * @param fadeOut If {@code true}, the html element will get the being-destroyed class added for a short duration
     *              before being removed from the dom.
     *              The exact duration is {@link animationDurationShort} milliseconds.
     *              The method will still only return once the element is fully removed from the dom.
     */
    public destroy(fadeOut: boolean = false): Promise<void> {
        this.renderedPromise = new Promise(resolve => {
            this.resolveRendered = resolve;
        });
        // do not substitute has(this.element) with this.isRendered() here - subclasses may override this.isRendered
        const doDestroy: () => Promise<void> = async () => {
            if (has(this.element)) {
                this.element.remove();
            }
            delete this.element;
            this.ownVisibilityState = false;
            this.fireVisibilityChange();
        };
        if (fadeOut) {
            return new Promise<void>(resolve => {
                if (has(this.element)) {
                    this.element.classList.add('being-destroyed');
                }
                setTimeout(async () => {
                    await doDestroy();
                    resolve();
                }, animationDurationShort);
            });
        } else {
            return doDestroy();
        }
    }

    /**
     * Find the first dom element inside this component matching the {@param selector}.
     * If no element is found, an error is thrown.
     * An error is also thrown if the html component is not rendered yet.
     */
    public findInScope<T extends HTMLElement>(selector: string): T {
        // do not substitute has(this.element) with this.isRendered() here - subclasses may override this.isRendered
        if (!has(this.element)) {
            throw new Error('findInScope called on an unrendered html component.');
        }

        const result = this.findAllInScope(selector);
        if (!has(result) || result.length === 0) {
            throw new Error(`Element not found ${selector}`);
        }
        return result[0] as T;
    }

    /**
     * Find all dom elements inside this component matching the {@param selector}
     * If no element is found, an empty array is returned.
     *
     * An error is thrown if the html component is not rendered yet.
     */
    public findAllInScope(selector: string): HTMLElement[] {
        // do not substitute has(this.element) with this.isRendered() here - subclasses may override this.isRendered
        if (!has(this.element)) {
            throw new Error('findAllInScope called on an unrendered html component.');
        }

        return Array.from(this.element.querySelectorAll(selector));
    }

    /**
     * If this component is currently rendered.
     */
    public isRendered(): boolean {
        return has(this.element);
    }

    /**
     * Returns a promise which resolves with the next render (resets after an invocation of {@link this.destroy()}).
     */
    public rendered(): Promise<void> {
        return this.renderedPromise;
    }

    /**
     * Sets or overwrites the tooltip of this HtmlComponent.
     * Technically speaking the tooltip is the title property of the Html
     * element.
     * The element must be render to the dom first otherwise this method does
     * nothing {@see HtmlComponent#renderTo}.
     * @param tooltip The tooltip to be displayed when hovering over this
     *     HtmlComponent
     */
    public setTooltip(tooltip: string): void {
        if (has(this.element)) {
            this.element.setAttribute('title', tooltip);
        }
    }

    /**
     * Attaches a listener which is invoked after a visibility change (hidden or shown).
     * Is idempotent.
     */
    public onVisibilityChange(listener: () => void): void {
        if (!has(this.visibilityChangeListeners.find(e => e.listener === listener))) {
            this.visibilityChangeListeners.push({lastState: this.isVisible(), listener});
        }
    }

    /**
     * Removes a visibility change listener.
     */
    public removeVisibilityChangeListener(listener: (visible: boolean) => void): void {
        this.visibilityChangeListeners.splice(this.visibilityChangeListeners.findIndex(e => e.listener === listener));
        if (has(this.parent) && this.visibilityChangeListeners.length === 0) {
            // deregister from the parent as we are not interested in visibility changes
            // anymore
            this.parent.removeVisibilityChangeListener(this.myParentVisibilityListener);
        }
    }

    public isVisible(): boolean {
        return this.ownVisibilityState && (!has(this.parent) || this.parent.isVisible());
    }

    /**
     * Show (not copy) this component in the DOM.
     */
    public show(): void {
        if (this.isRendered()) {
            this.element?.classList.remove('hidden');
            this.ownVisibilityState = true;
            this.fireVisibilityChange();
        }
    }

    /**
     * Hide (not remove) this component in the DOM.
     */
    public hide(): void {
        if (this.isRendered()) {
            this.element?.classList.add('hidden');
            this.ownVisibilityState = false;
            this.fireVisibilityChange();
        } else {
            this.hideWhenRendered = true;
        }
    }

    /**
     * Override this to do things before the first rendering run.
     * This method is called only once per instance.
     * This default implementation does nothing.
     */
    protected async beforeFirstRender(): Promise<void> {
        // do nothing here
    }

    /**
     * Override this to do things before rendering.
     * This default implementation does nothing.
     */
    protected async beforeEveryRender(): Promise<void> {
        // do nothing here
    }

    /**
     * Override this to do things after rendering.
     * This default implementation does nothing.
     */
    protected async afterEveryRender(): Promise<void> {
        // do nothing here
    }

    /**
     * Override this to do things synchronously after rendering.
     * This default implementation does nothing.
     * Note that this can block the node process and should be used with caution.
     */
    protected afterEveryRenderSync(): void {
        // do nothing here
    }

    /**
     * This throws function an error if the HtmlComponent is not rendered.
     */
    protected getRootElement(): HTMLElement {
        if (!has(this.element)) {
            throw new Error('Called getRootElement on an unrendered HtmlComponent.');
        }
        return this.element;
    }

    /**
     * overwrite this if you want to do something like mind your own visibility state (see HideableHtmlComponent)
     */
    protected parentVisibilityChanged(): void {
        this.fireVisibilityChange();
    }

    /**
     * Will inform all listeners of the current visibility state.
     * Will not fire the same state twice in a row.
     */
    protected fireVisibilityChange(): void {
        const newState = this.isVisible();

        this.visibilityChangeListeners.forEach(e => {
            if (e.lastState !== newState) {
                e.listener(newState);
                e.lastState = newState;
            }
        });
    }

    private myParentVisibilityListener = (): void => this.parentVisibilityChanged();
}
