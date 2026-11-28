import { Config } from "../synth/SynthConfig";
import { Prompt } from "./Prompt";
import { HTML, SVG } from "imperative-html/dist/esm/elements-strict";
import { SongDocument } from "./SongDocument"
import { ChangeGroup } from "./Change";
import { ChangeAddNewSequence, ChangeSequenceBooleans, ChangeSequenceHeight, ChangeSequenceLength, ChangeSequenceValues, ChangeSetEnvelopeWaveform, ChangeUpdateSequence } from "./changes";
import { SongEditor } from "./SongEditor";
import { SequenceEditor } from "./SequenceEditor";

const { div, input, button, span, h2, p } = HTML;


export class SequenceEditorPrompt implements Prompt {
    private readonly _sequenceEditor: SequenceEditor;

    private readonly _sequenceHeight: HTMLInputElement;
    private readonly _sequenceLength: HTMLInputElement;
    private readonly _sequenceInterpolates: HTMLInputElement = input({ type: "checkbox", style: "width: 1em; padding: 0.5em; margin-left: 1.5em;", id: "sequenceInterpolatesCheckbox" });
    private readonly _sequenceLoops: HTMLInputElement = input({ type: "checkbox", style: "width: 1em; padding: 0.5em; margin-left: 1.5em;", id: "sequenceLoopsCheckbox" });

    private readonly _cancelButton: HTMLButtonElement = button({ class: "cancelButton" });
    private readonly _okayButton: HTMLButtonElement = button({ class: "okayButton", style: "width:45%;" }, "Okay");
    public readonly _playButton: HTMLButtonElement = button({ style: "width: 55%;", type: "button" });

    private readonly copyButton: HTMLButtonElement = button({ style: "width:86px; margin-right: 5px;", class: "copyButton" }, [
        "Copy",
        // Copy icon:
        SVG.svg({ style: "flex-shrink: 0; position: absolute; left: 0; top: 50%; margin-top: -1em; pointer-events: none;", width: "2em", height: "2em", viewBox: "-5 -21 26 26" }, [
            SVG.path({ d: "M 0 -15 L 1 -15 L 1 0 L 13 0 L 13 1 L 0 1 L 0 -15 z M 2 -1 L 2 -17 L 10 -17 L 14 -13 L 14 -1 z M 3 -2 L 13 -2 L 13 -12 L 9 -12 L 9 -16 L 3 -16 z", fill: "currentColor" }),
        ]),
    ]);
    private readonly pasteButton: HTMLButtonElement = button({ style: "width:86px;", class: "pasteButton" }, [
        "Paste",
        // Paste icon:
        SVG.svg({ style: "flex-shrink: 0; position: absolute; left: 0; top: 50%; margin-top: -1em; pointer-events: none;", width: "2em", height: "2em", viewBox: "0 0 26 26" }, [
            SVG.path({ d: "M 8 18 L 6 18 L 6 5 L 17 5 L 17 7 M 9 8 L 16 8 L 20 12 L 20 22 L 9 22 z", stroke: "currentColor", fill: "none" }),
            SVG.path({ d: "M 9 3 L 14 3 L 14 6 L 9 6 L 9 3 z M 16 8 L 20 12 L 16 12 L 16 8 z", fill: "currentColor", }),
        ]),
    ]);
    private readonly copyPasteContainer: HTMLDivElement = div({ style: "width: 185px;" }, this.copyButton, this.pasteButton);
    public readonly container: HTMLDivElement;

    private readonly _oldWaveform: number;

