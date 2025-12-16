// Copyright (c) 2012-2022 John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { Algorithm, Dictionary, FilterType, SustainType, InstrumentType, EffectType, AutomationTarget, Config, effectsIncludeDistortion, LFOEnvelopeTypes, RandomEnvelopeTypes } from "../synth/SynthConfig";
import { NotePin, Note, makeNotePin, Pattern, FilterSettings, FilterControlPoint, SpectrumWave, HarmonicsWave, Instrument, Channel, Song, Synth, clamp, EnvelopeSettings } from "../synth/synth";
import { Preset, PresetCategory, EditorConfig } from "./EditorConfig";
import { Change, ChangeGroup, ChangeSequence, UndoableChange } from "./Change";
import { SongDocument } from "./SongDocument";
import { ColorConfig } from "./ColorConfig";
import { Slider } from "./HTMLWrapper";
import { SelectiveInstrumentSettings } from "./Preferences";

export function patternsContainSameInstruments(pattern1Instruments: number[], pattern2Instruments: number[]): boolean {
    const pattern2Has1Instruments: boolean = pattern1Instruments.every(instrument => pattern2Instruments.indexOf(instrument) != -1);
    const pattern1Has2Instruments: boolean = pattern2Instruments.every(instrument => pattern1Instruments.indexOf(instrument) != -1);
    return pattern2Has1Instruments && pattern1Has2Instruments && pattern2Instruments.length == pattern1Instruments.length;
}

export function discardInvalidPatternInstruments(instruments: number[], song: Song, channelIndex: number) {
    const uniqueInstruments: Set<number> = new Set(instruments);
    instruments.length = 0;
    instruments.push(...uniqueInstruments);
    for (let i: number = 0; i < instruments.length; i++) {
        if (instruments[i] >= song.channels[channelIndex].instruments.length) {
            instruments.splice(i, 1);
            i--;
        }
    }
    if (instruments.length > song.getMaxInstrumentsPerPattern(channelIndex)) {
        instruments.length = song.getMaxInstrumentsPerPattern(channelIndex);
    }
    if (instruments.length <= 0) {
        instruments[0] = 0;
    }
}

export function unionOfUsedNotes(pattern: Pattern, flags: boolean[]): void {
    for (const note of pattern.notes) {
        for (const pitch of note.pitches) {
            for (const pin of note.pins) {
                const key: number = (pitch + pin.interval) % 12;
                if (!flags[key]) {
                    flags[key] = true;
                }
            }
        }
    }
}

export function generateScaleMap(oldScaleFlags: ReadonlyArray<boolean>, newScaleValue: number, customScaleFlags: ReadonlyArray<boolean>): number[] {
    const newScaleFlags: ReadonlyArray<boolean> = newScaleValue == Config.scales["dictionary"]["Custom"].index ? customScaleFlags : Config.scales[newScaleValue].flags;
    const oldScale: number[] = [];
    const newScale: number[] = [];
    for (let i: number = 0; i < 12; i++) {
        if (oldScaleFlags[i]) oldScale.push(i);
        if (newScaleFlags[i]) newScale.push(i);
    }
    const largerToSmaller: boolean = oldScale.length > newScale.length;
    const smallerScale: number[] = largerToSmaller ? newScale : oldScale;
    const largerScale: number[] = largerToSmaller ? oldScale : newScale;

    const roles: string[] = ["root", "second", "second", "third", "third", "fourth", "tritone", "fifth", "sixth", "sixth", "seventh", "seventh", "root"];
    let bestScore: number = Number.MAX_SAFE_INTEGER;
    let bestIndexMap: number[] = [];
    const stack: number[][] = [[0]]; // Root always maps to root.

    while (stack.length > 0) {
        const indexMap: number[] = stack.pop()!;

        if (indexMap.length == smallerScale.length) {
            // Score this mapping.
            let score: number = 0;
            for (let i: number = 0; i < indexMap.length; i++) {
                score += Math.abs(smallerScale[i] - largerScale[indexMap[i]]);
                if (roles[smallerScale[i]] != roles[largerScale[indexMap[i]]]) {
                    // Penalize changing roles.
                    score += 0.75;
                }
            }
            if (bestScore > score) {
                bestScore = score;
                bestIndexMap = indexMap;
            }
        } else {
            // Recursively choose next indices for mapping.
            const lowIndex: number = indexMap[indexMap.length - 1] + 1;
            const highIndex: number = largerScale.length - smallerScale.length + indexMap.length;
            for (let i: number = lowIndex; i <= highIndex; i++) {
                stack.push(indexMap.concat(i));
            }
        }
    }

    const sparsePitchMap: number[][] = [];
    for (let i: number = 0; i < bestIndexMap.length; i++) {
        const smallerScalePitch = smallerScale[i];
        const largerScalePitch = largerScale[bestIndexMap[i]];
        sparsePitchMap[i] = largerToSmaller
            ? [largerScalePitch, smallerScalePitch]
            : [smallerScalePitch, largerScalePitch];
    }

    // To make it easier to wrap around.
    sparsePitchMap.push([12, 12]);
    newScale.push(12);

    let sparseIndex: number = 0;
    const fullPitchMap: number[] = [];
    for (let i: number = 0; i < 12; i++) {
        const oldLow: number = sparsePitchMap[sparseIndex][0];
        const newLow: number = sparsePitchMap[sparseIndex][1];
        const oldHigh: number = sparsePitchMap[sparseIndex + 1][0];
        const newHigh: number = sparsePitchMap[sparseIndex + 1][1];
        if (i == oldHigh - 1) sparseIndex++;

        const transformedPitch: number = (i - oldLow) * (newHigh - newLow) / (oldHigh - oldLow) + newLow;

        let nearestPitch: number = 0;
        let nearestPitchDistance: number = Number.MAX_SAFE_INTEGER;
        for (const newPitch of newScale) {
            let distance: number = Math.abs(newPitch - transformedPitch);
            if (roles[newPitch] != roles[i]) {
                // Again, penalize changing roles.
                distance += 0.1;
            }
            if (nearestPitchDistance > distance) {
                nearestPitchDistance = distance;
                nearestPitch = newPitch;
            }
        }

        fullPitchMap[i] = nearestPitch;
    }

    return fullPitchMap;
}

function removeRedundantPins(pins: NotePin[]): void {
    for (let i: number = 1; i < pins.length - 1;) {
        if (pins[i - 1].interval == pins[i].interval &&
            pins[i].interval == pins[i + 1].interval &&
            pins[i - 1].size == pins[i].size &&
            pins[i].size == pins[i + 1].size) {
            pins.splice(i, 1);
        } else {
            i++;
        }
    }
}

function projectNoteIntoBar(oldNote: Note, timeOffset: number, noteStartPart: number, noteEndPart: number, newNotes: Note[]): void {
    // Create a new note, and interpret the pitch bend and size events
    // to determine where we need to insert pins to control interval and volume.
    const newNote: Note = new Note(-1, noteStartPart, noteEndPart, Config.noteSizeMax, false);
    newNote.pins.length = 0;
    newNote.pitches.length = 0;
    const newNoteLength: number = noteEndPart - noteStartPart;

    for (const pitch of oldNote.pitches) {
        newNote.pitches.push(pitch);
    }

    for (let pinIndex: number = 0; pinIndex < oldNote.pins.length; pinIndex++) {
        const pin: NotePin = oldNote.pins[pinIndex];
        const newPinTime: number = pin.time + timeOffset;
        if (newPinTime < 0) {
            if (pinIndex + 1 >= oldNote.pins.length) throw new Error("Error converting pins in note overflow.");
            const nextPin: NotePin = oldNote.pins[pinIndex + 1];
            const nextPinTime: number = nextPin.time + timeOffset;
            if (nextPinTime > 0) {
                // Insert an interpolated pin at the start of the new note.
                const ratio: number = (-newPinTime) / (nextPinTime - newPinTime);
                newNote.pins.push(makeNotePin(Math.round(pin.interval + ratio * (nextPin.interval - pin.interval)), 0, Math.round(pin.size + ratio * (nextPin.size - pin.size))));

            }
        } else if (newPinTime <= newNoteLength) {
            newNote.pins.push(makeNotePin(pin.interval, newPinTime, pin.size));
        } else {
            if (pinIndex < 1) throw new Error("Error converting pins in note overflow.");
            const prevPin: NotePin = oldNote.pins[pinIndex - 1];
            const prevPinTime: number = prevPin.time + timeOffset;
            if (prevPinTime < newNoteLength) {
                // Insert an interpolated pin at the end of the new note.
                const ratio: number = (newNoteLength - prevPinTime) / (newPinTime - prevPinTime);
                newNote.pins.push(makeNotePin(Math.round(prevPin.interval + ratio * (pin.interval - prevPin.interval)), newNoteLength, Math.round(prevPin.size + ratio * (pin.size - prevPin.size))));
            }
        }
    }

    // Fix from Jummbus: Ensure the first pin's interval is zero, adjust pitches and pins to compensate.
    const offsetInterval: number = newNote.pins[0].interval;
    for (let pitchIdx: number = 0; pitchIdx < newNote.pitches.length; pitchIdx++) {
        newNote.pitches[pitchIdx] += offsetInterval;
    }
    for (let pinIdx: number = 0; pinIdx < newNote.pins.length; pinIdx++) {
        newNote.pins[pinIdx].interval -= offsetInterval;
    }

    let joinedWithPrevNote: boolean = false;
    if (newNote.start == 0) {
        newNote.continuesLastPattern = (timeOffset < 0 || oldNote.continuesLastPattern);
    } else {
        newNote.continuesLastPattern = false;
        if (newNotes.length > 0 && oldNote.continuesLastPattern) {
            const prevNote: Note = newNotes[newNotes.length - 1];
            if (prevNote.end == newNote.start && Synth.adjacentNotesHaveMatchingPitches(prevNote, newNote)) {
                joinedWithPrevNote = true;
                const newIntervalOffset: number = prevNote.pins[prevNote.pins.length - 1].interval;
                const newTimeOffset: number = prevNote.end - prevNote.start;
                for (let pinIndex: number = 1; pinIndex < newNote.pins.length; pinIndex++) {
                    const tempPin: NotePin = newNote.pins[pinIndex];
                    const transformedPin: NotePin = makeNotePin(tempPin.interval + newIntervalOffset, tempPin.time + newTimeOffset, tempPin.size);
                    prevNote.pins.push(transformedPin);
                    prevNote.end = prevNote.start + transformedPin.time;
                }
                removeRedundantPins(prevNote.pins);
            }
        }
    }
    if (!joinedWithPrevNote) {
        newNotes.push(newNote);
    }
}

function mod(a: number, b: number): number {
    return (a % b + b) % b;
}

function sigma(a: number, b: (i: number) => number, c: number): number {
    let result = 0;
    for (let i = c; i <= a; i++) {
        result += b(i);
    }
    /*
        The variables here look like this:
        A
        Σ  (i) => B
        C
    */
    return result;
}

// Custom chip generation functions.
function randomSineWave(wave: Float32Array): void {
    // Random sine waves refer to stuff similar in shape to sine/curvy waves. Imagine hills.
    let randomRoundWave: Float32Array = new Float32Array(64);
    let waveLength: number = 64;
    let foundNonZero = false;
    const roundedWaveType: number = (Math.random() * 2 + 1) | 0;
    if (roundedWaveType == 1 || roundedWaveType == 3) {
        // https://www.desmos.com/calculator/hji1istsat
        // "Phased"
        let randomNumber1 = Math.random() * 2 + 0.5;
        let randomNumber2 = Math.random() * 13 + 3;
        let randomNumber3 = Math.random() * 48 - 24;
        for (let i = 0; i < waveLength; i++) {
            randomRoundWave[i] = clamp(-24, 24 + 1, Math.round(mod(randomNumber3 + ((Math.sin((i + randomNumber3) / randomNumber2) * 24) + i * randomNumber1), 48) - 24));
        }
    } else if (roundedWaveType == 2) {
        // https://www.desmos.com/calculator/0bxjhiwhwq
        // "Bouncy"
        let randomNumber1 = Math.random() * 0.19 + 0.06;
        let randomNumber2 = Math.random() * 2 + 1;
        let randomNumber3 = Math.random() * 48 - 24;
        let randomNumber4 = Math.random() * 2 - 1;
        for (let i = 0; i < waveLength; i++) {
            randomRoundWave[i] = clamp(-24, 24 + 1, Math.round(randomNumber4 * Math.abs(2 * Math.floor((Math.sin((i / randomNumber2) * randomNumber1 + randomNumber3) * Math.cos((i * randomNumber2) * (randomNumber1 / 2)) * 24))) - randomNumber4 * 24));
        }
    }
    for (let i = 0; i < waveLength; i++) {
        wave[i] = randomRoundWave[i];
        let minimum = Infinity;
        let maximum = -Infinity;
        for (let i = 0; i < waveLength; i++) {
            minimum = Math.min(minimum, wave[i]);
            maximum = Math.max(maximum, wave[i]);
        }
        const distance = maximum - minimum;
        if (distance >= 7) {
            foundNonZero = true;
        }
    }
    // If the waveform is too quiet/all waves are the same, reroll.
    if (!foundNonZero) randomSineWave(wave);
}
function randomPulses(wave: Float32Array): void {
    // Random pulses refers to pulse widths. This one chooses two values and alternates between them
    // in a repeated pattern.
    let randomPulse: Float32Array = new Float32Array(64);
    let waveLength: number = 64;
    let foundNonZero = false;
    // Weird math for building random pulses but this is what we are going with.
    let randomNumber2 = Math.round(Math.random() * 15 + 15);
    let randomNumber3 = Math.round(Math.random() * 3 + 1);
    let randomNumber4 = Math.round(Math.random() * 13 + 2);
    for (let i = 0; i < waveLength; i++) {
        let randomNumber1 = sigma(mod(i, randomNumber2), (i) => 1, randomNumber4);
        randomPulse[i] = clamp(-24, 24 + 1, Math.round(mod(24 * (sigma(i, (i) => randomNumber1, Math.round(randomNumber2 / randomNumber3))), 24.0000000000001)));
    }
    for (let i = 0; i < waveLength; i++) {
        wave[i] = randomPulse[i];
        let minimum = Infinity;
        let maximum = -Infinity;
        for (let i = 0; i < waveLength; i++) {
            minimum = Math.min(minimum, wave[i]);
            maximum = Math.max(maximum, wave[i]);
        }
        const distance = maximum - minimum;
        if (distance >= 7) {
            foundNonZero = true;
        }
    }
    // If the waveform is too quiet/all waves are the same, reroll.
    if (!foundNonZero) randomPulses(wave);
}
function randomChipWave(wave: Float32Array): void {
    // Random chip is meant to mimic chipwaves in how they are made. Picture the shapes
    // of JummBox's chipwaves in the custom chip.
    let randomChip: Float32Array = new Float32Array(64);
    let waveLength: number = 64;
    let foundNonZero = false;
    const chipType: number = (Math.random() * 2 + 1) | 0;
    if (chipType == 1) {
        // https://www.desmos.com/calculator/udpkkpxqaj
        // "Sawscape"
        let randomNumber1 = Math.random() * 3;
        let randomNumber2 = Math.random() * 0.99 - 1;
        let randomNumber3 = Math.random() * 9 + 2;
        let randomNumber4 = Math.random() * 2 - 1;
        for (let i = 0; i < waveLength; i++) {
            randomChip[i] = clamp(-24, 24 + 1, (Math.round(Math.abs(randomNumber4 * mod(((randomNumber2 / randomNumber3) * randomNumber3) + (sigma(i / (randomNumber1 * randomNumber1), (i) => randomNumber3, randomNumber1 * -randomNumber2)) * randomNumber4, 24)))) * 2 - 24);
        }
    } else if (chipType == 2) {
        // https://www.desmos.com/calculator/bmogge156f
        // "Fake Chip"
        let randomNumber1 = Math.random() * 3;
        let randomNumber2 = Math.random() * 2 - 1;
        let randomNumber3 = Math.random() * 100;
        for (let i = 0; i < waveLength; i++) {
            randomChip[i] = clamp(-24, 24 + 1, mod(Math.round(mod((sigma(i / randomNumber1, (i) => (randomNumber1 * randomNumber3), 0)), 25 + randomNumber2) * 24), 48) - 24);
        }
    }
    for (let i = 0; i < waveLength; i++) {
        wave[i] = randomChip[i];
        let minimum = Infinity;
        let maximum = -Infinity;
        for (let i = 0; i < waveLength; i++) {
            minimum = Math.min(minimum, wave[i]);
            maximum = Math.max(maximum, wave[i]);
        }
        const distance = maximum - minimum;
        if (distance >= 7) {
            foundNonZero = true;
        }
    }
    // If the waveform is too quiet/all waves are the same, reroll.
    if (!foundNonZero) randomChipWave(wave);
}
function biasedFullyRandom(wave: Float32Array): void {
    // Biased-fully random means that the wave will be completely randomized, but the way it's 
    // randomized will be biased towards a certain point; in this case, that is the center.
    let fullyRandomWave: Float32Array = new Float32Array(64);
    let waveLength: number = 64;
    let foundNonZero = false;
    // Math for a fully random custom chip but the higher/lower parts 
    // of the waveform (in height) will contain less samples.
    for (let i: number = 0; i < waveLength; i++) {
        const v = Math.random() * 2 - 1;
        const bias = 6;
        const biased = v > 0 ? Math.pow(v, bias) : -Math.pow(-v, bias);
        fullyRandomWave[i] = clamp(-24, 24 + 1, Math.floor(biased * 24));
    }
    for (let i = 0; i < waveLength; i++) {
        wave[i] = fullyRandomWave[i];
        let minimum = Infinity;
        let maximum = -Infinity;
        for (let i = 0; i < waveLength; i++) {
            minimum = Math.min(minimum, wave[i]);
            maximum = Math.max(maximum, wave[i]);
        }
        const distance = maximum - minimum;
        if (distance >= 7) {
            foundNonZero = true;
        }
    }
    // If the waveform is too quiet/all waves are the same, reroll.
    if (!foundNonZero) biasedFullyRandom(wave);
}
function fullyRandom(wave: Float32Array): void {
    // A completely randomized waveform.
    let fullyRandomWave: Float32Array = new Float32Array(64);
    let waveLength: number = 64;
    // Randomize whatever is inside of the start-end parameter.
    for (let i: number = 0; i < waveLength; i++) {
        fullyRandomWave[i] = clamp(-24, 24 + 1, ((Math.random() * 48) | 0) - 24);
    }
    for (let i = 0; i < waveLength; i++) {
        wave[i] = fullyRandomWave[i];
    }
}

export class ChangeMoveAndOverflowNotes extends ChangeGroup {
    constructor(doc: SongDocument, newBeatsPerBar: number, partsToMove: number) {
        super();

        const pitchChannels: Channel[] = [];
        const noiseChannels: Channel[] = [];
        const modChannels: Channel[] = []

        for (let channelIndex: number = 0; channelIndex < doc.song.getChannelCount(); channelIndex++) {
            const oldChannel: Channel = doc.song.channels[channelIndex];
            const newChannel: Channel = new Channel();

            if (channelIndex < doc.song.pitchChannelCount) {
                pitchChannels.push(newChannel);
            } else if (channelIndex < doc.song.pitchChannelCount + doc.song.noiseChannelCount) {
                noiseChannels.push(newChannel);
            }
            else {
                modChannels.push(newChannel);
            }

            newChannel.muted = oldChannel.muted;
            newChannel.octave = oldChannel.octave;
            newChannel.name = oldChannel.name;

            for (const instrument of oldChannel.instruments) {
                newChannel.instruments.push(instrument);
            }

            const oldPartsPerBar: number = Config.partsPerBeat * doc.song.beatsPerBar;
            const newPartsPerBar: number = Config.partsPerBeat * newBeatsPerBar;
            let currentBar: number = -1;
            let pattern: Pattern | null = null;

            for (let oldBar: number = 0; oldBar < doc.song.barCount; oldBar++) {
                const oldPattern: Pattern | null = doc.song.getPattern(channelIndex, oldBar);
                if (oldPattern != null) {
                    const oldBarStart: number = oldBar * oldPartsPerBar;
                    for (const oldNote of oldPattern.notes) {

                        const absoluteNoteStart: number = oldNote.start + oldBarStart + partsToMove;
                        const absoluteNoteEnd: number = oldNote.end + oldBarStart + partsToMove;

                        const startBar: number = Math.floor(absoluteNoteStart / newPartsPerBar);
                        const endBar: number = Math.ceil(absoluteNoteEnd / newPartsPerBar);
                        for (let bar: number = startBar; bar < endBar; bar++) {
                            const barStartPart: number = bar * newPartsPerBar;
                            const noteStartPart: number = Math.max(0, absoluteNoteStart - barStartPart);
                            const noteEndPart: number = Math.min(newPartsPerBar, absoluteNoteEnd - barStartPart);

                            if (noteStartPart < noteEndPart) {

                                // Ensure a pattern exists for the current bar before inserting notes into it.
                                if (currentBar < bar || pattern == null) {
                                    currentBar++;
                                    while (currentBar < bar) {
                                        newChannel.bars[currentBar] = 0;
                                        currentBar++;
                                    }
                                    pattern = new Pattern();
                                    newChannel.patterns.push(pattern);
                                    newChannel.bars[currentBar] = newChannel.patterns.length;
                                    pattern.instruments.length = 0;
                                    pattern.instruments.push(...oldPattern.instruments);
                                }

                                // This is a consideration to allow arbitrary note sequencing, e.g. for mod channels (so the pattern being used can jump around)
                                pattern = newChannel.patterns[newChannel.bars[bar] - 1];

                                projectNoteIntoBar(oldNote, absoluteNoteStart - barStartPart - noteStartPart, noteStartPart, noteEndPart, pattern.notes);
                            }
                        }
                    }
                }
            }
        }

        removeDuplicatePatterns(pitchChannels);
        removeDuplicatePatterns(noiseChannels);
        removeDuplicatePatterns(modChannels);
        this.append(new ChangeReplacePatterns(doc, pitchChannels, noiseChannels, modChannels));
    }
}

class ChangePins extends UndoableChange {
    protected _oldStart: number;
    protected _newStart: number;
    protected _oldEnd: number;
    protected _newEnd: number;
    protected _oldPins: NotePin[];
    protected _newPins: NotePin[];
    protected _oldPitches: number[];
    protected _newPitches: number[];
    protected _oldContinuesLastPattern: boolean;
    protected _newContinuesLastPattern: boolean;
    constructor(protected _doc: SongDocument | null, protected _note: Note) {
        super(false);
        this._oldStart = this._note.start;
        this._oldEnd = this._note.end;
        this._newStart = this._note.start;
        this._newEnd = this._note.end;
        this._oldPins = this._note.pins;
        this._newPins = [];
        this._oldPitches = this._note.pitches;
        this._newPitches = [];
        this._oldContinuesLastPattern = this._note.continuesLastPattern;
        this._newContinuesLastPattern = this._note.continuesLastPattern;
    }

    protected _finishSetup(continuesLastPattern?: boolean): void {
        for (let i: number = 0; i < this._newPins.length - 1;) {
            if (this._newPins[i].time >= this._newPins[i + 1].time) {
                this._newPins.splice(i, 1);
            } else {
                i++;
            }
        }

        removeRedundantPins(this._newPins);

        const firstInterval: number = this._newPins[0].interval;
        const firstTime: number = this._newPins[0].time;
        for (let i: number = 0; i < this._oldPitches.length; i++) {
            this._newPitches[i] = this._oldPitches[i] + firstInterval;
        }
        for (let i: number = 0; i < this._newPins.length; i++) {
            this._newPins[i].interval -= firstInterval;
            this._newPins[i].time -= firstTime;
        }
        this._newStart = this._oldStart + firstTime;
        this._newEnd = this._newStart + this._newPins[this._newPins.length - 1].time;

        if (continuesLastPattern != undefined) {
            this._newContinuesLastPattern = continuesLastPattern;
        }
        if (this._newStart != 0) {
            this._newContinuesLastPattern = false;
        }

        this._doForwards();
        this._didSomething();
    }

    protected _doForwards(): void {
        this._note.pins = this._newPins;
        this._note.pitches = this._newPitches;
        this._note.start = this._newStart;
        this._note.end = this._newEnd;
        this._note.continuesLastPattern = this._newContinuesLastPattern;
        if (this._doc != null) this._doc.notifier.changed();
    }

    protected _doBackwards(): void {
        this._note.pins = this._oldPins;
        this._note.pitches = this._oldPitches;
        this._note.start = this._oldStart;
        this._note.end = this._oldEnd;
        this._note.continuesLastPattern = this._oldContinuesLastPattern;
        if (this._doc != null) this._doc.notifier.changed();
    }
}

export class ChangeCustomizeInstrument extends Change {
    constructor(doc: SongDocument) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        if (instrument.preset != instrument.type) {
            instrument.preset = instrument.type;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeCustomWave extends Change {
    constructor(doc: SongDocument, newArray: Float32Array) {
        super();
        const oldArray: Float32Array = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()].customChipWave;
        var comparisonResult: boolean = true;
        for (let i: number = 0; i < oldArray.length; i++) {
            if (oldArray[i] != newArray[i]) {
                comparisonResult = false;
                i = oldArray.length;
            }
        }
        if (comparisonResult == false) {
            let instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
            for (let i: number = 0; i < newArray.length; i++) {
                instrument.customChipWave[i] = newArray[i];
            }

            let sum: number = 0.0;
            for (let i: number = 0; i < instrument.customChipWave.length; i++) {
                sum += instrument.customChipWave[i];
            }
            const average: number = sum / instrument.customChipWave.length;

            // Perform the integral on the wave. The chipSynth will perform the derivative to get the original wave back but with antialiasing.
            let cumulative: number = 0;
            let wavePrev: number = 0;
            for (let i: number = 0; i < instrument.customChipWave.length; i++) {
                cumulative += wavePrev;
                wavePrev = instrument.customChipWave[i] - average;
                instrument.customChipWaveIntegral[i] = cumulative;
            }

            instrument.customChipWaveIntegral[64] = 0.0;
            instrument.preset = instrument.type;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeCustomAlgorythmorFeedback extends Change {
    constructor(doc: SongDocument, newArray: number[][], carry: number, mode: string) {
        super();
        if (mode == "algorithm") {
            const oldArray: number[][] = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()].customAlgorithm.modulatedBy;
            const oldCarriercount: number = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()].customAlgorithm.carrierCount;
            var comparisonResult: boolean = true;
            if (carry != oldCarriercount) {
                comparisonResult = false;
            } else {
                for (let i: number = 0; i < oldArray.length; i++) {
                    if (oldArray[i].length != newArray[i].length) {
                        comparisonResult = false;
                        break;
                    } else {
                        for (let j: number = 0; j < oldArray[i].length; j++) {
                            if (oldArray[i][j] != newArray[i][j]) {
                                comparisonResult = false;
                                break;
                            }
                        }
                    }
                }
            }
            if (comparisonResult == false) {
                let instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];

                instrument.customAlgorithm.set(carry, newArray);

                instrument.algorithm6Op = 0;
                doc.notifier.changed();
                this._didSomething();
            }
        } else if (mode == "feedback") {
            const oldArray: number[][] = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()].customFeedbackType.indices;
            var comparisonResult: boolean = true;
            for (let i: number = 0; i < oldArray.length; i++) {
                if (oldArray[i].length != newArray[i].length) {
                    comparisonResult = false;
                    break;
                } else {
                    for (let j: number = 0; j < oldArray[i].length; j++) {
                        if (oldArray[i][j] != newArray[i][j]) {
                            comparisonResult = false;
                            break;
                        }
                    }
                }
            }

            if (!comparisonResult) {
                let instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];

                instrument.customFeedbackType.set(newArray);

                instrument.feedbackType6Op = 0;
                doc.notifier.changed();
                this._didSomething();
            }
        }
    }
}

