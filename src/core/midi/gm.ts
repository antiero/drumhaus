import type {
  InstrumentData,
  InstrumentRole,
} from "@/core/audio/engine/instrument/types";

const DEFAULT_MIDI_CHANNEL = 10;
const DEFAULT_MIDI_CHANNEL_INDEX = DEFAULT_MIDI_CHANNEL - 1;

const PAD_FALLBACK_NOTES = [36, 35, 38, 39, 42, 46, 45, 47] as const;
const UNIVERSAL_FALLBACK_NOTES = [
  36, 35, 38, 40, 39, 42, 44, 46, 45, 47, 49, 50, 51, 53, 55, 57,
] as const;

const GM_ROLE_NOTE_CANDIDATES: Record<InstrumentRole, readonly number[]> = {
  kick: [36, 35],
  snare: [38, 40],
  clap: [39],
  hat: [42, 44, 22],
  ohat: [46, 26],
  tom: [45, 47, 50, 41, 43, 48],
  perc: [47, 50, 51, 56, 75],
  crash: [49, 57, 52],
  bass: [35, 36],
  synth: [47, 50, 53, 55],
  other: [45, 47, 50, 51],
};

function rotateCandidates(
  candidates: readonly number[],
  startIndex: number,
): number[] {
  if (candidates.length === 0) return [];

  const safeStartIndex = Math.min(startIndex, candidates.length - 1);
  return [
    ...candidates.slice(safeStartIndex),
    ...candidates.slice(0, safeStartIndex),
  ];
}

function buildInstrumentMidiNoteMap(instruments: InstrumentData[]): number[] {
  const usedNotes = new Set<number>();
  const roleCounts = new Map<InstrumentRole, number>();

  return instruments.map((instrument, index) => {
    const role = instrument.role;
    const occurrence = roleCounts.get(role) ?? 0;
    roleCounts.set(role, occurrence + 1);

    const roleCandidates = rotateCandidates(
      GM_ROLE_NOTE_CANDIDATES[role] ?? GM_ROLE_NOTE_CANDIDATES.other,
      occurrence,
    );
    const fallbackNote = PAD_FALLBACK_NOTES[index % PAD_FALLBACK_NOTES.length];
    const candidates = [
      ...roleCandidates,
      fallbackNote,
      ...PAD_FALLBACK_NOTES,
      ...UNIVERSAL_FALLBACK_NOTES,
    ];

    const note =
      candidates.find((candidate) => !usedNotes.has(candidate)) ?? fallbackNote;

    usedNotes.add(note);
    return note;
  });
}

function buildMidiNoteToInstrumentMap(
  instruments: InstrumentData[],
): Map<number, number> {
  const noteMap = new Map<number, number>();
  const instrumentNotes = buildInstrumentMidiNoteMap(instruments);

  for (let index = 0; index < instrumentNotes.length; index++) {
    noteMap.set(instrumentNotes[index], index);
  }

  return noteMap;
}

export {
  DEFAULT_MIDI_CHANNEL,
  DEFAULT_MIDI_CHANNEL_INDEX,
  buildInstrumentMidiNoteMap,
  buildMidiNoteToInstrumentMap,
};
