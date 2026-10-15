<?php
/**
 * 네이버·티스토리 블로그의 프로필 사진, 또는 글·댓글 수만 같은 주소로 돌려준다.
 * size=large 는 카드용으로 줄인 사진 대신 더 큰 원본에 가까운 사진을 돌려준다.
 * 사진이 없거나 기본 이미지면 404. 화면은 그때 기본 캐릭터 이미지를 쓴다.
 * view=counts 는 {"posts","comments","today","total","postsToday","commentsToday"} 를 돌려준다.
 * 값은 정수이거나 null이다. postsToday, commentsToday 는 오늘(서울) 새로 올라온 개수다.
 * 블로그 주소 외의 요청은 받지 않고, 받아 온 본문은 그대로 내보내지 않는다.
 */
ini_set("display_errors", "0");
header("X-Robots-Tag: noindex, nofollow, noarchive, nosnippet");

const BLOG_HTML_LIMIT = 500000;
const IMAGE_LIMIT = 2000000;
const COMMENT_CAP = 20;

function deny() {
    http_response_code(404);
    header("Content-Type: text/plain; charset=utf-8");
    header("Cache-Control: private, max-age=300");
    exit;
}

function host_of($url) {
    $parts = parse_url($url);
    if (!is_array($parts)) return "";
    if (empty($parts["scheme"]) || strtolower($parts["scheme"]) !== "https") return "";
    if (!empty($parts["user"]) || !empty($parts["pass"])) return "";
    if (isset($parts["port"]) && (int) $parts["port"] !== 443) return "";
    return strtolower(isset($parts["host"]) ? $parts["host"] : "");
}

function blog_kind($url) {
    $host = host_of($url);
    if ($host === "blog.naver.com" || $host === "m.blog.naver.com") return "naver";
    if (preg_match('/^[a-z0-9-]+\.tistory\.com$/', $host)) return "tistory";
    return "";
}

function image_host_ok($url) {
    $host = host_of($url);
    return in_array($host, array(
        "blogpfthumb-phinf.pstatic.net",
        "tistory1.daumcdn.net",
        "img1.daumcdn.net"
    ), true);
}

function fetch_url($url, $limit, $allow, $extraHeaders = array(), $rejectOversize = false, $timeout = 8, $decode = false, $userAgent = "") {
    if (!function_exists("curl_init")) return array(0, "", "");
    $headers = array("Accept: text/html,application/json,application/xml;q=0.9,image/avif,image/webp,image/*,*/*;q=0.8");
    foreach ($extraHeaders as $header) {
        if (is_string($header) && $header !== "") $headers[] = $header;
    }
    $current = $url;
    $hop = 0;
    while ($hop < 4) {
        if (!$allow($current)) return array(0, "", "");
        $ch = curl_init($current);
        $options = array(
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_USERAGENT => $userAgent !== "" ? $userAgent : "Mozilla/5.0 (compatible; BotDash/1.0)",
            CURLOPT_HTTPHEADER => $headers
        );
        if ($decode) $options[CURLOPT_ENCODING] = "";
        curl_setopt_array($ch, $options);
        $body = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $type = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        $location = (string) curl_getinfo($ch, CURLINFO_REDIRECT_URL);
        curl_close($ch);
        if ($body === false) return array(0, "", "");
        if (strlen($body) > $limit) {
            if ($rejectOversize) return array(0, "", "");
            $body = substr($body, 0, $limit);
        }
        if ($status >= 300 && $status < 400 && $location !== "") {
            $hop += 1;
            $current = $location;
            continue;
        }
        return array($status, $body, $type);
    }
    return array(0, "", "");
}

function decode_js_url($value) {
    $text = str_replace(array("\\/", "\\u002F", "\\u002f"), "/", $value);
    return trim($text);
}

function is_placeholder($url) {
    return (bool) preg_match('/default_[LSMsm]\.png|tistory_admin\/static|profile_default|static\/blog\/icon/i', $url);
}

function without_image_type($url) {
    $parts = parse_url($url);
    if (!is_array($parts) || empty($parts["scheme"]) || empty($parts["host"])) return $url;
    $query = array();
    if (!empty($parts["query"])) parse_str($parts["query"], $query);
    unset($query["type"]);
    $rebuilt = $parts["scheme"] . "://" . $parts["host"];
    if (!empty($parts["port"])) $rebuilt .= ":" . (int) $parts["port"];
    $rebuilt .= isset($parts["path"]) ? $parts["path"] : "";
    if ($query) $rebuilt .= "?" . http_build_query($query);
    return $rebuilt;
}

