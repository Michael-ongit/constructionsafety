import React, { useState } from "react";
import "./MessageBubble.css";

export default function MessageBubble({ message }) {
  const isUser = message.role === "user";
  const [showSql, setShowSql] = useState(false);

  return (
    <div className={`ehs-bubble-row ${isUser ? "ehs-bubble-row--user" : ""}`}>
      <div className={`ehs-bubble ${isUser ? "ehs-bubble--user" : "ehs-bubble--assistant"}`}>
        {message.error ? (
          <span className="ehs-bubble-error">{message.error}</span>
        ) : (
          <span className="ehs-bubble-text">{message.content}</span>
        )}

        {!isUser && message.sql ? (
          <div className="ehs-sql-toggle-wrap">
            <button type="button" className="ehs-sql-toggle" onClick={() => setShowSql((v) => !v)}>
              {showSql ? "Hide SQL" : "View SQL"}
            </button>
            {showSql ? <pre className="ehs-sql-block">{message.sql}</pre> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
