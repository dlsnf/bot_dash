/**
 * 숫자 릴. 카드, 상단 합계, 오늘 추가분, 그래프 숫자가 같이 쓴다.
 * 올라가는 시간은 아래 네 상수만 본다.
 */
(function (root) {
  var COUNT_UP_MIN_MS = 1100;
  var COUNT_UP_MAX_MS = 1300;
  var COUNT_UP_BASE_MS = 1000;
  var COUNT_UP_SCALE = 180;
  var numberFormat = new Intl.NumberFormat("ko-KR");
  var reducedMotion = false;

  try { reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (error) {}

  function formatNumber(value) {
    if (value == null || !isFinite(Number(value))) return "—";
    return numberFormat.format(value);
  }

  function countDigits(from, to) {
    var max = Math.max(Math.abs(from), Math.abs(to));
    if (max < 1) return 1;
    return Math.max(1, Math.ceil(Math.log(max + 1) / Math.log(10)));
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
    el.classList.remove("is-up");
    el.classList.add("is-animating", "is-settled");
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

  function paintStatic(el, value) {
    if (el._reelTimer) clearTimeout(el._reelTimer);
    el._reelTimer = 0;
    el._reelBusy = false;
    el._reelCurrent = value;
    mountReel(el, value, digitColumns(value, value), 0);
    el.classList.remove("is-up", "is-animating");
    el.classList.add("is-settled");
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

  function setOdometer(el, value, instant) {
    if (!el) return;
    var numeric = value == null || !isFinite(Number(value)) ? null : Math.max(0, Math.round(Number(value)));
    el._reelWant = numeric;
    if (instant) {
      if (numeric == null) clearReel(el);
      else paintStatic(el, numeric);
      return;
    }
    commitReel(el, numeric);
  }

  function setHostedOdometer(parent, value, prefix, instant) {
    if (!parent) return;
    var label = prefix || "";
    var numeric = value == null || !isFinite(Number(value)) ? null : Math.max(0, Math.round(Number(value)));
    parent._countValue = numeric;
    parent._countPrefix = label;
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
    setOdometer(reel, numeric, instant);
  }

  root.BotDashReel = {
    formatNumber: formatNumber,
    reducedMotion: reducedMotion,
    paintStatic: paintStatic,
    setOdometer: setOdometer,
    setHostedOdometer: setHostedOdometer
  };
})(window);
