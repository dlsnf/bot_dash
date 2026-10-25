<?php
/**
 * 글·댓글 수를 세는 순수 함수.
 * 네트워크는 하지 않는다. profile.php 가 받아 온 본문을 여기로 넘긴다.
 */

function seoul_clock($now = null) {
    if ($now instanceof DateTimeInterface) {
        $date = new DateTime("@" . $now->getTimestamp());
        $date->setTimezone(new DateTimeZone("Asia/Seoul"));
        return $date;
    }
    return new DateTime("now", new DateTimeZone("Asia/Seoul"));
}

function botdash_flag_on($value) {
    if (!is_string($value)) return false;
    $value = strtolower(trim($value));
    return $value === "1" || $value === "on" || $value === "true" || $value === "yes";
}

function clock_offset($seconds, $now = null) {
    $date = seoul_clock($now);
    $date->setTimestamp($date->getTimestamp() + (int) $seconds);
    return $date;
}

function seoul_midnight($year, $month, $day) {
    $date = new DateTime("now", new DateTimeZone("Asia/Seoul"));
    $date->setDate((int) $year, (int) $month, (int) $day);
    $date->setTime(0, 0, 0);
    return $date;
}

function zone_from_offset($offset) {
    if ($offset === "Z") return new DateTimeZone("UTC");
    if (preg_match('/^([+\-])(\d{2}):?(\d{2})$/', (string) $offset, $matched)) {
        return new DateTimeZone($matched[1] . $matched[2] . ":" . $matched[3]);
    }
    return new DateTimeZone("Asia/Seoul");
}

/**
 * 글·댓글 시각. 시·분이 없으면 그 날짜의 서울 0시다.
 * 날짜만 있으면 그 서울 날짜의 0시로 보고, 한국시간 오늘에 들어가는지로 센다.
 */
function event_instant($raw, $now = null) {
    $text = trim(html_entity_decode((string) $raw, ENT_QUOTES, "UTF-8"));
    if ($text === "") return null;
    $clock = seoul_clock($now);
    if ($text === "오늘" || preg_match('/^(?:방금|조금)\s*전$/u', $text)) return clone $clock;
    if (preg_match('/^(\d+)\s*초\s*전$/u', $text, $matched)) return clock_offset(-1 * (int) $matched[1], $clock);
    if (preg_match('/^(\d+)\s*분\s*전$/u', $text, $matched)) return clock_offset(-60 * (int) $matched[1], $clock);
    if (preg_match('/^(\d+)\s*시간\s*전$/u', $text, $matched)) return clock_offset(-3600 * (int) $matched[1], $clock);
    if ($text === "어제" || preg_match('/^(\d+)\s*일\s*전$/u', $text, $matched)) {
        $days = $text === "어제" ? 1 : (int) $matched[1];
        $instant = clone $clock;
        $instant->modify("-" . $days . " days");
        $instant->setTime(0, 0, 0);
        return $instant;
    }
    $compact = preg_replace("/\s+/", "", $text);
    if (preg_match("/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/", $compact, $matched)) {
        return new DateTime(
            $matched[1] . "-" . $matched[2] . "-" . $matched[3] . " " . $matched[4] . ":" . $matched[5] . ":" . $matched[6],
            new DateTimeZone("Asia/Seoul")
        );
    }
    if (preg_match("/^(\d{4})(\d{2})(\d{2})$/", $compact, $matched)) {
        return seoul_midnight($matched[1], $matched[2], $matched[3]);
    }
    if (preg_match("/^(\d{10,13})$/", $compact, $matched)) {
        $seconds = strlen($matched[1]) > 10 ? (int) floor(((float) $matched[1]) / 1000) : (int) $matched[1];
        $date = new DateTime("@" . $seconds);
        $date->setTimezone(new DateTimeZone("Asia/Seoul"));
        return $date;
    }
    if (preg_match('/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+\-]\d{2}:?\d{2})?)?$/', $text, $matched)) {
        if (!isset($matched[4]) || $matched[4] === "") return seoul_midnight($matched[1], $matched[2], $matched[3]);
        $second = (isset($matched[6]) && $matched[6] !== "") ? $matched[6] : "00";
        $zone = zone_from_offset(isset($matched[7]) ? $matched[7] : "");
        return new DateTime(
            sprintf("%s-%s-%s %s:%s:%s", $matched[1], $matched[2], $matched[3], $matched[4], $matched[5], $second),
            $zone
        );
    }
    if (preg_match('/(\d{4})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})\.?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/u', $text, $matched)) {
        if (!isset($matched[4]) || $matched[4] === "") return seoul_midnight($matched[1], $matched[2], $matched[3]);
        $second = (isset($matched[6]) && $matched[6] !== "") ? (int) $matched[6] : 0;
        $date = seoul_midnight($matched[1], $matched[2], $matched[3]);
        $date->setTime((int) $matched[4], (int) $matched[5], $second);
        return $date;
    }
    try {
        $date = new DateTime($text);
    } catch (Exception $error) {
        return null;
    }
    if (!preg_match('/\d{1,2}:\d{2}/', $text)) {
        $date->setTimezone(new DateTimeZone("Asia/Seoul"));
        return seoul_midnight($date->format("Y"), $date->format("n"), $date->format("j"));
    }
    return $date;
}

