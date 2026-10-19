<?php
/**
 * characters 폴더의 .md 목록. 허용된 파일명만, 하위 폴더는 빼고, 이름순이다.
 */
define("BOTDASH_CONTENT_LIBRARY", true);
require_once dirname(__DIR__) . "/content.php";

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

function remove_tree($dir) {
    if (!is_dir($dir)) return;
    $items = scandir($dir);
    if (!is_array($items)) return;
    foreach ($items as $item) {
        if ($item === "." || $item === "..") continue;
        $path = $dir . DIRECTORY_SEPARATOR . $item;
        if (is_dir($path)) remove_tree($path);
        else unlink($path);
    }
    rmdir($dir);
}

$dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . "botdash-chars-" . getmypid();
remove_tree($dir);
mkdir($dir);
mkdir($dir . DIRECTORY_SEPARATOR . "nested");
file_put_contents($dir . DIRECTORY_SEPARATOR . "na_nuri.md", "n");
file_put_contents($dir . DIRECTORY_SEPARATOR . "kang_doyun.md", "k");
file_put_contents($dir . DIRECTORY_SEPARATOR . "ok-name_1.md", "o");
file_put_contents($dir . DIRECTORY_SEPARATOR . "bad name.md", "b");
file_put_contents($dir . DIRECTORY_SEPARATOR . "notes.txt", "t");
file_put_contents($dir . DIRECTORY_SEPARATOR . ".secret.md", "s");
file_put_contents($dir . DIRECTORY_SEPARATOR . "UPPER.MD", "u");
file_put_contents($dir . DIRECTORY_SEPARATOR . "nested" . DIRECTORY_SEPARATOR . "skip.md", "x");
mkdir($dir . DIRECTORY_SEPARATOR . "fake.md");

$names = botdash_character_files($dir);
expect("허용된 md만 이름순", $names, array("kang_doyun.md", "na_nuri.md", "ok-name_1.md"));
expect("없는 폴더는 빈 목록", botdash_character_files($dir . "-missing"), array());

remove_tree($dir);

if ($failed > 0) {
    fwrite(STDERR, $failed . " failed\n");
    exit(1);
}
fwrite(STDOUT, "ok\n");
