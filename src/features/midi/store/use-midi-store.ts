import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

const DEFAULT_MIDI_DEVICE_CHANNEL = 10;

type MidiPortDescriptor = {
  id: string;
  name: string;
  manufacturer?: string;
  state: MIDIPortDeviceState;
  connection: MIDIPortConnectionState;
};

interface MidiState {
  inputEnabled: boolean;
  outputEnabled: boolean;
  clockEnabled: boolean;
  selectedInputIds: string[];
  selectedClockInputId: string | null;
  inputChannelsById: Record<string, number>;
  inputsInitialized: boolean;
  availableInputs: MidiPortDescriptor[];
  selectedOutputIds: string[];
  outputChannelsById: Record<string, number>;
  outputsInitialized: boolean;
  availableOutputs: MidiPortDescriptor[];
  setInputEnabled: (enabled: boolean) => void;
  setOutputEnabled: (enabled: boolean) => void;
  setClockEnabled: (enabled: boolean) => void;
  setSelectedInputIds: (ids: string[]) => void;
  setSelectedClockInputId: (id: string | null) => void;
  setSelectedOutputIds: (ids: string[]) => void;
  setInputChannelsById: (channels: Record<string, number>) => void;
  setOutputChannelsById: (channels: Record<string, number>) => void;
  syncAvailableInputs: (inputs: MidiPortDescriptor[]) => void;
  syncAvailableOutputs: (outputs: MidiPortDescriptor[]) => void;
  reset: () => void;
}

function withDefaultChannels(
  nextDevices: MidiPortDescriptor[],
  currentChannels: Record<string, number>,
): Record<string, number> {
  const nextChannels = { ...currentChannels };

  for (let index = 0; index < nextDevices.length; index++) {
    const device = nextDevices[index];

    if (nextChannels[device.id] === undefined) {
      nextChannels[device.id] = DEFAULT_MIDI_DEVICE_CHANNEL;
    }
  }

  return nextChannels;
}

function keepOnlyAvailableIds(
  ids: string[],
  devices: MidiPortDescriptor[],
): string[] {
  const availableIds = new Set(devices.map((device) => device.id));
  return ids.filter((id) => availableIds.has(id));
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;

  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }

  return true;
}

function areChannelMapsEqual(
  left: Record<string, number>,
  right: Record<string, number>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  if (leftKeys.length !== rightKeys.length) return false;

  for (let index = 0; index < leftKeys.length; index++) {
    const key = leftKeys[index];
    if (left[key] !== right[key]) return false;
  }

  return true;
}

function arePortListsEqual(
  left: MidiPortDescriptor[],
  right: MidiPortDescriptor[],
): boolean {
  if (left.length !== right.length) return false;

  for (let index = 0; index < left.length; index++) {
    const leftPort = left[index];
    const rightPort = right[index];

    if (
      leftPort.id !== rightPort.id ||
      leftPort.name !== rightPort.name ||
      leftPort.manufacturer !== rightPort.manufacturer ||
      leftPort.state !== rightPort.state ||
      leftPort.connection !== rightPort.connection
    ) {
      return false;
    }
  }

  return true;
}

