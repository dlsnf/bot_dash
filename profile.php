<?php
/**
 * 네이버·티스토리·Blogger 블로그의 프로필 사진, 또는 글·댓글 수만 같은 주소로 돌려준다.
 * size=large 는 카드용으로 줄인 사진 대신 더 큰 원본에 가까운 사진을 돌려준다.
 * 사진이 없거나 기본 이미지면 404. 화면은 그때 기본 캐릭터 이미지를 쓴다.
 * view=counts 는 {"posts","comments","today","total","postsToday","commentsToday"} 를 돌려준다.
 * 값은 정수이거나 null이다. postsToday, commentsToday 는 한국시간 오늘 0시부터 올라온 개수다.
 * null 인 칸은 gaps 에 이유를 붙인다.
 * 글이 20편을 넘으면 댓글은 data/comment_store.json 에 글마다 저장한다.
 * 요청은 최근 20편만 다시 세고 나머지는 저장분을 쓴다. 저장이 없거나 글이 빠지면 그 요청에서 전체를 받아 저장한다.
 * 저장이 10분보다 오래되면 응답을 보낸 뒤 전체를 다시 받아 고친다. 1페이지와 글 수가 맞지 않는 저장분은 쓰지 않는다.
 * Blogger 전체 페이지뷰는 계정 토큰이 있으면 API를, 없으면 공개 카운터를 쓴다.
 * 오늘 페이지뷰는 data/blogger_totals.json 의 어제 마감 전체를 지금 전체에서 뺀 값이다.
 * 마감은 대시보드 집계와 blogger_close.php 가 남긴다. 같은 날에는 더 큰 전체만 남긴다.
 * 어제 마감이 없으면 today 는 null 이고 gaps.today 는 alltime 이다. 화면은 그때 0을 그린다.
 * BOTDASH_COUNT_LOG=1 일 때만 그 이유를 data/blogger_count.log 에 남긴다. 기본은 꺼져 있다.
 * data 에 쓰지 못하면 임시 폴더의 botdash-blogger-count.log, 거기도 안 되면 PHP 오류 로그의 [botdash] 다.
 * 집계 응답의 X-Botdash-Log 가 실제 위치다.
 * 블로그 주소 외의 요청은 받지 않고, 받아 온 본문은 그대로 내보내지 않는다.
 */
if (!defined("BOTDASH_PROFILE_LIBRARY")) {
    ini_set("display_errors", "0");
    header("X-Robots-Tag: noindex, nofollow, noarchive, nosnippet");
}
require_once __DIR__ . "/auth.php";
require_once __DIR__ . "/profile_count.php";
// 세션 기본값이 no-cache 라서 Expires·Pragma 가 남으면 브라우저가 사진과 집계를 저장하지 않는다.
if (!defined("BOTDASH_PROFILE_LIBRARY")) {
    if (session_status() !== PHP_SESSION_ACTIVE) {
        session_cache_limiter("");
    }
    if (!botdash_logged_in()) {
        if (isset($_GET["view"]) && (string) $_GET["view"] === "counts") {
            $requested = isset($_GET["blog"]) ? trim((string) $_GET["blog"]) : "";
            blogger_count_log("로그인 없이 집계 요청 blog=" . $requested);
        }
        http_response_code(401);
        header("Content-Type: text/plain; charset=utf-8");
        header_remove("Pragma");
        header_remove("Expires");
        header("Cache-Control: private, no-store");
        exit;
    }
}

const BLOG_HTML_LIMIT = 500000;
const IMAGE_LIMIT = 2000000;
// 네이버 목록은 countPerPage 가 31 이상이면 글 5개만 돌려준다. 20개씩 다음 페이지를 이어 읽는다.
const NAVER_LIST_PAGE_SIZE = 20;
const NAVER_LIST_BATCH = 5;
const TISTORY_LIST_MAX_PAGES = 30;
const COMMENT_FETCH_ROUNDS = 15;
const TISTORY_SITEMAP_MAX = 15;
const TISTORY_COMMENT_BATCH = 20;
const COMMENT_STORE_TTL = 600;

function private_cache($seconds) {
    header_remove("Pragma");
    header_remove("Expires");
    header("Cache-Control: private, max-age=" . (int) $seconds);
}

function deny() {
    http_response_code(404);
    header("Content-Type: text/plain; charset=utf-8");
    private_cache(300);
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
    if (blogspot_name($host) !== "") return "blogger";
    return "";
}

function image_host_ok($url) {
    $host = host_of($url);
    if (in_array($host, array(
        "blogpfthumb-phinf.pstatic.net",
        "tistory1.daumcdn.net",
        "img1.daumcdn.net"
    ), true)) return true;
    return blogger_image_host($host);
}

function request_headers($extraHeaders) {
    $headers = array("Accept: text/html,application/json,application/xml;q=0.9,image/avif,image/webp,image/*,*/*;q=0.8");
    foreach ($extraHeaders as $header) {
        if (is_string($header) && $header !== "") $headers[] = $header;
    }
    return $headers;
}

function open_curl($url, $headers, $timeout, $decode, $userAgent) {
    if (!function_exists("curl_init")) return false;
    $ch = curl_init($url);
    if ($ch === false) return false;
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
    return $ch;
}

