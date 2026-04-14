(() => {
  const FIXED_PREFIX = "+88016";
  const TOTAL_CHECKS = 1000;
  const MIN_DELAY_MS = 300;
  const MAX_DELAY_MS = 700;
  const RESULT_WAIT_TIMEOUT_MS = 4500;
  const RESULT_POLL_INTERVAL_MS = 120;
  const MAX_FALLBACK_ELEMENTS = 300;
  const PERSIST_EVERY_N_CHECKS = 10;
  const SMART_PATTERNS = ["1111", "2222", "1234", "0000", "786", "9999", "1212"];
  const CURATED_SPECIAL_SUFFIXES = [
    "12345678",
    "87654321",
    "11223344",
    "44332211",
    "12121212",
    "56565656",
    "16000016",
    "16888888",
    "16777777",
    "16666666",
    "10000001",
    "10203040",
    "13572468",
    "24681357",
    "31415926",
    "27182818"
  ];
  const PRIORITY_FULL_NUMBERS = ["+8801632231309"];

  const state = {
    running: false,
    checked: 0,
    total: TOTAL_CHECKS,
    currentNumber: "",
    foundNumbers: [],
    checkedSuffixes: [],
    lastError: ""
  };
  let cachedEditableInput = null;
  let cachedCandidates = null;
  let activeRunId = 0;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isRunCancelled = (runId) => !state.running || runId !== activeRunId;

  const randomBetween = (min, max) =>
    Math.floor(Math.random() * (max - min + 1)) + min;

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

  function expandPatternTo8Digits(pattern) {
    const clean = normalizeDigits(pattern);
    if (!clean) {
      return "";
    }
    if (clean.length >= 8) {
      return clean.slice(-8);
    }
    return clean.repeat(Math.ceil(8 / clean.length)).slice(0, 8);
  }

  function generateSpecialCandidates(count) {
    const output = [];
    const seen = new Set();

    const add = (suffix) => {
      const clean = expandPatternTo8Digits(suffix);
      if (clean.length === 8 && !seen.has(clean)) {
        seen.add(clean);
        output.push(clean);
      }
    };

    PRIORITY_FULL_NUMBERS.forEach((full) => add(normalizeDigits(full).slice(-8)));
    CURATED_SPECIAL_SUFFIXES.forEach(add);

    SMART_PATTERNS.forEach((pattern) => {
      const reversed = pattern.split("").reverse().join("");
      add(pattern);
      add(pattern + pattern);
      add(reversed + pattern);
      add(pattern + reversed);
      add(pattern + "00");
      add("00" + pattern);
      add(pattern + "786");
      add("786" + pattern);
      add(pattern + "9999");
      add("9999" + pattern);
    });

    for (let i = 0; i <= 99; i += 1) {
      if (output.length >= count) {
        break;
      }
      const n2 = String(i).padStart(2, "0");
      const n4 = String(i).padStart(4, "0");
      SMART_PATTERNS.forEach((pattern) => {
        add(`${pattern}${n4}`);
        add(`${n4}${pattern}`);
        add(`${pattern}${n2}${pattern}`);
      });
    }

    for (let i = 0; output.length < count; i += 1) {
      const d = String(i % 10);
      const e = String((i + 3) % 10);
      const f = String((i + 6) % 10);
      add(`${d}${d}${e}${e}${d}${d}${e}${e}`);
      add(`${d}${e}${d}${e}${d}${e}${d}${e}`);
      add(`${d}${e}${e}${d}${d}${e}${e}${d}`);
      add(`${d}${e}${f}${d}${e}${f}${d}${e}`);
      add(`${i}`.padStart(4, "0").repeat(2));
      add(`${i}`.padStart(8, "0").split("").reverse().join(""));
      add(String(randomBetween(0, 99999999)).padStart(8, "0"));
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

    const candidates = inputs.filter((el) => !el.disabled && !el.readOnly && isVisible(el));
    const scored = candidates
      .map((el) => ({ el, score: scoreInputCandidate(el) }))
      .sort((a, b) => b.score - a.score);

    cachedEditableInput =
      scored.find((item) => item.score > -500)?.el ||
      candidates[0] ||
      null;

    return cachedEditableInput;
  }

  function getLocalContextText(el) {
    const byFor = el.id ? document.querySelector(`label[for="${el.id}"]`) : null;
    const wrappingLabel = el.closest("label");
    const section =
      el.closest("section, article, form, .card, .container, .row") ||
      el.parentElement;
    return normalizeSpaceText(
      `${byFor?.innerText || ""} ${wrappingLabel?.innerText || ""} ${(section?.innerText || "").slice(0, 600)}`
    );
  }

  function scoreInputCandidate(el) {
    const attrs = normalizeSpaceText(
      `${el.name || ""} ${el.id || ""} ${el.placeholder || ""} ${el.ariaLabel || ""} ${el.className || ""} ${el.type || ""}`
    );
    const context = getLocalContextText(el);
    const text = `${attrs} ${context}`;

    const positiveStrong =
      /search a mobile number to start/.test(text) ||
      /(^|[^\d])\+?\s*88016\s*-/.test(text);
    const positive =
      /search|mobile|msisdn|sim number|number search|availability|find number|016|\+88016/.test(text);
    const negative =
      /contact number|full name|email|password|login|log in|sign in|otp|verification|personal information|customer details/.test(
        text
      );

    let score = 0;
    if (positiveStrong) {
      score += 120;
    }
    if (positive) {
      score += 40;
    }
    if (el.type === "search" || /search/.test(attrs)) {
      score += 20;
    }
    if (negative) {
      score -= 200;
    }
    return score;
  }

  function setInputValue(input, value) {
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function trySubmitFromInput(input) {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
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

  function clickSearchButton(input) {
    const scope =
      input.closest("form, section, article, main, .card, .container, .row") ||
      input.parentElement ||
      document.body;
    const candidates = Array.from(
      scope.querySelectorAll('button, input[type="submit"], [role="button"], [aria-label]')
    );
    const button = candidates.find((el) => {
      const text = normalizeSpaceText(
        `${el.innerText || ""} ${el.value || ""} ${el.getAttribute("aria-label") || ""}`
      );
      return (
        !el.disabled &&
        isVisibleElement(el) &&
        /check|search|availability|find|submit|go|refresh/.test(text) &&
        !/log in|login|sign in|register|profile|cart|contact/.test(text)
      );
    });

    if (button && typeof button.click === "function") {
      button.click();
      return true;
    }
    return false;
  }

  function isVisibleElement(el) {
    if (!el || !(el instanceof Element)) {
      return false;
    }
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function normalizeSpaceText(text) {
    return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function availabilitySignalFromText(text) {
    const normalized = normalizeSpaceText(text);
    if (!normalized) {
      return null;
    }

    const hasPositive = /\bavailable\b/.test(normalized);
    const hasNegative =
      /\bnot available\b|\bunavailable\b|\balready taken\b|\bnot found\b|\bnot possible\b|\breserved\b|\boccupied\b/.test(
        normalized
      );

    if (hasNegative) {
      return false;
    }
    if (hasPositive) {
      return true;
    }
    return null;
  }

  function collectAvailabilityElements(input) {
    const scope = input.closest("form, section, article, main, .container, .card, .row") || document.body;
    const focusedSelectors = [
      '[aria-live]',
      '[role="status"]',
      '[class*="avail" i]',
      '[id*="avail" i]',
      '[class*="status" i]',
      '[id*="status" i]',
      '[class*="result" i]',
      '[id*="result" i]',
      '.alert',
      '.message',
      '.text-success',
      '.text-danger'
    ].join(", ");
    const fallbackSelectors = "p, span, div, li, strong";

    const focused = Array.from(scope.querySelectorAll(focusedSelectors));
    const fallback = focused.length
      ? []
      : Array.from(scope.querySelectorAll(fallbackSelectors))
          .slice(0, MAX_FALLBACK_ELEMENTS)
          .filter((el) => {
          const text = normalizeSpaceText(el.textContent);
          return /\bavailable\b|\bunavailable\b|\bnot available\b|\balready taken\b/.test(text);
          });

    return [...focused, ...fallback].filter(isVisibleElement);
  }

  function detectAvailabilityFromDom(input) {
    const candidates = collectAvailabilityElements(input);
    if (candidates.length === 0) {
      return null;
    }

    for (const el of candidates) {
      const signal = availabilitySignalFromText(el.textContent || el.innerText || "");
      if (signal === false) {
        return false;
      }
    }

    for (const el of candidates) {
      const signal = availabilitySignalFromText(el.textContent || el.innerText || "");
      if (signal === true) {
        return true;
      }
    }

    return null;
  }

  async function waitForDomAvailability(input, runId) {
    const start = Date.now();
    while (Date.now() - start < RESULT_WAIT_TIMEOUT_MS) {
      if (isRunCancelled(runId)) {
        return null;
      }
      const signal = detectAvailabilityFromDom(input);
      if (signal !== null) {
        return signal;
      }
      await sleep(RESULT_POLL_INTERVAL_MS);
    }

    const text = normalizeSpaceText(document.body?.innerText || "");
    if (!text) {
      return false;
    }
    if (/\bnot available\b|\bunavailable\b|\balready taken\b|\bnot found\b|\breserved\b/.test(text)) {
      return false;
    }
    return /\b(number|sim|msisdn)?\s*(is|are)\s*available\b|\bavailable\s*number\b/.test(text);
  }

  async function checkSingleSuffix(suffix, runId) {
    const input = findEditableInput();
    if (!input) {
      throw new Error("Could not find an editable number input on page.");
    }

    const fieldValue = input.value || "";
    const fixedPrefixDisplayMatch = fieldValue.match(/^\s*\+\s*88016\s*-\s*/);
    const fixedPrefixDisplay = fixedPrefixDisplayMatch ? fixedPrefixDisplayMatch[0] : "";
    const currentDigits = normalizeDigits(fieldValue);
    const fixedPrefixDigits = normalizeDigits(FIXED_PREFIX);
    const wantsSuffixOnly = input.maxLength === 8;
    const finalValue = fixedPrefixDisplay
      ? `${fixedPrefixDisplay}${suffix}`
      : wantsSuffixOnly || currentDigits.startsWith(fixedPrefixDigits)
        ? suffix
        : `${FIXED_PREFIX}${suffix}`;

    setInputValue(input, finalValue);

    if (!trySubmitFromInput(input)) {
      clickSearchButton(input);
    }

    const available = await waitForDomAvailability(input, runId);
    return available === true;
  }

  async function persistSearchData() {
    await chrome.storage.local.set({
      foundNumbers: state.foundNumbers,
      checkedSuffixes: state.checkedSuffixes,
      checkedCount: state.checked
    });
  }

  async function startSearch() {
    if (state.running) {
      return;
    }
    activeRunId += 1;
    const runId = activeRunId;
    state.running = true;
    state.currentNumber = "";
    state.lastError = "";

    cachedCandidates = cachedCandidates || generateSpecialCandidates(state.total);
    const candidates = cachedCandidates;
    const checkedSet = new Set(state.checkedSuffixes);

    for (const suffix of candidates) {
      if (isRunCancelled(runId) || state.checked >= state.total) {
        break;
      }
      if (checkedSet.has(suffix)) {
        continue;
      }

      checkedSet.add(suffix);
      state.checkedSuffixes.push(suffix);

      const fullNumber = `${FIXED_PREFIX}${suffix}`;
      state.currentNumber = fullNumber;

      try {
        const available = await checkSingleSuffix(suffix, runId);
        if (available && uniquePush(state.foundNumbers, fullNumber)) {
          await persistSearchData();
        }
      } catch (error) {
        state.lastError = error instanceof Error ? error.message : String(error);
      }

      state.checked += 1;
      if (state.checked % PERSIST_EVERY_N_CHECKS === 0) {
        await persistSearchData();
      }

      if (!isRunCancelled(runId) && state.checked < state.total) {
        await sleep(randomBetween(MIN_DELAY_MS, MAX_DELAY_MS));
      }
    }

    if (runId === activeRunId) {
      state.running = false;
      state.currentNumber = "";
    }
    await persistSearchData();
  }

  function stopSearch() {
    activeRunId += 1;
    state.running = false;
    state.currentNumber = "";
  }

  async function loadSearchData() {
    const data = await chrome.storage.local.get(["foundNumbers", "checkedSuffixes", "checkedCount"]);
    state.foundNumbers = Array.isArray(data.foundNumbers) ? data.foundNumbers : [];
    state.checkedSuffixes = Array.isArray(data.checkedSuffixes) ? data.checkedSuffixes : [];
    state.checked = Number.isFinite(data.checkedCount) ? data.checkedCount : state.checkedSuffixes.length;
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
      state.checkedSuffixes = [];
      state.checked = 0;
      state.currentNumber = "";
      state.lastError = "";
      persistSearchData().finally(() => sendResponse({ ok: true }));
      return true;
    }

    if (message.type === "get-state") {
      sendResponse({ ...state });
    }
  });

  loadSearchData().catch(() => {
    state.foundNumbers = [];
    state.checkedSuffixes = [];
    state.checked = 0;
  });
})();