function seoul_day_start($now = null) {
    $clock = seoul_clock($now);
    $clock->setTime(0, 0, 0);
    return $clock;
}

/**
 * 한국시간 오늘 0시부터 다음 0시 전인지. 시각을 읽지 못하면 null.
 */
function on_seoul_today($raw, $now = null) {
    $instant = event_instant($raw, $now);
    if (!$instant) return null;
    $start = seoul_day_start($now);
    $end = clone $start;
    $end->modify("+1 day");
    $ts = $instant->getTimestamp();
    return $ts >= $start->getTimestamp() && $ts < $end->getTimestamp();
}

function count_days($text, $pattern, $now = null) {
    if (!preg_match_all($pattern, $text, $matched)) return null;
    $count = 0;
    $known = false;
    foreach ($matched[1] as $raw) {
        $inside = on_seoul_today($raw, $now);
        if ($inside === null) continue;
        $known = true;
        if ($inside) $count += 1;
    }
    return $known ? $count : null;
}

/**
 * 글이 한국시간 오늘이면 그 글의 댓글도 전부 오늘이다.
 * 글이 어제 이전이거나 시각이 없으면 null. 댓글 시각을 따로 봐야 한다.
 */
function comments_on_fresh_post($postRaw, $commentCount, $now = null) {
    if (!is_int($commentCount) || $commentCount < 0) return null;
    if ($commentCount === 0) return 0;
    if (on_seoul_today($postRaw, $now) !== true) return null;
    return $commentCount;
}

function naver_post_times($list, $rss) {
    $times = array();
    if (is_string($list) && preg_match_all('/"logNo"\s*:\s*"(\d+)"[\s\S]{0,1200}?"addDate"\s*:\s*"([^"]+)"/', $list, $rows, PREG_SET_ORDER)) {
        foreach ($rows as $row) $times[$row[1]] = $row[2];
    }
    if (!is_string($rss) || !preg_match_all('#<item\b[^>]*>(.*?)</item>#is', $rss, $items)) return $times;
    foreach ($items[1] as $item) {
        if (!preg_match('#<guid>\s*([^<]+)\s*</guid>#i', $item, $guid)) continue;
        if (!preg_match('#/(\d+)\s*$#', trim($guid[1]), $id)) continue;
        if (!preg_match('#<pubDate>\s*([^<]+)\s*</pubDate>#i', $item, $date)) continue;
        $times[$id[1]] = trim($date[1]);
    }
    return $times;
}

function as_count($value) {
    if (is_int($value)) return $value < 0 ? null : $value;
    if (is_string($value) && preg_match('/^\d{1,12}$/', $value)) return (int) $value;
    return null;
}

function tistory_walk_comments($items, $now, &$nodes, &$today, &$todayKnown) {
    foreach ($items as $item) {
        if (!is_array($item)) return false;
        $nodes += 1;
        if (!isset($item["written"]) || !is_string($item["written"])) {
            $todayKnown = false;
        } else {
            $inside = on_seoul_today($item["written"], $now);
            if ($inside === null) $todayKnown = false;
            elseif ($inside) $today += 1;
        }
        if (!array_key_exists("children", $item)) continue;
        if (!is_array($item["children"])) return false;
        if (!tistory_walk_comments($item["children"], $now, $nodes, $today, $todayKnown)) return false;
    }
    return true;
}

function tistory_comment_census($json, $now = null) {
    $data = json_decode((string) $json, true);
    if (!is_array($data) || !isset($data["data"]) || !is_array($data["data"])) return null;
    $payload = $data["data"];
    if (!isset($payload["items"]) || !is_array($payload["items"]) || !array_key_exists("isLast", $payload)) return null;
    $nodes = 0;
    $today = 0;
    $todayKnown = true;
    if (!tistory_walk_comments($payload["items"], $now, $nodes, $today, $todayKnown)) return null;
    $next = null;
    if (!$payload["isLast"]) {
        if (!isset($payload["nextId"]) || !preg_match('/^\d{1,12}$/', (string) $payload["nextId"])) return null;
        $next = (string) $payload["nextId"];
    }
    return array(
        "nodes" => $nodes,
        "today" => $todayKnown ? $today : null,
        "isLast" => (bool) $payload["isLast"],
        "next" => $next
    );
}

function tistory_comment_window($json, $now = null) {
    $census = tistory_comment_census($json, $now);
    if ($census === null || $census["today"] === null) return null;
    return array($census["today"], $census["isLast"], $census["next"]);
}

/**
 * 목록에 찍힌 댓글 수보다 댓글 API가 더 많이 세면 그 차이만 더한다.
 * 블로그 주인 댓글이 목록 숫자에서 빠져 있을 때의 차이다.
 * 같거나 더 적으면 목록 숫자를 그대로 둔다.
 */
/**
 * 글마다 댓글 API를 끝까지 읽었을 때의 합. 한 글이라도 없으면 null.
 * 목록 HTML이 댓글 수를 빠뜨려도 이 합이 전체다.
 */
