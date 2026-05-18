const storageKey = "mobile-chat-room-profile-v2";
const legacyStorageKeys = ["mobile-chat-room-profile"];
const profileCookieName = "soulmate_profile_name";
const apiUrl = "/.netlify/functions/messages";
const appName = "SoulMate Chat";
const pollMs = 3000;
const notificationIcon = "/icons/icon-192.png";

const fallbackMessages = {
  General: [
    {
      id: "local-1",
      author: "Nikos",
      text: "Welcome to the chat room.",
      createdAt: Date.now() - 1000 * 60 * 11,
    },
    {
      id: "local-2",
      author: "Eleni",
      text: "The mobile layout is ready for testing.",
      createdAt: Date.now() - 1000 * 60 * 7,
    },
  ],
};

const state = {
  profileName: loadProfileName(),
  activeRoom: "General",
  online: false,
  loading: false,
  messages: structuredClone(fallbackMessages),
};
const deliveryState = new Map();
const renderedMessageIds = new Set();
const knownRemoteMessageIds = new Set();
let hasLoadedRemoteMessages = false;

const messagesEl = document.querySelector("#messages");
const messageForm = document.querySelector("#messageForm");
const messageInput = document.querySelector("#messageInput");
const activeRoomEl = document.querySelector("#activeRoom");
const avatarInitial = document.querySelector("#avatarInitial");
const profileDialog = document.querySelector("#profileDialog");
const profileForm = document.querySelector("#profileForm");
const nameInput = document.querySelector("#nameInput");
const sendButton = document.querySelector(".send-button");
const profileTitle = document.querySelector("#profileTitle");
const profileHelp = document.querySelector("#profileHelp");
const cancelProfileButton = document.querySelector("#cancelProfileButton");
const saveProfileButton = document.querySelector("#saveProfileButton");
const dialogActions = document.querySelector(".dialog-actions");
const notifyButton = document.querySelector("#notifyButton");
const notifyToast = document.querySelector("#notifyToast");

function loadProfileName() {
  const saved = readStoredProfileName();
  if (saved) {
    writeStoredProfileName(saved);
  }

  return saved;
}

function saveProfileName() {
  writeStoredProfileName(state.profileName);
}

function readStoredProfileName() {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      return saved;
    }

    for (const key of legacyStorageKeys) {
      const legacyName = localStorage.getItem(key);
      if (legacyName) {
        return legacyName;
      }
    }
  } catch {
    // Some mobile browser modes can block storage; fall back to cookie below.
  }

  return readCookie(profileCookieName);
}

function writeStoredProfileName(name) {
  try {
    localStorage.setItem(storageKey, name);
  } catch {
    // Cookie fallback below still keeps the name for normal mobile browsing.
  }

  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `${profileCookieName}=${encodeURIComponent(name)}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
}

function readCookie(name) {
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`));

  return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : "";
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat("el-GR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function normalizeMessage(message) {
  return {
    id: String(message.id),
    author: message.author,
    text: message.text,
    createdAt: message.createdAt || message.created_at,
    seenBy: message.seenBy || message.seen_by || [],
  };
}

function getDeliveryStatus(message) {
  const localStatus = deliveryState.get(message.id);
  if (localStatus) {
    return localStatus;
  }

  return message.seenBy.length > 0 ? `Seen by ${message.seenBy.join(", ")}` : "Sent";
}

function renderHeader() {
  activeRoomEl.textContent = appName;
  avatarInitial.textContent = state.profileName.trim().charAt(0).toUpperCase() || "?";
  renderNotificationButton();
}

function renderNotificationButton() {
  if (!("Notification" in window)) {
    notifyButton.hidden = true;
    return;
  }

  notifyButton.hidden = Notification.permission === "granted";
  notifyButton.classList.toggle("blocked", Notification.permission === "denied");
}

function renderMessages() {
  const roomMessages = state.messages[state.activeRoom] ?? [];
  const latestOwnMessage = [...roomMessages].reverse().find((message) => message.author === state.profileName);
  messagesEl.replaceChildren();

  const dayChip = document.createElement("div");
  dayChip.className = "day-chip";
  dayChip.textContent = state.loading ? "Loading..." : "Today";
  messagesEl.append(dayChip);

  if (roomMessages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No messages yet.";
    messagesEl.append(empty);
    return;
  }

  roomMessages.forEach((message) => {
    const isMine = message.author === state.profileName;
    const isLatestOwn = latestOwnMessage?.id === message.id;
    const item = document.createElement("article");
    item.className = `message ${isMine ? "mine" : "theirs"}`;
    if (!renderedMessageIds.has(message.id)) {
      item.classList.add("new-message");
    }

    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.innerHTML = `<span></span><span></span>`;
    meta.children[0].textContent = isMine ? "You" : message.author;
    meta.children[1].textContent = formatTime(message.createdAt);

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = message.text;

    item.append(meta, bubble);

    if (isMine && isLatestOwn) {
      const delivery = document.createElement("div");
      delivery.className = "delivery-status";
      delivery.textContent = getDeliveryStatus(message);
      item.append(delivery);
    }

    messagesEl.append(item);
    renderedMessageIds.add(message.id);
  });

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function render() {
  renderHeader();
  renderMessages();
}

async function fetchMessages({ showLoading = false } = {}) {
  if (showLoading) {
    state.loading = true;
    render();
  }

  try {
    const params = new URLSearchParams({ room: state.activeRoom });
    if (state.profileName) {
      params.set("viewer", state.profileName);
    }

    const response = await fetch(`${apiUrl}?${params.toString()}`);
    if (!response.ok) {
      throw new Error("Message fetch failed");
    }

    const data = await response.json();
    const nextMessages = data.messages.map(normalizeMessage);
    const newIncomingMessages = nextMessages.filter(
      (message) =>
        hasLoadedRemoteMessages &&
        !knownRemoteMessageIds.has(message.id) &&
        message.author !== state.profileName
    );

    state.messages[state.activeRoom] = nextMessages;
    nextMessages.forEach((message) => knownRemoteMessageIds.add(message.id));
    hasLoadedRemoteMessages = true;
    state.online = true;

    newIncomingMessages.forEach(showIncomingNotification);
  } catch {
    state.online = false;
  } finally {
    state.loading = false;
    render();
  }
}

function showToast(message) {
  notifyToast.textContent = message;
  notifyToast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    notifyToast.hidden = true;
  }, 2600);
}

