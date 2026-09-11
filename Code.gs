/******************************************************
 * 영어 편의점 — 서버 (Google Apps Script)
 * 설치 방법은 설치가이드.md 참고
 *
 * 시트 탭 3개를 사용합니다:
 *  - 사용자: 계정 + 부모용 요약(마지막활동/영머니/배운단어/마스터/연속일/정답률)
 *  - 상태: 각 아이의 전체 진행 데이터(JSON)
 *  - 이벤트: 문제 풀이 한 건 한 건의 로그(분석용)
 ******************************************************/

const TABS = { U: "사용자", S: "상태", E: "이벤트", I: "상점", Q: "퀘스트" };

/* ── 관리자 아이디 목록 ──
   여기 적힌 아이디로 로그인하면 앱 설정에 [상점 관리] 버튼이 나타납니다.
   원하는 아이디로 바꾼 뒤, 앱에서 그 아이디로 가입하세요. */
const ADMIN_IDS = ["appa"];

/* ── 최초 1회 실행: 시트 탭과 머리글 생성 ── */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  mk_(ss, TABS.U, ["아이디","이름","PIN해시","토큰","가입일","마지막활동","영머니","누적획득","배운단어","마스터","연속일","정답률"]);
  mk_(ss, TABS.S, ["아이디","상태JSON","업데이트"]);
  mk_(ss, TABS.E, ["시각","아이디","종류","단어","모드","정답","기타"]);
  mk_(ss, TABS.I, ["id","분류","이름","이모지","가격"]);
  mk_(ss, TABS.Q, ["아이디","상태JSON","업데이트"]);
}
function mk_(ss, name, head) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.appendRow(head);
}

/* ── 브라우저로 주소를 열면 작동 확인 ── */
function doGet() {
  return out_({ ok: true, msg: "영어 편의점 서버 작동 중 ✅" });
}

/* ── 앱에서 오는 모든 요청 처리 ── */
function doPost(e) {
  try {
    const p = JSON.parse(e.postData.contents);
    const a = p.action;
    if (a === "signup") return out_(signup_(p));
    if (a === "login")  return out_(login_(p));
    if (a === "load")   return out_(load_(p));
    if (a === "save")   return out_(save_(p));
    if (a === "tts")    return out_(tts_(p));
    if (a === "items")     return out_(items_());
    if (a === "saveitems") return out_(saveItems_(p));
    if (a === "qload")     return out_(qload_(p));
    if (a === "qsave")     return out_(qsave_(p));
    return out_({ err: "bad-action" });
  } catch (err) {
    return out_({ err: String(err) });
  }
}

/* ── 공용 도우미 ── */
function out_(o) {
  if (o.err) o.ok = false;
  else if (o.ok === undefined) o.ok = true;
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}
function sh_(n) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(n); }
function hash_(uid, pin) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, uid + "::" + pin + "::ecvs")
    .map(function(b){ return ((b + 256) % 256).toString(16).padStart(2, "0"); }).join("");
}
function findU_(uid) {
  const s = sh_(TABS.U), v = s.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][0]) === uid) return { row: i + 1, d: v[i] };
  }
  return null;
}
function auth_(p) {
  const u = findU_(String(p.uid || "").toLowerCase());
  if (!u) return null;
  if (String(u.d[3]) !== String(p.token || "")) return null;
  return u;
}
function ttsOn_() {
  return !!PropertiesService.getScriptProperties().getProperty("GCP_TTS_KEY");
}
function isAdmin_(uid) {
  return ADMIN_IDS.indexOf(String(uid || "").toLowerCase()) >= 0;
}

/* ── 상점 목록 읽기 (누구나) ──
   '상점' 탭이 비어 있으면 items:null → 앱은 내장 기본 36종을 씁니다. */
function items_() {
  const s = sh_(TABS.I);
  if (!s || s.getLastRow() < 2) return { items: null };
  const v = s.getDataRange().getValues();
  const items = [];
  for (let i = 1; i < v.length; i++) {
    const pr = Number(v[i][4]);
    if (String(v[i][2]) && pr > 0) {
      items.push({ id: String(v[i][0]), cat: String(v[i][1]), nm: String(v[i][2]), emo: String(v[i][3]), pr: pr });
    }
  }
  return { items: items.length ? items : null };
}

/* ── 상점 목록 저장 (관리자만) ── */
function saveItems_(p) {
  const u = auth_(p);
  if (!u) return { err: "auth" };
  if (!isAdmin_(u.d[0])) return { err: "notadmin" };
  const arr = (p.items || []).slice(0, 200);
  if (!arr.length) return { err: "empty" };
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    let s = sh_(TABS.I);
    if (!s) {
      s = SpreadsheetApp.getActiveSpreadsheet().insertSheet(TABS.I);
      s.appendRow(["id","분류","이름","이모지","가격"]);
    }
    if (s.getLastRow() > 1) s.getRange(2, 1, s.getLastRow() - 1, 5).clearContent();
    s.getRange(2, 1, arr.length, 5).setValues(arr.map(function(it){
      return [String(it.id || ""), String(it.cat || ""), String(it.nm || ""), String(it.emo || ""), Number(it.pr) || 0];
    }));
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/* ── 가입 ── */
function signup_(p) {
  const uid = String(p.uid || "").toLowerCase();
  if (!/^[a-z0-9]{3,12}$/.test(uid)) return { err: "badid" };
  if (!/^\d{4,6}$/.test(String(p.pin || ""))) return { err: "badpin" };
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    if (findU_(uid)) return { err: "dup" };
    const token = Utilities.getUuid();
    sh_(TABS.U).appendRow([uid, String(p.name || uid), hash_(uid, String(p.pin)), token, new Date(), new Date(), 0, 0, 0, 0, 0, ""]);
    sh_(TABS.S).appendRow([uid, "", new Date()]);
    return { token: token, tts: ttsOn_(), admin: isAdmin_(uid) };
  } finally {
    lock.releaseLock();
  }
}

