import { useState } from "react";
import { useNotifications } from "../../context/NotificationContext";

// Shown at the top of the notifications dropdown until the user has answered
// the browser's notification prompt. The prompt must come from this click —
// browsers ignore (Firefox, Safari) or hide (Chrome) prompts made on page load.
export default function PushPrompt() {
  const { canEnablePush, enablePush } = useNotifications();
  // Busy while the browser asks for permission and the device is registered.
  const [isEnabling, setIsEnabling] = useState(false);
  if (!canEnablePush) return null;

  async function handleEnable() {
    setIsEnabling(true);
    try {
      await enablePush();
    } finally {
      setIsEnabling(false);
    }
  }

  return (
    <div className="topbar__notif-empty">
      <p style={{ margin: "0 0 8px" }}>Get notified even when this tab is closed.</p>
      <button
        type="button"
        className="topbar__notif-action-btn topbar__notif-action-btn--primary"
        onClick={handleEnable}
        disabled={isEnabling}
        aria-busy={isEnabling}
      >
        {isEnabling ? "Turning on..." : "Turn on notifications"}
      </button>
    </div>
  );
}