    constructor(private _doc: SongDocument, private _editor: SongEditor, private sequenceIndex: number, private forEnvelope: number){//, private _forDrumset: boolean) {
        if (!this.sequenceIndex) this.sequenceIndex = 0;

        this._sequenceEditor = new SequenceEditor(this._doc, this.sequenceIndex, true);
        this._sequenceHeight = input({ value: this._sequenceEditor.sequence.height, style: "width: 4em; font-size: 80%; ", id: "sequenceHeightInput", type: "number", step: "1", min: "0", max: Config.envelopeSequenceHeightMax });
        this._sequenceLength = input({ value: this._sequenceEditor.sequence.length, style: "width: 4em; font-size: 80%; ", id: "sequenceLengthInput", type: "number", step: "1", min: "0", max: Config.envelopeSequenceLengthMax });

        this.container = div({ class: "prompt noSelection", style: "width: 500px;" },
            h2("Edit Sequence Instrument"),
            div({ style: "display: flex; width: 55%; align-self: center; flex-direction: row; align-items: center; justify-content: center;" },
                this._playButton,
            ),
            div({ style: "display: flex; flex-direction: row; align-items: center; justify-content: center; height: 200px" },
                this._sequenceEditor.canvas
            ),
            div({ style: "display: flex; flex-direction: row; justify-content: center;" },
                div({ style: "display: flex; flex-direction: column; justify-content: space-between;" },
                    div({ style: "display: flex; flex-direction: row; justify-content: right;" }, span("Height: "), this._sequenceHeight),
                    div({ style: "display: flex; flex-direction: row; justify-content: right;" }, span("Length: "), this._sequenceLength)
                ),
                div({ style: "display: flex; flex-direction: column; justify-content: space-between;" },
                    div({ style: "display: flex; flex-direction: row; justify-content: right;" }, span("Interpolates: "), this._sequenceInterpolates),
                    div({ style: "display: flex; flex-direction: row; justify-content: right;" }, span("Loops: "), this._sequenceLoops)
                ),
            ),
            p({ style: "display: flex; flex-direction: row; align-items: center; justify-content: center;" }, "Note that editing this sequence will update it in every place it is used"),
            div({ style: "display: flex; flex-direction: row-reverse; justify-content: space-between;" },
                this._okayButton,
                this.copyPasteContainer,
            ),
            this._cancelButton,
        );

        const instrument = this._doc.song.channels[this._doc.channel].instruments[this._doc.getCurrentInstrument()];
        // if (_forDrumset) {
        //     this._oldWaveform = instrument.drumsetEnvelopes[this.forEnvelope].waveform;
        //     new ChangeSetDrumsetEnvelopeWaveform(this._doc, this.sequenceIndex, this.forEnvelope);
        // } else {
            this._oldWaveform = instrument.envelopes[this.forEnvelope].waveform;
            new ChangeSetEnvelopeWaveform(this._doc, this.sequenceIndex, this.forEnvelope);
        // }
        this._sequenceInterpolates.checked = this._sequenceEditor.sequence.interpolated;
        this._sequenceLoops.checked = this._sequenceEditor.sequence.looped;
        this._okayButton.addEventListener("click", this._saveChanges);
        this._cancelButton.addEventListener("click", this._close);
        this.container.addEventListener("keydown", this.whenKeyPressed);
        this.copyButton.addEventListener("click", this._copySettings);
        this.pasteButton.addEventListener("click", this._pasteSettings);
        this._playButton.addEventListener("click", this._togglePlay);
        this._sequenceHeight.addEventListener("change", this._updateHeight);
        this._sequenceLength.addEventListener("change", this._updateLength);
        this._sequenceInterpolates.addEventListener("change", this._updateBooleans);
        this._sequenceLoops.addEventListener("change", this._updateBooleans);
        this.updatePlayButton();
        setTimeout(() => this._playButton.focus());
    }

    private _updateHeight = (): void => {
        new ChangeSequenceHeight(this._doc, this.sequenceIndex, parseInt(this._sequenceHeight.value));
        this._sequenceEditor.sequence.height = parseInt(this._sequenceHeight.value);
        this._sequenceEditor.sequence.values = this._doc.song.sequences[this.sequenceIndex].values.slice();
        this._sequenceEditor.redrawCanvas();
    }

    private _updateLength = (): void => {
        new ChangeSequenceLength(this._doc, this.sequenceIndex, parseInt(this._sequenceLength.value));
        this._sequenceEditor.sequence.length = parseInt(this._sequenceLength.value);
        this._sequenceEditor.sequence.values = this._doc.song.sequences[this.sequenceIndex].values.slice();
        this._sequenceEditor.redrawCanvas();
    }

    private _updateBooleans = (): void => {
        new ChangeSequenceBooleans(this._doc, this.sequenceIndex, this._sequenceInterpolates.checked, this._sequenceLoops.checked);
        this._sequenceEditor.sequence.interpolated = this._sequenceInterpolates.checked;
        this._sequenceEditor.sequence.looped = this._sequenceLoops.checked;
        this._sequenceEditor.redrawCanvas();
    }

    private _togglePlay = (): void => {
        this._editor.togglePlay();
        this.updatePlayButton();
    }

