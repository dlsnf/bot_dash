<?php
/**
 * 최근 게시물 개수와 접힘 상태를 아이디별로 저장한다. 네트워크는 쓰지 않는다.
 */
define("BOTDASH_PREFS_LIBRARY", true);
require_once dirname(__DIR__) . "/prefs.php";

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

$dir = sys_get_temp_dir() . "/botdash-prefs-test-" . getmypid();
mkdir($dir, 0700, true);
$path = $dir . "/user_prefs.json";

$empty = botdash_prefs_get($path, "ssi");
expect("없는 파일은 성공", $empty["ok"], true);
expect("접힘 없음", $empty["latestOpen"], null);
expect("데스크톱 개수 없음", $empty["latestSize"], null);
expect("모바일 개수 없음", $empty["latestSizeMobile"], null);

$saved = botdash_prefs_write($path, "ssi", array(
    "latestOpen" => 0,
    "latestSize" => 5,
    "latestSizeMobile" => 3
));
expect("저장 성공", $saved["ok"], true);
expect("접힘 저장", $saved["latestOpen"], 0);
expect("데스크톱 저장", $saved["latestSize"], 5);
expect("모바일 저장", $saved["latestSizeMobile"], 3);

$again = botdash_prefs_get($path, "ssi");
expect("다시 읽은 접힘", $again["latestOpen"], 0);
expect("다시 읽은 개수", $again["latestSize"], 5);

$other = botdash_prefs_write($path, "other", array("latestSize" => 8));
expect("다른 아이디", $other["latestSize"], 8);
expect("다른 아이디는 접힘을 비워 둠", $other["latestOpen"], null);
$kept = botdash_prefs_get($path, "ssi");
expect("다른 아이디가 기존 값을 지우지 않음", $kept["latestOpen"], 0);
expect("다른 아이디가 개수를 지우지 않음", $kept["latestSize"], 5);

$partial = botdash_prefs_write($path, "ssi", array("latestOpen" => 1));
expect("접힘만 바꿈", $partial["latestOpen"], 1);
expect("개수는 유지", $partial["latestSize"], 5);
expect("모바일 개수는 유지", $partial["latestSizeMobile"], 3);

expect("11개는 거절", botdash_prefs_write($path, "ssi", array("latestSize" => 11)), null);
expect("0개는 거절", botdash_prefs_write($path, "ssi", array("latestSize" => 0)), null);
expect("문자 개수는 거절", botdash_prefs_write($path, "ssi", array("latestSizeMobile" => "nope")), null);
expect("접힘 값은 0과 1", botdash_prefs_write($path, "ssi", array("latestOpen" => 2)), null);
expect("모르는 항목은 거절", botdash_prefs_write($path, "ssi", array("theme" => "glass")), null);
expect("빈 아이디는 거절", botdash_prefs_write($path, "", array("latestSize" => 4)), null);
expect("거절 뒤에도 값 유지", botdash_prefs_get($path, "ssi")["latestSize"], 5);

$mode = fileperms($path);
expect("설정 파일은 소유자만", $mode === false ? -1 : ($mode & 0777), 0600);

@unlink($path);
@rmdir($dir);

if ($failed > 0) {
    fwrite(STDERR, $failed . " failed\n");
    exit(1);
}
echo "ok\n";
