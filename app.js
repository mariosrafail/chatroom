const storageKey = "mobile-chat-room-profile";
const apiUrl = "/.netlify/functions/messages";
const pollMs = 3000;

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
  Random: [
    {
      id: "local-3",
      author: "Alex",
      text: "Random updates can go here.",
      createdAt: Date.now() - 1000 * 60 * 18,
    },
  ],
  Support: [
    {
      id: "local-4",
      author: "Support",
      text: "Send a message and we will check it.",
      createdAt: Date.now() - 1000 * 60 * 22,
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

const messagesEl = document.querySelector("#messages");
const messageForm = document.querySelector("#messageForm");
const messageInput = document.querySelector("#messageInput");
const activeRoomEl = document.querySelector("#activeRoom");
const avatarInitial = document.querySelector("#avatarInitial");
const roomsPanel = document.querySelector("#roomsPanel");
const profileDialog = document.querySelector("#profileDialog");
const profileForm = document.querySelector("#profileForm");
const nameInput = document.querySelector("#nameInput");
const sendButton = document.querySelector(".send-button");
const statusText = document.querySelector("#statusText");

function loadProfileName() {
  const saved = localStorage.getItem(storageKey);
  return saved || "Marios";
}

function saveProfileName() {
  localStorage.setItem(storageKey, state.profileName);
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
  };
}

function renderHeader() {
  activeRoomEl.textContent = state.activeRoom;
  avatarInitial.textContent = state.profileName.trim().charAt(0).toUpperCase() || "U";
  statusText.textContent = state.online ? "database connected" : "local preview";

  document.querySelectorAll(".room-option").forEach((button) => {
    button.classList.toggle("active", button.dataset.room === state.activeRoom);
  });
}

function renderMessages() {
  const roomMessages = state.messages[state.activeRoom] ?? [];
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
    const item = document.createElement("article");
    item.className = `message ${isMine ? "mine" : "theirs"}`;

    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.innerHTML = `<span></span><span></span>`;
    meta.children[0].textContent = isMine ? "You" : message.author;
    meta.children[1].textContent = formatTime(message.createdAt);

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = message.text;

    item.append(meta, bubble);
    messagesEl.append(item);
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
    const response = await fetch(`${apiUrl}?room=${encodeURIComponent(state.activeRoom)}`);
    if (!response.ok) {
      throw new Error("Message fetch failed");
    }

    const data = await response.json();
    state.messages[state.activeRoom] = data.messages.map(normalizeMessage);
    state.online = true;
  } catch {
    state.online = false;
  } finally {
    state.loading = false;
    render();
  }
}

async function addMessage(text) {
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

  messageInput.value = "";
  resizeInput();
  state.messages[state.activeRoom] ??= [];
  state.messages[state.activeRoom].push(optimisticMessage);
  render();

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
    state.online = true;
    state.messages[state.activeRoom] = [
      ...state.messages[state.activeRoom].filter((message) => message.id !== optimisticMessage.id),
      normalizeMessage(data.message),
    ];
  } catch {
    state.online = false;
  } finally {
    render();
  }
}

function resizeInput() {
  messageInput.style.height = "auto";
  messageInput.style.height = `${messageInput.scrollHeight}px`;
  sendButton.disabled = messageInput.value.trim().length === 0;
}

document.querySelector("#menuButton").addEventListener("click", () => {
  roomsPanel.classList.add("open");
});

document.querySelector("#closeRoomsButton").addEventListener("click", () => {
  roomsPanel.classList.remove("open");
});

document.querySelectorAll(".room-option").forEach((button) => {
  button.addEventListener("click", () => {
    state.activeRoom = button.dataset.room;
    roomsPanel.classList.remove("open");
    render();
    fetchMessages({ showLoading: true });
  });
});

document.querySelector("#profileButton").addEventListener("click", () => {
  nameInput.value = state.profileName;
  profileDialog.showModal();
});

document.querySelector("#cancelProfileButton").addEventListener("click", () => {
  profileDialog.close();
});

profileForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const nextName = nameInput.value.trim() || "User";
  state.profileName = nextName;
  saveProfileName();
  profileDialog.close();
  render();
});

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addMessage(messageInput.value);
});

messageInput.addEventListener("input", resizeInput);

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    addMessage(messageInput.value);
  }
});

document.querySelector("#quickButton").addEventListener("click", () => {
  addMessage("Got it, moving on.");
});

document.addEventListener("click", (event) => {
  const clickedInsidePanel = roomsPanel.contains(event.target);
  const clickedMenu = event.target.closest("#menuButton");

  if (!clickedInsidePanel && !clickedMenu) {
    roomsPanel.classList.remove("open");
  }
});

resizeInput();
render();
fetchMessages({ showLoading: true });
setInterval(() => fetchMessages(), pollMs);
