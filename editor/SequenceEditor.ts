import { HTML } from "imperative-html/dist/esm/elements-strict";
import { SongDocument } from "./SongDocument"
import { SequenceSettings } from "../synth/synth";
import { ChangeAddNewSequence, ChangeSequenceValues } from "./changes";
import { ColorConfig } from "./ColorConfig";

const { canvas } = HTML;

export class SequenceEditor {
    public sequence: SequenceSettings;
    public originalSequence: SequenceSettings;

    private _undoHistoryState: number = 0;
    private _changeQueue: SequenceSettings[] = [];

    private _mouseX: number = 0;
    private _mouseY: number = 0;
    private _mouseDown: boolean = false;

    private canvasHeight: number = 156;
    private canvasWidth: number = 384;

    public canvas: HTMLCanvasElement;
    private renderedColor: string = "";



    constructor(private _doc: SongDocument, private sequenceIndex: number, private _interactable: boolean, scale: number = 3) {
        this.canvasHeight = 52 * scale;
        this.canvasWidth = 128 * scale;
        this.canvas = canvas({ width: this.canvasWidth, height: this.canvasHeight, style: "border:2px solid " + ColorConfig.uiWidgetBackground, id: "customSequenceDrawCanvas" });
        if (!this.sequenceIndex) this.sequenceIndex = 0;
        if (this.sequenceIndex >= this._doc.song.sequences.length) {
            this.sequence = new SequenceSettings();
            new ChangeAddNewSequence(this._doc, sequenceIndex);
        } else {
            this.sequence = this._doc.song.sequences[this.sequenceIndex].copy();
        }
        this.originalSequence = this.sequence.copy();
        if (_interactable) {
            this.canvas.addEventListener("mousemove", this._onMouseMove);
            this.canvas.addEventListener("mousedown", this._onMouseDown);
            this.canvas.addEventListener("mouseup", this._whenCursorReleased);
            this.canvas.addEventListener("mouseleave", this._whenCursorReleased);

            this.canvas.addEventListener("touchstart", this._whenTouchPressed);
            this.canvas.addEventListener("touchmove", this._whenTouchMoved);
            this.canvas.addEventListener("touchend", this._whenCursorReleased);
            this.canvas.addEventListener("touchcancel", this._whenCursorReleased);
        }

        this.redrawCanvas();
    }

    public storeChange = (): void => {
        // Check if change is unique compared to the current history state
        var sameCheck = true;
        if (this._changeQueue.length > 0) {
            sameCheck = this.sequence.isSame(this._changeQueue[this._undoHistoryState]);
        }

        if (sameCheck == false || this._changeQueue.length == 0) {
            // Create new branch in history, removing all after this in time
            this._changeQueue.splice(0, this._undoHistoryState);

            this._undoHistoryState = 0;

            this._changeQueue.unshift(this.sequence.copy());

            // 32 undo max
            if (this._changeQueue.length > 32) {
                this._changeQueue.pop();
            }
        }
    }

    public undo = (): void => {
        // Go backward, if there is a change to go back to
        if (this._undoHistoryState < this._changeQueue.length - 1) {
            this._undoHistoryState++;
            this.sequence = this._changeQueue[this._undoHistoryState];
        }
    }

    public redo = (): void => {
        // Go forward, if there is a change to go to
        if (this._undoHistoryState > 0) {
            this._undoHistoryState--;
            this.sequence = this._changeQueue[this._undoHistoryState];
        }
    }

    public redrawCanvas(): void {
        const sequenceData: SequenceSettings = this._changeQueue[this._undoHistoryState];
        const renderColor: string = ColorConfig.getComputedChannelColor(this._doc.song, this._doc.channel).primaryNote;

        // Check if the data has changed from the last render.
        let needsRedraw: boolean = false;
        if (renderColor != this.renderedColor) {
            needsRedraw = true;
        } else {
            needsRedraw = !this.sequence.isSame(sequenceData)
        }
        if (!needsRedraw) {
            return;
        }

        if(this._interactable) this.storeChange();

        var ctx = this.canvas.getContext("2d") as CanvasRenderingContext2D;

        // Black BG
        ctx.fillStyle = ColorConfig.getComputed("--editor-background");
        ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);