function tistory_nodes_total($full, $ids) {
    if (!is_array($full) || !is_array($ids) || !$ids) return null;
    $sum = 0;
    foreach ($ids as $id) {
        $key = (string) $id;
        if (!array_key_exists($key, $full) || !is_int($full[$key]) || $full[$key] < 0) return null;
        $sum += $full[$key];
    }
    return $sum;
}

function tistory_apply_hidden_comments($base, $spans, $full) {
    if (!is_int($base) || $base < 0 || !is_array($spans) || !is_array($full)) return $base;
    $extra = 0;
    foreach ($full as $id => $nodes) {
        $key = (string) $id;
        if (!array_key_exists($key, $spans) || !is_int($nodes) || !is_int($spans[$key])) continue;
        if ($nodes > $spans[$key]) $extra += $nodes - $spans[$key];
    }
    return $base + $extra;
}

/**
 * 글 목록 JSON의 댓글 수. 빈 문자열은 0이다.
 * 칸이 없거나 숫자가 아니면 null 이라서 글 페이지를 다시 본다.
 */
function naver_list_comment_counts($body) {
    $data = json_decode((string) $body, true);
    if (!is_array($data) || !isset($data["postList"]) || !is_array($data["postList"])) return null;
    $counts = array();
    foreach ($data["postList"] as $post) {
        if (!is_array($post) || !isset($post["logNo"]) || !array_key_exists("commentCount", $post)) return null;
        $logNo = (string) $post["logNo"];
        if (!preg_match('/^\d{1,16}$/', $logNo) || isset($counts[$logNo])) return null;
        $raw = $post["commentCount"];
        if ($raw === "" || $raw === null) $count = 0;
        else $count = as_count($raw);
        if (!is_int($count)) return null;
        $counts[$logNo] = $count;
    }
    if (!$counts) return null;
    return $counts;
}

/**
 * 네이버 글 목록을 몇 페이지로 받을지. 글이 없으면 0.
 * maxPages 가 0이면 상한이 없다. 상한을 넘으면 null.
 */
function naver_list_page_count($total, $pageSize, $maxPages) {
    if (!is_int($total) || $total < 0) return null;
    if (!is_int($pageSize) || $pageSize < 1) return null;
    if (!is_int($maxPages) || $maxPages < 0) return null;
    if ($total === 0) return 0;
    $pages = intdiv($total + $pageSize - 1, $pageSize);
    if ($maxPages !== 0 && $pages > $maxPages) return null;
    return $pages;
}

function naver_list_log_nos($body) {
    if (!preg_match_all('/"logNo"\s*:\s*"(\d+)"/', (string) $body, $matched)) return array();
    return $matched[1];
}

/**
 * 여러 페이지의 글 목록을 한 표로 합친다.
 * 글이 빠지거나 같은 글번호가 두 번이면 null.
 * 댓글 칸이 없는 페이지가 있으면 counts 는 null 이고 글번호만 남긴다.
 */
function naver_list_merge($bodies, $total) {
    if (!is_array($bodies) || !is_int($total) || $total < 1) return null;
    $seen = array();
    $counts = array();
    $times = array();
    $fromList = true;
    foreach ($bodies as $body) {
        $ids = naver_list_log_nos($body);
        if (!$ids) return null;
        $pageCounts = naver_list_comment_counts($body);
        if (!is_array($pageCounts)) $fromList = false;
        $pageTimes = naver_post_times(is_string($body) ? $body : "", "");
        foreach ($ids as $logNo) {
            $logNo = (string) $logNo;
            if (isset($seen[$logNo])) return null;
            $seen[$logNo] = true;
            if (isset($pageTimes[$logNo]) && is_string($pageTimes[$logNo])) $times[$logNo] = $pageTimes[$logNo];
            if ($fromList && is_array($pageCounts) && array_key_exists($logNo, $pageCounts) && is_int($pageCounts[$logNo])) {
                $counts[$logNo] = $pageCounts[$logNo];
            } else {
                $fromList = false;
            }
        }
    }
    if (count($seen) !== $total) return null;
    return array(
        "logNos" => array_keys($seen),
        "counts" => ($fromList && count($counts) === $total) ? $counts : null,
        "times" => $times
    );
}

/**
 * 방금 본 글을 뺀 저장분. 빠진 글이나 지워진 글이 있으면 null.
 * $liveIds 는 이번 요청에서 직접 센 글번호다.
 */
function comment_store_rest($liveIds, $stored, $total) {
    if (!is_array($liveIds) || !is_array($stored) || !is_int($total) || $total < 1) return null;
    $live = array();
    foreach ($liveIds as $id) {
        $id = (string) $id;
        if ($id === "" || isset($live[$id])) return null;
        $live[$id] = true;
    }
    if (count($live) > $total) return null;
    $rest = array();
    foreach ($stored as $id => $count) {
        $id = (string) $id;
        if (isset($live[$id])) continue;
        if (!is_int($count) || $count < 0) return null;
        $rest[$id] = $count;
    }
    if (count($rest) !== $total - count($live)) return null;
    return $rest;
}

