import React from "react";
import ChatWidget from "./components/ChatWidget.jsx";

/**
 * This page is only a placeholder host so the widget has something to sit
 * on top of while you test it. In your real app, delete everything below
 * except <ChatWidget /> and drop it into your existing layout -- it is
 * fully self-contained (fixed-position launcher + sliding panel) and does
 * not require any surrounding markup.
 */
export default function App() {
  return (
    <div className="host-page">
      <header className="host-header">
        <div className="host-header-inner">
          <span className="host-brand">EHS Safety Portal</span>
        </div>
      </header>
      <main className="host-main">
        <h1>Your existing web app</h1>
        <p>
          This area represents the page the assistant will sit on top of once
          it's wired into your production frontend. Open the assistant from
          the button in the bottom-right corner.
        </p>
      </main>
      <ChatWidget />
    </div>
  );
}
