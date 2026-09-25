// Copyright (C) 2020 John Nesky, distributed under the MIT license.
// A few wrapper classes that add functionality onto existing HTML elements, namely binding some events to an implementation-specified change class

import { Change, ChangeGroup } from "./Change";
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
    private _futureValueLeft: number = 0;
    private _futureValueRight: number = 0;
    public readonly container: HTMLSpanElement;
    private readonly leftThumb: SVGGElement;
    private readonly rightThumb: SVGGElement;
    private readonly leftThumbMod: SVGGElement;
    private readonly rightThumbMod: SVGGElement;
    private bar: SVGRectElement;
    private _svg: SVGSVGElement;

    private static readonly width: number = 113;

    constructor(
        private readonly _doc: SongDocument,
        private readonly _getChangeLeft: ((oldValue: number, newValue: number) => Change) | null,
        private readonly _getChangeRight: ((oldValue: number, newValue: number) => Change) | null,
        private readonly _getModValueLeft: () => number | null,
        private readonly _getModValueRight: () => number | null,
        leftInitial: number,
        rightInitial: number,
        public min: number,
        public max: number,
        /**0 == none, 1 == single, 2 == octaves */
        midTick: 0 | 1 | 2 
    ) {
        this._valueLeft = leftInitial;
        this._valueRight = rightInitial;
        this._futureValueLeft = leftInitial;
        this._futureValueRight = rightInitial;
        this.bar = SVG.rect({ fill: ColorConfig.uiWidgetBackground, x: 0, y: -3, width: 113, height: 6 });
        this.leftThumb = SVG.g();
        this.rightThumb = SVG.g();
        this.leftThumbMod = SVG.g();
        this.rightThumbMod = SVG.g();
        this._svg = SVG.svg({ style: `background-color: ${ColorConfig.editorBackground}; touch-action: none;`, width: "100%", height: "100%", viewBox: "0 -12 " + DoubleSlider.width + " 24", preserveAspectRatio: "none" },
            this.bar, 
            this.leftThumb, 
            this.rightThumb,
            this.leftThumbMod,
            this.rightThumbMod
        );

        this.render();
        // A container is created around the input to allow for spec-compliant pseudo css classes (e.g ::before and ::after, which must be added to containers, not the input itself)
        this.container = span((midTick == 1) ? { class: "midTick", style: "position: sticky; width: 61.5%;" } : { style: "position: sticky; flex: 3" }, this._svg);
        
        this.container.addEventListener("pointerdown", this._mouseDown);
        this.container.addEventListener("pointermove", this._mouseMove);
        this.container.addEventListener("pointerup", this._mouseUp);
        this.container.addEventListener("pointercancel", this._mouseUp);
    }

    public updateLeft(value: number): DoubleSlider {
        if (value <= this._valueRight && value >= this.min) {
            //delay the update
            this._futureValueLeft = value;
            if (!this.isModRecording) {
                this._valueLeft = this._futureValueLeft;
            }
        }
        return this;
    }

    public updateRight(value: number): DoubleSlider {
        if (value >= this._valueLeft && value <= this.max) {
            //delay the update
            this._futureValueRight = value;
            if (!this.isModRecording) {
                this._valueRight = this._futureValueRight;
            }
        }
        return this;
    }

    private mouseDown: DoubleSliderInputElements = DoubleSliderInputElements.none; 
    private isModRecording: boolean = false;

    private getValueFromMouse(eventX: number) {
        const boundingRect: ClientRect = this._svg.getBoundingClientRect();
        let mouseX: number = (eventX - boundingRect.left - 5) / (boundingRect.right - boundingRect.left - 10);
        if (isNaN(mouseX)) return this.min;
        return Math.round(mouseX * (this.max - this.min)) + this.min;
    }

    private _initialPosition: number;

    private _mouseDown = (event: PointerEvent) => {
        if (this.mouseDown != DoubleSliderInputElements.none) return;
        this.mouseDown = DoubleSliderInputElements.bar;
        this.container.setPointerCapture(event.pointerId)
        this.isModRecording = (event.shiftKey || event.ctrlKey) && this._doc.synth.playing;
        this._oldValueLeft = this._valueLeft;
        this._oldValueRight = this._valueRight;

        this._initialPosition = this.getValueFromMouse(event.clientX || event.pageX);
        const midpoint = (this._valueLeft + this._valueRight) / 2;
        const stepsFromPercent = (percent: number) => (this.max - this.min) * percent / 100; //to give a bit of wiggle room for grabbing thumbs / the center bar
        if (this._valueLeft == this.min && this._valueRight == this.max && this._initialPosition > this.min && this._initialPosition < this.max) {
            //special case: jump the closest thumb to mouse if they're both at the extremes
            if (this._initialPosition < midpoint || this._initialPosition < this._valueLeft) {
                this.mouseDown = DoubleSliderInputElements.leftThumb;
            } else {
                this.mouseDown = DoubleSliderInputElements.rightThumb;
            }
        }else if ((this._initialPosition > this._valueLeft + stepsFromPercent(4) && this._initialPosition < this._valueRight - stepsFromPercent(4)) ||
            (this._valueRight - this._valueLeft < stepsFromPercent(10) && this._initialPosition > this._valueLeft - stepsFromPercent(4) && this._initialPosition < this._valueRight + stepsFromPercent(4))) {
            this.mouseDown = DoubleSliderInputElements.bar;
        } else if (this._initialPosition <= this._valueLeft + stepsFromPercent(4)) {
            this.mouseDown = DoubleSliderInputElements.leftThumb;
        } else if (this._initialPosition >= this._valueRight - stepsFromPercent(4)) {
            this.mouseDown = DoubleSliderInputElements.rightThumb;
        }

        this._handleChangeEvent(this._initialPosition);
    }

    private _mouseMove = (event: PointerEvent): void => {
        if (this.mouseDown == DoubleSliderInputElements.none) return;
        this.isModRecording = (event.shiftKey || event.ctrlKey) && this._doc.synth.playing;
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
        } else if (this.mouseDown == DoubleSliderInputElements.bar && this._getChangeLeft != null && this._getChangeRight != null) {
            //move both, keeping the distance between
            const delta: number = position - this._initialPosition;
            if (delta < 0) {
                const newLeft: number = Math.max(this._valueLeft + delta, this.min);
                this._valueRight -= this._valueLeft - newLeft;
                this._valueLeft = newLeft;
            } else if (delta > 0) {
                const newRight: number = Math.min(this._valueRight + delta, this.max);
                this._valueLeft += newRight - this._valueRight;
                this._valueRight = newRight;
            }
            this._initialPosition = position;
            this._change = new ChangeGroup().append(this._getChangeLeft(this._oldValueLeft, this._valueLeft)).append(this._getChangeRight(this._oldValueRight, this._valueRight));
            if (this._change.isNoop()) this._doc.renderChanges();
            this._doc.setProspectiveChange(this._change);
        }
        this.render();
    }

    private _mouseUp = (event: PointerEvent): void => {
        this.mouseDown = DoubleSliderInputElements.none;
        this.container.releasePointerCapture(event.pointerId);
        if (this.isModRecording) {
            this._valueLeft = this._futureValueLeft;
            this._valueRight = this._futureValueRight;
        }
        this.isModRecording = false;
        if ((this._getChangeLeft != null || this._getChangeRight != null) && this._change != null) {
            if (this._change.isNoop()) this._doc.renderChanges();
            this._doc.record(this._change);
            this._change = null;
        }
    };

    public render() {
        this.leftThumb.innerHTML = "";
        this.rightThumb.innerHTML = "";
        this.leftThumb.appendChild(this._thumb(this.isModRecording ? this._oldValueLeft : this._valueLeft, true, false));
        this.rightThumb.appendChild(this._thumb(this.isModRecording ? this._oldValueRight : this._valueRight, false, false));
        this.leftThumbMod.innerHTML = "";
        this.rightThumbMod.innerHTML = "";
        if (this._doc.synth.playing) {
            if (this._getModValueLeft() != null) this.leftThumbMod.appendChild(this._thumb(this._getModValueLeft()!, true, true));
            if (this._getModValueRight() != null) this.rightThumbMod.appendChild(this._thumb(this._getModValueRight()!, false, true));
        }
    }

    private _thumb(x: number, isLeft: boolean, isMod: boolean): SVGPathElement {
        const ratio: number = Math.floor(x / (this.max - this.min) * (DoubleSlider.width - 10)) + (isLeft ? 4.5 : 5.5);
        if (isMod) return SVG.path({ d: `M ${ratio} -8 A 4 4 0 0 ${isLeft ? 0 : 1} ${ratio + (isLeft ? -4 : 4)} -4 L ${ratio + (isLeft ? -4 : 4)} 4 A 4 4 0 0 ${isLeft ? 0 : 1} ${ratio} 8 `, "fill": `${ColorConfig.overwritingModSlider}` });
        return SVG.path({ d: `M ${ratio} -12 A 4 4 0 0 ${isLeft ? 0 : 1} ${ratio + (isLeft ? -4 : 4)} -8 L ${ratio + (isLeft ? -4 : 4)} 8 A 4 4 0 0 ${isLeft ? 0 : 1} ${ratio} 12 `, "fill": "currentColor" });
    }
}

const enum DoubleSliderInputElements {
    leftThumb,
    rightThumb,
    bar,
    none
}