    public updatePlayButton(): void {
        if (this._doc.synth.playing) {
            this._playButton.classList.remove("playButton");
            this._playButton.classList.add("pauseButton");
            this._playButton.title = "Pause (Space)";
            this._playButton.innerText = "Pause";
        } else {
            this._playButton.classList.remove("pauseButton");
            this._playButton.classList.add("playButton");
            this._playButton.title = "Play (Space)";
            this._playButton.innerText = "Play";
        }
    }

    private _close = (): void => {
        this._doc.prompt = null;
        this._doc.undo();
        // if (this._forDrumset) {
        //     new ChangeSetDrumsetEnvelopeWaveform(this._doc, this._oldWaveform, this.forEnvelope);
        // } else {
            new ChangeSetEnvelopeWaveform(this._doc, this._oldWaveform, this.forEnvelope);
        // }
        this._sequenceEditor.sequence = this._sequenceEditor.originalSequence;
        new ChangeUpdateSequence(this._doc, this.sequenceIndex, this._sequenceEditor.sequence);
    }

    public cleanUp = (): void => {
        this._okayButton.removeEventListener("click", this._saveChanges);
        this._cancelButton.removeEventListener("click", this._close);
        this.container.removeEventListener("keydown", this.whenKeyPressed);
        this._playButton.removeEventListener("click", this._togglePlay);
        this._sequenceInterpolates.removeEventListener("change", this._updateBooleans);
        this._sequenceLoops.removeEventListener("change", this._updateBooleans);
    }

    private _copySettings = (): void => {
        window.localStorage.setItem("sequenceCopy", JSON.stringify(this._sequenceEditor.sequence.toJsonObject()));
    }

    private _pasteSettings = (): void => {
        const storedSequenceWave: any = JSON.parse(String(window.localStorage.getItem("sequenceCopy")));
        this._sequenceEditor.sequence.fromJsonObject(storedSequenceWave, Config.jsonFormat);
        this._sequenceHeight.value = this._sequenceEditor.sequence.height + "";
        this._sequenceLength.value = this._sequenceEditor.sequence.length + "";
        new ChangeUpdateSequence(this._doc, this.sequenceIndex, this._sequenceEditor.sequence);
        this._sequenceEditor.redrawCanvas();
    }

    public whenKeyPressed = (event: KeyboardEvent): void => {
        if ((<Element>event.target).tagName != "BUTTON" && event.keyCode == 13) { // Enter key
            this._saveChanges();
        } else if (event.keyCode == 32) {
            this._togglePlay();
            event.preventDefault();
        } else if (event.keyCode == 90) { // z
            if (event.shiftKey) {
                this._sequenceEditor.redo();
            } else {
                this._sequenceEditor.undo();
            }
            event.stopPropagation();
        } else if (event.keyCode == 89) { // y
            this._sequenceEditor.redo();
            event.stopPropagation();
        } else if (event.keyCode == 219) { // [
            this._doc.synth.goToPrevBar();
        } else if (event.keyCode == 221) { // ]
            this._doc.synth.goToNextBar();
        }
    }

    private _saveChanges = (): void => {
        // Save again just in case
        const group: ChangeGroup = new ChangeGroup();
        group.append(new ChangeAddNewSequence(this._doc, this.sequenceIndex));
        group.append(new ChangeSequenceHeight(this._doc, this.sequenceIndex, this._sequenceEditor.sequence.height));
        group.append(new ChangeSequenceLength(this._doc, this.sequenceIndex, this._sequenceEditor.sequence.length));
        group.append(new ChangeSequenceValues(this._doc, this.sequenceIndex, this._sequenceEditor.sequence.values, true));
        group.append(new ChangeSequenceBooleans(this._doc, this.sequenceIndex, this._sequenceInterpolates.checked, this._sequenceLoops.checked));
        // const instrument = this._doc.song.channels[this._doc.channel].instruments[this._doc.getCurrentInstrument()];
        // instrument.envelopes[this.forEnvelope].waveform = -1;
        if (this.forEnvelope !== undefined) //if (this._forDrumset) {
        //     group.append(new ChangeSetDrumsetEnvelopeWaveform(this._doc, this.sequenceIndex, this.forEnvelope));
        // } else {
            group.append(new ChangeSetEnvelopeWaveform(this._doc, this.sequenceIndex, this.forEnvelope));
        // }
        this._doc.record(group, true);
        this._editor.envelopeEditor.rerenderExtraSettings();
        this._doc.prompt = null;
    }
}