function profile_from_html($kind, $html, $large = false) {
    if ($kind === "naver") {
        if (!preg_match('/profileImagePath\\\\?"\s*:\s*\\\\?"(.*?)\\\\?"/', $html, $matched)
            && !preg_match('/"profileImagePath":"(.*?)"/', $html, $matched)) {
            return "";
        }
        $url = decode_js_url($matched[1]);
        if (!image_host_ok($url) || is_placeholder($url)) return "";
        $bare = without_image_type($url);
        if ($large) return $bare;
        return $bare . (strpos($bare, "?") === false ? "?" : "&") . "type=f204_204";
    }
    if (!preg_match('/<img\b[^>]*\bimg-profile\b[^>]*>/i', $html, $tag)) return "";
    if (!preg_match('/\bsrc="([^"]+)"/i', $tag[0], $src)) return "";
    $url = html_entity_decode($src[1], ENT_QUOTES, "UTF-8");
    if (!image_host_ok($url) || is_placeholder($url)) return "";
    if ($large && preg_match('#/thumb/[CR]\d+x\d+#i', $url)) {
        $url = preg_replace('#(/thumb/)[CR]\d+x\d+[^/]*#i', '$1C800x800', $url, 1);
        if (!image_host_ok($url) || is_placeholder($url)) return "";
    }
    return $url;
}

function naver_blog_id($url) {
    $parts = parse_url($url);
    if (!is_array($parts)) return "";
    $path = isset($parts["path"]) ? $parts["path"] : "";
    if (preg_match('#^/([A-Za-z0-9_-]+)/?$#', $path, $matched)) {
        $id = $matched[1];
        if (!preg_match('/\.naver$/i', $id) && !preg_match('/^(PostList|PostView|prologue)$/i', $id)) {
            return $id;
        }
    }
    if (!empty($parts["query"])) {
        parse_str($parts["query"], $query);
        if (!empty($query["blogId"]) && preg_match('/^[A-Za-z0-9_-]+$/', $query["blogId"])) {
            return $query["blogId"];
        }
    }
    return "";
}

function naver_host_ok($url) {
    $host = host_of($url);
    return $host === "blog.naver.com" || $host === "m.blog.naver.com";
}

function count_or_null($value) {
    if (!is_int($value)) return null;
    if ($value < 0) return null;
    return $value;
}

function seoul_today() {
    $now = new DateTime("now", new DateTimeZone("Asia/Seoul"));
    return $now->format("Y-m-d");
}

function seoul_shift($modify) {
    $date = new DateTime("now", new DateTimeZone("Asia/Seoul"));
    $date->modify($modify);
    return $date->format("Y-m-d");
}

function day_key($raw) {
    $text = trim(html_entity_decode((string) $raw, ENT_QUOTES, "UTF-8"));
    if ($text === "") return "";
    if ($text === "오늘" || preg_match('/^(?:방금|조금)\s*전$/u', $text) || preg_match('/^\d+\s*초\s*전$/u', $text)) {
        return seoul_today();
    }
    if (preg_match('/^(\d+)\s*분\s*전$/u', $text, $matched)) return seoul_shift("-" . (int) $matched[1] . " minutes");
    if (preg_match('/^(\d+)\s*시간\s*전$/u', $text, $matched)) return seoul_shift("-" . (int) $matched[1] . " hours");
    if ($text === "어제") return seoul_shift("-1 day");
    if (preg_match('/^(\d+)\s*일\s*전$/u', $text, $matched)) return seoul_shift("-" . (int) $matched[1] . " days");
    $compact = preg_replace("/\s+/", "", $text);
    if (preg_match("/^(\d{4})[.\\-\/](\d{1,2})[.\\-\/](\d{1,2})/", $compact, $matched)) {
        return sprintf("%04d-%02d-%02d", (int) $matched[1], (int) $matched[2], (int) $matched[3]);
    }
    if (preg_match("/^(\d{4})(\d{2})(\d{2})$/", $compact, $matched)) {
        return $matched[1] . "-" . $matched[2] . "-" . $matched[3];
    }
    if (preg_match("/^(\d{10,13})$/", $compact, $matched)) {
        $seconds = strlen($matched[1]) > 10 ? (int) floor(((float) $matched[1]) / 1000) : (int) $matched[1];
        $date = new DateTime("@" . $seconds);
        $date->setTimezone(new DateTimeZone("Asia/Seoul"));
        return $date->format("Y-m-d");
    }
    $stamp = strtotime($text);
    if ($stamp) {
        $date = new DateTime("@" . $stamp);
        $date->setTimezone(new DateTimeZone("Asia/Seoul"));
        return $date->format("Y-m-d");
    }
    return "";
}

