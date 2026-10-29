<?php
/**
 * 로그인 세션은 30일이다. 시스템 임시 폴더의 짧은 청소에 지워지지 않게 별도 경로를 쓴다.
 */
$dir = sys_get_temp_dir() . "/botdash-session-test-" . getmypid();
mkdir($dir, 0700, true);
putenv("BOTDASH_SESSION_DIR=" . $dir);
require_once dirname(__DIR__) . "/auth.php";

$failed = 0;

function expect($label, $actual, $expected) {
    global $failed;
    if ($actual !== $expected) {
        fwrite(STDERR, $label . "\n");
        fwrite(STDERR, "  actual: " . var_export($actual, true) . "\n");
        fwrite(STDERR, "  expected: " . var_export($expected, true) . "\n");
        $failed += 1;
    }
}

$life = 60 * 60 * 24 * 30;
expect("수명 30일", botdash_session_lifetime(), $life);
expect("방금 본 세션은 쿠키를 다시 쓰지 않음", botdash_session_should_touch(1000, 1000 + 86399), false);
expect("하루가 지나면 쿠키를 늘림", botdash_session_should_touch(1000, 1000 + 86400), true);
expect("처음 보는 세션도 기록", botdash_session_should_touch(0, 1000), true);

botdash_session_start();
expect("저장 경로", session_save_path(), $dir);
expect("서버 수명", (int) ini_get("session.gc_maxlifetime"), $life);
expect("쿠키 수명", (int) ini_get("session.cookie_lifetime"), $life);
$params = session_get_cookie_params();
expect("쿠키 파라미터", isset($params["lifetime"]) ? (int) $params["lifetime"] : 0, $life);
expect("쿠키 이름", session_name(), "botdash");
$_SESSION["botdash_seen"] = time();
botdash_touch_session();
expect("하루 안이면 시각을 유지", isset($_SESSION["botdash_seen"]) ? (int) $_SESSION["botdash_seen"] > 0 : false, true);

session_write_close();
foreach (glob($dir . "/sess_*") as $file) @unlink($file);
@rmdir($dir);

if ($failed > 0) {
    fwrite(STDERR, $failed . " failed\n");
    exit(1);
}
echo "ok\n";
