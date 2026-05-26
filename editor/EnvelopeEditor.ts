// Copyright (c) 2012-2022 John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { InstrumentType, Config, DropdownID, LFOEnvelopeTypes, RandomEnvelopeTypes } from "../synth/SynthConfig";
import { Instrument } from "../synth/synth";
import { SongDocument } from "./SongDocument";
import { ChangeSetEnvelopeTarget, ChangeSetEnvelopeType, ChangeRemoveEnvelope, ChangeEnvelopePitchStart, ChangeEnvelopePitchEnd, ChangeEnvelopeInverse, ChangePerEnvelopeSpeed, ChangeEnvelopeLowerBound, ChangeEnvelopeUpperBound, ChangeRandomEnvelopeSteps, ChangeRandomEnvelopeSeed, PasteEnvelope, ChangeSetEnvelopeWaveform, ChangeDiscreteEnvelope, } from "./changes";
import { HTML, SVG } from "imperative-html/dist/esm/elements-strict";
import { Change } from "./Change";
import { prettyNumber } from "./EditorConfig";
import { Slider } from "./HTMLWrapper";

export class EnvelopeEditor {
	public readonly container: HTMLElement = HTML.div({ class: "envelopeEditor" });

	private readonly _rows: HTMLDivElement[] = [];
	private readonly _targetSelects: HTMLSelectElement[] = [];
	private readonly _envelopeSelects: HTMLSelectElement[] = [];
	private readonly _deleteButtons: HTMLButtonElement[] = [];
	//dropdown stuff
	public readonly extraSettingsDropdowns: HTMLButtonElement[] = []; //need to be accessed in SongEditor to function
	public readonly extraPitchSettingsGroups: HTMLDivElement[] = [];
	public readonly extraSettingsDropdownGroups: HTMLDivElement[] = [];
	public readonly extraRandomSettingsGroups: HTMLDivElement[] = [];
	public readonly extraLFODropdownGroups: HTMLDivElement[] = [];
	public readonly openExtraSettingsDropdowns: boolean[] = [];
	public readonly perEnvelopeSpeedGroups: HTMLElement[] = [];

	//pitch envelope sliders/boxes
	private readonly _pitchStartSliders: HTMLInputElement[] = [];
	public readonly pitchStartBoxes: HTMLInputElement[] = [];
	private readonly _pitchEndSliders: HTMLInputElement[] = [];
	public readonly pitchEndBoxes: HTMLInputElement[] = [];
	//pitch envelope note name displays
	private readonly _startNoteDisplays: HTMLSpanElement[] = [];
	private readonly _endNoteDisplays: HTMLSpanElement[] = [];
	//invert / discrete checkboxes
	private readonly _inverters: HTMLInputElement[] = [];
	private readonly _discreters: HTMLInputElement[] = [];
	//envelope speed sliders/displays
	public readonly perEnvelopeSpeedSliders: Slider[] = [];
	private readonly _perEnvelopeSpeedDisplays: HTMLSpanElement[] = [];
	//envelope bounds sliders/boxes
	public readonly perEnvelopeLowerBoundBoxes: HTMLInputElement[] = [];
	public readonly perEnvelopeUpperBoundBoxes: HTMLInputElement[] = [];
	public readonly perEnvelopeLowerBoundSliders: Slider[] = [];
	public readonly perEnvelopeUpperBoundSliders: Slider[] = [];
	//random envelopes
	public readonly randomStepsBoxes: HTMLInputElement[] = [];
	public readonly randomSeedBoxes: HTMLInputElement[] = [];
	private readonly _randomStepsSliders: HTMLInputElement[] = [];
	private readonly _randomSeedSliders: HTMLInputElement[] = [];
	private readonly _randomEnvelopeTypeSelects: HTMLSelectElement[] = [];
	private readonly _randomStepsWrappers: HTMLDivElement[] = [];
	//envelope copy and paste
	private readonly _envelopeCopyButtons: HTMLButtonElement[] = [];
	private readonly _envelopePasteButtons: HTMLButtonElement[] = [];
	//lfo
	private readonly _waveformSelects: HTMLSelectElement[] = [];
	public readonly LFOStepsBoxes: HTMLInputElement[] = [];
	private readonly _LFOStepsSliders: HTMLInputElement[] = [];
	private readonly _LFOStepsWrappers: HTMLDivElement[] = [];

	private _renderedEnvelopeCount: number = 0;
	private _renderedEqFilterCount: number = -1;
	private _renderedNoteFilterCount: number = -1;
	private _renderedInstrumentType: InstrumentType;
	private _renderedEffects: number = 0;

	private _lastChange: Change | null = null;

	constructor(private _doc: SongDocument, private _extraSettingsDropdown: Function, private _openPrompt: Function) {
		this.container.addEventListener("change", this._onChange);
		this.container.addEventListener("click", this._onClick);
		this.container.addEventListener("input", this._onInput);
	}