function count_days($text, $pattern, $today) {
    if (!preg_match_all($pattern, $text, $matched)) return null;
    $count = 0;
    $known = false;
    foreach ($matched[1] as $raw) {
        $day = day_key($raw);
        if ($day === "") continue;
        $known = true;
        if ($day === $today) $count += 1;
    }
    return $known ? $count : null;
}

function send_counts($posts, $comments, $today = null, $total = null, $postsToday = null, $commentsToday = null) {
    header("Content-Type: application/json; charset=utf-8");
    header("Cache-Control: private, max-age=600");
    header("X-Content-Type-Options: nosniff");
    echo json_encode(array(
        "posts" => count_or_null($posts),
        "comments" => count_or_null($comments),
        "today" => count_or_null($today),
        "total" => count_or_null($total),
        "postsToday" => count_or_null($postsToday),
        "commentsToday" => count_or_null($commentsToday)
    ));
    exit;
}

function json_count($value) {
    if (is_int($value)) return $value < 0 ? null : $value;
    if (is_string($value) && preg_match('/^\d{1,12}$/', $value)) return (int) $value;
    return null;
}

function naver_visitors($id) {
    $url = "https://m.blog.naver.com/api/blogs/" . rawurlencode($id);
    list($status, $body) = fetch_url(
        $url,
        BLOG_HTML_LIMIT,
        "naver_host_ok",
        array("Referer: https://m.blog.naver.com/" . rawurlencode($id)),
        true,
        6,
        true
    );
    if ($status !== 200 || $body === "") return array(null, null);
    $data = json_decode($body, true);
    if (!is_array($data) || empty($data["isSuccess"]) || !isset($data["result"]) || !is_array($data["result"])) {
        return array(null, null);
    }
    $result = $data["result"];
    return array(
        json_count(isset($result["dayVisitorCount"]) ? $result["dayVisitorCount"] : null),
        json_count(isset($result["totalVisitorCount"]) ? $result["totalVisitorCount"] : null)
    );
}

function tistory_visitors($host) {
    $allow = function ($url) use ($host) {
        if (host_of($url) !== $host) return false;
        $path = parse_url($url, PHP_URL_PATH);
        return !is_string($path) || $path === "" || $path === "/";
    };
    $browser = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
    list($status, $html) = fetch_url(
        "https://" . $host . "/",
        BLOG_HTML_LIMIT,
        $allow,
        array("Accept-Language: ko-KR,ko;q=0.9"),
        true,
        6,
        true,
        $browser
    );
    if ($status !== 200 || $html === "") return array(null, null);
    $pos = stripos($html, "box-visit");
    if ($pos === false && preg_match('/class="[^"]*\bcounter\b[^"]*"/i', $html, $found, PREG_OFFSET_CAPTURE)) {
        $pos = $found[0][1];
    }
    if ($pos === false) return array(null, null);
    $chunk = substr($html, $pos, 1800);
    $today = null;
    $total = null;
    if (preg_match('/Today\s*:\s*([\d,]{1,14})/i', $chunk, $matched)
        || preg_match('/오늘\s*[:：]\s*([\d,]{1,14})/u', $chunk, $matched)
        || preg_match('/class="[^"]*\btoday\b[^"]*"[^>]*>\s*([\d,]{1,14})\s*</i', $chunk, $matched)) {
        $today = json_count(str_replace(",", "", $matched[1]));
    }
    if (preg_match('/class="[^"]*\btext-total\b[^"]*"[^>]*>\s*([\d,]{1,14})\s*</i', $chunk, $matched)
        || preg_match('/전체\s*[:：]\s*([\d,]{1,14})/u', $chunk, $matched)
        || preg_match('/class="[^"]*\btotal\b[^"]*"[^>]*>\s*([\d,]{1,14})\s*</i', $chunk, $matched)) {
        $total = json_count(str_replace(",", "", $matched[1]));
    }
    return array($today, $total);
}