function comment_store_sum($counts) {
    if (!is_array($counts)) return null;
    $sum = 0;
    foreach ($counts as $count) {
        if (!is_int($count) || $count < 0) return null;
        $sum += $count;
    }
    return $sum;
}

/**
 * 글마다 오늘 댓글이 하나라도 없으면 null.
 */
function comment_store_today_sum($ids, $today) {
    if (!is_array($ids) || !is_array($today)) return null;
    $sum = 0;
    foreach ($ids as $id) {
        $id = (string) $id;
        if (!isset($today[$id]) || !is_int($today[$id]) || $today[$id] < 0) return null;
        $sum += $today[$id];
    }
    return $sum;
}

/**
 * 티스토리 글번호가 큰 것이 최근 글이다. $limit 개만 돌려준다.
 */
function tistory_newest_ids($ids, $limit) {
    if (!is_array($ids) || !is_int($limit) || $limit < 1) return array();
    $clean = array();
    foreach ($ids as $id) {
        $id = (string) $id;
        if (!preg_match('/^\d{1,12}$/', $id) || isset($clean[$id])) continue;
        $clean[$id] = (int) $id;
    }
    arsort($clean, SORT_NUMERIC);
    $out = array();
    foreach ($clean as $id => $number) {
        $out[] = (string) $id;
        if (count($out) >= $limit) break;
    }
    return $out;
}

function naver_comment_count($html) {
    if (preg_match('/commentCount="(\d+)"/', $html, $matched)) return (int) $matched[1];
    if (preg_match('/\\\\"commentCount\\\\"\s*:\s*(\d+)/', $html, $matched)) return (int) $matched[1];
    if (preg_match('/"commentCount"\s*:\s*(\d+)/', $html, $matched)) return (int) $matched[1];
    return null;
}

function naver_comment_decode($body) {
    $text = trim((string) $body);
    if ($text === "") return null;
    if ($text[0] !== "{" && $text[0] !== "[") {
        $start = strpos($text, "(");
        $end = strrpos($text, ")");
        if ($start === false || $end === false || $end <= $start) return null;
        $text = substr($text, $start + 1, $end - $start - 1);
    }
    $data = json_decode($text, true);
    if (!is_array($data) || empty($data["success"]) || !isset($data["result"]) || !is_array($data["result"])) return null;
    return $data["result"];
}

function naver_comment_take($items, &$seen, &$listed, &$today, &$todayKnown, $now) {
    if (!is_array($items)) return false;
    foreach ($items as $item) {
        if (!is_array($item)) return false;
        $no = isset($item["commentNo"]) ? (string) $item["commentNo"] : "";
        $fresh = ($no === "" || !isset($seen[$no]));
        if ($no !== "") $seen[$no] = true;
        if ($fresh && empty($item["deleted"]) && empty($item["blind"]) && empty($item["hiddenByCleanbot"])) {
            $listed += 1;
            $raw = isset($item["regTime"]) && is_string($item["regTime"]) ? $item["regTime"] : "";
            $inside = on_seoul_today($raw, $now);
            if ($inside === null) $todayKnown = false;
            elseif ($inside) $today += 1;
        }
        if (!array_key_exists("replyList", $item) || $item["replyList"] === null) continue;
        if (!is_array($item["replyList"])) return false;
        if (!naver_comment_take($item["replyList"], $seen, $listed, $today, $todayKnown, $now)) return false;
    }
    return true;
}

function naver_comment_census($body, $now = null) {
    $result = naver_comment_decode($body);
    if ($result === null || !isset($result["commentList"]) || !is_array($result["commentList"])) return null;
    $listed = 0;
    $today = 0;
    $todayKnown = true;
    $seen = array();
    if (!naver_comment_take($result["commentList"], $seen, $listed, $today, $todayKnown, $now)) return null;
    $reported = null;
    if (isset($result["count"]) && is_array($result["count"]) && array_key_exists("total", $result["count"])) {
        $reported = as_count($result["count"]["total"]);
    }
    $page = 1;
    $next = 0;
    $rows = null;
    if (isset($result["pageModel"]) && is_array($result["pageModel"])) {
        $rows = as_count(isset($result["pageModel"]["totalRows"]) ? $result["pageModel"]["totalRows"] : null);
        if (isset($result["pageModel"]["page"])) $page = (int) $result["pageModel"]["page"];
        if (isset($result["pageModel"]["nextPage"])) $next = (int) $result["pageModel"]["nextPage"];
    }
    return array(
        "reported" => $reported,
        "rows" => $rows,
        "listed" => $listed,
        "today" => $todayKnown ? $today : null,
        "hasNext" => $next > $page
    );
}

/**
 * 글 페이지의 댓글 수가 주인 댓글을 빼면, 목록을 끝까지 봤을 때의 개수가 더 크다.
 * 그 더 큰 수를 쓰고, 오늘 개수도 주인 댓글을 넣어 센다.
 * 목록이 끝나지 않았으면 네이버가 알려 준 합계만 믿고 오늘 수는 비운다.
 */
