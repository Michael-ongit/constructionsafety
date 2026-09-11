import { useCallback, useRef, useState } from "react";
import { streamChat } from "../lib/chatApi.js";

const MAX_CLIENT_HISTORY = 8;

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useChatStream({ onAssistantDone } = {}) {
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef(null);

  const send = useCallback(
    async (text) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      const userMsg = { id: makeId(), role: "user", content: trimmed };
      const assistantId = makeId();
      const assistantMsg = { id: assistantId, role: "assistant", content: "", sql: null, error: null };

      const history = messages
        .filter((m) => m.content)
        .slice(-MAX_CLIENT_HISTORY)
        .map((m) => ({ role: m.role, content: m.content }));

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);
      setStatus("Thinking...");

      const controller = new AbortController();
      abortRef.current = controller;

      let fullText = "";

      const patchAssistant = (patch) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, ...patch(m) } : m))
        );
      };

      try {
        await streamChat({ message: trimmed, history }, (event) => {
          switch (event.type) {
            case "status":
              setStatus(event.content);
              break;
            case "sql":
              patchAssistant((m) => ({ sql: event.content }));
              break;
            case "token":
              setStatus("");
              fullText += event.content;
              patchAssistant((m) => ({ content: (m.content || "") + event.content }));
              break;
            case "error":
              patchAssistant(() => ({ error: event.content }));
              onAssistantDone?.({ text: "", error: event.content });
              break;
            case "done":
              patchAssistant(() => ({ meta: event }));
              onAssistantDone?.({ text: fullText, error: null });
              break;
            default:
              break;
          }
        }, controller.signal);
      } catch (err) {
        if (err.name !== "AbortError") {
          const msg = err.message || "Something went wrong.";
          patchAssistant(() => ({ error: msg }));
          onAssistantDone?.({ text: "", error: msg });
        }
      } finally {
        setIsStreaming(false);
        setStatus("");
        abortRef.current = null;
      }
    },
    [messages, isStreaming, onAssistantDone]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setStatus("");
    setIsStreaming(false);
  }, []);

  return { messages, status, isStreaming, send, stop, clear };
}