function naver_counts($id) {
    $listUrl = "https://blog.naver.com/PostTitleListAsync.naver?blogId=" . rawurlencode($id)
        . "&currentPage=1&countPerPage=" . COMMENT_CAP;
    list($status, $body) = fetch_url(
        $listUrl,
        BLOG_HTML_LIMIT,
        "naver_host_ok",
        array("Referer: https://blog.naver.com/" . rawurlencode($id)),
        true,
        6,
        true
    );
    if ($status !== 200 || !preg_match('/"totalCount"\s*:\s*"?(\d+)/', $body, $totalMatch)) {
        return array(null, null, null, null);
    }
    $today = seoul_today();
    // 목록의 "5분 전"은 화면 문구라서 빠질 수 있다. RSS 발행 시각이 있으면 그 날짜를 쓴다.
    $postsToday = naver_rss_today($id, $today);
    if ($postsToday === null) $postsToday = count_days($body, '/"addDate"\s*:\s*"([^"]+)"/', $today);
    $total = (int) $totalMatch[1];
    if ($total === 0) return array(0, 0, 0, 0);
    // 글이 상한보다 많으면 일부 댓글만 더해 전체인 것처럼 보여 주지 않는다.
    if ($total > COMMENT_CAP) return array($total, null, $postsToday, null);
    if (!preg_match_all('/"logNo"\s*:\s*"(\d+)"/', $body, $logMatch)) return array($total, null, $postsToday, null);
    $logNos = array_values(array_unique($logMatch[1]));
    if (count($logNos) !== $total) return array($total, null, $postsToday, null);
    $sum = 0;
    $commentsToday = 0;
    $sawCommentDay = false;
    foreach ($logNos as $logNo) {
        $page = "https://m.blog.naver.com/" . rawurlencode($id) . "/" . rawurlencode($logNo);
        list($pageStatus, $html) = fetch_url($page, BLOG_HTML_LIMIT, "naver_host_ok", array(), true, 6, true);
        $count = naver_comment_count($html);
        if ($pageStatus !== 200 || $count === null) {
            return array($total, null, $postsToday, null);
        }
        $sum += $count;
        if ($count === 0) {
            $sawCommentDay = true;
            continue;
        }
        $fresh = count_days($html, '/"(?:regTime|commentDate|registeredDate)"\s*:\s*"([^"]+)"/', $today);
        if ($fresh === null) {
            $fresh = count_days($html, '/u_cbox_date[^>]*>\s*([^<]{6,40})</i', $today);
        }
        if ($fresh !== null) {
            $sawCommentDay = true;
            $commentsToday += $fresh;
        }
    }
    return array($total, $sum, $postsToday, $sawCommentDay ? $commentsToday : null);
}

function naver_comment_count($html) {
    if (preg_match('/commentCount="(\d+)"/', $html, $matched)) return (int) $matched[1];
    if (preg_match('/\\\\"commentCount\\\\"\s*:\s*(\d+)/', $html, $matched)) return (int) $matched[1];
    if (preg_match('/"commentCount"\s*:\s*(\d+)/', $html, $matched)) return (int) $matched[1];
    return null;
}

function naver_rss_today($id, $today) {
    $allow = function ($url) use ($id) {
        if (host_of($url) !== "rss.blog.naver.com") return false;
        $path = parse_url($url, PHP_URL_PATH);
        return $path === "/" . $id . ".xml";
    };
    list($status, $xml) = fetch_url(
        "https://rss.blog.naver.com/" . rawurlencode($id) . ".xml",
        BLOG_HTML_LIMIT,
        $allow,
        array(),
        true,
        6,
        true
    );
    if ($status !== 200 || $xml === "" || !preg_match_all('#<item\b[^>]*>(.*?)</item>#is', $xml, $items)) {
        return null;
    }
    $count = 0;
    $known = false;
    foreach ($items[1] as $item) {
        if (!preg_match('#<pubDate>\s*([^<]+)\s*</pubDate>#i', $item, $matched)) continue;
        $day = day_key($matched[1]);
        if ($day === "") continue;
        $known = true;
        if ($day === $today) $count += 1;
    }
    return $known ? $count : null;
}

