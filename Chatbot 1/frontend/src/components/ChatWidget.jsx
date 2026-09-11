import React, { useEffect, useRef, useState } from "react";
import { useChatStream } from "../hooks/useChatStream.js";
import { useTheme } from "../hooks/useTheme.js";
import { useNotifications } from "../hooks/useNotifications.js";
import MessageList from "./MessageList.jsx";
import ChatInput from "./ChatInput.jsx";
import ThemeToggle from "./ThemeToggle.jsx";
import "./ChatWidget.css";

const SUGGESTIONS = [
  "How many open compliance issues are there right now?",
  "Show the latest 5 unsafe activities detected",
  "Which site engineer has the most pending audits?",
];

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const openRef = useRef(open);
  openRef.current = open;

  const { notify } = useNotifications();

  const handleAssistantDone = ({ text, error }) => {
    // Only interrupt the user with a badge/notification if they aren't
    // actively looking at the panel right now (closed, or tab backgrounded).
    const isAway = !openRef.current || document.hidden;
    if (!isAway) return;

    setUnreadCount((c) => c + 1);
    const body = error ? `Couldn't answer: ${error}` : text || "Your answer is ready.";
    notify("Safety Assistant", body.slice(0, 160));
  };

  const { messages, status, isStreaming, send, stop, clear } = useChatStream({
    onAssistantDone: handleAssistantDone,
  });
  const theme = useTheme();

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open && window.innerWidth <= 640 ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const handleOpen = () => {
    setOpen(true);
    setUnreadCount(0);
  };

  return (
    <>
      <button
        type="button"
        className={`ehs-launcher ${open ? "ehs-launcher--hidden" : ""} ${
          isStreaming ? "ehs-launcher--busy" : ""
        }`}
        onClick={handleOpen}
        aria-label="Open safety assistant"
      >
        <ChatIcon />
        {isStreaming ? <span className="ehs-launcher-ring" /> : null}
        {!isStreaming && unreadCount > 0 ? (
          <span className="ehs-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>
        ) : null}
      </button>

      <div className={`ehs-scrim ${open ? "ehs-scrim--visible" : ""}`} onClick={() => setOpen(false)} />

      <aside className={`ehs-panel ${open ? "ehs-panel--open" : ""}`} role="dialog" aria-label="Safety assistant">
        <header className="ehs-panel-header">
          <div className="ehs-panel-title">
            <span className={`ehs-dot ${isStreaming ? "ehs-dot--busy" : ""}`} />
            <span>Safety Assistant</span>
          </div>
          <div className="ehs-panel-actions">
            <ThemeToggle mode={theme.mode} onCycle={theme.cycle} />
            <button
              type="button"
              className="ehs-icon-btn"
              onClick={clear}
              aria-label="Clear conversation"
              title="Clear conversation"
            >
              <TrashIcon />
            </button>
            <button
              type="button"
              className="ehs-icon-btn"
              onClick={() => setOpen(false)}
              aria-label="Close"
              title="Close"
            >
              <CloseIcon />
            </button>
          </div>
        </header>

        <MessageList messages={messages} status={status} suggestions={SUGGESTIONS} onSuggestion={send} />

        <ChatInput onSend={send} isStreaming={isStreaming} onStop={stop} />
      </aside>
    </>
  );
}

function ChatIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M4 4h16v11H7l-3 3V4z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m2 0v13a1 1 0 01-1 1H8a1 1 0 01-1-1V7h10z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