	private _onChange = (event: Event): void => {
		const targetSelectIndex: number = this._targetSelects.indexOf(<any>event.target);
		const envelopeSelectIndex: number = this._envelopeSelects.indexOf(<any>event.target);
		const inverterIndex: number = this._inverters.indexOf(<any>event.target);
		const discreterIndex: number = this._discreters.indexOf(<any>event.target); 
		const startBoxIndex: number = this.pitchStartBoxes.indexOf(<any>event.target);
		const endBoxIndex: number = this.pitchEndBoxes.indexOf(<any>event.target);
		const startSliderIndex: number = this._pitchStartSliders.indexOf(<any>event.target);
		const endSliderIndex: number = this._pitchEndSliders.indexOf(<any>event.target);
		const lowerBoundBoxIndex: number = this.perEnvelopeLowerBoundBoxes.indexOf(<any>event.target);
		const upperBoundBoxIndex: number = this.perEnvelopeUpperBoundBoxes.indexOf(<any>event.target);
		const randomStepsBoxIndex: number = this.randomStepsBoxes.indexOf(<any>event.target);
		const randomSeedBoxIndex: number = this.randomSeedBoxes.indexOf(<any>event.target);
		const randomStepsSliderIndex: number = this._randomStepsSliders.indexOf(<any>event.target);
		const randomSeedSliderIndex: number = this._randomSeedSliders.indexOf(<any>event.target);
		const waveformSelectIndex: number = this._waveformSelects.indexOf(<any>event.target);
		const randomTypeSelectIndex: number = this._randomEnvelopeTypeSelects.indexOf(<any>event.target);
		const LFOStepsBoxIndex: number = this.LFOStepsBoxes.indexOf(<any>event.target);
		const LFOStepsSliderIndex: number = this._LFOStepsSliders.indexOf(<any>event.target);
		if (targetSelectIndex != -1) {
			const combinedValue: number = parseInt(this._targetSelects[targetSelectIndex].value);
			const target: number = combinedValue % Config.instrumentAutomationTargets.length;
			const index: number = (combinedValue / Config.instrumentAutomationTargets.length) >>> 0;
			this._doc.record(new ChangeSetEnvelopeTarget(this._doc, targetSelectIndex, target, index));
		} else if (envelopeSelectIndex != -1) {
			const envelopeIndex: number = this._envelopeSelects.indexOf(<any>event.target);

			this._doc.record(new ChangeSetEnvelopeType(this._doc, envelopeIndex, this._envelopeSelects[envelopeIndex].selectedIndex));

			//hide different envelope groups based on envelope type
			this.rerenderExtraSettings(envelopeSelectIndex);
			this.render();
		} else if (waveformSelectIndex != -1) {
			this._doc.record(new ChangeSetEnvelopeWaveform(this._doc, this._waveformSelects[waveformSelectIndex].value, waveformSelectIndex));
		} else if (randomTypeSelectIndex != -1) {
			this._doc.record(new ChangeSetEnvelopeWaveform(this._doc, this._randomEnvelopeTypeSelects[randomTypeSelectIndex].value, randomTypeSelectIndex));
		} else if (inverterIndex != -1) {
			this._doc.record(new ChangeEnvelopeInverse(this._doc, this._inverters[inverterIndex].checked, inverterIndex));
		} else if (discreterIndex != -1) {
			this._doc.record(new ChangeDiscreteEnvelope(this._doc, this._discreters[discreterIndex].checked, discreterIndex));

		} else if (startBoxIndex != -1 || endBoxIndex != -1 || startSliderIndex != -1 || endSliderIndex != -1 ||
			lowerBoundBoxIndex != -1 || upperBoundBoxIndex != -1 || randomStepsBoxIndex != -1 || randomSeedBoxIndex != -1 ||
			randomStepsSliderIndex != -1 || randomSeedSliderIndex != -1 || LFOStepsBoxIndex != -1 || LFOStepsSliderIndex != -1) {
			if (this._lastChange != null) {
				this._doc.record(this._lastChange);
				this._lastChange = null;
			}
		}
	}

	private _onClick = (event: MouseEvent): void => {
		const deleteButtonIndex: number = this._deleteButtons.indexOf(<any>event.target);
		const envelopeCopyButtonIndex: number = this._envelopeCopyButtons.indexOf(<any>event.target);
		const envelopePasteButtonIndex: number = this._envelopePasteButtons.indexOf(<any>event.target);
		if (deleteButtonIndex != -1) {
			this._doc.record(new ChangeRemoveEnvelope(this._doc, deleteButtonIndex));
			this.extraSettingsDropdownGroups[deleteButtonIndex].style.display = "none";
		} else if (envelopeCopyButtonIndex != -1) {
			const instrument: Instrument = this._doc.song.channels[this._doc.channel].instruments[this._doc.getCurrentInstrument()];
			window.localStorage.setItem("envelopeCopy", JSON.stringify(instrument.envelopes[envelopeCopyButtonIndex].toJsonObject()));
		} else if (envelopePasteButtonIndex != -1) {
			const envelopeCopy: any = window.localStorage.getItem("envelopeCopy");
			this._doc.record(new PasteEnvelope(this._doc, JSON.parse(String(envelopeCopy)), envelopePasteButtonIndex));
		}
	}

	private _onInput = (event: Event): void => {
		const startBoxIndex: number = this.pitchStartBoxes.indexOf(<any>event.target);
		const endBoxIndex: number = this.pitchEndBoxes.indexOf(<any>event.target);
		const startSliderIndex: number = this._pitchStartSliders.indexOf(<any>event.target);
		const endSliderIndex: number = this._pitchEndSliders.indexOf(<any>event.target);
		const lowerBoundBoxIndex: number = this.perEnvelopeLowerBoundBoxes.indexOf(<any>event.target);
		const upperBoundBoxIndex: number = this.perEnvelopeUpperBoundBoxes.indexOf(<any>event.target);
		const randomStepsBoxIndex: number = this.randomStepsBoxes.indexOf(<any>event.target);
		const randomSeedBoxIndex: number = this.randomSeedBoxes.indexOf(<any>event.target);
		const randomStepsSliderIndex: number = this._randomStepsSliders.indexOf(<any>event.target);
		const randomSeedSliderIndex: number = this._randomSeedSliders.indexOf(<any>event.target);
		const LFOStepsBoxIndex: number = this.LFOStepsBoxes.indexOf(<any>event.target);
		const LFOStepsSliderIndex: number = this._LFOStepsSliders.indexOf(<any>event.target);
		const instrument: Instrument = this._doc.song.channels[this._doc.channel].instruments[this._doc.getCurrentInstrument()];
		if (startBoxIndex != -1) {
			this._lastChange = new ChangeEnvelopePitchStart(this._doc, parseInt(this.pitchStartBoxes[startBoxIndex].value), startBoxIndex);
		} else if (endBoxIndex != -1) {
			this._lastChange = new ChangeEnvelopePitchEnd(this._doc, parseInt(this.pitchEndBoxes[endBoxIndex].value), endBoxIndex);
		} else if (startSliderIndex != -1) {
			this._lastChange = new ChangeEnvelopePitchStart(this._doc, parseInt(this._pitchStartSliders[startSliderIndex].value), startSliderIndex);
		} else if (endSliderIndex != -1) {
			this._lastChange = new ChangeEnvelopePitchEnd(this._doc, parseInt(this._pitchEndSliders[endSliderIndex].value), endSliderIndex);
		} else if (lowerBoundBoxIndex != -1) {
			this._lastChange = new ChangeEnvelopeLowerBound(this._doc, instrument.envelopes[lowerBoundBoxIndex].perEnvelopeLowerBound, parseFloat(this.perEnvelopeLowerBoundBoxes[lowerBoundBoxIndex].value), lowerBoundBoxIndex);
		} else if (upperBoundBoxIndex != -1) {
			this._lastChange = new ChangeEnvelopeUpperBound(this._doc, instrument.envelopes[upperBoundBoxIndex].perEnvelopeUpperBound, parseFloat(this.perEnvelopeUpperBoundBoxes[upperBoundBoxIndex].value), upperBoundBoxIndex);
		} else if (randomStepsBoxIndex != -1) {
			this._lastChange = new ChangeRandomEnvelopeSteps(this._doc, parseFloat(this.randomStepsBoxes[randomStepsBoxIndex].value), randomStepsBoxIndex);
		} else if (randomSeedBoxIndex != -1) {
			this._lastChange = new ChangeRandomEnvelopeSeed(this._doc, parseFloat(this.randomSeedBoxes[randomSeedBoxIndex].value), randomSeedBoxIndex);
		} else if (randomStepsSliderIndex != -1) {
			this._lastChange = new ChangeRandomEnvelopeSteps(this._doc, parseFloat(this._randomStepsSliders[randomStepsSliderIndex].value), randomStepsSliderIndex);
		} else if (randomSeedSliderIndex != -1) {
			this._lastChange = new ChangeRandomEnvelopeSeed(this._doc, parseFloat(this._randomSeedSliders[randomSeedSliderIndex].value), randomSeedSliderIndex);
		} else if (LFOStepsBoxIndex != -1) {
			this._lastChange = new ChangeRandomEnvelopeSteps(this._doc, parseFloat(this.LFOStepsBoxes[LFOStepsBoxIndex].value), LFOStepsBoxIndex);
		} else if (LFOStepsSliderIndex != -1) {
			this._lastChange = new ChangeRandomEnvelopeSteps(this._doc, parseFloat(this._LFOStepsSliders[LFOStepsSliderIndex].value), LFOStepsSliderIndex);
		}
	}

