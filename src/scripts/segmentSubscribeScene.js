import {
  completeSubscriberSignInFromLink,
  cacheSubscriberProfile,
  getSubscriberRecord,
  isSubscriberProfileActive,
  normalizeEmail,
  normalizeSubscriberSegments,
  onSubscriberAuthChange,
  readCachedSubscriberProfile,
  sendSubscriberSignInLink,
  subscriberHasAnySegment,
  subscriberHasSegment,
  upsertSubscriberRecord,
} from "../lib/subscriberClient";

const UI_STORAGE_KEY = "sfa-subscriber-ui-v1";

function normalizeSegments(profile) {
  return normalizeSubscriberSegments(profile);
}

function hasSegment(profile, segment) {
  return subscriberHasSegment(profile, segment);
}

function setSceneStatus(scene, message, tone = "muted") {
  const status = scene.querySelector("[data-subscribe-status]");
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

function setControlVisibility(root, segment, profile) {
  const subscribed = hasSegment(profile, segment);
  const mode = subscriberHasAnySegment(profile) ? "profile" : "subscribe";
  document.documentElement.setAttribute("data-sfa-ui", mode);
  try {
    window.localStorage.setItem(UI_STORAGE_KEY, mode);
  } catch (error) {}
  root.querySelectorAll(`[data-subscribe-control][data-subscribe-segment="${segment}"]`).forEach((el) => {
    el.hidden = subscribed;
    if (el instanceof HTMLElement) {
      if (subscribed) {
        el.style.setProperty("display", "none", "important");
      } else {
        el.style.setProperty("display", "initial", "important");
      }
    }
  });
  root.querySelectorAll(`[data-profile-control][data-subscribe-segment="${segment}"]`).forEach((el) => {
    el.hidden = !subscribed;
    if (el instanceof HTMLElement) {
      if (subscribed) {
        el.style.setProperty("display", "inline-flex", "important");
      } else {
        el.style.setProperty("display", "none", "important");
      }
    }
    if (subscribed && el instanceof HTMLAnchorElement) {
      el.href = settingsHrefWithReturn(el.getAttribute("href") || el.href, profile?.email || "");
    }
  });
}

function currentReturnPath() {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function settingsHrefWithReturn(rawHref, email = "") {
  if (typeof window === "undefined") return rawHref;
  try {
    const url = new URL(rawHref || "/subscriber-settings/", window.location.origin);
    url.searchParams.set("from", currentReturnPath());
    const normalized = normalizeEmail(email || "");
    if (normalized) url.searchParams.set("email", normalized);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch (error) {
    return rawHref;
  }
}

function mergeSubscriberProfile(baseProfile, fallback) {
  const profile = baseProfile && typeof baseProfile === "object" ? baseProfile : {};
  const baseSegments = normalizeSegments(profile);
  const fallbackSegments = normalizeSegments(fallback);
  return {
    ...profile,
    email: normalizeEmail(profile.email || fallback?.email || ""),
    name: String(profile.name || fallback?.name || "").trim().slice(0, 80),
    status: String(profile.status || fallback?.status || "active").trim(),
    segmentTags: Array.from(new Set([...baseSegments, ...fallbackSegments])),
  };
}

function cacheSubscriberDraft(user, profile) {
  cacheSubscriberProfile({ email: user?.email, user, profile });
}

function applyAllControlVisibility(root, scenes, profilesByScene) {
  scenes.forEach((scene) => {
    const segment = scene.dataset.segmentSubscribe || "";
    const profile = profilesByScene.get(scene) || null;
    if (!segment) return;
    setControlVisibility(root, segment, profile);
  });
}

function openScene(scene) {
  if (!scene) return;
  scene.classList.add("is-open");
  scene.setAttribute("aria-hidden", "false");
  document.body.classList.add("segment-subscribe-open");
  const input = scene.querySelector("[data-subscribe-email]");
  if (input instanceof HTMLInputElement && !input.disabled) {
    window.setTimeout(() => input.focus(), 40);
  }
}

function closeScene(scene) {
  if (!scene) return;
  scene.classList.remove("is-open");
  scene.setAttribute("aria-hidden", "true");
  if (!document.querySelector("[data-segment-subscribe].is-open")) {
    document.body.classList.remove("segment-subscribe-open");
  }
}

function setBusy(scene, busy) {
  const button = scene.querySelector("[data-subscribe-submit]");
  if (button instanceof HTMLButtonElement) {
    if (!busy && button.dataset.locked === "true") return;
    button.disabled = busy || button.dataset.locked === "true";
    button.textContent = busy ? "Sending..." : button.dataset.defaultLabel || button.textContent;
  }
}

function setAlreadySubscribed(scene, user) {
  const emailInput = scene.querySelector("[data-subscribe-email]");
  const nameInput = scene.querySelector("[data-subscribe-name]");
  const button = scene.querySelector("[data-subscribe-submit]");
  if (emailInput instanceof HTMLInputElement) {
    emailInput.value = user?.email || emailInput.value;
    emailInput.disabled = true;
  }
  if (nameInput instanceof HTMLInputElement) {
    nameInput.disabled = true;
  }
  if (button instanceof HTMLButtonElement) {
    button.dataset.locked = "true";
    button.disabled = true;
    button.textContent = "Already subscribed";
  }
  setSceneStatus(scene, "You are already subscribed to this list.", "ok");
}

function resetAvailable(scene, user, profile) {
  const emailInput = scene.querySelector("[data-subscribe-email]");
  const nameInput = scene.querySelector("[data-subscribe-name]");
  const button = scene.querySelector("[data-subscribe-submit]");
  const segment = scene.dataset.segmentSubscribe || "";

  if (emailInput instanceof HTMLInputElement) {
    emailInput.disabled = false;
    if (user?.email && !emailInput.value) emailInput.value = user.email;
  }
  if (nameInput instanceof HTMLInputElement) {
    nameInput.disabled = false;
    if (profile?.name && !nameInput.value) nameInput.value = profile.name;
  }
  if (button instanceof HTMLButtonElement) {
    button.dataset.locked = "false";
    button.disabled = false;
    button.textContent = isSubscriberProfileActive(profile) ? `Add ${segment}` : button.dataset.defaultLabel || button.textContent;
  }
}

async function hydrateSceneState(scene, user) {
  const segment = scene.dataset.segmentSubscribe || "";
  if (!user?.uid) {
    const cached = readCachedSubscriberProfile();
    const profile = cached?.profile || null;
    if (hasSegment(profile, segment)) {
      setAlreadySubscribed(scene, { email: cached.email });
    } else {
      resetAvailable(scene, cached ? { email: cached.email } : null, profile);
      if (isSubscriberProfileActive(profile)) {
        setSceneStatus(scene, `You are following other updates. Add ${segment} to your subscriber profile.`, "muted");
      }
    }
    return profile;
  }

  const profile = await getSubscriberRecord(user.uid);
  if (hasSegment(profile, segment)) {
    setAlreadySubscribed(scene, user);
  } else {
    resetAvailable(scene, user, profile);
    if (isSubscriberProfileActive(profile)) {
      setSceneStatus(scene, `You are signed in. Add ${segment} to your subscriber profile.`, "muted");
    }
  }
  return profile;
}

export async function attachSegmentSubscribeScenes(root = document) {
  const scenes = Array.from(root.querySelectorAll("[data-segment-subscribe]"));
  if (!scenes.length) return;

  scenes.forEach((scene) => {
    if (scene.dataset.subscribeModal === "true") {
      scene.setAttribute("aria-hidden", scene.classList.contains("is-open") ? "false" : "true");
    }

    scene.querySelectorAll("[data-subscribe-close]").forEach((button) => {
      button.addEventListener("click", () => closeScene(scene));
    });
    scene.addEventListener("click", (event) => {
      if (event.target === scene && scene.dataset.subscribeModal === "true") closeScene(scene);
    });

    const button = scene.querySelector("[data-subscribe-submit]");
    if (button instanceof HTMLButtonElement && !button.dataset.defaultLabel) {
      button.dataset.defaultLabel = button.textContent || "Subscribe";
    }
  });

  root.querySelectorAll("[data-subscribe-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = String(button.getAttribute("data-subscribe-open") || "");
      const scene = root.querySelector(`[data-segment-subscribe][data-subscribe-id="${target}"]`);
      openScene(scene);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    scenes.forEach(closeScene);
  });

  try {
    await completeSubscriberSignInFromLink();
  } catch (error) {
    scenes.forEach((scene) => setSceneStatus(scene, "That sign-in link could not be completed. Please request a fresh one.", "error"));
  }

  let authUser = null;
  let activeProfiles = new Map();

  const unsubscribe = await onSubscriberAuthChange(async (user) => {
    authUser = user;
    activeProfiles = new Map();
    await Promise.all(scenes.map(async (scene) => {
      const profile = await hydrateSceneState(scene, user);
      activeProfiles.set(scene, profile);
    }));
    const firstProfile = scenes.length ? activeProfiles.get(scenes[0]) : null;
    if (user?.uid) cacheSubscriberDraft(user, firstProfile || null);
    applyAllControlVisibility(root, scenes, activeProfiles);
  });

  const handleExternalProfileMode = (event) => {
    const detail = event?.detail && typeof event.detail === "object" ? event.detail : {};
    const email = normalizeEmail(detail.email || "");
    const incomingProfile = detail.profile && typeof detail.profile === "object" ? detail.profile : null;
    const incomingSegments = normalizeSegments(incomingProfile);
    if (!incomingSegments.length) return;

    scenes.forEach((scene) => {
      const segment = scene.dataset.segmentSubscribe || "";
      if (!segment || !incomingSegments.includes(segment)) return;

      const emailInput = scene.querySelector("[data-subscribe-email]");
      if (emailInput instanceof HTMLInputElement && email && !emailInput.value) {
        emailInput.value = email;
      }

      const currentProfile = activeProfiles.get(scene);
      const nextProfile = {
        ...(currentProfile && typeof currentProfile === "object" ? currentProfile : {}),
        ...(incomingProfile || {}),
        email: email || incomingProfile?.email || currentProfile?.email || "",
        status: "active",
        segmentTags: incomingSegments,
      };
      activeProfiles.set(scene, nextProfile);
      cacheSubscriberDraft({ email }, nextProfile);
      setControlVisibility(root, segment, nextProfile);
      setSceneStatus(scene, "You are already following the journey! Open Subscriber Settings to edit preferences.", "ok");
    });
  };

  window.addEventListener("sfa:subscriber-profile-mode", handleExternalProfileMode);

  window.addEventListener("pagehide", () => {
    if (typeof unsubscribe === "function") unsubscribe();
    window.removeEventListener("sfa:subscriber-profile-mode", handleExternalProfileMode);
  }, { once: true });

  scenes.forEach((scene) => {
    const form = scene.querySelector("[data-subscribe-form]");
    if (!(form instanceof HTMLFormElement)) return;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const segment = scene.dataset.segmentSubscribe || "";
      const source = scene.dataset.subscribeSource || "segment_scene";
      const emailInput = scene.querySelector("[data-subscribe-email]");
      const nameInput = scene.querySelector("[data-subscribe-name]");
      const email = normalizeEmail(emailInput instanceof HTMLInputElement ? emailInput.value : "");
      const name = nameInput instanceof HTMLInputElement ? nameInput.value : "";
      const profile = activeProfiles.get(scene);

      if (authUser?.uid && hasSegment(profile, segment)) {
        setAlreadySubscribed(scene, authUser);
        return;
      }

      if (!email.includes("@")) {
        setSceneStatus(scene, "Enter a valid email address.", "error");
        if (emailInput instanceof HTMLInputElement) emailInput.focus();
        return;
      }

      setBusy(scene, true);
      setSceneStatus(scene, "", "muted");

      try {
        if (authUser?.uid && authUser.email && normalizeEmail(authUser.email) === email) {
          await upsertSubscriberRecord(authUser, { name, segmentTags: [segment], source });
          const nextProfile = await getSubscriberRecord(authUser.uid);
          activeProfiles.set(scene, nextProfile);
          cacheSubscriberDraft(authUser, nextProfile);
          setControlVisibility(root, segment, nextProfile);
          if (hasSegment(nextProfile, segment)) {
            setAlreadySubscribed(scene, authUser);
          } else {
            setSceneStatus(scene, "Subscription updated.", "ok");
          }
          return;
        }

        const result = await sendSubscriberSignInLink({
          email,
          name,
          segmentTags: [segment],
          source,
          redirectUrl: window.location.href,
        });

        if (!result.ok) {
          setSceneStatus(scene, "Could not send the confirmation link. Please retry.", "error");
          return;
        }

        if (result.existing) {
          const nextProfile = mergeSubscriberProfile(result.profile, {
            status: "active",
            email,
            name: name || profile?.name || "",
            segmentTags: [segment],
          });
          cacheSubscriberDraft({ email }, nextProfile);
          activeProfiles.set(scene, nextProfile);
          setControlVisibility(root, segment, nextProfile);
          if (result.updated) {
            setSceneStatus(scene, "Subscription updated.", "ok");
          } else {
            setSceneStatus(scene, "You are already following the journey! Open Subscriber Settings to edit preferences.", "ok");
          }
          return;
        }

        if (result.linked) {
          setSceneStatus(scene, "Subscription updated.", "ok");
          const nextProfile = await hydrateSceneState(scene, authUser);
          activeProfiles.set(scene, nextProfile);
          cacheSubscriberDraft(authUser, nextProfile);
          setControlVisibility(root, segment, nextProfile);
        } else {
          setSceneStatus(scene, "Check your inbox to confirm this subscription.", "ok");
        }
      } catch (error) {
        setSceneStatus(scene, "Subscription failed. Please retry in a moment.", "error");
      } finally {
        setBusy(scene, false);
      }
    });
  });
}

if (typeof document !== "undefined") {
  const boot = () => {
    attachSegmentSubscribeScenes().catch(() => undefined);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
}
