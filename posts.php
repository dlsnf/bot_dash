<?php
/**
 * 로그인한 브라우저에 최신 글을 날짜순으로 돌려준다.
 * 캐릭터 마크다운의 네이버·티스토리·Blogger 피드만 받는다.
 * offset, limit 으로 잘라 내고, 모아 둔 목록은 90초 동안 다시 쓴다.
 * 화면의 한 열은 1–10개다. 카드가 4열 이상이면 두 열이라 한 쪽이 그 두 배다.
 * 처음에는 두 쪽, 그 다음부터는 한 쪽이다. 한 요청은 30개를 넘기지 않는다.
 */
if (!defined("BOTDASH_CONTENT_LIBRARY")) define("BOTDASH_CONTENT_LIBRARY", true);
if (!defined("BOTDASH_PROFILE_LIBRARY")) define("BOTDASH_PROFILE_LIBRARY", true);
require_once __DIR__ . "/content.php";
require_once __DIR__ . "/profile.php";

const POSTS_CACHE_TTL = 90;
const POSTS_PER_BLOG = 40;

function posts_character_id($file) {
    $base = basename((string) $file);
    if (!preg_match('/^[A-Za-z0-9_-]+\.md$/', $base)) return "";
    return substr($base, 0, -3);
}

function posts_plain($text) {
    $text = strip_tags((string) $text);
    $flags = ENT_QUOTES | ENT_HTML5;
    for ($i = 0; $i < 3; $i++) {
        $next = html_entity_decode($text, $flags, "UTF-8");
        if ($next === $text) break;
        $text = $next;
    }
    return $text;
}

function posts_clip($text, $max) {
    $text = posts_plain($text);
    $text = trim(preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]+/u', "", (string) $text));
    $text = trim(preg_replace('/\s+/u', " ", $text));
    if ($text === "") return "";
    if (function_exists("mb_substr") && mb_strlen($text, "UTF-8") > $max) {
        return mb_substr($text, 0, $max, "UTF-8");
    }
    if (strlen($text) > $max) return substr($text, 0, $max);
    return $text;
}

function posts_character_name($markdown) {
    if (!is_string($markdown) || $markdown === "") return "";
    if (!preg_match('/^[ \t]*- 이름[:：][ \t]*(.+)$/mu', $markdown, $matched)) return "";
    $name = trim($matched[1]);
    if ($name === "" || $name === "없음" || $name === "(없음)") return "";
    return $name;
}

function posts_platform($url) {
    $host = strtolower((string) parse_url($url, PHP_URL_HOST));
    if ($host === "blog.naver.com" || $host === "m.blog.naver.com") return "네이버";
    if (preg_match('/^[a-z0-9-]+\.tistory\.com$/', $host)) return "티스토리";
    if (blogspot_name($host) !== "") return "Blogger";
    return "";
}

function posts_feed_url($blog, $platform) {
    if ($platform === "네이버") {
        $id = naver_blog_id($blog);
        if ($id === "" || !preg_match('/^[A-Za-z0-9._-]+$/', $id)) return "";
        return "https://rss.blog.naver.com/" . rawurlencode($id) . ".xml";
    }
    if ($platform === "티스토리") {
        $host = strtolower((string) parse_url($blog, PHP_URL_HOST));
        if (!preg_match('/^[a-z0-9-]+\.tistory\.com$/', $host)) return "";
        return "https://" . $host . "/rss";
    }
    if ($platform === "Blogger") {
        $name = blogspot_name((string) parse_url($blog, PHP_URL_HOST));
        if ($name === "") return "";
        return "https://" . $name . ".blogspot.com/feeds/posts/default?alt=json&max-results=30";
    }
    return "";
}

function posts_sources_from($markdown, $file) {
    $id = posts_character_id($file);
    if ($id === "" || !is_string($markdown)) return array();
    $name = posts_clip(posts_character_name($markdown), 80);
    if ($name === "") $name = $id;
    $sources = array();
    foreach (visitor_urls_from($markdown) as $blog) {
        $platform = posts_platform($blog);
        $feed = posts_feed_url($blog, $platform);
        if ($platform === "" || $feed === "") continue;
        $sources[] = array(
            "characterId" => $id,
            "name" => $name,
            "platform" => $platform,
            "blog" => $blog,
            "feed" => $feed
        );
    }
    return $sources;
}

function posts_time($raw, $now = null) {
    $raw = trim(html_entity_decode((string) $raw, ENT_QUOTES, "UTF-8"));
    if ($raw === "") return null;
    try {
        $date = new DateTime($raw);
    } catch (Exception $error) {
        return null;
    }
    $ts = $date->getTimestamp();
    $clock = is_int($now) ? $now : time();
    if ($ts < 946684800 || $ts > $clock + 172800) return null;
    return $ts;
}

