import { SlidersHorizontal } from "lucide-react";

import { buttonActive } from "@/shared/lib/button-active";
import { cn } from "@/shared/lib/utils";
import { useDialogStore } from "@/shared/store/use-dialog-store";
import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui";
import { useMidiStore } from "../store/use-midi-store";

function MidiActions() {
  const openDialog = useDialogStore((state) => state.openDialog);
  const inputEnabled = useMidiStore((state) => state.inputEnabled);
  const outputEnabled = useMidiStore((state) => state.outputEnabled);
  const clockEnabled = useMidiStore((state) => state.clockEnabled);

  const isAnyMidiEnabled = inputEnabled || outputEnabled || clockEnabled;

  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <Button
          variant="hardware-icon"
          size="icon-sm"
          className={cn("h-5 w-5", buttonActive(isAnyMidiEnabled))}
          onClick={() => openDialog("midiSettings")}
          aria-label="Open MIDI settings"
        >
          <SlidersHorizontal size={11} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>MIDI settings</TooltipContent>
    </Tooltip>
  );
}

export { MidiActions };
