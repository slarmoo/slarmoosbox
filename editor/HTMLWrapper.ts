// Copyright (C) 2020 John Nesky, distributed under the MIT license.
// A few wrapper classes that add functionality onto existing HTML elements, namely binding some events to an implementation-specified change class

import { Change } from "./Change";
import { ColorConfig } from "./ColorConfig";
import { SongDocument } from "./SongDocument";
import { HTML, SVG } from "imperative-html/dist/esm/elements-strict";

const { span } = HTML;

export class InputBox {
    private _change: Change | null = null;
    private _value: string = "";
    private _oldValue: string = "";

    constructor(public readonly input: HTMLInputElement, private readonly _doc: SongDocument, private readonly _getChange: (oldValue: string, newValue: string) => Change) {
        input.addEventListener("input", this._whenInput);
        input.addEventListener("change", this._whenChange);
    }

    public updateValue(value: string): void {
        this._value = value;
        this.input.value = String(value);
    }

    private _whenInput = (): void => {
        const continuingProspectiveChange: boolean = this._doc.lastChangeWas(this._change);
        if (!continuingProspectiveChange) this._oldValue = this._value;
        this._change = this._getChange(this._oldValue, this.input.value);
        this._doc.setProspectiveChange(this._change);
    };

    private _whenChange = (): void => {
        this._doc.record(this._change!);
        this._change = null;
    };
}

export class Slider {
    private _change: Change | null = null;
    private _value: number = 0;
    private _oldValue: number = 0;
    public container: HTMLSpanElement;

    constructor(public readonly input: HTMLInputElement, private readonly _doc: SongDocument, private readonly _getChange: ((oldValue: number, newValue: number) => Change) | null, midTick: boolean) {
        // A container is created around the input to allow for spec-compliant pseudo css classes (e.g ::before and ::after, which must be added to containers, not the input itself)
        this.container = (midTick) ? span({ class: "midTick", style: "position: sticky; width: 61.5%;" }, input) : span({ style: "position: sticky;" }, input);
        input.addEventListener("input", this._whenInput);
        input.addEventListener("change", this._whenChange);
    }

    public updateValue(value: number): void {
        this._value = value;
        this.input.value = String(value);
    }

    private _whenInput = (): void => {
        const continuingProspectiveChange: boolean = this._doc.lastChangeWas(this._change);
        if (!continuingProspectiveChange) this._oldValue = this._value;
        if (this._getChange != null) {
            this._change = this._getChange(this._oldValue, parseFloat(this.input.value));
            this._doc.setProspectiveChange(this._change);
        }
    };

    public getValueBeforeProspectiveChange(): number {
        return this._oldValue;
    }

    private _whenChange = (): void => {
        if (this._getChange != null) {
            this._doc.record(this._change!);
            this._change = null;
        }
    };
}

export class DoubleSlider {
    private _change: Change | null = null;
    private _valueLeft: number = 0;
    private _oldValueLeft: number = 0;
    private _valueRight: number = 0;
    private _oldValueRight: number = 0;
    public container: HTMLSpanElement;
    private leftThumb: SVGGElement;
    private rightThumb: SVGGElement;
    private bar: SVGRectElement;
    private _svg: SVGSVGElement;

    private static readonly width: number = 113;

    constructor(
        private readonly _doc: SongDocument,
        private readonly _getChangeLeft: ((oldValue: number, newValue: number) => Change) | null,
        private readonly _getChangeRight: ((oldValue: number, newValue: number) => Change) | null,
        leftInitial: number,
        rightInitial: number,
        public min: number,
        public max: number,
        midTick: boolean
    ) {
        this._valueLeft = leftInitial;
        this._valueRight = rightInitial;
        this._svg = SVG.svg({ style: `background-color: ${ColorConfig.editorBackground}; touch-action: none;`, width: "100%", height: "100%", viewBox: "0 -12 " + DoubleSlider.width + " 24", preserveAspectRatio: "none" });
        this.bar = SVG.rect({ fill: ColorConfig.uiWidgetBackground, x: 0, y: -3, width: 113, height: 6 });
        this.leftThumb = SVG.g();
        this.rightThumb = SVG.g();
        this.render();
        // A container is created around the input to allow for spec-compliant pseudo css classes (e.g ::before and ::after, which must be added to containers, not the input itself)
        this.container = span((midTick) ? { class: "midTick", style: "position: sticky; width: 61.5%;" } : { style: "position: sticky; flex: 3" }, this._svg);
        
        this.container.addEventListener("pointerdown", this._mouseDown);
        this.container.addEventListener("pointermove", this._mouseMove);
        this.container.addEventListener("pointerup", this._mouseUp);
        this.container.addEventListener("pointercancel", this._mouseUp);
    }

