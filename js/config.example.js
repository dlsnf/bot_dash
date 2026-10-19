/**
 * 설정 예시입니다. 이 파일만 GitHub에 올립니다.
 * 사용 전 복사하세요:  cp js/config.example.js js/config.js
 * js/config.js 는 .gitignore 대상이라 저장소에 올라가지 않습니다.
 * 비밀번호는 적지 않습니다. 서버의 /etc/bot_dash.env 또는 BOTDASH_USER, BOTDASH_PASSWORD 환경 변수가 검사합니다.
 */
const DASHBOARD_CONFIG = {
  auth: {
    username: "admin"
  },
  login: {
    maxAttempts: 5,
    lockMinutes: 10,
    sessionHours: 720
  },
  defaultImage: "characters/images/default.svg",
  visitorThresholds: {
    high: 100,
    medium: 30
  },
  // 어제 방문이 dropMinYesterday 이상이고, 감소율이 dropRate 이상이면 급감으로 표시
  dropRate: 0.3,
  dropMinYesterday: 10
};
