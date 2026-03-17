import { createContext, type RefObject } from "react";

import { InstrumentRuntime } from "@/core/audio/engine/instrument/types";
import type { PresetFileV1 } from "@/features/preset/types/preset";

interface DrumhausContextValue {
  instrumentRuntimes: RefObject<InstrumentRuntime[]>;
  instrumentRuntimesVersion: number;
  ensureAudioReady: () => Promise<boolean>;
  loadPreset: (preset: PresetFileV1) => void;
}

const DrumhausContext = createContext<DrumhausContextValue | null>(null);

export { DrumhausContext };
export type { DrumhausContextValue };
