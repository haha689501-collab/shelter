/*
 * 쉼터 설정 파일
 * ------------------------------------------------------------
 * 이 파일만 고치면 다른 학교 · 기관 · 행사용으로 바꿔 쓸 수 있습니다.
 * (코드 파일 app.js 는 손대지 않아도 됩니다)
 */
window.SPACE_CONFIG = {
  // 화면에 보이는 이름
  title: '쉼터',
  subtitle: '잠깐 걸으며 쉬어 가는 곳',

  // 쪽지 · 소원 글자 수 제한과 금지어 (금지어가 들어간 글은 등록되지 않음)
  maxTextLength: 40,
  bannedWords: [],

  // 같은 방에 함께 있을 수 있는 최대 인원. 넘으면 다른 방(?room=main-2)으로 안내합니다.
  roomCapacity: 40,

  // 여러 사람이 함께 쓰려면 Supabase 정보를 넣으세요 (README.md 참고).
  // 비워 두면 '혼자 모드'로 동작하며, 쪽지 · 소원은 이 브라우저에만 저장됩니다.
  // anonKey 에는 반드시 공개용 키(anon / publishable)만 넣으세요. service_role 키는 절대 넣지 마세요.
  supabase: {
    url: 'https://nlshasikjbccskjguykk.supabase.co',
    anonKey: 'sb_publishable_Ei0VbIgXfEEZB_xzwlGS7Q_tDhS19v4',
  },

  // 색상 테마 (해 질 녘 ~ 밤 분위기)
  theme: {
    skyTop: '#141a3a',
    skyBottom: '#c98a7a',
    fog: '#3a3558',
    ground: '#4f6b48',
    hill: '#5b7a4e',
    path: '#c9b48e',
    accent: '#ffd59a',
  },

  /*
   * 장소 목록
   * - type: hill(언덕) | greenhouse(온실) | cafe(카페) | music(음악실) | field(운동장)
   * - name, desc: 화면에 보이는 이름과 설명 (자유롭게 변경)
   * - position: [x, z] 좌표. 가운데 광장이 [0, 0] 이며, 반지름 60 안쪽을 권장합니다.
   * 필요 없는 장소는 지워도 되고, 같은 type 을 여러 개 둘 수도 있습니다.
   */
  places: [
    { id: 'hill',       type: 'hill',       name: '소나무 언덕', desc: '늘 푸른 소나무 아래에서 숨을 고르고, 응원 쪽지를 걸어 보세요.', position: [-30, -16] },
    { id: 'greenhouse', type: 'greenhouse', name: '작은 온실',   desc: '모두가 함께 물을 주면 가운데 화분이 조금씩 자라요.',          position: [30, -16] },
    { id: 'cafe',       type: 'cafe',       name: '창가 카페',   desc: '창가에 앉아 빗소리를 듣고, 누군가에게 수고했다고 말해 주세요.', position: [-28, 22] },
    { id: 'music',      type: 'music',      name: '음악실',      desc: '건반을 하나씩 눌러 보세요. 함께 있는 사람들의 소리가 섞여요.',  position: [28, 22] },
    { id: 'field',      type: 'field',      name: '별빛 운동장', desc: '잔디에 누워 별을 보고, 소원 별을 하나 띄워 보세요.',           position: [0, -46] },
  ],
};
