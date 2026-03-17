import { getContext, getTransport } from "tone/build/esm/index";

import { TRANSPORT_BPM_RANGE } from "@/core/audio/engine/constants";
import { useInstrumentsStore } from "@/features/instrument/store/use-instruments-store";
import {
  DEFAULT_MIDI_DEVICE_CHANNEL,
  useMidiStore,
  type MidiPortDescriptor,
} from "@/features/midi/store/use-midi-store";
import {
  buildInstrumentMidiNoteMap,
  buildMidiNoteToInstrumentMap,
  DEFAULT_MIDI_CHANNEL,
} from "./gm";

const MIDI_NOTE_ON = 0x90;
const MIDI_NOTE_OFF = 0x80;
const MIDI_CLOCK = 0xf8;
const MIDI_START = 0xfa;
const MIDI_CONTINUE = 0xfb;
const MIDI_STOP = 0xfc;
const MIDI_CLOCK_INTERVAL = "8i";
const MIDI_CLOCKS_PER_QUARTER_NOTE = 24;
const MIDI_CLOCK_HISTORY_SIZE = 24;
const MIDI_CLOCK_WARMUP_TICKS = 6;
const MIDI_CLOCK_TIMEOUT_MS = 250;

type MidiInputHandler = (instrumentIndex: number, velocity: number) => void;
type MidiClockSyncEvent =
  | { type: "bpm"; bpm: number; sourceId: string }
  | { type: "start"; sourceId: string }
  | { type: "stop"; sourceId: string };
type MidiClockSyncHandler = (event: MidiClockSyncEvent) => void;

type MidiOutputWithChannel = {
  output: MIDIOutput;
  channel: number;
};

let midiAccess: MIDIAccess | null = null;
let midiAccessPromise: Promise<MIDIAccess> | null = null;
let midiInputHandler: MidiInputHandler | null = null;
let midiClockSyncHandler: MidiClockSyncHandler | null = null;
let midiClockEventId: number | null = null;
const midiClockState = {
  sourceId: null as string | null,
  lastTimestamp: null as number | null,
  deltas: [] as number[],
  lastEmittedBpm: null as number | null,
};

function supportsWebMidi(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.requestMIDIAccess === "function"
  );
}