function naver_comment_sum($pages, $done) {
    if (!is_array($pages) || !$pages) return null;
    $reported = null;
    $listed = 0;
    $today = 0;
    $todayKnown = true;
    foreach ($pages as $page) {
        if (!is_array($page) || !isset($page["listed"]) || !is_int($page["listed"])) return null;
        $listed += $page["listed"];
        if ($reported === null && isset($page["reported"]) && is_int($page["reported"])) $reported = $page["reported"];
        if (!isset($page["today"]) || !is_int($page["today"])) $todayKnown = false;
        else $today += $page["today"];
    }
    $total = $reported;
    if ($done && $listed > (is_int($total) ? $total : -1)) $total = $listed;
    if (!is_int($total)) return null;
    return array(
        "total" => $total,
        "today" => ($done && $todayKnown) ? $today : null
    );
}

function rss_posts_on_day($xml, $now = null) {
    if (!is_string($xml) || $xml === "" || !preg_match_all('#<item\b[^>]*>(.*?)</item>#is', $xml, $items)) {
        return null;
    }
    $count = 0;
    $known = false;
    foreach ($items[1] as $item) {
        if (!preg_match('#<pubDate>\s*([^<]+)\s*</pubDate>#i', $item, $matched)) continue;
        $inside = on_seoul_today($matched[1], $now);
        if ($inside === null) continue;
        $known = true;
        if ($inside) $count += 1;
    }
    return $known ? $count : null;
}

function tistory_comment_page($html, &$counts) {
    $added = 0;
    $saw = false;
    if (preg_match_all('/id="commentCount(\d+)_\d+"[^>]*>\s*(\d*)\s*</', $html, $matched, PREG_SET_ORDER)) {
        $saw = true;
        foreach ($matched as $row) {
            if (isset($counts[$row[1]])) continue;
            $counts[$row[1]] = ($row[2] === "") ? 0 : (int) $row[2];
            $added += 1;
        }
    }
    // 커버 스킨은 commentCount 아이디 없이 글 카드의 span.reply에 숫자를 넣는다.
    if (preg_match_all('/<article\b[^>]*>.*?<\/article>/is', $html, $articles)) {
        foreach ($articles[0] as $article) {
            if (!preg_match('/<span\s+class="reply"[^>]*>\s*(\d+)\s*<\/span>/i', $article, $reply)) continue;
            if (!preg_match('/href="(?:https?:\/\/[^"\/]+)?\/(\d+)\/?(?:["#?])/', $article, $id)) continue;
            $saw = true;
            if (isset($counts[$id[1]])) continue;
            $counts[$id[1]] = (int) $reply[1];
            $added += 1;
        }
    }
    if (!$saw) return null;
    return $added;
}

function tistory_has_next_page($html, $page) {
    return (bool) preg_match('/(?:\?|&|\/)page=' . (int) ($page + 1) . '(?:["&\/\s]|$)/', $html);
}

/**
 * 다음 티스토리 목록 페이지. 0이면 더 받지 않는다. 상한이면 null.
 */
function tistory_list_continue($page, $hasNext, $seen, $postTotal, $maxPages) {
    if ($hasNext !== true) return 0;
    if (is_int($postTotal) && $postTotal > 0 && is_int($seen) && $seen >= $postTotal) return 0;
    if (!is_int($page) || !is_int($maxPages) || $page < 1 || $maxPages < 1) return null;
    if ($page >= $maxPages) return null;
    return $page + 1;
}

function tistory_comment_total($counts, $postTotal) {
    if (!$counts) return null;
    if (is_int($postTotal) && $postTotal > count($counts)) return null;
    $sum = 0;
    foreach ($counts as $count) $sum += $count;
    return $sum;
}

function blogger_https_host($url) {
    $parts = parse_url($url);
    if (!is_array($parts)) return "";
    if (empty($parts["scheme"]) || strtolower($parts["scheme"]) !== "https") return "";
    if (!empty($parts["user"]) || !empty($parts["pass"])) return "";
    if (isset($parts["port"]) && (int) $parts["port"] !== 443) return "";
    return strtolower(isset($parts["host"]) ? $parts["host"] : "");
}

function blogspot_name($host) {
    $host = strtolower((string) $host);
    if (!preg_match('/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.blogspot\.([a-z0-9.]+)$/', $host, $matched)) return "";
    if (!preg_match('/^(?:com|co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2})$/', $matched[2])) return "";
    if ($matched[1] === "www") return "";
    return $matched[1];
}

function blogger_published_min($now = null) {
    return seoul_day_start($now)->format("Y-m-d\\TH:i:sP");
}

function blogger_feed_url($name, $kind, $min) {
    $path = $kind === "comments" ? "/feeds/comments/default" : "/feeds/posts/default";
    // max-results=0 은 글을 나열하지 않고 피드가 가진 전체 개수만 받는다.
    $url = "https://" . $name . ".blogspot.com" . $path . "?alt=json&max-results=0";
    if (is_string($min) && $min !== "") $url .= "&published-min=" . rawurlencode($min);
    return $url;
}

