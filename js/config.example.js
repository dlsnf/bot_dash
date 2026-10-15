/**
 * 설정 예시입니다. 이 파일만 GitHub에 올립니다.
 * 사용 전 복사하세요:  cp js/config.example.js js/config.js
 * js/config.js 는 .gitignore 대상이라 저장소에 올라가지 않습니다.
 * 비밀번호는 예시 값입니다. 서버에 배포할 때 config.js에서 직접 수정하세요.
 */
const DASHBOARD_CONFIG = {
  auth: {
    username: "admin",
    // 예시 값입니다. 서버에 배포할 때 직접 수정하세요.
    password: "change-me-on-deploy"
  },
  login: {
    maxAttempts: 5,
    lockMinutes: 10,
    sessionHours: 720
  },
  // characters/ 기준 파일명. 새 캐릭터를 추가하면 여기에 적어 주세요.
  characterFiles: [],
  defaultImage: "characters/images/default.svg",
  visitorThresholds: {
    high: 100,
    medium: 30
  },
  // 어제 방문이 dropMinYesterday 이상이고, 감소율이 dropRate 이상이면 급감으로 표시
  dropRate: 0.3,
  dropMinYesterday: 10
};
