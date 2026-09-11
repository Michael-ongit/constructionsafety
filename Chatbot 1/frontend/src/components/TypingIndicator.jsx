import React from "react";
import "./TypingIndicator.css";

export default function TypingIndicator({ label }) {
  return (
    <div className="ehs-bubble-row">
      <div className="ehs-typing">
        <span className="ehs-typing-dots">
          <i />
          <i />
          <i />
        </span>
        {label ? <span className="ehs-typing-label">{label}</span> : null}
      </div>
    </div>
  );
}
