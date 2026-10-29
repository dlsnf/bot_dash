<?php
/**
 * 최신 글 피드 파싱, 정렬, 쪽 나누기. 네트워크는 쓰지 않는다.
 */
define("BOTDASH_POSTS_LIBRARY", true);
require_once dirname(__DIR__) . "/posts.php";

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

$now = strtotime("2026-10-28 12:00:00 +0900");
$naver = array(
    "characterId" => "kang_doyun",
    "name" => "강도윤",
    "platform" => "네이버",
    "blog" => "https://blog.naver.com/dy2894",
    "feed" => "https://rss.blog.naver.com/dy2894.xml"
);
$blogger = array(
    "characterId" => "kang_doyun",
    "name" => "강도윤",
    "platform" => "Blogger",
    "blog" => "https://donuguri-spec-notes.blogspot.com/",
    "feed" => "https://donuguri-spec-notes.blogspot.com/feeds/posts/default?alt=json&max-results=30"
);

$markdown = "# 테스트\n- 이름: 강도윤\n- 블로그·채널 목록: 네이버 블로그, https://blog.naver.com/dy2894, 운영 / 티스토리, https://dy2894.tistory.com, 운영 / Blogger, https://donuguri-spec-notes.blogspot.com/\n- 메모: https://evil.example/no\n";
$sources = posts_sources_from($markdown, "kang_doyun.md");
expect("블로그 3개", count($sources), 3);
expect("이름", $sources[0]["name"], "강도윤");
$feeds = array();
foreach ($sources as $source) $feeds[$source["platform"]] = $source["feed"];
expect("네이버 피드", $feeds["네이버"], "https://rss.blog.naver.com/dy2894.xml");
expect("티스토리 피드", $feeds["티스토리"], "https://dy2894.tistory.com/rss");
expect("블로거 피드", $feeds["Blogger"], "https://donuguri-spec-notes.blogspot.com/feeds/posts/default?alt=json&max-results=30");
expect("잘못된 파일명은 버림", posts_sources_from($markdown, "bad name.md"), array());

