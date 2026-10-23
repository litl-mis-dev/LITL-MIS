import { useState } from "react";
import logo from "../assets/images/LITL_Logo_Loading.png";

const loadingLogo = new Image();
loadingLogo.src = logo;

export default function LogoLoader({ label = "Loading", fullScreen = false }) {
  const className = fullScreen ? "logo-loader logo-loader--full" : "logo-loader";
  const [isLogoReady, setIsLogoReady] = useState(loadingLogo.complete);

  return (
    <div className={className} role="status" aria-live="polite">
      <img
        className={`logo-loader__mark ${isLogoReady ? "logo-loader__mark--ready" : ""}`}
        src={logo}
        alt=""
        aria-hidden="true"
        onLoad={() => setIsLogoReady(true)}
        onError={() => setIsLogoReady(false)}
      />
      <span className="logo-loader__label">{label}</span>
    </div>
  );
}
