import { useCallback, useEffect, useRef } from "react";

/**
 * Wraps the browser Notification API. Permission is requested once, lazily,
 * on the first attempt to notify (not on page load -- browsers ignore/flag
 * permission prompts fired without a user gesture nearby anyway).
 */
export function useNotifications() {
  const permissionRef = useRef(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );

  useEffect(() => {
    if (typeof Notification === "undefined") return;
    permissionRef.current = Notification.permission;
  }, []);

  const ensurePermission = useCallback(async () => {
    if (typeof Notification === "undefined") return "unsupported";
    if (Notification.permission === "granted" || Notification.permission === "denied") {
      return Notification.permission;
    }
    const result = await Notification.requestPermission();
    permissionRef.current = result;
    return result;
  }, []);

  const notify = useCallback(
    async (title, body) => {
      if (typeof Notification === "undefined") return;
      const permission = await ensurePermission();
      if (permission !== "granted") return;
      try {
        const n = new Notification(title, {
          body,
          icon: "/favicon.ico",
          tag: "ehs-safety-assistant",
          renotify: true,
        });
        n.onclick = () => {
          window.focus();
          n.close();
        };
      } catch {
        // Some browsers (mobile Safari, etc.) don't support the constructor
        // form -- fail silently, the in-app badge still covers it.
      }
    },
    [ensurePermission]
  );

  return { notify, ensurePermission };
}
