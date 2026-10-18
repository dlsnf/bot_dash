<?php
/**
 * 네이버·티스토리 블로그의 프로필 사진, 또는 글·댓글 수만 같은 주소로 돌려준다.
 * size=large 는 카드용으로 줄인 사진 대신 더 큰 원본에 가까운 사진을 돌려준다.
 * 사진이 없거나 기본 이미지면 404. 화면은 그때 기본 캐릭터 이미지를 쓴다.
 * view=counts 는 {"posts","comments","today","total","postsToday","commentsToday"} 를 돌려준다.
 * 값은 정수이거나 null이다. postsToday, commentsToday 는 최근 24시간 동안 올라온 개수다.
 * null 인 칸은 gaps 에 이유를 붙인다. 오늘 방문자는 data/history.json 에 날짜마다 하나 남긴다.
 * 블로그 주소 외의 요청은 받지 않고, 받아 온 본문은 그대로 내보내지 않는다.
 */
ini_set("display_errors", "0");
header("X-Robots-Tag: noindex, nofollow, noarchive, nosnippet");
require_once __DIR__ . "/auth.php";
require_once __DIR__ . "/profile_count.php";
// 세션 기본값이 no-cache 라서 Expires·Pragma 가 남으면 브라우저가 사진과 집계를 저장하지 않는다.
if (session_status() !== PHP_SESSION_ACTIVE) {
    session_cache_limiter("");
}
if (!botdash_logged_in()) {
    http_response_code(401);
    header("Content-Type: text/plain; charset=utf-8");
    header_remove("Pragma");
    header_remove("Expires");
    header("Cache-Control: private, no-store");
    exit;
}

const BLOG_HTML_LIMIT = 500000;
const IMAGE_LIMIT = 2000000;
const COMMENT_CAP = 20;

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
    echo $body;
    exit;
}

function clean_gaps($gaps) {
    $allowed = array("cap20" => true, "cap40" => true, "page8" => true, "short" => true, "unread" => true, "more" => true);
    $fields = array("posts", "comments", "today", "total", "postsToday", "commentsToday");
    $out = array();
    if (!is_array($gaps)) return $out;
    foreach ($fields as $field) {
        if (!isset($gaps[$field]) || !is_string($gaps[$field]) || !isset($allowed[$gaps[$field]])) continue;
        $out[$field] = $gaps[$field];
    }
    return $out;
}

