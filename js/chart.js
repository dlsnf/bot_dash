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
      if (!reel || replay || rise) {
        var fresh = document.createElement("span");
        fresh.className = "odometer";
        if (reel) reel.replaceWith(fresh);
        else el.appendChild(fresh);
        reel = fresh;
      }
      el._chartShown = null;
      if (rise) deps.paintStatic(reel, 0);
      else deps.setOdometer(reel, row.todayVisitors || 0);
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
    var existed = !!deps.state.chart;
    var rise = !deps.reducedMotion && (!!(options && options.rise) || !existed);
    if (deps.state.chart) {
      deps.state.chart.destroy();
      deps.state.chart = null;
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
      deps.state.chart = new Chart(canvas, {
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
                label: function (item) { return "오늘 방문자 " + deps.formatNumber(item.parsed.y); }
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
      deps.state.chart.$rise = rise;
      deps.state.chart.$chartRows = rows;
      syncChartValues(deps.state.chart, rows, !!(options && options.replay), rise);
      followChartValues(deps.state.chart);
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