    public updateLeft(value: number, render: boolean = false): DoubleSlider {
        if (value <= this._valueRight) {
            this._valueLeft = value;
            if (render) this.render();
        }
        return this;
    }

    public updateRight(value: number, render: boolean = false): DoubleSlider {
        if (value >= this._valueLeft) {
            this._valueRight = value;
            if (render) this.render();
        }
        return this;
    }

    private mouseDown: DoubleSliderInputElements = DoubleSliderInputElements.none; 

    private getValueFromMouse(eventX: number) {
        const boundingRect: ClientRect = this._svg.getBoundingClientRect();
        let mouseX: number = (eventX - boundingRect.left) / (boundingRect.right - boundingRect.left);
        if (isNaN(mouseX)) return this.min;
        return Math.max(Math.min(Math.round(mouseX * this.max), this.max), this.min);
    }

    private _mouseDown = (event: PointerEvent) => {
        if (this.mouseDown != DoubleSliderInputElements.none) return;
        this.mouseDown = DoubleSliderInputElements.bar;
        this.container.setPointerCapture(event.pointerId)
        this._oldValueLeft = this._valueLeft;
        this._oldValueRight = this._valueRight;

        const position: number = this.getValueFromMouse(event.clientX || event.pageX);
        const midpoint = (this._valueLeft + this._valueRight) / 2;
        if (position < midpoint || position < this._valueLeft) {
            this.mouseDown = DoubleSliderInputElements.leftThumb;
        } else {
            this.mouseDown = DoubleSliderInputElements.rightThumb;
        }

        this._handleChangeEvent(position);
    }

    private _mouseMove = (event: PointerEvent): void => {
        if (this.mouseDown == DoubleSliderInputElements.none) return;
        
        this._handleChangeEvent(this.getValueFromMouse(event.clientX || event.pageX));
    };

    private _handleChangeEvent(position: number) {
        if (this.mouseDown == DoubleSliderInputElements.leftThumb && this._getChangeLeft != null) {
            this.updateLeft(position);
            this._change = this._getChangeLeft(this._oldValueLeft, this._valueLeft);
            if (this._change.isNoop()) this._doc.renderChanges();
            this._doc.setProspectiveChange(this._change);
        } else if (this.mouseDown == DoubleSliderInputElements.rightThumb && this._getChangeRight != null) {
            this.updateRight(position);
            this._change = this._getChangeRight(this._oldValueRight, this._valueRight);
            if (this._change.isNoop()) this._doc.renderChanges();
            this._doc.setProspectiveChange(this._change);
        }
        this.render();
    }

    public getLeftValueBeforeProspectiveChange(): number {
        return this._oldValueLeft;
    }

    public getRightValueBeforeProspectiveChange(): number {
        return this._oldValueRight;
    }

    private _mouseUp = (event: PointerEvent): void => {
        this.mouseDown = DoubleSliderInputElements.none;
        this.container.releasePointerCapture(event.pointerId);
        if ((this._getChangeLeft != null || this._getChangeRight != null) && this._change != null) {
            if (this._change.isNoop()) this._doc.renderChanges();
            this._doc.record(this._change);
            this._change = null;
        }
    };

    private render() {
        this.leftThumb.innerHTML = "";
        this.rightThumb.innerHTML = "";
        this.leftThumb.appendChild(this._thumb(this._valueLeft, true));
        this.rightThumb.appendChild(this._thumb(this._valueRight, false));
        this._svg.innerHTML = "";
        this._svg.appendChild(this.bar);
        this._svg.appendChild(this.leftThumb);
        this._svg.appendChild(this.rightThumb);
    }

    private _thumb(x: number, isLeft: boolean): SVGPathElement {
        const ratio: number = Math.floor(x / (this.max - this.min) * (DoubleSlider.width - 10)) + (isLeft ? 4.5 : 5.5);
        return SVG.path({ d: `M ${ratio} -12 A 4 4 0 0 ${isLeft ? 0 : 1} ${ratio + (isLeft ? -4 : 4)} -8 L ${ratio + (isLeft ? -4 : 4)} 8 A 4 4 0 0 ${isLeft ? 0 : 1} ${ratio} 12 `, "fill": "currentColor" })
            // SVG.circle({ cx: ratio, cy: -9, r: 3, "fill": "currentColor" }),
            // SVG.rect({ x: ratio - 3, y: -9, width: 6, height: 18, "fill": "currentColor" }),
            // SVG.circle({ cx: ratio, cy: 9, r: 3, "fill": "currentColor" }),
    }
}

const enum DoubleSliderInputElements {
    leftThumb,
    rightThumb,
    bar,
    none
}