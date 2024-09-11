import { bindAll, each, isArray, isFunction, isUndefined, result } from 'underscore';
import { BlockProperties } from '../block_manager/model/Block';
import CanvasModule from '../canvas';
import { CanvasSpotBuiltInTypes } from '../canvas/model/CanvasSpot';
import { $, Model, SetOptions, View } from '../common';
import EditorModel from '../editor/model/Editor';
import { getPointerEvent, isTextNode, off, on } from './dom';
import { getElement, getModel, matches } from './mixins';
import { TreeSorterBase } from './TreeSorterBase';
import { DropLocationDeterminer } from './DropLocationDeterminer';
import Component from '../dom_components/model/Component';

type DropContent = BlockProperties['content'];

export interface Dimension {
  top: number;
  left: number;
  height: number;
  width: number;
  offsets: ReturnType<CanvasModule['getElementOffsets']>;
  dir?: boolean;
  el?: HTMLElement;
  indexEl?: number;
}

export interface Position {
  index: number;
  indexEl: number;
  method: string;
}

export enum SorterDirection {
  Vertical = "Vertical",
  Horizontal = "Horizontal",
  BothDirections = "BothDirections"
}

export interface SorterContainerContext {
  container: HTMLElement;
  containerSel: string;
  itemSel: string;
  pfx: string;
  document: Document;
  placeholderElement?: HTMLElement;
  customTarget?: Function;
}

export interface PositionOptions {
  windowMargin: number;
  borderOffset: number;
  offsetTop: number;
  offsetLeft: number;
  canvasRelative?: boolean;
  scale: number;
  relative: boolean;
}

export interface SorterEventHandlers {
  onStart?: Function;
  onMove?: Function;
  onEndMove?: Function;
  onEnd?: Function;
}

export interface SorterDragBehaviorOptions {
  dragDirection: SorterDirection;
  ignoreViewChildren?: boolean;
  nested?: boolean;
  selectOnEnd: boolean;
}

export interface SorterOptions<T> {
  em?: EditorModel;
  treeClass: new (model: T) => TreeSorterBase<T>;

  containerContext: SorterContainerContext;
  positionOptions: PositionOptions;
  dragBehavior: SorterDragBehaviorOptions;
  eventHandlers?: SorterEventHandlers;
}

const targetSpotType = CanvasSpotBuiltInTypes.Target;

const spotTarget = {
  id: 'sorter-target',
  type: targetSpotType,
};

type RequiredEmAndTreeClassPartialSorterOptions<T> = Partial<SorterOptions<T>> & {
  em: EditorModel;
  treeClass: new (model: T) => TreeSorterBase<T>;
};

export default class Sorter<T> extends View {
  em?: EditorModel;
  treeClass!: new (model: any) => TreeSorterBase<T>;

  positionOptions!: PositionOptions;
  containerContext!: SorterContainerContext;
  dragBehavior!: SorterDragBehaviorOptions;
  eventHandlers?: SorterEventHandlers;

  dropContent?: DropContent;
  options!: SorterOptions<T>;
  elT!: number;
  elL!: number;
  dropTargetIndicator?: HTMLElement;
  activeTextModel?: Model;
  dropModel?: Model;

  targetElement?: HTMLElement;
  prevTargetElement?: HTMLElement;
  sourceElement?: HTMLElement;
  moved?: boolean;
  sourceModel?: Model;
  targetModel?: Model;
  mouseXRelativeToContainer?: number;
  mouseYRelativeToContainer?: number;
  eventMove?: MouseEvent;
  prevTargetDim?: Dimension;
  cacheDimsP?: Dimension[];
  cacheDims?: Dimension[];
  targetP?: HTMLElement;
  targetPrev?: HTMLElement;
  lastPos?: Position;
  lastDims?: Dimension[];
  $placeholderElement?: any;
  toMove?: Model | Model[];
  dropLocationDeterminer!: DropLocationDeterminer<unknown>;
  docs!: Document[];

  // @ts-ignore
  initialize(sorterOptions: RequiredEmAndTreeClassPartialSorterOptions<T> = {}) {
    const defaultOptions: Omit<SorterOptions<T>, 'em' | 'treeClass'> = {
      containerContext: {
        // Change this
        container: '' as any,
        containerSel: '*',
        itemSel: '*',
        pfx: '',
        document,
      },
      positionOptions: {
        borderOffset: 10,
        relative: false,
        windowMargin: 0,
        offsetTop: 0,
        offsetLeft: 0,
        scale: 1,
        canvasRelative: false
      },
      dragBehavior: {
        dragDirection: SorterDirection.Vertical,
        nested: false,
        ignoreViewChildren: false,
        selectOnEnd: true,
      },
    }

    const mergedOptions: Omit<SorterOptions<T>, 'em' | 'treeClass'> = {
      ...defaultOptions,
      ...sorterOptions,
      containerContext: {
        ...defaultOptions.containerContext,
        ...sorterOptions.containerContext,
      },
      positionOptions: {
        ...defaultOptions.positionOptions,
        ...sorterOptions.positionOptions,
      },
      dragBehavior: {
        ...defaultOptions.dragBehavior,
        ...sorterOptions.dragBehavior,
      },
    };

    bindAll(this, 'startSort', 'onMove', 'endMove', 'rollback', 'updateOffset', 'moveDragHelper');
    this.containerContext = mergedOptions.containerContext;
    this.positionOptions = mergedOptions.positionOptions;
    this.dragBehavior = mergedOptions.dragBehavior;
    this.eventHandlers = mergedOptions.eventHandlers;

    this.elT = 0;
    this.elL = 0;
    this.em = sorterOptions.em;
    var el = mergedOptions.containerContext.container;
    this.el = typeof el === 'string' ? document.querySelector(el)! : el!;
    this.treeClass = sorterOptions.treeClass;

    this.updateOffset();
    if (this.em?.on) {
      this.em.on(this.em.Canvas.events.refresh, this.updateOffset);
    }

    this.dropLocationDeterminer = new DropLocationDeterminer({
      containerContext: this.containerContext,
      positionOptions: this.positionOptions,
      dragBehavior: this.dragBehavior,
      eventHandlers: this.eventHandlers,
    }, (model: Component, index: any) => {
      if (model?.view) {
        model.view.el.style.border = "black 3px dashed"
      }
      // console.log("You moved!", model, index)
    });
  }

  getContainerEl(elem?: HTMLElement) {
    if (elem) this.el = elem;

    if (!this.el) {
      var el = this.containerContext.container;
      this.el = typeof el === 'string' ? document.querySelector(el)! : el!;
    }

    return this.el;
  }

  getDocuments(el?: HTMLElement) {
    const em = this.em;
    const elDoc = el ? el.ownerDocument : em?.Canvas.getBody().ownerDocument;
    const docs = [document];
    elDoc && docs.push(elDoc);
    return docs;
  }

