/**
 * 봇대시 화면 로직.
 * index.html, login.html, detail.html이 이 파일 하나를 같이 쓴다.
 * 캐릭터 원본은 서버에서 만들지 않고, 브라우저가 md와 stats.json을 읽어 그린다.
 */
(function () {
  // 카운터 숫자가 올라가는 시간. 단위는 밀리초.
  // 작은 수는 MIN, 차이가 큰 수는 MAX까지 늘어난다. 1000이면 1초.
  var COUNT_UP_MIN_MS = 1100;
  var COUNT_UP_MAX_MS = 1300;
  var COUNT_UP_BASE_MS = 1000;
  var COUNT_UP_SCALE = 180;
  // 페이지를 켜 둔 채로 방문자 수를 다시 확인하는 간격. 600000이면 10분.
  var COUNT_REFRESH_MS = 600000;

  try {
    if (history.scrollRestoration) history.scrollRestoration = "manual";
  } catch (error) {}

  var STORAGE = {
    filter: "botdash_filter",
    sort: "botdash_sort",
    view: "botdash_view",
    savedUser: "botdash_saved_user",
    session: "botdash_session",
    attempts: "botdash_login_attempts",
    next: "botdash_next",
    scroll: "botdash_scroll"
  };
  var FILTERS = { all: 1, has: 1, zero: 1 };
  var SORTS = { visitors_desc: 1, visitors_asc: 1, name: 1, drop: 1, posts: 1 };
  var SECRET_KEYS = { password: 1, passwd: 1, pwd: 1, secret: 1, token: 1 };

  var state = {
    characters: [],
    notices: [],
    statsUpdatedAt: null,
    loadedAt: null,
    loading: false,
    ready: false,
    filter: "all",
    sort: "visitors_desc",
    query: "",
    queryRaw: "",
    view: "cards",
    chart: null,
    modalOpen: false,
    photoOpen: false,
    blogCounts: {},
    activeId: null,
    lastFocus: null,
    entryConsumed: false,
    lockTimer: 0,
    bootTimer: 0,
    countTimer: 0,
    countRefreshBusy: false,
    countRefreshGen: 0
  };

  document.addEventListener("DOMContentLoaded", boot);

  function boot() {
    var page = document.body.dataset.page;
    if (typeof DASHBOARD_CONFIG === "undefined") {
      document.body.classList.add("auth-ready");
      showBootError("config.js를 불러오지 못했습니다. 서버에 js/config.js가 있는지 확인해 주세요.");
      return;
    }
    if (page === "login") initLogin();
    else if (page === "detail") initDetailPage();
    else initDashboard();
  }

  function showBootError(message) {
    document.body.classList.remove("is-booting");
    var host = document.getElementById("detailRoot") || document.getElementById("cardGrid") || document.querySelector(".login-card");
    if (!host) return;
    var note = document.createElement("p");
    note.className = "notice";
    note.textContent = message;
    host.prepend(note);
  }

  /* ---------- 로그인 ---------- */

  // 비밀번호 문자열이 바뀌면 이전 세션을 버리기 위한 짧은 표시값이다. 보안 해시가 아니다.
  function credentialStamp() {
    var text = String(DASHBOARD_CONFIG.auth.username) + "|" + String(DASHBOARD_CONFIG.auth.password);
    var hash = 0;
    for (var i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    return String(hash);
  }

  function readSession() {
    try {
      var raw = localStorage.getItem(STORAGE.session);
      if (!raw) {
        raw = sessionStorage.getItem(STORAGE.session);
        if (!raw) return null;
        localStorage.setItem(STORAGE.session, raw);
        sessionStorage.removeItem(STORAGE.session);
      }
      var data = JSON.parse(raw);
      if (!data || typeof data !== "object") return null;
      return data;
    } catch (error) {
      return null;
    }
  }

  function clearSession() {
    try { localStorage.removeItem(STORAGE.session); } catch (error) {}
    try { sessionStorage.removeItem(STORAGE.session); } catch (error) {}
  }

  function isAuthenticated() {
    try {
      var data = readSession();
      var hours = Number(DASHBOARD_CONFIG.login.sessionHours || 720);
      var valid = !!(data
        && data.user === DASHBOARD_CONFIG.auth.username
        && data.stamp === credentialStamp()
        && data.at
        && Date.now() - data.at <= hours * 3600 * 1000);
      if (!valid) clearSession();
      return valid;
    } catch (error) {
      clearSession();
      return false;
    }
  }

  function redirectToLogin() {
    var file = location.pathname.split("/").pop() || "index.html";
    try { sessionStorage.setItem(STORAGE.next, file + location.search); } catch (error) {}
    location.replace("login.html");
  }

  function safeNext(value) {
    if (value === "index.html") return value;
    if (typeof value !== "string") return "index.html";
    var matched = /^detail\.html\?id=([^&]+)$/.exec(value);
    if (!matched || matched[1].length > 200) return "index.html";
    try {
      return "detail.html?id=" + encodeURIComponent(decodeURIComponent(matched[1]));
    } catch (error) {
      return "index.html";
    }
  }

  function readAttempts() {
    try {
      var data = JSON.parse(localStorage.getItem(STORAGE.attempts) || "");
      if (!data || typeof data.count !== "number") return { count: 0, lockUntil: 0 };
      return { count: data.count, lockUntil: data.lockUntil || 0 };
    } catch (error) {
      return { count: 0, lockUntil: 0 };
    }
  }

  function writeAttempts(data) {
    try { localStorage.setItem(STORAGE.attempts, JSON.stringify(data)); } catch (error) {}
  }

  function showAlert(message) {
    var box = document.getElementById("loginAlert");
    if (!box) return;
    if (!message) {
      box.hidden = true;
      box.textContent = "";
      return;
    }
    box.hidden = false;
    box.textContent = message;
  }

  function setFormDisabled(disabled) {
    ["username", "password", "rememberUser", "loginSubmit"].forEach(function (id) {
      var field = document.getElementById(id);
      if (field) field.disabled = disabled;
    });
  }

  function lockMessage(lockUntil) {
    var remain = Math.max(0, lockUntil - Date.now());
    var minutes = Math.floor(remain / 60000);
    var seconds = Math.floor((remain % 60000) / 1000);
    return "로그인이 일시 잠겼습니다. " + minutes + "분 " + seconds + "초 후 다시 시도하세요.";
  }

  // 실패가 설정 횟수에 닿으면 잠시 입력을 막는다. 브라우저를 새로고침해도 시간은 유지된다.
  function startLock(lockUntil) {
    setFormDisabled(true);
    showAlert(lockMessage(lockUntil));
    clearInterval(state.lockTimer);
    state.lockTimer = setInterval(function () {
      if (Date.now() >= lockUntil) {
        clearInterval(state.lockTimer);
        writeAttempts({ count: 0, lockUntil: 0 });
        setFormDisabled(false);
        showAlert("다시 로그인할 수 있습니다.");
        return;
      }
      showAlert(lockMessage(lockUntil));
    }, 1000);
  }

  function initLogin() {
    if (isAuthenticated()) {
      try { sessionStorage.removeItem(STORAGE.next); } catch (error) {}
      location.replace("index.html");
      return;
    }
    document.body.classList.add("auth-ready");
    var saved = readAttempts();
    if (saved.lockUntil > Date.now()) startLock(saved.lockUntil);
    var remember = document.getElementById("rememberUser");
    var savedUser = storageGet(STORAGE.savedUser);
    if (savedUser && remember) {
      document.getElementById("username").value = savedUser;
      remember.checked = true;
    }

    var form = document.getElementById("loginForm");
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var attempts = readAttempts();
      if (attempts.lockUntil > Date.now()) {
        startLock(attempts.lockUntil);
        return;
      }
      var username = document.getElementById("username").value.trim();
      var password = document.getElementById("password").value;
      if (!username || !password) {
        showAlert("아이디와 비밀번호를 입력하세요.");
        return;
      }
      if (username === DASHBOARD_CONFIG.auth.username && password === DASHBOARD_CONFIG.auth.password) {
        if (remember && remember.checked) storageSet(STORAGE.savedUser, username);
        else try { localStorage.removeItem(STORAGE.savedUser); } catch (error) {}
        try { localStorage.removeItem(STORAGE.attempts); } catch (error) {}
        localStorage.setItem(STORAGE.session, JSON.stringify({
          user: username,
          at: Date.now(),
          stamp: credentialStamp()
        }));
        try { sessionStorage.removeItem(STORAGE.session); } catch (error) {}
        var dest = null;
        try { dest = sessionStorage.getItem(STORAGE.next); } catch (error) {}
        try { sessionStorage.removeItem(STORAGE.next); } catch (error) {}
        location.replace(safeNext(dest));
        return;
      }
      attempts.count += 1;
      var max = Number(DASHBOARD_CONFIG.login.maxAttempts || 5);
      document.getElementById("username").setAttribute("aria-invalid", "true");
      document.getElementById("password").setAttribute("aria-invalid", "true");
      if (attempts.count >= max) {
        attempts.lockUntil = Date.now() + Number(DASHBOARD_CONFIG.login.lockMinutes || 10) * 60 * 1000;
        writeAttempts(attempts);
        startLock(attempts.lockUntil);
        return;
      }
      writeAttempts(attempts);
      showAlert("아이디 또는 비밀번호가 올바르지 않습니다. (" + attempts.count + "/" + max + ")");
    });
  }

  function logoutUser() {
    clearSession();
    location.replace("login.html");
  }

  /* ---------- 데이터 ---------- */

  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (error) { return null; }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (error) {}
  }

  async function fetchText(url) {
    var response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.text();
  }

  // 파일 하나는 실패해도 나머지 카드를 계속 만든다.
  async function loadCharacters() {
    var files = (DASHBOARD_CONFIG.characterFiles || []).map(function (file) {
      return String(file).trim();
    }).filter(Boolean);
    var stamp = Date.now();
    var notices = [];
    var statsDoc = null;
    if (location.protocol === "file:") {
      notices.push("파일을 직접 열면 마크다운을 읽지 못합니다. 웹서버로 열어 주세요.");
    }
    try {
      var statsText = await fetchText("data/stats.json?t=" + stamp);
      var parsed = JSON.parse(statsText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("형식");
      statsDoc = {
        updatedAt: parsed.updatedAt || null,
        characters: parsed.characters && typeof parsed.characters === "object" ? parsed.characters : {}
      };
    } catch (error) {
      notices.push("stats.json을 읽지 못했습니다. 마크다운 안의 통계만 사용합니다.");
    }

    var rows = await Promise.all(files.map(async function (file) {
      try {
        var text = await fetchText("characters/" + encodeURIComponent(file) + "?t=" + stamp);
        var parsedCharacter = CharacterParser.parse(text, file);
        if (!parsedCharacter.ok) {
          parsedCharacter.id = parsedCharacter.id || ("error:" + file);
          return parsedCharacter;
        }
        return CharacterParser.mergeStats(parsedCharacter, statsDoc);
      } catch (error) {
        return { ok: false, fileName: file, id: "error:" + file, error: "파일을 불러오지 못했습니다." };
      }
    }));

    var seen = {};
    rows.forEach(function (row) {
      if (!row.ok) {
        if (!row.id) row.id = "error:" + row.fileName;
        return;
      }
      if (seen[row.id]) {
        row.statWarnings = (row.statWarnings || []).concat("같은 아이디가 다른 파일에도 있습니다.");
      }
      seen[row.id] = true;
    });

    var errorCount = rows.filter(function (row) { return !row.ok; }).length;
    if (errorCount) notices.push("파싱에 실패한 파일이 " + errorCount + "개 있습니다. 해당 카드만 오류로 표시합니다.");
    state.characters = rows;
    state.statsUpdatedAt = statsDoc ? statsDoc.updatedAt : null;
    state.loadedAt = new Date();
    state.notices = notices;
  }

  function findById(id) {
    return state.characters.find(function (row) { return row.id === id || row.fileName === id; }) || null;
  }

  /* ---------- 필터, 정렬, 검색 ---------- */

  function loadPrefs() {
    var filter = storageGet(STORAGE.filter);
    var sort = storageGet(STORAGE.sort);
    state.filter = FILTERS[filter] ? filter : "all";
    state.sort = SORTS[sort] ? sort : "visitors_desc";
    state.view = storageGet(STORAGE.view) === "stats" ? "stats" : "cards";
    var select = document.getElementById("sortSelect");
    if (select) select.value = state.sort;
    document.querySelectorAll("#filterTabs [data-filter]").forEach(function (button) {
      button.setAttribute("aria-pressed", button.getAttribute("data-filter") === state.filter ? "true" : "false");
    });
    syncView();
  }

  function haystack(character) {
    if (!character.ok) return [character.fileName, character.error, "파싱 오류"].join(" ").toLowerCase();
    var blogs = (character.blogs || []).map(function (blog) {
      return [blog.platform, blog.url, blog.accountId].join(" ");
    }).join(" ");
    var accounts = (character.accounts || []).map(function (account) {
      return [account.platform, account.id, account.email, account.note].join(" ");
    }).join(" ");
    return [character.name, character.nickname, character.id, character.status, character.intro, blogs, accounts].join(" ").toLowerCase();
  }

  function matchesQuery(character, query) {
    if (!query) return true;
    return haystack(character).indexOf(query) !== -1;
  }

  function matchesFilter(character, filter) {
    if (filter === "all") return true;
    if (!character.ok) return false;
    if (filter === "has") return character.todayVisitors > 0;
    if (filter === "zero") return character.todayVisitors === 0;
    return true;
  }

  function dropAmount(character) {
    if (!character.ok || character.yesterdayVisitors == null || character.todayVisitors == null) return null;
    return character.yesterdayVisitors - character.todayVisitors;
  }

  function compareCharacters(a, b) {
    if (a.ok !== b.ok) return a.ok ? -1 : 1;
    if (!a.ok) return String(a.fileName).localeCompare(String(b.fileName), "ko");
    if (state.sort === "name") return String(a.name).localeCompare(String(b.name), "ko");
    if (state.sort === "visitors_asc") {
      return (a.todayVisitors == null ? Infinity : a.todayVisitors) - (b.todayVisitors == null ? Infinity : b.todayVisitors);
    }
    if (state.sort === "posts") return (postSortValue(b) - postSortValue(a));
    if (state.sort === "drop") {
      var left = dropAmount(a);
      var right = dropAmount(b);
      return (right == null ? -Infinity : right) - (left == null ? -Infinity : left);
    }
    return (b.todayVisitors == null ? -1 : b.todayVisitors) - (a.todayVisitors == null ? -1 : a.todayVisitors);
  }

  function visibleCharacters() {
    return state.characters.filter(function (character) {
      return matchesQuery(character, state.query) && matchesFilter(character, state.filter);
    }).slice().sort(compareCharacters);
  }

  function visitorLevel(value) {
    if (value == null || !isFinite(value)) return "unknown";
    if (value === 0) return "zero";
    if (value >= DASHBOARD_CONFIG.visitorThresholds.high) return "high";
    if (value >= DASHBOARD_CONFIG.visitorThresholds.medium) return "mid";
    return "low";
  }

  function isBigDrop(character) {
    if (!character.ok || character.yesterdayVisitors == null || character.todayVisitors == null) return false;
    if (character.yesterdayVisitors < Number(DASHBOARD_CONFIG.dropMinYesterday || 0)) return false;
    if (character.yesterdayVisitors <= 0) return false;
    var rate = (character.yesterdayVisitors - character.todayVisitors) / character.yesterdayVisitors;
    return rate >= Number(DASHBOARD_CONFIG.dropRate || 0.3);
  }

  function deltaInfo(character) {
    if (!character.ok || character.yesterdayVisitors == null || character.todayVisitors == null) return null;
    var diff = character.todayVisitors - character.yesterdayVisitors;
    var direction = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
    var rate = character.yesterdayVisitors > 0 ? Math.abs(diff) / character.yesterdayVisitors : null;
    return { direction: direction, diff: diff, rate: rate, big: isBigDrop(character) };
  }

  /* ---------- 그리기 ---------- */

  function h(tag, props) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (key) {
        var value = props[key];
        if (value == null || value === false) return;
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = String(value);
        else node.setAttribute(key, String(value));
      });
    }
    for (var i = 2; i < arguments.length; i++) appendAny(node, arguments[i]);
    return node;
  }

  function appendAny(node, child) {
    if (child == null || child === false) return;
    if (Array.isArray(child)) {
      child.forEach(function (item) { appendAny(node, item); });
      return;
    }
    if (typeof child === "string" || typeof child === "number") {
      node.appendChild(document.createTextNode(String(child)));
      return;
    }
    node.appendChild(child);
  }

  function icon(className) {
    return h("i", { class: className, "aria-hidden": "true" });
  }

  var numberFormat = new Intl.NumberFormat("ko-KR");
  var reducedMotion = false;
  try { reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (error) {}

  function formatNumber(value) {
    if (value == null || !isFinite(Number(value))) return "—";
    return numberFormat.format(value);
  }

  // 자릿수 릴을 한 번만 끝까지 올린다. 큰 수는 중간 샘플을 자르면 자릿수가 되돌아가 보인다.
  function countDigits(from, to) {
    var max = Math.max(Math.abs(from), Math.abs(to));
    if (max < 1) return 1;
    return Math.max(1, Math.ceil(Math.log(max + 1) / Math.log(10)));
  }

  function countsPending() {
    var keys = Object.keys(state.blogCounts);
    for (var i = 0; i < keys.length; i++) {
      if (state.blogCounts[keys[i]].status === "loading") return true;
    }
    return false;
  }

  function digitColumns(from, to) {
    var width = countDigits(from, to);
    var columns = [];
    var cap = 16;
    var dir = to >= from ? 1 : -1;
    for (var place = width - 1; place >= 0; place--) {
      var pow = Math.pow(10, place);
      var start = Math.floor(Math.abs(from) / pow) % 10;
      var end = Math.floor(Math.abs(to) / pow) % 10;
      var steps = Math.floor(Math.abs(to - from) / pow);
      var need = (end - start + 10) % 10;
      if (steps > cap) steps = cap - (cap % 10) + need;
      else if (steps % 10 !== need) steps += (need - (steps % 10) + 10) % 10;
      if (steps < need) steps = need;
      var frames = [start];
      for (var i = 1; i <= steps; i++) frames.push((start + dir * i + 100) % 10);
      columns.push(frames);
    }
    return columns;
  }

  function reelPattern(value, width) {
    var digits = String(Math.max(0, Math.round(value)));
    while (digits.length < width) digits = "0" + digits;
    var out = "";
    for (var i = 0; i < digits.length; i++) {
      var remain = digits.length - i;
      if (i > 0 && remain % 3 === 0) out += ",";
      out += digits.charAt(i);
    }
    return out;
  }

  function ribbonDigit(frames) {
    var digit = document.createElement("span");
    digit.className = "odometer-digit" + (frames.length < 2 ? " is-still" : "");
    var spacer = document.createElement("span");
    spacer.className = "odometer-digit-spacer";
    spacer.textContent = "8";
    var inner = document.createElement("span");
    inner.className = "odometer-digit-inner";
    var ribbon = document.createElement("span");
    ribbon.className = "odometer-ribbon";
    var ribbonInner = document.createElement("span");
    ribbonInner.className = "odometer-ribbon-inner";
    for (var i = 0; i < frames.length; i++) {
      var val = document.createElement("span");
      val.className = "odometer-value" + (i === frames.length - 1 && frames.length > 1 ? " is-last" : "");
      val.textContent = String(frames[i]);
      ribbonInner.appendChild(val);
    }
    ribbon.appendChild(ribbonInner);
    inner.appendChild(ribbon);
    digit.appendChild(spacer);
    digit.appendChild(inner);
    return digit;
  }

  function clearReel(el) {
    if (el._reelTimer) clearTimeout(el._reelTimer);
    if (el._reelTimerHold) clearTimeout(el._reelTimerHold);
    el._reelTimer = 0;
    el._reelTimerHold = 0;
    el._reelBusy = false;
    el._reelCurrent = null;
    el.classList.remove("is-up", "is-animating", "is-settled");
    el.textContent = "—";
  }

  function freezeReel(el, value) {
    if (el._reelTimer) clearTimeout(el._reelTimer);
    el._reelTimer = 0;
    el._reelBusy = false;
    el._reelCurrent = value;
    // 끝난 릴의 칸과 글자 위치를 그대로 둔다. 일반 텍스트로 바꾸면 너비가 흔들린다.
    el.classList.remove("is-up");
    el.classList.add("is-animating", "is-settled");
  }

  function paintStatic(el, value) {
    if (el._reelTimer) clearTimeout(el._reelTimer);
    el._reelTimer = 0;
    el._reelBusy = false;
    el._reelCurrent = value;
    mountReel(el, value, digitColumns(value, value), 0);
    el.classList.remove("is-up", "is-animating");
    el.classList.add("is-settled");
  }

  function mountReel(el, to, columns, duration) {
    var pattern = reelPattern(to, columns.length);
    el.classList.remove("is-animating", "is-settled", "is-up");
    el.classList.add("odometer");
    el.textContent = "";
    el.style.setProperty("--reel-time", duration + "ms");
    var sr = document.createElement("span");
    sr.className = "sr-only";
    sr.textContent = formatNumber(to);
    var inside = document.createElement("span");
    inside.className = "odometer-inside";
    inside.setAttribute("aria-hidden", "true");
    var place = 0;
    for (var i = 0; i < pattern.length; i++) {
      var ch = pattern.charAt(i);
      if (ch >= "0" && ch <= "9") {
        inside.appendChild(ribbonDigit(columns[place]));
        place++;
      } else {
        var mark = document.createElement("span");
        mark.className = "odometer-formatting-mark";
        mark.textContent = ch;
        inside.appendChild(mark);
      }
    }
    el.appendChild(sr);
    el.appendChild(inside);
  }

  function playSlide(el, from, to) {
    var columns = digitColumns(from, to);
    var dist = Math.abs(to - from);
    var duration = Math.min(
      COUNT_UP_MAX_MS,
      Math.max(COUNT_UP_MIN_MS, Math.round(COUNT_UP_BASE_MS + Math.sqrt(dist) * COUNT_UP_SCALE))
    );
    if (el._reelTimer) clearTimeout(el._reelTimer);
    el._reelBusy = true;
    el._reelTarget = to;
    mountReel(el, to, columns, duration);
    var settled = false;
    function finish() {
      if (settled) return;
      settled = true;
      el.removeEventListener("transitionend", onEnd);
      if (!el.isConnected) {
        el._reelBusy = false;
        return;
      }
      freezeReel(el, to);
      // 올라가는 도중에 더 큰 값이 오면, 끝난 자리에서 그 값으로 한 번 더 올린다.
      if (typeof el._reelWant === "number" && el._reelWant !== to) commitReel(el, el._reelWant);
    }
    function onEnd(event) {
      if (!event.target.classList || !event.target.classList.contains("odometer-ribbon-inner")) return;
      if (event.propertyName && event.propertyName.indexOf("transform") === -1) return;
      finish();
    }
    el.addEventListener("transitionend", onEnd);
    el._reelTimer = setTimeout(finish, duration + 120);
    requestAnimationFrame(function () {
      if (!el.isConnected || settled) return;
      el.classList.add("is-up");
      void el.offsetHeight;
      requestAnimationFrame(function () {
        if (!el.isConnected || settled) return;
        el.classList.add("is-animating");
      });
    });
  }

  function commitReel(el, value) {
    if (!el) return;
    if (value == null || !isFinite(Number(value))) {
      clearReel(el);
      return;
    }
    value = Math.max(0, Math.round(Number(value)));
    // 카드가 문서에 붙기 전에 만들어져도 숫자를 그린다. 붙기 전에 건너뛰면 빈 칸으로 남는다.
    if (el._reelBusy) {
      el._reelWant = value;
      return;
    }
    var current = typeof el._reelCurrent === "number" ? el._reelCurrent : 0;
    if (current === value && el.classList.contains("is-settled")) return;
    if (reducedMotion || current === value) {
      paintStatic(el, value);
      return;
    }
    playSlide(el, current, value);
  }

  function whenCountsSettle(el, run) {
    if (!countsPending()) {
      run();
      return;
    }
    if (el._reelTimerHold) return;
    el._reelTimerHold = setTimeout(function tick() {
      el._reelTimerHold = 0;
      if (!el.isConnected) return;
      if (countsPending()) {
        whenCountsSettle(el, run);
        return;
      }
      run();
    }, 40);
  }

  function setOdometer(el, value) {
    if (!el) return;
    el._reelWant = value == null || !isFinite(Number(value)) ? null : Math.max(0, Math.round(Number(value)));
    whenCountsSettle(el, function () {
      commitReel(el, el._reelWant);
    });
  }

  function setHostedOdometer(parent, value, prefix) {
    if (!parent) return;
    var label = prefix || "";
    var numeric = value == null || !isFinite(Number(value)) ? null : Math.max(0, Math.round(Number(value)));
    // 집계가 끝나는 순간의 값이 이전이 아니라 최종 합계가 되도록 항상 갱신한다.
    parent._countValue = numeric;
    parent._countPrefix = label;
    if (countsPending()) {
      whenCountsSettle(parent, function () {
        if (!parent.isConnected) return;
        setHostedOdometer(parent, parent._countValue, parent._countPrefix);
      });
      return;
    }
    var reel = null;
    var prefixNode = null;
    for (var i = 0; i < parent.children.length; i++) {
      if (parent.children[i].classList.contains("odometer")) reel = parent.children[i];
      if (parent.children[i].classList.contains("odometer-prefix")) prefixNode = parent.children[i];
    }
    if (!reel || (label && (!prefixNode || prefixNode.textContent !== label))) {
      parent.textContent = "";
      if (label) {
        prefixNode = document.createElement("span");
        prefixNode.className = "odometer-prefix";
        prefixNode.textContent = label;
        parent.appendChild(prefixNode);
      }
      reel = document.createElement("span");
      reel.className = "odometer";
      parent.appendChild(reel);
    }
    setOdometer(reel, numeric);
  }

  function formatWhen(value) {
    var date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  }

  // 컴퓨터 시간대와 상관없이 한국 표준시(UTC+9, 서머타임 없음)로 맞춘다.
  function formatCountChecked(value) {
    var date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) return "";
    var seoul = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    function two(n) { return (n < 10 ? "0" : "") + n; }
    return seoul.getUTCFullYear() + "-" + two(seoul.getUTCMonth() + 1) + "-" + two(seoul.getUTCDate()) + " " + two(seoul.getUTCHours()) + ":" + two(seoul.getUTCMinutes()) + ":" + two(seoul.getUTCSeconds());
  }

  function safeUrl(url) {
    try {
      var parsed = new URL(url, location.origin);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.href;
    } catch (error) {}
    return "";
  }

  function resolveImage(imageField) {
    var fallback = DASHBOARD_CONFIG.defaultImage;
    if (!imageField) return fallback;
    var value = String(imageField).trim();
    if (/^https?:\/\//i.test(value)) return safeUrl(value) || fallback;
    if (value.indexOf("..") !== -1 || value.indexOf("\\") !== -1 || value.charAt(0) === "/") return fallback;
    return "characters/" + value.replace(/^\/+/, "");
  }

  // 블로그 주소만 같은 서버의 profile.php에 넘긴다. 사진이 없으면 기본 이미지로 떨어진다.
  function blogPhotoSources(character) {
    var blogs = (character.blogs || []).slice().sort(function (a, b) {
      return (a.paused ? 1 : 0) - (b.paused ? 1 : 0);
    });
    var sources = [];
    blogs.forEach(function (blog) {
      var href = safeUrl(blog.url || "");
      if (!href) return;
      var host = "";
      try { host = new URL(href).hostname.toLowerCase(); } catch (error) { return; }
      var allowed = host === "blog.naver.com" || host === "m.blog.naver.com" || /\.tistory\.com$/.test(host);
      if (!allowed) return;
      var base = "profile.php?blog=" + encodeURIComponent(href);
      sources.push({ thumb: base, large: base + "&size=large" });
    });
    return sources;
  }

  function avatarNode(character, className) {
    var sources = blogPhotoSources(character);
    var local = character.image ? resolveImage(character.image) : "";
    if (local && local !== DASHBOARD_CONFIG.defaultImage) sources.push({ thumb: local, large: local });
    var first = sources[0];
    var fallback = DASHBOARD_CONFIG.defaultImage;
    var img = h("img", {
      class: className || "avatar",
      src: first ? first.thumb : fallback,
      "data-photo": first ? first.large : fallback,
      alt: "",
      width: "64",
      height: "64"
    });
    var button = h("button", {
      type: "button",
      class: "avatar-btn",
      "aria-label": (character.name || "캐릭터") + " 프로필 크게 보기"
    }, img);
    var index = 0;
    img.addEventListener("error", function onError() {
      index += 1;
      if (index < sources.length) {
        img.src = sources[index].thumb;
        img.setAttribute("data-photo", sources[index].large);
        return;
      }
      if (img.dataset.fallback === "1") {
        img.removeEventListener("error", onError);
        var mark = h("span", { class: (className || "avatar") + " avatar-fallback", "aria-hidden": "true" }, icon("fa-solid fa-user"));
        button.replaceWith(mark);
        return;
      }
      img.dataset.fallback = "1";
      img.setAttribute("data-photo", fallback);
      img.src = fallback;
    });
    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      var current = button.querySelector("img");
      if (!current) return;
      openPhoto(character, current);
    });
    return button;
  }

  function ensurePhotoLayer() {
    var layer = document.getElementById("photoLayer");
    if (layer) return layer;
    layer = document.createElement("div");
    layer.id = "photoLayer";
    layer.className = "photo-layer";
    layer.hidden = true;
    layer.innerHTML = ''
      + '<div class="photo-layer-backdrop" data-photo-close="true"></div>'
      + '<div class="photo-frame" id="photoDialog" role="dialog" aria-modal="true" aria-labelledby="photoTitle">'
      + '<div class="photo-stage">'
      + '<img class="photo-img" alt="">'
      + '<button type="button" class="modal-close photo-close" data-photo-close="true" aria-label="닫기">'
      + '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4.2 4.2 L11.8 11.8 M11.8 4.2 L4.2 11.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
      + '</button></div>'
      + '<p id="photoTitle" class="photo-caption"></p>'
      + '</div>';
    document.body.appendChild(layer);
    layer.addEventListener("click", function (event) {
      var closer = event.target.closest("[data-photo-close]");
      if (!closer) return;
      if (closer.closest(".photo-frame") && !closer.classList.contains("photo-close")) return;
      closePhoto();
    });
    return layer;
  }

  function openPhoto(character, img) {
    var thumb = img.currentSrc || img.src;
    var src = img.getAttribute("data-photo") || thumb;
    if (!src) return;
    var layer = ensurePhotoLayer();
    var photo = layer.querySelector(".photo-img");
    var stage = layer.querySelector(".photo-stage");
    var caption = layer.querySelector(".photo-caption");
    function showReady() {
      if (stage) stage.classList.remove("is-waiting");
    }
    if (stage) stage.classList.add("is-waiting");
    photo.onload = showReady;
    photo.onerror = function () {
      photo.onerror = null;
      if (!thumb || photo.src === thumb) {
        showReady();
        return;
      }
      photo.src = thumb;
    };
    photo.src = src;
    if (photo.complete && photo.naturalWidth > 0) showReady();
    photo.alt = (character.name || "캐릭터") + " 프로필";
    caption.textContent = character.name || "";
    state.photoLastFocus = document.activeElement;
    layer.hidden = false;
    state.photoOpen = true;
    document.body.classList.add("photo-open");
    var closeBtn = layer.querySelector(".photo-close");
    if (closeBtn) closeBtn.focus();
  }

  function closePhoto() {
    var layer = document.getElementById("photoLayer");
    if (!layer || layer.hidden) return;
    layer.hidden = true;
    state.photoOpen = false;
    document.body.classList.remove("photo-open");
    var photo = layer.querySelector(".photo-img");
    var stage = layer.querySelector(".photo-stage");
    if (stage) stage.classList.remove("is-waiting");
    if (photo) {
      photo.onload = null;
      photo.onerror = null;
      photo.removeAttribute("src");
      photo.alt = "";
    }
    if (state.photoLastFocus && state.photoLastFocus.focus) state.photoLastFocus.focus();
    state.photoLastFocus = null;
  }

  function trapPhotoTab(event) {
    if (event.key !== "Tab" || !state.photoOpen) return false;
    var dialog = document.getElementById("photoDialog");
    if (!dialog) return false;
    var nodes = focusable(dialog);
    if (!nodes.length) return false;
    var first = nodes[0];
    var last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
    return true;
  }

  function statusClass(status) {
    if (status === "활성") return "on";
    if (status === "휴식") return "rest";
    if (status === "점검") return "check";
    if (status === "미정") return "idle";
    if (status === "중지") return "stop";
    return "idle";
  }

  function deltaNode(character) {
    var info = deltaInfo(character);
    if (!info) return null;
    var cls = "delta is-" + info.direction + (info.big ? " is-big" : "");
    var label = info.direction === "up" ? "증가" : info.direction === "down" ? "감소" : "변동 없음";
    var iconClass = info.direction === "up" ? "fa-solid fa-arrow-trend-up" : info.direction === "down" ? "fa-solid fa-arrow-trend-down" : "fa-solid fa-minus";
    var absText = formatNumber(Math.abs(info.diff));
    var percent = info.rate == null ? "" : " (" + Math.round(info.rate * 100) + "%)";
    var sr = "어제보다 " + absText + "명 " + label;
    if (info.rate != null) sr += ", " + Math.round(info.rate * 100) + "퍼센트";
    if (info.big) sr += ". 전일 대비 크게 감소";
    return h("p", { class: cls },
      icon(iconClass),
      h("span", { text: absText + percent }),
      h("span", { class: "sr-only", text: sr }),
      h("span", { class: "delta-base", text: "어제 " + formatNumber(character.yesterdayVisitors) })
    );
  }

  function accountPairs(character) {
    if (character.accounts && character.accounts.length) {
      return character.accounts.map(function (account) {
        return { platform: account.platform || "계정", id: account.id || account.email || "" };
      }).filter(function (item) { return item.id; });
    }
    return (character.blogs || []).filter(function (blog) { return blog.accountId; }).map(function (blog) {
      return { platform: blog.platform || "블로그", id: blog.accountId };
    });
  }

  function accountNode(character) {
    var pairs = accountPairs(character);
    var wrap = h("ul", { class: "account-list" });
    if (!pairs.length) {
      wrap.appendChild(h("li", { class: "account-empty", text: "계정 아이디 없음" }));
      return wrap;
    }
    pairs.slice(0, 3).forEach(function (pair) {
      wrap.appendChild(h("li", null,
        h("span", { class: "plat", text: String(pair.platform).slice(0, 1) || "계" }),
        h("span", { class: "plat-name", text: pair.platform }),
        h("span", { class: "plat-id", text: pair.id })
      ));
    });
    if (pairs.length > 3) wrap.appendChild(h("li", { class: "account-more", text: "+" + (pairs.length - 3) }));
    return wrap;
  }

  function countableBlogUrl(url) {
    var href = safeUrl(url);
    if (!href) return "";
    try {
      var parsed = new URL(href);
      if (parsed.protocol !== "https:") return "";
      var host = parsed.hostname.toLowerCase();
      var naver = host === "blog.naver.com" || host === "m.blog.naver.com";
      var tistory = /^[a-z0-9-]+\.tistory\.com$/.test(host);
      if (!naver && !tistory) return "";
      parsed.hash = "";
      if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, "");
      return parsed.href;
    } catch (error) {
      return "";
    }
  }

  function normalizeCount(value) {
    if (typeof value !== "number" || !isFinite(value) || value < 0 || Math.floor(value) !== value) return null;
    return value;
  }

  function livePostTotal(character) {
    var sum = 0;
    var known = false;
    (character.blogs || []).forEach(function (blog) {
      var key = countableBlogUrl(blog.url || "");
      var data = key && state.blogCounts[key];
      if (data && data.status === "ok" && data.posts != null) {
        known = true;
        sum += data.posts;
      }
    });
    return known ? sum : null;
  }

  function postSortValue(character) {
    var live = livePostTotal(character);
    if (live != null) return live;
    return character.postCount == null ? -1 : character.postCount;
  }

  function paintTodayPlus(span, today, label) {
    var host = span.querySelector(".count-pair") || span;
    var plus = host.querySelector(".count-plus");
    if (!(today > 0)) {
      if (plus) plus.remove();
      return;
    }
    if (!plus) {
      plus = document.createElement("span");
      plus.className = "count-plus";
      var sign = document.createElement("span");
      sign.className = "count-plus-sign";
      sign.setAttribute("aria-hidden", "true");
      sign.textContent = "+";
      var reel = document.createElement("span");
      reel.className = "odometer";
      plus.appendChild(sign);
      plus.appendChild(reel);
      host.appendChild(plus);
    }
    plus.title = "오늘 올라온 " + label + " " + formatNumber(today);
    setOdometer(plus.querySelector(".odometer"), today);
  }

  function fillBlogCounts(el, url) {
    var key = countableBlogUrl(url);
    var data = key ? state.blogCounts[key] : null;
    var activity = el.getAttribute("data-counts-mode") === "activity";
    var loading = !!(key && (!data || data.status === "loading"));
    el.classList.toggle("is-loading", loading);
    if (loading) {
      el.textContent = "집계 중";
      return;
    }
    Array.prototype.slice.call(el.childNodes).forEach(function (node) {
      if (node.nodeType === 3) node.remove();
    });
    var posts = data && data.status === "ok" ? data.posts : null;
    var comments = data && data.status === "ok" ? data.comments : null;
    var postsToday = data && data.status === "ok" ? data.postsToday : null;
    var commentsToday = data && data.status === "ok" ? data.commentsToday : null;
    var items = [];
    if (!activity) {
      items.push({ label: "오늘", value: data && data.status === "ok" ? data.today : null });
      items.push({ label: "전체", value: data && data.status === "ok" ? data.total : null });
    }
    items.push({ label: "글", icon: "fa-solid fa-file-lines", value: posts, today: postsToday });
    items.push({ label: "댓글", icon: "fa-solid fa-comment", value: comments, today: commentsToday });
    var keep = {};
    items.forEach(function (item) {
      keep[item.label] = true;
      var span = el.querySelector('[data-count-label="' + item.label + '"]');
      if (!span) {
        span = document.createElement("span");
        span.setAttribute("data-count-label", item.label);
        if (item.icon) {
          span.appendChild(icon(item.icon));
          span.appendChild(document.createTextNode(" " + item.label + " "));
        } else {
          span.appendChild(document.createTextNode(item.label + " "));
        }
        var pair = document.createElement("span");
        pair.className = "count-pair";
        var reel = document.createElement("span");
        reel.className = "odometer";
        pair.appendChild(reel);
        span.appendChild(pair);
        el.appendChild(span);
      }
      // 총 6개 중 오늘 2개면 6이 아니라 4+2. 오늘 수가 없거나 총수보다 크면 총수만 보여 준다.
      var showPlus = (item.label === "글" || item.label === "댓글")
        && typeof item.value === "number"
        && typeof item.today === "number"
        && item.today > 0
        && item.today <= item.value;
      span.removeAttribute("title");
      paintTodayPlus(span, showPlus ? item.today : 0, item.label);
      setOdometer(span.querySelector(".count-pair > .odometer"), showPlus ? item.value - item.today : item.value);
    });
    Array.prototype.slice.call(el.children).forEach(function (child) {
      var label = child.getAttribute("data-count-label");
      if (label && !keep[label]) child.remove();
    });
  }

  function blogCountsEl(url, mode) {
    var key = countableBlogUrl(url);
    var props = { class: "blog-counts", "data-blog-counts": key };
    if (mode) props["data-counts-mode"] = mode;
    var el = h("span", props);
    fillBlogCounts(el, url);
    return el;
  }

  function paintBlogCounts(key) {
    document.querySelectorAll("[data-blog-counts]").forEach(function (el) {
      var elKey = el.getAttribute("data-blog-counts");
      if (key && elKey !== key) return;
      fillBlogCounts(el, elKey);
    });
  }

  function applyCountPayload(key, data) {
    state.blogCounts[key] = {
      status: "ok",
      posts: normalizeCount(data && data.posts),
      comments: normalizeCount(data && data.comments),
      today: normalizeCount(data && data.today),
      total: normalizeCount(data && data.total),
      postsToday: normalizeCount(data && data.postsToday),
      commentsToday: normalizeCount(data && data.commentsToday)
    };
  }

  // 이미 보이는 숫자에서 새 숫자로 올린다. 집계 중으로 바꾸면 릴이 지워져 0부터 다시 센다.
  function refreshLiveCounts() {
    if (state.countRefreshBusy || state.loading || !state.ready || countsPending()) return;
    if (document.body.classList.contains("is-booting")) return;
    var keys = [];
    state.characters.forEach(function (character) {
      (character.blogs || []).forEach(function (blog) {
        var key = countableBlogUrl(blog.url || "");
        if (key && keys.indexOf(key) < 0) keys.push(key);
      });
    });
    if (!keys.length) return;
    var gen = state.countRefreshGen;
    state.countRefreshBusy = true;
    setCountReloadBusy(true);
    var left = keys.length;
    function finish() {
      left -= 1;
      if (left > 0) return;
      state.countRefreshBusy = false;
      setCountReloadBusy(false);
      if (gen !== state.countRefreshGen || state.loading) return;
      applyLiveCounts(null);
    }
    keys.forEach(function (key) {
      fetch("profile.php?view=counts&blog=" + encodeURIComponent(key), { headers: { "Accept": "application/json" } })
        .then(function (response) {
          if (!response.ok) throw new Error("counts");
          return response.json();
        })
        .then(function (data) {
          if (gen !== state.countRefreshGen) return;
          applyCountPayload(key, data);
        })
        .catch(function () {})
        .then(finish, finish);
    });
  }

  function setCountReloadBusy(busy) {
    var button = document.getElementById("countReload");
    if (!button) return;
    var icon = button.querySelector("i");
    if (button._spinTimer) {
      clearTimeout(button._spinTimer);
      button._spinTimer = 0;
    }
    if (icon && button._spinDone) {
      icon.removeEventListener("animationiteration", button._spinDone);
      button._spinDone = null;
    }
    if (busy) {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      if (icon && !reducedMotion) icon.classList.add("is-spin");
      return;
    }
    function release() {
      button._spinDone = null;
      if (button._spinTimer) {
        clearTimeout(button._spinTimer);
        button._spinTimer = 0;
      }
      if (icon) {
        icon.removeEventListener("animationiteration", release);
        icon.classList.remove("is-spin");
      }
      button.disabled = false;
      button.setAttribute("aria-busy", "false");
    }
    if (!icon || reducedMotion || !icon.classList.contains("is-spin")) {
      release();
      return;
    }
    button._spinDone = release;
    icon.addEventListener("animationiteration", release);
    button._spinTimer = setTimeout(release, 700);
  }

  function startCountWatch() {
    if (state.countTimer) return;
    state.countTimer = setInterval(refreshLiveCounts, COUNT_REFRESH_MS);
  }

  function requestBlogCounts() {
    var pending = [];
    state.characters.forEach(function (character) {
      (character.blogs || []).forEach(function (blog) {
        var key = countableBlogUrl(blog.url || "");
        if (!key || state.blogCounts[key]) return;
        state.blogCounts[key] = { status: "loading" };
        pending.push(key);
      });
    });
    pending.forEach(function (key) {
      fetch("profile.php?view=counts&blog=" + encodeURIComponent(key), { headers: { "Accept": "application/json" } })
        .then(function (response) {
          if (!response.ok) throw new Error("counts");
          return response.json();
        })
        .then(function (data) {
          applyCountPayload(key, data);
          applyLiveCounts(key);
        })
        .catch(function () {
          state.blogCounts[key] = { status: "fail" };
          applyLiveCounts(key);
        });
    });
  }

  function externalLink(href) {
    return h("a", {
      class: "ext-link",
      href: href,
      target: "_blank",
      rel: "noopener noreferrer"
    },
      h("span", { class: "ext-link-text", text: href }),
      icon("fa-solid fa-arrow-up-right-from-square"),
      h("span", { class: "sr-only", text: "새 창" })
    );
  }

  function compareBlogs(a, b) {
    var platform = String(a.platform || "").localeCompare(String(b.platform || ""), "ko");
    if (platform) return platform;
    return String(a.url || "").localeCompare(String(b.url || ""), "ko");
  }

  function applyVisitorBlog(block, url) {
    var key = countableBlogUrl(url);
    var data = key ? state.blogCounts[key] : null;
    var loading = !!(key && (!data || data.status === "loading"));
    var today = data && data.status === "ok" ? data.today : null;
    var total = data && data.status === "ok" ? data.total : null;
    var num = block.querySelector("[data-blog-today]");
    var totalEl = block.querySelector("[data-blog-total]");
    if (num) {
      if (loading) num.textContent = "…";
      else setHostedOdometer(num, today);
    }
    if (totalEl) {
      if (loading) totalEl.textContent = "전체 …";
      else setHostedOdometer(totalEl, total, "전체 ");
    }
    ["unknown", "zero", "low", "mid", "high"].forEach(function (name) {
      block.classList.remove("is-" + name);
    });
    block.classList.add("is-" + (loading || today == null ? "unknown" : visitorLevel(today)));
  }

  function pausedMark() {
    return h("span", { class: "visitor-paused", text: "미운영" });
  }

  function blogsWithUrl(character) {
    return (character.blogs || []).filter(function (blog) {
      return String(blog.url || "").trim();
    }).sort(compareBlogs);
  }

  function visitorBlogsNode(character) {
    var blogs = blogsWithUrl(character);
    if (!blogs.length) {
      return h("p", { class: "visitor-note", text: "블로그 없음" });
    }
    var wrap = h("div", { class: "visitor-blogs" + (blogs.length === 1 ? " is-single" : "") });
    blogs.forEach(function (blog) {
      var key = countableBlogUrl(blog.url) || safeUrl(blog.url) || blog.url;
      var block = h("div", { class: "visitor-blog", "data-visitor-blog": key },
        h("p", { class: "visitor-label" },
          (blog.platform || "블로그") + " · 오늘",
          blog.paused ? pausedMark() : null
        ),
        h("p", { class: "visitor-num", "data-blog-today": "1", text: "…" }),
        h("p", { class: "visitor-total", "data-blog-total": "1", text: "전체 …" })
      );
      applyVisitorBlog(block, key);
      wrap.appendChild(block);
    });
    return wrap;
  }

  function blogLinks(character) {
    var blogs = blogsWithUrl(character);
    var wrap = h("div", { class: "blog-links" });
    if (!blogs.length) {
      wrap.appendChild(h("p", { class: "blog-empty", text: "블로그 없음" }));
      return wrap;
    }
    blogs.forEach(function (blog) {
      var href = safeUrl(blog.url);
      var row = h("div", { class: blog.platform ? "blog-row" : "blog-row is-plain" });
      if (blog.platform) {
        row.appendChild(h("span", { class: "blog-platform" },
          blog.platform,
          blog.paused ? pausedMark() : null
        ));
      }
      if (href) row.appendChild(externalLink(href));
      else row.appendChild(h("span", { class: "warn", text: "주소는 http 또는 https만 열 수 있습니다." }));
      row.appendChild(blogCountsEl(blog.url, "activity"));
      wrap.appendChild(row);
    });
    return wrap;
  }

  function detailLink(id, label) {
    return h("a", {
      class: "card-detail",
      href: "detail.html?id=" + encodeURIComponent(id),
      "data-id": id,
      "aria-label": label,
      title: "상세 보기"
    }, icon("fa-solid fa-chevron-right"));
  }

  function renderErrorCard(character) {
    return h("article", { class: "card card-error" },
      detailLink(character.id, (character.fileName || "파일") + " 상세 페이지"),
      h("div", { class: "card-body" },
        h("div", { class: "card-error-mark" }, icon("fa-solid fa-triangle-exclamation")),
        h("h2", { class: "card-name", text: "파싱 오류" }),
        h("p", { class: "card-file", text: character.fileName || "" }),
        h("p", { class: "card-error-msg", text: character.error || "파싱 오류" })
      )
    );
  }

  function renderCard(character) {
    if (!character.ok) return renderErrorCard(character);
    var level = visitorLevel(character.todayVisitors);
    var classes = ["card", "is-" + level];
    if (isBigDrop(character)) classes.push("is-drop");
    return h("article", { class: classes.join(" "), "data-character": character.id },
      h("div", { class: "meter", "aria-hidden": "true" }, h("span")),
      detailLink(character.id, character.name + " 상세 페이지"),
      h("div", { class: "card-body" },
        h("div", { class: "card-head" },
          avatarNode(character),
          h("div", { class: "card-id" },
            h("h2", { class: "card-name", text: character.name }),
            character.nickname ? h("p", { class: "card-nick", text: character.nickname }) : null,
            h("span", { class: "badge badge-" + statusClass(character.status), text: character.status || "미정" })
          )
        ),
        visitorBlogsNode(character),
        deltaNode(character),
        accountNode(character)
      ),
      blogLinks(character)
    );
  }

  function showSkeleton() {
    var grid = document.getElementById("cardGrid");
    if (!grid) return;
    grid.replaceChildren();
    grid.setAttribute("aria-busy", "true");
    for (var i = 0; i < 6; i++) {
      grid.appendChild(h("article", { class: "card skeleton-card", "aria-hidden": "true" },
        h("div", { class: "skeleton sk-avatar" }),
        h("div", { class: "skeleton sk-line" }),
        h("div", { class: "skeleton sk-num" }),
        h("div", { class: "skeleton sk-line short" })
      ));
    }
    var empty = document.getElementById("emptyState");
    if (empty) empty.hidden = true;
  }

  function renderNotice() {
    var el = document.getElementById("notice");
    if (!el) return;
    if (!state.notices.length) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = state.notices.join(" ");
  }

  function renderMetrics() {
    var ok = state.characters.filter(function (row) { return row.ok; });
    var errors = state.characters.length - ok.length;
    var count = document.getElementById("tabCardCount");
    var visitors = document.getElementById("statVisitors");
    var totalVisitors = document.getElementById("statTotal");
    if (count) count.textContent = String(ok.length);
    if (visitors) setHostedOdometer(visitors, summedVisitors(ok, "todayVisitors"));
    if (totalVisitors) setHostedOdometer(totalVisitors, summedVisitors(ok, "totalVisitors"));
    var errorEl = document.getElementById("statErrors");
    if (errorEl) {
      errorEl.hidden = !errors;
      errorEl.textContent = errors ? "오류 " + errors : "";
    }
    var updated = document.getElementById("updatedAt");
    var basis = document.getElementById("statsBasis");
    if (updated) updated.textContent = state.loadedAt ? "화면 갱신 " + formatWhen(state.loadedAt) : "화면 갱신 —";
    if (basis) basis.textContent = state.statsUpdatedAt ? "통계 기준 " + formatWhen(state.statsUpdatedAt) : "통계 기준 —";
  }

  function summedVisitors(rows, field) {
    var sum = 0;
    var known = false;
    rows.forEach(function (row) {
      if (!row.ok || typeof row[field] !== "number" || !isFinite(row[field])) return;
      known = true;
      sum += row[field];
    });
    return known ? sum : null;
  }

  function updateCounts() {
    var matched = state.characters.filter(function (row) { return matchesQuery(row, state.query); });
    var counts = {
      all: matched.length,
      has: matched.filter(function (row) { return row.ok && row.todayVisitors > 0; }).length,
      zero: matched.filter(function (row) { return row.ok && row.todayVisitors === 0; }).length
    };
    Object.keys(counts).forEach(function (key) {
      var el = document.getElementById("count-" + key);
      if (el) el.textContent = String(counts[key]);
    });
  }

  function buildEmpty() {
    var noData = state.characters.length === 0;
    var title = noData ? "등록된 캐릭터가 없습니다" : "조건에 맞는 캐릭터가 없습니다";
    var text = noData
      ? "characters 폴더에 마크다운을 추가하고 config.js의 characterFiles에 파일명을 적어 주세요."
      : (state.queryRaw
        ? "‘" + state.queryRaw + "’ 검색 결과가 없습니다. 다른 단어로 찾아 보세요."
        : "이 필터에 해당하는 캐릭터가 없습니다.");
    var box = h("div", { class: "empty-inner" },
      icon("fa-solid fa-folder-open"),
      h("h2", { text: title }),
      h("p", { text: text })
    );
    if (!noData) {
      var reset = h("button", { type: "button", class: "btn-dark" }, "필터 초기화");
      reset.addEventListener("click", resetView);
      box.appendChild(reset);
    }
    return box;
  }

  function renderGrid(list) {
    var grid = document.getElementById("cardGrid");
    var empty = document.getElementById("emptyState");
    if (!grid || !empty) return;
    if (!list.length) {
      grid.replaceChildren();
      empty.hidden = false;
      empty.replaceChildren(buildEmpty());
      return;
    }
    empty.hidden = true;
    grid.replaceChildren();
    list.forEach(function (row) { grid.appendChild(renderCard(row)); });
  }

  function countText(blog) {
    var key = countableBlogUrl(blog.url || "");
    var data = key && state.blogCounts[key];
    if (key && (!data || data.status === "loading")) return ["집계 중", "집계 중", "집계 중", "집계 중"];
    if (!data || data.status !== "ok") return ["—", "—", "—", "—"];
    return [formatNumber(data.posts), formatNumber(data.comments), formatNumber(data.today), formatNumber(data.total)];
  }

  function renderStatsTable() {
    var host = document.getElementById("statsTable");
    if (!host) return;
    var rows = visibleCharacters();
    if (!rows.length) {
      host.replaceChildren(h("p", { class: "stats-empty", text: "표시할 캐릭터가 없습니다." }));
      return;
    }
    var table = h("table", { class: "stats-table" });
    table.appendChild(h("caption", { class: "sr-only", text: "캐릭터별 블로그 방문자와 글, 댓글" }));
    table.appendChild(h("thead", null, h("tr", null,
      h("th", { text: "캐릭터" }),
      h("th", { text: "블로그" }),
      h("th", { text: "오늘" }),
      h("th", { text: "전체" }),
      h("th", { text: "글" }),
      h("th", { text: "댓글" })
    )));
    var body = h("tbody");
    rows.forEach(function (character) {
      var blogs = character.ok ? blogsWithUrl(character) : [];
      var span = Math.max(1, blogs.length);
      var nameCell = h("th", { scope: "row", text: character.ok ? character.name : "파싱 오류" });
      if (span > 1) nameCell.rowSpan = span;
      if (!blogs.length) {
        body.appendChild(h("tr", null, nameCell, h("td", { text: "없음" }), h("td", { class: "num", text: "—" }), h("td", { class: "num", text: "—" }), h("td", { class: "num", text: "—" }), h("td", { class: "num", text: "—" })));
        return;
      }
      blogs.forEach(function (blog, index) {
        var counts = countText(blog);
        var cells = [
          h("td", null, h("span", { class: "stats-platform" },
            blog.platform || "블로그",
            blog.paused ? pausedMark() : null
          )),
          h("td", { class: "num", text: counts[2] }),
          h("td", { class: "num", text: counts[3] }),
          h("td", { class: "num", text: counts[0] }),
          h("td", { class: "num", text: counts[1] })
        ];
        if (index === 0) body.appendChild(h("tr", null, nameCell, cells));
        else body.appendChild(h("tr", null, cells));
      });
    });
    table.appendChild(body);
    host.replaceChildren(h("div", { class: "stats-table-wrap" }, table));
  }

  function barColor(character) {
    var level = visitorLevel(character.todayVisitors);
    if (level === "zero") return "#6e6e80";
    if (level === "high") return "#f5a623";
    if (level === "mid") return "#5266eb";
    if (level === "unknown") return "#3a3a48";
    return "#9aa6ee";
  }

  function chartValueHost(wrap) {
    var host = wrap.querySelector(".chart-values");
    if (host) return host;
    host = document.createElement("div");
    host.className = "chart-values";
    host.setAttribute("aria-hidden", "true");
    wrap.appendChild(host);
    return host;
  }

  function chartBarValue(bar, scale, finalValue) {
    if (!finalValue) return 0;
    var base = scale.getPixelForValue(0);
    var target = scale.getPixelForValue(finalValue);
    var span = base - target;
    if (!span) return finalValue;
    if (Math.abs(bar.y - target) < 0.6) return finalValue;
    var raw = ((base - bar.y) / span) * finalValue;
    if (raw < 0) raw = 0;
    if (raw > finalValue) raw = finalValue;
    return Math.round(raw);
  }

  function showChartCount(el, value) {
    if (el._chartShown === value && el.querySelector(".odometer")) return;
    el._chartShown = value;
    var reel = el.querySelector(".odometer");
    if (!reel) {
      reel = document.createElement("span");
      reel.className = "odometer";
      el.appendChild(reel);
    }
    paintStatic(reel, value);
  }

  function followChartValues(chart) {
    if (!chart || !chart.canvas || !chart.scales || !chart.scales.y) return;
    var host = chart.canvas.parentNode.querySelector(".chart-values");
    var rows = chart.$chartRows || [];
    var meta = chart.getDatasetMeta(0);
    if (!host || !meta || !meta.data) return;
    var scale = chart.scales.y;
    rows.forEach(function (row, index) {
      var el = host.querySelector('[data-chart-value="' + row.id + '"]');
      var bar = meta.data[index];
      if (!el || !bar) return;
      el.style.left = bar.x + "px";
      el.style.top = bar.y + "px";
      if (!chart.$rise) return;
      showChartCount(el, chartBarValue(bar, scale, row.todayVisitors || 0));
    });
  }

  function syncChartValues(chart, rows, replay, rise) {
    var host = chartValueHost(chart.canvas.parentNode);
    var seen = {};
    rows.forEach(function (row) {
      seen[row.id] = true;
      var el = host.querySelector('[data-chart-value="' + row.id + '"]');
      if (!el) {
        el = document.createElement("span");
        el.className = "chart-value";
        el.setAttribute("data-chart-value", row.id);
        host.appendChild(el);
      }
      var reel = el.querySelector(".odometer");
      // 탭을 나갔다가 돌아오면 끝난 릴을 버리고 막대와 함께 0부터 올린다.
      // 같은 탭에 있는 동안의 새로고침은 지금 숫자에서 이어간다.
      if (!reel || replay || rise) {
        var fresh = document.createElement("span");
        fresh.className = "odometer";
        if (reel) reel.replaceWith(fresh);
        else el.appendChild(fresh);
        reel = fresh;
      }
      el._chartShown = null;
      if (rise) paintStatic(reel, 0);
      else setOdometer(reel, row.todayVisitors || 0);
    });
    Array.prototype.slice.call(host.children).forEach(function (child) {
      if (!seen[child.getAttribute("data-chart-value")]) child.remove();
    });
    chart.$chartRows = rows;
  }

  var barValuePlugin = {
    id: "barValues",
    afterDraw: function (chart) {
      followChartValues(chart);
    }
  };

  function renderChart(options) {
    var wrap = document.getElementById("chartWrap");
    var empty = document.getElementById("chartEmpty");
    var canvas = document.getElementById("visitorChart");
    if (!wrap || !canvas) return;
    var existed = !!state.chart;
    var rise = !reducedMotion && (!!(options && options.rise) || !existed);
    if (state.chart) {
      state.chart.destroy();
      state.chart = null;
    }
    var rows = visibleCharacters().filter(function (row) { return row.ok; });
    if (!rows.length || typeof Chart === "undefined") {
      wrap.hidden = true;
      var stale = wrap.querySelector(".chart-values");
      if (stale) stale.replaceChildren();
      if (empty) {
        empty.hidden = false;
        empty.textContent = typeof Chart === "undefined" ? "Chart.js를 불러오지 못했습니다." : "그래프를 표시할 캐릭터가 없습니다.";
      }
      return;
    }
    wrap.hidden = false;
    if (empty) empty.hidden = true;
    try {
      state.chart = new Chart(canvas, {
        type: "bar",
        plugins: [barValuePlugin],
        data: {
          labels: rows.map(function (row) { return row.name; }),
          datasets: [{
            label: "오늘 방문자",
            data: rows.map(function (row) { return row.todayVisitors || 0; }),
            backgroundColor: rows.map(barColor),
            borderRadius: 8,
            maxBarThickness: 64
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: rise ? 1000 : 0 },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: "#11111d",
              titleColor: "#ededf3",
              bodyColor: "#c3c3cc",
              borderColor: "#2c2c3a",
              borderWidth: 1,
              callbacks: {
                label: function (item) { return "오늘 방문자 " + formatNumber(item.parsed.y); }
              }
            }
          },
          layout: { padding: { top: 8, left: 4, right: 18 } },
          scales: {
            x: { ticks: { color: "#c3c3cc", maxRotation: 0, minRotation: 0, autoSkip: false, font: { size: 12 } }, grid: { display: false } },
            y: { beginAtZero: true, grace: "22%", ticks: { color: "#9a9aa8", precision: 0 }, grid: { color: "#2c2c3a" } }
          }
        }
      });
      state.chart.$rise = rise;
      state.chart.$chartRows = rows;
      syncChartValues(state.chart, rows, !!(options && options.replay), rise);
      followChartValues(state.chart);
    } catch (error) {
      wrap.hidden = true;
      if (empty) {
        empty.hidden = false;
        empty.textContent = "그래프를 그리지 못했습니다.";
      }
    }
  }

  function syncView() {
    var stats = state.view === "stats";
    var cards = document.getElementById("cards");
    var panel = document.getElementById("statsPanel");
    var tabCards = document.getElementById("tabCards");
    var tabStats = document.getElementById("tabStats");
    if (cards) cards.hidden = stats;
    if (panel) panel.hidden = !stats;
    if (tabCards) {
      tabCards.setAttribute("aria-selected", stats ? "false" : "true");
      tabCards.tabIndex = stats ? -1 : 0;
    }
    if (tabStats) {
      tabStats.setAttribute("aria-selected", stats ? "true" : "false");
      tabStats.tabIndex = stats ? 0 : -1;
    }
  }

  function countableBlogs(character) {
    return (character.blogs || []).filter(function (blog) { return countableBlogUrl(blog.url || ""); });
  }

  function syncLiveVisitors() {
    state.characters.forEach(function (character) {
      if (!character.ok) return;
      var blogs = countableBlogs(character);
      if (!blogs.length) return;
      var todaySum = 0;
      var totalSum = 0;
      var todayKnown = 0;
      var totalKnown = 0;
      var pending = false;
      blogs.forEach(function (blog) {
        var data = state.blogCounts[countableBlogUrl(blog.url)];
        if (!data || data.status === "loading") {
          pending = true;
          return;
        }
        if (data.status !== "ok") return;
        if (data.today != null) {
          todaySum += data.today;
          todayKnown += 1;
        }
        if (data.total != null) {
          totalSum += data.total;
          totalKnown += 1;
        }
      });
      if (todayKnown > 0) character.todayVisitors = todaySum;
      if (totalKnown > 0) character.totalVisitors = totalSum;
      character.visitorPartial = !pending && (todayKnown < blogs.length || totalKnown < blogs.length);
    });
  }

  function paintVisitorFigures() {
    syncLiveVisitors();
    renderMetrics();
    document.querySelectorAll("[data-character]").forEach(function (card) {
      var character = findById(card.getAttribute("data-character"));
      if (!character || !character.ok) return;
      card.querySelectorAll("[data-visitor-blog]").forEach(function (block) {
        applyVisitorBlog(block, block.getAttribute("data-visitor-blog"));
      });
      card.classList.remove("is-unknown", "is-zero", "is-low", "is-mid", "is-high");
      card.classList.add("is-" + visitorLevel(character.todayVisitors));
    });
    document.querySelectorAll("[data-stat-today]").forEach(function (el) {
      var character = findById(el.getAttribute("data-stat-today"));
      if (character) setHostedOdometer(el, character.todayVisitors);
    });
    document.querySelectorAll("[data-stat-total]").forEach(function (el) {
      var character = findById(el.getAttribute("data-stat-total"));
      if (character) setHostedOdometer(el, character.totalVisitors);
    });
  }

  // 카드 순서가 확정된 뒤에만 본문을 연다.
  function revealDashboard(force) {
    if (!document.body.classList.contains("is-booting")) return;
    if (!force && countsPending()) return;
    if (state.bootTimer) {
      clearTimeout(state.bootTimer);
      state.bootTimer = 0;
    }
    document.body.classList.remove("is-booting");
    if (pageReloaded()) window.scrollTo(0, 0);
    else if (scrollAfterBoot) {
      scrollAfterBoot = false;
      applySavedScroll();
    }
    if (state.view !== "stats") return;
    requestAnimationFrame(function () {
      if (state.chart && state.chart.resize) state.chart.resize();
      else {
        renderStatsTable();
        renderChart();
      }
    });
  }

  function armBootHold() {
    if (!document.body.classList.contains("is-booting") || state.bootTimer) return;
    state.bootTimer = setTimeout(function () {
      state.bootTimer = 0;
      revealDashboard(true);
    }, 12000);
  }

  function reorderCards(list) {
    var grid = document.getElementById("cardGrid");
    if (!grid) return false;
    var cards = grid.querySelectorAll("article.card[data-character]");
    if (cards.length !== list.length) return false;
    var have = {};
    for (var i = 0; i < cards.length; i++) have[cards[i].getAttribute("data-character")] = cards[i];
    for (var j = 0; j < list.length; j++) if (!have[list[j].id]) return false;
    var frag = document.createDocumentFragment();
    list.forEach(function (row) { frag.appendChild(have[row.id]); });
    grid.appendChild(frag);
    return true;
  }

  function applyLiveCounts(key) {
    syncLiveVisitors();
    var list = visibleCharacters();
    var pending = countsPending();
    // 응답이 하나씩 올 때마다 옮기면 카드가 겹쳐 보인다. 집계가 끝난 뒤 한 번만 맞춘다.
    if (!pending && document.getElementById("cardGrid")) {
      var current = [];
      document.querySelectorAll("#cardGrid article.card[data-character]").forEach(function (card) {
        current.push(card.getAttribute("data-character"));
      });
      if (current.join("|") !== list.map(function (row) { return row.id; }).join("|")) {
        if (!reorderCards(list)) {
          render();
          return;
        }
      }
    }
    if (!pending && state.view === "stats") {
      renderStatsTable();
      renderChart();
    }
    paintVisitorFigures();
    paintBlogCounts(key);
    if (!pending) {
      markCountChecked();
      revealDashboard();
    }
  }

  function stampChars(el) {
    var nodes = el.querySelectorAll(".tab-ch");
    if (!nodes.length) return el.textContent;
    var text = "";
    for (var i = 0; i < nodes.length; i++) text += nodes[i].textContent;
    return text;
  }

  function paintStamp(el, stamp) {
    if (stampChars(el) === stamp) return;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < stamp.length; i++) {
      var ch = stamp.charAt(i);
      var span = document.createElement("span");
      var kind = "tab-ch";
      if (ch >= "0" && ch <= "9") kind += " is-digit";
      else if (ch === " ") kind += " is-gap";
      span.className = kind;
      span.textContent = ch;
      frag.appendChild(span);
    }
    el.replaceChildren(frag);
  }

  function markCountChecked() {
    var el = document.getElementById("countUpdated");
    state.countCheckedAt = new Date();
    if (!el) return;
    var stamp = formatCountChecked(state.countCheckedAt);
    el.dateTime = stamp.replace(" ", "T") + "+09:00";
    paintStamp(el, stamp);
  }

  function render(options) {
    if (!state.ready || state.loading) return;
    syncLiveVisitors();
    renderNotice();
    renderMetrics();
    updateCounts();
    var visible = visibleCharacters();
    renderGrid(visible);
    syncView();
    if (state.view === "stats") {
      renderStatsTable();
      renderChart();
    }
    requestBlogCounts();
    var info = document.getElementById("resultInfo");
    if (info) info.textContent = "표시 중 " + visible.length + "개";
    if (options && options.refreshModal && state.modalOpen && state.activeId) {
      var current = findById(state.activeId);
      var body = document.getElementById("modalBody");
      if (!current) closeModal();
      else if (body) body.replaceChildren(buildDetailView(current));
    }
    // 방문자 수가 오기 전에 열면 기본 순서가 보였다가 다시 정렬된다.
    if (!countsPending()) revealDashboard();
    else armBootHold();
  }

  function resetView() {
    state.query = "";
    state.queryRaw = "";
    state.filter = "all";
    var input = document.getElementById("searchInput");
    if (input) {
      input.value = "";
      input.focus();
    }
    var clear = document.getElementById("clearSearch");
    if (clear) clear.hidden = true;
    storageSet(STORAGE.filter, "all");
    document.querySelectorAll("#filterTabs [data-filter]").forEach(function (button) {
      button.setAttribute("aria-pressed", button.getAttribute("data-filter") === "all" ? "true" : "false");
    });
    render();
  }

  /* ---------- 상세 ---------- */

  function buildBasicPanel(character) {
    var panel = h("div", { class: "panel" });
    var grid = h("dl", { class: "stat-grid" });
    [
      ["오늘 방문자", character.todayVisitors, "data-stat-today"],
      ["전체 방문자", character.totalVisitors, "data-stat-total"]
    ].forEach(function (pair) {
      var dd = h("dd");
      if (pair[2]) dd.setAttribute(pair[2], character.id);
      setHostedOdometer(dd, pair[1]);
      grid.appendChild(h("div", null, h("dt", { text: pair[0] }), dd));
    });
    var nodes = [grid, deltaNode(character), h("h3", { text: "소개" }), h("p", { class: "intro", text: character.intro || "소개가 없습니다." })];
    nodes.forEach(function (node) { if (node) panel.appendChild(node); });
    var meta = h("dl", { class: "meta-list" });
    [["파일", character.fileName], ["아이디", character.id], ["통계 출처", character.statsSource || "마크다운"]].forEach(function (pair) {
      meta.appendChild(h("div", null, h("dt", { text: pair[0] }), h("dd", { text: pair[1] || "—" })));
    });
    panel.appendChild(meta);
    (character.statWarnings || []).forEach(function (warning) {
      panel.appendChild(h("p", { class: "warn", text: warning }));
    });
    return panel;
  }

  function buildBlogPanel(character) {
    var panel = h("div", { class: "panel" });
    var blogs = (character.blogs || []).slice().sort(compareBlogs);
    if (!blogs.length) {
      panel.appendChild(h("p", { text: "등록된 블로그가 없습니다." }));
      return panel;
    }
    var list = h("ul", { class: "link-list" });
    blogs.forEach(function (blog) {
      var href = safeUrl(blog.url || "");
      var item = h("li", null, h("strong", null,
        blog.platform || "블로그",
        blog.paused ? pausedMark() : null
      ));
      if (blog.accountId) item.appendChild(h("span", { class: "kv" }, h("em", { text: "아이디" }), " " + blog.accountId));
      if (href) {
        item.appendChild(externalLink(href));
      } else if (blog.url) {
        item.appendChild(h("span", { class: "warn", text: "주소는 http 또는 https만 열 수 있습니다." }));
      }
      item.appendChild(blogCountsEl(blog.url || ""));
      list.appendChild(item);
    });
    panel.appendChild(list);
    return panel;
  }

  function buildAccountPanel(character) {
    var panel = h("div", { class: "panel" });
    panel.appendChild(h("p", { class: "hint", text: "비밀번호는 파일에 적지 않습니다. 적혀 있어도 화면과 내보내기에서 빼 둡니다." }));
    var accounts = character.accounts || [];
    if (!accounts.length) {
      panel.appendChild(h("p", { text: "등록된 계정이 없습니다." }));
      return panel;
    }
    var list = h("ul", { class: "link-list" });
    accounts.forEach(function (account) {
      var item = h("li", null, h("strong", { text: account.platform || "계정" }));
      if (account.id) item.appendChild(h("span", { class: "kv" }, h("em", { text: "아이디" }), " " + account.id));
      if (account.email) item.appendChild(h("span", { class: "kv" }, h("em", { text: "이메일" }), " " + account.email));
      if (account.note) item.appendChild(h("span", { class: "kv" }, h("em", { text: "메모" }), " " + account.note));
      list.appendChild(item);
    });
    panel.appendChild(list);
    return panel;
  }

  function buildRoutinePanel(character) {
    var panel = h("div", { class: "panel" });
    var routines = character.routines || [];
    if (!routines.length) {
      panel.appendChild(h("p", { text: "등록된 루틴이 없습니다." }));
      return panel;
    }
    var list = h("ol", { class: "routine" });
    routines.forEach(function (routine) {
      list.appendChild(h("li", null,
        h("time", { text: routine.time || "—", datetime: routine.time || "" }),
        h("div", null,
          h("strong", { text: routine.task || "할 일 없음" }),
          routine.days ? h("p", { text: routine.days }) : null
        )
      ));
    });
    panel.appendChild(list);
    return panel;
  }

  function bindTabs(list) {
    var buttons = Array.prototype.slice.call(list.querySelectorAll('[role="tab"]'));
    function activate(next) {
      buttons.forEach(function (button) {
        var on = button === next;
        button.setAttribute("aria-selected", on ? "true" : "false");
        button.tabIndex = on ? 0 : -1;
        var panel = document.getElementById(button.getAttribute("aria-controls"));
        if (panel) panel.hidden = !on;
      });
      var scroller = document.getElementById("modalBody");
      if (scroller) scroller.scrollTop = 0;
    }
    buttons.forEach(function (button, index) {
      button.addEventListener("click", function () { activate(button); });
      button.addEventListener("keydown", function (event) {
        var nextIndex = null;
        if (event.key === "ArrowRight") nextIndex = (index + 1) % buttons.length;
        else if (event.key === "ArrowLeft") nextIndex = (index - 1 + buttons.length) % buttons.length;
        else if (event.key === "Home") nextIndex = 0;
        else if (event.key === "End") nextIndex = buttons.length - 1;
        else return;
        event.preventDefault();
        buttons[nextIndex].focus();
        activate(buttons[nextIndex]);
      });
    });
  }

  function buildTabs(character) {
    var wrap = h("div", { class: "detail-tabs" });
    var list = h("div", { class: "tabs", role: "tablist", "aria-label": "상세 정보" });
    var specs = [["basic", "기본 정보"], ["blogs", "블로그 목록"], ["accounts", "계정 정보"], ["routine", "루틴"]];
    var panels = {
      basic: buildBasicPanel(character),
      blogs: buildBlogPanel(character),
      accounts: buildAccountPanel(character),
      routine: buildRoutinePanel(character)
    };
    specs.forEach(function (item, index) {
      var id = item[0];
      list.appendChild(h("button", {
        type: "button",
        role: "tab",
        id: "tab-" + id,
        class: "tab",
        "aria-selected": index === 0 ? "true" : "false",
        "aria-controls": "panel-" + id,
        tabindex: index === 0 ? "0" : "-1",
        "data-tab": id
      }, item[1]));
      panels[id].id = "panel-" + id;
      panels[id].setAttribute("role", "tabpanel");
      panels[id].setAttribute("aria-labelledby", "tab-" + id);
      panels[id].hidden = index !== 0;
    });
    wrap.append(list, panels.basic, panels.blogs, panels.accounts, panels.routine);
    bindTabs(list);
    return wrap;
  }

  function buildErrorDetail(character, page) {
    return h("article", { class: "detail" },
      h("p", { class: "eyebrow", text: "파싱 오류" }),
      h(page ? "h1" : "h2", { id: "detailTitle", text: character.fileName || "파일" }),
      h("p", { text: character.error || "파싱 오류" }),
      h("p", { text: "이 파일만 실패했습니다. 다른 캐릭터는 그대로 표시됩니다." })
    );
  }

  function buildDetailView(character, options) {
    var page = options && options.page;
    if (!character.ok) return buildErrorDetail(character, page);
    return h("article", { class: "detail" },
      h("header", { class: "detail-hero" },
        avatarNode(character, "avatar avatar-lg"),
        h("div", null,
          h("p", { class: "eyebrow", text: character.id }),
          h(page ? "h1" : "h2", { id: "detailTitle", text: character.name }),
          character.nickname ? h("p", { class: "card-nick", text: character.nickname }) : null,
          h("span", { class: "badge badge-" + statusClass(character.status), text: character.status || "미정" })
        )
      ),
      buildTabs(character)
    );
  }

  function isMobileView() {
    return window.matchMedia("(max-width: 767px)").matches;
  }

  function openCharacter(id) {
    var found = findById(id);
    if (!found) return;
    if (isMobileView()) {
      try { sessionStorage.setItem(STORAGE.scroll, String(window.scrollY)); } catch (error) {}
      location.href = "detail.html?id=" + encodeURIComponent(found.id);
      return;
    }
    openModal(found.id);
  }

  function setInert(on) {
    ["topbar", "content"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.inert = on;
      if (on) el.setAttribute("aria-hidden", "true");
      else el.removeAttribute("aria-hidden");
    });
    var footer = document.querySelector(".footer");
    if (footer) {
      footer.inert = on;
      if (on) footer.setAttribute("aria-hidden", "true");
      else footer.removeAttribute("aria-hidden");
    }
  }

  function openModal(id) {
    var character = findById(id);
    if (!character) {
      state.notices.push("요청한 캐릭터를 찾지 못했습니다.");
      renderNotice();
      return;
    }
    state.activeId = character.id;
    state.lastFocus = document.activeElement;
    var body = document.getElementById("modalBody");
    body.replaceChildren(buildDetailView(character));
    var modal = document.getElementById("modal");
    modal.hidden = false;
    document.body.classList.add("modal-open");
    setInert(true);
    state.modalOpen = true;
    var closeBtn = modal.querySelector(".modal-close");
    if (closeBtn) closeBtn.focus();
    history.replaceState(null, "", location.pathname + location.search + "#" + encodeURIComponent(character.id));
  }

  function closeModal(options) {
    var modal = document.getElementById("modal");
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    state.modalOpen = false;
    state.activeId = null;
    document.body.classList.remove("modal-open");
    setInert(false);
    history.replaceState(null, "", location.pathname + location.search);
    if ((!options || !options.skipFocus) && state.lastFocus && state.lastFocus.focus) state.lastFocus.focus();
  }

  function focusable(root) {
    return Array.prototype.slice.call(root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(function (node) {
      return !node.closest("[hidden]");
    });
  }

  function readHash() {
    var raw = location.hash.replace(/^#/, "");
    if (!raw) return "";
    try { return decodeURIComponent(raw); } catch (error) { return raw; }
  }

  var scrollAfterBoot = false;

  function pageReloaded() {
    try {
      var nav = performance.getEntriesByType("navigation");
      return !!(nav[0] && nav[0].type === "reload");
    } catch (error) {
      return false;
    }
  }

  function applySavedScroll() {
    var raw = null;
    try { raw = sessionStorage.getItem(STORAGE.scroll); } catch (error) {}
    if (raw == null) return;
    try { sessionStorage.removeItem(STORAGE.scroll); } catch (error) {}
    var y = Number(raw);
    if (!isFinite(y)) return;
    requestAnimationFrame(function () { window.scrollTo(0, y); });
  }

  function restoreScroll() {
    // 새로고침은 맨 위. 상세에서 돌아올 때만 저장해 둔 위치를 되돌린다.
    if (pageReloaded()) {
      scrollAfterBoot = false;
      try { sessionStorage.removeItem(STORAGE.scroll); } catch (error) {}
      window.scrollTo(0, 0);
      return;
    }
    if (document.body.classList.contains("is-booting")) {
      scrollAfterBoot = true;
      return;
    }
    applySavedScroll();
  }

  function consumeEntry() {
    var hash = readHash();
    if (!hash) {
      restoreScroll();
      return;
    }
    if (isMobileView()) {
      location.replace("detail.html?id=" + encodeURIComponent(hash));
      return;
    }
    if (!findById(hash)) {
      state.notices.push("요청한 캐릭터를 찾지 못했습니다.");
      renderNotice();
    } else {
      openModal(hash);
    }
    restoreScroll();
  }

  function stripSecrets(value) {
    if (Array.isArray(value)) return value.map(stripSecrets);
    if (value && typeof value === "object") {
      var out = {};
      Object.keys(value).forEach(function (key) {
        if (SECRET_KEYS[key.toLowerCase()]) return;
        out[key] = stripSecrets(value[key]);
      });
      return out;
    }
    return value;
  }

  function exportData() {
    var parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(new Date());
    var map = {};
    parts.forEach(function (part) { map[part.type] = part.value; });
    var payload = {
      exportedAt: new Date().toISOString(),
      statsUpdatedAt: state.statsUpdatedAt,
      note: "내부용 파일입니다. 계정 아이디가 들어 있으니 공유하지 마세요.",
      characters: stripSecrets(JSON.parse(JSON.stringify(state.characters)))
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = h("a", { href: url, download: "botdash-characters-" + map.year + map.month + map.day + "-" + map.hour + map.minute + ".json" });
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function setLoading(loading) {
    var refresh = document.getElementById("refreshBtn");
    var exp = document.getElementById("exportBtn");
    if (refresh) {
      refresh.disabled = loading;
      var mark = refresh.querySelector("i");
      if (mark) mark.classList.toggle("fa-spin", loading);
    }
    if (exp) exp.disabled = loading || !state.ready;
    var grid = document.getElementById("cardGrid");
    if (grid) grid.setAttribute("aria-busy", loading ? "true" : "false");
  }

  async function loadAndRender() {
    if (state.loading) return;
    state.countRefreshGen += 1;
    state.blogCounts = {};
    state.loading = true;
    setLoading(true);
    if (state.ready) showSkeleton();
    try {
      if (typeof CharacterParser === "undefined") throw new Error("parser.js를 불러오지 못했습니다.");
      if (!Array.isArray(DASHBOARD_CONFIG.characterFiles)) throw new Error("config.js의 characterFiles 목록을 확인해 주세요.");
      await loadCharacters();
    } catch (error) {
      state.characters = [];
      state.statsUpdatedAt = null;
      state.loadedAt = new Date();
      state.notices = [error.message || "데이터를 불러오지 못했습니다."];
    } finally {
      state.loading = false;
      state.ready = true;
      setLoading(false);
    }
    render({ refreshModal: true });
    if (!state.entryConsumed) {
      state.entryConsumed = true;
      consumeEntry();
    }
  }

  // 검색·필터는 화면 너비와 상관없이 접어 두고, 버튼으로 펼친다.
  function bindToolsToggle() {
    var toggle = document.getElementById("toolsToggle");
    var panel = document.getElementById("toolPanel");
    if (!toggle || !panel) return;
    var open = false;
    var label = toggle.querySelector(".toggle-label");
    function apply() {
      panel.classList.toggle("is-open", open);
      toggle.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      if (label) label.textContent = open ? "닫기" : "필터";
      if (open) panel.removeAttribute("inert");
      else panel.setAttribute("inert", "");
    }
    apply();
    toggle.addEventListener("click", function () {
      var first = !panel.classList.contains("is-ready");
      open = !open;
      if (first) {
        panel.classList.add("is-ready");
        requestAnimationFrame(function () { apply(); });
        return;
      }
      apply();
    });
  }

  function bindViewTabs() {
    var tabs = [document.getElementById("tabCards"), document.getElementById("tabStats")];
    if (!tabs[0] || !tabs[1]) return;
    function select(view) {
      var next = view === "stats" ? "stats" : "cards";
      var enteredStats = next === "stats" && state.view !== "stats";
      state.view = next;
      storageSet(STORAGE.view, state.view);
      // 탭만 바꿀 때 카드를 다시 만들면, 집계가 끝난 숫자가 빈 칸으로 남는다.
      syncView();
      if (state.view === "stats") {
        renderStatsTable();
        renderChart(enteredStats ? { replay: true, rise: true } : null);
      }
    }
    tabs.forEach(function (button, index) {
      button.addEventListener("click", function () {
        select(button.id === "tabStats" ? "stats" : "cards");
      });
      button.addEventListener("keydown", function (event) {
        var next = null;
        if (event.key === "ArrowRight") next = tabs[(index + 1) % tabs.length];
        else if (event.key === "ArrowLeft") next = tabs[(index - 1 + tabs.length) % tabs.length];
        else return;
        event.preventDefault();
        next.focus();
        select(next.id === "tabStats" ? "stats" : "cards");
      });
    });
  }

  function bindDashboard() {
    bindToolsToggle();
    bindViewTabs();
    document.getElementById("logoutBtn").addEventListener("click", logoutUser);
    document.getElementById("refreshBtn").addEventListener("click", loadAndRender);
    var countReload = document.getElementById("countReload");
    if (countReload) countReload.addEventListener("click", refreshLiveCounts);
    document.getElementById("exportBtn").addEventListener("click", exportData);
    document.getElementById("sortSelect").addEventListener("change", function (event) {
      if (!SORTS[event.target.value]) return;
      state.sort = event.target.value;
      storageSet(STORAGE.sort, state.sort);
      render();
    });
    var search = document.getElementById("searchInput");
    var clear = document.getElementById("clearSearch");
    search.addEventListener("input", function () {
      state.queryRaw = search.value.trim();
      state.query = state.queryRaw.toLowerCase();
      clear.hidden = !search.value;
      render();
    });
    clear.addEventListener("click", function () {
      search.value = "";
      state.query = "";
      state.queryRaw = "";
      clear.hidden = true;
      search.focus();
      render();
    });
    var buttons = Array.prototype.slice.call(document.querySelectorAll("#filterTabs [data-filter]"));
    function applyFilter(button) {
      state.filter = button.getAttribute("data-filter");
      storageSet(STORAGE.filter, state.filter);
      buttons.forEach(function (item) {
        item.setAttribute("aria-pressed", item === button ? "true" : "false");
      });
      render();
    }
    buttons.forEach(function (button, index) {
      button.addEventListener("click", function () { applyFilter(button); });
      button.addEventListener("keydown", function (event) {
        var target = null;
        if (event.key === "ArrowRight") target = buttons[(index + 1) % buttons.length];
        else if (event.key === "ArrowLeft") target = buttons[(index - 1 + buttons.length) % buttons.length];
        else return;
        event.preventDefault();
        target.focus();
        applyFilter(target);
      });
    });
    document.getElementById("cardGrid").addEventListener("click", function (event) {
      var opener = event.target.closest(".card-detail");
      if (!opener) return;
      try { sessionStorage.setItem(STORAGE.scroll, String(window.scrollY)); } catch (error) {}
      if (isMobileView()) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      openCharacter(opener.getAttribute("data-id"));
    });
    document.getElementById("modal").addEventListener("click", function (event) {
      var closer = event.target.closest("[data-close]");
      if (!closer) return;
      if (closer.closest(".modal-dialog") && !closer.classList.contains("modal-close")) return;
      closeModal();
    });
    document.addEventListener("keydown", function (event) {
      if (state.photoOpen && event.key === "Escape") {
        event.preventDefault();
        closePhoto();
        return;
      }
      if (trapPhotoTab(event)) return;
      if (event.key === "Escape" && state.modalOpen) {
        event.preventDefault();
        closeModal();
        return;
      }
      if (event.key !== "Tab" || !state.modalOpen) return;
      var nodes = focusable(document.getElementById("modalDialog"));
      if (!nodes.length) return;
      var first = nodes[0];
      var last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    var mobileQuery = window.matchMedia("(max-width: 767px)");
    var onViewport = function (event) {
      if (!event.matches || !state.modalOpen || !state.activeId) return;
      var id = state.activeId;
      try { sessionStorage.setItem(STORAGE.scroll, String(window.scrollY)); } catch (error) {}
      closeModal({ skipFocus: true });
      location.href = "detail.html?id=" + encodeURIComponent(id);
    };
    if (mobileQuery.addEventListener) mobileQuery.addEventListener("change", onViewport);
    else if (mobileQuery.addListener) mobileQuery.addListener(onViewport);
  }

  function initDashboard() {
    if (typeof CharacterParser === "undefined") {
      showBootError("parser.js를 불러오지 못했습니다.");
      return;
    }
    if (!isAuthenticated()) {
      redirectToLogin();
      return;
    }
    loadPrefs();
    bindDashboard();
    loadAndRender();
    startCountWatch();
  }

  function missingDetail(message) {
    return h("article", { class: "detail" },
      h("h1", { text: "캐릭터를 찾지 못했습니다" }),
      h("p", { text: message }),
      h("a", { class: "btn-dark", href: "index.html" }, "대시보드로")
    );
  }

  function bindSwipe() {
    var handle = document.getElementById("swipeHandle");
    var sheet = document.getElementById("detailSheet");
    if (!handle || !sheet) return;
    var startY = 0;
    var startX = 0;
    var dragging = false;
    handle.addEventListener("pointerdown", function (event) {
      dragging = true;
      startY = event.clientY;
      startX = event.clientX;
      if (handle.setPointerCapture) handle.setPointerCapture(event.pointerId);
      sheet.style.transition = "none";
    });
    handle.addEventListener("pointermove", function (event) {
      if (!dragging) return;
      var dy = Math.max(0, event.clientY - startY);
      var dx = event.clientX - startX;
      if (Math.abs(dx) > dy) return;
      sheet.style.transform = "translateY(" + dy + "px)";
    });
    function end(event) {
      if (!dragging) return;
      dragging = false;
      var dy = event.clientY - startY;
      sheet.style.transition = "";
      sheet.style.transform = "";
      if (dy > 90) location.href = "index.html";
    }
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", function () {
      dragging = false;
      sheet.style.transition = "";
      sheet.style.transform = "";
    });
  }

  async function loadDetail() {
    var root = document.getElementById("detailRoot");
    try {
      if (typeof CharacterParser === "undefined") throw new Error("parser.js를 불러오지 못했습니다.");
      state.blogCounts = {};
      await loadCharacters();
      renderNotice();
      var id = new URLSearchParams(location.search).get("id");
      if (!id) {
        root.replaceChildren(missingDetail("주소에 캐릭터 아이디가 없습니다."));
        return;
      }
      var character = findById(id);
      if (!character) {
        root.replaceChildren(missingDetail("요청한 캐릭터를 찾지 못했습니다."));
        return;
      }
      document.title = (character.ok ? character.name : "파싱 오류") + " · 봇대시";
      root.replaceChildren(buildDetailView(character, { page: true }));
      requestBlogCounts();
    } catch (error) {
      root.replaceChildren(missingDetail(error.message || "데이터를 불러오지 못했습니다."));
    }
  }

  function initDetailPage() {
    if (!isAuthenticated()) {
      redirectToLogin();
      return;
    }
    var logout = document.getElementById("logoutBtn");
    if (logout) logout.addEventListener("click", logoutUser);
    bindSwipe();
    document.addEventListener("keydown", function (event) {
      if (state.photoOpen && event.key === "Escape") {
        event.preventDefault();
        closePhoto();
        return;
      }
      if (trapPhotoTab(event)) return;
      if (event.key === "Escape") location.href = "index.html";
    });
    loadDetail();
  }
})();
