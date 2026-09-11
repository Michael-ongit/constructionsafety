import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "ehs-chat-theme";

function resolveSystemTheme() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function useTheme() {
  const [mode, setMode] = useState(() => localStorage.getItem(STORAGE_KEY) || "system");
  const [resolved, setResolved] = useState(() => (mode === "system" ? resolveSystemTheme() : mode));

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
    setResolved(mode === "system" ? resolveSystemTheme() : mode);
  }, [mode]);

  useEffect(() => {
    if (mode !== "system") return undefined;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => setResolved(resolveSystemTheme());
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [mode]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolved);
  }, [resolved]);

  const cycle = useCallback(() => {
    setMode((prev) => (prev === "light" ? "dark" : prev === "dark" ? "system" : "light"));
  }, []);

  return { mode, resolved, setMode, cycle };
}
