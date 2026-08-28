# 영어 편의점 (English Store) — 프로젝트 운영 지침

## 무엇인가
초등학생(현재 사용자: 박보민 대표의 초4 아들, 국제학교 진학 예정)용 영단어 학습 게임 웹앱.
단어를 외워 "영머니"를 벌고, 앱 안 편의점에서 실제 상품을 골라 부모가 실제로 사 주는 구조.

## 아키텍처 (3요소)

```
index.html  (GitHub Pages)  ← 프론트 전체. 단일 파일, 약 160KB
      ↕ fetch POST (text/plain, redirect:follow)
Code.gs     (Google Apps Script 웹앱)  ← 백엔드
      ↕
구글시트 (탭 4개: 사용자 / 상태 / 이벤트 / 상점)  ← DB 겸 부모 대시보드
```

- **index.html은 단일 파일**이다. HTML+CSS+JS가 한 파일 안에 있고, 빌드 과정도 번들러도 없다. 파일을 쪼개지 말 것.
- 외부 의존성은 Google Fonts(Jua)뿐. npm 패키지, 프레임워크(React 등) 도입 금지.
- `const SERVER_URL`(script 태그 상단)에 Apps Script 웹앱 URL이 들어 있다. 이 값을 임의로 비우거나 바꾸지 말 것.
- 저장은 3단계 폴백: 서버(로그인 시) → localStorage 캐시 → 게스트 모드.

## 절대 규칙

1. **localStorage/sessionStorage는 이 파일에서는 정상 사용**한다 (GitHub Pages에서 구동되므로). 단 로그인 사용자의 정본은 항상 서버다.
2. **수정 후 반드시 문법 검증**: script 내용을 추출해 `node --check`를 돌리고, `onclick="fn(...)"`으로 호출되는 모든 함수가 실제로 정의돼 있는지 확인할 것. 과거 이 확인을 빠뜨려 화면이 죽은 적이 있다.
3. **단어 DB(`WORDS`) 구조를 깨지 말 것.** 레벨 1~5, 각 75개, 각 항목은 6필드 배열:
   `[단어, 뜻, 예문, 예문해석, 말하기문장, 말하기해석]`
   표제어는 예문과 말하기문장에 반드시 원형으로 포함돼야 한다(빈칸 채우기 문제가 이걸 전제로 동작).
4. **상태(`S`) 필드를 지우지 말 것.** 기존 사용자 데이터가 서버에 저장돼 있어, 필드를 제거하면 진행 상황이 날아간다. 추가는 자유, 삭제는 금지.
5. 아이가 쓰는 앱이다. 텍스트는 반말 한국어, 이모지 적극 사용, 문장은 짧게.

## 화면 구조

`<div class="screen" id="scr-XXX">` 단위로 전환하며, `show("XXX")`로 표시한다.
auth(로그인) / welcome / place(레벨테스트) / home / learn / quiz / store / review / log(대시보드)

렌더 함수는 각 화면당 하나: `renderAuth, renderWelcome, renderPQ, renderHome, renderCard, renderEx, renderSpeak, renderQ, renderStore, renderReview, renderLog`
모두 문자열로 HTML을 만들어 `innerHTML`에 넣는 방식이다. 이 패턴을 유지할 것.

## 학습 루프 (핵심 로직)

하루 세션 = 단어 10개, 4단계를 순서대로 통과해야 완료:
1. **단어 카드** (뒤집기, `renderCard`) — "이미 알아요" 누르면 box3으로 저장하고 새 단어로 교체
2. **예문 빈칸** 4지선다 (`renderEx`)
3. **말하기** (`renderSpeak`) — 녹음 후 자기 목소리 재생해 원어민과 비교하는 방식.
   ※ iOS Safari의 SpeechRecognition이 불안정해 자동 인식은 **의도적으로 제거**했다. 되살리지 말 것.
4. **퀴즈** (`renderQ`) — 뜻/영어/듣기 3유형 랜덤

부가 모드: 복습(Leitner), 주말 보스 퀴즈(토·일), 오답 집중 훈련(miss≥2 단어 3개 이상 시).
`startQuiz(mode)`의 mode는 `daily | review | boss | drill` 4종.

