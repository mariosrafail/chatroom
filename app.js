const storageKey = "mobile-chat-room-profile-v2";
const legacyStorageKeys = ["mobile-chat-room-profile"];
const profileCookieName = "soulmate_profile_name";
const cityStorageKey = "soulmate_city";
const apiUrl = "/.netlify/functions/messages";
const appName = "SoulMate Chat";
const pollMs = 3000;
const notificationIcon = "/icons/icon-192.png";
const todayDate = getLocalDateKey();
const typingIdleMs = 4200;
const typingThrottleMs = 1800;
const greekCities = {
  athens: { name: "Athens", latitude: 37.9838, longitude: 23.7275 },
  thessaloniki: { name: "Thessaloniki", latitude: 40.6401, longitude: 22.9444 },
  patra: { name: "Patra", latitude: 38.2466, longitude: 21.7346 },
  heraklion: { name: "Heraklion", latitude: 35.3387, longitude: 25.1442 },
};

const fallbackMessages = {
  [todayDate]: [
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
  activeDate: todayDate,
  availableDays: [{ chatDate: todayDate, count: 0 }],
  typingUsers: [],
  cityKey: loadCityKey(),
  sun: null,
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
const menuButton = document.querySelector("#menuButton");
const closeCalendarButton = document.querySelector("#closeCalendarButton");
const calendarPanel = document.querySelector("#calendarPanel");
const calendarScrim = document.querySelector("#calendarScrim");
const dayList = document.querySelector("#dayList");
const todayButton = document.querySelector("#todayButton");
const messageMenu = document.querySelector("#messageMenu");
const copyMessageButton = document.querySelector("#copyMessageButton");
const editMessageButton = document.querySelector("#editMessageButton");
const deleteMessageButton = document.querySelector("#deleteMessageButton");
const editDialog = document.querySelector("#editDialog");
const editForm = document.querySelector("#editForm");
const editInput = document.querySelector("#editInput");
const cancelEditButton = document.querySelector("#cancelEditButton");
const historyDialog = document.querySelector("#historyDialog");
const historyList = document.querySelector("#historyList");
const citySelect = document.querySelector("#citySelect");
const sunMode = document.querySelector("#sunMode");
const sunTimes = document.querySelector("#sunTimes");
const dayLength = document.querySelector("#dayLength");
let selectedMessage = null;
let longPressTimer = null;
let lastTypingSentAt = 0;
let typingStopTimer = null;

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

function loadCityKey() {
  try {
    const saved = localStorage.getItem(cityStorageKey);
    if (saved && greekCities[saved]) {
      return saved;
    }
  } catch {
    // Default below is still valid.
  }

  return "athens";
}

function saveCityKey(cityKey) {
  try {
    localStorage.setItem(cityStorageKey, cityKey);
  } catch {
    // Non-critical preference.
  }
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

function formatClock(date) {
  return new Intl.DateTimeFormat("el-GR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDayLabel(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const currentDate = getLocalDateKey();

  if (dateKey === currentDate) {
    return "Today";
  }

  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatFullDate(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function normalizeMessage(message) {
  return {
    id: String(message.id),
    author: message.author,
    text: cleanMessageText(message.text),
    createdAt: message.createdAt || message.created_at,
    chatDate: normalizeDateKey(message.chatDate || message.chat_date || state.activeDate),
    editedAt: message.editedAt || message.edited_at || null,
    editHistory: normalizeEditHistory(message.editHistory || message.edit_history || []),
    seenBy: message.seenBy || message.seen_by || [],
  };
}

function normalizeEditHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history.map((entry) => ({
    oldText: cleanMessageText(entry.oldText || entry.old_text),
    newText: cleanMessageText(entry.newText || entry.new_text),
    editedAt: entry.editedAt || entry.edited_at,
  }));
}

function cleanMessageText(value) {
  return String(value || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

function normalizeDateKey(value) {
  return String(value || getLocalDateKey()).slice(0, 10);
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
  renderCalendar();
  renderSunCard();
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
  const roomMessages = (state.messages[state.activeDate] ?? []).filter((message) => message.text.length > 0);
  const latestOwnMessage = [...roomMessages].reverse().find((message) => message.author === state.profileName);
  messagesEl.replaceChildren();

  const dayChip = document.createElement("div");
  dayChip.className = "day-chip";
  dayChip.textContent = state.loading ? "Loading..." : formatFullDate(state.activeDate);
  messagesEl.append(dayChip);

  if (roomMessages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No messages yet.";
    messagesEl.append(empty);
    return;
  }

  roomMessages.forEach((message, index) => {
    const isMine = message.author === state.profileName;
    const isLatestOwn = latestOwnMessage?.id === message.id;
    const previousMessage = roomMessages[index - 1];
    const nextMessage = roomMessages[index + 1];
    const groupedWithPrevious = isGroupedMessage(previousMessage, message);
    const continuesGroup = isGroupedMessage(message, nextMessage);
    const item = document.createElement("article");
    item.className = `message ${isMine ? "mine" : "theirs"}`;
    item.classList.toggle("grouped", groupedWithPrevious);
    item.classList.toggle("continues", continuesGroup);
    if (!renderedMessageIds.has(message.id)) {
      item.classList.add("new-message");
    }

    if (!groupedWithPrevious) {
      const meta = document.createElement("div");
      meta.className = "message-meta";
      meta.innerHTML = `<span></span><span></span>`;
      meta.children[0].textContent = isMine ? "You" : message.author;
      meta.children[1].textContent = formatTime(message.createdAt);
      item.append(meta);
    }

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = message.text;

    item.append(bubble);
    attachMessageActions(item, message);

    if (message.editedAt) {
      const edited = document.createElement("button");
      edited.type = "button";
      edited.className = "edited-label";
      edited.textContent = "edited";
      edited.addEventListener("click", () => showEditHistory(message));
      item.append(edited);
    }

    if (isMine && isLatestOwn) {
      const delivery = document.createElement("div");
      delivery.className = "delivery-status";
      delivery.textContent = getDeliveryStatus(message);
      item.append(delivery);
    }

    messagesEl.append(item);
    renderedMessageIds.add(message.id);
  });

  renderTypingIndicator();

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderTypingIndicator() {
  if (!isTodayActive() || state.typingUsers.length === 0) {
    return;
  }

  const item = document.createElement("article");
  item.className = "message theirs typing-message";

  const bubble = document.createElement("div");
  bubble.className = "bubble typing-bubble";

  const names = document.createElement("span");
  names.className = "typing-text";
  names.textContent =
    state.typingUsers.length === 1
      ? `${state.typingUsers[0]} typing`
      : `${state.typingUsers.join(", ")} typing`;

  const dots = document.createElement("span");
  dots.className = "typing-dots";
  dots.innerHTML = "<i></i><i></i><i></i>";

  bubble.append(names, dots);
  item.append(bubble);
  messagesEl.append(item);
}

function attachMessageActions(element, message) {
  const canOpenActions = (event) => !event.target.closest("button, a, input, textarea, select");

  element.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !canOpenActions(event)) {
      return;
    }

    window.clearTimeout(longPressTimer);
    longPressTimer = window.setTimeout(() => {
      event.preventDefault();
      showMessageMenu(message, event.clientX, event.clientY);
    }, 520);
  });

  element.addEventListener("pointerup", () => window.clearTimeout(longPressTimer));
  element.addEventListener("pointercancel", () => window.clearTimeout(longPressTimer));
  element.addEventListener("pointerleave", () => window.clearTimeout(longPressTimer));
  element.addEventListener("contextmenu", (event) => {
    if (!canOpenActions(event)) {
      return;
    }

    event.preventDefault();
    showMessageMenu(message, event.clientX, event.clientY);
  });
  element.addEventListener("dblclick", (event) => {
    if (!canOpenActions(event)) {
      return;
    }

    showMessageMenu(message, event.clientX, event.clientY);
  });
}

function isGroupedMessage(firstMessage, secondMessage) {
  if (!firstMessage || !secondMessage || firstMessage.author !== secondMessage.author) {
    return false;
  }

  const firstTime = new Date(firstMessage.createdAt).getTime();
  const secondTime = new Date(secondMessage.createdAt).getTime();
  const fiveMinutes = 1000 * 60 * 5;

  return Math.abs(secondTime - firstTime) <= fiveMinutes;
}

function render() {
  closeMessageMenu();
  renderHeader();
  renderMessages();
  renderComposerState();
}

function renderCalendar() {
  const days = mergeAvailableDays();
  dayList.replaceChildren();

  days.forEach((day) => {
    const button = document.createElement("button");
    button.className = "day-option";
    button.type = "button";
    button.classList.toggle("active", day.chatDate === state.activeDate);
    button.dataset.date = day.chatDate;

    const label = document.createElement("span");
    label.textContent = formatDayLabel(day.chatDate);

    const meta = document.createElement("small");
    meta.textContent = `${day.count} message${day.count === 1 ? "" : "s"}`;

    button.append(label, meta);
    button.addEventListener("click", () => {
      selectDate(day.chatDate);
    });
    dayList.append(button);
  });

  todayButton.classList.toggle("active", state.activeDate === getLocalDateKey());
  citySelect.value = state.cityKey;
}

function renderSunCard() {
  if (!state.sun) {
    return;
  }

  const city = greekCities[state.cityKey];
  sunMode.textContent = `${state.sun.isNight ? "Night" : "Day"} in ${city.name}`;
  sunTimes.textContent = `Sunrise ${formatClock(state.sun.sunrise)} · Sunset ${formatClock(state.sun.sunset)}`;
  dayLength.textContent = `Day length ${formatDuration(state.sun.dayLengthMs)}`;
}

function formatDuration(durationMs) {
  const totalMinutes = Math.round(durationMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function mergeAvailableDays() {
  const daysByDate = new Map();
  state.availableDays.forEach((day) => daysByDate.set(day.chatDate, day));
  if (!daysByDate.has(getLocalDateKey())) {
    daysByDate.set(getLocalDateKey(), { chatDate: getLocalDateKey(), count: 0 });
  }

  return [...daysByDate.values()].sort((a, b) => b.chatDate.localeCompare(a.chatDate));
}

async function fetchMessages({ showLoading = false } = {}) {
  if (showLoading) {
    state.loading = true;
    render();
  }

  try {
    refreshTodayDate();
    const params = new URLSearchParams({ room: state.activeRoom, date: state.activeDate });
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

    state.messages[state.activeDate] = nextMessages;
    state.availableDays = normalizeDays(data.days);
    state.typingUsers = Array.isArray(data.typing) ? data.typing.filter((name) => name !== state.profileName) : [];
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

async function sendTypingStatus(isTyping) {
  if (!state.profileName || !isTodayActive()) {
    return;
  }

  try {
    await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "typing",
        room: state.activeRoom,
        chatDate: getLocalDateKey(),
        author: state.profileName,
        typing: isTyping,
      }),
    });
  } catch {
    // Typing presence is best-effort.
  }
}

function scheduleTypingStatus() {
  if (!state.profileName || !isTodayActive()) {
    return;
  }

  const hasText = cleanMessageText(messageInput.value).length > 0;
  window.clearTimeout(typingStopTimer);

  if (!hasText) {
    sendTypingStatus(false);
    return;
  }

  const now = Date.now();
  if (now - lastTypingSentAt > typingThrottleMs) {
    lastTypingSentAt = now;
    sendTypingStatus(true);
  }

  typingStopTimer = window.setTimeout(() => {
    sendTypingStatus(false);
  }, typingIdleMs);
}

function normalizeDays(days) {
  if (!Array.isArray(days)) {
    return [{ chatDate: getLocalDateKey(), count: 0 }];
  }

  return days.map((day) => ({
    chatDate: normalizeDateKey(day.chatDate || day.chat_date),
    count: Number(day.count) || 0,
  }));
}

function refreshTodayDate() {
  const currentDate = getLocalDateKey();
  if (state.activeDate === todayDate && currentDate !== todayDate) {
    state.activeDate = currentDate;
  }
}

function updateSunTheme() {
  const city = greekCities[state.cityKey] || greekCities.athens;
  const sun = calculateSunTimes(new Date(), city.latitude, city.longitude);
  const now = new Date();
  const daylight = calculateDaylightFactor(now, sun.sunrise, sun.sunset);
  const twilight = 1 - Math.abs(daylight - 0.5) * 2;
  const isNight = daylight < 0.12;

  state.sun = {
    ...sun,
    daylight,
    isNight,
  };

  document.documentElement.style.setProperty("--day-opacity", daylight.toFixed(3));
  document.documentElement.style.setProperty("--night-opacity", (1 - daylight).toFixed(3));
  document.documentElement.style.setProperty("--twilight-opacity", Math.max(0, twilight).toFixed(3));
  document.body.classList.toggle("night-mode", isNight);
  document.body.classList.toggle("day-mode", !isNight);

  const theme = isNight ? "#111827" : "#ff2d70";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme);
  renderSunCard();
}

function calculateDaylightFactor(now, sunrise, sunset) {
  const dawnStart = new Date(sunrise.getTime() - 90 * 60000);
  const dawnEnd = new Date(sunrise.getTime() + 45 * 60000);
  const duskStart = new Date(sunset.getTime() - 120 * 60000);
  const duskEnd = new Date(sunset.getTime() + 75 * 60000);

  if (now < dawnStart || now > duskEnd) {
    return 0;
  }

  if (now >= dawnStart && now < dawnEnd) {
    return smoothStep((now - dawnStart) / (dawnEnd - dawnStart));
  }

  if (now >= duskStart && now <= duskEnd) {
    return 1 - smoothStep((now - duskStart) / (duskEnd - duskStart));
  }

  return 1;
}

function smoothStep(value) {
  const x = Math.min(1, Math.max(0, value));
  return x * x * (3 - 2 * x);
}

function calculateSunTimes(date, latitude, longitude) {
  const zenith = 90.833;
  const sunriseUtc = calculateSunEventUtc(date, latitude, longitude, zenith, true);
  const sunsetUtc = calculateSunEventUtc(date, latitude, longitude, zenith, false);
  const sunrise = new Date(sunriseUtc);
  const sunset = new Date(sunsetUtc);

  return {
    sunrise,
    sunset,
    dayLengthMs: sunset - sunrise,
  };
}

function calculateSunEventUtc(date, latitude, longitude, zenith, isSunrise) {
  const dayOfYear = getDayOfYear(date);
  const lngHour = longitude / 15;
  const t = dayOfYear + ((isSunrise ? 6 : 18) - lngHour) / 24;
  const meanAnomaly = 0.9856 * t - 3.289;
  let trueLongitude =
    meanAnomaly +
    1.916 * Math.sin(toRadians(meanAnomaly)) +
    0.02 * Math.sin(toRadians(2 * meanAnomaly)) +
    282.634;
  trueLongitude = normalizeDegrees(trueLongitude);

  let rightAscension = toDegrees(Math.atan(0.91764 * Math.tan(toRadians(trueLongitude))));
  rightAscension = normalizeDegrees(rightAscension);
  const longitudeQuadrant = Math.floor(trueLongitude / 90) * 90;
  const ascensionQuadrant = Math.floor(rightAscension / 90) * 90;
  rightAscension = (rightAscension + longitudeQuadrant - ascensionQuadrant) / 15;

  const sinDeclination = 0.39782 * Math.sin(toRadians(trueLongitude));
  const cosDeclination = Math.cos(Math.asin(sinDeclination));
  const cosHour =
    (Math.cos(toRadians(zenith)) - sinDeclination * Math.sin(toRadians(latitude))) /
    (cosDeclination * Math.cos(toRadians(latitude)));

  if (cosHour > 1 || cosHour < -1) {
    const fallback = new Date(date);
    fallback.setHours(isSunrise ? 7 : 19, 0, 0, 0);
    return fallback.getTime();
  }

  let hourAngle = isSunrise ? 360 - toDegrees(Math.acos(cosHour)) : toDegrees(Math.acos(cosHour));
  hourAngle /= 15;

  const localMeanTime = hourAngle + rightAscension - 0.06571 * t - 6.622;
  const utcHour = normalizeHours(localMeanTime - lngHour);
  const result = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0));
  result.setUTCMinutes(Math.round(utcHour * 60));
  return result.getTime();
}

function getDayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians) {
  return (radians * 180) / Math.PI;
}

function normalizeDegrees(degrees) {
  return ((degrees % 360) + 360) % 360;
}

function normalizeHours(hours) {
  return ((hours % 24) + 24) % 24;
}

function showToast(message) {
  notifyToast.textContent = message;
  notifyToast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    notifyToast.hidden = true;
  }, 2600);
}

