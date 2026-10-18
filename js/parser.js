/**
 * 캐릭터 마크다운 파서.
 * 파일 하나가 깨져도 예외를 밖으로 던지지 않고 { ok: false }를 반환한다.
 * 호출하는 쪽은 카드 단위로 실패를 격리할 수 있다.
 */
(function (root) {
  var STAT_KEYS = ["todayVisitors", "yesterdayVisitors", "postCount", "commentCount"];
  var SECRET_KEYS = { password: 1, passwd: 1, pwd: 1, secret: 1, token: 1 };

  function fail(fileName, message) {
    return { ok: false, fileName: fileName || "", error: message || "파싱 오류" };
  }

  function stripQuotes(value) {
    var text = String(value == null ? "" : value).trim();
    if ((text.charAt(0) === '"' && text.charAt(text.length - 1) === '"') ||
        (text.charAt(0) === "'" && text.charAt(text.length - 1) === "'")) {
      return text.slice(1, -1);
    }
    return text;
  }

  function parseNumber(raw, key) {
    var num = Number(String(raw).replace(/,/g, "").trim());
    if (!isFinite(num)) {
      throw new Error("통계 값이 숫자가 아닙니다: " + key);
    }
    return num;
  }

  function parseFrontMatter(block) {
    var data = {};
    var lines = block.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var trimmed = lines[i].trim();
      if (!trimmed || trimmed.charAt(0) === "#") continue;
      var matched = /^([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(trimmed);
      if (!matched) {
        throw new Error("프론트매터 형식 오류 (" + (i + 1) + "번째 줄)");
      }
      var key = matched[1];
      var value = stripQuotes(matched[2]);
      if (SECRET_KEYS[key.toLowerCase()]) continue;
      if (STAT_KEYS.indexOf(key) !== -1) {
        if (value === "") throw new Error("통계 값이 비어 있습니다: " + key);
        data[key] = parseNumber(value, key);
      } else {
        data[key] = value;
      }
    }
    return data;
  }

  function parseSections(body) {
    var sections = {};
    var current = null;
    var bucket = [];
    function flush() {
      if (current) sections[current] = bucket.join("\n");
      bucket = [];
    }
    var lines = String(body || "").split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var heading = /^##\s+(.+?)\s*$/.exec(lines[i]);
      if (heading) {
        flush();
        current = heading[1].trim();
      } else if (current) {
        bucket.push(lines[i]);
      }
    }
    flush();
    return sections;
  }

  function assignKv(target, text) {
    var matched = /^([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(String(text).trim());
    if (!matched) throw new Error("목록 형식 오류: " + String(text).trim());
    var key = matched[1];
    if (SECRET_KEYS[key.toLowerCase()]) return;
    target[key] = stripQuotes(matched[2]);
  }

  function parseItems(text) {
    var items = [];
    var current = null;
    var lines = String(text || "").split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line.trim()) continue;
      var started = /^-\s+(.*)$/.exec(line);
      if (started) {
        if (current) items.push(current);
        current = {};
        assignKv(current, started[1]);
        continue;
      }
      var continued = /^(?: {2,}|\t+)(.*)$/.exec(line);
      if (continued && current) {
        assignKv(current, continued[1]);
        continue;
      }
      throw new Error("목록 형식 오류: " + line.trim());
    }
    if (current) items.push(current);
    return items;
  }

  function parseStatSection(text) {
    var map = {};
    var lines = String(text || "").split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var trimmed = lines[i].trim().replace(/^-\s+/, "");
      if (!trimmed || trimmed.charAt(0) === "#") continue;
      var matched = /^([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(trimmed);
      if (!matched) throw new Error("통계 섹션 형식 오류: " + trimmed);
      map[matched[1]] = stripQuotes(matched[2]);
    }
    return map;
  }

  function applyStatMap(target, map) {
    STAT_KEYS.forEach(function (key) {
      if (map[key] == null || map[key] === "") return;
      target[key] = typeof map[key] === "number" ? map[key] : parseNumber(map[key], key);
    });
  }

  function emptyCharacter(fileName) {
    return {
      ok: true,
      fileName: fileName,
      id: "",
      name: "",
      nickname: "",
      status: "미정",
      image: "",
      birthdate: "",
      gender: "",
      intro: "",
      todayVisitors: null,
      yesterdayVisitors: null,
      postCount: null,
      commentCount: null,
      blogs: [],
      accounts: [],
      routines: [],
      statsSource: "마크다운",
      statWarnings: []
    };
  }

  function fieldValue(fields, key) {
    for (var i = 0; i < fields.length; i++) {
      if (fields[i].key === key) return fields[i].value;
    }
    return "";
  }

  function fieldValues(fields, key) {
    var values = [];
    for (var i = 0; i < fields.length; i++) {
      if (fields[i].key === key) values.push(fields[i].value);
    }
    return values;
  }

  function cleanUrl(raw) {
    return String(raw || "").replace(/[),.\]]+$/, "");
  }

  // 1993-02-19 만 받는다. 없는 날짜는 빈 문자열로 둔다.
  function parseBirth(value) {
    var matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
    if (!matched) return "";
    var year = Number(matched[1]);
    var month = Number(matched[2]);
    var day = Number(matched[3]);
    var date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
    return matched[1] + "-" + matched[2] + "-" + matched[3];
  }

  function parseGender(value) {
    var text = String(value || "").trim();
    if (text === "여자" || text === "여성") return "female";
    if (text === "남자" || text === "남성") return "male";
    return "";
  }

  // "네이버 … https://blog.naver.com/id / 티스토리 …" 한 줄을 블로그 목록으로 나눈다.
  function parseBlogLine(value) {
    var text = String(value || "").trim();
    if (!text || text === "없음" || text === "(없음)") return [];
    var blogs = [];
    text.split(/\s+\/\s+/).forEach(function (part) {
      var found = /https?:\/\/[^\s)]+/i.exec(part);
      if (!found) return;
      var platform = "블로그";
      if (part.indexOf("티스토리") !== -1) platform = "티스토리";
      else if (part.indexOf("네이버") !== -1) platform = "네이버";
      else if (part.indexOf("뽐뿌") !== -1) platform = "뽐뿌";
      else if (part.indexOf("클리앙") !== -1) platform = "클리앙";
      // 주소가 있으면 운영 중이다. 메모에 적힌 미운영은 카드에 붙이지 않는다.
      blogs.push({
        platform: platform,
        url: cleanUrl(found[0]),
        paused: false
      });
    });
    return blogs;
  }

  function parseLoginValue(value) {
    var text = String(value || "").trim();
    if (!text || text === "없음" || text === "(없음)") return null;
    var matched = /^([^:：]+)[:：]\s*(.*)$/.exec(text);
    if (!matched) return null;
    var id = matched[2].trim();
    var note = "";
    var extra = /^(.*?)(?:\s*\(([^)]*)\))\s*$/.exec(id);
    if (extra) {
      id = extra[1].trim();
      note = extra[2].trim();
    }
    if (!id || id === "없음" || id === "(없음)") return null;
    var account = { platform: matched[1].trim() };
    if (id.indexOf("@") !== -1) account.email = id;
    else account.id = id;
    if (note) account.note = note;
    return account;
  }

  function parseRoutineLine(value) {
    var text = String(value || "").trim();
    if (!text || text === "(없음)" || text.indexOf("없음") === 0) return [];
    return text.split(/\s+\/\s+/).map(function (part) {
      var time = /(\d{1,2}:\d{2})/.exec(part);
      return { time: time ? time[1] : "", task: part.trim() };
    }).filter(function (item) { return item.task; });
  }

  /**
   * 운영 메모 형식(- 이름: 값)을 카드 필드로 읽는다.
   * 프로필 사진 파일 경로는 쓰지 않는다. 화면은 블로그 프로필을 따로 가져온다.
   */
  function parseProfile(text, fileName) {
    var fields = [];
    var heading = "";
    String(text || "").split(/\r?\n/).forEach(function (line) {
      var trimmed = line.trim();
      var title = /^#\s+(.+)$/.exec(trimmed);
      if (title && !heading) heading = title[1].trim();
      var item = /^-\s+([^:：]+)\s*[:：]\s*(.*)$/.exec(trimmed);
      if (item) fields.push({ key: item[1].trim(), value: item[2].trim() });
    });
    if (!fields.length) return fail(fileName, "프론트매터도 프로필 목록도 없습니다.");
    var givenName = fieldValue(fields, "이름");
    var koreanName = fieldValue(fields, "한국어 호칭");
    var character = emptyCharacter(fileName || "");
    character.id = String(fileName || "").replace(/\.md$/i, "");
    character.name = koreanName || givenName || heading;
    character.nickname = fieldValue(fields, "별명");
    character.birthdate = parseBirth(fieldValue(fields, "생년월일"));
    character.gender = parseGender(fieldValue(fields, "성별"));
    if (!character.name) return fail(fileName, "이름(name)이 없습니다.");
    if (!character.id) return fail(fileName, "아이디를 만들 수 없습니다.");
    var intro = fieldValue(fields, "적용 컨셉") || fieldValue(fields, "특이사항");
    if (givenName && koreanName && givenName !== koreanName && intro.indexOf(givenName) === -1) {
      intro = "이름: " + givenName + (intro ? "\n" + intro : "");
    }
    var region = fieldValue(fields, "사는 지역");
    if (region && intro.indexOf(region) === -1) intro += (intro ? "\n" : "") + "사는 곳: " + region;
    character.intro = intro.trim();
    character.blogs = parseBlogLine(fieldValue(fields, "블로그·채널 목록"));
    character.accounts = fieldValues(fields, "로그인 아이디").map(parseLoginValue).filter(Boolean);
    character.routines = parseRoutineLine(fieldValue(fields, "루틴 목록"));
    var running = character.blogs.filter(function (blog) { return !blog.paused; });
    if (running.length) character.status = "활성";
    else if (character.blogs.length) character.status = "휴식";
    else character.status = "미정";
    return character;
  }

  /**
   * 마크다운 문자열을 캐릭터 객체로 바꾼다.
   * 통계는 프론트매터 또는 ## 통계 섹션 둘 다 읽을 수 있다.
   * --- 가 없으면 운영 메모(- 이름: 값)로 읽는다.
   */
  function parse(text, fileName) {
    try {
      if (typeof text !== "string" || !text.trim()) {
        return fail(fileName, "파일 내용이 비어 있습니다.");
      }
      var source = text.replace(/^\uFEFF/, "").replace(/^(?:[ \t]*\r?\n)+/, "");
      var wrapped = /^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)([\s\S]*)$/.exec(source);
      if (!wrapped) return parseProfile(source, fileName);
      var front = parseFrontMatter(wrapped[1]);
      var sections = parseSections(wrapped[2]);
      var character = emptyCharacter(fileName || "");
      character.id = front.id || String(fileName || "").replace(/\.md$/i, "");
      character.name = front.name || "";
      character.nickname = front.nickname || "";
      character.birthdate = parseBirth(front.birthdate || "");
      character.gender = parseGender(front.gender || "");
      character.status = front.status || "미정";
      character.image = front.image || "";
      if (!character.name) return fail(fileName, "이름(name)이 없습니다.");
      if (!character.id) return fail(fileName, "아이디를 만들 수 없습니다.");
      applyStatMap(character, front);
      if (sections["통계"]) applyStatMap(character, parseStatSection(sections["통계"]));
      character.intro = String(sections["소개"] || "").trim();
      // 비밀번호만 있던 항목은 키가 전부 버려져 빈 객체가 된다.
      function filled(items) {
        return items.filter(function (item) { return item && Object.keys(item).length; });
      }
      character.blogs = sections["블로그"] ? filled(parseItems(sections["블로그"])) : [];
      character.accounts = sections["계정"] ? filled(parseItems(sections["계정"])) : [];
      character.routines = sections["루틴"] ? filled(parseItems(sections["루틴"])) : [];
      return character;
    } catch (error) {
      return fail(fileName, error && error.message ? error.message : "파싱 오류");
    }
  }

  /**
   * stats.json 값을 같은 id(없으면 파일명)에 덮어쓴다.
   * JSON에 없는 항목은 마크다운 값을 유지한다.
   */
  function mergeStats(character, statsDoc) {
    var next = Object.assign({}, character);
    next.statWarnings = (character.statWarnings || []).slice();
    if (!character.ok) return next;
    var bag = statsDoc && statsDoc.characters && typeof statsDoc.characters === "object"
      ? statsDoc.characters
      : null;
    var fileKey = String(character.fileName || "").replace(/\.md$/i, "");
    var extra = bag ? (bag[character.id] || bag[fileKey]) : null;
    if (!extra || typeof extra !== "object" || Array.isArray(extra)) {
      next.statsSource = "마크다운";
      return next;
    }
    var fromJson = 0;
    var keptMd = 0;
    STAT_KEYS.forEach(function (key) {
      if (extra[key] == null || extra[key] === "") {
        if (next[key] != null) keptMd += 1;
        return;
      }
      var num = Number(String(extra[key]).replace(/,/g, "").trim());
      if (!isFinite(num)) {
        if (next[key] != null) keptMd += 1;
        next.statWarnings.push(key + " 값을 읽지 못해 마크다운 값을 유지했습니다.");
        return;
      }
      next[key] = num;
      fromJson += 1;
    });
    if (fromJson === 0) next.statsSource = "마크다운";
    else if (keptMd > 0) next.statsSource = "stats.json + 마크다운";
    else next.statsSource = "stats.json";
    return next;
  }

  root.CharacterParser = { parse: parse, mergeStats: mergeStats, STAT_KEYS: STAT_KEYS };
})(typeof globalThis !== "undefined" ? globalThis : this);