function blogger_feed_total($status, $body) {
    if ((int) $status !== 200 || !is_string($body) || $body === "" || $body[0] !== "{") return null;
    $data = json_decode($body, true);
    if (!is_array($data) || !isset($data["feed"]) || !is_array($data["feed"])) return null;
    $node = isset($data["feed"]["openSearch\$totalResults"]) ? $data["feed"]["openSearch\$totalResults"] : null;
    if (!is_array($node) || !isset($node["\$t"])) return null;
    return as_count($node["\$t"]);
}

function blogger_window_count($total, $window) {
    if ($total === 0) return 0;
    if (!is_int($window)) return null;
    if (is_int($total) && $window > $total) return null;
    return $window;
}

function blogger_image_host($host) {
    if ($host === "blogger.googleusercontent.com") return true;
    if (preg_match('/^lh[3-6]\.googleusercontent\.com$/', $host)) return true;
    if (preg_match('/^(?:[1-4]\.)?bp\.blogspot\.com$/', $host)) return true;
    return false;
}

function blogger_image_usable($url) {
    if (!blogger_image_host(blogger_https_host($url))) return false;
    if (preg_match('/\/anon\d*\.png|default-avatar|\/U2hvZWJveA\/|blank\.gif/i', $url)) return false;
    return true;
}

function blogger_https_url($url) {
    $url = trim(html_entity_decode((string) $url, ENT_QUOTES, "UTF-8"));
    if (strpos($url, "//") === 0) $url = "https:" . $url;
    if (stripos($url, "http://") === 0) $url = "https://" . substr($url, 7);
    if (blogger_https_host($url) === "") return "";
    return $url;
}

function blogger_image_url($url, $large) {
    $url = blogger_https_url($url);
    if (!blogger_image_usable($url)) return "";
    $size = $large ? "s1600" : "s204";
    if (preg_match('#/s\d+/#', $url)) return preg_replace('#/s\d+/#', "/" . $size . "/", $url, 1);
    if (preg_match('/=s\d+/', $url)) return preg_replace('/=s\d+(?:-[a-z0-9-]+)?/', "=" . $size, $url, 1);
    return $url;
}

function blogger_author_image($body, $large) {
    if (!is_string($body) || $body === "" || $body[0] !== "{") return "";
    $data = json_decode($body, true);
    if (!is_array($data) || !isset($data["feed"]["author"][0]) || !is_array($data["feed"]["author"][0])) return "";
    $image = isset($data["feed"]["author"][0]["gd\$image"]) ? $data["feed"]["author"][0]["gd\$image"] : null;
    if (!is_array($image) || empty($image["src"]) || !is_string($image["src"])) return "";
    return blogger_image_url($image["src"], $large);
}

function blogger_html_image($html, $large) {
    if (!is_string($html) || !preg_match('/<img\b[^>]*\bprofile-img\b[^>]*>/i', $html, $tag)) return "";
    if (!preg_match('/\bsrc=(["\'])([^"\']+)\1/i', $tag[0], $src)) return "";
    return blogger_image_url($src[2], $large);
}

function blogger_js_unescape($text) {
    return preg_replace_callback('/\\\\x([0-9a-fA-F]{2})/', function ($matched) {
        return chr(hexdec($matched[1]));
    }, str_replace(array("\\/", "\\u0026", "\\u003d"), array("/", "&", "="), (string) $text));
}

function blogger_stats_url($html, $name) {
    if (!is_string($html) || !preg_match('/statsUrl[\'"]?\s*:\s*([\'"])(.*?)\1/s', $html, $matched)) return "";
    $url = blogger_https_url(blogger_js_unescape($matched[2]));
    if (blogspot_name(blogger_https_host($url)) !== $name) return "";
    $parts = parse_url($url);
    if (!is_array($parts) || (isset($parts["path"]) ? $parts["path"] : "") !== "/b/stats") return "";
    $query = array();
    if (!empty($parts["query"])) parse_str($parts["query"], $query);
    if (!isset($query["timeRange"]) || $query["timeRange"] !== "ALL_TIME") return "";
    $token = isset($query["token"]) ? $query["token"] : "";
    if (!is_string($token) || !preg_match('/^[A-Za-z0-9_-]{8,200}$/', $token)) return "";
    return "https://" . blogger_https_host($url) . "/b/stats?style=BLACK_TRANSPARENT&timeRange=ALL_TIME&token=" . rawurlencode($token);
}

function blogger_stats_total($status, $body) {
    if ((int) $status !== 200 || !is_string($body) || $body === "" || $body[0] !== "{") return null;
    $data = json_decode($body, true);
    if (!is_array($data) || !array_key_exists("total", $data)) return null;
    if (is_int($data["total"])) return as_count($data["total"]);
    if (is_string($data["total"])) return as_count($data["total"]);
    return null;
}

/**
 * 그 서울 날짜의 전체 페이지뷰를 남긴다.
 * 지난 날짜는 고치지 않고, 같은 날에는 더 큰 값만 남긴다.
 * 오늘로부터 13일보다 오래된 칸은 뺀다.
 * 대시보드 집계와 blogger_close.php 가 이 값을 갱신한다.
 */