	private _makeOption(target: number, index: number): HTMLOptionElement {
		let displayName = Config.instrumentAutomationTargets[target].displayName;
		if (Config.instrumentAutomationTargets[target].maxCount > 1) {
			if (displayName.indexOf("#") != -1) {
				displayName = displayName.replace("#", String(index + 1));
			} else {
				displayName += " " + (index + 1);
			}
		}
		return HTML.option({ value: target + index * Config.instrumentAutomationTargets.length }, displayName);
	}

	private _updateTargetOptionVisibility(menu: HTMLSelectElement, instrument: Instrument): void {
		for (let optionIndex: number = 0; optionIndex < menu.childElementCount; optionIndex++) {
			const option: HTMLOptionElement = <HTMLOptionElement>menu.children[optionIndex];
			const combinedValue: number = parseInt(option.value);
			const target: number = combinedValue % Config.instrumentAutomationTargets.length;
			const index: number = (combinedValue / Config.instrumentAutomationTargets.length) >>> 0;
			option.hidden = !instrument.supportsEnvelopeTarget(target, index);
		}
	}

	private _pitchToNote(value: number, isNoise: boolean): string {
		let text = "";
		if (isNoise) {
			value = value * 6 + 12;
		}
		const offset: number = Config.keys[this._doc.song.key].basePitch % Config.pitchesPerOctave;
		const keyValue = (value + offset) % Config.pitchesPerOctave;
		if (Config.keys[keyValue].isWhiteKey) {
			text = Config.keys[keyValue].name;
		} else {
			const shiftDir: number = Config.blackKeyNameParents[value % Config.pitchesPerOctave];
			text = Config.keys[(keyValue + Config.pitchesPerOctave + shiftDir) % Config.pitchesPerOctave].name;
			if (shiftDir == 1) {
				text += "♭";
			} else if (shiftDir == -1) {
				text += "♯";
			}
		}
		return "[" + text + Math.floor((value + Config.pitchesPerOctave) / 12 + this._doc.song.octave - 1) + "]";
	}