function getWebMidiErrorMessage(error: unknown): string {
  if (!supportsWebMidi()) {
    return "This browser does not support WebMIDI.";
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "WebMIDI access could not be initialized.";
}

async function ensureWebMidiAccess(): Promise<MIDIAccess> {
  if (midiAccess) {
    return midiAccess;
  }

  if (!supportsWebMidi()) {
    throw new Error("This browser does not support WebMIDI.");
  }

  if (!midiAccessPromise) {
    midiAccessPromise = navigator
      .requestMIDIAccess()
      .then((access) => {
        midiAccess = access;
        access.onstatechange = () => {
          syncMidiInputs();
          syncMidiOutputs();
        };
        syncMidiInputs();
        syncMidiOutputs();
        return access;
      })
      .catch((error: unknown) => {
        midiAccessPromise = null;
        throw error;
      });
  }

  return midiAccessPromise;
}

function setMidiInputHandler(handler: MidiInputHandler | null): void {
  midiInputHandler = handler;
}

function setMidiClockSyncHandler(handler: MidiClockSyncHandler | null): void {
  midiClockSyncHandler = handler;
}

function resetMidiClockTracking(sourceId?: string): void {
  midiClockState.sourceId = sourceId ?? null;
  midiClockState.lastTimestamp = null;
  midiClockState.deltas = [];
  midiClockState.lastEmittedBpm = null;
}

function clampBpm(bpm: number): number {
  return Math.max(
    TRANSPORT_BPM_RANGE[0],
    Math.min(TRANSPORT_BPM_RANGE[1], bpm),
  );
}

function emitMidiClockSyncEvent(event: MidiClockSyncEvent): void {
  midiClockSyncHandler?.(event);
}

function processMidiClockTick(sourceId: string, timestamp: number): void {
  if (midiClockState.sourceId !== sourceId) {
    resetMidiClockTracking(sourceId);
  }

  const lastTimestamp = midiClockState.lastTimestamp;
  midiClockState.sourceId = sourceId;
  midiClockState.lastTimestamp = timestamp;

  if (lastTimestamp === null) {
    return;
  }

  const delta = timestamp - lastTimestamp;

  if (!Number.isFinite(delta) || delta <= 0 || delta > MIDI_CLOCK_TIMEOUT_MS) {
    midiClockState.deltas = [];
    midiClockState.lastEmittedBpm = null;
    return;
  }

  midiClockState.deltas.push(delta);
  if (midiClockState.deltas.length > MIDI_CLOCK_HISTORY_SIZE) {
    midiClockState.deltas.shift();
  }

  if (midiClockState.deltas.length < MIDI_CLOCK_WARMUP_TICKS) {
    return;
  }

  const averageDelta =
    midiClockState.deltas.reduce((sum, value) => sum + value, 0) /
    midiClockState.deltas.length;
  const bpm = clampBpm(60000 / (averageDelta * MIDI_CLOCKS_PER_QUARTER_NOTE));
  const roundedBpm = Math.round(bpm);

  if (midiClockState.lastEmittedBpm === roundedBpm) {
    return;
  }

  midiClockState.lastEmittedBpm = roundedBpm;
  emitMidiClockSyncEvent({
    type: "bpm",
    bpm: roundedBpm,
    sourceId,
  });
}

function toWebMidiTimestamp(audioTimeSeconds?: number): number | undefined {
  if (audioTimeSeconds === undefined) {
    return undefined;
  }

  const currentAudioTime = getContext().currentTime;
  const deltaMilliseconds = Math.max(
    0,
    (audioTimeSeconds - currentAudioTime) * 1000,
  );

  return performance.now() + deltaMilliseconds;
}

function getMidiInputs(): MIDIInput[] {
  if (!midiAccess) return [];
  return Array.from(midiAccess.inputs.values());
}

function getMidiOutputs(): MIDIOutput[] {
  if (!midiAccess) return [];
  return Array.from(midiAccess.outputs.values());
}

function toPortDescriptor<T extends MIDIPort>(port: T): MidiPortDescriptor {
  return {
    id: port.id,
    name: port.name ?? `Unnamed MIDI ${port.type}`,
    manufacturer: port.manufacturer ?? undefined,
    state: port.state,
    connection: port.connection,
  };
}

function syncMidiOutputs(): void {
  if (!midiAccess) return;

  useMidiStore
    .getState()
    .syncAvailableOutputs(
      getMidiOutputs().map((output) => toPortDescriptor(output)),
    );
}

function getSelectedMidiOutputConfigs(): MidiOutputWithChannel[] {
  const outputs = getMidiOutputs();
  const { outputChannelsById, outputsInitialized, selectedOutputIds } =
    useMidiStore.getState();

  const selectedIds = outputsInitialized
    ? new Set(selectedOutputIds)
    : new Set(outputs.map((output) => output.id));

  const selectedOutputs =
    outputsInitialized && selectedOutputIds.length === 0
      ? []
      : outputs.filter((output) => selectedIds.has(output.id));

  return selectedOutputs.map((output) => ({
    output,
    channel: outputChannelsById[output.id] ?? DEFAULT_MIDI_DEVICE_CHANNEL,
  }));
}

function sendMidiMessage(
  output: MIDIOutput,
  data: number[],
  timestamp?: number,
): void {
  try {
    if (timestamp === undefined) {
      output.send(data);
    } else {
      output.send(data, timestamp);
    }
  } catch (error) {
    console.warn("[midi] Failed to send MIDI message:", error);
  }
}

function sendRawMidi(
  data: number[],
  timestamp?: number,
  {
    requiresOutputToggle = false,
  }: {
    requiresOutputToggle?: boolean;
  } = {},
): void {
  if (!midiAccess) return;
  if (requiresOutputToggle && !useMidiStore.getState().outputEnabled) return;

  const outputs = getSelectedMidiOutputConfigs();
  if (outputs.length === 0) return;

  for (let index = 0; index < outputs.length; index++) {
    sendMidiMessage(outputs[index].output, data, timestamp);
  }
}

function sendMidiInstrumentNoteAtTime(
  instrumentIndex: number,
  decaySeconds: number,
  velocity: number = 1,
  timeSeconds?: number,
): void {
  if (!useMidiStore.getState().outputEnabled) return;
  if (!midiAccess) return;

  const outputs = getSelectedMidiOutputConfigs();
  if (outputs.length === 0) return;

  const instruments = useInstrumentsStore.getState().instruments;
  const instrumentNotes = buildInstrumentMidiNoteMap(instruments);
  const note = instrumentNotes[instrumentIndex];

  if (note === undefined) return;

  const midiVelocity = Math.max(1, Math.min(127, Math.round(velocity * 127)));
  const noteOnTimestamp = toWebMidiTimestamp(timeSeconds);
  const noteOffTime =
    timeSeconds !== undefined
      ? timeSeconds + Math.max(0.05, decaySeconds)
      : undefined;
  const noteOffTimestamp =
    noteOffTime !== undefined
      ? toWebMidiTimestamp(noteOffTime)
      : performance.now() + Math.max(50, decaySeconds * 1000);

  for (let index = 0; index < outputs.length; index++) {
    const { output, channel } = outputs[index];
    const channelIndex = Math.max(0, Math.min(15, channel - 1));

    sendMidiMessage(
      output,
      [MIDI_NOTE_ON | channelIndex, note, midiVelocity],
      noteOnTimestamp,
    );
    sendMidiMessage(
      output,
      [MIDI_NOTE_OFF | channelIndex, note, 0],
      noteOffTimestamp,
    );
  }
}

function sendMidiInstrumentNoteOffAtTime(
  instrumentIndex: number,
  timeSeconds?: number,
): void {
  if (!useMidiStore.getState().outputEnabled) return;
  if (!midiAccess) return;

  const outputs = getSelectedMidiOutputConfigs();
  if (outputs.length === 0) return;

  const instruments = useInstrumentsStore.getState().instruments;
  const instrumentNotes = buildInstrumentMidiNoteMap(instruments);
  const note = instrumentNotes[instrumentIndex];

  if (note === undefined) return;

  const timestamp = toWebMidiTimestamp(timeSeconds);

  for (let index = 0; index < outputs.length; index++) {
    const { output, channel } = outputs[index];
    const channelIndex = Math.max(0, Math.min(15, channel - 1));

    sendMidiMessage(output, [MIDI_NOTE_OFF | channelIndex, note, 0], timestamp);
  }
}

function sendMidiClockAtTime(timeSeconds?: number): void {
  if (!useMidiStore.getState().clockEnabled) return;

  sendRawMidi([MIDI_CLOCK], toWebMidiTimestamp(timeSeconds));
}

function sendMidiTransportStart(timeSeconds?: number): void {
  if (!useMidiStore.getState().clockEnabled) return;

  syncMidiClockScheduler();
  sendRawMidi([MIDI_START], toWebMidiTimestamp(timeSeconds));
}

function sendMidiTransportStop(timeSeconds?: number): void {
  if (!useMidiStore.getState().clockEnabled) return;

  sendRawMidi([MIDI_STOP], toWebMidiTimestamp(timeSeconds));
}

function clearMidiClockScheduler(): void {
  if (midiClockEventId === null) return;

  getTransport().clear(midiClockEventId);
  midiClockEventId = null;
}

function syncMidiClockScheduler(): void {
  if (!useMidiStore.getState().clockEnabled || !midiAccess) {
    clearMidiClockScheduler();
    return;
  }

  if (midiClockEventId !== null) return;

  midiClockEventId = getTransport().scheduleRepeat((time) => {
    sendMidiClockAtTime(time);
  }, MIDI_CLOCK_INTERVAL);
}

function handleMidiRealtimeMessage(
  sourceId: string,
  event: MIDIMessageEvent,
): boolean {
  const { clockEnabled, selectedClockInputId } = useMidiStore.getState();
  if (
    !clockEnabled ||
    !selectedClockInputId ||
    sourceId !== selectedClockInputId
  ) {
    return false;
  }

  const data = event.data;
  if (!data || data.length === 0) {
    return false;
  }

  const status = data[0];

  switch (status) {
    case MIDI_CLOCK: {
      const timestamp =
        typeof event.timeStamp === "number"
          ? event.timeStamp
          : performance.now();
      processMidiClockTick(sourceId, timestamp);
      return true;
    }
    case MIDI_START:
    case MIDI_CONTINUE:
      resetMidiClockTracking(sourceId);
      emitMidiClockSyncEvent({ type: "start", sourceId });
      return true;
    case MIDI_STOP:
      resetMidiClockTracking(sourceId);
      emitMidiClockSyncEvent({ type: "stop", sourceId });
      return true;
    default:
      return false;
  }
}

function handleMidiMessage(sourceId: string, event: MIDIMessageEvent): void {
  handleMidiRealtimeMessage(sourceId, event);

  const {
    inputChannelsById,
    inputEnabled,
    inputsInitialized,
    selectedInputIds,
  } = useMidiStore.getState();

  if (!inputEnabled || !midiInputHandler) return;

  if (inputsInitialized && !selectedInputIds.includes(sourceId)) {
    return;
  }

  const data = event.data;
  if (!data || data.length < 3) return;

  const [status, note, velocity] = data;
  const messageType = status & 0xf0;
  const channel = status & 0x0f;
  const selectedChannel =
    inputChannelsById[sourceId] ?? DEFAULT_MIDI_DEVICE_CHANNEL;

  if (channel !== selectedChannel - 1) return;
  if (messageType !== MIDI_NOTE_ON || velocity === 0) return;

  const instruments = useInstrumentsStore.getState().instruments;
  const noteMap = buildMidiNoteToInstrumentMap(instruments);
  const instrumentIndex = noteMap.get(note);

  if (instrumentIndex === undefined) return;

  midiInputHandler(instrumentIndex, velocity / 127);
}

function syncMidiInputs(): void {
  if (!midiAccess) return;

  const inputs = getMidiInputs();
  useMidiStore
    .getState()
    .syncAvailableInputs(inputs.map((input) => toPortDescriptor(input)));

  const {
    clockEnabled,
    inputEnabled,
    inputsInitialized,
    selectedClockInputId,
    selectedInputIds,
  } = useMidiStore.getState();

  const selectedIds = inputsInitialized
    ? new Set(selectedInputIds)
    : new Set(inputs.map((input) => input.id));

  for (let index = 0; index < inputs.length; index++) {
    const input = inputs[index];
    const shouldListenForNotes = inputEnabled && selectedIds.has(input.id);
    const shouldListenForClock =
      clockEnabled && selectedClockInputId === input.id;
    const shouldListen = shouldListenForNotes || shouldListenForClock;
    input.onmidimessage = shouldListen
      ? (event) => handleMidiMessage(input.id, event)
      : null;
  }
}

export {
  DEFAULT_MIDI_CHANNEL,
  ensureWebMidiAccess,
  getWebMidiErrorMessage,
  resetMidiClockTracking,
  setMidiClockSyncHandler,
  setMidiInputHandler,
  supportsWebMidi,
  sendMidiInstrumentNoteAtTime,
  sendMidiInstrumentNoteOffAtTime,
  sendMidiTransportStart,
  sendMidiTransportStop,
  syncMidiClockScheduler,
  syncMidiInputs,
  syncMidiOutputs,
};