function blogger_total_apply($data, $blog, $day, $total, $now = null) {
    if (!is_array($data)) $data = array();
    if (!is_string($blog) || $blog === "" || !is_int($total) || $total < 0) return $data;
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $day)) return $data;
    $clock = seoul_clock($now);
    if ($day !== $clock->format("Y-m-d")) return $data;
    if (!isset($data[$day]) || !is_array($data[$day])) $data[$day] = array();
    $previous = isset($data[$day][$blog]) ? $data[$day][$blog] : null;
    if (is_string($previous) && preg_match('/^\d{1,12}$/', $previous)) $previous = (int) $previous;
    if (is_int($previous) && $previous > $total) $total = $previous;
    $data[$day][$blog] = $total;
    $cutoff = clone $clock;
    $cutoff->modify("-13 days");
    $cutoffKey = $cutoff->format("Y-m-d");
    $kept = array();
    foreach ($data as $key => $row) {
        if (!is_string($key) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $key) || $key < $cutoffKey) continue;
        if (!is_array($row)) continue;
        $clean = array();
        foreach ($row as $url => $value) {
            if (!is_string($url) || $url === "") continue;
            if (is_int($value) && $value >= 0) $clean[$url] = $value;
            elseif (is_string($value) && preg_match('/^\d{1,12}$/', $value)) $clean[$url] = (int) $value;
        }
        if ($clean) $kept[$key] = $clean;
    }
    ksort($kept);
    return $kept;
}

/**
 * 오늘 페이지뷰는 지금 전체에서 어제 마감 전체를 뺀 값이다.
 * 어제 칸이 없거나 전체가 줄어들면 null.
 */
function blogger_today_count($data, $blog, $total, $now = null) {
    if (!is_array($data) || !is_string($blog) || $blog === "" || !is_int($total) || $total < 0) return null;
    $yesterday = seoul_clock($now);
    $yesterday->modify("-1 day");
    $key = $yesterday->format("Y-m-d");
    if (!isset($data[$key]) || !is_array($data[$key]) || !array_key_exists($blog, $data[$key])) return null;
    $base = $data[$key][$blog];
    if (is_string($base) && preg_match('/^\d{1,12}$/', $base)) $base = (int) $base;
    if (!is_int($base) || $base < 0 || $total < $base) return null;
    return $total - $base;
}

/**
 * 오늘 숫자가 비는 이유. 화면은 이 경우를 0으로 그린다.
 */
function blogger_today_gap_reason($data, $blog, $total, $now = null) {
    if (!is_array($data)) return "기록 파일이 비어 있음";
    if (!is_string($blog) || $blog === "") return "블로그 주소가 없음";
    if (!is_int($total) || $total < 0) return "전체가 없음";
    $todayKey = seoul_clock($now)->format("Y-m-d");
    $yesterday = seoul_clock($now);
    $yesterday->modify("-1 day");
    $key = $yesterday->format("Y-m-d");
    $days = array();
    foreach ($data as $day => $row) {
        if (is_string($day) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $day)) $days[] = $day;
    }
    sort($days, SORT_STRING);
    $dayList = $days ? implode(",", $days) : "없음";
    if (!isset($data[$key]) || !is_array($data[$key])) {
        return "어제 날짜 없음. 한국오늘=" . $todayKey . " 어제=" . $key . " 파일의 날짜=" . $dayList;
    }
    if (!array_key_exists($blog, $data[$key])) {
        $urls = array();
        foreach ($data[$key] as $url => $value) {
            if (is_string($url) && $url !== "") $urls[] = $url;
        }
        sort($urls, SORT_STRING);
        $urlList = $urls ? implode(",", $urls) : "없음";
        return "어제 날짜에 이 주소 없음. 요청=" . $blog . " 어제=" . $key . " 파일주소=" . $urlList;
    }
    $base = $data[$key][$blog];
    if (is_string($base) && preg_match('/^\d{1,12}$/', $base)) $base = (int) $base;
    if (!is_int($base) || $base < 0) return "어제 값이 숫자가 아님";
    if ($total < $base) return "지금 전체 " . $total . ", 어제 전체 " . $base . ", 오늘을 만들지 않음";
    return "알 수 없음";
}

function blogger_api_pageviews($status, $body) {
    if ((int) $status !== 200 || !is_string($body) || $body === "" || $body[0] !== "{") return null;
    $data = json_decode($body, true, 512, JSON_BIGINT_AS_STRING);
    if (!is_array($data) || !isset($data["counts"]) || !is_array($data["counts"])) return null;
    foreach ($data["counts"] as $row) {
        if (!is_array($row) || !isset($row["timeRange"])) continue;
        if ($row["timeRange"] !== "ALL_TIME" && $row["timeRange"] !== "all") continue;
        return as_count(isset($row["count"]) ? $row["count"] : null);
    }
    return null;
}

function blogger_api_blog_id($status, $body) {
    if ((int) $status !== 200 || !is_string($body) || $body === "" || $body[0] !== "{") return "";
    $data = json_decode($body, true, 512, JSON_BIGINT_AS_STRING);
    if (!is_array($data) || !isset($data["id"])) return "";
    $id = $data["id"];
    if (is_int($id)) $id = (string) $id;
    if (!is_string($id) || !preg_match('/^\d{1,24}$/', $id)) return "";
    return $id;
}

