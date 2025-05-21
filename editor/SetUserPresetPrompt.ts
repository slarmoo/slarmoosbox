// Copyright (c) 2012-2022 John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { SongDocument } from "./SongDocument";
import { Prompt } from "./Prompt";
import { HTML } from "imperative-html/dist/esm/elements-strict";
import { Instrument } from "../synth/synth";
import { EditorConfig } from "./EditorConfig";

const { button, div, h2, input } = HTML;
export class SetUserPresetPrompt implements Prompt {
    private readonly _cancelButton: HTMLButtonElement = button({ class: "cancelButton" });
    private readonly _saveButton: HTMLButtonElement = button({ class: "exportButton", style: "width:45%;" }, "Save");
    private readonly _presetName: HTMLInputElement = input({ type: "text", style: "width: 10em;", maxlength: 40, "autofocus": "autofocus" });

    public readonly container: HTMLDivElement = div({ class: "prompt noSelection", style: "width: 200px;" },
        h2("Export Instruments Options"),
        div({ style: "display: flex; flex-direction: row; align-items: center; justify-content: space-between;" },
            "Preset name:",
            this._presetName,
        ),
        div({ style: "display: flex; flex-direction: row-reverse; justify-content: space-between;" },
            this._saveButton,
        ),
        this._cancelButton,
    );

    constructor(private _doc: SongDocument) { //, private _editor: SongEditor
        const _channelName: string = this._doc.song.channels[this._doc.channel].name == "" ? "My Preset" : this._doc.song.channels[this._doc.channel].name;
        this._presetName.value = _channelName;
        this._cancelButton.addEventListener("click", this._close);
        this._saveButton.addEventListener("click", this._savePreset.bind(this));
        this._presetName.addEventListener("input", SetUserPresetPrompt._validateFileName)
    }

    private _close = (): void => {
        this._doc.undo();
    }

    public cleanUp = (): void => {
        this._cancelButton.removeEventListener("click", this._close);
        this._saveButton.removeEventListener("click", this._savePreset);
        this._presetName.removeEventListener("input", SetUserPresetPrompt._validateFileName)
    }

    private _savePreset() {
        const instrument: Instrument = this._doc.song.channels[this._doc.channel].instruments[this._doc.getCurrentInstrument()];
        const instrumentJson: Object = instrument.toJsonObject();
        let doesPresetExist: boolean = false;
        let oldPresetName: string = "";
        for (const key in this._doc.prefs.userPresets) {
            if (instrumentJson == this._doc.prefs.userPresets.get(key)) {
                doesPresetExist = true;
                oldPresetName = key;
            }
        }
        if (doesPresetExist) { //user preset already exists, remove it and replace name if needed
            this._doc.prefs.userPresets.delete(oldPresetName);
            if (!(this._presetName.value == oldPresetName || this._presetName.value == "")) {
                this._doc.prefs.userPresets.set(this._presetName.value, instrument.toJsonObject());
            }
        } else if (EditorConfig.valueToPreset(instrument.preset) == EditorConfig.valueToPreset(instrument.type)) { //add preset
            this._doc.prefs.userPresets.set(this._presetName.value, instrument.toJsonObject());
        }
        console.log(this._doc.prefs.userPresets);

        this._doc.prefs.save();

        this._close();
    }

    private static _validateFileName(event: Event | null, use?: HTMLInputElement): void {
        let input: HTMLInputElement;
        if (event != null) {
            input = <HTMLInputElement>event.target;
        } else if (use != undefined) {
            input = use;
        }
        else {
            return;
        }
        const deleteChars = /[\+\*\$\?\|\{\}\\\/<>#%!`&'"=:@]/gi;
        if (deleteChars.test(input.value)) {
            let cursorPos: number = <number>input.selectionStart;
            input.value = input.value.replace(deleteChars, "");
            cursorPos--;
            input.setSelectionRange(cursorPos, cursorPos);
        }
    }
}