function posts_iso($ts) {
    $date = new DateTime("@" . (int) $ts);
    $date->setTimezone(new DateTimeZone("Asia/Seoul"));
    return $date->format("Y-m-d\\TH:i:sP");
}

function posts_xml_text($item, $tag) {
    if (!preg_match('#<' . $tag . '\b[^>]*>(.*?)</' . $tag . '>#is', $item, $matched)) return "";
    $text = $matched[1];
    if (preg_match('#<!\[CDATA\[(.*)]]>#s', $text, $wrapped)) $text = $wrapped[1];
    return trim(html_entity_decode(strip_tags($text), ENT_QUOTES, "UTF-8"));
}

function posts_naver_link_ok($url, $id) {
    $host = strtolower((string) parse_url($url, PHP_URL_HOST));
    if ($host !== "blog.naver.com" && $host !== "m.blog.naver.com") return false;
    if ($id === "") return false;
    $parts = parse_url($url);
    $path = isset($parts["path"]) ? $parts["path"] : "";
    if (preg_match('#^/' . preg_quote($id, "#") . '(?:/|$)#', $path)) return true;
    if (!empty($parts["query"])) {
        parse_str($parts["query"], $query);
        if (isset($query["blogId"]) && (string) $query["blogId"] === $id) return true;
    }
    return false;
}

function posts_public_url($url, $platform, $blog) {
    $url = trim(html_entity_decode((string) $url, ENT_QUOTES, "UTF-8"));
    $parts = parse_url($url);
    if (!is_array($parts)) return "";
    if (empty($parts["scheme"]) || strtolower($parts["scheme"]) !== "https") return "";
    if (!empty($parts["user"]) || !empty($parts["pass"])) return "";
    if (isset($parts["port"]) && (int) $parts["port"] !== 443) return "";
    $host = strtolower(isset($parts["host"]) ? $parts["host"] : "");
    if ($host === "") return "";
    if ($platform === "네이버") {
        $id = naver_blog_id($blog);
        if (!posts_naver_link_ok($url, $id)) return "";
    } elseif ($platform === "티스토리" || $platform === "Blogger") {
        $blogHost = strtolower((string) parse_url($blog, PHP_URL_HOST));
        if ($host !== $blogHost) return "";
    } else {
        return "";
    }
    return $url;
}

function posts_item($source, $title, $url, $published) {
    if (!is_int($published)) return null;
    $title = posts_clip(posts_plain($title), 180);
    $url = posts_public_url($url, $source["platform"], $source["blog"]);
    if ($title === "" || $url === "") return null;
    return array(
        "characterId" => $source["characterId"],
        "name" => $source["name"],
        "platform" => $source["platform"],
        "blog" => $source["blog"],
        "title" => $title,
        "url" => $url,
        "published" => $published
    );
}

function posts_rss_link($item) {
    $link = posts_xml_text($item, "link");
    if ($link !== "") return $link;
    if (preg_match('#<link\b[^>]*href="([^"]+)"#i', $item, $matched)) {
        return trim(html_entity_decode($matched[1], ENT_QUOTES, "UTF-8"));
    }
    return posts_xml_text($item, "guid");
}

function posts_items_from_rss($xml, $source, $now = null) {
    if (!is_string($xml) || !preg_match_all('#<item\b[^>]*>(.*?)</item>#is', $xml, $matched)) return array();
    $items = array();
    foreach ($matched[1] as $item) {
        $published = posts_time(posts_xml_text($item, "pubDate"), $now);
        $row = posts_item($source, posts_xml_text($item, "title"), posts_rss_link($item), $published);
        if ($row) $items[] = $row;
    }
    return $items;
}

function posts_atom_href($entry) {
    if (!preg_match_all('#<link\b[^>]*>#i', $entry, $tags)) return "";
    $fallback = "";
    foreach ($tags[0] as $tag) {
        if (!preg_match('#href="([^"]+)"#i', $tag, $href)) continue;
        $url = html_entity_decode($href[1], ENT_QUOTES, "UTF-8");
        if (preg_match('#\brel="alternate"#i', $tag) || !preg_match('#\brel="#i', $tag)) return $url;
        if ($fallback === "") $fallback = $url;
    }
    return $fallback;
}