function blogger_blog_names($text) {
    $names = array();
    foreach (preg_split('/[\s,]+/', (string) $text) as $part) {
        $part = strtolower(trim($part));
        if ($part === "") continue;
        $host = $part;
        if (strpos($part, "://") !== false) {
            $parsed = parse_url($part, PHP_URL_HOST);
            $host = is_string($parsed) ? strtolower($parsed) : "";
        }
        $name = blogspot_name($host);
        if ($name === "" && preg_match('/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/', $part)) $name = $part;
        if ($name !== "") $names[$name] = true;
    }
    return array_keys($names);
}

function blogger_character_blogs($markdown) {
    $names = array();
    if (!is_string($markdown) || $markdown === "") return array();
    if (!preg_match_all('#https?://([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.blogspot\.[a-z0-9.]+)#i', $markdown, $matches)) {
        return array();
    }
    foreach ($matches[1] as $host) {
        $name = blogspot_name($host);
        if ($name !== "") $names[$name] = true;
    }
    return array_keys($names);
}

/**
 * 대시보드가 집계 주소로 쓰는 블로거 주소. 루트는 슬래시로 끝난다.
 */
function blogger_close_url($raw) {
    $raw = rtrim(trim((string) $raw), "),.]");
    $parts = parse_url($raw);
    if (!is_array($parts)) return "";
    if (empty($parts["scheme"]) || strtolower($parts["scheme"]) !== "https") return "";
    if (!empty($parts["user"]) || !empty($parts["pass"])) return "";
    if (isset($parts["port"]) && (int) $parts["port"] !== 443) return "";
    $host = strtolower(isset($parts["host"]) ? $parts["host"] : "");
    if (blogspot_name($host) === "") return "";
    $path = isset($parts["path"]) && $parts["path"] !== "" ? $parts["path"] : "/";
    if (strlen($path) > 1) $path = rtrim($path, "/");
    if ($path === "") $path = "/";
    $query = isset($parts["query"]) && $parts["query"] !== "" ? "?" . $parts["query"] : "";
    return "https://" . $host . $path . $query;
}

function blogger_close_urls_from($markdown) {
    $urls = array();
    if (!is_string($markdown) || $markdown === "") return array();
    if (!preg_match_all('#https?://[^\s<>"\']+#i', $markdown, $matches)) return array();
    foreach ($matches[0] as $raw) {
        $url = blogger_close_url($raw);
        if ($url !== "") $urls[$url] = true;
    }
    $keys = array_keys($urls);
    sort($keys, SORT_STRING);
    return $keys;
}

function blogger_apply_character_blogs($sets, $bySuffix) {
    if (!is_array($sets)) return array();
    if (!is_array($bySuffix)) $bySuffix = array();
    foreach ($sets as $index => $set) {
        if (!is_array($set)) continue;
        $blogs = isset($set["blogs"]) && is_array($set["blogs"]) ? $set["blogs"] : array();
        if ($blogs) continue;
        $suffix = isset($set["suffix"]) && is_string($set["suffix"]) ? $set["suffix"] : "";
        if ($suffix === "" || !isset($bySuffix[$suffix]) || !is_array($bySuffix[$suffix])) continue;
        $sets[$index]["blogs"] = array_values($bySuffix[$suffix]);
    }
    return $sets;
}

function blogger_credential_sets($vars) {
    if (!is_array($vars)) return array();
    $sets = array();
    foreach ($vars as $key => $value) {
        if (!is_string($key) || !preg_match('/^BLOGGER_REFRESH_TOKEN_([A-Za-z0-9_]+)$/', $key, $matched)) continue;
        if (!is_string($value) || $value === "") continue;
        $suffix = $matched[1];
        $idKey = "BLOGGER_CLIENT_ID_" . $suffix;
        $secretKey = "BLOGGER_CLIENT_SECRET_" . $suffix;
        $id = isset($vars[$idKey]) && is_string($vars[$idKey]) ? $vars[$idKey] : "";
        $secret = isset($vars[$secretKey]) && is_string($vars[$secretKey]) ? $vars[$secretKey] : "";
        if ($id === "" || $secret === "") continue;
        $blogsKey = "BLOGGER_BLOGS_" . $suffix;
        $blogs = isset($vars[$blogsKey]) && is_string($vars[$blogsKey]) ? blogger_blog_names($vars[$blogsKey]) : array();
        $sets[] = array(
            "suffix" => $suffix,
            "client_id" => $id,
            "client_secret" => $secret,
            "refresh_token" => $value,
            "blogs" => $blogs
        );
    }
    return $sets;
}

function blogger_sets_for($name, $sets) {
    if (!is_string($name) || $name === "" || !is_array($sets)) return array();
    $named = array();
    $open = array();
    foreach ($sets as $set) {
        if (!is_array($set)) continue;
        $blogs = isset($set["blogs"]) && is_array($set["blogs"]) ? $set["blogs"] : array();
        if ($blogs) {
            if (in_array($name, $blogs, true)) $named[] = $set;
        } else {
            $open[] = $set;
        }
    }
    if ($named) return $named;
    return $open;
}