function fetch_url($url, $limit, $allow, $extraHeaders = array(), $rejectOversize = false, $timeout = 8, $decode = false, $userAgent = "") {
    if (!function_exists("curl_init")) return array(0, "", "");
    $headers = request_headers($extraHeaders);
    $current = $url;
    $hop = 0;
    while ($hop < 4) {
        if (!$allow($current)) return array(0, "", "");
        $ch = open_curl($current, $headers, $timeout, $decode, $userAgent);
        if ($ch === false) return array(0, "", "");
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

function fetch_urls($jobs) {
    $results = array();
    $count = count($jobs);
    for ($i = 0; $i < $count; $i++) $results[$i] = array(0, "", "");
    if ($count === 0) return $results;
    $serial = function () use ($jobs, &$results, $count) {
        for ($i = 0; $i < $count; $i++) {
            $job = $jobs[$i];
            $results[$i] = fetch_url(
                $job["url"],
                $job["limit"],
                $job["allow"],
                isset($job["headers"]) ? $job["headers"] : array(),
                !empty($job["reject"]),
                isset($job["timeout"]) ? $job["timeout"] : 8,
                !empty($job["decode"]),
                isset($job["ua"]) ? $job["ua"] : ""
            );
        }
        return $results;
    };
    if (!function_exists("curl_multi_init") || !function_exists("curl_init")) return $serial();

    $pending = array();
    for ($i = 0; $i < $count; $i++) {
        $job = $jobs[$i];
        $pending[$i] = array(
            "url" => $job["url"],
            "hop" => 0,
            "limit" => $job["limit"],
            "allow" => $job["allow"],
            "headers" => isset($job["headers"]) ? $job["headers"] : array(),
            "reject" => !empty($job["reject"]),
            "timeout" => isset($job["timeout"]) ? $job["timeout"] : 8,
            "decode" => !empty($job["decode"]),
            "ua" => isset($job["ua"]) ? $job["ua"] : ""
        );
    }
    $wave = 0;
    while ($pending && $wave < 4) {
        $wave += 1;
        $mh = curl_multi_init();
        if ($mh === false) {
            foreach ($pending as $index => $job) {
                $results[$index] = fetch_url(
                    $job["url"],
                    $job["limit"],
                    $job["allow"],
                    $job["headers"],
                    $job["reject"],
                    $job["timeout"],
                    $job["decode"],
                    $job["ua"]
                );
            }
            return $results;
        }
        $handles = array();
        foreach (array_keys($pending) as $index) {
            $job = $pending[$index];
            if (!is_callable($job["allow"]) || !$job["allow"]($job["url"])) {
                $results[$index] = array(0, "", "");
                unset($pending[$index]);
                continue;
            }
            $ch = open_curl($job["url"], request_headers($job["headers"]), $job["timeout"], $job["decode"], $job["ua"]);
            if ($ch === false) {
                $results[$index] = array(0, "", "");
                unset($pending[$index]);
                continue;
            }
            curl_multi_add_handle($mh, $ch);
            $handles[spl_object_id($ch)] = array($index, $ch);
        }
        if (!$handles) {
            curl_multi_close($mh);
            continue;
        }
        $running = 0;
        do {
            $mrc = curl_multi_exec($mh, $running);
        } while ($mrc === CURLM_CALL_MULTI_PERFORM);
        while ($running && $mrc === CURLM_OK) {
            if (curl_multi_select($mh, 1.0) === -1) usleep(10000);
            do {
                $mrc = curl_multi_exec($mh, $running);
            } while ($mrc === CURLM_CALL_MULTI_PERFORM);
        }
        foreach ($handles as $pair) {
            $index = $pair[0];
            $ch = $pair[1];
            $job = $pending[$index];
            $body = curl_multi_getcontent($ch);
            $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            $type = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
            $location = (string) curl_getinfo($ch, CURLINFO_REDIRECT_URL);
            $errno = curl_errno($ch);
            curl_multi_remove_handle($mh, $ch);
            curl_close($ch);
            if ($errno !== 0 || !is_string($body)) {
                $results[$index] = array(0, "", "");
                unset($pending[$index]);
                continue;
            }
            if (strlen($body) > $job["limit"]) {
                if ($job["reject"]) {
                    $results[$index] = array(0, "", "");
                    unset($pending[$index]);
                    continue;
                }
                $body = substr($body, 0, $job["limit"]);
            }
            if ($status >= 300 && $status < 400 && $location !== "") {
                if ($job["hop"] >= 3) {
                    $results[$index] = array(0, "", "");
                    unset($pending[$index]);
                    continue;
                }
                $pending[$index]["url"] = $location;
                $pending[$index]["hop"] = $job["hop"] + 1;
                continue;
            }
            $results[$index] = array($status, $body, $type);
            unset($pending[$index]);
        }
        curl_multi_close($mh);
    }
    return $results;
}

function decode_js_url($value) {
    $text = str_replace(array("\\/", "\\u002F", "\\u002f"), "/", $value);
    return trim($text);
}

function is_placeholder($url) {
    return (bool) preg_match('/default_[LSMsm]\.png|tistory_admin\/static|profile_default|static\/blog\/icon|\/anon\d*\.png|default-avatar|\/U2hvZWJveA\/|blank\.gif/i', $url);
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

function cache_dir() {
    $dir = sys_get_temp_dir() . "/botdash-cache";
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    return $dir;
}

function cache_file($kind, $blog, $large) {
    $name = hash("sha256", $kind . "\0" . $blog . "\0" . ($large ? "large" : "thumb"));
    return cache_dir() . "/" . $name;
}

function request_bypasses_cache() {
    $control = isset($_SERVER["HTTP_CACHE_CONTROL"]) ? strtolower((string) $_SERVER["HTTP_CACHE_CONTROL"]) : "";
    $pragma = isset($_SERVER["HTTP_PRAGMA"]) ? strtolower((string) $_SERVER["HTTP_PRAGMA"]) : "";
    if (strpos($pragma, "no-cache") !== false) return true;
    if (strpos($control, "no-cache") !== false || strpos($control, "no-store") !== false) return true;
    return false;
}

function read_cache($kind, $blog, $large, $expect) {
    if (request_bypasses_cache()) return null;
    $path = cache_file($kind, $blog, $large);
    if (!is_file($path)) return null;
    $raw = @file_get_contents($path);
    if (!is_string($raw) || $raw === "") return null;
    $split = explode("\n", $raw, 3);
    if (count($split) < 3) return null;
    $expire = (int) $split[0];
    $type = $split[1];
    $body = $split[2];
    if ($expire <= time() || $body === "") {
        @unlink($path);
        return null;
    }
    if ($expect === "json") {
        if (stripos($type, "application/json") !== 0) return null;
        $decoded = json_decode($body, true);
        if (!is_array($decoded)) return null;
        return array("application/json; charset=utf-8", $body);
    }
    if (stripos($type, "image/") !== 0) return null;
    $magic = image_type($body, "");
    if ($magic === "") return null;
    return array($magic, $body);
}

function write_cache($kind, $blog, $large, $type, $body, $ttl) {
    if ($type === "" || $body === "" || !preg_match('#^(image/[a-z0-9.+-]+|application/json; charset=utf-8)$#i', $type)) return;
    $dir = cache_dir();
    if (!is_dir($dir) || !is_writable($dir)) return;
    $path = $dir . "/" . basename(cache_file($kind, $blog, $large));
    $tmp = $path . "." . getmypid() . ".tmp";
    $payload = (string) (time() + (int) $ttl) . "\n" . $type . "\n" . $body;
    if (@file_put_contents($tmp, $payload, LOCK_EX) === false) return;
    @chmod($tmp, 0600);
    if (!@rename($tmp, $path)) @unlink($tmp);
}

function send_body($type, $body, $seconds) {
    header("Content-Type: " . $type);
    private_cache($seconds);
    header("X-Content-Type-Options: nosniff");
    header("Content-Length: " . strlen($body));
    echo $body;
    comment_store_run_queued();
    exit;
}

function clean_gaps($gaps) {
    $allowed = array("cap20" => true, "cap40" => true, "page8" => true, "short" => true, "unread" => true, "more" => true, "many" => true, "alltime" => true);
    $fields = array("posts", "comments", "today", "total", "postsToday", "commentsToday");
    $out = array();
    if (!is_array($gaps)) return $out;
    foreach ($fields as $field) {
        if (!isset($gaps[$field]) || !is_string($gaps[$field]) || !isset($allowed[$gaps[$field]])) continue;
        $out[$field] = $gaps[$field];
    }
    return $out;
}

function send_counts($posts, $comments, $today = null, $total = null, $postsToday = null, $commentsToday = null, $cacheBlog = "", $gaps = array()) {
    $posts = count_or_null($posts);
    $comments = count_or_null($comments);
    $today = count_or_null($today);
    $total = count_or_null($total);
    $postsToday = count_or_null($postsToday);
    $commentsToday = count_or_null($commentsToday);
    $gaps = clean_gaps($gaps);
    $values = array(
        "posts" => $posts,
        "comments" => $comments,
        "today" => $today,
        "total" => $total,
        "postsToday" => $postsToday,
        "commentsToday" => $commentsToday
    );
    foreach ($values as $field => $value) {
        if ($value !== null) unset($gaps[$field]);
    }
    $payload = $values;
    if ($gaps) $payload["gaps"] = $gaps;
    $json = json_encode($payload);
    if (!is_string($json) || $json === "") $json = "{}";
    if ($cacheBlog !== "" && $json !== "{}") {
        write_cache("countsDay", $cacheBlog, false, "application/json; charset=utf-8", $json, 600);
    }
    send_body("application/json; charset=utf-8", $json, 600);
}

function json_count($value) {
    if (is_int($value)) return $value < 0 ? null : $value;
    if (is_string($value) && preg_match('/^\d{1,12}$/', $value)) return (int) $value;
    return null;
}

function naver_visitor_counts($status, $body) {
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

function naver_blog_no($status, $body) {
    if ($status !== 200 || $body === "") return "";
    $data = json_decode($body, true);
    if (!is_array($data) || empty($data["result"]) || !is_array($data["result"])) return "";
    $no = isset($data["result"]["blogNo"]) ? $data["result"]["blogNo"] : null;
    if (is_int($no)) $no = (string) $no;
    if (!is_string($no) || !preg_match('/^\d{1,12}$/', $no)) return "";
    return $no;
}

function naver_comment_url($blogNo, $logNo, $page) {
    return "https://apis.naver.com/commentBox/cbox/web_naver_list_jsonp.json"
        . "?ticket=blog&templateId=default&pool=cbox9&lang=ko&country=KR"
        . "&objectId=" . rawurlencode($blogNo . "_201_" . $logNo)
        . "&groupId=" . rawurlencode($blogNo)
        . "&pageSize=100&listType=OBJECT&pageType=more&page=" . (int) $page
        . "&initialize=true&replyPageSize=100&showReply=true";
}

function naver_comment_allow($blogNo, $logNo) {
    $objectId = $blogNo . "_201_" . $logNo;
    return function ($url) use ($blogNo, $objectId) {
        if (host_of($url) !== "apis.naver.com") return false;
        $parts = parse_url($url);
        if (!is_array($parts)) return false;
        $path = isset($parts["path"]) ? $parts["path"] : "";
        if ($path !== "/commentBox/cbox/web_naver_list_jsonp.json") return false;
        $query = array();
        if (!empty($parts["query"])) parse_str($parts["query"], $query);
        if (!isset($query["ticket"]) || $query["ticket"] !== "blog") return false;
        if (!isset($query["objectId"]) || $query["objectId"] !== $objectId) return false;
        if (!isset($query["groupId"]) || (string) $query["groupId"] !== (string) $blogNo) return false;
        if (!isset($query["page"]) || !preg_match('/^[1-9]\d{0,2}$/', (string) $query["page"])) return false;
        return true;
    };
}

function naver_comment_extras($blogId, $blogNo, $counts) {
    $bags = array();
    if (!preg_match('/^\d{1,12}$/', (string) $blogNo)) return array();
    $pending = array();
    foreach ($counts as $logNo => $count) {
        $logNo = (string) $logNo;
        if (!is_int($count) || $count <= 0 || !preg_match('/^\d{1,16}$/', $logNo)) continue;
        $pending[$logNo] = 1;
        $bags[$logNo] = array("pages" => array(), "done" => false);
    }
    for ($round = 0; $round < COMMENT_FETCH_ROUNDS && $pending; $round++) {
        $jobs = array();
        $order = array();
        foreach ($pending as $logNo => $page) {
            $jobs[] = array(
                "url" => naver_comment_url($blogNo, $logNo, $page),
                "limit" => BLOG_HTML_LIMIT,
                "allow" => naver_comment_allow($blogNo, $logNo),
                "headers" => array("Referer: https://m.blog.naver.com/" . rawurlencode($blogId) . "/" . rawurlencode($logNo)),
                "reject" => true,
                "timeout" => 6,
                "decode" => true,
                "ua" => tistory_browser()
            );
            $order[] = $logNo;
        }
        $next = array();
        foreach (fetch_urls($jobs) as $index => $page) {
            $logNo = $order[$index];
            if (!isset($bags[$logNo]) || $page[0] !== 200 || $page[1] === "") continue;
            $census = naver_comment_census($page[1]);
            if ($census === null) continue;
            $bags[$logNo]["pages"][] = $census;
            if (empty($census["hasNext"])) $bags[$logNo]["done"] = true;
            else $next[$logNo] = $pending[$logNo] + 1;
        }
        $pending = $next;
    }
    $out = array();
    foreach ($bags as $logNo => $bag) {
        if (!$bag["pages"]) continue;
        $merged = naver_comment_sum($bag["pages"], $bag["done"]);
        if ($merged !== null) $out[$logNo] = $merged;
    }
    return $out;
}

function tistory_browser() {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
}

function tistory_visitors($host, $fetched = null) {
    if (is_array($fetched)) {
        $status = isset($fetched[0]) ? (int) $fetched[0] : 0;
        $html = isset($fetched[1]) ? (string) $fetched[1] : "";
    } else {
        $allow = function ($url) use ($host) {
            if (host_of($url) !== $host) return false;
            $path = parse_url($url, PHP_URL_PATH);
            return !is_string($path) || $path === "" || $path === "/";
        };
        list($status, $html) = fetch_url(
            "https://" . $host . "/",
            BLOG_HTML_LIMIT,
            $allow,
            array("Accept-Language: ko-KR,ko;q=0.9"),
            true,
            6,
            true,
            tistory_browser()
        );
    }
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

function comment_store_path() {
    return __DIR__ . "/data/comment_store.json";
}

function comment_store_key_ok($key) {
    return is_string($key) && preg_match('/^(?:naver:[A-Za-z0-9_-]{1,40}|tistory:[a-z0-9.-]{1,80})$/', $key) === 1;
}

function comment_store_normalize($record) {
    if (!is_array($record) || !isset($record["counts"]) || !is_array($record["counts"])) return null;
    $counts = array();
    foreach ($record["counts"] as $id => $count) {
        $id = (string) $id;
        if (!preg_match('/^\d{1,16}$/', $id) || !is_int($count) || $count < 0 || isset($counts[$id])) return null;
        $counts[$id] = $count;
    }
    $today = array();
    if (isset($record["today"]) && is_array($record["today"])) {
        foreach ($record["today"] as $id => $count) {
            $id = (string) $id;
            if (!isset($counts[$id]) || !is_int($count) || $count < 0) continue;
            $today[$id] = $count;
        }
    }
    $savedAt = isset($record["savedAt"]) && is_int($record["savedAt"]) && $record["savedAt"] > 0 ? $record["savedAt"] : 0;
    return array("savedAt" => $savedAt, "counts" => $counts, "today" => $today);
}

function comment_store_locked($write, $change) {
    $path = comment_store_path();
    $dir = dirname($path);
    if (!is_dir($dir) || !is_writable($dir)) return null;
    $fh = @fopen($path, "c+");
    if (!$fh) return null;
    if (!flock($fh, $write ? LOCK_EX : LOCK_SH)) {
        fclose($fh);
        return null;
    }
    $raw = stream_get_contents($fh);
    $data = array();
    if (is_string($raw) && $raw !== "") {
        $decoded = json_decode($raw, true);
        if (is_array($decoded)) $data = $decoded;
    }
    if ($write) {
        $data = $change($data);
        $json = is_array($data) ? json_encode($data, JSON_UNESCAPED_SLASHES) : false;
        if (is_string($json)) {
            rewind($fh);
            if (ftruncate($fh, 0)) fwrite($fh, $json);
            fflush($fh);
            @chmod($path, 0600);
        }
        flock($fh, LOCK_UN);
        fclose($fh);
        return is_string($json);
    }
    $result = $change($data);
    flock($fh, LOCK_UN);
    fclose($fh);
    return $result;
}

function comment_store_read($key) {
    if (!comment_store_key_ok($key)) return null;
    return comment_store_locked(false, function ($data) use ($key) {
        if (!isset($data[$key]) || !is_array($data[$key])) return null;
        return comment_store_normalize($data[$key]);
    });
}

function comment_store_save($key, $record) {
    $record = comment_store_normalize($record);
    if (!comment_store_key_ok($key) || $record === null) return false;
    $saved = comment_store_locked(true, function ($data) use ($key, $record) {
        if (!is_array($data)) $data = array();
        $data[$key] = $record;
        return $data;
    });
    return $saved === true;
}

function comment_store_queue($key, $job) {
    if (!comment_store_key_ok($key) || !is_callable($job)) return;
    if (!isset($GLOBALS["BOTDASH_COMMENT_JOBS"]) || !is_array($GLOBALS["BOTDASH_COMMENT_JOBS"])) {
        $GLOBALS["BOTDASH_COMMENT_JOBS"] = array();
    }
    $GLOBALS["BOTDASH_COMMENT_JOBS"][$key] = $job;
}

function comment_store_run_queued() {
    $jobs = isset($GLOBALS["BOTDASH_COMMENT_JOBS"]) && is_array($GLOBALS["BOTDASH_COMMENT_JOBS"])
        ? $GLOBALS["BOTDASH_COMMENT_JOBS"] : array();
    $GLOBALS["BOTDASH_COMMENT_JOBS"] = array();
    if (!$jobs) return;
    ignore_user_abort(true);
    @set_time_limit(0);
    if (function_exists("fastcgi_finish_request")) @fastcgi_finish_request();
    else {
        while (ob_get_level() > 0) @ob_end_flush();
        @flush();
    }
    foreach ($jobs as $job) $job();
}

function naver_list_job($id, $page) {
    return array(
        "url" => "https://blog.naver.com/PostTitleListAsync.naver?blogId=" . rawurlencode($id)
            . "&currentPage=" . (int) $page
            . "&countPerPage=" . NAVER_LIST_PAGE_SIZE,
        "limit" => BLOG_HTML_LIMIT,
        "allow" => "naver_host_ok",
        "headers" => array("Referer: https://blog.naver.com/" . rawurlencode($id)),
        "reject" => true,
        "timeout" => 6,
        "decode" => true
    );
}

function naver_apply_comments($id, $blogNo, $pageCounts, $postTimes, $htmlFresh) {
    if (!is_array($pageCounts)) return null;
    $extras = naver_comment_extras($id, $blogNo, $pageCounts);
    $final = array();
    $todays = array();
    $sum = 0;
    $commentsToday = 0;
    $known = true;
    foreach ($pageCounts as $logNo => $count) {
        $logNo = (string) $logNo;
        if (!preg_match('/^\d{1,16}$/', $logNo) || !is_int($count) || $count < 0) return null;
        if (isset($extras[$logNo]) && is_int($extras[$logNo]["total"]) && $extras[$logNo]["total"] > $count) {
            $count = $extras[$logNo]["total"];
        }
        $final[$logNo] = $count;
        $sum += $count;
        if ($count === 0) {
            $todays[$logNo] = 0;
            continue;
        }
        $fresh = null;
        if (isset($extras[$logNo]) && is_int($extras[$logNo]["today"])) $fresh = $extras[$logNo]["today"];
        if ($fresh === null && is_array($htmlFresh) && array_key_exists($logNo, $htmlFresh)) $fresh = $htmlFresh[$logNo];
        if ($fresh === null) {
            $postRaw = is_array($postTimes) && isset($postTimes[$logNo]) ? $postTimes[$logNo] : "";
            $fresh = comments_on_fresh_post($postRaw, $count);
        }
        if (!is_int($fresh)) {
            $known = false;
            continue;
        }
        $todays[$logNo] = $fresh;
        $commentsToday += $fresh;
    }
    return array(
        "sum" => $sum,
        "today" => $known ? $commentsToday : null,
        "counts" => $final,
        "todays" => $todays,
        "known" => $known
    );
}

function naver_fetch_list_bodies($id, $firstBody, $pagesNeeded) {
    $bodies = array($firstBody);
    for ($from = 2; $from <= $pagesNeeded; $from += NAVER_LIST_BATCH) {
        $to = $from + NAVER_LIST_BATCH - 1;
        if ($to > $pagesNeeded) $to = $pagesNeeded;
        $jobs = array();
        for ($page = $from; $page <= $to; $page++) $jobs[] = naver_list_job($id, $page);
        foreach (fetch_urls($jobs) as $pageResult) {
            if ($pageResult[0] !== 200 || $pageResult[1] === "") return null;
            $bodies[] = $pageResult[1];
        }
    }
    return $bodies;
}

function naver_load_comments($id, $blogNo, $firstBody, $rssXml) {
    if (!preg_match('/"totalCount"\s*:\s*"?(\d+)/', (string) $firstBody, $totalMatch)) return array("error" => "unread");
    $total = (int) $totalMatch[1];
    if ($total === 0) {
        return array("total" => 0, "sum" => 0, "today" => 0, "counts" => array(), "todays" => array(), "known" => true);
    }
    $pagesNeeded = naver_list_page_count($total, NAVER_LIST_PAGE_SIZE, 0);
    if (!is_int($pagesNeeded) || $pagesNeeded < 1) return array("error" => "unread");
    $bodies = naver_fetch_list_bodies($id, $firstBody, $pagesNeeded);
    if (!is_array($bodies)) return array("error" => "unread");
    $merged = naver_list_merge($bodies, $total);
    if ($merged === null) return array("error" => "short");
    $logNos = $merged["logNos"];
    $postTimes = $merged["times"];
    if (is_string($rssXml) && $rssXml !== "") {
        foreach (naver_post_times("", $rssXml) as $logNo => $raw) $postTimes[$logNo] = $raw;
    }
    $pageCounts = $merged["counts"];
    $htmlFresh = array();
    if (!is_array($pageCounts)) {
        $pageCounts = array();
        $jobs = array();
        foreach ($logNos as $logNo) {
            $jobs[] = array(
                "url" => "https://m.blog.naver.com/" . rawurlencode($id) . "/" . rawurlencode($logNo),
                "limit" => BLOG_HTML_LIMIT,
                "allow" => "naver_host_ok",
                "headers" => array(),
                "reject" => true,
                "timeout" => 6,
                "decode" => true
            );
        }
        foreach (fetch_urls($jobs) as $index => $page) {
            list($pageStatus, $html) = $page;
            $count = naver_comment_count($html);
            if ($pageStatus !== 200 || $count === null) return array("error" => "unread");
            $logNo = (string) $logNos[$index];
            $pageCounts[$logNo] = $count;
            if ($count === 0) continue;
            $postRaw = isset($postTimes[$logNo]) ? $postTimes[$logNo] : "";
            $fresh = comments_on_fresh_post($postRaw, $count);
            if ($fresh === null) {
                $fresh = count_days($html, '/"(?:regTime|commentDate|registeredDate)"\s*:\s*"([^"]+)"/');
                if ($fresh === null) $fresh = count_days($html, '/u_cbox_date[^>]*>\s*([^<]{6,40})</i');
            }
            $htmlFresh[$logNo] = $fresh;
        }
    }
    $applied = naver_apply_comments($id, $blogNo, $pageCounts, $postTimes, $htmlFresh);
    if ($applied === null) return array("error" => "unread");
    $applied["total"] = $total;
    return $applied;
}

function naver_save_comments($id, $counts, $todays, $savedAt) {
    comment_store_save("naver:" . $id, array(
        "savedAt" => $savedAt,
        "counts" => $counts,
        "today" => $todays
    ));
}

function naver_refresh_comments($id) {
    $job = naver_list_job($id, 1);
    list($status, $body) = fetch_url(
        $job["url"],
        $job["limit"],
        $job["allow"],
        $job["headers"],
        !empty($job["reject"]),
        $job["timeout"],
        !empty($job["decode"])
    );
    if ($status !== 200 || $body === "") return;
    list($infoStatus, $infoBody) = fetch_url(
        "https://m.blog.naver.com/api/blogs/" . rawurlencode($id),
        BLOG_HTML_LIMIT,
        "naver_host_ok",
        array("Referer: https://m.blog.naver.com/" . rawurlencode($id)),
        true,
        6,
        true
    );
    $loaded = naver_load_comments($id, naver_blog_no($infoStatus, $infoBody), $body, "");
    if (!is_array($loaded) || isset($loaded["error"]) || !isset($loaded["counts"])) return;
    naver_save_comments($id, $loaded["counts"], $loaded["todays"], time());
}

function naver_comments_saved($id, $blogNo, $firstBody, $rssXml) {
    if (!preg_match('/"totalCount"\s*:\s*"?(\d+)/', (string) $firstBody, $totalMatch)) return null;
    $total = (int) $totalMatch[1];
    if ($total <= NAVER_LIST_PAGE_SIZE) return null;
    $head = naver_list_comment_counts($firstBody);
    if (!is_array($head)) return null;
    $stored = comment_store_read("naver:" . $id);
    if (!is_array($stored)) return null;
    $rest = comment_store_rest(array_keys($head), $stored["counts"], $total);
    if (!is_array($rest)) return null;
    $headTimes = naver_post_times($firstBody, is_string($rssXml) ? $rssXml : "");
    $applied = naver_apply_comments($id, $blogNo, $head, $headTimes, array());
    if (!is_array($applied)) return null;
    $olderSum = comment_store_sum($rest);
    if (!is_int($olderSum)) return null;
    $olderToday = comment_store_today_sum(array_keys($rest), $stored["today"]);
    $today = ($applied["known"] && is_int($olderToday) && is_int($applied["today"])) ? $applied["today"] + $olderToday : null;
    $counts = $rest;
    foreach ($applied["counts"] as $logNo => $count) $counts[$logNo] = $count;
    $todays = array();
    foreach ($counts as $logNo => $count) {
        if (isset($applied["todays"][$logNo])) $todays[$logNo] = $applied["todays"][$logNo];
        elseif (isset($stored["today"][$logNo]) && is_int($stored["today"][$logNo])) $todays[$logNo] = $stored["today"][$logNo];
    }
    naver_save_comments($id, $counts, $todays, $stored["savedAt"]);
    if (!is_int($stored["savedAt"]) || $stored["savedAt"] < time() - COMMENT_STORE_TTL) {
        comment_store_queue("naver:" . $id, function () use ($id) {
            naver_refresh_comments($id);
        });
    }
    return array("sum" => $applied["sum"] + $olderSum, "today" => $today, "known" => is_int($today));
}

function naver_counts($id) {
    $rssAllow = function ($url) use ($id) {
        if (host_of($url) !== "rss.blog.naver.com") return false;
        $path = parse_url($url, PHP_URL_PATH);
        return $path === "/" . $id . ".xml";
    };
    // 목록, RSS, 방문자 수는 서로 기다릴 필요가 없다.
    $wave = fetch_urls(array(
        naver_list_job($id, 1),
        array(
            "url" => "https://rss.blog.naver.com/" . rawurlencode($id) . ".xml",
            "limit" => BLOG_HTML_LIMIT,
            "allow" => $rssAllow,
            "headers" => array(),
            "reject" => true,
            "timeout" => 6,
            "decode" => true
        ),
        array(
            "url" => "https://m.blog.naver.com/api/blogs/" . rawurlencode($id),
            "limit" => BLOG_HTML_LIMIT,
            "allow" => "naver_host_ok",
            "headers" => array("Referer: https://m.blog.naver.com/" . rawurlencode($id)),
            "reject" => true,
            "timeout" => 6,
            "decode" => true
        )
    ));
    list($status, $body) = $wave[0];
    list($rssStatus, $xml) = $wave[1];
    $visitors = naver_visitor_counts($wave[2][0], $wave[2][1]);
    $blogNo = naver_blog_no($wave[2][0], $wave[2][1]);
    if ($status !== 200 || !preg_match('/"totalCount"\s*:\s*"?(\d+)/', $body, $totalMatch)) {
        return naver_count_row(null, null, $visitors[0], $visitors[1], null, null, array());
    }
    // 목록의 "5분 전"은 화면 문구라서 빠질 수 있다. RSS 발행 시각이 있으면 한국시간 오늘을 센다.
    $postsToday = ($rssStatus === 200 && $xml !== "") ? rss_posts_on_day($xml) : null;
    if ($postsToday === null) $postsToday = count_days($body, '/"addDate"\s*:\s*"([^"]+)"/');
    $total = (int) $totalMatch[1];
    if ($total === 0) return naver_count_row(0, 0, $visitors[0], $visitors[1], 0, 0, array());
    $rssXml = ($rssStatus === 200 && $xml !== "") ? $xml : "";
    // 20편을 넘으면 최근 목록만 다시 세고, 나머지는 저장분이 글 수와 맞을 때만 더한다.
    $saved = naver_comments_saved($id, $blogNo, $body, $rssXml);
    if (is_array($saved)) {
        return naver_count_row(
            $total,
            $saved["sum"],
            $visitors[0],
            $visitors[1],
            $postsToday,
            $saved["today"],
            $saved["known"] ? array() : array("commentsToday" => "")
        );
    }
    $loaded = naver_load_comments($id, $blogNo, $body, $rssXml);
    if (!is_array($loaded) || isset($loaded["error"])) {
        $gap = (is_array($loaded) && isset($loaded["error"])) ? $loaded["error"] : "unread";
        return naver_count_row($total, null, $visitors[0], $visitors[1], $postsToday, null, array(
            "comments" => $gap,
            "commentsToday" => $gap
        ));
    }
    naver_save_comments($id, $loaded["counts"], $loaded["todays"], time());
    return naver_count_row(
        $total,
        $loaded["sum"],
        $visitors[0],
        $visitors[1],
        $postsToday,
        $loaded["today"],
        $loaded["known"] ? array() : array("commentsToday" => "")
    );
}

function naver_count_row($posts, $comments, $today, $total, $postsToday, $commentsToday, $gaps) {
    $out = is_array($gaps) ? $gaps : array();
    $skipCommentsToday = isset($out["commentsToday"]) && $out["commentsToday"] === "";
    if ($skipCommentsToday) unset($out["commentsToday"]);
    if ($posts === null && !isset($out["posts"])) $out["posts"] = "unread";
    if ($comments === null && !isset($out["comments"])) $out["comments"] = "unread";
    if ($today === null && !isset($out["today"])) $out["today"] = "unread";
    if ($total === null && !isset($out["total"])) $out["total"] = "unread";
    if ($postsToday === null && !isset($out["postsToday"])) $out["postsToday"] = "unread";
    if ($commentsToday === null && !$skipCommentsToday && !isset($out["commentsToday"])) $out["commentsToday"] = "unread";
    return array($posts, $comments, $today, $total, $postsToday, $commentsToday, $out);
}

function tistory_comments($host, $postTotal, $fetched = null) {
    if ($postTotal === 0) return array(0, null, array());
    $allow = function ($url) use ($host) {
        if (host_of($url) !== $host) return false;
        $path = parse_url($url, PHP_URL_PATH);
        if (is_string($path) && $path !== "" && $path !== "/") return false;
        $query = array();
        $rawQuery = parse_url($url, PHP_URL_QUERY);
        if (is_string($rawQuery) && $rawQuery !== "") parse_str($rawQuery, $query);
        if (!$query) return true;
        return count($query) === 1
            && isset($query["page"])
            && preg_match('/^[1-9]\d{0,2}$/', (string) $query["page"]);
    };
    $counts = array();
    $status = 0;
    $html = "";
    $browser = tistory_browser();
    if (is_array($fetched)) {
        $status = isset($fetched[0]) ? (int) $fetched[0] : 0;
        $html = isset($fetched[1]) ? (string) $fetched[1] : "";
    }
    // 방문자 수를 읽을 때 받은 첫 화면을 다시 쓴다. 두 번째 요청이 막히면 댓글만 비었다.
    if ($status !== 200 || $html === "") {
        list($status, $html) = fetch_url("https://" . $host . "/", BLOG_HTML_LIMIT, $allow, array(), true, 6, true, $browser);
    }
    if ($status !== 200 || $html === "") return array(null, "unread", array());
    $added = tistory_comment_page($html, $counts);
    if ($added === null) return array(null, "unread", array());
    $stop = null;
    $page = 1;
    $postGoal = is_int($postTotal) ? $postTotal : null;
    while ($added > 0) {
        $next = tistory_list_continue($page, tistory_has_next_page($html, $page), count($counts), $postGoal, TISTORY_LIST_MAX_PAGES);
        if ($next === 0) break;
        if ($next === null) {
            $stop = "many";
            break;
        }
        $from = $next;
        $to = $from + 6;
        if ($to > TISTORY_LIST_MAX_PAGES) $to = TISTORY_LIST_MAX_PAGES;
        $jobs = array();
        for ($n = $from; $n <= $to; $n++) {
            $jobs[] = array(
                "url" => "https://" . $host . "/?page=" . $n,
                "limit" => BLOG_HTML_LIMIT,
                "allow" => $allow,
                "headers" => array(),
                "reject" => true,
                "timeout" => 6,
                "decode" => true,
                "ua" => $browser
            );
        }
        $halt = false;
        foreach (fetch_urls($jobs) as $index => $pageResult) {
            $page = $from + $index;
            $status = $pageResult[0];
            $html = $pageResult[1];
            if ($status !== 200 || $html === "") {
                $stop = "unread";
                $halt = true;
                break;
            }
            $added = tistory_comment_page($html, $counts);
            if ($added === null) {
                $stop = "unread";
                $halt = true;
                break;
            }
            if ($added === 0) {
                $stop = "short";
                $halt = true;
                break;
            }
            $step = tistory_list_continue($page, tistory_has_next_page($html, $page), count($counts), $postGoal, TISTORY_LIST_MAX_PAGES);
            if ($step === 0) {
                $halt = true;
                break;
            }
            if ($step === null) {
                $stop = "many";
                $halt = true;
                break;
            }
        }
        if ($halt) break;
    }
    // 상한에서 끊긴 목록은 전체처럼 보이지 않게 비운다.
    if ($stop === "many") return array(null, "many", $counts);
    // 글 수보다 적게 보면 합이 전체인 것처럼 보이지 않게 비운다.
    $sum = tistory_comment_total($counts, $postGoal);
    if ($sum === null) return array(null, $stop ? $stop : "short", array());
    return array($sum, null, $counts);
}

function tistory_posts_today($host, $fetched = null) {
    if (is_array($fetched)) {
        $status = isset($fetched[0]) ? (int) $fetched[0] : 0;
        $xml = isset($fetched[1]) ? (string) $fetched[1] : "";
    } else {
        $allow = function ($url) use ($host) {
            if (host_of($url) !== $host) return false;
            $path = parse_url($url, PHP_URL_PATH);
            return $path === "/rss" || $path === "/feed";
        };
        list($status, $xml) = fetch_url("https://" . $host . "/rss", BLOG_HTML_LIMIT, $allow, array(), true, 6, true);
    }
    if ($status !== 200 || $xml === "") return null;
    return rss_posts_on_day($xml);
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

function tistory_posts($host, $fetched = null, &$ids = null) {
    $allow = function ($url) use ($host) {
        if (host_of($url) !== $host) return false;
        $path = parse_url($url, PHP_URL_PATH);
        return is_string($path) && preg_match('#^/sitemap[^/]*\.xml$#i', $path);
    };
    if (is_array($fetched)) {
        $status = isset($fetched[0]) ? (int) $fetched[0] : 0;
        $xml = isset($fetched[1]) ? (string) $fetched[1] : "";
    } else {
        list($status, $xml) = fetch_url("https://" . $host . "/sitemap.xml", BLOG_HTML_LIMIT, $allow, array(), true, 6, true);
    }
    $fail = function () use (&$ids) {
        if (is_array($ids)) $ids = array();
        return null;
    };
    if ($status !== 200 || $xml === "") return $fail();
    if (stripos($xml, "<urlset") === false && stripos($xml, "<sitemapindex") === false) return $fail();
    $seen = array();
    if (stripos($xml, "<sitemapindex") !== false) {
        if (!preg_match_all('#<loc>\s*([^<]+)\s*</loc>#i', $xml, $children)) return $fail();
        if (count($children[1]) > TISTORY_SITEMAP_MAX) return $fail();
        $jobs = array();
        foreach ($children[1] as $child) {
            $child = trim(html_entity_decode($child, ENT_QUOTES, "UTF-8"));
            $jobs[] = array(
                "url" => $child,
                "limit" => BLOG_HTML_LIMIT,
                "allow" => $allow,
                "headers" => array(),
                "reject" => true,
                "timeout" => 6,
                "decode" => true
            );
        }
        $total = 0;
        foreach (fetch_urls($jobs) as $result) {
            list($childStatus, $childXml) = $result;
            if ($childStatus !== 200 || $childXml === "") return $fail();
            $total += numeric_post_locs($childXml, $seen);
        }
        if (is_array($ids)) $ids = array_keys($seen);
        return $total;
    }
    $total = numeric_post_locs($xml, $seen);
    if (is_array($ids)) $ids = array_keys($seen);
    return $total;
}

function tistory_comment_allow($host) {
    return function ($url) use ($host) {
        if (host_of($url) !== $host) return false;
        $path = parse_url($url, PHP_URL_PATH);
        if (!is_string($path) || !preg_match('#^/m/api/\d{1,12}/comment$#', $path)) return false;
        $rawQuery = parse_url($url, PHP_URL_QUERY);
        if (!is_string($rawQuery) || $rawQuery === "") return true;
        $query = array();
        parse_str($rawQuery, $query);
        return count($query) === 1
            && isset($query["startId"])
            && preg_match('/^\d{1,12}$/', (string) $query["startId"]);
    };
}

function tistory_comment_key($host) {
    return "tistory:" . strtolower((string) $host);
}

function tistory_comment_fetch($host, $ids) {
    $full = array();
    $todayBy = array();
    if (!is_array($ids) || !$ids) return array(null, "unread", $full, $todayBy);
    $allow = tistory_comment_allow($host);
    $pending = array();
    foreach ($ids as $id) {
        $id = (string) $id;
        if (!preg_match('/^\d{1,12}$/', $id)) return array(null, "unread", $full, $todayBy);
        $pending[$id] = "";
    }
    $total = 0;
    $running = array();
    for ($round = 0; $round < COMMENT_FETCH_ROUNDS && $pending; $round++) {
        $next = array();
        $idsNow = array_keys($pending);
        $countNow = count($idsNow);
        for ($offset = 0; $offset < $countNow; $offset += TISTORY_COMMENT_BATCH) {
            $slice = array_slice($idsNow, $offset, TISTORY_COMMENT_BATCH);
            $jobs = array();
            foreach ($slice as $id) {
                $url = "https://" . $host . "/m/api/" . $id . "/comment";
                if ($pending[$id] !== "") $url .= "?startId=" . rawurlencode($pending[$id]);
                $jobs[] = array(
                    "url" => $url,
                    "limit" => BLOG_HTML_LIMIT,
                    "allow" => $allow,
                    "headers" => array("Accept: application/json"),
                    "reject" => true,
                    "timeout" => 6,
                    "decode" => true,
                    "ua" => tistory_browser()
                );
            }
            foreach (fetch_urls($jobs) as $index => $page) {
                $id = $slice[$index];
                if ($page[0] !== 200 || $page[1] === "") return array(null, "unread", $full, $todayBy);
                $census = tistory_comment_census($page[1]);
                if ($census === null) return array(null, "unread", $full, $todayBy);
                $running[$id] = (isset($running[$id]) ? $running[$id] : 0) + $census["nodes"];
                if ($census["today"] === null) return array(null, "unread", $full, $todayBy);
                $todayBy[$id] = (isset($todayBy[$id]) ? $todayBy[$id] : 0) + $census["today"];
                $total += $census["today"];
                if ($census["isLast"]) {
                    $full[$id] = $running[$id];
                    if (!isset($todayBy[$id])) $todayBy[$id] = 0;
                    continue;
                }
                $start = $census["next"];
                if (!is_string($start) || isset($next[$id])) return array(null, "unread", $full, $todayBy);
                $next[$id] = $start;
            }
        }
        $pending = $next;
    }
    if ($pending) return array(null, "more", $full, $todayBy);
    return array($total, null, $full, $todayBy);
}

function tistory_save_comments($host, $counts, $todays, $savedAt) {
    comment_store_save(tistory_comment_key($host), array(
        "savedAt" => $savedAt,
        "counts" => $counts,
        "today" => $todays
    ));
}

function tistory_refresh_comments($host) {
    $ids = array();
    $posts = tistory_posts($host, null, $ids);
    if (!is_int($posts) || !$ids) return;
    $fetched = tistory_comment_fetch($host, $ids);
    if (!is_array($fetched) || $fetched[1] !== null || !is_array($fetched[2])) return;
    if (count($fetched[2]) !== count($ids)) return;
    $todays = isset($fetched[3]) && is_array($fetched[3]) ? $fetched[3] : array();
    tistory_save_comments($host, $fetched[2], $todays, time());
}

function tistory_comments_today($host, $ids) {
    $full = array();
    if (!is_array($ids) || !$ids) return array(null, "unread", $full);
    $key = tistory_comment_key($host);
    if (count($ids) > NAVER_LIST_PAGE_SIZE && comment_store_key_ok($key)) {
        $stored = comment_store_read($key);
        $head = tistory_newest_ids($ids, NAVER_LIST_PAGE_SIZE);
        $rest = is_array($stored) ? comment_store_rest($head, $stored["counts"], count($ids)) : null;
        if (is_array($rest) && count($head) === NAVER_LIST_PAGE_SIZE) {
            $headFetch = tistory_comment_fetch($host, $head);
            if (is_array($headFetch) && $headFetch[1] === null && is_array($headFetch[2]) && count($headFetch[2]) === count($head)) {
                $olderSum = comment_store_sum($rest);
                $headSum = comment_store_sum($headFetch[2]);
                if (is_int($olderSum) && is_int($headSum)) {
                    $merged = $rest;
                    foreach ($headFetch[2] as $id => $count) $merged[$id] = $count;
                    $headToday = isset($headFetch[3]) && is_array($headFetch[3]) ? $headFetch[3] : array();
                    $todays = array();
                    foreach ($merged as $id => $count) {
                        if (isset($headToday[$id]) && is_int($headToday[$id])) $todays[$id] = $headToday[$id];
                        elseif (isset($stored["today"][$id]) && is_int($stored["today"][$id])) $todays[$id] = $stored["today"][$id];
                    }
                    tistory_save_comments($host, $merged, $todays, $stored["savedAt"]);
                    if (!is_int($stored["savedAt"]) || $stored["savedAt"] < time() - COMMENT_STORE_TTL) {
                        comment_store_queue($key, function () use ($host) {
                            tistory_refresh_comments($host);
                        });
                    }
                    $olderToday = comment_store_today_sum(array_keys($rest), $stored["today"]);
                    $today = (is_int($headFetch[0]) && is_int($olderToday)) ? $headFetch[0] + $olderToday : null;
                    return array($today, $today === null ? "unread" : null, $merged);
                }
            }
        }
    }
    $fetched = tistory_comment_fetch($host, $ids);
    if (!is_array($fetched)) return array(null, "unread", $full);
    if ($fetched[1] === null && is_array($fetched[2]) && count($fetched[2]) === count($ids)) {
        $todays = isset($fetched[3]) && is_array($fetched[3]) ? $fetched[3] : array();
        tistory_save_comments($host, $fetched[2], $todays, time());
    }
    return array($fetched[0], $fetched[1], is_array($fetched[2]) ? $fetched[2] : $full);
}

function tistory_live($host) {
    $homeAllow = function ($url) use ($host) {
        if (host_of($url) !== $host) return false;
        $path = parse_url($url, PHP_URL_PATH);
        return !is_string($path) || $path === "" || $path === "/";
    };
    $rssAllow = function ($url) use ($host) {
        if (host_of($url) !== $host) return false;
        $path = parse_url($url, PHP_URL_PATH);
        return $path === "/rss" || $path === "/feed";
    };
    $sitemapAllow = function ($url) use ($host) {
        if (host_of($url) !== $host) return false;
        $path = parse_url($url, PHP_URL_PATH);
        return is_string($path) && preg_match('#^/sitemap[^/]*\.xml$#i', $path);
    };
    // 사이트맵, RSS, 첫 화면은 댓글 합계보다 먼저, 그리고 같이 받는다.
    $wave = fetch_urls(array(
        array(
            "url" => "https://" . $host . "/sitemap.xml",
            "limit" => BLOG_HTML_LIMIT,
            "allow" => $sitemapAllow,
            "headers" => array(),
            "reject" => true,
            "timeout" => 6,
            "decode" => true
        ),
        array(
            "url" => "https://" . $host . "/rss",
            "limit" => BLOG_HTML_LIMIT,
            "allow" => $rssAllow,
            "headers" => array(),
            "reject" => true,
            "timeout" => 6,
            "decode" => true
        ),
        array(
            "url" => "https://" . $host . "/",
            "limit" => BLOG_HTML_LIMIT,
            "allow" => $homeAllow,
            "headers" => array("Accept-Language: ko-KR,ko;q=0.9"),
            "reject" => true,
            "timeout" => 6,
            "decode" => true,
            "ua" => tistory_browser()
        )
    ));
    $entryIds = array();
    $posts = tistory_posts($host, $wave[0], $entryIds);
    $postsToday = tistory_posts_today($host, $wave[1]);
    list($todayCount, $total) = tistory_visitors($host, $wave[2]);
    $commentGap = null;
    $todayGap = null;
    if ($posts === 0) {
        $comments = 0;
        $commentsToday = 0;
        $postsTodayOut = 0;
    } else {
        list($comments, $commentGap, $spanCounts) = tistory_comments($host, $posts, $wave[2]);
        list($commentsToday, $todayGap, $fullCounts) = tistory_comments_today($host, $entryIds);
        $apiTotal = tistory_nodes_total(is_array($fullCounts) ? $fullCounts : array(), $entryIds);
        if (is_int($apiTotal)) {
            $comments = $apiTotal;
            $commentGap = null;
        } elseif (is_int($comments)) {
            $comments = tistory_apply_hidden_comments($comments, is_array($spanCounts) ? $spanCounts : array(), is_array($fullCounts) ? $fullCounts : array());
        }
        $postsTodayOut = $postsToday;
    }
    $gaps = array();
    if ($posts === null) $gaps["posts"] = "unread";
    if ($postsTodayOut === null) $gaps["postsToday"] = "unread";
    if ($comments === null) $gaps["comments"] = $commentGap ? $commentGap : "unread";
    if ($commentsToday === null) $gaps["commentsToday"] = $todayGap ? $todayGap : "unread";
    if ($todayCount === null) $gaps["today"] = "unread";
    if ($total === null) $gaps["total"] = "unread";
    return array($posts, $comments, $todayCount, $total, $postsTodayOut, $commentsToday, $gaps);
}

function image_type($body, $header) {
    // 원격 Content-Type 은 쓰지 않는다. image/svg+xml 이 이 주소로 열리면 스크립트가 된다.
    if (strncmp($body, "\xFF\xD8\xFF", 3) === 0) return "image/jpeg";
    if (strncmp($body, "\x89PNG", 4) === 0) return "image/png";
    if (strncmp($body, "GIF8", 4) === 0) return "image/gif";
    if (strlen($body) >= 12 && strncmp($body, "RIFF", 4) === 0 && substr($body, 8, 4) === "WEBP") return "image/webp";
    return "";
}

function blogger_same_blog($url, $name) {
    return blogspot_name(host_of($url)) === $name;
}

function blogger_feed_allow($name) {
    return function ($url) use ($name) {
        $path = parse_url($url, PHP_URL_PATH);
        if ($path !== "/feeds/posts/default" && $path !== "/feeds/comments/default") {
            if (host_of($url) !== "www.blogger.com") return false;
            return (bool) preg_match('#^/feeds/\d{1,24}/(?:posts|comments)/default$#', (string) $path);
        }
        return blogger_same_blog($url, $name);
    };
}

function blogger_home_allow($name) {
    return function ($url) use ($name) {
        if (!blogger_same_blog($url, $name)) return false;
        $path = parse_url($url, PHP_URL_PATH);
        return !is_string($path) || $path === "" || $path === "/";
    };
}

function blogger_stats_allow($name) {
    return function ($url) use ($name) {
        if (!blogger_same_blog($url, $name)) return false;
        return parse_url($url, PHP_URL_PATH) === "/b/stats";
    };
}

function fetch_form($url, $fields, $allow, $timeout = 8) {
    if (!function_exists("curl_init") || !is_callable($allow) || !$allow($url)) return array(0, "");
    $ch = curl_init($url);
    if ($ch === false) return array(0, "");
    curl_setopt_array($ch, array(
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query($fields),
        CURLOPT_HTTPHEADER => array(
            "Content-Type: application/x-www-form-urlencoded",
            "Accept: application/json"
        ),
        CURLOPT_USERAGENT => "BotDash/1.0"
    ));
    $body = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if (!is_string($body)) return array(0, "");
    return array($status, $body);
}

function blogger_google_allow($url) {
    $host = host_of($url);
    $path = parse_url($url, PHP_URL_PATH);
    if (!is_string($path)) return false;
    if ($host === "oauth2.googleapis.com") return $path === "/token";
    if ($host !== "www.googleapis.com") return false;
    if ($path === "/blogger/v3/blogs/byurl") return true;
    return (bool) preg_match('#^/blogger/v3/blogs/\d{1,24}/pageviews$#', $path);
}

function blogger_access_token($set) {
    if (!is_array($set) || empty($set["suffix"]) || !is_string($set["suffix"])) return "";
    $path = cache_dir() . "/blogger-access-" . hash("sha256", $set["suffix"]);
    if (is_file($path)) {
        $raw = @file_get_contents($path);
        $split = explode("\n", is_string($raw) ? $raw : "", 2);
        if (count($split) === 2 && preg_match('/^\d+$/', $split[0]) && (int) $split[0] > time() + 60 && $split[1] !== "" && strpos($split[1], "\n") === false) {
            return $split[1];
        }
    }
    list($status, $body) = fetch_form("https://oauth2.googleapis.com/token", array(
        "client_id" => $set["client_id"],
        "client_secret" => $set["client_secret"],
        "refresh_token" => $set["refresh_token"],
        "grant_type" => "refresh_token"
    ), "blogger_google_allow", 8);
    if ($status !== 200 || $body === "" || $body[0] !== "{") return "";
    $data = json_decode($body, true);
    if (!is_array($data) || empty($data["access_token"]) || !is_string($data["access_token"])) return "";
    if ($data["access_token"] === "" || strpos($data["access_token"], "\n") !== false) return "";
    $ttl = 3000;
    if (isset($data["expires_in"]) && is_numeric($data["expires_in"])) $ttl = (int) $data["expires_in"];
    $expires = time() + max(0, $ttl);
    $dir = cache_dir();
    if (is_dir($dir) && is_writable($dir)) {
        $tmp = $path . "." . getmypid() . ".tmp";
        if (@file_put_contents($tmp, (string) $expires . "\n" . $data["access_token"], LOCK_EX) !== false) {
            @chmod($tmp, 0600);
            if (!@rename($tmp, $path)) @unlink($tmp);
        }
    }
    return $data["access_token"];
}

function blogger_character_blog_map() {
    $dir = __DIR__ . "/characters";
    $map = array();
    if (!is_dir($dir)) return $map;
    $paths = glob($dir . "/*.md");
    if (!is_array($paths)) return $map;
    foreach ($paths as $path) {
        $suffix = basename($path, ".md");
        if (!preg_match('/^[A-Za-z0-9_]+$/', $suffix)) continue;
        $text = @file_get_contents($path);
        if (!is_string($text)) continue;
        $names = blogger_character_blogs($text);
        if ($names) $map[$suffix] = $names;
    }
    return $map;
}

function blogger_api_total($name) {
    $sets = blogger_sets_for($name, blogger_apply_character_blogs(
        blogger_credential_sets(botdash_env_vars()),
        blogger_character_blog_map()
    ));
    $blogUrl = "https://" . $name . ".blogspot.com/";
    foreach ($sets as $set) {
        $access = blogger_access_token($set);
        if ($access === "") continue;
        list($status, $body) = fetch_url(
            "https://www.googleapis.com/blogger/v3/blogs/byurl?url=" . rawurlencode($blogUrl),
            100000,
            "blogger_google_allow",
            array("Authorization: Bearer " . $access, "Accept: application/json"),
            true,
            8,
            true
        );
        $blogId = blogger_api_blog_id($status, $body);
        if ($blogId === "") continue;
        list($status, $body) = fetch_url(
            "https://www.googleapis.com/blogger/v3/blogs/" . $blogId . "/pageviews?range=all",
            100000,
            "blogger_google_allow",
            array("Authorization: Bearer " . $access, "Accept: application/json"),
            true,
            8,
            true
        );
        $total = blogger_api_pageviews($status, $body);
        if (is_int($total)) return $total;
    }
    return null;
}

function blogger_totals_path() {
    return __DIR__ . "/data/blogger_totals.json";
}

function visitor_days_path() {
    return __DIR__ . "/data/visitor_days.json";
}

function blogger_count_log_path() {
    return __DIR__ . "/data/blogger_count.log";
}

function blogger_path_state($path) {
    $bits = array("path=" . $path);
    $exists = is_file($path) || is_dir($path);
    $bits[] = $exists ? "있음" : "없음";
    if ($exists) {
        $perm = @fileperms($path);
        if (is_int($perm)) $bits[] = "mode=" . substr(sprintf("%o", $perm), -4);
        $owner = @fileowner($path);
        if (is_int($owner)) {
            $bits[] = "owner=" . $owner;
            if (function_exists("posix_getpwuid")) {
                $info = @posix_getpwuid($owner);
                if (is_array($info) && isset($info["name"]) && is_string($info["name"])) $bits[] = "ownername=" . $info["name"];
            }
        }
    }
    if (function_exists("posix_geteuid")) {
        $uid = posix_geteuid();
        $bits[] = "euid=" . $uid;
        if (function_exists("posix_getpwuid")) {
            $info = @posix_getpwuid($uid);
            if (is_array($info) && isset($info["name"]) && is_string($info["name"])) $bits[] = "user=" . $info["name"];
        }
    }
    $bits[] = is_readable($path) ? "읽기가능" : "읽기불가";
    $bits[] = is_writable($path) ? "쓰기가능" : "쓰기불가";
    return implode(" ", $bits);
}

function blogger_count_write($path, $line) {
    $dir = dirname($path);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    if (!is_dir($dir) || !is_writable($dir)) return false;
    $fh = @fopen($path, "a");
    if (!$fh) return false;
    $written = false;
    if (flock($fh, LOCK_EX)) {
        $written = fwrite($fh, $line . "\n") !== false;
        fflush($fh);
        flock($fh, LOCK_UN);
    }
    fclose($fh);
    if ($written) @chmod($path, 0644);
    return $written;
}

function blogger_count_log_enabled() {
    $vars = botdash_env_vars();
    $value = isset($vars["BOTDASH_COUNT_LOG"]) ? $vars["BOTDASH_COUNT_LOG"] : "";
    return botdash_flag_on(is_string($value) ? $value : "");
}

function blogger_count_log($message) {
    if (!blogger_count_log_enabled()) return;
    $line = seoul_clock()->format("Y-m-d\\TH:i:sP") . " " . str_replace(array("\r", "\n"), " ", (string) $message);
    $saved = array();
    if (blogger_count_write(blogger_count_log_path(), $line)) $saved[] = blogger_count_log_path();
    if (!$saved) {
        $tmp = rtrim(sys_get_temp_dir(), "/\\") . "/botdash-blogger-count.log";
        if (blogger_count_write($tmp, $line)) $saved[] = $tmp;
    }
    if (!$saved) error_log("[botdash] " . $line);
    if (PHP_SAPI !== "cli" && !headers_sent()) {
        header("X-Botdash-Log: " . ($saved ? implode(", ", $saved) : "error_log"));
    }
}

function blogger_record_total($blog, $total) {
    $total = count_or_null($total);
    if (blog_kind($blog) !== "blogger" || !is_int($total)) {
        blogger_count_log($blog . " 오늘 계산 실패: 블로거 주소가 아니거나 전체가 없음");
        return null;
    }
    $path = blogger_totals_path();
    $dir = dirname($path);
    if (!is_dir($dir) || !is_writable($dir)) {
        blogger_count_log($blog . " 오늘 계산 실패: data 폴더를 쓸 수 없음 " . blogger_path_state($dir));
        return null;
    }
    $fh = @fopen($path, "c+");
    if (!$fh) {
        blogger_count_log($blog . " 오늘 계산 실패: 파일을 열지 못함 " . blogger_path_state($path));
        return null;
    }
    if (!flock($fh, LOCK_EX)) {
        fclose($fh);
        blogger_count_log($blog . " 오늘 계산 실패: 파일 잠금을 얻지 못함 " . blogger_path_state($path));
        return null;
    }
    $raw = stream_get_contents($fh);
    if (!is_string($raw) || $raw === "") $data = array();
    else {
        $data = json_decode($raw, true);
        if (!is_array($data)) {
            blogger_count_log($blog . " 오늘 계산 실패: 기록 파일이 JSON이 아님");
            $data = array();
        }
    }
    $clock = seoul_clock();
    $stored = blogger_total_apply(is_array($data) ? $data : array(), $blog, $clock->format("Y-m-d"), $total, $clock);
    $today = blogger_today_count($stored, $blog, $total, $clock);
    if ($today === null) {
        blogger_count_log($blog . " 오늘 계산 실패: " . blogger_today_gap_reason($stored, $blog, $total, $clock));
    } else {
        $base = $total - $today;
        blogger_count_log($blog . " 전체 " . $total . " 어제 " . $base . " 오늘 " . $today);
    }
    $json = json_encode($stored, JSON_UNESCAPED_SLASHES);
    $wrote = false;
    if (is_string($json)) {
        rewind($fh);
        if (ftruncate($fh, 0) && fwrite($fh, $json) !== false) {
            fflush($fh);
            $wrote = true;
        }
    }
    flock($fh, LOCK_UN);
    fclose($fh);
    if ($wrote) @chmod($path, 0600);
    else blogger_count_log($blog . " 오늘 계산 실패: 마감 파일을 쓰지 못함 " . blogger_path_state($path));
    return $today;
}

function visitor_days_own($path) {
    $dir = dirname($path);
    $owner = @fileowner($dir);
    $group = @filegroup($dir);
    if (is_int($owner)) @chown($path, $owner);
    if (is_int($group)) @chgrp($path, $group);
    @chmod($path, 0600);
}

/**
 * 오늘 방문자 한 칸을 data/visitor_days.json 에 남긴다.
 * 지난 날짜와 더 작은 같은 날 값은 visitor_day_apply 가 거절한다.
 */
function visitor_record_day($blog, $count, $now = null) {
    $count = count_or_null($count);
    if (!is_string($blog) || visitor_blog_url($blog) !== $blog || !is_int($count)) return false;
    $path = visitor_days_path();
    $dir = dirname($path);
    if (!is_dir($dir) || !is_writable($dir)) return false;
    $fh = @fopen($path, "c+");
    if (!$fh) return false;
    if (!flock($fh, LOCK_EX)) {
        fclose($fh);
        return false;
    }
    $raw = stream_get_contents($fh);
    if (!is_string($raw) || $raw === "") $data = array();
    else {
        $data = json_decode($raw, true);
        if (!is_array($data)) $data = array();
    }
    $clock = seoul_clock($now);
    $stored = visitor_day_apply(is_array($data) ? $data : array(), $blog, $clock->format("Y-m-d"), $count, $clock);
    $json = json_encode($stored, JSON_UNESCAPED_SLASHES);
    $wrote = false;
    if (is_string($json)) {
        rewind($fh);
        if (ftruncate($fh, 0) && fwrite($fh, $json) !== false) {
            fflush($fh);
            $wrote = true;
        }
    }
    flock($fh, LOCK_UN);
    fclose($fh);
    if ($wrote) visitor_days_own($path);
    return $wrote;
}

function blogger_cached_counts($blog, $data) {
    if (!is_array($data)) return $data;
    $total = isset($data["total"]) ? $data["total"] : null;
    if (is_string($total) && preg_match('/^\d{1,12}$/', $total)) $total = (int) $total;
    if (!is_int($total)) {
        blogger_count_log($blog . " 오늘 계산 실패: 저장된 집계에 전체가 없음");
        return $data;
    }
    $today = blogger_record_total($blog, $total);
    $data["today"] = $today;
    if (!isset($data["gaps"]) || !is_array($data["gaps"])) $data["gaps"] = array();
    if ($today === null) $data["gaps"]["today"] = "alltime";
    else unset($data["gaps"]["today"]);
    if (!$data["gaps"]) unset($data["gaps"]);
    return $data;
}

function blogger_job($url, $allow, $timeout) {
    return array(
        "url" => $url,
        "limit" => BLOG_HTML_LIMIT,
        "allow" => $allow,
        "headers" => array("Accept-Language: en-US,en;q=0.9"),
        "reject" => true,
        "timeout" => $timeout,
        "decode" => true,
        "ua" => tistory_browser()
    );
}

function blogger_alltime($name) {
    if (!is_string($name) || blogspot_name($name . ".blogspot.com") !== $name) return null;
    $total = blogger_api_total($name);
    if (is_int($total)) return $total;
    list($status, $body) = fetch_url(
        "https://" . $name . ".blogspot.com/",
        BLOG_HTML_LIMIT,
        blogger_home_allow($name),
        array("Accept-Language: en-US,en;q=0.9"),
        true,
        8,
        true,
        tistory_browser()
    );
    if ($status !== 200) return null;
    $statsUrl = blogger_stats_url($body, $name);
    if ($statsUrl === "") return null;
    list($status, $body) = fetch_url(
        $statsUrl,
        100000,
        blogger_stats_allow($name),
        array("Referer: https://" . $name . ".blogspot.com/"),
        true,
        6,
        true,
        tistory_browser()
    );
    return blogger_stats_total($status, $body);
}

function blogger_live($name) {
    $min = blogger_published_min();
    $feedAllow = blogger_feed_allow($name);
    $wave = fetch_urls(array(
        blogger_job("https://" . $name . ".blogspot.com/", blogger_home_allow($name), 8),
        blogger_job(blogger_feed_url($name, "posts", ""), $feedAllow, 6),
        blogger_job(blogger_feed_url($name, "posts", $min), $feedAllow, 6),
        blogger_job(blogger_feed_url($name, "comments", ""), $feedAllow, 6),
        blogger_job(blogger_feed_url($name, "comments", $min), $feedAllow, 6)
    ));
    $posts = blogger_feed_total($wave[1][0], $wave[1][1]);
    $comments = blogger_feed_total($wave[3][0], $wave[3][1]);
    $postsToday = blogger_window_count($posts, blogger_feed_total($wave[2][0], $wave[2][1]));
    $commentsToday = blogger_window_count($comments, blogger_feed_total($wave[4][0], $wave[4][1]));
    $pageviews = blogger_api_total($name);
    $todayGap = "unread";
    if (!is_int($pageviews)) {
        $statsUrl = ($wave[0][0] === 200) ? blogger_stats_url($wave[0][1], $name) : "";
        if ($statsUrl !== "") {
            $todayGap = "alltime";
            list($status, $body) = fetch_url(
                $statsUrl,
                100000,
                blogger_stats_allow($name),
                array("Referer: https://" . $name . ".blogspot.com/"),
                true,
                6,
                true,
                tistory_browser()
            );
            $pageviews = blogger_stats_total($status, $body);
        }
    }
    $gaps = array("today" => $todayGap);
    if ($posts === null) $gaps["posts"] = "unread";
    if ($postsToday === null) $gaps["postsToday"] = "unread";
    if ($comments === null) $gaps["comments"] = "unread";
    if ($commentsToday === null) $gaps["commentsToday"] = "unread";
    if ($pageviews === null) $gaps["total"] = "unread";
    return array($posts, $comments, null, $pageviews, $postsToday, $commentsToday, $gaps);
}

function blogger_photo_url($name, $large) {
    list($status, $body) = fetch_url(
        blogger_feed_url($name, "posts", ""),
        BLOG_HTML_LIMIT,
        blogger_feed_allow($name),
        array(),
        true,
        6,
        true,
        tistory_browser()
    );
    $image = ($status === 200) ? blogger_author_image($body, $large) : "";
    if ($image !== "") return $image;
    list($status, $html) = fetch_url(
        "https://" . $name . ".blogspot.com/",
        BLOG_HTML_LIMIT,
        blogger_home_allow($name),
        array("Accept-Language: en-US,en;q=0.9"),
        true,
        8,
        true,
        tistory_browser()
    );
    if ($status !== 200) return "";
    return blogger_html_image($html, $large);
}

if (!defined("BOTDASH_PROFILE_LIBRARY")) {
$blog = isset($_GET["blog"]) ? trim((string) $_GET["blog"]) : "";
$kind = blog_kind($blog);
if ($kind === "") deny();

if (isset($_GET["view"]) && (string) $_GET["view"] === "counts") {
    blogger_count_log("집계 요청 kind=" . $kind . " blog=" . $blog);
    $cached = read_cache("countsDay", $blog, false, "json");
    if ($cached !== null) {
        $cachedData = json_decode($cached[1], true);
        if ($kind === "blogger" && is_array($cachedData)) {
            $cachedData = blogger_cached_counts($blog, $cachedData);
            $body = json_encode($cachedData);
            if (is_string($body)) send_body($cached[0], $body, 600);
            blogger_count_log($blog . " 오늘 계산 실패: 응답을 만들지 못함");
        } elseif ($kind === "blogger") {
            blogger_count_log($blog . " 오늘 계산 실패: 저장된 집계 본문이 아님");
        }
        send_body($cached[0], $cached[1], 600);
    }
    if ($kind === "naver") {
        $id = naver_blog_id($blog);
        if ($id === "") send_counts(null, null, null, null, null, null, $blog, array(
            "posts" => "unread",
            "comments" => "unread",
            "today" => "unread",
            "total" => "unread",
            "postsToday" => "unread",
            "commentsToday" => "unread"
        ));
        $row = naver_counts($id);
        send_counts($row[0], $row[1], $row[2], $row[3], $row[4], $row[5], $blog, isset($row[6]) ? $row[6] : array());
    }
    if ($kind === "blogger") {
        $name = blogspot_name(host_of($blog));
        if ($name === "") {
            blogger_count_log($blog . " 오늘 계산 실패: 블로거 주소를 읽지 못함");
            send_counts(null, null, null, null, null, null, $blog, array(
            "posts" => "unread",
            "comments" => "unread",
            "today" => "unread",
            "total" => "unread",
            "postsToday" => "unread",
            "commentsToday" => "unread"
        ));
        }
        $row = blogger_live($name);
        $gaps = isset($row[6]) && is_array($row[6]) ? $row[6] : array();
        $today = null;
        if (is_int($row[3])) {
            $today = blogger_record_total($blog, $row[3]);
            if ($today === null) $gaps["today"] = "alltime";
            else unset($gaps["today"]);
        } else {
            blogger_count_log($blog . " 오늘 계산 실패: 전체를 읽지 못함");
        }
        send_counts($row[0], $row[1], $today, $row[3], $row[4], $row[5], $blog, $gaps);
    }
    $row = tistory_live(host_of($blog));
    send_counts($row[0], $row[1], $row[2], $row[3], $row[4], $row[5], $blog, isset($row[6]) ? $row[6] : array());
}

$large = isset($_GET["size"]) && (string) $_GET["size"] === "large";
$cachedImage = read_cache("image", $blog, $large, "image");
if ($cachedImage !== null) send_body($cachedImage[0], $cachedImage[1], 3600);

if ($kind === "blogger") {
    $name = blogspot_name(host_of($blog));
    if ($name === "") deny();
    $image = blogger_photo_url($name, $large);
    if ($image === "" || !image_host_ok($image) || is_placeholder($image)) deny();
    $imageLimit = $large ? 4000000 : IMAGE_LIMIT;
    list($imageStatus, $bytes, $contentType) = fetch_url($image, $imageLimit, function ($url) {
        return image_host_ok($url) && !is_placeholder($url);
    }, array(), true);
    $type = image_type($bytes, $contentType);
    if ($imageStatus !== 200 || $type === "" || $bytes === "") deny();
    write_cache("image", $blog, $large, $type, $bytes, 3600);
    send_body($type, $bytes, 3600);
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

write_cache("image", $blog, $large, $type, $bytes, 3600);
send_body($type, $bytes, 3600);
}
