(function () {
  "use strict";

  const SIGNAL_ENDPOINT = "https://usercom.babbage.systems/signal";
  const SOURCE = "peacock-wallet";
  const SURFACE = "marketing-site";
  const RELEASE = "__RELEASE_VERSION__";
  const MAX_CONTEXT_VALUE_LENGTH = 96;
  const ALLOWED_HOSTS = new Set([
    "userwallet.getmetanet.com",
    "peacockwallet.com",
    "www.peacockwallet.com"
  ]);

  const privacySignalEnabled = () => {
    const globalPrivacyControl = navigator.globalPrivacyControl === true;
    const doNotTrack = navigator.doNotTrack === "1" || window.doNotTrack === "1";
    return ALLOWED_HOSTS.has(window.location.hostname.toLowerCase()) && !globalPrivacyControl && !doNotTrack;
  };

  const bounded = (value) => String(value == null ? "" : value).slice(0, MAX_CONTEXT_VALUE_LENGTH);

  const sessionId = () => {
    const storageKey = "peacock-marketing-session";
    try {
      const existing = sessionStorage.getItem(storageKey);
      if (existing) return existing;
      const created = crypto.randomUUID();
      sessionStorage.setItem(storageKey, created);
      return created;
    } catch (_) {
      return crypto.randomUUID();
    }
  };

  const sourceChannel = () => {
    if (!document.referrer) return "direct";
    try {
      const host = new URL(document.referrer).hostname.toLowerCase();
      if (host === window.location.hostname) return "internal";
      if (host === "github.com" || host.endsWith(".github.com")) return "github";
      if (/google|bing|duckduckgo|brave|yahoo/.test(host)) return "search";
      return "other";
    } catch (_) {
      return "other";
    }
  };

  const viewportClass = () => {
    if (window.innerWidth < 680) return "small";
    if (window.innerWidth < 980) return "medium";
    return "large";
  };

  const getPlatformInfo = () => {
    const uaData = navigator.userAgentData;
    const ua = navigator.userAgent || navigator.platform || "";
    const platform = (navigator.platform || "").toLowerCase();
    const reportedPlatform = uaData && uaData.platform ? uaData.platform.toLowerCase() : platform;
    const reportedArch = uaData && uaData.architecture ? uaData.architecture.toLowerCase() : "";
    const isMobile = uaData ? uaData.mobile : /android|iphone|ipad|ipod/i.test(ua);
    const isMac = /mac/i.test(reportedPlatform) || /mac os x/i.test(ua);
    const isIOS = /iphone|ipad|ipod/i.test(ua);
    const isLinux = /linux|x11|bsd/i.test(reportedPlatform) || /linux/i.test(ua);
    const isWindows = /win/i.test(reportedPlatform) || /windows/i.test(ua);

    let os = "other";
    if (isIOS || (isMobile && isMac)) os = "ios";
    else if (isMac) os = "macos";
    else if (isLinux) os = "linux";
    else if (isWindows) os = "windows";
    else if (/android/i.test(ua)) os = "android";

    let arch = "unknown";
    if (/arm|aarch64/.test(reportedArch) || /arm|aarch64/i.test(ua)) arch = "arm64";
    else if (/x86|amd64|x64/.test(reportedArch) || /x86_64|win64|wow64/i.test(ua)) arch = "x64";

    return { os, arch, isMobile };
  };

  const platformInfo = getPlatformInfo();
  const currentSessionId = sessionId();

  const cleanContext = (context) => {
    const safe = {};
    Object.entries(context || {}).slice(0, 12).forEach(([key, value]) => {
      if (/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(key) && ["string", "number", "boolean"].includes(typeof value)) {
        safe[key] = typeof value === "string" ? bounded(value) : value;
      }
    });
    return safe;
  };

  const postSignal = (name, context) => {
    if (!privacySignalEnabled() || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(name)) return;

    const payload = {
      source: SOURCE,
      name,
      surface: SURFACE,
      path: bounded(window.location.pathname || "/"),
      sessionId: currentSessionId,
      tags: [bounded(`release:${RELEASE}`), bounded(`platform:${platformInfo.os}`)],
      context: cleanContext({
        release: RELEASE,
        platform: platformInfo.os,
        architecture: platformInfo.arch,
        viewport: viewportClass(),
        sourceChannel: sourceChannel(),
        ...context
      })
    };

    fetch(SIGNAL_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
      credentials: "omit",
      referrerPolicy: "no-referrer"
    }).catch(() => undefined);
  };

  const recommendDownload = () => {
    const links = Array.from(document.querySelectorAll("a[data-download]"));
    if (["other", "ios", "android"].includes(platformInfo.os)) return;

    const exact = links.find((link) => link.dataset.os === platformInfo.os && link.dataset.arch === platformInfo.arch);
    const fallback = links.find((link) => link.dataset.os === platformInfo.os);
    const recommendation = exact || fallback;
    if (!recommendation) return;

    recommendation.classList.add("highlighted");
    const card = recommendation.closest("[data-card-os]");
    if (card) card.classList.add("recommended");

    const osNames = { macos: "macOS", windows: "Windows", linux: "Linux" };
    const osName = osNames[platformInfo.os] || "your platform";
    const primary = document.getElementById("primary-download");
    if (primary) {
      primary.href = recommendation.getAttribute("href");
      primary.textContent = `Download for ${osName}`;
      primary.dataset.recommended = "true";
    }

    const detected = document.getElementById("detected-os");
    const detectedName = document.getElementById("detected-os-name");
    if (detected && detectedName) {
      detectedName.textContent = osName;
      detected.hidden = false;
    }
  };

  const instrumentLinks = () => {
    document.querySelectorAll("a[data-download]").forEach((link) => {
      link.addEventListener("click", () => {
        postSignal("marketing.download_clicked", {
          targetPlatform: link.dataset.os || "unknown",
          targetArchitecture: link.dataset.arch || "unknown",
          assetType: link.dataset.asset || "unknown",
          recommended: link.classList.contains("highlighted")
        });
      });
    });

    document.querySelectorAll("a[data-signal]").forEach((link) => {
      link.addEventListener("click", () => {
        postSignal(link.dataset.signal, {
          location: link.dataset.location || "unknown",
          recommended: link.dataset.recommended === "true"
        });
      });
    });
  };

  recommendDownload();
  instrumentLinks();
  const year = document.getElementById("copyright-year");
  if (year) year.textContent = String(new Date().getFullYear());
  postSignal("marketing.page_view", { mobile: platformInfo.isMobile });
})();
