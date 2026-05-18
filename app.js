const storageKey = "mobile-chat-room-state";

const defaultState = {
  profileName: "Marios",
  activeRoom: "General",
  messages: {
    General: [
      {
        id: crypto.randomUUID(),
        author: "Nikos",
        text: "Καλωσήρθες στο chat room.",
        createdAt: Date.now() - 1000 * 60 * 11,
      },
      {
        id: crypto.randomUUID(),
        author: "Eleni",
        text: "Το mobile layout είναι έτοιμο για γρήγορη δοκιμή.",
        createdAt: Date.now() - 1000 * 60 * 7,
      },
    ],
    Random: [
      {
        id: crypto.randomUUID(),
        author: "Alex",
        text: "Εδώ μπορούμε να βάζουμε άσχετα updates.",
        createdAt: Date.now() - 1000 * 60 * 18,
      },
    ],
    Support: [
      {
        id: crypto.randomUUID(),
        author: "Support",
        text: "Γράψε τι χρειάζεσαι και θα το δούμε.",
        createdAt: Date.now() - 1000 * 60 * 22,
      },
    ],
  },
};

const state = loadState();
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

function loadState() {
  const saved = localStorage.getItem(storageKey);

  if (!saved) {
    return structuredClone(defaultState);
  }

  try {
    const parsed = JSON.parse(saved);
    return {
      ...structuredClone(defaultState),
      ...parsed,
      messages: {
        ...structuredClone(defaultState.messages),
        ...parsed.messages,
      },
    };
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat("el-GR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function renderHeader() {
  activeRoomEl.textContent = state.activeRoom;
  avatarInitial.textContent = state.profileName.trim().charAt(0).toUpperCase() || "U";

  document.querySelectorAll(".room-option").forEach((button) => {
    button.classList.toggle("active", button.dataset.room === state.activeRoom);
  });
}

function renderMessages() {
  const roomMessages = state.messages[state.activeRoom] ?? [];
  messagesEl.replaceChildren();

  const dayChip = document.createElement("div");
  dayChip.className = "day-chip";
  dayChip.textContent = "Σήμερα";
  messagesEl.append(dayChip);

  roomMessages.forEach((message) => {
    const isMine = message.author === state.profileName;
    const item = document.createElement("article");
    item.className = `message ${isMine ? "mine" : "theirs"}`;

    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.innerHTML = `<span></span><span></span>`;
    meta.children[0].textContent = isMine ? "Εσύ" : message.author;
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
  saveState();
}

function addMessage(text) {
  const cleanText = text.trim();
  if (!cleanText) {
    return;
  }

  state.messages[state.activeRoom] ??= [];
  state.messages[state.activeRoom].push({
    id: crypto.randomUUID(),
    author: state.profileName,
    text: cleanText,
    createdAt: Date.now(),
  });

  messageInput.value = "";
  resizeInput();
  render();
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
  addMessage("Το είδα, συνεχίζουμε.");
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