async function requestNotifications() {
  if (!("Notification" in window)) {
    showToast("Notifications are not supported on this browser.");
    return;
  }

  try {
    const permission = await Notification.requestPermission();
    renderNotificationButton();

    if (permission === "granted") {
      showToast("Notifications enabled.");
      showIncomingNotification({
        author: appName,
        text: "You will get alerts for new messages while the app is running.",
      });
      return;
    }

    showToast("Notifications were not enabled.");
  } catch {
    showToast("Could not enable notifications.");
  }
}

function showIncomingNotification(message) {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }

  const title = message.author === appName ? appName : `${message.author} sent a message`;
  const notification = new Notification(title, {
    body: message.text,
    icon: notificationIcon,
    badge: notificationIcon,
    tag: `soulmate-${message.id || Date.now()}`,
    renotify: true,
  });

  notification.onclick = () => {
    window.focus();
    notification.close();
  };

  if ("vibrate" in navigator) {
    navigator.vibrate([40, 40, 40]);
  }
}

async function addMessage(text) {
  if (!state.profileName) {
    openProfileDialog({ required: true });
    return;
  }

  const cleanText = text.trim();
  if (!cleanText) {
    return;
  }

  const optimisticMessage = {
    id: crypto.randomUUID(),
    author: state.profileName,
    text: cleanText,
    createdAt: new Date().toISOString(),
  };
  deliveryState.set(optimisticMessage.id, "Sent");

  messageInput.value = "";
  resizeInput();
  keepComposerFocused();
  state.messages[state.activeRoom] ??= [];
  state.messages[state.activeRoom].push(optimisticMessage);
  render();
  keepComposerFocused();

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        room: state.activeRoom,
        author: state.profileName,
        text: cleanText,
      }),
    });

    if (!response.ok) {
      throw new Error("Message send failed");
    }

    const data = await response.json();
    const savedMessage = normalizeMessage(data.message);
    state.online = true;
    deliveryState.delete(optimisticMessage.id);
    state.messages[state.activeRoom] = [
      ...state.messages[state.activeRoom].filter((message) => message.id !== optimisticMessage.id),
      savedMessage,
    ];
  } catch {
    state.online = false;
    deliveryState.set(optimisticMessage.id, "Not sent");
  } finally {
    render();
    keepComposerFocused();
  }
}

function keepComposerFocused() {
  requestAnimationFrame(() => {
    messageInput.focus({ preventScroll: true });
  });
}

function resizeInput() {
  messageInput.style.height = "auto";
  messageInput.style.height = `${messageInput.scrollHeight}px`;
  sendButton.disabled = !state.profileName || messageInput.value.trim().length === 0;
}

function openProfileDialog({ required = false } = {}) {
  profileTitle.textContent = required ? "Enter name" : "Profile";
  profileHelp.textContent = required
    ? "Choose a name before you start chatting."
    : "Your name appears next to messages sent from this device.";
  saveProfileButton.textContent = required ? "Start" : "Save";
  cancelProfileButton.hidden = required;
  dialogActions.classList.toggle("single-action", required);
  nameInput.value = state.profileName;
  profileDialog.showModal();
  nameInput.focus();
}

document.querySelector("#profileButton").addEventListener("click", () => {
  openProfileDialog({ required: false });
});

document.querySelector("#cancelProfileButton").addEventListener("click", () => {
  profileDialog.close();
});

profileDialog.addEventListener("cancel", (event) => {
  if (!state.profileName) {
    event.preventDefault();
  }
});

profileForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const nextName = nameInput.value.trim() || "User";
  state.profileName = nextName;
  saveProfileName();
  profileDialog.close();
  render();
  resizeInput();
  fetchMessages();
});

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addMessage(messageInput.value);
});

sendButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
});

messageInput.addEventListener("input", resizeInput);

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    addMessage(messageInput.value);
  }
});

notifyButton.addEventListener("click", requestNotifications);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

resizeInput();
render();
fetchMessages({ showLoading: true });
setInterval(() => fetchMessages(), pollMs);

if (!state.profileName) {
  openProfileDialog({ required: true });
}
