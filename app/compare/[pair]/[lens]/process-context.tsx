"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { ProcessInput, StepId } from "./process-model";

// The comparison's stream state, shared with the process panel beside it, the
// strip under it and the overlay route (@process), which all live under this
// segment's layout while the comparison stays mounted.

type Process = {
  input: ProcessInput | null;
  setInput: (input: ProcessInput | null) => void;
  focus: StepId | null; // the step a strip tap asked the overlay to open
  opened: number; // counts those taps: the overlay route is kept (hidden) after Back, so it restarts on each
  openAt: (step: StepId) => void;
};

const ProcessContext = createContext<Process | null>(null);

export function ProcessProvider({ children }: { children: ReactNode }) {
  const [input, setInput] = useState<ProcessInput | null>(null);
  const [focus, setFocus] = useState<StepId | null>(null);
  const [opened, setOpened] = useState(0);
  const openAt = (step: StepId) => {
    setFocus(step);
    setOpened((n) => n + 1);
  };
  return <ProcessContext value={{ input, setInput, focus, opened, openAt }}>{children}</ProcessContext>;
}

export function useProcess(): Process {
  const process = useContext(ProcessContext);
  if (!process) throw new Error("useProcess needs a ProcessProvider (app/compare/[pair]/[lens]/layout.tsx).");
  return process;
}
