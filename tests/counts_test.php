<?php
/**
 * 한국시간 오늘 글 판정과 댓글 합산. 블로그에는 접속하지 않고 저장해 둔 조각만 본다.
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
expect("22시간 전은 어제라 뺀다", on_seoul_today("22시간 전", $morning), false);
expect("25시간 전은 뺀다", on_seoul_today("25시간 전", $morning), false);
expect("24시간 전도 어제라 뺀다", on_seoul_today("24시간 전", $morning), false);
expect("5시간 전은 오늘", on_seoul_today("5시간 전", $morning), true);
expect("오늘 문구", on_seoul_today("오늘", $morning), true);
expect("어제 문구는 뺀다", on_seoul_today("어제", $morning), false);
expect("자정은 오늘", on_seoul_today("2026-10-16T00:00:00+09:00", $morning), true);
expect("전날 23시 59분은 뺀다", on_seoul_today("2026-10-15T23:59:59+09:00", $morning), false);

$rss = file_get_contents(__DIR__ . "/fixtures/rss-day.xml");
$night = new DateTime("2026-10-16 23:40:00", new DateTimeZone("Asia/Seoul"));
expect("오전에는 오늘 9시 글만 센다", rss_posts_on_day($rss, $morning), 1);
expect("같은 날 밤 RSS도 오늘 글만", rss_posts_on_day($rss, $night), 1);
expect("다음 날 8시에는 전날 글을 뺀다", rss_posts_on_day($rss, $nextMorning), 0);
expect("다음 날 정오에는 전날 글을 뺀다", rss_posts_on_day($rss, $noonAfter), 0);
expect("빈 RSS", rss_posts_on_day("", $morning), null);

$list = '{"addDate":"2026. 10. 16."}{"addDate":"20261015"}';
expect("날짜만 있는 오늘은 센다", count_days($list, '/"addDate"\s*:\s*"([^"]+)"/', $morning), 1);
expect("날짜만 있는 어제는 뺀다", count_days($list, '/"addDate"\s*:\s*"([^"]+)"/', $nextMorning), 0);

$timed = '{"regTime":"2026-10-16T23:30:00+09:00"}{"regTime":"2026-10-16T09:00:00+09:00"}';
expect("다음 날이면 전날 시각 글을 뺀다", count_days($timed, '/"regTime"\s*:\s*"([^"]+)"/', $noonAfter), 0);
expect("같은 날 밤에는 시각이 있는 글 둘", count_days($timed, '/"regTime"\s*:\s*"([^"]+)"/', $night), 2);
$dotted = '{"commentDate":"2026. 10. 16. 23:30"}{"commentDate":"2026. 10. 16. 09:00"}';
expect("점 날짜도 다음 날이면 뺀다", count_days($dotted, '/"commentDate"\s*:\s*"([^"]+)"/', $noonAfter), 0);

$checked = new DateTime("2026-10-17 10:45:00", new DateTimeZone("Asia/Seoul"));
$list = '{"logNo":"10","commentCount":"1","addDate":"12시간 전"}{"logNo":"11","addDate":"2026. 10. 15."}';
$rssTimes = '<item><guid>https://blog.naver.com/dlsnf8478/10</guid><pubDate>Fri, 16 Oct 2026 22:10:00 +0900</pubDate></item>';
$times = naver_post_times($list, $rssTimes);
expect("RSS 시각이 목록 문구를 덮는다", $times["10"], "Fri, 16 Oct 2026 22:10:00 +0900");
expect("목록만 있는 글 시각", $times["11"], "2026. 10. 15.");
expect("어제 글의 댓글은 오늘이 아니다", comments_on_fresh_post($times["10"], 1, $checked), null);
expect("오늘 글의 댓글은 전부 센다", comments_on_fresh_post("Sat, 17 Oct 2026 09:10:00 +0900", 1, $checked), 1);
expect("지난 글의 댓글은 시각이 더 필요하다", comments_on_fresh_post($times["11"], 2, $checked), null);
expect("댓글이 없으면 0", comments_on_fresh_post($times["11"], 0, $checked), 0);

$oldComments = '{"data":{"items":[{"written":"2026. 10. 15. 11:11","children":[{"written":"2026. 10. 14. 23:23","children":[]}]}],"isLast":true,"nextId":0}}';
expect("지난 티스토리 댓글은 0", tistory_comment_window($oldComments, $checked), array(0, true, null));
$reply = '{"data":{"items":[{"written":"2026. 10. 10. 11:15","children":[{"written":"2026. 10. 16. 22:00","children":[]}]}],"isLast":false,"nextId":15}}';
expect("어제 답글은 오늘이 아니다", tistory_comment_window($reply, $checked), array(0, false, "15"));
$todayReply = '{"data":{"items":[{"written":"2026. 10. 10. 11:15","children":[{"written":"2026. 10. 17. 09:00","children":[]}]}],"isLast":false,"nextId":15}}';
expect("오늘 답글은 센다", tistory_comment_window($todayReply, $checked), array(1, false, "15"));
expect("댓글 없음", tistory_comment_window('{"data":{"items":[],"isLast":true,"nextId":0}}', $checked), array(0, true, null));
expect("댓글 본문이 아니면 비움", tistory_comment_window("{}", $checked), null);

expect("댓글 속성", naver_comment_count('commentCount="4"'), 4);
expect("댓글 JSON", naver_comment_count('{"commentCount":7}'), 7);
expect("댓글 이스케이프 JSON", naver_comment_count('{\\"commentCount\\":3}'), 3);
expect("댓글 없음", naver_comment_count("<div></div>"), null);

$commentNow = new DateTime("2026-10-19 12:00:00", new DateTimeZone("Asia/Seoul"));
$ownerLeftOut = '{"success":true,"result":{"count":{"total":1},"pageModel":{"page":1,"nextPage":0,"totalRows":2},"commentList":['
    . '{"commentNo":"1","manager":false,"regTime":"2026-10-17T18:00:00+0900","replyList":null},'
    . '{"commentNo":"2","manager":true,"regTime":"2026-10-19T11:00:00+0900","replyList":null}'
    . ']}}';
$ownerCensus = naver_comment_census($ownerLeftOut, $commentNow);
expect("주인 댓글도 목록에 센다", $ownerCensus["listed"], 2);
expect("주인 댓글의 오늘", $ownerCensus["today"], 1);
$ownerMerged = naver_comment_sum(array($ownerCensus), true);
expect("목록 숫자가 주인 댓글을 빼면 올린다", $ownerMerged["total"], 2);
expect("오늘 수에도 주인 댓글", $ownerMerged["today"], 1);
$ownerIncluded = '{"success":true,"result":{"count":{"total":2},"pageModel":{"page":1,"nextPage":0,"totalRows":2},"commentList":['
    . '{"commentNo":"1","regTime":"2026-10-17T18:00:00+0900"},'
    . '{"commentNo":"2","manager":true,"regTime":"2026-10-19T11:00:00+0900"}'
    . ']}}';
$ownerSame = naver_comment_sum(array(naver_comment_census($ownerIncluded, $commentNow)), true);
expect("이미 들어 있으면 한 번만", $ownerSame["total"], 2);
expect("jsonp도 읽는다", naver_comment_census('_callback(' . $ownerIncluded . ');', $commentNow)["listed"], 2);
$ownerOpen = '{"success":true,"result":{"count":{"total":4},"pageModel":{"page":1,"nextPage":2,"totalRows":4},"commentList":['
    . '{"commentNo":"1","regTime":"2026-10-19T11:00:00+0900"}'
    . ']}}';
$ownerPartial = naver_comment_sum(array(naver_comment_census($ownerOpen, $commentNow)), false);
expect("목록이 덜 오면 합계를 올리지 않는다", $ownerPartial["total"], 4);
expect("덜 온 목록의 오늘은 비운다", $ownerPartial["today"], null);

$ownerTree = '{"data":{"items":[{"written":"2026. 10. 14. 23:23","children":[{"written":"2026. 10. 15. 11:11","writer":{"role":"owner"},"children":[]}]}],"isLast":true,"nextId":0}}';
$ownerNodes = tistory_comment_census($ownerTree, $checked);
expect("주인 답글도 개수에 넣는다", $ownerNodes["nodes"], 2);
expect("목록보다 많은 주인 댓글만 더한다", tistory_apply_hidden_comments(4, array("11" => 2, "1" => 2), array("11" => 3, "1" => 2)), 5);
expect("같은 수는 그대로", tistory_apply_hidden_comments(4, array("1" => 4), array("1" => 4)), 4);
expect("더 작은 목록은 합을 줄이지 않는다", tistory_apply_hidden_comments(4, array("1" => 4), array("1" => 2)), 4);

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

expect("blogspot.com 이름", blogspot_name("doda-in-korea.blogspot.com"), "doda-in-korea");
expect("blogspot.co.kr 이름", blogspot_name("doda-in-korea.blogspot.co.kr"), "doda-in-korea");
expect("blogspot.com.au 이름", blogspot_name("doda-in-korea.blogspot.com.au"), "doda-in-korea");
expect("다른 호스트는 블로거가 아니다", blogspot_name("blog.naver.com"), "");
expect("blogspot 뒤에 다른 도메인은 거절", blogspot_name("name.blogspot.com.evil.com"), "");
expect("www.blogspot.com 은 거절", blogspot_name("www.blogspot.com"), "");

$bloggerNow = new DateTime("2026-10-19 15:07:07", new DateTimeZone("Asia/Seoul"));
expect("오늘 자정", blogger_published_min($bloggerNow), "2026-10-19T00:00:00+09:00");
expect("글 피드 주소", blogger_feed_url("doda-in-korea", "posts", ""), "https://doda-in-korea.blogspot.com/feeds/posts/default?alt=json&max-results=0");
expect("댓글 구간 주소", blogger_feed_url("doda-in-korea", "comments", "2026-10-19T00:00:00+09:00"), "https://doda-in-korea.blogspot.com/feeds/comments/default?alt=json&max-results=0&published-min=2026-10-19T00%3A00%3A00%2B09%3A00");

$feed = '{"feed":{"openSearch$totalResults":{"$t":"2"},"author":[{"gd$image":{"src":"https://blogger.googleusercontent.com/img/b/photo/s1600/face.jpg"}}]}}';
expect("피드 글 수", blogger_feed_total(200, $feed), 2);
expect("피드가 아니면 비움", blogger_feed_total(200, "<html></html>"), null);
expect("글이 없으면 오늘도 0", blogger_window_count(0, 4), 0);
expect("구간이 전체보다 크면 비움", blogger_window_count(2, 3), null);
expect("구간 글 수", blogger_window_count(2, 1), 1);

$thumb = blogger_author_image($feed, false);
$large = blogger_author_image($feed, true);
expect("썸네일은 s204", $thumb, "https://blogger.googleusercontent.com/img/b/photo/s204/face.jpg");
expect("큰 사진은 s1600", $large, "https://blogger.googleusercontent.com/img/b/photo/s1600/face.jpg");
expect("기본 이미지는 버린다", blogger_image_url("https://blogger.googleusercontent.com/img/b/U2hvZWJveA/h60/", false), "");
expect("다른 호스트 사진은 버린다", blogger_image_url("https://evil.example/s1600/a.jpg", false), "");
$htmlPhoto = "<img alt='My photo' class='profile-img' src='//lh3.googleusercontent.com/a/face=s80-c'/>";
expect("화면 프로필의 크기", blogger_html_image($htmlPhoto, false), "https://lh3.googleusercontent.com/a/face=s204");

$statsHtml = "<script>'statsUrl': '//doda-in-korea.blogspot.com/b/stats?style\\x3dBLACK_TRANSPARENT\\x26timeRange\\x3dALL_TIME\\x26token\\x3dANakCkvp4-token'</script>";
expect("전체 페이지뷰 주소", blogger_stats_url($statsHtml, "doda-in-korea"), "https://doda-in-korea.blogspot.com/b/stats?style=BLACK_TRANSPARENT&timeRange=ALL_TIME&token=ANakCkvp4-token");
expect("다른 블로그 토큰은 거절", blogger_stats_url($statsHtml, "other-blog"), "");
$weekHtml = str_replace("ALL_TIME", "LAST_WEEK", $statsHtml);
expect("일주일 범위는 전체로 쓰지 않는다", blogger_stats_url($weekHtml, "doda-in-korea"), "");
expect("페이지뷰 합계", blogger_stats_total(200, '{"total":48,"sparklineData":[[29,96]]}'), 48);
expect("페이지뷰 본문이 아니면 비움", blogger_stats_total(200, "<HTML>Forbidden</HTML>"), null);
expect("음수 페이지뷰는 비움", blogger_stats_total(200, '{"total":-1}'), null);

$views = '{"counts":[{"timeRange":"SEVEN_DAYS","count":"70"},{"timeRange":"ALL_TIME","count":"73"}]}';
expect("API 전체 페이지뷰", blogger_api_pageviews(200, $views), 73);
expect("전체 구간이 없으면 비움", blogger_api_pageviews(200, '{"counts":[{"timeRange":"SEVEN_DAYS","count":"3"}]}'), null);
expect("API 블로그 아이디", blogger_api_blog_id(200, '{"id":"3237702426019841266"}'), "3237702426019841266");
expect("블로그 이름 목록", blogger_blog_names("https://nuri-seoul-shopping-bag.blogspot.com/, nuri-seoul-okaimono.blogspot.com"), array("nuri-seoul-shopping-bag", "nuri-seoul-okaimono"));
$characterMd = "티스토리 https://dlsnf8478.tistory.com/ / Blogger(영어), https://nuri-seoul-shopping-bag.blogspot.com/ (blogID 1) / Blogger(일본어), https://nuri-seoul-okaimono.blogspot.com/";
expect("캐릭터 파일의 Blogger 주소", blogger_character_blogs($characterMd), array("nuri-seoul-shopping-bag", "nuri-seoul-okaimono"));
expect("Blogger가 아니면 비움", blogger_character_blogs("https://blog.naver.com/dlsnf8478"), array());
expect("마감에 쓸 주소", blogger_close_urls_from($characterMd), array(
    "https://nuri-seoul-okaimono.blogspot.com/",
    "https://nuri-seoul-shopping-bag.blogspot.com/"
));
expect("국가 도메인도 적힌 그대로", blogger_close_urls_from("https://doda-in-korea.blogspot.co.kr/"), array("https://doda-in-korea.blogspot.co.kr/"));
expect("끝의 마침표는 뺀다", blogger_close_urls_from("https://doda-in-korea.blogspot.com/."), array("https://doda-in-korea.blogspot.com/"));
expect("같은 주소는 한 번", blogger_close_urls_from("https://doda-in-korea.blogspot.com/ https://doda-in-korea.blogspot.com"), array("https://doda-in-korea.blogspot.com/"));
expect("http 주소는 마감에 넣지 않는다", blogger_close_urls_from("http://doda-in-korea.blogspot.com/"), array());
$fromFile = blogger_apply_character_blogs(array(
    array("suffix" => "na_nuri", "blogs" => array()),
    array("suffix" => "kang_doyun", "blogs" => array("donuguri-spec-notes"))
), array("na_nuri" => array("nuri-seoul-shopping-bag", "nuri-seoul-okaimono")));
expect("파일 이름이 같은 계정에 주소를 붙인다", $fromFile[0]["blogs"], array("nuri-seoul-shopping-bag", "nuri-seoul-okaimono"));
expect("이미 적힌 주소는 파일로 바꾸지 않는다", $fromFile[1]["blogs"], array("donuguri-spec-notes"));

$sets = blogger_credential_sets(array(
    "BLOGGER_CLIENT_ID_en_na_nuri" => "id",
    "BLOGGER_CLIENT_SECRET_en_na_nuri" => "secret",
    "BLOGGER_REFRESH_TOKEN_en_na_nuri" => "refresh",
    "BLOGGER_BLOGS_en_na_nuri" => "nuri-seoul-shopping-bag.blogspot.com",
    "BLOGGER_CLIENT_ID_en_kang_doyun" => "id2",
    "BLOGGER_CLIENT_SECRET_en_kang_doyun" => "secret2",
    "BLOGGER_REFRESH_TOKEN_en_kang_doyun" => "refresh2"
));
expect("지정된 블로그의 계정", blogger_sets_for("nuri-seoul-shopping-bag", $sets)[0]["suffix"], "en_na_nuri");
expect("목록이 없는 계정은 나머지 블로그에 쓴다", blogger_sets_for("kang-doyun", $sets)[0]["suffix"], "en_kang_doyun");
expect("빈 토큰은 계정에서 뺀다", blogger_credential_sets(array(
    "BLOGGER_CLIENT_ID_en_na_nuri" => "id",
    "BLOGGER_CLIENT_SECRET_en_na_nuri" => "",
    "BLOGGER_REFRESH_TOKEN_en_na_nuri" => "refresh"
)), array());

$closeNow = new DateTime("2026-10-20 00:30:00", new DateTimeZone("Asia/Seoul"));
$nuri = "https://nuri-seoul-shopping-bag.blogspot.com/";
$closes = array(
    "2026-10-06" => array($nuri => 1),
    "2026-10-19" => array($nuri => 73)
);
expect("로그 설정이 없으면 꺼진다", botdash_flag_on(""), false);
expect("로그 0은 꺼진다", botdash_flag_on("0"), false);
expect("로그 1은 켠다", botdash_flag_on("1"), true);
expect("로그 on은 켠다", botdash_flag_on(" on "), true);
expect("어제 마감과의 차이", blogger_today_count($closes, $nuri, 80, $closeNow), 7);
expect("어제 기록이 없으면 비움", blogger_today_count(array(), $nuri, 80, $closeNow), null);
expect("줄어든 전체는 비움", blogger_today_count($closes, $nuri, 70, $closeNow), null);
expect("다른 블로그 마감은 쓰지 않는다", blogger_today_count($closes, "https://other.blogspot.com/", 80, $closeNow), null);
expect("그저께 값으로는 오늘을 만들지 않는다", blogger_today_count(array("2026-10-18" => array($nuri => 10)), $nuri, 80, $closeNow), null);
expect("어제 날짜가 없을 때의 이유", blogger_today_gap_reason(array(), $nuri, 80, $closeNow), "어제 날짜 없음. 한국오늘=2026-10-20 어제=2026-10-19 파일의 날짜=없음");
expect("그저께만 있을 때의 이유", blogger_today_gap_reason(array("2026-10-18" => array($nuri => 10)), $nuri, 80, $closeNow), "어제 날짜 없음. 한국오늘=2026-10-20 어제=2026-10-19 파일의 날짜=2026-10-18");
expect("어제 주소가 다를 때의 이유", blogger_today_gap_reason($closes, "https://other.blogspot.com/", 80, $closeNow), "어제 날짜에 이 주소 없음. 요청=https://other.blogspot.com/ 어제=2026-10-19 파일주소=" . $nuri);
expect("전체가 더 작을 때의 이유", blogger_today_gap_reason($closes, $nuri, 70, $closeNow), "지금 전체 70, 어제 전체 73, 오늘을 만들지 않음");
$stored = blogger_total_apply($closes, $nuri, "2026-10-20", 80, $closeNow);
expect("오늘 전체에 기록", $stored["2026-10-20"][$nuri], 80);
expect("어제 마감은 그대로", $stored["2026-10-19"][$nuri], 73);
$stored = blogger_total_apply($stored, $nuri, "2026-10-20", 85, $closeNow);
expect("같은 날 더 큰 값이 마감", $stored["2026-10-20"][$nuri], 85);
$stored = blogger_total_apply($stored, $nuri, "2026-10-20", 82, $closeNow);
expect("같은 날 더 작은 값은 남기지 않는다", $stored["2026-10-20"][$nuri], 85);
expect("14일 전 마감은 뺀다", isset($stored["2026-10-06"]), false);
$untouchedTotal = blogger_total_apply($stored, $nuri, "2026-10-19", 1, $closeNow);
expect("지난 날짜의 전체는 고치지 않는다", $untouchedTotal["2026-10-19"][$nuri], 73);

if ($failed > 0) {
    fwrite(STDERR, $failed . " failed\n");
    exit(1);
}
fwrite(STDOUT, "ok\n");
