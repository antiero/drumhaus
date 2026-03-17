import { RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { Sequence } from "tone/build/esm/index";

import { InstrumentRuntime } from "@/core/audio/engine/instrument/types";
import { useInstrumentsStore } from "@/features/instrument/store/use-instruments-store";
import {
  getMasterChainParams,
  useMasterChainStore,
} from "@/features/master-bus/store/use-master-chain-store";
import { usePatternStore } from "@/features/sequencer/store/use-pattern-store";
import { useTransportStore } from "@/features/transport/store/use-transport-store";
import { prepareSampleSourceResolver } from "../cache/sample";
import {
  connectInstrumentsToMasterChain,
  createDrumSequence,
  createInstrumentRuntimes,
  createMasterChainRuntimes,
  createSoloChangeHandler,
  disposeDrumSequence,
  disposeInstrumentRuntimes,
  disposeMasterChainRuntimes,
  MasterChainRuntimes,
  releaseNonSoloRuntimes,
  startAudioContext,
  subscribeRuntimeToInstrumentParams,
  updateMasterChainParams,
  waitForBuffersToLoad,
} from "../engine";
import { MasterChainParams } from "../engine/fx/masterChain/types";
import { useAudioContextGuards } from "./use-audio-context-guards";

interface UseAudioEngineResult {
  instrumentRuntimes: RefObject<InstrumentRuntime[]>;
  instrumentRuntimesVersion: number;
  ensureAudioReady: () => Promise<boolean>;
}

function useAudioEngine(): UseAudioEngineResult {
  // Guard and recover audio context automatically (visibility/gestures/stall)
  useAudioContextGuards();

  // Audio engine refs (Tone.js runtime nodes)
  const instrumentRuntimes = useRef<InstrumentRuntime[]>([]);
  const [instrumentRuntimesVersion, setInstrumentRuntimesVersion] = useState(0);
  const toneSequence = useRef<Sequence | null>(null);
  const playbackVariationRef = useRef<number>(0);

  const isPlaying = useTransportStore((state) => state.isPlaying);
  const chain = usePatternStore((state) => state.chain);
  const chainEnabled = usePatternStore((state) => state.chainEnabled);
  const activeVariation = usePatternStore((state) => state.variation);

  const instrumentSamplePaths = useInstrumentsStore((state) =>
    state.instruments.map((inst) => inst.sample.path).join(","),
  );

  // Dispose instrument runtimes only on unmount
  useEffect(() => {
    return () => {
      disposeInstrumentRuntimes(instrumentRuntimes.current);
    };
  }, []);

  // Create/update audio sequencer when playing or instruments change
  useEffect(() => {
    if (isPlaying) {
      createDrumSequence(
        toneSequence,
        instrumentRuntimes,
        {
          chain,
          chainEnabled,
          activeVariation,
        },
        playbackVariationRef,
      );
    }

    return () => {
      disposeDrumSequence(toneSequence);
    };
    // Note: activeVariation is intentionally omitted from dependencies.
    // When chainEnabled=true, the chain controls playback (not UI variation).
    // When chainEnabled=false, variation changes are read from store on each bar.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, instrumentRuntimesVersion, chain, chainEnabled]);

  // When any instrument is soloed, immediately release all non-solo runtimes
  useEffect(() => {
    const soloHandler = createSoloChangeHandler(
      () => instrumentRuntimes.current,
      releaseNonSoloRuntimes,
    );

    // Initialize with current state
    soloHandler.getInitialState(useInstrumentsStore.getState().instruments);

    const unsubscribe = useInstrumentsStore.subscribe((state) => {
      soloHandler.handleStateChange(state.instruments);
    });

    return unsubscribe;
  }, []);

  // Rebuild audio engine when samples change
  useEffect(() => {
    if (instrumentSamplePaths.length === 0) {
      return;
    }

    let cancelled = false;

    const instruments = useInstrumentsStore.getState().instruments;
    // Capture old runtimes to dispose after new ones are ready
    const oldRuntimes = instrumentRuntimes.current;

    const loadBuffers = async () => {
      let newRuntimes: InstrumentRuntime[] = [];
      try {
        const samplePaths = instruments.map((inst) => inst.sample.path);
        const resolveSampleSource =
          await prepareSampleSourceResolver(samplePaths);
        newRuntimes = await createInstrumentRuntimes(
          instruments,
          resolveSampleSource,
        );
        await waitForBuffersToLoad();
        if (cancelled) {
          disposeInstrumentRuntimes(newRuntimes);
          return;
        }
        // Swap in new runtimes atomically
        instrumentRuntimes.current = newRuntimes;
        setInstrumentRuntimesVersion((v) => v + 1);

        // Now dispose old runtimes - sequencer has switched to new ones
        disposeInstrumentRuntimes(oldRuntimes);
      } catch (error) {
        if (cancelled) {
          disposeInstrumentRuntimes(newRuntimes);
          return;
        }
        console.error("Error loading audio buffers:", error);
      }
    };

    void loadBuffers();

    return () => {
      cancelled = true;
      // Only dispose current runtimes on unmount, not on kit switch
      // Kit switches are handled by disposing oldRuntimes after swap
    };
  }, [instrumentSamplePaths]);

  // Subscribe all instrument runtimes to their params
  useEffect(() => {
    const unsubscribers = instrumentRuntimes.current.map((runtime, index) =>
      subscribeRuntimeToInstrumentParams(index, runtime),
    );
    return () => unsubscribers.forEach((unsub) => unsub());
  }, [instrumentRuntimesVersion, instrumentRuntimes]);

  // --- Master Chain ---

  // Master Chain Runtimes
  const masterChainRuntimes = useRef<MasterChainRuntimes | null>(null);
  const isInitialized = useRef(false);
  const initPromiseRef = useRef<Promise<boolean> | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const subscribeToMasterChain = useCallback(() => {
    if (unsubscribeRef.current) return;

    let prevParams: MasterChainParams | null = null;

    unsubscribeRef.current = useMasterChainStore.subscribe((state) => {
      if (!masterChainRuntimes.current) return;

      const currentParams = {
        filter: state.filter,
        saturation: state.saturation,
        phaser: state.phaser,
        reverb: state.reverb,
        compThreshold: state.compThreshold,
        compRatio: state.compRatio,
        compAttack: state.compAttack,
        compMix: state.compMix,
        masterVolume: state.masterVolume,
      };

      if (
        !prevParams ||
        prevParams.filter !== currentParams.filter ||
        prevParams.saturation !== currentParams.saturation ||
        prevParams.phaser !== currentParams.phaser ||
        prevParams.reverb !== currentParams.reverb ||
        prevParams.compThreshold !== currentParams.compThreshold ||
        prevParams.compRatio !== currentParams.compRatio ||
        prevParams.compAttack !== currentParams.compAttack ||
        prevParams.compMix !== currentParams.compMix ||
        prevParams.masterVolume !== currentParams.masterVolume
      ) {
        updateMasterChainParams(masterChainRuntimes.current, currentParams);
        prevParams = currentParams;
      }
    });
  }, []);

  const ensureAudioReady = useCallback(async (): Promise<boolean> => {
    const didStartAudio = await startAudioContext();
    if (!didStartAudio) {
      return false;
    }

    if (isInitialized.current && masterChainRuntimes.current) {
      return true;
    }

    if (!initPromiseRef.current) {
      initPromiseRef.current = (async () => {
        disposeMasterChainRuntimes(masterChainRuntimes.current);
        masterChainRuntimes.current = await createMasterChainRuntimes(
          getMasterChainParams(),
        );
        isInitialized.current = true;
        subscribeToMasterChain();

        if (instrumentRuntimes.current.length > 0) {
          connectInstrumentsToMasterChain(
            instrumentRuntimes.current,
            masterChainRuntimes.current,
          );
        }

        return true;
      })().finally(() => {
        initPromiseRef.current = null;
      });
    }

    return await initPromiseRef.current;
  }, [subscribeToMasterChain]);

  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      if (isInitialized.current) {
        disposeMasterChainRuntimes(masterChainRuntimes.current);
        masterChainRuntimes.current = null;
        isInitialized.current = false;
      }
    };
  }, []);

  // Connect instruments to master chain when they change
  useEffect(() => {
    if (!isInitialized.current || !masterChainRuntimes.current) return;

    connectInstrumentsToMasterChain(
      instrumentRuntimes.current,
      masterChainRuntimes.current,
    );
  }, [instrumentRuntimes, instrumentRuntimesVersion]);

  return {
    instrumentRuntimes,
    instrumentRuntimesVersion,
    ensureAudioReady,
  };
}

export { useAudioEngine };
