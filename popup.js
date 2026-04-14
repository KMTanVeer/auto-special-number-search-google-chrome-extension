const statusEl = document.getElementById("status");
const numbersEl = document.getElementById("numbers");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const copyBtn = document.getElementById("copyBtn");
const clearBtn = document.getElementById("clearBtn");

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function sendToActiveTab(message) {
  const tabId = await getActiveTabId();
  if (!tabId) {
    throw new Error("No active tab found.");
  }
  return chrome.tabs.sendMessage(tabId, message);
}

function renderState(state) {
  if (!state) {
    statusEl.textContent = "Status: Open Airtel sim-services page in current tab.";
    return;
  }

  const current = state.currentNumber ? ` | Current: ${state.currentNumber}` : "";
  const error = state.lastError ? ` | Last error: ${state.lastError}` : "";
  statusEl.textContent = `Status: ${state.running ? "running" : "idle"} | Checked: ${state.checked}/${state.total}${current}${error}`;

  if (!Array.isArray(state.foundNumbers) || state.foundNumbers.length === 0) {
    numbersEl.textContent = "No numbers found yet.";
    numbersEl.classList.add("muted");
    return;
  }

  numbersEl.textContent = state.foundNumbers.join("\n");
  numbersEl.classList.remove("muted");
}

async function refreshState() {
  try {
    const state = await sendToActiveTab({ type: "get-state" });
    renderState(state);
  } catch {
    renderState(null);
  }
}

startBtn.addEventListener("click", async () => {
  try {
    await sendToActiveTab({ type: "start-search" });
    await refreshState();
  } catch (error) {
    statusEl.textContent = `Status: ${error.message}`;
  }
});

stopBtn.addEventListener("click", async () => {
  try {
    await sendToActiveTab({ type: "stop-search" });
    await refreshState();
  } catch (error) {
    statusEl.textContent = `Status: ${error.message}`;
  }
});

copyBtn.addEventListener("click", async () => {
  try {
    const state = await sendToActiveTab({ type: "get-state" });
    const text = Array.isArray(state?.foundNumbers) ? state.foundNumbers.join("\n") : "";
    if (!text) {
      statusEl.textContent = "Status: No numbers to copy.";
      return;
    }
    await navigator.clipboard.writeText(text);
    statusEl.textContent = "Status: Found numbers copied to clipboard.";
  } catch (error) {
    statusEl.textContent = `Status: ${error.message}`;
  }
});

clearBtn.addEventListener("click", async () => {
  try {
    await sendToActiveTab({ type: "clear-found" });
    await refreshState();
  } catch (error) {
    statusEl.textContent = `Status: ${error.message}`;
  }
});

refreshState();
setInterval(refreshState, 2000);
