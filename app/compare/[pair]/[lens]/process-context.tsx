"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { ProcessInput, StepId } from "./process-model";
import type { ThemeContent } from "./text-tiles";

// The comparison's stream state, shared with the process panel beside it, the
// strip under it and the overlay route (@process), which all live under this
// segment's layout while the comparison stays mounted.

export type Theme = { key: string; content: ThemeContent };

type Process = {
  input: ProcessInput | null;
  setInput: (input: ProcessInput | null) => void;
  focus: StepId | null; // the step a strip tap asked the overlay to open
  opened: number; // counts those taps: the overlay route is kept (hidden) after Back, so it restarts on each
  openAt: (step: StepId) => void;
  theme: Theme | null; // a text-lens subject shown in the desktop panel in place of the steps
  setTheme: (theme: Theme | null) => void;
};

const ProcessContext = createContext<Process | null>(null);

export function ProcessProvider({ children }: { children: ReactNode }) {
  const [input, setInput] = useState<ProcessInput | null>(null);
  const [focus, setFocus] = useState<StepId | null>(null);
  const [opened, setOpened] = useState(0);
  const [theme, setTheme] = useState<Theme | null>(null);
  const openAt = (step: StepId) => {
    setFocus(step);
    setOpened((n) => n + 1);
  };
  return <ProcessContext value={{ input, setInput, focus, opened, openAt, theme, setTheme }}>{children}</ProcessContext>;
}

export function useProcess(): Process {
  const process = useContext(ProcessContext);
  if (!process) throw new Error("useProcess needs a ProcessProvider (app/compare/[pair]/[lens]/layout.tsx).");
  return process;
}
