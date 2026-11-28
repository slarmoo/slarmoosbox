// Copyright (c) 2012-2022 John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import {Scale, Config} from "../synth/SynthConfig";
import {ColorConfig} from "../editor/ColorConfig";

export class SelectiveInstrumentSettings {
	public instrumentType: boolean = false;
	public eqFilter: boolean = true;
	public fade: boolean = true;
	public instrumentTypeSettings: boolean = true;
	public unison: boolean = true;
	public effects: boolean = true;
	public envelopes: boolean = true;
	public instrumentPatterns: boolean = true;
	public allInstruments: boolean = false;

	toJsonObject(): string {
		const object: any = {};
		object["instrumentType"] = this.instrumentType;
		object["eqFilter"] = this.eqFilter;
		object["fade"] = this.fade;
		object["instrumentTypeSettings"] = this.instrumentTypeSettings;
		object["unison"] = this.unison;
		object["effects"] = this.effects;
		object["envelopes"] = this.envelopes;
		object["instrumentPatterns"] = this.instrumentPatterns;
		object["allInstruments"] = this.allInstruments;
		return JSON.stringify(object);
	}

	fromJsonObject(object: any) {
		if (object["instrumentType"] != undefined) this.instrumentType = object["instrumentType"];
		if (object["eqFilter"] != undefined) this.eqFilter = object["eqFilter"];
		if (object["fade"] != undefined) this.fade = object["fade"];
		if (object["instrumentTypeSettings"] != undefined) this.instrumentTypeSettings = object["instrumentTypeSettings"];
		if (object["unison"] != undefined) this.unison = object["unison"];
		if (object["effects"] != undefined) this.effects = object["effects"];
		if (object["envelopes"] != undefined) this.envelopes = object["envelopes"];
		if (object["instrumentPatterns"] != undefined) this.instrumentPatterns = object["instrumentPatterns"];
		if (object["allInstruments"] != undefined) this.allInstruments = object["allInstruments"];
	}
}