  /**
   * Triggered when the offset of the editor is changed
   */
  updateOffset() {
    const offset = this.em?.get('canvasOffset') || {};
    this.positionOptions.offsetTop = offset.top;
    this.positionOptions.offsetLeft = offset.left;
  }

  /**
   * Set content to drop
   * @param {String|Object} content
   */
  setDropContent(content: DropContent) {
    delete this.dropModel;
    this.dropContent = content;
  }

  updateTextViewCursorPosition(mouseEvent: any) {
    const { em } = this;
    if (!em) return;
    const Canvas = em.Canvas;
    const targetDoc = Canvas.getDocument();
    let range = null;

    if (targetDoc.caretRangeFromPoint) {
      // Chrome
      const poiner = getPointerEvent(mouseEvent);
      range = targetDoc.caretRangeFromPoint(poiner.clientX, poiner.clientY);
    } else if (mouseEvent.rangeParent) {
      // Firefox
      range = targetDoc.createRange();
      range.setStart(mouseEvent.rangeParent, mouseEvent.rangeOffset);
    }

    const sel = Canvas.getWindow().getSelection();
    Canvas.getFrameEl().focus();
    sel?.removeAllRanges();
    range && sel?.addRange(range);
    this.setContentEditable(this.activeTextModel, true);
  }

  setContentEditable(model?: Model, mode?: boolean) {
    if (model) {
      // @ts-ignore
      const el = model.getEl();
      if (el.contentEditable != mode) el.contentEditable = mode;
    }
  }

  /**
   * Toggle cursor while sorting
   * @param {Boolean} active
   */
  toggleSortCursor(active?: boolean) {
    const { em } = this;
    const cv = em?.Canvas;

    // Avoid updating body className as it causes a huge repaint
    // Noticeable with "fast" drag of blocks
    cv && (active ? cv.startAutoscroll() : cv.stopAutoscroll());
  }

  /**
   * Set drag helper
   * @param {HTMLElement} el
   * @param {Event} event
   */
  setDragHelper(el: HTMLElement, event: Event) {
    const ev = event || '';
    const clonedEl = el.cloneNode(true) as HTMLElement;
    const rect = el.getBoundingClientRect();
    const computed = getComputedStyle(el);
    let style = '';

    for (var i = 0; i < computed.length; i++) {
      const prop = computed[i];
      style += `${prop}:${computed.getPropertyValue(prop)};`;
    }

    document.body.appendChild(clonedEl);
    clonedEl.className += ` ${this.containerContext.pfx}bdrag`;
    clonedEl.setAttribute('style', style);
    this.dropTargetIndicator = clonedEl;
    clonedEl.style.width = `${rect.width}px`;
    clonedEl.style.height = `${rect.height}px`;
    ev && this.moveDragHelper(ev);

    // Listen mouse move events
    if (this.em) {
      const $doc = $(this.em.Canvas.getBody().ownerDocument);
      $doc.off('mousemove', this.moveDragHelper).on('mousemove', this.moveDragHelper);
    }
    $(document).off('mousemove', this.moveDragHelper).on('mousemove', this.moveDragHelper);
  }

  /**
   * Update the position of the helper
   * @param  {Event} e
   */
  moveDragHelper(e: any) {
    const doc = (e.target as HTMLElement).ownerDocument;

    if (!this.dropTargetIndicator || !doc) {
      return;
    }

    let posY = e.pageY;
    let posX = e.pageX;
    let addTop = 0;
    let addLeft = 0;
    // @ts-ignore
    const window = doc.defaultView || (doc.parentWindow as Window);
    const frame = window.frameElement;
    const dragHelperStyle = this.dropTargetIndicator.style;

    // If frame is present that means mouse has moved over the editor's canvas,
    // which is rendered inside the iframe and the mouse move event comes from
    // the iframe, not the parent window. Mouse position relative to the frame's
    // parent window needs to account for the frame's position relative to the
    // parent window.
    if (frame) {
      const frameRect = frame.getBoundingClientRect();
      addTop = frameRect.top + document.documentElement.scrollTop;
      addLeft = frameRect.left + document.documentElement.scrollLeft;
      posY = e.clientY;
      posX = e.clientX;
    }

    dragHelperStyle.top = posY + addTop + 'px';
    dragHelperStyle.left = posX + addLeft + 'px';
  }

  /**
   * Returns true if the element matches with selector
   * @param {Element} el
   * @param {String} selector
   * @return {Boolean}
   */
  matches(el: HTMLElement, selector: string): boolean {
    return matches.call(el, selector);
  }

  /**
   * Closest parent
   * @param {Element} el
   * @param {String} selector
   * @return {Element|null}
   */
  closest(el: HTMLElement, selector: string): HTMLElement | undefined {
    if (!el) return;
    let elem = el.parentNode;

    while (elem && elem.nodeType === 1) {
      if (this.matches(elem as HTMLElement, selector)) return elem as HTMLElement;
      elem = elem.parentNode;
    }
  }

  /*-1-*/
  /**
   * Get the offset of the element
   * @param  {HTMLElement} el
   * @return {Object}
  */
  offset(el: HTMLElement) {
    const rect = el.getBoundingClientRect();

    return {
      top: rect.top + document.body.scrollTop,
      left: rect.left + document.body.scrollLeft,
    };
  }
  /*-1-*/

  /**
   * Create placeholder
   * @return {HTMLElement}
   */
  createPlaceholder() {
    const pfx = this.containerContext.pfx;
    const el = document.createElement('div');
    const ins = document.createElement('div');
    el.className = pfx + 'placeholder';
    el.style.display = 'none';
    el.style.pointerEvents = 'none';
    ins.className = pfx + 'placeholder-int';
    el.appendChild(ins);
    return el;
  }

  /**
   * Picking component to move
   * @param {HTMLElement} src
   * */
  startSort(src?: HTMLElement, opts: { container?: HTMLElement } = {}) {
    if (!!opts.container) {
      this.updateContainer(opts.container);
    }
    if (!!src) {
      const elementDoc = this.getElementDoc(src);
      elementDoc && this.appendDoc(elementDoc);
    }
    this.dropLocationDeterminer.startSort();

    const { em } = this;
    const { itemSel, containerSel } = this.containerContext;
    /*---*/
    const docs = this.getDocuments(src);
    this.resetDragStates();

    // Check if the start element is a valid one, if not, try the closest valid one
    if (src && !this.matches(src, `${itemSel}, ${containerSel}`)) {
      src = this.closest(src, itemSel)!;
    }

    this.sourceElement = src;
    this.ensurePlaceholder();
    if (src) {
      this.sourceModel = this.getSourceModel(src);
    }

    this.bindDragEventHandlers(docs);
    this.envokeOnStartCallback();
    /*---*/

    // Avoid strange effects on dragging
    em?.clearSelection();
    this.toggleSortCursor(true);
    this.emitSorterStart(src);
  }

