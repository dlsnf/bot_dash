<?php
/**
 * 오늘 글 판정과 댓글 합산. 블로그에는 접속하지 않고 저장해 둔 조각만 본다.
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

$late = new DateTime("2026-10-16 23:30:00", new DateTimeZone("Asia/Seoul"));
$morning = new DateTime("2026-10-16 10:00:00", new DateTimeZone("Asia/Seoul"));
expect("22시간 전은 같은 날이면 오늘", day_key("22시간 전", $late), "2026-10-16");
expect("22시간 전이 자정을 넘으면 어제", day_key("22시간 전", $morning), "2026-10-15");
expect("오늘 문구", day_key("오늘", $morning), "2026-10-16");
expect("어제 문구", day_key("어제", $morning), "2026-10-15");

$rss = file_get_contents(__DIR__ . "/fixtures/rss-day.xml");
expect("RSS 오늘 글", rss_posts_on_day($rss, "2026-10-16"), 1);
expect("RSS 어제 글", rss_posts_on_day($rss, "2026-10-15"), 1);
expect("빈 RSS", rss_posts_on_day("", "2026-10-16"), null);

$list = '{"addDate":"2026. 10. 16."}{"addDate":"20261015"}';
expect("목록 날짜 오늘", count_days($list, '/"addDate"\s*:\s*"([^"]+)"/', "2026-10-16"), 1);

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

if ($failed > 0) {
    fwrite(STDERR, $failed . " failed\n");
    exit(1);
}
fwrite(STDOUT, "ok\n");
