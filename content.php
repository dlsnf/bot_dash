<?php
/**
 * 로그인한 브라우저만 캐릭터 마크다운과 stats.json 을 읽게 한다.
 * 주소의 f 는 characters/이름.md, data/stats.json, data/history.json 만 허용한다.
 */
ini_set("display_errors", "0");
header("X-Robots-Tag: noindex, nofollow, noarchive, nosnippet");
header("Cache-Control: private, no-store");
require __DIR__ . "/auth.php";

function botdash_content_deny($status) {
    http_response_code($status);
    header("Content-Type: text/plain; charset=utf-8");
    exit;
}

if (!botdash_logged_in()) botdash_content_deny(401);
$rel = isset($_GET["f"]) ? (string) $_GET["f"] : "";
if ($rel === "data/stats.json" || $rel === "data/history.json") {
    $path = __DIR__ . "/" . $rel;
    $type = "application/json; charset=utf-8";
} elseif (preg_match('/^characters\/[A-Za-z0-9_-]+\.md$/', $rel)) {
    $path = __DIR__ . "/" . $rel;
    $type = "text/plain; charset=utf-8";
} else {
    botdash_content_deny(404);
}
$root = realpath(__DIR__);
$target = realpath($path);
$prefix = $root . DIRECTORY_SEPARATOR;
if ($root === false || $target === false || strpos($target, $prefix) !== 0 || !is_file($target)) {
    botdash_content_deny(404);
}
header("Content-Type: " . $type);
readfile($target);