	public rerenderExtraSettings(index: number = 0) { //probably not the best solution, but very reliable and easy
		const instrument: Instrument = this._doc.song.channels[this._doc.channel].instruments[this._doc.getCurrentInstrument()];
		for (let i = index; i < Config.maxEnvelopeCount; i++) {
			if (i >= instrument.envelopeCount) {
				if (this.extraSettingsDropdowns[i]) { //make sure is not null so that we don't get an error
					this.extraSettingsDropdowns[i].style.display = "none";
				}
				if (this.extraSettingsDropdownGroups[i]) {
					this.extraSettingsDropdownGroups[i].style.display = "none";
				}
				if (this.extraPitchSettingsGroups[i]) {
					this.extraPitchSettingsGroups[i].style.display = "none";
				}
				if (this.extraPitchSettingsGroups[i]) {
					this.perEnvelopeSpeedGroups[i].style.display = "none";
				}
				if (this.extraLFODropdownGroups[i]) {
					this.extraLFODropdownGroups[i].style.display = "none";
				}
			} else if (this.openExtraSettingsDropdowns[i]) {
				this.extraSettingsDropdownGroups[i].style.display = "flex";
				this.extraSettingsDropdowns[i].style.display = "inline";
				this.updateSpeedDisplay(i);

				if (Config.newEnvelopes[instrument.envelopes[i].envelope].name == "pitch") {
					//update values
					this.pitchStartBoxes[i].value = instrument.envelopes[i].pitchEnvelopeStart.toString();
					this.pitchEndBoxes[i].value = instrument.envelopes[i].pitchEnvelopeEnd.toString();
					//reset bounds between noise and pitch channels
					this._pitchStartSliders[i].max = (instrument.isNoiseInstrument ? Config.drumCount - 1 : Config.maxPitch).toString();
					this.pitchStartBoxes[i].max = (instrument.isNoiseInstrument ? Config.drumCount - 1 : Config.maxPitch).toString();
					this._pitchEndSliders[i].max = (instrument.isNoiseInstrument ? Config.drumCount - 1 : Config.maxPitch).toString();
					this.pitchEndBoxes[i].max = (instrument.isNoiseInstrument ? Config.drumCount - 1 : Config.maxPitch).toString();
					if (instrument.isNoiseInstrument && parseInt(this.pitchStartBoxes[i].value) > Config.drumCount - 1) {
						this.pitchStartBoxes[i].value = (Config.drumCount - 1).toString(); //reset if somehow greater than it should be
					}
					if (instrument.isNoiseInstrument && parseInt(this.pitchEndBoxes[i].value) > Config.drumCount - 1) {
						this.pitchEndBoxes[i].value = (Config.drumCount - 1).toString();
					}
					//update note displays
					this._startNoteDisplays[i].textContent = "Start " + this._pitchToNote(parseInt(this.pitchStartBoxes[i].value), instrument.isNoiseInstrument) + ": ";
					this._endNoteDisplays[i].textContent = "End " + this._pitchToNote(parseInt(this.pitchEndBoxes[i].value), instrument.isNoiseInstrument) + ": ";
					//show pitch, hide others
					this.extraPitchSettingsGroups[i].style.display = "flex";
					this.perEnvelopeSpeedGroups[i].style.display = "none";
					this.extraRandomSettingsGroups[i].style.display = "none";
					this.extraLFODropdownGroups[i].style.display = "none";

				} else if (Config.newEnvelopes[instrument.envelopes[i].envelope].name == "random") {
					
					//update values
					const isRandomTime: boolean = instrument.envelopes[i].waveform == RandomEnvelopeTypes.time || instrument.envelopes[i].waveform == RandomEnvelopeTypes.timeSmooth;
					this.randomStepsBoxes[i].value = instrument.envelopes[i].steps.toString();
					this.randomSeedBoxes[i].value = instrument.envelopes[i].seed.toString();
					this._randomStepsSliders[i].value = instrument.envelopes[i].steps.toString();
					this._randomSeedSliders[i].value = instrument.envelopes[i].seed.toString();
					this.perEnvelopeSpeedSliders[i].updateValue(EnvelopeEditor.convertIndexSpeed(instrument.envelopes[i].perEnvelopeSpeed, "index"));
					if (instrument.envelopes[i].waveform > RandomEnvelopeTypes.length) instrument.envelopes[i].waveform = 0;
					this._randomStepsWrappers[i].style.display = instrument.envelopes[i].waveform == RandomEnvelopeTypes.time || instrument.envelopes[i].waveform == RandomEnvelopeTypes.note ? "flex" : "none";
					this._randomEnvelopeTypeSelects[i].selectedIndex = instrument.envelopes[i].waveform;
					
					//hide other dropdown groups, show perEnvelopeSpeed
					this.perEnvelopeSpeedGroups[i].style.display = isRandomTime ? "" : "none";
					this.extraSettingsDropdownGroups[i].style.display = "flex";
					this.extraSettingsDropdowns[i].style.display = "inline";
					this.extraPitchSettingsGroups[i].style.display = "none";
					this.extraRandomSettingsGroups[i].style.display = "";
					this.extraLFODropdownGroups[i].style.display = "none";

				} else if (Config.newEnvelopes[instrument.envelopes[i].envelope].name == "lfo") {

					//update values
					this._waveformSelects[i].value = instrument.envelopes[i].waveform.toString();
					this.perEnvelopeSpeedSliders[i].updateValue(EnvelopeEditor.convertIndexSpeed(instrument.envelopes[i].perEnvelopeSpeed, "index"));

					//show / hide steps based on waveform
					if (instrument.envelopes[i].waveform == LFOEnvelopeTypes.steppedSaw || instrument.envelopes[i].waveform == LFOEnvelopeTypes.steppedTri) {
						this._LFOStepsWrappers[i].style.display = "flex";
					} else {
						this._LFOStepsWrappers[i].style.display = "none";
					}

					//hide other dropdown groups, show lfo settings and speed
					this.extraLFODropdownGroups[i].style.display = "";
					this.perEnvelopeSpeedGroups[i].style.display = "flex"
					this.extraSettingsDropdownGroups[i].style.display = "flex";
					this.extraSettingsDropdowns[i].style.display = "inline";
					this.extraPitchSettingsGroups[i].style.display = "none";
					this.extraRandomSettingsGroups[i].style.display = "none";
				} else {
					this.extraPitchSettingsGroups[i].style.display = "none";
					this.extraRandomSettingsGroups[i].style.display = "none";
					this.extraLFODropdownGroups[i].style.display = "none";
					if (Config.newEnvelopes[instrument.envelopes[i].envelope].name == "punch" || Config.newEnvelopes[instrument.envelopes[i].envelope].name == "none" || Config.newEnvelopes[instrument.envelopes[i].envelope].name == "note size") {
						this.perEnvelopeSpeedGroups[i].style.display = "none"
					} else {
						//perEnvelopeSpeed
						this.perEnvelopeSpeedGroups[i].style.display = "flex"
						this.perEnvelopeSpeedSliders[i].updateValue(EnvelopeEditor.convertIndexSpeed(instrument.envelopes[i].perEnvelopeSpeed, "index"));
					}
				}
				this._inverters[i].checked = instrument.envelopes[i].inverse;
				this._discreters[i].checked = instrument.envelopes[i].discrete;

				this.perEnvelopeLowerBoundBoxes[i].value = instrument.envelopes[i].perEnvelopeLowerBound.toString();
				this.perEnvelopeUpperBoundBoxes[i].value = instrument.envelopes[i].perEnvelopeUpperBound.toString();
				this.perEnvelopeLowerBoundSliders[i].updateValue(instrument.envelopes[i].perEnvelopeLowerBound);
				this.perEnvelopeUpperBoundSliders[i].updateValue(instrument.envelopes[i].perEnvelopeUpperBound);
			} else if (this.openExtraSettingsDropdowns[i] == false) {
				this.extraSettingsDropdownGroups[i].style.display = "none";
				this.extraPitchSettingsGroups[i].style.display = "none";
				this.extraSettingsDropdowns[i].style.display = "inline";
				this.perEnvelopeSpeedGroups[i].style.display = "none";
			} else {
				if (this.extraSettingsDropdowns[i]) { //make sure is not null so that we don't get an error
					this.extraSettingsDropdowns[i].style.display = "none";
				}
				if (this.extraSettingsDropdownGroups[i]) {
					this.extraSettingsDropdownGroups[i].style.display = "none";
				}
				if (this.extraPitchSettingsGroups[i]) {
					this.extraPitchSettingsGroups[i].style.display = "none";
				}
				if (this.extraPitchSettingsGroups[i]) {
					this.perEnvelopeSpeedGroups[i].style.display = "none";
				}
				if (this.extraLFODropdownGroups[i]) {
					this.extraLFODropdownGroups[i].style.display = "none";
				}
				if (this.extraRandomSettingsGroups[i]) {
					this.extraRandomSettingsGroups[i].style.display = "none";
				}
			}
		}
	}

	public static convertIndexSpeed(value: number, convertTo: string): number {
		switch (convertTo) {
			case "index":
				return Config.perEnvelopeSpeedToIndices[value] != null ? Config.perEnvelopeSpeedToIndices[value] : 23;
			case "speed":
				return Config.perEnvelopeSpeedIndices[value] != null ? Config.perEnvelopeSpeedIndices[value] : 1;
		} 
		return 0;
		//lots of defaults just in case...
	}

	private updateSpeedDisplay(envelopeIndex: number) {
		this._perEnvelopeSpeedDisplays[envelopeIndex].textContent = "Spd: x" + prettyNumber(this._doc.song.channels[this._doc.channel].instruments[this._doc.getCurrentInstrument()].envelopes[envelopeIndex].perEnvelopeSpeed  /*this.convertIndexSpeed(this.perEnvelopeSpeedSliders[envelopeIndex].getValueBeforeProspectiveChange(), "speed")*/);
	}

