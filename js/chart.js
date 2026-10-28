/**
 * 통계 탭의 막대 그래프, 이번 달 선 그래프, 전체 비중 원, 막대 위 숫자.
 * 막대 색은 방문자 단계(오늘은 단계, 전체는 파랑)이고, 1등만 같은 색을 조금 진하게 한다.
 * 막대 위 숫자는 밝은 회색이다.
 * 선 그래프 가로축은 27 / (화) 두 줄이고, 토요일 파랑, 일요일·법정공휴일 빨강이다.
 * 캐릭터 카드의 최근 1주일 선은 날짜·요일과 점 위 숫자를 그린다.
 * Chart.js가 없는 화면에서는 그리지 않는다.
 */
(function (root) {
  var deps = null;



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
    deps.paintStatic(reel, value);
  }

  function chartNumber(row, field) {
    var value = row && row[field];
    return typeof value === "number" && isFinite(value) ? value : 0;
  }

  function followChartValues(chart) {
    if (!chart || !chart.canvas || !chart.scales || !chart.scales.y) return;
    var host = chart.canvas.parentNode.querySelector(".chart-values");
    var rows = chart.$chartRows || [];
    var meta = chart.getDatasetMeta(0);
    if (!host || !meta || !meta.data) return;
    var scale = chart.scales.y;
    var field = chart.$valueField || "todayVisitors";
    rows.forEach(function (row, index) {
      var el = host.querySelector('[data-chart-value="' + row.id + '"]');
      var bar = meta.data[index];
      if (!el || !bar) return;
      el.style.left = bar.x + "px";
      el.style.top = bar.y + "px";
      if (!chart.$rise) return;
      showChartCount(el, chartBarValue(bar, scale, chartNumber(row, field)));
    });
  }

  function syncChartValues(chart, rows, replay, rise) {
    var host = chartValueHost(chart.canvas.parentNode);
    var seen = {};
    var field = chart.$valueField || "todayVisitors";
    rows.forEach(function (row) {
      seen[row.id] = true;
      var el = host.querySelector('[data-chart-value="' + row.id + '"]');
      if (!el) {
        el = document.createElement("span");
        el.className = "chart-value";
        el.setAttribute("data-chart-value", row.id);
        host.appendChild(el);
      }
      el.style.color = "";
      var reel = el.querySelector(".odometer");
      if (!reel || replay || rise) {
        var fresh = document.createElement("span");
        fresh.className = "odometer";
        if (reel) reel.replaceWith(fresh);
        else el.appendChild(fresh);
        reel = fresh;
      }
      el._chartShown = null;
      if (rise) deps.paintStatic(reel, 0);
      else deps.setOdometer(reel, chartNumber(row, field));
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

  function barColor(character) {
    var level = deps.visitorLevel(character.todayVisitors);
    if (level === "zero") return "#6e6e80";
    if (level === "t10000") return "#e453ff";
    if (level === "t5000") return "#ff3355";
    if (level === "t1000") return "#ff4d2e";
    if (level === "t500") return "#ff7a00";
    if (level === "high") return "#f5a623";
    if (level === "mid") return "#5266eb";
    if (level === "unknown") return "#3a3a48";
    return "#9aa6ee";
  }

  function totalBarColor(row) {
    var value = row.totalVisitors;
    if (value == null || !isFinite(value)) return "#3a3a48";
    if (value === 0) return "#6e6e80";
    return "#6cb6ff";
  }

  function chartSpec(metric) {
    if (metric === "total") {
      return {
        field: "totalVisitors",
        stateKey: "totalChart",
        wrapId: "totalChartWrap",
        canvasId: "totalChart",
        emptyId: "totalChartEmpty",
        label: "전체 방문자",
        color: totalBarColor
      };
    }
    return {
      field: "todayVisitors",
      stateKey: "chart",
      wrapId: "chartWrap",
      canvasId: "visitorChart",
      emptyId: "chartEmpty",
      label: "오늘 방문자",
      color: barColor
    };
  }

  function deepenColor(hex, step, saturate) {
    var matched = /^#([0-9a-f]{6})$/i.exec(hex || "");
    if (!matched) return hex;
    var n = parseInt(matched[1], 16);
    var r = ((n >> 16) & 255) / 255;
    var g = ((n >> 8) & 255) / 255;
    var b = (n & 255) / 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var h = 0;
    var s = 0;
    var l = (max + min) / 2;
    var span = max - min;
    if (span) {
      s = l > 0.5 ? span / (2 - max - min) : span / (max + min);
      if (max === r) h = ((g - b) / span + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / span + 2) / 6;
      else h = ((r - g) / span + 4) / 6;
    }
    l = Math.max(0.08, l - step);
    if (saturate) s = Math.min(1, s + 0.06);
    function channel(p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    function byte(value) {
      var rounded = Math.round(value * 255);
      return (rounded < 16 ? "0" : "") + rounded.toString(16);
    }
    var rr = s ? channel(p, q, h + 1 / 3) : l;
    var gg = s ? channel(p, q, h) : l;
    var bb = s ? channel(p, q, h - 1 / 3) : l;
    return "#" + byte(rr) + byte(gg) + byte(bb);
  }

  function glassTheme() {
    return document.documentElement.getAttribute("data-theme") === "glass";
  }

  function axisColor(fallback) {
    return glassTheme() ? "rgba(28,30,38,0.62)" : fallback;
  }

  function gridColor() {
    return glassTheme() ? "rgba(28,30,38,0.14)" : "#2c2c3a";
  }

  // 글래시에서는 막대와 선이 배경을 비치게 한다. 기본 테마 색은 그대로다.
  function tint(hex, alpha) {
    if (!glassTheme()) return hex;
    var matched = /^#([0-9a-f]{6})$/i.exec(String(hex || ""));
    if (!matched) return hex;
    var n = parseInt(matched[1], 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + alpha + ")";
  }

  // 값이 가장 큰 막대만 진하게. 0뿐이면 1등을 두지 않고, 동점이면 함께 진하게 한다.
  function rankedBarColors(rows, field, colorOf) {
    var best = 0;
    rows.forEach(function (row) {
      var value = chartNumber(row, field);
      if (value > best) best = value;
    });
    return rows.map(function (row) {
      var color = colorOf(row);
      if (best > 0 && chartNumber(row, field) === best) {
        color = field === "todayVisitors" ? deepenColor(color, 0.08, false) : deepenColor(color, 0.12, true);
      }
      return tint(color, 0.5);
    });
  }

  function renderChart(options) {
    var spec = chartSpec(options && options.metric);
    var wrap = document.getElementById(spec.wrapId);
    var empty = document.getElementById(spec.emptyId);
    var canvas = document.getElementById(spec.canvasId);
    if (!wrap || !canvas) return;
    var existed = !!deps.state[spec.stateKey];
    var rise = !deps.reducedMotion && (!!(options && options.rise) || !existed);
    if (deps.state[spec.stateKey]) {
      deps.state[spec.stateKey].destroy();
      deps.state[spec.stateKey] = null;
    }
    var rows = deps.visibleCharacters().filter(function (row) { return row.ok; });
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
      var chart = new Chart(canvas, {
        type: "bar",
        plugins: [barValuePlugin],
        data: {
          labels: rows.map(function (row) { return row.name; }),
          datasets: [{
            label: spec.label,
            data: rows.map(function (row) { return chartNumber(row, spec.field); }),
            backgroundColor: rankedBarColors(rows, spec.field, spec.color),
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
              backgroundColor: glassTheme() ? "rgba(255,255,255,0.92)" : "#11111d",
              titleColor: glassTheme() ? "#1c1e26" : "#ededf3",
              bodyColor: glassTheme() ? "rgba(28,30,38,0.78)" : "#c3c3cc",
              borderColor: glassTheme() ? "rgba(255,255,255,0.8)" : "#2c2c3a",
              borderWidth: 1,
              callbacks: {
                label: function (item) { return spec.label + " " + deps.formatNumber(item.parsed.y); }
              }
            }
          },
          layout: { padding: { top: 8, left: 4, right: 18 } },
          scales: {
            x: { ticks: { color: axisColor("#c3c3cc"), maxRotation: 0, minRotation: 0, autoSkip: false, font: { size: 12 } }, grid: { display: false } },
            y: { beginAtZero: true, grace: "22%", ticks: { color: axisColor("#9a9aa8"), precision: 0 }, grid: { color: gridColor() } }
          }
        }
      });
      chart.$rise = rise;
      chart.$valueField = spec.field;
      chart.$chartRows = rows;
      deps.state[spec.stateKey] = chart;
      syncChartValues(chart, rows, !!(options && options.replay), rise);
      followChartValues(chart);
    } catch (error) {
      wrap.hidden = true;
      if (empty) {
        empty.hidden = false;
        empty.textContent = "그래프를 그리지 못했습니다.";
      }
    }
  }

  var LINE_COLORS = ["#6cb6ff", "#3dbea5", "#e7a0c4", "#f0d36a", "#c4b5fd", "#f0a07a"];

  function characterColor(row) {
    var id = row && row.id;
    var found = 0;
    var index = 0;
    (deps.state.characters || []).forEach(function (item) {
      if (!item.ok) return;
      if (item.id === id) found = index;
      index += 1;
    });
    return LINE_COLORS[found % LINE_COLORS.length];
  }

  function lineColor(id) {
    return characterColor({ id: id });
  }

  function dayNumber(value) {
    return typeof value === "number" && isFinite(value) && value >= 0 && Math.floor(value) === value;
  }

  function closedDayTotal(character, row) {
    var blogs = deps.countableBlogs(character);
    if (!blogs.length || !row) return null;
    var sum = 0;
    for (var i = 0; i < blogs.length; i++) {
      var key = deps.countableBlogUrl(blogs[i].url || "");
      if (!key || !Object.prototype.hasOwnProperty.call(row, key) || !dayNumber(row[key])) return null;
      sum += row[key];
    }
    return sum;
  }

  function liveDayTotal(character) {
    var blogs = deps.countableBlogs(character);
    if (!blogs.length) return null;
    var sum = 0;
    for (var i = 0; i < blogs.length; i++) {
      var key = deps.countableBlogUrl(blogs[i].url || "");
      var data = key && deps.state.blogCounts[key];
      if (!data || data.status !== "ok" || deps.omitsDailyVisitors(data) || !dayNumber(data.today)) return null;
      sum += data.today;
    }
    return sum;
  }

  function seoulShift(key, deltaDays) {
    var matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || "");
    if (!matched) return "";
    var utc = Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]) + deltaDays);
    var date = new Date(utc);
    function two(n) { return (n < 10 ? "0" : "") + n; }
    return date.getUTCFullYear() + "-" + two(date.getUTCMonth() + 1) + "-" + two(date.getUTCDate());
  }

  function weekKeys(todayKey) {
    var keys = [];
    for (var back = 7; back >= 0; back--) {
      var key = seoulShift(todayKey, -back);
      if (key) keys.push(key);
    }
    return keys;
  }

  var WEEK_FONT = '"Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';
  var WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

  function weekParts(key) {
    var matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || "");
    if (!matched) return null;
    var utc = Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]));
    return {
      month: Number(matched[2]),
      day: Number(matched[3]),
      week: WEEKDAYS[new Date(utc).getUTCDay()]
    };
  }

  // 가로축은 27 / (화) 두 줄이다. 한 줄 27(화)는 카드 칸에서 겹친다.
  function weekTickLines(key) {
    var parts = weekParts(key);
    if (!parts) return "";
    return [String(parts.day), "(" + parts.week + ")"];
  }

  // 이번 달처럼 칸이 좁으면 홀수 날을 한 칸 아래로 내린다.
  // 그래도 27이 안 들어가면 27 / 화 처럼 짧게 쓴다.
  function monthTickLines(key, index, stagger, tight) {
    var lines = weekTickLines(key);
    if (tight) {
      var parts = weekParts(key);
      lines = parts ? [String(parts.day), parts.week] : lines;
    }
    if (!lines || !stagger) return lines;
    if (index % 2 === 0) return lines.concat(["", ""]);
    return ["", ""].concat(lines);
  }

  function weekLabel(key) {
    var parts = weekParts(key);
    if (!parts) return "";
    return parts.month + "월 " + parts.day + "일(" + parts.week + ")";
  }

  // 설·추석·부처님오신날은 당일. 설·추석은 앞뒤 하루를 붙이고, 대체공휴일은 법령대로 계산한다.
  // 신정·현충일은 대체공휴일이 없다. 노동절·제헌절은 2026년부터 공휴일이다.
  var LUNAR_MARK = {
    2024: { seollal: "2024-02-10", buddha: "2024-05-15", chuseok: "2024-09-17" },
    2025: { seollal: "2025-01-29", buddha: "2025-05-05", chuseok: "2025-10-06" },
    2026: { seollal: "2026-02-17", buddha: "2026-05-24", chuseok: "2026-09-25" },
    2027: { seollal: "2027-02-07", buddha: "2027-05-13", chuseok: "2027-09-15" },
    2028: { seollal: "2028-01-27", buddha: "2028-05-02", chuseok: "2028-10-03" },
    2029: { seollal: "2029-02-13", buddha: "2029-05-20", chuseok: "2029-09-22" },
    2030: { seollal: "2030-02-03", buddha: "2030-05-09", chuseok: "2030-09-12" },
    2031: { buddha: "2031-05-28", chuseok: "2031-10-01" },
    2032: { buddha: "2032-05-16", chuseok: "2032-09-19" },
    2033: { buddha: "2033-05-06", chuseok: "2033-09-08" },
    2034: { buddha: "2034-05-25", chuseok: "2034-09-27" },
    2035: { buddha: "2035-05-15", chuseok: "2035-09-16" },
    2036: { buddha: "2036-05-03", chuseok: "2036-10-04" }
  };
  var EXTRA_HOLIDAY = {
    2024: ["2024-04-10", "2024-10-01"],
    2025: ["2025-01-27", "2025-06-03"],
    2026: ["2026-06-03"]
  };
  var HOLIDAY_CACHE = {};
  var AXIS_MUTED = "#9a9aa8";
  var AXIS_SAT = "#79b8ff";
  var AXIS_HOLIDAY = "#ff6b6b";

  function holidayKeys(year) {
    if (HOLIDAY_CACHE[year]) return HOLIDAY_CACHE[year];
    var set = {};
    function ymd(month, day) {
      return year + "-" + (month < 10 ? "0" : "") + month + "-" + (day < 10 ? "0" : "") + day;
    }
    var base = [];
    function pushBase(key, sub) { if (key) base.push({ key: key, sub: sub }); }
    pushBase(ymd(1, 1), false);
    pushBase(ymd(6, 6), false);
    [[3, 1], [5, 5], [8, 15], [10, 3], [10, 9], [12, 25]].forEach(function (pair) {
      pushBase(ymd(pair[0], pair[1]), true);
    });
    if (year >= 2026) {
      pushBase(ymd(5, 1), true);
      pushBase(ymd(7, 17), true);
    }
    var lunar = LUNAR_MARK[year] || {};
    if (lunar.buddha) pushBase(lunar.buddha, true);
    ["seollal", "chuseok"].forEach(function (name) {
      var center = lunar[name];
      if (!center) return;
      [-1, 0, 1].forEach(function (delta) { pushBase(seoulShift(center, delta), "span"); });
    });
    (EXTRA_HOLIDAY[year] || []).forEach(function (key) { pushBase(key, false); });
    var counts = {};
    base.forEach(function (item) {
      counts[item.key] = (counts[item.key] || 0) + 1;
      set[item.key] = true;
    });
    function nextFree(key) {
      var cursor = key;
      var i;
      for (i = 0; i < 8; i++) {
        cursor = seoulShift(cursor, 1);
        if (!cursor) return "";
        if (weekParts(cursor).week === "일") continue;
        if (set[cursor]) continue;
        return cursor;
      }
      return "";
    }
    var wanted = {};
    base.forEach(function (item) {
      if (item.sub === true) {
        var week = weekParts(item.key).week;
        if (week === "토" || week === "일" || counts[item.key] > 1) wanted[item.key] = true;
      } else if (item.sub === "span" && weekParts(item.key).week === "일") {
        wanted[item.key] = true;
      }
    });
    Object.keys(counts).forEach(function (key) {
      if (counts[key] > 1) wanted[key] = true;
    });
    Object.keys(wanted).sort().forEach(function (key) {
      var sub = nextFree(key);
      if (sub) set[sub] = true;
    });
    HOLIDAY_CACHE[year] = set;
    return set;
  }

  function isLegalHoliday(key) {
    var year = Number((key || "").slice(0, 4));
    if (!year) return false;
    return !!(holidayKeys(year - 1)[key] || holidayKeys(year)[key] || holidayKeys(year + 1)[key]);
  }

  function axisColor(key) {
    if (isLegalHoliday(key)) return AXIS_HOLIDAY;
    var parts = weekParts(key);
    if (!parts) return AXIS_MUTED;
    if (parts.week === "토") return AXIS_SAT;
    if (parts.week === "일") return AXIS_HOLIDAY;
    return AXIS_MUTED;
  }

  function drawStandingValues(chart, items, size, font) {
    var ctx = chart.ctx;
    items.forEach(function (item) {
      var half = size / 2 + 1;
      var minX = chart.chartArea.left + half;
      var maxX = chart.width - half - 1;
      if (minX <= maxX) item.x = Math.max(minX, Math.min(maxX, item.x));
      item.bottom = item.y;
      item.top = item.y - item.w;
    });
    var guard;
    for (guard = 0; guard < 8; guard++) {
      var moved = false;
      for (var i = 0; i < items.length; i++) {
        for (var j = i + 1; j < items.length; j++) {
          var a = items[i];
          var b = items[j];
          if (Math.abs(a.x - b.x) >= size) continue;
          var overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (overlap <= 0) continue;
          var upper = a.top <= b.top ? a : b;
          upper.top -= overlap + 2;
          upper.bottom -= overlap + 2;
          moved = true;
        }
      }
      if (!moved) break;
    }
    ctx.save();
    ctx.font = font;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.lineWidth = size <= 8 ? 2 : 3;
    ctx.strokeStyle = glassTheme() ? "rgba(255,255,255,0.94)" : "#11111d";
    ctx.lineJoin = "round";
    items.forEach(function (item) {
      var y = Math.max(item.w + 2, item.bottom);
      ctx.save();
      ctx.translate(item.x, y);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = item.color;
      ctx.strokeText(item.text, 0, 0);
      ctx.fillText(item.text, 0, 0);
      ctx.restore();
    });
    ctx.restore();
  }

  function drawPointValues(chart) {
    var datasets = chart.data.datasets || [];
    if (!datasets.length || !chart.chartArea) return;
    var size = chart.$pointFont || (chart.canvas && chart.canvas.$pointFont) || 11;
    var ink = chart.$pointInk || (chart.canvas && chart.canvas.$pointInk) || "";
    var ctx = chart.ctx;
    var font = "700 " + size + "px " + WEEK_FONT;
    ctx.save();
    ctx.font = font;
    var items = [];
    datasets.forEach(function (dataset, setIndex) {
      var meta = chart.getDatasetMeta(setIndex);
      if (!meta || meta.hidden || !meta.data) return;
      meta.data.forEach(function (point, index) {
        var value = dataset.data[index];
        if (!dayNumber(value) || !point || point.skip) return;
        var text = deps.formatNumber(value);
        items.push({
          x: point.x,
          y: point.y - 7,
          text: text,
          w: ctx.measureText(text).width,
          color: ink || dataset.borderColor || "#ededf3"
        });
      });
    });
    ctx.restore();
    if (!items.length) return;
    var stand = chart.$pointStand || (chart.canvas && chart.canvas.$pointStand);
    if (stand) {
      drawStandingValues(chart, items, size, font);
      return;
    }
    items.sort(function (a, b) { return a.x - b.x; });
    var area = chart.chartArea;
    items.forEach(function (item) {
      var half = item.w / 2;
      var minX = area.left + half;
      // 오늘 숫자는 점 가운데에 둔다. 오른쪽 여백 안에 그리고, 캔버스를 넘어갈 때만 당긴다.
      var maxX = chart.width - half - 1;
      if (minX <= maxX) item.x = Math.max(minX, Math.min(maxX, item.x));
    });
    var guard;
    for (guard = 0; guard < 4; guard++) {
      var moved = false;
      for (index = 1; index < items.length; index++) {
        var left = items[index - 1];
        var right = items[index];
        if (Math.abs(left.x - right.x) >= (left.w + right.w) / 2 + 6) continue;
        if (Math.abs(left.y - right.y) >= 14) continue;
        var lift = left.y < right.y ? left : right;
        lift.y -= 14;
        moved = true;
      }
      if (!moved) break;
    }
    ctx.save();
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.lineWidth = 3;
    ctx.strokeStyle = glassTheme() ? "rgba(255,255,255,0.94)" : "#11111d";
    ctx.lineJoin = "round";
    items.slice().sort(function (a, b) { return b.y - a.y; }).forEach(function (item) {
      var y = Math.max(size + 1, item.y);
      ctx.fillStyle = item.color;
      ctx.strokeText(item.text, item.x, y);
      ctx.fillText(item.text, item.x, y);
    });
    ctx.restore();
  }

  function drawDayTicks(chart) {
    var keys = chart.$dayKeys || (chart.canvas && chart.canvas.$dayKeys);
    var scale = chart.scales && chart.scales.x;
    if (!keys || !scale || !scale.ticks) return;
    var fontSize = (scale.options.ticks.font && scale.options.ticks.font.size) || 10;
    var ctx = chart.ctx;
    var lineScale = (scale.options.ticks.font && scale.options.ticks.font.lineHeight) || 1.15;
    var lineHeight = fontSize * lineScale;
    var y0 = scale.top + (scale.options.ticks.padding || 0);
    ctx.save();
    ctx.font = fontSize + "px " + WEEK_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    scale.ticks.forEach(function (tick, index) {
      var label = tick.label;
      var lines = Array.isArray(label) ? label : [String(label)];
      var key = keys[tick.value != null ? tick.value : index];
      ctx.fillStyle = axisColor(key);
      var x = scale.getPixelForTick(index);
      lines.forEach(function (text, line) {
        ctx.fillText(text, x, y0 + line * lineHeight);
      });
    });
    ctx.restore();
  }

  function monthInner(canvas) {
    var parent = canvas.parentNode;
    if (!parent) return null;
    if (parent.classList.contains("month-chart-inner")) return parent;
    var inner = document.createElement("div");
    inner.className = "month-chart-inner";
    parent.insertBefore(inner, canvas);
    inner.appendChild(canvas);
    return inner;
  }

  // 휴대폰처럼 하루 칸이 12px보다 좁으면 그래프를 넓혀 가로로 밀게 한다.
  function syncMonthHost(chart) {
    var canvas = chart.canvas;
    if (!canvas) return false;
    var inner = monthInner(canvas);
    var wrap = inner && inner.parentNode;
    var host = wrap && wrap.clientWidth;
    var keys = chart.$dayKeys || canvas.$dayKeys || [];
    if (!inner || !host || !keys.length) return false;
    var hostPitch = (host - 64) / keys.length;
    var want = hostPitch < 12 ? Math.ceil(keys.length * 28 + 80) : 0;
    var next = want ? want + "px" : "100%";
    if (inner.style.width === next) return false;
    inner.style.width = next;
    inner.style.height = "100%";
    if (want) wrap.scrollLeft = want;
    chart.resize();
    return true;
  }

  function applyMonthFit(chart) {
    if (!(chart.$monthFit || (chart.canvas && chart.canvas.$monthFit))) return;
    if (chart.$monthUpdating) return;
    if (syncMonthHost(chart)) return;
    var keys = chart.$dayKeys || (chart.canvas && chart.canvas.$dayKeys);
    var area = chart.chartArea;
    if (!keys || !keys.length || !area || area.right - area.left < 20) return;
    var pitch = (area.right - area.left) / keys.length;
    var stagger = pitch < 22;
    var tight = (stagger ? pitch * 2 : pitch) < 20;
    var stand = pitch < 18;
    var size = tight ? 8 : (stagger ? 9 : 10);
    var sig = (stagger ? "s" : "n") + (tight ? "t" : "f") + (stand ? "u" : "h") + size;
    if (chart.$monthSig === sig) return;
    chart.$monthSig = sig;
    chart.$pointStand = stand;
    chart.$pointFont = size;
    if (chart.canvas) {
      chart.canvas.$pointStand = stand;
      chart.canvas.$pointFont = size;
    }
    if (chart.options.scales.x.ticks.font) chart.options.scales.x.ticks.font.size = size;
    chart.data.labels = keys.map(function (key, index) {
      return monthTickLines(key, index, stagger, tight);
    });
    chart.$monthUpdating = true;
    chart.update("none");
    chart.$monthUpdating = false;
  }

  var weekPointValuesPlugin = {
    id: "weekPointValues",
    afterLayout: function (chart) {
      applyMonthFit(chart);
    },
    afterDraw: function (chart) {
      var keys = chart.$dayKeys || (chart.canvas && chart.canvas.$dayKeys);
      if (!keys) return;
      drawPointValues(chart);
      drawDayTicks(chart);
    }
  };

  function sharePercent(value, sum) {
    if (!sum) return "0%";
    var pct = Math.round(value / sum * 1000) / 10;
    return (pct % 1 === 0 ? String(Math.round(pct)) : pct.toFixed(1)) + "%";
  }

  function monthKeys(todayKey) {
    var parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todayKey || "");
    if (!parts) return [];
    var last = Number(parts[3]);
    var keys = [];
    for (var day = 1; day <= last; day++) {
      keys.push(parts[1] + "-" + parts[2] + "-" + (day < 10 ? "0" : "") + day);
    }
    return keys;
  }

  function monthHasClose(days, todayKey) {
    var month = String(todayKey || "").slice(0, 7);
    if (!days || month.length !== 7) return false;
    return Object.keys(days).some(function (day) {
      return day.slice(0, 7) === month && days[day] && Object.keys(days[day]).length > 0;
    });
  }

  function showMonthMessage(wrap, empty, text) {
    if (wrap) wrap.hidden = true;
    if (empty) {
      empty.hidden = false;
      empty.textContent = text;
    }
  }

  function renderMonthChart(options) {
    var wrap = document.getElementById("monthChartWrap");
    var empty = document.getElementById("monthChartEmpty");
    var canvas = document.getElementById("monthChart");
    if (!wrap || !canvas) return;
    var existed = !!deps.state.monthChart;
    var rise = !deps.reducedMotion && (!!(options && options.rise) || !existed);
    if (deps.state.monthChart) {
      deps.state.monthChart.destroy();
      deps.state.monthChart = null;
    }
    var todayKey = deps.seoulDateKey(new Date());
    var days = deps.state.visitorDays || {};
    var rows = deps.visibleCharacters().filter(function (row) {
      return row.ok && deps.countableBlogs(row).length;
    });
    if (!rows.length || typeof Chart === "undefined") {
      showMonthMessage(wrap, empty, typeof Chart === "undefined" ? "Chart.js를 불러오지 못했습니다." : "그래프를 표시할 캐릭터가 없습니다.");
      return;
    }
    if (!monthHasClose(days, todayKey)) {
      showMonthMessage(wrap, empty, "마감 기록이 없습니다.");
      return;
    }
    var keys = monthKeys(todayKey);
    if (!keys.length) {
      showMonthMessage(wrap, empty, "마감 기록이 없습니다.");
      return;
    }
    var last = keys.length - 1;
    wrap.hidden = false;
    if (empty) empty.hidden = true;
    canvas.$dayKeys = keys;
    canvas.$pointFont = 10;
    canvas.$pointStand = false;
    canvas.$monthFit = true;
    var monthHost = monthInner(canvas);
    if (monthHost) {
      var monthWrap = monthHost.parentNode;
      var monthWidth = monthWrap && monthWrap.clientWidth;
      var monthPitch = monthWidth ? (monthWidth - 64) / keys.length : 22;
      monthHost.style.height = "100%";
      monthHost.style.width = monthPitch < 12 ? Math.ceil(keys.length * 28 + 80) + "px" : "100%";
    }
    try {
      var chart = new Chart(canvas, {
        type: "line",
        plugins: [weekPointValuesPlugin],
        data: {
          labels: keys.map(weekTickLines),
          datasets: rows.map(function (row) {
            var color = lineColor(row.id);
            var data = keys.map(function (key, index) {
              if (index === last) return liveDayTotal(row);
              return closedDayTotal(row, days[key]);
            });
            return {
              label: row.name,
              data: data,
              borderColor: tint(color, 0.72),
              backgroundColor: tint(color, 0.72),
              borderWidth: 2,
              tension: 0,
              spanGaps: false,
              pointRadius: function (ctx) {
                var value = ctx.dataset.data[ctx.dataIndex];
                if (!dayNumber(value)) return 0;
                return ctx.dataIndex === last ? 5 : 3;
              },
              pointHoverRadius: 5,
              segment: {
                borderDash: function (ctx) {
                  return ctx.p1DataIndex === last ? [5, 4] : [];
                }
              }
            };
          })
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: rise ? 1000 : 0 },
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: {
              display: true,
              position: "bottom",
              labels: { color: axisColor("#c3c3cc"), boxWidth: 12, boxHeight: 12, padding: 14, font: { size: 12 } }
            },
            tooltip: {
              backgroundColor: glassTheme() ? "rgba(255,255,255,0.92)" : "#11111d",
              titleColor: glassTheme() ? "#1c1e26" : "#ededf3",
              bodyColor: glassTheme() ? "rgba(28,30,38,0.78)" : "#c3c3cc",
              borderColor: glassTheme() ? "rgba(255,255,255,0.8)" : "#2c2c3a",
              borderWidth: 1,
              callbacks: {
                title: function (items) {
                  var item = items && items[0];
                  if (!item) return "";
                  var stored = (item.chart && item.chart.$dayKeys) || [];
                  var key = stored[item.dataIndex] || "";
                  return weekLabel(key) + (item.dataIndex === last ? " 진행 중" : "");
                },
                label: function (item) {
                  if (!dayNumber(item.parsed.y)) return item.dataset.label + " 없음";
                  return item.dataset.label + " " + deps.formatNumber(item.parsed.y);
                }
              }
            }
          },
          layout: { padding: { top: 18, left: 2, right: 22 } },
          scales: {
            x: {
              offset: true,
              ticks: {
                color: "rgba(0,0,0,0)",
                maxRotation: 0,
                minRotation: 0,
                autoSkip: false,
                padding: 2,
                font: { size: 10, family: WEEK_FONT, lineHeight: 1.15 }
              },
              grid: { display: false }
            },
            y: { beginAtZero: true, grace: "28%", ticks: { color: axisColor("#9a9aa8"), precision: 0, font: { size: 10, family: WEEK_FONT } }, grid: { color: gridColor() } }
          }
        }
      });
      chart.$dayKeys = keys;
      chart.$monthFit = true;
      if (!chart.$monthSig) {
        chart.$pointFont = 10;
        chart.$pointStand = false;
      }
      deps.state.monthChart = chart;
      if (monthHost && monthWrap && monthHost.style.width !== "100%") monthWrap.scrollLeft = monthWrap.scrollWidth;
    } catch (error) {
      showMonthMessage(wrap, empty, "그래프를 그리지 못했습니다.");
    }
  }

  var SHARE_FONT = "\"Apple SD Gothic Neo\", \"Noto Sans KR\", \"Malgun Gothic\", \"Segoe UI\", sans-serif";

  function shareFont(weight, size) {
    return weight + " " + size + "px " + SHARE_FONT;
  }

  function shareArcProps(arc, final) {
    if (!arc || !arc.getProps) return arc || {};
    var props = arc.getProps(["x", "y", "startAngle", "endAngle", "outerRadius"], !!final);
    if (!props || props.outerRadius === undefined) return arc;
    return props;
  }

  function fillRounded(ctx, x, y, width, height, radius) {
    var r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
    ctx.fill();
  }

  function shareLabelWidths(ctx, item) {
    ctx.font = shareFont(700, 12);
    var nameWidth = ctx.measureText(item.name).width;
    ctx.font = shareFont(600, 11);
    var percentWidth = ctx.measureText(item.percent).width;
    return { nameWidth: nameWidth, percentWidth: percentWidth, textWidth: Math.max(nameWidth, percentWidth) };
  }

  function nudgeShareLabels(items, chart) {
    var gap = 34;
    var margin = 18;
    function separate(group, key, limit) {
      group.sort(function (a, b) { return a[key] - b[key]; });
      var cursor = -Infinity;
      group.forEach(function (item) {
        if (item[key] < cursor + gap) item[key] = cursor + gap;
        cursor = item[key];
      });
      if (!group.length) return;
      var overflow = group[group.length - 1][key] - (limit - margin);
      if (overflow > 0) group.forEach(function (item) { item[key] -= overflow; });
      var underflow = margin - group[0][key];
      if (underflow > 0) group.forEach(function (item) { item[key] += underflow; });
    }
    var left = [];
    var right = [];
    var mid = [];
    items.forEach(function (item) {
      if (item.cos > 0.42) right.push(item);
      else if (item.cos < -0.42) left.push(item);
      else mid.push(item);
    });
    separate(left, "labelY", chart.height);
    separate(right, "labelY", chart.height);
    mid.forEach(function (item) {
      item.labelX = item.live.x + item.cos * (item.live.outerRadius + 18);
    });
    separate(mid, "labelX", chart.width);
  }

  function drawShareText(ctx, item, x, y, align, fillName, fillPercent) {
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.font = shareFont(700, 12);
    ctx.fillStyle = fillName;
    ctx.fillText(item.name, x, y - 7);
    ctx.font = shareFont(600, 11);
    ctx.fillStyle = fillPercent;
    ctx.fillText(item.percent, x, y + 8);
  }

  function drawShareInside(ctx, item) {
    var live = shareArcProps(item.arc, false);
    if (!live || live.outerRadius < 28) return;
    var angle = (live.startAngle + live.endAngle) / 2;
    var dist = live.outerRadius * 0.58;
    drawShareText(
      ctx,
      item,
      live.x + Math.cos(angle) * dist,
      live.y + Math.sin(angle) * dist,
      "center",
      "#14141f",
      "#242433"
    );
  }

  function drawShareOutside(ctx, item, color, chart) {
    var live = item.live;
    if (!live || live.outerRadius < 8) return;
    var side = item.cos > 0.42 ? 1 : (item.cos < -0.42 ? -1 : 0);
    var widths = shareLabelWidths(ctx, item);
    var textX = side === 0 ? item.labelX : live.x + item.cos * (live.outerRadius + 12);
    var textY = side === 0 ? live.y + item.sin * (live.outerRadius + 22) : item.labelY;
    var boxW = widths.textWidth;
    if (side > 0) textX = Math.max(8, Math.min(textX, chart.width - boxW - 8));
    else if (side < 0) textX = Math.max(boxW + 8, Math.min(textX, chart.width - 8));
    else textX = Math.max(boxW / 2 + 8, Math.min(textX, chart.width - boxW / 2 - 8));
    textY = Math.max(18, Math.min(textY, chart.height - 18));
    var boxLeft = side > 0 ? textX - 5 : (side < 0 ? textX - boxW - 5 : textX - boxW / 2 - 5);
    var boxTop = textY - 16;
    var edgeX = live.x + item.cos * live.outerRadius;
    var edgeY = live.y + item.sin * live.outerRadius;
    var joinX = side > 0 ? boxLeft : (side < 0 ? boxLeft + boxW + 10 : textX);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(edgeX, edgeY);
    ctx.lineTo(joinX, textY);
    ctx.stroke();
    ctx.fillStyle = glassTheme() ? "rgba(255,255,255,0.9)" : "rgba(17, 17, 29, 0.94)";
    fillRounded(ctx, boxLeft, boxTop, boxW + 10, 32, 7);
    drawShareText(
      ctx,
      item,
      textX,
      textY,
      side > 0 ? "left" : (side < 0 ? "right" : "center"),
      glassTheme() ? "#1c1e26" : "#ededf3",
      glassTheme() ? "rgba(28,30,38,0.72)" : "#c3c3cc"
    );
  }

  function drawShareLabels(chart, sum) {
    var meta = chart.getDatasetMeta(0);
    var dataset = chart.data.datasets && chart.data.datasets[0];
    if (!meta || !dataset || !meta.data) return;
    var labels = chart.data.labels || [];
    var ctx = chart.ctx;
    var items = [];
    var outside = [];
    ctx.save();
    meta.data.forEach(function (arc, index) {
      var value = dataset.data[index];
      if (!value || !chart.getDataVisibility(index)) return;
      var finalProps = shareArcProps(arc, true);
      var sweep = finalProps.endAngle - finalProps.startAngle;
      if (!(sweep > 0.02) || !(finalProps.outerRadius > 24)) return;
      var item = {
        arc: arc,
        index: index,
        name: String(labels[index] || ""),
        percent: sharePercent(value, sum)
      };
      var widths = shareLabelWidths(ctx, item);
      var midR = finalProps.outerRadius * 0.58;
      var chord = 2 * Math.max(8, midR - 14) * Math.sin(Math.min(sweep, Math.PI) / 2);
      item.textWidth = widths.textWidth;
      item.inside = chord >= widths.textWidth + 10 && sweep >= 0.7 && finalProps.outerRadius >= 78;
      if (!item.inside) {
        var live = shareArcProps(arc, false);
        var angle = (live.startAngle + live.endAngle) / 2;
        item.live = live;
        item.cos = Math.cos(angle);
        item.sin = Math.sin(angle);
        item.labelY = live.y + item.sin * (live.outerRadius + 22);
        outside.push(item);
      }
      items.push(item);
    });
    nudgeShareLabels(outside, chart);
    items.forEach(function (item) {
      var color = dataset.backgroundColor[item.index];
      if (item.inside) drawShareInside(ctx, item);
      else drawShareOutside(ctx, item, color, chart);
    });
    ctx.restore();
  }

  function renderShareChart(options) {
    var wrap = document.getElementById("shareChartWrap");
    var empty = document.getElementById("shareChartEmpty");
    var canvas = document.getElementById("shareChart");
    var note = document.getElementById("shareChartNote");
    if (!wrap || !canvas) return;
    var existed = !!deps.state.shareChart;
    var rise = !deps.reducedMotion && (!!(options && options.rise) || !existed);
    if (deps.state.shareChart) {
      deps.state.shareChart.destroy();
      deps.state.shareChart = null;
    }
    var rows = (deps.state.characters || []).filter(function (row) {
      return row.ok && dayNumber(row.totalVisitors) && row.totalVisitors > 0;
    }).sort(function (a, b) { return b.totalVisitors - a.totalVisitors; });
    var partial = (deps.state.characters || []).some(function (row) {
      return row.ok && (row.visitorPartial || !dayNumber(row.totalVisitors));
    });
    if (note) {
      note.textContent = partial
        ? "캐릭터별 전체 방문자 비중입니다. 검색과 관계없이 읽힌 값만 나눕니다."
        : "캐릭터별 전체 방문자 비중입니다. 검색과 관계없이 읽힌 전체를 나눕니다.";
    }
    if (!rows.length || typeof Chart === "undefined") {
      showMonthMessage(wrap, empty, typeof Chart === "undefined" ? "Chart.js를 불러오지 못했습니다." : "전체 방문자가 없습니다.");
      return;
    }
    wrap.hidden = false;
    if (empty) empty.hidden = true;
    var sum = 0;
    rows.forEach(function (row) { sum += row.totalVisitors; });
    try {
      deps.state.shareChart = new Chart(canvas, {
        type: "pie",
        plugins: [{
          id: "shareLabels",
          afterDatasetsDraw: function (chart) { drawShareLabels(chart, sum); }
        }],
        data: {
          labels: rows.map(function (row) { return row.name; }),
          datasets: [{
            data: rows.map(function (row) { return row.totalVisitors; }),
            backgroundColor: rows.map(function (row) { return tint(lineColor(row.id), 0.62); }),
            borderColor: glassTheme() ? "rgba(255,255,255,0.72)" : "#11111d",
            borderWidth: 2,
            hoverOffset: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { top: 28, right: 16, bottom: 16, left: 16 } },
          animation: { duration: rise ? 1000 : 0 },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: glassTheme() ? "rgba(255,255,255,0.92)" : "#11111d",
              titleColor: glassTheme() ? "#1c1e26" : "#ededf3",
              bodyColor: glassTheme() ? "rgba(28,30,38,0.78)" : "#c3c3cc",
              borderColor: glassTheme() ? "rgba(255,255,255,0.8)" : "#2c2c3a",
              borderWidth: 1,
              callbacks: {
                label: function (item) {
                  var value = item.dataset.data[item.dataIndex];
                  return item.label + " " + deps.formatNumber(value) + " · " + sharePercent(value, sum);
                }
              }
            }
          }
        }
      });
    } catch (error) {
      showMonthMessage(wrap, empty, "그래프를 그리지 못했습니다.");
    }
  }

  function renderWeekChart(canvas, character) {
    if (!canvas) return;
    var wrap = canvas.parentNode;
    var section = wrap && wrap.parentNode;
    var empty = section ? section.querySelector(".card-week-empty") : null;
    if (!wrap || !character || typeof Chart === "undefined") return;
    if (deps.characterLivePending(character)) {
      if (!Chart.getChart(canvas)) wrap.classList.add("is-pending");
      return;
    }
    wrap.classList.remove("is-pending");
    var todayKey = deps.seoulDateKey(new Date());
    var keys = weekKeys(todayKey);
    var days = deps.state.visitorDays || {};
    var last = keys.length - 1;
    var data = keys.map(function (key, index) {
      if (index === last) return liveDayTotal(character);
      return closedDayTotal(character, days[key]);
    });
    var summary = section.querySelector(".sr-only");
    if (summary) {
      summary.textContent = keys.map(function (key, index) {
        var value = data[index];
        var text = weekLabel(key) + " ";
        return text + (dayNumber(value) ? deps.formatNumber(value) : "없음");
      }).join(", ");
    }
    if (!data.some(dayNumber)) {
      var stale = Chart.getChart(canvas);
      if (stale) stale.destroy();
      canvas.hidden = true;
      if (empty) {
        empty.hidden = false;
        empty.textContent = "마감 기록이 없습니다.";
      }
      return;
    }
    canvas.hidden = false;
    if (empty) empty.hidden = true;
    var color = tint(lineColor(character.id), 0.72);
    var existing = Chart.getChart(canvas);
    canvas.$dayKeys = keys;
    canvas.$pointFont = 11;
    canvas.$pointInk = glassTheme() ? "rgba(28,30,38,0.78)" : "#ededf3";
    if (existing) {
      existing.$weekKeys = keys;
      existing.$dayKeys = keys;
      existing.$pointFont = 11;
      existing.$pointInk = canvas.$pointInk;
      existing.data.labels = keys.map(weekTickLines);
      existing.data.datasets[0].data = data;
      existing.data.datasets[0].borderColor = color;
      existing.data.datasets[0].backgroundColor = color;
      existing.update("none");
      return;
    }
    try {
      var chart = new Chart(canvas, {
        type: "line",
        plugins: [weekPointValuesPlugin],
        data: {
          labels: keys.map(weekTickLines),
          datasets: [{
            data: data,
            borderColor: color,
            backgroundColor: color,
            borderWidth: 2,
            tension: 0,
            spanGaps: false,
            pointRadius: function (ctx) {
              if (!dayNumber(ctx.dataset.data[ctx.dataIndex])) return 0;
              return ctx.dataIndex === last ? 4 : 2;
            },
            pointHoverRadius: 4,
            segment: {
              borderDash: function (ctx) {
                return ctx.p1DataIndex === last ? [4, 3] : [];
              }
            }
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: deps.reducedMotion ? 0 : 700 },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: glassTheme() ? "rgba(255,255,255,0.92)" : "#11111d",
              titleColor: glassTheme() ? "#1c1e26" : "#ededf3",
              bodyColor: glassTheme() ? "rgba(28,30,38,0.78)" : "#c3c3cc",
              borderColor: glassTheme() ? "rgba(255,255,255,0.8)" : "#2c2c3a",
              borderWidth: 1,
              callbacks: {
                title: function (items) {
                  var item = items && items[0];
                  if (!item) return "";
                  var stored = item.chart.$weekKeys || [];
                  var key = stored[item.dataIndex] || "";
                  return weekLabel(key) + (item.dataIndex === stored.length - 1 ? " 진행 중" : "");
                },
                label: function (item) {
                  if (!dayNumber(item.parsed.y)) return "없음";
                  return deps.formatNumber(item.parsed.y);
                }
              }
            }
          },
          layout: { padding: { top: 16, right: 22, bottom: 0, left: 0 } },
          scales: {
            x: {
              ticks: {
                color: "rgba(0,0,0,0)",
                maxRotation: 0,
                minRotation: 0,
                autoSkip: false,
                padding: 2,
                font: { size: 10, family: WEEK_FONT, lineHeight: 1.15 }
              },
              grid: { display: false }
            },
            y: {
              beginAtZero: true,
              grace: "28%",
              ticks: { color: axisColor("#9a9aa8"), precision: 0, maxTicksLimit: 4, font: { size: 10, family: WEEK_FONT } },
              grid: { color: gridColor() }
            }
          }
        }
      });
      chart.$weekKeys = keys;
      chart.$dayKeys = keys;
      chart.$pointFont = 11;
      chart.$pointInk = canvas.$pointInk;
    } catch (error) {
      canvas.hidden = true;
      if (empty) {
        empty.hidden = false;
        empty.textContent = "그래프를 그리지 못했습니다.";
      }
    }
  }

  root.BotDashChart = {
    install: function (next) {
      deps = next;
    },
    render: function (options) {
      renderChart(options);
    },
    renderMonth: function (options) {
      renderMonthChart(options);
    },
    renderShare: function (options) {
      renderShareChart(options);
    },
    renderWeek: function (canvas, character) {
      renderWeekChart(canvas, character);
    },
    resizeWeeks: function () {
      if (typeof Chart === "undefined") return;
      document.querySelectorAll("[data-week-chart]").forEach(function (canvas) {
        var chart = Chart.getChart(canvas);
        if (chart) chart.resize();
      });
    }
  };
})(window);
