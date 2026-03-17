import { useEffect, useState } from "react";
import { ArrowDownToLine, ArrowUpToLine, Clock3 } from "lucide-react";

import {
  ensureWebMidiAccess,
  getWebMidiErrorMessage,
  syncMidiInputs,
  syncMidiOutputs,
} from "@/core/midi/web-midi";
import {
  DEFAULT_MIDI_DEVICE_CHANNEL,
  useMidiStore,
  type MidiPortDescriptor,
} from "@/features/midi/store/use-midi-store";
import { buttonActive } from "@/shared/lib/button-active";
import { cn } from "@/shared/lib/utils";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui";

interface MidiOutputsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const MIDI_CHANNEL_OPTIONS = Array.from(
  { length: 16 },
  (_, index) => index + 1,
);
const NO_CLOCK_SOURCE_VALUE = "__none__";

function portSubtitle(port: MidiPortDescriptor): string {
  const parts = [port.manufacturer, port.connection, port.state].filter(
    Boolean,
  );
  return parts.join(" • ");
}

function toggleDraftSelection(
  ids: string[],
  deviceId: string,
  checked: boolean,
): string[] {
  if (checked) {
    if (ids.includes(deviceId)) return ids;
    return [...ids, deviceId];
  }

  return ids.filter((id) => id !== deviceId);
}