function tistory_comments($host, $postTotal) {
    if ($postTotal === 0) return 0;
    $allow = function ($url) use ($host) {
        if (host_of($url) !== $host) return false;
        $path = parse_url($url, PHP_URL_PATH);
        if (!is_string($path) || ($path !== "" && $path !== "/")) return false;
        $query = array();
        $rawQuery = parse_url($url, PHP_URL_QUERY);
        if (is_string($rawQuery) && $rawQuery !== "") parse_str($rawQuery, $query);
        if (!$query) return true;
        return count($query) === 1
            && isset($query["page"])
            && preg_match('/^[1-9]\d{0,2}$/', (string) $query["page"]);
    };
    $counts = array();
    for ($page = 1; $page <= 8; $page++) {
        $url = "https://" . $host . "/" . ($page === 1 ? "" : "?page=" . $page);
        $browser = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
        list($status, $html) = fetch_url($url, BLOG_HTML_LIMIT, $allow, array(), true, 6, true, $browser);
        if ($status !== 200 || $html === "") {
            if ($page === 1) return null;
            break;
        }
        if (!preg_match_all('/id="commentCount(\d+)_\d+"[^>]*>\s*(\d*)\s*</', $html, $matched, PREG_SET_ORDER)) {
            if ($page === 1) return null;
            break;
        }
        $added = 0;
        foreach ($matched as $row) {
            if (isset($counts[$row[1]])) continue;
            $counts[$row[1]] = ($row[2] === "") ? 0 : (int) $row[2];
            $added += 1;
        }
        if ($added === 0) break;
        if (!preg_match('/(?:\?|&|\/)page=' . ($page + 1) . '(?:["&\/\s]|$)/', $html)) break;
    }
    if (!$counts) return null;
    // 글 수보다 적게 보면 합이 전체인 것처럼 보이지 않게 비운다.
    if (is_int($postTotal) && $postTotal > count($counts)) return null;
    $sum = 0;
    foreach ($counts as $count) $sum += $count;
    return $sum;
}

function tistory_posts_today($host, $today) {
    $allow = function ($url) use ($host) {
        if (host_of($url) !== $host) return false;
        $path = parse_url($url, PHP_URL_PATH);
        return $path === "/rss" || $path === "/feed";
    };
    list($status, $xml) = fetch_url("https://" . $host . "/rss", BLOG_HTML_LIMIT, $allow, array(), true, 6, true);
    if ($status !== 200 || $xml === "" || !preg_match_all('#<item\b[^>]*>(.*?)</item>#is', $xml, $items)) {
        return null;
    }
    $count = 0;
    $known = false;
    foreach ($items[1] as $item) {
        if (!preg_match('#<pubDate>\s*([^<]+)\s*</pubDate>#i', $item, $matched)) continue;
        $day = day_key($matched[1]);
        if ($day === "") continue;
        $known = true;
        if ($day === $today) $count += 1;
    }
    return $known ? $count : null;
}

function numeric_post_locs($xml, &$seen) {
    if (!preg_match_all('#<loc>\s*([^<]+)\s*</loc>#i', $xml, $matched)) return 0;
    $added = 0;
    foreach ($matched[1] as $loc) {
        $loc = trim(html_entity_decode($loc, ENT_QUOTES, "UTF-8"));
        $path = parse_url($loc, PHP_URL_PATH);
        if (!is_string($path) || !preg_match('#^/(\d+)/?$#', $path, $idMatch)) continue;
        $id = $idMatch[1];
        if (isset($seen[$id])) continue;
        $seen[$id] = true;
        $added += 1;
    }
    return $added;
}