	public render(): void {
		const instrument: Instrument = this._doc.song.channels[this._doc.channel].instruments[this._doc.getCurrentInstrument()];

		for (let envelopeIndex: number = this._rows.length; envelopeIndex < instrument.envelopeCount; envelopeIndex++) {
			const targetSelect: HTMLSelectElement = HTML.select();
			for (let target: number = 0; target < Config.instrumentAutomationTargets.length; target++) {
				const interleaved: boolean = (Config.instrumentAutomationTargets[target].interleave);
				for (let index: number = 0; index < Config.instrumentAutomationTargets[target].maxCount; index++) {
					targetSelect.appendChild(this._makeOption(target, index));
					if (interleaved) {
						targetSelect.appendChild(this._makeOption(target + 1, index));
					}
				}
				if (interleaved) target++;
			}

			const envelopeSelect: HTMLSelectElement = HTML.select({ id: "envelopeSelect"});
			//count represents the location of the envelope in the dropdown, while envelope represents the location of the envelope in synthconfig
			//add bases first, then presets
			for (let envelope: number = 0; envelope < Config.newEnvelopes.length; envelope++) {
				envelopeSelect.appendChild(HTML.option({ value: envelope }, Config.newEnvelopes[envelope].name));
			}
			// I might add envelope presets later, but it's too much of a hassle currently
			//const envelopePresets: HTMLElement = HTML.optgroup({ label: "Presets ▾" });
			// for (let envelope: number = 0; envelope < Config.envelopes.length; envelope++) {
			// 	if (!Config.envelopes[envelope].default) {
			// 		envelopePresets.appendChild(HTML.option({ value: envelope }, Config.envelopes[envelope].name));
			// 		this.envelopesScrambled[count] = envelope;
			// 		count++;
			// 	}
			// }
			// envelopeSelect.appendChild(envelopePresets);

			const deleteButton: HTMLButtonElement = HTML.button({ type: "button", class: "delete-envelope", style: "flex: 0.2" });

			//Create HTML structure for the dropdowns

			//pitch settings
			const pitchStartNoteSlider: HTMLInputElement = HTML.input({ value: instrument.envelopes[envelopeIndex].pitchEnvelopeStart ? instrument.envelopes[envelopeIndex].pitchEnvelopeStart : 0, style: "width: 113px; margin-left: 0px;", type: "range", min: "0", max: instrument.isNoiseInstrument ? Config.drumCount-1 : Config.maxPitch, step: "1" });
			const pitchStartNoteBox: HTMLInputElement = HTML.input({ value: instrument.envelopes[envelopeIndex].pitchEnvelopeStart ? instrument.envelopes[envelopeIndex].pitchEnvelopeStart : 0, style: "width: 4em; font-size: 80%; ", id: "startNoteBox", type: "number", step: "1", min: "0", max: instrument.isNoiseInstrument ? Config.drumCount - 1 : Config.maxPitch });

			const pitchEndNoteSlider: HTMLInputElement = HTML.input({ value: instrument.envelopes[envelopeIndex].pitchEnvelopeEnd ? instrument.envelopes[envelopeIndex].pitchEnvelopeEnd : instrument.isNoiseInstrument ? Config.drumCount-1 : Config.maxPitch, style: "width: 113px; margin-left: 0px;", type: "range", min: "0", max: instrument.isNoiseInstrument ? Config.drumCount-1 : Config.maxPitch, step: "1" });
			const pitchEndNoteBox: HTMLInputElement = HTML.input({ value: instrument.envelopes[envelopeIndex].pitchEnvelopeEnd ? instrument.envelopes[envelopeIndex].pitchEnvelopeEnd : instrument.isNoiseInstrument ? Config.drumCount-1 : Config.maxPitch, style: "width: 4em; font-size: 80%; ", id: "endNoteBox", type: "number", step: "1", min: "0", max: instrument.isNoiseInstrument ? Config.drumCount - 1 : Config.maxPitch });
			
			const pitchStartNoteDisplay: HTMLSpanElement = HTML.span({ class: "tip", style: `width:68px; flex:1; height:1em; font-size: smaller;`, onclick: () => this._openPrompt("pitchRange") }, "Start " + this._pitchToNote(parseInt(pitchStartNoteBox.value), instrument.isNoiseInstrument) + ": ");
			const pitchEndNoteDisplay: HTMLSpanElement = HTML.span({ class: "tip", style: `width:68px; flex:1; height:1em; font-size: smaller;`, onclick: () => this._openPrompt("pitchRange") }, "End " + this._pitchToNote(parseInt(pitchEndNoteBox.value), instrument.isNoiseInstrument) + ": ");
			
			const pitchStartBoxWrapper: HTMLDivElement = HTML.div({ style: "flex: 1; display: flex; flex-direction: column; align-items: center;" }, pitchStartNoteDisplay, pitchStartNoteBox);
			const pitchEndBoxWrapper: HTMLDivElement = HTML.div({ style: "flex: 1; display: flex; flex-direction: column; align-items: center;" }, pitchEndNoteDisplay, pitchEndNoteBox);
			
			const pitchStartNoteWrapper: HTMLDivElement = HTML.div({ style: "margin-top: 3px; flex:1; display:flex; flex-direction: row; align-items:center; justify-content:right;" }, pitchStartBoxWrapper, pitchStartNoteSlider);
			const pitchEndNoteWrapper: HTMLDivElement = HTML.div({ style: "margin-top: 3px; flex:1; display:flex; flex-direction: row; align-items:center; justify-content:right;" }, pitchEndBoxWrapper, pitchEndNoteSlider);

			const extraPitchSettingsGroup: HTMLDivElement = HTML.div({ class: "editor-controls", style: "flex-direction:column; align-items:center;" }, pitchStartNoteWrapper, pitchEndNoteWrapper);
			extraPitchSettingsGroup.style.display = "none";

			//random settings
			const randomStepsBox: HTMLInputElement = HTML.input({ value: instrument.envelopes[envelopeIndex].steps, type: "number", min: 1, max: Config.randomEnvelopeStepsMax, step: 1, style: "width: 4em; font-size: 80%; " });
			const randomStepsSlider: HTMLInputElement = HTML.input({ value: instrument.envelopes[envelopeIndex].steps, type: "range", min: 1, max: Config.randomEnvelopeStepsMax, step: 1, style: "width: 113px; margin-left: 0px;" });
			
			const randomSeedBox: HTMLInputElement = HTML.input({ value: instrument.envelopes[envelopeIndex].seed, type: "number", min: 1, max: Config.randomEnvelopeSeedMax, step: 1, style: "width: 4em; font-size: 80%; " });
			const randomSeedSlider: HTMLInputElement = HTML.input({ value: instrument.envelopes[envelopeIndex].seed, type: "range", min: 1, max: Config.randomEnvelopeSeedMax, step: 1, style: "width: 113px; margin-left: 0px;" });
			
			const randomStepsBoxWrapper: HTMLDivElement = HTML.div({ style: "flex: 1; display: flex; flex-direction: column; align-items: center;" }, HTML.span({ class: "tip", style: `width:68px; flex:1; height:1em; font-size: smaller;`, onclick: () => this._openPrompt("randomSteps") }, "Steps: "), randomStepsBox);
			const randomSeedBoxWrapper: HTMLDivElement = HTML.div({ style: "flex: 1; display: flex; flex-direction: column; align-items: center;" }, HTML.span({ class: "tip", style: `width:68px; flex:1; height:1em; font-size: smaller;`, onclick: () => this._openPrompt("randomSeed") }, "Seed: "), randomSeedBox);
			
			const randomStepsWrapper: HTMLDivElement = HTML.div({ style: "margin-top: 3px; flex:1; display:flex; flex-direction: row; align-items:center; justify-content:right;" }, randomStepsBoxWrapper, randomStepsSlider);
			const randomSeedWrapper: HTMLDivElement = HTML.div({ style: "margin-top: 3px; flex:1; display:flex; flex-direction: row; align-items:center; justify-content:right;" }, randomSeedBoxWrapper, randomSeedSlider);

			const randomTypeSelect: HTMLSelectElement = HTML.select({ style: "width: 115px;" });
			const randomNames: string[] = ["time", "pitch", "note", "time smooth"];
			for (let waveform: number = 0; waveform < RandomEnvelopeTypes.length; waveform++) {
				randomTypeSelect.appendChild(HTML.option({ value: waveform }, randomNames[waveform]));
			}
			const randomTypeSelectWrapper: HTMLDivElement = HTML.div({ class: "editor-controls selectContainer", style: "margin-top: 3px; flex:1; display:flex; flex-direction: row; align-items:center; justify-content:right;" }, HTML.span({ style: "font-size: smaller; margin-right: 35px;", class: "tip", onclick: () => this._openPrompt("randomEnvelopeType") }, "Type: "), randomTypeSelect);
			
			const extraRandomSettingsGroup: HTMLDivElement = HTML.div({ class: "editor-controls", style: "flex-direction:column; align-items:center;" }, randomTypeSelectWrapper, randomStepsWrapper, randomSeedWrapper);
			extraRandomSettingsGroup.style.display = "none";

			//lfo settings
			const waveformSelect: HTMLSelectElement = HTML.select({ style: "width: 115px;" });
			const LFOStepsBox: HTMLInputElement = HTML.input({ value: instrument.envelopes[envelopeIndex].steps, type: "number", min: 1, max: Config.randomEnvelopeStepsMax, step: 1, style: "width: 4em; font-size: 80%; " });
			const LFOStepsSlider: HTMLInputElement = HTML.input({ value: instrument.envelopes[envelopeIndex].steps, type: "range", min: 1, max: Config.randomEnvelopeStepsMax, step: 1, style: "width: 113px; margin-left: 0px;" });

			const LFOStepsBoxWrapper: HTMLDivElement = HTML.div({ style: "flex: 1; display: flex; flex-direction: column; align-items: center;" }, HTML.span({ class: "tip", style: `width:68px; flex:1; height:1em; font-size: smaller;`, onclick: () => this._openPrompt("randomSteps") }, "Steps: "), LFOStepsBox);

			const LFOStepsWrapper: HTMLDivElement = HTML.div({ style: "margin-top: 3px; flex:1; display:flex; flex-direction: row; align-items:center; justify-content:right;" }, LFOStepsBoxWrapper, LFOStepsSlider);
			const wavenames: string[] = ["sine", "square", "triangle", "sawtooth", "trapezoid", "stepped saw", "stepped tri"];
			for (let waveform: number = 0; waveform < LFOEnvelopeTypes.length; waveform++) {
				waveformSelect.appendChild(HTML.option({ value: waveform }, wavenames[waveform]));
			}
			
			const waveformWrapper: HTMLDivElement = HTML.div({ class: "editor-controls selectContainer", style: "margin-top: 3px; flex:1; display:flex; flex-direction: row; align-items:center; justify-content:right;" }, HTML.span({ style: "font-size: smaller; margin-right: 10px;", class: "tip", onclick: () => this._openPrompt("lfoEnvelopeWaveform") }, "Waveform: "), waveformSelect);
			const extraLFOSettingsGroup: HTMLDivElement = HTML.div({ class: "editor-controls", style: "margin-top: 3px; flex:1; display:flex; flex-direction: column; align-items:center; justify-content:right;" }, waveformWrapper, LFOStepsWrapper);
			extraLFOSettingsGroup.style.display = "none";

			//speed settings
			const perEnvelopeSpeedSlider: Slider = new Slider(HTML.input({ oninput: () => this.updateSpeedDisplay(envelopeIndex), style: "margin: 0; width: 113px", type: "range", min: 0, max: Config.perEnvelopeSpeedIndices.length - 1, value: EnvelopeEditor.convertIndexSpeed(instrument.envelopes[envelopeIndex].perEnvelopeSpeed, "index"), step: "1" }), this._doc, (oldSpeed: number, newSpeed: number) => new ChangePerEnvelopeSpeed(this._doc, EnvelopeEditor.convertIndexSpeed(oldSpeed, "speed"), EnvelopeEditor.convertIndexSpeed(newSpeed, "speed"), envelopeIndex), false);
			const perEnvelopeSpeedDisplay: HTMLSpanElement = HTML.span({ class: "tip", style: `width:58px; flex:1; height:1em; font-size: smaller; margin-left: 10px;`, onclick: () => this._openPrompt("perEnvelopeSpeed") }, "Spd: x" + prettyNumber(EnvelopeEditor.convertIndexSpeed(perEnvelopeSpeedSlider.getValueBeforeProspectiveChange(), "speed")));
			const perEnvelopeSpeedWrapper: HTMLDivElement = HTML.div({ style: "margin-top: 3px; flex:1; display:flex; flex-direction: row; align-items:center; justify-content:right;" }, perEnvelopeSpeedDisplay, perEnvelopeSpeedSlider.container);
			const perEnvelopeSpeedGroup: HTMLDivElement = HTML.div({ class: "editor-controls", style: "flex-direction:column; align-items:center;" }, perEnvelopeSpeedWrapper);

			//general settings (bounds and invert)
			const lowerBoundBox: HTMLInputElement = HTML.input({ value: instrument.envelopes[envelopeIndex].perEnvelopeLowerBound, type: "number", min: Config.perEnvelopeBoundMin, max: Config.perEnvelopeBoundMax, step: 0.1, style: "width: 4em; font-size: 80%; " });
			const lowerBoundSlider: Slider = new Slider(HTML.input({ value: instrument.envelopes[envelopeIndex].perEnvelopeLowerBound, type: "range", min: Config.perEnvelopeBoundMin, max: Config.perEnvelopeBoundMax, step: 0.1, style: "width: 113px; margin-left: 0px;" }), this._doc, (oldBound: number, newBound: number) => new ChangeEnvelopeLowerBound(this._doc, oldBound, newBound, envelopeIndex), false);

			const upperBoundBox: HTMLInputElement = HTML.input({ value: instrument.envelopes[envelopeIndex].perEnvelopeUpperBound, type: "number", min: Config.perEnvelopeBoundMin, max: Config.perEnvelopeBoundMax, step: 0.1, style: "width: 4em; font-size: 80%; " });
			const upperBoundSlider: Slider = new Slider(HTML.input({ value: instrument.envelopes[envelopeIndex].perEnvelopeUpperBound, type: "range", min: Config.perEnvelopeBoundMin, max: Config.perEnvelopeBoundMax, step: 0.1, style: "width: 113px; margin-left: 0px;" }), this._doc, (oldBound: number, newBound: number) => new ChangeEnvelopeUpperBound(this._doc, oldBound, newBound, envelopeIndex), false);

			const lowerBoundBoxWrapper: HTMLDivElement = HTML.div({ style: "flex: 1; display: flex; flex-direction: column; align-items: center;" }, HTML.span({ class: "tip", style: `width:68px; flex:1; height:1em; font-size: smaller;`, onclick: () => this._openPrompt("envelopeRange") }, "Lwr bnd: "), lowerBoundBox);
			const upperBoundBoxWrapper: HTMLDivElement = HTML.div({ style: "flex: 1; display: flex; flex-direction: column; align-items: center;" }, HTML.span({ class: "tip", style: `width:68px; flex:1; height:1em; font-size: smaller;`, onclick: () => this._openPrompt("envelopeRange") }, "Upr bnd: "), upperBoundBox);
			
			const lowerBoundWrapper: HTMLDivElement = HTML.div({ style: "margin-top: 3px; flex:1; display:flex; flex-direction: row; align-items:center; justify-content:right;" }, lowerBoundBoxWrapper, lowerBoundSlider.container);
			const upperBoundWrapper: HTMLDivElement = HTML.div({ style: "margin-top: 3px; flex:1; display:flex; flex-direction: row; align-items:center; justify-content:right;" }, upperBoundBoxWrapper, upperBoundSlider.container);

			const invertBox: HTMLInputElement = HTML.input({ "checked": instrument.envelopes[envelopeIndex].inverse, type: "checkbox", style: "width: 1em; padding: 0.5em;", id: "invertBox" });
			// const invertWrapper: HTMLDivElement = HTML.div({ style: "margin: 0.5em; align-items:center; justify-content:right;" }, HTML.span({ class: "tip", onclick: () => this._openPrompt("envelopeInvert") }, "Invert: "), invertBox);
			const discreteEnvelopeBox: HTMLInputElement = HTML.input({ "checked": instrument.envelopes[envelopeIndex].discrete, type: "checkbox", style: "width: 1em; padding: 0.5em;" });
			const checkboxWrapper: HTMLDivElement = HTML.div({ style: "margin: 0.1em; align-items:center; justify-content:right;" }, HTML.span({ class: "tip", onclick: () => this._openPrompt("envelopeInvert") }, "‣ Invert: "), invertBox, HTML.span({ class: "tip", style: "margin-left:4px;", onclick: () => this._openPrompt("discreteEnvelope") }, "‣ Discrete:"), discreteEnvelopeBox);
				
			
			//copy paste buttons
			const envelopeCopyButton: HTMLButtonElement = HTML.button({ style: "margin-left:0px; max-width:86px; width: 86px; height: 26px; padding-left: 22px", class: "copyButton", title: "Copy Envelope" }, [
				"Copy Env",
				// Copy icon:
				SVG.svg({ style: "flex-shrink: 0; position: absolute; left: 0; top: 50%; margin-top: -1em; pointer-events: none;", width: "26px", height: "26px", viewBox: "-5 -21 26 26" }, [
					SVG.path({ d: "M 0 -15 L 1 -15 L 1 0 L 13 0 L 13 1 L 0 1 L 0 -15 z M 2 -1 L 2 -17 L 10 -17 L 14 -13 L 14 -1 z M 3 -2 L 13 -2 L 13 -12 L 9 -12 L 9 -16 L 3 -16 z", fill: "currentColor" }),
				]),
			]);
			const envelopePasteButton: HTMLButtonElement = HTML.button({ style: "margin-left:2px; max-width:89px; width: 89px; height: 26px; padding-left: 22px", class: "pasteButton", title: "Paste Envelope" }, [
					"Paste Env",
					// Paste icon:
				SVG.svg({ style: "flex-shrink: 0; position: absolute; left: 0; top: 50%; margin-top: -1em; pointer-events: none;", width: "26px", height: "26px", viewBox: "0 0 26 26" }, [
						SVG.path({ d: "M 8 18 L 6 18 L 6 5 L 17 5 L 17 7 M 9 8 L 16 8 L 20 12 L 20 22 L 9 22 z", stroke: "currentColor", fill: "none" }),
						SVG.path({ d: "M 9 3 L 14 3 L 14 6 L 9 6 L 9 3 z M 16 8 L 20 12 L 16 12 L 16 8 z", fill: "currentColor", }),
					]),
				]);
			
			const copyPasteContainer: HTMLDivElement = HTML.div({ class: "editor-controls", style: "margin: 0.5em; display: flex; flex-direction:row; align-items:center;" }, envelopeCopyButton, envelopePasteButton);
			
			//general structure
			const extraSettingsDropdown: HTMLButtonElement = HTML.button({ style: "margin-left:0em; margin-right: 0.3em; height:1.5em; align-self: center; width: 10px; padding: 0px; font-size: 8px;", onclick: () => { this._extraSettingsDropdown(DropdownID.EnvelopeSettings, envelopeIndex); } }, "▼");
			extraSettingsDropdown.style.display = "inline";

			const extraSettingsDropdownGroup: HTMLDivElement = HTML.div({ class: "editor-controls", style: "flex-direction:column; align-items:center;" }, extraRandomSettingsGroup, extraLFOSettingsGroup, extraPitchSettingsGroup, perEnvelopeSpeedGroup, lowerBoundWrapper, upperBoundWrapper, checkboxWrapper, copyPasteContainer);
			extraSettingsDropdownGroup.style.display = "none";


			const row: HTMLDivElement = HTML.div({ class: "envelope-row" },
				extraSettingsDropdown,
				HTML.div({ class: "selectContainer", style: "width: 0; flex: 1;" }, targetSelect),
				HTML.div({ class: "selectContainer", style: "width: 0; flex: 0.85" }, envelopeSelect),
				deleteButton,
			);

			this.container.appendChild(row);
			this.container.appendChild(extraSettingsDropdownGroup);
			this._rows[envelopeIndex] = row;
			this._targetSelects[envelopeIndex] = targetSelect;
			this._envelopeSelects[envelopeIndex] = envelopeSelect;
			this._deleteButtons[envelopeIndex] = deleteButton;

			this.extraSettingsDropdowns[envelopeIndex] = extraSettingsDropdown;
			this.extraSettingsDropdownGroups[envelopeIndex] = extraSettingsDropdownGroup;
			this._inverters[envelopeIndex] = invertBox;
			this._discreters[envelopeIndex] = discreteEnvelopeBox;
			this.perEnvelopeLowerBoundBoxes[envelopeIndex] = lowerBoundBox;
			this.perEnvelopeUpperBoundBoxes[envelopeIndex] = upperBoundBox;
			this.perEnvelopeLowerBoundSliders[envelopeIndex] = lowerBoundSlider;
			this.perEnvelopeUpperBoundSliders[envelopeIndex] = upperBoundSlider;

			this._perEnvelopeSpeedDisplays[envelopeIndex] = perEnvelopeSpeedDisplay;
			this.perEnvelopeSpeedSliders[envelopeIndex] = perEnvelopeSpeedSlider;
			this.perEnvelopeSpeedGroups[envelopeIndex] = perEnvelopeSpeedGroup;
			

			this.extraPitchSettingsGroups[envelopeIndex] = extraPitchSettingsGroup;
			this._pitchStartSliders[envelopeIndex] = pitchStartNoteSlider;
			this.pitchStartBoxes[envelopeIndex] = pitchStartNoteBox;
			this._pitchEndSliders[envelopeIndex] = pitchEndNoteSlider;
			this.pitchEndBoxes[envelopeIndex] = pitchEndNoteBox;
			this._startNoteDisplays[envelopeIndex] = pitchStartNoteDisplay;
			this._endNoteDisplays[envelopeIndex] = pitchEndNoteDisplay;

			this.extraRandomSettingsGroups[envelopeIndex] = extraRandomSettingsGroup;
			this.randomStepsBoxes[envelopeIndex] = randomStepsBox;
			this.randomSeedBoxes[envelopeIndex] = randomSeedBox;
			this._randomStepsSliders[envelopeIndex] = randomStepsSlider;
			this._randomSeedSliders[envelopeIndex] = randomSeedSlider;
			this._randomStepsWrappers[envelopeIndex] = randomStepsWrapper;
			this._randomEnvelopeTypeSelects[envelopeIndex] = randomTypeSelect;

			this.extraLFODropdownGroups[envelopeIndex] = extraLFOSettingsGroup;
			this._waveformSelects[envelopeIndex] = waveformSelect;
			this.LFOStepsBoxes[envelopeIndex] = LFOStepsBox;
			this._LFOStepsSliders[envelopeIndex] = LFOStepsSlider;
			this._LFOStepsWrappers[envelopeIndex] = LFOStepsWrapper;

			this._envelopeCopyButtons[envelopeIndex] = envelopeCopyButton;
			this._envelopePasteButtons[envelopeIndex] = envelopePasteButton;
		}

		for (let envelopeIndex: number = this._renderedEnvelopeCount; envelopeIndex < instrument.envelopeCount; envelopeIndex++) {
			this._rows[envelopeIndex].style.display = "";
			// For newly visible rows, update target option visibiliy.
			this._updateTargetOptionVisibility(this._targetSelects[envelopeIndex], instrument);
		}

		for (let envelopeIndex: number = instrument.envelopeCount; envelopeIndex < this._renderedEnvelopeCount; envelopeIndex++) {
			this._rows[envelopeIndex].style.display = "none";
		}

		let useControlPointCount: number = instrument.noteFilter.controlPointCount;
		if (instrument.noteFilterType)
			useControlPointCount = 1;

		if (this._renderedEqFilterCount != instrument.eqFilter.controlPointCount ||
			this._renderedNoteFilterCount != useControlPointCount ||
			this._renderedInstrumentType != instrument.type ||
			this._renderedEffects != instrument.effects) {
			// Update target option visibility for previously visible rows.
			for (let envelopeIndex: number = 0; envelopeIndex < this._renderedEnvelopeCount; envelopeIndex++) {
				this._updateTargetOptionVisibility(this._targetSelects[envelopeIndex], instrument);
			}
		}

		for (let envelopeIndex: number = 0; envelopeIndex < instrument.envelopeCount; envelopeIndex++) {
			this._targetSelects[envelopeIndex].value = String(instrument.envelopes[envelopeIndex].target + instrument.envelopes[envelopeIndex].index * Config.instrumentAutomationTargets.length);
			this._envelopeSelects[envelopeIndex].selectedIndex = instrument.envelopes[envelopeIndex].envelope;
			this.pitchStartBoxes[envelopeIndex].value = String(instrument.envelopes[envelopeIndex].pitchEnvelopeStart);
			this.pitchEndBoxes[envelopeIndex].value = String(instrument.envelopes[envelopeIndex].pitchEnvelopeEnd);
			this._pitchStartSliders[envelopeIndex].value = String(instrument.envelopes[envelopeIndex].pitchEnvelopeStart);
			this._pitchEndSliders[envelopeIndex].value = String(instrument.envelopes[envelopeIndex].pitchEnvelopeEnd);
			this._inverters[envelopeIndex].checked = instrument.envelopes[envelopeIndex].inverse;
			this._discreters[envelopeIndex].checked = instrument.envelopes[envelopeIndex].discrete;
			this.perEnvelopeSpeedSliders[envelopeIndex].updateValue(EnvelopeEditor.convertIndexSpeed(instrument.envelopes[envelopeIndex].perEnvelopeSpeed, "index"));
			this.updateSpeedDisplay(envelopeIndex);
			this.perEnvelopeLowerBoundBoxes[envelopeIndex].value = String(instrument.envelopes[envelopeIndex].perEnvelopeLowerBound);
			this.perEnvelopeUpperBoundBoxes[envelopeIndex].value = String(instrument.envelopes[envelopeIndex].perEnvelopeUpperBound);
			this.perEnvelopeLowerBoundSliders[envelopeIndex].updateValue(instrument.envelopes[envelopeIndex].perEnvelopeLowerBound);
			this.perEnvelopeUpperBoundSliders[envelopeIndex].updateValue(instrument.envelopes[envelopeIndex].perEnvelopeUpperBound);
			this.randomStepsBoxes[envelopeIndex].value = String(instrument.envelopes[envelopeIndex].steps);
			this.randomSeedBoxes[envelopeIndex].value = String(instrument.envelopes[envelopeIndex].seed);
			this._randomStepsSliders[envelopeIndex].value = String(instrument.envelopes[envelopeIndex].steps);
			this._randomSeedSliders[envelopeIndex].value = String(instrument.envelopes[envelopeIndex].seed);
			this.LFOStepsBoxes[envelopeIndex].value = String(instrument.envelopes[envelopeIndex].steps);
			this._LFOStepsSliders[envelopeIndex].value = String(instrument.envelopes[envelopeIndex].steps);
			this.openExtraSettingsDropdowns[envelopeIndex] = this.openExtraSettingsDropdowns[envelopeIndex] ? true : false
		}

		this._renderedEnvelopeCount = instrument.envelopeCount;
		this._renderedEqFilterCount = instrument.eqFilter.controlPointCount;
		this._renderedNoteFilterCount = useControlPointCount;
		this._renderedInstrumentType = instrument.type;
		this._renderedEffects = instrument.effects;
	}
}