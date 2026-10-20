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

`js/config.js`는 화면 기준값만 담습니다. 비밀번호와 캐릭터 파일명은 적지 않습니다. 캐릭터 마크다운은 `characters/`에 넣으면 대시보드가 `.md` 파일을 스스로 읽습니다.

로그인에 쓰는 값은 `.env.example`을 웹 폴더 밖 `/etc/bot_dash.env`로 복사한 뒤 바꿉니다. 프로젝트 안의 `.env`는 읽지 않습니다.

```bash
cp .env.example /etc/bot_dash.env
chmod 600 /etc/bot_dash.env
```

운영 서버에서 이 파일을 다시 올리면 소유자가 바뀝니다. PHP 계정 `apache`만 읽도록 되돌립니다. 계정과 토큰 내용은 바뀌지 않습니다.

```bash
chown apache:apache /etc/bot_dash.env
chmod 600 /etc/bot_dash.env
```

Windows에서는 같은 기본 경로가 드라이브 루트의 `C:\etc\bot_dash.env`입니다.

```powershell
New-Item -ItemType Directory -Force -Path C:\etc | Out-Null
Copy-Item .env.example C:\etc\bot_dash.env
```

`BOTDASH_USER`와 `BOTDASH_PASSWORD`를 채우고, 파일은 UTF-8로 저장합니다. 다른 경로를 쓰려면 그 경로를 `BOTDASH_ENV`에 넣습니다. 컨테이너라면 파일을 두지 않고 같은 이름의 환경 변수를 넘깁니다. 프로세스에 `BOTDASH_USER`와 `BOTDASH_PASSWORD`가 둘 다 있으면 그 값이 파일보다 우선합니다.

Blogger 페이지뷰를 API로 받을 때만 `.env.example`에 주석으로 있는 `BLOGGER_CLIENT_ID_`, `BLOGGER_CLIENT_SECRET_`, `BLOGGER_REFRESH_TOKEN_` 줄을 캐릭터 파일명 접미사로 채웁니다. 예를 들어 `characters/na_nuri.md`는 `BLOGGER_CLIENT_ID_na_nuri`입니다. 블로그 주소는 캐릭터 마크다운에 둡니다.

정적 파일을 확인하려면 다음 명령으로 서버를 실행합니다.

```bash
python3 -m http.server 8080
```

`http://127.0.0.1:8080/login.html`을 엽니다. PHP를 사용할 수 있는 환경에서는 다음 명령으로 실행하면 `profile.php`의 정보 조회 기능도 확인할 수 있습니다.

```bash
php -S 127.0.0.1:8080
```

## 블로거 오늘 방문자

블로거가 알려 주는 숫자는 전체 페이지뷰입니다. 오늘 방문자는 `data/blogger_totals.json`에 적힌 어제 전체에서 지금 전체를 뺀 값입니다. 어제 기록이 없으면 오늘 칸은 0으로 보입니다. 이 파일은 git에 들어가지 않으므로 서버에 따로 둡니다.

웹 PHP가 이 파일을 읽고 쓸 수 있어야 오늘 숫자가 나옵니다. 운영 서버의 PHP 계정은 `apache`이고, 사이트 경로는 `/var/www/html/bot_dash`입니다. 그 폴더에서 권한을 이렇게 맞춥니다.

```bash
sudo chown apache:apache data data/blogger_totals.json
sudo chmod 755 data
sudo chmod 600 data/blogger_totals.json
```

`data`는 소유자가 들어갈 수 있는 755입니다. JSON은 소유자만 읽고 쓰는 600입니다. 기록이 성공할 때마다 프로그램이 JSON을 다시 600으로 되돌립니다. 655는 소유자의 폴더 진입 권한이 빠져서 쓰지 않습니다.

블로거 오늘 계산 로그는 기본적으로 남지 않습니다. 서버 `/etc/bot_dash.env`에 `BOTDASH_COUNT_LOG=1`을 넣으면 `data/blogger_count.log`에 남습니다. `0`이거나 그 줄이 없으면 꺼집니다. 켠 상태에서 `data/`에 쓰지 못하면 `/tmp/botdash-blogger-count.log`에 남고, 집계 응답 헤더 `X-Botdash-Log`가 그 경로입니다.

하루 마감은 브라우저 없이 `blogger_close.php`가 남깁니다. 서버 시계는 한국시간입니다. root crontab에 한 줄만 있습니다. root는 파일 소유자와 상관없이 JSON을 쓸 수 있어서 `apache` crontab은 따로 두지 않습니다. 같은 줄을 두 계정에 넣으면 23:50에 두 번 실행됩니다.

```bash
crontab -l 2>/dev/null | sed '/blogger_close\.php/d' | { cat; echo '50 23 * * * /usr/bin/php /var/www/html/bot_dash/blogger_close.php'; } | crontab -
crontab -l
```

`crontab -l`에 아래 줄이 보이면 등록된 것입니다.

```cron
50 23 * * * /usr/bin/php /var/www/html/bot_dash/blogger_close.php
```

서버가 그 시각에 켜져 있어야 합니다. 시계가 한국시간이 아니면 줄 앞에 `CRON_TZ=Asia/Seoul`을 붙입니다. 첫날 기록만으로는 오늘 방문자가 나오지 않습니다. 다음 날 23:50 기록부터 어제 마감이 생겨서 오늘 방문자가 계산됩니다.

## 개인 데이터와 보안

`.gitignore`는 개인 캐릭터 파일, 실제 설정 파일, 통계 데이터를 저장소에서 제외합니다. 공개 저장소에는 실제 계정 정보, 이메일, 비밀번호, 개인 메모 또는 통계를 추가하지 마세요. 예시 설정의 값은 실제 인증 정보로 사용하지 마세요.

비밀번호는 `js/config.js`나 웹에서 열리는 `.env`에 넣지 않습니다. [로컬 실행](#로컬-실행)처럼 `/etc/bot_dash.env`에 `BOTDASH_USER`와 `BOTDASH_PASSWORD`를 두거나, 컨테이너에는 같은 이름의 환경 변수를 넘깁니다. 로그인한 뒤에만 `content.php`가 마크다운과 `stats.json`을 돌려주고, `profile.php`가 글·댓글 수와 프로필 사진을 가져옵니다. 이 사이트는 HTTP라 로그인 요청 자체는 암호화되지 않습니다. HTTPS가 있으면 그쪽으로 여는 것이 맞습니다.

## 캐릭터 데이터

캐릭터 파일은 `characters/` 바로 아래의 Markdown 파일입니다. 파일을 넣으면 로그인한 대시보드가 그 목록을 읽어 카드를 만듭니다. 파일명은 영문, 숫자, `_`, `-`만 쓸 수 있고, 하위 폴더의 파일은 읽지 않습니다. 선택적으로 `data/stats.json`에서 방문자 등 통계를 관리할 수 있습니다.

## 기술 구성

- 프론트엔드: HTML, CSS, JavaScript
- 프로필 및 블로그 정보 조회: PHP
- 그래프: Chart.js
- 아이콘: Font Awesome