        //waveform
        ctx.fillStyle = renderColor;
        if (this.sequence.interpolated) {
            for (let i: number = 0; i < this.sequence.length; i++) {
                const h: number = this.sequence.values[i] / this.sequence.height * this.canvasHeight;
                const h2: number = i + 1 == this.sequence.length ? !this.sequence.looped ? h : this.sequence.values[0] / this.sequence.height * this.canvasHeight : this.sequence.values[i + 1] / this.sequence.height * this.canvasHeight;
                //draw trapezoid instead
                ctx.beginPath();
                ctx.moveTo(i * this.canvasWidth / this.sequence.length, this.canvasHeight);
                ctx.lineTo(i * this.canvasWidth / this.sequence.length, this.canvasHeight - h);
                ctx.lineTo((i + 1) * this.canvasWidth / this.sequence.length, this.canvasHeight - h2);
                ctx.lineTo((i + 1) * this.canvasWidth / this.sequence.length, this.canvasHeight);
                ctx.closePath();
                ctx.fill();
            }
        } else {
            for (let i: number = 0; i < this.sequence.length; i++) {
                const h: number = this.sequence.values[i] / this.sequence.height * this.canvasHeight;
                ctx.fillRect(i * this.canvasWidth / this.sequence.length, this.canvasHeight - h, this.canvasWidth / this.sequence.length, h);
            }
        }

        //horizontal divisor lines
        ctx.fillStyle = ColorConfig.getComputed("--editor-background");
        for (let i: number = 0; i < this.sequence.height; i++) {
            const h: number = i / this.sequence.height * this.canvasHeight;
            ctx.fillRect(0, h, this.canvasWidth, 1);
        }

        //vertical divisor lines
        ctx.fillStyle = ColorConfig.getComputed("--ui-widget-background");
        for (let i: number = 0; i < this.sequence.length; i++) {
            ctx.fillRect(i * this.canvasWidth / this.sequence.length, 0, 1, this.canvasHeight);
        }
    }

    private _onCursorMove = (): void => {
        if (this._mouseDown) {

            if (this._mouseY < 2) this._mouseY = 2;
            if (this._mouseY > this.canvasHeight - 2) this._mouseY = this.canvasHeight;

            const editSequenceIndex: number = this.sequence.interpolated ? Math.round(this._mouseX * this.sequence.length / this.canvasWidth) : Math.floor(this._mouseX * this.sequence.length / this.canvasWidth);

            this.sequence.values[editSequenceIndex] = Math.round(this.sequence.height - this._mouseY * this.sequence.height / this.canvasHeight);
            new ChangeSequenceValues(this._doc, this.sequenceIndex, this.sequence.values);

            this.redrawCanvas();
        }
    }

    private _onMouseDown = (event: MouseEvent): void => {
        event.preventDefault();
        this._mouseDown = true;
        this._mouseX = (event.clientX || event.pageX) - this.canvas.getBoundingClientRect().left;
        this._mouseY = Math.floor((event.clientY || event.pageY) - this.canvas.getBoundingClientRect().top);

        // Allow single-click edit
        this._onCursorMove();
    }

    private _whenTouchPressed = (event: TouchEvent): void => {
        event.preventDefault();
        this._mouseDown = true;
        this._mouseX = event.touches[0].clientX - this.canvas.getBoundingClientRect().left;
        this._mouseY = Math.floor(event.touches[0].clientY - this.canvas.getBoundingClientRect().top);

        // Allow single-click edit
        this._onCursorMove();
    }

    private _onMouseMove = (event: MouseEvent): void => {
        this._mouseX = (event.clientX || event.pageX) - this.canvas.getBoundingClientRect().left;
        this._mouseY = Math.floor((event.clientY || event.pageY) - this.canvas.getBoundingClientRect().top);
        this._onCursorMove();
    }

    private _whenTouchMoved = (event: TouchEvent): void => {
        if (!this._mouseDown) return;
        event.preventDefault();
        this._mouseX = event.touches[0].clientX - this.canvas.getBoundingClientRect().left;
        this._mouseY = Math.floor(event.touches[0].clientY - this.canvas.getBoundingClientRect().top);
        this._onCursorMove();
    }

    private _whenCursorReleased = (): void => {
        this._mouseDown = false;
    }
}