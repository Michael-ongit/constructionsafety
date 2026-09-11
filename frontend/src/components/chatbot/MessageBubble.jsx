import React from "react";
import "./MessageBubble.css";

function formatContent(text) {
  if (!text) return "";
  let cleaned = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/\n{3,}/g, "\n\n");
  return cleaned;
}

export default function MessageBubble({ message }) {
  const isUser = message.role === "user";

  return (
    <div className={`ehs-bubble-row ${isUser ? "ehs-bubble-row--user" : ""}`}>
      <div className={`ehs-bubble ${isUser ? "ehs-bubble--user" : "ehs-bubble--assistant"}`}>
        {message.error ? (
          <span className="ehs-bubble-error">{message.error}</span>
        ) : (
          <span className="ehs-bubble-text">{formatContent(message.content)}</span>
        )}
      </div>
    </div>
  );
}