function record_blog_today($blog, $today) {
    if (blog_kind($blog) === "") return;
    $today = count_or_null($today);
    if (!is_int($today)) return;
    $path = __DIR__ . "/data/history.json";
    $dir = dirname($path);
    if (!is_dir($dir) || !is_writable($dir)) return;
    $fh = @fopen($path, "c+");
    if (!$fh) return;
    if (!flock($fh, LOCK_EX)) {
        fclose($fh);
        return;
    }
    $raw = stream_get_contents($fh);
    $data = json_decode(is_string($raw) ? $raw : "", true);
    $next = history_apply(is_array($data) ? $data : array(), $blog, seoul_clock()->format("Y-m-d"), $today);
    $json = json_encode($next, JSON_UNESCAPED_SLASHES);
    if (is_string($json)) {
        rewind($fh);
        if (ftruncate($fh, 0)) {
            fwrite($fh, $json);
            fflush($fh);
        }
    }
    flock($fh, LOCK_UN);
    fclose($fh);
    @chmod($path, 0600);
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
        write_cache("counts24", $cacheBlog, false, "application/json; charset=utf-8", $json, 600);
        record_blog_today($cacheBlog, $today);
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

function naver_counts($id) {
    $listUrl = "https://blog.naver.com/PostTitleListAsync.naver?blogId=" . rawurlencode($id)
        . "&currentPage=1&countPerPage=" . COMMENT_CAP;
    $rssAllow = function ($url) use ($id) {
        if (host_of($url) !== "rss.blog.naver.com") return false;
        $path = parse_url($url, PHP_URL_PATH);
        return $path === "/" . $id . ".xml";
    };
    // 목록, RSS, 방문자 수는 서로 기다릴 필요가 없다.
    $wave = fetch_urls(array(
        array(
            "url" => $listUrl,
            "limit" => BLOG_HTML_LIMIT,
            "allow" => "naver_host_ok",
            "headers" => array("Referer: https://blog.naver.com/" . rawurlencode($id)),
            "reject" => true,
            "timeout" => 6,
            "decode" => true
        ),
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
    if ($status !== 200 || !preg_match('/"totalCount"\s*:\s*"?(\d+)/', $body, $totalMatch)) {
        return naver_count_row(null, null, $visitors[0], $visitors[1], null, null, array());
    }
    // 목록의 "5분 전"은 화면 문구라서 빠질 수 있다. RSS 발행 시각이 있으면 지금으로부터 24시간을 센다.
    $postsToday = ($rssStatus === 200 && $xml !== "") ? rss_posts_on_day($xml) : null;
    if ($postsToday === null) $postsToday = count_days($body, '/"addDate"\s*:\s*"([^"]+)"/');
    $postTimes = naver_post_times($body, ($rssStatus === 200 && $xml !== "") ? $xml : "");
    $total = (int) $totalMatch[1];
    if ($total === 0) return naver_count_row(0, 0, $visitors[0], $visitors[1], 0, 0, array());
    // 글이 상한보다 많으면 일부 댓글만 더해 전체인 것처럼 보여 주지 않는다.
    if ($total > COMMENT_CAP) {
        return naver_count_row($total, null, $visitors[0], $visitors[1], $postsToday, null, array(
            "comments" => "cap20",
            "commentsToday" => "cap20"
        ));
    }
    if (!preg_match_all('/"logNo"\s*:\s*"(\d+)"/', $body, $logMatch)) {
        return naver_count_row($total, null, $visitors[0], $visitors[1], $postsToday, null, array(
            "comments" => "short",
            "commentsToday" => "short"
        ));
    }
    $logNos = array_values(array_unique($logMatch[1]));
    if (count($logNos) !== $total) {
        return naver_count_row($total, null, $visitors[0], $visitors[1], $postsToday, null, array(
            "comments" => "short",
            "commentsToday" => "short"
        ));
    }
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
    $pages = fetch_urls($jobs);
    $sum = 0;
    $commentsToday = 0;
    $commentsKnown = true;
    foreach ($pages as $index => $page) {
        list($pageStatus, $html) = $page;
        $count = naver_comment_count($html);
        if ($pageStatus !== 200 || $count === null) {
            return naver_count_row($total, null, $visitors[0], $visitors[1], $postsToday, null, array(
                "comments" => "unread",
                "commentsToday" => "unread"
            ));
        }
        $sum += $count;
        if ($count === 0) continue;
        // 글이 24시간 안이면 그 글의 댓글도 그 안이다. 시각이 없다고 0으로 두지 않는다.
        $logNo = $logNos[$index];
        $postRaw = isset($postTimes[$logNo]) ? $postTimes[$logNo] : "";
        $fresh = comments_on_fresh_post($postRaw, $count);
        if ($fresh === null) {
            $fresh = count_days($html, '/"(?:regTime|commentDate|registeredDate)"\s*:\s*"([^"]+)"/');
            if ($fresh === null) {
                $fresh = count_days($html, '/u_cbox_date[^>]*>\s*([^<]{6,40})</i');
            }
        }
        if ($fresh === null) {
            $commentsKnown = false;
            continue;
        }
        $commentsToday += $fresh;
    }
    return naver_count_row(
        $total,
        $sum,
        $visitors[0],
        $visitors[1],
        $postsToday,
        $commentsKnown ? $commentsToday : null,
        $commentsKnown ? array() : array("commentsToday" => "")
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

function tistory_comments($host, $postTotal) {
    if ($postTotal === 0) return array(0, null);
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
    $browser = tistory_browser();
    list($status, $html) = fetch_url("https://" . $host . "/", BLOG_HTML_LIMIT, $allow, array(), true, 6, true, $browser);
    if ($status !== 200 || $html === "") return array(null, "unread");
    $added = tistory_comment_page($html, $counts);
    if ($added === null) return array(null, "unread");
    $stop = null;
    if ($added > 0 && tistory_has_next_page($html, 1)) {
        $jobs = array();
        for ($page = 2; $page <= 8; $page++) {
            $jobs[] = array(
                "url" => "https://" . $host . "/?page=" . $page,
                "limit" => BLOG_HTML_LIMIT,
                "allow" => $allow,
                "headers" => array(),
                "reject" => true,
                "timeout" => 6,
                "decode" => true,
                "ua" => $browser
            );
        }
        $pages = fetch_urls($jobs);
        foreach ($pages as $index => $pageResult) {
            $page = $index + 2;
            $status = $pageResult[0];
            $html = $pageResult[1];
            if ($status !== 200 || $html === "") {
                $stop = "unread";
                break;
            }
            $added = tistory_comment_page($html, $counts);
            if ($added === null) {
                $stop = "unread";
                break;
            }
            if ($added === 0) {
                $stop = "short";
                break;
            }
            if (!tistory_has_next_page($html, $page)) break;
            if ($page === 8) {
                $stop = "page8";
                break;
            }
        }
    }
    // 글 수보다 적게 보면 합이 전체인 것처럼 보이지 않게 비운다.
    $sum = tistory_comment_total($counts, is_int($postTotal) ? $postTotal : null);
    if ($sum === null) return array(null, $stop ? $stop : "short");
    return array($sum, null);
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
        if (count($children[1]) > 4) return $fail();
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

function tistory_comments_today($host, $ids) {
    if (!is_array($ids) || !$ids) return array(null, "unread");
    if (count($ids) > 40) return array(null, "cap40");
    $allow = tistory_comment_allow($host);
    $pending = array();
    foreach ($ids as $id) {
        $id = (string) $id;
        if (!preg_match('/^\d{1,12}$/', $id)) return array(null, "unread");
        $pending[$id] = "";
    }
    $total = 0;
    for ($round = 0; $round < 5 && $pending; $round++) {
        $jobs = array();
        $order = array();
        foreach ($pending as $id => $start) {
            $url = "https://" . $host . "/m/api/" . $id . "/comment";
            if ($start !== "") $url .= "?startId=" . rawurlencode($start);
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
            $order[] = $id;
        }
        $next = array();
        foreach (fetch_urls($jobs) as $index => $page) {
            if ($page[0] !== 200 || $page[1] === "") return array(null, "unread");
            $parsed = tistory_comment_window($page[1]);
            if ($parsed === null) return array(null, "unread");
            $total += $parsed[0];
            if ($parsed[1]) continue;
            $start = $parsed[2];
            if (!is_string($start) || isset($next[$order[$index]])) return array(null, "unread");
            $next[$order[$index]] = $start;
        }
        $pending = $next;
    }
    if ($pending) return array(null, "more");
    return array($total, null);
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
        list($comments, $commentGap) = tistory_comments($host, $posts);
        list($commentsToday, $todayGap) = tistory_comments_today($host, $entryIds);
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
    $cached = read_cache("counts24", $blog, false, "json");
    if ($cached !== null) {
        $cachedData = json_decode($cached[1], true);
        if (is_array($cachedData) && array_key_exists("today", $cachedData)) record_blog_today($blog, $cachedData["today"]);
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
    $row = tistory_live(host_of($blog));
    send_counts($row[0], $row[1], $row[2], $row[3], $row[4], $row[5], $blog, isset($row[6]) ? $row[6] : array());
}

$large = isset($_GET["size"]) && (string) $_GET["size"] === "large";
$cachedImage = read_cache("image", $blog, $large, "image");
if ($cachedImage !== null) send_body($cachedImage[0], $cachedImage[1], 3600);

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