export class Preferences {
	public static readonly defaultVisibleOctaves: number = 3;
	public static readonly defaultCustomColors: string = `:root {
			--page-margin: #14051a;
			--editor-background: #14051a66;
			--playhead: rgba(255, 255, 255, 0.9);
			--primary-text: #71eee5;
			--secondary-text: #3abbb2;
			--inverted-text: #13695e;
			--box-selection-fill: #36c71c;
			--loop-accent: #36c71c;
			--link-accent: white;
			--ui-widget-background: #183d05;
			--ui-widget-focus: #247d0d;
			--pitch-background: #2e0e51;
			--tonic: #247d0d;
			--fifth-note: #3abbb2;
			--white-piano-key: #ffffff;
			--black-piano-key: #061705;
			--white-piano-key-text: #061705;
			--use-color-formula: true;
			--track-editor-bg-pitch: #09382b;
			--track-editor-bg-pitch-dim: #14051a;
			--track-editor-bg-noise: #40400b;
			--track-editor-bg-noise-dim: #14051a;
			--track-editor-bg-mod: #0a2c08;
			--track-editor-bg-mod-dim: #14051a;
			--multiplicative-mod-slider: #3abb22;
			--overwriting-mod-slider: #71eee5;
			--indicator-primary: #a773e5;
			--indicator-secondary: #4c1c89;
			--select2-opt-group: #183d05;
			--input-box-outline: #18040a;
			--mute-button-normal: #36c71c;
			--mute-button-mod: #a773e5;
			--mod-label-primary: #a773e5;
			--mod-label-secondary-text: #6b29bf;
			--mod-label-primary-text: #14051a;
			--mod-title: #247d1d;
			--pitch-secondary-channel-hue: 100;
			--pitch-secondary-channel-hue-scale: 6.1;
			--pitch-secondary-channel-sat: 100.0;
			--pitch-secondary-channel-sat-scale: 0.15;
			--pitch-secondary-channel-lum: 60.0;
			--pitch-secondary-channel-lum-scale: 0.05;
			--pitch-primary-channel-hue: 100;
			--pitch-primary-channel-hue-scale: 6.1;
			--pitch-primary-channel-sat: 100;
			--pitch-primary-channel-sat-scale: 0.15;
			--pitch-primary-channel-lum: 75.0;
			--pitch-primary-channel-lum-scale: 0.05;
			--pitch-secondary-note-hue: 100;
			--pitch-secondary-note-hue-scale: 6.1;
			--pitch-secondary-note-sat: 95.0;
			--pitch-secondary-note-sat-scale: 0.15;
			--pitch-secondary-note-lum: 40;
			--pitch-secondary-note-lum-scale: 0.05;
			--pitch-primary-note-hue: 100;
			--pitch-primary-note-hue-scale: 6.1;
			--pitch-primary-note-sat: 100;
			--pitch-primary-note-sat-scale: 0.15;
			--pitch-primary-note-lum: 85.6;
			--pitch-primary-note-lum-scale: 0.025;
			--noise-secondary-channel-hue: 65;
			--noise-secondary-channel-hue-scale: 2;
			--noise-secondary-channel-sat: 55;
			--noise-secondary-channel-sat-scale: 0;
			--noise-secondary-channel-lum: 42;
			--noise-secondary-channel-lum-scale: 0;
			--noise-primary-channel-hue: 65;
			--noise-primary-channel-hue-scale: 2;
			--noise-primary-channel-sat: 66;
			--noise-primary-channel-sat-scale: 0;
			--noise-primary-channel-lum: 63.5;
			--noise-primary-channel-lum-scale: 0;
			--noise-secondary-note-hue: 65;
			--noise-secondary-note-hue-scale: 2;
			--noise-secondary-note-sat: 66;
			--noise-secondary-note-sat-scale: 0;
			--noise-secondary-note-lum: 55;
			--noise-secondary-note-lum-scale: 0;
			--noise-primary-note-hue: 65;
			--noise-primary-note-hue-scale: 2;
			--noise-primary-note-sat: 70;
			--noise-primary-note-sat-scale: 0;
			--noise-primary-note-lum: 74;
			--noise-primary-note-lum-scale: 0;
			--mod-secondary-channel-hue: 192;
			--mod-secondary-channel-hue-scale: 1.5;
			--mod-secondary-channel-sat: 88;
			--mod-secondary-channel-sat-scale: 0;
			--mod-secondary-channel-lum: 50;
			--mod-secondary-channel-lum-scale: 0;
			--mod-primary-channel-hue: 192;
			--mod-primary-channel-hue-scale: 1.5;
			--mod-primary-channel-sat: 96;
			--mod-primary-channel-sat-scale: 0;
			--mod-primary-channel-lum: 80;
			--mod-primary-channel-lum-scale: 0;
			--mod-secondary-note-hue: 192;
			--mod-secondary-note-hue-scale: 1.5;
			--mod-secondary-note-sat: 92;
			--mod-secondary-note-sat-scale: 0;
			--mod-secondary-note-lum: 45;
			--mod-secondary-note-lum-scale: 0;
			--mod-primary-note-hue: 192;
			--mod-primary-note-hue-scale: 1.5;
			--mod-primary-note-sat: 96;
			--mod-primary-note-sat-scale: 0;
			--mod-primary-note-lum: 85;
			--mod-primary-note-lum-scale: 0;
			--oscilloscope-line-R: white;
			--oscilloscope-line-L: var(--secondary-text);
}`;
	public customTheme: string | null;
	public customThemeImage: string | null;
	public customColors: string | null;
	public autoPlay: boolean;
	public autoFollow: boolean;
	public enableNotePreview: boolean;
	public showFifth: boolean = true;
	public notesOutsideScale: boolean;
	public defaultScale: number;
	public showLetters: boolean;
	public showChannels: boolean;
	public showScrollBar: boolean;
	public alwaysFineNoteVol: boolean;
	public displayVolumeBar: boolean;
	public instrumentCopyPaste: boolean;
	public instrumentImportExport: boolean;
	public instrumentButtonsAtTop: boolean;
	public enableChannelMuting: boolean;
	public colorTheme: string;
	public layout: string;
	public displayBrowserUrl: boolean;
	public volume: number = 75;
	public visibleOctaves: number = Preferences.defaultVisibleOctaves;
	public pressControlForShortcuts: boolean;
	public keyboardLayout: string;
	public bassOffset: number;
	public enableMidi: boolean;
	public showRecordButton: boolean;
	public snapRecordedNotesToRhythm: boolean;
	public ignorePerformedNotesNotInScale: boolean;
	public metronomeCountIn: boolean;
	public metronomeWhileRecording: boolean;
	public notesFlashWhenPlayed: boolean;
	public showOscilloscope: boolean;
	public showSampleLoadingStatus: boolean;
	public showDescription: boolean;
	public showInstrumentScrollbars: boolean;
	public closePromptByClickoff: boolean;
	public frostedGlassBackground: boolean;
	public shortenerStrategySelect: string;
	public removeWhitespace: boolean;
	public alwaysShowPlayhead: boolean; //41Box ported behavior
	public centerDoubleSliders: boolean;
	public selectiveRandom: SelectiveInstrumentSettings = new SelectiveInstrumentSettings();
	public selectivePaste: SelectiveInstrumentSettings = new SelectiveInstrumentSettings();
	
	constructor() {
		this.reload();
	}
	
