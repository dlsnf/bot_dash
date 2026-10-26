<?php
/**
 * 브라우저 없이 오늘 방문자를 data/visitor_days.json 에 남긴다.
 * 웹으로 열리지 않는다. 사이트가 있는 서버에서 한국시간 23:50 에 한 번 돌린다.
 *
 *   php visitor_close.php
 *
 * 네이버는 오늘 방문자만, 티스토리는 카운터의 오늘 숫자만 적는다.
 * 블로거는 전체 페이지뷰를 data/blogger_totals.json 에 남기고, 어제 마감과의 차이를 적는다.
 * 읽지 못한 블로그는 0으로 적지 않는다. 지난 날짜는 고치지 않는다.
 *
 * 서버 시계가 한국시간이면 crontab 은 이렇다.
 *   50 23 * * * /usr/bin/php /실제/경로/visitor_close.php
 * 서버 시계가 다른 시간이면 줄 앞에 CRON_TZ=Asia/Seoul 을 붙인다.
 * blogger_close.php 와 같은 시각에 둘 다 두면 블로거를 두 번 읽는다. 이 줄 하나만 둔다.
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

function visitor_close_targets() {
    $urls = array();
    $dir = __DIR__ . "/characters";
    foreach (botdash_character_files($dir) as $file) {
        $text = @file_get_contents($dir . "/" . $file);
        if (!is_string($text)) continue;
        foreach (visitor_urls_from($text) as $url) $urls[$url] = true;
    }
    $keys = array_keys($urls);
    sort($keys, SORT_STRING);
    return $keys;
}

function visitor_close_naver($url) {
    $id = naver_blog_id($url);
    if ($id === "") return null;
    list($status, $body) = fetch_url(
        "https://m.blog.naver.com/api/blogs/" . rawurlencode($id),
        BLOG_HTML_LIMIT,
        "naver_host_ok",
        array("Referer: https://m.blog.naver.com/" . rawurlencode($id)),
        true,
        6,
        true
    );
    $visitors = naver_visitor_counts($status, $body);
    return $visitors[0];
}

function visitor_close_tistory($url) {
    $host = host_of($url);
    if (!preg_match('/^[a-z0-9-]+\.tistory\.com$/', $host)) return null;
    $visitors = tistory_visitors($host);
    return $visitors[0];
}

function visitor_close_blogger($url) {
    $name = blogspot_name(host_of($url));
    if ($name === "") return null;
    $total = blogger_alltime($name);
    if (!is_int($total)) return null;
    return blogger_record_total($url, $total);
}

$day = seoul_clock()->format("Y-m-d");
fwrite(STDOUT, $day . " 방문자 마감\n");
$failed = 0;
$targets = visitor_close_targets();
if (!$targets) fwrite(STDOUT, "집계할 블로그가 없습니다.\n");
foreach ($targets as $url) {
    $kind = blog_kind($url);
    if ($kind === "naver") $today = visitor_close_naver($url);
    elseif ($kind === "tistory") $today = visitor_close_tistory($url);
    elseif ($kind === "blogger") $today = visitor_close_blogger($url);
    else $today = null;
    if (!is_int($today)) {
        fwrite(STDOUT, $url . " 오늘 없음\n");
        continue;
    }
    if (!visitor_record_day($url, $today)) {
        fwrite(STDOUT, $url . " 기록을 쓰지 못함\n");
        $failed += 1;
        continue;
    }
    fwrite(STDOUT, $url . " 오늘 " . $today . "\n");
}
exit($failed > 0 ? 1 : 0);