$rss = <<<XML
<?xml version="1.0" encoding="UTF-8"?>
<rss><channel>
  <item><title><![CDATA[오늘 글]]></title><link>https://blog.naver.com/dy2894/223</link><pubDate>Wed, 28 Oct 2026 10:15:00 +0900</pubDate></item>
  <item><title>어제 &amp; 글</title><link>https://blog.naver.com/dy2894/222</link><pubDate>Tue, 27 Oct 2026 09:00:00 +0900</pubDate></item>
  <item><title>날짜 없음</title><link>https://blog.naver.com/dy2894/221</link></item>
  <item><title>다른 블로그</title><link>https://blog.naver.com/other/9</link><pubDate>Wed, 28 Oct 2026 11:00:00 +0900</pubDate></item>
  <item><title>http 주소</title><link>http://blog.naver.com/dy2894/1</link><pubDate>Wed, 28 Oct 2026 11:00:00 +0900</pubDate></item>
  <item><title>CDATA 주소</title><link><![CDATA[https://blog.naver.com/dy2894/224456762133?fromRss=true&trackingCode=rss]]></link><pubDate>Wed, 28 Oct 2026 10:00:00 +0900</pubDate></item>
  <item><title>guid만</title><guid>https://blog.naver.com/dy2894/220</guid><pubDate>Wed, 28 Oct 2026 08:00:00 +0900</pubDate></item>
  <item><title>PostView</title><link>https://m.blog.naver.com/PostView.naver?blogId=dy2894&amp;logNo=219</link><pubDate>Wed, 28 Oct 2026 07:00:00 +0900</pubDate></item>
  <item><title>다른 PostView</title><link>https://blog.naver.com/PostView.naver?blogId=other&amp;logNo=1</link><pubDate>Wed, 28 Oct 2026 07:00:00 +0900</pubDate></item>
  <item><title>다른 호스트</title><link>https://post.naver.com/viewer/postView.naver?volumeNo=1</link><pubDate>Wed, 28 Oct 2026 07:00:00 +0900</pubDate></item>
  <item><title>150분&amp;middot;근력</title><link>https://blog.naver.com/dy2894/218</link><pubDate>Wed, 28 Oct 2026 06:00:00 +0900</pubDate></item>
  <item><title><![CDATA[지침&amp;middot;짜는]]></title><link>https://blog.naver.com/dy2894/217</link><pubDate>Wed, 28 Oct 2026 05:00:00 +0900</pubDate></item>
  <item><title>숫자&#183;점</title><link>https://blog.naver.com/dy2894/216</link><pubDate>Wed, 28 Oct 2026 04:00:00 +0900</pubDate></item>
</channel></rss>
XML;
$parsed = posts_items_from_rss($rss, $naver, $now);
expect("RSS는 유효한 글만", count($parsed), 8);
expect("CDATA 제목", $parsed[0]["title"], "오늘 글");
expect("엔티티 제목", $parsed[1]["title"], "어제 & 글");
expect("두 번 인코딩된 가운뎃점", $parsed[5]["title"], "150분·근력");
expect("CDATA 속 가운뎃점", $parsed[6]["title"], "지침·짜는");
expect("숫자 가운뎃점", $parsed[7]["title"], "숫자·점");
expect("CDATA 주소", $parsed[2]["url"], "https://blog.naver.com/dy2894/224456762133?fromRss=true&trackingCode=rss");
expect("guid 주소", $parsed[3]["url"], "https://blog.naver.com/dy2894/220");
expect("모바일 PostView", $parsed[4]["url"], "https://m.blog.naver.com/PostView.naver?blogId=dy2894&logNo=219");

$json = json_encode(array("feed" => array("entry" => array(
    array(
        "title" => array('$t' => "150분&amp;middot;근력"),
        "published" => array('$t' => "2026-10-28T01:00:00Z"),
        "link" => array(
            array("rel" => "self", "href" => "https://donuguri-spec-notes.blogspot.com/feeds/posts/default/1"),
            array("rel" => "alternate", "href" => "https://donuguri-spec-notes.blogspot.com/2026/10/spec.html")
        )
    ),
    array(
        "title" => array('$t' => "다른 블로그"),
        "published" => array('$t' => "2026-10-28T02:00:00Z"),
        "link" => array(array("rel" => "alternate", "href" => "https://other.blogspot.com/2026/10/x.html"))
    )
))), JSON_UNESCAPED_SLASHES);
$blogPosts = posts_items_from_blogger($json, $blogger, $now);
expect("블로거 JSON 한 건", count($blogPosts), 1);
expect("블로거 가운뎃점", $blogPosts[0]["title"], "150분·근력");
expect("alternate 주소", $blogPosts[0]["url"], "https://donuguri-spec-notes.blogspot.com/2026/10/spec.html");

$atom = <<<XML
<entry>
  <title>Atom&amp;middot;title</title>
  <published>2026-10-28T03:00:00Z</published>
  <link rel="self" href="https://donuguri-spec-notes.blogspot.com/feeds/1"/>
  <link rel="alternate" href="https://donuguri-spec-notes.blogspot.com/2026/10/atom.html"/>
</entry>
XML;
$atomPosts = posts_items_from_blogger($atom, $blogger, $now);
expect("블로거 Atom", count($atomPosts), 1);
expect("Atom 가운뎃점", $atomPosts[0]["title"], "Atom·title");
expect("Atom 주소", $atomPosts[0]["url"], "https://donuguri-spec-notes.blogspot.com/2026/10/atom.html");

$merged = posts_prepare(array_merge($parsed, $blogPosts, $parsed));
expect("중복 제거", count($merged), 9);
expect("가장 최근이 앞", $merged[0]["title"], "오늘 글");
$iso = posts_iso($merged[0]["published"]);
expect("서울 시각", $iso, "2026-10-28T10:15:00+09:00");

$many = array();
for ($i = 0; $i < 12; $i++) {
    $many[] = array(
        "characterId" => "kang_doyun",
        "name" => "강도윤",
        "platform" => "네이버",
        "blog" => "https://blog.naver.com/dy2894",
        "title" => "글 " . $i,
        "url" => "https://blog.naver.com/dy2894/" . (100 + $i),
        "published" => $now - ($i * 3600)
    );
}
$first = posts_slice($many, 0, 10);
expect("처음 10개", count($first["posts"]), 10);
expect("10개 뒤에는 더 있음", $first["more"], true);
expect("응답 시각", $first["posts"][0]["published"], posts_iso($now));
$next = posts_slice($many, 10, 5);
expect("다음 5개 중 남은 2개", count($next["posts"]), 2);
expect("남은 뒤에는 없음", $next["more"], false);
expect("limit 상한", posts_slice($many, 0, 100)["limit"], 30);

$dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . "botdash-posts-" . getmypid();
@mkdir($dir);
$cache = $dir . DIRECTORY_SEPARATOR . "posts_feed.json";
expect("캐시 저장", posts_cache_write($cache, $many, $now), true);
expect("캐시 읽기", count(posts_cache_read($cache, $now + 10, 90)), 12);
expect("캐시 만료", posts_cache_read($cache, $now + 91, 90), null);
@unlink($cache);
@rmdir($dir);

if ($failed > 0) {
    fwrite(STDERR, $failed . " failed\n");
    exit(1);
}
fwrite(STDOUT, "ok\n");