	public reload(): void {
		// ==true means default to false, and !=false means default to true
		this.autoPlay = window.localStorage.getItem("autoPlay") == "true";
		this.autoFollow = window.localStorage.getItem("autoFollow") != "false";
		this.enableNotePreview = window.localStorage.getItem("enableNotePreview") != "false";
		this.showFifth = window.localStorage.getItem("showFifth") != "false";
		this.notesOutsideScale = window.localStorage.getItem("notesOutsideScale") == "true";
		this.showLetters = window.localStorage.getItem("showLetters") != "false";
		this.showChannels = window.localStorage.getItem("showChannels") == "true";
		this.showScrollBar = window.localStorage.getItem("showScrollBar") != "false";
		this.alwaysFineNoteVol = window.localStorage.getItem("alwaysFineNoteVol") == "true";
		this.displayVolumeBar = window.localStorage.getItem("displayVolumeBar") != "false";
		this.instrumentCopyPaste = window.localStorage.getItem("instrumentCopyPaste") != "false";
		this.instrumentImportExport = window.localStorage.getItem("instrumentImportExport") == "true";
		this.instrumentButtonsAtTop = window.localStorage.getItem("instrumentButtonsAtTop") == "true"
		this.enableChannelMuting = window.localStorage.getItem("enableChannelMuting") != "false";
		this.displayBrowserUrl = window.localStorage.getItem("displayBrowserUrl") != "false";
		this.pressControlForShortcuts = window.localStorage.getItem("pressControlForShortcuts") == "true";
		this.enableMidi = window.localStorage.getItem("enableMidi") != "false";
		this.showRecordButton = window.localStorage.getItem("showRecordButton") == "true";
		this.snapRecordedNotesToRhythm = window.localStorage.getItem("snapRecordedNotesToRhythm") == "true";
		this.ignorePerformedNotesNotInScale = window.localStorage.getItem("ignorePerformedNotesNotInScale") == "true";
		this.metronomeCountIn = window.localStorage.getItem("metronomeCountIn") != "false";
		this.metronomeWhileRecording = window.localStorage.getItem("metronomeWhileRecording") != "false";
		this.notesFlashWhenPlayed = window.localStorage.getItem("notesFlashWhenPlayed") == "true";
		this.showOscilloscope = window.localStorage.getItem("showOscilloscope") == "true";
		this.showSampleLoadingStatus = window.localStorage.getItem("showSampleLoadingStatus") != "false";
		this.showDescription = window.localStorage.getItem("showDescription") != "false";
		this.showInstrumentScrollbars = window.localStorage.getItem("showInstrumentScrollbars") == "true";
		this.closePromptByClickoff = window.localStorage.getItem("closePromptByClickoff") == "true";
		this.frostedGlassBackground = window.localStorage.getItem("frostedGlassBackground") == "true";
		this.shortenerStrategySelect = window.localStorage.getItem("shortenerStrategySelect") || "wackybox";
		if (this.shortenerStrategySelect == "tinyurl") this.shortenerStrategySelect = "wackybox"; //tinyurl isn't supported anymore
		this.removeWhitespace = window.localStorage.getItem("removeWhitespace") != "false";
		this.keyboardLayout = window.localStorage.getItem("keyboardLayout") || "pianoTransposingC";
		this.bassOffset = (+(<any>window.localStorage.getItem("bassOffset"))) || 0;
		this.layout = window.localStorage.getItem("layout") || "small";
		this.colorTheme = window.localStorage.getItem("colorTheme") || ColorConfig.defaultTheme;
		this.customTheme = window.localStorage.getItem("customTheme");
		this.customThemeImage = window.localStorage.getItem("customThemeImage") ||
			window.localStorage.getItem("customTheme2"); //customTheme2 is not really a descriptive name for what it entails, so it's being deprecated
		this.customColors = window.localStorage.getItem("customColors") || "";
		this.visibleOctaves = ((<any>window.localStorage.getItem("visibleOctaves")) >>> 0) || Preferences.defaultVisibleOctaves;
		this.selectiveRandom.fromJsonObject(JSON.parse(window.localStorage.getItem("selectiveRandom") || "{}"));
		this.selectivePaste.fromJsonObject(JSON.parse(window.localStorage.getItem("selectivePaste") || "{}"));
		this.alwaysShowPlayhead = window.localStorage.getItem("alwaysShowPlayhead") == "true";
		this.centerDoubleSliders = window.localStorage.getItem("centerDoubleSliders") == "true";
		
		const defaultScale: Scale | undefined = Config.scales.dictionary[window.localStorage.getItem("defaultScale")!];
		this.defaultScale = (defaultScale != undefined) ? defaultScale.index : 0;
		
		if (window.localStorage.getItem("volume") != null) {
			this.volume = Math.min(<any>window.localStorage.getItem("volume") >>> 0, 75);
		}
		
		if (window.localStorage.getItem("fullScreen") != null) {
			if (window.localStorage.getItem("fullScreen") == "true") this.layout = "long";
			window.localStorage.removeItem("fullScreen");
		}
		
	}
	
