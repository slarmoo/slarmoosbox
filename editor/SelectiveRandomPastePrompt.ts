// Copyright (C) 2020 John Nesky, distributed under the MIT license.

import { HTML } from "imperative-html/dist/esm/elements-strict";
import { SongDocument } from "./SongDocument";
import { Prompt } from "./Prompt";
import { SelectiveInstrumentSettings } from "./Preferences";


const { button, div, h2, p, input, span } = HTML;

export class SelectiveRandomPastePrompt implements Prompt {
    private readonly SpecificRandomPasteSettings: SelectiveInstrumentSettings;

    private readonly _cancelButton: HTMLButtonElement = button({ class: "cancelButton" });
    private readonly _okayButton: HTMLButtonElement = button({ class: "okayButton", style: "width:45%;" }, "Okay");

    private readonly _instrumentTypeCheckbox: HTMLInputElement;
    private readonly _eqFilterCheckbox: HTMLInputElement;
    private readonly _fadeCheckbox: HTMLInputElement;
    private readonly _instrumentTypeSettingsCheckbox: HTMLInputElement;
    private readonly _unisonCheckbox: HTMLInputElement;
    private readonly _effectsCheckbox: HTMLInputElement;
    private readonly _envelopesCheckbox: HTMLInputElement;
    private readonly _instrumentPatternsCheckbox: HTMLInputElement;
    private readonly _allInstrumentsCheckbox: HTMLInputElement;

    public readonly container: HTMLDivElement;


    constructor(private _doc: SongDocument, private _isRandom: boolean) {

        if (this._isRandom) this.SpecificRandomPasteSettings = this._doc.prefs.selectiveRandom;
        else this.SpecificRandomPasteSettings = this._doc.prefs.selectivePaste;

        this._instrumentTypeCheckbox = input({ "checked": this.SpecificRandomPasteSettings.instrumentType, type: "checkbox", style: "width: 1em; padding: 0.5em;" });
        this._eqFilterCheckbox = input({ "checked": this.SpecificRandomPasteSettings.eqFilter, type: "checkbox", style: "width: 1em; padding: 0.5em;" });
        this._fadeCheckbox = input({ "checked": this.SpecificRandomPasteSettings.fade, type: "checkbox", style: "width: 1em; padding: 0.5em;" });
        this._instrumentTypeSettingsCheckbox = input({ "checked": this.SpecificRandomPasteSettings.instrumentTypeSettings, type: "checkbox", style: "width: 1em; padding: 0.5em;" });
        this._unisonCheckbox = input({ "checked": this.SpecificRandomPasteSettings.unison, type: "checkbox", style: "width: 1em; padding: 0.5em;" });
        this._effectsCheckbox = input({ "checked": this.SpecificRandomPasteSettings.effects, type: "checkbox", style: "width: 1em; padding: 0.5em;" });
        this._envelopesCheckbox = input({ "checked": this.SpecificRandomPasteSettings.envelopes, type: "checkbox", style: "width: 1em; padding: 0.5em;" });
        this._instrumentPatternsCheckbox = input({ "checked": this.SpecificRandomPasteSettings.instrumentPatterns, type: "checkbox", style: "width: 1em; padding: 0.5em;" });
        this._allInstrumentsCheckbox = input({ "checked": this.SpecificRandomPasteSettings.allInstruments, type: "checkbox", style: "width: 1em; padding: 0.5em;" });

        this._okayButton.addEventListener("click", this._saveChanges);
        this._cancelButton.addEventListener("click", this._close);

        this.container = div({ class: "prompt noSelection", style: "width: 250px;" },
            h2(this._isRandom ? "Customize Specific Random" : "Customize Specific Paste"),
            p((this._isRandom ? "When generating a random instrument with Alt + R" : "When pasting an instrument with Alt + V") +
                ", you can choose which parameters you want " + (this._isRandom ? "randomized" : "pasted") + " here."),
            div({ style: "align-items: center; display: flex; flex-direction: row;"},
                div({ style: "display: flex; flex-direction: column; align-items: flex-start;" },
                    div(span("Instrument Type: "), this._instrumentTypeCheckbox),
                    div(span("EQ Filter: "), this._eqFilterCheckbox),
                    div(span("Fade: "), this._fadeCheckbox),
                    div(span("Instrument Type Settings: "), this._instrumentTypeSettingsCheckbox),
                    div(span("Unison: "), this._unisonCheckbox),
                    div(span("Effects: "), this._effectsCheckbox),
                    div(span("Envelopes: "), this._envelopesCheckbox),
                    this._isRandom || !this._doc.song.patternInstruments ? "" : div(span("Instrument Patterns: "), this._instrumentPatternsCheckbox),
                    this._isRandom || (!this._doc.song.patternInstruments && !this._doc.song.layeredInstruments) ? "" : div(span("All Instruments: "), this._allInstrumentsCheckbox)
                ),
            ),
            div({ style: "display: flex; flex-direction: row-reverse; justify-content: space-between;" },
                this._okayButton,
            ),
            this._cancelButton,
        )
        this.container.addEventListener("keydown", this.whenKeyPressed);
    }

    private _close = (): void => {
        this._doc.undo();
    }

    public cleanUp = (): void => {
        this._okayButton.removeEventListener("click", this._saveChanges);
        this._cancelButton.removeEventListener("click", this._close);
        this.container.removeEventListener("keydown", this.whenKeyPressed);
    }

    public whenKeyPressed = (event: KeyboardEvent): void => {
        if ((<Element>event.target).tagName != "BUTTON" && event.keyCode == 13) { // Enter key
            this._saveChanges();
        }
    }


    private _saveChanges = (): void => {
        this._doc.prompt = null;

        this.SpecificRandomPasteSettings.instrumentType = this._instrumentTypeCheckbox.checked;
        this.SpecificRandomPasteSettings.eqFilter = this._eqFilterCheckbox.checked;
        this.SpecificRandomPasteSettings.fade = this._fadeCheckbox.checked;
        this.SpecificRandomPasteSettings.instrumentTypeSettings = this._instrumentTypeSettingsCheckbox.checked;
        this.SpecificRandomPasteSettings.unison = this._unisonCheckbox.checked;
        this.SpecificRandomPasteSettings.effects = this._effectsCheckbox.checked;
        this.SpecificRandomPasteSettings.envelopes = this._envelopesCheckbox.checked;
        this.SpecificRandomPasteSettings.instrumentPatterns = this._instrumentPatternsCheckbox.checked;
        this.SpecificRandomPasteSettings.allInstruments = this._allInstrumentsCheckbox.checked;

        if (this._isRandom) this._doc.prefs.selectiveRandom = this.SpecificRandomPasteSettings;
        else this._doc.prefs.selectivePaste = this.SpecificRandomPasteSettings;
        this._doc.prefs.save();
        this._close();
    }
}