export class ChangePreset extends Change {
    constructor(doc: SongDocument, newValue: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        const oldValue: number = instrument.preset;
        if (oldValue != newValue) {
            const preset1: Preset | null = EditorConfig.instrumentToPreset(newValue);
            const preset: Preset | null = preset1 ?? EditorConfig.valueToPreset(newValue);
            if (preset != null) {
                if (preset.customType != undefined) {
                    instrument.type = preset.customType;
                    if (!Config.instrumentTypeHasSpecialInterval[instrument.type] && Config.chords[instrument.chord].customInterval) {
                        instrument.chord = 0;
                    }
                    instrument.clearInvalidEnvelopeTargets();
                } else if (preset.settings != undefined) {
                    const tempVolume: number = instrument.volume;
                    const tempPan: number = instrument.pan;
                    const tempPanDelay = instrument.panDelay;
                    //const usesPanning: boolean = effectsIncludePanning(instrument.effects);
                    instrument.fromJsonObject(preset.settings, doc.song.getChannelIsNoise(doc.channel), doc.song.getChannelIsMod(doc.channel), doc.song.rhythm == 0 || doc.song.rhythm == 2, doc.song.rhythm >= 2);
                    instrument.volume = tempVolume;
                    instrument.pan = tempPan;
                    instrument.panDelay = tempPanDelay;
                    //@jummbus - Disable this check, pan will be on by default.
                    //if (usesPanning && instrument.pan != Config.panCenter) {
                    instrument.effects = (instrument.effects | (1 << EffectType.panning));
                    //}
                }
            }
            instrument.preset = newValue;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeRandomGeneratedInstrument extends Change {
    constructor(doc: SongDocument, usesSelectiveRandom: boolean) {
        super();

        interface ItemWeight<T> {
            readonly item: T;
            readonly weight: number;
        }
        function selectWeightedRandom<T>(entries: ReadonlyArray<ItemWeight<T>>): T {
            let total: number = 0;
            for (const entry of entries) {
                total += entry.weight;
            }
            let random: number = Math.random() * total;
            for (const entry of entries) {
                random -= entry.weight;
                if (random <= 0.0) return entry.item;
            }
            return entries[(Math.random() * entries.length) | 0].item;
        }
        function selectCurvedDistribution(min: number, max: number, peak: number, width: number): number {
            const entries: Array<ItemWeight<number>> = [];
            for (let i: number = min; i <= max; i++) {
                entries.push({ item: i, weight: 1.0 / (Math.pow((i - peak) / width, 2.0) + 1.0) });
            }
            return selectWeightedRandom(entries);
        }

        class PotentialFilterPoint {
            constructor(
                public readonly chance: number,
                public readonly type: FilterType,
                public readonly minFreq: number,
                public readonly maxFreq: number,
                public readonly centerHz: number,
                public readonly centerGain: number,
            ) { };
        }
        function applyFilterPoints(filter: FilterSettings, potentialPoints: ReadonlyArray<PotentialFilterPoint>): void {
            filter.reset();
            const usedFreqs: number[] = [];
            for (const potentialPoint of potentialPoints) {
                if (Math.random() > potentialPoint.chance) continue;
                const point: FilterControlPoint = new FilterControlPoint();
                point.type = potentialPoint.type;
                point.freq = selectCurvedDistribution(potentialPoint.minFreq, potentialPoint.maxFreq, FilterControlPoint.getRoundedSettingValueFromHz(potentialPoint.centerHz), 1.0 / Config.filterFreqStep);
                point.gain = selectCurvedDistribution(0, Config.filterGainRange - 1, Config.filterGainCenter + potentialPoint.centerGain, 2.0 / Config.filterGainStep);
                if (point.type == FilterType.peak && point.gain == Config.filterGainCenter) continue; // skip pointless points. :P
                if (usedFreqs.includes(point.freq)) continue;
                usedFreqs.push(point.freq);
                filter.controlPoints[filter.controlPointCount] = point;
                filter.controlPointCount++;
            }
        }

        const isNoise: boolean = doc.song.getChannelIsNoise(doc.channel);
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        const selectiveRandom: SelectiveInstrumentSettings = usesSelectiveRandom ? doc.prefs.selectiveRandom : new SelectiveInstrumentSettings();
        if (!usesSelectiveRandom) selectiveRandom.instrumentType = true;
        if (selectiveRandom.effects) {
            instrument.effects = 1 << EffectType.panning; // disable all existing effects except panning, which should always be on.
            instrument.aliases = false;
        }
        if (selectiveRandom.envelopes) instrument.envelopeCount = 0;

        const midFreq: number = FilterControlPoint.getRoundedSettingValueFromHz(700.0);
        const maxFreq: number = Config.filterFreqRange - 1;
        if(selectiveRandom.eqFilter)
            applyFilterPoints(instrument.eqFilter, [
                new PotentialFilterPoint(0.8, FilterType.lowPass, midFreq, maxFreq, 4000.0, -1),
                new PotentialFilterPoint(0.4, FilterType.highPass, 0, midFreq - 1, 250.0, -1),
                new PotentialFilterPoint(0.5, FilterType.peak, 0, maxFreq, 2000.0, 0),
                new PotentialFilterPoint(0.4, FilterType.peak, 0, maxFreq, 1400.0, 0),
                new PotentialFilterPoint(0.3, FilterType.peak, 0, maxFreq, 1000.0, 0),
                new PotentialFilterPoint(0.2, FilterType.peak, 0, maxFreq, 500.0, 0),
            ]);

        if (isNoise) {
            const type: InstrumentType = !selectiveRandom.instrumentType ? instrument.type :
            selectWeightedRandom([
                { item: InstrumentType.noise, weight: 3 },
                { item: InstrumentType.spectrum, weight: 3 },
                { item: InstrumentType.drumset, weight: 1 },
            ]);
            instrument.preset = instrument.type = type;

            if (type != InstrumentType.drumset) { // Drumset doesn't use fade.
                instrument.fadeIn = (Math.random() < 0.8) ? 0 : selectCurvedDistribution(0, Config.fadeInRange - 1, 0, 2);
                instrument.fadeOut = selectCurvedDistribution(0, Config.fadeOutTicks.length - 1, Config.fadeOutNeutral, 2);
            }

            if (selectiveRandom.effects) {
                if (Math.random() < 0.1) {
                    instrument.effects |= 1 << EffectType.transition;
                    instrument.transition = Config.transitions.dictionary[selectWeightedRandom([
                        { item: "normal", weight: 30 },
                        { item: "interrupt", weight: 1 },
                        { item: "slide", weight: 2 },
                    ])].index;
                }
                if (Math.random() < 0.2) {
                    instrument.effects |= 1 << EffectType.chord;
                    instrument.chord = Config.chords.dictionary[selectWeightedRandom([
                        { item: "strum", weight: 2 },
                        { item: "arpeggio", weight: 1 },
                    ])].index;
                }
                if (Math.random() < 0.1) {
                    instrument.pitchShift = selectCurvedDistribution(0, Config.pitchShiftRange - 1, Config.pitchShiftCenter, 2);
                    if (instrument.pitchShift != Config.pitchShiftCenter) {
                        instrument.effects |= 1 << EffectType.pitchShift;
                        if(selectiveRandom.envelopes) instrument.addEnvelope(Config.instrumentAutomationTargets.dictionary["pitchShift"].index, 0, Config.newEnvelopes.dictionary[selectWeightedRandom([
                            { item: "note size", weight: 1 },
                            { item: "random", weight: 2 },
                            { item: "flare", weight: 2 },
                            { item: "twang", weight: 16 },
                            { item: "swell", weight: 2 },
                            { item: "lfo", weight: 1 },
                            { item: "decay", weight: 4 },
                            { item: "blip", weight: 8 },
                            { item: "fall", weight: 2 },
                        ])].index, true, 0, -1, selectWeightedRandom([{ item: false, weight: 8 }, { item: true, weight: 1 }]), Config.perEnvelopeSpeedIndices[selectCurvedDistribution(1, 63, 50, 13)]);
                    }
                }
                if (Math.random() < 0.1) {
                    instrument.effects |= 1 << EffectType.vibrato;
                    instrument.vibrato = selectCurvedDistribution(0, Config.echoSustainRange - 1, Config.echoSustainRange >> 1, 2);
                    instrument.vibrato = Config.vibratos.dictionary[selectWeightedRandom([
                        { item: "light", weight: 2 },
                        { item: "delayed", weight: 2 },
                        { item: "heavy", weight: 1 },
                        { item: "shaky", weight: 2 },
                    ])].index;
                }
                if (Math.random() < 0.8) {
                    instrument.effects |= 1 << EffectType.noteFilter;
                    applyFilterPoints(instrument.noteFilter, [
                        new PotentialFilterPoint(1.0, FilterType.lowPass, midFreq, maxFreq, 8000.0, -1),
                    ]);
                    if(selectiveRandom.envelopes) instrument.addEnvelope(Config.instrumentAutomationTargets.dictionary["noteFilterAllFreqs"].index, 0, Config.newEnvelopes.dictionary[selectWeightedRandom([
                        { item: "note size", weight: 2 },
                        { item: "pitch", weight: 2 },
                        { item: "punch", weight: 4 },
                        { item: "flare", weight: 4 },
                        { item: "twang", weight: 16 },
                        { item: "swell", weight: 4 },
                        { item: "lfo", weight: 8 },
                        { item: "decay", weight: 8 },
                        { item: "wibble", weight: 4 },
                        { item: "linear", weight: 4 },
                        { item: "fall", weight: 4 },
                    ])].index, true, 0, -1, selectWeightedRandom([{ item: false, weight: 8 }, { item: true, weight: 1 }]), Config.perEnvelopeSpeedIndices[selectCurvedDistribution(1, 63, 30, 30)]);
                }
                if (Math.random() < 0.1) {
                    instrument.effects |= 1 << EffectType.distortion;
                    instrument.distortion = selectCurvedDistribution(1, Config.distortionRange - 1, Config.distortionRange - 1, 2);
                }
                if (Math.random() < 0.1) {
                    instrument.effects |= 1 << EffectType.bitcrusher;
                    instrument.bitcrusherFreq = selectCurvedDistribution(0, Config.bitcrusherFreqRange - 1, Config.bitcrusherFreqRange >> 1, 2);
                    instrument.bitcrusherQuantization = selectCurvedDistribution(0, Config.bitcrusherQuantizationRange - 1, Config.bitcrusherQuantizationRange >> 1, 2);
                }
                if (Math.random() < 0.1) {
                    instrument.effects |= 1 << EffectType.chorus;
                    instrument.chorus = selectCurvedDistribution(1, Config.chorusRange - 1, Config.chorusRange - 1, 1);
                }
                if (Math.random() < 0.1) {
                    instrument.echoSustain = selectCurvedDistribution(0, Config.echoSustainRange - 1, Config.echoSustainRange >> 1, 2);
                    instrument.echoDelay = selectCurvedDistribution(0, Config.echoDelayRange - 1, Config.echoDelayRange >> 1, 2);
                    if (instrument.echoSustain != 0 || instrument.echoDelay != 0) {
                        instrument.effects |= 1 << EffectType.echo;
                    }
                }
                if (Math.random() < 0.5) {
                    instrument.effects |= 1 << EffectType.reverb;
                    instrument.reverb = selectCurvedDistribution(1, Config.reverbRange - 1, 1, 1);
                }
            }

            // Configure this to whatever you'd like.
            if (selectiveRandom.unison) {
                instrument.unison = Config.unisons.dictionary[selectWeightedRandom([
                    { item: "none", weight: 100 },
                    { item: "shimmer", weight: 10 },
                    { item: "hum", weight: 8 },
                    { item: "honky tonk", weight: 6 },
                    { item: "dissonant", weight: 2 },
                    { item: "fifth", weight: 4 },
                    { item: "octave", weight: 5 },
                    { item: "bowed", weight: 4 },
                    { item: "piano", weight: 10 },
                    { item: "warbled", weight: 5 },
                    { item: "hecking gosh", weight: 3 },
                    { item: "spinner", weight: 6 },
                    { item: "detune", weight: 4 },
                    { item: "rising", weight: 2 },
                    { item: "vibrate", weight: 3 },
                    { item: "bass", weight: 2 },
                    { item: "recurve", weight: 3 },
                    { item: "inject", weight: 2 },
                    { item: "FART", weight: 1 },
                    { item: "augmented", weight: 1 },
                    { item: "diminished", weight: 1 },
                    { item: "chorus", weight: 2 },
                    { item: "block", weight: 2 },
                    { item: "bow", weight: 2 },
                    // { item: "custom", weight: 10 },
                ])].index;

                if (instrument.unison != Config.unisons.dictionary["none"].index && Math.random() > 0.4)
                    instrument.addEnvelope(Config.instrumentAutomationTargets.dictionary["unison"].index, 0, Config.newEnvelopes.dictionary[selectWeightedRandom([
                        { item: "note size", weight: 2 },
                        { item: "pitch", weight: 2 },
                        { item: "twang", weight: 6 },
                        { item: "swell", weight: 1 },
                        { item: "decay", weight: 6 },
                        { item: "wibble", weight: 4 },
                        { item: "linear", weight: 6 },
                        { item: "rise", weight: 2 },
                        { item: "fall", weight: 2 },
                    ])].index, true, 0, -1, selectWeightedRandom([{ item: false, weight: 8 }, { item: true, weight: 1 }]), Config.perEnvelopeSpeedIndices[selectCurvedDistribution(1, 63, 57, 6)]);
            }

            function normalize(harmonics: number[]): void {
                let max: number = 0;
                for (const value of harmonics) {
                    if (value > max) max = value;
                }
                for (let i: number = 0; i < harmonics.length; i++) {
                    harmonics[i] = Config.harmonicsMax * harmonics[i] / max;
                }
            }

            if(selectiveRandom.instrumentTypeSettings) switch (type) {
                case InstrumentType.noise: {
                    instrument.chipNoise = (Math.random() * Config.chipNoises.length) | 0;
                } break;
                case InstrumentType.spectrum: {
                    const spectrumGenerators: Function[] = [
                        (): number[] => {
                            const spectrum: number[] = [];
                            for (let i: number = 0; i < Config.spectrumControlPoints; i++) {
                                spectrum[i] = (Math.random() < 0.5) ? Math.random() : 0.0;
                            }
                            return spectrum;
                        },
                        (): number[] => {
                            let current: number = 1.0;
                            const spectrum: number[] = [current];
                            for (let i = 1; i < Config.spectrumControlPoints; i++) {
                                current *= Math.pow(2, Math.random() - 0.52);
                                spectrum[i] = current;
                            }
                            return spectrum;
                        },
                        (): number[] => {
                            let current: number = 1.0;
                            const spectrum: number[] = [current];
                            for (let i = 1; i < Config.spectrumControlPoints; i++) {
                                current *= Math.pow(2, Math.random() - 0.52);
                                spectrum[i] = current * Math.random();
                            }
                            return spectrum;
                        },
                    ];
                    const generator = spectrumGenerators[(Math.random() * spectrumGenerators.length) | 0];
                    const spectrum: number[] = generator();
                    normalize(spectrum);
                    for (let i: number = 0; i < Config.spectrumControlPoints; i++) {
                        instrument.spectrumWave.spectrum[i] = Math.round(spectrum[i]);
                    }
                    instrument.spectrumWave.markCustomWaveDirty();
                } break;
                case InstrumentType.drumset: {
                    for (let i: number = 0; i < Config.drumCount; i++) {
                        // Might wanna do this Random*Config.____.length thing for all envelope/unison randomization?
                        instrument.drumsetEnvelopes[i] = Math.floor(Math.random() * Config.envelopes.length);
                        const spectrum: number[] = [];
                        let randomFactor: number = Math.floor(Math.random() * 3)
                        for (let j = 0; j < Config.spectrumControlPoints; j++) {
                            if (randomFactor == 0 || randomFactor == 3) spectrum[j] = Math.pow(Math.random(), 3) * 0.25;
                            else if (randomFactor == 1) spectrum[j] = Math.pow(Math.random(), ((i / 8) + 1));
                            else if (randomFactor == 2) spectrum[j] = (Math.pow(Math.random(), 2)) * ((i / 3) + 1);
                            else spectrum[j] = Math.pow(Math.random(), 3) * 0.25;
                        }
                        normalize(spectrum);
                        for (let j: number = 0; j < Config.spectrumControlPoints; j++) {
                            instrument.drumsetSpectrumWaves[i].spectrum[j] = Math.round(spectrum[j]);
                        }
                        instrument.drumsetSpectrumWaves[i].markCustomWaveDirty();
                    }
                } break;
                default: throw new Error("Unhandled noise instrument type in random generator.");
            }
        } else {
            const type: InstrumentType = !selectiveRandom.instrumentType ? instrument.type :
            selectWeightedRandom([
                { item: InstrumentType.chip, weight: 2 },
                // { item: InstrumentType.noise, weight: 1 },
                { item: InstrumentType.pwm, weight: 2 },
                { item: InstrumentType.supersaw, weight: 2 },
                { item: InstrumentType.customChipWave, weight: 2 },
                { item: InstrumentType.harmonics, weight: 2 },
                { item: InstrumentType.pickedString, weight: 2 },
                { item: InstrumentType.spectrum, weight: 2 },
                { item: InstrumentType.fm, weight: 2 },
                { item: InstrumentType.fm6op, weight: 2 },
            ]);
            instrument.preset = instrument.type = type;

            instrument.fadeIn = (Math.random() < 0.5) ? 0 : selectCurvedDistribution(0, Config.fadeInRange - 1, 0, 2);
            instrument.fadeOut = selectCurvedDistribution(0, Config.fadeOutTicks.length - 1, Config.fadeOutNeutral, 2);
            if (selectiveRandom.unison) { // TODO: add noise
                instrument.unison = Config.unisons.dictionary[selectWeightedRandom([
                    { item: "none", weight: 100 },
                    { item: "shimmer", weight: 10 },
                    { item: "hum", weight: 8 },
                    { item: "honky tonk", weight: 6 },
                    { item: "dissonant", weight: 2 },
                    { item: "fifth", weight: 4 },
                    { item: "octave", weight: 5 },
                    { item: "bowed", weight: 4 },
                    { item: "piano", weight: 10 },
                    { item: "warbled", weight: 5 },
                    { item: "hecking gosh", weight: 3 },
                    { item: "spinner", weight: 6 },
                    { item: "detune", weight: 4 },
                    { item: "rising", weight: 2 },
                    { item: "vibrate", weight: 3 },
                    { item: "bass", weight: 2 },
                    { item: "recurve", weight: 3 },
                    { item: "inject", weight: 2 },
                    { item: "FART", weight: 1 },
                    { item: "augmented", weight: 1 },
                    { item: "diminished", weight: 1 },
                    { item: "chorus", weight: 2 },
                    { item: "block", weight: 1 },
                    { item: "bow", weight: 2 },
                    // { item: "custom", weight: 10 },
                ])].index;
                /* randomly generated unisons don't work correctly - instead of trying to fix them, just ignore it

                if (instrument.unison == Config.unisons.length) {
                    instrument.unisonVoices = 2;
                    instrument.unisonSpread = Math.floor(Math.random() * 12000 - 6000) / 1000;
                    instrument.unisonOffset = Math.floor(Math.random() * 12000 - 6000) / 1000;
                    instrument.unisonExpression = 1;
                    instrument.unisonSign = Math.floor(Math.random() * 2000 - 1000) / 1000;
                } else {  */
                instrument.unisonVoices = Config.unisons[instrument.unison].voices;
                instrument.unisonSpread = Config.unisons[instrument.unison].spread;
                instrument.unisonOffset = Config.unisons[instrument.unison].offset;
                instrument.unisonExpression = Config.unisons[instrument.unison].expression;
                instrument.unisonSign = Config.unisons[instrument.unison].sign;
                //  } 
            }

            if (selectiveRandom.effects) {
                if (Math.random() < 0.1) {
                    instrument.effects |= 1 << EffectType.transition;
                    instrument.transition = Config.transitions.dictionary[selectWeightedRandom([
                        { item: "interrupt", weight: 1 },
                        { item: "slide", weight: 2 },
                        { item: "continue", weight: 1 },
                    ])].index;
                }
                if (Math.random() < 0.2) {
                    instrument.effects |= 1 << EffectType.chord;
                    instrument.chord = Config.chords.dictionary[selectWeightedRandom([
                        { item: "strum", weight: 2 },
                        { item: "arpeggio", weight: 1 },
                    ])].index;
                }
                if (Math.random() < 0.05) {
                    instrument.pitchShift = selectCurvedDistribution(0, Config.pitchShiftRange - 1, Config.pitchShiftCenter, 1);
                    if (instrument.pitchShift != Config.pitchShiftCenter) {
                        instrument.effects |= 1 << EffectType.pitchShift;
                        if(selectiveRandom.envelopes) instrument.addEnvelope(Config.instrumentAutomationTargets.dictionary["pitchShift"].index, 0, Config.newEnvelopes.dictionary[selectWeightedRandom([
                            { item: "note size", weight: 2 },
                            { item: "pitch", weight: 2 },
                            { item: "random", weight: 3 },
                            { item: "flare", weight: 4 },
                            { item: "twang", weight: 20 },
                            { item: "decay", weight: 6 },
                            { item: "linear", weight: 1 },
                            { item: "blip", weight: 10 },
                            { item: "fall", weight: 2 },
                        ])].index, true, 0, -1, selectWeightedRandom([{ item: false, weight: 8 }, { item: true, weight: 1 }]), Config.perEnvelopeSpeedIndices[selectCurvedDistribution(1, 63, 50, 13)]);
                    }
                }
                if (Math.random() < 0.25) {
                    instrument.effects |= 1 << EffectType.vibrato;
                    instrument.vibrato = selectCurvedDistribution(0, Config.echoSustainRange - 1, Config.echoSustainRange >> 1, 2);
                    instrument.vibrato = Config.vibratos.dictionary[selectWeightedRandom([
                        { item: "light", weight: 2 },
                        { item: "delayed", weight: 2 },
                        { item: "heavy", weight: 1 },
                        { item: "shaky", weight: 2 },
                    ])].index;
                }
                if (Math.random() < 0.1) {
                    instrument.effects |= 1 << EffectType.distortion;
                    instrument.distortion = selectCurvedDistribution(1, Config.distortionRange - 1, Config.distortionRange - 1, 2);
                    if (selectiveRandom.envelopes && Math.random() < 0.3) {
                        let envelopeLowerBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                        let envelopeUpperBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                        if (envelopeLowerBound >= envelopeUpperBound) {
                            envelopeLowerBound = 0;
                            envelopeUpperBound = 1;
                        }
                        instrument.addEnvelope(Config.instrumentAutomationTargets.dictionary["distortion"].index, 0, Config.newEnvelopes.dictionary[selectWeightedRandom([
                            { item: "note size", weight: 3 },
                            { item: "pitch", weight: 4 },
                            { item: "random", weight: 1 },
                            { item: "punch", weight: 2 },
                            { item: "flare", weight: 3 },
                            { item: "twang", weight: 10 },
                            { item: "swell", weight: 8 },
                            { item: "lfo", weight: 7 },
                            { item: "decay", weight: 5 },
                            { item: "wibble", weight: 5 },
                            { item: "linear", weight: 4 },
                            { item: "rise", weight: 8 },
                            { item: "fall", weight: 2 },
                        ])].index, true, 0, -1, selectWeightedRandom([{ item: false, weight: 8 }, { item: true, weight: 1 }]), Config.perEnvelopeSpeedIndices[selectCurvedDistribution(1, 63, 45, 20)], envelopeLowerBound, envelopeUpperBound, selectCurvedDistribution(2, 16, 2, 6), selectCurvedDistribution(1, 63, 32, 31),
                            selectWeightedRandom([{ item: LFOEnvelopeTypes.sine, weight: 2 }, { item: LFOEnvelopeTypes.triangle, weight: 5 }]));
                    }
                }
                if (effectsIncludeDistortion(instrument.effects) && Math.random() < 0.8) {
                    instrument.effects |= 1 << EffectType.noteFilter;
                    applyFilterPoints(instrument.noteFilter, [
                        new PotentialFilterPoint(1.0, FilterType.lowPass, midFreq, maxFreq, 2000.0, -1),
                        new PotentialFilterPoint(0.9, FilterType.highPass, 0, midFreq - 1, 500.0, -1),
                        new PotentialFilterPoint(0.4, FilterType.peak, 0, maxFreq, 1400.0, 0),
                    ]);
                } else if (Math.random() < 0.5) {
                    instrument.effects |= 1 << EffectType.noteFilter;
                    applyFilterPoints(instrument.noteFilter, [
                        new PotentialFilterPoint(1.0, FilterType.lowPass, midFreq, maxFreq, 8000.0, -1),
                    ]);
                    let envelopeLowerBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                    let envelopeUpperBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                    if (envelopeLowerBound >= envelopeUpperBound) {
                        envelopeLowerBound = 0;
                        envelopeUpperBound = 1;
                    }
                    if (selectiveRandom.envelopes) instrument.addEnvelope(Config.instrumentAutomationTargets.dictionary["noteFilterAllFreqs"].index, 0, Config.newEnvelopes.dictionary[selectWeightedRandom([
                        { item: "note size", weight: 2 },
                        { item: "pitch", weight: 2 },
                        { item: "punch", weight: 6 },
                        { item: "flare", weight: 3 },
                        { item: "twang", weight: 7 },
                        { item: "swell", weight: 8 },
                        { item: "lfo", weight: 12 },
                        { item: "decay", weight: 3 },
                        { item: "wibble", weight: 5 },
                        { item: "linear", weight: 4 },
                        { item: "rise", weight: 8 },
                        { item: "fall", weight: 2 },
                    ])].index, true, 0, -1, selectWeightedRandom([{ item: false, weight: 8 }, { item: true, weight: 1 }]), Config.perEnvelopeSpeedIndices[selectCurvedDistribution(1, 63, 30, 30)], envelopeLowerBound, envelopeUpperBound, 2, 2,
                        selectWeightedRandom([{ item: LFOEnvelopeTypes.sine, weight: 8 }, { item: LFOEnvelopeTypes.triangle, weight: 4 }, { item: LFOEnvelopeTypes.sawtooth, weight: 2 }, { item: LFOEnvelopeTypes.square, weight: 1 }]));
                }
                if (Math.random() < 0.1) {
                    instrument.effects |= 1 << EffectType.bitcrusher;
                    instrument.bitcrusherFreq = selectCurvedDistribution(0, Config.bitcrusherFreqRange - 1, 0, 2);
                    instrument.bitcrusherQuantization = selectCurvedDistribution(0, Config.bitcrusherQuantizationRange - 1, Config.bitcrusherQuantizationRange >> 1, 2);
                    let envelopeLowerBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                    let envelopeUpperBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                    if (envelopeLowerBound >= envelopeUpperBound) {
                        envelopeLowerBound = 0;
                        envelopeUpperBound = 1;
                    }
                    if (selectiveRandom.envelopes && Math.random() < 0.3) {
                        instrument.addEnvelope(Config.instrumentAutomationTargets.dictionary["bitcrusherFrequency"].index, 0, Config.newEnvelopes.dictionary[selectWeightedRandom([
                            { item: "note size", weight: 4 },
                            { item: "pitch", weight: 3 },
                            { item: "random", weight: 12 },
                            { item: "flare", weight: 3 },
                            { item: "twang", weight: 7 },
                            { item: "swell", weight: 4 },
                            { item: "lfo", weight: 12 },
                            { item: "decay", weight: 2 },
                            { item: "wibble", weight: 1 },
                            { item: "linear", weight: 6 },
                            { item: "rise", weight: 5 },
                            { item: "blip", weight: 12 },
                            { item: "fall", weight: 2 },
                        ])].index, true, 0, -1, selectWeightedRandom([{ item: false, weight: 8 }, { item: true, weight: 1 }]), Config.perEnvelopeSpeedIndices[selectCurvedDistribution(1, 63, 20, 34)], envelopeLowerBound, envelopeUpperBound, selectCurvedDistribution(2, 16, 2, 6), selectCurvedDistribution(1, 63, 32, 31),
                            selectWeightedRandom([{ item: LFOEnvelopeTypes.sine, weight: 3 }, { item: LFOEnvelopeTypes.triangle, weight: 1 }]));
                    }
                    if (selectiveRandom.envelopes && Math.random() < 0.5) {
                        instrument.addEnvelope(Config.instrumentAutomationTargets.dictionary["bitcrusherQuantization"].index, 0, Config.newEnvelopes.dictionary[selectWeightedRandom([
                            { item: "note size", weight: 8 },
                            { item: "pitch", weight: 3 },
                            { item: "random", weight: 12 },
                            { item: "flare", weight: 3 },
                            { item: "twang", weight: 7 },
                            { item: "swell", weight: 4 },
                            { item: "lfo", weight: 12 },
                            { item: "decay", weight: 2 },
                            { item: "wibble", weight: 1 },
                            { item: "linear", weight: 6 },
                            { item: "rise", weight: 5 },
                            { item: "blip", weight: 12 },
                            { item: "fall", weight: 2 },
                        ])].index, true, 0, -1, selectWeightedRandom([{ item: false, weight: 8 }, { item: true, weight: 1 }]), Config.perEnvelopeSpeedIndices[selectCurvedDistribution(1, 63, 20, 34)], envelopeLowerBound, envelopeUpperBound, selectCurvedDistribution(2, 16, 2, 6), selectCurvedDistribution(1, 63, 32, 31),
                            selectWeightedRandom([{ item: LFOEnvelopeTypes.sine, weight: 3 }, { item: LFOEnvelopeTypes.triangle, weight: 1 }]));
                    } else if (selectiveRandom.envelopes && type == InstrumentType.spectrum) {
                        instrument.addEnvelope(Config.instrumentAutomationTargets.dictionary["noteVolume"].index, 0, Config.newEnvelopes.dictionary["note size"].index, true);
                        instrument.addEnvelope(Config.instrumentAutomationTargets.dictionary["bitcrusherQuantization"].index, 0, Config.newEnvelopes.dictionary["note size"].index, true);
                    }
                }
                if (Math.random() < 0.1) {
                    instrument.effects |= 1 << EffectType.chorus;
                    instrument.chorus = selectCurvedDistribution(1, Config.chorusRange - 1, Config.chorusRange - 1, 1);
                    if (selectiveRandom.envelopes && Math.random() < 0.1) {
                        let envelopeLowerBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                        let envelopeUpperBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                        if (envelopeLowerBound >= envelopeUpperBound) {
                            envelopeLowerBound = 0;
                            envelopeUpperBound = 1;
                        }
                        instrument.addEnvelope(Config.instrumentAutomationTargets.dictionary["chorus"].index, 0, Config.newEnvelopes.dictionary[selectWeightedRandom([
                            { item: "note size", weight: 3 },
                            { item: "pitch", weight: 4 },
                            { item: "random", weight: 1 },
                            { item: "punch", weight: 2 },
                            { item: "flare", weight: 3 },
                            { item: "twang", weight: 10 },
                            { item: "swell", weight: 8 },
                            { item: "lfo", weight: 7 },
                            { item: "decay", weight: 5 },
                            { item: "wibble", weight: 5 },
                            { item: "linear", weight: 4 },
                            { item: "rise", weight: 8 },
                            { item: "fall", weight: 2 },
                        ])].index, true, 0, -1, selectWeightedRandom([{ item: false, weight: 8 }, { item: true, weight: 1 }]), Config.perEnvelopeSpeedIndices[selectCurvedDistribution(1, 63, 45, 20)], envelopeLowerBound, envelopeUpperBound, selectCurvedDistribution(2, 16, 2, 6), selectCurvedDistribution(1, 63, 32, 31),
                            selectWeightedRandom([{ item: LFOEnvelopeTypes.sine, weight: 2 }, { item: LFOEnvelopeTypes.triangle, weight: 5 }]));
                    }
                }
                if (Math.random() < 0.1) {
                    instrument.echoSustain = selectCurvedDistribution(0, Config.echoSustainRange - 1, Config.echoSustainRange >> 1, 2);
                    instrument.echoDelay = selectCurvedDistribution(0, Config.echoDelayRange - 1, Config.echoDelayRange >> 1, 2);
                    if (instrument.echoSustain != 0 || instrument.echoDelay != 0) {
                        instrument.effects |= 1 << EffectType.echo;
                        if (selectiveRandom.envelopes && Math.random() < 0.04) {
                            let envelopeLowerBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                            let envelopeUpperBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                            if (envelopeLowerBound >= envelopeUpperBound) {
                                envelopeLowerBound = 0;
                                envelopeUpperBound = 1;
                            }
                            instrument.addEnvelope(Config.instrumentAutomationTargets.dictionary["echoDelay"].index, 0, Config.newEnvelopes.dictionary[selectWeightedRandom([
                                { item: "note size", weight: 4 },
                                { item: "pitch", weight: 8 },
                                { item: "random", weight: 7 },
                                { item: "twang", weight: 3 },
                                { item: "swell", weight: 3 },
                                { item: "lfo", weight: 4 },
                                { item: "decay", weight: 1 },
                                { item: "wibble", weight: 1 },
                                { item: "linear", weight: 2 },
                                { item: "rise", weight: 1 },
                                { item: "fall", weight: 2 },
                            ])].index, true, 0, -1, selectWeightedRandom([{ item: false, weight: 8 }, { item: true, weight: 1 }]), Config.perEnvelopeSpeedIndices[selectCurvedDistribution(1, 63, 45, 20)], envelopeLowerBound, envelopeUpperBound, selectCurvedDistribution(2, 16, 2, 6), selectCurvedDistribution(1, 63, 32, 31),
                                selectWeightedRandom([{ item: LFOEnvelopeTypes.sine, weight: 8 }, { item: LFOEnvelopeTypes.triangle, weight: 3 }]));
                        }
                    }
                }
                if (Math.random() < 0.07) {
                    instrument.ringModulation = selectCurvedDistribution(1, Config.ringModRange - 1, Config.ringModRange / 2, Config.ringModRange / 2);
                    instrument.ringModulationHz = selectCurvedDistribution(1, Config.ringModHzRange - 1, Config.ringModHzRange / 2, Config.ringModHzRange / 2);
                    if (instrument.ringModulation != 0 || instrument.ringModulationHz != 0) {
                        instrument.effects |= 1 << EffectType.ringModulation;
                        instrument.ringModWaveformIndex = 0;

                        if (selectiveRandom.envelopes && Math.random() < 0.1) {
                            let envelopeLowerBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                            let envelopeUpperBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                            if (envelopeLowerBound >= envelopeUpperBound) {
                                envelopeLowerBound = 0;
                                envelopeUpperBound = 1;
                            }
                            instrument.addEnvelope(Config.instrumentAutomationTargets.dictionary["ringModulation"].index, 0, Config.newEnvelopes.dictionary[selectWeightedRandom([
                                { item: "note size", weight: 4 },
                                { item: "pitch", weight: 8 },
                                { item: "random", weight: 7 },
                                { item: "punch", weight: 1 },
                                { item: "flare", weight: 1 },
                                { item: "twang", weight: 8 },
                                { item: "swell", weight: 6 },
                                { item: "lfo", weight: 6 },
                                { item: "decay", weight: 4 },
                                { item: "wibble", weight: 2 },
                                { item: "linear", weight: 4 },
                                { item: "rise", weight: 3 },
                                { item: "fall", weight: 4 },
                            ])].index, true, 0, -1, selectWeightedRandom([{ item: false, weight: 8 }, { item: true, weight: 1 }]), Config.perEnvelopeSpeedIndices[selectCurvedDistribution(1, 63, 25, 20)], envelopeLowerBound, envelopeUpperBound, selectCurvedDistribution(2, 16, 2, 6), selectCurvedDistribution(1, 63, 32, 31),
                                selectWeightedRandom([{ item: LFOEnvelopeTypes.sine, weight: 8 }, { item: LFOEnvelopeTypes.triangle, weight: 3 }]));
                        }

                        if (selectiveRandom.envelopes && Math.random() < 0.3) {
                            let envelopeLowerBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                            let envelopeUpperBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                            if (envelopeLowerBound >= envelopeUpperBound) {
                                envelopeLowerBound = 0;
                                envelopeUpperBound = 1;
                            }
                            instrument.addEnvelope(Config.instrumentAutomationTargets.dictionary["ringModulationHz"].index, 0, Config.newEnvelopes.dictionary[selectWeightedRandom([
                                { item: "note size", weight: 4 },
                                { item: "pitch", weight: 8 },
                                { item: "random", weight: 7 },
                                { item: "punch", weight: 1 },
                                { item: "flare", weight: 4 },
                                { item: "twang", weight: 8 },
                                { item: "swell", weight: 6 },
                                { item: "lfo", weight: 6 },
                                { item: "decay", weight: 4 },
                                { item: "wibble", weight: 2 },
                                { item: "linear", weight: 4 },
                                { item: "rise", weight: 3 },
                                { item: "fall", weight: 4 },
                            ])].index, true, 0, -1, selectWeightedRandom([{ item: false, weight: 8 }, { item: true, weight: 1 }]), Config.perEnvelopeSpeedIndices[selectCurvedDistribution(1, 63, 25, 20)], envelopeLowerBound, envelopeUpperBound, selectCurvedDistribution(2, 16, 2, 6), selectCurvedDistribution(1, 63, 32, 31),
                                selectWeightedRandom([{ item: LFOEnvelopeTypes.sine, weight: 8 }, { item: LFOEnvelopeTypes.triangle, weight: 3 }, { item: LFOEnvelopeTypes.square, weight: 1 }]));
                        }
                    }
                }
                if (Math.random() < 0.5) {
                    instrument.effects |= 1 << EffectType.reverb;
                    instrument.reverb = selectCurvedDistribution(1, Config.reverbRange - 1, 1, 1);
                    if (selectiveRandom.envelopes && Math.random() < 0.03) {
                        let envelopeLowerBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                        let envelopeUpperBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                        if (envelopeLowerBound >= envelopeUpperBound) {
                            envelopeLowerBound = 0;
                            envelopeUpperBound = 1;
                        }
                        instrument.addEnvelope(Config.instrumentAutomationTargets.dictionary["reverb"].index, 0, Config.newEnvelopes.dictionary[selectWeightedRandom([
                            { item: "note size", weight: 3 },
                            { item: "pitch", weight: 4 },
                            { item: "random", weight: 1 },
                            { item: "punch", weight: 2 },
                            { item: "flare", weight: 3 },
                            { item: "twang", weight: 10 },
                            { item: "swell", weight: 8 },
                            { item: "lfo", weight: 7 },
                            { item: "decay", weight: 5 },
                            { item: "wibble", weight: 5 },
                            { item: "linear", weight: 4 },
                            { item: "rise", weight: 8 },
                            { item: "fall", weight: 2 },
                        ])].index, true, 0, -1, selectWeightedRandom([{ item: false, weight: 8 }, { item: true, weight: 1 }]), Config.perEnvelopeSpeedIndices[selectCurvedDistribution(1, 63, 45, 20)], envelopeLowerBound, envelopeUpperBound, selectCurvedDistribution(2, 16, 2, 6), selectCurvedDistribution(1, 63, 32, 31),
                            selectWeightedRandom([{ item: LFOEnvelopeTypes.sine, weight: 2 }, { item: LFOEnvelopeTypes.triangle, weight: 5 }]));
                    }
                }
                if (Math.random() < 0.1) {
                    instrument.effects |= 1 << EffectType.granular;
                    instrument.granular = selectCurvedDistribution(1, Config.granularRange - 1, Config.granularRange / 2, Config.granularRange / 3);
                    instrument.grainAmounts = selectCurvedDistribution(1, Config.grainAmountsMax - 1, Config.grainAmountsMax - 2, 3);
                    instrument.grainSize = selectCurvedDistribution(Config.grainSizeMin / Config.grainSizeStep, Config.grainSizeMax / Config.grainSizeStep, Config.grainSizeMax / Config.grainSizeStep, Config.grainSizeMax / Config.grainSizeStep / 2);
                    instrument.grainRange = selectCurvedDistribution(0, Config.grainRangeMax / Config.grainSizeStep, Config.grainRangeMax / Config.grainSizeStep / 2, Config.grainSizeMax / Config.grainSizeStep / 2);
                
                    if (selectiveRandom.envelopes && Math.random() < 0.2) {
                        let envelopeLowerBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                        let envelopeUpperBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                        if (envelopeLowerBound >= envelopeUpperBound) {
                            envelopeLowerBound = 0;
                            envelopeUpperBound = 1;
                        }
                        instrument.addEnvelope(Config.instrumentAutomationTargets.dictionary["granular"].index, 0, Config.newEnvelopes.dictionary[selectWeightedRandom([
                            { item: "note size", weight: 10 },
                            { item: "pitch", weight: 8 },
                            { item: "random", weight: 2 },
                            { item: "twang", weight: 8 },
                            { item: "swell", weight: 6 },
                            { item: "lfo", weight: 4 },
                            { item: "decay", weight: 4 },
                            { item: "wibble", weight: 2 },
                            { item: "linear", weight: 4 },
                            { item: "rise", weight: 3 },
                            { item: "fall", weight: 4 },
                        ])].index, true, 0, -1, selectWeightedRandom([{ item: false, weight: 8 }, { item: true, weight: 1 }]), Config.perEnvelopeSpeedIndices[selectCurvedDistribution(1, 63, 25, 20)], envelopeLowerBound, envelopeUpperBound, selectCurvedDistribution(2, 16, 2, 6), selectCurvedDistribution(1, 63, 32, 31),
                            selectWeightedRandom([{ item: LFOEnvelopeTypes.sine, weight: 8 }, { item: LFOEnvelopeTypes.triangle, weight: 3 }, { item: LFOEnvelopeTypes.square, weight: 1 }]));
                    }

                    if (selectiveRandom.envelopes && Math.random() < 0.3) {
                        let envelopeLowerBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                        let envelopeUpperBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                        if (envelopeLowerBound >= envelopeUpperBound) {
                            envelopeLowerBound = 0;
                            envelopeUpperBound = 1;
                        }
                        instrument.addEnvelope(Config.instrumentAutomationTargets.dictionary["grainFreq"].index, 0, Config.newEnvelopes.dictionary[selectWeightedRandom([
                            { item: "note size", weight: 10 },
                            { item: "pitch", weight: 8 },
                            { item: "random", weight: 7 },
                            { item: "flare", weight: 1 },
                            { item: "twang", weight: 8 },
                            { item: "swell", weight: 6 },
                            { item: "lfo", weight: 6 },
                            { item: "decay", weight: 4 },
                            { item: "wibble", weight: 3 },
                            { item: "linear", weight: 4 },
                            { item: "rise", weight: 3 },
                            { item: "fall", weight: 4 },
                        ])].index, true, 0, -1, selectWeightedRandom([{ item: false, weight: 8 }, { item: true, weight: 1 }]), Config.perEnvelopeSpeedIndices[selectCurvedDistribution(1, 63, 25, 20)], envelopeLowerBound, envelopeUpperBound, selectCurvedDistribution(2, 16, 2, 6), selectCurvedDistribution(1, 63, 32, 31),
                            selectWeightedRandom([{ item: LFOEnvelopeTypes.sine, weight: 8 }, { item: LFOEnvelopeTypes.triangle, weight: 3 }, { item: LFOEnvelopeTypes.square, weight: 1 }]));
                    }

                    if (selectiveRandom.envelopes && Math.random() < 0.3) {
                        let envelopeLowerBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                        let envelopeUpperBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                        if (envelopeLowerBound >= envelopeUpperBound) {
                            envelopeLowerBound = 0;
                            envelopeUpperBound = 1;
                        }
                        instrument.addEnvelope(Config.instrumentAutomationTargets.dictionary["grainSize"].index, 0, Config.newEnvelopes.dictionary[selectWeightedRandom([
                            { item: "note size", weight: 10 },
                            { item: "pitch", weight: 8 },
                            { item: "random", weight: 7 },
                            { item: "punch", weight: 1 },
                            { item: "flare", weight: 1 },
                            { item: "twang", weight: 5 },
                            { item: "swell", weight: 8 },
                            { item: "lfo", weight: 6 },
                            { item: "decay", weight: 3 },
                            { item: "wibble", weight: 2 },
                            { item: "linear", weight: 4 },
                            { item: "rise", weight: 6 },
                            { item: "fall", weight: 4 },
                        ])].index, true, 0, -1, selectWeightedRandom([{ item: false, weight: 8 }, { item: true, weight: 1 }]), Config.perEnvelopeSpeedIndices[selectCurvedDistribution(1, 63, 25, 20)], envelopeLowerBound, envelopeUpperBound, selectCurvedDistribution(2, 16, 2, 6), selectCurvedDistribution(1, 63, 32, 31),
                            selectWeightedRandom([{ item: LFOEnvelopeTypes.sine, weight: 8 }, { item: LFOEnvelopeTypes.triangle, weight: 3 }, { item: LFOEnvelopeTypes.square, weight: 1 }]));
                    }

                    if (selectiveRandom.envelopes && Math.random() < 0.05) {
                        let envelopeLowerBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                        let envelopeUpperBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                        if (envelopeLowerBound >= envelopeUpperBound) {
                            envelopeLowerBound = 0;
                            envelopeUpperBound = 1;
                        }
                        instrument.addEnvelope(Config.instrumentAutomationTargets.dictionary["grainRange"].index, 0, Config.newEnvelopes.dictionary[selectWeightedRandom([
                            { item: "note size", weight: 10 },
                            { item: "pitch", weight: 8 },
                            { item: "random", weight: 7 },
                            { item: "punch", weight: 1 },
                            { item: "flare", weight: 1 },
                            { item: "twang", weight: 8 },
                            { item: "swell", weight: 6 },
                            { item: "lfo", weight: 6 },
                            { item: "decay", weight: 4 },
                            { item: "wibble", weight: 2 },
                            { item: "linear", weight: 4 },
                            { item: "rise", weight: 3 },
                            { item: "fall", weight: 4 },
                        ])].index, true, 0, -1, selectWeightedRandom([{ item: false, weight: 8 }, { item: true, weight: 1 }]), Config.perEnvelopeSpeedIndices[selectCurvedDistribution(1, 63, 25, 20)], envelopeLowerBound, envelopeUpperBound, selectCurvedDistribution(2, 16, 2, 6), selectCurvedDistribution(1, 63, 32, 31),
                            selectWeightedRandom([{ item: LFOEnvelopeTypes.sine, weight: 8 }, { item: LFOEnvelopeTypes.triangle, weight: 3 }, { item: LFOEnvelopeTypes.square, weight: 1 }]));
                    }
                }
            }
            if (selectiveRandom.envelopes && Math.random() < 0.2) {
                let envelopeLowerBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                let envelopeUpperBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                if (envelopeLowerBound >= envelopeUpperBound) {
                    envelopeLowerBound = 0;
                    envelopeUpperBound = 1;
                }
                instrument.addEnvelope(Config.instrumentAutomationTargets.dictionary["noteVolume"].index, 0, Config.newEnvelopes.dictionary[selectWeightedRandom([
                    { item: "pitch", weight: 1 },
                    { item: "random", weight: 4},
                    { item: "punch", weight: 6 },
                    { item: "flare", weight: 3 },
                    { item: "twang", weight: 13 },
                    { item: "swell", weight: 7 },
                    { item: "lfo", weight: 2 },
                    { item: "decay", weight: 4 },
                    { item: "wibble", weight: 3 },
                    { item: "linear", weight: 4 },
                    { item: "rise", weight: 4 },
                    { item: "fall", weight: 3 },
                ])].index, true, 0, -1, selectWeightedRandom([{ item: false, weight: 8 }, { item: true, weight: 1 }]), Config.perEnvelopeSpeedIndices[selectCurvedDistribution(1, 63, 40, 20)], envelopeLowerBound, envelopeUpperBound, selectCurvedDistribution(2, 16, 2, 6), selectCurvedDistribution(1, 63, 32, 31),
                    selectWeightedRandom([{ item: RandomEnvelopeTypes.time, weight: 8 }, { item: RandomEnvelopeTypes.pitch, weight: 2 }]));
            }
            function normalize(harmonics: number[]): void {
                let max: number = 0;
                for (const value of harmonics) {
                    if (value > max) max = value;
                }
                for (let i: number = 0; i < harmonics.length; i++) {
                    harmonics[i] = Config.harmonicsMax * harmonics[i] / max;
                }
            }
            if (selectiveRandom.instrumentTypeSettings) switch (type) {
                case InstrumentType.chip: {
                    instrument.chipWave = (Math.random() * Config.chipWaves.length) | 0;
                    instrument.isUsingAdvancedLoopControls = false;
                    instrument.chipWaveLoopStart = 0;
                    instrument.chipWaveLoopEnd = Config.rawRawChipWaves[instrument.chipWave].samples.length - 1;
                    instrument.chipWaveLoopMode = 0;
                    instrument.chipWavePlayBackwards = false;
                    instrument.chipWaveStartOffset = 0;
                } break;
                case InstrumentType.pwm:
                case InstrumentType.supersaw: {
                    if (type == InstrumentType.supersaw) {
                        instrument.supersawDynamism = selectCurvedDistribution(0, Config.supersawDynamismMax, Config.supersawDynamismMax, 2);
                        instrument.supersawSpread = selectCurvedDistribution(0, Config.supersawSpreadMax, Math.ceil(Config.supersawSpreadMax / 3), 4);
                        instrument.supersawShape = selectCurvedDistribution(0, Config.supersawShapeMax, 0, 4);
                    }
                    instrument.pulseWidth = selectCurvedDistribution(0, Config.pulseWidthRange - 1, Config.pulseWidthRange - 1, 2);
                    instrument.decimalOffset = 0;

                    if (selectiveRandom.envelopes && Math.random() < 0.6) {
                        instrument.addEnvelope(Config.instrumentAutomationTargets.dictionary["pulseWidth"].index, 0, Config.newEnvelopes.dictionary[selectWeightedRandom([
                            { item: "note size", weight: 2 },
                            { item: "pitch", weight: 1 },
                            { item: "random", weight: 3 },
                            { item: "punch", weight: 6 },
                            { item: "flare", weight: 3 },
                            { item: "twang", weight: 6 },
                            { item: "swell", weight: 8 },
                            { item: "lfo", weight: 6 },
                            { item: "decay", weight: 2 },
                            { item: "wibble", weight: 6 },
                            { item: "linear", weight: 3 },
                            { item: "rise", weight: 5 },
                            { item: "blip", weight: 10 },
                            { item: "fall", weight: 4 },
                        ])].index, false, 0, -1, selectWeightedRandom([{ item: false, weight: 8 }, { item: true, weight: 1 }]),
                            Config.perEnvelopeSpeedIndices[selectCurvedDistribution(1, 63, 40, 20)],
                            selectWeightedRandom([
                                { item: 0, weight: 8 },
                                { item: 0.1, weight: 4 },
                                { item: 0.2, weight: 3 },
                                { item: 0.3, weight: 1 },
                                { item: 0.4, weight: 2 },
                                { item: 0.5, weight: 6 },
                            ]), selectWeightedRandom([
                                { item: 0.6, weight: 1 },
                                { item: 0.7, weight: 2 },
                                { item: 0.8, weight: 3 },
                                { item: 0.9, weight: 5 },
                                { item: 1, weight: 8 }]), selectCurvedDistribution(2, 16, 2, 6), selectCurvedDistribution(1, 63, 32, 31),
                            selectWeightedRandom([{ item: RandomEnvelopeTypes.time, weight: 8 }, { item: RandomEnvelopeTypes.pitch, weight: 2 }]));                        
                    }
                } break;
                case InstrumentType.pickedString:
                case InstrumentType.harmonics: {
                    if (type == InstrumentType.pickedString) {
                        instrument.stringSustain = (Math.random() * Config.stringSustainRange) | 0;
                    }

                    const harmonicGenerators: Function[] = [
                        (): number[] => {
                            const harmonics: number[] = [];
                            for (let i: number = 0; i < Config.harmonicsControlPoints; i++) {
                                harmonics[i] = (Math.random() < 0.4) ? Math.random() : 0.0;
                            }
                            harmonics[(Math.random() * 8) | 0] = Math.pow(Math.random(), 0.25);
                            return harmonics;
                        },
                        (): number[] => {
                            let current: number = 1.0;
                            const harmonics: number[] = [current];
                            for (let i = 1; i < Config.harmonicsControlPoints; i++) {
                                current *= Math.pow(2, Math.random() - 0.55);
                                harmonics[i] = current;
                            }
                            return harmonics;
                        },
                        (): number[] => {
                            let current: number = 1.0;
                            const harmonics: number[] = [current];
                            for (let i = 1; i < Config.harmonicsControlPoints; i++) {
                                current *= Math.pow(2, Math.random() - 0.55);
                                harmonics[i] = current * Math.random();
                            }
                            return harmonics;
                        },
                    ];
                    const generator = harmonicGenerators[(Math.random() * harmonicGenerators.length) | 0];
                    const harmonics: number[] = generator();
                    normalize(harmonics);
                    for (let i: number = 0; i < Config.harmonicsControlPoints; i++) {
                        instrument.harmonicsWave.harmonics[i] = Math.round(harmonics[i]);
                    }
                    instrument.harmonicsWave.markCustomWaveDirty();
                } break;
                case InstrumentType.spectrum: {
                    const spectrum: number[] = [];
                    for (let i: number = 0; i < Config.spectrumControlPoints; i++) {
                        const isHarmonic: boolean = i == 0 || i == 7 || i == 11 || i == 14 || i == 16 || i == 18 || i == 21;
                        if (isHarmonic) {
                            spectrum[i] = Math.pow(Math.random(), 0.25);
                        } else {
                            spectrum[i] = Math.pow(Math.random(), 3) * 0.5;
                        }
                    }
                    normalize(spectrum);
                    for (let i: number = 0; i < Config.spectrumControlPoints; i++) {
                        instrument.spectrumWave.spectrum[i] = Math.round(spectrum[i]);
                    }
                    instrument.spectrumWave.markCustomWaveDirty();
                } break;
                case InstrumentType.fm6op:
                case InstrumentType.fm: {
                    if (type == InstrumentType.fm) {
                        instrument.algorithm = (Math.random() * Config.algorithms.length) | 0;
                        instrument.feedbackType = (Math.random() * Config.feedbacks.length) | 0;
                    } else {
                        instrument.algorithm6Op = (Math.random() * (Config.algorithms6Op.length - 1) + 1) | 0;
                        instrument.customAlgorithm.fromPreset(instrument.algorithm6Op);
                        instrument.feedbackType6Op = (Math.random() * (Config.feedbacks6Op.length - 1) + 1) | 0;
                        instrument.customFeedbackType.fromPreset(instrument.feedbackType6Op);
                    }
                    const algorithm: Algorithm = type == InstrumentType.fm ? Config.algorithms[instrument.algorithm] : Config.algorithms6Op[instrument.algorithm6Op];
                    for (let i: number = 0; i < algorithm.carrierCount; i++) {
                        instrument.operators[i].frequency = selectCurvedDistribution(0, Config.operatorFrequencies.length - 1, 0, 3);
                        instrument.operators[i].amplitude = selectCurvedDistribution(0, Config.operatorAmplitudeMax, Config.operatorAmplitudeMax - 1, 2);
                        instrument.operators[i].waveform = Config.operatorWaves.dictionary[selectWeightedRandom([
                            { item: "sine", weight: 10 },
                            { item: "triangle", weight: 6 },
                            { item: "pulse width", weight: 6 },
                            { item: "sawtooth", weight: 3 },
                            { item: "ramp", weight: 3 },
                            { item: "trapezoid", weight: 4 },
				            { item: "quasi-sine", weight: 2 },
                        ])].index;
                        if (instrument.operators[i].waveform == 2/*"pulse width"*/) {
                            instrument.operators[i].pulseWidth = selectWeightedRandom([
                                { item: 0, weight: 3 },
                                { item: 1, weight: 5 },
                                { item: 2, weight: 7 },
                                { item: 3, weight: 10 },
                                { item: 4, weight: 15 },
                                { item: 5, weight: 25 }, // 50%
                                { item: 6, weight: 15 },
                                { item: 7, weight: 10 },
                                { item: 8, weight: 7 },
                                { item: 9, weight: 5 },
                                { item: 9, weight: 3 },
                            ]);
                        }
                    }
                    for (let i: number = algorithm.carrierCount; i < Config.operatorCount + (type == InstrumentType.fm6op ? 2 : 0); i++) {
                        instrument.operators[i].frequency = selectCurvedDistribution(3, Config.operatorFrequencies.length - 1, 0, 3);
                        instrument.operators[i].amplitude = (Math.pow(Math.random(), 2) * Config.operatorAmplitudeMax) | 0;
                        if (selectiveRandom.envelopes && instrument.envelopeCount < Config.maxEnvelopeCount && Math.random() < 0.4) {
                            let envelopeLowerBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                            let envelopeUpperBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                            if (envelopeLowerBound >= envelopeUpperBound) {
                                envelopeLowerBound = 0;
                                envelopeUpperBound = 1;
                            }
                            instrument.addEnvelope(Config.instrumentAutomationTargets.dictionary["operatorAmplitude"].index, i, Config.newEnvelopes.dictionary[selectWeightedRandom([
                                { item: "punch", weight: 2 },
                                { item: "pitch", weight: 1 },
                                { item: "flare", weight: 3 },
                                { item: "twang", weight: 4 },
                                { item: "swell", weight: 4 },
                                { item: "lfo", weight: 6 },
                                { item: "decay", weight: 2 },
                                { item: "wibble", weight: 5 },
                                { item: "linear", weight: 3 },
                                { item: "rise", weight: 5 },
                                { item: "fall", weight: 2 },
                            ])].index, true, 0, -1, selectWeightedRandom([{ item: false, weight: 8 }, { item: true, weight: 1 }]), Config.perEnvelopeSpeedIndices[selectCurvedDistribution(1, 63, 30, 30)], envelopeLowerBound, envelopeUpperBound, 2, 2,
                                selectWeightedRandom([{ item: LFOEnvelopeTypes.sine, weight: 8 }, { item: LFOEnvelopeTypes.triangle, weight: 4 }, { item: LFOEnvelopeTypes.sawtooth, weight: 2 }, { item: LFOEnvelopeTypes.square, weight: 1 }]));
                        }
                        if (selectiveRandom.envelopes && instrument.envelopeCount < Config.maxEnvelopeCount && Math.random() < 0.15) {
                            let envelopeLowerBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                            let envelopeUpperBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                            if (envelopeLowerBound >= envelopeUpperBound) {
                                envelopeLowerBound = 0;
                                envelopeUpperBound = 1;
                            }
                            instrument.addEnvelope(Config.instrumentAutomationTargets.dictionary["operatorFrequency"].index, i, Config.newEnvelopes.dictionary[selectWeightedRandom([
                                { item: "punch", weight: 2 },
                                { item: "pitch", weight: 1 },
                                { item: "flare", weight: 3 },
                                { item: "twang", weight: 10 },
                                { item: "swell", weight: 5 },
                                { item: "lfo", weight: 6 },
                                { item: "decay", weight: 2 },
                                { item: "wibble", weight: 5 },
                                { item: "linear", weight: 3 },
                                { item: "rise", weight: 5 },
                                { item: "fall", weight: 2 },
                            ])].index, true, 0, -1, selectWeightedRandom([{ item: false, weight: 8 }, { item: true, weight: 1 }]), Config.perEnvelopeSpeedIndices[selectCurvedDistribution(1, 63, 30, 30)], envelopeLowerBound, envelopeUpperBound, 2, 2,
                                selectWeightedRandom([{ item: LFOEnvelopeTypes.sine, weight: 8 }, { item: LFOEnvelopeTypes.triangle, weight: 4 }, { item: LFOEnvelopeTypes.sawtooth, weight: 4 }, { item: LFOEnvelopeTypes.square, weight: 1 }]));
                        }
                        instrument.operators[i].waveform = Config.operatorWaves.dictionary[selectWeightedRandom([
                            { item: "sine", weight: 10 },
                            { item: "triangle", weight: 6 },
                            { item: "pulse width", weight: 6 },
                            { item: "sawtooth", weight: 3 },
                            { item: "ramp", weight: 3 },
                            { item: "trapezoid", weight: 4 },
				            { item: "quasi-sine", weight: 2 },
                        ])].index;
                        if (instrument.operators[i].waveform == 2) {
                            instrument.operators[i].pulseWidth = selectWeightedRandom([
                                { item: 0, weight: 3 },
                                { item: 1, weight: 5 },
                                { item: 2, weight: 7 },
                                { item: 3, weight: 10 },
                                { item: 4, weight: 15 },
                                { item: 5, weight: 25 }, // 50%
                                { item: 6, weight: 15 },
                                { item: 7, weight: 10 },
                                { item: 8, weight: 7 },
                                { item: 9, weight: 5 },
                                { item: 9, weight: 3 },
                            ]);
                        }
                    }
                    instrument.feedbackAmplitude = (Math.pow(Math.random(), 3) * Config.operatorAmplitudeMax) | 0;
                    if (selectiveRandom.envelopes && instrument.envelopeCount < Config.maxEnvelopeCount && Math.random() < 0.4) {
                        let envelopeLowerBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                        let envelopeUpperBound = selectCurvedDistribution(0, 20, 8, 5) / 10;
                        if (envelopeLowerBound >= envelopeUpperBound) {
                            envelopeLowerBound = 0;
                            envelopeUpperBound = 1;
                        }
                        instrument.addEnvelope(Config.instrumentAutomationTargets.dictionary["feedbackAmplitude"].index, 0, Config.newEnvelopes.dictionary[selectWeightedRandom([
                            { item: "note size", weight: 4 },
                            { item: "punch", weight: 2 },
                            { item: "pitch", weight: 1 },
                            { item: "flare", weight: 2 },
                            { item: "twang", weight: 2 },
                            { item: "swell", weight: 4 },
                            { item: "lfo", weight: 3 },
                            { item: "decay", weight: 3 },
                            { item: "wibble", weight: 3 },
                            { item: "linear", weight: 2 },
                            { item: "rise", weight: 3 },
                            { item: "fall", weight: 3 },
                        ])].index, true, 0, -1, selectWeightedRandom([{ item: false, weight: 8 }, { item: true, weight: 1 }]), Config.perEnvelopeSpeedIndices[selectCurvedDistribution(1, 63, 30, 30)], envelopeLowerBound, envelopeUpperBound, 2, 2,
                            selectWeightedRandom([{ item: LFOEnvelopeTypes.sine, weight: 8 }, { item: LFOEnvelopeTypes.triangle, weight: 4 }, { item: LFOEnvelopeTypes.sawtooth, weight: 2 }, { item: LFOEnvelopeTypes.square, weight: 1 }]));
                    }
                } break;
                case InstrumentType.customChipWave: {
                    // The custom chip randomizing is a little different. It uses a random algorithm
                    // (seen as the functions below) to give the waveform unique shapes other than messy
                    // custom chip sounds. 
                    let randomGeneratedArray: Float32Array = new Float32Array(64);
                    let randomGeneratedArrayIntegral: Float32Array = new Float32Array(65);
                    const algorithmFunction: (wave: Float32Array) => void = selectWeightedRandom([
                        { item: randomSineWave, weight: 4 },
                        { item: randomPulses, weight: 4 },
                        { item: randomChipWave, weight: 3 },
                        { item: biasedFullyRandom, weight: 2 },
                        { item: fullyRandom, weight: 1 },
                    ]);
                    algorithmFunction(randomGeneratedArray);

                    let sum: number = 0.0;
                    for (let i: number = 0; i < randomGeneratedArray.length; i++) sum += randomGeneratedArray[i];
                    const average: number = sum / randomGeneratedArray.length;
                    let cumulative: number = 0;
                    let wavePrev: number = 0;
                    for (let i: number = 0; i < randomGeneratedArray.length; i++) {
                        cumulative += wavePrev;
                        wavePrev = randomGeneratedArray[i] - average;
                        randomGeneratedArrayIntegral[i] = cumulative;
                    }
                    randomGeneratedArrayIntegral[64] = 0.0;

                    instrument.customChipWave = randomGeneratedArray;
                    instrument.customChipWaveIntegral = randomGeneratedArrayIntegral;
                } break;
               // case InstrumentType.noise: {
                //     instrument.chipNoise = selectWeightedRandom([
                //         { item: 0, weight: 1 }, // retro
                //         { item: 1, weight: 1 }, // white
                //         { item: 2, weight: 6 }, // clang
                //         { item: 3, weight: 6 }, // buzz
                //         { item: 4, weight: 1 }, // hollow
                //         { item: 7, weight: 4 }, // cutter
                //         { item: 8, weight: 4 }, // metallic
                //         { item: 9, weight: 1 }, // static
                //         { item: 10, weight: 1 }, // 1-bit white
                //         { item: 11, weight: 5 }, // 1-bit metallic
                //     ]);
                // } break;
                default: throw new Error("Unhandled pitched instrument type in random generator.");
            }
        }
        if (!selectiveRandom.envelopes) instrument.clearInvalidEnvelopeTargets();
        //TODO: Rewrite how we add envelopes and do them all in one place
        // else {
        //     const potentialEnvelopes = 
        // }
        
        doc.notifier.changed();
        this._didSomething();
    }
}

export class ChangeTransition extends Change {
    constructor(doc: SongDocument, newValue: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        const oldValue: number = instrument.transition;
        if (oldValue != newValue) {
            this._didSomething();
            instrument.transition = newValue;
            instrument.preset = instrument.type;
            doc.notifier.changed();
        }
    }
}

export class ChangeToggleEffects extends Change {
    constructor(doc: SongDocument, toggleFlag: number, useInstrument: Instrument | null) {
        super();
        let instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        if (useInstrument != null)
            instrument = useInstrument;
        const oldValue: number = instrument.effects;
        const wasSelected: boolean = ((oldValue & (1 << toggleFlag)) != 0);
        const newValue: number = wasSelected ? (oldValue & (~(1 << toggleFlag))) : (oldValue | (1 << toggleFlag));
        instrument.effects = newValue;
        // As a special case, toggling the panning effect doesn't remove the preset.
        if (toggleFlag != EffectType.panning) instrument.preset = instrument.type;
        // Remove AA when distortion is turned off.
        if (toggleFlag == EffectType.distortion && wasSelected)
            instrument.aliases = false;
        if (wasSelected) instrument.clearInvalidEnvelopeTargets();
        this._didSomething();
        doc.notifier.changed();
    }
}


export class ChangePatternNumbers extends Change {
    constructor(doc: SongDocument, value: number, startBar: number, startChannel: number, width: number, height: number) {
        super();
        if (value > doc.song.patternsPerChannel) throw new Error("invalid pattern");

        for (let bar: number = startBar; bar < startBar + width; bar++) {
            for (let channelIndex: number = startChannel; channelIndex < startChannel + height; channelIndex++) {
                if (doc.song.channels[channelIndex].bars[bar] != value) {
                    doc.song.channels[channelIndex].bars[bar] = value;
                    this._didSomething();
                }
            }
        }

        //Make mod channels shift viewed instrument over when pattern numbers change
        if (startChannel >= doc.song.pitchChannelCount + doc.song.noiseChannelCount) {
            const pattern: Pattern | null = doc.getCurrentPattern();
            if (pattern != null) {
                doc.viewedInstrument[startChannel] = pattern.instruments[0];
            }
            else {
                doc.viewedInstrument[startChannel] = 0;
            }
        }

        doc.notifier.changed();
    }
}

export class ChangeBarCount extends Change {
    constructor(doc: SongDocument, newValue: number, atBeginning: boolean) {
        super();
        if (doc.song.barCount != newValue) {
            for (const channel of doc.song.channels) {
                if (atBeginning) {
                    while (channel.bars.length < newValue) {
                        channel.bars.unshift(0);
                    }
                    if (doc.song.barCount > newValue) {
                        channel.bars.splice(0, doc.song.barCount - newValue);
                    }
                } else {
                    while (channel.bars.length < newValue) {
                        channel.bars.push(0);
                    }
                    channel.bars.length = newValue;
                }
            }

            if (atBeginning) {
                const diff: number = newValue - doc.song.barCount;
                doc.bar = Math.max(0, doc.bar + diff);
                if (diff < 0 || doc.barScrollPos > 0) {
                    doc.barScrollPos = Math.max(0, doc.barScrollPos + diff);
                }
                doc.song.loopStart = Math.max(0, doc.song.loopStart + diff);
            }
            doc.bar = Math.min(doc.bar, newValue - 1);
            doc.song.loopLength = Math.min(newValue, doc.song.loopLength);
            doc.song.loopStart = Math.min(newValue - doc.song.loopLength, doc.song.loopStart);
            doc.song.barCount = newValue;
            doc.notifier.changed();

            this._didSomething();
        }
    }
}

export class ChangeInsertBars extends Change {
    constructor(doc: SongDocument, start: number, count: number) {
        super();

        const newLength: number = Math.min(Config.barCountMax, doc.song.barCount + count);
        count = newLength - doc.song.barCount;
        if (count == 0) return;

        for (const channel of doc.song.channels) {
            while (channel.bars.length < newLength) {
                channel.bars.splice(start, 0, 0);
            }
        }
        doc.song.barCount = newLength;

        doc.bar += count;
        doc.barScrollPos += count;
        if (doc.song.loopStart >= start) {
            doc.song.loopStart += count;
        } else if (doc.song.loopStart + doc.song.loopLength >= start) {
            doc.song.loopLength += count;
        }

        doc.notifier.changed();
        this._didSomething();
    }
}

export class ChangeDeleteBars extends Change {
    constructor(doc: SongDocument, start: number, count: number) {
        super();

        for (const channel of doc.song.channels) {
            channel.bars.splice(start, count);
            if (channel.bars.length == 0) channel.bars.push(0);
        }
        doc.song.barCount = Math.max(1, doc.song.barCount - count);

        doc.bar = Math.max(0, doc.bar - count);

        doc.barScrollPos = Math.max(0, doc.barScrollPos - count);
        if (doc.song.loopStart >= start) {
            doc.song.loopStart = Math.max(0, doc.song.loopStart - count);
        } else if (doc.song.loopStart + doc.song.loopLength > start) {
            doc.song.loopLength -= count;
        }
        doc.song.loopLength = Math.max(1, Math.min(doc.song.barCount - doc.song.loopStart, doc.song.loopLength));

        doc.notifier.changed();
        this._didSomething();
    }
}

export class ChangeLimiterSettings extends Change {
    constructor(doc: SongDocument, limitRatio: number, compressionRatio: number, limitThreshold: number, compressionThreshold: number, limitRise: number, limitDecay: number, masterGain: number) {
        super();

        // This check causes issues with the state change handler because it gets superceded by whenupdated when the limiter prompt closes for some reason, causing the state to revert. I think it's because the notifier change needs to happen right as the prompt closes.
        //if (limitRatio != doc.song.limitRatio || compressionRatio != doc.song.compressionRatio || limitThreshold != doc.song.limitThreshold || compressionThreshold != doc.song.compressionThreshold || limitRise != doc.song.limitRise || limitDecay != doc.song.limitDecay) {

        doc.song.limitRatio = limitRatio;
        doc.song.compressionRatio = compressionRatio;
        doc.song.limitThreshold = limitThreshold;
        doc.song.compressionThreshold = compressionThreshold;
        doc.song.limitRise = limitRise;
        doc.song.limitDecay = limitDecay;
        doc.song.masterGain = masterGain;

        doc.notifier.changed();
        this._didSomething();
        //}
    }
}

export class ChangeChannelOrder extends Change {
    constructor(doc: SongDocument, selectionMin: number, selectionMax: number, offset: number) {
        super();
        // Change the order of two channels by swapping.
        doc.song.channels.splice(selectionMin + offset, 0, ...doc.song.channels.splice(selectionMin, selectionMax - selectionMin + 1));

        // Update mods for each channel
        selectionMax = Math.max(selectionMax, selectionMin);
        for (let channelIndex: number = doc.song.pitchChannelCount + doc.song.noiseChannelCount; channelIndex < doc.song.getChannelCount(); channelIndex++) {
            for (let instrumentIdx: number = 0; instrumentIdx < doc.song.channels[channelIndex].instruments.length; instrumentIdx++) {
                let instrument: Instrument = doc.song.channels[channelIndex].instruments[instrumentIdx];
                for (let i: number = 0; i < Config.modCount; i++) {
                    if (instrument.modChannels[i] >= selectionMin && instrument.modChannels[i] <= selectionMax) {
                        instrument.modChannels[i] += offset;
                    } else if (instrument.modChannels[i] >= selectionMin + offset && instrument.modChannels[i] <= selectionMax + offset) {
                        instrument.modChannels[i] -= offset * (selectionMax - selectionMin + 1);
                    }
                }
            }
        }

        doc.notifier.changed();
        this._didSomething();

    }
}

export class ChangeSwapInstrumentOrder extends Change {
    constructor(doc: SongDocument, channel: number, instrumentLeft: number) {
        super();
        const instruments = doc.song.channels[channel].instruments;
        if (instrumentLeft >= 0 && instruments.length >= 2 && instrumentLeft < instruments.length - 1) {
            // Change the order of two instruments by swapping.
            instruments.splice(instrumentLeft, 2, instruments[instrumentLeft + 1], instruments[instrumentLeft]);

            //set viewed instrument to be the new index of the currently viewed instrument
            const index = instrumentLeft + +(doc.getCurrentInstrument() == instrumentLeft);
            if (index != doc.getCurrentInstrument()) {
                doc.viewedInstrument[doc.channel] = index;
                if (doc.channel >= doc.song.pitchChannelCount + doc.song.noiseChannelCount) doc.recentPatternInstruments[doc.channel] = [index];
            }

            // update patterns if different instruments per pattern is used
            if (doc.song.patternInstruments) {
                for (const pattern of doc.song.channels[channel].patterns) {
                    pattern.instruments.forEach((value, index) => {
                        if (value == instrumentLeft) pattern.instruments[index] = instrumentLeft + 1;
                        else if (value == instrumentLeft + 1) pattern.instruments[index] = instrumentLeft;
                    })
                }
            }

            // Update mods for each channel
            for (let channelIndex: number = doc.song.pitchChannelCount + doc.song.noiseChannelCount; channelIndex < doc.song.getChannelCount(); channelIndex++) {
                for (let instrumentIdx: number = 0; instrumentIdx < doc.song.channels[channelIndex].instruments.length; instrumentIdx++) {
                    let instrument: Instrument = doc.song.channels[channelIndex].instruments[instrumentIdx];
                    for (let i: number = 0; i < Config.modCount; i++) {
                        if (instrument.modChannels[i] == channel) {
                            if (instrument.modInstruments[i] == instrumentLeft) instrument.modInstruments[i]++;
                            else if (instrument.modInstruments[i] == instrumentLeft + 1) instrument.modInstruments[i]--;
                        }
                    }
                }
            }

            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeCustomScale extends Change {
    constructor(doc: SongDocument, flags: boolean[]) {
        super();

        for (let i: number = 0; i < Config.pitchesPerOctave; i++) {
            doc.song.scaleCustom[i] = flags[i];
        }

        doc.notifier.changed();
        this._didSomething();
    }
}

export class ChangeChannelCount extends Change {
    constructor(doc: SongDocument, newPitchChannelCount: number, newNoiseChannelCount: number, newModChannelCount: number) {
        super();
        if (doc.song.pitchChannelCount != newPitchChannelCount || doc.song.noiseChannelCount != newNoiseChannelCount || doc.song.modChannelCount != newModChannelCount) {
            const newChannels: Channel[] = [];

            function changeGroup(newCount: number, oldCount: number, newStart: number, oldStart: number, octave: number, isNoise: boolean, isMod: boolean): void {
                for (let i: number = 0; i < newCount; i++) {
                    const channelIndex = i + newStart;
                    const oldChannel = i + oldStart;
                    if (i < oldCount) {
                        newChannels[channelIndex] = doc.song.channels[oldChannel];
                    } else {
                        newChannels[channelIndex] = new Channel();
                        newChannels[channelIndex].octave = octave;
                        for (let j: number = 0; j < Config.instrumentCountMin; j++) {
                            const instrument: Instrument = new Instrument(isNoise, isMod);
                            if (!isMod) {
                                const presetValue: number = pickRandomPresetValue(isNoise);
                                const preset: Preset = EditorConfig.valueToPreset(presetValue)!;
                                instrument.fromJsonObject(preset.settings, isNoise, isMod, doc.song.rhythm == 0 || doc.song.rhythm == 2, doc.song.rhythm >= 2);
                                instrument.preset = presetValue;
                                instrument.effects |= 1 << EffectType.panning;
                            } else {
                                instrument.setTypeAndReset(InstrumentType.mod, isNoise, isMod);
                            }
                            newChannels[channelIndex].instruments[j] = instrument;
                        }
                        for (let j: number = 0; j < doc.song.patternsPerChannel; j++) {
                            newChannels[channelIndex].patterns[j] = new Pattern();
                        }
                        for (let j: number = 0; j < doc.song.barCount; j++) {
                            newChannels[channelIndex].bars[j] = 0;
                        }
                    }
                }
            }

            changeGroup(newPitchChannelCount, doc.song.pitchChannelCount, 0, 0, 3, false, false);
            changeGroup(newNoiseChannelCount, doc.song.noiseChannelCount, newPitchChannelCount, doc.song.pitchChannelCount, 0, true, false);
            changeGroup(newModChannelCount, doc.song.modChannelCount, newNoiseChannelCount + newPitchChannelCount, doc.song.pitchChannelCount + doc.song.noiseChannelCount, 0, false, true);

            let oldPitchCount: number = doc.song.pitchChannelCount;
            doc.song.pitchChannelCount = newPitchChannelCount;
            doc.song.noiseChannelCount = newNoiseChannelCount;
            doc.song.modChannelCount = newModChannelCount;

            for (let channelIndex: number = 0; channelIndex < doc.song.getChannelCount(); channelIndex++) {
                doc.song.channels[channelIndex] = newChannels[channelIndex];
            }
            doc.song.channels.length = doc.song.getChannelCount();

            doc.channel = Math.min(doc.channel, newPitchChannelCount + newNoiseChannelCount + newModChannelCount - 1);

            // Determine if any mod instruments now refer to an invalid channel. Unset them if so
            for (let channelIndex: number = doc.song.pitchChannelCount + doc.song.noiseChannelCount; channelIndex < doc.song.getChannelCount(); channelIndex++) {
                for (let instrumentIdx: number = 0; instrumentIdx < doc.song.channels[channelIndex].instruments.length; instrumentIdx++) {
                    for (let mod: number = 0; mod < Config.modCount; mod++) {

                        let instrument: Instrument = doc.song.channels[channelIndex].instruments[instrumentIdx];
                        let modChannel: number = instrument.modChannels[mod];

                        // Boundary checking
                        if ((modChannel >= doc.song.pitchChannelCount && modChannel < oldPitchCount) || modChannel >= doc.song.pitchChannelCount + doc.song.noiseChannelCount) {
                            instrument.modulators[mod] = Config.modulators.dictionary["none"].index;
                        }

                        // Bump indices - new pitch channel added, bump all noise mods.
                        if (modChannel >= oldPitchCount && oldPitchCount < newPitchChannelCount) {
                            instrument.modChannels[mod] += newPitchChannelCount - oldPitchCount;
                        }
                    }
                }
            }

            doc.notifier.changed();

            ColorConfig.resetColors();

            this._didSomething();
        }
    }
}

export class ChangeAddChannel extends ChangeGroup {
    constructor(doc: SongDocument, index: number, isNoise: boolean, isMod: boolean) {
        super();
        const newPitchChannelCount: number = doc.song.pitchChannelCount + (isNoise || isMod ? 0 : 1);
        const newNoiseChannelCount: number = doc.song.noiseChannelCount + (!isNoise || isMod ? 0 : 1);
        const newModChannelCount: number = doc.song.modChannelCount + (isNoise || !isMod ? 0 : 1);

        if (newPitchChannelCount <= Config.pitchChannelCountMax && newNoiseChannelCount <= Config.noiseChannelCountMax && newModChannelCount <= Config.modChannelCountMax) {
            const addedChannelIndex: number = doc.song.pitchChannelCount
                + (isNoise || isMod ? doc.song.noiseChannelCount : 0)
                + (isMod ? doc.song.modChannelCount : 0);

            this.append(new ChangeChannelCount(doc, newPitchChannelCount, newNoiseChannelCount, newModChannelCount));
            if (addedChannelIndex - 1 >= index) {
                this.append(new ChangeChannelOrder(doc, index, addedChannelIndex - 1, 1));
            }

            doc.synth.computeLatestModValues();
            doc.recalcChannelNames = true;
        }
    }
}

export class ChangeRemoveChannel extends ChangeGroup {
    constructor(doc: SongDocument, minIndex: number, maxIndex: number) {
        super();

        const oldMax: number = maxIndex;

        // Update modulators - if a higher index was removed, shift down
        for (let modChannel: number = doc.song.pitchChannelCount + doc.song.noiseChannelCount; modChannel < doc.song.channels.length; modChannel++) {
            for (let instrumentIndex: number = 0; instrumentIndex < doc.song.channels[modChannel].instruments.length; instrumentIndex++) {
                const modInstrument: Instrument = doc.song.channels[modChannel].instruments[instrumentIndex];
                for (let mod: number = 0; mod < Config.modCount; mod++) {
                    if (modInstrument.modChannels[mod] >= minIndex && modInstrument.modChannels[mod] <= oldMax) {
                        this.append(new ChangeModChannel(doc, mod, 0, modInstrument));
                    }
                    else if (modInstrument.modChannels[mod] > oldMax) {
                        this.append(new ChangeModChannel(doc, mod, modInstrument.modChannels[mod] - (oldMax - minIndex + 1) + 2, modInstrument));
                    }
                }
            }
        }

        while (maxIndex >= minIndex) {
            const isNoise: boolean = doc.song.getChannelIsNoise(maxIndex);
            const isMod: boolean = doc.song.getChannelIsMod(maxIndex);
            doc.song.channels.splice(maxIndex, 1);
            if (isNoise) {
                doc.song.noiseChannelCount--;
            } else if (isMod) {
                doc.song.modChannelCount--;
            } else {
                doc.song.pitchChannelCount--;
            }
            maxIndex--;
        }

        if (doc.song.pitchChannelCount < Config.pitchChannelCountMin) {
            this.append(new ChangeChannelCount(doc, Config.pitchChannelCountMin, doc.song.noiseChannelCount, doc.song.modChannelCount));
        }

        ColorConfig.resetColors();
        doc.recalcChannelNames = true;

        this.append(new ChangeChannelBar(doc, Math.max(0, minIndex - 1), doc.bar));

        doc.synth.computeLatestModValues();

        this._didSomething();
        doc.notifier.changed();
    }
}

export class ChangeChannelBar extends Change {
    constructor(doc: SongDocument, newChannel: number, newBar: number, silently: boolean = false) {
        super();
        const oldChannel: number = doc.channel;
        const oldBar: number = doc.bar;
        doc.channel = newChannel;
        doc.bar = newBar;
        if (!silently) {
            doc.selection.scrollToSelectedPattern();
        }
        // Mod channels always jump to viewing the active instrument for the mod.
        if (doc.song.getChannelIsMod(doc.channel)) {
            const pattern: Pattern | null = doc.song!.getPattern(doc.channel, doc.bar);
            if (pattern != null)
                doc.viewedInstrument[doc.channel] = pattern.instruments[0];
        }
        doc.notifier.changed();
        if (oldChannel != newChannel || oldBar != newBar) {
            this._didSomething();
        }
    }
}

export class ChangeUnison extends Change {
    constructor(doc: SongDocument, newValue: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        const oldValue: number = instrument.unison;
        if (oldValue != newValue) {
            instrument.unison = newValue;
            instrument.unisonVoices = Config.unisons[instrument.unison].voices;
            instrument.unisonSpread = Config.unisons[instrument.unison].spread;
            instrument.unisonOffset = Config.unisons[instrument.unison].offset;
            instrument.unisonExpression = Config.unisons[instrument.unison].expression;
            instrument.unisonSign = Config.unisons[instrument.unison].sign;
            instrument.preset = instrument.type;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeUnisonVoices extends Change {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        let prevUnison: number = instrument.unison;
        if (oldValue != newValue || prevUnison != Config.unisons.length) {
            instrument.unisonVoices = newValue;
            instrument.unison = Config.unisons.length; // Custom
            instrument.preset = instrument.type;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeUnisonSpread extends Change {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        let prevUnison: number = instrument.unison;
        if (oldValue != newValue || prevUnison != Config.unisons.length) {
            instrument.unisonSpread = newValue;
            instrument.unison = Config.unisons.length; // Custom
            instrument.preset = instrument.type;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeUnisonOffset extends Change {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        let prevUnison: number = instrument.unison;
        if (oldValue != newValue || prevUnison != Config.unisons.length) {
            instrument.unisonOffset = newValue;
            instrument.unison = Config.unisons.length; // Custom
            instrument.preset = instrument.type;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeUnisonExpression extends Change {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        let prevUnison: number = instrument.unison;
        if (oldValue != newValue || prevUnison != Config.unisons.length) {
            instrument.unisonExpression = newValue;
            instrument.unison = Config.unisons.length; // Custom
            instrument.preset = instrument.type;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeUnisonSign extends Change {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        let prevUnison: number = instrument.unison;
        if (oldValue != newValue || prevUnison != Config.unisons.length) {
            instrument.unisonSign = newValue;
            instrument.unison = Config.unisons.length; // Custom
            instrument.preset = instrument.type;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeChord extends Change {
    constructor(doc: SongDocument, newValue: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        const oldValue: number = instrument.chord;
        if (oldValue != newValue) {
            this._didSomething();
            instrument.chord = newValue;
            instrument.preset = instrument.type;
            doc.notifier.changed();
        }
    }
}

export class ChangeVibrato extends Change {
    constructor(doc: SongDocument, newValue: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        const oldValue: number = instrument.vibrato;
        if (oldValue != newValue) {
            instrument.vibrato = newValue;
            instrument.vibratoDepth = Config.vibratos[instrument.vibrato].amplitude;
            instrument.vibratoDelay = Config.vibratos[instrument.vibrato].delayTicks / 2;
            instrument.vibratoSpeed = 10; // default
            instrument.vibratoType = Config.vibratos[instrument.vibrato].type;
            instrument.preset = instrument.type;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeVibratoDepth extends Change {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        let prevVibrato: number = instrument.vibrato;
        doc.synth.unsetMod(Config.modulators.dictionary["vibrato depth"].index, doc.channel, doc.getCurrentInstrument());

        doc.notifier.changed();
        if (oldValue != newValue || prevVibrato != Config.vibratos.length) {
            instrument.vibratoDepth = newValue / 25;
            instrument.vibrato = Config.vibratos.length; // Custom
            instrument.preset = instrument.type;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeEnvelopeSpeed extends Change {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        doc.synth.unsetMod(Config.modulators.dictionary["envelope speed"].index, doc.channel, doc.getCurrentInstrument());

        doc.notifier.changed();
        if (oldValue != newValue) {
            instrument.envelopeSpeed = newValue;
            instrument.preset = instrument.type;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeVibratoSpeed extends Change {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        let prevVibrato: number = instrument.vibrato;
        doc.synth.unsetMod(Config.modulators.dictionary["vibrato speed"].index, doc.channel, doc.getCurrentInstrument());

        doc.notifier.changed();
        if (oldValue != newValue || prevVibrato != Config.vibratos.length) {
            instrument.vibratoSpeed = newValue;
            instrument.vibrato = Config.vibratos.length; // Custom
            instrument.preset = instrument.type;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeVibratoDelay extends Change {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        let prevVibrato: number = instrument.vibrato;
        doc.synth.unsetMod(Config.modulators.dictionary["vibrato delay"].index, doc.channel, doc.getCurrentInstrument());

        doc.notifier.changed();
        if (oldValue != newValue || prevVibrato != Config.vibratos.length) {
            instrument.vibratoDelay = newValue;
            instrument.vibrato = Config.vibratos.length; // Custom
            instrument.preset = instrument.type;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeVibratoType extends Change {
    constructor(doc: SongDocument, newValue: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        const oldValue: number = instrument.vibratoType;
        let prevVibrato: number = instrument.vibrato;

        doc.notifier.changed();
        if (oldValue != newValue || prevVibrato != Config.vibratos.length) {
            instrument.vibratoType = newValue;
            instrument.vibrato = Config.vibratos.length; // Custom
            instrument.preset = instrument.type;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeArpeggioSpeed extends Change {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        instrument.arpeggioSpeed = newValue;
        doc.synth.unsetMod(Config.modulators.dictionary["arp speed"].index, doc.channel, doc.getCurrentInstrument());

        doc.notifier.changed();
        if (oldValue != newValue) {
            instrument.preset = instrument.type;
            this._didSomething();
        }
    }
}

export class ChangeFastTwoNoteArp extends Change {
    constructor(doc: SongDocument, newValue: boolean) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        const oldValue = instrument.fastTwoNoteArp;

        doc.notifier.changed();
        if (oldValue != newValue) {
            instrument.fastTwoNoteArp = newValue;
            instrument.preset = instrument.type;
            this._didSomething();
        }
    }
}

export class ChangeMonophonicTone extends Change {
    constructor(doc: SongDocument, newValue: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        const oldValue = instrument.monoChordTone;

        doc.notifier.changed();
        if (oldValue != newValue) {
            instrument.monoChordTone = newValue;
            this._didSomething();
        }
    }
}

export class ChangeClicklessTransition extends Change {
    constructor(doc: SongDocument, newValue: boolean) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        const oldValue = instrument.clicklessTransition;

        doc.notifier.changed();
        if (oldValue != newValue) {
            instrument.clicklessTransition = newValue;
            instrument.preset = instrument.type;
            this._didSomething();
        }
    }
}

export class ChangeAliasing extends Change {
    constructor(doc: SongDocument, newValue: boolean) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        const oldValue = instrument.aliases;

        doc.notifier.changed();
        if (oldValue != newValue) {
            instrument.aliases = newValue;
            instrument.preset = instrument.type;
            this._didSomething();
        }
    }
}

export class ChangeSpectrum extends Change {
    constructor(doc: SongDocument, instrument: Instrument, spectrumWave: SpectrumWave) {
        super();
        spectrumWave.markCustomWaveDirty();
        instrument.preset = instrument.type;
        doc.notifier.changed();
        this._didSomething();
    }
}

export class ChangeHarmonics extends Change {
    constructor(doc: SongDocument, instrument: Instrument, harmonicsWave: HarmonicsWave) {
        super();
        harmonicsWave.markCustomWaveDirty();
        instrument.preset = instrument.type;
        doc.notifier.changed();
        this._didSomething();
    }
}

export class ChangeDrumsetEnvelope extends Change {
    constructor(doc: SongDocument, drumIndex: number, newValue: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        const oldValue: number = instrument.drumsetEnvelopes[drumIndex];
        if (oldValue != newValue) {
            instrument.drumsetEnvelopes[drumIndex] = newValue;
            instrument.preset = instrument.type;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

class ChangeInstrumentSlider extends Change {
    protected _instrument: Instrument;
    constructor(private _doc: SongDocument) {
        super();
        this._instrument = this._doc.song.channels[this._doc.channel].instruments[this._doc.getCurrentInstrument()];
    }

    public commit(): void {
        if (!this.isNoop()) {
            this._instrument.preset = this._instrument.type;
            this._doc.notifier.changed();
        }
    }
}


//for envelope mod recording
class IndexableChange extends ChangeInstrumentSlider {
    constructor(index: number, _doc: SongDocument) {
        super(_doc);
        this.index = index;
    }

    private index: number = 0;

    public getIndex(): number {
        return this.index;
    }
}

export class ChangePulseWidth extends ChangeInstrumentSlider {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super(doc);
        this._instrument.pulseWidth = newValue;
        doc.synth.unsetMod(Config.modulators.dictionary["pulse width"].index, doc.channel, doc.getCurrentInstrument());
        doc.notifier.changed();
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeDecimalOffset extends ChangeInstrumentSlider {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super(doc);
        this._instrument.decimalOffset = newValue;
        doc.synth.unsetMod(Config.modulators.dictionary["decimal offset"].index, doc.channel, doc.getCurrentInstrument());
        doc.notifier.changed();
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeSupersawDynamism extends ChangeInstrumentSlider {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super(doc);
        this._instrument.supersawDynamism = newValue;
        doc.synth.unsetMod(Config.modulators.dictionary["dynamism"].index, doc.channel, doc.getCurrentInstrument());
        doc.notifier.changed();
        if (oldValue != newValue) this._didSomething();
    }
}
export class ChangeSupersawSpread extends ChangeInstrumentSlider {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super(doc);
        this._instrument.supersawSpread = newValue;
        doc.synth.unsetMod(Config.modulators.dictionary["spread"].index, doc.channel, doc.getCurrentInstrument());
        doc.notifier.changed();
        if (oldValue != newValue) this._didSomething();
    }
}
export class ChangeSupersawShape extends ChangeInstrumentSlider {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super(doc);
        this._instrument.supersawShape = newValue;
        doc.synth.unsetMod(Config.modulators.dictionary["saw shape"].index, doc.channel, doc.getCurrentInstrument());
        doc.notifier.changed();
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangePitchShift extends ChangeInstrumentSlider {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super(doc);
        this._instrument.pitchShift = newValue;
        doc.notifier.changed();
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeDetune extends ChangeInstrumentSlider {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super(doc);
        this._instrument.detune = newValue + Config.detuneCenter;
        doc.notifier.changed();
        doc.synth.unsetMod(Config.modulators.dictionary["detune"].index, doc.channel, doc.getCurrentInstrument());
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeRingMod extends ChangeInstrumentSlider {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super(doc);
        this._instrument.ringModulation = newValue;
        doc.notifier.changed();
        doc.synth.unsetMod(Config.modulators.dictionary["ring modulation"].index, doc.channel, doc.getCurrentInstrument());
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeRingModHz extends ChangeInstrumentSlider {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super(doc);
        this._instrument.ringModulationHz = newValue;
        doc.notifier.changed();
        doc.synth.unsetMod(Config.modulators.dictionary["ring mod hertz"].index, doc.channel, doc.getCurrentInstrument());
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeRingModChipWave extends Change {
    constructor(doc: SongDocument, newValue: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        if (instrument.ringModWaveformIndex != newValue) {
            instrument.ringModWaveformIndex = newValue;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeRingModPulseWidth extends ChangeInstrumentSlider {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super(doc);
        this._instrument.ringModPulseWidth = newValue;
        doc.notifier.changed();
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeGranular extends ChangeInstrumentSlider {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super(doc);
        this._instrument.granular = newValue;
        doc.notifier.changed();
        doc.synth.unsetMod(Config.modulators.dictionary["granular"].index, doc.channel, doc.getCurrentInstrument());
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeGrainSize extends ChangeInstrumentSlider {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super(doc);
        this._instrument.grainSize = newValue;
        doc.notifier.changed();
        doc.synth.unsetMod(Config.modulators.dictionary["grain size"].index, doc.channel, doc.getCurrentInstrument());
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeGrainAmounts extends ChangeInstrumentSlider {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super(doc);
        this._instrument.grainAmounts = newValue;
        doc.notifier.changed();
        // doc.synth.unsetMod(Config.modulators.dictionary["granular"].index, doc.channel, doc.getCurrentInstrument());
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeGrainRange extends ChangeInstrumentSlider {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super(doc);
        this._instrument.grainRange = newValue;
        doc.notifier.changed();
        // doc.synth.unsetMod(Config.modulators.dictionary["grain size"].index, doc.channel, doc.getCurrentInstrument());
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeDistortion extends ChangeInstrumentSlider {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super(doc);
        this._instrument.distortion = newValue;
        doc.notifier.changed();
        doc.synth.unsetMod(Config.modulators.dictionary["distortion"].index, doc.channel, doc.getCurrentInstrument());
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeBitcrusherFreq extends ChangeInstrumentSlider {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super(doc);
        this._instrument.bitcrusherFreq = newValue;
        doc.synth.unsetMod(Config.modulators.dictionary["bit crush"].index, doc.channel, doc.getCurrentInstrument());
        doc.notifier.changed();
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeBitcrusherQuantization extends ChangeInstrumentSlider {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super(doc);
        doc.synth.unsetMod(Config.modulators.dictionary["freq crush"].index, doc.channel, doc.getCurrentInstrument());
        this._instrument.bitcrusherQuantization = newValue;
        doc.notifier.changed();
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeStringSustain extends ChangeInstrumentSlider {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super(doc);
        this._instrument.stringSustain = newValue;
        doc.synth.unsetMod(Config.modulators.dictionary["sustain"].index, doc.channel, doc.getCurrentInstrument());
        doc.notifier.changed();
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeStringSustainType extends Change {
    constructor(doc: SongDocument, newValue: SustainType) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        const oldValue: SustainType = instrument.stringSustainType;
        if (oldValue != newValue) {
            instrument.stringSustainType = newValue;
            instrument.preset = instrument.type;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeEQFilterType extends Change {
    constructor(doc: SongDocument, instrument: Instrument, newValue: boolean) {
        super();
        instrument.eqFilterType = newValue;
        if (newValue == true) { // To Simple - clear eq filter
            instrument.eqFilter.reset();
            instrument.tmpEqFilterStart = instrument.eqFilter;
            instrument.tmpEqFilterEnd = null;
        }
        else {
            // To Advanced - convert filter
            instrument.eqFilter.convertLegacySettings(instrument.eqFilterSimpleCut, instrument.eqFilterSimplePeak, Config.envelopes.dictionary["none"]);
            instrument.tmpEqFilterStart = instrument.eqFilter;
            instrument.tmpEqFilterEnd = null;
        }
        instrument.clearInvalidEnvelopeTargets();
        instrument.preset = instrument.type;
        doc.notifier.changed();
        this._didSomething();
    }
}

export class ChangeNoteFilterType extends Change {
    constructor(doc: SongDocument, instrument: Instrument, newValue: boolean) {
        super();
        instrument.noteFilterType = newValue;
        if (newValue == true) { // To Simple - clear note filter, kill modulators
            instrument.noteFilter.reset();
            instrument.tmpNoteFilterStart = instrument.noteFilter;
            instrument.tmpNoteFilterEnd = null;
        }
        else {
            // To Advanced - convert filter, kill modulators
            instrument.noteFilter.convertLegacySettings(instrument.noteFilterSimpleCut, instrument.noteFilterSimplePeak, Config.envelopes.dictionary["none"]);
            instrument.tmpNoteFilterStart = instrument.noteFilter;
            instrument.tmpNoteFilterEnd = null;
        }
        instrument.clearInvalidEnvelopeTargets();
        instrument.preset = instrument.type;
        doc.notifier.changed();
        this._didSomething();
    }
}

export class ChangeEQFilterSimpleCut extends ChangeInstrumentSlider {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super(doc);
        this._instrument.eqFilterSimpleCut = newValue;
        doc.synth.unsetMod(Config.modulators.dictionary["eq filt cut"].index, doc.channel, doc.getCurrentInstrument());
        doc.notifier.changed();
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeEQFilterSimplePeak extends ChangeInstrumentSlider {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super(doc);
        this._instrument.eqFilterSimplePeak = newValue;
        doc.synth.unsetMod(Config.modulators.dictionary["eq filt peak"].index, doc.channel, doc.getCurrentInstrument());
        doc.notifier.changed();
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeNoteFilterSimpleCut extends ChangeInstrumentSlider {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super(doc);
        this._instrument.noteFilterSimpleCut = newValue;
        doc.synth.unsetMod(Config.modulators.dictionary["note filt cut"].index, doc.channel, doc.getCurrentInstrument());
        doc.notifier.changed();
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeNoteFilterSimplePeak extends ChangeInstrumentSlider {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super(doc);
        this._instrument.noteFilterSimplePeak = newValue;
        doc.synth.unsetMod(Config.modulators.dictionary["note filt peak"].index, doc.channel, doc.getCurrentInstrument());
        doc.notifier.changed();
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeSongFilterAddPoint extends UndoableChange {
    private _doc: SongDocument;
    private _filterSettings: FilterSettings;
    private _point: FilterControlPoint;
    private _index: number;
    constructor(doc: SongDocument, filterSettings: FilterSettings, point: FilterControlPoint, index: number, deletion: boolean = false) {
            super(deletion);
            this._doc = doc;
            this._filterSettings = filterSettings;
            this._point = point;
            this._index = index;
    
                this._didSomething();
            this.redo();
        }

        protected _doForwards(): void {
this._filterSettings.controlPoints.splice(this._index, 0, this._point);
        this._filterSettings.controlPointCount++;
        this._filterSettings.controlPoints.length = this._filterSettings.controlPointCount;
        this._doc.song.tmpEqFilterStart = this._doc.song.eqFilter;
        this._doc.song.tmpEqFilterEnd = null;
        this._doc.notifier.changed();
    }

    protected _doBackwards(): void {
this._filterSettings.controlPoints.splice(this._index, 1);
        this._filterSettings.controlPointCount--;
        this._filterSettings.controlPoints.length = this._filterSettings.controlPointCount;
        this._doc.song.tmpEqFilterStart = this._doc.song.eqFilter;
        this._doc.song.tmpEqFilterEnd = null;
        this._doc.notifier.changed();
    }
}

export class ChangeFilterAddPoint extends UndoableChange {
    private _doc: SongDocument;
    private _instrument: Instrument;
    private _instrumentPrevPreset: number;
    private _instrumentNextPreset: number;
    private _filterSettings: FilterSettings;
    private _point: FilterControlPoint;
    private _index: number;
    private _envelopeTargetsAdd: number[] = [];
    private _envelopeIndicesAdd: number[] = [];
    private _envelopeTargetsRemove: number[] = [];
    private _envelopeIndicesRemove: number[] = [];
    constructor(doc: SongDocument, filterSettings: FilterSettings, point: FilterControlPoint, index: number, isNoteFilter: boolean, deletion: boolean = false) {
        super(deletion);
        this._doc = doc;
        this._instrument = this._doc.song.channels[this._doc.channel].instruments[this._doc.getCurrentInstrument()];
        this._instrumentNextPreset = deletion ? this._instrument.preset : this._instrument.type;
        this._instrumentPrevPreset = deletion ? this._instrument.type : this._instrument.preset;
        this._filterSettings = filterSettings;
        this._point = point;
        this._index = index;

        for (let envelopeIndex: number = 0; envelopeIndex < this._instrument.envelopeCount; envelopeIndex++) {
            let target: number = this._instrument.envelopes[envelopeIndex].target;
            let targetIndex: number = this._instrument.envelopes[envelopeIndex].index;
            this._envelopeTargetsAdd.push(target);
            this._envelopeIndicesAdd.push(targetIndex);
            if (deletion) {
                // When deleting a filter control point, find all envelopes that targeted that
                // point and clear them, and all envelopes that targeted later points and
                // decrement those to keep them in sync with the new list of points.
                const automationTarget: AutomationTarget = Config.instrumentAutomationTargets[target];
                if (automationTarget.isFilter && (automationTarget.effect == EffectType.noteFilter) == isNoteFilter) {
                    if (automationTarget.maxCount == Config.filterMaxPoints) {
                        if (targetIndex == index) {
                            target = Config.instrumentAutomationTargets.dictionary["none"].index;
                            targetIndex = 0;
                        } else if (targetIndex > index) {
                            targetIndex--;
                        }
                    } else {
                        if (filterSettings.controlPointCount <= 1) {
                            target = Config.instrumentAutomationTargets.dictionary["none"].index;
                            targetIndex = 0;
                        }
                    }
                }
            }
            this._envelopeTargetsRemove.push(target);
            this._envelopeIndicesRemove.push(targetIndex);
        }

        this._didSomething();
        this.redo();
    }

    protected _doForwards(): void {
        this._filterSettings.controlPoints.splice(this._index, 0, this._point);
        this._filterSettings.controlPointCount++;
        this._filterSettings.controlPoints.length = this._filterSettings.controlPointCount;
        this._instrument.preset = this._instrumentNextPreset;
        for (let envelopeIndex: number = 0; envelopeIndex < this._instrument.envelopeCount; envelopeIndex++) {
            this._instrument.envelopes[envelopeIndex].target = this._envelopeTargetsAdd[envelopeIndex];
            this._instrument.envelopes[envelopeIndex].index = this._envelopeIndicesAdd[envelopeIndex];
        }
        this._instrument.tmpEqFilterStart = this._instrument.eqFilter;
        this._instrument.tmpEqFilterEnd = null;
        this._instrument.tmpNoteFilterStart = this._instrument.noteFilter;
        this._instrument.tmpNoteFilterEnd = null;
        this._doc.notifier.changed();
    }

    protected _doBackwards(): void {
        this._filterSettings.controlPoints.splice(this._index, 1);
        this._filterSettings.controlPointCount--;
        this._filterSettings.controlPoints.length = this._filterSettings.controlPointCount;
        this._instrument.preset = this._instrumentPrevPreset;
        for (let envelopeIndex: number = 0; envelopeIndex < this._instrument.envelopeCount; envelopeIndex++) {
            this._instrument.envelopes[envelopeIndex].target = this._envelopeTargetsRemove[envelopeIndex];
            this._instrument.envelopes[envelopeIndex].index = this._envelopeIndicesRemove[envelopeIndex];
        }
        this._instrument.tmpEqFilterStart = this._instrument.eqFilter;
        this._instrument.tmpEqFilterEnd = null;
        this._instrument.tmpNoteFilterStart = this._instrument.noteFilter;
        this._instrument.tmpNoteFilterEnd = null;
        this._doc.notifier.changed();
    }
}

export class FilterMoveData {
    public point: FilterControlPoint;
    public freq: number;
    public gain: number;

    constructor(usePoint: FilterControlPoint, useFreq: number, useGain: number) {
        this.point = usePoint;
        this.freq = useFreq;
        this.gain = useGain;
    }
}

export class ChangeSongFilterMovePoint extends UndoableChange {
    private _doc: SongDocument;
    private _point: FilterControlPoint;
    private _oldFreq: number;
    private _newFreq: number;
    private _oldGain: number;
    private _newGain: number;
    public pointIndex: number;
    public pointType: FilterType;
    constructor(doc: SongDocument, point: FilterControlPoint, oldFreq: number, newFreq: number, oldGain: number, newGain: number, pointIndex: number) {
            super(false);
            this._doc = doc;
            this._point = point;
            this._oldFreq = oldFreq;
            this._newFreq = newFreq;
            this._oldGain = oldGain;
            this._newGain = newGain;
            this.pointIndex = pointIndex;
            this.pointType = point.type;
            this._didSomething();
            this.redo();
        }

        public getMoveData(beforeChange: boolean): FilterMoveData {
            if (beforeChange) {
                    return new FilterMoveData(this._point, this._oldFreq, this._oldGain);
                }
            return new FilterMoveData(this._point, this._newFreq, this._newGain);
        }

        protected _doForwards(): void {
 this._point.freq = this._newFreq;
        this._point.gain = this._newGain;
        this._doc.notifier.changed();
    }

        protected _doBackwards(): void {
 this._point.freq = this._oldFreq;
        this._point.gain = this._oldGain;
        this._doc.notifier.changed();
    }
}

export class ChangeFilterMovePoint extends UndoableChange {
    private _doc: SongDocument;
    private _instrument: Instrument;
    private _instrumentPrevPreset: number;
    private _instrumentNextPreset: number;
    private _point: FilterControlPoint;
    private _oldFreq: number;
    private _newFreq: number;
    private _oldGain: number;
    private _newGain: number;
    public useNoteFilter: boolean;
    public pointIndex: number;
    public pointType: FilterType;
    constructor(doc: SongDocument, point: FilterControlPoint, oldFreq: number, newFreq: number, oldGain: number, newGain: number, useNoteFilter: boolean, pointIndex: number) {
        super(false);
        this._doc = doc;
        this._instrument = this._doc.song.channels[this._doc.channel].instruments[this._doc.getCurrentInstrument()];
        this._instrumentNextPreset = this._instrument.type;
        this._instrumentPrevPreset = this._instrument.preset;
        this._point = point;
        this._oldFreq = oldFreq;
        this._newFreq = newFreq;
        this._oldGain = oldGain;
        this._newGain = newGain;
        this.useNoteFilter = useNoteFilter;
        this.pointIndex = pointIndex;
        this.pointType = point.type;
        this._didSomething();
        this.redo();
    }

    public getMoveData(beforeChange: boolean): FilterMoveData {
        if (beforeChange) {
            return new FilterMoveData(this._point, this._oldFreq, this._oldGain);
        }
        return new FilterMoveData(this._point, this._newFreq, this._newGain);
    }

    protected _doForwards(): void {
        this._point.freq = this._newFreq;
        this._point.gain = this._newGain;
        this._instrument.preset = this._instrumentNextPreset;
        this._doc.notifier.changed();
    }

    protected _doBackwards(): void {
        this._point.freq = this._oldFreq;
        this._point.gain = this._oldGain;
        this._instrument.preset = this._instrumentPrevPreset;
        this._doc.notifier.changed();
    }
}

export class ChangeSongFilterSettings extends UndoableChange {
    private _doc: SongDocument;
    private _filterSettings: FilterSettings;
    private _subFilters: (FilterSettings | null)[];
    private _oldSubFilters: (FilterSettings | null)[];
    private _oldSettings: FilterSettings;
    
    constructor(doc: SongDocument, settings: FilterSettings, oldSettings: FilterSettings, subFilters: (FilterSettings | null)[] | null = null, oldSubFilters: (FilterSettings | null)[] | null = null) {
        super(false);
        this._doc = doc;
        this._oldSettings = oldSettings;
        this._filterSettings = settings;
        if (subFilters != null && oldSubFilters != null) {
                this._subFilters = subFilters;
                this._oldSubFilters = oldSubFilters;
            }
        this._didSomething();
        this.redo();
    }

    protected _doForwards(): void {
        this._doc.song.eqFilter = this._filterSettings;
        if (this._subFilters != null)
                this._doc.song.eqSubFilters = this._subFilters;
        this._doc.song.tmpEqFilterStart = this._doc.song.eqFilter;
        this._doc.song.tmpEqFilterEnd = null;

            this._doc.notifier.changed();
    }

    protected _doBackwards(): void {
        this._doc.song.eqFilter = this._oldSettings;
        if (this._oldSubFilters != null)
                this._doc.song.eqSubFilters = this._oldSubFilters;
        this._doc.song.tmpEqFilterStart = this._doc.song.eqFilter;
        this._doc.song.tmpEqFilterEnd = null;
        this._doc.notifier.changed();
    }
}

export class ChangeFilterSettings extends UndoableChange {
    private _doc: SongDocument;
    private _instrument: Instrument;
    private _instrumentPrevPreset: number;
    private _instrumentNextPreset: number;
    private _filterSettings: FilterSettings;
    private _subFilters: (FilterSettings | null)[];
    private _oldSubFilters: (FilterSettings | null)[];
    private _oldSettings: FilterSettings;
    private _useNoteFilter: boolean;
    constructor(doc: SongDocument, settings: FilterSettings, oldSettings: FilterSettings, useNoteFilter: boolean, subFilters: (FilterSettings | null)[] | null = null, oldSubFilters: (FilterSettings | null)[] | null = null) {
        super(false);
        this._doc = doc;
        this._instrument = this._doc.song.channels[this._doc.channel].instruments[this._doc.getCurrentInstrument()];
        this._instrumentNextPreset = this._instrument.type;
        this._instrumentPrevPreset = this._instrument.preset;
        this._oldSettings = oldSettings;
        this._useNoteFilter = useNoteFilter;
        this._filterSettings = settings;
        if (subFilters != null && oldSubFilters != null) {
            this._subFilters = subFilters;
            this._oldSubFilters = oldSubFilters;
        }
        this._instrument.clearInvalidEnvelopeTargets();
        this._didSomething();
        this.redo();
    }

    protected _doForwards(): void {

        if (this._useNoteFilter) {
            this._instrument.noteFilter = this._filterSettings;
            if (this._subFilters != null)
                this._instrument.noteSubFilters = this._subFilters;
            this._instrument.tmpNoteFilterStart = this._instrument.noteFilter;
            this._instrument.tmpNoteFilterEnd = null;
        } else {
            this._instrument.eqFilter = this._filterSettings;
            if (this._subFilters != null)
                this._instrument.eqSubFilters = this._subFilters;
            this._instrument.tmpEqFilterStart = this._instrument.eqFilter;
            this._instrument.tmpEqFilterEnd = null;
        }

        this._instrument.preset = this._instrumentNextPreset;
        this._instrument.clearInvalidEnvelopeTargets();
        this._doc.notifier.changed();
    }

    protected _doBackwards(): void {
        if (this._useNoteFilter) {
            this._instrument.noteFilter = this._oldSettings;
            if (this._oldSubFilters != null)
                this._instrument.noteSubFilters = this._oldSubFilters;
            this._instrument.tmpNoteFilterStart = this._instrument.noteFilter;
            this._instrument.tmpNoteFilterEnd = null;
        } else {
            this._instrument.eqFilter = this._oldSettings;
            if (this._oldSubFilters != null)
                this._instrument.eqSubFilters = this._oldSubFilters;
            this._instrument.tmpEqFilterStart = this._instrument.eqFilter;
            this._instrument.tmpEqFilterEnd = null;
        }
        this._instrument.preset = this._instrumentPrevPreset;
        this._instrument.clearInvalidEnvelopeTargets();
        this._doc.notifier.changed();
    }
}

export class ChangeFadeInOut extends UndoableChange {
    private _doc: SongDocument;
    private _instrument: Instrument;
    private _instrumentPrevPreset: number;
    private _instrumentNextPreset: number;
    private _oldFadeIn: number;
    private _oldFadeOut: number;
    private _newFadeIn: number;
    private _newFadeOut: number;
    constructor(doc: SongDocument, fadeIn: number, fadeOut: number) {
        super(false);
        this._doc = doc;
        this._instrument = this._doc.song.channels[this._doc.channel].instruments[this._doc.getCurrentInstrument()];
        this._instrumentNextPreset = this._instrument.type;
        this._instrumentPrevPreset = this._instrument.preset;
        this._oldFadeIn = this._instrument.fadeIn;
        this._oldFadeOut = this._instrument.fadeOut;
        this._newFadeIn = fadeIn;
        this._newFadeOut = fadeOut;
        this._didSomething();
        this.redo();
    }

    protected _doForwards(): void {
        this._instrument.fadeIn = this._newFadeIn;
        this._instrument.fadeOut = this._newFadeOut;
        this._instrument.preset = this._instrumentNextPreset;
        this._doc.notifier.changed();
    }

    protected _doBackwards(): void {
        this._instrument.fadeIn = this._oldFadeIn;
        this._instrument.fadeOut = this._oldFadeOut;
        this._instrument.preset = this._instrumentPrevPreset;
        this._doc.notifier.changed();
    }
}

export class ChangeAlgorithm extends Change {
    constructor(doc: SongDocument, newValue: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        const oldValue: number = instrument.algorithm;
        if (oldValue != newValue) {
            instrument.algorithm = newValue;
            instrument.preset = instrument.type;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeFeedbackType extends Change {
    constructor(doc: SongDocument, newValue: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        const oldValue: number = instrument.feedbackType;
        if (oldValue != newValue) {
            instrument.feedbackType = newValue;
            instrument.preset = instrument.type;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}


export class Change6OpAlgorithm extends Change {
    constructor(doc: SongDocument, newValue: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        const oldValue: number = instrument.algorithm6Op;
        if (oldValue != newValue) {
            instrument.algorithm6Op = newValue;
            if (newValue != 0) {
                instrument.customAlgorithm.fromPreset(newValue);
            }
            instrument.preset = instrument.type;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class Change6OpFeedbackType extends Change {
    constructor(doc: SongDocument, newValue: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        const oldValue: number = instrument.feedbackType6Op;
        if (oldValue != newValue) {
            instrument.feedbackType6Op = newValue;
            if (newValue != 0) {
                instrument.customFeedbackType.fromPreset(newValue);
            }
            instrument.preset = instrument.type;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeOperatorWaveform extends Change {
    constructor(doc: SongDocument, operatorIndex: number, newValue: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        const oldValue: number = instrument.operators[operatorIndex].waveform;
        if (oldValue != newValue) {
            instrument.operators[operatorIndex].waveform = newValue;
            instrument.preset = instrument.type;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeOperatorPulseWidth extends Change {
    constructor(doc: SongDocument, operatorIndex: number, oldValue: number, newValue: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        instrument.operators[operatorIndex].pulseWidth = newValue;
        doc.notifier.changed();
        if (oldValue != newValue) {
            instrument.preset = instrument.type;
            this._didSomething();
        }
    }
}

export class ChangeOperatorFrequency extends Change {
    constructor(doc: SongDocument, operatorIndex: number, newValue: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        const oldValue: number = instrument.operators[operatorIndex].frequency;
        if (oldValue != newValue) {
            instrument.operators[operatorIndex].frequency = newValue;
            instrument.preset = instrument.type;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeOperatorAmplitude extends ChangeInstrumentSlider {
    public operatorIndex: number = 0;
    constructor(doc: SongDocument, operatorIndex: number, oldValue: number, newValue: number) {
        super(doc);
        this.operatorIndex = operatorIndex;
        this._instrument.operators[operatorIndex].amplitude = newValue;
        // Not used currently as mod is implemented as multiplicative
        //doc.synth.unsetMod(ModSetting.mstFMSlider1 + operatorIndex, doc.channel, doc.getCurrentInstrument());
        doc.notifier.changed();
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeFeedbackAmplitude extends ChangeInstrumentSlider {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super(doc);
        this._instrument.feedbackAmplitude = newValue;
        // Not used currently as mod is implemented as multiplicative
        //doc.synth.unsetMod(ModSetting.mstFMFeedback, doc.channel, doc.getCurrentInstrument());
        doc.notifier.changed();
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeAddChannelInstrument extends Change {
    constructor(doc: SongDocument) {
        super();
        const channel: Channel = doc.song.channels[doc.channel];
        const isNoise: boolean = doc.song.getChannelIsNoise(doc.channel);
        const isMod: boolean = doc.song.getChannelIsMod(doc.channel);
        const maxInstruments: number = doc.song.getMaxInstrumentsPerChannel();
        if (channel.instruments.length >= maxInstruments) return;
        const presetValue: number = pickRandomPresetValue(isNoise);
        const preset: Preset = EditorConfig.valueToPreset(presetValue)!;
        const instrument: Instrument = new Instrument(isNoise, isMod);
        instrument.fromJsonObject(preset.settings, isNoise, isMod, false, false, 1);
        instrument.preset = presetValue;
        instrument.effects |= 1 << EffectType.panning;
        instrument.volume = 0;
        channel.instruments.push(instrument);
        if (!isMod) { // Mod channels lose information when changing set instrument
            doc.viewedInstrument[doc.channel] = channel.instruments.length - 1;
        }

        // Determine if any mod instruments were setting 'all' or 'active'. If so, bump indices since there is now a new instrument in the list.
        for (let channelIndex: number = doc.song.pitchChannelCount + doc.song.noiseChannelCount; channelIndex < doc.song.getChannelCount(); channelIndex++) {
            for (let instrumentIndex: number = 0; instrumentIndex < doc.song.channels[channelIndex].instruments.length; instrumentIndex++) {
                for (let mod: number = 0; mod < Config.modCount; mod++) {

                    let instrument: Instrument = doc.song.channels[channelIndex].instruments[instrumentIndex];
                    let modInstrument: number = instrument.modInstruments[mod];
                    let modChannel: number = instrument.modChannels[mod];

                    if (modChannel == doc.channel && modInstrument >= doc.song.channels[modChannel].instruments.length - 1) {
                        //BUGFIX FROM JUMMBOX
                        instrument.modInstruments[mod]++;
                    }
                }
            }
        }
        // Also, make synth re-compute mod values, since 'all'/'active' mods now retroactively apply to this new instrument.
        doc.synth.computeLatestModValues();

        doc.notifier.changed();
        this._didSomething();
    }
}

export class ChangeRemoveChannelInstrument extends Change {
    constructor(doc: SongDocument) {
        super();
        const channel: Channel = doc.song.channels[doc.channel];
        if (channel.instruments.length <= Config.instrumentCountMin) return;
        const removedIndex: number = doc.viewedInstrument[doc.channel];
        channel.instruments.splice(removedIndex, 1);
        if (doc.song.patternInstruments) {
            for (const pattern of channel.patterns) {
                for (let i: number = 0; i < pattern.instruments.length; i++) {
                    if (pattern.instruments[i] == removedIndex) {
                        pattern.instruments.splice(i, 1);
                        i--;
                    } else if (pattern.instruments[i] > removedIndex) {
                        pattern.instruments[i]--;
                    }
                }
                if (pattern.instruments.length <= 0) {
                    pattern.instruments[0] = 0;
                }
            }
        }

        // Determine if any mod instruments now refer to an invalid instrument number. Unset them if so
        for (let channelIndex: number = doc.song.pitchChannelCount + doc.song.noiseChannelCount; channelIndex < doc.song.getChannelCount(); channelIndex++) {
            for (let instrumentIdx: number = 0; instrumentIdx < doc.song.channels[channelIndex].instruments.length; instrumentIdx++) {
                for (let mod: number = 0; mod < Config.modCount; mod++) {

                    let instrument: Instrument = doc.song.channels[channelIndex].instruments[instrumentIdx];
                    let modInstrument: number = instrument.modInstruments[mod];
                    let modChannel: number = instrument.modChannels[mod];

                    if (modChannel == doc.channel) {
                        // Boundary checking - check if setting was 'all' or 'active' previously
                        if (modInstrument > removedIndex) {
                            instrument.modInstruments[mod]--;
                        }
                        // Boundary checking - check if setting was set to the last instrument before splice
                        else if (modInstrument == removedIndex) {
                            instrument.modInstruments[mod] = 0;
                            instrument.modulators[mod] = 0;
                        }
                    }

                }
            }
        }

        doc.notifier.changed();
        this._didSomething();
    }
}

export class ChangeViewInstrument extends Change {
    constructor(doc: SongDocument, index: number) {
        super();
        if (doc.viewedInstrument[doc.channel] != index) {
            doc.viewedInstrument[doc.channel] = index;
            if (doc.channel >= doc.song.pitchChannelCount + doc.song.noiseChannelCount)
                doc.recentPatternInstruments[doc.channel] = [index];
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeInstrumentsFlags extends Change {
    constructor(doc: SongDocument, newLayeredInstruments: boolean, newPatternInstruments: boolean) {
        super();
        const oldLayeredInstruments: boolean = doc.song.layeredInstruments;
        const oldPatternInstruments: boolean = doc.song.patternInstruments;
        if (oldLayeredInstruments == newLayeredInstruments && oldPatternInstruments == newPatternInstruments) return;
        doc.song.layeredInstruments = newLayeredInstruments;
        doc.song.patternInstruments = newPatternInstruments;

        for (let channelIndex: number = 0; channelIndex < doc.song.getChannelCount(); channelIndex++) {
            const channel: Channel = doc.song.channels[channelIndex];
            if (channel.instruments.length > doc.song.getMaxInstrumentsPerChannel()) {
                channel.instruments.length = doc.song.getMaxInstrumentsPerChannel();
            }
            for (let j: number = 0; j < doc.song.patternsPerChannel; j++) {
                const pattern: Pattern = channel.patterns[j];
                if (!oldPatternInstruments && newPatternInstruments) {
                    // patternInstruments was enabled, set up pattern instruments as appropriate.
                    for (let i: number = 0; i < channel.instruments.length; i++) {
                        pattern.instruments[i] = i;
                    }
                    pattern.instruments.length = channel.instruments.length;
                }
                discardInvalidPatternInstruments(pattern.instruments, doc.song, channelIndex);
            }
        }



        doc.notifier.changed();
        this._didSomething();
    }
}


export class ChangeKey extends Change {
    constructor(doc: SongDocument, newValue: number) {
        super();
        if (doc.song.key != newValue) {
            doc.song.key = newValue;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeLoop extends Change {
    constructor(private _doc: SongDocument, public oldStart: number, public oldLength: number, public newStart: number, public newLength: number) {
        super();
        this._doc.song.loopStart = this.newStart;
        this._doc.song.loopLength = this.newLength;
        this._doc.notifier.changed();
        if (this.oldStart != this.newStart || this.oldLength != this.newLength) {
            this._didSomething();
        }
    }
}

export class ChangePitchAdded extends UndoableChange {
    private _doc: SongDocument;
    private _note: Note;
    private _pitch: number;
    private _index: number;
    constructor(doc: SongDocument, note: Note, pitch: number, index: number, deletion: boolean = false) {
        super(deletion);
        this._doc = doc;
        this._note = note;
        this._pitch = pitch;
        this._index = index;
        this._didSomething();
        this.redo();
    }

    protected _doForwards(): void {
        this._note.pitches.splice(this._index, 0, this._pitch);
        this._doc.notifier.changed();
    }

    protected _doBackwards(): void {
        this._note.pitches.splice(this._index, 1);
        this._doc.notifier.changed();
    }
}

export class ChangeOctave extends Change {
    constructor(doc: SongDocument, public oldValue: number, newValue: number) {
        super();
        doc.song.channels[doc.channel].octave = newValue;
        doc.notifier.changed();
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeRhythm extends ChangeGroup {
    constructor(doc: SongDocument, newValue: number) {
        super();

        if (doc.song.rhythm != newValue) {
            doc.song.rhythm = newValue;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangePaste extends ChangeGroup {
    constructor(doc: SongDocument, pattern: Pattern, notes: any[], selectionStart: number, selectionEnd: number, oldPartDuration: number) {
        super();

        // Erase the current contents of the selection:
        this.append(new ChangeNoteTruncate(doc, pattern, selectionStart, selectionEnd, null, true));

        // Mods don't follow this sequence, so skipping for now.
        let noteInsertionIndex: number = 0;
        if (!doc.song.getChannelIsMod(doc.channel)) {
            for (let i: number = 0; i < pattern.notes.length; i++) {
                if (pattern.notes[i].start < selectionStart) {
                    if (pattern.notes[i].end > selectionStart) throw new Error();

                    noteInsertionIndex = i + 1;
                } else if (pattern.notes[i].start < selectionEnd) {
                    throw new Error();
                }
            }
        }
        else {
            noteInsertionIndex = pattern.notes.length;
        }

        while (selectionStart < selectionEnd) {
            for (const noteObject of notes) {
                const noteStart: number = noteObject["start"] + selectionStart;
                const noteEnd: number = noteObject["end"] + selectionStart;
                if (noteStart >= selectionEnd) break;
                const note: Note = new Note(noteObject["pitches"][0], noteStart, noteEnd, noteObject["pins"][0]["size"], false);
                note.pitches.length = 0;
                for (const pitch of noteObject["pitches"]) {
                    note.pitches.push(pitch);
                }
                note.pins.length = 0;
                for (const pin of noteObject["pins"]) {
                    note.pins.push(makeNotePin(pin.interval, pin.time, pin.size));
                }
                note.continuesLastPattern = (noteObject["continuesLastPattern"] === true) && (note.start == 0);
                pattern.notes.splice(noteInsertionIndex++, 0, note);
                if (note.end > selectionEnd) {
                    this.append(new ChangeNoteLength(doc, note, note.start, selectionEnd));
                }
            }

            selectionStart += oldPartDuration;
        }

        // Need to re-sort the notes by start time as they might change order because of paste.
        if (pattern != null && doc.song.getChannelIsMod(doc.channel)) pattern.notes.sort(function (a, b) { return (a.start == b.start) ? a.pitches[0] - b.pitches[0] : a.start - b.start; });


        doc.notifier.changed();
        this._didSomething();
    }
}

export class ChangePasteInstrument extends ChangeGroup {
    constructor(doc: SongDocument, instrument: Instrument, instrumentCopy: any) {
        super();
        instrument.fromJsonObject(instrumentCopy, instrumentCopy["isDrum"], instrumentCopy["isMod"], false, false);
        doc.notifier.changed();
        this._didSomething();
    }
}

export class ChangePasteInstrumentEditSelective extends ChangeGroup {
    constructor(doc: SongDocument, instrumentCopy: any, instrumentCopies: any[], savedInstrumentNumbers?: number[] | undefined) {
        super();
        const selectivePaste = doc.prefs.selectivePaste;
        //switch instrument before advanced pasting
        if (doc.song.patternInstruments && selectivePaste.instrumentPatterns && savedInstrumentNumbers) {
            for (let i: number = 0; i < Config.patternInstrumentCountMax; i++) {
                const change = doc.selection.setInstrumentNumbers(savedInstrumentNumbers);
                if (change) this.append(change);
            }
        }
        const channel: Channel = doc.song.channels[doc.channel];

        //select how many / which instruments we should paste. If We're doing instrumentPatterns we should only paste instruments from those patterns
        //if we're doing all instruments then we can paste them all. Otherwise, just do the one we have highlighted
        const instrumentNumbers: number[] = selectivePaste.allInstruments && (doc.song.patternInstruments || doc.song.layeredInstruments) ?
            (selectivePaste.instrumentPatterns && doc.song.patternInstruments && savedInstrumentNumbers ?
            savedInstrumentNumbers :
            new Array(instrumentCopies.length).fill(0).map((_, i) => i)) :
            [doc.getCurrentInstrument()];
        
        const instrumentPaste = new Instrument(instrumentCopy["isDrum"], instrumentCopy["isMod"])
        instrumentPaste.fromJsonObject(instrumentCopy, instrumentCopy["isDrum"], instrumentCopy["isMod"], false, false);

        for (const index of instrumentNumbers) {
            if (selectivePaste.allInstruments && (doc.song.patternInstruments || doc.song.layeredInstruments)) {
                console.log(instrumentCopies[index], index);
                instrumentPaste.fromJsonObject(instrumentCopies[index], instrumentCopies[index]["isDrum"], instrumentCopies[index]["isMod"], false, false);
            }
            //if we're pasting more instruments than we have, just add it to the end of the list
            if (index >= channel.instruments.length) {
                this.append(new ChangeAppendInstrument(doc, channel, instrumentCopies[index]));
                continue;
            }
            const instrument: Instrument = channel.instruments[index];
            if (selectivePaste.instrumentType) this.append(new ChangePreset(doc, instrumentPaste.type));
            if (selectivePaste.instrumentTypeSettings && instrument.type == instrumentPaste.type) {
                switch (instrument.type) {
                    case InstrumentType.chip:
                        instrument.chipWave = instrumentPaste.chipWave;
                        instrument.isUsingAdvancedLoopControls = instrumentPaste.isUsingAdvancedLoopControls;
                        instrument.chipWaveLoopStart = instrumentPaste.chipWaveLoopStart;
                        instrument.chipWaveLoopEnd = instrumentPaste.chipWaveLoopEnd;
                        instrument.chipWaveLoopMode = instrumentPaste.chipWaveLoopMode;
                        instrument.chipWavePlayBackwards = instrumentPaste.chipWavePlayBackwards;
                        instrument.chipWaveStartOffset = instrumentPaste.chipWaveStartOffset;
                        break;
                    case InstrumentType.customChipWave:
                        instrument.chipWave = instrumentPaste.chipWave;
                        instrument.customChipWave = instrumentPaste.customChipWave.slice();
                        instrument.customChipWaveIntegral = instrumentPaste.customChipWaveIntegral.slice();
                        break;
                    case InstrumentType.fm:
                        instrument.algorithm = instrumentPaste.algorithm;
                        instrument.feedbackType = instrumentPaste.feedbackType;
                        instrument.feedbackAmplitude = instrumentPaste.feedbackAmplitude;
                        for (let i: number = 0; i < instrument.operators.length; i++) {
                            instrument.operators[i].copy(instrumentPaste.operators[i]);
                        }
                        break;
                    case InstrumentType.fm6op:
                        instrument.algorithm6Op = instrumentPaste.algorithm6Op;
                        instrument.feedbackType6Op = instrumentPaste.feedbackType6Op;
                        instrument.customAlgorithm.copy(instrumentPaste.customAlgorithm)
                        instrument.feedbackAmplitude = instrumentPaste.feedbackAmplitude;
                        for (let i: number = 0; i < instrument.operators.length; i++) {
                            instrument.operators[i].copy(instrumentPaste.operators[i]);
                        }
                        break;
                    case InstrumentType.noise:
                        instrument.chipNoise = instrumentPaste.chipNoise;
                        break;
                    case InstrumentType.spectrum:
                        instrument.spectrumWave.spectrum = instrumentPaste.spectrumWave.spectrum.slice();
                        instrument.spectrumWave.markCustomWaveDirty();
                        break;
                    case InstrumentType.drumset:
                        for (let i: number = 0; i < Config.drumCount; i++) {
                            instrument.drumsetEnvelopes[i] = instrumentPaste.drumsetEnvelopes[i];
                            if (instrument.drumsetSpectrumWaves[i] == undefined) {
                                instrument.drumsetSpectrumWaves[i] = new SpectrumWave(true);
                            }
                            instrument.drumsetSpectrumWaves[i].spectrum = instrumentPaste.drumsetSpectrumWaves[i].spectrum.slice();
                            instrument.drumsetSpectrumWaves[i].markCustomWaveDirty();
                        }
                        break;
                    case InstrumentType.harmonics:
                        instrument.harmonicsWave.harmonics = instrumentPaste.harmonicsWave.harmonics;
                        instrument.harmonicsWave.markCustomWaveDirty();
                        break;
                    case InstrumentType.pwm:
                        instrument.pulseWidth = instrumentPaste.stringSustain;
                        instrument.decimalOffset = instrumentPaste.decimalOffset;
                        break;
                    case InstrumentType.pickedString:
                        instrument.harmonicsWave.harmonics = instrumentPaste.harmonicsWave.harmonics;
                        instrument.harmonicsWave.markCustomWaveDirty();
                        instrument.stringSustain = instrumentPaste.stringSustain;
                        break;
                    case InstrumentType.mod:
                        //all of the instrument settings for mod channels are type dependent, so just paste the whole instrument
                        this.append(new ChangePasteInstrument(doc, instrument, instrumentCopy));
                        doc.notifier.changed();
                        this._didSomething();
                        return;
                    case InstrumentType.supersaw:
                        instrument.supersawDynamism = instrumentPaste.supersawDynamism;
                        instrument.supersawSpread = instrumentPaste.supersawSpread;
                        instrument.supersawShape = instrumentPaste.supersawShape;
                        instrument.pulseWidth = instrumentPaste.pulseWidth;
                        instrument.decimalOffset = instrumentPaste.decimalOffset;
                        break;
                }
            }
            if (selectivePaste.eqFilter) {
                instrument.eqFilterType = instrumentPaste.eqFilterType;
                this.append(new ChangeFilterSettings(doc, instrumentPaste.eqFilter, instrument.eqFilter, false, instrumentPaste.eqSubFilters, instrument.eqSubFilters));
                instrument.eqFilterSimpleCut = instrumentPaste.eqFilterSimpleCut;
                instrument.eqFilterSimplePeak = instrumentPaste.eqFilterSimplePeak;
            }
            if (selectivePaste.fade) this.append(new ChangeFadeInOut(doc, instrumentPaste.fadeIn, instrumentPaste.fadeOut));
            if (selectivePaste.unison) {
                if (instrumentPaste.unison != Config.unisons.length) this.append(new ChangeUnison(doc, instrumentPaste.unison));
                else {
                    instrument.unison = instrumentPaste.unison;
                    instrument.unisonVoices = instrumentPaste.unisonVoices;
                    instrument.unisonSpread = instrumentPaste.unisonSpread;
                    instrument.unisonOffset = instrumentPaste.unisonOffset;
                    instrument.unisonExpression = instrumentPaste.unisonExpression;
                    instrument.unisonSign = instrumentPaste.unisonSign;
                }
            }
            if (selectivePaste.effects) {
                instrument.effects = instrumentPaste.effects
                instrument.chorus = instrumentPaste.chorus;
                instrument.reverb = instrumentPaste.reverb;
                instrument.echoSustain = instrumentPaste.echoSustain;
                instrument.echoDelay = instrumentPaste.echoDelay;
                instrument.noteFilterType = instrumentPaste.noteFilterType;
                this.append(new ChangeFilterSettings(doc, instrumentPaste.noteFilter, instrument.noteFilter, true, instrumentPaste.noteSubFilters, instrument.noteSubFilters));
                instrument.noteFilterSimpleCut = instrumentPaste.noteFilterSimpleCut;
                instrument.noteFilterSimplePeak = instrumentPaste.noteFilterSimplePeak;
                instrument.distortion = instrumentPaste.distortion;
                instrument.bitcrusherFreq = instrumentPaste.bitcrusherFreq;
                instrument.bitcrusherQuantization = instrumentPaste.bitcrusherQuantization;
                instrument.ringModulation = instrumentPaste.ringModulation;
                instrument.ringModulationHz = instrumentPaste.ringModulationHz;
                instrument.ringModWaveformIndex = instrumentPaste.ringModWaveformIndex;
                instrument.ringModPulseWidth = instrumentPaste.ringModPulseWidth;
                instrument.granular = instrumentPaste.granular;
                instrument.grainSize = instrumentPaste.grainSize;
                instrument.grainAmounts = instrumentPaste.grainAmounts;
                instrument.grainRange = instrumentPaste.grainRange;
                instrument.pan = instrumentPaste.pan;
                instrument.panDelay = instrumentPaste.panDelay;
                instrument.pitchShift = instrumentPaste.pitchShift;
                instrument.detune = instrumentPaste.detune;
                instrument.vibrato = instrumentPaste.vibrato;
                if (instrument.vibrato == Config.vibratos.length) {
                    instrument.vibratoDepth = instrumentPaste.vibratoDepth;
                    instrument.vibratoSpeed = instrumentPaste.vibratoSpeed;
                    instrument.vibratoDelay = instrumentPaste.vibratoDelay;
                    instrument.vibratoType = instrumentPaste.vibratoType;
                }
                instrument.clicklessTransition = instrumentPaste.clicklessTransition;
                instrument.arpeggioSpeed = instrumentPaste.arpeggioSpeed;
                instrument.monoChordTone = instrumentPaste.monoChordTone;
                instrument.legacyTieOver = instrumentPaste.legacyTieOver;
                instrument.aliases = instrumentPaste.aliases;
                instrument.transition = instrumentPaste.transition;
                instrument.chord = instrumentPaste.chord;
            }
            if (selectivePaste.envelopes) {
                instrument.envelopeSpeed = instrumentPaste.envelopeSpeed;
                instrument.envelopeCount = instrumentPaste.envelopeCount;
                for (let i: number = 0; i < instrument.envelopeCount; i++) {
                    if (!instrument.envelopes[i]) instrument.envelopes[i] = new EnvelopeSettings(instrumentCopy["isDrum"]);
                    instrument.envelopes[i].fromJsonObject(instrumentPaste.envelopes[i].toJsonObject(), Config.jsonFormat);
                }
            }
            instrument.clearInvalidEnvelopeTargets();
        }
        doc.notifier.changed();
        this._didSomething();
    }
}

export class ChangeAppendInstrument extends ChangeGroup {
    constructor(doc: SongDocument, channel: Channel, instrument: any) {
        super();
        let newInstrument: Instrument = new Instrument(instrument["isDrum"], instrument["isMod"])
        newInstrument.fromJsonObject(instrument, instrument["isDrum"], instrument["isMod"], false, false);
        channel.instruments.push(newInstrument);
        this._didSomething();
        doc.notifier.changed();
    }
}

export class ChangeSetPatternInstruments extends Change {
    constructor(doc: SongDocument, channelIndex: number, instruments: number[], pattern: Pattern) {
        super();
        if (!patternsContainSameInstruments(instruments, pattern.instruments)) {
            pattern.instruments.length = 0;
            pattern.instruments.push(...instruments);
            discardInvalidPatternInstruments(pattern.instruments, doc.song, channelIndex);
            this._didSomething();
            doc.notifier.changed();
        }
    }
}

export class ChangeModChannel extends Change {
    constructor(doc: SongDocument, mod: number, index: number, useInstrument?: Instrument) {
        super();
        let instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        if (useInstrument != undefined)
            instrument = useInstrument;

        // None, or swapping from song to instrument/vice-versa
        if (index == 0 || (Config.modulators[instrument.modulators[mod]].forSong && index >= 2) || (!Config.modulators[instrument.modulators[mod]].forSong && index < 2)) {
            instrument.modulators[mod] = Config.modulators.dictionary["none"].index;
        }

        instrument.modChannels[mod] = index - 2;

        doc.notifier.changed();
        this._didSomething();
    }
}

export class ChangeModInstrument extends Change {
    constructor(doc: SongDocument, mod: number, tgtInstrument: number) {
        super();

        let instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];

        if (instrument.modInstruments[mod] != tgtInstrument) {
            instrument.modInstruments[mod] = tgtInstrument;

            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeModSetting extends Change {
    constructor(doc: SongDocument, mod: number, text: string) {
        super();

        let instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];

        // Populate all instruments that could be targeted by this mod setting.
        let tgtChannel: number = instrument.modChannels[mod];
        let usedInstruments: Instrument[] = [];
        if (tgtChannel >= 0) { // Ignore song/none.
            if (instrument.modInstruments[mod] == doc.song.channels[tgtChannel].instruments.length) {
                // All - Populate list of all instruments
                usedInstruments = usedInstruments.concat(doc.song.channels[tgtChannel].instruments);
            } else if (instrument.modInstruments[mod] > doc.song.channels[tgtChannel].instruments.length) {
                // Active - Populate list of only used instruments
                let tgtPattern: Pattern | null = doc.song.getPattern(tgtChannel, doc.bar);
                if (tgtPattern != null) {
                    for (let i: number = 0; i < tgtPattern.instruments.length; i++) {
                        usedInstruments.push(doc.song.channels[tgtChannel].instruments[tgtPattern.instruments[i]]);
                    }
                }
            }
            else {
                // Single instrument used.
                usedInstruments.push(doc.song.channels[tgtChannel].instruments[instrument.modInstruments[mod]]);
            }
        }

        // Check if a new effect is being added - if so add the proper associated effect to the instrument(s), and truncate "+ " from start of text.
        if (text.startsWith("+ ")) {
            text = text.substr(2);
            for (let i: number = 0; i < usedInstruments.length; i++) {
                const tgtInstrument: Instrument = usedInstruments[i];
                if (!(tgtInstrument.effects & (1 << Config.modulators.dictionary[text].associatedEffect))) {
                    doc.record(new ChangeToggleEffects(doc, Config.modulators.dictionary[text].associatedEffect, tgtInstrument));
                }
            }
        }

        let setting: number = Config.modulators.dictionary[text].index;

        if (instrument.modulators[mod] != setting) {

            instrument.modulators[mod] = setting;

            // Go through each pattern where this instrument is set, and clean up any notes that are out of bounds
            let cap: number = Config.modulators[setting].maxRawVol;

            for (let i: number = 0; i < doc.song.patternsPerChannel; i++) {
                const pattern: Pattern = doc.song.channels[doc.channel].patterns[i];
                if (pattern.instruments[0] == doc.getCurrentInstrument()) {
                    for (let j: number = 0; j < pattern.notes.length; j++) {
                        const note: Note = pattern.notes[j];
                        if (note.pitches[0] == Config.modCount - mod - 1) {
                            for (let k: number = 0; k < note.pins.length; k++) {
                                const pin: NotePin = note.pins[k];
                                if (pin.size > cap)
                                    pin.size = cap;
                            }
                        }
                    }
                }
            }

            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeModFilter extends Change {
    constructor(doc: SongDocument, mod: number, type: number) {
        super();

        let instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];

        if (instrument.modFilterTypes[mod] != type) {

            instrument.modFilterTypes[mod] = type;

            // Go through each pattern where this instrument is set, and clean up any notes that are out of bounds
            let cap: number = doc.song.getVolumeCapForSetting(true, instrument.modulators[mod], instrument.modFilterTypes[mod]);

            for (let i: number = 0; i < doc.song.patternsPerChannel; i++) {
                const pattern: Pattern = doc.song.channels[doc.channel].patterns[i];
                if (pattern.instruments[0] == doc.getCurrentInstrument()) {
                    for (let j: number = 0; j < pattern.notes.length; j++) {
                        const note: Note = pattern.notes[j];
                        if (note.pitches[0] == Config.modCount - mod - 1) {
                            for (let k: number = 0; k < note.pins.length; k++) {
                                const pin: NotePin = note.pins[k];
                                if (pin.size > cap)
                                    pin.size = cap;
                            }
                        }
                    }
                }
            }

            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeModEnvelope extends Change {
    constructor(doc: SongDocument, mod: number, envelope: number) {
        super();

        let instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];

        if (instrument.modEnvelopeNumbers[mod] != envelope) {

            instrument.modEnvelopeNumbers[mod] = envelope;

            // Go through each pattern where this instrument is set, and clean up any notes that are out of bounds
            let cap: number = doc.song.getVolumeCapForSetting(true, instrument.modulators[mod], instrument.modEnvelopeNumbers[mod]);

            for (let i: number = 0; i < doc.song.patternsPerChannel; i++) {
                const pattern: Pattern = doc.song.channels[doc.channel].patterns[i];
                if (pattern.instruments[0] == doc.getCurrentInstrument()) {
                    for (let j: number = 0; j < pattern.notes.length; j++) {
                        const note: Note = pattern.notes[j];
                        if (note.pitches[0] == Config.modCount - mod - 1) {
                            for (let k: number = 0; k < note.pins.length; k++) {
                                const pin: NotePin = note.pins[k];
                                if (pin.size > cap)
                                    pin.size = cap;
                            }
                        }
                    }
                }
            }

            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangePatternsPerChannel extends Change {
    constructor(doc: SongDocument, newValue: number) {
        super();
        if (doc.song.patternsPerChannel != newValue) {
            for (let i: number = 0; i < doc.song.getChannelCount(); i++) {
                const channelBars: number[] = doc.song.channels[i].bars;
                const channelPatterns: Pattern[] = doc.song.channels[i].patterns;
                for (let j: number = 0; j < channelBars.length; j++) {
                    if (channelBars[j] > newValue) channelBars[j] = 0;
                }
                for (let j: number = channelPatterns.length; j < newValue; j++) {
                    channelPatterns[j] = new Pattern();
                }
                channelPatterns.length = newValue;
            }
            doc.song.patternsPerChannel = newValue;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeEnsurePatternExists extends UndoableChange {
    private _doc: SongDocument;
    private _bar: number;
    private _channelIndex: number;
    private _patternIndex: number;
    private _patternOldNotes: Note[] | null = null;
    private _oldPatternCount: number;
    private _newPatternCount: number;
    private _oldPatternInstruments: number[] | null = null;
    private _newPatternInstruments: number[];

    constructor(doc: SongDocument, channelIndex: number, bar: number) {
        super(false);
        const song: Song = doc.song;
        if (song.channels[channelIndex].bars[bar] != 0) return;

        this._doc = doc;
        this._bar = bar;
        this._channelIndex = channelIndex;
        this._oldPatternCount = song.patternsPerChannel;
        this._newPatternCount = song.patternsPerChannel;
        if (channelIndex < doc.song.pitchChannelCount + doc.song.noiseChannelCount)
            this._newPatternInstruments = doc.recentPatternInstruments[channelIndex].concat();
        else
            this._newPatternInstruments = [doc.viewedInstrument[channelIndex]];

        let firstEmptyUnusedIndex: number | null = null;
        let firstUnusedIndex: number | null = null;
        for (let patternIndex: number = 1; patternIndex <= song.patternsPerChannel; patternIndex++) {
            let used = false;
            for (let barIndex: number = 0; barIndex < song.barCount; barIndex++) {
                if (song.channels[channelIndex].bars[barIndex] == patternIndex) {
                    used = true;
                    break;
                }
            }
            if (used) continue;
            if (firstUnusedIndex == null) {
                firstUnusedIndex = patternIndex;
            }
            const pattern: Pattern = song.channels[channelIndex].patterns[patternIndex - 1];
            if (pattern.notes.length == 0) {
                firstEmptyUnusedIndex = patternIndex;
                break;
            }
        }

        if (firstEmptyUnusedIndex != null) {
            this._patternIndex = firstEmptyUnusedIndex;
            this._oldPatternInstruments = song.channels[channelIndex].patterns[firstEmptyUnusedIndex - 1].instruments.concat();
        } else if (song.patternsPerChannel < song.barCount) {
            this._newPatternCount = song.patternsPerChannel + 1;
            this._patternIndex = song.patternsPerChannel + 1;
        } else if (firstUnusedIndex != null) {
            this._patternIndex = firstUnusedIndex;
            this._patternOldNotes = song.channels[channelIndex].patterns[firstUnusedIndex - 1].notes;
            this._oldPatternInstruments = song.channels[channelIndex].patterns[firstUnusedIndex - 1].instruments.concat();
        } else {
            throw new Error();
        }

        this._didSomething();
        this._doForwards();
    }

    protected _doForwards(): void {
        const song: Song = this._doc.song;
        for (let j: number = song.patternsPerChannel; j < this._newPatternCount; j++) {
            for (let i: number = 0; i < song.getChannelCount(); i++) {
                song.channels[i].patterns[j] = new Pattern();
            }
        }
        song.patternsPerChannel = this._newPatternCount;
        const pattern: Pattern = song.channels[this._channelIndex].patterns[this._patternIndex - 1];
        pattern.notes = [];
        pattern.instruments.length = 0;
        pattern.instruments.push(...this._newPatternInstruments);
        song.channels[this._channelIndex].bars[this._bar] = this._patternIndex;
        this._doc.notifier.changed();
    }

    protected _doBackwards(): void {
        const song: Song = this._doc.song;
        const pattern: Pattern = song.channels[this._channelIndex].patterns[this._patternIndex - 1];
        if (this._patternOldNotes != null) pattern.notes = this._patternOldNotes;
        if (this._oldPatternInstruments != null) {
            pattern.instruments.length = 0;
            pattern.instruments.push(...this._oldPatternInstruments);
        }
        song.channels[this._channelIndex].bars[this._bar] = 0;
        for (let i: number = 0; i < song.getChannelCount(); i++) {
            song.channels[i].patterns.length = this._oldPatternCount;
        }
        song.patternsPerChannel = this._oldPatternCount;
        this._doc.notifier.changed();
    }
}

export class ChangePinTime extends ChangePins {
    constructor(doc: SongDocument | null, note: Note, pinIndex: number, shiftedTime: number, continuesLastPattern: boolean) {
        super(doc, note);

        shiftedTime -= this._oldStart;
        const originalTime: number = this._oldPins[pinIndex].time;
        const skipStart: number = Math.min(originalTime, shiftedTime);
        const skipEnd: number = Math.max(originalTime, shiftedTime);
        let setPin: boolean = false;
        for (let i: number = 0; i < this._oldPins.length; i++) {
            const oldPin: NotePin = note.pins[i];
            const time: number = oldPin.time;
            if (time < skipStart) {
                this._newPins.push(makeNotePin(oldPin.interval, time, oldPin.size));
            } else if (time > skipEnd) {
                if (!setPin) {
                    if (this._newPins.length > 0) continuesLastPattern = note.continuesLastPattern;
                    this._newPins.push(makeNotePin(this._oldPins[pinIndex].interval, shiftedTime, this._oldPins[pinIndex].size));
                    setPin = true;
                }
                this._newPins.push(makeNotePin(oldPin.interval, time, oldPin.size));
            }
        }
        if (!setPin) {
            continuesLastPattern = note.continuesLastPattern;
            this._newPins.push(makeNotePin(this._oldPins[pinIndex].interval, shiftedTime, this._oldPins[pinIndex].size));
        }

        this._finishSetup(continuesLastPattern);
    }
}

export class ChangePitchBend extends ChangePins {
    constructor(doc: SongDocument | null, note: Note, bendStart: number, bendEnd: number, bendTo: number, pitchIndex: number) {
        super(doc, note);

        bendStart -= this._oldStart;
        bendEnd -= this._oldStart;
        bendTo -= note.pitches[pitchIndex];

        let setStart: boolean = false;
        let setEnd: boolean = false;
        let prevInterval: number = 0;
        let prevSize: number = Config.noteSizeMax;
        let persist: boolean = true;
        let i: number;
        let direction: number;
        let stop: number;
        let push: (item: NotePin) => void;
        if (bendEnd > bendStart) {
            i = 0;
            direction = 1;
            stop = note.pins.length;
            push = (item: NotePin) => { this._newPins.push(item); };
        } else {
            i = note.pins.length - 1;
            direction = -1;
            stop = -1;
            push = (item: NotePin) => { this._newPins.unshift(item); };
        }
        for (; i != stop; i += direction) {
            const oldPin: NotePin = note.pins[i];
            const time: number = oldPin.time;
            for (; ;) {
                if (!setStart) {
                    if (time * direction <= bendStart * direction) {
                        prevInterval = oldPin.interval;
                        prevSize = oldPin.size;
                    }
                    if (time * direction < bendStart * direction) {
                        push(makeNotePin(oldPin.interval, time, oldPin.size));
                        break;
                    } else {
                        push(makeNotePin(prevInterval, bendStart, prevSize));
                        setStart = true;
                    }
                } else if (!setEnd) {
                    if (time * direction <= bendEnd * direction) {
                        prevInterval = oldPin.interval;
                        prevSize = oldPin.size;
                    }
                    if (time * direction < bendEnd * direction) {
                        break;
                    } else {
                        push(makeNotePin(bendTo, bendEnd, prevSize));
                        setEnd = true;
                    }
                } else {
                    if (time * direction == bendEnd * direction) {
                        break;
                    } else {
                        if (oldPin.interval != prevInterval) persist = false;
                        push(makeNotePin(persist ? bendTo : oldPin.interval, time, oldPin.size));
                        break;
                    }
                }
            }
        }
        if (!setEnd) {
            push(makeNotePin(bendTo, bendEnd, prevSize));
        }

        this._finishSetup();
    }
}

export class ChangePatternRhythm extends ChangeSequence {
    constructor(doc: SongDocument, pattern: Pattern) {
        super();
        const minDivision: number = Config.partsPerBeat / Config.rhythms[doc.song.rhythm].stepsPerBeat;

        const changeRhythm: (oldTime: number) => number = function (oldTime: number): number {
            let thresholds: number[] | null = Config.rhythms[doc.song.rhythm].roundUpThresholds;
            if (thresholds != null) {
                const beatStart: number = Math.floor(oldTime / Config.partsPerBeat) * Config.partsPerBeat;
                const remainder: number = oldTime - beatStart;
                let newTime: number = beatStart;
                for (const threshold of thresholds) {
                    if (remainder >= threshold) {
                        newTime += minDivision;
                    } else {
                        break;
                    }
                }
                return newTime;
            } else {
                return Math.round(oldTime / minDivision) * minDivision;
            }
        };

        let i: number = 0;
        while (i < pattern.notes.length) {
            const note: Note = pattern.notes[i];
            if (changeRhythm(note.start) >= changeRhythm(note.end)) {
                this.append(new ChangeNoteAdded(doc, pattern, note, i, true));
            } else {
                this.append(new ChangeRhythmNote(doc, note, changeRhythm));
                i++;
            }
        }
    }
}

class ChangeRhythmNote extends ChangePins {
    constructor(doc: SongDocument | null, note: Note, changeRhythm: (oldTime: number) => number) {
        super(doc, note);

        for (const oldPin of this._oldPins) {
            this._newPins.push(makeNotePin(oldPin.interval, changeRhythm(oldPin.time + this._oldStart) - this._oldStart, oldPin.size));
        }

        this._finishSetup();
    }
}

export class ChangeMoveNotesSideways extends ChangeGroup {
    constructor(doc: SongDocument, beatsToMove: number, strategy: string) {
        super();
        let partsToMove: number = Math.round((beatsToMove % doc.song.beatsPerBar) * Config.partsPerBeat);
        if (partsToMove < 0) partsToMove += doc.song.beatsPerBar * Config.partsPerBeat;
        if (partsToMove == 0.0) return;

        switch (strategy) {
            case "wrapAround": {
                const partsPerBar: number = Config.partsPerBeat * doc.song.beatsPerBar;
                for (const channel of doc.song.channels) {
                    for (const pattern of channel.patterns) {
                        const newNotes: Note[] = [];

                        for (let bar: number = 1; bar >= 0; bar--) {
                            const barStartPart: number = bar * partsPerBar;

                            for (const oldNote of pattern.notes) {
                                const absoluteNoteStart: number = oldNote.start + partsToMove;
                                const absoluteNoteEnd: number = oldNote.end + partsToMove;
                                const noteStartPart: number = Math.max(0, absoluteNoteStart - barStartPart);
                                const noteEndPart: number = Math.min(partsPerBar, absoluteNoteEnd - barStartPart);

                                if (noteStartPart < noteEndPart) {
                                    projectNoteIntoBar(oldNote, absoluteNoteStart - barStartPart - noteStartPart, noteStartPart, noteEndPart, newNotes);
                                }
                            }
                        }

                        pattern.notes = newNotes;
                    }
                }
            } break;
            case "overflow": {
                let originalBarCount: number = doc.song.barCount;
                let originalLoopStart: number = doc.song.loopStart;
                let originalLoopLength: number = doc.song.loopLength;

                this.append(new ChangeMoveAndOverflowNotes(doc, doc.song.beatsPerBar, partsToMove));

                if (beatsToMove < 0) {
                    let firstBarIsEmpty: boolean = true;
                    for (const channel of doc.song.channels) {
                        if (channel.bars[0] != 0) firstBarIsEmpty = false;
                    }
                    if (firstBarIsEmpty) {
                        for (const channel of doc.song.channels) {
                            channel.bars.shift();
                        }
                        doc.song.barCount--;
                    } else {
                        originalBarCount++;
                        originalLoopStart++;
                        doc.bar++;
                    }
                }
                while (doc.song.barCount < originalBarCount) {
                    for (const channel of doc.song.channels) {
                        channel.bars.push(0);
                    }
                    doc.song.barCount++;
                }
                doc.song.loopStart = originalLoopStart;
                doc.song.loopLength = originalLoopLength;
            } break;
            default: throw new Error("Unrecognized beats-per-bar conversion strategy.");
        }

        doc.notifier.changed();
        this._didSomething();
    }
}

export class ChangeBeatsPerBar extends ChangeGroup {
    constructor(doc: SongDocument, newValue: number, strategy: string) {
        super();
        if (doc.song.beatsPerBar != newValue) {
            switch (strategy) {
                case "splice": {
                    if (doc.song.beatsPerBar > newValue) {
                        const sequence: ChangeSequence = new ChangeSequence();
                        for (let i: number = 0; i < doc.song.getChannelCount(); i++) {
                            for (let j: number = 0; j < doc.song.channels[i].patterns.length; j++) {
                                sequence.append(new ChangeNoteTruncate(doc, doc.song.channels[i].patterns[j], newValue * Config.partsPerBeat, doc.song.beatsPerBar * Config.partsPerBeat, null, true));
                            }
                        }
                    }
                } break;
                case "stretch": {
                    const changeRhythm = function (oldTime: number): number {
                        return Math.round(oldTime * newValue / doc.song.beatsPerBar);
                    };
                    for (let channelIndex: number = 0; channelIndex < doc.song.getChannelCount(); channelIndex++) {
                        for (let patternIndex: number = 0; patternIndex < doc.song.channels[channelIndex].patterns.length; patternIndex++) {
                            const pattern: Pattern = doc.song.channels[channelIndex].patterns[patternIndex];
                            let noteIndex: number = 0;
                            while (noteIndex < pattern.notes.length) {
                                const note: Note = pattern.notes[noteIndex];
                                if (changeRhythm(note.start) >= changeRhythm(note.end)) {
                                    this.append(new ChangeNoteAdded(doc, pattern, note, noteIndex, true));
                                } else {
                                    this.append(new ChangeRhythmNote(doc, note, changeRhythm));
                                    noteIndex++;
                                }
                            }
                        }
                    }
                    this.append(new ChangeTempo(doc, doc.song.tempo, doc.song.tempo * newValue / doc.song.beatsPerBar));
                } break;
                case "overflow": {
                    this.append(new ChangeMoveAndOverflowNotes(doc, newValue, 0));
                    doc.song.loopStart = 0;
                    doc.song.loopLength = doc.song.barCount;
                } break;
                default: throw new Error("Unrecognized beats-per-bar conversion strategy.");
            }

            doc.song.beatsPerBar = newValue;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeScale extends ChangeGroup {
    constructor(doc: SongDocument, newValue: number) {
        super();
        if (doc.song.scale != newValue) {
            doc.song.scale = newValue;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeDetectKey extends ChangeGroup {
    constructor(doc: SongDocument) {
        super();
        const song: Song = doc.song;
        const basePitch: number = Config.keys[song.key].basePitch;
        const keyWeights: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        for (let channelIndex: number = 0; channelIndex < song.pitchChannelCount; channelIndex++) {
            for (let barIndex: number = 0; barIndex < song.barCount; barIndex++) {
                const pattern: Pattern | null = song.getPattern(channelIndex, barIndex);
                if (pattern != null) {
                    for (const note of pattern.notes) {
                        const prevPin: NotePin = note.pins[0];
                        for (let pinIndex: number = 1; pinIndex < note.pins.length; pinIndex++) {
                            const nextPin: NotePin = note.pins[pinIndex];
                            if (prevPin.interval == nextPin.interval) {
                                let weight: number = nextPin.time - prevPin.time;
                                weight += Math.max(0, Math.min(Config.partsPerBeat, nextPin.time + note.start) - (prevPin.time + note.start));
                                weight *= nextPin.size + prevPin.size;
                                for (const pitch of note.pitches) {
                                    const key = (basePitch + prevPin.interval + pitch) % 12;
                                    keyWeights[key] += weight;
                                }
                            }
                        }
                    }
                }
            }
        }

        let bestKey: number = 0;
        let bestKeyWeight: number = 0;
        for (let key: number = 0; key < 12; key++) {
            // Look for the root of the most prominent major or minor chord.
            const keyWeight: number = keyWeights[key] * (3 * keyWeights[(key + 7) % 12] + keyWeights[(key + 4) % 12] + keyWeights[(key + 3) % 12]);
            if (bestKeyWeight < keyWeight) {
                bestKeyWeight = keyWeight;
                bestKey = key;
            }
        }

        if (bestKey != song.key) {
            const diff: number = song.key - bestKey;
            const absoluteDiff: number = Math.abs(diff);

            for (let channelIndex: number = 0; channelIndex < song.pitchChannelCount; channelIndex++) {
                for (const pattern of song.channels[channelIndex].patterns) {
                    for (let i: number = 0; i < absoluteDiff; i++) {
                        this.append(new ChangeTranspose(doc, channelIndex, pattern, diff > 0, true));
                    }
                }
            }

            song.key = bestKey;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export function pickRandomPresetValue(isNoise: boolean): number {
    const eligiblePresetValues: number[] = [];
    for (let categoryIndex: number = 0; categoryIndex < EditorConfig.presetCategories.length; categoryIndex++) {
        const category: PresetCategory = EditorConfig.presetCategories[categoryIndex];
        if (category.name == "Novelty Presets") continue;
        for (let presetIndex: number = 0; presetIndex < category.presets.length; presetIndex++) {
            const preset: Preset = category.presets[presetIndex];
            if (preset.settings != undefined && (preset.isNoise == true) == isNoise) {
                eligiblePresetValues.push((categoryIndex << 6) + presetIndex);
            }
        }
    }
    return eligiblePresetValues[(Math.random() * eligiblePresetValues.length) | 0];
}

export function setDefaultInstruments(song: Song): void {
    for (let channelIndex: number = 0; channelIndex < song.channels.length; channelIndex++) {
        for (const instrument of song.channels[channelIndex].instruments) {
            const isNoise: boolean = song.getChannelIsNoise(channelIndex);
            const isMod: boolean = song.getChannelIsMod(channelIndex);
            const presetValue: number = (channelIndex == song.pitchChannelCount) ? EditorConfig.nameToPresetValue(Math.random() > 0.5 ? "chip noise" : "standard drumset")! : pickRandomPresetValue(isNoise);
            const preset: Preset = EditorConfig.valueToPreset(presetValue)!;
            instrument.fromJsonObject(preset.settings, isNoise, isMod, song.rhythm == 0 || song.rhythm == 2, song.rhythm >= 2, 1);
            instrument.preset = presetValue;
            instrument.effects |= 1 << EffectType.panning;
        }
    }
}

export class ChangeSong extends ChangeGroup {
    constructor(doc: SongDocument, newHash: string, jsonFormat: string = "auto") {
        super();
        let pitchChannelCount = doc.song.pitchChannelCount;
        let noiseChannelCount = doc.song.noiseChannelCount;
        let modChannelCount = doc.song.modChannelCount;
        doc.song.fromBase64String(newHash, jsonFormat);
        if (pitchChannelCount != doc.song.pitchChannelCount || noiseChannelCount != doc.song.noiseChannelCount || modChannelCount != doc.song.modChannelCount) {
            ColorConfig.resetColors();
        }
        if (newHash == "") {
            this.append(new ChangePatternSelection(doc, 0, 0));
            doc.selection.resetBoxSelection();
            setDefaultInstruments(doc.song);
            doc.song.scale = doc.prefs.defaultScale;

            for (let i: number = 0; i <= doc.song.channels.length; i++) {
                doc.viewedInstrument[i] = 0;
                doc.recentPatternInstruments[i] = [0];
            }
            doc.viewedInstrument.length = doc.song.channels.length;
        } else {
            this.append(new ChangeValidateTrackSelection(doc));
        }
        doc.synth.computeLatestModValues();
        doc.notifier.changed();
        this._didSomething();
    }
}

export class ChangeValidateTrackSelection extends Change {
    constructor(doc: SongDocument) {
        super();
        const channelIndex: number = Math.min(doc.channel, doc.song.getChannelCount() - 1);
        const bar: number = Math.max(0, Math.min(doc.song.barCount - 1, doc.bar));
        if (doc.channel != channelIndex || doc.bar != bar) {
            doc.bar = bar;
            doc.channel = channelIndex;
            this._didSomething();
        }
        doc.selection.scrollToSelectedPattern();
        doc.notifier.changed();
    }
}

export class ChangeReplacePatterns extends ChangeGroup {
    constructor(doc: SongDocument, pitchChannels: Channel[], noiseChannels: Channel[], modChannels: Channel[]) {
        super();

        const song: Song = doc.song;

        function removeExtraSparseChannels(channels: Channel[], maxLength: number): void {
            while (channels.length > maxLength) {
                let sparsestIndex: number = channels.length - 1;
                let mostZeroes: number = 0;
                for (let channelIndex: number = 0; channelIndex < channels.length - 1; channelIndex++) {
                    let zeroes: number = 0;
                    for (const bar of channels[channelIndex].bars) {
                        if (bar == 0) zeroes++;
                    }
                    if (zeroes >= mostZeroes) {
                        sparsestIndex = channelIndex;
                        mostZeroes = zeroes;
                    }
                }
                channels.splice(sparsestIndex, 1);
            }
        }

        removeExtraSparseChannels(pitchChannels, Config.pitchChannelCountMax);
        removeExtraSparseChannels(noiseChannels, Config.noiseChannelCountMax);
        removeExtraSparseChannels(modChannels, Config.modChannelCountMax);

        while (pitchChannels.length < Config.pitchChannelCountMin) pitchChannels.push(new Channel());
        while (noiseChannels.length < Config.noiseChannelCountMin) noiseChannels.push(new Channel());
        while (modChannels.length < Config.modChannelCountMin) modChannels.push(new Channel());

        // Set minimum counts.
        song.barCount = 1;
        song.patternsPerChannel = 8;
        const combinedChannels: Channel[] = pitchChannels.concat(noiseChannels.concat(modChannels));
        for (let channelIndex: number = 0; channelIndex < combinedChannels.length; channelIndex++) {
            const channel: Channel = combinedChannels[channelIndex];
            song.barCount = Math.max(song.barCount, channel.bars.length);
            song.patternsPerChannel = Math.max(song.patternsPerChannel, channel.patterns.length);
            song.channels[channelIndex] = channel;
        }
        song.channels.length = combinedChannels.length;
        song.pitchChannelCount = pitchChannels.length;
        song.noiseChannelCount = noiseChannels.length;
        song.modChannelCount = modChannels.length;

        song.barCount = Math.min(Config.barCountMax, song.barCount);
        song.patternsPerChannel = Math.min(Config.barCountMax, song.patternsPerChannel);
        for (let channelIndex: number = 0; channelIndex < song.channels.length; channelIndex++) {
            const channel: Channel = song.channels[channelIndex];

            for (let barIndex: number = 0; barIndex < channel.bars.length; barIndex++) {
                if (channel.bars[barIndex] > song.patternsPerChannel || channel.bars[barIndex] < 0) {
                    channel.bars[barIndex] = 0;
                }
            }
            while (channel.bars.length < song.barCount) {
                channel.bars.push(0);
            }
            channel.bars.length = song.barCount;

            if (channel.instruments.length > song.getMaxInstrumentsPerChannel()) {
                channel.instruments.length = song.getMaxInstrumentsPerChannel();
            }

            for (const pattern of channel.patterns) {
                discardInvalidPatternInstruments(pattern.instruments, song, channelIndex);
            }
            while (channel.patterns.length < song.patternsPerChannel) {
                channel.patterns.push(new Pattern());
            }

            channel.patterns.length = song.patternsPerChannel;
        }

        song.loopStart = Math.max(0, Math.min(song.barCount - 1, song.loopStart));
        song.loopLength = Math.min(song.barCount - song.loopStart, song.loopLength);

        this.append(new ChangeValidateTrackSelection(doc));
        doc.notifier.changed();
        this._didSomething();

        ColorConfig.resetColors();
    }
}

export function comparePatternNotes(a: Note[], b: Note[]): boolean {
    if (a.length != b.length) return false;

    for (let noteIndex: number = 0; noteIndex < a.length; noteIndex++) {
        const oldNote: Note = a[noteIndex];
        const newNote: Note = b[noteIndex];
        if (newNote.start != oldNote.start || newNote.end != oldNote.end || newNote.pitches.length != oldNote.pitches.length || newNote.pins.length != oldNote.pins.length) {
            return false;
        }

        for (let pitchIndex: number = 0; pitchIndex < oldNote.pitches.length; pitchIndex++) {
            if (newNote.pitches[pitchIndex] != oldNote.pitches[pitchIndex]) {
                return false;
            }
        }

        for (let pinIndex: number = 0; pinIndex < oldNote.pins.length; pinIndex++) {
            if (newNote.pins[pinIndex].interval != oldNote.pins[pinIndex].interval || newNote.pins[pinIndex].time != oldNote.pins[pinIndex].time || newNote.pins[pinIndex].size != oldNote.pins[pinIndex].size) {
                return false;
            }
        }
    }

    return true;
}

export function removeDuplicatePatterns(channels: Channel[]): void {
    for (const channel of channels) {
        const newPatterns: Pattern[] = [];
        for (let bar: number = 0; bar < channel.bars.length; bar++) {
            if (channel.bars[bar] == 0) continue;

            const oldPattern: Pattern = channel.patterns[channel.bars[bar] - 1];

            let foundMatchingPattern: boolean = false;
            for (let newPatternIndex: number = 0; newPatternIndex < newPatterns.length; newPatternIndex++) {
                const newPattern: Pattern = newPatterns[newPatternIndex];

                if (!patternsContainSameInstruments(oldPattern.instruments, newPattern.instruments) || newPattern.notes.length != oldPattern.notes.length) {
                    continue;
                }

                if (comparePatternNotes(oldPattern.notes, newPattern.notes)) {
                    foundMatchingPattern = true;
                    channel.bars[bar] = newPatternIndex + 1;
                    break;
                }
            }

            if (!foundMatchingPattern) {
                newPatterns.push(oldPattern);
                channel.bars[bar] = newPatterns.length;
            }
        }

        for (let patternIndex: number = 0; patternIndex < newPatterns.length; patternIndex++) {
            channel.patterns[patternIndex] = newPatterns[patternIndex];
        }
        channel.patterns.length = newPatterns.length;
    }
}

export class ChangeKeyOctave extends Change {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super();
        doc.song.octave = Math.max(Config.octaveMin, Math.min(Config.octaveMax, Math.round(newValue)));
        doc.notifier.changed();
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeTempo extends Change {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super();
        doc.song.tempo = Math.max(Config.tempoMin, Math.min(Config.tempoMax, Math.round(newValue)));
        doc.synth.unsetMod(Config.modulators.dictionary["tempo"].index);
        doc.notifier.changed();
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeEchoDelay extends ChangeInstrumentSlider {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super(doc);
        this._instrument.echoDelay = newValue;
        doc.synth.unsetMod(Config.modulators.dictionary["echo delay"].index, doc.channel, doc.getCurrentInstrument());
        doc.notifier.changed();
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeEchoSustain extends ChangeInstrumentSlider {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super(doc);
        this._instrument.echoSustain = newValue;
        doc.synth.unsetMod(Config.modulators.dictionary["echo"].index, doc.channel, doc.getCurrentInstrument());
        doc.notifier.changed();
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeChorus extends ChangeInstrumentSlider {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super(doc);
        this._instrument.chorus = newValue;
        doc.synth.unsetMod(Config.modulators.dictionary["chorus"].index, doc.channel, doc.getCurrentInstrument());
        doc.notifier.changed();
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeReverb extends ChangeInstrumentSlider {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super(doc);
        this._instrument.reverb = newValue;
        doc.synth.unsetMod(Config.modulators.dictionary["reverb"].index, doc.channel, doc.getCurrentInstrument());
        doc.notifier.changed();
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeSongReverb extends Change {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super();
        doc.song.reverb = newValue;
        doc.synth.unsetMod(Config.modulators.dictionary["song reverb"].index);
        doc.notifier.changed();
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeNoteAdded extends UndoableChange {
    private _doc: SongDocument;
    private _pattern: Pattern;
    private _note: Note;
    private _index: number;
    constructor(doc: SongDocument, pattern: Pattern, note: Note, index: number, deletion: boolean = false) {
        super(deletion);
        this._doc = doc;
        this._pattern = pattern;
        this._note = note;
        this._index = index;
        this._didSomething();
        this.redo();
    }

    protected _doForwards(): void {
        this._pattern.notes.splice(this._index, 0, this._note);
        this._doc.notifier.changed();
    }

    protected _doBackwards(): void {
        this._pattern.notes.splice(this._index, 1);
        this._doc.notifier.changed();
    }
}

export class ChangeNoteLength extends ChangePins {
    constructor(doc: SongDocument | null, note: Note, truncStart: number, truncEnd: number) {
        super(doc, note);
        const continuesLastPattern: boolean = ((this._oldStart < 0 || note.continuesLastPattern) && truncStart == 0);

        truncStart -= this._oldStart;
        truncEnd -= this._oldStart;
        let setStart: boolean = false;
        let prevSize: number = this._oldPins[0].size;
        let prevInterval: number = this._oldPins[0].interval;
        let pushLastPin: boolean = true;
        let i: number;
        for (i = 0; i < this._oldPins.length; i++) {
            const oldPin: NotePin = this._oldPins[i];
            if (oldPin.time < truncStart) {
                prevSize = oldPin.size;
                prevInterval = oldPin.interval;
            } else {
                if (oldPin.time > truncStart && !setStart) {
                    this._newPins.push(makeNotePin(prevInterval, truncStart, prevSize));
                    setStart = true;
                }
                if (oldPin.time <= truncEnd) {
                    this._newPins.push(makeNotePin(oldPin.interval, oldPin.time, oldPin.size));
                    if (oldPin.time == truncEnd) {
                        pushLastPin = false;
                        break;
                    }
                } else {
                    break;
                }

            }

        }

        if (pushLastPin) this._newPins.push(makeNotePin(this._oldPins[i].interval, truncEnd, this._oldPins[i].size));

        this._finishSetup(continuesLastPattern);
    }
}

export class ChangeNoteTruncate extends ChangeSequence {
    constructor(doc: SongDocument, pattern: Pattern, start: number, end: number, skipNote: Note | null = null, force: boolean = false) {
        super();
        let i: number = 0;
        while (i < pattern.notes.length) {
            const note: Note = pattern.notes[i];
            if (note == skipNote && skipNote != null) {
                i++;
            } else if (note.end <= start) {
                i++;
            } else if (note.start >= end) {
                // Allow out-of-order notes for mods so that all get checked.
                if (!doc.song.getChannelIsMod(doc.channel)) {
                    break;
                } else {
                    i++;
                }
            } else if (note.start < start && note.end > end) {
                if (!doc.song.getChannelIsMod(doc.channel) || force || (skipNote != null && note.pitches[0] == skipNote.pitches[0])) {
                    const copy: Note = note.clone();
                    this.append(new ChangeNoteLength(doc, note, note.start, start));
                    i++;
                    this.append(new ChangeNoteAdded(doc, pattern, copy, i, false));
                    this.append(new ChangeNoteLength(doc, copy, end, copy.end));
                }
                i++;
            } else if (note.start < start) {
                if (!doc.song.getChannelIsMod(doc.channel) || force || (skipNote != null && note.pitches[0] == skipNote.pitches[0]))
                    this.append(new ChangeNoteLength(doc, note, note.start, start));
                i++;
            } else if (note.end > end) {
                if (!doc.song.getChannelIsMod(doc.channel) || force || (skipNote != null && note.pitches[0] == skipNote.pitches[0]))
                    this.append(new ChangeNoteLength(doc, note, end, note.end));
                i++;
            } else {
                if (!doc.song.getChannelIsMod(doc.channel) || force || (skipNote != null && note.pitches[0] == skipNote.pitches[0]))
                    this.append(new ChangeNoteAdded(doc, pattern, note, i, true));
                else
                    i++;
            }
        }
    }
}

class ChangeSplitNotesAtSelection extends ChangeSequence {
    constructor(doc: SongDocument, pattern: Pattern) {
        super();
        let i: number = 0;
        while (i < pattern.notes.length) {
            const note: Note = pattern.notes[i];
            if (note.start < doc.selection.patternSelectionStart && doc.selection.patternSelectionStart < note.end) {
                const copy: Note = note.clone();
                this.append(new ChangeNoteLength(doc, note, note.start, doc.selection.patternSelectionStart));
                i++;
                this.append(new ChangeNoteAdded(doc, pattern, copy, i, false));
                this.append(new ChangeNoteLength(doc, copy, doc.selection.patternSelectionStart, copy.end));
                // i++; // The second note might be split again at the end of the selection. Check it again.
            } else if (note.start < doc.selection.patternSelectionEnd && doc.selection.patternSelectionEnd < note.end) {
                const copy: Note = note.clone();
                this.append(new ChangeNoteLength(doc, note, note.start, doc.selection.patternSelectionEnd));
                i++;
                this.append(new ChangeNoteAdded(doc, pattern, copy, i, false));
                this.append(new ChangeNoteLength(doc, copy, doc.selection.patternSelectionEnd, copy.end));
                i++;
            } else {
                i++;
            }
        }
    }
}

class ChangeTransposeNote extends UndoableChange {
    protected _doc: SongDocument;
    protected _note: Note;
    protected _oldStart: number;
    protected _newStart: number;
    protected _oldEnd: number;
    protected _newEnd: number;
    protected _oldPins: NotePin[];
    protected _newPins: NotePin[];
    protected _oldPitches: number[];
    protected _newPitches: number[];
    constructor(doc: SongDocument, channelIndex: number, note: Note, upward: boolean, ignoreScale: boolean = false, octave: boolean = false) {
        super(false);
        this._doc = doc;
        this._note = note;
        this._oldPins = note.pins;
        this._newPins = [];
        this._oldPitches = note.pitches;
        this._newPitches = [];

        // I'm disabling pitch transposing for noise channels to avoid
        // accidentally messing up noise channels when pitch shifting all
        // channels at once.
        const isNoise: boolean = doc.song.getChannelIsNoise(channelIndex);
        if (isNoise != doc.song.getChannelIsNoise(doc.channel)) return;

        // Can't transpose mods
        if (doc.song.getChannelIsMod(doc.channel)) return;

        const maxPitch: number = (isNoise ? Config.drumCount - 1 : Config.maxPitch);

        for (let i: number = 0; i < this._oldPitches.length; i++) {
            let pitch: number = this._oldPitches[i];
            if (octave && !isNoise) {
                if (upward) {
                    pitch = Math.min(maxPitch, pitch + 12);
                } else {
                    pitch = Math.max(0, pitch - 12);
                }
            } else {
                let scale = doc.song.scale == Config.scales.dictionary["Custom"].index ? doc.song.scaleCustom : Config.scales[doc.song.scale].flags;
                if (upward) {
                    for (let j: number = pitch + 1; j <= maxPitch; j++) {
                        if (isNoise || ignoreScale || scale[j % 12]) {
                            pitch = j;
                            break;
                        }
                    }
                } else {
                    for (let j: number = pitch - 1; j >= 0; j--) {
                        if (isNoise || ignoreScale || scale[j % 12]) {
                            pitch = j;
                            break;
                        }
                    }
                }
            }

            let foundMatch: boolean = false;
            for (let j: number = 0; j < this._newPitches.length; j++) {
                if (this._newPitches[j] == pitch) {
                    foundMatch = true;
                    break;
                }
            }
            if (!foundMatch) this._newPitches.push(pitch);
        }

        let min: number = 0;
        let max: number = maxPitch;

        for (let i: number = 1; i < this._newPitches.length; i++) {
            const diff: number = this._newPitches[0] - this._newPitches[i];
            if (min < diff) min = diff;
            if (max > diff + maxPitch) max = diff + maxPitch;
        }

        for (const oldPin of this._oldPins) {
            let interval: number = oldPin.interval + this._oldPitches[0];

            if (interval < min) interval = min;
            if (interval > max) interval = max;
            if (octave && !isNoise) {
                if (upward) {
                    interval = Math.min(max, interval + 12);
                } else {
                    interval = Math.max(min, interval - 12);
                }
            } else {
                let scale = doc.song.scale == Config.scales.dictionary["Custom"].index ? doc.song.scaleCustom : Config.scales[doc.song.scale].flags;
                if (upward) {
                    for (let i: number = interval + 1; i <= max; i++) {
                        if (isNoise || ignoreScale || scale[i % 12]) {
                            interval = i;
                            break;
                        }
                    }
                } else {
                    for (let i: number = interval - 1; i >= min; i--) {
                        if (isNoise || ignoreScale || scale[i % 12]) {
                            interval = i;
                            break;
                        }
                    }
                }
            }
            interval -= this._newPitches[0];
            this._newPins.push(makeNotePin(interval, oldPin.time, oldPin.size));
        }

        if (this._newPins[0].interval != 0) throw new Error("wrong pin start interval");

        for (let i: number = 1; i < this._newPins.length - 1;) {
            if (this._newPins[i - 1].interval == this._newPins[i].interval &&
                this._newPins[i].interval == this._newPins[i + 1].interval &&
                this._newPins[i - 1].size == this._newPins[i].size &&
                this._newPins[i].size == this._newPins[i + 1].size) {
                this._newPins.splice(i, 1);
            } else {
                i++;
            }
        }

        this._doForwards();
        this._didSomething();
    }

    protected _doForwards(): void {
        this._note.pins = this._newPins;
        this._note.pitches = this._newPitches;
        this._doc.notifier.changed();
    }

    protected _doBackwards(): void {
        this._note.pins = this._oldPins;
        this._note.pitches = this._oldPitches;
        this._doc.notifier.changed();
    }
}

export class ChangeTranspose extends ChangeSequence {
    constructor(doc: SongDocument, channelIndex: number, pattern: Pattern, upward: boolean, ignoreScale: boolean = false, octave: boolean = false) {
        super();
        if (doc.selection.patternSelectionActive) {
            this.append(new ChangeSplitNotesAtSelection(doc, pattern));
        }
        for (const note of pattern.notes) {
            if (doc.selection.patternSelectionActive && (note.end <= doc.selection.patternSelectionStart || note.start >= doc.selection.patternSelectionEnd)) {
                continue;
            }
            this.append(new ChangeTransposeNote(doc, channelIndex, note, upward, ignoreScale, octave));
        }
    }
}

export class ChangeTrackSelection extends Change {
    constructor(doc: SongDocument, newX0: number, newX1: number, newY0: number, newY1: number) {
        super();
        doc.selection.boxSelectionX0 = newX0;
        doc.selection.boxSelectionX1 = newX1;
        doc.selection.boxSelectionY0 = newY0;
        doc.selection.boxSelectionY1 = newY1;
        doc.notifier.changed();
        this._didSomething();
    }
}

export class ChangePatternSelection extends UndoableChange {
    private _doc: SongDocument;
    private _oldStart: number;
    private _oldEnd: number;
    private _oldActive: boolean;
    private _newStart: number;
    private _newEnd: number;
    private _newActive: boolean;

    constructor(doc: SongDocument, newStart: number, newEnd: number) {
        super(false);
        this._doc = doc;
        this._oldStart = doc.selection.patternSelectionStart;
        this._oldEnd = doc.selection.patternSelectionEnd;
        this._oldActive = doc.selection.patternSelectionActive;
        this._newStart = newStart;
        this._newEnd = newEnd;
        this._newActive = newStart < newEnd;
        this._doForwards();
        this._didSomething();
    }

    protected _doForwards(): void {
        this._doc.selection.patternSelectionStart = this._newStart;
        this._doc.selection.patternSelectionEnd = this._newEnd;
        this._doc.selection.patternSelectionActive = this._newActive;
        this._doc.notifier.changed();
    }

    protected _doBackwards(): void {
        this._doc.selection.patternSelectionStart = this._oldStart;
        this._doc.selection.patternSelectionEnd = this._oldEnd;
        this._doc.selection.patternSelectionActive = this._oldActive;
        this._doc.notifier.changed();
    }
}

export class ChangeDragSelectedNotes extends ChangeSequence {
    constructor(doc: SongDocument, channelIndex: number, pattern: Pattern, parts: number, transpose: number) {
        super();

        if (parts == 0 && transpose == 0) return;

        if (doc.selection.patternSelectionActive) {
            this.append(new ChangeSplitNotesAtSelection(doc, pattern));
        }

        const oldStart: number = doc.selection.patternSelectionStart;
        const oldEnd: number = doc.selection.patternSelectionEnd;
        const newStart: number = Math.max(0, Math.min(doc.song.beatsPerBar * Config.partsPerBeat, oldStart + parts));
        const newEnd: number = Math.max(0, Math.min(doc.song.beatsPerBar * Config.partsPerBeat, oldEnd + parts));
        if (newStart == newEnd) {
            // Just erase the current contents of the selection:
            this.append(new ChangeNoteTruncate(doc, pattern, oldStart, oldEnd, null, true));
        } else if (parts < 0) {
            // Clear space for the dragged notes:
            this.append(new ChangeNoteTruncate(doc, pattern, newStart, Math.min(oldStart, newEnd), null, true));
        } else {
            // Clear space for the dragged notes:
            this.append(new ChangeNoteTruncate(doc, pattern, Math.max(oldEnd, newStart), newEnd, null, true));
        }

        this.append(new ChangePatternSelection(doc, newStart, newEnd));
        const draggedNotes = [];
        let noteInsertionIndex: number = 0;
        let i: number = 0;
        while (i < pattern.notes.length) {
            const note: Note = pattern.notes[i];
            if (note.end <= oldStart || note.start >= oldEnd) {
                i++;
                if (note.end <= newStart) noteInsertionIndex = i;
            } else {
                draggedNotes.push(note.clone());
                this.append(new ChangeNoteAdded(doc, pattern, note, i, true));
            }
        }

        for (const note of draggedNotes) {
            note.start += parts;
            note.end += parts;
            if (note.end <= newStart) continue;
            if (note.start >= newEnd) continue;

            this.append(new ChangeNoteAdded(doc, pattern, note, noteInsertionIndex++, false));

            this.append(new ChangeNoteLength(doc, note, Math.max(note.start, newStart), Math.min(newEnd, note.end)));

            for (let i: number = 0; i < Math.abs(transpose); i++) {
                this.append(new ChangeTransposeNote(doc, channelIndex, note, transpose > 0, doc.prefs.notesOutsideScale));
            }

        }
    }
}

export class ChangeHoldingModRecording extends Change {
    public storedChange: Change | null;
    public storedValues: number[] | null;
    public storedSlider: Slider | null;
    constructor(doc: SongDocument, storedChange: Change | null, storedValues: number[] | null, slider: Slider | null) {
        super();
        this.storedChange = storedChange;
        this.storedValues = storedValues;
        this.storedSlider = slider;
        this._didSomething();
    }
}

export class ChangeDuplicateSelectedReusedPatterns extends ChangeGroup {
    constructor(doc: SongDocument, barStart: number, barWidth: number, channelStart: number, channelHeight: number, replaceUnused: boolean) {
        super();
        for (let channelIndex: number = channelStart; channelIndex < channelStart + channelHeight; channelIndex++) {
            const reusablePatterns: Dictionary<number> = {};

            for (let bar: number = barStart; bar < barStart + barWidth; bar++) {
                const currentPatternIndex: number = doc.song.channels[channelIndex].bars[bar];
                if (currentPatternIndex == 0) continue;
                if (reusablePatterns[String(currentPatternIndex)] == undefined) {
                    let isUsedElsewhere = false;
                    // if (replaceUnused) {
                    //     for (let bar2: number = 0; bar2 < doc.song.barCount; bar2++) {
                    //         if (bar2 < barStart || bar2 >= barStart + barWidth) {
                    //             if (doc.song.channels[channelIndex].bars[bar2] == currentPatternIndex) {
                    //                 isUsedElsewhere = true;
                    //                 break;
                    //             }
                    //         }
                    //     }
                    // } else {
                        for (let bar2: number = 0; bar2 < doc.song.barCount; bar2++) {
                            if (bar2 < barStart || bar2 >= barStart + barWidth) {
                                if (doc.song.channels[channelIndex].bars[bar2] == currentPatternIndex) {
                                    isUsedElsewhere = true;
                                    break;
                                }
                            }
                        }
                    // }
                    if (isUsedElsewhere) {
                        // Need to duplicate the pattern.
                        const copiedPattern: Pattern = doc.song.getPattern(channelIndex, bar)!;
                        this.append(new ChangePatternNumbers(doc, 0, bar, channelIndex, 1, 1));
                        this.append(new ChangeEnsurePatternExists(doc, channelIndex, bar));
                        const newPattern: Pattern | null = doc.song.getPattern(channelIndex, bar);
                        if (newPattern == null) throw new Error();
                        this.append(new ChangePaste(doc, newPattern, copiedPattern.notes, 0, Config.partsPerBeat * doc.song.beatsPerBar, Config.partsPerBeat * doc.song.beatsPerBar));

                        // Copy the instruments into the new pattern.
                        newPattern.instruments.length = 0;
                        newPattern.instruments.push(...copiedPattern.instruments);

                        reusablePatterns[String(currentPatternIndex)] = doc.song.channels[channelIndex].bars[bar];
                    } else {
                        reusablePatterns[String(currentPatternIndex)] = currentPatternIndex;
                    }
                }

                this.append(new ChangePatternNumbers(doc, reusablePatterns[String(currentPatternIndex)], bar, channelIndex, 1, 1));
            }
        }
    }
}

export class ChangePatternScale extends Change {
    constructor(doc: SongDocument, pattern: Pattern, scaleMap: number[]) {
        super();
        if (doc.selection.patternSelectionActive) {
            new ChangeSplitNotesAtSelection(doc, pattern);
        }
        const maxPitch: number = Config.maxPitch;
        for (const note of pattern.notes) {
            if (doc.selection.patternSelectionActive && (note.end <= doc.selection.patternSelectionStart || note.start >= doc.selection.patternSelectionEnd)) {
                continue;
            }

            const newPitches: number[] = [];
            const newPins: NotePin[] = [];
            for (let i: number = 0; i < note.pitches.length; i++) {
                const pitch: number = note.pitches[i];
                const transformedPitch: number = scaleMap[pitch % 12] + (pitch - (pitch % 12));
                if (newPitches.indexOf(transformedPitch) == -1) {
                    newPitches.push(transformedPitch);
                }
            }

            let min: number = 0;
            let max: number = maxPitch;

            for (let i: number = 1; i < newPitches.length; i++) {
                const diff: number = newPitches[0] - newPitches[i];
                if (min < diff) min = diff;
                if (max > diff + maxPitch) max = diff + maxPitch;
            }

            for (const oldPin of note.pins) {
                let interval: number = oldPin.interval + note.pitches[0];
                if (interval < min) interval = min;
                if (interval > max) interval = max;
                const transformedInterval: number = scaleMap[interval % 12] + (interval - (interval % 12));
                newPins.push(makeNotePin(transformedInterval - newPitches[0], oldPin.time, oldPin.size));
            }

            if (newPins[0].interval != 0) throw new Error("wrong pin start interval");

            for (let i: number = 1; i < newPins.length - 1;) {
                if (newPins[i - 1].interval == newPins[i].interval &&
                    newPins[i].interval == newPins[i + 1].interval &&
                    newPins[i - 1].size == newPins[i].size &&
                    newPins[i].size == newPins[i + 1].size) {
                    newPins.splice(i, 1);
                } else {
                    i++;
                }
            }

            note.pitches = newPitches;
            note.pins = newPins;
        }
        this._didSomething();
        doc.notifier.changed();
    }
}

export class ChangeVolume extends Change {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super();
        doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()].volume = newValue;
        // Not used currently as mod is implemented as multiplicative.
        //doc.synth.unsetMod(ModSetting.mstInsVolume, doc.channel, doc.getCurrentInstrument());
        doc.notifier.changed();
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeSongTitle extends Change {
    constructor(doc: SongDocument, oldValue: string, newValue: string) {
        super();
        if (newValue.length > 30) {
            newValue = newValue.substring(0, 30);
        }

        doc.song.title = newValue;
        document.title = newValue + " - " + EditorConfig.versionDisplayName;
        doc.notifier.changed();
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeChannelName extends Change {
    constructor(doc: SongDocument, oldValue: string, newValue: string) {
        super();
        if (newValue.length > 15) {
            newValue = newValue.substring(0, 15);
        }

        doc.song.channels[doc.muteEditorChannel].name = newValue;
        doc.recalcChannelNames = true;

        doc.notifier.changed();
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangePan extends Change {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super();
        doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()].pan = newValue;
        doc.synth.unsetMod(Config.modulators.dictionary["pan"].index, doc.channel, doc.getCurrentInstrument());
        doc.notifier.changed();
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangePanDelay extends Change {
    constructor(doc: SongDocument, oldValue: number, newValue: number) {
        super();
        doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()].panDelay = newValue;
        doc.notifier.changed();
        if (oldValue != newValue) this._didSomething();
    }
}

export class ChangeSizeBend extends UndoableChange {
    private _doc: SongDocument;
    private _note: Note;
    private _oldPins: NotePin[];
    private _newPins: NotePin[];
    constructor(doc: SongDocument, note: Note, bendPart: number, bendSize: number, bendInterval: number, uniformSize: boolean) {
        super(false);
        this._doc = doc;
        this._note = note;
        this._oldPins = note.pins;
        this._newPins = [];

        let inserted: boolean = false;

        for (const pin of note.pins) {
            if (pin.time < bendPart) {
                if (uniformSize) {
                    this._newPins.push(makeNotePin(pin.interval, pin.time, bendSize));
                } else {
                    this._newPins.push(pin);
                }
            } else if (pin.time == bendPart) {
                this._newPins.push(makeNotePin(bendInterval, bendPart, bendSize));
                inserted = true;
            } else {
                if (!uniformSize && !inserted) {
                    this._newPins.push(makeNotePin(bendInterval, bendPart, bendSize));
                    inserted = true;
                }
                if (uniformSize) {
                    this._newPins.push(makeNotePin(pin.interval, pin.time, bendSize));
                } else {
                    this._newPins.push(pin);
                }
            }
        }

        removeRedundantPins(this._newPins);

        this._doForwards();
        this._didSomething();
    }

    protected _doForwards(): void {
        this._note.pins = this._newPins;
        this._doc.notifier.changed();
    }

    protected _doBackwards(): void {
        this._note.pins = this._oldPins;
        this._doc.notifier.changed();
    }
}

export class ChangeChipWave extends Change {
    constructor(doc: SongDocument, newValue: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        if (instrument.chipWave != newValue) {
            instrument.chipWave = newValue;
						 // advloop addition
                instrument.isUsingAdvancedLoopControls = false;
                instrument.chipWaveLoopStart = 0;
                instrument.chipWaveLoopEnd = Config.rawRawChipWaves[instrument.chipWave].samples.length - 1;
                instrument.chipWaveLoopMode = 0;
                instrument.chipWavePlayBackwards = false;
                instrument.chipWaveStartOffset = 0;
                // advloop addition
            instrument.preset = instrument.type;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

	// advloop addition
    export class ChangeChipWaveUseAdvancedLoopControls extends Change {
        constructor(doc: SongDocument, newValue: boolean) {
            super();
            const instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
            if (instrument.isUsingAdvancedLoopControls != newValue) {
                instrument.isUsingAdvancedLoopControls = newValue;
                instrument.chipWaveLoopStart = 0;
                instrument.chipWaveLoopEnd = Config.rawRawChipWaves[instrument.chipWave].samples.length - 1;
                instrument.chipWaveLoopMode = 0;
                instrument.chipWavePlayBackwards = false;
                instrument.chipWaveStartOffset = 0;
                instrument.preset = instrument.type;
                doc.notifier.changed();
                this._didSomething();
            }
        }
    }
    export class ChangeChipWaveLoopMode extends Change {
        constructor(doc: SongDocument, newValue: number) {
            super();
            const instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
            if (instrument.chipWaveLoopMode != newValue) {
                instrument.isUsingAdvancedLoopControls = true;
                instrument.chipWaveLoopMode = newValue;
                instrument.preset = instrument.type;
                doc.notifier.changed();
                this._didSomething();
            }
        }
    }
   export class ChangeChipWaveLoopStart extends Change {
        constructor(doc: SongDocument, newValue: number) {
            super();
            const instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
            if (instrument.chipWaveLoopStart != newValue) {
                instrument.isUsingAdvancedLoopControls = true;
                instrument.chipWaveLoopStart = newValue;
                instrument.preset = instrument.type;
                doc.notifier.changed();
                this._didSomething();
            }
        }
    }
   export class ChangeChipWaveLoopEnd extends Change {
        constructor(doc: SongDocument, newValue: number) {
            super();
            const instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
            if (instrument.chipWaveLoopEnd != newValue) {
                instrument.isUsingAdvancedLoopControls = true;
                instrument.chipWaveLoopEnd = newValue;
                instrument.chipWaveLoopStart = Math.max(0, Math.min(newValue - 1, instrument.chipWaveLoopStart));
                instrument.preset = instrument.type;
                doc.notifier.changed();
                this._didSomething();
            }
        }
    }
   export class ChangeChipWaveStartOffset extends Change {
        constructor(doc: SongDocument, newValue: number) {
            super();
            const instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
            if (instrument.chipWaveStartOffset != newValue) {
                instrument.isUsingAdvancedLoopControls = true;
                instrument.chipWaveStartOffset = newValue;
                instrument.preset = instrument.type;
                doc.notifier.changed();
                this._didSomething();
            }
        }
    }
   export class ChangeChipWavePlayBackwards extends Change {
        constructor(doc: SongDocument, newValue: boolean) {
            super();
            const instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
            if (instrument.chipWavePlayBackwards != newValue) {
                instrument.isUsingAdvancedLoopControls = true;
                instrument.chipWavePlayBackwards = newValue;
                instrument.preset = instrument.type;
                doc.notifier.changed();
                this._didSomething();
            }
        }
    }
    // advloop addition

export class ChangeNoiseWave extends Change {
    constructor(doc: SongDocument, newValue: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        if (instrument.chipNoise != newValue) {
            instrument.chipNoise = newValue;
            instrument.preset = instrument.type;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeAddEnvelope extends Change {
    constructor(doc: SongDocument) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        instrument.addEnvelope(0, 0, 0, true, 0, instrument.isNoiseInstrument ? Config.drumCount : Config.maxPitch, false, 1, 0);
        instrument.preset = instrument.type;
        doc.notifier.changed();
        this._didSomething();
    }
}

export class ChangeRemoveEnvelope extends Change {
    constructor(doc: SongDocument, index: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        instrument.envelopeCount--;
        for (let i: number = index; i < instrument.envelopeCount; i++) {
            instrument.envelopes[i].target = instrument.envelopes[i + 1].target;
            instrument.envelopes[i].index = instrument.envelopes[i + 1].index;
            instrument.envelopes[i].envelope = instrument.envelopes[i + 1].envelope;
            instrument.envelopes[i].pitchEnvelopeStart = instrument.envelopes[i + 1].pitchEnvelopeStart;
            instrument.envelopes[i].pitchEnvelopeEnd = instrument.envelopes[i + 1].pitchEnvelopeEnd;
            instrument.envelopes[i].inverse = instrument.envelopes[i + 1].inverse;
            instrument.envelopes[i].perEnvelopeSpeed = instrument.envelopes[i + 1].perEnvelopeSpeed;
            instrument.envelopes[i].perEnvelopeLowerBound = instrument.envelopes[i + 1].perEnvelopeLowerBound;
            instrument.envelopes[i].perEnvelopeUpperBound = instrument.envelopes[i + 1].perEnvelopeUpperBound;
            instrument.envelopes[i].steps = instrument.envelopes[i + 1].steps;
            instrument.envelopes[i].seed = instrument.envelopes[i + 1].seed;
            instrument.envelopes[i].waveform = instrument.envelopes[i + 1].waveform;
            instrument.envelopes[i].discrete = instrument.envelopes[i + 1].discrete;
        }
        // TODO: Shift any envelopes that were targeting other envelope indices after the removed one.
        instrument.preset = instrument.type;
        doc.notifier.changed();
        this._didSomething();
    }
}

export class ChangeSetEnvelopeTarget extends Change {
    constructor(doc: SongDocument, envelopeIndex: number, target: number, targetIndex: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        const oldTarget: number = instrument.envelopes[envelopeIndex].target;
        const oldIndex: number = instrument.envelopes[envelopeIndex].index;
        if (oldTarget != target || oldIndex != targetIndex) {
            instrument.envelopes[envelopeIndex].target = target;
            instrument.envelopes[envelopeIndex].index = targetIndex;
            instrument.preset = instrument.type;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeSetEnvelopeType extends Change {
    constructor(doc: SongDocument, envelopeIndex: number, newValue: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        const oldValue: number = instrument.envelopes[envelopeIndex].envelope;
        if (oldValue != newValue) {
            instrument.envelopes[envelopeIndex].envelope = newValue;
            instrument.preset = instrument.type;
            if (oldValue == Config.newEnvelopes.dictionary["none"].index) {
                instrument.envelopes[envelopeIndex].perEnvelopeSpeed = Config.newEnvelopes[newValue].speed;
            }
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeEnvelopePitchStart extends Change {
    constructor(doc: SongDocument, startNote: number, index: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        const oldStartNote: number = instrument.envelopes[index].pitchEnvelopeStart;
        instrument.envelopes[index].pitchEnvelopeStart = startNote;
        if (oldStartNote != startNote) {
            instrument.preset = instrument.type;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeEnvelopePitchEnd extends Change {
    constructor(doc: SongDocument, endNote: number, index: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        const oldEndNote: number = instrument.envelopes[index].pitchEnvelopeEnd;
        instrument.envelopes[index].pitchEnvelopeEnd = endNote;
        if (oldEndNote != endNote) {
            instrument.preset = instrument.type;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeEnvelopeInverse extends Change {
    constructor(doc: SongDocument, value: boolean, index: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        const oldValue: boolean = instrument.envelopes[index].inverse;
        instrument.envelopes[index].inverse = value;
        if (oldValue != value) {
            instrument.preset = instrument.type;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeDiscreteEnvelope extends Change {
    constructor(doc: SongDocument, newValue: boolean, index: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        const oldValue = instrument.envelopes[index].discrete;

        doc.notifier.changed();
        if (oldValue != newValue) {
            instrument.envelopes[index].discrete = newValue;
            instrument.preset = instrument.type;
            this._didSomething();
        }
    }
}

export class ChangePerEnvelopeSpeed extends IndexableChange {
    constructor(doc: SongDocument, oldSpeed: number, speed: number, index: number) {
        super(index, doc);
        this._instrument.envelopes[index].perEnvelopeSpeed = speed;
        doc.synth.unsetMod(Config.modulators.dictionary["individual envelope speed"].index, doc.channel, doc.getCurrentInstrument());
        doc.notifier.changed();
        if (oldSpeed != speed) this._didSomething();
    }
}

export class ChangeEnvelopeLowerBound extends IndexableChange {
    constructor(doc: SongDocument, oldBound: number, bound: number, index: number) {
        super(index, doc);
        bound = bound > Config.perEnvelopeBoundMax ? Config.perEnvelopeBoundMax : bound < Config.perEnvelopeBoundMin ? Config.perEnvelopeBoundMin : Math.round(bound * 10) != bound * 10 ? Config.perEnvelopeBoundMin : bound;
        this._instrument.envelopes[index].perEnvelopeLowerBound = bound;
        doc.synth.unsetMod(Config.modulators.dictionary["individual envelope lower bound"].index, doc.channel, doc.getCurrentInstrument());
        doc.notifier.changed();
        if (oldBound != bound) this._didSomething();
    }
}

export class ChangeEnvelopeUpperBound extends IndexableChange {
    constructor(doc: SongDocument, oldBound: number, bound: number, index: number) {
        super(index, doc);
        bound = bound > Config.perEnvelopeBoundMax ? Config.perEnvelopeBoundMax : bound < Config.perEnvelopeBoundMin ? Config.perEnvelopeBoundMin : Math.round(bound * 10) != bound * 10 ? Config.perEnvelopeBoundMin : bound;
        this._instrument.envelopes[index].perEnvelopeUpperBound = bound;
        doc.synth.unsetMod(Config.modulators.dictionary["individual envelope upper bound"].index, doc.channel, doc.getCurrentInstrument());
        doc.notifier.changed();
        if (oldBound != bound) this._didSomething();
    }
}

export class ChangeRandomEnvelopeSteps extends Change {
    constructor(doc: SongDocument, steps: number, index: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        const oldSteps: number = instrument.envelopes[index].steps;
        steps = steps > Config.randomEnvelopeStepsMax ? Config.randomEnvelopeStepsMax : steps < 1 ? 2 : Math.floor(steps);
        instrument.envelopes[index].steps = steps;
        if (oldSteps != steps) {
            instrument.preset = instrument.type;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class ChangeRandomEnvelopeSeed extends Change {
    constructor(doc: SongDocument, seed: number, index: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        const oldSeed: number = instrument.envelopes[index].seed;
        seed = seed > Config.randomEnvelopeSeedMax ? Config.randomEnvelopeSeedMax : seed < 1 ? 2 : Math.floor(seed);
        instrument.envelopes[index].seed = seed;
        if (oldSeed != seed) {
            //changing the seed does not change the preset
            doc.notifier.changed();
            this._didSomething();
        }
    }
}

export class PasteEnvelope extends Change {
    constructor(doc: SongDocument, envelope: any, index: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        instrument.envelopes[index].fromJsonObject(envelope, "slarmoosbox");
        
        
        instrument.preset = instrument.type;
        doc.notifier.changed();
        this._didSomething();
    }
}

export class ChangeSetEnvelopeWaveform extends Change {
    constructor(doc: SongDocument, waveform: any, index: number) {
        super();
        const instrument: Instrument = doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
        const oldWaveform: number = instrument.envelopes[index].waveform;
        waveform = parseInt(waveform + ""); //make sure waveform isn't a string
        instrument.envelopes[index].waveform = waveform;
        if (oldWaveform != waveform) {
            instrument.preset = instrument.type;
            doc.notifier.changed();
            this._didSomething();
        }
    }
}