  private bindDragEventHandlers(docs: Document[]) {
    on(this.containerContext.container!, 'mousemove dragover', this.onMove);
    on(docs, 'mouseup dragend touchend', this.endMove);
    on(docs, 'keydown', this.rollback);
  }

  private emitSorterStart(src: HTMLElement | undefined) {
    this.em?.trigger('sorter:drag:start', src, this.sourceModel);
  }

  private envokeOnStartCallback() {
    isFunction(this.eventHandlers?.onStart) && this.eventHandlers.onStart({
      sorter: this,
      target: this.sourceModel,
      //@ts-ignore
      parent: this.sourceModel && this.sourceModel.parent?.(),
      //@ts-ignore
      index: this.sourceModel && this.sourceModel.index?.(),
    });
  }

  private ensurePlaceholder() {
    if (!this.containerContext.placeholderElement) {
      this.containerContext.placeholderElement = this.createPlaceholder();
      this.containerContext.container!.appendChild(this.containerContext.placeholderElement);
    }
  }

  private resetDragStates() {
    delete this.dropModel;
    delete this.targetElement;
    delete this.prevTargetElement;
    this.moved = false;
  }

  updateContainer(container: HTMLElement) {
    const newContainer = this.getContainerEl(container);

    this.dropLocationDeterminer.updateContainer(newContainer);
  }

  getElementDoc(el: HTMLElement) {
    const em = this.em;
    const elementDocument = el ? el.ownerDocument : em?.Canvas.getBody().ownerDocument;
    const docs = [document];
    elementDocument && docs.push(elementDocument);

    return elementDocument
  }

  appendDoc(doc: Document) {
    this.updateDocs([document, doc])
  }

  updateDocs(docs: Document[]) {
    this.docs = docs
    this.dropLocationDeterminer.updateDocs(docs);
  }

  /**
   * Get the model from HTMLElement target
   * @return {Model|null}
   */
  getTargetModel(el: HTMLElement) {
    const elem = el || this.targetElement;
    return $(elem).data('model');
  }

  updateTargetModel(el: HTMLElement) {
    this.targetElement = el || this.targetElement;
    if (!this.targetElement) return;
    this.targetModel = $(this.targetElement).data('model')
    this.dropLocationDeterminer.targetElement = this.targetElement
    this.dropLocationDeterminer.targetModel = this.targetModel
  }

  getTargetNode(el: HTMLElement) {
    return new this.treeClass(this.getTargetModel(el));
  }

  getSourceNode(el: HTMLElement) {
    return new this.treeClass(this.getTargetModel(el));
  }

  /**
   * Get the model of the current source element (element to drag)
   * @return {Model}
   */
  getSourceModel(source?: HTMLElement, { target, avoidChildren = 1 }: any = {}): Model {
    const { em, sourceElement: sourceEl } = this;
    const src = source || sourceEl;
    let { dropModel, dropContent } = this;
    const isTextable = (src: any) =>
      src && target && src.opt && src.opt.avoidChildren && this.isTextableActive(src, target);

    if (dropContent && em) {
      if (isTextable(dropModel)) {
        dropModel = undefined;
      }

      if (!dropModel) {
        const comps = em.Components.getComponents();
        const opts = {
          avoidChildren,
          avoidStore: 1,
          avoidUpdateStyle: 1,
        };
        const tempModel = comps.add(dropContent, { ...opts, temporary: true });
        // @ts-ignore
        dropModel = comps.remove(tempModel, opts as any);
        dropModel = dropModel instanceof Array ? dropModel[0] : dropModel;
        this.dropModel = dropModel;

        if (isTextable(dropModel)) {
          return this.getSourceModel(src, { target, avoidChildren: 0 });
        }
      }

      return dropModel!;
    }

    return src && $(src).data('model');
  }

  /**
   * Highlight target
   * @param  {Model|null} model
   */
  selectTargetModel(model?: Model, source?: Model) {
    // if (model instanceof Collection) {
    //   return;
    // }

    // Prevents loops in Firefox
    // https://github.com/GrapesJS/grapesjs/issues/2911
    if (source && source === model) return;

    const { targetModel } = this;

    // Reset the previous model but not if it's the same as the source
    // https://github.com/GrapesJS/grapesjs/issues/2478#issuecomment-570314736
    if (targetModel && targetModel !== this.sourceModel) {
      targetModel.set && targetModel.set('status', '');
    }

    if (model?.set) {
      const cv = this.em!.Canvas;
      const { Select, Hover, Spacing } = CanvasSpotBuiltInTypes;
      [Select, Hover, Spacing].forEach((type) => cv.removeSpots({ type }));
      cv.addSpot({ ...spotTarget, component: model as any });
      model.set('status', 'selected-parent');
      this.targetModel = model;
    }
  }

  clearFreeze() {
    this.sourceModel?.set && this.sourceModel.set('status', '');
  }

  /**
   * Handles the mouse move event during a drag operation.
   * It updates positions, manages placeholders, and triggers necessary events.
   *
   * @param {MouseEvent} mouseEvent - The mouse move event.
   * @private
   */
  private onMove(mouseEvent: MouseEvent): void {
    const customTarget = this.containerContext.customTarget;
    this.moved = true;

    this.showPlaceholder();
    /*-1-*/
    this.cacheContainerPosition(mouseEvent);

    const { mouseXRelativeToContainer, mouseYRelativeToContainer } = this.getMousePositionRelativeToContainer(mouseEvent);
    this.mouseXRelativeToContainer = mouseXRelativeToContainer;
    this.mouseYRelativeToContainer = mouseYRelativeToContainer;
    this.eventMove = mouseEvent;

    const sourceModel = this.getSourceModel();
    const targetEl = customTarget ? customTarget({ sorter: this, event: mouseEvent }) : mouseEvent.target;
    this.updateTargetModel(targetEl);
    const dims = this.dimsFromTarget(targetEl as HTMLElement, mouseXRelativeToContainer, mouseYRelativeToContainer);
    this.lastDims = dims;
    // const target = this.targetElement;
    // const targetModel = target && this.getTargetModel(target);
    /*-1-*/

    this.selectTargetModel(this.targetModel, sourceModel);
    if (!this.targetModel) this.hidePlaceholder();
    if (!this.targetElement) return;

    const pos = this.findPosition(dims, mouseXRelativeToContainer, mouseYRelativeToContainer);

    // @ts-ignore
    this.handleTextable(sourceModel, this.targetModel, mouseEvent, pos, dims);

    // @ts-ignore
    this.triggerOnMoveCallback(mouseEvent, sourceModel, this.targetModel, pos);

    // @ts-ignore
    this.triggerDragEvent(this.targetElement, this.targetModel, sourceModel, dims, pos, mouseXRelativeToContainer, mouseYRelativeToContainer);
  }

