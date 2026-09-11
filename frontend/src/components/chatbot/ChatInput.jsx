import React, { useRef, useState } from "react";
import "./ChatInput.css";

export default function ChatInput({ onSend, isStreaming, onStop }) {
  const [value, setValue] = useState("");
  const textareaRef = useRef(null);

  const handleSend = () => {
    if (!value.trim()) return;
    onSend(value);
    setValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const autoGrow = (e) => {
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    setValue(el.value);
  };

  return (
    <div className="ehs-input-bar">
      <textarea
        ref={textareaRef}
        className="ehs-input"
        placeholder="Ask about safety data..."
        rows={1}
        value={value}
        onChange={autoGrow}
        onKeyDown={handleKeyDown}
      />
      {isStreaming ? (
        <button type="button" className="ehs-send-btn ehs-send-btn--stop" onClick={onStop} aria-label="Stop">
          <StopIcon />
        </button>
      ) : (
        <button
          type="button"
          className="ehs-send-btn"
          onClick={handleSend}
          disabled={!value.trim()}
          aria-label="Send"
        >
          <SendIcon />
        </button>
      )}
    </div>
  );
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 20l16-8L4 4v6l10 2-10 2v6z" fill="currentColor" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" />
    </svg>
  );
}
