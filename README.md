# 캐릭터 대시보드

여러 캐릭터와 블로그의 공개 현황을 한 화면에서 확인하는 웹 대시보드입니다. 카드와 상세 화면에서 방문자, 게시물, 댓글 정보를 볼 수 있고, 통계 화면에서는 데이터를 비교할 수 있습니다.

## 주요 기능

- 캐릭터 카드, 검색, 필터, 정렬 및 상세 보기
- 블로그별 공개 프로필과 게시물 통계 조회
- 방문자 통계 그래프 및 JSON 내보내기
- 서버 세션 로그인 뒤의 카드 화면

화면은 HTML, CSS, JavaScript로 구성되어 있습니다. `profile.php`는 블로그의 공개 정보를 가져오며, 그래프에는 Chart.js, 아이콘에는 Font Awesome CDN을 사용합니다.

## 로컬 실행

저장소를 복제한 뒤 프로젝트 디렉터리에서 설정 예시를 복사합니다.

```bash
cp js/config.example.js js/config.js
```

`js/config.js`를 열어 캐릭터 파일 목록을 지정합니다. 비밀번호는 이 파일에 적지 않습니다. 캐릭터 데이터가 있다면 `characters/`에 별도로 준비하고, `characterFiles`에 파일명을 추가하세요.

정적 파일을 확인하려면 다음 명령으로 서버를 실행합니다.

```bash
python3 -m http.server 8080
```

`http://127.0.0.1:8080/login.html`을 엽니다. PHP를 사용할 수 있는 환경에서는 다음 명령으로 실행하면 `profile.php`의 정보 조회 기능도 확인할 수 있습니다.

```bash
php -S 127.0.0.1:8080
```

## 개인 데이터와 보안

`.gitignore`는 개인 캐릭터 파일, 실제 설정 파일, 통계 데이터를 저장소에서 제외합니다. 공개 저장소에는 실제 계정 정보, 이메일, 비밀번호, 개인 메모 또는 통계를 추가하지 마세요. 예시 설정의 값은 실제 인증 정보로 사용하지 마세요.

비밀번호는 `js/config.js`에 넣지 않습니다. 서버의 `/etc/bot_dash.env`에 `BOTDASH_USER`와 `BOTDASH_PASSWORD`를 두거나, 컨테이너에는 같은 이름의 환경 변수를 넘깁니다. 로그인한 뒤에만 `content.php`가 마크다운과 `stats.json`을 돌려주고, `profile.php`가 글·댓글 수와 프로필 사진을 가져옵니다. 이 사이트는 HTTP라 로그인 요청 자체는 암호화되지 않습니다. HTTPS가 있으면 그쪽으로 여는 것이 맞습니다.

## 캐릭터 데이터

캐릭터 파일은 `characters/` 아래의 Markdown 파일입니다. 파일을 추가한 후 `js/config.js`의 `characterFiles`에 이름을 등록하면 대시보드가 해당 데이터를 읽습니다. 선택적으로 `data/stats.json`에서 방문자 등 통계를 관리할 수 있습니다.

## 기술 구성

- 프론트엔드: HTML, CSS, JavaScript
- 프로필 및 블로그 정보 조회: PHP
- 그래프: Chart.js
- 아이콘: Font Awesome
