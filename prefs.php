<?php
/**
 * 로그인한 아이디의 최근 게시물 설정을 읽고 쓴다.
 * 데스크톱·모바일 한 열 개수와 목록을 펼쳤는지다. data/ 는 브라우저에 열리지 않는다.
 */
require_once __DIR__ . "/auth.php";

function botdash_prefs_user_key($user) {
    $user = (string) $user;
    if ($user === "" || strlen($user) > 80) return "";
    if (preg_match('/[\x00-\x1F]/', $user)) return "";
    return $user;
}

function botdash_prefs_clamp_size($value) {
    if (is_string($value) && preg_match('/^\d+$/', $value)) $value = (int) $value;
    if (!is_int($value) || $value < 1 || $value > 10) return null;
    return $value;
}

function botdash_prefs_clamp_open($value) {
    if ($value === 0 || $value === 1) return (int) $value;
    if (is_string($value) && ($value === "0" || $value === "1")) return (int) $value;
    return null;
}

function botdash_prefs_blank() {
    return array(
        "latestOpen" => null,
        "latestSize" => null,
        "latestSizeMobile" => null
    );
}

function botdash_prefs_normalize_row($row) {
    $out = botdash_prefs_blank();
    if (!is_array($row)) return $out;
    if (array_key_exists("latestOpen", $row)) $out["latestOpen"] = botdash_prefs_clamp_open($row["latestOpen"]);
    if (array_key_exists("latestSize", $row)) $out["latestSize"] = botdash_prefs_clamp_size($row["latestSize"]);
    if (array_key_exists("latestSizeMobile", $row)) $out["latestSizeMobile"] = botdash_prefs_clamp_size($row["latestSizeMobile"]);
    return $out;
}

function botdash_prefs_read_all($path) {
    if (!is_string($path) || !is_file($path)) return array();
    $raw = file_get_contents($path);
    $data = json_decode(is_string($raw) ? $raw : "", true);
    if (!is_array($data)) return array();
    foreach (array_keys($data) as $key) {
        if (!is_string($key)) return array();
    }
    return $data;
}

function botdash_prefs_public($row) {
    $out = botdash_prefs_normalize_row($row);
    $out["ok"] = true;
    return $out;
}

function botdash_prefs_get($path, $user) {
    $key = botdash_prefs_user_key($user);
    $all = botdash_prefs_read_all($path);
    $row = ($key !== "" && isset($all[$key]) && is_array($all[$key])) ? $all[$key] : array();
    return botdash_prefs_public($row);
}

function botdash_prefs_patch($current, $patch) {
    if (!is_array($patch)) return null;
    $next = botdash_prefs_normalize_row($current);
    foreach ($patch as $field => $value) {
        if ($field !== "latestOpen" && $field !== "latestSize" && $field !== "latestSizeMobile") return null;
    }
    if (array_key_exists("latestOpen", $patch)) {
        $open = botdash_prefs_clamp_open($patch["latestOpen"]);
        if ($open === null) return null;
        $next["latestOpen"] = $open;
    }
    if (array_key_exists("latestSize", $patch)) {
        $size = botdash_prefs_clamp_size($patch["latestSize"]);
        if ($size === null) return null;
        $next["latestSize"] = $size;
    }
    if (array_key_exists("latestSizeMobile", $patch)) {
        $size = botdash_prefs_clamp_size($patch["latestSizeMobile"]);
        if ($size === null) return null;
        $next["latestSizeMobile"] = $size;
    }
    return $next;
}

function botdash_prefs_store_row($row) {
    $out = array();
    if ($row["latestOpen"] === 0 || $row["latestOpen"] === 1) $out["latestOpen"] = $row["latestOpen"];
    if (is_int($row["latestSize"])) $out["latestSize"] = $row["latestSize"];
    if (is_int($row["latestSizeMobile"])) $out["latestSizeMobile"] = $row["latestSizeMobile"];
    return $out;
}

function botdash_prefs_write($path, $user, $patch) {
    $key = botdash_prefs_user_key($user);
    if ($key === "" || !is_string($path) || $path === "") return null;
    $dir = dirname($path);
    if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) return null;
    $fp = fopen($path, "c+");
    if (!$fp) return null;
    if (!flock($fp, LOCK_EX)) {
        fclose($fp);
        return null;
    }
    $raw = stream_get_contents($fp);
    $all = json_decode(is_string($raw) ? $raw : "", true);
    if (!is_array($all)) $all = array();
    $keep = array();
    foreach ($all as $name => $row) {
        if (is_string($name)) $keep[$name] = $row;
    }
    $current = isset($keep[$key]) && is_array($keep[$key]) ? $keep[$key] : array();
    $next = botdash_prefs_patch($current, $patch);
    if ($next === null) {
        flock($fp, LOCK_UN);
        fclose($fp);
        return null;
    }
    $keep[$key] = botdash_prefs_store_row($next);
    $body = json_encode($keep, JSON_UNESCAPED_UNICODE);
    if (!is_string($body)) $body = "{}";
    rewind($fp);
    ftruncate($fp, 0);
    fwrite($fp, $body);
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    @chmod($path, 0600);
    return botdash_prefs_public($next);
}

if (defined("BOTDASH_PREFS_LIBRARY")) return;

ini_set("display_errors", "0");
header("X-Robots-Tag: noindex, nofollow, noarchive, nosnippet");
header("Cache-Control: no-store");
header("Content-Type: application/json; charset=utf-8");

if (!botdash_logged_in()) {
    http_response_code(401);
    echo '{"ok":false}';
    exit;
}

list($user, $pass) = botdash_load_secrets();
$path = __DIR__ . "/data/user_prefs.json";
if ($_SERVER["REQUEST_METHOD"] === "GET") {
    $body = json_encode(botdash_prefs_get($path, $user), JSON_UNESCAPED_UNICODE);
    echo is_string($body) ? $body : '{"ok":false}';
    exit;
}
if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    echo '{"ok":false}';
    exit;
}

$raw = file_get_contents("php://input");
$patch = json_decode(is_string($raw) ? $raw : "", true);
$result = botdash_prefs_write($path, $user, $patch);
if ($result === null) {
    http_response_code(400);
    echo '{"ok":false}';
    exit;
}
$body = json_encode($result, JSON_UNESCAPED_UNICODE);
echo is_string($body) ? $body : '{"ok":false}';