function isTodayActive() {
  return state.activeDate === getLocalDateKey();
}

function canModifyMessage(message) {
  return Boolean(
    message &&
      isTodayActive() &&
      message.author === state.profileName &&
      /^\d+$/.test(message.id)
  );
}

function showMessageMenu(message, x, y) {
  selectedMessage = message;
  const canModify = canModifyMessage(message);
  editMessageButton.hidden = !canModify;
  deleteMessageButton.hidden = !canModify;

  messageMenu.hidden = false;
  const rect = messageMenu.getBoundingClientRect();
  const left = Math.min(Math.max(10, x - rect.width / 2), window.innerWidth - rect.width - 10);
  const top = Math.min(Math.max(10, y - rect.height - 12), window.innerHeight - rect.height - 10);

  messageMenu.style.left = `${left}px`;
  messageMenu.style.top = `${top}px`;
}

function closeMessageMenu() {
  messageMenu.hidden = true;
}

async function copySelectedMessage() {
  if (!selectedMessage) {
    return;
  }

  try {
    await navigator.clipboard.writeText(selectedMessage.text);
    showToast("Copied.");
  } catch {
    showToast("Copy failed.");
  } finally {
    closeMessageMenu();
  }
}

function openEditDialog() {
  if (!canModifyMessage(selectedMessage)) {
    closeMessageMenu();
    return;
  }

  editInput.value = selectedMessage.text;
  closeMessageMenu();
  editDialog.showModal();
  editInput.focus();
}