  /*-1-*/
  /**
   * Caches the container position and updates relevant variables for position calculation.
  *
  * @param {MouseEvent} mouseEvent - The current mouse event.
  * @private
  */
  private cacheContainerPosition(mouseEvent: MouseEvent): void {
    const containerOffset = this.offset(this.containerContext.container);
    this.elT = this.positionOptions.windowMargin ? Math.abs(containerOffset.top) : containerOffset.top;
    this.elL = this.positionOptions.windowMargin ? Math.abs(containerOffset.left) : containerOffset.left;
  }
  /*-1-*/

  /**
   * Gets the mouse position relative to the container, adjusting for scroll and canvas relative options.
   *
   * @param {MouseEvent} mouseEvent - The current mouse event.
   * @return {{ mouseXRelativeToContainer: number, mouseYRelativeToContainer: number }} - The mouse X and Y positions relative to the container.
   * @private
   */
  private getMousePositionRelativeToContainer(mouseEvent: MouseEvent): { mouseXRelativeToContainer: number, mouseYRelativeToContainer: number } {
    const { em } = this;
    let mouseYRelativeToContainer = mouseEvent.pageY - this.elT + this.getContainerEl().scrollTop;
    let mouseXRelativeToContainer = mouseEvent.pageX - this.elL + this.getContainerEl().scrollLeft;

    if (this.positionOptions.canvasRelative && em) {
      const mousePos = em.Canvas.getMouseRelativeCanvas(mouseEvent, { noScroll: 1 });
      mouseXRelativeToContainer = mousePos.x;
      mouseYRelativeToContainer = mousePos.y;
    }

    return { mouseXRelativeToContainer, mouseYRelativeToContainer };
  }

  /**
   * Handles the activation or deactivation of the textable state during a drag operation.
   *
   * @param {Model} sourceModel - The source model being dragged.
   * @param {Model} targetModel - The target model being dragged over.
   * @param {MouseEvent} ev - The mouse event.
   * @param {Object} pos - The position data of the placeholder.
   * @param {Object} dims - The dimensions of the target element.
   * @private
   */
  private handleTextable(sourceModel: Model, targetModel: Model, ev: MouseEvent, pos: any, dims: any): void {
    if (this.isTextableActive(sourceModel, targetModel)) {
      this.activateTextable(targetModel, ev, pos, this.containerContext.placeholderElement);
    } else {
      this.deactivateTextable();

      if (this.isPointerPositionChanged(pos)) {
        this.updatePlaceholderPosition(dims, pos);
      }
    }
  }

  /**
   * Triggers the `onMove` callback function if it exists.
   *
   * @param {MouseEvent} mouseEvent - The current mouse event.
   * @param {Model} sourceModel - The source model being dragged.
   * @param {Model} targetModel - The target model being dragged over.
   * @param {Object} pos - The position data.
   * @private
   */
  private triggerOnMoveCallback(mouseEvent: MouseEvent, sourceModel: Model, targetModel: Model, pos: any): void {
    if (isFunction(this.eventHandlers?.onMove)) {
      this.eventHandlers?.onMove({
        event: mouseEvent,
        target: sourceModel,
        parent: targetModel,
        index: pos.index + (pos.method === 'after' ? 1 : 0),
      });
    }
  }

  /**
   * Triggers the `sorter:drag` event on the event manager (em).
   *
   * @param {HTMLElement} target - The target element being dragged over.
   * @param {Model} targetModel - The target model being dragged over.
   * @param {Model} sourceModel - The source model being dragged.
   * @param {Object} dims - The dimensions of the target element.
   * @param {Object} pos - The position data.
   * @param {number} mouseXRelativeToContainer - The mouse X position relative to the container.
   * @param {number} mouseYRelativeToContainer - The mouse Y position relative to the container.
   * @private
   */
  private triggerDragEvent(target: HTMLElement, targetModel: Model, sourceModel: Model, dims: any, pos: any, mouseXRelativeToContainer: number, mouseYRelativeToContainer: number): void {
    if (this.em) {
      this.em.trigger('sorter:drag', {
        target,
        targetModel,
        sourceModel,
        dims,
        pos,
        x: mouseXRelativeToContainer,
        y: mouseYRelativeToContainer,
      });
    }
  }

  private activateTextable(targetModel: Model<any, SetOptions, any> | undefined, mouseEvent: MouseEvent, pos: Position | undefined, placeholderElement: HTMLElement | undefined) {
    this.activeTextModel = targetModel;
    if (placeholderElement) placeholderElement.style.display = 'none';
    this.lastPos = pos;
    this.updateTextViewCursorPosition(mouseEvent);
  }

  private deactivateTextable() {
    this.disableTextable();
    delete this.activeTextModel;
  }

  private isPointerPositionChanged(pos: Position) {
    return !this.lastPos || this.lastPos.index !== pos.index || this.lastPos.method !== pos.method;
  }

  private updatePlaceholderPosition(dims: Dimension[], pos: Position | undefined) {
    const { placeholderElement } = this.containerContext;
    //@ts-ignore
    this.movePlaceholder(placeholderElement!, dims, pos, this.prevTargetDim);
    this.ensure$PlaceholderElement();

    if (!this.positionOptions.canvasRelative) {
      this.adjustPlaceholderOffset();
    }

    this.lastPos = pos;
  }

  private adjustPlaceholderOffset() {
    if (this.positionOptions.offsetTop) {
      this.$placeholderElement.css('top', '+=' + this.positionOptions.offsetTop + 'px');
    }
    if (this.positionOptions.offsetLeft) {
      this.$placeholderElement.css('left', '+=' + this.positionOptions.offsetLeft + 'px');
    }
  }

  private showPlaceholder() {
    this.containerContext.placeholderElement!.style.display = 'block';
  }

  private ensure$PlaceholderElement() {
    if (!this.$placeholderElement) this.$placeholderElement = $(this.containerContext.placeholderElement!);
  }

  isTextableActive(src: any, trg: any): boolean {
    return !!(src?.get?.('textable') && trg?.isInstanceOf('text'));
  }

  disableTextable() {
    const { activeTextModel } = this;
    // @ts-ignore
    activeTextModel?.getView().disableEditing();
    this.setContentEditable(activeTextModel, false);
  }

  /**
   * Determines if an element is in the normal flow of the document.
   * This checks whether the element is not floated or positioned in a way that removes it from the flow.
   *
   * @param  {HTMLElement} el - The element to check.
   * @param  {HTMLElement} [parent=document.body] - The parent element for additional checks (defaults to `document.body`).
   * @return {boolean} Returns `true` if the element is in flow, otherwise `false`.
   * @private
   */
  private isInFlow(el: HTMLElement, parent: HTMLElement = document.body): boolean {
    if (!el) return false;

    if (!this.isStyleInFlow(el, parent)) return false;

    return true;
  }

