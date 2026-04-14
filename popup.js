const statusEl = document.getElementById("status");
const numbersEl = document.getElementById("numbers");
const runningEl = document.getElementById("runningValue");
const checkedEl = document.getElementById("checkedValue");
const foundEl = document.getElementById("foundValue");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const copyBtn = document.getElementById("copyBtn");
const exportBtn = document.getElementById("exportBtn");
const clearBtn = document.getElementById("clearBtn");
const REFRESH_INTERVAL_MS = 1200;

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

async function getStoredFoundNumbers() {
  const data = await chrome.storage.local.get(["foundNumbers"]);
  return Array.isArray(data.foundNumbers) ? data.foundNumbers : [];
}

function saveBlobAsFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderState(state, fallbackFound = []) {
  if (!state) {
    runningEl.textContent = "unknown";
    checkedEl.textContent = "0";
    foundEl.textContent = String(fallbackFound.length);
    statusEl.textContent = "Status: Open Airtel sim-services page in current tab.";
    numbersEl.textContent = fallbackFound.length ? fallbackFound.join("\n") : "No numbers found yet.";
    numbersEl.classList.toggle("muted", fallbackFound.length === 0);
    return;
  }

  const foundNumbers = Array.isArray(state.foundNumbers) ? state.foundNumbers : fallbackFound;
  runningEl.textContent = state.running ? "running" : "idle";
  checkedEl.textContent = `${state.checked}/${state.total}`;
  foundEl.textContent = String(foundNumbers.length);

  const current = state.currentNumber ? ` | Current: ${state.currentNumber}` : "";
  const error = state.lastError ? ` | Last error: ${state.lastError}` : "";
  statusEl.textContent = `Status: ${state.running ? "running" : "idle"}${current}${error}`;

  if (!foundNumbers.length) {
    numbersEl.textContent = "No numbers found yet.";
    numbersEl.classList.add("muted");
    return;
  }

  numbersEl.textContent = foundNumbers.join("\n");
  numbersEl.classList.remove("muted");
}

async function refreshState() {
  const storedFound = await getStoredFoundNumbers();
  try {
    const state = await sendToActiveTab({ type: "get-state" });
    renderState(state, storedFound);
  } catch {
    renderState(null, storedFound);
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
    const foundNumbers =
      Array.isArray(state?.foundNumbers) && state.foundNumbers.length
        ? state.foundNumbers
        : await getStoredFoundNumbers();
    const text = foundNumbers.join("\n");
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

exportBtn.addEventListener("click", async () => {
  try {
    let foundNumbers = await getStoredFoundNumbers();
    try {
      const state = await sendToActiveTab({ type: "get-state" });
      if (Array.isArray(state?.foundNumbers)) {
        foundNumbers = state.foundNumbers;
      }
    } catch {
      // no-op: keep stored numbers fallback
    }

    if (!foundNumbers.length) {
      statusEl.textContent = "Status: No numbers to export.";
      return;
    }

    const blob = new Blob([foundNumbers.join("\n")], { type: "text/plain;charset=utf-8" });
    saveBlobAsFile(blob, `airtel-found-numbers-${Date.now()}.txt`);
    statusEl.textContent = `Status: Exported ${foundNumbers.length} numbers.`;
  } catch (error) {
    statusEl.textContent = `Status: ${error.message}`;
  }
});

clearBtn.addEventListener("click", async () => {
  try {
    let clearedInTab = false;
    try {
      await sendToActiveTab({ type: "clear-found" });
      clearedInTab = true;
    } catch {
      clearedInTab = false;
    }
    if (!clearedInTab) {
      await chrome.storage.local.set({ foundNumbers: [], checkedSuffixes: [], checkedCount: 0 });
    }
    await refreshState();
  } catch (error) {
    statusEl.textContent = `Status: ${error.message}`;
  }
});

refreshState();
const refreshTimer = setInterval(refreshState, REFRESH_INTERVAL_MS);

window.addEventListener("unload", () => {
  clearInterval(refreshTimer);
});
