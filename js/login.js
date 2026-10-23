/**
 * 로그인 화면과 세션 확인.
 * 비밀번호는 여기 두지 않고 login.php 로만 보낸다.
 */
(function (root) {
  function create(deps) {
    var state = deps.state;
    var STORAGE = deps.STORAGE;
    var storageGet = deps.storageGet;
    var storageSet = deps.storageSet;

    function ensureSession() {
      return fetch("login.php?view=session", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Accept": "application/json" }
      }).then(function (response) {
        if (!response.ok) return { ok: false };
        return response.json();
      }).then(function (data) {
        return !!(data && data.ok);
      }).catch(function () {
        return false;
      });
    }

    function clearSession() {
      try { localStorage.removeItem(STORAGE.session); } catch (error) {}
      try { sessionStorage.removeItem(STORAGE.session); } catch (error) {}
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
      var days = Math.floor(remain / 86400000);
      var hours = Math.floor((remain % 86400000) / 3600000);
      var minutes = Math.floor((remain % 3600000) / 60000);
      var seconds = Math.floor((remain % 60000) / 1000);
      if (days > 0) return "로그인이 일시 잠겼습니다. " + days + "일 " + hours + "시간 후 다시 시도하세요.";
      if (hours > 0) return "로그인이 일시 잠겼습니다. " + hours + "시간 " + minutes + "분 후 다시 시도하세요.";
      return "로그인이 일시 잠겼습니다. " + minutes + "분 " + seconds + "초 후 다시 시도하세요.";
    }

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
      ensureSession().then(function (ok) {
        if (ok) {
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
          var submit = document.getElementById("loginSubmit");
          if (submit) submit.disabled = true;
          fetch("login.php", {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({ username: username, password: password })
          }).then(function (response) {
            return response.json().then(function (data) {
              return { status: response.status, data: data || {} };
            });
          }).then(function (result) {
            if (submit) submit.disabled = false;
            if (result.status === 200 && result.data.ok) {
              if (remember && remember.checked) storageSet(STORAGE.savedUser, username);
              else try { localStorage.removeItem(STORAGE.savedUser); } catch (error) {}
              try { localStorage.removeItem(STORAGE.attempts); } catch (error) {}
              var dest = null;
              try { dest = sessionStorage.getItem(STORAGE.next); } catch (error) {}
              try { sessionStorage.removeItem(STORAGE.next); } catch (error) {}
              location.replace(safeNext(dest));
              return;
            }
            document.getElementById("username").setAttribute("aria-invalid", "true");
            document.getElementById("password").setAttribute("aria-invalid", "true");
            if (result.status === 503) {
              showAlert("서버에 로그인 설정이 없습니다.");
              return;
            }
            if (result.status === 429) {
              var retry = Number(result.data.retryAfter || 600);
              startLock(Date.now() + retry * 1000);
              return;
            }
            showAlert("아이디 또는 비밀번호가 올바르지 않습니다.");
          }).catch(function () {
            if (submit) submit.disabled = false;
            showAlert("로그인 요청에 실패했습니다.");
          });
        });
      });
    }

    function logoutUser() {
      clearSession();
      fetch("login.php?view=logout", { method: "POST", credentials: "same-origin", cache: "no-store" })
        .finally(function () { location.replace("login.html"); });
    }

    return {
      ensureSession: ensureSession,
      redirectToLogin: redirectToLogin,
      initLogin: initLogin,
      logoutUser: logoutUser
    };
  }

  root.BotDashLogin = { create: create };
})(window);