  /**
   * Checks if an element has styles that keep it in the document flow.
   * Considers properties like `float`, `position`, and certain display types.
   *
   * @param  {HTMLElement} el - The element to check.
   * @param  {HTMLElement} parent - The parent element for additional style checks.
   * @return {boolean} Returns `true` if the element is styled to be in flow, otherwise `false`.
   * @private
   */
  private isStyleInFlow(el: HTMLElement, parent: HTMLElement): boolean {
    if (this.isTextNode(el)) return false;

    const elementStyles = el.style || {};
    const $el = $(el);
    const $parent = $(parent);

    // Check overflow property
    if (elementStyles.overflow && elementStyles.overflow !== 'visible') return false;

    // Check float property
    const elementFloat = $el.css('float');
    if (elementFloat && elementFloat !== 'none') return false;

    // Check parent for flexbox display and non-column flex-direction
    if ($parent.css('display') === 'flex' && $parent.css('flex-direction') !== 'column') return false;

    // Check position property
    if (!this.isInFlowPosition(elementStyles.position)) return false;

    // Check tag and display properties
    return this.isFlowElementTag(el) || this.isFlowElementDisplay($el);
  }

  /**
   * Determines if the element's `position` style keeps it in the flow.
   *
   * @param {string} position - The position style of the element.
   * @return {boolean} Returns `true` if the position keeps the element in flow.
   * @private
   */
  private isInFlowPosition(position: string): boolean {
    switch (position) {
      case 'static':
      case 'relative':
      case '':
        return true;
      default:
        return false;
    }
  }

  /**
   * Checks if the element's tag name represents an element typically in flow.
   *
   * @param {HTMLElement} el - The element to check.
   * @return {boolean} Returns `true` if the tag name represents a flow element.
   * @private
   */
  private isFlowElementTag(el: HTMLElement): boolean {
    const flowTags = ['TR', 'TBODY', 'THEAD', 'TFOOT'];
    return flowTags.includes(el.tagName);
  }

  /**
   * Checks if the element's display style keeps it in flow.
   *
   * @param {JQuery} $el - The jQuery-wrapped element to check.
   * @return {boolean} Returns `true` if the display style represents a flow element.
   * @private
   */
  private isFlowElementDisplay($el: JQuery): boolean {
    const display = $el.css('display');
    const flowDisplays = ['block', 'list-item', 'table', 'flex', 'grid'];
    return flowDisplays.includes(display);
  }

  /**
   * Checks if the node is a text node.
   *
   * @param {Node} node - The node to check.
   * @return {boolean} Returns `true` if the node is a text node, otherwise `false`.
   * @private
   */
  private isTextNode(node: Node): boolean {
    return node.nodeType === Node.TEXT_NODE;
  }

  /**
   * Check if the target is valid with the actual source
   * @param  {HTMLElement} trg
   * @return {Boolean}
   */
  validTarget(trg: HTMLElement, src?: HTMLElement) {
    const pos = this.lastPos;
    const trgModel = this.getTargetModel(trg);
    const srcModel = this.getSourceModel(src, { target: trgModel });
    // @ts-ignore
    if (!trgModel?.view?.el || !srcModel?.view?.el) {
      return {
        valid: false,
        src,
        srcModel,
        trg,
        trgModel
      };
    }

    // @ts-ignore
    src = srcModel?.view?.el;
    trg = trgModel.view.el;
    const targetNode = new this.treeClass(trgModel);
    const sourceNode = new this.treeClass(srcModel);

    const targetChildren = targetNode.getChildren();
    if (!targetChildren) {
      return {
        valid: false,
        src,
        srcModel,
        trg,
        trgModel
      };
    }
    const length = targetChildren.length;
    const index = pos ? (pos.method === 'after' ? pos.indexEl + 1 : pos.indexEl) : length;
    const canMove = targetNode.canMove(sourceNode, index);

    return {
      valid: canMove,
      src,
      srcModel,
      trg,
      trgModel
    };
  }

  /**
   * Get dimensions of nodes relative to the coordinates.
   *
   * @param {HTMLElement} target - The target element.
   * @param {number} [rX=0] - Relative X position.
   * @param {number} [rY=0] - Relative Y position.
   * @return {Dimension[]} - The dimensions array of the target and its valid parents.
   * @private
   */
  private dimsFromTarget(target: HTMLElement, rX = 0, rY = 0): Dimension[] {
    const em = this.em;
    let dims: Dimension[] = [];

    if (!target) return dims;

    target = this.getValidTarget(target)!;

    if (!target) return dims;

    if (this.isNewTarget(target)) {
      this.handleNewTarget(target, rX, rY);
    }

    dims = this.getTargetDimensions(target, rX, rY);

    this.clearLastPosition();

    return dims;
  }

  /**
   * Get a valid target by checking if the target matches specific selectors
   * and if not, find the closest valid target.
   *
   * @param {HTMLElement} target - The target element.
   * @return {HTMLElement | null} - The valid target element or null if none found.
   * @private
   */
  private getValidTarget(target: HTMLElement): HTMLElement | null {
    if (!this.matches(target, `${this.containerContext.itemSel}, ${this.containerContext.containerSel}`)) {
      target = this.closest(target, this.containerContext.itemSel)!;
    }

    return target;
  }

  /**
   * Checks if the provided target is different from the previous one.
   *
   * @param {HTMLElement} target - The target element.
   * @return {boolean} - Whether the target is a new one.
   * @private
   */
  private isNewTarget(target: HTMLElement): boolean {
    if (this.prevTargetElement && this.prevTargetElement !== target) {
      delete this.prevTargetElement;
    }

    return !this.prevTargetElement;
  }

  /**
   * Handle the initialization of a new target, caching dimensions and validating
   * if the target is valid for sorting.
   *
   * @param {HTMLElement} target - The new target element.
   * @param {number} rX - Relative X position.
   * @param {number} rY - Relative Y position.
   * @private
   */
  private handleNewTarget(target: HTMLElement, rX: number, rY: number): void {
    const em = this.em;

    this.targetP = this.closest(target, this.containerContext.containerSel);

    const validResult = this.validTarget(target);
    em && em.trigger('sorter:drag:validation', validResult);

    if (!validResult.valid && this.targetP) {
      this.dimsFromTarget(this.targetP, rX, rY);
      return;
    }

    this.prevTargetElement = target;
    this.prevTargetDim = this.getDim(target);
    this.cacheDimsP = this.getChildrenDim(this.targetP!);
    this.cacheDims = this.getChildrenDim(target);
  }

  /**
   * Retrieve and return the dimensions for the target, considering any potential
   * parent element dimensions if necessary.
   *
   * @param {HTMLElement} target - The target element.
   * @param {number} rX - Relative X position.
   * @param {number} rY - Relative Y position.
   * @return {Dimension[]} - The dimensions array of the target.
   * @private
   */
  private getTargetDimensions(target: HTMLElement, rX: number, rY: number): Dimension[] {
    let dims = this.cacheDims!;

    if (this.nearBorders(this.prevTargetDim!, rX, rY) || (!this.dragBehavior.nested && !this.cacheDims!.length)) {
      const targetParent = this.targetP;

      if (targetParent && this.validTarget(targetParent).valid) {
        dims = this.cacheDimsP!;
        this.targetElement = targetParent;
      }
    }

    this.targetElement = this.prevTargetElement;

    return dims;
  }