function MidiOutputsDialog({ isOpen, onClose }: MidiOutputsDialogProps) {
  const inputEnabled = useMidiStore((state) => state.inputEnabled);
  const outputEnabled = useMidiStore((state) => state.outputEnabled);
  const clockEnabled = useMidiStore((state) => state.clockEnabled);
  const availableInputs = useMidiStore((state) => state.availableInputs);
  const availableOutputs = useMidiStore((state) => state.availableOutputs);
  const selectedInputIds = useMidiStore((state) => state.selectedInputIds);
  const selectedClockInputId = useMidiStore(
    (state) => state.selectedClockInputId,
  );
  const selectedOutputIds = useMidiStore((state) => state.selectedOutputIds);
  const inputChannelsById = useMidiStore((state) => state.inputChannelsById);
  const outputChannelsById = useMidiStore((state) => state.outputChannelsById);
  const setInputEnabled = useMidiStore((state) => state.setInputEnabled);
  const setOutputEnabled = useMidiStore((state) => state.setOutputEnabled);
  const setClockEnabled = useMidiStore((state) => state.setClockEnabled);
  const setSelectedInputIds = useMidiStore(
    (state) => state.setSelectedInputIds,
  );
  const setSelectedClockInputId = useMidiStore(
    (state) => state.setSelectedClockInputId,
  );
  const setSelectedOutputIds = useMidiStore(
    (state) => state.setSelectedOutputIds,
  );
  const setInputChannelsById = useMidiStore(
    (state) => state.setInputChannelsById,
  );
  const setOutputChannelsById = useMidiStore(
    (state) => state.setOutputChannelsById,
  );

  const [draftInputEnabled, setDraftInputEnabled] = useState(inputEnabled);
  const [draftOutputEnabled, setDraftOutputEnabled] = useState(outputEnabled);
  const [draftClockEnabled, setDraftClockEnabled] = useState(clockEnabled);
  const [draftSelectedInputIds, setDraftSelectedInputIds] =
    useState<string[]>(selectedInputIds);
  const [draftSelectedClockInputId, setDraftSelectedClockInputId] = useState<
    string | null
  >(selectedClockInputId);
  const [draftSelectedOutputIds, setDraftSelectedOutputIds] =
    useState<string[]>(selectedOutputIds);
  const [draftInputChannelsById, setDraftInputChannelsById] =
    useState<Record<string, number>>(inputChannelsById);
  const [draftOutputChannelsById, setDraftOutputChannelsById] =
    useState<Record<string, number>>(outputChannelsById);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    setDraftInputEnabled(inputEnabled);
    setDraftOutputEnabled(outputEnabled);
    setDraftClockEnabled(clockEnabled);
    setDraftSelectedInputIds(selectedInputIds);
    setDraftSelectedClockInputId(selectedClockInputId);
    setDraftSelectedOutputIds(selectedOutputIds);
    setDraftInputChannelsById(inputChannelsById);
    setDraftOutputChannelsById(outputChannelsById);
  }, [
    clockEnabled,
    inputChannelsById,
    inputEnabled,
    isOpen,
    outputChannelsById,
    outputEnabled,
    selectedClockInputId,
    selectedInputIds,
    selectedOutputIds,
  ]);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    const loadPorts = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        await ensureWebMidiAccess();
        if (cancelled) return;

        syncMidiInputs();
        syncMidiOutputs();
      } catch (error) {
        if (cancelled) return;

        setErrorMessage(getWebMidiErrorMessage(error));
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadPorts();

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const handleClose = () => {
    setDraftInputEnabled(inputEnabled);
    setDraftOutputEnabled(outputEnabled);
    setDraftClockEnabled(clockEnabled);
    setDraftSelectedInputIds(selectedInputIds);
    setDraftSelectedClockInputId(selectedClockInputId);
    setDraftSelectedOutputIds(selectedOutputIds);
    setDraftInputChannelsById(inputChannelsById);
    setDraftOutputChannelsById(outputChannelsById);
    setErrorMessage(null);
    onClose();
  };

  const handleSave = () => {
    setInputEnabled(draftInputEnabled);
    setOutputEnabled(draftOutputEnabled);
    setClockEnabled(draftClockEnabled);
    setSelectedInputIds(draftSelectedInputIds);
    setSelectedClockInputId(draftSelectedClockInputId);
    setSelectedOutputIds(draftSelectedOutputIds);
    setInputChannelsById(draftInputChannelsById);
    setOutputChannelsById(draftOutputChannelsById);
    onClose();
  };

  const toggleDraftClock = () => {
    const nextEnabled = !draftClockEnabled;
    setDraftClockEnabled(nextEnabled);

    if (
      nextEnabled &&
      draftSelectedClockInputId === null &&
      availableInputs.length > 0
    ) {
      setDraftSelectedClockInputId(availableInputs[0].id);
    }
  };

  const renderPortRows = (
    ports: MidiPortDescriptor[],
    selectedIds: string[],
    onSelectedIdsChange: (nextIds: string[]) => void,
    channelsById: Record<string, number>,
    onChannelsByIdChange: (nextChannels: Record<string, number>) => void,
    emptyMessage: string,
  ) => {
    if (ports.length === 0) {
      return <p className="text-muted-foreground text-sm">{emptyMessage}</p>;
    }

    return (
      <div className="space-y-2">
        {ports.map((port) => {
          const checkboxId = `midi-port-${port.id}`;
          const subtitle = portSubtitle(port);
          const isSelected = selectedIds.includes(port.id);
          const selectedChannel =
            channelsById[port.id] ?? DEFAULT_MIDI_DEVICE_CHANNEL;

          return (
            <div
              key={port.id}
              className="bg-secondary/35 grid grid-cols-[auto_minmax(0,1fr)_5.5rem] items-start gap-3 rounded-md border px-3 py-2"
            >
              <Checkbox
                id={checkboxId}
                checked={isSelected}
                onCheckedChange={(checked) =>
                  onSelectedIdsChange(
                    toggleDraftSelection(
                      selectedIds,
                      port.id,
                      checked === true,
                    ),
                  )
                }
              />
              <Label
                htmlFor={checkboxId}
                className="flex cursor-pointer flex-col items-start gap-1"
              >
                <span className="text-sm font-medium">{port.name}</span>
                {subtitle.length > 0 && (
                  <span className="text-muted-foreground text-xs">
                    {subtitle}
                  </span>
                )}
              </Label>

              <Select
                value={String(selectedChannel)}
                onValueChange={(value) =>
                  onChannelsByIdChange({
                    ...channelsById,
                    [port.id]: Number(value),
                  })
                }
              >
                <SelectTrigger
                  size="sm"
                  className="h-8 w-full bg-white/60 px-2 py-1 text-xs"
                  disabled={!isSelected}
                >
                  <SelectValue placeholder="Ch 10" />
                </SelectTrigger>
                <SelectContent>
                  {MIDI_CHANNEL_OPTIONS.map((channel) => (
                    <SelectItem key={channel} value={String(channel)}>
                      Ch {channel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>MIDI Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 pb-6">
          <DialogDescription>
            Enable MIDI routing, choose which ports Drumhaus listens to or sends
            to, choose a dedicated clock source, and set the channel for each
            note device.
          </DialogDescription>

          {errorMessage ? (
            <p className="text-sm text-red-600">{errorMessage}</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Button
                  type="button"
                  variant="outline"
                  className={cn(
                    "justify-start gap-2",
                    buttonActive(draftInputEnabled),
                  )}
                  onClick={() => setDraftInputEnabled(!draftInputEnabled)}
                >
                  <ArrowDownToLine size={14} />
                  MIDI In
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className={cn(
                    "justify-start gap-2",
                    buttonActive(draftOutputEnabled),
                  )}
                  onClick={() => setDraftOutputEnabled(!draftOutputEnabled)}
                >
                  <ArrowUpToLine size={14} />
                  MIDI Out
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className={cn(
                    "justify-start gap-2",
                    buttonActive(draftClockEnabled),
                  )}
                  onClick={toggleDraftClock}
                >
                  <Clock3 size={14} />
                  MIDI Clock
                </Button>
              </div>

              <section className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold">Clock Source</h3>
                  <p className="text-muted-foreground text-sm">
                    Choose the input Drumhaus should follow for incoming MIDI
                    clock. BPM updates follow this port only.
                  </p>
                </div>
                {isLoading ? (
                  <p className="text-muted-foreground text-sm">
                    Looking for available MIDI inputs...
                  </p>
                ) : availableInputs.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    No MIDI inputs are currently available.
                  </p>
                ) : (
                  <Select
                    value={draftSelectedClockInputId ?? NO_CLOCK_SOURCE_VALUE}
                    onValueChange={(value) =>
                      setDraftSelectedClockInputId(
                        value === NO_CLOCK_SOURCE_VALUE ? null : value,
                      )
                    }
                  >
                    <SelectTrigger
                      className="w-full bg-white/60"
                      disabled={!draftClockEnabled}
                    >
                      <SelectValue placeholder="Select a MIDI clock source" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_CLOCK_SOURCE_VALUE}>
                        No clock source
                      </SelectItem>
                      {availableInputs.map((port) => (
                        <SelectItem key={port.id} value={port.id}>
                          {port.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </section>

              <section className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold">MIDI Sources</h3>
                  <p className="text-muted-foreground text-sm">
                    Drumhaus listens for note input on checked ports and the
                    selected channel. Clock source selection is independent.
                  </p>
                </div>
                {isLoading ? (
                  <p className="text-muted-foreground text-sm">
                    Looking for available MIDI inputs...
                  </p>
                ) : (
                  renderPortRows(
                    availableInputs,
                    draftSelectedInputIds,
                    setDraftSelectedInputIds,
                    draftInputChannelsById,
                    setDraftInputChannelsById,
                    "No MIDI inputs are currently available.",
                  )
                )}
              </section>

              <section className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold">MIDI Destinations</h3>
                  <p className="text-muted-foreground text-sm">
                    Drumhaus sends note output to checked destinations on the
                    selected channel. When MIDI Clock is enabled, Drumhaus also
                    sends transport clock to the same destination list.
                  </p>
                </div>
                {isLoading ? (
                  <p className="text-muted-foreground text-sm">
                    Looking for available MIDI outputs...
                  </p>
                ) : (
                  renderPortRows(
                    availableOutputs,
                    draftSelectedOutputIds,
                    setDraftSelectedOutputIds,
                    draftOutputChannelsById,
                    setDraftOutputChannelsById,
                    "No MIDI outputs are currently available.",
                  )
                )}
              </section>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" type="button" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={Boolean(errorMessage) || isLoading}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { MidiOutputsDialog };