**Leitner 복습**: `S.learned[단어] = {lv, box, next, date, miss}`. box 1→6, `BOX_GAP = [0,1,3,7,14,30,60]`일 후 재출제.
- 맞히면 box+1 (🌱→🌿→🪴→🌲→🌳→👑). **box 6에서 또 맞히면 box 7 = 졸업(🎓)** — `next=""` 로 두어 복습·오답훈련에 영구히 안 나온다. STAGE 배열 index 7 이 🎓.
- 틀리면 **한 칸만** 내려가고(`max(1, box-1)`) 다음 날 재출제 + miss+1. (예전에는 box=1 완전 리셋 → 복습량 폭증의 원인이었다. 되돌리지 말 것.)
- **하루 복습 상한** `S.revCap`(기본 20, 설정에서 10/20/30). 그날 아침 `pickDay()`가
  `S.day.revSet` 에 밀린 것 중 **오래된 순 상한개**를 담아 고정한다. `dueReviews()`는 이 고정 목록만 낸다
  (상한 없이 매번 다시 뽑으면 `finishReview`의 "남은 복습 0" 판정이 영영 안 되어 새 단어가 안 열린다).
- `allDue()` = 밀린 것 전체(표시용), `backlogN()` = 오늘 몫을 뺀 나머지.
  **밀린 총개수는 아이 화면에 숫자로 보여주지 않는다**(한때 400개까지 쌓여 겁을 준다). 기록 탭(부모용)에만 표시.

**모든 문제는 답한 뒤 자동으로 넘어가지 않는다.** 해설 패널을 보여주고 "다음 ▶" 버튼을 눌러야 진행한다(아이가 살펴볼 시간 확보). 자동 넘김으로 되돌리지 말 것.

## 발음(TTS) 2단계 구조

- 서버에 `GCP_TTS_KEY`가 등록돼 있으면 `speakServer()`가 Google Cloud TTS(Neural2) 음성을 받아 재생 — 이게 기본이자 권장 경로.
- 실패하거나 키가 없으면 `speakLocal()`로 기기 내장 음성 폴백.
- `speak(text, rate)`가 이 둘을 자동 분기한다. **음성 재생은 항상 `speak()`를 통할 것.**
- 저품질 기기 음성은 `isJunkVoice()`로 목록에서 걸러낸다.

**소리가 안 나는 문제로 여러 번 고쳤다. 아래를 되돌리지 말 것 (2026-08-28):**
- `a.play()` 는 프로미스를 돌려준다. **반드시 `.catch(()=>speakLocal(...))`** 를 붙인다.
  await 없이 try/catch 안에 두면 재생 차단(아이폰 자동재생 정책)이 잡히지 않아 **소리 없이 조용히 실패**한다.
- `speechSynthesis.cancel()` 직후 `speak()` 하면 통째로 무시되는 기기가 있다 → `speakLocal()`은
  60ms 뒤에 말하고, 320ms 뒤 `speaking/pending` 이 false 면 **한 번만** 다시 시도한다(`ttsT/ttsRetryT`).
- 아이폰은 `speechSynthesis` 를 pause 상태로 두는 일이 있어 매번 `resume()` 을 먼저 부른다.
- 첫 터치·클릭 때 `unlockAudio()` 로 AudioContext 를 깨우고 무음 발화를 한 번 흘린다.
- 설정의 `soundCheck()` 가 자가 진단 화면이다. 사용자가 "소리가 안 난다"고 하면 먼저 그걸 돌려 보게 한다.
  (아이폰 **무음 스위치**가 켜져 있으면 mp3 재생이 통째로 무음이 된다 — 가장 흔한 원인)
- `openSettings()` 는 로그인 화면(S 가 null)에서도 열려야 한다 → 첫 줄에 `if(!S) S = defaultState();`

## 서버(Code.gs) 연동

액션: `signup | login | load | save | tts | items | saveitems`
- `items`: 상점 목록 읽기(인증 불필요). '상점' 탭이 비어 있으면 `items:null` → 앱은 내장 기본값 사용.
- `saveitems`: 관리자만 상점 목록 저장. 관리자는 Code.gs 상단 `ADMIN_IDS` 배열의 아이디.
  login/signup 응답에 `admin:true`가 실리고, 프론트는 설정 모달에 [상점 관리] 버튼을 노출한다.
- 인증: uid + token(UUID). 요청마다 `auth_()`로 검증.
- `save`는 상태 JSON 갱신 + 이벤트 로그 append + 사용자 요약 7컬럼 갱신을 한 번에 처리.
- 프론트는 `logEv(type, data)`로 이벤트를 큐에 쌓고 `flushServer()`가 1.2초 디바운스로 전송한다.
  이벤트 종류: `q, session, review, boss, drill, buy, know, place, login, claw, clawwin`
- **Code.gs를 수정했으면 반드시 Apps Script에서 새로 배포**해야 반영된다(저장만으로는 반영 안 됨).
- 시트 탭이 없으면 `getDataRange` null 에러가 난다 → `setup()` 실행 필요.