  /**
   * Clears the last known position data.
   *
   * @private
   */
  private clearLastPosition(): void {
    delete this.lastPos;
  }

  /**
   * Get valid target from element
   * This method should replace dimsFromTarget()
   * @param  {HTMLElement} el
   * @return {HTMLElement}
   */
  getTargetFromEl(el: HTMLElement): HTMLElement {
    let target = el;
    let targetParent;
    let targetPrev = this.targetPrev;
    const em = this.em;
    const containerSel = this.containerContext.containerSel;
    const itemSel = this.containerContext.itemSel;

    // Select the first valuable target
    if (!this.matches(target, `${itemSel}, ${containerSel}`)) {
      target = this.closest(target, itemSel)!;
    }

    // Check if the target is different from the previous one
    if (targetPrev && targetPrev != target) {
      delete this.targetPrev;
    }

    // New target found
    if (!this.targetPrev) {
      targetParent = this.closest(target, containerSel);

      // If the current target is not valid (src/trg reasons) try with
      // the parent one (if exists)
      const validResult = this.validTarget(target);
      em && em.trigger('sorter:drag:validation', validResult);

      if (!validResult.valid && targetParent) {
        return this.getTargetFromEl(targetParent);
      }

      this.targetPrev = target;
    }

    // Generally, on any new target the poiner enters inside its area and
    // triggers nearBorders(), so have to take care of this
    if (this.nearElBorders(target)) {
      targetParent = this.closest(target, containerSel);

      if (targetParent && this.validTarget(targetParent).valid) {
        target = targetParent;
      }
    }

    return target;
  }

  /**
   * Check if the current pointer is near to element borders
   * @return {Boolen}
   */
  nearElBorders(el: HTMLElement) {
    const off = 10;
    const rect = el.getBoundingClientRect();
    const body = el.ownerDocument.body;
    const { x, y } = this.getCurrentPos();
    const top = rect.top + body.scrollTop;
    const left = rect.left + body.scrollLeft;
    const width = rect.width;
    const height = rect.height;

    if (
      y < top + off || // near top edge
      y > top + height - off || // near bottom edge
      x < left + off || // near left edge
      x > left + width - off // near right edge
    ) {
      return 1;
    }
  }

  getCurrentPos() {
    const ev = this.eventMove;
    const x = ev?.pageX || 0;
    const y = ev?.pageY || 0;
    return { x, y };
  }

  /**
   * Returns dimensions and positions about the element
   * @param {HTMLElement} el
   * @return {Array<number>}
   */
  getDim(el: HTMLElement): Dimension {
    const { em } = this;
    const canvasRelative = this.positionOptions.canvasRelative;
    const canvas = em?.Canvas;
    const offsets = canvas ? canvas.getElementOffsets(el) : {};
    let top, left, height, width;

    if (canvasRelative && em) {
      const pos = canvas!.getElementPos(el, { noScroll: 1 })!;
      top = pos.top; // - offsets.marginTop;
      left = pos.left; // - offsets.marginLeft;
      height = pos.height; // + offsets.marginTop + offsets.marginBottom;
      width = pos.width; // + offsets.marginLeft + offsets.marginRight;
    } else {
      var o = this.offset(el);
      top = this.positionOptions.relative ? el.offsetTop : o.top - (this.positionOptions.windowMargin ? -1 : 1) * this.elT;
      left = this.positionOptions.relative ? el.offsetLeft : o.left - (this.positionOptions.windowMargin ? -1 : 1) * this.elL;
      height = el.offsetHeight;
      width = el.offsetWidth;
    }

    return { top, left, height, width, offsets };
  }

  /**
   * Get children dimensions
   * @param {HTMLELement} el Element root
   * @return {Array}
   * */
  getChildrenDim(trg: HTMLElement) {
    const dims: Dimension[] = [];
    if (!trg) return dims;

    // Get children based on getChildrenContainer
    const trgModel = this.getTargetModel(trg);
    if (trgModel && trgModel.view && !this.dragBehavior.ignoreViewChildren) {
      const view = trgModel.getCurrentView ? trgModel.getCurrentView() : trgModel.view;
      trg = view.getChildrenContainer();
    }

    each(trg.children, (ele, i) => {
      const el = ele as HTMLElement;
      const model = getModel(el, $);
      const elIndex = model && model.index ? model.index() : i;

      if (!isTextNode(el) && !this.matches(el, this.containerContext.itemSel)) {
        return;
      }

      const dim = this.getDim(el);
      let dir = this.dragBehavior.dragDirection;
      let dirValue: boolean;

      if (dir === SorterDirection.Vertical) dirValue = true;
      else if (dir === SorterDirection.Horizontal) dirValue = false;
      else dirValue = this.isInFlow(el, trg);

      dim.dir = dirValue;
      dim.el = el;
      dim.indexEl = elIndex;
      dims.push(dim);
    });

    return dims;
  }

  /**
   * Check if the coordinates are near to the borders
   * @param {Array<number>} dim
   * @param {number} rX Relative X position
   * @param {number} rY Relative Y position
   * @return {Boolean}
   * */
  nearBorders(dim: Dimension, rX: number, rY: number) {
    let result = false;
    const off = this.positionOptions.borderOffset;
    const x = rX || 0;
    const y = rY || 0;
    const t = dim.top;
    const l = dim.left;
    const h = dim.height;
    const w = dim.width;
    if (t + off > y || y > t + h - off || l + off > x || x > l + w - off) result = true;

    return result;
  }

  /**
   * Find the position based on passed dimensions and coordinates
   * @param {Array<Array>} dims Dimensions of nodes to parse
   * @param {number} posX X coordindate
   * @param {number} posY Y coordindate
   * @return {Object}
   * */
  findPosition(dims: Dimension[], posX: number, posY: number): Position {
    const result: Position = { index: 0, indexEl: 0, method: 'before' };
    let leftLimit = 0;
    let xLimit = 0;
    let dimRight = 0;
    let yLimit = 0;
    let xCenter = 0;
    let yCenter = 0;
    let dimDown = 0;
    let dim: Dimension;

    // Each dim is: Top, Left, Height, Width
    for (var i = 0, len = dims.length; i < len; i++) {
      dim = dims[i];
      const { top, left, height, width } = dim;
      // Right position of the element. Left + Width
      dimRight = left + width;
      // Bottom position of the element. Top + Height
      dimDown = top + height;
      // X center position of the element. Left + (Width / 2)
      xCenter = left + width / 2;
      // Y center position of the element. Top + (Height / 2)
      yCenter = top + height / 2;
      // Skip if over the limits
      if (
        (xLimit && left > xLimit) ||
        (yLimit && yCenter >= yLimit) || // >= avoid issue with clearfixes
        (leftLimit && dimRight < leftLimit)
      )
        continue;
      result.index = i;
      result.indexEl = dim.indexEl!;
      // If it's not in flow (like 'float' element)
      if (!dim.dir) {
        if (posY < dimDown) yLimit = dimDown;
        //If x lefter than center
        if (posX < xCenter) {
          xLimit = xCenter;
          result.method = 'before';
        } else {
          leftLimit = xCenter;
          result.method = 'after';
        }
      } else {
        // If y upper than center
        if (posY < yCenter) {
          result.method = 'before';
          break;
        } else result.method = 'after'; // After last element
      }
    }

    return result;
  }

