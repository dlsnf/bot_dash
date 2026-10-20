<?php
/**
 * 브라우저 없이 블로거 전체 페이지뷰를 data/blogger_totals.json 에 남긴다.
 * 웹으로 열리지 않는다. 사이트가 있는 서버에서 한국시간 23:50 에 한 번 돌린다.
 *
 *   php blogger_close.php
 *
 * 서버 시계가 한국시간이면 crontab 은 이렇다.
 *   50 23 * * * /usr/bin/php /실제/경로/blogger_close.php
 * 서버 시계가 다른 시간이면 줄 앞에 CRON_TZ=Asia/Seoul 을 붙인다.
 */
if (PHP_SAPI !== "cli") {
    http_response_code(404);
    header("Content-Type: text/plain; charset=utf-8");
    exit;
}

define("BOTDASH_PROFILE_LIBRARY", true);
define("BOTDASH_CONTENT_LIBRARY", true);
require __DIR__ . "/profile.php";
require __DIR__ . "/content.php";

function blogger_close_targets() {
    $urls = array();
    $dir = __DIR__ . "/characters";
    foreach (botdash_character_files($dir) as $file) {
        $text = @file_get_contents($dir . "/" . $file);
        if (!is_string($text)) continue;
        foreach (blogger_close_urls_from($text) as $url) $urls[$url] = true;
    }
    $keys = array_keys($urls);
    sort($keys, SORT_STRING);
    return $keys;
}

$day = seoul_clock()->format("Y-m-d");
fwrite(STDOUT, $day . " 블로거 마감\n");
$failed = 0;
$targets = blogger_close_targets();
if (!$targets) fwrite(STDOUT, "블로거 주소가 없습니다.\n");
foreach ($targets as $url) {
    $name = blogspot_name((string) parse_url($url, PHP_URL_HOST));
    $total = $name === "" ? null : blogger_alltime($name);
    if (!is_int($total)) {
        fwrite(STDOUT, $url . " 전체를 읽지 못함\n");
        continue;
    }
    blogger_record_total($url, $total);
    $raw = @file_get_contents(blogger_totals_path());
    $data = json_decode(is_string($raw) ? $raw : "", true);
    $saved = is_array($data) && isset($data[$day][$url]) ? $data[$day][$url] : null;
    if (is_string($saved) && preg_match('/^\d{1,12}$/', $saved)) $saved = (int) $saved;
    if (!is_int($saved) || $saved < $total) {
        fwrite(STDOUT, $url . " 기록을 쓰지 못함\n");
        $failed += 1;
        continue;
    }
    $today = blogger_today_count(is_array($data) ? $data : array(), $url, $saved);
    $todayText = is_int($today) ? (string) $today : "없음";
    fwrite(STDOUT, $url . " 전체 " . $saved . " 오늘 " . $todayText . "\n");
}
exit($failed > 0 ? 1 : 0);