## 상점

- 실제 목록은 전역 `ITEMS`. 서버 '상점' 탭 값이 있으면 그것, 없으면 내장 기본값 `STORE_ITEMS` 36종.
  부팅 때 `loadItemsCache()`(localStorage `ecvs-items`) → `loadItemsServer()`(`items` 액션) 순으로 채운다.
  상점·구매·뽑기 로직은 전부 `ITEMS`를 참조해야 한다 (`STORE_ITEMS` 직접 참조 금지).
- 관리자 화면(`scr-admin`, `renderAdmin`)에서 이모지/이름/가격/분류를 편집해 `saveitems`로 저장.
  분류(카테고리) 칩은 `ITEMS`에서 동적으로 생성되므로 새 분류를 자유롭게 추가할 수 있다.
- 간식은 2025~26년 한국 편의점 실제 가격, 장난감·굿즈는 시중가 기준.
  가격 현실성이 이 앱의 핵심(돈 감각 학습)이므로 임의로 바꾸지 말 것.
- 인형뽑기: 1회 1,000원, 꽝 없음. 경품은 `ITEMS` 중 3,000원 이하 전부(`clawPool`),
  가격이 쌀수록 잘 나오는 가중치(`clawWeight`), 직전 당첨(`S.lastClaw`)과 같으면 1회 재추첨.
  연출은 `doClaw()`의 setTimeout 단계(집게 이동→하강→집기→상승→출구→낙하, 약 6초).
- 구매하면 `S.buys`에 쌓이고 기록 탭 영수증에 표시 → 부모가 실제로 사 준 뒤 "전달 대기" 토글.

## 보상 설계

`REWARD` 상수 참조. 단어 50 / 재도전 25 / 일일보너스 100 / 퍼펙트 100 / 복습 10 / 복습올클리어 100 / 레벨테스트 300 / 레벨업 500 / 7일연속 300 / 보스 클리어 500 등.
**보상 금액을 바꾸면 상점 물가와의 균형이 깨진다.** 조정 시 두 쪽을 함께 검토할 것.

## 배포

수정 → GitHub 리포지토리(`bominpark-droid/English-convinience-store`)의 `index.html` 교체 → 커밋 →
1~2분 후 https://bominpark-droid.github.io/English-convinience-store/ 에 반영.
브라우저 캐시 때문에 즉시 안 보이면 강력 새로고침(Cmd+Shift+R).

## 단어 퀘스트 (quest.html) — 별도 게임 페이지 (2026-08-13 신설)

로블럭스풍 블록 캐릭터 단어 RPG. 영어 편의점과 **같은 저장소·같은 서버·같은 계정**을 쓰되
완전히 독립된 페이지다 (`…github.io/English-convinience-store/quest.html`).

- **단일 파일 원칙 동일.** 영머니와는 연동하지 않는다 (게임 자체가 보상).
- **단어 DB(`WORDS`)는 index.html의 복사본.** 단어를 고치면 **두 파일을 반드시 같이** 고칠 것.
- 구조: 5개 월드(=레벨 1~5) × 8스테이지(단어 10개, 마지막은 5개) = 40스테이지.
  하루 1스테이지만 클리어 가능(`QS.lastClear`). 흐름: 카드 학습 → 되찾기 퀴즈(맞으면 온전한 카드,
  틀리면 금 간 카드=공격력 절반) → 보스전(온전 카드 `needFull()`장 이상이면 승리, 10초 연출+팡파레
  `fanfare()`) → 패배 시 틀린 단어만 재학습 후 재도전.
- 상태는 `QS` (localStorage `ecvs-quest`) + 로그인 시 서버 `qload/qsave`(시트 '퀘스트' 탭).
  세션은 편의점의 `ecvs-session`을 그대로 읽는다 (같은 도메인이라 공유됨).
- 카드 공격력 `cardATK = 레벨×10 + 철자 수`. 도감(`renderDeck`)에서 수집 현황 표시.
- 팡파레는 WebAudio 합성(`fanfare()`) — 추후 대표가 작곡한 mp3로 교체 예정.

## 알려진 제약

- claude.ai 아티팩트 미리보기에서는 CSP 때문에 서버 연결·마이크가 모두 차단된다. 실제 테스트는 GitHub Pages에서만.
- iOS Safari는 새로 설치한 시스템 음성을 목록에 노출하지 않는 경우가 많다 → 서버 TTS를 쓰는 이유.
- 게스트 모드 진행분은 계정으로 이전되지 않는다(현재 사양).
