/**
 * 봇대시 화면 로직.
 * 숫자 릴은 js/reel.js, 통계 그래프는 js/chart.js, 로그인은 js/login.js 에 있다.
 * 캐릭터 원본은 서버에서 만들지 않고, 로그인한 브라우저가 content.php 로 characters 폴더의 md와 stats.json, visitor_days.json을 읽어 그린다.
 */
(function () {
  // 카운터 숫자가 올라가는 시간. 단위는 밀리초.
  // 작은 수는 MIN, 차이가 큰 수는 MAX까지 늘어난다. 1000이면 1초.
  var COUNT_UP_MIN_MS = 1100;
  var COUNT_UP_MAX_MS = 1300;
  var COUNT_UP_BASE_MS = 1000;
  var COUNT_UP_SCALE = 180;
  // 저장해 둔 프로필 썸네일을 다시 받는 간격. 한 시간이 지나야 뒤에서 갱신한다.
  var THUMB_REFRESH_MS = 60 * 60 * 1000;
  // 페이지를 켜 둔 채로 방문자 수와 최근 게시물을 다시 확인하는 간격. 600000이면 10분.
  // 로그인 시각부터 세지 않고, 지금 시각의 10분 경계(정각, 10분, 20분…)에 맞춘다.
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
    scroll: "botdash_scroll",
    order: "botdash_order",
    counts: "botdash_counts",
    countsDay: "botdash_counts_day",
    viewDay: "botdash_view_day",
    latestOpen: "botdash_latest_open",
    latestSize: "botdash_latest_size",
    latestSizeMobile: "botdash_latest_size_m"
  };
  var FILTERS = { all: 1, has: 1, zero: 1 };
  var SORTS = { visitors_desc: 1, visitors_asc: 1, name: 1, drop: 1, posts: 1 };
  var GAP_TEXT = {
    cap20: "20개 초과",
    cap40: "40개 초과",
    page8: "8페이지 초과",
    short: "목록이 부족",
    unread: "못 읽음",
    more: "댓글이 더 있음",
    many: "글이 너무 많음",
    alltime: "일별 없음"
  };
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
    totalChart: null,
    monthChart: null,
    shareChart: null,
    visitorDays: {},
    chartRiseUntil: 0,
    chartRiseTimer: 0,
    chartRisePending: false,
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
    countRefreshGen: 0,
    // 캐릭터 파일을 읽은 뒤 집계를 부르기 전까지는 countsPending이 비어 있다.
    countIconHold: false,
    thumbs: {},
    thumbArchive: {},
    thumbRefreshGen: 0,
    sortRanks: null,
    cardPlaces: null,
    cardColumns: 0,
    cardMoving: false,
    cardMoveGen: 0,
    countsShown: false
  };

  if (!window.BotDashReel || !window.BotDashChart || !window.BotDashLogin) {
    document.addEventListener("DOMContentLoaded", function () {
      document.body.classList.add("auth-ready");
      document.body.classList.remove("is-booting");
    });
    return;
  }

  var formatNumber = window.BotDashReel.formatNumber;
  var reducedMotion = window.BotDashReel.reducedMotion;
  var paintStatic = window.BotDashReel.paintStatic;
  var setOdometer = window.BotDashReel.setOdometer;
  var setHostedOdometer = window.BotDashReel.setHostedOdometer;
  window.BotDashChart.install({
    state: state,
    visibleCharacters: visibleCharacters,
    visitorLevel: visitorLevel,
    formatNumber: formatNumber,
    paintStatic: paintStatic,
    setOdometer: setOdometer,
    reducedMotion: reducedMotion,
    seoulDateKey: seoulDateKey,
    countableBlogUrl: countableBlogUrl,
    countableBlogs: countableBlogs,
    omitsDailyVisitors: omitsDailyVisitors,
    characterLivePending: characterLivePending
  });
  var loginApi = window.BotDashLogin.create({
    state: state,
    STORAGE: STORAGE,
    storageGet: storageGet,
    storageSet: storageSet
  });
  var ensureSession = loginApi.ensureSession;
  var redirectToLogin = loginApi.redirectToLogin;
  var initLogin = loginApi.initLogin;
  var logoutUser = loginApi.logoutUser;

  document.addEventListener("DOMContentLoaded", boot);

  // 터치 기기에서 맨 위를 아래로 당겼다 놓으면 페이지를 다시 연다.
  // 아이콘은 화면 밖에서 반 바퀴 돌아 있고, 끝까지 내리면 한바퀴 반을 더 돌아 정방향이 된다.
  // 새로고침 기준 전에는 당긴 만큼 나타났다가 올리면 사라진다. 기준을 넘으면 불투명하다.
  // 기준을 넘겨 놓으면 그 자리에서 계속 돌고, 0.5초 뒤에 페이지를 다시 연다.
  // 손을 떼기 전에 위로 올리면 페이지가 다시 스크롤된다.
  function bindPullRefresh() {
    var page = document.body.dataset.page;
    if (page !== "dashboard" && page !== "detail") return;
    if (document.body.dataset.pullRefresh) return;
    if (!window.matchMedia("(hover: none) and (pointer: coarse)").matches) return;
    document.body.dataset.pullRefresh = "1";
    var icon = h("i", { class: "fa-solid fa-rotate-right", "aria-hidden": "true" });
    var pill = h("p", { class: "pull-refresh-pill" }, icon);
    var pullHost = h("div", { class: "pull-refresh", "aria-hidden": "true" }, pill);
    document.body.appendChild(pullHost);
    var startY = 0;
    var startX = 0;
    var tracking = false;
    var owned = false;
    var paging = false;
    var raw = 0;
    var fired = false;
    var queued = false;
    var paintGen = 0;
    var spinAnim = null;
    var FIRE = 76;
    var MAX = 140;
    var view = { distance: 0, ready: false, angle: 0, opacity: 0, snap: false };

    function scrolledTop() {
      return (window.scrollY || document.documentElement.scrollTop || 0) <= 0;
    }

    function blockedTarget() {
      return document.body.classList.contains("modal-open") || document.body.classList.contains("photo-open");
    }

    function pullAngle(distance) {
      var span = Math.min(Math.max(distance, 0), MAX) / MAX * 540;
      return Math.round((180 + span) * 10) / 10;
    }

    function pullOpacity(dy) {
      if (dy >= FIRE) return 1;
      if (dy <= 0) return 0;
      return Math.round(dy / FIRE * 100) / 100;
    }

    function pullDistance(dy) {
      return Math.min(MAX, Math.round(dy * 12) / 10);
    }

    function place(distance, angle) {
      return "translate3d(0, calc(-100% - 16px + " + distance + "px), 0) rotate(" + angle + "deg)";
    }

    // 당기는 중에는 스크롤 값을 읽지 않는다.
    // 읽으면 방금 바꾼 transform 때문에 배치가 다시 계산되어 회전이 끊긴다.
    function paintPull() {
      queued = false;
      pullHost.classList.toggle("is-snap", view.snap);
      pullHost.classList.toggle("is-ready", view.ready);
      if (view.distance > 0) {
        pill.style.transform = place(view.distance, view.angle);
        pill.style.opacity = String(view.opacity);
      } else {
        pill.style.transform = "";
        pill.style.opacity = "0";
      }
    }

    function schedulePull() {
      if (queued) return;
      queued = true;
      var gen = paintGen;
      requestAnimationFrame(function () {
        if (gen !== paintGen) return;
        paintPull();
      });
    }

    function resetPull() {
      tracking = false;
      raw = 0;
      view.distance = 0;
      view.ready = false;
      view.angle = 0;
      view.opacity = 0;
      view.snap = true;
      if (spinAnim) {
        spinAnim.cancel();
        spinAnim = null;
      }
      paintPull();
    }

    function spinInPlace() {
      paintGen += 1;
      queued = false;
      var from = place(view.distance, view.angle);
      var to = place(view.distance, view.angle + 360);
      pill.style.opacity = "1";
      pill.style.transform = from;
      spinAnim = pill.animate([
        { transform: from, opacity: 1 },
        { transform: to, opacity: 1 }
      ], { duration: 750, iterations: Infinity, easing: "linear" });
    }

    function followFinger(dy) {
      if (dy > 0) {
        if (paging) {
          paging = false;
          window.scrollTo(0, 0);
        }
        raw = dy;
        view.distance = pullDistance(dy);
        view.ready = dy >= FIRE;
        view.angle = pullAngle(view.distance);
        view.opacity = pullOpacity(dy);
        view.snap = false;
        schedulePull();
        return;
      }
      paging = true;
      raw = dy;
      view.distance = 0;
      view.ready = false;
      view.angle = 0;
      view.opacity = 0;
      view.snap = false;
      schedulePull();
      window.scrollTo(0, -dy);
    }

    var originLatest = false;

    document.addEventListener("touchstart", function (event) {
      if (fired || event.touches.length !== 1) return;
      if (!scrolledTop() || blockedTarget()) return;
      var touch = event.touches[0];
      startY = touch.clientY;
      startX = touch.clientX;
      originLatest = !!(event.target && event.target.closest && event.target.closest("#latestViewport, #latestTicker"));
      tracking = true;
      owned = false;
      paging = false;
      raw = 0;
      view.snap = false;
      pullHost.classList.remove("is-snap");
    }, { passive: true });

    document.addEventListener("touchmove", function (event) {
      if (!tracking || fired || event.touches.length !== 1) return;
      var touch = event.touches[0];
      var dy = touch.clientY - startY;
      var dx = touch.clientX - startX;
      // 최근 글 가로 스와이프는 당기기보다 먼저 넘긴다. 세로로 확실히 내릴 때만 새로고침을 잡는다.
      if (originLatest && Math.abs(dx) >= Math.abs(dy) && Math.abs(dx) > 6) {
        tracking = false;
        return;
      }
      if (!owned && raw <= 0 && dy > 0 && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 12) {
        tracking = false;
        return;
      }
      if (!owned && dy < 8) return;
      if (event.cancelable) event.preventDefault();
      owned = true;
      followFinger(dy);
    }, { passive: false });

    document.addEventListener("touchend", function () {
      if (!tracking || fired) return;
      var ready = raw >= FIRE;
      tracking = false;
      if (!ready) {
        resetPull();
        return;
      }
      fired = true;
      view.ready = true;
      view.opacity = 1;
      view.snap = false;
      paintPull();
      spinInPlace();
      setTimeout(function () { location.reload(); }, 500);
    });

    document.addEventListener("touchcancel", function () {
      if (!fired) resetPull();
    });
  }

  function boot() {
    bindPullRefresh();
    var page = document.body.dataset.page;
    if (typeof DASHBOARD_CONFIG === "undefined") {
      document.body.classList.add("auth-ready");
      showBootError("config.js를 불러오지 못했습니다. 서버에 js/config.js가 있는지 확인해 주세요.");
      return;
    }
    if (page === "login") initLogin();
    else {
      ensureSession().then(function (ok) {
        if (!ok) {
          redirectToLogin();
          return;
        }
        if (page === "detail") initDetailPage();
        else initDashboard();
      }).catch(function () {
        redirectToLogin();
      });
    }
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

  async function loadCharacterFiles(stamp) {
    var text = await fetchText("content.php?list=characters&t=" + stamp);
    var parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("형식");
    var seen = {};
    return parsed.map(function (file) {
      return String(file).trim();
    }).filter(function (file) {
      if (!/^[A-Za-z0-9_-]+\.md$/.test(file) || seen[file]) return false;
      seen[file] = true;
      return true;
    });
  }

  // 파일 하나는 실패해도 나머지 카드를 계속 만든다.
  async function loadCharacters() {
    var stamp = Date.now();
    var notices = [];
    var statsDoc = null;
    if (location.protocol === "file:") {
      state.characters = [];
      state.statsUpdatedAt = null;
      state.visitorDays = {};
      state.loadedAt = new Date();
      state.notices = ["파일을 직접 열면 마크다운을 읽지 못합니다. 웹서버로 열어 주세요."];
      return;
    }
    var files;
    try {
      files = await loadCharacterFiles(stamp);
    } catch (error) {
      throw new Error("캐릭터 목록을 읽지 못했습니다.");
    }
    try {
      var statsText = await fetchText("content.php?f=" + encodeURIComponent("data/stats.json") + "&t=" + stamp);
      var parsed = JSON.parse(statsText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("형식");
      statsDoc = {
        updatedAt: parsed.updatedAt || null,
        characters: parsed.characters && typeof parsed.characters === "object" ? parsed.characters : {}
      };
    } catch (error) {
      notices.push("stats.json을 읽지 못했습니다. 마크다운 안의 통계만 사용합니다.");
    }
    state.visitorDays = {};
    try {
      var dayText = await fetchText("content.php?f=" + encodeURIComponent("data/visitor_days.json") + "&t=" + stamp);
      var dayDoc = JSON.parse(dayText);
      state.visitorDays = normalizeVisitorDays(dayDoc);
    } catch (error) {
      if (!error || error.message !== "HTTP 404") notices.push("일별 방문자 기록을 읽지 못했습니다.");
    }

    var rows = await Promise.all(files.map(async function (file) {
      try {
        var text = await fetchText("content.php?f=" + encodeURIComponent("characters/" + file) + "&t=" + stamp);
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

  function normalizeVisitorDays(parsed) {
    var out = {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return out;
    Object.keys(parsed).forEach(function (day) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
      var row = parsed[day];
      if (!row || typeof row !== "object" || Array.isArray(row)) return;
      var clean = {};
      Object.keys(row).forEach(function (url) {
        var value = row[url];
        if (typeof value === "string" && /^\d{1,12}$/.test(value)) value = Number(value);
        if (typeof value !== "number" || !isFinite(value) || value < 0 || Math.floor(value) !== value) return;
        clean[url] = value;
      });
      if (Object.keys(clean).length) out[day] = clean;
    });
    return out;
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
    var desktopSize = document.getElementById("latestSizeDesktop");
    var mobileSize = document.getElementById("latestSizeMobile");
    if (desktopSize) desktopSize.value = String(latestStoredSize(false));
    if (mobileSize) mobileSize.value = String(latestStoredSize(true));
    loadSortRanks();
    syncView();
  }

  // 정렬이 확정된 순서를 남긴다. 다음 로딩은 이 순서로 열고, 기준 숫자가 달라지면 다시 줄 세운다.
  function loadSortRanks() {
    state.sortRanks = {};
    var raw = storageGet(STORAGE.order);
    if (!raw) return;
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      Object.keys(SORTS).forEach(function (sort) {
        var table = parsed[sort];
        if (!table || typeof table !== "object" || Array.isArray(table)) return;
        var clean = {};
        Object.keys(table).forEach(function (id) {
          var rank = table[id];
          if (typeof rank !== "number" || !isFinite(rank)) return;
          clean[id] = rank;
        });
        if (Object.keys(clean).length) state.sortRanks[sort] = clean;
      });
    } catch (error) {
      state.sortRanks = {};
    }
  }

  function sortId(character) {
    return character.id || String(character.fileName || "").replace(/\.md$/i, "");
  }

  function savedRank(id) {
    var table = state.sortRanks && state.sortRanks[state.sort];
    if (!table || !id) return null;
    var rank = table[id];
    return typeof rank === "number" ? rank : null;
  }

  // 집계 중에는 저장해 둔 순서를 유지한다. 기록이 없는 캐릭터만 뒤로 보낸다.
  function compareSaved(a, b) {
    var rankA = savedRank(sortId(a));
    var rankB = savedRank(sortId(b));
    if (rankA == null && rankB == null) return null;
    if (rankA == null) return 1;
    if (rankB == null) return -1;
    return rankA - rankB;
  }

  function holdSortOrder() {
    if (document.body.dataset.page === "detail") return false;
    if (!state.sortRanks || !state.sortRanks[state.sort]) return false;
    return countsPending();
  }

  function rememberSortOrder() {
    if (document.body.dataset.page === "detail") return;
    if (!state.ready || countsPending()) return;
    var ranked = state.characters.slice().sort(compareCharacters);
    var table = {};
    ranked.forEach(function (character, index) {
      var id = sortId(character);
      if (id) table[id] = index;
    });
    if (!state.sortRanks) state.sortRanks = {};
    state.sortRanks[state.sort] = table;
    storageSet(STORAGE.order, JSON.stringify(state.sortRanks));
  }

  function haystack(character) {
    if (!character.ok) return [character.fileName, character.error, "파싱 오류"].join(" ").toLowerCase();
    var blogs = (character.blogs || []).map(function (blog) {
      return [blog.platform, blog.url, blog.accountId].join(" ");
    }).join(" ");
    var accounts = (character.accounts || []).map(function (account) {
      return [account.platform, account.id, account.email, account.note].join(" ");
    }).join(" ");
    return [character.name, character.nickname, character.birthdate, genderLabel(character.gender), character.id, character.status, character.intro, blogs, accounts].join(" ").toLowerCase();
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

  // 오늘 방문자 순은 그 캐릭터의 플랫폼 오늘 수를 모두 더한 값이다.
  function liveTodayTotal(character) {
    if (!character || !character.ok) return null;
    var sum = 0;
    var known = false;
    countableBlogs(character).forEach(function (blog) {
      var data = state.blogCounts[countableBlogUrl(blog.url)];
      if (data && data.status === "ok" && data.today != null) {
        known = true;
        sum += data.today;
      }
    });
    return known ? sum : null;
  }

  function todaySortValue(character) {
    var live = liveTodayTotal(character);
    if (live != null) return live;
    if (countableBlogs(character).length) return null;
    return character.todayVisitors;
  }

  function compareCharacters(a, b) {
    if (a.ok !== b.ok) return a.ok ? -1 : 1;
    if (!a.ok) return String(a.fileName).localeCompare(String(b.fileName), "ko");
    if (holdSortOrder()) {
      var held = compareSaved(a, b);
      if (held != null) return held;
    }
    if (state.sort === "name") return String(a.name).localeCompare(String(b.name), "ko");
    if (state.sort === "visitors_asc") {
      var lowA = todaySortValue(a);
      var lowB = todaySortValue(b);
      return (lowA == null ? Infinity : lowA) - (lowB == null ? Infinity : lowB);
    }
    if (state.sort === "posts") return (postSortValue(b) - postSortValue(a));
    if (state.sort === "drop") {
      var left = dropAmount(a);
      var right = dropAmount(b);
      return (right == null ? -Infinity : right) - (left == null ? -Infinity : left);
    }
    var highA = todaySortValue(a);
    var highB = todaySortValue(b);
    return (highB == null ? -1 : highB) - (highA == null ? -1 : highA);
  }

  function visibleCharacters() {
    return state.characters.filter(function (character) {
      return matchesQuery(character, state.query) && matchesFilter(character, state.filter);
    }).slice().sort(compareCharacters);
  }

  var VISITOR_LEVELS = ["unknown", "zero", "low", "mid", "high", "t500", "t1000", "t5000", "t10000"];

  function clearVisitorLevel(node) {
    VISITOR_LEVELS.forEach(function (name) {
      node.classList.remove("is-" + name);
    });
  }

  function visitorLevel(value) {
    if (value == null || !isFinite(value)) return "unknown";
    if (value === 0) return "zero";
    var table = DASHBOARD_CONFIG.visitorThresholds || {};
    var steps = [
      ["t10000", "t10000", 10000],
      ["t5000", "t5000", 5000],
      ["t1000", "t1000", 1000],
      ["t500", "t500", 500],
      ["high", "high", 100],
      ["mid", "medium", 30]
    ];
    for (var i = 0; i < steps.length; i++) {
      var limit = Number(table[steps[i][1]]);
      if (!isFinite(limit)) limit = steps[i][2];
      if (value >= limit) return steps[i][0];
    }
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

  function countsPending() {
    var keys = Object.keys(state.blogCounts);
    for (var i = 0; i < keys.length; i++) {
      if (state.blogCounts[keys[i]].status === "loading") return true;
    }
    return false;
  }

  function characterLivePending(character) {
    if (!character || !character.ok) return false;
    var blogs = countableBlogs(character);
    if (!blogs.length) return false;
    for (var i = 0; i < blogs.length; i++) {
      var data = state.blogCounts[countableBlogUrl(blogs[i].url)];
      if (!data || data.status === "loading") return true;
    }
    return false;
  }

  function countSkeleton(kind) {
    return h("span", { class: "skeleton " + kind, "aria-hidden": "true" });
  }

  function paintPendingValue(el, kind) {
    if (!el) return;
    el.setAttribute("aria-busy", "true");
    el.replaceChildren(
      h("span", { class: "sr-only", text: "집계 중" }),
      countSkeleton(kind)
    );
  }

  function reelHasCount(reel) {
    if (!reel) return false;
    if (reel._reelBusy) return true;
    return typeof reel._reelCurrent === "number";
  }

  // 처음 숫자와 저장값에서 올라가는 중에는 확정 숫자로 바꾸지 않는다.
  function paintCountInstant(host, reel) {
    if (!state.countsShown) return false;
    if (reelHasCount(reel)) return false;
    if (!host) return true;
    if (host.getAttribute("aria-busy") === "true" || host.querySelector(".skeleton")) return false;
    if (reelHasCount(host.querySelector(".odometer"))) return false;
    return true;
  }

  function showHostedCount(parent, value, prefix) {
    setHostedOdometer(parent, value, prefix, paintCountInstant(parent));
  }

  function showReel(reel, value, host) {
    setOdometer(reel, value, paintCountInstant(host, reel));
  }

  function markCountsShown() {
    if (!countsPending()) state.countsShown = true;
  }

  // 스켈레톤이나 첫 화면의 저장값이 숫자로 바뀌는 순간만 짧게 페이드한다.
  function fadeCount(el) {
    if (!el || reducedMotion) return;
    var fromSkeleton = el.getAttribute("aria-busy") === "true" || !!el.querySelector(".skeleton");
    if (!fromSkeleton) {
      if (state.countsShown || el._countFaded) return;
      el._countFaded = true;
    }
    playCountFade(el);
  }

  // 끝난 페이드 클래스를 남겨 두면, 카드를 옮길 때 애니메이션이 다시 시작된다.
  function finishFade(el, className) {
    var token = (el._fadeToken || 0) + 1;
    el._fadeToken = token;
    function clear(event) {
      if (el._fadeToken !== token) {
        el.removeEventListener("animationend", clear);
        return;
      }
      if (event.target !== el || event.animationName !== "count-in") return;
      el.removeEventListener("animationend", clear);
      el.classList.remove(className);
    }
    el.addEventListener("animationend", clear);
  }

  function clearFadeMarks(root) {
    if (!root) return;
    var nodes = [root];
    if (root.querySelectorAll) {
      root.querySelectorAll(".is-count-in, .is-fade-in").forEach(function (el) { nodes.push(el); });
    }
    nodes.forEach(function (el) {
      if (!el.classList) return;
      if (!el.classList.contains("is-count-in") && !el.classList.contains("is-fade-in")) return;
      el._fadeToken = (el._fadeToken || 0) + 1;
      el.classList.remove("is-count-in", "is-fade-in");
    });
  }

  function playCountFade(el) {
    if (!el || reducedMotion) return;
    el.classList.remove("is-count-in");
    void el.offsetWidth;
    finishFade(el, "is-count-in");
    el.classList.add("is-count-in");
  }

  // 스켈레톤 카드가 실제 카드로 바뀌는 첫 순간만 칸 전체를 페이드한다.
  function fadeIn(el) {
    if (!el || reducedMotion) return;
    el.classList.remove("is-fade-in");
    void el.offsetWidth;
    finishFade(el, "is-fade-in");
    el.classList.add("is-fade-in");
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
      var allowed = host === "blog.naver.com" || host === "m.blog.naver.com" || /\.tistory\.com$/.test(host) || blogspotName(host) !== "";
      if (!allowed) return;
      var base = "profile.php?blog=" + encodeURIComponent(href);
      sources.push({ thumb: base, large: base + "&size=large" });
    });
    return sources;
  }

  var thumbDbPromise = null;

  function isProfileThumb(url) {
    return typeof url === "string" && url.indexOf("profile.php?") === 0;
  }

  function openThumbDb() {
    if (thumbDbPromise) return thumbDbPromise;
    thumbDbPromise = new Promise(function (resolve) {
      if (!window.indexedDB) {
        resolve(null);
        return;
      }
      var req;
      try { req = indexedDB.open("botdash-thumbs", 1); }
      catch (error) {
        resolve(null);
        return;
      }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains("thumbs")) db.createObjectStore("thumbs");
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { resolve(null); };
    });
    return thumbDbPromise;
  }

  function readThumbRecords(keys) {
    return openThumbDb().then(function (db) {
      if (!db || !keys.length) return {};
      return new Promise(function (resolve) {
        var out = {};
        var tx;
        try { tx = db.transaction("thumbs", "readonly"); }
        catch (error) {
          resolve(out);
          return;
        }
        var store = tx.objectStore("thumbs");
        keys.forEach(function (key) {
          var req = store.get(key);
          req.onsuccess = function () {
            var row = req.result;
            if (row && row.blob instanceof Blob && String(row.blob.type || "").indexOf("image/") === 0) out[key] = row;
          };
        });
        tx.oncomplete = function () { resolve(out); };
        tx.onerror = function () { resolve(out); };
        tx.onabort = function () { resolve(out); };
      });
    });
  }

  function writeThumbRecord(key, blob, savedAt) {
    openThumbDb().then(function (db) {
      if (!db) return;
      try {
        db.transaction("thumbs", "readwrite").objectStore("thumbs").put({ blob: blob, savedAt: savedAt }, key);
      } catch (error) {}
    });
  }

  function warmThumbs(keys) {
    var missing = [];
    keys.forEach(function (key) {
      if (!isProfileThumb(key) || state.thumbs[key]) return;
      missing.push(key);
    });
    if (!missing.length) return Promise.resolve();
    return readThumbRecords(missing).then(function (rows) {
      Object.keys(rows).forEach(function (key) {
        if (state.thumbs[key]) return;
        state.thumbs[key] = {
          url: URL.createObjectURL(rows[key].blob),
          savedAt: rows[key].savedAt || 0,
          size: rows[key].blob.size || 0
        };
      });
    }).catch(function () {});
  }

  function thumbKeysFor(characters) {
    var keys = [];
    var seen = {};
    characters.forEach(function (character) {
      blogPhotoSources(character).forEach(function (source) {
        if (!isProfileThumb(source.thumb) || seen[source.thumb]) return;
        seen[source.thumb] = true;
        keys.push(source.thumb);
      });
    });
    return keys;
  }

  function rememberThumb(key, blob) {
    if (!isProfileThumb(key) || !blob || String(blob.type || "").indexOf("image/") !== 0) return null;
    var prev = state.thumbs[key];
    var url = URL.createObjectURL(blob);
    state.thumbs[key] = { url: url, savedAt: Date.now(), size: blob.size || 0 };
    writeThumbRecord(key, blob, state.thumbs[key].savedAt);
    return { url: url, prev: prev && prev.url !== url ? prev.url : "" };
  }

  function imageBlob(response) {
    var type = (response.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
    if (type.indexOf("image/") !== 0) return Promise.resolve(null);
    return response.blob().then(function (blob) {
      if (!blob) return null;
      if (String(blob.type || "").indexOf("image/") === 0) return blob;
      return new Blob([blob], { type: type });
    });
  }

  function releaseThumbUrl(url) {
    if (!url || url.indexOf("blob:") !== 0) return;
    var used = false;
    document.querySelectorAll("img").forEach(function (img) {
      if (img.src === url) used = true;
    });
    if (!used) URL.revokeObjectURL(url);
  }

  // 화면에 그린 사진을 썸네일로 남긴다. 한 시간 안이면 다시 받지 않는다.
  function archiveThumb(key) {
    if (!isProfileThumb(key)) return;
    var row = state.thumbs[key];
    if (row && Date.now() - row.savedAt < THUMB_REFRESH_MS) return;
    if (state.thumbArchive[key]) return;
    state.thumbArchive[key] = true;
    fetch(key, { credentials: "same-origin", cache: "force-cache" }).then(function (response) {
      if (!response.ok) return null;
      return imageBlob(response);
    }).then(function (blob) {
      state.thumbArchive[key] = false;
      if (!blob) return;
      var saved = rememberThumb(key, blob);
      if (saved) releaseThumbUrl(saved.prev);
    }).catch(function () {
      state.thumbArchive[key] = false;
    });
  }

  // 저장분이 오래되면 보이던 사진을 유지한 채 뒤에서 받고, 모이면 같이 바꾼다.
  // 쿠키가 만료돼 401이면 저장분을 지우지 않는다.
  function refreshThumbs() {
    var gen = state.thumbRefreshGen + 1;
    state.thumbRefreshGen = gen;
    var keys = [];
    var seen = {};
    document.querySelectorAll("img[data-thumb-key]").forEach(function (img) {
      var key = img.getAttribute("data-thumb-key");
      if (!isProfileThumb(key) || seen[key]) return;
      seen[key] = true;
      if (!state.thumbs[key]) return;
      keys.push(key);
    });
    if (!keys.length) return;
    Promise.all(keys.map(function (key) {
      return fetch(key, { credentials: "same-origin", cache: "default" }).then(function (response) {
        if (response.status === 401) return { key: key, expired: true };
        if (!response.ok) return { key: key };
        return imageBlob(response).then(function (blob) { return { key: key, blob: blob }; });
      }).catch(function () { return { key: key }; });
    })).then(function (results) {
      if (gen !== state.thumbRefreshGen) return;
      var expired = false;
      results.forEach(function (row) { if (row.expired) expired = true; });
      if (expired) return;
      var prevs = [];
      results.forEach(function (row) {
        if (!row.blob) return;
        var current = state.thumbs[row.key];
        if (current && current.size && current.size === row.blob.size) {
          current.savedAt = Date.now();
          writeThumbRecord(row.key, row.blob, current.savedAt);
          return;
        }
        var saved = rememberThumb(row.key, row.blob);
        if (!saved) return;
        if (saved.prev) prevs.push(saved.prev);
        document.querySelectorAll("img[data-thumb-key]").forEach(function (img) {
          if (img.getAttribute("data-thumb-key") !== row.key) return;
          img.src = saved.url;
        });
      });
      prevs.forEach(releaseThumbUrl);
    });
  }

  // 같은 화면의 프로필 사진은 다 끝나면 같이 연다. 숫자 집계와는 따로다.
  function createAvatarBatch() {
    var nodes = [];
    var pending = 0;
    var closed = false;
    function reveal() {
      if (!closed || pending > 0) return;
      nodes.forEach(function (node) {
        node.classList.remove("is-pending");
        node.removeAttribute("aria-busy");
      });
    }
    return {
      watch: function (node) {
        nodes.push(node);
        node.classList.add("is-pending");
        node.setAttribute("aria-busy", "true");
        pending += 1;
        var settled = false;
        return {
          done: function () {
            if (settled) return;
            settled = true;
            pending -= 1;
            reveal();
          },
          swap: function (next) {
            var index = nodes.indexOf(node);
            if (index >= 0) nodes[index] = next;
            next.classList.add("is-pending");
            next.setAttribute("aria-busy", "true");
            node.classList.remove("is-pending");
            node.removeAttribute("aria-busy");
          }
        };
      },
      close: function () {
        closed = true;
        reveal();
      }
    };
  }

  function avatarNode(character, className, batch, savedBatch) {
    var sources = blogPhotoSources(character);
    var local = character.image ? resolveImage(character.image) : "";
    if (local && local !== DASHBOARD_CONFIG.defaultImage) sources.push({ thumb: local, large: local });
    var first = sources[0];
    var fallback = DASHBOARD_CONFIG.defaultImage;
    var saved = first && isProfileThumb(first.thumb) ? state.thumbs[first.thumb] : null;
    var img = h("img", {
      class: className || "avatar",
      alt: "",
      width: "64",
      height: "64"
    });
    var button = h("button", {
      type: "button",
      class: "avatar-btn",
      "aria-label": (character.name || "캐릭터") + " 프로필 크게 보기"
    }, img);
    var group = saved && saved.url ? savedBatch : batch;
    var ownBatch = !group;
    if (ownBatch) group = createAvatarBatch();
    var slot = group.watch(button);
    var index = 0;
    function finish() {
      slot.done();
      var key = img.getAttribute("data-thumb-key");
      if (key && (img.currentSrc || img.src).indexOf("profile.php?") !== -1) archiveThumb(key);
    }
    if (first) img.setAttribute("data-photo", first.large);
    else img.setAttribute("data-photo", fallback);
    if (saved && saved.url) {
      img.setAttribute("data-thumb-key", first.thumb);
      img.addEventListener("load", function () { slot.done(); });
      img.addEventListener("error", function () { slot.done(); });
      img.src = saved.url;
      if (img.complete && img.naturalWidth > 0) slot.done();
    } else {
      if (first && isProfileThumb(first.thumb)) img.setAttribute("data-thumb-key", first.thumb);
      img.addEventListener("load", finish);
      img.addEventListener("error", function onError() {
        index += 1;
        if (index < sources.length) {
          img.src = sources[index].thumb;
          img.setAttribute("data-photo", sources[index].large);
          if (isProfileThumb(sources[index].thumb)) img.setAttribute("data-thumb-key", sources[index].thumb);
          else img.removeAttribute("data-thumb-key");
          return;
        }
        if (img.dataset.fallback === "1") {
          img.removeEventListener("error", onError);
          var mark = h("span", { class: (className || "avatar") + " avatar-fallback", "aria-hidden": "true" }, icon("fa-solid fa-user"));
          button.replaceWith(mark);
          slot.swap(mark);
          slot.done();
          return;
        }
        img.dataset.fallback = "1";
        img.removeAttribute("data-thumb-key");
        img.setAttribute("data-photo", fallback);
        img.src = fallback;
      });
      img.src = first ? first.thumb : fallback;
      if (img.complete && img.naturalWidth > 0) finish();
    }
    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (button.classList.contains("is-pending")) return;
      var current = button.querySelector("img");
      if (!current) return;
      openPhoto(character, current);
    });
    if (ownBatch) group.close();
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

  function formatBirth(value) {
    var matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!matched) return "";
    return Number(matched[1]) + "년 " + Number(matched[2]) + "월 " + Number(matched[3]) + "일";
  }

  function genderLabel(gender) {
    if (gender === "female") return "여자";
    if (gender === "male") return "남자";
    return "";
  }

  function genderIcon(gender) {
    var label = genderLabel(gender);
    if (!label) return null;
    var mark = gender === "female" ? "fa-solid fa-venus" : "fa-solid fa-mars";
    return h("span", { class: "gender gender-" + (gender === "female" ? "f" : "m"), title: label },
      icon(mark),
      h("span", { class: "sr-only", text: label })
    );
  }

  function birthLine(character) {
    var text = formatBirth(character && character.birthdate);
    var mark = genderIcon(character && character.gender);
    if (!text && !mark) return null;
    return h("p", { class: "card-birth" },
      mark,
      text ? h("time", { datetime: character.birthdate, text: text }) : null
    );
  }

  function statusClass(status) {
    if (status === "활성") return "on";
    if (status === "휴식") return "rest";
    if (status === "점검") return "check";
    if (status === "미정") return "idle";
    if (status === "중지") return "stop";
    return "idle";
  }

  function paintDelta(node, character) {
    if (character.yesterdayVisitors == null) {
      node.hidden = true;
      node.className = "delta";
      node.replaceChildren();
      return;
    }
    if (characterLivePending(character)) {
      node.hidden = false;
      node.className = "delta is-loading";
      node.replaceChildren(
        h("span", { class: "sr-only", text: "집계 중" }),
        countSkeleton("sk-delta")
      );
      return;
    }
    fadeCount(node);
    var info = deltaInfo(character);
    if (!info) {
      node.hidden = true;
      node.className = "delta";
      node.replaceChildren();
      return;
    }
    node.hidden = false;
    var cls = "delta is-" + info.direction + (info.big ? " is-big" : "");
    var label = info.direction === "up" ? "증가" : info.direction === "down" ? "감소" : "변동 없음";
    var iconClass = info.direction === "up" ? "fa-solid fa-arrow-trend-up" : info.direction === "down" ? "fa-solid fa-arrow-trend-down" : "fa-solid fa-minus";
    var absText = formatNumber(Math.abs(info.diff));
    var percent = info.rate == null ? "" : " (" + Math.round(info.rate * 100) + "%)";
    var sr = "어제보다 " + absText + "명 " + label;
    if (info.rate != null) sr += ", " + Math.round(info.rate * 100) + "퍼센트";
    if (info.big) sr += ". 전일 대비 크게 감소";
    node.className = cls;
    node.replaceChildren(
      icon(iconClass),
      h("span", { text: absText + percent }),
      h("span", { class: "sr-only", text: sr }),
      h("span", { class: "delta-base", text: "어제 " + formatNumber(character.yesterdayVisitors) })
    );
  }

  function deltaNode(character) {
    // 어제 값이 없으면 집계 뒤에 줄이 사라지며 칸 높이가 바뀐다. 그 줄은 처음부터 두지 않는다.
    if (character.yesterdayVisitors == null) return null;
    if (!characterLivePending(character) && !deltaInfo(character)) return null;
    var node = h("p", { "data-delta": character.id });
    paintDelta(node, character);
    return node;
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
      if (!naver && !tistory && !blogspotName(host)) return "";
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
    showReel(plus.querySelector(".odometer"), today, host);
  }

  function paintPartial(el, character) {
    if (!el) return;
    var show = !!(character && character.ok && !characterLivePending(character) && character.visitorPartial);
    el.hidden = !show;
    el.textContent = show ? "방문자 합에 빠진 블로그가 있습니다." : "";
  }

  function partialHost(character) {
    var el = h("p", { class: "visitor-partial", "data-partial": character.id, hidden: true });
    paintPartial(el, character);
    return el;
  }

  function gapText(data, field) {
    if (!data || (data.status !== "ok" && data.status !== "fail")) return "—";
    if (data.status === "fail") return "못 불러옴";
    if (!data.gaps) return "—";
    var code = data.gaps[field];
    if (GAP_TEXT[code]) return GAP_TEXT[code];
    return "못 읽음";
  }

  function sideGapText(data, field) {
    var code = data && data.gaps && data.gaps[field];
    if (!GAP_TEXT[code]) return "";
    return GAP_TEXT[code];
  }

  function normalizeGaps(data) {
    var out = {};
    var src = data && data.gaps;
    if (!src || typeof src !== "object") return out;
    Object.keys(GAP_TEXT).forEach(function (code) {
      ["posts", "comments", "today", "total", "postsToday", "commentsToday"].forEach(function (field) {
        if (src[field] === code) out[field] = code;
      });
    });
    return out;
  }

  // 마지막으로 받은 집계. 다음 화면에서는 이 값을 먼저 그리고, 뒤에서 다시 받아 반영한다.
  function readCountCache() {
    var parsed = null;
    try { parsed = JSON.parse(storageGet(STORAGE.counts) || ""); } catch (error) { return {}; }
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  }

  function knownCountKeys() {
    var keys = {};
    state.characters.forEach(function (character) {
      (character.blogs || []).forEach(function (blog) {
        var key = countableBlogUrl(blog.url || "");
        if (key) keys[key] = true;
      });
    });
    return keys;
  }

  function rememberCount(key) {
    var data = state.blogCounts[key];
    if (!key || !data || data.status !== "ok" || data.cached) return;
    var map = readCountCache();
    map[key] = {
      posts: data.posts,
      comments: data.comments,
      today: data.today,
      total: data.total,
      postsToday: data.postsToday,
      commentsToday: data.commentsToday,
      gaps: data.gaps || {}
    };
    var known = knownCountKeys();
    if (Object.keys(known).length) {
      Object.keys(map).forEach(function (saved) {
        if (!known[saved]) delete map[saved];
      });
    }
    storageSet(STORAGE.counts, JSON.stringify(map));
    stampCountCacheDay();
  }

  // 컴퓨터 시간대와 상관없이 한국시간 0시(밤 12시)에 날짜가 바뀐다.
  function seoulDateKey(now) {
    var date = now instanceof Date ? now : new Date(now || Date.now());
    var seoul = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    function two(n) { return (n < 10 ? "0" : "") + n; }
    return seoul.getUTCFullYear() + "-" + two(seoul.getUTCMonth() + 1) + "-" + two(seoul.getUTCDate());
  }

  function countCacheIsToday() {
    return storageGet(STORAGE.countsDay) === seoulDateKey(new Date());
  }

  function stampCountCacheDay() {
    storageSet(STORAGE.countsDay, seoulDateKey(new Date()));
  }

  // 이 브라우저에서 한국시간 오늘 페이지를 처음 연 경우. 판정은 한 번만 하고, 새로고침은 날짜를 바꾸지 않는다.
  function captureFirstLoadToday() {
    if (state.firstLoadToday != null) return state.firstLoadToday;
    var today = seoulDateKey(new Date());
    var first = storageGet(STORAGE.viewDay) !== today;
    state.firstLoadToday = first;
    if (first) {
      storageSet(STORAGE.viewDay, today);
      storageSet(STORAGE.counts, "{}");
    }
    return first;
  }

  function seedCachedCounts() {
    var freshDay = captureFirstLoadToday() || !countCacheIsToday();
    state.countDayReset = freshDay;
    if (freshDay) {
      storageSet(STORAGE.counts, "{}");
      state.characters.forEach(function (character) {
        (character.blogs || []).forEach(function (blog) {
          var key = countableBlogUrl(blog.url || "");
          if (!key) return;
          var current = state.blogCounts[key];
          if (current && (current.refreshing || (current.status === "ok" && !current.cached))) return;
          state.blogCounts[key] = { status: "loading" };
        });
      });
      return;
    }
    var map = readCountCache();
    state.characters.forEach(function (character) {
      (character.blogs || []).forEach(function (blog) {
        var key = countableBlogUrl(blog.url || "");
        var row = key && map[key];
        if (!key || state.blogCounts[key] || !row || typeof row !== "object") return;
        state.blogCounts[key] = {
          status: "ok",
          cached: true,
          posts: normalizeCount(row.posts),
          comments: normalizeCount(row.comments),
          today: normalizeCount(row.today),
          total: normalizeCount(row.total),
          postsToday: normalizeCount(row.postsToday),
          commentsToday: normalizeCount(row.commentsToday),
          gaps: normalizeGaps(row)
        };
      });
    });
  }

  function paintCountGap(span, text) {
    var host = span.querySelector(".count-pair") || span;
    var gap = host.querySelector(".count-gap");
    if (!text) {
      if (gap) gap.remove();
      return;
    }
    if (!gap) {
      gap = document.createElement("span");
      gap.className = "count-gap";
      host.appendChild(gap);
    }
    gap.textContent = text;
  }

  function showCountOrGap(el, value, data, field, prefix) {
    if (value == null && data && (data.status === "ok" || data.status === "fail")) {
      el.removeAttribute("aria-busy");
      var nodes = [];
      if (prefix) nodes.push(h("span", { class: "odometer-prefix", text: prefix }));
      nodes.push(h("span", { class: "count-gap", text: gapText(data, field) }));
      el.replaceChildren.apply(el, nodes);
      return;
    }
    showHostedCount(el, value, prefix);
  }

  function fillBlogCounts(el, url) {
    var key = countableBlogUrl(url);
    var data = key ? state.blogCounts[key] : null;
    var activity = el.getAttribute("data-counts-mode") === "activity";
    var loading = blogCountLoading(key);
    el.classList.toggle("is-loading", loading);
    if (loading) el.setAttribute("aria-busy", "true");
    else el.removeAttribute("aria-busy");
    Array.prototype.slice.call(el.childNodes).forEach(function (node) {
      if (node.nodeType === 3) node.remove();
    });
    var posts = data && data.status === "ok" ? data.posts : null;
    var comments = data && data.status === "ok" ? data.comments : null;
    var postsToday = data && data.status === "ok" ? data.postsToday : null;
    var commentsToday = data && data.status === "ok" ? data.commentsToday : null;
    var items = [];
    if (!activity) {
      items.push({ label: "오늘", field: "today", value: displayToday(data) });
      items.push({ label: "전체", field: "total", value: data && data.status === "ok" ? data.total : null });
    }
    items.push({ label: "글", field: "posts", todayField: "postsToday", icon: "fa-solid fa-file-lines", value: posts, today: postsToday });
    items.push({ label: "댓글", field: "comments", todayField: "commentsToday", icon: "fa-solid fa-comment", value: comments, today: commentsToday });
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
      if (loading) {
        paintTodayPlus(span, 0, item.label);
        paintCountGap(span, "");
        var loadingPair = span.querySelector(".count-pair");
        if (loadingPair) loadingPair.replaceChildren(countSkeleton("sk-count"));
        return;
      }
      // 총 6개 중 오늘 2개면 6이 아니라 4+2. 그 수가 없거나 총수보다 크면 총수만 보여 준다.
      var showPlus = (item.label === "글" || item.label === "댓글")
        && typeof item.value === "number"
        && typeof item.today === "number"
        && item.today > 0
        && item.today <= item.value;
      span.removeAttribute("title");
      if (item.value == null) {
        paintTodayPlus(span, 0, item.label);
        paintCountGap(span, "");
        var emptyPair = span.querySelector(".count-pair");
        if (emptyPair) emptyPair.replaceChildren(h("span", { class: "count-gap", text: gapText(data, item.field) }));
        return;
      }
      paintTodayPlus(span, showPlus ? item.today : 0, item.label);
      paintCountGap(span, !showPlus && item.today == null && item.todayField ? sideGapText(data, item.todayField) : "");
      var pair = span.querySelector(".count-pair");
      if (pair) fadeCount(pair);
      // 오늘 추가분 칸에도 odometer 가 있다. 쌍의 직계 자식만 본 숫자로 본다.
      var reel = null;
      if (pair) {
        for (var reelIndex = 0; reelIndex < pair.children.length; reelIndex++) {
          if (pair.children[reelIndex].classList.contains("odometer")) {
            reel = pair.children[reelIndex];
            break;
          }
        }
      }
      if (pair && !reel) {
        for (var skIndex = pair.children.length - 1; skIndex >= 0; skIndex--) {
          if (pair.children[skIndex].classList.contains("skeleton")) pair.children[skIndex].remove();
        }
        reel = document.createElement("span");
        reel.className = "odometer";
        pair.insertBefore(reel, pair.firstChild);
      }
      showReel(reel, showPlus ? item.value - item.today : item.value, pair);
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
      commentsToday: normalizeCount(data && data.commentsToday),
      gaps: data && data.gaps ? normalizeGaps(data) : null
    };
    rememberCount(key);
  }

  // 이미 보이는 숫자에서 새 숫자로 올린다. 집계 중으로 바꾸면 릴이 지워져 0부터 다시 센다.
  function countReloadShouldSpin() {
    return !!(state.countIconHold || state.loading || state.countRefreshBusy || countsPending());
  }

  function syncCountReloadSpin() {
    setCountReloadBusy(countReloadShouldSpin());
  }

  function releaseCountIconHold() {
    if (state.loading || countsPending()) return;
    state.countIconHold = false;
    syncCountReloadSpin();
  }

  function refreshLiveCounts() {
    if (state.countRefreshBusy || state.loading || state.countIconHold || !state.ready || countsPending()) return;
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
    syncCountReloadSpin();
    var left = keys.length;
    function finish() {
      left -= 1;
      if (left > 0) return;
      state.countRefreshBusy = false;
      syncCountReloadSpin();
      if (gen !== state.countRefreshGen || state.loading || state.countIconHold) return;
      applyLiveCounts(null);
    }
    keys.forEach(function (key) {
      fetchCounts(key, "reload")
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

  // 로컬 시각 기준 다음 10분 경계까지 남은 시간. 정각이면 다음 경계(10분 뒤)를 가리킨다.
  function msUntilNextCountRefresh(now) {
    var date = new Date(now);
    var intoSlot = (date.getMinutes() % 10) * 60000 + date.getSeconds() * 1000 + date.getMilliseconds();
    if (!intoSlot) return COUNT_REFRESH_MS;
    return COUNT_REFRESH_MS - intoSlot;
  }

  function armCountRefresh(skipIfClose) {
    var wait = msUntilNextCountRefresh(Date.now());
    // 경계보다 조금 일찍 깨어나면 같은 슬롯을 바로 한 번 더 치지 않게 다음 경계로 넘긴다.
    if (skipIfClose && wait < 1500) wait += COUNT_REFRESH_MS;
    state.countTimer = setTimeout(function () {
      state.countTimer = 0;
      refreshLiveCounts();
      refreshLatestPosts();
      armCountRefresh(true);
    }, wait);
  }

  function startCountWatch() {
    if (state.countTimer) return;
    armCountRefresh(false);
  }

  // 같은 날 다시 열면 저장해 둔 집계를 먼저 그린 뒤 서버의 10분 캐시로 뒤에서 다시 받는다.
  // 이 브라우저에서 한국시간 그날 처음 열면 저장값을 버리고, 집계가 끝날 때까지 스켈레톤을 보여 준다.
  function fetchCounts(key, cacheMode) {
    return fetch("profile.php?view=counts&window=today&blog=" + encodeURIComponent(key), {
      credentials: "same-origin",
      cache: cacheMode || "default",
      headers: { "Accept": "application/json" }
    });
  }

  function requestBlogCounts() {
    seedCachedCounts();
    var cacheMode = state.countDayReset ? "reload" : "default";
    var pending = [];
    var seen = {};
    state.characters.forEach(function (character) {
      (character.blogs || []).forEach(function (blog) {
        var key = countableBlogUrl(blog.url || "");
        if (!key || seen[key]) return;
        seen[key] = true;
        if (!state.blogCounts[key]) state.blogCounts[key] = { status: "loading" };
        var row = state.blogCounts[key];
        var stale = !!(row.cached && !row.settled);
        if (row.status !== "loading" && !stale) return;
        if (row.refreshing) return;
        row.refreshing = true;
        pending.push(key);
      });
    });
    var gen = state.countRefreshGen;
    if (!pending.length) {
      releaseCountIconHold();
      return;
    }
    // 받아 오는 동안 이미 그린 숫자는 유지한다. 응답이 모이면 한 번에 바꾼다.
    state.countRefreshBusy = true;
    syncCountReloadSpin();
    var incoming = {};
    var left = pending.length;
    pending.forEach(function (key) {
      fetchCounts(key, cacheMode)
        .then(function (response) {
          if (!response.ok) throw new Error("counts");
          return response.json();
        })
        .then(function (data) {
          if (gen !== state.countRefreshGen) return;
          incoming[key] = { ok: true, data: data };
        })
        .catch(function () {
          if (gen !== state.countRefreshGen) return;
          incoming[key] = { ok: false };
        })
        .then(function () {
          left -= 1;
          if (left > 0 || gen !== state.countRefreshGen) return;
          pending.forEach(function (doneKey) {
            var item = incoming[doneKey];
            if (item && item.ok) {
              applyCountPayload(doneKey, item.data);
              return;
            }
            var current = state.blogCounts[doneKey];
            if (current && current.status === "ok" && current.cached) {
              current.settled = true;
              current.refreshing = false;
              return;
            }
            state.blogCounts[doneKey] = { status: "fail" };
          });
          state.countRefreshBusy = false;
          syncCountReloadSpin();
          applyLiveCounts(null);
          releaseCountIconHold();
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

  // 같은 플랫폼이 둘 이상이면 파일에 적힌 순서대로 Blogger 1, Blogger 2 처럼 나눈다.
  function labeledBlogs(character, requireUrl) {
    var rows = (character.blogs || []).map(function (blog, index) {
      return { blog: blog, order: index };
    }).filter(function (row) {
      return !requireUrl || String(row.blog.url || "").trim();
    }).sort(function (a, b) {
      var platform = String(a.blog.platform || "").localeCompare(String(b.blog.platform || ""), "ko");
      if (platform) return platform;
      return a.order - b.order;
    });
    var totals = {};
    rows.forEach(function (row) {
      var name = row.blog.platform || "블로그";
      totals[name] = (totals[name] || 0) + 1;
    });
    var seen = {};
    rows.forEach(function (row) {
      var name = row.blog.platform || "블로그";
      if (totals[name] > 1) {
        seen[name] = (seen[name] || 0) + 1;
        row.label = name + " " + seen[name];
      } else {
        row.label = name;
      }
    });
    return rows;
  }

  function applyVisitorBlog(block, url) {
    var key = countableBlogUrl(url);
    var data = key ? state.blogCounts[key] : null;
    var loading = blogCountLoading(key);
    var today = displayToday(data);
    var total = data && data.status === "ok" ? data.total : null;
    var num = block.querySelector("[data-blog-today]");
    var totalEl = block.querySelector("[data-blog-total]");
    block.setAttribute("aria-busy", loading ? "true" : "false");
    if (num) {
      if (loading) paintPendingValue(num, "sk-visitor");
      else {
        fadeCount(num);
        num.removeAttribute("aria-busy");
        showCountOrGap(num, today, data, "today");
      }
    }
    if (totalEl) {
      if (loading) {
        totalEl.setAttribute("aria-busy", "true");
        totalEl.replaceChildren(
          h("span", { class: "odometer-prefix", text: "전체 " }),
          h("span", { class: "sr-only", text: "집계 중" }),
          countSkeleton("sk-total")
        );
      } else {
        var revealTotal = totalEl.getAttribute("aria-busy") === "true" || !!totalEl.querySelector(".skeleton");
        totalEl.removeAttribute("aria-busy");
        showCountOrGap(totalEl, total, data, "total", "전체 ");
        var totalReel = totalEl.querySelector(".odometer");
        if (revealTotal) playCountFade(totalReel);
        else fadeCount(totalReel);
      }
    }
    clearVisitorLevel(block);
    block.classList.add("is-" + (loading || today == null ? "unknown" : visitorLevel(today)));
  }

  function pausedMark() {
    return h("span", { class: "visitor-paused", text: "미운영" });
  }

  function blogspotName(host) {
    var matched = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.blogspot\.([a-z0-9.]+)$/.exec(String(host || ""));
    if (!matched) return "";
    if (!/^(?:com|co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2})$/.test(matched[2])) return "";
    if (matched[1] === "www") return "";
    return matched[1];
  }

  function omitsDailyVisitors(data) {
    return !!(data && data.status === "ok" && data.today == null && data.gaps && data.gaps.today === "alltime");
  }

  // 일별 방문자 없는 블로그는 칸에 0을 그린다. 오늘 합과 기록에는 넣지 않는다.
  function displayToday(data) {
    if (omitsDailyVisitors(data)) return 0;
    if (!data || data.status !== "ok" || typeof data.today !== "number") return null;
    return data.today;
  }

  function platformIcon(name) {
    var file = name === "네이버" ? "naver.jpg" : name === "티스토리" ? "tistory.jpg" : name === "Blogger" ? "blogger.jpg" : "";
    if (!file) return null;
    return h("img", {
      class: "platform-icon",
      src: "assets/app-icons/" + file,
      alt: "",
      width: "18",
      height: "18"
    });
  }

  function visitorBlogsNode(character) {
    var rows = labeledBlogs(character, true);
    if (!rows.length) {
      return h("p", { class: "visitor-note", text: "블로그 없음" });
    }
    var wrap = h("div", { class: "visitor-blogs" + (rows.length === 1 ? " is-single" : "") });
    if (rows.length > 1) wrap.appendChild(h("p", { class: "visitor-today", text: "오늘" }));
    rows.forEach(function (row) {
      var blog = row.blog;
      var key = countableBlogUrl(blog.url) || safeUrl(blog.url) || blog.url;
      var block = h("div", { class: "visitor-blog", "data-visitor-blog": key },
        h("p", { class: "visitor-label" },
          rows.length === 1 ? row.label + " · 오늘" : row.label,
          blog.paused ? pausedMark() : null
        ),
        h("p", { class: "visitor-num", "data-blog-today": "1", text: "…" }),
        h("p", { class: "visitor-total", "data-blog-total": "1", text: "전체 …" })
      );
      applyVisitorBlog(block, key);
      wrap.appendChild(block);
    });
    wrap.appendChild(partialHost(character));
    return wrap;
  }

  function blogLinks(character) {
    var rows = labeledBlogs(character, true);
    var wrap = h("div", { class: "blog-links" });
    if (!rows.length) {
      wrap.appendChild(h("p", { class: "blog-empty", text: "블로그 없음" }));
      return wrap;
    }
    rows.forEach(function (entry) {
      var blog = entry.blog;
      var href = safeUrl(blog.url);
      var row = h("div", { class: blog.platform ? "blog-row" : "blog-row is-plain" });
      if (blog.platform) {
        row.appendChild(h("span", { class: "blog-platform" },
          platformIcon(blog.platform),
          h("span", { class: "platform-name", text: entry.label }),
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

  function renderCard(character, batch, savedBatch) {
    if (!character.ok) return renderErrorCard(character);
    var pendingCard = characterLivePending(character);
    var level = pendingCard ? "unknown" : visitorLevel(character.todayVisitors);
    var classes = ["card", "is-" + level];
    if (!pendingCard && isBigDrop(character)) classes.push("is-drop");
    return h("article", { class: classes.join(" "), "data-character": character.id },
      h("div", { class: "meter", "aria-hidden": "true" }, h("span")),
      detailLink(character.id, character.name + " 상세 페이지"),
      h("div", { class: "card-body" },
        h("div", { class: "card-head" },
          avatarNode(character, "avatar", batch, savedBatch),
          h("div", { class: "card-id" },
            h("h2", { class: "card-name", text: character.name }),
            character.nickname ? h("p", { class: "card-nick", text: character.nickname }) : null,
            h("span", { class: "badge badge-" + statusClass(character.status), text: character.status || "미정" })
          )
        ),
        visitorBlogsNode(character),
        deltaNode(character),
        weekChartNode(character),
        accountNode(character)
      ),
      blogLinks(character)
    );
  }

  function weekChartNode(character) {
    if (!countableBlogs(character).length) return null;
    return h("section", { class: "card-week" },
      h("h3", { text: "최근 1주일 방문자" }),
      h("div", { class: "card-week-wrap" },
        h("canvas", { "data-week-chart": character.id, "aria-hidden": "true" })
      ),
      h("p", { class: "sr-only" }),
      h("p", { class: "card-week-empty", hidden: true })
    );
  }

  function destroyWeekCharts(root) {
    if (typeof Chart === "undefined" || !root) return;
    root.querySelectorAll("[data-week-chart]").forEach(function (canvas) {
      var chart = Chart.getChart(canvas);
      if (chart) chart.destroy();
    });
  }

  function renderWeekCharts() {
    if (!window.BotDashChart || !window.BotDashChart.renderWeek) return;
    document.querySelectorAll("#cardGrid [data-week-chart]").forEach(function (canvas) {
      window.BotDashChart.renderWeek(canvas, findById(canvas.getAttribute("data-week-chart")));
    });
  }

  function paintShellPlaceholders() {
    ["statVisitors", "statTotal"].forEach(function (id) {
      paintPendingValue(document.getElementById(id), "sk-metric-num");
    });
    ["count-all", "count-has", "count-zero"].forEach(function (id) {
      paintPendingValue(document.getElementById(id), "sk-count");
    });
  }

  function paintLivePlaceholders() {
    // 저장해 둔 집계가 다 있으면 숫자를 스켈레톤으로 되돌리지 않는다.
    if (!countsBlockPaint()) return;
    paintPendingValue(document.getElementById("statVisitors"), "sk-metric-num");
    paintPendingValue(document.getElementById("statTotal"), "sk-metric-num");
    ["count-has", "count-zero"].forEach(function (id) {
      paintPendingValue(document.getElementById(id), "sk-count");
    });
    document.querySelectorAll("[data-visitor-blog]").forEach(function (block) {
      applyVisitorBlog(block, block.getAttribute("data-visitor-blog"));
    });
    document.querySelectorAll("[data-blog-counts]").forEach(function (el) {
      fillBlogCounts(el, el.getAttribute("data-blog-counts"));
    });
    document.querySelectorAll("[data-stat-today]").forEach(function (el) {
      var character = findById(el.getAttribute("data-stat-today"));
      if (character && characterLivePending(character)) paintPendingValue(el, "sk-visitor");
    });
    document.querySelectorAll("[data-stat-total]").forEach(function (el) {
      var character = findById(el.getAttribute("data-stat-total"));
      if (character && characterLivePending(character)) paintPendingValue(el, "sk-total");
    });
    document.querySelectorAll("[data-delta]").forEach(function (node) {
      var character = findById(node.getAttribute("data-delta"));
      if (character) paintDelta(node, character);
    });
    document.querySelectorAll("article.card[data-character]").forEach(function (card) {
      var character = findById(card.getAttribute("data-character"));
      if (!character || !characterLivePending(character)) return;
      clearVisitorLevel(card);
      card.classList.remove("is-drop");
      card.classList.add("is-unknown");
    });
    if (state.view === "stats") {
      renderStatsTable();
      holdChart();
    }
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
    var figuresWait = !state.ready || countsBlockPaint();
    if (visitors) {
      if (figuresWait) paintPendingValue(visitors, "sk-metric-num");
      else {
        fadeCount(visitors);
        visitors.removeAttribute("aria-busy");
        showHostedCount(visitors, summedVisitors(ok, "todayVisitors"));
      }
    }
    if (totalVisitors) {
      if (figuresWait) paintPendingValue(totalVisitors, "sk-metric-num");
      else {
        fadeCount(totalVisitors);
        totalVisitors.removeAttribute("aria-busy");
        showHostedCount(totalVisitors, summedVisitors(ok, "totalVisitors"));
      }
    }
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
    var wait = countsBlockPaint();
    Object.keys(counts).forEach(function (key) {
      var el = document.getElementById("count-" + key);
      if (!el) return;
      if (wait && key !== "all") {
        paintPendingValue(el, "sk-count");
        return;
      }
      fadeCount(el);
      el.removeAttribute("aria-busy");
      el.textContent = String(counts[key]);
    });
  }

  function buildEmpty() {
    var noData = state.characters.length === 0;
    var title = noData ? "등록된 캐릭터가 없습니다" : "조건에 맞는 캐릭터가 없습니다";
    var text = noData
      ? "characters 폴더에 영문 파일명의 마크다운을 넣어 주세요."
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

  function cardsHidden() {
    var panel = document.getElementById("cards");
    return !panel || panel.hidden;
  }

  function cardColumnCount() {
    if (window.matchMedia("(min-width: 1720px)").matches) return 4;
    if (window.matchMedia("(min-width: 1280px)").matches) return 3;
    if (window.matchMedia("(min-width: 768px)").matches) return 2;
    return 1;
  }

  // 문서 기준 위치. 스크롤이 바뀌어도 칸 이동량만 남긴다.
  function snapshotCardPlaces(grid) {
    var places = {};
    if (!grid) return places;
    grid.querySelectorAll("article.card[data-character]").forEach(function (card) {
      var id = card.getAttribute("data-character");
      if (!id) return;
      var rect = card.getBoundingClientRect();
      if (rect.width < 1 && rect.height < 1) return;
      places[id] = {
        left: rect.left + window.pageXOffset,
        top: rect.top + window.pageYOffset
      };
    });
    return places;
  }

  function rememberCardPlaces() {
    if (cardsHidden()) return;
    var grid = document.getElementById("cardGrid");
    if (!grid) return;
    state.cardPlaces = snapshotCardPlaces(grid);
    state.cardColumns = cardColumnCount();
  }

  // 같은 카드를 이전 자리에서 새 자리로 미끄러뜨린다.
  function playCardMove(grid, before) {
    state.cardMoveGen += 1;
    var gen = state.cardMoveGen;
    if (!grid || !before || reducedMotion || cardsHidden()) {
      state.cardMoving = false;
      rememberCardPlaces();
      return;
    }
    var moving = [];
    grid.querySelectorAll("article.card[data-character]").forEach(function (card) {
      var id = card.getAttribute("data-character");
      var first = before[id];
      if (!first) return;
      var rect = card.getBoundingClientRect();
      var dx = first.left - (rect.left + window.pageXOffset);
      var dy = first.top - (rect.top + window.pageYOffset);
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      card.style.transition = "none";
      card.style.transform = "translate(" + dx.toFixed(2) + "px, " + dy.toFixed(2) + "px)";
      moving.push(card);
    });
    if (!moving.length) {
      state.cardMoving = false;
      rememberCardPlaces();
      return;
    }
    state.cardMoving = true;
    void grid.offsetWidth;
    requestAnimationFrame(function () {
      if (gen !== state.cardMoveGen) return;
      moving.forEach(function (card) {
        card.classList.add("is-moving");
        card.style.transition = "";
        card.style.transform = "";
      });
    });
    window.setTimeout(function () {
      if (gen !== state.cardMoveGen) return;
      moving.forEach(function (card) {
        card.classList.remove("is-moving");
        card.style.transform = "";
        card.style.transition = "";
      });
      state.cardMoving = false;
      rememberCardPlaces();
    }, 480);
  }

  function watchCardColumns() {
    var grid = document.getElementById("cardGrid");
    if (!grid || typeof ResizeObserver !== "function") return;
    state.cardColumns = cardColumnCount();
    rememberCardPlaces();
    var observer = new ResizeObserver(function () {
      var next = cardColumnCount();
      if (state.cardMoving) return;
      if (cardsHidden()) {
        state.cardColumns = next;
        return;
      }
      if (state.cardColumns && next !== state.cardColumns && state.cardPlaces) {
        var before = state.cardPlaces;
        state.cardColumns = next;
        state.cardMoving = true;
        playCardMove(grid, before);
        return;
      }
      state.cardColumns = next;
      rememberCardPlaces();
    });
    observer.observe(grid);
  }

  function renderGrid(list, options) {
    var grid = document.getElementById("cardGrid");
    var empty = document.getElementById("emptyState");
    if (!grid || !empty) return;
    var fromSkeleton = !!grid.querySelector(".skeleton-card");
    var cardsPanel = document.getElementById("cards");
    var revealCards = fromSkeleton && cardsPanel && !cardsPanel.hidden;
    var before = snapshotCardPlaces(grid);
    var existing = cardsById(grid);
    var reuse = !(options && options.rebuildCards) && !fromSkeleton && sameCardSet(existing, list);
    if (reuse) {
      empty.hidden = true;
      state.cardMoving = true;
      clearFadeMarks(grid);
      list.forEach(function (row) { grid.appendChild(existing[row.id]); });
      playCardMove(grid, before);
      return;
    }
    if (!list.length) {
      state.cardMoving = true;
      destroyWeekCharts(grid);
      grid.replaceChildren();
      empty.hidden = false;
      empty.replaceChildren(buildEmpty());
      state.cardMoving = false;
      state.cardPlaces = {};
      if (revealCards) fadeIn(empty);
      return;
    }
    empty.hidden = true;
    state.cardMoving = true;
    destroyWeekCharts(grid);
    grid.replaceChildren();
    var batch = createAvatarBatch();
    var savedBatch = createAvatarBatch();
    list.forEach(function (row) { grid.appendChild(renderCard(row, batch, savedBatch)); });
    batch.close();
    savedBatch.close();
    if (revealCards) fadeIn(grid);
    playCardMove(grid, before);
  }

  function countCell(blog, field) {
    var key = countableBlogUrl(blog.url || "");
    var data = key && state.blogCounts[key];
    var loading = blogCountLoading(key);
    var td = h("td", { class: "num", "data-blog-key": key, "data-blog-field": field });
    if (loading) {
      td.setAttribute("aria-busy", "true");
      td.appendChild(countSkeleton("sk-count"));
      return td;
    }
    paintStatCell(td);
    return td;
  }

  function statCountNode(data, field) {
    var todayField = field === "posts" ? "postsToday" : field === "comments" ? "commentsToday" : "";
    var value = field === "today" ? displayToday(data) : (data && data.status === "ok" ? data[field] : null);
    if (value == null) return h("span", { class: "count-gap", text: gapText(data, field) });
    if (!todayField) return document.createTextNode(formatNumber(value));
    var today = data[todayField];
    var showPlus = typeof today === "number" && today > 0 && today <= value;
    var wrap = h("span", { class: "count-pair" });
    wrap.appendChild(document.createTextNode(formatNumber(showPlus ? value - today : value)));
    if (showPlus) {
      var label = field === "posts" ? "글" : "댓글";
      wrap.appendChild(h("span", {
        class: "count-plus",
        title: "오늘 올라온 " + label + " " + formatNumber(today)
      }, h("span", { class: "count-plus-sign", "aria-hidden": "true", text: "+" }), formatNumber(today)));
    } else if (today == null && sideGapText(data, todayField)) {
      wrap.appendChild(h("span", { class: "count-gap", text: sideGapText(data, todayField) }));
    }
    return wrap;
  }

  function paintStatCell(td) {
    var key = td.getAttribute("data-blog-key");
    var field = td.getAttribute("data-blog-field");
    var data = key && state.blogCounts[key];
    var loading = blogCountLoading(key);
    if (loading) {
      td.setAttribute("aria-busy", "true");
      td.replaceChildren(countSkeleton("sk-count"));
      return;
    }
    fadeCount(td);
    td.removeAttribute("aria-busy");
    td.replaceChildren(statCountNode(data, field));
  }

  function paintStatsCells() {
    document.querySelectorAll("#statsTable [data-blog-field]").forEach(paintStatCell);
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
    table.appendChild(h("caption", { class: "sr-only", text: "캐릭터별 블로그 방문자, 글, 댓글" }));
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
      var blogs = character.ok ? labeledBlogs(character, true) : [];
      var span = Math.max(1, blogs.length);
      var nameCell = h("th", { scope: "row" }, character.ok ? character.name : "파싱 오류");
      if (span > 1) nameCell.rowSpan = span;
      if (!blogs.length) {
        body.appendChild(h("tr", null, nameCell, h("td", { text: "없음" }), h("td", { class: "num", text: "—" }), h("td", { class: "num", text: "—" }), h("td", { class: "num", text: "—" }), h("td", { class: "num", text: "—" })));
        return;
      }
      blogs.forEach(function (entry, index) {
        var blog = entry.blog;
        var cells = [
          h("td", null, h("span", { class: "stats-platform" },
            entry.label,
            blog.paused ? pausedMark() : null
          )),
          countCell(blog, "today"),
          countCell(blog, "total"),
          countCell(blog, "posts"),
          countCell(blog, "comments")
        ];
        if (index === 0) body.appendChild(h("tr", null, nameCell, cells));
        else body.appendChild(h("tr", null, cells));
      });
    });
    table.appendChild(body);
    host.replaceChildren(h("div", { class: "stats-table-wrap" }, table));
  }

  function renderChart(options) {
    window.BotDashChart.render(options);
  }

  function holdWrap(id) {
    var wrap = document.getElementById(id);
    if (!wrap) return;
    wrap.hidden = false;
    wrap.classList.add("is-pending");
    wrap.setAttribute("aria-busy", "true");
  }

  function clearChartRise() {
    if (state.chartRiseTimer) {
      clearTimeout(state.chartRiseTimer);
      state.chartRiseTimer = 0;
    }
    state.chartRiseUntil = 0;
    state.chartRisePending = false;
  }

  function holdChart() {
    clearChartRise();
    ["chartEmpty", "totalChartEmpty", "monthChartEmpty", "shareChartEmpty"].forEach(function (id) {
      var empty = document.getElementById(id);
      if (empty) empty.hidden = true;
    });
    holdWrap("chartWrap");
    holdWrap("totalChartWrap");
    holdWrap("monthChartWrap");
    holdWrap("shareChartWrap");
    ["chart", "totalChart", "monthChart", "shareChart"].forEach(function (key) {
      if (state[key] && state[key].destroy) {
        state[key].destroy();
        state[key] = null;
      }
    });
  }

  function releaseChartWrap(id) {
    var wrap = document.getElementById(id);
    if (!wrap) return;
    wrap.classList.remove("is-pending");
    wrap.removeAttribute("aria-busy");
  }

  function showChart(options) {
    if (countsPending()) {
      holdChart();
      return;
    }
    var forced = !!(options && (options.replay || options.rise));
    if (!forced && state.chartRiseUntil && Date.now() < state.chartRiseUntil) {
      state.chartRisePending = true;
      return;
    }
    var firstRise = !state.chart || !state.totalChart || forced;
    releaseChartWrap("chartWrap");
    releaseChartWrap("totalChartWrap");
    releaseChartWrap("monthChartWrap");
    releaseChartWrap("shareChartWrap");
    renderChart({ metric: "today", replay: options && options.replay, rise: options && options.rise });
    renderChart({ metric: "total", replay: options && options.replay, rise: options && options.rise });
    window.BotDashChart.renderMonth({ replay: options && options.replay, rise: options && options.rise });
    window.BotDashChart.renderShare({ replay: options && options.replay, rise: options && options.rise });
    if (!firstRise || reducedMotion) return;
    state.chartRiseUntil = Date.now() + 1000;
    if (state.chartRiseTimer) clearTimeout(state.chartRiseTimer);
    state.chartRiseTimer = setTimeout(function () {
      state.chartRiseTimer = 0;
      state.chartRiseUntil = 0;
      if (!state.chartRisePending) return;
      state.chartRisePending = false;
      showChart();
    }, 1040);
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
    if (!stats && window.BotDashChart && window.BotDashChart.resizeWeeks) {
      requestAnimationFrame(function () { window.BotDashChart.resizeWeeks(); });
    }
    if (!stats) requestAnimationFrame(function () { latestSnap(); });
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
      var dailyBlogs = 0;
      var pending = false;
      blogs.forEach(function (blog) {
        var data = state.blogCounts[countableBlogUrl(blog.url)];
        if (!data || data.status === "loading") {
          pending = true;
          return;
        }
        // 어제 마감 페이지뷰가 없는 Blogger는 오늘 합에서 뺀다.
        if (!omitsDailyVisitors(data)) {
          dailyBlogs += 1;
          if (data.status === "ok" && data.today != null) {
            todaySum += data.today;
            todayKnown += 1;
          }
        }
        if (data.status === "ok" && data.total != null) {
          totalSum += data.total;
          totalKnown += 1;
        }
      });
      // 블로그가 남아 있으면 합이 아직 아니다. 그 칸은 스켈레톤으로 둔다.
      if (pending) return;
      character.todayVisitors = todayKnown > 0 ? todaySum : null;
      character.totalVisitors = totalKnown > 0 ? totalSum : null;
      character.visitorPartial = todayKnown < dailyBlogs || totalKnown < blogs.length;
    });
  }

  function paintVisitorFigures() {
    syncLiveVisitors();
    renderMetrics();
    updateCounts();
    document.querySelectorAll("[data-character]").forEach(function (card) {
      var character = findById(card.getAttribute("data-character"));
      if (!character || !character.ok) return;
      card.querySelectorAll("[data-visitor-blog]").forEach(function (block) {
        applyVisitorBlog(block, block.getAttribute("data-visitor-blog"));
      });
      var pendingCard = characterLivePending(character);
      clearVisitorLevel(card);
      card.classList.add("is-" + (pendingCard ? "unknown" : visitorLevel(character.todayVisitors)));
      card.classList.toggle("is-drop", !pendingCard && isBigDrop(character));
    });
    document.querySelectorAll("[data-delta]").forEach(function (node) {
      var character = findById(node.getAttribute("data-delta"));
      if (character) paintDelta(node, character);
    });
    document.querySelectorAll("[data-partial]").forEach(function (el) {
      paintPartial(el, findById(el.getAttribute("data-partial")));
    });
    document.querySelectorAll("[data-stat-today]").forEach(function (el) {
      var character = findById(el.getAttribute("data-stat-today"));
      if (!character) return;
      if (characterLivePending(character)) paintPendingValue(el, "sk-visitor");
      else {
        fadeCount(el);
        el.removeAttribute("aria-busy");
        showHostedCount(el, character.todayVisitors);
      }
    });
    document.querySelectorAll("[data-stat-total]").forEach(function (el) {
      var character = findById(el.getAttribute("data-stat-total"));
      if (!character) return;
      if (characterLivePending(character)) paintPendingValue(el, "sk-total");
      else {
        fadeCount(el);
        el.removeAttribute("aria-busy");
        showHostedCount(el, character.totalVisitors);
      }
    });
  }

  // 세션이 확인되면 본문을 연다. 아직 없는 숫자만 칸 스켈레톤으로 남긴다.
  function revealDashboard() {
    if (!document.body.classList.contains("is-booting")) return;
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
  }

  // 이 블로그 값만 본다. 다른 블로그가 아직이어도 저장해 둔 숫자는 그대로 둔다.
  function blogCountLoading(key) {
    if (!key) return false;
    var data = state.blogCounts[key];
    return !data || data.status === "loading";
  }

  // 헤더 합, 필터 수, 통계 그래프는 아직 값이 없는 블로그가 있으면 기다린다.
  function countsBlockPaint() {
    if (document.body.dataset.page === "detail") {
      var params = new URLSearchParams(location.search);
      var character = findById(params.get("id") || "");
      return !!(character && characterLivePending(character));
    }
    return countsPending();
  }

  function cardsById(grid) {
    var byId = {};
    grid.querySelectorAll("article.card[data-character]").forEach(function (card) {
      byId[card.getAttribute("data-character")] = card;
    });
    return byId;
  }

  function sameCardSet(byId, list) {
    var seen = 0;
    var id;
    for (id in byId) {
      if (Object.prototype.hasOwnProperty.call(byId, id)) seen += 1;
    }
    if (seen !== list.length) return false;
    for (var i = 0; i < list.length; i++) {
      if (!byId[list[i].id]) return false;
    }
    return true;
  }

  function sameCardOrder(grid, list) {
    var cards = grid.querySelectorAll("article.card[data-character]");
    if (cards.length !== list.length) return false;
    for (var i = 0; i < list.length; i++) {
      if (cards[i].getAttribute("data-character") !== list[i].id) return false;
    }
    return true;
  }

  function applyLiveCounts(key) {
    syncLiveVisitors();
    if (countsBlockPaint()) return;
    var grid = document.getElementById("cardGrid");
    var rebuiltStats = false;
    if (grid) {
      var list = visibleCharacters();
      var byId = cardsById(grid);
      // 보이는 캐릭터가 늘거나 줄면 칸을 다시 그린다. 순서만 바뀌면 있는 칸을 옮긴다.
      if (!sameCardSet(byId, list)) {
        markCountChecked();
        render();
        return;
      }
      // 저장 순서와 같으면 칸을 움직이지 않는다. 합이 바뀌어 순위가 달라질 때만 옮긴다.
      if (!sameCardOrder(grid, list)) {
        var beforePlaces = snapshotCardPlaces(grid);
        state.cardMoving = true;
        clearFadeMarks(grid);
        list.forEach(function (character) { grid.appendChild(byId[character.id]); });
        playCardMove(grid, beforePlaces);
        if (state.view === "stats") {
          renderStatsTable();
          rebuiltStats = true;
        }
      }
    }
    if (state.view === "stats") {
      if (!rebuiltStats) paintStatsCells();
      showChart();
    }
    paintVisitorFigures();
    paintBlogCounts(null);
    renderWeekCharts();
    markCountChecked();
    markCountsShown();
    rememberSortOrder();
    revealDashboard();
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
    requestBlogCounts();
    syncLiveVisitors();
    renderNotice();
    renderMetrics();
    updateCounts();
    var visible = visibleCharacters();
    renderGrid(visible, options);
    syncView();
    renderWeekCharts();
    if (state.view === "stats") {
      renderStatsTable();
      showChart();
    }
    var info = document.getElementById("resultInfo");
    if (info) info.textContent = "표시 중 " + visible.length + "개";
    if (options && options.refreshModal && state.modalOpen && state.activeId) {
      var current = findById(state.activeId);
      var body = document.getElementById("modalBody");
      if (!current) closeModal();
      else if (body) body.replaceChildren(buildDetailView(current));
    }
    rememberSortOrder();
    markCountsShown();
    revealDashboard();
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
      if (characterLivePending(character)) paintPendingValue(dd, pair[2] === "data-stat-today" ? "sk-visitor" : "sk-total");
      else setHostedOdometer(dd, pair[1]);
      grid.appendChild(h("div", null, h("dt", { text: pair[0] }), dd));
    });
    var nodes = [grid, partialHost(character), deltaNode(character), h("h3", { text: "소개" }), h("p", { class: "intro", text: character.intro || "소개가 없습니다." })];
    nodes.forEach(function (node) { if (node) panel.appendChild(node); });
    var meta = h("dl", { class: "meta-list" });
    var birthText = formatBirth(character.birthdate);
    var birthValue = birthText
      ? h("dd", null, h("time", { datetime: character.birthdate, text: birthText }))
      : h("dd", { text: "—" });
    meta.appendChild(h("div", null, h("dt", { text: "생년월일" }), birthValue));
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
    var blogs = labeledBlogs(character, false);
    if (!blogs.length) {
      panel.appendChild(h("p", { text: "등록된 블로그가 없습니다." }));
      return panel;
    }
    var list = h("ul", { class: "link-list" });
    blogs.forEach(function (entry) {
      var blog = entry.blog;
      var href = safeUrl(blog.url || "");
      var item = h("li", null, h("strong", { class: "blog-platform" },
        platformIcon(blog.platform),
        h("span", { class: "platform-name", text: entry.label }),
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
          birthLine(character),
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
    if (refresh) {
      refresh.disabled = loading;
      var mark = refresh.querySelector("i");
      if (mark) mark.classList.toggle("fa-spin", loading);
    }
    var exp = document.getElementById("exportBtn");
    if (exp) exp.disabled = loading || !state.ready;
    var grid = document.getElementById("cardGrid");
    if (grid) grid.setAttribute("aria-busy", loading ? "true" : "false");
  }

  async function loadAndRender() {
    if (state.loading) return;
    state.countRefreshGen += 1;
    state.blogCounts = {};
    state.countRefreshBusy = false;
    state.countIconHold = true;
    state.loading = true;
    setLoading(true);
    syncCountReloadSpin();
    if (state.ready) {
      seedCachedCounts();
      paintLivePlaceholders();
    }
    try {
      if (typeof CharacterParser === "undefined") throw new Error("parser.js를 불러오지 못했습니다.");
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
    try { await warmThumbs(thumbKeysFor(state.characters)); } catch (error) {}
    render({ refreshModal: true, rebuildCards: true });
    releaseCountIconHold();
    refreshThumbs();
    paintLatestAvatars();
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
      window.scrollTo(0, 0);
      if (state.view === "stats") {
        renderStatsTable();
        showChart(enteredStats ? { replay: true, rise: true } : null);
      } else {
        rememberCardPlaces();
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

  function bindStickyOffset() {
    var bar = document.querySelector(".topbar");
    if (!bar) return;
    function apply() {
      document.documentElement.style.setProperty("--topbar-h", bar.getBoundingClientRect().height + "px");
    }
    apply();
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(apply).observe(bar);
    else window.addEventListener("resize", apply);
  }

  function bindDashboard() {
    bindStickyOffset();
    bindToolsToggle();
    bindViewTabs();
    watchCardColumns();
    document.getElementById("logoutBtn").addEventListener("click", logoutUser);
    var refreshBtn = document.getElementById("refreshBtn");
    if (refreshBtn) refreshBtn.addEventListener("click", loadAndRender);
    var topRefresh = document.getElementById("topRefreshBtn");
    if (topRefresh) topRefresh.addEventListener("click", function () { location.reload(); });
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

  // 최근 글. 한 쪽에 보이는 개수는 필터에 저장하고, 데스크톱과 모바일은 따로다. 기본은 5개와 3개.
  // 처음 두 쪽을 받고, 다음 쪽으로 넘어갈 때 한 쪽을 더 받는다.
  var LATEST_SIZE_MAX = 10;
  var LATEST_PAGE_MS = 600;
  // 새 페이지가 도착한 뒤에 스켈레톤을 유지하는 시간.
  var LATEST_SKELETON_MS = 500;
  // 접힌 티커가 다음 글로 넘어가는 데 걸리는 시간.
  var LATEST_TICKER_MS = 1100;
  var LATEST_TICKER_EASE = "cubic-bezier(0.76, 0, 0.24, 1)";
  // 접힌 뉴스 티커가 한 글을 보여 주는 시간은 이 값의 절반이다.
  var LATEST_TICKER_HOLD = 9000;
  // 접힌 뉴스 티커는 최근 글 5개만 돈다.
  var LATEST_TICKER_KEEP = 5;
  var latest = {
    posts: [],
    more: true,
    loading: false,
    error: "",
    moreError: false,
    gen: 0,
    bound: false,
    pageSize: 5,
    index: 0,
    announced: -1,
    timer: 0,
    resizeTimer: 0,
    jumping: false,
    scrollAnim: 0,
    tickerIndex: 0,
    tickerTimer: 0,
    tickerBusy: false,
    tickerReady: false,
    tickerFadePending: false,
    closeTimer: 0,
    revealFrom: -1,
    skeletonHoldUntil: 0,
    pendingReveal: null,
    sizeMotion: 0
  };

  function latestStoredSize(mobile) {
    var raw = parseInt(storageGet(mobile ? STORAGE.latestSizeMobile : STORAGE.latestSize), 10);
    if (raw >= 1 && raw <= LATEST_SIZE_MAX) return raw;
    return mobile ? 3 : 5;
  }

  function latestPageSize() {
    return latestStoredSize(isMobileView());
  }

  function clearLatestBodySize() {
    var body = document.getElementById("latestBody");
    if (!body) return;
    body.style.height = "";
    body.style.overflow = "";
    body.style.transition = "";
  }

  // 개수가 바뀌면 목록 높이가 카드 자리 이동과 같은 시간으로 늘거나 줄어든다.
  function withLatestHeight(apply) {
    var body = document.getElementById("latestBody");
    var section = document.getElementById("latestPosts");
    var animate = !!(body && section && !reducedMotion
      && !section.classList.contains("is-collapsed")
      && !section.classList.contains("is-opening")
      && !section.classList.contains("is-closing"));
    var start = animate ? body.getBoundingClientRect().height : 0;
    apply();
    if (!animate) return;
    var end = body.getBoundingClientRect().height;
    if (Math.abs(end - start) < 1) return;
    latest.sizeMotion += 1;
    var motion = latest.sizeMotion;
    var finished = false;
    function done(event) {
      if (finished || motion !== latest.sizeMotion) return;
      if (event && event.target !== body) return;
      if (event && event.propertyName && event.propertyName !== "height") return;
      finished = true;
      clearLatestBodySize();
      body.removeEventListener("transitionend", done);
    }
    body.style.overflow = "hidden";
    body.style.height = start + "px";
    void body.offsetHeight;
    body.style.transition = "height 0.45s ease";
    body.style.height = end + "px";
    body.addEventListener("transitionend", done);
    setTimeout(done, 520);
  }

  function applyCurrentLatestSize() {
    if (latest.loading && !latest.posts.length) {
      withLatestHeight(function () { loadLatestPosts(); });
      return;
    }
    var next = latestPageSize();
    var gap = next - latest.posts.length;
    if (gap > 0 && latest.posts.length && latest.more && !latest.loading) {
      var gen = latest.gen;
      latest.loading = true;
      fetchLatest(latest.posts.length, Math.min(30, gap)).then(function (data) {
        if (gen !== latest.gen) return;
        latestAdd(data.posts);
        latest.loading = false;
        latest.more = !!(data.more && data.posts.length);
        withLatestHeight(function () { latestRegroup(); });
      }).catch(function () {
        if (gen !== latest.gen) return;
        latest.loading = false;
        withLatestHeight(function () { latestRegroup(); });
      });
      return;
    }
    withLatestHeight(function () { latestRegroup(); });
  }

  function bindLatestSize() {
    [
      ["latestSizeDesktop", false],
      ["latestSizeMobile", true]
    ].forEach(function (pair) {
      var select = document.getElementById(pair[0]);
      if (!select) return;
      select.addEventListener("change", function () {
        var next = parseInt(select.value, 10);
        if (!(next >= 1 && next <= LATEST_SIZE_MAX)) {
          select.value = String(latestStoredSize(pair[1]));
          return;
        }
        storageSet(pair[1] ? STORAGE.latestSizeMobile : STORAGE.latestSize, String(next));
        if (pair[1] !== isMobileView()) return;
        document.documentElement.setAttribute("data-latest-boot", String(next));
        applyCurrentLatestSize();
      });
    });
  }

  function latestPageCount(count, pageSize) {
    if (!pageSize || count < 1) return 0;
    return Math.ceil(count / pageSize);
  }

  function latestFetchLimit(loaded, pageSize) {
    if (loaded < 1) return pageSize * 2;
    return pageSize;
  }

  function latestCanLoadMore() {
    return !!(latest.more && !latest.loading && !latest.moreError && latest.posts.length);
  }

  function latestOnLastPage() {
    var track = document.getElementById("latestTrack");
    if (!track || !latest.posts.length) return false;
    var index = latest.jumping ? (latest.index || 0) : latestPageIndex();
    var dataPages = latestPageCount(latest.posts.length, latest.pageSize);
    return index >= dataPages - 1 && index >= track.children.length - 1;
  }

  function decodeTitle(text) {
    var value = String(text || "");
    if (value.indexOf("&") === -1) return value;
    var el = document.createElement("textarea");
    for (var i = 0; i < 3; i++) {
      el.innerHTML = value.replace(/</g, "&lt;");
      var next = el.value;
      if (next === value) return value;
      value = next;
      if (value.indexOf("&") === -1) return value;
    }
    return value;
  }

  function postWhen(iso, now) {
    var then = Date.parse(iso);
    if (!isFinite(then)) return "";
    var diff = (typeof now === "number" ? now : Date.now()) - then;
    if (diff < 60000) return "방금 전";
    var mins = Math.floor(diff / 60000);
    if (mins < 60) return mins + "분 전";
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + "시간 전";
    var seoul = new Date(then + 9 * 60 * 60 * 1000);
    function two(n) { return (n < 10 ? "0" : "") + n; }
    return seoul.getUTCFullYear() + "-" + two(seoul.getUTCMonth() + 1) + "-" + two(seoul.getUTCDate());
  }

  function latestPageIndex() {
    var frame = document.getElementById("latestViewport");
    if (!frame || frame.clientWidth < 1) return latest.index || 0;
    return Math.max(0, Math.round(frame.scrollLeft / frame.clientWidth));
  }

  function latestPlatformLabel(post) {
    var character = findById(post.characterId);
    if (!character || !character.ok) return post.platform || "블로그";
    var want = countableBlogUrl(post.blog);
    var rows = labeledBlogs(character, true);
    for (var i = 0; i < rows.length; i++) {
      if (want && countableBlogUrl(rows[i].blog.url) === want) return rows[i].label;
    }
    return post.platform || "블로그";
  }

  // 사진이 오기 전에는 기본 이미지를 그리지 않는다. 스켈레톤을 유지하다가 받은 사진만 연다.
  function bindLatestAvatar(img, character) {
    var slot = img.parentElement && img.parentElement.classList.contains("latest-avatar-slot") ? img.parentElement : img;
    slot.classList.add("is-pending");
    var sources = [];
    if (character && character.ok) {
      blogPhotoSources(character).forEach(function (source) {
        if (!source || !source.thumb) return;
        var key = isProfileThumb(source.thumb) ? source.thumb : "";
        var saved = key && state.thumbs[key];
        if (saved && saved.url) sources.push({ src: saved.url, key: key });
        sources.push({ src: source.thumb, key: key });
      });
      if (character.image) {
        var local = resolveImage(character.image);
        if (local && local !== DASHBOARD_CONFIG.defaultImage) sources.push({ src: local, key: "" });
      }
    }
    var index = 0;
    var fallback = DASHBOARD_CONFIG.defaultImage;
    function show(src, key) {
      if (key) img.setAttribute("data-thumb-key", key);
      else img.removeAttribute("data-thumb-key");
      img.src = src;
    }
    function reveal() {
      slot.classList.remove("is-pending");
    }
    function useFallback() {
      img.onload = function () { reveal(); };
      img.onerror = function () {
        img.onerror = null;
        reveal();
      };
      show(fallback, "");
      if (img.complete && img.naturalWidth > 0) reveal();
    }
    img.onload = function () {
      if (img.naturalWidth > 0) reveal();
    };
    img.onerror = function () {
      index += 1;
      if (index < sources.length) {
        show(sources[index].src, sources[index].key);
        return;
      }
      useFallback();
    };
    if (!sources.length) {
      useFallback();
      return;
    }
    show(sources[0].src, sources[0].key);
    if (img.complete && img.naturalWidth > 0) reveal();
  }

  function latestAvatar(character, ticker) {
    var size = ticker ? "20" : "28";
    var img = h("img", {
      class: ticker ? "latest-ticker-avatar" : "latest-avatar",
      alt: "",
      width: size,
      height: size,
      draggable: "false"
    });
    h("span", { class: "latest-avatar-slot is-pending", "aria-hidden": "true" }, img);
    if ((character && character.ok) || state.ready) bindLatestAvatar(img, character && character.ok ? character : null);
    return img.parentElement;
  }

  function paintLatestAvatars() {
    document.querySelectorAll(".latest-item[data-latest-character], .latest-ticker-row[data-latest-character]").forEach(function (row) {
      if (row.getAttribute("data-latest-ready") === "1") return;
      var character = findById(row.getAttribute("data-latest-character"));
      var img = row.querySelector(".latest-avatar, .latest-ticker-avatar");
      if (!character || !character.ok) {
        if (!state.ready) return;
        row.setAttribute("data-latest-ready", "1");
        if (img) bindLatestAvatar(img, null);
        return;
      }
      row.setAttribute("data-latest-ready", "1");
      if (img) bindLatestAvatar(img, character);
      var name = row.querySelector(".latest-platform-name");
      if (name) {
        name.textContent = latestPlatformLabel({
          characterId: character.id,
          blog: row.getAttribute("data-latest-blog") || "",
          platform: row.getAttribute("data-latest-kind") || ""
        });
      }
    });
  }

  function tickLatestTimes() {
    var clock = Date.now();
    document.querySelectorAll("time[data-published]").forEach(function (node) {
      node.textContent = postWhen(node.getAttribute("data-published"), clock);
    });
  }

  function latestItem(post) {
    var character = findById(post.characterId);
    var known = !!(character && character.ok);
    var href = safeUrl(post.url);
    var title = href
      ? h("a", { class: "latest-link", href: href, target: "_blank", rel: "noopener noreferrer" }, post.title, h("span", { class: "sr-only", text: " (새 탭)" }))
      : h("span", { class: "latest-link", text: post.title });
    return h("article", {
      class: "latest-item",
      "data-latest-character": post.characterId || "",
      "data-latest-blog": post.blog || "",
      "data-latest-kind": post.platform || "",
      "data-latest-ready": known || state.ready ? "1" : "0"
    },
      latestAvatar(character, false),
      h("span", { class: "latest-platform", "data-latest-platform": post.platform || "" },
        platformIcon(post.platform),
        h("span", { class: "latest-platform-name sr-only", text: latestPlatformLabel(post) })
      ),
      title,
      h("time", { class: "latest-time", datetime: post.published || "", "data-published": post.published || "", text: postWhen(post.published, Date.now()) })
    );
  }

  function latestSkeletonPage() {
    var page = h("div", { class: "latest-page", "aria-busy": "true", "aria-label": "게시물을 불러오는 중" });
    for (var i = 0; i < latest.pageSize; i++) {
      page.appendChild(h("div", { class: "latest-item is-skel", "aria-hidden": "true" },
        h("span", { class: "skeleton latest-sk-avatar" }),
        h("span", { class: "latest-sk-lines" },
          h("span", { class: "skeleton latest-sk-line" }),
          h("span", { class: "skeleton latest-sk-line short" })
        )
      ));
    }
    return page;
  }

  function latestMessagePage(message, retry) {
    var page = h("div", { class: "latest-page" });
    var row = h("p", { class: "latest-empty", text: message });
    if (retry) {
      row.appendChild(document.createTextNode(" "));
      row.appendChild(h("button", {
        type: "button",
        class: "latest-retry",
        "data-latest-retry": latest.posts.length ? "more" : "reset",
        text: "다시 시도"
      }));
    }
    page.appendChild(row);
    return page;
  }

  function latestDataPage(posts, number, reveal) {
    var page = h("div", { class: "latest-page" + (reveal ? " is-reveal" : ""), role: "group", "aria-label": "최근 게시물 " + number + "쪽" });
    posts.forEach(function (post) { page.appendChild(latestItem(post)); });
    return page;
  }

  function latestShownIndex() {
    if (latest.jumping) return latest.index || 0;
    return latestPageIndex();
  }

  function latestPageText() {
    var track = document.getElementById("latestTrack");
    var total = track ? track.children.length : 0;
    var index = latestShownIndex();
    if (total < 1) return "1 / 1";
    return (index + 1) + " / " + total;
  }

  function syncLatestNav() {
    var prev = document.getElementById("latestPrev");
    var next = document.getElementById("latestNext");
    var track = document.getElementById("latestTrack");
    var label = document.getElementById("latestPage");
    if (!prev || !next || !track) return;
    var index = latestShownIndex();
    var max = Math.max(0, track.children.length - 1);
    prev.disabled = index <= 0;
    next.disabled = index >= max && !latest.more;
    if (label) label.textContent = latestPageText();
  }

  function announceLatest() {
    var status = document.getElementById("latestStatus");
    if (!status) return;
    if (latest.loading && latest.posts.length) {
      if (latest.announced === -2) return;
      latest.announced = -2;
      status.textContent = "다음 게시물을 불러오는 중";
      return;
    }
    var pages = latestPageCount(latest.posts.length, latest.pageSize);
    if (!pages) return;
    var index = latestShownIndex();
    if (index === latest.announced) return;
    latest.announced = index;
    status.textContent = "최근 게시물 " + latestPageText();
  }

  function renderLatest() {
    var section = document.getElementById("latestPosts");
    var track = document.getElementById("latestTrack");
    var frame = document.getElementById("latestViewport");
    if (!section || !track || !frame) return;
    var left = frame.scrollLeft;
    var pages = [];
    if (!latest.posts.length) {
      pages.push(latest.loading ? latestSkeletonPage() : latestMessagePage(latest.error || "최근 게시물을 찾지 못했습니다.", !!latest.error));
    } else {
      var size = latest.pageSize;
      var revealIndex = latest.revealFrom >= 0 ? Math.floor(latest.revealFrom / size) : -1;
      latest.revealFrom = -1;
      for (var i = 0; i < latest.posts.length; i += size) {
        var pageIndex = Math.floor(i / size);
        pages.push(latestDataPage(latest.posts.slice(i, i + size), pageIndex + 1, pageIndex === revealIndex));
      }
      if (latest.loading) pages.push(latestSkeletonPage());
      else if (latest.moreError) pages.push(latestMessagePage("다음 게시물을 불러오지 못했습니다.", true));
    }
    track.replaceChildren.apply(track, pages);
    latestFitPageWidths();
    if (left) frame.scrollLeft = left;
    section.setAttribute("aria-busy", latest.loading ? "true" : "false");
    section.classList.toggle("is-loading", !!(latest.loading && !latest.posts.length));
    syncLatestNav();
    syncLatestTicker();
  }

  function latestAdd(items) {
    var seen = {};
    latest.posts.forEach(function (post) { seen[post.url] = true; });
    items.forEach(function (post) {
      if (!post || !post.url || seen[post.url]) return;
      seen[post.url] = true;
      latest.posts.push(post);
    });
  }

  function fetchLatest(offset, limit) {
    return fetch("posts.php?offset=" + offset + "&limit=" + limit, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Accept": "application/json" }
    }).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    }).then(function (data) {
      var posts = data && Array.isArray(data.posts) ? data.posts : [];
      posts = posts.filter(function (post) {
        return post && typeof post.title === "string" && post.title && safeUrl(post.url);
      }).map(function (post) {
        return {
          characterId: String(post.characterId || ""),
          name: String(post.name || ""),
          platform: String(post.platform || ""),
          blog: String(post.blog || ""),
          title: decodeTitle(String(post.title)),
          url: safeUrl(post.url),
          published: String(post.published || "")
        };
      });
      return { posts: posts, more: !!(data && data.more) && posts.length > 0 };
    });
  }

  function loadLatestPosts() {
    var section = document.getElementById("latestPosts");
    if (!section) return;
    latest.gen += 1;
    var gen = latest.gen;
    latest.posts = [];
    latest.more = true;
    latest.error = "";
    latest.moreError = false;
    latest.loading = true;
    latest.pageSize = latestPageSize();
    latest.announced = -1;
    latest.tickerReady = false;
    latest.tickerFadePending = false;
    renderLatest();
    fetchLatest(0, latestFetchLimit(0, latest.pageSize)).then(function (data) {
      if (gen !== latest.gen) return;
      latest.loading = false;
      latest.posts = data.posts;
      latest.more = data.more;
      renderLatest();
      onLatestSettle();
    }).catch(function () {
      if (gen !== latest.gen) return;
      latest.loading = false;
      latest.more = false;
      latest.error = "게시물을 불러오지 못했습니다.";
      renderLatest();
    });
  }

  function latestHoldSkeleton(apply) {
    if (!latest.skeletonHoldUntil) {
      latest.pendingReveal = apply;
      return;
    }
    var wait = Math.max(0, latest.skeletonHoldUntil - Date.now());
    setTimeout(apply, wait);
  }

  function latestMarkPageArrived() {
    if (latest.skeletonHoldUntil || (!latest.loading && !latest.pendingReveal)) return;
    var frame = document.getElementById("latestViewport");
    var track = document.getElementById("latestTrack");
    if (!frame || !track || frame.clientWidth < 1) return;
    var index = Math.max(0, Math.round(frame.scrollLeft / frame.clientWidth));
    var page = track.children[index];
    if (!page || !page.querySelector(".is-skel")) return;
    latest.skeletonHoldUntil = Date.now() + LATEST_SKELETON_MS;
    if (!latest.pendingReveal) return;
    var apply = latest.pendingReveal;
    latest.pendingReveal = null;
    setTimeout(apply, LATEST_SKELETON_MS);
  }

  function latestFitPageWidths() {
    var frame = document.getElementById("latestViewport");
    var track = document.getElementById("latestTrack");
    if (!frame || !track || frame.clientWidth < 1) return;
    var width = frame.clientWidth + "px";
    for (var i = 0; i < track.children.length; i++) {
      var page = track.children[i];
      if (page.style.width === width && page.style.flexBasis === width) continue;
      page.style.width = width;
      page.style.flexBasis = width;
    }
  }

  function latestAppendSkeleton() {
    var track = document.getElementById("latestTrack");
    if (!track) return;
    var last = track.lastElementChild;
    if (last && last.getAttribute("aria-busy") === "true") return;
    track.appendChild(latestSkeletonPage());
    latestFitPageWidths();
  }

  function loadLatestMore() {
    if (!latestCanLoadMore()) return false;
    var gen = latest.gen;
    var offset = latest.posts.length;
    var limit = latestFetchLimit(offset, latest.pageSize);
    latest.skeletonHoldUntil = 0;
    latest.pendingReveal = null;
    latest.loading = true;
    latest.moreError = false;
    latestAppendSkeleton();
    announceLatest();
    fetchLatest(offset, limit).then(function (data) {
      latestHoldSkeleton(function () {
        if (gen !== latest.gen) return;
        var before = latest.posts.length;
        latestAdd(data.posts);
        latest.loading = false;
        latest.more = latest.posts.length > before && data.more;
        if (latest.posts.length > before) latest.revealFrom = before;
        renderLatest();
        onLatestSettle();
      });
    }).catch(function () {
      latestHoldSkeleton(function () {
        if (gen !== latest.gen) return;
        latest.loading = false;
        latest.moreError = true;
        renderLatest();
      });
    });
    return true;
  }

  function onLatestSettle() {
    if (latest.jumping) return;
    var frame = document.getElementById("latestViewport");
    if (frame && (frame.classList.contains("is-dragging") || frame.classList.contains("is-paging"))) return;
    if (frame && frame.clientWidth >= 1) latest.index = Math.max(0, Math.round(frame.scrollLeft / frame.clientWidth));
    syncLatestNav();
    announceLatest();
    latestMarkPageArrived();
  }

  function refreshLatestPosts() {
    var section = document.getElementById("latestPosts");
    if (!section || latest.loading) return;
    var gen = latest.gen;
    var size = latest.pageSize || latestPageSize();
    var want = Math.max(latest.posts.length, latestFetchLimit(0, size));
    var anchor = "";
    if (latest.posts.length) {
      var at = latestPageIndex() * size;
      if (latest.posts[at]) anchor = latest.posts[at].url;
    }
    var collected = [];
    var more = true;
    function step() {
      var limit = Math.min(30, want - collected.length);
      if (limit < 1) return Promise.resolve({ posts: collected, more: more });
      return fetchLatest(collected.length, limit).then(function (data) {
        if (gen !== latest.gen) return null;
        data.posts.forEach(function (post) { collected.push(post); });
        more = data.more;
        if (!more || collected.length >= want) return { posts: collected, more: more };
        return step();
      });
    }
    step().then(function (data) {
      if (!data || gen !== latest.gen || latest.loading) return;
      latest.posts = data.posts;
      latest.more = data.more;
      latest.error = "";
      latest.moreError = false;
      renderLatest();
      paintLatestAvatars();
      var frame = document.getElementById("latestViewport");
      if (anchor && frame && frame.clientWidth) {
        var found = -1;
        for (var i = 0; i < latest.posts.length; i++) {
          if (latest.posts[i].url === anchor) { found = i; break; }
        }
        if (found >= 0) {
          latest.index = Math.floor(found / size);
          frame.scrollLeft = latest.index * frame.clientWidth;
        }
      }
      onLatestSettle();
    }).catch(function () {});
  }

  function finishLatestMotion() {
    latest.closeTimer = 0;
    var section = document.getElementById("latestPosts");
    if (!section) return;
    var closing = section.classList.contains("is-closing");
    var host = document.getElementById("latestTicker");
    // 접힘 페이드가 끝난 뒤 tickerIn이 다시 돌거나 티커를 다시 그리면 한 프레임 깜빡인다.
    if (host) host.classList.remove("is-in");
    section.classList.remove("is-opening", "is-closing", "is-open-ready");
    if (!closing) return;
    section.classList.add("is-collapsed");
    document.documentElement.setAttribute("data-latest", "closed");
    latest.tickerFadePending = false;
    if (host && !host.querySelector(".latest-ticker-track") && !latest.tickerBusy) renderLatestTicker();
    scheduleLatestTicker();
  }

  function latestSetOpen(open, persist) {
    var section = document.getElementById("latestPosts");
    var toggle = document.getElementById("latestToggle");
    if (!section || !toggle) return;
    latest.sizeMotion += 1;
    clearLatestBodySize();
    if (latest.closeTimer) {
      clearTimeout(latest.closeTimer);
      latest.closeTimer = 0;
    }
    var fadeClose = !open && persist && !reducedMotion;
    section.classList.toggle("is-collapsed", !open && !fadeClose);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "최근 게시물 접기" : "최근 게시물 펼치기");
    if (open || fadeClose) document.documentElement.removeAttribute("data-latest");
    else document.documentElement.setAttribute("data-latest", "closed");
    section.classList.remove("is-opening", "is-closing", "is-open-ready");
    if (!open) {
      var tickerHost = document.getElementById("latestTicker");
      if (tickerHost) tickerHost.classList.remove("is-in");
    }
    if (persist && !reducedMotion) {
      void section.offsetWidth;
      if (open) {
        section.classList.add("is-opening");
        // 높이가 다 커지기 전, 0.2s 뒤에 목록 페이드를 시작한다.
        latest.closeTimer = setTimeout(function () {
          latest.closeTimer = 0;
          if (!section.classList.contains("is-opening")) return;
          section.classList.add("is-open-ready");
          latest.closeTimer = setTimeout(finishLatestMotion, 300);
        }, 200);
      } else {
        section.classList.add("is-closing");
        latest.closeTimer = setTimeout(finishLatestMotion, 300);
      }
    }
    if (persist) {
      try { localStorage.setItem(STORAGE.latestOpen, open ? "1" : "0"); } catch (error) {}
    }
    if (!open && section.contains(document.activeElement) && document.activeElement !== toggle) toggle.focus();
    if (!fadeClose) {
      syncLatestTicker();
      if (!open && latest.tickerFadePending) fadeLatestTicker();
    }
    if (open) {
      // 티커에 보이던 글이 들어 있는 페이지를 넘김 없이 바로 연다.
      if (latestTickerPosts().length) latest.index = latestPageForTicker();
      var frame = document.getElementById("latestViewport");
      if (frame) void frame.offsetWidth;
      latest.jumping = !frame || frame.clientWidth < 1;
      latestSnap();
      syncLatestNav();
      requestAnimationFrame(function () {
        latestSnap();
        latest.jumping = false;
        syncLatestNav();
        announceLatest();
      });
    }
  }

  function latestScrollTo(frame, left, done, glide) {
    if (latest.scrollAnim) {
      cancelAnimationFrame(latest.scrollAnim);
      latest.scrollAnim = 0;
    }
    if (reducedMotion) {
      frame.classList.remove("is-paging");
      frame.scrollLeft = left;
      if (done) done();
      return;
    }
    var start = frame.scrollLeft;
    var change = left - start;
    if (!change) {
      frame.classList.remove("is-paging");
      if (done) done();
      return;
    }
    frame.classList.add("is-paging");
    var duration = glide && glide.duration ? glide.duration : LATEST_PAGE_MS;
    var began = 0;
    function step(now) {
      if (!began) began = now;
      var progress = Math.min(1, (now - began) / duration);
      var eased = glide
        ? 1 - Math.pow(1 - progress, 3)
        : (progress < 0.5
          ? 8 * progress * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 4) / 2);
      frame.scrollLeft = start + change * eased;
      if (progress < 1) {
        latest.scrollAnim = requestAnimationFrame(step);
        return;
      }
      latest.scrollAnim = 0;
      frame.scrollLeft = left;
      frame.classList.remove("is-paging");
      if (done) done();
    }
    latest.scrollAnim = requestAnimationFrame(step);
  }

  function latestIsClosed() {
    var section = document.getElementById("latestPosts");
    return !!(section && section.classList.contains("is-collapsed"));
  }

  function latestTickerPosts() {
    return latest.posts.slice(0, LATEST_TICKER_KEEP);
  }

  // 접힌 티커에서 지금 보이는 글. 슬라이드가 절반을 넘기면 올라오는 글이다.
  function latestTickerPostIndex() {
    var posts = latestTickerPosts();
    if (!posts.length) return 0;
    var index = latest.tickerIndex % posts.length;
    var host = document.getElementById("latestTicker");
    var track = host && host.querySelector(".latest-ticker-track");
    var row = track && track.firstElementChild;
    if (!track || !row || row.offsetHeight < 1) return index;
    var moved = 0;
    var raw = window.getComputedStyle(track).transform;
    var matched = raw && raw !== "none" ? /matrix(?:3d)?\(([^)]+)\)/.exec(raw) : null;
    if (matched) {
      var parts = matched[1].split(",");
      var translateY = parts.length >= 16 ? parts[13] : parts[5];
      moved = Math.abs(parseFloat(translateY) || 0);
    }
    if (moved >= row.offsetHeight / 2) index = (index + 1) % posts.length;
    return index;
  }

  function latestPageForTicker() {
    var size = latest.pageSize || latestPageSize();
    if (size < 1) return latest.index || 0;
    var count = Math.max(1, Math.ceil(latest.posts.length / size));
    return Math.max(0, Math.min(count - 1, Math.floor(latestTickerPostIndex() / size)));
  }

  function latestTickerRow(post, hidden) {
    var href = safeUrl(post.url);
    var props = {
      class: "latest-ticker-row",
      "data-latest-character": post.characterId || ""
    };
    var tag = "span";
    if (href) {
      tag = "a";
      props.href = href;
      props.target = "_blank";
      props.rel = "noopener noreferrer";
    }
    if (hidden) {
      props["aria-hidden"] = "true";
      props.tabindex = "-1";
    }
    var character = findById(post.characterId);
    var known = !!(character && character.ok);
    if (known || state.ready) props["data-latest-ready"] = "1";
    return h(tag, props,
      latestAvatar(character, true),
      platformIcon(post.platform),
      h("span", { class: "latest-ticker-title", text: post.title }),
      h("time", {
        class: "latest-ticker-time",
        datetime: post.published || "",
        "data-published": post.published || "",
        text: postWhen(post.published, Date.now())
      })
    );
  }

  function latestTickerSkeleton() {
    return h("div", { class: "latest-ticker-window" },
      h("div", { class: "latest-ticker-row is-skel", "aria-hidden": "true" },
        h("span", { class: "skeleton latest-ticker-sk-avatar" }),
        h("span", { class: "skeleton latest-ticker-sk-icon" }),
        h("span", { class: "skeleton latest-ticker-sk-title" }),
        h("span", { class: "skeleton latest-ticker-sk-time" })
      )
    );
  }

  function renderLatestTicker() {
    var host = document.getElementById("latestTicker");
    if (!host) return;
    var posts = latestTickerPosts();
    if (!posts.length) {
      host.classList.remove("is-in");
      if (latest.loading) host.replaceChildren(latestTickerSkeleton());
      else host.replaceChildren();
      return;
    }
    if (latest.tickerIndex >= posts.length) latest.tickerIndex = 0;
    var firstPaint = !latest.tickerReady;
    var windowEl = h("div", { class: "latest-ticker-window" });
    var track = h("div", { class: "latest-ticker-track" });
    var next = (latest.tickerIndex + 1) % posts.length;
    track.appendChild(latestTickerRow(posts[latest.tickerIndex], false));
    track.appendChild(latestTickerRow(posts[next], true));
    windowEl.appendChild(track);
    host.replaceChildren(windowEl);
    if (!firstPaint) return;
    latest.tickerReady = true;
    fadeLatestTicker();
  }

  function fadeLatestTicker() {
    if (reducedMotion) {
      latest.tickerFadePending = false;
      return;
    }
    var host = document.getElementById("latestTicker");
    if (!host || !latestIsClosed()) {
      latest.tickerFadePending = true;
      return;
    }
    latest.tickerFadePending = false;
    host.classList.remove("is-in");
    void host.offsetWidth;
    host.classList.add("is-in");
  }

  function slideLatestTicker(delta, speed) {
    var host = document.getElementById("latestTicker");
    if (!host || latest.tickerBusy || !latestIsClosed()) return false;
    var posts = latestTickerPosts();
    if (posts.length < 2 || !delta) return false;
    var track = host.querySelector(".latest-ticker-track");
    var row = track && track.firstElementChild;
    var distance = row ? row.offsetHeight : 0;
    if (!track || distance < 1) return false;
    var count = posts.length;
    var step = delta > 0 ? 1 : -1;
    var landed = (latest.tickerIndex + step + count) % count;
    clearLatestTickerTimer();
    if (reducedMotion) {
      latest.tickerIndex = landed;
      renderLatestTicker();
      scheduleLatestTicker();
      return true;
    }
    latest.tickerBusy = true;
    var ms = speed || LATEST_TICKER_MS;
    var finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      latest.tickerBusy = false;
      latest.tickerIndex = landed;
      renderLatestTicker();
      scheduleLatestTicker();
    }
    if (step < 0) {
      track.insertBefore(latestTickerRow(posts[landed], true), track.firstElementChild);
      track.style.transition = "none";
      track.style.transform = "translateY(" + (-distance) + "px)";
      void track.offsetWidth;
    }
    track.addEventListener("transitionend", finish);
    setTimeout(finish, ms + 280);
    track.style.transition = "transform " + ms + "ms " + LATEST_TICKER_EASE;
    void track.offsetWidth;
    track.style.transform = step > 0 ? "translateY(" + (-distance) + "px)" : "translateY(0)";
    return true;
  }

  function advanceLatestTicker() {
    var host = document.getElementById("latestTicker");
    if (!host || latest.tickerBusy || !latestIsClosed()) return false;
    if (host.contains(document.activeElement)) return false;
    if (host.matches(":hover") && window.matchMedia("(hover: hover) and (pointer: fine)").matches) return false;
    return slideLatestTicker(1);
  }

  function latestTickerDwell() {
    return Math.max(1, Math.round(LATEST_TICKER_HOLD / 2));
  }

  function clearLatestTickerTimer() {
    if (!latest.tickerTimer) return;
    clearTimeout(latest.tickerTimer);
    latest.tickerTimer = 0;
  }

  function scheduleLatestTicker() {
    if (latest.tickerTimer || latest.tickerBusy) return;
    if (!latestIsClosed() || latestTickerPosts().length < 2) return;
    var host = document.getElementById("latestTicker");
    if (host && host.contains(document.activeElement)) return;
    if (host && host.matches(":hover") && window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    latest.tickerTimer = setTimeout(function () {
      latest.tickerTimer = 0;
      var started = advanceLatestTicker();
      if (!started || reducedMotion) scheduleLatestTicker();
    }, latestTickerDwell());
  }

  function syncLatestTicker() {
    if (!latest.tickerBusy) renderLatestTicker();
    if (!latestIsClosed() || latestTickerPosts().length < 2) {
      clearLatestTickerTimer();
      return;
    }
    if (!latest.tickerBusy) scheduleLatestTicker();
  }

  function latestSnap() {
    var frame = document.getElementById("latestViewport");
    if (!frame || frame.clientWidth < 1) return;
    var max = Math.max(0, frame.querySelectorAll(".latest-page").length - 1);
    var index = Math.max(0, Math.min(max, latest.index || 0));
    latest.index = index;
    frame.scrollLeft = index * frame.clientWidth;
  }

  function latestRegroup() {
    var nextSize = latestPageSize();
    if (!latest.posts.length) {
      if (nextSize !== latest.pageSize && latest.loading) {
        latest.pageSize = nextSize;
        renderLatest();
      } else latest.pageSize = nextSize;
      return;
    }
    if (nextSize === latest.pageSize) {
      latestFitPageWidths();
      latestSnap();
      return;
    }
    var frame = document.getElementById("latestViewport");
    var anchor = latestPageIndex() * latest.pageSize;
    latest.pageSize = nextSize;
    latest.index = Math.floor(anchor / nextSize);
    renderLatest();
    if (frame && frame.clientWidth) frame.scrollLeft = latest.index * frame.clientWidth;
    onLatestSettle();
  }

  function latestPullNext() {
    if (!latestOnLastPage() || !loadLatestMore()) return false;
    var frame = document.getElementById("latestViewport");
    var track = document.getElementById("latestTrack");
    if (!frame || !track) return true;
    var index = Math.max(0, track.children.length - 1);
    latestScrollTo(frame, index * (frame.clientWidth || 1), function () { onLatestSettle(); });
    return true;
  }

  function latestGo(delta) {
    var frame = document.getElementById("latestViewport");
    var track = document.getElementById("latestTrack");
    if (!frame || !track) return;
    var current = latest.jumping ? (latest.index || 0) : latestPageIndex();
    if (delta > 0 && latestOnLastPage()) loadLatestMore();
    track = document.getElementById("latestTrack");
    var max = Math.max(0, track.children.length - 1);
    var index = Math.max(0, Math.min(max, current + delta));
    latest.index = index;
    latest.jumping = true;
    syncLatestNav();
    announceLatest();
    latestScrollTo(frame, index * (frame.clientWidth || 1), function () {
      latest.jumping = false;
      onLatestSettle();
    });
  }

  function suppressNextClick() {
    function stop(event) {
      document.removeEventListener("click", stop, true);
      event.preventDefault();
      event.stopPropagation();
    }
    document.addEventListener("click", stop, true);
    setTimeout(function () { document.removeEventListener("click", stop, true); }, 500);
  }

  function bindLatestTickerSwipe(host) {
    var start = null;
    host.addEventListener("touchstart", function (event) {
      if (event.touches.length !== 1 || latest.tickerBusy) return;
      var touch = event.touches[0];
      start = { x: touch.clientX, y: touch.clientY, moved: false, ignore: false };
      clearLatestTickerTimer();
    }, { passive: true });
    host.addEventListener("touchmove", function (event) {
      if (!start || start.ignore || event.touches.length !== 1) return;
      var touch = event.touches[0];
      var dx = touch.clientX - start.x;
      var dy = touch.clientY - start.y;
      if (!start.moved) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dy) > Math.abs(dx)) {
          start.ignore = true;
          scheduleLatestTicker();
          return;
        }
        start.moved = true;
      }
      if (event.cancelable) event.preventDefault();
    }, { passive: false });
    function end(event) {
      if (!start) return;
      var current = start;
      start = null;
      if (current.ignore || !current.moved) {
        scheduleLatestTicker();
        return;
      }
      suppressNextClick();
      var point = event.changedTouches && event.changedTouches[0];
      var dx = event.type === "touchcancel" || !point ? 0 : point.clientX - current.x;
      if (Math.abs(dx) < 24 || !slideLatestTicker(dx < 0 ? 1 : -1, 420)) scheduleLatestTicker();
    }
    host.addEventListener("touchend", end);
    host.addEventListener("touchcancel", end);
  }

  function bindLatestDrag(frame) {
    var drag = null;
    var touchDrag = null;
    var blockClick = false;
    function pageLimit() {
      return Math.max(0, frame.querySelectorAll(".latest-page").length - 1) * (frame.clientWidth || 1);
    }
    function settleTouch(current, dx, velocity) {
      frame.classList.add("is-paging");
      frame.classList.remove("is-dragging");
      var width = frame.clientWidth || 1;
      var max = Math.max(0, frame.querySelectorAll(".latest-page").length - 1);
      var startPage = Math.max(0, Math.min(max, Math.round(current.left / width)));
      var commit = Math.min(48, width * 0.14);
      var dir = 0;
      if (dx <= -commit || (velocity < -0.4 && dx < -10)) dir = 1;
      else if (dx >= commit || (velocity > 0.4 && dx > 10)) dir = -1;
      var index = dir === 0
        ? Math.max(0, Math.min(max, Math.round(frame.scrollLeft / width)))
        : Math.max(0, Math.min(max, startPage + dir));
      var target = index * width;
      var remain = Math.abs(target - frame.scrollLeft);
      if (remain < 1) {
        frame.classList.remove("is-paging");
        onLatestSettle();
        return;
      }
      // 손을 뗀 뒤의 마지막 구간은 느리게 출발하지 않고 바로 이어져 자리에 앉는다.
      latestScrollTo(frame, target, function () {
        onLatestSettle();
      }, {
        duration: Math.round(Math.max(90, Math.min(420, remain / width * 380)))
      });
    }
    // 터치 스와이프는 pointer 이벤트가 중간에 끊긴다. touchmove에서 직접 넘긴다.
    frame.addEventListener("touchstart", function (event) {
      if (event.touches.length !== 1) {
        touchDrag = null;
        return;
      }
      if (latest.scrollAnim) {
        cancelAnimationFrame(latest.scrollAnim);
        latest.scrollAnim = 0;
        frame.classList.remove("is-paging");
        latest.jumping = false;
      }
      var touch = event.touches[0];
      touchDrag = {
        x: touch.clientX,
        y: touch.clientY,
        left: frame.scrollLeft,
        atEnd: frame.scrollLeft >= frame.scrollWidth - frame.clientWidth - 2,
        moved: false,
        ignore: false,
        armed: false,
        samples: [{ x: touch.clientX, t: event.timeStamp }]
      };
    }, { passive: true });
    frame.addEventListener("touchmove", function (event) {
      if (!touchDrag || touchDrag.ignore || event.touches.length !== 1) return;
      var touch = event.touches[0];
      var dx = touch.clientX - touchDrag.x;
      var dy = touch.clientY - touchDrag.y;
      if (!touchDrag.moved) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dy) > Math.abs(dx)) {
          touchDrag.ignore = true;
          return;
        }
        touchDrag.moved = true;
        frame.classList.add("is-dragging");
        void frame.offsetWidth;
      }
      if (touchDrag.atEnd && !touchDrag.armed && dx < -8) {
        touchDrag.armed = true;
        loadLatestMore();
      }
      var widthNow = frame.clientWidth || 1;
      var origin = Math.round(touchDrag.left / widthNow) * widthNow;
      var next = touchDrag.left - dx;
      if (next < origin - widthNow) next = origin - widthNow;
      if (next > origin + widthNow) next = origin + widthNow;
      if (next < 0) next = 0;
      var limit = pageLimit();
      if (next > limit) next = limit;
      frame.scrollLeft = next;
      touchDrag.samples.push({ x: touch.clientX, t: event.timeStamp });
      if (touchDrag.samples.length > 5) touchDrag.samples.shift();
      if (event.cancelable) event.preventDefault();
    }, { passive: false });
    function endTouch(event) {
      if (!touchDrag) return;
      var current = touchDrag;
      touchDrag = null;
      if (current.ignore || !current.moved) {
        frame.classList.remove("is-dragging");
        return;
      }
      suppressNextClick();
      var point = event.changedTouches && event.changedTouches[0];
      var dx = event.type === "touchcancel" || !point ? 0 : point.clientX - current.x;
      var samples = current.samples;
      var velocity = 0;
      if (event.type !== "touchcancel" && samples.length >= 2) {
        var first = samples[0];
        var last = samples[samples.length - 1];
        velocity = (last.x - first.x) / Math.max(16, last.t - first.t);
      }
      settleTouch(current, dx, velocity);
    }
    frame.addEventListener("touchend", endTouch);
    frame.addEventListener("touchcancel", endTouch);
    frame.addEventListener("pointerdown", function (event) {
      if (event.pointerType === "touch") return;
      if (latest.scrollAnim) {
        cancelAnimationFrame(latest.scrollAnim);
        latest.scrollAnim = 0;
        frame.classList.remove("is-paging");
        latest.jumping = false;
      }
      if (event.button !== 0) return;
      drag = { id: event.pointerId, x: event.clientX, left: frame.scrollLeft, moved: false };
    });
    frame.addEventListener("pointermove", function (event) {
      if (event.pointerType === "touch") return;
      if (!drag || event.pointerId !== drag.id) return;
      var mouseDx = event.clientX - drag.x;
      if (!drag.moved && Math.abs(mouseDx) < 8) return;
      if (!drag.moved) {
        drag.moved = true;
        frame.classList.add("is-dragging");
        if (frame.setPointerCapture) {
          try { frame.setPointerCapture(event.pointerId); } catch (error) {}
        }
      }
      frame.scrollLeft = drag.left - mouseDx;
    });
    function endDrag(event) {
      if (event.pointerType === "touch") return;
      if (!drag || event.pointerId !== drag.id) return;
      var moved = drag.moved;
      var dx = event.clientX - drag.x;
      var startedAtEnd = drag.left >= frame.scrollWidth - frame.clientWidth - 2;
      drag = null;
      frame.classList.remove("is-dragging");
      if (!moved) return;
      blockClick = true;
      var width = frame.clientWidth || 1;
      var max = Math.max(0, frame.querySelectorAll(".latest-page").length - 1);
      var index = Math.max(0, Math.min(max, Math.round(frame.scrollLeft / width)));
      if (dx <= -56 && startedAtEnd && latestPullNext()) return;
      latestScrollTo(frame, index * width, function () { onLatestSettle(); });
    }
    frame.addEventListener("pointerup", endDrag);
    frame.addEventListener("pointercancel", endDrag);
    frame.addEventListener("click", function (event) {
      if (!blockClick) return;
      blockClick = false;
      event.preventDefault();
      event.stopPropagation();
    }, true);
  }

  function bindLatestPosts() {
    var section = document.getElementById("latestPosts");
    var frame = document.getElementById("latestViewport");
    if (!section || !frame || latest.bound) return;
    latest.bound = true;
    latest.pageSize = latestPageSize();
    bindLatestSize();
    var savedOpen = true;
    try { savedOpen = localStorage.getItem(STORAGE.latestOpen) !== "0"; } catch (error) {}
    latestSetOpen(savedOpen, false);
    var toggle = document.getElementById("latestToggle");
    if (toggle) {
      toggle.addEventListener("click", function () {
        latestSetOpen(toggle.getAttribute("aria-expanded") !== "true", true);
      });
    }
    var prev = document.getElementById("latestPrev");
    var next = document.getElementById("latestNext");
    if (prev) prev.addEventListener("click", function () { latestGo(-1); });
    if (next) next.addEventListener("click", function () { latestGo(1); });
    var tickerHost = document.getElementById("latestTicker");
    if (tickerHost) {
      function pauseTicker() {
        if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
        clearLatestTickerTimer();
      }
      function resumeTicker() {
        scheduleLatestTicker();
      }
      bindLatestTickerSwipe(tickerHost);
      tickerHost.addEventListener("mouseenter", pauseTicker);
      tickerHost.addEventListener("focusin", pauseTicker);
      tickerHost.addEventListener("mouseleave", resumeTicker);
      tickerHost.addEventListener("focusout", function () {
        setTimeout(function () {
          if (!tickerHost.contains(document.activeElement)) resumeTicker();
        }, 0);
      });
    }
    section.addEventListener("click", function (event) {
      var retry = event.target.closest("[data-latest-retry]");
      if (retry) {
        if (retry.getAttribute("data-latest-retry") === "more") {
          latest.moreError = false;
          loadLatestMore();
          return;
        }
        loadLatestPosts();
        return;
      }
      if (event.target.closest("a[href], button, input, textarea, select, .latest-nav")) return;
      var button = document.getElementById("latestToggle");
      if (!button) return;
      latestSetOpen(button.getAttribute("aria-expanded") !== "true", true);
    });
    frame.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      latestGo(event.key === "ArrowRight" ? 1 : -1);
    });
    var scrollTimer = 0;
    frame.addEventListener("scroll", function () {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(onLatestSettle, 80);
    }, { passive: true });
    if ("onscrollend" in frame) frame.addEventListener("scrollend", onLatestSettle);
    bindLatestDrag(frame);
    frame.addEventListener("wheel", function (event) {
      if (Math.abs(event.deltaX) < 28 || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      if (event.deltaX < 0) return;
      if (frame.scrollLeft < frame.scrollWidth - frame.clientWidth - 2) return;
      if (latestPullNext()) event.preventDefault();
    }, { passive: false });
    var query = window.matchMedia("(max-width: 767px)");
    if (query.addEventListener) query.addEventListener("change", latestRegroup);
    else if (query.addListener) query.addListener(latestRegroup);
    window.addEventListener("resize", function () {
      clearTimeout(latest.resizeTimer);
      latest.resizeTimer = setTimeout(latestRegroup, 150);
    });
    if (!latest.timer) latest.timer = setInterval(tickLatestTimes, 30000);
  }

  function initDashboard() {
    if (typeof CharacterParser === "undefined") {
      showBootError("parser.js를 불러오지 못했습니다.");
      return;
    }
    captureFirstLoadToday();
    loadPrefs();
    bindDashboard();
    paintShellPlaceholders();
    revealDashboard();
    bindLatestPosts();
    loadLatestPosts();
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

  async function loadDetail() {
    var root = document.getElementById("detailRoot");
    try {
      if (typeof CharacterParser === "undefined") throw new Error("parser.js를 불러오지 못했습니다.");
      state.blogCounts = {};
      await loadCharacters();
      seedCachedCounts();
      if (state.countDayReset) syncLiveVisitors();
      try { await warmThumbs(thumbKeysFor(state.characters)); } catch (error) {}
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
      refreshThumbs();
    } catch (error) {
      if (root) root.replaceChildren(missingDetail(error.message || "데이터를 불러오지 못했습니다."));
    }
  }

  function initDetailPage() {
    captureFirstLoadToday();
    var logout = document.getElementById("logoutBtn");
    if (logout) logout.addEventListener("click", logoutUser);
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