function posts_items_from_atom($xml, $source, $now = null) {
    if (!is_string($xml) || !preg_match_all('#<entry\b[^>]*>(.*?)</entry>#is', $xml, $matched)) return array();
    $items = array();
    foreach ($matched[1] as $entry) {
        $published = "";
        if (preg_match('#<published>\s*([^<]+)\s*</published>#i', $entry, $found)) $published = $found[1];
        elseif (preg_match('#<updated>\s*([^<]+)\s*</updated>#i', $entry, $found)) $published = $found[1];
        $row = posts_item($source, posts_xml_text($entry, "title"), posts_atom_href($entry), posts_time($published, $now));
        if ($row) $items[] = $row;
    }
    return $items;
}

function posts_json_text($node) {
    if (is_string($node)) return trim($node);
    if (is_array($node) && isset($node['$t']) && is_string($node['$t'])) return trim($node['$t']);
    return "";
}

function posts_blogger_href($entry) {
    if (!is_array($entry) || !isset($entry["link"])) return "";
    $links = $entry["link"];
    if (isset($links["href"])) $links = array($links);
    if (!is_array($links)) return "";
    $fallback = "";
    foreach ($links as $link) {
        if (!is_array($link) || empty($link["href"]) || !is_string($link["href"])) continue;
        $rel = isset($link["rel"]) ? (string) $link["rel"] : "";
        if ($rel === "alternate" || $rel === "") return $link["href"];
        if ($fallback === "") $fallback = $link["href"];
    }
    return $fallback;
}

function posts_items_from_blogger($body, $source, $now = null) {
    $body = ltrim((string) $body);
    if ($body !== "" && $body[0] === "<") return posts_items_from_atom($body, $source, $now);
    if (strncmp($body, ")]}'", 4) === 0) $body = ltrim(substr($body, 4), "\r\n");
    $data = json_decode($body, true);
    if (!is_array($data)) return array();
    $feed = isset($data["feed"]) && is_array($data["feed"]) ? $data["feed"] : array();
    $entries = isset($feed["entry"]) ? $feed["entry"] : array();
    if (isset($entries["title"]) || isset($entries["link"]) || isset($entries["published"])) $entries = array($entries);
    if (!is_array($entries)) return array();
    $items = array();
    foreach ($entries as $entry) {
        if (!is_array($entry)) continue;
        $row = posts_item(
            $source,
            posts_json_text(isset($entry["title"]) ? $entry["title"] : ""),
            posts_blogger_href($entry),
            posts_time(posts_json_text(isset($entry["published"]) ? $entry["published"] : ""), $now)
        );
        if ($row) $items[] = $row;
    }
    return $items;
}

function posts_sort($items) {
    usort($items, function ($a, $b) {
        if ($a["published"] === $b["published"]) return strcmp($a["url"], $b["url"]);
        return $a["published"] < $b["published"] ? 1 : -1;
    });
    return $items;
}

function posts_cap_source($items, $limit) {
    $items = posts_sort($items);
    if (count($items) > $limit) $items = array_slice($items, 0, $limit);
    return $items;
}

function posts_prepare($items) {
    $clean = array();
    foreach ($items as $item) {
        if (!is_array($item) || !isset($item["url"]) || !is_string($item["url"]) || $item["url"] === "") continue;
        if (!isset($item["published"]) || !is_int($item["published"])) continue;
        $clean[] = $item;
    }
    $clean = posts_sort($clean);
    $seen = array();
    $unique = array();
    foreach ($clean as $item) {
        if (isset($seen[$item["url"]])) continue;
        $seen[$item["url"]] = true;
        $unique[] = $item;
    }
    return $unique;
}

function posts_public($item) {
    return array(
        "characterId" => (string) $item["characterId"],
        "name" => (string) $item["name"],
        "platform" => (string) $item["platform"],
        "blog" => (string) $item["blog"],
        "title" => posts_clip(posts_plain((string) $item["title"]), 180),
        "url" => (string) $item["url"],
        "published" => posts_iso($item["published"])
    );
}

function posts_slice($items, $offset, $limit) {
    $offset = (int) $offset;
    if ($offset < 0) $offset = 0;
    if ($offset > 5000) $offset = 5000;
    $limit = (int) $limit;
    if ($limit < 1) $limit = 10;
    if ($limit > 30) $limit = 30;
    $slice = array_slice($items, $offset, $limit);
    $public = array();
    foreach ($slice as $item) $public[] = posts_public($item);
    return array(
        "posts" => $public,
        "offset" => $offset,
        "limit" => $limit,
        "more" => ($offset + count($slice)) < count($items)
    );
}

function posts_cache_path() {
    return __DIR__ . "/data/posts_feed.json";
}

