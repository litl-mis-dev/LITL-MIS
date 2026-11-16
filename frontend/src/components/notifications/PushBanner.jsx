import { useState } from "react";
import { useNotifications } from "../../context/NotificationContext";
import { HOME_SCREEN_HINT } from "../../utils/push";

const DISMISSED_KEY = "litl_push_banner_dismissed";

function readDismissed() {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "true";
  } catch {
    return false;
  }
}

// Asks for push on every page until this browser answers or "Not now" is
// clicked. The same button stays in the notifications dropdown afterwards.
// Without this, the only way to turn push on was inside the dropdown, so most
// people never subscribed and got no notifications on their devices.
export default function PushBanner() {
  const { canEnablePush, enablePush, needsHomeScreen } = useNotifications();
  const [isDismissed, setIsDismissed] = useState(readDismissed);
  const [isEnabling, setIsEnabling] = useState(false);

  if (isDismissed || (!canEnablePush && !needsHomeScreen)) return null;

  function dismiss() {
    setIsDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, "true");
    } catch {
      // storage blocked — the banner stays hidden until the page reloads
    }
  }

  async function handleEnable() {
    setIsEnabling(true);
    try {
      await enablePush();
    } finally {
      setIsEnabling(false);
    }
  }

  return (
    <section className="push-banner" aria-label="Device notifications">
      <div className="push-banner__text">
        <strong>Get notifications on this device</strong>
        <span>
          {needsHomeScreen
            ? HOME_SCREEN_HINT
            : "Receive announcements, event reminders and updates even when this site is closed."}
        </span>
      </div>
      <div className="push-banner__actions">
        {!needsHomeScreen && (
          <button
            type="button"
            className="btn btn--primary"
            onClick={handleEnable}
            disabled={isEnabling}
            aria-busy={isEnabling}
          >
            {isEnabling ? "Turning on..." : "Turn on"}
          </button>
        )}
        <button type="button" className="btn btn--outline" onClick={dismiss} disabled={isEnabling}>
          {needsHomeScreen ? "Got it" : "Not now"}
        </button>
      </div>
    </section>
  );
}