function tistory_posts($host) {
    $allow = function ($url) use ($host) {
        if (host_of($url) !== $host) return false;
        $path = parse_url($url, PHP_URL_PATH);
        return is_string($path) && preg_match('#^/sitemap[^/]*\.xml$#i', $path);
    };
    list($status, $xml) = fetch_url("https://" . $host . "/sitemap.xml", BLOG_HTML_LIMIT, $allow, array(), true, 6, true);
    if ($status !== 200 || $xml === "") return null;
    if (stripos($xml, "<urlset") === false && stripos($xml, "<sitemapindex") === false) return null;
    $seen = array();
    if (stripos($xml, "<sitemapindex") !== false) {
        if (!preg_match_all('#<loc>\s*([^<]+)\s*</loc>#i', $xml, $children)) return null;
        if (count($children[1]) > 4) return null;
        $total = 0;
        foreach ($children[1] as $child) {
            $child = trim(html_entity_decode($child, ENT_QUOTES, "UTF-8"));
            list($childStatus, $childXml) = fetch_url($child, BLOG_HTML_LIMIT, $allow, array(), true, 6, true);
            if ($childStatus !== 200 || $childXml === "") return null;
            $total += numeric_post_locs($childXml, $seen);
        }
        return $total;
    }
    return numeric_post_locs($xml, $seen);
}

function image_type($body, $header) {
    if (strncmp($body, "\xFF\xD8\xFF", 3) === 0) return "image/jpeg";
    if (strncmp($body, "\x89PNG", 4) === 0) return "image/png";
    if (strncmp($body, "GIF8", 4) === 0) return "image/gif";
    if (strncmp($body, "RIFF", 4) === 0) return "image/webp";
    if (stripos($header, "image/") === 0) return trim(explode(";", $header)[0]);
    return "";
}

$blog = isset($_GET["blog"]) ? trim((string) $_GET["blog"]) : "";
$kind = blog_kind($blog);
if ($kind === "") deny();

if (isset($_GET["view"]) && (string) $_GET["view"] === "counts") {
    if ($kind === "naver") {
        $id = naver_blog_id($blog);
        if ($id === "") send_counts(null, null);
        list($posts, $comments, $postsToday, $commentsToday) = naver_counts($id);
        list($today, $total) = naver_visitors($id);
        send_counts($posts, $comments, $today, $total, $postsToday, $commentsToday);
    }
    $host = host_of($blog);
    $posts = tistory_posts($host);
    $postsToday = tistory_posts_today($host, seoul_today());
    list($today, $total) = tistory_visitors($host);
    // 글 목록의 commentCount 칸을 더한다. 빈 칸은 0이다. 목록에 없는 글이 있으면 합을 비운다.
    $comments = $posts === 0 ? 0 : tistory_comments($host, $posts);
    send_counts($posts, $comments, $today, $total, $posts === 0 ? 0 : $postsToday, $posts === 0 ? 0 : null);
}

$fetchUrl = $blog;
if ($kind === "naver") {
    $parts = parse_url($blog);
    $id = "";
    if (!empty($parts["path"]) && preg_match('#^/([A-Za-z0-9_-]+)#', $parts["path"], $idMatch)) {
        $id = $idMatch[1];
    }
    if ($id === "") deny();
    $fetchUrl = "https://m.blog.naver.com/" . rawurlencode($id);
} else {
    $fetchUrl = "https://" . host_of($blog) . "/";
}

list($status, $html) = fetch_url($fetchUrl, BLOG_HTML_LIMIT, function ($url) {
    return blog_kind($url) !== "";
});
if ($status !== 200 || $html === "") deny();

$large = isset($_GET["size"]) && (string) $_GET["size"] === "large";
$image = profile_from_html($kind, $html, $large);
if ($image === "") deny();

$imageLimit = $large ? 4000000 : IMAGE_LIMIT;
list($imageStatus, $bytes, $contentType) = fetch_url($image, $imageLimit, function ($url) {
    return image_host_ok($url) && !is_placeholder($url);
}, array(), true);
$type = image_type($bytes, $contentType);
if (($imageStatus !== 200 || $type === "" || $bytes === "") && $large) {
    $image = profile_from_html($kind, $html, false);
    if ($image === "") deny();
    list($imageStatus, $bytes, $contentType) = fetch_url($image, IMAGE_LIMIT, function ($url) {
        return image_host_ok($url) && !is_placeholder($url);
    }, array(), true);
    $type = image_type($bytes, $contentType);
}
if ($imageStatus !== 200 || $type === "" || $bytes === "") deny();

header("Content-Type: " . $type);
header("Cache-Control: private, max-age=3600");
header("X-Content-Type-Options: nosniff");
echo $bytes;
