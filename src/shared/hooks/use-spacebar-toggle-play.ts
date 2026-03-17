import { RefObject, useEffect } from "react";

import { InstrumentRuntime } from "@/core/audio/engine/instrument/types";
import { useTransportStore } from "@/features/transport/store/use-transport-store";
import { useDialogStore } from "@/shared/store/use-dialog-store";

interface UseSpacebarTogglePlayProps {
  instrumentRuntimes: RefObject<InstrumentRuntime[]>;
  instrumentRuntimesVersion: number;
  ensureAudioReady: () => Promise<boolean>;
}

function useSpacebarTogglePlay({
  instrumentRuntimes,
  instrumentRuntimesVersion,
  ensureAudioReady,
}: UseSpacebarTogglePlayProps) {
  const isAnyDialogOpen = useDialogStore((state) => state.isAnyDialogOpen);
  const togglePlay = useTransportStore((state) => state.togglePlay);

  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key !== " ") return;

      const activeElement = document.activeElement;
      const isTextInput =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement instanceof HTMLSelectElement ||
        (activeElement instanceof HTMLElement &&
          activeElement.isContentEditable);

      if (isTextInput) return;

      e.preventDefault();

      if (!isAnyDialogOpen()) {
        void (async () => {
          const didStartAudio = await ensureAudioReady();
          if (!didStartAudio) {
            return;
          }

          await togglePlay(instrumentRuntimes.current);
        })();
      }
    };

    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [
    isAnyDialogOpen,
    ensureAudioReady,
    instrumentRuntimes,
    instrumentRuntimesVersion,
    togglePlay,
  ]);
}

export { useSpacebarTogglePlay };