  /**
   * Updates the position of the placeholder.
   * @param {HTMLElement} placeholder Placeholder element.
   * @param {Dimension[]} elementsDimension Array of element dimensions.
   * @param {Position} position Object representing position details (index and method).
   * @param {Dimension} [targetDimension] Optional target dimensions ([top, left, height, width]).
   */
  private movePlaceholder(
    placeholder: HTMLElement,
    elementsDimension: Dimension[],
    position: Position,
    targetDimension?: Dimension
  ) {
    const marginOffset = 0;
    const placeholderMargin = 5;
    const unit = 'px';
    let top = 0;
    let left = 0;
    let width = '';
    let height = '';

    const { method, index } = position;
    const elementDimension = elementsDimension[index];

    this.setPlaceholderOrientation(placeholder, elementDimension);

    if (elementDimension) {
      const { top: elTop, left: elLeft, height: elHeight, width: elWidth, dir } = elementDimension;

      if (!dir) {
        // If element is not in flow (e.g., a floating element)
        width = 'auto';
        height = (elHeight - marginOffset * 2) + unit;
        top = elTop + marginOffset;
        left = method === 'before' ? elLeft - marginOffset : elLeft + elWidth - marginOffset;

        this.setPlaceholderVertical(placeholder);
      } else {
        width = elWidth + unit;
        height = 'auto';
        top = method === 'before' ? elTop - marginOffset : elTop + elHeight - marginOffset;
        left = elLeft;
      }
    } else {
      this.handleNestedPlaceholder(placeholder, placeholderMargin, targetDimension);
    }

    this.updatePlaceholderStyles(placeholder, top, left, width, height);
  }

  /**
   * Sets the orientation of the placeholder based on the element dimensions.
   * @param {HTMLElement} placeholder Placeholder element.
   * @param {Dimension} elementDimension Dimensions of the element at the index.
   */
  private setPlaceholderOrientation(placeholder: HTMLElement, elementDimension?: Dimension) {
    placeholder.classList.remove('vertical');
    placeholder.classList.add('horizontal');

    if (elementDimension && !elementDimension.dir) {
      this.setPlaceholderVertical(placeholder);
    }
  }

  /**
   * Sets the placeholder's class to vertical.
   * @param {HTMLElement} placeholder Placeholder element.
   */
  private setPlaceholderVertical(placeholder: HTMLElement) {
    placeholder.classList.remove('horizontal');
    placeholder.classList.add('vertical');
  }

  /**
   * Handles the case where the placeholder is nested inside a component.
   * @param {HTMLElement} placeholder Placeholder element.
   * @param {Dimension} targetDimension Target element dimensions.
   * @param {number} marginOffset Margin offset value.
   */
  private handleNestedPlaceholder(
    placeholder: HTMLElement,
    marginOffset: number,
    targetDimension?: Dimension,
  ) {
    if (!this.dragBehavior.nested || !targetDimension) {
      placeholder.style.display = 'none';
      return;
    }

    const { top: trgTop, left: trgLeft, width: trgWidth, offsets } = targetDimension;
    const paddingTop = offsets?.paddingTop || marginOffset;
    const paddingLeft = offsets?.paddingLeft || marginOffset;
    const borderTopWidth = offsets?.borderTopWidth || 0;
    const borderLeftWidth = offsets?.borderLeftWidth || 0;
    const borderRightWidth = offsets?.borderRightWidth || 0;

    const borderWidth = borderLeftWidth + borderRightWidth;
    const top = trgTop + paddingTop + borderTopWidth;
    const left = trgLeft + paddingLeft + borderLeftWidth;
    const width = trgWidth - paddingLeft * 2 - borderWidth + 'px';

    this.updatePlaceholderStyles(placeholder, top, left, width, 'auto');
  }

  /**
   * Updates the CSS styles of the placeholder element.
   * @param {HTMLElement} placeholder Placeholder element.
   * @param {number} top Top position of the placeholder.
   * @param {number} left Left position of the placeholder.
   * @param {string} width Width of the placeholder.
   * @param {string} height Height of the placeholder.
   */
  private updatePlaceholderStyles(
    placeholder: HTMLElement,
    top: number,
    left: number,
    width: string,
    height: string
  ) {
    placeholder.style.top = top + 'px';
    placeholder.style.left = left + 'px';
    if (width) placeholder.style.width = width;
    if (height) placeholder.style.height = height;
  }

  /**
   * Build an array of all the parents, including the component itself
   * @return {Model|null}
   */
  parents(model: any): any[] {
    return model ? [model].concat(this.parents(model.parent())) : [];
  }

  /**
   * Sort according to the position in the dom
   * @param {Object} obj1 contains {model, parents}
   * @param {Object} obj2 contains {model, parents}
   */
  sort(obj1: any, obj2: any) {
    // common ancesters
    const ancesters = obj1.parents.filter((p: any) => obj2.parents.includes(p));
    const ancester = ancesters[0];
    if (!ancester) {
      // this is never supposed to happen
      return obj2.model.index() - obj1.model.index();
    }
    // find siblings in the common ancester
    // the sibling is the element inside the ancester
    const s1 = obj1.parents[obj1.parents.indexOf(ancester) - 1];
    const s2 = obj2.parents[obj2.parents.indexOf(ancester) - 1];
    // order according to the position in the DOM
    return s2.index() - s1.index();
  }

  /**
   * End the move action.
   * Handles the cleanup and final steps after an item is moved.
   */
  endMove(): void {
    const { sourceElement: src, eventHandlers, targetElement: target, lastPos } = this;
    const container = this.getContainerEl();
    const docs = this.getDocuments();
    let srcModel;

    this.cleanupEventListeners(container, docs);
    this.hidePlaceholder();

    if (src) {
      srcModel = this.getSourceModel();
    }

    const moved = this.handleMove(target!, src!, lastPos!);

    this.finalizeMove(moved, srcModel);
    this.cleanupAfterMove();

    if (isFunction(eventHandlers?.onEndMove)) {
      this.triggerEndMoveEvent(srcModel, moved);
    }

    isFunction(eventHandlers?.onEnd) && eventHandlers?.onEnd({ sorter: this });
  }