/* ── 로그인 ── */
function login_(p) {
  const uid = String(p.uid || "").toLowerCase();
  const u = findU_(uid);
  if (!u) return { err: "nouser" };
  if (u.d[2] !== hash_(uid, String(p.pin || ""))) return { err: "badpin" };
  const token = Utilities.getUuid();
  sh_(TABS.U).getRange(u.row, 4).setValue(token);
  sh_(TABS.U).getRange(u.row, 6).setValue(new Date());
  return { token: token, name: u.d[1], tts: ttsOn_(), admin: isAdmin_(uid) };
}

/* ── 진행 데이터 불러오기 ── */
function load_(p) {
  const u = auth_(p);
  if (!u) return { err: "auth" };
  const s = sh_(TABS.S), v = s.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][0]) === u.d[0]) {
      const j = v[i][1];
      return { state: j ? JSON.parse(j) : null, tts: ttsOn_() };
    }
  }
  return { state: null, tts: ttsOn_() };
}

/* ── 진행 데이터 저장 + 이벤트 기록 + 부모용 요약 갱신 ── */
function save_(p) {
  const u = auth_(p);
  if (!u) return { err: "auth" };
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const st = p.state || {};
    const js = JSON.stringify(st);

    /* 상태 JSON 갱신 */
    const s = sh_(TABS.S), v = s.getDataRange().getValues();
    let done = false;
    for (let i = 1; i < v.length; i++) {
      if (String(v[i][0]) === u.d[0]) {
        s.getRange(i + 1, 2, 1, 2).setValues([[js, new Date()]]);
        done = true;
        break;
      }
    }
    if (!done) s.appendRow([u.d[0], js, new Date()]);

    /* 이벤트 로그 (한 번에 최대 500건) */
    const evs = (p.events || []).slice(0, 500);
    if (evs.length) {
      const es = sh_(TABS.E);
      es.getRange(es.getLastRow() + 1, 1, evs.length, 7).setValues(evs.map(function(ev){
        return [new Date(ev.t || Date.now()), u.d[0], ev.type || "", ev.w || "", ev.m || "", (ev.ok === undefined ? "" : ev.ok), JSON.stringify(ev)];
      }));
    }

    /* 부모용 요약: 마지막활동 · 영머니 · 누적획득 · 배운단어 · 마스터 · 연속일 · 정답률 */
    const learned = st.learned || {};
    const lw = Object.keys(learned);
    const mastered = lw.filter(function(w){ return (learned[w].box || 1) >= 6; }).length;
    let q = 0, r = 0;
    const ds = st.dstats || {};
    for (const d in ds) { q += ds[d].q || 0; r += ds[d].r || 0; }
    const acc = q ? Math.round(r / q * 100) + "%" : "";
    sh_(TABS.U).getRange(u.row, 6, 1, 7).setValues([[new Date(), st.money || 0, st.earned || 0, lw.length, mastered, st.streak || 0, acc]]);

    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/* ── 단어 퀘스트(게임 페이지) 진행 저장/불러오기 ──
   영어 편의점과 같은 계정을 쓰지만, 진행 데이터는 '퀘스트' 탭에 따로 삽니다. */
function qload_(p) {
  const u = auth_(p);
  if (!u) return { err: "auth" };
  const s = sh_(TABS.Q);
  if (!s || s.getLastRow() < 2) return { state: null };
  const v = s.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][0]) === u.d[0]) {
      const j = v[i][1];
      return { state: j ? JSON.parse(j) : null };
    }
  }
  return { state: null };
}
function qsave_(p) {
  const u = auth_(p);
  if (!u) return { err: "auth" };
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    let s = sh_(TABS.Q);
    if (!s) {
      s = SpreadsheetApp.getActiveSpreadsheet().insertSheet(TABS.Q);
      s.appendRow(["아이디","상태JSON","업데이트"]);
    }
    const js = JSON.stringify(p.state || {});
    const v = s.getDataRange().getValues();
    for (let i = 1; i < v.length; i++) {
      if (String(v[i][0]) === u.d[0]) {
        s.getRange(i + 1, 2, 1, 2).setValues([[js, new Date()]]);
        return { ok: true };
      }
    }
    s.appendRow([u.d[0], js, new Date()]);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/* ── 원어민 음성(선택 기능): Google Cloud TTS 중계 ──
   스크립트 속성에 GCP_TTS_KEY 를 넣으면 자동으로 켜집니다.
   음성을 바꾸고 싶으면 GCP_TTS_VOICE 속성 추가 (기본: en-US-Neural2-F) */
function tts_(p) {
  const u = auth_(p);
  if (!u) return { err: "auth" };
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty("GCP_TTS_KEY");
  if (!key) return { err: "tts-off" };

  const text = String(p.text || "").slice(0, 300);
  const voice = props.getProperty("GCP_TTS_VOICE") || "en-US-Neural2-F";
  const ck = "t:" + Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, voice + "|" + text));
  const cache = CacheService.getScriptCache();
  const hit = cache.get(ck);
  if (hit) return { audio: hit };

  const res = UrlFetchApp.fetch("https://texttospeech.googleapis.com/v1/text:synthesize?key=" + key, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({
      input: { text: text },
      voice: { languageCode: "en-US", name: voice },
      audioConfig: { audioEncoding: "MP3", speakingRate: 0.92 }
    })
  });
  const audio = JSON.parse(res.getContentText()).audioContent;
  if (audio && audio.length < 95000) cache.put(ck, audio, 21600); /* 6시간 캐시 */
  return { audio: audio };
}
