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

function seoul_today($now = null) {
    return seoul_clock($now)->format("Y-m-d");
}

function seoul_shift($modify, $now = null) {
    $date = seoul_clock($now);
    $date->modify($modify);
    return $date->format("Y-m-d");
}

function day_key($raw, $now = null) {
    $text = trim(html_entity_decode((string) $raw, ENT_QUOTES, "UTF-8"));
    if ($text === "") return "";
    if ($text === "오늘" || preg_match('/^(?:방금|조금)\s*전$/u', $text) || preg_match('/^\d+\s*초\s*전$/u', $text)) {
        return seoul_today($now);
    }
    if (preg_match('/^(\d+)\s*분\s*전$/u', $text, $matched)) return seoul_shift("-" . (int) $matched[1] . " minutes", $now);
    if (preg_match('/^(\d+)\s*시간\s*전$/u', $text, $matched)) return seoul_shift("-" . (int) $matched[1] . " hours", $now);
    if ($text === "어제") return seoul_shift("-1 day", $now);
    if (preg_match('/^(\d+)\s*일\s*전$/u', $text, $matched)) return seoul_shift("-" . (int) $matched[1] . " days", $now);
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

function naver_comment_count($html) {
    if (preg_match('/commentCount="(\d+)"/', $html, $matched)) return (int) $matched[1];
    if (preg_match('/\\\\"commentCount\\\\"\s*:\s*(\d+)/', $html, $matched)) return (int) $matched[1];
    if (preg_match('/"commentCount"\s*:\s*(\d+)/', $html, $matched)) return (int) $matched[1];
    return null;
}

function rss_posts_on_day($xml, $today) {
    if (!is_string($xml) || $xml === "" || !preg_match_all('#<item\b[^>]*>(.*?)</item>#is', $xml, $items)) {
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
