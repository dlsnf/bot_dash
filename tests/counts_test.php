<?php
/**
 * 최근 24시간 글 판정과 댓글 합산. 블로그에는 접속하지 않고 저장해 둔 조각만 본다.
 */
require_once dirname(__DIR__) . "/profile_count.php";

$failed = 0;

function expect($label, $actual, $expected) {
    global $failed;
    if ($actual !== $expected) {
        fwrite(STDERR, $label . "\n");
        $failed += 1;
    }
}

$morning = new DateTime("2026-10-16 10:00:00", new DateTimeZone("Asia/Seoul"));
$nextMorning = new DateTime("2026-10-17 08:00:00", new DateTimeZone("Asia/Seoul"));
$noonAfter = new DateTime("2026-10-17 12:00:00", new DateTimeZone("Asia/Seoul"));
expect("22시간 전은 자정을 넘어도 센다", within_24h("22시간 전", $morning), true);
expect("25시간 전은 뺀다", within_24h("25시간 전", $morning), false);
expect("24시간 전은 포함한다", within_24h("24시간 전", $morning), true);
expect("오늘 문구", within_24h("오늘", $morning), true);
expect("어제 문구는 시각이 없어 뺀다", within_24h("어제", $morning), false);

$rss = file_get_contents(__DIR__ . "/fixtures/rss-day.xml");
expect("오전에는 전날 밤 글도 24시간 안", rss_posts_on_day($rss, $morning), 2);
expect("다음 날 8시에는 전날 9시 글만", rss_posts_on_day($rss, $nextMorning), 1);
expect("다음 날 정오에는 둘 다 지남", rss_posts_on_day($rss, $noonAfter), 0);
expect("빈 RSS", rss_posts_on_day("", $morning), null);

$list = '{"addDate":"2026. 10. 16."}{"addDate":"20261015"}';
expect("날짜만 있는 오늘은 센다", count_days($list, '/"addDate"\s*:\s*"([^"]+)"/', $morning), 1);
expect("날짜만 있는 어제는 뺀다", count_days($list, '/"addDate"\s*:\s*"([^"]+)"/', $nextMorning), 0);

$timed = '{"regTime":"2026-10-16T23:30:00+09:00"}{"regTime":"2026-10-16T09:00:00+09:00"}';
expect("시각이 있으면 저녁 글만 남긴다", count_days($timed, '/"regTime"\s*:\s*"([^"]+)"/', $noonAfter), 1);
$dotted = '{"commentDate":"2026. 10. 16. 23:30"}{"commentDate":"2026. 10. 16. 09:00"}';
expect("점 날짜의 시각", count_days($dotted, '/"commentDate"\s*:\s*"([^"]+)"/', $noonAfter), 1);

$checked = new DateTime("2026-10-17 10:45:00", new DateTimeZone("Asia/Seoul"));
$list = '{"logNo":"10","commentCount":"1","addDate":"12시간 전"}{"logNo":"11","addDate":"2026. 10. 15."}';
$rssTimes = '<item><guid>https://blog.naver.com/dlsnf8478/10</guid><pubDate>Fri, 16 Oct 2026 22:10:00 +0900</pubDate></item>';
$times = naver_post_times($list, $rssTimes);
expect("RSS 시각이 목록 문구를 덮는다", $times["10"], "Fri, 16 Oct 2026 22:10:00 +0900");
expect("목록만 있는 글 시각", $times["11"], "2026. 10. 15.");
expect("24시간 안 글의 댓글은 전부 센다", comments_on_fresh_post($times["10"], 1, $checked), 1);
expect("지난 글의 댓글은 시각이 더 필요하다", comments_on_fresh_post($times["11"], 2, $checked), null);
expect("댓글이 없으면 0", comments_on_fresh_post($times["11"], 0, $checked), 0);

$oldComments = '{"data":{"items":[{"written":"2026. 10. 15. 11:11","children":[{"written":"2026. 10. 14. 23:23","children":[]}]}],"isLast":true,"nextId":0}}';
expect("지난 티스토리 댓글은 0", tistory_comment_window($oldComments, $checked), array(0, true, null));
$reply = '{"data":{"items":[{"written":"2026. 10. 10. 11:15","children":[{"written":"2026. 10. 16. 22:00","children":[]}]}],"isLast":false,"nextId":15}}';
expect("답글만 24시간 안", tistory_comment_window($reply, $checked), array(1, false, "15"));
expect("댓글 없음", tistory_comment_window('{"data":{"items":[],"isLast":true,"nextId":0}}', $checked), array(0, true, null));
expect("댓글 본문이 아니면 비움", tistory_comment_window("{}", $checked), null);

expect("댓글 속성", naver_comment_count('commentCount="4"'), 4);
expect("댓글 JSON", naver_comment_count('{"commentCount":7}'), 7);
expect("댓글 이스케이프 JSON", naver_comment_count('{\\"commentCount\\":3}'), 3);
expect("댓글 없음", naver_comment_count("<div></div>"), null);

$counts = array();
$page1 = file_get_contents(__DIR__ . "/fixtures/tistory-page-1.html");
$page2 = file_get_contents(__DIR__ . "/fixtures/tistory-page-2.html");
expect("1페이지에 다음 링크", tistory_has_next_page($page1, 1), true);
expect("2페이지는 끝", tistory_has_next_page($page2, 2), false);
$added1 = tistory_comment_page($page1, $counts);
$added2 = tistory_comment_page($page2, $counts);
expect("1페이지 새 글", $added1, 2);
expect("2페이지는 중복을 빼고 하나", $added2, 1);
expect("빈 칸은 0으로 합산", tistory_comment_total($counts, 3), 5);
expect("글 수보다 적으면 합을 비움", tistory_comment_total($counts, 4), null);

$historyNow = new DateTime("2026-10-18 15:00:00", new DateTimeZone("Asia/Seoul"));
$history = array(
    "2026-10-04" => array("https://blog.naver.com/a" => 1),
    "2026-10-05" => array("https://blog.naver.com/a" => 2),
    "2026-10-18" => array("https://blog.naver.com/a" => 3)
);
$history = history_apply($history, "https://blog.naver.com/a", "2026-10-18", 9, $historyNow);
expect("오늘 방문자만 덮어쓴다", $history["2026-10-18"]["https://blog.naver.com/a"], 9);
expect("13일 전 기록은 남긴다", $history["2026-10-05"]["https://blog.naver.com/a"], 2);
expect("14일 전 기록은 뺀다", isset($history["2026-10-04"]), false);
$history = history_apply($history, "https://blog.naver.com/b", "2026-10-18", 4, $historyNow);
expect("같은 날의 다른 블로그", $history["2026-10-18"]["https://blog.naver.com/b"], 4);
$untouched = history_apply($history, "https://blog.naver.com/a", "2026-10-17", 8, $historyNow);
expect("지난 날짜는 고치지 않는다", isset($untouched["2026-10-17"]), false);
$rejected = history_apply($history, "https://blog.naver.com/a", "2026-10-18", -1, $historyNow);
expect("음수 방문자는 거절", $rejected["2026-10-18"]["https://blog.naver.com/a"], 9);

if ($failed > 0) {
    fwrite(STDERR, $failed . " failed\n");
    exit(1);
}
fwrite(STDOUT, "ok\n");
