const API_BASE_URL = import.meta.env.VITE_API_URL
  ? '' // In dev: route through Vite proxy
  : "http://localhost:3001";
const CHAT_PATH = "/chat-api/api/chat";
const HEALTH_PATH = "/chat-api/api/health";

export async function streamChat({ message, history }, onEvent, signal) {
  const response = await fetch(`${API_BASE_URL}${CHAT_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Request failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        onEvent(JSON.parse(payload));
      } catch {
        // ignore malformed chunk
      }
    }
  }
}

export async function checkHealth() {
  const res = await fetch(`${API_BASE_URL}${HEALTH_PATH}`);
  if (!res.ok) throw new Error("Health check failed");
  return res.json();
}
