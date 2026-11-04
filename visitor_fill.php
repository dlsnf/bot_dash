<?php
/**
 * 어제 마감에 빈 칸이 있으면 아침에도 채울 수 있는 것만 적는다.
 * 웹으로 열리지 않는다. 23:50 마감이 서버가 꺼져 있어 빠졌을 때 쓴다.
 *
 *   php visitor_fill.php
 *
 * 티스토리 어제 방문자는 카운터의 어제 숫자다.
 * 블로거 어제 방문자는 저장된 어제 전체에서 그제 전체를 뺀 값이다.
 * 오늘 아침의 전체 페이지뷰로는 어제를 만들지 않는다.
 * 네이버 어제 방문자는 공개 주소가 없어서 비워 둔다.
 * 글은 피드에 남은 어제 글이다. 블로거 댓글도 어제 0시부터 오늘 0시 전 피드다.
 * 이미 숫자가 있는 칸은 고치지 않는다.
 *
 * 서버 시계가 한국시간이면 crontab 은 이렇다.
 *   10 8 * * * /usr/bin/php /실제/경로/visitor_fill.php
 * 23:50 의 visitor_close.php 는 그대로 둔다.
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

$day = seoul_clock();
$day->modify("-1 day");
fwrite(STDOUT, $day->format("Y-m-d") . " 어제 빈 칸 보충\n");
$failed = 0;
$targets = dashboard_blog_urls();
if (!$targets) fwrite(STDOUT, "집계할 블로그가 없습니다.\n");
foreach ($targets as $url) {
    list($wrote, $visitors, $posts, $comments, $missing) = visitor_fill_one($url);
    if ($missing && (is_int($visitors) || is_int($posts) || is_int($comments)) && !$wrote) $failed += 1;
    fwrite(STDOUT, visitor_fill_line($url, $wrote, $visitors, $posts, $comments, $missing) . "\n");
}
exit($failed > 0 ? 1 : 0);