const useMidiStore = create<MidiState>()(
  devtools(
    persist(
      immer((set) => ({
        inputEnabled: false,
        outputEnabled: false,
        clockEnabled: false,
        selectedInputIds: [],
        selectedClockInputId: null,
        inputChannelsById: {},
        inputsInitialized: false,
        availableInputs: [],
        selectedOutputIds: [],
        outputChannelsById: {},
        outputsInitialized: false,
        availableOutputs: [],

        setInputEnabled: (enabled) => {
          set((state) => {
            state.inputEnabled = enabled;
          });
        },

        setOutputEnabled: (enabled) => {
          set((state) => {
            state.outputEnabled = enabled;
          });
        },

        setClockEnabled: (enabled) => {
          set((state) => {
            state.clockEnabled = enabled;
          });
        },

        setSelectedInputIds: (ids) => {
          set((state) => {
            state.selectedInputIds = ids;
            state.inputsInitialized = true;
          });
        },

        setSelectedClockInputId: (id) => {
          set((state) => {
            state.selectedClockInputId = id;
          });
        },

        setSelectedOutputIds: (ids) => {
          set((state) => {
            state.selectedOutputIds = ids;
            state.outputsInitialized = true;
          });
        },

        setInputChannelsById: (channels) => {
          set((state) => {
            state.inputChannelsById = channels;
          });
        },

        setOutputChannelsById: (channels) => {
          set((state) => {
            state.outputChannelsById = channels;
          });
        },

        syncAvailableInputs: (inputs) => {
          set((state) => {
            const nextInputChannelsById = withDefaultChannels(
              inputs,
              state.inputChannelsById,
            );
            const availableIds = new Set(inputs.map((input) => input.id));
            const nextSelectedInputIds = state.inputsInitialized
              ? keepOnlyAvailableIds(state.selectedInputIds, inputs)
              : inputs.map((input) => input.id);
            const nextSelectedClockInputId =
              state.selectedClockInputId &&
              availableIds.has(state.selectedClockInputId)
                ? state.selectedClockInputId
                : null;
            const nextInputsInitialized = true;

            const hasChanged =
              !arePortListsEqual(state.availableInputs, inputs) ||
              !areChannelMapsEqual(
                state.inputChannelsById,
                nextInputChannelsById,
              ) ||
              !areStringArraysEqual(
                state.selectedInputIds,
                nextSelectedInputIds,
              ) ||
              state.selectedClockInputId !== nextSelectedClockInputId ||
              state.inputsInitialized !== nextInputsInitialized;

            if (!hasChanged) {
              return;
            }

            state.availableInputs = inputs;
            state.inputChannelsById = nextInputChannelsById;
            state.selectedInputIds = nextSelectedInputIds;
            state.selectedClockInputId = nextSelectedClockInputId;
            state.inputsInitialized = nextInputsInitialized;
          });
        },

        syncAvailableOutputs: (outputs) => {
          set((state) => {
            const nextOutputChannelsById = withDefaultChannels(
              outputs,
              state.outputChannelsById,
            );
            const nextSelectedOutputIds = state.outputsInitialized
              ? keepOnlyAvailableIds(state.selectedOutputIds, outputs)
              : outputs.map((output) => output.id);
            const nextOutputsInitialized = true;

            const hasChanged =
              !arePortListsEqual(state.availableOutputs, outputs) ||
              !areChannelMapsEqual(
                state.outputChannelsById,
                nextOutputChannelsById,
              ) ||
              !areStringArraysEqual(
                state.selectedOutputIds,
                nextSelectedOutputIds,
              ) ||
              state.outputsInitialized !== nextOutputsInitialized;

            if (!hasChanged) {
              return;
            }

            state.availableOutputs = outputs;
            state.outputChannelsById = nextOutputChannelsById;
            state.selectedOutputIds = nextSelectedOutputIds;
            state.outputsInitialized = nextOutputsInitialized;
          });
        },

        reset: () => {
          set((state) => {
            state.inputEnabled = false;
            state.outputEnabled = false;
            state.clockEnabled = false;
          });
        },
      })),
      {
        name: "drumhaus-midi-storage",
        partialize: (state) => ({
          inputEnabled: state.inputEnabled,
          outputEnabled: state.outputEnabled,
          clockEnabled: state.clockEnabled,
          selectedInputIds: state.selectedInputIds,
          selectedClockInputId: state.selectedClockInputId,
          inputChannelsById: state.inputChannelsById,
          inputsInitialized: state.inputsInitialized,
          selectedOutputIds: state.selectedOutputIds,
          outputChannelsById: state.outputChannelsById,
          outputsInitialized: state.outputsInitialized,
        }),
      },
    ),
    {
      name: "MidiStore",
    },
  ),
);

export { DEFAULT_MIDI_DEVICE_CHANNEL, useMidiStore };
export type { MidiPortDescriptor };
