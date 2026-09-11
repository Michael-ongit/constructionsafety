import React, { useEffect, useRef } from "react";
import MessageBubble from "./MessageBubble.jsx";
import TypingIndicator from "./TypingIndicator.jsx";
import "./MessageList.css";

export default function MessageList({ messages, status, suggestions, onSuggestion }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  if (messages.length === 0) {
    return (
      <div className="ehs-messages ehs-messages--empty">
        <div className="ehs-empty-state">
          <div className="ehs-empty-icon">🦺</div>
          <h3>Ask about your safety data</h3>
          <p>I turn your question into a SQL query, run it, and summarize the results.</p>
          <div className="ehs-suggestions">
            {suggestions.map((s) => (
              <button key={s} type="button" className="ehs-suggestion" onClick={() => onSuggestion(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ehs-messages">
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}
      {status ? <TypingIndicator label={status} /> : null}
      <div ref={bottomRef} />
    </div>
  );
}
