import { useAudioEngine } from "@/core/audio/hooks/use-audio-engine";
import { useWebMidi } from "@/core/midi/use-web-midi";
import { usePresetLoading } from "@/features/preset/hooks/use-preset-loading";
import { DrumhausContext, type DrumhausContextValue } from "./drumhaus-context";

interface DrumhausProviderProps {
  children: React.ReactNode;
}

const DrumhausProvider = ({ children }: DrumhausProviderProps) => {
  // --- Audio Engine and Preset Loading ---
  const { instrumentRuntimes, instrumentRuntimesVersion, ensureAudioReady } =
    useAudioEngine();
  useWebMidi({ instrumentRuntimes, ensureAudioReady });
  const { loadPreset } = usePresetLoading({ instrumentRuntimes });

  const value: DrumhausContextValue = {
    instrumentRuntimes,
    instrumentRuntimesVersion,
    ensureAudioReady,
    loadPreset,
  };

  return (
    <DrumhausContext.Provider value={value}>
      {children}
    </DrumhausContext.Provider>
  );
};

export { DrumhausProvider };
