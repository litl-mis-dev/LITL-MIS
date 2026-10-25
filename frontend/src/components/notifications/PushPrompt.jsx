import { useNotifications } from "../../context/NotificationContext";

// Shown at the top of the notifications dropdown until the user has answered
// the browser's notification prompt. The prompt must come from this click —
// browsers ignore (Firefox, Safari) or hide (Chrome) prompts made on page load.
export default function PushPrompt() {
  const { canEnablePush, enablePush } = useNotifications();
  if (!canEnablePush) return null;

  return (
    <div className="topbar__notif-empty">
      <p style={{ margin: "0 0 8px" }}>Get notified even when this tab is closed.</p>
      <button
        type="button"
        className="topbar__notif-action-btn topbar__notif-action-btn--primary"
        onClick={enablePush}
      >
        Turn on notifications
      </button>
    </div>
  );
}