	public save(): void {
		window.localStorage.setItem("autoPlay", this.autoPlay ? "true" : "false");
		window.localStorage.setItem("autoFollow", this.autoFollow ? "true" : "false");
		window.localStorage.setItem("enableNotePreview", this.enableNotePreview ? "true" : "false");
		window.localStorage.setItem("showFifth", this.showFifth ? "true" : "false");
		window.localStorage.setItem("notesOutsideScale", this.notesOutsideScale ? "true" : "false");
		window.localStorage.setItem("defaultScale", Config.scales[this.defaultScale].name);
		window.localStorage.setItem("showLetters", this.showLetters ? "true" : "false");
		window.localStorage.setItem("showChannels", this.showChannels ? "true" : "false");
		window.localStorage.setItem("showScrollBar", this.showScrollBar ? "true" : "false");
		window.localStorage.setItem("alwaysFineNoteVol", this.alwaysFineNoteVol ? "true" : "false");
		window.localStorage.setItem("displayVolumeBar", this.displayVolumeBar ? "true" : "false");
		window.localStorage.setItem("enableChannelMuting", this.enableChannelMuting ? "true" : "false");
		window.localStorage.setItem("instrumentCopyPaste", this.instrumentCopyPaste ? "true" : "false");
		window.localStorage.setItem("instrumentImportExport", this.instrumentImportExport ? "true" : "false");
		window.localStorage.setItem("instrumentButtonsAtTop", this.instrumentButtonsAtTop ? "true" : "false");
		window.localStorage.setItem("displayBrowserUrl", this.displayBrowserUrl ? "true" : "false");
		window.localStorage.setItem("pressControlForShortcuts", this.pressControlForShortcuts ? "true" : "false");
		window.localStorage.setItem("enableMidi", this.enableMidi ? "true" : "false");
		window.localStorage.setItem("showRecordButton", this.showRecordButton ? "true" : "false");
		window.localStorage.setItem("snapRecordedNotesToRhythm", this.snapRecordedNotesToRhythm ? "true" : "false");
		window.localStorage.setItem("ignorePerformedNotesNotInScale", this.ignorePerformedNotesNotInScale ? "true" : "false");
		window.localStorage.setItem("metronomeCountIn", this.metronomeCountIn ? "true" : "false");
		window.localStorage.setItem("metronomeWhileRecording", this.metronomeWhileRecording ? "true" : "false");
		window.localStorage.setItem("notesFlashWhenPlayed", this.notesFlashWhenPlayed ? "true" : "false");
		window.localStorage.setItem("showOscilloscope", this.showOscilloscope ? "true" : "false");
		window.localStorage.setItem("showSampleLoadingStatus", this.showSampleLoadingStatus ? "true" : "false");
		window.localStorage.setItem("showDescription", this.showDescription ? "true" : "false");
		window.localStorage.setItem("showInstrumentScrollbars", this.showInstrumentScrollbars ? "true" : "false");
		window.localStorage.setItem("closePromptByClickoff", this.closePromptByClickoff ? "true" : "false");
		window.localStorage.setItem("frostedGlassBackground", this.frostedGlassBackground ? "true" : "false");
		window.localStorage.setItem("shortenerStrategySelect", this.shortenerStrategySelect);
		window.localStorage.setItem("removeWhitespace", this.removeWhitespace ? "true" : "false");
		window.localStorage.setItem("keyboardLayout", this.keyboardLayout);
		window.localStorage.setItem("bassOffset", String(this.bassOffset));
		window.localStorage.setItem("layout", this.layout);
		window.localStorage.setItem("colorTheme", this.colorTheme);
		window.localStorage.setItem("customTheme", this.customTheme!);
		window.localStorage.setItem("customThemeImage", this.customThemeImage!);
		window.localStorage.setItem("customColors", this.customColors || "");
		window.localStorage.setItem("volume", String(this.volume));
		window.localStorage.setItem("visibleOctaves", String(this.visibleOctaves));
		window.localStorage.setItem("selectiveRandom", this.selectiveRandom.toJsonObject());
		window.localStorage.setItem("selectivePaste", this.selectivePaste.toJsonObject());
		window.localStorage.setItem("alwaysShowPlayhead", this.alwaysShowPlayhead ? "true" : "false");
		window.localStorage.setItem("centerDoubleSliders", this.centerDoubleSliders ? "true" : "false");

	}
}