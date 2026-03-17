import { useEffect, useRef, type RefObject } from "react";

import { triggerInstrument } from "@/core/audio/engine";
import type { InstrumentRuntime } from "@/core/audio/engine/instrument/types";
import { useInstrumentsStore } from "@/features/instrument/store/use-instruments-store";
import { useMidiStore } from "@/features/midi/store/use-midi-store";
import { useTransportStore } from "@/features/transport/store/use-transport-store";
import { useToast } from "@/shared/ui";
import {
  ensureWebMidiAccess,
  getWebMidiErrorMessage,
  resetMidiClockTracking,
  setMidiClockSyncHandler,
  setMidiInputHandler,
  syncMidiClockScheduler,
  syncMidiInputs,
  syncMidiOutputs,
} from "./web-midi";

interface UseWebMidiProps {
  instrumentRuntimes: RefObject<InstrumentRuntime[]>;
  ensureAudioReady: () => Promise<boolean>;
}

function useWebMidi({
  instrumentRuntimes,
  ensureAudioReady,
}: UseWebMidiProps): void {
  const inputEnabled = useMidiStore((state) => state.inputEnabled);
  const outputEnabled = useMidiStore((state) => state.outputEnabled);
  const clockEnabled = useMidiStore((state) => state.clockEnabled);
  const selectedClockInputId = useMidiStore(
    (state) => state.selectedClockInputId,
  );
  const selectedInputIds = useMidiStore((state) => state.selectedInputIds);
  const resetMidi = useMidiStore((state) => state.reset);
  const setBpm = useTransportStore((state) => state.setBpm);
  const { toast } = useToast();

  const reportedErrorRef = useRef<string | null>(null);

  useEffect(() => {
    setMidiInputHandler((instrumentIndex, velocity) => {
      void (async () => {
        const didStartAudio = await ensureAudioReady();
        if (!didStartAudio) {
          return;
        }

        const runtime = instrumentRuntimes.current[instrumentIndex];
        const instrument =
          useInstrumentsStore.getState().instruments[instrumentIndex];

        if (!runtime || !instrument) {
          return;
        }

        await triggerInstrument(
          runtime,
          instrument.params.tune,
          instrument.params.decay,
          {
            velocity,
            sendMidi: false,
          },
        );
      })();
    });

    return () => {
      setMidiInputHandler(null);
    };
  }, [ensureAudioReady, instrumentRuntimes]);

  useEffect(() => {
    setMidiClockSyncHandler((event) => {
      if (event.type === "bpm") {
        setBpm(event.bpm);
      }
    });

    return () => {
      setMidiClockSyncHandler(null);
    };
  }, [setBpm]);

  useEffect(() => {
    if (!clockEnabled) {
      resetMidiClockTracking();
      return;
    }

    resetMidiClockTracking(selectedClockInputId ?? undefined);
  }, [clockEnabled, selectedClockInputId]);

  useEffect(() => {
    let cancelled = false;

    const syncWebMidi = async () => {
      if (!inputEnabled && !outputEnabled && !clockEnabled) {
        syncMidiInputs();
        syncMidiClockScheduler();
        reportedErrorRef.current = null;
        return;
      }

      try {
        await ensureWebMidiAccess();

        if (cancelled) return;

        syncMidiInputs();
        syncMidiClockScheduler();
        syncMidiOutputs();
        reportedErrorRef.current = null;
      } catch (error) {
        if (cancelled) return;

        resetMidi();
        syncMidiInputs();
        syncMidiClockScheduler();

        const description = getWebMidiErrorMessage(error);
        if (reportedErrorRef.current === description) return;

        reportedErrorRef.current = description;
        toast({
          title: "WebMIDI unavailable",
          description,
          status: "error",
          duration: 6000,
        });
      }
    };

    void syncWebMidi();

    return () => {
      cancelled = true;
    };
  }, [
    clockEnabled,
    inputEnabled,
    outputEnabled,
    resetMidi,
    selectedClockInputId,
    selectedInputIds,
    toast,
  ]);
}

export { useWebMidi };
