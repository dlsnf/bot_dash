/**
 * 통계 탭의 막대 그래프와 막대 위 숫자.
 * Chart.js가 없는 화면에서는 그리지 않는다.
 */
(function (root) {
  var deps = null;

  function barColor(character) {
    var level = deps.visitorLevel(character.todayVisitors);
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

  root.BotDashChart = {
    install: function (next) {
      deps = next;
    },
    render: function (options) {
      renderChart(options);
    }
  };
})(window);
