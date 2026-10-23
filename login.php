<?php
/**
 * 아이디와 비밀번호는 /etc/bot_dash.env 또는 컨테이너 환경 변수에만 있다.
 * view=session 은 로그인 여부, view=logout 은 세션을 지운다.
 */
ini_set("display_errors", "0");
header("X-Robots-Tag: noindex, nofollow, noarchive, nosnippet");
header("Cache-Control: no-store");
header("Content-Type: application/json; charset=utf-8");
require __DIR__ . "/auth.php";

function botdash_json($status, $payload) {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function botdash_lock_seconds($fails) {
    // 5번마다 잠근다. 처음 10분, 다음 1시간, 그 다음은 하루. 횟수는 성공하기 전까지 남긴다.
    if ($fails < 5 || $fails % 5 !== 0) return 0;
    $round = intdiv($fails, 5);
    if ($round === 1) return 600;
    if ($round === 2) return 3600;
    return 86400;
}

$view = isset($_GET["view"]) ? (string) $_GET["view"] : "";
if ($view === "session") {
    botdash_json(200, array("ok" => botdash_logged_in()));
}
if ($view === "logout") {
    if ($_SERVER["REQUEST_METHOD"] !== "POST") botdash_json(405, array("ok" => false));
    botdash_end_session();
    botdash_json(200, array("ok" => true));
}
if ($_SERVER["REQUEST_METHOD"] !== "POST") botdash_json(405, array("ok" => false));

$lock = botdash_lock_state();
$now = time();
if ($lock["until"] > $now) {
    botdash_json(429, array("ok" => false, "retryAfter" => $lock["until"] - $now));
}

$raw = file_get_contents("php://input");
$body = json_decode($raw ? $raw : "", true);
if (!is_array($body)) $body = array();
$username = isset($body["username"]) ? (string) $body["username"] : "";
$password = isset($body["password"]) ? (string) $body["password"] : "";
list($expectUser, $expectPass) = botdash_load_secrets();
if ($expectUser === "" || $expectPass === "") {
    botdash_json(503, array("ok" => false, "error" => "config"));
}
$userOk = hash_equals($expectUser, $username);
$passOk = hash_equals($expectPass, $password);
if (!$userOk || !$passOk) {
    $fails = $lock["fails"] + 1;
    $seconds = botdash_lock_seconds($fails);
    $until = $seconds > 0 ? $now + $seconds : 0;
    botdash_write_lock($fails, $until);
    if ($until > $now) botdash_json(429, array("ok" => false, "retryAfter" => $until - $now));
    botdash_json(401, array("ok" => false, "fails" => $fails % 5));
}

botdash_clear_lock();
botdash_session_start();
session_regenerate_id(true);
$_SESSION["botdash_ok"] = true;
$_SESSION["botdash_mark"] = botdash_mark($expectUser, $expectPass);
botdash_json(200, array("ok" => true));
