import {
  completeSubscriberSignInFromLink,
  getSubscriberRecord,
  isSubscriberProfileActive,
  normalizeEmail,
  onSubscriberAuthChange,
  sendSubscriberSignInLink,
  upsertSubscriberRecord,
} from "../lib/subscriberClient";

const SEGMENTS = ["Articles & Op-Eds", "Photography", "Faces of the World", "Travel"];

function normalizeSegments(profile) {
  if (!profile || typeof profile !== "object") return [];
  const direct = Array.isArray(profile.segmentTags)
    ? profile.segmentTags.filter((segment) => SEGMENTS.includes(segment))
    : [];
  if (direct.length) return Array.from(new Set(direct));

  const preferences = Array.isArray(profile.preferences) ? profile.preferences : [];
  if (preferences.includes("all") || profile.wantsAllUpdates) return [...SEGMENTS];

  const next = [];
  if (preferences.includes("articles") || preferences.includes("papers") || profile.wantsPapers) next.push("Articles & Op-Eds");
  if (preferences.includes("photography") || profile.wantsPhotography) next.push("Photography");
  if (preferences.includes("faces") || preferences.includes("stories") || profile.wantsFaces) next.push("Faces of the World");
  if (preferences.includes("travel") || profile.wantsTravel) next.push("Travel");
  return Array.from(new Set(next));
}

function hasSegment(profile, segment) {
  return isSubscriberProfileActive(profile) && normalizeSegments(profile).includes(segment);
}

function setSceneStatus(scene, message, tone = "muted") {
  const status = scene.querySelector("[data-subscribe-status]");
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
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
    resetAvailable(scene, null, null);
    return null;
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
  });

  window.addEventListener("pagehide", () => {
    if (typeof unsubscribe === "function") unsubscribe();
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

        if (result.linked) {
          setSceneStatus(scene, "Subscription updated.", "ok");
          await hydrateSceneState(scene, authUser);
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
