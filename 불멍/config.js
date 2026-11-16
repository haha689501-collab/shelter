/*
 * 불멍 캠프 설정 파일
 * ------------------------------------------------------------
 * 이 파일만 고치면 이름 · 장소 설명 · 함께 모드를 바꿀 수 있습니다.
 * (Supabase 는 쉼터와 같은 프로젝트를 그대로 씁니다. 방 이름 앞에 'BUL-' 가 붙어 섞이지 않아요)
 */
window.SPACE_CONFIG = {
  title: '불멍 캠프',
  subtitle: '별 아래 모닥불 앞에서, 아무것도 안 해도 되는 시간',

  // 풍등 소원 글자 수 제한과 금지어
  maxTextLength: 40,
  bannedWords: [],

  // 한 방 최대 인원 (넘으면 다른 방으로 안내)
  roomCapacity: 40,

  // 공개 키(anon / publishable)만 넣으세요. service_role 키는 절대 넣지 마세요.
  // 비워 두면 '혼자 모드'로 동작합니다.
  supabase: {
    url: 'https://nlshasikjbccskjguykk.supabase.co',
    anonKey: 'sb_publishable_Ei0VbIgXfEEZB_xzwlGS7Q_tDhS19v4',
  },

  /*
   * 장소 목록 — type 은 fire | tent | hammock | lake 중 하나
   * position: [x, z] (모닥불이 [0, 0], 호수는 북쪽 +z)
   */
  places: [
    { id: 'fire',    type: 'fire',    name: '모닥불',      desc: '둘러앉아 불을 바라봐요. 장작을 넣고, 마시멜로를 굽고, 고민 한 줄을 태워도 돼요.', position: [0, 0], radius: 7 },
    { id: 'tent',    type: 'tent',    name: '텐트촌',      desc: '랜턴을 켜고 끄거나, 텐트 안 침낭에 누워 쉬어요.', position: [-12, -9], radius: 6.5 },
    { id: 'hammock', type: 'hammock', name: '소나무 해먹', desc: '두 소나무 사이에 걸린 해먹. 누우면 천천히 흔들려요.', position: [15, 3], radius: 5 },
    { id: 'lake',    type: 'lake',    name: '호숫가 데크', desc: '달빛이 물 위에 길게 비쳐요. 소원을 적어 풍등을 띄우고, 물수제비도 떠 봐요.', position: [4, 20], radius: 6 },
  ],
};