  /**
   * Clean up event listeners that were attached during the move.
   *
   * @param {HTMLElement} container - The container element.
   * @param {Document[]} docs - List of documents.
   * @private
   */
  private cleanupEventListeners(container: HTMLElement, docs: Document[]): void {
    off(container, 'mousemove dragover', this.onMove as any);
    off(docs, 'mouseup dragend touchend', this.endMove);
    off(docs, 'keydown', this.rollback);
  }

  /**
   * Hide the placeholder element if it exists.
   * 
   * @private
   */
  private hidePlaceholder(): void {
    if (this.containerContext.placeholderElement) {
      this.containerContext.placeholderElement.style.display = 'none';
    }
  }

  /**
   * Handle the actual move of the element(s).
   *
   * @param {HTMLElement | null} target - The target element.
   * @param {HTMLElement | null} src - The source element.
   * @param {Position | null} lastPos - The last known position of the element.
   * @return {HTMLElement[]} - An array of moved elements.
   * @private
   */
  private handleMove(target: HTMLElement | null, src: HTMLElement | null, lastPos: Position | null): HTMLElement[] {
    const moved: HTMLElement[] = [];
    const toMove = this.toMove;
    const toMoveArr = isArray(toMove) ? toMove : toMove ? [toMove] : [src];
    let domPositionOffset = 0;

    if (toMoveArr.length === 1) {
      moved.push(this.move(target!, toMoveArr[0]!, lastPos!));
    } else {
      toMoveArr
        .map((model) => ({
          model,
          parents: this.parents(model),
        }))
        .sort(this.sort)
        .forEach(({ model }) => {
          // @ts-ignore
          const index = model.index();
          // @ts-ignore
          const parent = model.parent().getEl();

          moved.push(
            this.move(target!, model!, {
              ...lastPos!,
              indexEl: lastPos!.indexEl - domPositionOffset,
              index: lastPos!.index - domPositionOffset,
            }),
          );

          if (parent === target && index <= lastPos!.index) {
            domPositionOffset++;
          }
        });
    }

    return moved;
  }

  /**
   * Finalize the move by removing any helpers and selecting the target model.
   * 
   * @private
   */
  private finalizeMove(moved: HTMLElement[], srcModel: any): void {
    this.removeDropTargetIndicator();
    this.disableTextable();
    this.selectTargetModel();
    this.clearFreeze();
    this.toggleSortCursor();
    // @ts-ignore
    this.em?.Canvas.removeSpots(this.spotTarget);

    delete this.toMove;
    delete this.eventMove;
    delete this.dropModel;
  }

  /**
   * Remove the drag helper or drop target indicator.
   * 
   * @private
   */
  private removeDropTargetIndicator(): void {
    const dragHelper = this.dropTargetIndicator;

    if (dragHelper) {
      dragHelper.parentNode!.removeChild(dragHelper);
      delete this.dropTargetIndicator;
    }
  }

  /**
   * Trigger the `onEndMove` event with the relevant data.
   * 
   * @param {any} srcModel - The source model.
   * @param {HTMLElement[]} moved - The moved elements.
   * @private
   */
  private triggerEndMoveEvent(srcModel: any, moved: HTMLElement[]): void {
    const onEndMove = this.eventHandlers?.onEndMove;
    const data = {
      target: srcModel,
      parent: srcModel?.parent(),
      index: srcModel?.index(),
    };

    moved.length
      ? moved.forEach((m) => onEndMove!(m, this, data))
      : onEndMove!(null, this, { ...data, cancelled: 1 });
  }

  /**
   * Clean up after the move operation is completed.
   *
   * @private
   */
  private cleanupAfterMove(): void {
    delete this.toMove;
    delete this.eventMove;
    delete this.dropModel;
  }

  /**
   * Move component to new position
   * @param {HTMLElement} dst Destination target
   * @param {HTMLElement} src Element to move
   * @param {Object} pos Object with position coordinates
   * */
  move(dst: HTMLElement, src: HTMLElement | Model, pos: Position) {
    const { em, dropContent } = this;
    const srcEl = getElement(src as HTMLElement);
    const warns: string[] = [];
    const index = pos.method === 'after' ? pos.indexEl + 1 : pos.indexEl;
    const validResult = this.validTarget(dst, srcEl);
    const { trgModel, srcModel } = validResult;
    const targetNode = new this.treeClass(trgModel);
    const sourceNode = new this.treeClass(srcModel);
    const targetCollection = targetNode.getChildren();
    const sourceParent = sourceNode.getParent();
    let modelToDrop, created;

    if (!targetCollection && em) {
      // const dropInfo = validResult.dropInfo || trgModel?.get('droppable');
      // const dragInfo = validResult.dragInfo || srcModel?.get('draggable');

      !targetCollection && warns.push('Target collection not found');
      // !droppable && dropInfo && warns.push(`Target is not droppable, accepts [${dropInfo}]`);
      // !draggable && dragInfo && warns.push(`Component not draggable, acceptable by [${dragInfo}]`);
      em.logWarning('Invalid target position', {
        errors: warns,
        model: srcModel,
        context: 'sorter',
        target: trgModel,
      });

      em?.trigger('sorter:drag:end', {
        targetCollection,
        modelToDrop,
        warns,
        validResult,
        dst,
        srcEl,
      });

      return
    }

    const opts: any = { at: index, action: 'move-component' };
    const isTextable = this.isTextableActive(srcModel, trgModel);

    if (!dropContent) {
      const srcIndex = sourceParent?.indexOfChild(sourceNode);
      const trgIndex = targetNode?.indexOfChild(sourceNode);
      const isDraggingIntoSameCollection = trgIndex !== -1;
      if (isUndefined(srcIndex)) {
        return;
      }

      if (isDraggingIntoSameCollection && index > srcIndex) {
        opts.at = index - 1;
      }
      modelToDrop = sourceParent?.removeChildAt(srcIndex)
    } else {
      // @ts-ignore
      modelToDrop = isFunction(dropContent) ? dropContent() : dropContent;
      opts.avoidUpdateStyle = true;
      opts.action = 'add-component';
    }

    if (modelToDrop) {
      if (isTextable) {
        delete opts.at;
        created = trgModel.getView().insertComponent(modelToDrop, opts);
      } else {
        created = targetNode.addChildAt(modelToDrop, opts.at).model;
      }
    }

    delete this.dropContent;
    delete this.prevTargetElement; // This will recalculate children dimensions
    em?.trigger('sorter:drag:end', {
      targetCollection,
      modelToDrop,
      warns,
      validResult,
      dst,
      srcEl,
    });

    return created;
  }

  /**
   * Rollback to previous situation.
   *
   * @param {KeyboardEvent} e - The keyboard event object.
   */
  rollback(e: KeyboardEvent) {
    off(this.getDocuments(), 'keydown', this.rollback);
    const ESC_KEY = 'Escape';

    if (e.key === ESC_KEY) {
      this.moved = false;
      this.endMove();
    }
  }
}