function posts_cache_read($path, $now, $ttl) {
    if (!is_string($path) || !is_file($path)) return null;
    $data = json_decode((string) file_get_contents($path), true);
    if (!is_array($data) || !isset($data["savedAt"]) || !isset($data["posts"]) || !is_array($data["posts"])) return null;
    $saved = $data["savedAt"];
    if (!is_int($saved)) {
        if (!(is_string($saved) && preg_match('/^\d+$/', $saved))) return null;
        $saved = (int) $saved;
    }
    if ($saved > $now || $now - $saved > $ttl) return null;
    $posts = array();
    foreach ($data["posts"] as $item) {
        if (!is_array($item) || !isset($item["url"]) || !is_string($item["url"])) continue;
        if (!isset($item["published"]) || !is_int($item["published"])) continue;
        $posts[] = $item;
    }
    return $posts;
}

function posts_cache_write($path, $posts, $now) {
    $dir = dirname($path);
    if (!is_dir($dir) || !is_writable($dir)) return false;
    $body = json_encode(array("savedAt" => (int) $now, "posts" => $posts), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (!is_string($body)) return false;
    return file_put_contents($path, $body, LOCK_EX) !== false;
}

function posts_feed_job($source) {
    $parts = parse_url($source["feed"]);
    $host = strtolower((string) $parts["host"]);
    $path = (string) $parts["path"];
    return array(
        "url" => $source["feed"],
        "limit" => 700000,
        "allow" => function ($url) use ($host, $path) {
            if (!is_string($url) || $url === "") return false;
            $next = parse_url($url);
            if (!is_array($next)) return false;
            if (empty($next["scheme"]) || strtolower($next["scheme"]) !== "https") return false;
            if (!empty($next["user"]) || !empty($next["pass"])) return false;
            if (strtolower(isset($next["host"]) ? $next["host"] : "") !== $host) return false;
            return (isset($next["path"]) ? $next["path"] : "") === $path;
        },
        "headers" => array("Accept: application/json, application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9"),
        "reject" => true,
        "timeout" => 6,
        "decode" => true
    );
}

function posts_load_all($dir) {
    $items = array();
    $ok = false;
    $sources = array();
    $jobs = array();
    foreach (botdash_character_files($dir) as $file) {
        $markdown = @file_get_contents($dir . DIRECTORY_SEPARATOR . $file);
        if (!is_string($markdown)) continue;
        foreach (posts_sources_from($markdown, $file) as $source) {
            $sources[] = $source;
            $jobs[] = posts_feed_job($source);
        }
    }
    if (!$jobs) return array("posts" => array(), "ok" => false);
    $results = fetch_urls($jobs);
    foreach ($results as $index => $row) {
        if (!isset($sources[$index])) continue;
        $status = isset($row[0]) ? (int) $row[0] : 0;
        $body = isset($row[1]) && is_string($row[1]) ? $row[1] : "";
        if ($status !== 200 || $body === "") continue;
        $ok = true;
        $source = $sources[$index];
        $parsed = $source["platform"] === "Blogger"
            ? posts_items_from_blogger($body, $source)
            : posts_items_from_rss($body, $source);
        foreach (posts_cap_source($parsed, POSTS_PER_BLOG) as $item) $items[] = $item;
    }
    return array("posts" => posts_prepare($items), "ok" => $ok);
}

if (defined("BOTDASH_POSTS_LIBRARY")) return;

if (!botdash_logged_in()) {
    http_response_code(401);
    header("Content-Type: application/json; charset=utf-8");
    header("Cache-Control: private, no-store");
    header("X-Robots-Tag: noindex, nofollow, noarchive, nosnippet");
    echo "{}";
    exit;
}

ini_set("display_errors", "0");
header("Content-Type: application/json; charset=utf-8");
header("Cache-Control: private, no-store");
header("X-Robots-Tag: noindex, nofollow, noarchive, nosnippet");

$offset = isset($_GET["offset"]) ? (int) $_GET["offset"] : 0;
$limit = isset($_GET["limit"]) ? (int) $_GET["limit"] : 10;
$now = time();
$path = posts_cache_path();
$posts = posts_cache_read($path, $now, POSTS_CACHE_TTL);
if (!is_array($posts)) {
    $loaded = posts_load_all(__DIR__ . "/characters");
    $posts = $loaded["posts"];
    if (!empty($loaded["ok"])) posts_cache_write($path, $posts, $now);
}
$body = json_encode(posts_slice($posts, $offset, $limit), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
echo is_string($body) ? $body : '{"posts":[],"offset":0,"limit":10,"more":false}';
