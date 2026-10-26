/**
 * 통계 탭의 막대 그래프, 이번 달 선 그래프, 전체 비중 원, 막대 위 숫자.
 * Chart.js가 없는 화면에서는 그리지 않는다.
 */
(function (root) {
  var deps = null;

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

  function totalBarColor(row) {
    var value = row.totalVisitors;
    if (value == null || !isFinite(value)) return "#3a3a48";
    if (value === 0) return "#6e6e80";
    return "#3dbea5";
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
            backgroundColor: rows.map(spec.color),
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
                label: function (item) { return spec.label + " " + deps.formatNumber(item.parsed.y); }
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

  function lineColor(id) {
    var found = 0;
    var index = 0;
    (deps.state.characters || []).forEach(function (row) {
      if (!row.ok || !deps.countableBlogs(row).length) return;
      if (row.id === id) found = index;
      index += 1;
    });
    return LINE_COLORS[found % LINE_COLORS.length];
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
    var monthLabel = Number(todayKey.slice(5, 7)) + "월 ";
    try {
      var chart = new Chart(canvas, {
        type: "line",
        data: {
          labels: keys.map(function (key) { return String(Number(key.slice(8))); }),
          datasets: rows.map(function (row) {
            var color = lineColor(row.id);
            var data = keys.map(function (key, index) {
              if (index === last) return liveDayTotal(row);
              return closedDayTotal(row, days[key]);
            });
            return {
              label: row.name,
              data: data,
              borderColor: color,
              backgroundColor: color,
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
              labels: { color: "#c3c3cc", boxWidth: 12, boxHeight: 12, padding: 14, font: { size: 12 } }
            },
            tooltip: {
              backgroundColor: "#11111d",
              titleColor: "#ededf3",
              bodyColor: "#c3c3cc",
              borderColor: "#2c2c3a",
              borderWidth: 1,
              callbacks: {
                title: function (items) {
                  var item = items && items[0];
                  if (!item) return "";
                  var key = keys[item.dataIndex] || "";
                  return monthLabel + Number(key.slice(8)) + "일" + (item.dataIndex === last ? " 진행 중" : "");
                },
                label: function (item) {
                  if (!dayNumber(item.parsed.y)) return item.dataset.label + " 없음";
                  return item.dataset.label + " " + deps.formatNumber(item.parsed.y);
                }
              }
            }
          },
          layout: { padding: { top: 8, left: 4, right: 12 } },
          scales: {
            x: {
              ticks: { color: "#c3c3cc", maxRotation: 0, minRotation: 0, autoSkip: true, font: { size: 11 } },
              grid: { display: false }
            },
            y: { beginAtZero: true, grace: "18%", ticks: { color: "#9a9aa8", precision: 0 }, grid: { color: "#2c2c3a" } }
          }
        }
      });
      deps.state.monthChart = chart;
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
    ctx.fillStyle = "rgba(17, 17, 29, 0.94)";
    fillRounded(ctx, boxLeft, boxTop, boxW + 10, 32, 7);
    drawShareText(ctx, item, textX, textY, side > 0 ? "left" : (side < 0 ? "right" : "center"), "#ededf3", "#c3c3cc");
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
            backgroundColor: rows.map(function (row) { return lineColor(row.id); }),
            borderColor: "#11111d",
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
              backgroundColor: "#11111d",
              titleColor: "#ededf3",
              bodyColor: "#c3c3cc",
              borderColor: "#2c2c3a",
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
        var text = key.slice(5).replace("-", "/") + " ";
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
    var color = lineColor(character.id);
    var existing = Chart.getChart(canvas);
    if (existing) {
      existing.$weekKeys = keys;
      existing.data.labels = keys.map(function (key) { return String(Number(key.slice(8))); });
      existing.data.datasets[0].data = data;
      existing.data.datasets[0].borderColor = color;
      existing.data.datasets[0].backgroundColor = color;
      existing.update("none");
      return;
    }
    try {
      var chart = new Chart(canvas, {
        type: "line",
        data: {
          labels: keys.map(function (key) { return String(Number(key.slice(8))); }),
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
              backgroundColor: "#11111d",
              titleColor: "#ededf3",
              bodyColor: "#c3c3cc",
              borderColor: "#2c2c3a",
              borderWidth: 1,
              callbacks: {
                title: function (items) {
                  var item = items && items[0];
                  if (!item) return "";
                  var stored = item.chart.$weekKeys || [];
                  var key = stored[item.dataIndex] || "";
                  return Number(key.slice(5, 7)) + "월 " + Number(key.slice(8)) + "일" + (item.dataIndex === stored.length - 1 ? " 진행 중" : "");
                },
                label: function (item) {
                  if (!dayNumber(item.parsed.y)) return "없음";
                  return deps.formatNumber(item.parsed.y);
                }
              }
            }
          },
          layout: { padding: { top: 8, right: 4, left: 0 } },
          scales: {
            x: { ticks: { color: "#9a9aa8", maxRotation: 0, autoSkip: true, font: { size: 10 } }, grid: { display: false } },
            y: { beginAtZero: true, grace: "20%", ticks: { color: "#9a9aa8", precision: 0, maxTicksLimit: 4, font: { size: 10 } }, grid: { color: "#2c2c3a" } }
          }
        }
      });
      chart.$weekKeys = keys;
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
