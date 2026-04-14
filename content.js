(() => {
  const FIXED_PREFIX = "+88016";
  const TOTAL_CHECKS = 1000;
  const REQUEST_SETTLE_DELAY_MS = 1400;

  const state = {
    running: false,
    checked: 0,
    total: TOTAL_CHECKS,
    currentNumber: "",
    foundNumbers: [],
    lastError: ""
  };
  let cachedEditableInput = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function uniquePush(list, value) {
    if (!list.includes(value)) {
      list.push(value);
      return true;
    }
    return false;
  }

  function normalizeDigits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function generateSpecialCandidates(count) {
    const specialSeeds = [
      "32321252",
      "32234243",
      "12344321",
      "12121212",
      "11223344",
      "55667788",
      "90909090",
      "10101010",
      "98767890",
      "77778888",
      "11112222",
      "36936936",
      "12341234",
      "50505050",
      "80808080"
    ];

    const output = [];
    const seen = new Set();

    const add = (suffix) => {
      const clean = normalizeDigits(suffix).slice(0, 8).padStart(8, "0");
      if (clean.length === 8 && !seen.has(clean)) {
        seen.add(clean);
        output.push(clean);
      }
    };

    specialSeeds.forEach(add);

    for (let i = 0; output.length < count; i += 1) {
      const d = String(i % 10);
      const e = String((i + 3) % 10);
      add(`${d}${d}${e}${e}${d}${d}${e}${e}`);
      add(`${d}${e}${d}${e}${d}${e}${d}${e}`);
      add(`${d}${e}${e}${d}${d}${e}${e}${d}`);
      add(`${i}`.padStart(4, "0").repeat(2));
      add(`${i}`.padStart(8, "0").split("").reverse().join(""));
    }

    return output.slice(0, count);
  }

  function isVisible(input) {
    const style = window.getComputedStyle(input);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    const rect = input.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findEditableInput() {
    if (
      cachedEditableInput &&
      cachedEditableInput.isConnected &&
      !cachedEditableInput.disabled &&
      !cachedEditableInput.readOnly &&
      isVisible(cachedEditableInput)
    ) {
      return cachedEditableInput;
    }

    const inputs = Array.from(
      document.querySelectorAll('input[type="text"], input[type="tel"], input:not([type])')
    );

    cachedEditableInput =
      inputs.find(
        (el) =>
          !el.disabled &&
          !el.readOnly &&
          isVisible(el) &&
          /number|mobile|msisdn|sim|phone|digits|016|\+88016/i.test(
            `${el.name || ""} ${el.id || ""} ${el.placeholder || ""} ${el.ariaLabel || ""}`
          )
      ) ||
      inputs.find((el) => !el.disabled && !el.readOnly && isVisible(el)) ||
      null;

    return cachedEditableInput;
  }

  function setInputValue(input, value) {
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function trySubmitFromInput(input) {
    const form = input.form;
    if (form) {
      if (typeof form.requestSubmit === "function") {
        form.requestSubmit();
      } else {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      }
      return true;
    }
    return false;
  }

  function clickSearchButton() {
    const candidates = Array.from(
      document.querySelectorAll('button, input[type="submit"], [role="button"]')
    );
    const button =
      candidates.find((el) => /check|search|availability|find|submit|go/i.test(el.innerText || el.value || "")) ||
      candidates.find((el) => !el.disabled && isVisible(el)) ||
      null;

    if (button && typeof button.click === "function") {
      button.click();
      return true;
    }
    return false;
  }

  function pageSaysAvailable() {
    const text = (document.body?.innerText || "").toLowerCase().replace(/\s+/g, " ");
    if (!text) {
      return false;
    }
    if (/\bnot available\b|\bunavailable\b|\balready taken\b|\bnot found\b/.test(text)) {
      return false;
    }
    return (
      /\b(number|sim|msisdn)?\s*(is|are)\s*available\b/.test(text) ||
      /\bavailable\s*number\b/.test(text)
    );
  }

  async function checkSingleSuffix(suffix) {
    const input = findEditableInput();
    if (!input) {
      throw new Error("Could not find an editable number input on page.");
    }

    const currentDigits = normalizeDigits(input.value);
    const fixedPrefixDigits = normalizeDigits(FIXED_PREFIX);
    const wantsSuffixOnly =
      input.maxLength === 8 || currentDigits.startsWith(fixedPrefixDigits);

    setInputValue(input, wantsSuffixOnly ? suffix : `${FIXED_PREFIX}${suffix}`);

    if (!trySubmitFromInput(input)) {
      clickSearchButton();
    }

    await sleep(REQUEST_SETTLE_DELAY_MS);
    return pageSaysAvailable();
  }

  async function persistFoundNumbers() {
    await chrome.storage.local.set({ foundNumbers: state.foundNumbers });
  }

  async function startSearch() {
    if (state.running) {
      return;
    }
    state.running = true;
    state.checked = 0;
    state.currentNumber = "";
    state.lastError = "";

    const candidates = generateSpecialCandidates(state.total);

    for (const suffix of candidates) {
      if (!state.running) {
        break;
      }

      const fullNumber = `${FIXED_PREFIX}${suffix}`;
      state.currentNumber = fullNumber;

      try {
        const available = await checkSingleSuffix(suffix);
        if (available && uniquePush(state.foundNumbers, fullNumber)) {
          await persistFoundNumbers();
        }
      } catch (error) {
        state.lastError = error instanceof Error ? error.message : String(error);
      }

      state.checked += 1;
    }

    state.running = false;
    state.currentNumber = "";
    await persistFoundNumbers();
  }

  function stopSearch() {
    state.running = false;
  }

  async function loadFoundNumbers() {
    const data = await chrome.storage.local.get(["foundNumbers"]);
    state.foundNumbers = Array.isArray(data.foundNumbers) ? data.foundNumbers : [];
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") {
      return;
    }

    if (message.type === "start-search") {
      startSearch().finally(() => sendResponse({ ok: true }));
      return true;
    }

    if (message.type === "stop-search") {
      stopSearch();
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "clear-found") {
      state.foundNumbers = [];
      persistFoundNumbers().finally(() => sendResponse({ ok: true }));
      return true;
    }

    if (message.type === "get-state") {
      sendResponse({ ...state });
    }
  });

  loadFoundNumbers().catch(() => {
    state.foundNumbers = [];
  });
})();
