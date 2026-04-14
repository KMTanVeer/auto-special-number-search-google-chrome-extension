(() => {
  const FIXED_PREFIX = "+88016";
  const TOTAL_CHECKS = 1000;
  const MIN_DELAY_MS = 120;
  const MAX_DELAY_MS = 260;
  const RESULT_WAIT_TIMEOUT_MS = 2800;
  const RESULT_POLL_INTERVAL_MS = 80;
  const MAX_FALLBACK_ELEMENTS = 300;
  const REFRESH_AVAILABILITY_ELEMENTS_EVERY_N_POLLS = 6;
  // Cap scoped text fallback size to avoid scanning very large pages on each timed-out check.
  const MAX_SCOPED_FALLBACK_TEXT_LENGTH = 8000;
  const MAX_LOCAL_CONTEXT_TEXT_LENGTH = 600;
  const PERSIST_EVERY_N_CHECKS = 10;
  const INPUT_SCORE_STRONG_MATCH = 120;
  const INPUT_SCORE_MATCH = 40;
  const INPUT_SCORE_SEARCH_TYPE = 20;
  const INPUT_SCORE_NEGATIVE = -200;
  const INPUT_MIN_ACCEPTABLE_SCORE = -500;
  const SMART_PATTERNS = ["1111", "2222", "1234", "0000", "786", "9999", "1212"];
  const LUCKY_CORES = ["786", "888", "777", "999", "555", "666", "444", "333", "222", "111", "000"];
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
  let cachedAvailabilityScope = null;
  let cachedAvailabilityElements = null;
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

    // 1. Priority explicit numbers
    PRIORITY_FULL_NUMBERS.forEach((full) => add(normalizeDigits(full).slice(-8)));

    // 2. All-same digit: 00000000 … 99999999
    for (let d = 0; d <= 9; d += 1) {
      add(String(d).repeat(8));
    }

    // 3. Sequential runs (ascending and descending, wrapping 0–9)
    for (let start = 0; start <= 9; start += 1) {
      const asc = Array.from({ length: 8 }, (_, k) => (start + k) % 10).join("");
      const desc = Array.from({ length: 8 }, (_, k) => (start - k + 10) % 10).join("");
      add(asc);
      add(desc);
    }

    // 4. Lucky-number cores: each core and its combos
    LUCKY_CORES.forEach((core) => {
      const rev = core.split("").reverse().join("");
      add(core);             // expandPatternTo8Digits stretches short cores to 8 digits
      add(core + core);
      add(core + core + core);
      add("00" + core);
      add(core + "00");
      add("0" + core + "0");
      add(core + rev);
      add(rev + core);
      add(core + "16");
      add("16" + core);
    });

    // 5. Repeated pairs: aabbccdd and aaaabbbb — all 2-digit combos
    for (let firstDigit = 0; firstDigit <= 9 && output.length < count; firstDigit += 1) {
      for (let secondDigit = 0; secondDigit <= 9 && output.length < count; secondDigit += 1) {
        add(String(firstDigit).repeat(2) + String(secondDigit).repeat(2) + String(firstDigit).repeat(2) + String(secondDigit).repeat(2));
        add(String(firstDigit).repeat(4) + String(secondDigit).repeat(4));
        add(String(firstDigit).repeat(2) + String(secondDigit).repeat(2) + String(secondDigit).repeat(2) + String(firstDigit).repeat(2));
      }
    }

    // 6. Stepping repeated-pairs: 11223344, 22334455 …
    for (let start = 0; start <= 9; start += 1) {
      const stepping = Array.from({ length: 4 }, (_, k) => String((start + k) % 10).repeat(2)).join("");
      add(stepping);
      add(stepping.split("").reverse().join(""));
    }

    // 7. Alternating two digits: ababababab
    for (let firstDigit = 0; firstDigit <= 9 && output.length < count; firstDigit += 1) {
      for (let secondDigit = firstDigit + 1; secondDigit <= 9 && output.length < count; secondDigit += 1) {
        add((String(firstDigit) + String(secondDigit)).repeat(4));
        add((String(secondDigit) + String(firstDigit)).repeat(4));
      }
    }

    // 8. SMART_PATTERNS original expansions
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

    // 9. Mirror / palindrome bulk filler (abcddcba): every 4-digit half
    for (let half = 1000; half <= 9999 && output.length < count; half += 1) {
      const h = String(half);
      add(h + h.split("").reverse().join(""));
    }
    // abbaabba and abbabaab 2-digit core mirrors
    for (let i = 10; i <= 99 && output.length < count; i += 1) {
      const ab = String(i);
      const ba = ab.split("").reverse().join("");
      add(ab + ba + ab + ba);
      add(ab + ba + ba + ab);
      add(ba + ab + ba + ab);
    }

    // 10. Arithmetic fill until count is satisfied
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
      scored.find((item) => item.score > INPUT_MIN_ACCEPTABLE_SCORE)?.el ||
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
      `${byFor?.innerText || ""} ${wrappingLabel?.innerText || ""} ${(section?.innerText || "").slice(0, MAX_LOCAL_CONTEXT_TEXT_LENGTH)}`
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
      score += INPUT_SCORE_STRONG_MATCH;
    }
    if (positive) {
      score += INPUT_SCORE_MATCH;
    }
    if (el.type === "search" || /search/.test(attrs)) {
      score += INPUT_SCORE_SEARCH_TYPE;
    }
    if (negative) {
      score += INPUT_SCORE_NEGATIVE;
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

  function getScopeForInput(input) {
    return input.closest("form, section, article, main, .container, .card, .row") || document.body;
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

  function collectAvailabilityElements(input, forceRefresh = false) {
    const scope = getScopeForInput(input);
    if (
      !forceRefresh &&
      cachedAvailabilityScope === scope &&
      Array.isArray(cachedAvailabilityElements) &&
      cachedAvailabilityElements.length
    ) {
      if (cachedAvailabilityElements.every((el) => el?.isConnected)) {
        return cachedAvailabilityElements;
      }
    }

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

    const elements = [...focused, ...fallback].filter(isVisibleElement);
    cachedAvailabilityScope = scope;
    cachedAvailabilityElements = elements;
    return elements;
  }

  function detectAvailabilityFromDom(input, forceRefresh = false) {
    const candidates = collectAvailabilityElements(input, forceRefresh);
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
    let pollCount = 0;
    while (Date.now() - start < RESULT_WAIT_TIMEOUT_MS) {
      if (isRunCancelled(runId)) {
        return null;
      }
      pollCount += 1;
      const signal = detectAvailabilityFromDom(
        input,
        pollCount % REFRESH_AVAILABILITY_ELEMENTS_EVERY_N_POLLS === 0
      );
      if (signal !== null) {
        return signal;
      }
      await sleep(RESULT_POLL_INTERVAL_MS);
    }

    const scope = getScopeForInput(input);
    // Scope fallback matching near the active search area first; this is faster and avoids unrelated page text.
    const text = normalizeSpaceText((scope?.textContent || "").slice(0, MAX_SCOPED_FALLBACK_TEXT_LENGTH));
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

    // This extension targets a fixed-prefix flow (+88016 is static in the UI), so the field must receive only the 8-digit suffix.
    const finalValue = suffix;

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
    cachedAvailabilityScope = null;
    cachedAvailabilityElements = null;
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
      cachedAvailabilityScope = null;
      cachedAvailabilityElements = null;
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