async function saveEditedMessage() {
  if (!canModifyMessage(selectedMessage)) {
    return;
  }

  const text = cleanMessageText(editInput.value);
  if (!text || text === selectedMessage.text) {
    editDialog.close();
    return;
  }

  try {
    const response = await fetch(apiUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: selectedMessage.id,
        room: state.activeRoom,
        author: state.profileName,
        text,
      }),
    });

    if (!response.ok) {
      throw new Error("Edit failed");
    }

    editDialog.close();
    await fetchMessages();
  } catch {
    showToast("Could not edit message.");
  }
}

async function deleteSelectedMessage() {
  if (!canModifyMessage(selectedMessage)) {
    closeMessageMenu();
    return;
  }

  const confirmed = window.confirm("Delete this message?");
  closeMessageMenu();
  if (!confirmed) {
    return;
  }

  try {
    const response = await fetch(apiUrl, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: selectedMessage.id,
        room: state.activeRoom,
        author: state.profileName,
      }),
    });

    if (!response.ok) {
      throw new Error("Delete failed");
    }

    state.messages[state.activeDate] = state.messages[state.activeDate].filter(
      (message) => message.id !== selectedMessage.id
    );
    selectedMessage = null;
    render();
    fetchMessages();
  } catch {
    showToast("Could not delete message.");
  }
}

