<?php
/**
 * 로그인 비밀은 웹으로 내려가지 않는다.
 * 컨테이너 환경 변수 BOTDASH_USER, BOTDASH_PASSWORD 가 있으면 그 값을 쓴다.
 * 없으면 /etc/bot_dash.env 를 읽는다. BOTDASH_ENV 로 파일 경로를 바꿀 수 있다.
 */
function botdash_env_value($value) {
    $value = trim($value);
    $len = strlen($value);
    if ($len >= 2) {
        $quote = $value[0];
        if (($quote === '"' || $quote === "'") && $value[$len - 1] === $quote) {
            return substr($value, 1, -1);
        }
    }
    return $value;
}

function botdash_env_path() {
    $path = getenv("BOTDASH_ENV");
    if (!is_string($path) || $path === "") $path = "/etc/bot_dash.env";
    return $path;
}

function botdash_env_vars() {
    $vars = array();
    $path = botdash_env_path();
    if (is_readable($path)) {
        $lines = file($path, FILE_IGNORE_NEW_LINES);
        if (is_array($lines)) {
            foreach ($lines as $line) {
                $line = trim($line);
                if ($line === "" || $line[0] === "#") continue;
                $eq = strpos($line, "=");
                if ($eq === false) continue;
                $key = trim(substr($line, 0, $eq));
                if ($key === "") continue;
                $vars[$key] = botdash_env_value(substr($line, $eq + 1));
            }
        }
    }
    foreach (array($_ENV, $_SERVER) as $source) {
        if (!is_array($source)) continue;
        foreach ($source as $key => $value) {
            if (!is_string($key) || !is_string($value) || $value === "") continue;
            if (strncmp($key, "BOTDASH_", 8) !== 0 && strncmp($key, "BLOGGER_", 8) !== 0) continue;
            $vars[$key] = $value;
        }
    }
    return $vars;
}

function botdash_load_secrets() {
    $envUser = getenv("BOTDASH_USER");
    $envPass = getenv("BOTDASH_PASSWORD");
    if (is_string($envUser) && $envUser !== "" && is_string($envPass) && $envPass !== "") {
        return array($envUser, $envPass);
    }
    $vars = botdash_env_vars();
    $user = isset($vars["BOTDASH_USER"]) ? $vars["BOTDASH_USER"] : "";
    $pass = isset($vars["BOTDASH_PASSWORD"]) ? $vars["BOTDASH_PASSWORD"] : "";
    return array($user, $pass);
}

function botdash_cookie_path() {
    $dir = str_replace("\\", "/", dirname(isset($_SERVER["SCRIPT_NAME"]) ? $_SERVER["SCRIPT_NAME"] : "/"));
    if ($dir === "/" || $dir === "." || $dir === "") return "/";
    return rtrim($dir, "/") . "/";
}

function botdash_session_start() {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $https = (!empty($_SERVER["HTTPS"]) && $_SERVER["HTTPS"] !== "off")
        || (isset($_SERVER["SERVER_PORT"]) && (int) $_SERVER["SERVER_PORT"] === 443);
    session_name("botdash");
    session_set_cookie_params(array(
        "lifetime" => 60 * 60 * 24 * 30,
        "path" => botdash_cookie_path(),
        "httponly" => true,
        "samesite" => "Lax",
        "secure" => $https
    ));
    session_start();
}

function botdash_mark($user, $pass) {
    return hash("sha256", $user . "\0" . $pass);
}

function botdash_logged_in() {
    botdash_session_start();
    if (empty($_SESSION["botdash_ok"]) || empty($_SESSION["botdash_mark"])) return false;
    list($user, $pass) = botdash_load_secrets();
    if ($user === "" || $pass === "") return false;
    return hash_equals(botdash_mark($user, $pass), (string) $_SESSION["botdash_mark"]);
}

function botdash_client_key() {
    $ip = isset($_SERVER["REMOTE_ADDR"]) ? (string) $_SERVER["REMOTE_ADDR"] : "";
    return hash("sha256", $ip);
}

function botdash_lock_file() {
    return sys_get_temp_dir() . "/botdash-login-" . botdash_client_key() . ".json";
}

function botdash_lock_state() {
    $path = botdash_lock_file();
    if (!is_readable($path)) return array("fails" => 0, "until" => 0);
    $data = json_decode((string) file_get_contents($path), true);
    if (!is_array($data)) return array("fails" => 0, "until" => 0);
    return array(
        "fails" => isset($data["fails"]) ? (int) $data["fails"] : 0,
        "until" => isset($data["until"]) ? (int) $data["until"] : 0
    );
}

function botdash_write_lock($fails, $until) {
    $path = botdash_lock_file();
    file_put_contents($path, json_encode(array("fails" => $fails, "until" => $until)), LOCK_EX);
    @chmod($path, 0600);
}

function botdash_clear_lock() {
    $path = botdash_lock_file();
    if (is_file($path)) @unlink($path);
}
