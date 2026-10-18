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
 * 0시는 최근 24시간의 경계보다 이른 어제 날짜를 빼기 위한 자리다.
 * 서울의 오늘은 0시도 24시간 안이므로 날짜만 있어도 오늘 글은 센다.
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

function within_24h($raw, $now = null) {
    $instant = event_instant($raw, $now);
    if (!$instant) return null;
    $cutoff = seoul_clock($now)->getTimestamp() - 86400;
    return $instant->getTimestamp() >= $cutoff;
}

function count_days($text, $pattern, $now = null) {
    if (!preg_match_all($pattern, $text, $matched)) return null;
    $count = 0;
    $known = false;
    foreach ($matched[1] as $raw) {
        $inside = within_24h($raw, $now);
        if ($inside === null) continue;
        $known = true;
        if ($inside) $count += 1;
    }
    return $known ? $count : null;
}

/**
 * 글이 최근 24시간 안이면 그 글의 댓글도 전부 그 안이다.
 * 글이 그보다 오래됐거나 시각이 없으면 null. 댓글 시각을 따로 봐야 한다.
 */
function comments_on_fresh_post($postRaw, $commentCount, $now = null) {
    if (!is_int($commentCount) || $commentCount < 0) return null;
    if ($commentCount === 0) return 0;
    if (within_24h($postRaw, $now) !== true) return null;
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

function tistory_count_written($items, $now, &$count) {
    foreach ($items as $item) {
        if (!is_array($item) || !isset($item["written"]) || !is_string($item["written"])) return false;
        $inside = within_24h($item["written"], $now);
        if ($inside === null) return false;
        if ($inside) $count += 1;
        if (!isset($item["children"])) continue;
        if (!is_array($item["children"])) return false;
        if (!tistory_count_written($item["children"], $now, $count)) return false;
    }
    return true;
}

function tistory_comment_window($json, $now = null) {
    $data = json_decode((string) $json, true);
    if (!is_array($data) || !isset($data["data"]) || !is_array($data["data"])) return null;
    $payload = $data["data"];
    if (!isset($payload["items"]) || !is_array($payload["items"]) || !array_key_exists("isLast", $payload)) return null;
    $count = 0;
    if (!tistory_count_written($payload["items"], $now, $count)) return null;
    $next = null;
    if (!$payload["isLast"]) {
        if (!isset($payload["nextId"]) || !preg_match('/^\d{1,12}$/', (string) $payload["nextId"])) return null;
        $next = (string) $payload["nextId"];
    }
    return array($count, (bool) $payload["isLast"], $next);
}

function naver_comment_count($html) {
    if (preg_match('/commentCount="(\d+)"/', $html, $matched)) return (int) $matched[1];
    if (preg_match('/\\\\"commentCount\\\\"\s*:\s*(\d+)/', $html, $matched)) return (int) $matched[1];
    if (preg_match('/"commentCount"\s*:\s*(\d+)/', $html, $matched)) return (int) $matched[1];
    return null;
}

function rss_posts_on_day($xml, $now = null) {
    if (!is_string($xml) || $xml === "" || !preg_match_all('#<item\b[^>]*>(.*?)</item>#is', $xml, $items)) {
        return null;
    }
    $count = 0;
    $known = false;
    foreach ($items[1] as $item) {
        if (!preg_match('#<pubDate>\s*([^<]+)\s*</pubDate>#i', $item, $matched)) continue;
        $inside = within_24h($matched[1], $now);
        if ($inside === null) continue;
        $known = true;
        if ($inside) $count += 1;
    }
    return $known ? $count : null;
}

function tistory_comment_page($html, &$counts) {
    if (!preg_match_all('/id="commentCount(\d+)_\d+"[^>]*>\s*(\d*)\s*</', $html, $matched, PREG_SET_ORDER)) {
        return null;
    }
    $added = 0;
    foreach ($matched as $row) {
        if (isset($counts[$row[1]])) continue;
        $counts[$row[1]] = ($row[2] === "") ? 0 : (int) $row[2];
        $added += 1;
    }
    return $added;
}

function tistory_has_next_page($html, $page) {
    return (bool) preg_match('/(?:\?|&|\/)page=' . (int) ($page + 1) . '(?:["&\/\s]|$)/', $html);
}

function tistory_comment_total($counts, $postTotal) {
    if (!$counts) return null;
    if (is_int($postTotal) && $postTotal > count($counts)) return null;
    $sum = 0;
    foreach ($counts as $count) $sum += $count;
    return $sum;
}

/**
 * 블로그 하나의 오늘 방문자를 서울 날짜 칸에 넣는다.
 * 지난 날짜는 고치지 않고, 오늘로부터 13일보다 오래된 칸은 뺀다.
 */
function history_apply($data, $blog, $day, $today, $now = null) {
    if (!is_array($data)) $data = array();
    if (!is_string($blog) || $blog === "" || !is_int($today) || $today < 0) return $data;
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $day)) return $data;
    $clock = seoul_clock($now);
    if ($day !== $clock->format("Y-m-d")) return $data;
    if (!isset($data[$day]) || !is_array($data[$day])) $data[$day] = array();
    $data[$day][$blog] = $today;
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