function showEditHistory(message) {
  historyList.replaceChildren();

  if (!message.editHistory.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "No previous text saved.";
    historyList.append(empty);
  }

  message.editHistory.forEach((entry) => {
    const item = document.createElement("div");
    item.className = "history-item";

    const time = document.createElement("small");
    time.textContent = `Edited ${formatTime(entry.editedAt)}`;

    const oldText = document.createElement("p");
    oldText.textContent = entry.oldText;

    const newText = document.createElement("p");
    newText.className = "history-new";
    newText.textContent = entry.newText;

    item.append(time, oldText, newText);
    historyList.append(item);
  });

  historyDialog.showModal();
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
  if (!isTodayActive()) {
    showToast("Past days are locked.");
    return;
  }

  if (!state.profileName) {
    openProfileDialog({ required: true });
    return;
  }

  const cleanText = cleanMessageText(text);
  if (!cleanText) {
    return;
  }

  const optimisticMessage = {
    id: crypto.randomUUID(),
    author: state.profileName,
    text: cleanText,
    createdAt: new Date().toISOString(),
    chatDate: getLocalDateKey(),
    seenBy: [],
  };
  deliveryState.set(optimisticMessage.id, "Sent");

  messageInput.value = "";
  resizeInput();
  sendTypingStatus(false);
  keepComposerFocused();
  state.activeDate = getLocalDateKey();
  state.messages[state.activeDate] ??= [];
  state.messages[state.activeDate].push(optimisticMessage);
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
        chatDate: state.activeDate,
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
    state.messages[state.activeDate] = [
      ...state.messages[state.activeDate].filter((message) => message.id !== optimisticMessage.id),
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

function selectDate(dateKey) {
  state.activeDate = dateKey;
  closeCalendar();
  renderedMessageIds.clear();
  render();
  fetchMessages({ showLoading: true });
}

function openCalendar() {
  calendarPanel.classList.add("open");
  calendarScrim.hidden = false;
}

function closeCalendar() {
  calendarPanel.classList.remove("open");
  calendarScrim.hidden = true;
}

function keepComposerFocused() {
  requestAnimationFrame(() => {
    messageInput.focus({ preventScroll: true });
  });
}

function resizeInput() {
  messageInput.style.height = "auto";
  messageInput.style.height = `${messageInput.scrollHeight}px`;
  renderComposerState();
}

function renderComposerState() {
  const locked = !isTodayActive();
  messageInput.disabled = locked;
  messageInput.placeholder = locked ? "This day is locked" : "Write a message...";
  sendButton.disabled = locked || !state.profileName || cleanMessageText(messageInput.value).length === 0;
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

messageInput.addEventListener("input", () => {
  resizeInput();
  scheduleTypingStatus();
});

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    addMessage(messageInput.value);
  }
});

notifyButton.addEventListener("click", requestNotifications);
menuButton.addEventListener("click", openCalendar);
closeCalendarButton.addEventListener("click", closeCalendar);
calendarScrim.addEventListener("click", closeCalendar);
todayButton.addEventListener("click", () => selectDate(getLocalDateKey()));
citySelect.addEventListener("change", () => {
  state.cityKey = greekCities[citySelect.value] ? citySelect.value : "athens";
  saveCityKey(state.cityKey);
  updateSunTheme();
});
copyMessageButton.addEventListener("click", copySelectedMessage);
editMessageButton.addEventListener("click", openEditDialog);
deleteMessageButton.addEventListener("click", deleteSelectedMessage);
cancelEditButton.addEventListener("click", () => editDialog.close());
editForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveEditedMessage();
});
document.addEventListener("pointerdown", (event) => {
  if (!messageMenu.hidden && !messageMenu.contains(event.target)) {
    closeMessageMenu();
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

resizeInput();
updateSunTheme();
render();
fetchMessages({ showLoading: true });
setInterval(() => fetchMessages(), pollMs);
setInterval(updateSunTheme, 60000);

if (!state.profileName) {
  openProfileDialog({ required: true });
}
