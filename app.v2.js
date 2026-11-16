/*
 * 쉼터 3D — v2 (현실감 개선판)
 * ------------------------------------------------------------------
 * v1 과 달라진 점
 *  1. 질감: 풀·돌·나무·회벽·기와·바위를 캔버스로 직접 그려서
 *     색(map) · 요철(normalMap) · 거칠기(roughnessMap) 3종 세트로 입힙니다. (외부 파일 0개)
 *  2. 빛: 그림자(PCF Soft)를 켜고, 하늘을 환경광(PMREM)으로 구워서 반사에 씁니다.
 *  3. 땅: 평평한 원판 대신 낮은 구릉을 만들고, 길·건물 자리만 평탄화합니다.
 *     풀포기 · 돌 · 들꽃 · 반딧불이 · 물안개를 얹어 빈 바닥을 없앴습니다.
 *  4. 사람: 캡슐 대신 머리 · 몸통 · 팔(어깨/팔꿈치) · 다리(엉덩이/무릎) · 신발을 갖춘
 *     3.5등신 캐릭터. 걷기 · 앉기 · 눕기 · 손 흔들기 · 절하기 · 눈 깜빡임이 들어갑니다.
 *  설정은 config.js 에서 바꾸세요.
 */
(async () => {
  'use strict';

  const THREE = await import('https://unpkg.com/three@0.160.0/build/three.module.js');
  const C = window.SPACE_CONFIG;

  // ------------------------------------------------------------------
  // v2 팔레트 — 밤이 아니라 '해 질 녘'. 따뜻한 빛이 힐링 느낌의 8할입니다.
  //   config.js 의 theme 대신 이 값을 씁니다. (config.js 에 themeV2 를 두면 그 값이 우선)
  // ------------------------------------------------------------------
  // 먼 풍경 — 'hills'(낮은 구릉이 있는 넓은 들판) | 'mountains'(산줄기) | 'none'(지평선만)
  //   config.js 에 horizon 을 두면 그 값이 우선합니다.
  const HORIZON = C.horizon || 'hills';

  const T = Object.assign({
    skyTop: '#4a7ec4',    // 높은 하늘 (맑은 파랑)
    skyMid: '#f2b483',    // 중간 (노을 번짐)
    skyBottom: '#ffdcae', // 지평선 (금빛)
    fog: '#e8bd9b',       // 멀어질수록 섞이는 색
    accent: '#ffc27a',    // 등불 빛
    sun: '#ffd8a8',
  }, C.themeV2 || {});

  // ------------------------------------------------------------------
  // 유틸
  // ------------------------------------------------------------------
  const $ = (s) => document.querySelector(s);
  const el = (tag, props = {}, children = []) => {
    const e = document.createElement(tag);
    Object.assign(e, props);
    for (const c of children) e.append(c);
    return e;
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function seeded(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rnd = seeded(20261112);
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

  // 값 잡음(value noise) — 텍스처와 지형을 같은 함수로 만듭니다.
  function hash2(x, y) {
    let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ 0x9e3779b9;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  const wrap = (v, p) => (p ? ((v % p) + p) % p : v);
  function noise2(x, y, px = 0, py = 0) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const h = (a, b) => hash2(wrap(a, px), wrap(b, py));
    return lerp(lerp(h(xi, yi), h(xi + 1, yi), u), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v);
  }
  function fbm(x, y, oct = 4, px = 0, py = 0) {
    let a = 0.5, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) { s += a * noise2(x * f, y * f, px * f, py * f); n += a; a *= 0.5; f *= 2; }
    return s / n;
  }

  function cleanText(raw) {
    const t = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, C.maxTextLength);
    if (!t) return null;
    const low = t.toLowerCase();
    if ((C.bannedWords || []).some((w) => w && low.includes(String(w).toLowerCase()))) return null;
    return t;
  }

  let toastTimer;
  function toast(msg, ms = 2800) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  function askText(title, placeholder) {
    return new Promise((resolve) => {
      const m = $('#modal'), inp = $('#modal-input'), cnt = $('#modal-count');
      $('#modal-title').textContent = title;
      inp.value = '';
      inp.placeholder = placeholder;
      inp.maxLength = C.maxTextLength;
      const upd = () => { cnt.textContent = `${inp.value.length} / ${C.maxTextLength}`; };
      upd();
      m.classList.add('show');
      setTimeout(() => inp.focus(), 30);
      const done = (v) => {
        m.classList.remove('show');
        $('#modal-ok').onclick = $('#modal-cancel').onclick = null;
        inp.oninput = inp.onkeydown = null;
        inp.blur();
        resolve(v);
      };
      inp.oninput = upd;
      inp.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.isComposing) done(inp.value);
        if (e.key === 'Escape') done(null);
      };
      $('#modal-ok').onclick = () => done(inp.value);
      $('#modal-cancel').onclick = () => done(null);
    });
  }

  // ------------------------------------------------------------------
  // 내 정보 (익명 별명)
  // ------------------------------------------------------------------
  const ADJ = ['조용한', '느긋한', '포근한', '반짝이는', '산책하는', '꿈꾸는', '따뜻한', '졸린', '상냥한', '씩씩한'];
  const NOUN = ['고양이', '다람쥐', '부엉이', '여우', '고래', '수달', '참새', '토끼', '펭귄', '판다'];
  const COLORS = ['#f4a7b9', '#9ad0ec', '#b8e0a8', '#ffd59a', '#c9b6f2', '#f7c59f', '#a8e6cf', '#ffb3a7'];
  const randomName = () => `${ADJ[Math.floor(Math.random() * ADJ.length)]} ${NOUN[Math.floor(Math.random() * NOUN.length)]}`;
  const HAIRS = [
    { id: 0, name: '단발' }, { id: 1, name: '짧은 머리' },
    { id: 2, name: '묶은 머리' }, { id: 3, name: '모자' },
  ];
  const HAIR_COLORS = ['#241d1a', '#4a3326', '#6b4a2f', '#8a6b4a', '#7a6f8e', '#b06a5a'];
  const me = {
    id: sessionStorage.getItem('shelter:id') || uid(),
    name: localStorage.getItem('shelter:name') || randomName(),
    color: localStorage.getItem('shelter:color') || COLORS[Math.floor(Math.random() * COLORS.length)],
  };
  // 내 모습 — 옷 색 · 머리 모양 · 머리 색
  me.look = (() => {
    try {
      const v = JSON.parse(localStorage.getItem('shelter:look') || 'null');
      if (v && v.color) return v;
    } catch (e) { /* 저장된 값이 깨졌으면 새로 만듭니다 */ }
    return {
      color: me.color,
      hair: Math.floor(Math.random() * HAIRS.length),
      hairColor: HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)],
    };
  })();
  me.color = me.look.color;
  sessionStorage.setItem('shelter:id', me.id);
  localStorage.setItem('shelter:name', me.name);
  localStorage.setItem('shelter:color', me.color);

  const params = new URLSearchParams(location.search);
  // 주소는 ?room=CODE 또는 /room/CODE 둘 다 됩니다
  const pathCode = (decodeURIComponent(location.pathname).match(/\/room\/([A-Za-z0-9가-힣-]+)/) || [])[1];
  // 방 코드 — 영문 · 숫자 · 한글 (예전엔 한글을 지워서 '가족' 같은 코드가 빈칸 → 공개 방(MAIN)이 되었음)
  const roomCode = (v) => String(v || '').replace(/[^a-zA-Z0-9가-힣-]/g, '').toUpperCase().slice(0, 12);
  const room = roomCode(params.get('room') || pathCode || 'main') || 'MAIN';

  // ------------------------------------------------------------------
  // 저장소: 혼자 모드(localStorage) / 함께 모드(Supabase)
  // ------------------------------------------------------------------
  // 큰 나무(water) 숫자는 '하루'마다 새로 셉니다 — 방 이름 뒤에 날짜를 붙인 칸에 저장 (예: MAIN#20261117).
  //   DB 의 숫자 이름은 water | cheer | happy 로 묶여 있어서, 이름 대신 방 칸을 날짜별로 나눕니다. (방 이름 최대 30자 이내)
  const today = () => { const d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); };
  const counterRoom = (name) => (name === 'water' ? `${room}#${today()}` : room);
  class LocalStore {
    constructor() { this.mode = 'local'; }
    key(k) { return `shelter:${room}:${k}`; }
    async list(kind) { return JSON.parse(localStorage.getItem(this.key(kind)) || '[]'); }
    async add(kind, text) {
      const arr = await this.list(kind);
      const item = { id: uid(), text, created_at: new Date().toISOString() };
      arr.push(item);
      localStorage.setItem(this.key(kind), JSON.stringify(arr.slice(-200)));
      return item;
    }
    async getCounter(name) { return Number(localStorage.getItem(`shelter:${counterRoom(name)}:c:${name}`) || 0); }
    async incCounter(name) {
      const v = (await this.getCounter(name)) + 1;
      localStorage.setItem(`shelter:${counterRoom(name)}:c:${name}`, String(v));
      return v;
    }
    connect() {}
    send() {}
  }

  class SupaStore {
    constructor(sb) { this.sb = sb; this.mode = 'supabase'; this.channel = null; }
    async list(kind) {
      const { data, error } = await this.sb.from('shelter_messages')
        .select('id,text,created_at').eq('room', room).eq('kind', kind)
        .order('created_at', { ascending: false }).limit(120);
      if (error) throw error;
      return (data || []).reverse();
    }
    async add(kind, text) {
      const { data, error } = await this.sb.from('shelter_messages')
        .insert({ room, kind, text }).select('id,text,created_at').single();
      if (error) throw error;
      return data;
    }
    async getCounter(name) {
      const { data, error } = await this.sb.from('shelter_counters')
        .select('value').eq('room', counterRoom(name)).eq('name', name).maybeSingle();
      if (error) throw error;
      return Number(data?.value || 0);
    }
    async incCounter(name) {
      const { data, error } = await this.sb.rpc('shelter_increment', { p_room: counterRoom(name), p_name: name });
      if (error) throw error;
      return Number(data);
    }
    connect(h) {
      const ch = this.sb.channel(`shelter:${room}`, { config: { presence: { key: me.id }, broadcast: { self: false } } });
      ch.on('presence', { event: 'sync' }, () => h.onPresence(Object.keys(ch.presenceState())))
        .on('broadcast', { event: 'move' }, ({ payload }) => h.onMove(payload))
        .on('broadcast', { event: 'act' }, ({ payload }) => h.onAct(payload))
        .on('broadcast', { event: 'chat' }, ({ payload }) => h.onChat(payload))
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'shelter_messages', filter: `room=eq.${room}` },
          (p) => h.onMessage(p.new))
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') await ch.track({ name: me.name });
        });
      this.channel = ch;
    }
    send(event, payload) {
      if (this.channel) this.channel.send({ type: 'broadcast', event, payload });
    }
    // 다른 공간(쉼터 ↔ 불멍)의 인원만 지켜봅니다 — 내 자리는 등록하지 않으므로 그쪽 인원에 세어지지 않습니다
    watchCount(name, cb) {
      const ch = this.sb.channel(name, { config: { presence: { key: 'watch-' + me.id } } });
      ch.on('presence', { event: 'sync' }, () => cb(Object.keys(ch.presenceState()).length)).subscribe();
    }
  }

  let store = new LocalStore();
  if (C.supabase && C.supabase.url && C.supabase.anonKey) {
    try {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
      store = new SupaStore(createClient(C.supabase.url, C.supabase.anonKey));
    } catch (e) {
      console.warn('Supabase 연결 실패, 혼자 모드로 전환합니다.', e);
    }
  }

  // ------------------------------------------------------------------
  // 렌더러 · 장면
  // ------------------------------------------------------------------
  const LOW = (navigator.hardwareConcurrency || 8) <= 4 || /Android|iPhone|iPad/i.test(navigator.userAgent);
  // 휴대폰 (아이폰 · 아이패드 · 안드로이드) — 화면 효과 몇 가지를 끕니다 (아래 설명)
  const TOUCH = window.matchMedia('(pointer: coarse)').matches;   // 손가락으로 쓰는 화면 — 키보드 안내 대신 터치 안내
  const PHONE = /Android|iPhone|iPad/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, LOW ? 1.3 : 1.8));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  // 휴대폰 그래픽에서는 부드러운 그림자가 바닥 · 하늘에 색 점(잔상)을 만들어 기본 그림자로
  renderer.shadowMap.type = PHONE ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  $('#app').appendChild(renderer.domElement);
  const ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // 화면 효과 — 빛 번짐(블룸). 지는 해와 등불이 공기 중에 번져 사진처럼 보입니다.
  let composer = null;
  // 휴대폰(아이폰 · 아이패드 · 안드로이드)은 빛 번짐을 끕니다 — 휴대폰 그래픽에서
  // 하늘 · 등불 주변에 색 점(잔상)이 생기고, 발열 · 배터리 소모도 큽니다.
  async function setupComposer() {
    if (PHONE) return;
    try {
      const base = 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/';
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
        import(base + 'EffectComposer.js'), import(base + 'RenderPass.js'),
        import(base + 'UnrealBloomPass.js'), import(base + 'OutputPass.js'),
      ]);
      const c = new EffectComposer(renderer);
      c.addPass(new RenderPass(scene, camera));
      const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.28, 0.6, 0.95);
      c.addPass(bloom);
      c.addPass(new OutputPass());
      c.setSize(window.innerWidth, window.innerHeight);
      composer = c;
    } catch (e) { console.warn('블룸 생략', e); }
  }

  const scene = new THREE.Scene();
  // 거리에 따라 서서히 옅어지는 안개 — 먼 산이 보일 만큼은 남겨 둡니다.
  scene.fog = new THREE.FogExp2(T.fog, 0.0026);
  // 세로 화면(휴대폰)은 시야를 넓혀 장소가 위아래로 잘리지 않게 합니다
  const fovFor = (aspect) => (aspect < 0.8 ? 62 : 48);
  const camera = new THREE.PerspectiveCamera(fovFor(window.innerWidth / window.innerHeight), window.innerWidth / window.innerHeight, 0.1, 800);

  const WIND = { value: 0 };   // 바람 — 풀과 꽃이 같은 박자로 흔들리게
  const tmpV = new THREE.Vector3();
  const matCache = new Map();
  function mat(color, opts = {}) {
    const k = color + JSON.stringify(opts);
    if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.9, envMapIntensity: 0.35, ...opts }));
    return matCache.get(k);
  }
  function mesh(geo, material, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    return m;
  }

  // ------------------------------------------------------------------
  // 질감 공장 — 캔버스에 직접 그려서 색 · 요철 · 거칠기 지도를 만듭니다.
  //   외부 이미지 파일이 없어도 "진짜 재질" 느낌이 나는 가장 싼 방법입니다.
  // ------------------------------------------------------------------
  const TS = LOW ? 128 : 256;              // 텍스처 한 변 크기
  const painters = {
    // 잔디 — 낮은 주파수 얼룩 + 높은 주파수 잔풀
    grass(d, S) {
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        const a = fbm(u * 5, v * 5, 3, 5, 5);
        const b = fbm(u * 26 + 3, v * 26 + 7, 2, 26, 26);
        const dry = smooth(0.62, 0.86, a);
        const r = 46 + a * 34 + b * 44 + dry * 48;
        const g = 78 + a * 44 + b * 56 + dry * 30;
        const bl = 42 + a * 26 + b * 30 + dry * 12;
        px(d, S, x, y, r, g, bl);
      }
    },
    // 돌판 길 — 어긋나게 쌓은 판석 + 줄눈
    stone(d, S) {
      const cols = 3, cw = S / cols;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const row = Math.floor(y / cw);
        const sx = (x + (row % 2) * cw * 0.5) % S;
        const ex = Math.min(sx % cw, cw - (sx % cw));
        const ey = Math.min(y % cw, cw - (y % cw));
        const edge = Math.min(ex, ey);
        const seam = smooth(0.5, 3.2, edge);
        const id = row * 7 + Math.floor(sx / cw) * 13;
        const tint = 0.84 + hash2(id, 3) * 0.3;
        const n = fbm(x / S * 18, y / S * 18, 3, 18, 18);
        const g = (96 + n * 58) * tint * (0.42 + seam * 0.58);
        px(d, S, x, y, g * 1.02, g, g * 0.97);
      }
    },
    // 나무 — 결 + 옹이
    wood(d, S) {
      const planks = 3, ph = S / planks;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const row = Math.floor(y / ph);
        const ey = Math.min(y % ph, ph - (y % ph));
        const seam = smooth(0.4, 2.6, ey);
        const tint = 0.82 + hash2(row, 11) * 0.34;
        const grain = fbm(x / S * 3 + row * 4, y / S * 34, 3, 3, 34);
        const line = 0.74 + 0.26 * Math.abs(Math.sin((y / S) * 52 + grain * 5));
        const k = tint * line * (0.5 + seam * 0.5) * (0.82 + grain * 0.36);
        px(d, S, x, y, 150 * k, 104 * k, 68 * k);
      }
    },
    // 회벽 — 아주 고운 요철
    plaster(d, S) {
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const a = fbm(x / S * 9, y / S * 9, 3, 9, 9);
        const b = fbm(x / S * 44, y / S * 44, 2, 44, 44);
        const k = 0.86 + a * 0.16 + b * 0.1;
        px(d, S, x, y, 232 * k, 220 * k, 199 * k);
      }
    },
    // 기와 — 반원 기와가 세로로 늘어선 모양
    roof(d, S) {
      const cols = 6, cw = S / cols, rows = 3, rh = S / rows;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const t = (x % cw) / cw;
        const round = Math.sin(t * Math.PI);
        const rowT = (y % rh) / rh;
        const step = smooth(0, 0.08, rowT) * (1 - smooth(0.93, 1, rowT));
        const n = fbm(x / S * 20, y / S * 20, 2, 20, 20);
        const k = (0.38 + round * 0.52) * (0.55 + step * 0.45) * (0.86 + n * 0.28);
        px(d, S, x, y, 78 * k, 82 * k, 96 * k);
      }
    },
    // 바위
    rock(d, S) {
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const a = fbm(x / S * 7, y / S * 7, 4, 7, 7);
        const crack = 1 - smooth(0, 0.06, Math.abs(fbm(x / S * 4 + 9, y / S * 4 + 4, 3, 4, 4) - 0.5));
        const k = (0.56 + a * 0.5) * (1 - crack * 0.32);
        px(d, S, x, y, 128 * k, 124 * k, 126 * k);
      }
    },
    // 천 (담요 · 차양)
    cloth(d, S) {
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const weave = 0.88 + 0.12 * (Math.sin(x * 1.6) * Math.sin(y * 1.6));
        const n = fbm(x / S * 16, y / S * 16, 2, 16, 16);
        const k = weave * (0.88 + n * 0.22);
        px(d, S, x, y, 240 * k, 236 * k, 232 * k);
      }
    },
    // 물결 (법선용)
    ripple(d, S) {
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const a = fbm(x / S * 8, y / S * 8, 3, 8, 8);
        const b = Math.sin((x / S) * Math.PI * 12 + a * 6) * 0.5 + 0.5;
        const k = 0.5 + a * 0.3 + b * 0.2;
        px(d, S, x, y, 200 * k, 210 * k, 225 * k);
      }
    },
  };
  function px(d, S, x, y, r, g, b) {
    const i = (y * S + x) * 4;
    d[i] = clamp(r, 0, 255); d[i + 1] = clamp(g, 0, 255); d[i + 2] = clamp(b, 0, 255); d[i + 3] = 255;
  }
  function paint(kind) {
    const c = document.createElement('canvas');
    c.width = c.height = TS;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(TS, TS);
    painters[kind](img.data, TS);
    ctx.putImageData(img, 0, 0);
    return c;
  }
  // 밝기 차이를 기울기로 바꿔 법선 지도를 만듭니다(소벨).
  function toNormal(src, strength) {
    const S = src.width;
    const sd = src.getContext('2d').getImageData(0, 0, S, S).data;
    const out = document.createElement('canvas');
    out.width = out.height = S;
    const octx = out.getContext('2d');
    const img = octx.createImageData(S, S);
    const L = (x, y) => {
      const i = ((((y % S) + S) % S) * S + (((x % S) + S) % S)) * 4;
      return (sd[i] * 0.3 + sd[i + 1] * 0.59 + sd[i + 2] * 0.11) / 255;
    };
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = (L(x + 1, y) - L(x - 1, y)) * strength;
      const dy = (L(x, y + 1) - L(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * S + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len) * 0.5 * 255 + 127;
      img.data[i + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    return out;
  }
  // 밝은 곳일수록 매끈하게 — 거칠기 지도
  function toRough(src, lo, hi) {
    const S = src.width;
    const sd = src.getContext('2d').getImageData(0, 0, S, S).data;
    const out = document.createElement('canvas');
    out.width = out.height = S;
    const octx = out.getContext('2d');
    const img = octx.createImageData(S, S);
    for (let i = 0; i < sd.length; i += 4) {
      const l = (sd[i] * 0.3 + sd[i + 1] * 0.59 + sd[i + 2] * 0.11) / 255;
      const v = (lo + (hi - lo) * (1 - l)) * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    return out;
  }
  const texBase = new Map();
  const texSets = new Map();
  const ROUGH = { grass: [0.82, 1], stone: [0.6, 0.95], wood: [0.55, 0.92], plaster: [0.7, 0.98], roof: [0.5, 0.9], rock: [0.65, 1], cloth: [0.8, 1], ripple: [0.1, 0.3] };
  const BUMP = { grass: 2.2, stone: 3.4, wood: 2.4, plaster: 1.6, roof: 3.6, rock: 3.2, cloth: 1.8, ripple: 3 };
  function texSet(kind, repeat) {
    const key = kind + ':' + repeat;
    if (texSets.has(key)) return texSets.get(key);
    if (!texBase.has(kind)) {
      const color = paint(kind);
      texBase.set(kind, { color, normal: toNormal(color, BUMP[kind]), rough: toRough(color, ROUGH[kind][0], ROUGH[kind][1]) });
    }
    const b = texBase.get(kind);
    const make = (canvas, srgb) => {
      const t = new THREE.CanvasTexture(canvas);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat, repeat);
      t.anisotropy = ANISO;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const set = { map: make(b.color, true), normalMap: make(b.normal, false), roughnessMap: make(b.rough, false) };
    texSets.set(key, set);
    return set;
  }
  function matT(kind, { repeat = 2, color = '#ffffff', normalScale = 1, ...rest } = {}) {
    const key = 'T|' + kind + '|' + repeat + '|' + color + '|' + normalScale + '|' + JSON.stringify(rest);
    if (matCache.has(key)) return matCache.get(key);
    const m = new THREE.MeshStandardMaterial({ color, envMapIntensity: 0.4, ...texSet(kind, repeat), ...rest });
    m.normalScale = new THREE.Vector2(normalScale, normalScale);
    matCache.set(key, m);
    return m;
  }

  function makeLabel(text, { size = 40, color = '#fff', bg = 'rgba(16,18,34,.56)', scale = 1 } = {}) {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    const font = `700 ${size}px "Pretendard","Apple SD Gothic Neo","Malgun Gothic",sans-serif`;
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + size * 1.3;
    const h = Math.ceil(size * 1.8);
    c.width = w; c.height = h;
    ctx.font = font;
    ctx.fillStyle = bg;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(0, 0, w, h, h / 2); else ctx.rect(0, 0, w, h);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.14)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.userData.own = true;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, fog: false }));
    sp.renderOrder = 10;
    const k = 0.011 * scale;
    sp.scale.set(w * k, h * k, 1);
    return sp;
  }

  const glowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,236,190,.9)');
    grd.addColorStop(1, 'rgba(255,220,150,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const softTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,.5)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();

  // 다 쓴 3D 물체 정리 — 장면에서 빼도 그래픽 메모리(지오메트리 · 텍스처 · 재질)에는 남아 쌓입니다.
  //   여럿이 오래 있으면 말풍선 · 이모지 · 나간 사람 캐릭터가 계속 쌓여 점점 버벅였습니다 (8명 45초에 텍스처 2배).
  //   공용으로 쓰는 것(mat() 캐시 재질 · glowTex 같은 공용 텍스처 · 스프라이트 공용 판 · shared 표시한 지오메트리)은 남깁니다.
  function disposeObj(root) {
    if (!root) return;
    const shared = new Set(matCache.values());
    root.traverse((o) => {
      if (o.geometry && !o.isSprite && !o.geometry.userData.shared) o.geometry.dispose();
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of ms) {
        if (shared.has(m)) continue;
        if (m.map && m.map.userData.own) m.map.dispose();
        m.dispose();
      }
    });
  }
  function emojiSprite(emoji, size = 1) {
    // 아이폰 이모지는 글꼴보다 크게 그려져 작은 캔버스에선 가장자리가 잘립니다 → 넉넉한 여백
    const c = document.createElement('canvas');
    c.width = c.height = 160;
    const g = c.getContext('2d');
    g.font = '96px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(emoji, 80, 86);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.userData.own = true;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, fog: false }));
    sp.renderOrder = 11;
    sp.scale.set(size * 1.25, size * 1.25, 1);   // 여백만큼 키워 보이는 크기는 예전과 같게
    return sp;
  }

  // ------------------------------------------------------------------
  // 하늘 · 빛
  // ------------------------------------------------------------------
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(T.skyTop) },
      bottom: { value: new THREE.Color(T.skyBottom) },
      mid: { value: new THREE.Color(T.skyMid) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 top; uniform vec3 bottom; uniform vec3 mid; varying vec3 vP;
      void main(){
        float h = clamp(vP.y * 1.5 + 0.12, 0.0, 1.0);
        vec3 c = mix(bottom, mid, smoothstep(0.0, 0.34, h));
        c = mix(c, top, smoothstep(0.26, 0.92, h));
        // 해가 지는 쪽(-x, -z)에 금빛이 번집니다
        vec3 sunDir = normalize(vec3(-0.6, 0.12, -0.5));
        float d = max(0.0, dot(normalize(vP), sunDir));
        c += vec3(0.42, 0.24, 0.08) * pow(d, 6.0);
        c += vec3(0.30, 0.17, 0.06) * pow(max(0.0, 1.0 - abs(vP.y) * 3.2), 2.2);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(460, 32, 18), skyMat);
  scene.add(sky);

  // 하늘을 환경광으로 구워 두면 모든 재질의 반사가 자연스러워집니다.
  if (!PHONE) try {   // 휴대폰은 생략 — 일부 휴대폰에서 이 텍스처가 깨져 온 화면에 색 점(잔상)이 생겼습니다
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 24, 14), skyMat.clone()));
    scene.environment = pmrem.fromScene(envScene, 0.1).texture;
    pmrem.dispose();
  } catch (e) { console.warn('환경광 생성 생략', e); }

  // ------------------------------------------------------------------
  // 하늘에 뜨는 것들 — 해 질 녘에는 해와 구름, 누우면 별 · 별자리 · 오로라
  // ------------------------------------------------------------------
  const night = { mix: 0, stars: null, sun: null, halo: null, clouds: [], dipper: null, shoot: [] };
  {
    // 별 — 하늘 전체(구 표면)에 '고르게' 뿌립니다. 높이(y)를 균일하게 뽑으면 같은 넓이에 같은 수가 들어갑니다.
    //   (예전엔 천정 쪽 약 25° 를 빼고 뿌려서, 누워 올려다보면 가운데에 둥근 구멍이 보였음)
    //   크기 · 색 · 반짝이는 박자가 저마다 다르고, 은은하게 깜빡입니다. (불멍 캠프의 하늘과 같은 방식)
    const n = LOW ? 2200 : 4000;
    const pos = new Float32Array(n * 3), size = new Float32Array(n), phase = new Float32Array(n), col = new Float32Array(n * 3);
    for (let i2 = 0; i2 < n; i2++) {
      const y = -0.08 + rnd() * 1.08, th = rnd() * Math.PI * 2, rr = Math.sqrt(1 - y * y), r = 380;
      pos[i2 * 3] = r * rr * Math.cos(th);
      pos[i2 * 3 + 1] = r * y;
      pos[i2 * 3 + 2] = r * rr * Math.sin(th);
      const big = rnd();
      size[i2] = big > 0.988 ? 4.2 + rnd() * 2 : big > 0.92 ? 2.4 + rnd() * 1.3 : 1.1 + rnd() * 1.2;
      phase[i2] = rnd();
      const tint = rnd();
      const c3 = tint < 0.15 ? [1, 0.82, 0.66] : tint < 0.35 ? [0.75, 0.85, 1] : [1, 0.97, 0.92];
      col.set(c3, i2 * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    night.stars = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPR: { value: renderer.getPixelRatio() }, uShow: { value: 0 } },
      vertexShader: `
        attribute float aSize; attribute float aPhase; attribute vec3 aColor;
        uniform float uTime; uniform float uPR; varying vec3 vC; varying float vA;
        void main(){
          vC = aColor;
          vA = 0.62 + 0.38 * sin(uTime * (0.8 + aPhase * 1.7) + aPhase * 40.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uPR;
        }`,
      fragmentShader: `
        varying vec3 vC; varying float vA; uniform float uShow;
        void main(){
          float r = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, r); a *= a;
          gl_FragColor = vec4(vC * a * vA * uShow * 1.5, 1.0);
        }`,
    }));
    night.stars.frustumCulled = false;
    scene.add(night.stars);

    night.sun = mesh(new THREE.SphereGeometry(13, 24, 16), new THREE.MeshBasicMaterial({ color: 0xfff0cd, fog: false, transparent: true }), -230, 42, -190);
    scene.add(night.sun);
    night.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: '#ffd59a', transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, opacity: 0.9 }));
    night.halo.position.copy(night.sun.position);
    night.halo.scale.setScalar(260);
    scene.add(night.halo);
    for (let i2 = 0; i2 < 14; i2++) {
      const a = rnd() * Math.PI * 2, r = 230 + rnd() * 120;
      const cl = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: i2 % 3 ? '#ffc79a' : '#f5d9c4', transparent: true, opacity: 0.16 + rnd() * 0.14, depthWrite: false, fog: false }));
      cl.position.set(Math.cos(a) * r, 45 + rnd() * 70, Math.sin(a) * r);
      cl.scale.set(150 + rnd() * 120, 26 + rnd() * 20, 1);
      cl.userData.base = cl.material.opacity;
      scene.add(cl);
      night.clouds.push(cl);
    }

    // 별자리 — 하늘 곳곳에. 드래그해서 둘러보면 다른 별자리가 나옵니다.
    const CONSTELLATIONS = [
      {
        name: '북두칠성', dir: [-0.62, 0.6, -0.5], spread: 0.105, bright: [0, 6],
        pts: [[0, 1], [0.12, 0.54], [0.6, 0.44], [0.66, 0.8], [1.12, 0.96], [1.58, 1.04], [2.0, 0.82]],
        links: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6]],
      },
      {
        name: '카시오페이아', dir: [0.72, 0.56, -0.41], spread: 0.1, bright: [2],
        pts: [[0, 0.55], [0.5, 1.0], [1.0, 0.5], [1.5, 1.0], [2.0, 0.6]],
        links: [[0, 1], [1, 2], [2, 3], [3, 4]],
      },
      {
        name: '오리온', dir: [0.2, 0.42, 0.88], spread: 0.1, bright: [0, 6],
        pts: [[0.15, 1.6], [1.15, 1.7], [0.5, 0.95], [0.8, 0.9], [1.1, 0.85], [0.35, 0.15], [1.35, 0.2]],
        links: [[0, 1], [0, 2], [1, 4], [2, 3], [3, 4], [2, 5], [4, 6], [5, 6]],
      },
      {
        name: '백조자리', dir: [-0.78, 0.5, 0.36], spread: 0.1, bright: [0],
        pts: [[1.0, 1.7], [1.0, 1.0], [1.0, 0.2], [0.25, 1.05], [1.75, 1.0]],
        links: [[0, 1], [1, 2], [3, 1], [1, 4]],
      },
      {
        name: '전갈자리', dir: [0.85, 0.32, 0.4], spread: 0.09, bright: [1],
        pts: [[0.1, 1.5], [0.5, 1.2], [0.85, 0.95], [1.1, 0.6], [1.35, 0.3], [1.75, 0.22], [2.05, 0.45], [2.0, 0.8]],
        links: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7]],
      },
    ];
    const dip = new THREE.Group();
    const haloMat = new THREE.SpriteMaterial({ map: glowTex, color: '#9fc4ff', transparent: true, opacity: 0.22, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
    const coreMat = new THREE.SpriteMaterial({ map: glowTex, color: '#ffffff', transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
    const lineMat2 = new THREE.LineBasicMaterial({ color: '#6f8fc8', transparent: true, opacity: 0.2, fog: false });
    for (const C2 of CONSTELLATIONS) {
      const base = new THREE.Vector3(C2.dir[0], C2.dir[1], C2.dir[2]).normalize();
      const right = new THREE.Vector3().crossVectors(base, new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3().crossVectors(right, base).normalize();
      const pts = C2.pts.map(([u, v]) => base.clone()
        .addScaledVector(right, (u - 1) * C2.spread).addScaledVector(up, (v - 0.9) * C2.spread)
        .normalize().multiplyScalar(360));
      pts.forEach((pt, i3) => {
        const big = C2.bright.includes(i3) ? 1.3 : 1;
        const h2 = new THREE.Sprite(haloMat);
        h2.position.copy(pt);
        h2.scale.setScalar(3.6 * big);
        dip.add(h2);
        const core = new THREE.Sprite(coreMat);
        core.position.copy(pt);
        core.scale.setScalar(1.9 * big);
        dip.add(core);
      });
      const linePos = [];
      for (const [a2, b2] of C2.links) linePos.push(pts[a2].x, pts[a2].y, pts[a2].z, pts[b2].x, pts[b2].y, pts[b2].z);
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
      dip.add(new THREE.LineSegments(lg, lineMat2));
      // 이름표 — 별자리 아래쪽에 작게
      const lb2 = makeLabel(C2.name, { size: 30, scale: 0.9, bg: 'rgba(10,14,30,.35)' });
      const c0 = new THREE.Vector3();
      for (const pt of pts) c0.add(pt);
      c0.divideScalar(pts.length).normalize().multiplyScalar(352);
      lb2.position.copy(c0).addScaledVector(up, -C2.spread * 150);
      lb2.scale.multiplyScalar(26);
      lb2.material.opacity = 0.5;
      dip.add(lb2);
    }
    dip.visible = false;
    scene.add(dip);
    night.dipper = dip;

  }

  // 해 질 녘 빛 — 키 라이트는 따뜻한 금빛, 하늘빛은 부드러운 파랑, 땅반사는 풀빛.
  scene.add(new THREE.HemisphereLight(0xbfd6ff, 0x6a7a44, 1.15));
  scene.add(new THREE.AmbientLight(0xffd9b8, 0.55));
  const moonLight = new THREE.DirectionalLight(0xffd4a0, 2.1);
  const SUN_OFF = new THREE.Vector3(-46, 36, -38);
  moonLight.position.copy(SUN_OFF);
  moonLight.castShadow = true;
  moonLight.shadow.mapSize.set(LOW ? 1024 : 2048, LOW ? 1024 : 2048);
  moonLight.shadow.camera.near = 1;
  moonLight.shadow.camera.far = 160;
  moonLight.shadow.camera.left = -30;
  moonLight.shadow.camera.right = 30;
  moonLight.shadow.camera.top = 30;
  moonLight.shadow.camera.bottom = -30;
  moonLight.shadow.bias = PHONE ? -0.0015 : -0.0006;
  moonLight.shadow.normalBias = PHONE ? 0.08 : 0.035;
  moonLight.shadow.radius = 2.5;
  scene.add(moonLight);
  scene.add(moonLight.target);

  // ------------------------------------------------------------------
  // 누우면 밤이 됩니다 — 하늘 · 별 · 빛을 함께 바꿉니다.
  const DAY = { top: new THREE.Color(T.skyTop), mid: new THREE.Color(T.skyMid), bot: new THREE.Color(T.skyBottom), fog: new THREE.Color(T.fog) };
  const NGT = { top: new THREE.Color('#141f4a'), mid: new THREE.Color('#1b2a55'), bot: new THREE.Color('#324066'), fog: new THREE.Color('#223056') };
  const hemi = scene.children.find((o) => o.isHemisphereLight);
  const amb = scene.children.find((o) => o.isAmbientLight);
  function applyNight(m) {
    skyMat.uniforms.top.value.copy(DAY.top).lerp(NGT.top, m);
    skyMat.uniforms.mid.value.copy(DAY.mid).lerp(NGT.mid, m);
    skyMat.uniforms.bottom.value.copy(DAY.bot).lerp(NGT.bot, m);
    scene.fog.color.copy(DAY.fog).lerp(NGT.fog, m);
    night.stars.material.uniforms.uShow.value = m < 0.05 ? 0 : m;   // 낮(노을)에는 별을 숨깁니다 — 하늘에 점처럼 보였음
    night.stars.visible = m >= 0.05;
    night.sun.material.opacity = 1 - m;
    night.halo.material.opacity = 0.9 * (1 - m);
    for (const cl of night.clouds) cl.material.opacity = cl.userData.base * (1 - m * 0.75);
    night.dipper.visible = m > 0.25;
    moonLight.intensity = 2.1 * (1 - m) + 0.5 * m;
    moonLight.color.setHex(0xffd4a0).lerp(new THREE.Color(0xbcd0ff), m);
    if (hemi) hemi.intensity = (1.15 * (1 - m) + 0.35 * m) * (PHONE ? 1.35 : 1);   // 휴대폰은 환경광이 없어 조금 더 밝게
    if (amb) amb.intensity = 0.55 * (1 - m) + 0.25 * m;
    renderer.toneMappingExposure = 1.0 - m * 0.18;
  }
  // 별똥별 — 밤에만 가끔 길게 흐릅니다
  let shootTimer = 4;
  function shootingStar() {
    const g2 = new THREE.PlaneGeometry(1.6, 42);
    const m2 = new THREE.MeshBasicMaterial({ map: softTex, color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const sh = new THREE.Mesh(g2, m2);
    const a2 = rnd() * Math.PI * 2;
    sh.position.set(Math.cos(a2) * 230, 190 + rnd() * 80, Math.sin(a2) * 230);
    const dir = new THREE.Vector3(-Math.cos(a2) * 0.6 + (rnd() - 0.5), -0.55, -Math.sin(a2) * 0.6 + (rnd() - 0.5)).normalize();
    sh.lookAt(sh.position.clone().add(dir));
    sh.rotateX(Math.PI / 2);
    scene.add(sh);
    night.shoot.push({ m: sh, dir, t: 0 });
  }

  // 땅 — 낮은 구릉 + 평탄화(길 · 건물 자리)
  // ------------------------------------------------------------------
  const places = C.places.map((p) => ({ ...p, x: p.position[0], z: p.position[1], radius: p.radius || 12, state: {} }));
  // 광장도 하나의 장소로 — 연못가에서 할 수 있는 일이 생깁니다
  places.push({
    id: 'petcafe', type: 'petcafe', name: '멍냥 쉼터', desc: '강아지와 고양이에게 간식을 주고 쓰다듬어 보세요.',
    x: 0, z: 34, radius: 10, state: {},
  });
  // 냇가 건너 정자 (냇물 위치는 아래 STREAM_Z 와 같은 식: x=0 에서 72 + 6·sin1.3)
  places.push({
    id: 'pavilion', type: 'pavilion', name: '냇가 정자', desc: '물소리를 들으며 눈을 감고 명상해 보세요. 숨을 따라 풍경이 울려요.',
    x: 6, z: 72 + Math.sin(1.3) * 6 + 24, radius: 6, labelY: 7.6, noFlat: true, state: {},
  });
  places.push({
    id: 'hall', type: 'hall', name: '이야기 마당', desc: '모닥불 둘레에 둥글게 앉아 서로 이야기를 나눠요.',
    x: -46, z: 2, radius: 9, state: {},
  });
  places.push({
    id: 'plaza', type: 'plaza', name: C.title, desc: '연못을 둘러싼 벤치에 앉아 물소리를 들어 보세요.',
    x: 0, z: 0, radius: 7.6, labelY: 3.6, state: {},
  });
  const flatZones = [{ x: 0, z: 0, r: 9, soft: 7 }];
  for (const p of places) {
    if (p.type === 'plaza') continue;
    if (p.noFlat) {
      flatZones.push({ x: p.x, z: p.z, r: 6.5, soft: 5 });
      // 다리 북쪽 끝 → 정자 길 (나무 · 바위가 길을 막지 않게). 냇물 위치: x=0 에서 72 + 6·sin1.3
      const bzN = 72 + Math.sin(1.3) * 6 + 9.6;
      flatZones.push({ ax: 0, az: bzN, bx: p.x, bz: p.z, r: 2.4, soft: 3 });
      continue;
    }   // 정자 — 자리만 고르고, 냇물을 가로지르는 길은 내지 않습니다 (나무 · 풀도 이 안엔 안 자람)
    flatZones.push({ x: p.x, z: p.z, r: (p.radius || 12) * 0.95, soft: 9 });
    flatZones.push({ ax: 0, az: 0, bx: p.x, bz: p.z, r: 2.6, soft: 4.5 }); // 길
  }
  function distToZone(z0, x, z) {
    if (z0.bx === undefined) return Math.hypot(x - z0.x, z - z0.z);
    const dx = z0.bx - z0.ax, dz = z0.bz - z0.az;
    const t = clamp(((x - z0.ax) * dx + (z - z0.az) * dz) / (dx * dx + dz * dz), 0, 1);
    return Math.hypot(x - (z0.ax + dx * t), z - (z0.az + dz * t));
  }
  function flatness(x, z) {
    let f = 1;
    for (const z0 of flatZones) f = Math.min(f, smooth(z0.r, z0.r + z0.soft, distToZone(z0, x, z)));
    return f;
  }
  // 냇가 — 북쪽으로 걸어가면 나오는 시내. 지형을 따라 골을 파 둡니다.
  const STREAM_Z = (x) => 72 + x * 0.09 + Math.sin(x * 0.028) * 10 + Math.sin(x * 0.011 + 1.3) * 6;
  const BRIDGE_X = 0;
  const viewBlockers = [];   // 앞모습 시점 고를 때만 피하는 가는 기둥
  // 나무다리 위 (풀 · 꽃 · 낙엽을 심지 않을 곳)
  const onBridge = (x, z) => Math.abs(x - BRIDGE_X) < 2.4 && Math.abs(z - STREAM_Z(BRIDGE_X)) < 10.5;
  function streamDist(x, z) { return Math.abs(z - STREAM_Z(x)); }
  function terrainY(x, z) {
    const base = (fbm(x * 0.0125 + 3, z * 0.0125 + 7, 3) - 0.5) * 4.6
      + (fbm(x * 0.052 + 11, z * 0.052 + 2, 2) - 0.5) * 0.85;
    const rim = Math.max(0, Math.hypot(x, z) - 96) ** 1.2 * 0.03; // 바깥은 완만히 솟아 먼 산과 이어짐
    const trench = smooth(16, 2.5, streamDist(x, z)) * 1.7;        // 냇가 골짜기
    return base * flatness(x, z) + rim - trench;
  }

  const mounds = [], pads = [];
  function groundY(x, z) {
    let y = terrainY(x, z);
    for (const m of mounds) {
      const d = Math.hypot(x - m.x, z - m.z);
      // 반구는 밑동이 수직으로 끊겨 경계가 드러납니다. 바닥에서 기울기가 0이 되는 곡선을 씁니다.
      if (d < m.r) y = Math.max(y, m.h * (0.5 + 0.5 * Math.cos(Math.PI * d / m.r)));
    }
    for (const p of pads) if (Math.hypot(x - p.x, z - p.z) < p.r) y = Math.max(y, p.h);
    return y;
  }
  // 사람이 설 높이 — 땅 높이에 살짝 띄워 발이 땅에 묻히지 않게 합니다.
  const standY = (x, z) => groundY(x, z) + 0.05;

  // ------------------------------------------------------------------
  // 못 지나가는 곳 — 피아노 · 화분 · 건물처럼 몸이 묻히면 안 되는 물체
  //   원 하나로 막습니다. 안으로 들어오면 가장 가까운 테두리로 밀어냅니다.
  // ------------------------------------------------------------------
  const blockers = [];   // {x,z,r} 원  또는  {x,z,hw,hd,c,s} 회전한 상자
  function pushOut(pos, maxStep = 0.35) {
    for (let iter = 0; iter < 3; iter++) {
      let cx = 0, cz = 0, hits = 0;
      for (const b of blockers) {
        const dx = pos.x - b.x, dz = pos.z - b.z;
        if (b.hw !== undefined) {
          const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
          if (Math.abs(lx) >= b.hw || Math.abs(lz) >= b.hd) continue;
          const px = b.hw - Math.abs(lx), pz = b.hd - Math.abs(lz);
          let nlx = lx, nlz = lz;
          if (px < pz) nlx = (lx < 0 ? -1 : 1) * b.hw; else nlz = (lz < 0 ? -1 : 1) * b.hd;
          cx += (b.x + nlx * b.c + nlz * b.s) - pos.x;
          cz += (b.z - nlx * b.s + nlz * b.c) - pos.z;
          hits++;
        } else {
          const d = Math.hypot(dx, dz);
          if (d >= b.r) continue;
          const ux = d > 1e-3 ? dx / d : 1, uz = d > 1e-3 ? dz / d : 0;
          cx += (b.x + ux * b.r) - pos.x;
          cz += (b.z + uz * b.r) - pos.z;
          hits++;
        }
      }
      if (!hits) break;
      const ml = Math.hypot(cx, cz);
      if (ml < 1e-4) break;
      const k = ml > maxStep ? maxStep / ml : 1;
      pos.x += cx * k;
      pos.z += cz * k;
    }
  }
  // 나무 · 기둥처럼 '세워진 것'은 심을 때 바로 등록합니다
  function blockHere(x, z, r) { blockers.push({ x, z, r }); }

  const groundMeshes = [];
  {
    const SEG = LOW ? 110 : 170, SIZE = 330;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = -pos.getY(i);
      pos.setZ(i, terrainY(x, z));
    }
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, matT('grass', { repeat: 83, color: '#c2cfa9', normalScale: 1.0 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    groundMeshes.push(ground);
  }

  // ------------------------------------------------------------------
  // 먼 산 — 능선 잡음을 여러 겹 쌓고, 비탈의 '기울기'에 따라 숲 · 바위 · 눈을 칠합니다.
  //   (기울기를 쓰면 가파른 면은 바위, 완만한 면은 숲이 되어 진짜 산처럼 보입니다)
  // ------------------------------------------------------------------
  {
    const RINGS = LOW ? 90 : 150, SEGS = LOW ? 170 : 260, r0 = 150, r1 = 520;
    const forest = new THREE.Color('#3c6338'), dry = new THREE.Color('#7d8a57');
    const rockC = new THREE.Color('#7d7266'), snow = new THREE.Color('#eceade'), autumn = new THREE.Color('#9d6334');
    const c = new THREE.Color(), haze = new THREE.Color();
    const sunSide = new THREE.Color('#f0c49c'), shadeSide = new THREE.Color('#8b9ec4');
    // 능선 잡음 — |2n-1| 을 뒤집어 날을 세우고, 위 옥타브가 큰 곳에만 세부를 얹습니다.
    function ridged(x, z) {
      let a = 1, f = 0.0042, sum = 0, norm = 0, prev = 1;
      for (let o = 0; o < 5; o++) {
        let n = 1 - Math.abs(noise2(x * f + 13, z * f + 7) * 2 - 1);
        n = n * n * prev;
        prev = clamp(n * 1.5, 0, 1);
        sum += n * a;
        norm += a;
        a *= 0.5;
        f *= 2.2;
      }
      return sum / norm;
    }
    const AMP = HORIZON === 'hills' ? 0.2 : 1;   // 들판 모드에서는 능선 높이를 1/5 로
    function heightAt(x, z) {
      const rr = Math.hypot(x, z);
      const amp = smooth(r0, r0 + 42, rr) * (62 + 165 * clamp((rr - r0) / (r1 - r0), 0, 1) ** 0.7) * AMP;
      return ridged(x, z) ** (HORIZON === 'hills' ? 1.05 : 1.45) * amp;
    }
    const pos = [], col = [], idx = [];
    for (let i2 = 0; i2 <= RINGS; i2++) {
      const u = i2 / RINGS, r = r0 + (r1 - r0) * u ** 1.2;
      for (let j2 = 0; j2 <= SEGS; j2++) {
        const a = (j2 / SEGS) * Math.PI * 2;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const rr0 = Math.hypot(x, z);
        const hh = heightAt(x, z);
        pos.push(x, hh, z);
        const d = 5;
        const slope = clamp(Math.hypot(heightAt(x + d, z) - hh, heightAt(x, z + d) - hh) / d * 1.25, 0, 1);
        const t = clamp(hh / 165, 0, 1);
        c.copy(forest).lerp(dry, t * 0.75);
        c.lerp(rockC, slope * 0.85);                                   // 가파른 면은 바위
        c.lerp(autumn, clamp((noise2(x * 0.02, z * 0.02) - 0.55) * 2.2, 0, 1) * (1 - t) * 0.45);
        if (HORIZON === 'mountains') c.lerp(snow, clamp((t - 0.66) * 3.4, 0, 1) * (1 - slope * 0.55));
        // 해가 드는 쪽은 따뜻하게, 그늘진 쪽은 푸르게
        const sun = clamp((-x - z) / (r * 1.5) + 0.5, 0, 1);
        const lit = 0.66 + 0.46 * sun;
        c.multiplyScalar(lit);
        c.lerp(sunSide, sun * 0.18);
        c.lerp(shadeSide, (1 - sun) * 0.22);
        // 멀수록 공기에 묻힙니다 (대기 원근)
        const hz = clamp((rr0 - r0) / 260, 0, 1) ** 0.85;
        haze.copy(sunSide).lerp(shadeSide, 1 - sun);
        c.lerp(haze, hz * 0.72);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let i2 = 0; i2 < RINGS; i2++) for (let j2 = 0; j2 < SEGS; j2++) {
      const a0 = i2 * (SEGS + 1) + j2, b0 = a0 + SEGS + 1;
      idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const far = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.1, fog: false,
    }));
    // 산자락 숲 — 멀리서 보이는 나무 띠 (맨 땅처럼 보이지 않게)
    {
      // 멀리서도 '나무'로 보이도록 줄기를 붙여 하나로 굽습니다
      const canopy = new THREE.IcosahedronGeometry(1, 1);
      canopy.scale(1, 1.3, 1);
      const trunkG = new THREE.CylinderGeometry(0.13, 0.19, 1.5, 6);
      const cone = mergeGeos([
        { geo: trunkG, matrix: new THREE.Matrix4().makeTranslation(0, 0.75, 0), color: '#5e4636' },
        { geo: canopy, matrix: new THREE.Matrix4().makeTranslation(0, 2.25, 0) },
      ]);
      trunkG.dispose();
      canopy.dispose();
      cone.setAttribute('color', new THREE.Float32BufferAttribute(new Array(cone.attributes.position.count * 3).fill(1), 3));
      const fm = new THREE.MeshStandardMaterial({ roughness: 1, vertexColors: true, envMapIntensity: 0.2, flatShading: true });
      const N = LOW ? 700 : 2200;
      const im3 = new THREE.InstancedMesh(cone, fm, N);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), col = new THREE.Color();
      const GREENS = ['#2f5234', '#3a6038', '#476b3c', '#5b6e3a'];
      for (let i3 = 0; i3 < N; i3++) {
        const a2 = rnd() * Math.PI * 2;
        const rr2 = 122 + rnd() ** 0.7 * 110;
        const x2 = Math.cos(a2) * rr2, z2 = Math.sin(a2) * rr2;
        const hy = rr2 > 150 ? heightAt(x2, z2) - 3 : terrainY(x2, z2);
        const sc = (HORIZON === 'hills' ? 1.3 : 1.7) + rnd() * (HORIZON === 'hills' ? 1.5 : 2.4);
        v3.set(x2, hy, z2);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6);
        s3.set(sc * (0.7 + rnd() * 0.5), sc * (1.2 + rnd() * 0.8), sc * (0.7 + rnd() * 0.5));
        im3.setMatrixAt(i3, m4.compose(v3, q, s3));
        col.set(GREENS[Math.floor(rnd() * GREENS.length)]).offsetHSL(0, 0, (rnd() - 0.5) * 0.08);
        im3.setColorAt(i3, col);
      }
      if (im3.instanceColor) im3.instanceColor.needsUpdate = true;
      im3.userData.noShadow = true;
      im3.frustumCulled = false;
      scene.add(im3);
    }
    far.userData.noShadow = true;
    far.position.y = -3;
    if (HORIZON !== 'none') scene.add(far);
  }

  // ------------------------------------------------------------------
  // 소품 (나무 · 벤치 · 석등 · 바위)
  // ------------------------------------------------------------------
  const PINE = [[1.75, 2.4, 2.3], [1.35, 2.0, 3.45], [0.92, 1.7, 4.5]];
  function pineTree(s = 1, seed = 0) {
    const r2 = seeded(hashStr('pine' + seed + s.toFixed(2)));
    const g = new THREE.Group();
    const barkM = matT('wood', { repeat: 1.7, color: '#6b503c' });
    // 줄기 — 잎보다 아래가 비어 있어야 '나무'로 보입니다
    for (let k = 0; k < 3; k++) {
      const seg = mesh(new THREE.CylinderGeometry(0.2 - k * 0.042, 0.27 - k * 0.042, 1.15, 8), barkM, 0, 0.55 + k * 1.05, 0);
      seg.rotation.z = (r2() - 0.5) * 0.09;
      g.add(seg);
    }
    // 가지 몇 개
    for (let k = 0; k < 3; k++) {
      const a = r2() * Math.PI * 2;
      const br = mesh(new THREE.CylinderGeometry(0.04, 0.085, 1.1, 6), barkM, Math.cos(a) * 0.35, 2.3 + r2() * 0.7, Math.sin(a) * 0.35);
      br.rotation.set(Math.sin(a) * 1.0, 0, -Math.cos(a) * 1.0);
      g.add(br);
    }
    // 잎 뭉치 — 위로 갈수록 작아져 침엽수 실루엣이 됩니다
    const base = new THREE.Color(r2() < 0.5 ? '#3f6e45' : '#355f3a');
    const tex = texSet('grass', 0.45);
    const CL = [[1.5, 3.25, 0.95], [1.25, 4.05, 0.72], [0.95, 4.75, 0.5], [0.62, 5.3, 0.3]];
    for (const [rr, yy, spread] of CL) {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + r2() * 2;
        const c = base.clone().offsetHSL((r2() - 0.5) * 0.03, (r2() - 0.5) * 0.1, (r2() - 0.5) * 0.12);
        const m = new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true, map: tex.map, envMapIntensity: 0.18 });
        const blob = mesh(new THREE.IcosahedronGeometry(rr * (0.62 + r2() * 0.3), 1), m,
          Math.cos(a) * spread, yy + (r2() - 0.5) * 0.3, Math.sin(a) * spread);
        blob.scale.set(1, 0.92, 1);
        blob.rotation.set(r2(), r2() * 6, r2());
        g.add(blob);
      }
    }
    g.scale.setScalar(s);
    return g;
  }
  function pineRadiusAt(y) {
    // 잎 뭉치가 있는 높이(3.2~5.2)에서는 바깥쪽, 그 아래는 줄기 가까이
    if (y > 3.1 && y < 5.3) return 1.25 - (y - 3.1) * 0.22;
    return 0.33;
  }
  // 여러 도형을 하나로 합치기 — 꽃 한 송이처럼 조각이 많을 때 인스턴스 하나로 묶습니다.
  function mergeGeos(list) {
    const pos = [], norm = [], uv = [], idx = [], col = [];
    let off = 0;
    for (const { geo, matrix, color } of list) {
      const g = geo.clone().applyMatrix4(matrix);
      const pa = g.attributes.position.array, na = g.attributes.normal.array;
      const ua = g.attributes.uv ? g.attributes.uv.array : null;
      for (let i = 0; i < pa.length; i++) pos.push(pa[i]);
      for (let i = 0; i < na.length; i++) norm.push(na[i]);
      const vCount = pa.length / 3;
      for (let i = 0; i < vCount * 2; i++) uv.push(ua ? ua[i] : 0);
      const cc = color ? new THREE.Color(color) : null;
      for (let i = 0; i < vCount; i++) col.push(cc ? cc.r : 1, cc ? cc.g : 1, cc ? cc.b : 1);
      if (g.index) for (const v of g.index.array) idx.push(v + off);
      else for (let i = 0; i < vCount; i++) idx.push(i + off);
      off += vCount;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
    out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    out.setIndex(idx);
    return out;
  }
  // 꽃 한 송이 — 꽃잎을 거의 눕혀야 위에서 봤을 때 '꽃'으로 보입니다.
  //   세워 두면 벌레 다리처럼 보입니다.
  const blossomGeo = (() => {
    const list = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const petal = new THREE.SphereGeometry(0.1, 16, 12);
    for (let i2 = 0; i2 < 5; i2++) {
      const a = (i2 / 5) * Math.PI * 2;
      // 꽃잎은 바깥쪽을 향하되 45도쯤 세웁니다 (납작하게 눕히면 프로펠러처럼 보입니다)
      m.compose(new THREE.Vector3(Math.cos(a) * 0.1, 0.25, Math.sin(a) * 0.1),
        q.setFromEuler(e.set(-0.72, Math.PI / 2 - a, 0, 'YXZ')), new THREE.Vector3(0.74, 0.3, 1.05));
      list.push({ geo: petal, matrix: m.clone() });
    }
    // 꽃술 — 노란 가운데가 있어야 꽃으로 읽힙니다
    list.push({ geo: new THREE.SphereGeometry(0.058, 14, 10), color: '#ffd978',
      matrix: new THREE.Matrix4().makeScale(1, 0.78, 1).setPosition(0, 0.285, 0) });
    // 줄기와 잎
    list.push({ geo: new THREE.CylinderGeometry(0.013, 0.017, 0.26, 5), color: '#6f9b4e',
      matrix: new THREE.Matrix4().makeTranslation(0, 0.13, 0) });
    for (const sg of [-1, 1]) {
      m.compose(new THREE.Vector3(sg * 0.07, 0.06, 0), q.setFromEuler(e.set(0, sg > 0 ? 0 : Math.PI, 1.15, 'YXZ')), new THREE.Vector3(1, 1, 1));
      list.push({ geo: new THREE.SphereGeometry(0.055, 8, 6).scale(1.6, 0.18, 0.7), color: '#6f9b4e', matrix: m.clone() });
    }
    const g = mergeGeos(list);
    petal.dispose();
    return g;
  })();

  // 활엽수 — 가을빛 섞어 심어 화면을 채웁니다.
  const LEAF = ['#a8552f', '#bd7437', '#c79a46', '#9c7b3c', '#7c8c48', '#8f5c35', '#cdae55'];
  function broadTree(s = 1, seed = 0) {
    const r2 = seeded(hashStr('tree' + seed));
    const g = new THREE.Group();
    const barkM = matT('wood', { repeat: 1.6, color: '#6a5140' });
    for (let k = 0; k < 3; k++) {
      const seg = mesh(new THREE.CylinderGeometry(0.26 - k * 0.055, 0.32 - k * 0.055, 1.1, 8), barkM, 0, 0.5 + k * 0.95, 0);
      seg.rotation.z = (r2() - 0.5) * 0.12;
      g.add(seg);
    }
    for (let k = 0; k < 3; k++) {
      const a = r2() * Math.PI * 2;
      const br = mesh(new THREE.CylinderGeometry(0.05, 0.11, 1.5, 6), barkM, Math.cos(a) * 0.5, 2.5 + r2() * 0.5, Math.sin(a) * 0.5);
      br.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
      g.add(br);
    }
    const base = new THREE.Color(LEAF[Math.floor(r2() * LEAF.length)]);
    const leafTex = texSet('grass', 0.5);
    for (let i = 0; i < 11; i++) {
      const a = r2() * Math.PI * 2, rr = r2() * 1.5;
      const c = base.clone().offsetHSL((r2() - 0.5) * 0.04, (r2() - 0.5) * 0.12, (r2() - 0.5) * 0.14);
      const m = new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true, map: leafTex.map, envMapIntensity: 0.2 });
      const blob = mesh(new THREE.IcosahedronGeometry(0.62 + r2() * 0.62, 1), m, Math.cos(a) * rr, 3.0 + r2() * 1.5, Math.sin(a) * rr);
      blob.scale.set(1 + r2() * 0.3, 0.68 + r2() * 0.3, 1 + r2() * 0.3);
      blob.rotation.set(r2(), r2() * 6, r2());
      g.add(blob);
    }
    g.scale.setScalar(s);
    return g;
  }
  // 잎 하나 — 가운데 잎맥을 따라 접히고 끝으로 갈수록 뾰족해지며 아래로 처집니다.
  // (공 모양 덩어리를 쓰면 '동그라미'로 보여서, 잎을 한 장씩 만듭니다)
  const leafGeoCache = new Map();
  function leafGeometry(len = 0.5, wide = 0.16, droop = 0.35) {
    const key = len + ':' + wide + ':' + droop;
    if (leafGeoCache.has(key)) return leafGeoCache.get(key);
    const pos = [], uv = [], idx = [], SEG = 6;
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      const w = wide * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.08)) * (1 - t * 0.2);
      const y = len * t - droop * len * t * t;     // 끝이 처지는 곡선
      const z = -droop * len * t * t * 0.55;
      pos.push(-w, y, z + w * 0.5, 0, y, z, w, y, z + w * 0.5);
      uv.push(0, t, 0.5, t, 1, t);
    }
    for (let i = 0; i < SEG; i++) {
      const a = i * 3;
      idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
      idx.push(a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    leafGeoCache.set(key, g);
    return g;
  }
  // 화분에 심는 포기 — 잎을 돌려 가며 꽂습니다.
  function plantBush(seed, { leaves = 9, len = 0.5, wide = 0.16, colors = ['#5aa85e', '#6fbf73', '#84cf80'], tilt = 0.75, stem = 0 } = {}) {
    const r2 = seeded(hashStr('bush' + seed));
    const g = new THREE.Group();
    if (stem > 0) g.add(mesh(new THREE.CylinderGeometry(0.035, 0.055, stem, 6), mat('#4b7d39', { roughness: 1 }), 0, stem / 2, 0));
    for (let i = 0; i < leaves; i++) {
      const a = i * 2.399963 + r2() * 0.5;
      const lf = new THREE.Mesh(leafGeometry(len * (0.8 + r2() * 0.45), wide * (0.85 + r2() * 0.35), 0.3 + r2() * 0.3),
        new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.95, side: THREE.DoubleSide, envMapIntensity: 0.2 }));
      lf.position.y = stem > 0 ? stem * (0.35 + (i / leaves) * 0.6) : 0.04;
      lf.rotation.order = 'YXZ';   // 먼저 방향을 돌리고, 그 방향으로 눕힙니다
      lf.rotation.y = a;
      lf.rotation.x = tilt * (0.55 + r2() * 0.7);
      lf.castShadow = true;
      g.add(lf);
    }
    return g;
  }
  function bench() {
    const g = new THREE.Group();
    const w = matT('wood', { repeat: 1.2, color: '#a9825c' });
    for (let i = 0; i < 3; i++) g.add(mesh(new THREE.BoxGeometry(2.4, 0.1, 0.17), w, 0, 0.55, -0.2 + i * 0.2));
    for (let i = 0; i < 2; i++) g.add(mesh(new THREE.BoxGeometry(2.4, 0.2, 0.08), w, 0, 0.78 + i * 0.24, -0.27));
    for (const x of [-1, 1]) {
      g.add(mesh(new THREE.BoxGeometry(0.1, 0.55, 0.5), mat('#4a3a2e', { roughness: 0.8 }), x, 0.27, 0));
      g.add(mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), mat('#4a3a2e', { roughness: 0.8 }), x, 0.85, -0.27));
    }
    return g;
  }
  // 돌 석등 — 산사에서 본 길 밝힘 방식
  const lamps = [];
  function lamp(x, z, withLight) {
    const g = new THREE.Group();
    const st = matT('rock', { repeat: 1.1, color: '#b9b4ad' });
    g.add(mesh(new THREE.CylinderGeometry(0.26, 0.38, 0.3, 8), st, 0, 0.15, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.14, 0.16, 1.5, 8), st, 0, 1.0, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.42, 0.3, 0.14, 8), st, 0, 1.8, 0));
    const box = mesh(new THREE.BoxGeometry(0.52, 0.5, 0.52), new THREE.MeshStandardMaterial({ color: '#fff0cf', emissive: T.accent, emissiveIntensity: 1.5, roughness: 0.6, transparent: true, opacity: 0.95 }), 0, 2.12, 0);
    g.add(box);
    // 창살은 '면'이 아니라 '모서리'로 — 면으로 두르면 등이 검게 막힙니다.
    const frameM = mat('#3a3630', { roughness: 0.8 });
    for (const fx of [-0.26, 0.26]) for (const fz of [-0.26, 0.26]) g.add(mesh(new THREE.BoxGeometry(0.05, 0.56, 0.05), frameM, fx, 2.12, fz));
    for (const fy of [1.86, 2.38]) {
      g.add(mesh(new THREE.BoxGeometry(0.58, 0.05, 0.05), frameM, 0, fy, 0.26));
      g.add(mesh(new THREE.BoxGeometry(0.58, 0.05, 0.05), frameM, 0, fy, -0.26));
      g.add(mesh(new THREE.BoxGeometry(0.05, 0.05, 0.58), frameM, 0.26, fy, 0));
      g.add(mesh(new THREE.BoxGeometry(0.05, 0.05, 0.58), frameM, -0.26, fy, 0));
    }
    const cap = mesh(new THREE.ConeGeometry(0.52, 0.3, 4), st, 0, 2.52, 0);
    cap.rotation.y = Math.PI / 4;
    g.add(cap);
    g.add(mesh(new THREE.SphereGeometry(0.08, 8, 6), mat('#8e8980', { roughness: 0.8 }), 0, 2.72, 0));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: T.accent, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }));
    halo.position.y = 2.12;
    halo.scale.setScalar(4.2);
    g.add(halo);
    g.position.set(x, groundY(x, z), z);
    // 불빛 세기는 매 프레임 거리로 조절합니다 (사람이 지나가면 환해지도록)
    g.userData.lamp = { boxMat: box.material, halo, lit: 0 };
    blockers.push({ x, z, r: 0.5 });
    scene.add(g);
    lamps.push(g);
  }
  // 점광원은 비싸니 두 개만 만들어, 가장 가까운 석등으로 옮겨 다니게 합니다.
  const roamLights = [0, 1].map(() => {
    const l = new THREE.PointLight(T.accent, 0, 22, 1.5);
    scene.add(l);
    return l;
  });

  // ------------------------------------------------------------------
  // 장소 만들기
  // ------------------------------------------------------------------
  const clickables = [];

  // ------------------------------------------------------------------
  // 광장과 연못 — 돌판 마당 가운데 연못, 연잎과 잉어, 작은 분수
  // ------------------------------------------------------------------
  let waterMat = null;
  const pond = { jets: [], rings: [], koi: [], lily: [] };
  {
    const plaza = mesh(new THREE.CircleGeometry(8, 52), matT('stone', { repeat: 13, color: '#d8d0c0' }));
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.y = 0.02;
    plaza.receiveShadow = true;
    scene.add(plaza);
    groundMeshes.push(plaza);
    const edge = mesh(new THREE.TorusGeometry(8, 0.13, 8, 60), matT('rock', { repeat: 6, color: '#a9a296' }), 0, 0.05, 0);
    edge.rotation.x = -Math.PI / 2;
    scene.add(edge);

    const R = 3.7;                       // 연못 반지름
    const stone = matT('rock', { repeat: 2.6, color: '#bdb5a7' });
    // 연못 벽과 걸터앉는 테두리
    // 벽은 '통'으로 (속을 채우면 윗면이 뚜껑이 되어 물이 가려집니다)
    const wallMat = stone.clone();
    wallMat.side = THREE.DoubleSide;
    scene.add(mesh(new THREE.CylinderGeometry(R + 0.3, R + 0.42, 0.52, 36, 1, true), wallMat, 0, 0.26, 0));
    const rim = mesh(new THREE.TorusGeometry(R + 0.3, 0.18, 10, 40), stone, 0, 0.52, 0);
    rim.rotation.x = -Math.PI / 2;
    rim.receiveShadow = true;
    scene.add(rim);
    // 바닥 자갈과 물
    scene.add(mesh(new THREE.CylinderGeometry(R, R, 0.06, 36), matT('rock', { repeat: 4, color: '#bfae92' }), 0, 0.12, 0));
    const rip = texSet('ripple', 3);
    waterMat = new THREE.MeshStandardMaterial({
      color: '#86d2e4', roughness: 0.34, metalness: 0, envMapIntensity: 0.6,
      emissive: '#3f94a6', emissiveIntensity: 0.55,
      normalMap: rip.normalMap, transparent: true, opacity: 0.82, depthWrite: false,
    });
    waterMat.normalScale = new THREE.Vector2(0.5, 0.5);
    const water = mesh(new THREE.CylinderGeometry(R, R, 0.04, 36), waterMat, 0, 0.44, 0);
    water.renderOrder = 2;
    scene.add(water);

    // 가운데 분수 — 3단으로 쌓고, 위 그릇에서 아래 그릇으로 물이 넘쳐 흐릅니다
    scene.add(mesh(new THREE.CylinderGeometry(0.78, 0.95, 0.5, 16), stone, 0, 0.42, 0));
    scene.add(mesh(new THREE.CylinderGeometry(0.34, 0.46, 1.35, 14), stone, 0, 1.3, 0));
    scene.add(mesh(new THREE.CylinderGeometry(1.5, 0.46, 0.3, 24), stone, 0, 2.05, 0));   // 아래 그릇
    const lowRim = mesh(new THREE.TorusGeometry(1.5, 0.11, 8, 28), stone, 0, 2.18, 0);
    lowRim.rotation.x = -Math.PI / 2;
    scene.add(lowRim);
    scene.add(mesh(new THREE.CylinderGeometry(1.42, 1.42, 0.05, 24), waterMat, 0, 2.17, 0));
    scene.add(mesh(new THREE.CylinderGeometry(0.24, 0.32, 0.95, 12), stone, 0, 2.65, 0));
    scene.add(mesh(new THREE.CylinderGeometry(0.78, 0.3, 0.22, 18), stone, 0, 3.2, 0));   // 위 그릇
    scene.add(mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.04, 18), waterMat, 0, 3.3, 0));
    scene.add(mesh(new THREE.SphereGeometry(0.17, 12, 10), stone, 0, 3.45, 0));
    // 넘쳐 흐르는 물 커튼
    const curtain = waterMat.clone();
    curtain.opacity = 0.13;
    curtain.side = THREE.DoubleSide;
    scene.add(mesh(new THREE.CylinderGeometry(0.76, 0.84, 1.0, 20, 1, true), curtain, 0, 2.66, 0));
    scene.add(mesh(new THREE.CylinderGeometry(1.46, 1.6, 1.55, 26, 1, true), curtain, 0, 1.36, 0));
    // 물줄기 — 방울을 튀기는 대신 '이어진 물'로 만듭니다
    const jetMat = waterMat.clone();
    jetMat.opacity = 0.3;
    jetMat.side = THREE.DoubleSide;
    jetMat.depthWrite = false;
    const foamMat = new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.28, roughness: 0.35, depthWrite: false });
    const jets = new THREE.Group();
    scene.add(jets);
    // 가운데 솟구치는 물기둥
    const column = mesh(new THREE.CylinderGeometry(0.03, 0.1, 1.1, 12, 1, true), jetMat, 0, 4.0, 0);
    jets.add(column);
    jets.add(mesh(new THREE.SphereGeometry(0.085, 10, 8), jetMat, 0, 4.58, 0));
    // 꼭대기에서 아래 그릇으로 떨어지는 포물선 줄기
    const arcTube = (from, to, lift, rad) => {
      const mid = from.clone().lerp(to, 0.5);
      mid.y += lift;
      const curve = new THREE.CatmullRomCurve3([from, mid, to]);
      return new THREE.Mesh(new THREE.TubeGeometry(curve, 22, rad, 7, false), jetMat);
    };
    for (let i = 0; i < 10; i++) {
      const a2 = (i / 10) * Math.PI * 2;
      jets.add(arcTube(new THREE.Vector3(Math.cos(a2) * 0.06, 4.52, Math.sin(a2) * 0.06),
        new THREE.Vector3(Math.cos(a2) * 1.18, 2.3, Math.sin(a2) * 1.18), 0.12, 0.02));
    }
    // 물이 떨어지는 자리의 거품 테두리
    const foam1 = mesh(new THREE.TorusGeometry(1.2, 0.07, 8, 28), foamMat, 0, 2.21, 0);
    foam1.rotation.x = -Math.PI / 2;
    jets.add(foam1);
    const foam2 = mesh(new THREE.TorusGeometry(1.62, 0.1, 8, 32), foamMat, 0, 0.47, 0);
    foam2.rotation.x = -Math.PI / 2;
    jets.add(foam2);
    // 물보라 (아주 옅게)
    for (let i = 0; i < 3; i++) {
      const sp2 = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: '#eaf6ff', transparent: true, opacity: 0.12, depthWrite: false }));
      sp2.position.set(0, 2.5 + i * 0.9, 0);
      sp2.scale.setScalar(3 + i);
      jets.add(sp2);
    }
    pond.jetGroup = jets;
    pond.foam = [foam1, foam2];
    pond.column = column;
    pond.curtain = curtain;
    const jetLight = new THREE.PointLight('#ffe0b0', 9, 14, 1.6);
    jetLight.position.set(0, 2.4, 0);
    scene.add(jetLight);

    // 연잎과 연꽃
    const padGeo = new THREE.CircleGeometry(1, 20, 0.35, Math.PI * 2 - 0.7);
    const padMat = new THREE.MeshStandardMaterial({ color: '#4f8f54', roughness: 0.75, side: THREE.DoubleSide, envMapIntensity: 0.4 });
    for (let i = 0; i < 9; i++) {
      // 가운데 기둥과 바깥 벽에 닿지 않는 고리 안에서만 흘러갑니다
      const a = rnd() * Math.PI * 2, rr = 1.85 + rnd() * 0.95;
      const sc = 0.5 + rnd() * 0.4;
      const lp = new THREE.Mesh(padGeo, padMat);
      // 물 윗면(0.46)보다 확실히 위 — 물속으로 잠겼다 나왔다 하면 깜빡여 보입니다
      lp.position.set(Math.cos(a) * rr, 0.49, Math.sin(a) * rr);
      lp.rotation.set(-Math.PI / 2, 0, rnd() * 6);
      lp.scale.setScalar(sc);
      lp.renderOrder = 3;
      scene.add(lp);
      // 연못을 따라 아주 천천히 한 방향으로 흘러갑니다 (바깥쪽일수록 느리게)
      const flow = { a, rr, sp: (0.035 + rnd() * 0.02) * (2.4 / rr), p: rnd() * 6.3, spin: (rnd() - 0.5) * 0.06 };
      pond.lily.push({ m: lp, y: 0.49, flow, dx: 0, dz: 0 });
      if (i % 3 === 0) {
        const fl = new THREE.Mesh(blossomGeo, new THREE.MeshStandardMaterial({ color: i % 2 ? '#ffb3d1' : '#fff0f4', roughness: 0.8, envMapIntensity: 0.3, vertexColors: true }));
        fl.position.set(Math.cos(a) * rr + 0.2, 0.48, Math.sin(a) * rr + 0.2);
        fl.scale.setScalar(1.15);
        fl.renderOrder = 3;
        scene.add(fl);
        pond.lily.push({ m: fl, y: 0.48, flow: pond.lily[pond.lily.length - 1].flow, dx: 0.2, dz: 0.2 });   // 연꽃은 제 연잎과 함께
      }
    }
    // 연못을 바라보는 벤치 — 광장 돌바닥 위, 연못 쪽을 향해 (연못 테두리에 걸터앉지 않습니다)
    pond.benches = [];
    for (const ang of [1.5, -1.5]) {               // 두 개만 — 연못 양옆에 마주 보게
      const bx = Math.sin(ang) * 6.3, bz = Math.cos(ang) * 6.3;
      const b = bench();
      b.position.set(bx, groundY(bx, bz), bz);
      b.rotation.y = Math.atan2(-bx, -bz);          // 등받이는 바깥, 앉으면 연못을 봅니다
      scene.add(b);
      pond.benches.push({ x: bx, z: bz, ry: b.rotation.y });
      // 사람이 벤치를 뚫고 지나가지 않게 — 회전 상자 (앉아 있는 동안에는 밀어내지 않습니다)
      blockers.push({ x: bx, z: bz, hw: 1.25, hd: 0.32, c: Math.cos(b.rotation.y), s: Math.sin(b.rotation.y) });
    }
    // 잉어 — 몸통과 꼬리를 하나로 합쳐 가볍게
    const koiGeo = mergeGeos([
      { geo: new THREE.SphereGeometry(0.17, 10, 8), matrix: new THREE.Matrix4().makeScale(1, 0.55, 2) },
      { geo: new THREE.ConeGeometry(0.12, 0.26, 6), matrix: new THREE.Matrix4().compose(
        new THREE.Vector3(0, 0, -0.42), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), new THREE.Vector3(1, 1, 0.4)) },
    ]);
    for (let i = 0; i < 3; i++) {
      const k = new THREE.Mesh(koiGeo, new THREE.MeshStandardMaterial({ color: i === 1 ? '#f6f2ea' : '#f08a45', roughness: 0.55, envMapIntensity: 0.6 }));
      scene.add(k);
      pond.koi.push({ m: k, a: rnd() * 6.3, r: 1.1 + i * 0.7, sp: 0.35 + rnd() * 0.25 });
    }

    blockers.push({ x: 0, z: 0, r: R + 0.55 });   // 연못에는 빠지지 않게
  }

  // ------------------------------------------------------------------
  // 북쪽 냇가 — 물길과 나무다리, 건너편에 정자와 돌탑
  // ------------------------------------------------------------------
  const stream = {};
  {
    const streamMat = waterMat.clone();
    streamMat.opacity = 0.74;
    streamMat.color.set('#8fd0de');
    const half = 5.2, SEGN = 90;
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= SEGN; i++) {
      const x = -130 + (260 * i) / SEGN;
      const zc = STREAM_Z(x);
      const w = half * (0.8 + Math.sin(i * 0.4) * 0.18);
      const yb = terrainY(x, zc) + 0.75;
      pos.push(x, yb, zc - w, x, yb, zc + w);
      uv.push(i * 0.5, 0, i * 0.5, 1);
    }
    for (let i = 0; i < SEGN; i++) {
      const a0 = i * 2;
      idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    sg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    sg.setIndex(idx);
    sg.computeVertexNormals();
    const water2 = new THREE.Mesh(sg, streamMat);
    water2.renderOrder = 2;
    scene.add(water2);
    // 결이 하류로 흘러가도록 전용 법선 지도를 둡니다
    const flowTex = texSet('ripple', 1).normalMap.clone();
    flowTex.needsUpdate = true;
    flowTex.wrapS = flowTex.wrapT = THREE.RepeatWrapping;
    flowTex.repeat.set(6, 1.2);
    streamMat.normalMap = flowTex;
    streamMat.normalScale = new THREE.Vector2(0.7, 0.7);
    streamMat.needsUpdate = true;
    // 하얀 물거품 — 흐름을 눈으로 보이게
    const foamG = new THREE.PlaneGeometry(1.5, 0.28);
    foamG.rotateX(-Math.PI / 2);
    const foamM = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.28, depthWrite: false });
    const foams = [];
    for (let i = 0; i < 34; i++) {
      const fm2 = new THREE.Mesh(foamG, foamM);
      fm2.renderOrder = 3;
      scene.add(fm2);
      foams.push({ m: fm2, x: -130 + rnd() * 260, off: (rnd() - 0.5) * 7, sp: 3.2 + rnd() * 2.6, sc: 0.5 + rnd() * 1.1 });
    }
    stream.flowTex = flowTex;
    stream.foams = foams;

    // 물가 — 바위와 갈대
    const rockM = matT('rock', { repeat: 1.2, color: '#9c968c', flatShading: true });
    for (let i = 0; i < 90; i++) {
      const x = -120 + rnd() * 240;
      const side = rnd() < 0.5 ? -1 : 1;
      const zc = STREAM_Z(x) + side * (4.4 + rnd() * 3.5);
      const sc = 0.4 + rnd() * 1.1;
      const rk = mesh(new THREE.IcosahedronGeometry(sc, 0), rockM, x, terrainY(x, zc) + sc * 0.2, zc);
      rk.rotation.set(rnd(), rnd() * 6, rnd());
      rk.scale.y = 0.65;
      rk.castShadow = true;
      rk.receiveShadow = true;
      scene.add(rk);
      if (Math.abs(x) > 8) blockers.push({ x, z: zc, r: sc * 0.8 });
    }

    // 물에는 들어가지 못하게 — 다리 자리만 비워 둡니다
    // 2m 토막으로 촘촘히 (10m 토막이면 다리 양옆 20m 가 통째로 비어 물에 들어갈 수 있었습니다)
    for (let bx2 = -130; bx2 < 130; bx2 += 2) {
      if (bx2 + 2 > BRIDGE_X - 2.0 && bx2 < BRIDGE_X + 2.0) continue;   // 다리 통로(딱 다리 폭만)
      const ax = bx2, az = STREAM_Z(bx2), bx3 = bx2 + 2, bz3 = STREAM_Z(bx2 + 2);
      const segDx = bx3 - ax, segDz = bz3 - az;
      const segLen = Math.hypot(segDx, segDz);
      const ang = Math.atan2(segDx, segDz);
      blockers.push({
        x: (ax + bx3) / 2, z: (az + bz3) / 2,
        hw: 6.4, hd: segLen / 2 + 0.3,
        c: Math.cos(ang), s: Math.sin(ang),
      });
    }

    // 다리 옆으로 빠지지 않게 — 통로 양쪽을 막습니다
    for (const sgn of [-1, 1]) {
      const gz = STREAM_Z(BRIDGE_X + sgn * 2.4);
      blockers.push({ x: BRIDGE_X + sgn * 2.8, z: gz, hw: 1.0, hd: 6.4, c: 1, s: 0 });
    }

    // 나무다리
    const bz = STREAM_Z(BRIDGE_X);
    const deckM = matT('wood', { repeat: 1.6, color: '#8d6646' });
    const railM2 = matT('wood', { repeat: 1.2, color: '#7d5a3e' });
    const SPAN = 9, STEPS = 16;
    const arch = (t) => Math.sin(t * Math.PI) * 1.5;
    for (let i = 0; i < STEPS; i++) {
      const t = i / (STEPS - 1);
      const zz = bz - SPAN + t * SPAN * 2;
      const yy = terrainY(BRIDGE_X, bz) + 1.25 + arch(t);
      const plank = mesh(new THREE.BoxGeometry(3.2, 0.16, SPAN * 2 / STEPS + 0.06), deckM, BRIDGE_X, yy, zz);
      plank.rotation.x = Math.cos(t * Math.PI) * 0.18;
      plank.castShadow = true;
      plank.receiveShadow = true;
      scene.add(plank);
      groundMeshes.push(plank);
      pads.push({ x: BRIDGE_X, z: zz, r: 1.7, h: yy - 0.02 });
      if (i % 4 === 0) {
        for (const sx of [-1.5, 1.5]) {
          scene.add(mesh(new THREE.CylinderGeometry(0.08, 0.09, 1.1, 7), railM2, BRIDGE_X + sx, yy + 0.55, zz));
        }
      }
    }
    for (const sx of [-1.5, 1.5]) {
      for (let i = 0; i < STEPS - 1; i++) {
        const t0 = i / (STEPS - 1), t1 = (i + 1) / (STEPS - 1);
        const z0 = bz - SPAN + t0 * SPAN * 2, z1 = bz - SPAN + t1 * SPAN * 2;
        const y0 = terrainY(BRIDGE_X, bz) + 2.05 + arch(t0), y1 = terrainY(BRIDGE_X, bz) + 2.05 + arch(t1);
        const bar = mesh(new THREE.BoxGeometry(0.09, 0.09, Math.hypot(z1 - z0, y1 - y0)), railM2, BRIDGE_X + sx, (y0 + y1) / 2, (z0 + z1) / 2);
        bar.rotation.x = -Math.atan2(y1 - y0, z1 - z0);
        scene.add(bar);
      }
    }

    // 건너편 정자
    const pav = new THREE.Group();
    const px2 = 6, pz2 = bz + 24;
    pav.position.set(px2, groundY(px2, pz2), pz2);
    pav.rotation.y = Math.PI;
    scene.add(pav);
    const stoneP = matT('rock', { repeat: 4, color: '#c2bbae' });
    const woodP = matT('wood', { repeat: 1.3, color: '#9a7049' });
    const roofP = matT('roof', { repeat: 2.4, color: '#8a89a2' });
    const base2 = mesh(new THREE.CylinderGeometry(4.5, 4.6, 0.5, 32), stoneP, 0, 0.25, 0);   // 둥근 바닥 (팔각이면 모서리에서 발이 묻힘)
    base2.receiveShadow = true;
    pav.add(base2);
    groundMeshes.push(base2);
    pads.push({ x: px2, z: pz2, r: 4.55, h: pav.position.y + 0.5 });   // 땅 높이 + 바닥돌 (예전엔 0.5 만 넣어 발이 묻혔음)
    for (let k = 0; k < 6; k++) {
      const a2 = (k / 6) * Math.PI * 2;
      const pillar = mesh(new THREE.CylinderGeometry(0.2, 0.22, 3.4, 9), woodP, Math.cos(a2) * 3.4, 2.2, Math.sin(a2) * 3.4);
      pav.add(pillar);
      viewBlockers.push(pillar);
      blockers.push({ x: px2 + Math.cos(a2) * 3.4, z: pz2 + Math.sin(a2) * 3.4, r: 0.4 });
    }
    const roofP2 = mesh(new THREE.ConeGeometry(5.4, 2.2, 6), roofP, 0, 5, 0);
    pav.add(roofP2);
    pav.add(mesh(new THREE.SphereGeometry(0.26, 12, 10), mat('#d8c89a', { roughness: 0.5, metalness: 0.3 }), 0, 6.3, 0));
    // 명상 자리 — 가운데 둥근 방석과 낮은 향꽂이, 바닥 네 귀퉁이의 작은 등
    // 돗자리(짚 색, 테두리) → 네모 방석 → 도톰한 둥근 명상 방석
    const matG = new THREE.Group();
    matG.position.set(0, 0.5, 0.6);
    matG.add(mesh(new THREE.BoxGeometry(1.9, 0.03, 1.9), matT('wood', { repeat: 3, color: '#cdb98a' }), 0, 0.015, 0));
    for (const [w, d, x, z] of [[1.94, 0.08, 0, 0.93], [1.94, 0.08, 0, -0.93], [0.08, 1.94, 0.93, 0], [0.08, 1.94, -0.93, 0]]) {
      matG.add(mesh(new THREE.BoxGeometry(w, 0.035, d), mat('#3e4a3c', { roughness: 0.9 }), x, 0.018, z));
    }
    const zab = mesh(new THREE.BoxGeometry(0.95, 0.07, 0.95), mat('#3d4a63', { roughness: 0.95 }), 0, 0.065, 0);
    matG.add(zab);
    const zafu = mesh(new THREE.SphereGeometry(0.36, 24, 14), mat('#5b3f5c', { roughness: 0.95 }), 0, 0.17, 0.05);
    zafu.scale.set(1, 0.32, 1);
    matG.add(zafu);
    pav.add(matG);
    const smoke = [];   // (향은 두지 않습니다)
    const hanji = new THREE.MeshStandardMaterial({ color: '#f2a95e', emissive: '#e8792a', emissiveIntensity: 0.75, roughness: 0.85 });   // 하얗게 날지 않게 주황빛으로
    const rimW = mat('#5a3e2b', { roughness: 0.7 });
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const lb = new THREE.Group();
      lb.position.set(Math.cos(a) * 3.5, 0.5, Math.sin(a) * 3.5);
      const body = mesh(new THREE.SphereGeometry(0.2, 18, 12), hanji, 0, 0.3, 0);
      body.scale.set(1, 1.35, 1);                       // 갸름한 한지 등
      lb.add(body);
      lb.add(mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.05, 14), rimW, 0, 0.57, 0));
      lb.add(mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.05, 14), rimW, 0, 0.04, 0));
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: '#ffb55e', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.position.y = 0.3;
      halo.scale.setScalar(1.3);
      lb.add(halo);
      pav.add(lb);
    }
    const pl2 = new THREE.PointLight('#ffd9a8', 8, 16, 1.5);
    pl2.position.set(0, 3.4, 0);
    pl2.color.set('#ffcf9a'); pl2.intensity = 6;     // 은은하게
    pav.add(pl2);
    // 처마 끝 풍경(작은 종) — 울리면 흔들립니다
    const chimeG = new THREE.Group();
    chimeG.position.set(0, 3.95, 3.3);
    const brassC = mat('#c8a565', { roughness: 0.35, metalness: 0.7 });
    chimeG.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 4), mat('#3a3630'), 0, -0.15, 0));
    const bell = mesh(new THREE.CylinderGeometry(0.06, 0.13, 0.22, 10, 1, true), brassC, 0, -0.38, 0);
    bell.material = brassC.clone(); bell.material.side = THREE.DoubleSide;
    chimeG.add(bell);
    const fish = mesh(new THREE.BoxGeometry(0.14, 0.2, 0.01), mat('#b8c4d6', { roughness: 0.5, metalness: 0.4 }), 0, -0.68, 0);
    chimeG.add(fish);
    pav.add(chimeG);
    stream.pav = { x: px2, z: pz2, ry: Math.PI, benchLocal: new THREE.Vector3(0, 0, 0.6), group: pav, chime: chimeG, swing: 0, smoke };

    // 돌탑 몇 기
    for (let k = 0; k < 5; k++) {
      const cx = -34 - rnd() * 18, cz = bz + 12 + rnd() * 20;
      const gy = groundY(cx, cz);
      let hh = 0;
      for (let m2 = 0; m2 < 5 + Math.floor(rnd() * 4); m2++) {
        const rr = 0.52 - m2 * 0.06 + rnd() * 0.05;
        const st2 = mesh(new THREE.IcosahedronGeometry(rr, 0), matT('rock', { repeat: 1.4, color: '#a09a90', flatShading: true }), cx, gy + hh + rr * 0.4, cz);
        st2.rotation.set(rnd(), rnd() * 6, rnd());
        st2.scale.y = 0.55;
        st2.castShadow = true;
        scene.add(st2);
        hh += rr * 0.72;
      }
      blockers.push({ x: cx, z: cz, r: 0.7 });
    }
  }

  // 길 — 디딤돌을 깔고 석등을 세웁니다.
  const pathMat = matT('stone', { repeat: 0.55, color: '#c8c1b4' });
  pathMat.polygonOffset = true; pathMat.polygonOffsetFactor = -2; pathMat.polygonOffsetUnits = -2;
  const pathFlowers = [];
  const slabsPlaced = [];   // 겹쳐 깔리지 않게 (겹치면 서로 깜빡입니다)
  places.forEach((p, i) => {
    if (p.type === 'plaza') return;
    // 길 구간 — 정자는 냇물을 가로지르지 않게 다리에서 이어집니다
    const bz0 = STREAM_Z(BRIDGE_X);
    const segs = p.type === 'pavilion'
      ? [[0, 0, BRIDGE_X, bz0 - 9.6, false], [BRIDGE_X, bz0 + 9.6, p.x, p.z, true]]
      : [[0, 0, p.x, p.z, true]];
    const a = Math.atan2(p.x, p.z);
    for (const [ax, az, bx, bz2, toPlace] of segs) {
      const dx = bx - ax, dz = bz2 - az, d = Math.hypot(dx, dz), sa = Math.atan2(dx, dz);
      const steps = Math.floor(d / 1.5);
      const k0 = ax === 0 && az === 0 ? 2 : 0;           // 광장 바닥 위에는 깔지 않습니다
      for (let k = k0; k < steps; k++) {
        const t = k / steps;
        const sx = ax + dx * t + (rnd() - 0.5) * 0.5, sz = az + dz * t + (rnd() - 0.5) * 0.5;
        if (toPlace && Math.hypot(sx - p.x, sz - p.z) < (p.radius || 12) * 0.85) continue;   // 장소 안쪽은 비웁니다
        if (slabsPlaced.some(([qx, qz]) => Math.hypot(qx - sx, qz - sz) < 0.95)) continue;   // 이미 깔린 돌판 위엔 또 깔지 않음
        slabsPlaced.push([sx, sz]);
        // 겹친 돌판 윗면이 같은 높이면 서로 깜빡입니다 → 길이를 줄이고 높이를 번갈아 조금씩 다르게
        const slab = mesh(new THREE.BoxGeometry(1.5 + rnd() * 0.5, 0.12, 1.0 + rnd() * 0.22), pathMat, sx, groundY(sx, sz) + 0.04 + (k % 3) * 0.012, sz);
        slab.rotation.y = sa + (rnd() - 0.5) * 0.25;
        slab.receiveShadow = true;
        scene.add(slab);
        groundMeshes.push(slab);
      }
      // 길 양옆으로 꽃을 심습니다
      for (let k = k0; k < steps; k++) {
        const t = k / steps;
        for (const sideSign of [-1, 1]) {
          if (rnd() < 0.45) continue;
          for (let m = 0; m < 2; m++) {
            const off = (1.7 + rnd() * 1.5) * sideSign;
            const fx = ax + dx * t + Math.cos(sa) * off + (rnd() - 0.5) * 0.7;
            const fz = az + dz * t - Math.sin(sa) * off + (rnd() - 0.5) * 0.7;
            if (Math.hypot(fx, fz) < 8.8) continue;      // 광장 바닥에는 심지 않습니다
            if (places.some((q) => q.type !== 'plaza' && Math.hypot(fx - q.x, fz - q.z) < (q.radius || 12) * 0.85)) continue;   // 장소 바닥에도
            if (onBridge(fx, fz)) continue;
            pathFlowers.push([fx, fz]);
          }
        }
      }
    }
    if (p.type === 'pavilion') return;                  // 정자 길엔 석등을 따로 세우지 않습니다
    const nx = Math.cos(a) * 3.1, nz = -Math.sin(a) * 3.1;
    lamp(p.x * 0.4 + nx, p.z * 0.4 + nz, i < 3);
    lamp(p.x * 0.72 - nx, p.z * 0.72 - nz, false);
  });
  // 길가 꽃 — 전부 인스턴스 하나로 (그리기 명령 1번)
  {
    const FCOL = ['#e4a7b6', '#efd9df', '#f0e6bc', '#e3b492', '#cdbcdd', '#f7f3e8', '#dd9aa0'];
    const mat2 = windify(new THREE.MeshStandardMaterial({ roughness: 0.85, vertexColors: true, envMapIntensity: 0.3 }));
    const im = new THREE.InstancedMesh(blossomGeo, mat2, pathFlowers.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), col = new THREE.Color();
    pathFlowers.forEach(([fx, fz], n) => {
      const sc = 0.5 + rnd() * 0.38;
      v3.set(fx, groundY(fx, fz) - 0.02, fz);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2);
      s3.set(sc, sc * (0.9 + rnd() * 0.4), sc);
      im.setMatrixAt(n, m4.compose(v3, q, s3));
      im.setColorAt(n, col.set(FCOL[Math.floor(rnd() * FCOL.length)]));
    });
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = false;
    im.receiveShadow = true;
    im.frustumCulled = false;
    scene.add(im);
  }

  const builders = {
    // 이야기 마당 — 모닥불을 가운데 두고 통나무 의자 10개가 둥글게 마주 봅니다
    hall(p, g) {
      const deck = mesh(new THREE.CylinderGeometry(6.2, 6.3, 0.14, 40), matT('wood', { repeat: 6, color: '#a98159' }), 0, 0.07, 0);
      deck.receiveShadow = true;
      g.add(deck);
      groundMeshes.push(deck);
      const rim = mesh(new THREE.TorusGeometry(6.2, 0.1, 8, 48), matT('wood', { repeat: 4, color: '#7d5a3e' }), 0, 0.14, 0);
      rim.rotation.x = -Math.PI / 2;
      g.add(rim);
      // 모닥불 — 통나무 다섯 개를 별 모양으로 눕히고(끝에 밝은 나이테), 그 위로 물방울 모양 불꽃 세 겹
      const logM = matT('wood', { repeat: 0.7, color: '#a0703f' });
      const ringM = mat('#e9cc9c', { roughness: 0.8 });
      const ringIn = mat('#c99a62', { roughness: 0.8 });
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + 0.3;
        const lg = new THREE.Group();
        lg.position.set(0, 0.25, 0);
        lg.rotation.y = a;
        const body = mesh(new THREE.CylinderGeometry(0.12, 0.13, 1.15, 12), logM, 0, 0, 0.5);
        body.rotation.x = Math.PI / 2 - 0.18;            // 가운데 쪽이 살짝 들리게
        lg.add(body);
        const cap = mesh(new THREE.CircleGeometry(0.125, 18), ringM, 0, -0.1, 1.07);
        cap.rotation.x = -0.18;
        lg.add(cap);
        const capIn = mesh(new THREE.RingGeometry(0.05, 0.065, 18), ringIn, 0, -0.1, 1.072);
        capIn.rotation.x = -0.18;
        lg.add(capIn);
        g.add(lg);
      }
      // 물방울(눈물) 모양 — 아래는 둥글고 위는 뾰족한 회전체
      const flameGeo = (() => {
        const pts = [];
        for (let i = 0; i <= 24; i++) {
          const t = i / 24;                                   // 0 = 바닥, 1 = 끝
          const r = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.25 + 0.0)), 0.9) * (1 - t) ** 0.55 * 0.5 + 0.0001;
          pts.push(new THREE.Vector2(r, t));
        }
        return new THREE.LatheGeometry(pts, 24);
      })();
      const flames = [];
      const flameDefs = [
        // [x, z, 높이, 폭, 색, 투명도, 기울기]
        [0, 0, 1.35, 1.0, '#ff6d1f', 0.82, 0],
        [0.22, 0.05, 0.85, 0.62, '#ff8a26', 0.8, -0.25],
        [-0.22, -0.04, 0.8, 0.6, '#ff8a26', 0.8, 0.25],
        [0, 0.02, 0.95, 0.68, '#ffb43a', 0.9, 0],
        [0, 0.03, 0.55, 0.42, '#ffe7a3', 0.95, 0],
      ];
      for (const [fx, fz, h, w, col, op, tilt] of flameDefs) {
        const f = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, depthWrite: false }));
        f.position.set(fx, 0.32, fz);
        f.scale.set(w, h, w);
        f.rotation.z = tilt;
        f.userData.base = { h, w, op, tilt };
        f.userData.noShadow = true;
        f.renderOrder = 5;
        g.add(f);
        flames.push(f);
      }
      // 불꽃 둘레의 은은한 빛 (한 장)
      const glowS = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: '#ff9a4a', transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
      glowS.position.set(0, 0.85, 0);
      glowS.scale.setScalar(2.4);
      g.add(glowS);
      // 바깥으로 넓게 번지는 빛무리 두 겹
      const glowW = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: '#ffb468', transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending }));
      glowW.position.set(0, 0.9, 0);
      glowW.scale.setScalar(4.6);
      g.add(glowW);
      const glowC = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: '#ffe0a0', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
      glowC.position.set(0, 0.7, 0);
      glowC.scale.setScalar(1.4);
      g.add(glowC);
      // 마루에 동그랗게 번지는 따뜻한 불빛
      const floorGlow = mesh(new THREE.CircleGeometry(2.8, 32), new THREE.MeshBasicMaterial({ map: softTex, color: '#ff9a4a', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }), 0, 0.16, 0);
      floorGlow.rotation.x = -Math.PI / 2;
      g.add(floorGlow);
      const fireLight = new THREE.PointLight('#ff9a50', 9, 13, 1.5);
      fireLight.position.set(0, 1.0, 0);
      g.add(fireLight);
      p.state.fire = { flames, light: fireLight, glows: [[glowS, 0.45, 2.4], [glowW, 0.32, 4.6], [glowC, 0.55, 1.4]] };
      // 통나무 의자 10개 — 위에 동그란 방석
      p.state.seats = [];
      const stoolM = matT('wood', { repeat: 0.8, color: '#9a7049' });
      const cushion = ['#e6b8a2', '#c9d8b6', '#f0d9a8', '#cdbfe0', '#b9d3e3'];
      const N = 10, R = 3.4;
      for (let k = 0; k < N; k++) {
        const a = (k / N) * Math.PI * 2 + Math.PI / N;
        const sx = Math.sin(a) * R, sz = Math.cos(a) * R;
        g.add(mesh(new THREE.CylinderGeometry(0.3, 0.33, 0.42, 12), stoolM, sx, 0.14 + 0.21, sz));
        g.add(mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.07, 14), mat(cushion[k % cushion.length], { roughness: 0.95 }), sx, 0.6, sz));
        p.state.seats.push({ local: new THREE.Vector3(sx, 0, sz), ry: a + Math.PI });   // 가운데(모닥불)를 바라보게
      }
      // 가랜드 — 둘레의 나무 기둥 사이, 그리고 기둥에서 모닥불 위 가운데로 따뜻한 전구 줄이 늘어집니다
      const lampM = new THREE.MeshBasicMaterial({ color: '#ffcf86' });
      const postM = matT('wood', { repeat: 0.8, color: '#6f5038' });
      const cordM = mat('#2e2620', { roughness: 0.9 });
      const NP = 6, PR = 5.75, PH = 3.0;
      const posts = [];
      for (let k = 0; k < NP; k++) {
        const a = (k / NP) * Math.PI * 2;
        const px = Math.sin(a) * PR, pz = Math.cos(a) * PR;
        if (pz < -4.2 && Math.abs(px) < 2) continue;                 // 무대 뒤는 비웁니다
        g.add(mesh(new THREE.CylinderGeometry(0.08, 0.1, PH, 8), postM, px, 0.14 + PH / 2, pz));
        posts.push(new THREE.Vector3(px, 0.14 + PH - 0.08, pz));
      }
      const topP = new THREE.Vector3(0, 4.3, 0);
      const bulbPos = [];
      const hang = (a, b, sag, n) => {
        const pts = [];
        for (let i = 0; i <= 16; i++) {
          const t = i / 16;
          const q = a.clone().lerp(b, t);
          q.y -= Math.sin(t * Math.PI) * sag;
          pts.push(q);
        }
        g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.012, 4, false), cordM));
        for (let i = 1; i < n; i++) {
          const t = i / n;
          const q = a.clone().lerp(b, t);
          q.y -= Math.sin(t * Math.PI) * sag + 0.07;
          bulbPos.push(q);
        }
      };
      for (let k = 0; k < posts.length; k++) {
        const nb = posts[(k + 1) % posts.length];
        if (posts[k].distanceTo(nb) < 8) hang(posts[k], nb, 0.55, 9);   // 둘레를 잇는 줄
        hang(posts[k], topP, 0.35, 8);                                   // 가운데로 모이는 줄
      }
      const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.055, 8, 6), lampM, bulbPos.length);
      const bm4 = new THREE.Matrix4();
      bulbPos.forEach((q, i) => bulbs.setMatrixAt(i, bm4.makeTranslation(q.x, q.y, q.z)));
      g.add(bulbs);
      // 전구마다 은은한 빛무리 — 점 하나씩 (Points 라 늘 카메라를 봅니다)
      const haloGeo = new THREE.BufferGeometry().setFromPoints(bulbPos);
      const halos = new THREE.Points(haloGeo, new THREE.PointsMaterial({ map: softTex, color: '#ffb35a', size: 0.55, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
      g.add(halos);
      p.state.garland = halos;
      // 둘레 한쪽의 작은 이야기 무대 — 올라서서 인사하거나 이야기를 들려줘요
      const SZ = -5.0;
      const stg = mesh(new THREE.CylinderGeometry(1.25, 1.32, 0.34, 28), matT('wood', { repeat: 2, color: '#b48a5e' }), 0, 0.17 + 0.07, SZ);
      stg.receiveShadow = true;
      g.add(stg);
      groundMeshes.push(stg);
      const arch = mesh(new THREE.TorusGeometry(1.35, 0.07, 8, 28, Math.PI), matT('wood', { repeat: 1, color: '#7d5a3e' }), 0, 0.4, SZ - 0.9);
      g.add(arch);
      for (const x of [-1.35, 1.35]) g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.42, 8), arch.material, x, 0.2, SZ - 0.9));
      // 무대 위로 늘어진 작은 전구 줄
      for (let k = 0; k < 9; k++) {
        const a = Math.PI * (k / 8);
        g.add(mesh(new THREE.SphereGeometry(0.06, 8, 6), lampM, Math.cos(a) * 1.35, 0.4 + Math.sin(a) * 1.35 - 0.12, SZ - 0.82));
      }
      p.state.stageLocal = new THREE.Vector3(0, 0, SZ + 0.2);
      p.labelY = 4.2;
      p.state.blocks = [[0, 0, 1.05]];                   // 모닥불엔 들어가지 않게
      p.state.padsLocal = [[0, 0, 6.2, 0.14], [0, SZ, 1.25, 0.41]];
    },
    hill(p, g) {
      p.state.blocks = [[0, 0, 1.15]];     // 큰 소나무만 (벤치는 앉아야 하니 막지 않습니다)
      const r = 13, h = 4.4;
      const mY = (d) => (d < r ? h * (0.5 + 0.5 * Math.cos(Math.PI * d / r)) : 0);   // 언덕 표면 높이
      // 언덕 — 밑동에서 기울기가 0이 되어 잔디와 자연스럽게 이어집니다
      {
        const RG = 26, SG = 48, R2 = r * 1.18;      // 바닥보다 조금 넓게 깔아 경계를 덮습니다
        const mp = [], mu = [], mi = [];
        for (let i2 = 0; i2 <= RG; i2++) {
          const d2 = (R2 * i2) / RG;
          const yy = d2 < r ? h * (0.5 + 0.5 * Math.cos(Math.PI * d2 / r)) : 0;
          for (let j2 = 0; j2 <= SG; j2++) {
            const a2 = (j2 / SG) * Math.PI * 2;
            const xx = Math.cos(a2) * d2, zz = Math.sin(a2) * d2;
            mp.push(xx, yy - 0.02, zz);
            mu.push(xx * 0.252, zz * 0.252);          // 바닥 잔디와 같은 결 크기
          }
        }
        for (let i2 = 0; i2 < RG; i2++) for (let j2 = 0; j2 < SG; j2++) {
          const a0 = i2 * (SG + 1) + j2, b0 = a0 + SG + 1;
          mi.push(a0, a0 + 1, b0, a0 + 1, b0 + 1, b0);
        }
        const mg = new THREE.BufferGeometry();
        mg.setAttribute('position', new THREE.Float32BufferAttribute(mp, 3));
        mg.setAttribute('uv', new THREE.Float32BufferAttribute(mu, 2));
        mg.setIndex(mi);
        mg.computeVertexNormals();
        const mound = new THREE.Mesh(mg, matT('grass', { repeat: 1, color: '#c6d2ae' }));
        mound.receiveShadow = true;
        g.add(mound);
        groundMeshes.push(mound);
      }
      mounds.push({ x: p.x, z: p.z, r, h });
      const big = pineTree(1.85);
      big.position.y = h - 0.25;
      g.add(big);
      p.state.treeBase = new THREE.Vector3(p.x, h - 0.25, p.z);
      p.state.treeScale = 1.85;
      for (let i = 0; i < 11; i++) {
        const a = rnd() * Math.PI * 2, rr = 7.5 + rnd() * 6;
        const lx = Math.cos(a) * rr, lz = Math.sin(a) * rr;
        if (lz > 4 && Math.abs(lx) < 4.5) continue; // 길 쪽은 비워 둠
        const t = i % 3 === 0 ? broadTree(0.8 + rnd() * 0.4, i) : pineTree(0.7 + rnd() * 0.5);
        t.position.set(lx, mY(rr) - 0.1, lz);
        t.rotation.y = rnd() * Math.PI;
        g.add(t);
        p.state.blocks.push([lx, lz, 0.55]);
      }
      const b = bench();
      b.position.set(3.2, mY(3.6) - 0.08, 1.6);
      b.rotation.y = -0.5;
      g.add(b);
      p.state.benchLocal = new THREE.Vector3(3.2, 0, 1.62);        // 벤치 위 (앉는 자리)
      p.state.benchLookLocal = new THREE.Vector3(5.5, 0, 5.5);     // 바라볼 방향
      // 언덕을 오르는 돌계단 (광장 쪽에서 올라옵니다)
      const stoneM2 = matT('stone', { repeat: 0.6, color: '#c6bfb2' });
      for (let k = 0; k < 11; k++) {
        const t2 = k / 11;
        const rr2 = r * (0.98 - t2 * 0.82);
        const sway = Math.sin(t2 * 3.4) * 1.5;
        const sx2 = sway, sz2 = rr2;
        const sy = mY(Math.hypot(sx2, sz2));
        const st = mesh(new THREE.BoxGeometry(1.9, 0.16, 1.1), stoneM2, sx2, sy - 0.02, sz2);
        st.rotation.y = Math.cos(t2 * 3.4) * 0.22;
        st.receiveShadow = true;
        g.add(st);
        groundMeshes.push(st);
        if (k % 4 === 2) {                       // 계단 옆 석등
          const lp = new THREE.Vector3(sx2 + 1.7, 0, sz2).applyMatrix4(new THREE.Matrix4());
          const post = mesh(new THREE.CylinderGeometry(0.1, 0.13, 1.1, 8), stoneM2, lp.x, sy + 0.55, lp.z);
          g.add(post);
          const lampBox = mesh(new THREE.BoxGeometry(0.42, 0.4, 0.42), new THREE.MeshStandardMaterial({ color: '#fff3dc', emissive: T.accent, emissiveIntensity: 1.5, roughness: 0.6 }), lp.x, sy + 1.28, lp.z);
          g.add(lampBox);
          const capl = mesh(new THREE.ConeGeometry(0.4, 0.22, 4), stoneM2, lp.x, sy + 1.56, lp.z);
          capl.rotation.y = Math.PI / 4;
          g.add(capl);
        }
      }
      // 꼭대기 난간 — 돌계단이 올라오는 자리는 비워 둡니다 (예전엔 계단 끝을 난간이 막았음)
      const railM = matT('wood', { repeat: 1.2, color: '#9d7a55' });
      {
        const RR = 5.4;
        // 계단이 반지름 RR 을 지나는 곳의 각도 (계단 식과 같은 식으로 계산)
        let ts = 0;
        for (let q = 0; q <= 400; q++) { const tt = q / 400; if (r * (0.98 - tt * 0.82) <= RR) { ts = tt; break; } }
        const stairAng = Math.atan2(r * (0.98 - ts * 0.82), Math.sin(ts * 3.4) * 1.5);
        const GAP = 0.32;                         // 계단 폭(1.9m)보다 넉넉한 틈
        const arcs = [[-2.4, stairAng - GAP], [stairAng + GAP, 1.8]].filter(([a0, a1]) => a1 - a0 > 0.6);   // 자투리 없이
        const ry2 = mY(RR);
        for (const [a0, a1] of arcs) {
          const n = Math.max(1, Math.round((a1 - a0) / 0.52));
          for (let k = 0; k <= n; k++) {
            const a3 = a0 + (k / n) * (a1 - a0);
            const rx2 = Math.cos(a3) * RR, rz2 = Math.sin(a3) * RR;
            g.add(mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.95, 7), railM, rx2, ry2 + 0.45, rz2));
            if (k < n) {
              const a4 = a0 + ((k + 1) / n) * (a1 - a0);
              const nx2 = Math.cos(a4) * RR, nz2 = Math.sin(a4) * RR;
              const bar = mesh(new THREE.BoxGeometry(Math.hypot(nx2 - rx2, nz2 - rz2), 0.08, 0.08), railM, (rx2 + nx2) / 2, ry2 + 0.82, (rz2 + nz2) / 2);
              bar.rotation.y = -Math.atan2(nz2 - rz2, nx2 - rx2);
              g.add(bar);
            }
          }
        }
      }
      // 비탈의 들꽃
      for (let k = 0; k < 26; k++) {
        const a3 = rnd() * Math.PI * 2, rr3 = 3 + rnd() * 9;
        const fx2 = Math.cos(a3) * rr3, fz2 = Math.sin(a3) * rr3;
        if (fz2 > 2 && Math.abs(fx2) < 3) continue;
        const fl2 = new THREE.Mesh(blossomGeo, mat(['#dfa3b2', '#eee3b4', '#cfc0dd', '#e8c6a8'][k % 4], { roughness: 0.9, vertexColors: true }));
        fl2.position.set(fx2, mY(rr3) - 0.06, fz2);
        fl2.scale.setScalar(0.55 + rnd() * 0.4);
        fl2.rotation.y = rnd() * 6;
        g.add(fl2);
      }
      // 바위 몇 덩이
      for (let i = 0; i < 5; i++) {
        const a = rnd() * Math.PI * 2, rr = 4 + rnd() * 7;
        const rx = Math.cos(a) * rr, rz = Math.sin(a) * rr;
        const rock = mesh(new THREE.IcosahedronGeometry(0.4 + rnd() * 0.5, 0), matT('rock', { repeat: 1.5, color: '#a6a099', flatShading: true }),
          rx, mY(rr) - 0.12, rz);
        rock.rotation.set(rnd(), rnd(), rnd());
        rock.scale.y = 0.7;
        g.add(rock);
      }
      p.state.notes = new THREE.Group();
      scene.add(p.state.notes);
      p.labelY = 14;
    },

    greenhouse(p, g) {
      p.state.pots = [];
      const W = 12, D = 9, H = 4.2;
      // 반투명 유리 — 투과(transmission)는 쓰지 않습니다. 투과 재질이 화면에 들어오면 three.js 가 장면 전체를
      //   한 번 더 그려서(매 프레임) 무거워지고, 처음 보일 때 셰이더 15개를 새로 만드느라 몇 초씩 멈췄습니다.
      //   투명도 0.22 라 겉보기 차이는 거의 없습니다.
      const glass = new THREE.MeshStandardMaterial({
        color: '#dff2fb', transparent: true, opacity: 0.24, roughness: 0.08, metalness: 0,
        side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.4,
      });
      for (const [gw, gx, gz, ry] of [[W, 0, -D / 2, 0], [D, -W / 2, 0, Math.PI / 2], [D, W / 2, 0, Math.PI / 2]]) {
        const pane = mesh(new THREE.PlaneGeometry(gw, H), glass, gx, H / 2, gz);
        pane.rotation.y = ry;
        g.add(pane);
      }
      for (const gx of [-3.75, 3.75]) g.add(mesh(new THREE.PlaneGeometry(4.5, H), glass, gx, H / 2, D / 2));
      {
        const fr2 = matT('wood', { repeat: 0.8, color: '#8d6a4a' });
        for (const dx of [-1.5, 1.5]) g.add(mesh(new THREE.BoxGeometry(0.18, H, 0.22), fr2, dx, H / 2, D / 2));
        g.add(mesh(new THREE.BoxGeometry(3.2, 0.2, 0.22), fr2, 0, H - 0.1, D / 2));
        g.add(mesh(new THREE.PlaneGeometry(3, H - 2.4), glass, 0, H - 1.2, D / 2));
      }
      const frame = matT('wood', { repeat: 0.8, color: '#8d6a4a' });
      // 뼈대
      for (const x of [-W / 2, W / 2]) for (const z of [-D / 2, D / 2]) g.add(mesh(new THREE.BoxGeometry(0.16, H, 0.16), frame, x, H / 2, z));
      for (const y of [0.05, H]) for (const z of [-D / 2, D / 2]) g.add(mesh(new THREE.BoxGeometry(W, 0.14, 0.14), frame, 0, y, z));
      for (const y of [0.05, H]) for (const x of [-W / 2, W / 2]) g.add(mesh(new THREE.BoxGeometry(0.14, 0.14, D), frame, x, y, 0));
      const rise = 1.8, half = D / 2, slope = Math.hypot(half, rise), ang = Math.atan(rise / half);
      for (const s of [-1, 1]) {
        const roof = mesh(new THREE.PlaneGeometry(W, slope), glass, 0, H + rise / 2, s * half / 2);
        roof.rotation.x = -Math.PI / 2 + s * ang;
        g.add(roof);
      }
      // 용마루 — 지붕이 앞뒤로 기울어 있으므로 '긴 쪽(x)'을 따라 놓아야 합니다
      // (예전에는 z 방향으로 놓아 지붕 위에 막대가 가로질러 떠 보였음)
      g.add(mesh(new THREE.BoxGeometry(W + 0.2, 0.16, 0.16), frame, 0, H + rise, 0));
      // 서까래 — 양 끝과 가운데에서 경사를 따라 내려옵니다
      for (const x of [-W / 2, 0, W / 2]) for (const s of [-1, 1]) {
        const rafter = mesh(new THREE.BoxGeometry(0.12, 0.12, slope), frame, x, H + rise / 2, s * half / 2);
        rafter.rotation.x = s * ang;
        g.add(rafter);
      }
      // 양 옆 삼각형 유리 (박공)
      {
        const tri = new THREE.Shape();
        tri.moveTo(-half, 0); tri.lineTo(half, 0); tri.lineTo(0, rise); tri.closePath();
        const triGeo = new THREE.ShapeGeometry(tri);
        for (const x of [-W / 2, W / 2]) {
          const gable = new THREE.Mesh(triGeo, glass);
          gable.rotation.y = Math.PI / 2;
          gable.position.set(x, H, 0);
          g.add(gable);
        }
      }
      // 화분 선반
      for (const x of [-4, 4]) {
        g.add(mesh(new THREE.BoxGeometry(2.2, 0.12, 6), frame, x, 0.92, 0));
        for (const [lx, ly] of [[-1, 0.45], [1, 0.45]]) g.add(mesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), frame, x + lx, ly, 2.6));
        for (const [lx, ly] of [[-1, 0.45], [1, 0.45]]) g.add(mesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), frame, x + lx, ly, -2.6));
        for (let k = 0; k < 4; k++) {
          const px2 = x + (k % 2 ? 0.5 : -0.5), pz = -2 + k * 1.3;
          g.add(mesh(new THREE.CylinderGeometry(0.3, 0.24, 0.42, 10), mat('#b5654a', { roughness: 0.85 }), px2, 1.2, pz));
          g.add(mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.06, 10), mat('#4a3a2c', { roughness: 1 }), px2, 1.4, pz)); // 흙
          // 화분마다 다른 포기 — 넓은 잎 · 가는 허브 · 다육이
          const kind = (k + (x > 0 ? 2 : 0)) % 3;
          const opt = kind === 0 ? { leaves: 7, len: 0.52, wide: 0.19, tilt: 0.8 }
            : kind === 1 ? { leaves: 13, len: 0.46, wide: 0.075, tilt: 0.55, colors: ['#6f9e45', '#88b857', '#5c8c3c'] }
              : { leaves: 11, len: 0.26, wide: 0.15, tilt: 1.15, colors: ['#7fc99a', '#9ad7ab', '#68b487'] };
          const bush = plantBush('shelf' + x + k, opt);
          bush.position.set(px2, 1.42, pz);
          g.add(bush);
          p.state.pots.push({ local: new THREE.Vector3(px2, 1.46, pz), bush });   // 물 줄 수 있는 화분
        }
      }
      // 가운데 화분
      g.add(mesh(new THREE.CylinderGeometry(0.98, 0.74, 1.05, 16), mat('#b5654a', { roughness: 0.85 }), 0, 0.52, 0));
      const potRim = mesh(new THREE.TorusGeometry(0.98, 0.06, 6, 20), mat('#9c553d', { roughness: 0.85 }), 0, 1.0, 0);
      potRim.rotation.x = Math.PI / 2;
      g.add(potRim);
      const plant = new THREE.Group();
      plant.add(mesh(new THREE.CylinderGeometry(0.055, 0.1, 2.2, 7), mat('#4f8a3c', { roughness: 1 }), 0, 1.1, 0));
      // 줄기를 따라 잎이 어긋나게 달립니다
      for (let i = 0; i < 11; i++) {
        const a = i * 2.399963, y = 0.35 + i * 0.17;
        const leaf = new THREE.Mesh(leafGeometry(0.62 - i * 0.02, 0.2 - i * 0.004, 0.42),
          new THREE.MeshStandardMaterial({ color: i % 2 ? '#62b56c' : '#7ccb7d', roughness: 0.95, side: THREE.DoubleSide, envMapIntensity: 0.2 }));
        leaf.position.y = y;
        leaf.rotation.order = 'YXZ';
        leaf.rotation.y = a;
        leaf.rotation.x = 0.95 - i * 0.03;
        leaf.castShadow = true;
        plant.add(leaf);
      }
      const flowers = new THREE.Group();
      for (let i = 0; i < 7; i++) {
        const a = i * 0.9;
        const fl = new THREE.Group();
        fl.position.set(Math.cos(a) * 0.42, 2.25 + (i % 2) * 0.16, Math.sin(a) * 0.42);
        for (let k = 0; k < 5; k++) {
          const petal = mesh(new THREE.SphereGeometry(0.11, 8, 6), mat('#ffb3cd', { roughness: 0.8, emissive: '#4a2030' }), Math.cos(k * 1.26) * 0.1, 0, Math.sin(k * 1.26) * 0.1);
          petal.scale.set(1, 0.4, 1);
          fl.add(petal);
        }
        fl.add(mesh(new THREE.SphereGeometry(0.06, 8, 6), mat('#ffe9a8', { roughness: 0.7, emissive: '#6a5520' }), 0, 0.03, 0));
        flowers.add(fl);
      }
      flowers.visible = false;
      plant.add(flowers);
      plant.position.y = 1;
      g.add(plant);
      const warm = new THREE.PointLight('#ffd9a0', 9, 16, 1.4);
      warm.position.set(0, 3.2, 0);
      g.add(warm);
      // 앞쪽 가운데는 문으로 터 둡니다 (안으로 들어갈 수 있게)
      p.state.boxes = [
        [0, -D / 2, W / 2 + 0.3, 0.3],
        [-W / 2, 0, 0.3, D / 2 + 0.3],
        [W / 2, 0, 0.3, D / 2 + 0.3],
        [-3.75, D / 2, 2.25, 0.3],
        [3.75, D / 2, 2.25, 0.3],
        [-4, 0, 1.2, 3.2],                      // 왼쪽 화분 선반
        [4, 0, 1.2, 3.2],                       // 오른쪽 화분 선반
      ];
      p.state.pots.push({ local: new THREE.Vector3(0, 1.08, 0), central: true });   // 가운데 큰 화분
      p.state.plant = plant;
      p.state.flowers = flowers;
      p.labelY = 8.5;
    },

    cafe(p, g) {
      const bw = 10, bh = 4.5, bd = 7;
      const wall = matT('plaster', { repeat: 2.4, color: '#e3d3bb' });
      const woodM = matT('wood', { repeat: 1.6, color: '#8a5b40' });
      const roofM = matT('roof', { repeat: 2.2, color: '#8e8ea6' });
      g.add(mesh(new THREE.BoxGeometry(bw, bh, bd), wall, 0, bh / 2, -2.5));
      // 기둥과 보 (한옥 느낌)
      for (const x of [-bw / 2 + 0.2, bw / 2 - 0.2]) g.add(mesh(new THREE.BoxGeometry(0.34, bh, 0.34), woodM, x, bh / 2, 1));
      g.add(mesh(new THREE.BoxGeometry(bw + 0.4, 0.36, 0.36), woodM, 0, bh - 0.2, 1));
      const roof = mesh(new THREE.ConeGeometry(7.9, 2.4, 4), roofM, 0, bh + 1.2, -2.5);
      roof.rotation.y = Math.PI / 4;
      roof.scale.z = 0.72;
      g.add(roof);
      const eave = mesh(new THREE.BoxGeometry(bw + 2.2, 0.18, bd + 2.2), roofM, 0, bh + 0.08, -2.5);
      g.add(eave);
      // 창 (안쪽 불빛)
      const win = mesh(new THREE.PlaneGeometry(5.2, 2.2), new THREE.MeshStandardMaterial({ color: '#ffd9a0', emissive: '#ffb35c', emissiveIntensity: 1.1, roughness: 0.4 }), -1.6, 2.2, 1.01);
      g.add(win);
      for (let i = 0; i < 4; i++) g.add(mesh(new THREE.BoxGeometry(0.07, 2.2, 0.06), woodM, -3.9 + i * 1.52, 2.2, 1.06));
      g.add(mesh(new THREE.BoxGeometry(5.4, 0.08, 0.06), woodM, -1.6, 2.2, 1.06));
      g.add(mesh(new THREE.BoxGeometry(5.5, 0.16, 0.24), woodM, -1.6, 1.05, 1.1));
      g.add(mesh(new THREE.PlaneGeometry(1.4, 2.6), woodM, 3.2, 1.3, 1.01));
      // 차양
      const awning = mesh(new THREE.BoxGeometry(bw + 0.6, 0.1, 2.4), matT('cloth', { repeat: 3, color: '#c75b4a' }), 0, 3.6, 2.1);
      awning.rotation.x = 0.28;
      g.add(awning);
      // 바깥 자리 — 탁자를 가운데 두고 의자를 앞뒤로 둡니다 (등받이는 바깥쪽)
      const deck = mesh(new THREE.BoxGeometry(7, 0.12, 5.2), woodM, -0.6, 0.06, 3.9);
      deck.receiveShadow = true;
      g.add(deck);
      const TX = -1.6, TZ = 3.9;                     // 탁자 위치
      g.add(mesh(new THREE.CylinderGeometry(0.74, 0.74, 0.1, 20), woodM, TX, 1.04, TZ));
      const tRim = mesh(new THREE.TorusGeometry(0.74, 0.04, 6, 24), woodM, TX, 1.0, TZ);
      tRim.rotation.x = Math.PI / 2;
      g.add(tRim);
      g.add(mesh(new THREE.CylinderGeometry(0.09, 0.16, 1, 10), mat('#3a3a44', { roughness: 0.7 }), TX, 0.55, TZ));
      // 탁자 위 잔과 접시
      g.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 16), mat('#f3ece0', { roughness: 0.4 }), TX + 0.2, 1.1, TZ - 0.15));
      g.add(mesh(new THREE.CylinderGeometry(0.13, 0.1, 0.24, 14), mat('#fdfbf6', { roughness: 0.35 }), TX + 0.2, 1.21, TZ - 0.15));
      const handle2 = mesh(new THREE.TorusGeometry(0.07, 0.016, 6, 12), mat('#fdfbf6', { roughness: 0.35 }), TX + 0.34, 1.21, TZ - 0.15);
      handle2.rotation.y = Math.PI / 2;
      g.add(handle2);
      // 의자 두 개 — 탁자의 앞뒤(건물쪽 / 잔디쪽)
      for (const dz of [-1, 1]) {
        const cz = TZ + dz * 1.25;
        g.add(mesh(new THREE.BoxGeometry(0.66, 0.1, 0.66), woodM, TX, 0.62, cz));          // 앉는 판
        for (const [lx, lz] of [[-0.26, -0.26], [0.26, -0.26], [-0.26, 0.26], [0.26, 0.26]]) {
          g.add(mesh(new THREE.BoxGeometry(0.07, 0.5, 0.07), mat('#3a3a44', { roughness: 0.7 }), TX + lx, 0.37, cz + lz));
        }
        const backRest = mesh(new THREE.BoxGeometry(0.64, 0.52, 0.07), woodM, TX, 0.92, cz + dz * 0.3);  // 등받이는 탁자 반대쪽
        backRest.rotation.x = -dz * 0.12;
        g.add(backRest);
      }
      // 창가 바 스툴 두 개
      for (const sx of [-2.6, -0.6]) {
        g.add(mesh(new THREE.CylinderGeometry(0.28, 0.26, 0.1, 14), woodM, sx, 0.68, 1.95));
        g.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.62, 10), mat('#3a3a44', { roughness: 0.7 }), sx, 0.36, 1.95));
      }
      // 처마에 달린 등
      for (const x of [-3.4, 3.4]) {
        const l = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.4, 10), new THREE.MeshStandardMaterial({ color: '#fff1d2', emissive: '#ffbf72', emissiveIntensity: 1.4, roughness: 0.5 }), x, 3.2, 2.9);
        g.add(l);
        g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), mat('#3a3a44'), x, 3.6, 2.9));
      }
      const warm = new THREE.PointLight('#ffc98a', 12, 18, 1.4);
      warm.position.set(-1.2, 2.6, 2.4);
      g.add(warm);
      p.state.blocks = [[-1.6, 3.9, 0.8]];                          // 탁자 (의자는 앉아야 하니 막지 않습니다)
      p.state.boxes = [[0, -2.5, bw / 2 + 0.3, bd / 2 + 0.3]];     // 건물 벽
      p.state.padsLocal = [[-0.6, 3.9, 3.5, 0.12]];
      p.state.seatLocal = new THREE.Vector3(-1.6, 0, 3.9 - 1.25);      // 건물 쪽 의자 (잔디를 바라봄)
      p.state.tableLocal = new THREE.Vector3(-1.6, 0, 3.9);
      p.state.viewLocal = new THREE.Vector3(-1.6, 0, 9.5);             // 바라볼 풍경 쪽
      p.state.windowSeatLocal = new THREE.Vector3(-0.6, 0, 1.95);      // 창가 스툴 (스툴 바로 위)
      p.state.windowLocal = new THREE.Vector3(-1.6, 2, 1);
      // 비
      const n = 900, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { pos[i * 3] = (rnd() - 0.5) * 26; pos[i * 3 + 1] = rnd() * 16; pos[i * 3 + 2] = (rnd() - 0.5) * 26; }
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const rain = new THREE.Points(rg, new THREE.PointsMaterial({ color: '#cfe0ff', size: 0.06, transparent: true, opacity: 0.55 }));
      rain.position.set(p.x, 0, p.z);
      rain.visible = false;
      scene.add(rain);
      p.state.rain = rain;
      p.labelY = 8.5;
    },

    music(p, g) {
      const stoneM = matT('stone', { repeat: 7, color: '#cfc7b8' });
      const woodM = matT('wood', { repeat: 1.3, color: '#9a6c4a' });
      const roofM = matT('roof', { repeat: 2.6, color: '#8a88a4' });
      const base = mesh(new THREE.CylinderGeometry(6, 6.3, 0.45, 28), stoneM, 0, 0.22, 0);
      base.receiveShadow = true;
      g.add(base);
      pads.push({ x: p.x, z: p.z, r: 6, h: 0.45 });
      for (const [x, z] of [[-4.2, -4.2], [4.2, -4.2], [-4.2, 4.2], [4.2, 4.2]]) {
        g.add(mesh(new THREE.CylinderGeometry(0.24, 0.26, 4.6, 10), woodM, x, 2.75, z));
        g.add(mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.2, 10), stoneM, x, 0.55, z));
      }
      g.add(mesh(new THREE.BoxGeometry(9.4, 0.26, 0.26), woodM, 0, 5.05, -4.2));
      g.add(mesh(new THREE.BoxGeometry(9.4, 0.26, 0.26), woodM, 0, 5.05, 4.2));
      g.add(mesh(new THREE.BoxGeometry(0.26, 0.26, 9.4), woodM, -4.2, 5.05, 0));
      g.add(mesh(new THREE.BoxGeometry(0.26, 0.26, 9.4), woodM, 4.2, 5.05, 0));
      const roof = mesh(new THREE.ConeGeometry(8.2, 2.6, 4), roofM, 0, 6.4, 0);
      roof.rotation.y = Math.PI / 4;
      g.add(roof);
      g.add(mesh(new THREE.SphereGeometry(0.28, 12, 10), mat('#d8c89a', { roughness: 0.5, metalness: 0.3 }), 0, 7.8, 0));
      // 피아노 — 업라이트 피아노 모양 (몸통 · 건반받침 · 뚜껑 · 보면대 · 페달)
      const piano = new THREE.Group();
      const KEYW = 0.36, KEYN = 8;                    // 흰 건반 폭과 개수
      const KB = KEYW * KEYN;                          // 건반 전체 폭
      const CASE = KB + 0.42;
      const body = mat('#241f28', { roughness: 0.22, metalness: 0.12, envMapIntensity: 1.1 });
      const bodyDark = mat('#191520', { roughness: 0.28, metalness: 0.1 });
      const brass = mat('#c9a86a', { roughness: 0.3, metalness: 0.75, envMapIntensity: 1.2 });
      // 몸통(위로 솟은 울림통)과 아래 다리판
      piano.add(mesh(new THREE.BoxGeometry(CASE, 1.5, 0.62), body, 0, 2.35, -0.3));
      piano.add(mesh(new THREE.BoxGeometry(CASE, 1.25, 0.52), bodyDark, 0, 1.05, -0.32));
      // 윗 뚜껑 (앞으로 살짝 튀어나온 상판)
      piano.add(mesh(new THREE.BoxGeometry(CASE + 0.12, 0.12, 0.86), body, 0, 3.16, -0.18));
      // 건반 받침대
      piano.add(mesh(new THREE.BoxGeometry(CASE, 0.14, 0.92), body, 0, 1.76, 0.22));
      // 양쪽 볼대 (건반 옆을 막는 나무)
      for (const sx of [-1, 1]) piano.add(mesh(new THREE.BoxGeometry(0.2, 0.3, 0.92), body, sx * (KB / 2 + 0.1), 1.96, 0.22));
      // 건반 뚜껑 (열려서 뒤로 젖혀진 모양)
      const fall = mesh(new THREE.BoxGeometry(CASE, 0.1, 0.46), body, 0, 2.08, -0.12);
      fall.rotation.x = -0.5;
      piano.add(fall);
      // 보면대
      const desk = mesh(new THREE.BoxGeometry(CASE - 0.5, 0.06, 0.58), bodyDark, 0, 2.52, 0.02);
      desk.rotation.x = -1.05;
      piano.add(desk);
      // 흰 건반
      const keys = [];
      const whiteMat = () => new THREE.MeshStandardMaterial({ color: '#f7f3ea', emissive: '#000000', roughness: 0.3, envMapIntensity: 0.5 });
      for (let i = 0; i < KEYN; i++) {
        const x = -KB / 2 + KEYW / 2 + i * KEYW;
        const k = mesh(new THREE.BoxGeometry(KEYW - 0.025, 0.09, 0.78), whiteMat(), x, 1.87, 0.52);
        k.userData = { kind: 'key', index: i };
        piano.add(k);
        keys.push(k);
        clickables.push(k);
      }
      // 검은 건반 — 흰 건반 사이, 더 좁고 높고 안쪽으로
      for (const bi of [0, 1, 3, 4, 5]) {
        const x = -KB / 2 + KEYW * (bi + 1);
        piano.add(mesh(new THREE.BoxGeometry(KEYW * 0.56, 0.1, 0.46), mat('#15121a', { roughness: 0.25 }), x, 1.955, 0.36));
      }
      // 건반 앞 테두리
      piano.add(mesh(new THREE.BoxGeometry(KB + 0.2, 0.07, 0.07), bodyDark, 0, 1.83, 0.93));
      // 다리와 페달
      for (const sx of [-1, 1]) piano.add(mesh(new THREE.BoxGeometry(0.18, 0.95, 0.5), body, sx * (CASE / 2 - 0.12), 0.48, -0.3));
      piano.add(mesh(new THREE.BoxGeometry(0.5, 0.5, 0.1), bodyDark, 0, 0.5, -0.05));
      for (const px of [-0.14, 0, 0.14]) piano.add(mesh(new THREE.BoxGeometry(0.07, 0.04, 0.26), brass, px, 0.3, 0.06));
      // 브랜드 각인 느낌의 금색 선
      piano.add(mesh(new THREE.BoxGeometry(0.9, 0.035, 0.03), brass, 0, 2.78, 0.02));
      // 앉은 사람 손높이에 건반이 오도록 크기와 높이를 맞춥니다
      piano.position.set(0, 0.35, -0.95);
      piano.scale.setScalar(0.45);
      g.add(piano);
      const b = bench();
      b.scale.set(0.6, 0.85, 0.8);
      b.position.set(0, 0.45, -0.08);    // 건반에 손이 닿도록 피아노 쪽으로
      b.rotation.y = Math.PI;
      g.add(b);
      // 처마에 매단 등 — 사람이 들어오면 밝아집니다
      const lanternMat = new THREE.MeshStandardMaterial({ color: '#fff3dc', emissive: '#ffbf72', emissiveIntensity: 0.6, roughness: 0.5 });
      for (const [lx, lz] of [[-4.2, -4.2], [4.2, -4.2], [-4.2, 4.2], [4.2, 4.2]]) {
        g.add(mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.42, 10), lanternMat, lx * 0.78, 4.5, lz * 0.78));
        g.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 6), mat('#3a3630'), lx * 0.78, 4.95, lz * 0.78));
      }
      const warm = new THREE.PointLight('#ffd9a8', 3, 20, 1.5);
      warm.position.set(0, 4.2, 0);
      g.add(warm);
      p.state.warm = warm;
      p.state.lanternMat = lanternMat;
      p.state.blocks = [[-4.2, -4.2, 0.42], [4.2, -4.2, 0.42], [-4.2, 4.2, 0.42], [4.2, 4.2, 0.42]];
      p.state.boxes = [[0, -1.25, 1.3, 0.75]];                     // 피아노
      p.state.seatLocal = new THREE.Vector3(0, 0, -0.08);
      p.state.pianoLocal = new THREE.Vector3(0, 1.2, -0.95);
      p.state.keys = keys;
      p.labelY = 9.4;
    },

    field(p, g) {
      const W = 34, D = 20;
      const turf = mesh(new THREE.PlaneGeometry(W, D, 12, 8), matT('grass', { repeat: 16, color: '#b2c49a' }));
      turf.rotation.x = -Math.PI / 2;
      turf.position.y = 0.03;
      turf.receiveShadow = true;
      g.add(turf);
      groundMeshes.push(turf);
      const lineMat = new THREE.MeshStandardMaterial({ color: '#eef3ea', roughness: 0.9 });
      const line = (w, d, x, z) => { const l = mesh(new THREE.PlaneGeometry(w, d), lineMat, x, 0.05, z); l.rotation.x = -Math.PI / 2; g.add(l); };
      line(W, 0.15, 0, -D / 2); line(W, 0.15, 0, D / 2); line(0.15, D, -W / 2, 0); line(0.15, D, W / 2, 0); line(0.15, D, 0, 0);
      const ring = mesh(new THREE.RingGeometry(2.9, 3.05, 44), lineMat, 0, 0.05, 0);
      ring.rotation.x = -Math.PI / 2;
      g.add(ring);
      for (const s of [-1, 1]) {
        const goal = new THREE.Group();
        const gm = mat('#f2f2f2', { roughness: 0.5, metalness: 0.1 });
        goal.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 2, 8), gm, 0, 1, -2.5));
        goal.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 2, 8), gm, 0, 1, 2.5));
        const bar = mesh(new THREE.CylinderGeometry(0.07, 0.07, 5.1, 8), gm, 0, 2, 0);
        bar.rotation.x = Math.PI / 2;
        goal.add(bar);
        goal.position.x = s * (W / 2 - 0.3);
        g.add(goal);
      }
      p.state.lieLocal = new THREE.Vector3(5, 0, 3);
      // 하늘을 도는 새 — 하얀 새 네 마리가 느슨한 V자로, 몇 번 날갯짓하고 길게 미끄러집니다
      // (검은 삼각형 한 마리는 까마귀처럼 보인다는 의견)
      const birdMat = new THREE.MeshStandardMaterial({ color: '#fbf5ea', roughness: 0.85, emissive: '#5a4636', emissiveIntensity: 0.35, side: THREE.DoubleSide });
      const tipMat = new THREE.MeshStandardMaterial({ color: '#d9cdbd', roughness: 0.9, side: THREE.DoubleSide });
      const beakMat = new THREE.MeshStandardMaterial({ color: '#f0a65a', roughness: 0.6 });
      const wingShape = new THREE.Shape();
      wingShape.moveTo(0, -0.24);
      wingShape.quadraticCurveTo(0.7, -0.34, 1.25, -0.08);      // 뒷날개 선
      wingShape.quadraticCurveTo(1.42, 0.06, 1.2, 0.14);        // 둥근 날개 끝
      wingShape.quadraticCurveTo(0.6, 0.34, 0, 0.26);           // 앞날개 선
      wingShape.closePath();
      const wingGeo = new THREE.ShapeGeometry(wingShape, 6);
      wingGeo.rotateX(-Math.PI / 2);
      const tipGeo = new THREE.SphereGeometry(0.16, 8, 6);
      const bodyGeo = new THREE.SphereGeometry(0.24, 12, 10);
      const headGeo = new THREE.SphereGeometry(0.16, 12, 10);
      const beakGeo = new THREE.ConeGeometry(0.05, 0.16, 6);
      const tailShape = new THREE.Shape();
      tailShape.moveTo(-0.07, 0); tailShape.lineTo(-0.2, -0.42); tailShape.quadraticCurveTo(0, -0.34, 0.2, -0.42); tailShape.lineTo(0.07, 0);
      const tailGeo = new THREE.ShapeGeometry(tailShape, 4);
      tailGeo.rotateX(-Math.PI / 2);
      const makeBird = () => {
        const g = new THREE.Group();
        const body = new THREE.Mesh(bodyGeo, birdMat);
        body.scale.set(0.95, 0.85, 2.1);
        const head = new THREE.Mesh(headGeo, birdMat);
        head.position.set(0, 0.1, 0.52);
        const beak = new THREE.Mesh(beakGeo, beakMat);
        beak.rotation.x = Math.PI / 2;
        beak.position.set(0, 0.08, 0.72);
        const tail = new THREE.Mesh(tailGeo, birdMat);
        tail.position.set(0, 0.02, -0.42);
        const mkWing = (side) => {
          const pivot = new THREE.Group();
          pivot.position.set(side * 0.12, 0.08, 0.05);
          const w = new THREE.Mesh(wingGeo, birdMat);
          const tip = new THREE.Mesh(tipGeo, tipMat);   // 날개 끝만 살짝 회색 — 갈매기·백로 느낌
          tip.scale.set(1.1, 0.12, 0.7);
          tip.position.set(1.12, 0, 0.03);
          pivot.add(w, tip);
          pivot.scale.x = side;
          return pivot;
        };
        const wl = mkWing(1), wr = mkWing(-1);
        g.add(body, head, beak, tail, wl, wr);
        return { obj: g, wl, wr };
      };
      const flock = new THREE.Group();
      const birds = [[0, 0, 0], [-2.6, -0.5, -2.2], [2.4, 0.4, -2.6], [-4.8, -0.2, -4.6]].map(([x, y, z], i) => {
        const b = makeBird();
        b.obj.position.set(x, y, z);
        b.obj.scale.setScalar(1.25 - i * 0.06);
        b.off = i * 1.7;
        b.base = new THREE.Vector3(x, y, z);
        flock.add(b.obj);
        return b;
      });
      // 새는 그림자를 드리우지 않습니다 (땅에 지나가는 검은 그림자가 무섭게 보인다는 의견)
      flock.traverse((o) => { if (o.isMesh) { o.userData.noShadow = true; o.castShadow = false; o.receiveShadow = false; } });
      scene.add(flock);
      p.state.bird = { obj: flock, birds };
      p.state.stars = new THREE.Group();
      scene.add(p.state.stars);
      p.labelY = 6;
    },

    petcafe(p, g) {
      const woodM = matT('wood', { repeat: 1.5, color: '#b08a60' });
      const roofM = matT('roof', { repeat: 2, color: '#9c8b7c' });
      const deck = mesh(new THREE.CylinderGeometry(7.4, 7.5, 0.16, 32), matT('wood', { repeat: 7, color: '#b08a60' }), 0, 0.08, 0);
      deck.receiveShadow = true;
      g.add(deck);
      groundMeshes.push(deck);
      p.state.padsLocal = [[0, 0, 7.3, 0.16]];
      // 작은 가게
      g.add(mesh(new THREE.BoxGeometry(5.2, 2.6, 3.2), matT('plaster', { repeat: 2, color: '#f2e5cc' }), 0, 1.45, -4.4));
      for (const x of [-2.4, 2.4]) g.add(mesh(new THREE.BoxGeometry(0.26, 2.6, 0.26), woodM, x, 1.45, -2.85));
      const roof = mesh(new THREE.ConeGeometry(4.8, 1.7, 4), roofM, 0, 3.4, -4.4);
      roof.rotation.y = Math.PI / 4;
      roof.scale.z = 0.78;
      g.add(roof);
      g.add(mesh(new THREE.BoxGeometry(6.4, 0.2, 2.2), roofM, 0, 2.85, -2.6));
      const sign = makeLabel('🐾 멍냥 쉼터', { size: 36, scale: 0.8 });
      sign.position.set(0, 3.55, -2.45);   // 처마 위로 — 카메라 높이(약 2.7m)와 겹치면 간판이 화면을 가렸음
      g.add(sign);
      // 울타리 (앞쪽은 터 둡니다)
      for (let i = 0; i < 28; i++) {
        const a2 = (i / 28) * Math.PI * 2;
        if (Math.sin(a2) > 0.55) continue;
        const fx = Math.cos(a2) * 7.2, fz = Math.sin(a2) * 7.2;
        g.add(mesh(new THREE.BoxGeometry(0.14, 0.8, 0.14), woodM, fx, 0.4, fz));
      }
      // 방석 · 밥그릇 · 물그릇
      const cushions = [[-3.4, 1.2, '#f2b8c6'], [3.2, 0.6, '#bcd8ef'], [-1.2, 3.2, '#f6e3b0'], [2.6, 3.4, '#cfe6c8']];
      for (const [cx, cz, col] of cushions) {
        const cu = mesh(new THREE.CylinderGeometry(0.85, 0.8, 0.18, 18), matT('cloth', { repeat: 1.6, color: col }), cx, 0.25, cz);
        cu.receiveShadow = true;
        g.add(cu);
      }
      for (const [bx, bz, col] of [[-0.9, -1.4, '#d98c56'], [0.9, -1.4, '#7fb3d5']]) {
        g.add(mesh(new THREE.CylinderGeometry(0.34, 0.26, 0.2, 14), mat(col, { roughness: 0.6 }), bx, 0.26, bz));
        g.add(mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.05, 14), mat(bz > 0 ? '#9c6b3f' : '#8fd3ff', { roughness: 0.3 }), bx, 0.33, bz));
      }
      p.state.boxes = [[0, -4.4, 3.1, 2.05], [0, -2.9, 3.3, 1.3]];   // 가게 — 몸 두께만큼 넉넉히 + 처마 밑(카메라가 지붕 속으로 들어가 화면이 까매짐)
      p.state.petSpots = cushions.map(([cx, cz]) => new THREE.Vector3(cx, 0, cz));
      p.labelY = 6.4;
    }
  };

  const placeLabels = [];
  for (const p of places) {
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    g.rotation.y = Math.atan2(-p.x, -p.z); // 광장을 바라보게
    scene.add(g);
    p.group = g;
    (builders[p.type] || (() => {}))(p, g);
    g.updateMatrixWorld(true);
    // 빌더가 남긴 '막을 곳'과 '올라설 단'을 월드 좌표로 옮깁니다
    for (const [lx, lz, r] of (p.state.blocks || [])) {
      const v = new THREE.Vector3(lx, 0, lz).applyMatrix4(g.matrixWorld);
      blockers.push({ x: v.x, z: v.z, r });
    }
    for (const [lx, lz, hw, hd] of (p.state.boxes || [])) {
      const v = new THREE.Vector3(lx, 0, lz).applyMatrix4(g.matrixWorld);
      blockers.push({ x: v.x, z: v.z, hw, hd, c: Math.cos(g.rotation.y), s: Math.sin(g.rotation.y) });
    }
    for (const [lx, lz, hw, hd, ry] of (p.state.rboxes || [])) {
      const v = new THREE.Vector3(lx, 0, lz).applyMatrix4(g.matrixWorld);
      const a = g.rotation.y + ry;
      blockers.push({ x: v.x, z: v.z, hw, hd, c: Math.cos(a), s: Math.sin(a) });
    }
    for (const [lx, lz, r, h] of (p.state.padsLocal || [])) {
      const v = new THREE.Vector3(lx, 0, lz).applyMatrix4(g.matrixWorld);
      pads.push({ x: v.x, z: v.z, r, h });
    }
    const label = makeLabel(p.name, { scale: p.type === 'plaza' ? 0.62 : 0.8 });
    label.position.set(p.x, p.labelY || 7, p.z);
    scene.add(label);
    placeLabels.push(label);
  }
  const byType = (t) => places.filter((p) => p.type === t);

  // ------------------------------------------------------------------
  // 자연물 — 풀포기 · 들꽃 · 바위 (인스턴싱: 수천 개도 가볍게)
  // ------------------------------------------------------------------
  function windify(material) {
    material.onBeforeCompile = (sh) => {
      sh.uniforms.uWind = WIND;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float ph = instanceMatrix[3][0] * 0.6 + instanceMatrix[3][2] * 0.8;
          float sway = sin(uWind * 1.7 + ph) * 0.09 + sin(uWind * 3.1 + ph * 1.7) * 0.03;
          transformed.x += sway * max(0.0, uv.y - 0.08);
          transformed.z += sway * 0.5 * max(0.0, uv.y - 0.08);`);
    };
    material.customProgramCacheKey = () => 'wind';
    return material;
  }
  {
    // 풀포기 — 끝으로 갈수록 가늘어지는 잎 다섯 장을 한 포기로 묶습니다.
    // (네모난 판을 세우면 종이상자처럼 보여서, 폭이 줄어드는 띠로 만듭니다)
    function tuftGeometry() {
      const pos = [], uv = [], col = [], idx = [];
      const dark = new THREE.Color('#27451d'), light = new THREE.Color('#67993a');
      const c = new THREE.Color();
      for (let b = 0; b < 5; b++) {
        const a = (b / 5) * Math.PI * 2 + rnd() * 0.8;
        const dx = Math.cos(a), dz = Math.sin(a);
        const h = 0.2 + rnd() * 0.2, bend = 0.08 + rnd() * 0.12, w0 = 0.026 + rnd() * 0.012;
        const SEG = 3, o = pos.length / 3;
        for (let i = 0; i <= SEG; i++) {
          const t = i / SEG, y = h * t, curve = bend * t * t, w = w0 * (1 - t * 0.9);
          pos.push(dx * curve - dz * w, y, dz * curve + dx * w);
          pos.push(dx * curve + dz * w, y, dz * curve - dx * w);
          uv.push(0, t, 1, t);
          c.copy(dark).lerp(light, t * 0.9 + rnd() * 0.1);
          col.push(c.r, c.g, c.b, c.r, c.g, c.b);
        }
        for (let i = 0; i < SEG; i++) {
          const a0 = o + i * 2;
          idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    }
    const grassMat = windify(new THREE.MeshStandardMaterial({ roughness: 1, side: THREE.DoubleSide, vertexColors: true }));
    const COUNT = LOW ? 3000 : 14000;
    {
      const im = new THREE.InstancedMesh(tuftGeometry(), grassMat, COUNT);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), v3 = new THREE.Vector3();
      let n = 0, guard = 0;
      while (n < COUNT && guard++ < COUNT * 8) {
        const a = rnd() * Math.PI * 2, r = 5 + rnd() ** 0.75 * 112;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        // 장소 안쪽이라도 '언덕 위'에는 풀을 심습니다 (맨땅처럼 보이지 않게)
        let onMound = false;
        for (const m2 of mounds) if (Math.hypot(x - m2.x, z - m2.z) < m2.r * 1.05) onMound = true;
        if (!onMound && flatness(x, z) < 0.65 || onBridge(x, z)) continue;
        const sc = 0.7 + rnd() * 0.55;
        v3.set(x, groundY(x, z) - 0.03, z);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI);
        s3.set(sc, sc * (0.8 + rnd() * 0.7), sc);
        im.setMatrixAt(n, m4.compose(v3, q, s3));
        n++;
      }
      im.count = n;
      im.castShadow = false;
      im.receiveShadow = false;
      im.frustumCulled = false;
      scene.add(im);
    }
    // 들꽃 — 작은 꽃송이 (인스턴스마다 색만 다르게)
    const petal = new THREE.SphereGeometry(0.075, 8, 6);
    petal.scale(1, 0.85, 1);
    petal.translate(0, 0.17, 0);
    petal.setAttribute('color', new THREE.Float32BufferAttribute(new Array(petal.attributes.position.count * 3).fill(1), 3));
    const flowerMat = windify(new THREE.MeshStandardMaterial({ roughness: 0.9, vertexColors: true }));
    const FC = LOW ? 300 : 1200;
    const fim = new THREE.InstancedMesh(petal, flowerMat, FC);
    const col = new THREE.Color();
    const FCOL = ['#e8cfd6', '#efe6c4', '#d8d0e6', '#eddac4'];
    {
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), v3 = new THREE.Vector3();
      let n = 0, guard = 0;
      while (n < FC && guard++ < FC * 10) {
        const a = rnd() * Math.PI * 2, r = 8 + Math.sqrt(rnd()) * 108;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (flatness(x, z) < 0.8 || onBridge(x, z)) continue;
        v3.set(x, groundY(x, z), z);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI);
        const sc = 0.8 + rnd() * 0.6;
        s3.set(sc, sc, sc);
        fim.setMatrixAt(n, m4.compose(v3, q, s3));
        fim.setColorAt(n, col.set(FCOL[Math.floor(rnd() * FCOL.length)]));
        n++;
      }
      fim.count = n;
      fim.frustumCulled = false;
      if (fim.instanceColor) fim.instanceColor.needsUpdate = true;
      scene.add(fim);
    }
    // 바위
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    const rim = new THREE.InstancedMesh(rockGeo, matT('rock', { repeat: 1.2, color: '#9e9890', flatShading: true }), 90);
    {
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), v3 = new THREE.Vector3(), e = new THREE.Euler();
      let n = 0, guard = 0;
      while (n < 90 && guard++ < 900) {
        const a = rnd() * Math.PI * 2, r = 12 + Math.sqrt(rnd()) * 78;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (flatness(x, z) < 0.85 || onBridge(x, z)) continue;
        const sc = 0.35 + rnd() * 1.1;
        v3.set(x, groundY(x, z) - sc * 0.3, z);
        q.setFromEuler(e.set(rnd() * 0.6, rnd() * 6, rnd() * 0.6));
        s3.set(sc, sc * 0.72, sc * (0.8 + rnd() * 0.5));
        rim.setMatrixAt(n, m4.compose(v3, q, s3));
        n++;
      }
      rim.count = n;
      rim.castShadow = true;
      rim.receiveShadow = true;
      scene.add(rim);
    }
    // 숲 — 바깥쪽을 나무로 채워 허전함을 없앱니다.
    // 숲 — 한 그루씩 흩뿌리지 않고 '무리'로 심어야 숲처럼 보입니다
    let planted = 0;
    const MAXT = LOW ? 160 : 520;
    for (let gi = 0; gi < 90 && planted < MAXT; gi++) {
      const ga = rnd() * Math.PI * 2, gr = 40 + Math.sqrt(rnd()) * 78;
      const gx = Math.cos(ga) * gr, gz = Math.sin(ga) * gr;
      if (flatness(gx, gz) < 0.95 || onBridge(gx, gz)) continue;
      const pine = rnd() < 0.55;
      const count = 4 + Math.floor(rnd() * 9);
      for (let k = 0; k < count && planted < MAXT; k++) {
        const a = rnd() * Math.PI * 2, rr = rnd() * (5 + rnd() * 7);
        const x = gx + Math.cos(a) * rr, z = gz + Math.sin(a) * rr;
        if (flatness(x, z) < 0.92 || onBridge(x, z)) continue;
        if (streamDist(x, z) < 7) continue;
        const big = 0.85 + rnd() * 1.15;
        const t = (pine ? rnd() < 0.75 : rnd() < 0.25) ? pineTree(big) : broadTree(big, planted);
        t.position.set(x, groundY(x, z) - 0.15, z);
        t.rotation.y = rnd() * Math.PI;
        scene.add(t);
        blockHere(x, z, 0.4 + big * 0.2);
        planted++;
      }
    }
    // 억새밭 — 바람에 흔들리는 은빛 밭
    {
      const geo2 = tuftGeometry();
      const sm = windify(new THREE.MeshStandardMaterial({ roughness: 1, side: THREE.DoubleSide, color: '#d8cfa8', envMapIntensity: 0.2 }));
      const N2 = LOW ? 500 : 1800;
      const im4 = new THREE.InstancedMesh(geo2, sm, N2);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
      const cx = Math.cos(2.2) * 86, cz = Math.sin(2.2) * 86;
      let n3 = 0, guard3 = 0;
      while (n3 < N2 && guard3++ < N2 * 5) {
        const a = rnd() * Math.PI * 2, rr = rnd() ** 0.6 * 22;
        const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
        if (flatness(x, z) < 0.8 || onBridge(x, z)) continue;
        const sc = 2.4 + rnd() * 1.8;
        v3.set(x, groundY(x, z) - 0.05, z);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6);
        s3.set(sc * 0.8, sc, sc * 0.8);
        im4.setMatrixAt(n3, m4.compose(v3, q, s3));
        n3++;
      }
      im4.count = n3;
      im4.frustumCulled = false;
      scene.add(im4);
    }
    // 큰 바위 몇 덩이
    for (let i = 0; i < (LOW ? 10 : 26); i++) {
      const a = rnd() * Math.PI * 2, r = 55 + rnd() * 58;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (flatness(x, z) < 0.9 || streamDist(x, z) < 6 || onBridge(x, z)) continue;
      const sc = 1.4 + rnd() * 2.6;
      const rk = mesh(new THREE.IcosahedronGeometry(sc, 0), matT('rock', { repeat: 1.1, color: '#9a948a', flatShading: true }), x, groundY(x, z) + sc * 0.2, z);
      rk.rotation.set(rnd(), rnd() * 6, rnd());
      rk.scale.y = 0.6;
      rk.castShadow = true;
      rk.receiveShadow = true;
      scene.add(rk);
      blockHere(x, z, sc * 0.75);
    }
    // 반딧불이
    {
      // 낙엽 — 나무 아래 바닥에 깔립니다
      const lf = new THREE.PlaneGeometry(0.3, 0.2);
      lf.rotateX(-Math.PI / 2);
      lf.setAttribute('color', new THREE.Float32BufferAttribute(new Array(lf.attributes.position.count * 3).fill(1), 3));
      const lm = new THREE.MeshStandardMaterial({ roughness: 1, side: THREE.DoubleSide, vertexColors: true, envMapIntensity: 0.15 });
      const N = LOW ? 700 : 2600;
      const im2 = new THREE.InstancedMesh(lf, lm, N);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e3 = new THREE.Euler(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), col = new THREE.Color();
      let n2 = 0, guard2 = 0;
      while (n2 < N && guard2++ < N * 6) {
        const a = rnd() * Math.PI * 2, r = 9 + rnd() ** 0.6 * 112;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (flatness(x, z) < 0.5 || onBridge(x, z)) continue;
        v3.set(x, groundY(x, z) + 0.035, z);
        q.setFromEuler(e3.set((rnd() - 0.5) * 0.3, rnd() * 6, (rnd() - 0.5) * 0.3));
        const sc = 0.7 + rnd() * 0.8;
        s3.set(sc, sc, sc);
        im2.setMatrixAt(n2, m4.compose(v3, q, s3));
        col.set(LEAF[Math.floor(rnd() * LEAF.length)]).offsetHSL(0, -0.05, -0.05);
        im2.setColorAt(n2, col);
        n2++;
      }
      im2.count = n2;
      if (im2.instanceColor) im2.instanceColor.needsUpdate = true;
      im2.receiveShadow = true;
      im2.frustumCulled = false;
      scene.add(im2);
    }
    {
      const n = LOW ? 60 : 140, pos = new Float32Array(n * 3), base = [];
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2, r = 8 + rnd() * 60;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const y = groundY(x, z) + 0.6 + rnd() * 2.4;
        pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
        base.push({ x, y, z, p: rnd() * 6.3 });
      }
      const g2 = new THREE.BufferGeometry();
      g2.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const fire = new THREE.Points(g2, new THREE.PointsMaterial({ map: glowTex, color: '#ffe9a8', size: 0.6, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 }));
      scene.add(fire);
      fire.userData.base = base;
      window.__fireflies = fire;
    }
    // 물안개
    for (let i = 0; i < (LOW ? 6 : 14); i++) {
      const a = rnd() * Math.PI * 2, r = 20 + rnd() * 60;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: '#cdd6f0', transparent: true, opacity: 0.12, depthWrite: false, fog: false }));
      sp.position.set(x, groundY(x, z) + 0.9, z);
      sp.scale.set(26 + rnd() * 20, 7 + rnd() * 4, 1);
      scene.add(sp);
    }
  }

  // 카메라를 가리는 큰 물체 (나무 · 건물 · 기둥 · 지붕 · 석등)
  const occluders = [];
  for (const root of [...places.map((p) => p.group), ...lamps]) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh || groundMeshes.includes(o) || o.material.transparent) return;
      o.geometry.computeBoundingBox();
      const s = new THREE.Vector3();
      o.getWorldScale(s);
      const bb = o.geometry.boundingBox;
      // 키가 크고 '넓은' 것만 (석등 · 기둥처럼 가는 것은 캐릭터를 거의 가리지 않는데,
      //   가장자리에 걸렸다 말았다 하면 카메라가 계속 당겨졌다 물러나 화면이 흔들렸습니다)
      if ((bb.max.y - bb.min.y) * s.y > 1.5 && Math.min((bb.max.x - bb.min.x) * s.x, (bb.max.z - bb.min.z) * s.z) > 0.8) occluders.push(o);
    });
  }

  // 그림자 설정 — 땅은 받기만, 나머지는 드리우고 받기
  scene.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.userData.noShadow) return;
    if (groundMeshes.includes(o)) { o.receiveShadow = true; return; }
    const m = o.material;
    if (!m || m.transparent || m.isMeshBasicMaterial) return;
    o.castShadow = true;
    o.receiveShadow = true;
  });

  // ------------------------------------------------------------------
  // 아바타 — 머리 · 몸통 · 팔(어깨/팔꿈치) · 다리(엉덩이/무릎)를 갖춘 3.5등신
  // ------------------------------------------------------------------
  const SKIN = ['#f7d5b8', '#efbf9d', '#dda67c', '#c6895e'];
  const HAIRC = ['#241d1a', '#3b2a21', '#54382a', '#17151c'];
  function makeAvatar(color, name, opts = {}) {
    const h = hashStr(String(name || 'guest'));
    const root = new THREE.Group();
    const inner = new THREE.Group();   // 앉기 · 눕기 보정
    root.add(inner);
    const body = new THREE.Group();    // 걸음 흔들림
    inner.add(body);

    const base = new THREE.Color(color);
    // 사람은 반사를 거의 안 하도록(envMapIntensity 낮게) 해야 머리카락이 하얗게 뜨지 않습니다.
    const mSkin = new THREE.MeshStandardMaterial({ color: opts.skin || SKIN[h % SKIN.length], roughness: 0.88, envMapIntensity: 0.12 });
    // (h >> 3) 은 값이 크면 음수가 되어 색을 못 찾습니다. 부호 없는 >>> 를 써야 합니다.
    const mHair = new THREE.MeshStandardMaterial({ color: opts.hairColor || HAIRC[(h >>> 3) % HAIRC.length], roughness: 0.84, envMapIntensity: 0.1 });
    const mTop = new THREE.MeshStandardMaterial({ color: base, roughness: 0.92, envMapIntensity: 0.1 });
    const mSash = new THREE.MeshStandardMaterial({ color: base.clone().lerp(new THREE.Color('#ffffff'), 0.45), roughness: 0.9, envMapIntensity: 0.1 });
    const mPant = new THREE.MeshStandardMaterial({ color: base.clone().lerp(new THREE.Color('#2b2a3c'), 0.86), roughness: 0.94, envMapIntensity: 0.08 });
    const mShoe = new THREE.MeshStandardMaterial({ color: '#2a2435', roughness: 0.78, envMapIntensity: 0.12 });
    const mEye = new THREE.MeshBasicMaterial({ color: '#2a2335' });
    const mGlint = new THREE.MeshBasicMaterial({ color: '#ffffff' });

    // 다리
    const legs = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(s * 0.13, 0.72, 0);
      hip.add(mesh(new THREE.CapsuleGeometry(0.115, 0.2, 4, 10), mPant, 0, -0.17, 0));
      const knee = new THREE.Group();
      knee.position.y = -0.34;
      knee.add(mesh(new THREE.CapsuleGeometry(0.1, 0.18, 4, 10), mPant, 0, -0.14, 0));
      const shoe = mesh(new THREE.BoxGeometry(0.19, 0.12, 0.3), mShoe, 0, -0.29, 0.05);
      knee.add(shoe);
      hip.add(knee);
      body.add(hip);
      legs.push({ hip, knee, shoe });
    }

    // 상체 (허리에서 꺾이도록 그룹으로)
    const upper = new THREE.Group();
    upper.position.y = 0.72;
    body.add(upper);
    const torso = mesh(new THREE.CapsuleGeometry(0.235, 0.3, 5, 14), mTop, 0, 0.3, 0);
    torso.scale.z = 0.84;
    upper.add(torso);
    // 목과 옷깃
    upper.add(mesh(new THREE.CylinderGeometry(0.082, 0.092, 0.14, 10), mSkin, 0, 0.64, 0));
    const collar = mesh(new THREE.TorusGeometry(0.125, 0.032, 8, 18), mSash, 0, 0.6, 0);
    collar.rotation.x = Math.PI / 2;
    upper.add(collar);
    // 앞섶 — 옷에 바느질 선 하나만 넣어도 '옷'으로 읽힙니다.
    const placket = mesh(new THREE.BoxGeometry(0.055, 0.4, 0.03), mSash, 0, 0.34, 0.185);
    placket.scale.z = 0.9;
    upper.add(placket);

    // 팔
    const arms = [];
    for (const s of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(s * 0.26, 0.52, 0);
      sh.add(mesh(new THREE.CapsuleGeometry(0.082, 0.17, 4, 10), mTop, 0, -0.13, 0));
      const elbow = new THREE.Group();
      elbow.position.y = -0.27;
      elbow.add(mesh(new THREE.CapsuleGeometry(0.072, 0.14, 4, 10), mSkin, 0, -0.11, 0));
      elbow.add(mesh(new THREE.SphereGeometry(0.085, 10, 8), mSkin, 0, -0.24, 0));
      sh.add(elbow);
      upper.add(sh);
      arms.push({ sh, elbow });
    }

    // 머리
    const head = new THREE.Group();
    head.position.y = 0.91;
    upper.add(head);
    const skull = mesh(new THREE.SphereGeometry(0.26, 26, 20), mSkin);
    skull.scale.set(1, 1.03, 0.97);
    head.add(skull);
    for (const s of [-1, 1]) {
      const ear = mesh(new THREE.SphereGeometry(0.055, 10, 8), mSkin, s * 0.252, -0.01, 0);
      ear.scale.set(0.55, 1, 0.8);
      head.add(ear);
    }
    // 머리 — 뒤통수를 덮는 모자 하나가 아니라, 이마선 + 앞머리 몇 가닥으로 나눠 만듭니다.
    // (그래야 눈과 머리가 따로 놀지 않습니다)
    const style = opts.hair !== undefined ? opts.hair : h % 4;
    const cap = mesh(new THREE.SphereGeometry(0.272, 26, 20, 0, Math.PI * 2, 0, Math.PI * 0.52), mHair, 0, 0.028, -0.022);
    cap.scale.set(1, 1.02, 1.04);
    head.add(cap);
    // 앞머리 — 이마를 살짝 덮는 한 장 (덩어리를 여러 개 얹으면 울퉁불퉁해 보입니다)
    if (style !== 3) {
      // 앞머리 — 한쪽을 조금 더 길게 해서 가르마를 만듭니다
      const side2 = (h >>> 5) % 2 ? 1 : -1;
      const fringe2 = mesh(new THREE.SphereGeometry(0.232, 20, 15, 0, Math.PI * 2, 0, Math.PI * 0.5), mHair, side2 * 0.022, 0.062, 0.05);
      fringe2.scale.set(1.06, 0.56, 1.0);
      fringe2.rotation.set(0.46, 0, side2 * 0.16);
      head.add(fringe2);
      // 뒤통수 볼륨
      const back = mesh(new THREE.SphereGeometry(0.2, 16, 12), mHair, 0, 0.03, -0.14);
      back.scale.set(1.12, 0.95, 0.85);
      head.add(back);
    }
    // 구레나룻 — 귀 앞을 살짝 덮어 얼굴선을 잡아 줍니다
    //   동그란 점이면 옆모습에서 눈동자처럼 보여서, 머리선에서 귀 앞으로 내려오는 가는 띠로 만듭니다
    for (const s of [-1, 1]) {
      const burn = mesh(new THREE.CapsuleGeometry(0.026, 0.1, 4, 8), mHair, s * 0.222, 0.06, 0.035);
      burn.scale.set(0.55, 1, 1.5);
      burn.rotation.x = 0.12;
      head.add(burn);
    }
    if (style === 0) for (const s of [-1, 1]) {          // 단발
      const side = mesh(new THREE.SphereGeometry(0.135, 14, 12), mHair, s * 0.2, -0.07, -0.04);
      side.scale.set(0.6, 1.35, 1);
      head.add(side);
    }
    if (style === 2) {                                    // 묶은 머리
      const bun = mesh(new THREE.SphereGeometry(0.125, 14, 12), mHair, 0, 0.12, -0.26);
      head.add(bun);
      const tie = mesh(new THREE.TorusGeometry(0.075, 0.022, 6, 14), mTop, 0, 0.05, -0.23);
      tie.rotation.x = 1.2;
      head.add(tie);
    }
    if (style === 3) {                                    // 모자 — 머리를 완전히 덮고, 챙은 어깨보다 좁게
      const hatM = new THREE.MeshStandardMaterial({ color: base.clone().lerp(new THREE.Color('#40394e'), 0.62), roughness: 0.92, envMapIntensity: 0.1 });
      // 이마 위까지만 덮습니다 (예전엔 눈 높이까지 내려와 눈이 가려졌음)
      const crown = mesh(new THREE.SphereGeometry(0.29, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), hatM, 0, 0.085, -0.02);
      crown.scale.set(1, 0.95, 1.02);
      head.add(crown);
      const band = mesh(new THREE.CylinderGeometry(0.292, 0.292, 0.06, 20), mat('#8d7a5e', { roughness: 0.9 }), 0, 0.11, -0.02);
      head.add(band);
      const brim = mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.022, 22), hatM, 0, 0.085, -0.02);
      head.add(brim);
    }

    // 얼굴 — 단순할수록 귀엽습니다.
    //   눈꺼풀 · 짙은 눈썹을 얹으면 '가면'처럼 보여서, 또렷한 눈 + 옅은 눈썹 + 미소만 둡니다.
    const eyes = [], openEye = [], shutEye = [];
    const blushMat = new THREE.MeshBasicMaterial({ color: '#ff9a9a', transparent: true, opacity: 0.3 });
    for (const s2 of [-1, 1]) {
      // 눈 — 살짝 세로로 긴 타원, 흰 점 하나로 생기를 줍니다
      const eye = mesh(new THREE.SphereGeometry(0.034, 18, 14), mEye, s2 * 0.103, -0.028, 0.237);
      eye.scale.set(1.02, 1.08, 0.36);
      head.add(eye);
      eyes.push(eye);
      // 윗속눈썹 — 가는 선 하나로 눈매가 또렷해집니다
      const lash = mesh(new THREE.TorusGeometry(0.038, 0.0075, 6, 14, Math.PI * 0.8), mEye, s2 * 0.103, -0.018, 0.238);
      lash.rotation.z = -Math.PI * 0.1 + s2 * 0.08;
      lash.scale.set(1, 0.72, 0.6);
      head.add(lash);
      // 반짝임은 큰 것 하나 + 작은 것 하나 (하나만 두면 인형 눈처럼 보입니다)
      const g1 = mesh(new THREE.SphereGeometry(0.0095, 8, 6), mGlint, s2 * 0.091, -0.004, 0.252);
      head.add(g1);
      const g2 = mesh(new THREE.SphereGeometry(0.005, 6, 5), mGlint, s2 * 0.115, -0.046, 0.248);
      head.add(g2);
      openEye.push(eye, lash, g1, g2);
      // 감은 눈 — 아래로 둥근 초승달 선 (명상할 때만 보입니다)
      const shut = mesh(new THREE.TorusGeometry(0.034, 0.0065, 6, 14, Math.PI * 0.85), mEye, s2 * 0.103, -0.02, 0.24);
      shut.rotation.z = Math.PI + Math.PI * 0.075;
      shut.scale.set(1, 0.6, 0.6);
      shut.visible = false;
      head.add(shut);
      shutEye.push(shut);
      // 눈썹 — 피부색에 가깝게 옅게, 눈에서 멀찍이
      const blush = mesh(new THREE.SphereGeometry(0.046, 10, 8), blushMat, s2 * 0.158, -0.085, 0.185);
      blush.scale.set(1, 0.45, 0.2);
      head.add(blush);
    }
    const nose = mesh(new THREE.SphereGeometry(0.019, 8, 6), mSkin, 0, -0.058, 0.25);
    nose.scale.set(1, 0.85, 0.75);
    head.add(nose);
    // 입 — 작게 웃는 선
    const mouth = mesh(new THREE.TorusGeometry(0.026, 0.0062, 8, 18, Math.PI * 0.8), mEye, 0, -0.084, 0.234);
    mouth.rotation.z = Math.PI * 1.05;
    mouth.rotation.x = -0.1;
    head.add(mouth);

    // 발밑 그림자(그림자 맵 밖에서도 떠 보이지 않게)
    const blob = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), new THREE.MeshBasicMaterial({ map: softTex, color: '#0c0a18', transparent: true, opacity: 0.4, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.03;
    root.add(blob);

    root.traverse((o) => { if (o.isMesh && o !== blob && !o.material.transparent) { o.castShadow = true; o.receiveShadow = true; } });

    const label = makeLabel(name, { size: 32, scale: opts.npc ? 0.36 : 0.44, bg: opts.npc ? 'rgba(16,18,34,.34)' : undefined });
    label.position.y = 2.22;
    root.add(label);
    if (opts.scale) root.scale.setScalar(opts.scale);

    root.userData = {
      inner, body, upper, head, legs, arms, eyes, openEye, shutEye, blob, label,
      pose: 'stand', gesture: null, t: rnd() * 10, gait: 0, walk: 0, blink: 2 + rnd() * 3,
    };
    return root;
  }

  const MEDK = 2.25;   // 가부좌 정강이 접는 각도 (무릎 축이 위를 향할 때 수평으로 돕니다)
  function animateAvatar(av, dt, moving) {
    const u = av.userData;
    const k = Math.min(1, dt * 12);
    u.t += dt;
    if (u.playing > 0) u.playing -= dt;
    if (u.keyHit) { u.keyHit.t += dt; if (u.keyHit.t > 0.6) u.keyHit = null; }
    if (u.watering > 0) u.watering -= dt;
    if (u.drink > 0) {
      u.drink -= dt;
      if (u.drink <= 0) takeCup(av);
      else if (u.cup && Math.random() < dt * 3) {
        const st = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: '#ffffff', transparent: true, opacity: 0.3, depthWrite: false }));
        av.getWorldPosition(tmpV);
        st.position.set(tmpV.x + (Math.random() - 0.5) * 0.2, tmpV.y + 1.15, tmpV.z + (Math.random() - 0.5) * 0.2);
        st.scale.setScalar(0.5);
        scene.add(st);
        floaters.push({ s: st, t: 0, vx: (Math.random() - 0.5) * 0.15 });
      }
    }
    u.gait += dt * (moving ? 9.5 : 0);
    u.walk = lerp(u.walk, moving ? 1 : 0, Math.min(1, dt * 7));
    const w = u.walk, s = Math.sin(u.gait);

    // 기본 자세
    let rootY = 0, rootRx = 0, upperRx = 0, hipA = s * 0.62 * w, kneeA = Math.max(0, -s) * 0.5 * w;
    if (u.pose === 'sit') { rootY = u.meditate ? -0.4 : -0.3; }   // 명상 — 엉덩이를 방석에 붙여 낮게
    if (u.pose === 'crouch') { rootY = -0.52; upperRx += 0.18; }
    const atKeys = u.pose === 'sit' && (u.atPiano || u.playing > 0);
    if (atKeys) upperRx += 0.14;                 // 피아노 앞 — 상체를 살짝 숙여 건반 쪽으로
    if (u.pose === 'lie') { rootY = 0.34; rootRx = -Math.PI / 2; }

    // 제스처
    let waveAmt = 0, bowAmt = 0, patAmt = 0, danceAmt = 0, stickAmt = 0, rpsAmt = 0, rpsT = 0, throwAmt = 0, throwT = 0;
    if (u.gesture) {
      u.gesture.t += dt;
      const dur = u.gesture.dur || 2.2, gt = u.gesture.t;
      const g = Math.sin(Math.min(1, gt / dur) * Math.PI);
      // 0.4초에 걸쳐 시작하고, 머물다가, 0.4초에 걸쳐 끝냅니다
      const env = smooth(0, 0.4, gt) * (1 - smooth(dur - 0.4, dur, gt));
      if (u.gesture.type === 'bow') { bowAmt = g; upperRx += 0.72 * g; }
      if (u.gesture.type === 'wave') waveAmt = env;
      if (u.gesture.type === 'pat') patAmt = g;
      if (u.gesture.type === 'dance') danceAmt = env;
      if (u.gesture.type === 'stick') stickAmt = env;
      if (u.gesture.type === 'rps') { rpsAmt = env; rpsT = gt; }
      if (u.gesture.type === 'throw') { throwAmt = 1 - smooth(0.75, 1.0, gt); throwT = gt; }
      if (gt > dur) u.gesture = null;
    }
    // 응원봉 — 흔드는 동안에만 오른손에 쥡니다
    const holdStick = !!(u.gesture && u.gesture.type === 'stick');
    if (holdStick && !u.stickObj) { u.stickObj = makeGlowStick(); u.arms[1].elbow.add(u.stickObj); }
    if (u.stickObj) tintStick(u.stickObj, u.t);
    if (!holdStick && u.stickObj) { u.arms[1].elbow.remove(u.stickObj); u.stickObj = null; }
    const beat = u.t * 6.2;                       // 춤 박자 (약 1초에 한 번 통통)
    if (danceAmt > 0.02) rootY += Math.abs(Math.sin(beat)) * 0.07 * danceAmt;

    // 다리
    for (let i = 0; i < u.legs.length; i++) {
      const sgn = i ? 1 : -1;
      let hr = hipA * sgn, kr = kneeA;
      if (u.pose === 'sit') { hr = -1.3; kr = 1.4; }
      let hy = 0;
      let kz = 0;
      if (u.meditate) { hr = -1.5; kr = 0.12; hy = sgn * 0.95; kz = -MEDK * sgn; }   // 가부좌 — 허벅지는 옆으로, 정강이는 바닥에 눕혀 앞에서 엇갈리게
      if (u.pose === 'crouch') { hr = -1.45 + sgn * 0.12; kr = 1.95; }
      if (u.pose === 'lie') { hr = 0.04 * sgn; kr = 0.05; }
      if (danceAmt > 0.02 && u.pose === 'stand') {   // 무릎을 번갈아 굽히며 들썩
        hr = lerp(hr, -0.12 + Math.sin(beat * 0.5 + i * Math.PI) * 0.28, danceAmt);
        kr = lerp(kr, 0.28 + 0.28 * Math.sin(beat + i * Math.PI), danceAmt);
      }
      u.legs[i].hip.rotation.order = 'YXZ';          // 벌린 다음 숙이도록 (y=0 이면 예전과 같음)
      u.legs[i].hip.rotation.y = lerp(u.legs[i].hip.rotation.y, hy, k);
      u.legs[i].hip.rotation.x = lerp(u.legs[i].hip.rotation.x, hr, k);
      u.legs[i].knee.rotation.x = lerp(u.legs[i].knee.rotation.x, kr, k);
      u.legs[i].knee.rotation.z = lerp(u.legs[i].knee.rotation.z, kz, k);
      if (u.legs[i].shoe) u.legs[i].shoe.rotation.x = lerp(u.legs[i].shoe.rotation.x, u.meditate ? -1.5 : 0, k);   // 가부좌 — 발을 눕혀 발바닥이 위로 오지 않게
    }
    // 팔
    for (let i = 0; i < u.arms.length; i++) {
      const sgn = i ? 1 : -1;
      let rx = -hipA * sgn * 0.8, rz = sgn * (0.14 + Math.sin(u.t * 1.3) * 0.02 * (1 - w)), er = -0.25 - w * 0.2;
      if (u.pose === 'sit') { rx = -0.35; rz = sgn * 0.2; er = -0.5; }
      if (u.meditate) { rx = -0.55; rz = sgn * 0.5; er = -0.45; }   // 명상 — 팔을 벌려 손을 무릎 위에
      if (u.pose === 'crouch') { rx = -0.62; rz = sgn * 0.26; er = -0.72; }
      // 피아노 치는 중 — 두 팔을 번갈아 건반 쪽으로
      if (atKeys) {
        // 두 손을 건반 위에 — 위팔은 앞으로, 팔꿈치는 살짝 굽혀 손끝이 건반에 닿게.
        // 쉬는 동안에도 손이 아주 조금씩 움직이고, 건반을 누르면 그 손이 건반 위로 가서 톡 누릅니다.
        const shX = sgn * 0.26;
        let handX = sgn * 0.2;                                      // 쉬는 자리 (몸 앞 조금 벌려)
        let press = 0;
        const kh = u.keyHit;
        if (kh && kh.t < 0.45 && (kh.x >= 0) === (sgn > 0)) {      // 이 손이 칠 건반
          handX = kh.x;
          press = kh.t < 0.12 ? smooth(0, 0.08, kh.t) : 1 - smooth(0.12, 0.3, kh.t);
        }
        rz = Math.asin(clamp((handX - shX) / 0.52, -0.9, 0.9));   // 손을 좌우로 옮김
        rx = -1.2 + Math.sin(u.t * 1.6 + i * 2) * 0.03 - press * 0.06;
        er = -0.45 - press * 0.35 + Math.sin(u.t * 2.1 + i) * 0.03;
      }
      // 물 주는 중 — 오른팔을 앞으로 내밀어 조리개를 기울입니다
      if (u.watering > 0 && i === 1) {
        rx = -1.15;
        rz = sgn * 0.3;
        er = -0.35;
      }
      // 음료 마시는 중 — 오른팔이 입으로 올라갔다 내려옵니다
      if (u.drink > 0 && i === 1) {
        const cyc = u.drink % 4;
        const sip = smooth(2.0, 2.7, cyc) * (1 - smooth(3.4, 4.0, cyc));   // 들고 있다가 → 입으로 → 내려놓기
        u.sip = sip;
        rx = -0.5 - sip * 0.32;                   // 위팔은 조금만 앞으로
        rz = sgn * (0.12 - sip * 0.42);           // 마실 땐 손이 몸 안쪽(입)으로
        er = -1.15 - sip * 0.95;                  // 팔꿈치를 굽혀 컵을 입 높이로
      }
      let ez = 0;
      if (i === 1 && waveAmt > 0.02) {
        // 실제 사람처럼: 위팔은 앞·옆으로 비스듬히(어깨보다 조금 낮게) 들고,
        // 팔꿈치를 굽혀 손이 얼굴 옆으로 올라오게 한 뒤, 팔꿈치를 축으로 손을 좌우로 흔듭니다.
        // (팔을 옆으로 쭉 펴고 아래팔만 세우면 로봇 팔처럼 보입니다)
        const sway = Math.sin(u.t * 10.5) * waveAmt;
        rz = sgn * (0.14 + 0.88 * waveAmt + sway * 0.05);   // 위팔도 손을 따라 아주 조금 움직임
        rx = -0.62 * waveAmt;
        er = -0.25 - 1.75 * waveAmt;                         // 팔꿈치 약 115도 굽힘
        ez = -sgn * (0.12 * waveAmt + sway * 0.36);          // 손을 좌우로 (약 ±20도)
      }
      if (patAmt > 0.02 && i === 1) {   // 쓰다듬기 — 오른손을 앞 아래로 내려 토닥입니다
        rx = -1.0 - Math.sin(u.t * 7) * 0.18 * patAmt;
        rz = sgn * 0.3;
        er = -0.45;
      }
      if (danceAmt > 0.02) {            // 춤 — 두 팔을 번갈아 머리 위로
        const up = 0.5 + 0.5 * Math.sin(beat * 0.5 + i * Math.PI);
        rz = lerp(rz, sgn * (0.45 + 1.9 * up), danceAmt);
        rx = lerp(rx, -0.35, danceAmt);
        er = lerp(er, -1.0 + up * 0.7, danceAmt);
      }
      if (stickAmt > 0.02) {            // 응원봉 — 오른팔은 머리 위에서 좌우로, 왼팔은 박자 맞추기
        if (i === 1) {
          rz = lerp(rz, sgn * (2.35 + Math.sin(u.t * 5.2) * 0.38), stickAmt);
          rx = lerp(rx, -0.15, stickAmt);
          er = lerp(er, -0.2, stickAmt);
        } else {
          rz = lerp(rz, sgn * 0.3, stickAmt);
          rx = lerp(rx, -0.7 - Math.abs(Math.sin(u.t * 5.2)) * 0.2, stickAmt);
          er = lerp(er, -1.1, stickAmt);
        }
      }
      if (rpsAmt > 0.02 && i === 1) {   // 가위바위보 — 주먹을 세 번 흔들고(1.5초), 앞으로 내밉니다
        let tx2, te;
        if (rpsT < 1.5) {
          const pump = Math.abs(Math.sin(rpsT / 1.5 * Math.PI * 3));
          tx2 = -0.65 - 0.35 * pump; te = -1.25 + 0.55 * pump;
        } else { tx2 = -1.3; te = -0.15; }
        rx = lerp(rx, tx2, rpsAmt);
        rz = lerp(rz, sgn * 0.2, rpsAmt);
        er = lerp(er, te, rpsAmt);
      }
      if (throwAmt > 0.02 && i === 1) { // 공 던지기 — 팔을 뒤로 젖혔다가(0.35초) 앞위로 휘두릅니다
        const back = smooth(0, 0.3, throwT), fwd = smooth(0.3, 0.5, throwT);
        rx = lerp(rx, lerp(0.95 * back, -1.9, fwd), throwAmt);
        er = lerp(er, lerp(-1.4 * back, -0.15, fwd), throwAmt);
        rz = lerp(rz, sgn * 0.25, throwAmt);
      }
      if (bowAmt > 0.02) {              // 절할 때는 두 팔을 몸 앞으로 모읍니다
        rx = -0.42 * bowAmt;
        rz = sgn * (0.1 + 0.12 * bowAmt);
        er = -0.5 - 0.5 * bowAmt;
      }
      u.arms[i].sh.rotation.x = lerp(u.arms[i].sh.rotation.x, rx, k);
      u.arms[i].sh.rotation.z = lerp(u.arms[i].sh.rotation.z, rz, k);
      u.arms[i].elbow.rotation.x = lerp(u.arms[i].elbow.rotation.x, er, k);
      u.arms[i].elbow.rotation.z = lerp(u.arms[i].elbow.rotation.z, ez, Math.min(1, dt * 18));
      if (i === 1 && u.cup) u.cup.rotation.x = -(u.arms[1].sh.rotation.x + u.arms[1].elbow.rotation.x) - (u.sip || 0) * 0.9;
    }
    // 몸 전체 — 걸을 때 위아래로 통통, 서 있을 땐 숨 쉬듯
    const bob = w * Math.abs(Math.sin(u.gait)) * 0.055 + (1 - w) * Math.sin(u.t * 1.5) * 0.012;
    u.inner.position.y = lerp(u.inner.position.y, rootY + bob, k);
    if (u.prevPose === 'lie' && u.pose !== 'lie') { u.inner.rotation.x = rootRx; u.inner.position.y = rootY; }
    u.prevPose = u.pose;
    u.inner.rotation.x = lerp(u.inner.rotation.x, rootRx, Math.min(1, dt * 8));
    u.upper.rotation.x = lerp(u.upper.rotation.x, upperRx + w * 0.08, k);
    u.body.rotation.z = lerp(u.body.rotation.z, Math.sin(u.gait) * 0.03 * w + Math.sin(beat * 0.5) * 0.11 * danceAmt + Math.sin(u.t * 5.2) * 0.04 * stickAmt, k);
    u.inner.rotation.y = lerp(u.inner.rotation.y, Math.sin(beat * 0.25) * 0.45 * danceAmt, k);
    u.head.rotation.x = lerp(u.head.rotation.x, bowAmt * 0.3, k);
    u.head.rotation.z = lerp(u.head.rotation.z, -Math.sin(u.gait) * 0.05 * w + Math.sin(u.t * 0.9) * 0.03 * (1 - w) + waveAmt * 0.1, k);
    u.head.rotation.y = lerp(u.head.rotation.y, Math.sin(u.t * 0.45) * 0.22 * (1 - w), Math.min(1, dt * 2));

    // 눈 깜빡임 (명상 중에는 눈을 감고 있습니다)
    // 명상 — 뜬 눈 · 반짝임은 숨기고, 편안하게 감은 초승달 눈을 보입니다 (가늘게 뜬 눈은 무섭게 보였음)
    const shut = !!u.meditate;
    if (u.shutEye && u.shutNow !== shut) { u.shutNow = shut; for (const o of u.openEye) o.visible = !shut; for (const o of u.shutEye) o.visible = shut; }
    if (shut) u.blink = 1;
    u.blink -= dt;
    if (u.blink < 0) {
      const closing = u.blink > -0.07;
      for (const e of u.eyes) e.scale.y = closing ? 0.12 : 1.1;
      if (u.blink < -0.14) u.blink = 2.5 + Math.random() * 4;
    }
    u.blob.visible = u.pose === 'stand' || u.pose === 'crouch';
    u.label.visible = u.pose !== 'lie';
  }

  // ------------------------------------------------------------------
  // 반려동물 — 강아지와 고양이
  // ------------------------------------------------------------------
  function makePet(kind, color) {
    const g = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.92, envMapIntensity: 0.12 });
    const dark = new THREE.MeshStandardMaterial({ color: '#2a2335', roughness: 0.55 });
    const body = mesh(new THREE.CapsuleGeometry(0.16, 0.24, 4, 10), m, 0, 0.3, 0);
    body.rotation.x = Math.PI / 2;
    g.add(body);
    const head = new THREE.Group();
    head.position.set(0, 0.4, 0.27);
    g.add(head);
    head.add(mesh(new THREE.SphereGeometry(0.145, 14, 12), m));
    const snout = mesh(new THREE.SphereGeometry(0.072, 10, 8), m, 0, -0.035, 0.115);
    snout.scale.set(1, 0.8, 1.25);
    head.add(snout);
    head.add(mesh(new THREE.SphereGeometry(0.026, 8, 6), dark, 0, -0.015, 0.2));
    for (const s2 of [-1, 1]) head.add(mesh(new THREE.SphereGeometry(0.022, 8, 6), dark, s2 * 0.055, 0.035, 0.125));
    for (const s2 of [-1, 1]) {
      if (kind === 'cat') {
        const ear = mesh(new THREE.ConeGeometry(0.052, 0.1, 4), m, s2 * 0.085, 0.15, 0.01);
        ear.rotation.z = s2 * 0.22;
        head.add(ear);
      } else {
        const ear = mesh(new THREE.SphereGeometry(0.055, 8, 8), m, s2 * 0.115, 0.045, 0);
        ear.scale.set(0.45, 1.25, 0.85);
        head.add(ear);
      }
    }
    const legs = [];
    for (const [lx, lz] of [[-0.1, 0.14], [0.1, 0.14], [-0.1, -0.14], [0.1, -0.14]]) {
      const l = new THREE.Group();
      l.position.set(lx, 0.22, lz);
      l.add(mesh(new THREE.CapsuleGeometry(0.044, 0.13, 3, 6), m, 0, -0.085, 0));
      g.add(l);
      legs.push(l);
    }
    const tail = new THREE.Group();
    tail.position.set(0, 0.36, -0.26);
    tail.rotation.x = -0.6;
    tail.add(mesh(new THREE.CapsuleGeometry(0.033, kind === 'cat' ? 0.26 : 0.15, 3, 6), m, 0, kind === 'cat' ? 0.17 : 0.1, 0));
    g.add(tail);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.userData = { legs, tail, head, t: rnd() * 5, kind };
    return g;
  }
  function animatePet(pet, dt, moving) {
    const u = pet.userData;
    u.t += dt;
    const sw = moving ? Math.sin(u.t * 13) : 0;
    u.legs.forEach((l, i) => { l.rotation.x = lerp(l.rotation.x, sw * (i % 2 ? 1 : -1) * 0.55, Math.min(1, dt * 14)); });
    u.tail.rotation.z = Math.sin(u.t * (moving ? 9 : 4)) * (u.kind === 'cat' ? 0.25 : 0.5);
    u.head.rotation.y = Math.sin(u.t * 0.8) * 0.3 * (moving ? 0.3 : 1);
    pet.position.y = standY(pet.position.x, pet.position.z) + Math.abs(sw) * 0.03;
  }

  let player = makeAvatar(me.look.color, me.name, { hair: me.look.hair, hairColor: me.look.hairColor, skin: me.look.skin });
  player.position.set(0, 0, 10);
  scene.add(player);

  // ------------------------------------------------------------------
  // 둘러보는 사람들 (NPC) — 혼자 들어와도 인기척이 있도록
  //   생김새는 나와 다르게: 머리 모양 · 머리색 · 피부색 · 키를 따로 지정합니다.
  // ------------------------------------------------------------------
  const NPC_KIND = [
    { name: '도연', color: '#d3dbe9', hair: 0, hairColor: '#2d2420', skin: '#f7d5b8', scale: 0.97 },
    { name: '하람', color: '#e7d2ad', hair: 3, hairColor: '#4a3326', skin: '#efbf9d', scale: 1.05 },
    { name: '시우', color: '#c6dcc4', hair: 1, hairColor: '#1d1a1c', skin: '#dda67c', scale: 0.92 },
    { name: '예린', color: '#e3c9e8', hair: 2, hairColor: '#6b4a2f', skin: '#f7d5b8', scale: 0.89 },
    { name: '한결', color: '#f0c9b8', hair: 1, hairColor: '#352723', skin: '#c6895e', scale: 1.01 },
    { name: '윤서', color: '#bcd3e8', hair: 2, hairColor: '#241d1a', skin: '#efbf9d', scale: 0.95 },
  ];
  const npcs = [];
  const petList = [];        // 부딪힘 판정에 쓰는 모든 동물
  function npcSpot() {
    const pool = places.filter((pp) => pp.type !== 'pavilion');
    const p = rnd() < 0.25 ? null : pool[Math.floor(rnd() * pool.length)];
    const a = rnd() * Math.PI * 2;
    const r = p ? (p.radius || 12) * (0.95 + rnd() * 0.45) : 9 + rnd() * 4;
    return new THREE.Vector3((p ? p.x : 0) + Math.cos(a) * r, 0, (p ? p.z : 0) + Math.sin(a) * r);
  }
  for (let i = 0; i < (LOW ? 3 : 5); i++) {
    const d = NPC_KIND[i % NPC_KIND.length];
    const av = makeAvatar(d.color, d.name, { npc: true, hair: d.hair, hairColor: d.hairColor, skin: d.skin, scale: d.scale });
    const s = npcSpot();
    av.position.set(s.x, standY(s.x, s.z), s.z);
    scene.add(av);
    const n = { av, name: d.name, target: npcSpot(), wait: rnd() * 5, speed: 1.5 + rnd() * 0.9, greet: rnd() * 6 };
    if (i === 0) {                       // 한 명은 강아지와 산책
      n.pet = makePet('dog', '#dcb784');
      n.pet.position.copy(av.position);
      scene.add(n.pet);
      petList.push(n.pet);
    }
    npcs.push(n);
  }
  // 멍냥 쉼터의 강아지 · 고양이들
  const petCafe = places.find((pp) => pp.type === 'petcafe');
  if (petCafe) {
    petCafe.state.pets = [['dog', '#e3bd8b'], ['dog', '#8f6c4e'], ['cat', '#9a9aa8'], ['cat', '#ead9c1']].map(([kind, col], i) => {
      const pet = makePet(kind, col);
      const spot = petCafe.state.petSpots[i % petCafe.state.petSpots.length].clone().applyMatrix4(petCafe.group.matrixWorld);
      pet.position.set(spot.x, standY(spot.x, spot.z), spot.z);
      pet.rotation.y = rnd() * 6;
      scene.add(pet);
      petList.push(pet);
      return { obj: pet, home: spot.clone(), state: 'rest', t: 2 + rnd() * 4, target: spot.clone(), happy: 0 };
    });
  }
  // 번호표 — 동물 머리 위 (1 🐶 · 2 🐶 · 3 🐱 · 4 🐱)
  const petTag = (pt, i) => `${i + 1} ${pt.obj.userData.kind === 'dog' ? '🐶' : '🐱'}`;
  if (petCafe) petCafe.state.pets.forEach((pt, i) => {
    const lb = makeLabel(petTag(pt, i), { size: 30, scale: 0.42 });
    lb.position.y = 1.15;
    lb.visible = false;                 // 평소엔 숨기고, 고를 때만 보입니다
    pt.obj.add(lb);
    pt.tag = lb;
  });
  // 번호표 — 온실 화분 (1~8 · ★ 큰 화분), 화분마다 따로 자랍니다
  // 작은 화분은 들어올 때마다 새싹부터 — 예전엔 브라우저에 영원히 남아, 한 번 다 키우면 다시 물을 줄 수 없었음
  localStorage.removeItem('shelter:pots');
  const potLevels = [];
  {
    const gh0 = byType('greenhouse')[0];
    if (gh0) (gh0.state.pots || []).forEach((q, i) => {
      const lb = makeLabel(q.central ? '★' : String(i + 1), { size: 30, scale: 0.36 });
      lb.position.copy(q.local).add(q.central ? new THREE.Vector3(1.25, 0.2, 0) : new THREE.Vector3(0, 0.7, 0));
      lb.visible = false;               // 물 주기를 눌렀을 때만 보입니다
      gh0.group.add(lb);
      q.tag = lb;
      if (!q.central) q.level = potLevels[i] || 0;
    });
  }
  function growPot(i, save) {
    const gh0 = byType('greenhouse')[0];
    const q = gh0 && gh0.state.pots[i];
    if (!q || q.central) return;
    q.level = Math.min(POT_FULL, (q.level || 0) + 1);
    if (save) potLevels[i] = q.level;
  }
  function petSpotNear() {
    // 가게 안 · 벽 옆(로컬 z < -2.1)은 고르지 않습니다 — 동물이 벽 옆에 가면 쓰다듬을 때 사람도 벽에 붙었음
    const inv = petCafe.group.matrixWorld.clone().invert();
    for (let tries = 0; tries < 20; tries++) {
      const a3 = rnd() * Math.PI * 2, r = rnd() * 5.0;
      const v = new THREE.Vector3(petCafe.x + Math.cos(a3) * r, 0, petCafe.z + Math.sin(a3) * r);
      const l = v.clone().applyMatrix4(inv);
      if (l.z > -2.1 + (Math.abs(l.x) > 3.4 ? -10 : 0)) return v;
    }
    return new THREE.Vector3(petCafe.x, 0, petCafe.z);
  }
  let treat = null;
  function showTreat(pos) {
    if (!treat) {
      treat = new THREE.Group();
      treat.add(mesh(new THREE.CylinderGeometry(0.26, 0.2, 0.1, 14), mat('#c9733f', { roughness: 0.7 }), 0, 0.05, 0));
      treat.add(mesh(new THREE.SphereGeometry(0.13, 10, 8), mat('#8b5a2b', { roughness: 0.8 }), 0, 0.12, 0));
      scene.add(treat);
    }
    treat.position.copy(pos);
    treat.visible = true;
  }
  function callPets(spot) {
    if (!petCafe) return;
    petCafe.state.feedSpot = spot || null;
    petCafe.state.pets.forEach((pt, i) => {
      if (pt.happy > 0) return;
      pt.state = 'come';
      pt.mood = 'eat';
      pt.phase = Math.random() * 6;
      pt.delay = i * 0.25 + Math.random() * 0.4;     // 한꺼번에 똑같이 움직이지 않도록
    });
  }

  // 카페 앞에 앉아 있는 고양이
  {
    const cafe = places.find((p) => p.type === 'cafe');
    const cat = makePet('cat', '#8d8d99');
    const spot = new THREE.Vector3(2.9, 0, 4.2);
    if (cafe) spot.applyMatrix4(cafe.group.matrixWorld); else spot.set(6, 0, 6);
    cat.position.set(spot.x, standY(spot.x, spot.z), spot.z);
    cat.rotation.y = rnd() * 6;
    scene.add(cat);
    petList.push(cat);
    window.__cat = cat;
  }

  // ------------------------------------------------------------------
  // 데이터: 쪽지(소나무) · 소원 별(운동장) · 카운터
  // ------------------------------------------------------------------
  const seen = new Set();
  const NOTE_COLORS = ['#fff3c4', '#ffd6e0', '#d4f0ff', '#e0ffd4', '#f1e0ff'];
  const notes = [], wishes = [];

  function addNoteMesh(item) {
    const hill = byType('hill')[0];
    if (!hill || seen.has('n' + item.id)) return;
    seen.add('n' + item.id);
    notes.push(item);
    const i = notes.length - 1;
    const a = i * 2.399963, yl = 3.3 + ((i * 0.618) % 1) * 1.8;
    const rl = pineRadiusAt(yl) + 0.14, s = hill.state.treeScale;
    const m = mesh(new THREE.PlaneGeometry(0.42, 0.56), new THREE.MeshStandardMaterial({ color: NOTE_COLORS[hashStr(String(item.id)) % NOTE_COLORS.length], side: THREE.DoubleSide, emissive: '#3a3020', roughness: 0.85 }));
    m.position.copy(hill.state.treeBase).add(new THREE.Vector3(Math.cos(a) * rl * s, yl * s, Math.sin(a) * rl * s));
    m.rotation.y = Math.PI / 2 - a;
    m.rotation.z = (rnd() - 0.5) * 0.4;
    m.castShadow = true;
    m.userData = { kind: 'note', text: item.text };
    hill.state.notes.add(m);
    clickables.push(m);
    if (hill.state.notes.children.length > 70) {
      const old = hill.state.notes.children[0];
      hill.state.notes.remove(old);
      clickables.splice(clickables.indexOf(old), 1);
    }
  }

  const risingStars = [];
  const wishStarTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 7);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35, 'rgba(255,250,235,.85)');
    grd.addColorStop(1, 'rgba(255,245,225,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  function addStarMesh(item, fromPos) {
    const field = byType('field')[0];
    if (!field || seen.has('w' + item.id)) return;
    seen.add('w' + item.id);
    wishes.push(item);
    const r = seeded(hashStr(String(item.id) + item.text));
    const a = r() * Math.PI * 2, rad = 4 + r() * 26;
    const target = new THREE.Vector3(field.x + Math.cos(a) * rad, 26 + r() * 20, field.z + Math.sin(a) * rad);
    // 작고 또렷한 별 한 점 — 큰 빛무리(glowTex)를 쓰면 누워 볼 때 노란 공처럼 보였습니다.
    //   그림은 가운데 작은 점뿐이지만 판은 넉넉해서, 누르면 소원을 읽기는 쉽습니다.
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: wishStarTex, color: '#fffaf0', transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    sp.scale.setScalar(2.6);
    sp.userData = { kind: 'star', text: item.text, phase: r() * 6 };
    if (fromPos) {
      sp.position.copy(fromPos);
      risingStars.push({ sp, from: fromPos.clone(), to: target, t: 0 });
    } else sp.position.copy(target);
    field.state.stars.add(sp);
    clickables.push(sp);
    if (field.state.stars.children.length > 150) {
      const old = field.state.stars.children[0];
      field.state.stars.remove(old);
      clickables.splice(clickables.indexOf(old), 1);
    }
  }

  const counters = { water: 0, cheer: 0, happy: 0 };
  // 다 자라는 횟수 — 큰 나무는 모두 합쳐 30번, 작은 화분은 10번.
  //   (예전엔 물을 줄 때마다 계속 커져 최대 2.4배 — 온실 지붕(4.2m)을 뚫고 올라갔음)
  const TREE_FULL = 30, POT_FULL = 10;
  function applyCounter(name, value) {
    counters[name] = Math.max(counters[name], value);
    const gh = byType('greenhouse')[0];
    if (name === 'water' && gh) {
      const v = counters.water;
      gh.state.plant.userData.target = 0.6 + 0.6 * Math.min(v, TREE_FULL) / TREE_FULL;   // 다 자라면 1.2배 — 꼭대기가 지붕 바로 아래
      gh.state.flowers.visible = v >= 10;
    }
    refreshPanelInfo();
  }

  async function loadData() {
    try {
      const [ns, ws, cw, cc, ch] = await Promise.all([store.list('note'), store.list('wish'), store.getCounter('water'), store.getCounter('cheer'), store.getCounter('happy')]);
      ns.forEach((n) => addNoteMesh(n));
      ws.forEach((w) => addStarMesh(w));
      applyCounter('water', cw);
      applyCounter('cheer', cc);
      applyCounter('happy', ch);
    } catch (e) {
      console.warn(e);
      toast('저장된 쪽지를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
  }

  // ------------------------------------------------------------------
  // 소리 (WebAudio로 직접 만든 소리라 외부 음원 파일이 필요 없습니다)
  // ------------------------------------------------------------------
  let actx = null, master = null, muted = false, rainNode = null;
  function ensureAudio() {
    if (actx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    master = actx.createGain();
    master.gain.value = 0.8;
    master.connect(actx.destination);
  }
  // 다장조 한 옥타브 — 도 레 미 파 솔 라 시 도
  const SCALE = [261.63, 293.66, 329.63, 349.23, 392.0, 440.0, 493.88, 523.25];
  const KEY_NAMES = ['도', '레', '미', '파', '솔', '라', '시', '도'];
  function tone(freq, vol = 0.25, dur = 1.8) {
    if (!actx || muted) return;
    const t = actx.currentTime;
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(master);
    for (const [type, mult, v] of [['sine', 1, 1], ['triangle', 2, 0.25]]) {
      const o = actx.createOscillator();
      const og = actx.createGain();
      o.type = type;
      o.frequency.value = freq * mult;
      og.gain.value = v;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }
  const chime = () => { tone(784, 0.12, 1.4); setTimeout(() => tone(1046.5, 0.08, 1.6), 120); };
  function setRainSound(on) {
    if (!actx) return;
    if (on && !rainNode) {
      const len = actx.sampleRate * 2, buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = actx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      // 처마 밑에서 듣는 정도로 — 태풍이 아니라 잔비 소리
      const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const hp = actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 240;
      const g = actx.createGain(); g.gain.value = 0;
      g.gain.linearRampToValueAtTime(0.075, actx.currentTime + 2.5);
      const rlfo = actx.createOscillator(), rlg = actx.createGain();
      rlfo.frequency.value = 0.07;
      rlg.gain.value = 0.018;
      rlfo.connect(rlg).connect(g.gain);
      rlfo.start();
      src.connect(lp).connect(hp).connect(g).connect(master);
      src.start();
      rainNode = { src, g };
    } else if (!on && rainNode) {
      const n = rainNode;
      rainNode = null;
      n.g.gain.linearRampToValueAtTime(0, actx.currentTime + 1);
      setTimeout(() => n.src.stop(), 1100);
    }
  }

  // 연못 물소리 — 켜고 끌 수 있는 졸졸 소리
  let fountainNode = null;
  function toggleFountain() {
    ensureAudio();
    if (!actx) return;
    if (actx.state === 'suspended') actx.resume();
    if (fountainNode) {
      const n = fountainNode;
      fountainNode = null;
      if (n.blipTimer) clearTimeout(n.blipTimer);
      n.g.gain.linearRampToValueAtTime(0, actx.currentTime + 0.8);
      setTimeout(() => { try { n.src.stop(); } catch (e) {} }, 900);
      toast('물소리를 껐어요');
      return;
    }
    // 냇물 — 낮게 깔리는 물살 + 가끔 '또르륵' 하는 물방울
    const len = actx.sampleRate * 3, buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = actx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    // 낮은 '쉬~'는 바람처럼 들려서, 높고 가는 물살만 아주 작게 깔고 졸졸 소리를 위에 얹습니다
    const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 1.4;
    const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200;
    const g = actx.createGain(); g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.022, actx.currentTime + 1.5);
    // 물살이 느리게 세졌다 잦아듭니다
    const flo = actx.createOscillator(), flg = actx.createGain();
    flo.frequency.value = 0.13;
    flg.gain.value = 260;
    flo.frequency.value = 0.5;
    flo.connect(flg).connect(bp.frequency);
    flo.start();
    src.connect(bp).connect(lp).connect(g).connect(master);
    src.start();
    // 졸졸 — 짧은 물방울 소리를 불규칙하게 섞습니다
    const blip = () => {
      if (!fountainNode) return;
      if (!muted) {
        const t0 = actx.currentTime;
        const o = actx.createOscillator(), og = actx.createGain(), ol = actx.createBiquadFilter();
        ol.type = 'lowpass';
        ol.frequency.value = 1800;
        o.type = 'sine';
        const f0 = 600 + Math.random() * 700;
        o.frequency.setValueAtTime(f0, t0);
        o.frequency.exponentialRampToValueAtTime(f0 * (1.4 + Math.random() * 0.6), t0 + 0.08);
        og.gain.setValueAtTime(0.0001, t0);
        og.gain.exponentialRampToValueAtTime(0.012 + Math.random() * 0.01, t0 + 0.008);
        og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
        o.connect(ol).connect(og).connect(master);
        o.start(t0);
        o.stop(t0 + 0.2);
      }
      fountainNode.blipTimer = setTimeout(blip, 70 + Math.random() * 230);   // 촘촘하게 — 졸졸졸
    };
    fountainNode = { src, g, blipTimer: null };
    fountainNode.blipTimer = setTimeout(blip, 400);
    toast('졸졸졸… 시냇물 소리를 켰어요 💧', 2400);
  }

  // 물 쏟아지는 소리 — 짧은 잡음에 필터를 걸어 만듭니다.
  function waterSound() {
    if (!actx || muted) return;
    const len = Math.floor(actx.sampleRate * 1.6), buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = actx.createBufferSource();
    src.buffer = buf;
    const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.8;
    const g = actx.createGain();
    g.gain.setValueAtTime(0, actx.currentTime);
    g.gain.linearRampToValueAtTime(0.16, actx.currentTime + 0.3);
    g.gain.linearRampToValueAtTime(0, actx.currentTime + 1.6);
    src.connect(bp).connect(g).connect(master);
    src.start();
  }

  // ------------------------------------------------------------------
  // 배경 음악 — 음원 파일 없이 화음 · 바람 · 풀벌레를 직접 만들어 깔아 둡니다.
  // ------------------------------------------------------------------
  let ambient = null;
  // 오르골 같은 한 음 — 빠르게 올라갔다 길게 사라집니다.
  function pluck(freq, vol = 0.09, dur = 2.4, when = 0) {
    if (!actx || muted) return;
    const dest = ambient ? ambient.out : master;
    const t0 = actx.currentTime + when;
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    g.connect(dest);
    for (const [type, mult, v] of [['sine', 1, 1], ['triangle', 2.005, 0.2], ['sine', 3.01, 0.07]]) {
      const o = actx.createOscillator(), og = actx.createGain();
      o.type = type;
      o.frequency.value = freq * mult;
      og.gain.value = v;
      o.connect(og).connect(g);
      o.start(t0);
      o.stop(t0 + dur + 0.1);
    }
  }
  function startAmbient() {
    if (!actx || ambient) return;
    const out = actx.createGain();
    out.gain.value = 0.0001;
    out.connect(master);
    out.gain.exponentialRampToValueAtTime(0.34, actx.currentTime + 4);   // 전체를 낮게 (0.55 → 0.34)

    // 1) 바람 — 느리게 세졌다 잦아듭니다
    const wlen = actx.sampleRate * 4, wbuf = actx.createBuffer(1, wlen, actx.sampleRate), wd = wbuf.getChannelData(0);
    for (let i2 = 0; i2 < wlen; i2++) wd[i2] = Math.random() * 2 - 1;
    const wsrc = actx.createBufferSource();
    wsrc.buffer = wbuf;
    wsrc.loop = true;
    const wf = actx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 380; wf.Q.value = 0.3;
    const wg = actx.createGain(); wg.gain.value = 0.018;               // 바람 — '쓰윽' 소리가 커서 크게 줄임
    const wlfo = actx.createOscillator(), wlg = actx.createGain();
    wlfo.frequency.value = 0.035;
    wlg.gain.value = 0.007;
    wlfo.connect(wlg).connect(wg.gain);
    wlfo.start();
    wsrc.connect(wf).connect(wg).connect(out);
    wsrc.start();

    // 1-2) 멀리서 흐르는 물소리 — 아주 낮게 깔아 둡니다
    const blen = actx.sampleRate * 3, bbuf = actx.createBuffer(1, blen, actx.sampleRate), bd = bbuf.getChannelData(0);
    for (let i2 = 0; i2 < blen; i2++) bd[i2] = Math.random() * 2 - 1;
    const bsrc = actx.createBufferSource();
    bsrc.buffer = bbuf;
    bsrc.loop = true;
    const bf2 = actx.createBiquadFilter(); bf2.type = 'bandpass'; bf2.frequency.value = 1500; bf2.Q.value = 0.55;
    const bl2 = actx.createBiquadFilter(); bl2.type = 'lowpass'; bl2.frequency.value = 3000;
    const bg2 = actx.createGain(); bg2.gain.value = 0.026;
    const blfo = actx.createOscillator(), blg = actx.createGain();
    blfo.frequency.value = 0.09;
    blg.gain.value = 0.01;
    blfo.connect(blg).connect(bg2.gain);
    blfo.start();
    bsrc.connect(bf2).connect(bl2).connect(bg2).connect(out);
    bsrc.start();

    // 2) 나뭇잎 스치는 소리
    const rustle = () => {
      if (!ambient) return;
      if (!muted) {
        const t0 = actx.currentTime, dur = 1.2 + Math.random() * 1.6;
        const n = Math.floor(actx.sampleRate * dur), bf = actx.createBuffer(1, n, actx.sampleRate), d2 = bf.getChannelData(0);
        for (let i2 = 0; i2 < n; i2++) d2[i2] = (Math.random() * 2 - 1) * Math.sin((i2 / n) * Math.PI);
        const src = actx.createBufferSource();
        src.buffer = bf;
        const hp = actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
        const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200;   // 날카로운 '쓰윽'을 둥글게
        const g = actx.createGain(); g.gain.value = 0.005 + Math.random() * 0.004;               // 0.022~0.042 → 0.005~0.009
        src.connect(hp).connect(lp).connect(g).connect(out);
        src.start(t0);
      }
      ambient.rustleTimer = setTimeout(rustle, 7000 + Math.random() * 11000);
    };

    // 3) 새소리 — 두세 음을 짧게 지저귑니다
    const BIRD = [[1800, 2300, 2050], [2400, 2100], [1600, 2000, 2400, 2100], [2600, 2200, 2600]];
    const bird = () => {
      if (!ambient) return;
      if (!muted && night.mix < 0.4) {
        const phrase = BIRD[Math.floor(Math.random() * BIRD.length)];
        const t0 = actx.currentTime + Math.random() * 0.2;
        const far = 0.3 + Math.random() * 0.7;
        phrase.forEach((f, k) => {
          const o = actx.createOscillator(), g = actx.createGain(), lp = actx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = 5200;
          o.type = 'sine';
          const at = t0 + k * (0.09 + Math.random() * 0.05);
          o.frequency.setValueAtTime(f * (0.97 + Math.random() * 0.06), at);
          o.frequency.exponentialRampToValueAtTime(f * 1.12, at + 0.07);
          g.gain.setValueAtTime(0.0001, at);
          g.gain.exponentialRampToValueAtTime(0.016 * far, at + 0.015);
          g.gain.exponentialRampToValueAtTime(0.0001, at + 0.13);
          o.connect(lp).connect(g).connect(out);
          o.start(at);
          o.stop(at + 0.2);
        });
      }
      ambient.birdTimer = setTimeout(bird, 7000 + Math.random() * 14000);
    };

    // 4) 멀리서 울리는 풍경 소리 — 아주 가끔
    const chimeFar = () => {
      if (!ambient) return;
      if (!muted) {
        const f = [784, 880, 1046.5][Math.floor(Math.random() * 3)];
        pluck(f, 0.028, 7.5);
        if (Math.random() < 0.5) pluck(f * 1.5, 0.018, 4.5, 0.35);
      }
      ambient.chimeTimer = setTimeout(chimeFar, 15000 + Math.random() * 18000);
    };

    // 5) 풀벌레 — 해가 지고 나면 커집니다
    const cricket = () => {
      if (!ambient) return;
      if (!muted) {
        const t0 = actx.currentTime;
        const vol = 0.008 + night.mix * 0.016;
        for (let k = 0; k < 3; k++) {
          const o = actx.createOscillator(), g = actx.createGain();
          o.type = 'triangle';
          o.frequency.value = 2400 + Math.random() * 900;
          g.gain.setValueAtTime(0.0001, t0 + k * 0.09);
          g.gain.exponentialRampToValueAtTime(vol, t0 + k * 0.09 + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + k * 0.09 + 0.06);
          o.connect(g).connect(out);
          o.start(t0 + k * 0.09);
          o.stop(t0 + k * 0.09 + 0.09);
        }
      }
      ambient.cricketTimer = setTimeout(cricket, 5000 + Math.random() * 10000);
    };

    // 6) 잔잔하고 따뜻한 음악 — 드론(웅) 없이, 오르골 같은 음이 띄엄띄엄 이어집니다
    const MEL = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25];   // 도레미솔라도
    let mi = 2;
    const tune = () => {
      if (!ambient) return;
      const busy = starTimer || healingTimer;                    // 별 보기 · 힐링 음악 중엔 쉼
      if (!muted && !busy) {
        mi = Math.max(0, Math.min(MEL.length - 1, mi + [-2, -1, -1, 1, 1, 2][Math.floor(Math.random() * 6)]));
        pluck(MEL[mi], 0.026, 3.6);
        if (Math.random() < 0.3) pluck(MEL[mi] / 2, 0.016, 4.5, 0.02);           // 가끔 낮은 음을 함께
        if (Math.random() < 0.25) pluck(MEL[Math.min(MEL.length - 1, mi + 2)], 0.014, 3, 0.45);
      }
      ambient.tuneTimer = setTimeout(tune, 1800 + Math.random() * 2200 + (Math.random() < 0.15 ? 4000 : 0));
    };

    ambient = { out, rustleTimer: null, birdTimer: null, chimeTimer: null, cricketTimer: null, tuneTimer: null };
    ambient.tuneTimer = setTimeout(tune, 3500);
    ambient.rustleTimer = setTimeout(rustle, 2500);
    ambient.birdTimer = setTimeout(bird, 1800);
    ambient.chimeTimer = setTimeout(chimeFar, 12000);
    ambient.cricketTimer = setTimeout(cricket, 6000);
  }

  // 별 보기 음악 — 아주 느린 오르골. 누워 있는 동안에만 흐릅니다.
  let starTimer = null, starStep = 0;
  const STAR_NOTES = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.26, 783.99];
  function startStarMusic() {
    if (starTimer || !actx) return;
    starStep = 0;
    const play = () => {
      if (!starTimer) return;
      if (!muted) {
        const i = Math.max(0, Math.min(STAR_NOTES.length - 1,
          Math.round(4 + Math.sin(starStep * 0.7) * 3 + (Math.random() - 0.5) * 2)));
        pluck(STAR_NOTES[i], 0.075, 5.5);
        if (starStep % 4 === 0) pluck(STAR_NOTES[Math.max(0, i - 4)] / 2, 0.05, 7);   // 낮은 받침음
        if (Math.random() < 0.3) pluck(STAR_NOTES[Math.min(STAR_NOTES.length - 1, i + 2)], 0.045, 4.5, 0.6);
      }
      starStep++;
      starTimer = setTimeout(play, 1700 + Math.random() * 900);
    };
    starTimer = setTimeout(play, 300);
  }
  function stopStarMusic() {
    if (starTimer) clearTimeout(starTimer);
    starTimer = null;
  }

  // ------------------------------------------------------------------
  // 효과
  // ------------------------------------------------------------------
  const floaters = [];
  // 응원봉 — 무지개색이 막대를 따라 흐르며 빛납니다 (블룸 효과로 은은하게 번짐)
  const stickHandleGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.16, 10);
  stickHandleGeo.userData.shared = true;   // 여러 응원봉이 함께 씀 — 정리할 때 지우지 않게
  function makeGlowStick() {
    const g = new THREE.Group();
    g.add(mesh(stickHandleGeo, mat('#2b2b3a', { roughness: 0.5 }), 0, -0.27, 0));
    const tubeGeo = new THREE.CapsuleGeometry(0.05, 0.42, 6, 14);
    const n = tubeGeo.attributes.position.count;
    tubeGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const tube = new THREE.Mesh(tubeGeo, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
    tube.position.y = -0.62;
    const halo = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.48, 4, 12),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    halo.position.y = -0.62;
    // 막대 둘레로 은은하게 번지는 빛무리
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: '#ffffff', transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    glow.position.y = -0.62;
    glow.scale.set(0.9, 1.25, 1);
    g.add(tube, halo, glow);
    g.userData = { tube, halo, glow };
    tintStick(g, 0);
    return g;
  }
  const _hsl = new THREE.Color();
  function tintStick(g, t) {
    const { tube, halo } = g.userData;
    const pos = tube.geometry.attributes.position, col = tube.geometry.attributes.color;
    for (let i = 0; i < pos.count; i++) {
      const y = (pos.getY(i) + 0.26) / 0.52;               // 0(손잡이 쪽) ~ 1(끝)
      _hsl.setHSL(((y * 0.85 - t * 0.45) % 1 + 1) % 1, 1, 0.55);
      col.setXYZ(i, _hsl.r * 1.15, _hsl.g * 1.15, _hsl.b * 1.15);   // 너무 밝으면 하얗게 날아갑니다
    }
    col.needsUpdate = true;
    halo.material.color.setHSL(((-t * 0.45) % 1 + 1) % 1, 1, 0.6);
    const { glow } = g.userData;
    glow.material.color.setHSL(((0.4 - t * 0.45) % 1 + 1) % 1, 1, 0.6);
    glow.material.opacity = 0.45 + Math.sin(t * 3.1) * 0.1;      // 숨 쉬듯 살짝
  }
  // 주변을 비추는 빛 하나 — 미리 만들어 두고 옮겨 씁니다
  //   (빛을 그때그때 새로 만들면 화면이 잠깐 멈칫합니다)
  const stickLight = new THREE.PointLight('#ffffff', 0, 6, 2);
  scene.add(stickLight);
  const _stickPos = new THREE.Vector3();
  function updateStickLight(dt) {
    const s2 = player.userData.stickObj;
    if (s2) {
      s2.userData.tube.getWorldPosition(_stickPos);
      stickLight.position.copy(_stickPos);
      stickLight.color.copy(s2.userData.glow.material.color);
    }
    stickLight.intensity = lerp(stickLight.intensity, s2 ? 3.2 : 0, Math.min(1, dt * 4));
  }
  // 번호로 고르기 — labels: 버튼 글자 배열, onPick(i)
  let pickTags = [];
  function pickFrom(title, labels, onPick, tags = []) {
    const box = $('#pick');
    $('#pick-title').textContent = title;
    for (const tg of pickTags) tg.visible = false;          // 이전에 보이던 번호표는 숨기고
    pickTags = tags.filter(Boolean);
    for (const tg of pickTags) tg.visible = true;           // 고르는 동안만 번호표를 띄웁니다
    const close = () => { box.classList.remove('show'); clearTimeout(box._t); for (const tg of pickTags) tg.visible = false; pickTags = []; };
    $('#pick-list').replaceChildren(...labels.map((lb, i) => {
      const b = el('button', { type: 'button', textContent: lb });
      b.onclick = () => { close(); onPick(i); };
      return b;
    }));
    $('#pick-cancel').onclick = close;
    box.classList.add('show');
    clearTimeout(box._t);
    box._t = setTimeout(close, 15000);
  }
  // 지금 들어와 있는 사람들 (닉네임 목록용)
  let presentIds = [];
  function renderWho() {
    const box = $('#who');
    const rows = [el('div', { className: 'me-row', textContent: `${me.name} (나)` })];
    let waiting = 0;
    for (const id of presentIds) {
      if (id === me.id) continue;
      const o = others.get(id);
      if (o && o.name) rows.push(el('div', { textContent: o.name }));
      else waiting++;
    }
    if (waiting) rows.push(el('div', { className: 'sub', textContent: `들어오는 중 ${waiting}명` }));
    rows.push(el('div', { className: 'sub', textContent: `둘러보는 이웃(NPC) ${npcs.length}명은 빼고 셌어요` }));
    box.replaceChildren(...rows);
  }
  // hold: 머리 위에 머무는 시간(초). 0 이면 바로 떠오르며 사라집니다.
  function floatEmoji(emoji, pos, size = 0.8, hold = 0) {
    const s = emojiSprite(emoji, size);
    s.position.copy(pos);
    scene.add(s);
    floaters.push({ s, t: 0, vx: hold ? 0 : (Math.random() - 0.5) * 0.4, hold, base: s.scale.clone() });
  }
  // 물주기 — 하늘에서 떨어지는 게 아니라, 물뿌리개가 기울어 물줄기가 쏟아집니다.
  const drops = [], splashes = [];
  let canObj = null, pour = null;
  const dropGeo = new THREE.CapsuleGeometry(0.019, 0.1, 3, 6);
  const dropMat = new THREE.MeshStandardMaterial({ color: '#cdeeff', emissive: '#7fc4e8', emissiveIntensity: 0.5, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.6, depthWrite: false });
  const ringGeo = new THREE.RingGeometry(0.06, 0.1, 18);
  function makeWateringCan() {
    const g = new THREE.Group();
    const metal = mat('#8fa6b8', { roughness: 0.35, metalness: 0.6, envMapIntensity: 1 });
    g.add(mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.42, 16), metal, 0, 0, 0));
    const rim2 = mesh(new THREE.TorusGeometry(0.3, 0.025, 6, 18), metal, 0, 0.2, 0);
    rim2.rotation.x = Math.PI / 2;
    g.add(rim2);
    const handle = mesh(new THREE.TorusGeometry(0.17, 0.028, 6, 16, Math.PI), metal, 0, 0.22, -0.08);
    handle.rotation.y = Math.PI / 2;
    g.add(handle);
    const spout = mesh(new THREE.CylinderGeometry(0.045, 0.075, 0.62, 10), metal, 0.3, 0.1, 0);
    spout.rotation.z = -0.9;
    g.add(spout);
    g.add(mesh(new THREE.CylinderGeometry(0.1, 0.07, 0.07, 12), metal, 0.54, 0.29, 0));
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }
  // 물조리개를 손에 쥐여 줍니다 (멀리서 혼자 떠다니지 않게)
  function giveCan(av) {
    const u = av.userData;
    if (u.can) return u.can;
    const can = makeWateringCan();
    can.scale.setScalar(0.62);
    can.position.set(0.02, -0.3, 0.16);
    can.rotation.set(0, -1.1, 0);
    u.arms[1].elbow.add(can);
    u.can = can;
    return can;
  }
  function takeCan(av) {
    const u = av.userData;
    if (!u.can) return;
    u.can.parent.remove(u.can);
    u.can = null;
  }
  function waterEffect(byMe = true, pot = null) {
    const gh = byType('greenhouse')[0];
    if (!gh) return;
    const target = pot || (gh.state.pots || []).find((q) => q.central);
    const world = target ? target.local.clone().applyMatrix4(gh.group.matrixWorld) : new THREE.Vector3(gh.x, 1.08, gh.z);
    if (!target || target.central) gh.state.shake = 1;        // 가운데 화분이면 큰 잎이 떨립니다
    if (target && target.bush) target.bush.userData.shake = 1;
    waterSound();
    if (byMe) {
      giveCan(player);
      player.userData.watering = 2.6;        // 팔을 앞으로 내밀어 기울입니다
      pour = { t: 0, gh, hand: true, landY: world.y, bush: target && target.bush, aim: world.clone() };
    } else {
      pour = { t: 0, gh, hand: false, landY: world.y, bush: target && target.bush, aim: world.clone(),
        spout: world.clone().add(new THREE.Vector3(0.5, 1.2, 0.3)) };
    }
  }
  // 클릭한 자리에 잠깐 동그라미 — 어디로 가는지 보이게
  const marks = [];
  function markSpot(v) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#fff4d8', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    m.position.set(v.x, groundY(v.x, v.z) + 0.07, v.z);
    m.rotation.x = -Math.PI / 2;
    m.scale.setScalar(2.4);
    scene.add(m);
    marks.push({ m, t: 0 });
  }
  function splash(x, y, z) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#bfeaff', transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }));
    m.position.set(x, y + 0.01, z);
    m.rotation.x = -Math.PI / 2;
    scene.add(m);
    splashes.push({ m, t: 0 });
  }
  // 정자 풍경 — 맑은 종소리 몇 번, 종이 흔들립니다
  function ringChime(byMe, soft = 1) {
    if (!stream.pav) return;
    stream.pav.swing = Math.max(stream.pav.swing, soft);
    ensureAudio();
    if (!muted && actx) {
      const notes = soft < 1 ? [1046.5, 1568] : [1046.5, 1318.5, 1568, 1174.7];
      notes.forEach((f, k) => setTimeout(() => pluck(f, (byMe ? 0.06 : 0.035) * soft, 5.5), k * 260 + Math.random() * 80));
    }
  }
  // 공 던지기 — 강아지 쪽을 바라보고 팔을 휘둘러 던집니다.
  //   땅에 닿으면 통통 튀다가 데굴데굴 굴러, 멍냥 쉼터 울타리 안에서 멈춥니다.
  //   (예전: 바라보던 방향으로 미사일처럼 날아가 그 자리에 '착륙')
  let ball = null;
  const BALL_R = 0.14;
  function throwBall(target) {
    if (!ball) {
      ball = mesh(new THREE.SphereGeometry(BALL_R, 16, 12), mat('#ffd166', { roughness: 0.5 }), 0, 0, 0);
      // 구르는 게 보이도록 테니스공 줄무늬
      const seam = mesh(new THREE.TorusGeometry(BALL_R * 1.005, 0.012, 6, 24), mat('#fff6dc', { roughness: 0.6 }), 0, 0, 0);
      seam.rotation.x = 0.6;
      ball.add(seam);
      ball.castShadow = true;
      scene.add(ball);
    }
    // 던질 상대 — 고른 동물 (그 동물 쪽을 바라보고 던집니다)
    const dog = target || null;
    if (dog) {
      // 너무 멀거나 가까우면 그 동물에게서 약 4m 떨어진 쪽으로 옮겨 섭니다 (쉼터 안)
      const away = new THREE.Vector3(player.position.x - dog.obj.position.x, 0, player.position.z - dog.obj.position.z);
      const dd = away.length();
      if (dd > 6 || dd < 2.5) {
        if (away.lengthSq() < 0.01) away.set(0, 0, 1);
        away.normalize();
        const stand = keepInCafe(dog.obj.position.clone().addScaledVector(away, 4), 6.0);
        player.position.set(stand.x, standY(stand.x, stand.z), stand.z);
        pushOut(player.position);
      }
    }
    const aim = dog ? dog.obj.position : new THREE.Vector3(petCafe.x, 0, petCafe.z + 1);
    const dir = new THREE.Vector3(aim.x - player.position.x, 0, aim.z - player.position.z);
    if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
    const dist = clamp(dir.length(), 2.2, 4.2);          // 화면 안에서 보이도록 가깝게 (예전 3~7m)
    dir.normalize();
    moveTarget = null;
    player.rotation.y = Math.atan2(dir.x, dir.z);
    frontView(player.rotation.y, { dist: 5.2, pitch: 0.28, offs: [1.0, -1.0, 1.4, -1.4, 0.6, -0.6] });   // 던지는 내 모습이 보이게
    if (player.userData.pose !== 'stand') setPose('stand');
    player.userData.gesture = { type: 'throw', t: 0, dur: 1.0 };
    ball.visible = false;
    ball.userData.flight = ball.userData.roll = ball.userData.carriedBy = null;
    if (dog) { dog.state = 'watch'; dog.obj.rotation.y = Math.atan2(player.position.x - dog.obj.position.x, player.position.z - dog.obj.position.z); }
    // 팔을 뒤로 젖혔다 앞으로 휘두르는 순간(0.42초)에 손을 떠납니다
    setTimeout(() => {
      const from = player.position.clone().addScaledVector(dir, 0.3);
      from.y += 1.75;
      const land = player.position.clone().addScaledVector(dir, dist * 0.7);
      keepInCafe(land, 4.2);           // 울타리보다 안쪽에 떨어지게
      land.y = groundY(land.x, land.z) + BALL_R;
      ball.position.copy(from);
      ball.visible = true;
      const speed0 = 0.6 * 1.8;                 // 살짝 — 약 0.6m 굴러가다 멈춥니다 (감속 1.8/초)
      ball.userData.flight = { from, to: land, t: 0, dur: 0.75, h: 1.1, vx: dir.x * speed0, vz: dir.z * speed0 };
      ball.userData.thrownTo = dog;              // 이 동물이 공이 멈추길 기다렸다가 가지러 갑니다
      // 다른 강아지들도 고개를 돌립니다
    }, 420);
    toast('공을 던졌어요 🎾', 1800);
  }
  // 멍냥 쉼터 울타리(반지름 r) 안으로, 가게 벽 앞으로
  function keepInCafe(v, r = 6.5) {
    const dx = v.x - petCafe.x, dz = v.z - petCafe.z, d = Math.hypot(dx, dz);
    if (d > r) { v.x = petCafe.x + dx / d * r; v.z = petCafe.z + dz / d * r; }
    if (v.z - petCafe.z < -2.6 && Math.abs(v.x - petCafe.x) < 3.0) v.z = petCafe.z - 2.6;
    return v;
  }
  const _spinAxis = new THREE.Vector3();
  function updateBall(dt) {
    if (!ball || !ball.visible) return;
    const u = ball.userData;
    if (u.carriedBy) {                         // 강아지가 물고 있음
      const o = u.carriedBy.obj;
      ball.position.set(o.position.x + Math.sin(o.rotation.y) * 0.5, o.position.y + 0.42, o.position.z + Math.cos(o.rotation.y) * 0.5);
      return;
    }
    let vx = 0, vz = 0;
    if (u.flight) {
      const f = u.flight;
      f.t += dt / f.dur;
      const e = Math.min(1, f.t);
      ball.position.lerpVectors(f.from, f.to, e);
      ball.position.y = lerp(f.from.y, f.to.y, e) + Math.sin(e * Math.PI) * f.h;
      vx = (f.to.x - f.from.x) / f.dur; vz = (f.to.z - f.from.z) / f.dur;
      if (e >= 1) { u.flight = null; u.roll = { vx: f.vx, vz: f.vz, hop: 0.32, hopT: 0 }; }
    } else if (u.roll) {
      const r = u.roll;
      ball.position.x += r.vx * dt;
      ball.position.z += r.vz * dt;
      const decay = Math.exp(-1.8 * dt);
      r.vx *= decay; r.vz *= decay;
      // 울타리에 닿으면 튕겨 나옵니다
      const dx = ball.position.x - petCafe.x, dz = ball.position.z - petCafe.z, d = Math.hypot(dx, dz);
      if (d > 6.2) {   // 울타리 안쪽에서 멈추게 — 넘어가지 않습니다
        const nx = dx / d, nz = dz / d, vn = r.vx * nx + r.vz * nz;
        if (vn > 0) { r.vx -= 1.6 * vn * nx; r.vz -= 1.6 * vn * nz; }
        ball.position.x = petCafe.x + nx * 6.2; ball.position.z = petCafe.z + nz * 6.2;
      }
      // 가게 벽
      if (ball.position.z - petCafe.z < -2.6 && Math.abs(ball.position.x - petCafe.x) < 3.0) {
        ball.position.z = petCafe.z - 2.6;
        if (r.vz < 0) r.vz = -r.vz * 0.5;
      }
      // 착지 직후 통통 — 점점 낮게
      r.hopT += dt;
      r.hop *= Math.exp(-2.6 * dt);
      ball.position.y = groundY(ball.position.x, ball.position.z) + BALL_R + Math.abs(Math.sin(r.hopT * 9)) * r.hop;
      vx = r.vx; vz = r.vz;
      if (Math.hypot(r.vx, r.vz) < 0.05 && r.hop < 0.01) u.roll = null;   // 멈춤
    }
    // 굴러가는 방향으로 회전 (미끄러지지 않고 '데굴데굴')
    const sp = Math.hypot(vx, vz);
    if (sp > 0.01 && !u.flight) {
      _spinAxis.set(vz, 0, -vx).normalize();
      ball.rotateOnWorldAxis(_spinAxis, (sp * dt) / BALL_R);
    } else if (u.flight) ball.rotation.x += dt * 8;
  }

  // 손에 컵 쥐여 주기 — 마시는 동작은 animateAvatar 가 맡습니다
  function giveCup(av) {
    const u = av.userData;
    u.drink = 8;
    if (u.cup) return;
    const cup = new THREE.Group();
    cup.add(mesh(new THREE.CylinderGeometry(0.072, 0.058, 0.12, 12), mat('#fdfbf6', { roughness: 0.35 }), 0, 0, 0));
    cup.add(mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.015, 12), mat('#8a5a3a', { roughness: 0.3 }), 0, 0.05, 0));
    const handle = mesh(new THREE.TorusGeometry(0.035, 0.009, 6, 10), mat('#fdfbf6', { roughness: 0.35 }), 0.075, 0, 0);
    handle.rotation.y = Math.PI / 2;
    cup.add(handle);
    // 손잡이를 잡게 — 손(주먹) 자리에 '받침'을 두고, 컵은 손 앞쪽에 손잡이가 손을 향하도록 놓습니다.
    //   (예전엔 컵 몸통 한가운데를 주먹으로 쥐어서 아령을 든 것처럼 보였음)
    cup.rotation.y = Math.PI / 2;                 // 손잡이(+x) → 손 쪽(뒤)
    cup.position.set(0, 0.03, 0.115);             // 손 앞에, 손잡이가 손에 닿게
    const hold = new THREE.Group();
    hold.position.set(0, -0.24, 0);               // 주먹 자리
    hold.add(cup);
    u.arms[1].elbow.add(hold);
    u.cup = hold;
  }
  function takeCup(av) {
    const u = av.userData;
    if (!u.cup) return;
    u.cup.parent.remove(u.cup);
    u.cup = null;
  }
  function flashKey(i) {
    const mu = byType('music')[0];
    if (!mu) return;
    const k = mu.state.keys[i];
    k.material.emissive.set('#ffb860');
    k.position.y = 1.81;
    setTimeout(() => { k.material.emissive.set('#000000'); k.position.y = 1.86; }, 220);
    const b = document.querySelector(`#panel .keys button[data-i="${i}"]`);
    if (b) { b.classList.add('on'); setTimeout(() => b.classList.remove('on'), 200); }
  }

  // ------------------------------------------------------------------
  // 행동
  // ------------------------------------------------------------------
  const cooldown = {};
  function cool(name, ms) {
    const now = Date.now();
    if (cooldown[name] && now - cooldown[name] < ms) {
      toast('조금만 천천히 해 볼까요? 🙂', 1500);
      return false;
    }
    cooldown[name] = now;
    return true;
  }
  let camMode = 'follow'; // follow | lie
  let moveTarget = null;
  let sitLift = 0;        // 벤치 · 연못 테두리처럼 '올라앉는' 높이
  let blockedMsg = 0;
  let crouchT = 0;
  function crouchDown(sec) {
    sitLift = 0;
    setPose('crouch');
    crouchT = sec;
  }
  function setPose(pose) {
    if (pose === 'stand') { sitLift = 0; crouchT = 0; takeCup(player); player.userData.atPiano = false; if (player.userData.meditate) stopBreath(); }
    player.userData.pose = pose;
    if (pose === 'stand' && currentPlace) showPanel(currentPlace, true);
    if (pose !== 'lie') camMode = 'follow';
    netDirty = true;
  }
  const GESTURE_DUR = { wave: 2.2, bow: 2.2, pat: 2.2, dance: 6, stick: 6, rps: 3.2 };
  function gesture(type) {
    if (type === 'dance' && player.userData.pose !== 'stand') { toast('일어선 뒤에 출 수 있어요', 1500); return; }
    player.userData.gesture = { type, t: 0, dur: GESTURE_DUR[type] };
    store.send('act', { id: me.id, type });
    // 춤이나 응원봉은 가까이 있는 이웃들도 따라 합니다
    if (type === 'dance' || type === 'stick') {
      for (const n of npcs) {
        if (n.av.userData.pose !== 'stand' || n.av.position.distanceTo(player.position) > 9) continue;
        n.wait = Math.max(n.wait, GESTURE_DUR[type] + 1);
        faceTo(n.av, player);
        setTimeout(() => { n.av.userData.gesture = { type, t: 0, dur: GESTURE_DUR[type] }; }, 300 + Math.random() * 700);
      }
    }
  }
  function faceTo(av, target) {
    const ry = Math.atan2(target.position.x - av.position.x, target.position.z - av.position.z);
    av.rotation.y = ry;
    // 내 캐릭터면 바로 상대에게 알립니다 (예전엔 제자리에서 돌기만 하면 방향을 보내지 않아
    //   상대 화면에서는 서로 마주 보지 않았음)
    if (av === player) { netDirty = true; netTimer = 1; }
    // 다른 접속자 캐릭터는 매 프레임 받은 방향(o.ry)으로 돌아가므로 그 값도 바꿔 둡니다
    for (const o of others.values()) if (o.av === av) o.ry = ry;
  }

  // ---------------- 가위바위보 — 가까이 있는 사람(이웃 · 다른 접속자)과
  const RPS_E = ['✌️', '✊', '🖐️'], RPS_N = ['가위', '바위', '보'];
  const rpsBeat = (a, b) => (a === b ? 0 : ((a - b + 3) % 3 === 1 ? 1 : -1));   // 1 이면 a 승
  const rpsPick = (v) => ([0, 1, 2].includes(v) ? v : 0);
  let rpsPending = null;
  function nearestPartner(maxD = 7) {
    let best = null, bd = maxD;
    for (const [id, o] of others) {
      const d = o.av.position.distanceTo(player.position);
      if (d < bd) { bd = d; best = { kind: 'user', id, av: o.av, name: o.name || '손님' }; }
    }
    for (const n of npcs) {
      const d = n.av.position.distanceTo(player.position);
      if (d < bd) { bd = d; best = { kind: 'npc', n, av: n.av, name: n.name || '이웃' }; }
    }
    return best;
  }
  function openRps(title, onPick, ms = 12000) {
    const box = $('#rps');
    $('#rps-title').textContent = title;
    box.classList.add('show');
    const btns = box.querySelectorAll('[data-pick]');
    const close = () => { box.classList.remove('show'); clearTimeout(box._t); btns.forEach((b) => { b.onclick = null; }); };
    btns.forEach((b) => { b.onclick = () => { close(); onPick(Number(b.dataset.pick)); }; });
    $('#rps-cancel').onclick = close;
    clearTimeout(box._t);
    box._t = setTimeout(close, ms);
  }
  // A 와 B 가 함께 "가위 바위 보!" — 1.5초 뒤 머리 위에 낸 손이 뜹니다. mySide: 'a' | 'b' | null
  function rpsShow(avA, pa, avB, pb, mySide) {
    if (avA && avB) { faceTo(avA, avB); faceTo(avB, avA); }      // 두 사람이 서로 마주 봅니다
    for (const av of [avA, avB]) if (av) av.userData.gesture = { type: 'rps', t: 0, dur: GESTURE_DUR.rps };
    sayBubble(avA, '가위, 바위, 보!');
    setTimeout(() => {
      // 말풍선은 걷고, 낸 손을 '바로 머리 위'(2.3m)에 띄워 2초쯤 보여 준 뒤 천천히 올라갑니다.
      //   (2.9m 는 말풍선보다 높아서, 카메라가 가까우면 화면 위로 잘려 나갔습니다)
      const clearBubble = (av) => { const u2 = av.userData; if (u2.bubble) { av.remove(u2.bubble); u2.bubble = null; } };
      const up = new THREE.Vector3(0, 2.3, 0);
      clearBubble(avA);
      floatEmoji(RPS_E[pa], avA.position.clone().add(up), 0.85, 2.2);
      if (!avB) return;
      clearBubble(avB);
      floatEmoji(RPS_E[pb], avB.position.clone().add(up), 0.85, 2.2);
      const r = rpsBeat(pa, pb);
      if (r !== 0) setTimeout(() => floatEmoji('🎉', (r > 0 ? avA : avB).position.clone().add(new THREE.Vector3(0.45, 2.95, 0)), 0.7, 1.8), 450);
      if (mySide) {
        const mine = mySide === 'a' ? r : -r;
        const mp = mySide === 'a' ? pa : pb, tp = mySide === 'a' ? pb : pa;
        toast(`나 ${RPS_N[mp]} · 상대 ${RPS_N[tp]} — ` + (mine > 0 ? '이겼어요! 🎉' : mine < 0 ? '졌어요 😆' : '비겼어요! 한 번 더?'), 3200);
      }
    }, 1500);
  }
  function startRps() {
    if (rpsPending) { toast('상대가 고르기를 기다리는 중이에요', 1500); return; }
    if (player.userData.pose !== 'stand') { toast('일어선 뒤에 할 수 있어요', 1500); return; }
    const p = nearestPartner(8);
    if (!p) { toast('가까이 있는 사람 곁으로 가서 해 보세요 ✌️ (8m 안)', 2400); return; }
    // 서로 마주 보고 할 수 있게, 상대 앞 2m 까지 다가갑니다
    {
      const d = new THREE.Vector3(player.position.x - p.av.position.x, 0, player.position.z - p.av.position.z);
      if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
      d.normalize();
      const stand = p.av.position.clone().addScaledVector(d, 2.0);
      player.position.set(stand.x, standY(stand.x, stand.z), stand.z);
      pushOut(player.position);
      moveTarget = null;
      // 카메라는 옆에서 — 두 사람이 화면 왼쪽 · 오른쪽에 서서 말풍선 · 이름표가 겹치지 않습니다
      camYaw = Math.atan2(d.x, d.z) + Math.PI / 2;
      camPitch = 0.2;
      camDist = window.innerWidth < window.innerHeight ? 10 : 6.5;   // 휴대폰 세로 화면은 더 멀리서
    }
    faceTo(player, p.av);
    if (p.kind === 'npc') {
      p.n.wait = Math.max(p.n.wait, 14);           // 고르는 동안 기다려 줍니다
      faceTo(p.av, player);
      sayBubble(p.av, '좋아요!');
      openRps(`${p.name}님과 가위바위보!`, (i) => {
        const np = Math.floor(Math.random() * 3);
        p.n.wait = Math.max(p.n.wait, 5);
        rpsShow(player, i, p.av, np, 'a');
        store.send('act', { id: me.id, type: 'rpsShow', a: me.id, pa: i, b: null, pb: 0 });
      });
    } else {
      openRps(`${p.name}님과 가위바위보!`, (i) => {
        rpsPending = { to: p.id, pick: i };
        store.send('act', { id: me.id, type: 'rpsInvite', to: p.id, name: me.name });
        toast(`${p.name}님이 고르기를 기다려요…`, 3000);
        setTimeout(() => {
          if (rpsPending && rpsPending.to === p.id) { rpsPending = null; toast('대답이 없어요. 다음에 다시 해 봐요', 2200); }
        }, 15000);
      });
    }
  }

  async function writeMessage(kind) {
    const raw = await askText(kind === 'note' ? '소나무에 걸 응원 쪽지' : '하늘에 띄울 소원', kind === 'note' ? '예) 오늘도 수고 많았어' : '예) 다들 푹 잘 수 있기를');
    if (raw === null) return;
    const text = cleanText(raw);
    if (!text) { toast('남길 수 없는 내용이에요. 다른 말로 적어 볼까요?'); return; }
    if (!cool('write', 8000)) return;
    try {
      const item = await store.add(kind, text);
      if (kind === 'note') { addNoteMesh(item); toast('📝 쪽지를 소나무에 걸었어요'); }
      else { addStarMesh(item, player.position.clone().add(new THREE.Vector3(0, 1.5, 0))); toast('⭐ 소원 별이 하늘로 올라가요'); }
      refreshPanelInfo();
      chime();
    } catch (e) {
      console.warn(e);
      toast('저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
  }
  function readRandom(list, emoji, empty) {
    if (!list.length) { toast(empty); return; }
    toast(`${emoji} ${list[Math.floor(Math.random() * list.length)].text}`, 4000);
  }

  let breathTimer = null;
  function startBreath() {
    if (player.userData.pose !== 'sit') setPose('sit');
    const ov = $('#breath'), circle = $('#breath-circle'), text = $('#breath-text');
    ov.classList.add('show');
    const steps = [['천천히 들이쉬어요', 4000, 1], ['잠시 멈춰요', 2000, 1], ['길게 내쉬어요', 6000, 0.6]];
    let i = 0;
    const run = () => {
      const [t, ms, sc] = steps[i % steps.length];
      text.textContent = t;
      circle.style.transitionDuration = ms + 'ms';
      circle.style.transform = `scale(${sc})`;
      i++;
      breathTimer = setTimeout(run, ms);
    };
    run();
  }
  let meditateTimer = null;
  function stopBreath() {
    clearInterval(meditateTimer);
    const wasMeditating = player && player.userData.meditate;
    if (player) player.userData.meditate = false;
    if (wasMeditating) setTimeout(() => {
      // 방석 위에 어설프게 남지 않게 — 방석 앞으로 한 걸음 나와서 일어섭니다 (다리가 방석에 묻히지 않게)
      const fy = player.rotation.y;
      player.position.x += Math.sin(fy) * 1.2;
      player.position.z += Math.cos(fy) * 1.2;
      setPose('stand');
    }, 0);
    clearTimeout(breathTimer);
    $('#breath').classList.remove('show');
    $('#breath-circle').style.transform = 'scale(.6)';
  }

  let counterDay = today();
  async function bump(name) {
    try {
      if (name === 'water' && today() !== counterDay) {   // 자정을 넘겨 머물렀으면 큰 나무도 오늘 새싹부터
        counterDay = today();
        counters.water = 0;
      }
      const v = await store.incCounter(name);
      applyCounter(name, v);
      store.send('act', { id: me.id, type: 'counter', name, value: v, day: counterDay });
    } catch (e) { console.warn(e); toast('저장하지 못했어요. 잠시 후 다시 시도해 주세요.'); }
  }

  // 상호작용할 때 '앞모습'이 보이는 시점 — faceYaw(캐릭터가 바라보는 방향) 앞쪽 여러 각도를
  // 실제로 비춰 보고, 벽 · 기둥에 막히지 않는 것 중 정면에 가장 가까운 각도를 고릅니다.
  function frontView(faceYaw, { dist = 5, pitch = 0.24, offs = [0.5, -0.5, 0.9, -0.9, 1.3, -1.3, 1.7, -1.7] } = {}) {
    const eye = new THREE.Vector3(player.position.x, player.position.y + 1.5, player.position.z);   // 실제 카메라와 같은 높이에서 시험
    let pick = offs[0], bestFree = -1;
    for (const off of offs) {
      const a = faceYaw + off;
      camRay.set(eye, new THREE.Vector3(Math.sin(a) * Math.cos(pitch), Math.sin(pitch), Math.cos(a) * Math.cos(pitch)));
      camRay.far = dist + 0.3;
      const h = camRay.intersectObjects(occluders.concat(viewBlockers), false)[0];
      if (!h) { pick = off; break; }
      if (h.distance > bestFree) { bestFree = h.distance; pick = off; }   // 모두 막히면 가장 트인 쪽
    }
    camYaw = faceYaw + pick;
    camPitch = pitch;
    camDist = dist;
  }
  function goTo(local, place) {
    const w = local.clone().applyMatrix4(place.group.matrixWorld);
    player.position.set(w.x, standY(w.x, w.z), w.z);
    moveTarget = null;
  }

  let rainOn = false;
  const actions = {
    hill: (p) => [
      ['🧘 벤치에 앉아 숨 고르기', () => {
        // 아무 데나 앉지 않고 벤치로 가서 앉습니다
        goTo(p.state.benchLocal, p);
        moveTarget = null;
        sitLift = 0.55;     // 언덕 벤치 좌석 높이
        setPose('sit');
        const look = p.state.benchLookLocal.clone().applyMatrix4(p.group.matrixWorld);
        player.rotation.y = Math.atan2(look.x - player.position.x, look.z - player.position.z);
        camYaw = Math.atan2(-(look.x - player.position.x), -(look.z - player.position.z));
        camPitch = 0.25;
        camDist = 6.5;
        startBreath();
      }],
      ['📝 쪽지 걸기', () => writeMessage('note')],
      ['📜 쪽지 하나 읽기', () => readRandom(notes, '📝', '아직 걸린 쪽지가 없어요. 첫 쪽지를 걸어 볼까요?')],
    ],
    greenhouse: (p) => [
      ['💧 물 주기', () => {
        const pots = p.state.pots || [];
        const full = (q) => (q.central ? counters.water >= TREE_FULL : (q.level || 0) >= POT_FULL);
        pickFrom('어느 화분에 물을 줄까요?', pots.map((q, i) => (q.central ? '★ 큰 화분' : String(i + 1)) + (full(q) ? ' ✓' : '')), (i) => {
          // (번호표는 고르는 동안만 보입니다 — 아래 pots.map((q) => q.tag))
          const best = pots[i];
          // 다 자란 화분은 더 주지 않습니다
          if (full(best)) {
            toast(best.central ? '오늘은 큰 나무가 다 자랐어요 🌸 내일 다시 새싹부터 함께 키워요' : `${i + 1}번 화분은 다 자랐어요 🌼 다른 화분은 어때요?`, 2600);
            return;
          }
          if (!cool('water', 2500)) return;
          const bestW = best.local.clone().applyMatrix4(p.group.matrixWorld);
          // 선반 화분은 '가까운 통로'에 섭니다 — 안쪽 줄은 가운데 통로, 바깥 줄은 유리벽 쪽 통로.
          //   (화분에서 아무 방향으로 물러서면 선반에 부딪혀 옆으로 밀려나, 테이블에 물을 주게 됩니다)
          let stand;
          if (!best.central) {
            const lx = best.local.x, side = Math.sign(lx);
            const aisleX = Math.abs(lx) < 4 ? side * 2.55 : side * 5.45;
            stand = new THREE.Vector3(aisleX, 0, best.local.z).applyMatrix4(p.group.matrixWorld);
          } else {
            const dir = new THREE.Vector3(player.position.x - bestW.x, 0, player.position.z - bestW.z);
            if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
            dir.normalize();
            stand = bestW.clone().addScaledVector(dir, 1.6);
          }
          player.position.set(stand.x, standY(stand.x, stand.z), stand.z);
          pushOut(player.position);
          moveTarget = null;
          const ddx = bestW.x - player.position.x, ddz = bestW.z - player.position.z;
          player.rotation.y = Math.atan2(ddx, ddz);
          camYaw = Math.atan2(-ddx, -ddz) + 0.9;
          camPitch = 0.22;
          camDist = 5.2;
          waterEffect(true, best);
          chime();
          if (best.central) {
            bump('water');                       // 큰 화분은 모두가 준 물로 자랍니다
            toast(counters.water + 1 >= TREE_FULL ? '큰 나무가 다 자랐어요 🌸 고마워요!' : `큰 나무에 물을 주었어요 💧 (${counters.water + 1} / ${TREE_FULL})`, 2000);
          } else {
            growPot(i, true);
            setTimeout(() => floatEmoji('🌱', bestW.clone().add(new THREE.Vector3(0, 0.9, 0)), 0.45), 1400);
            toast(best.level >= POT_FULL ? `${i + 1}번 화분이 다 자랐어요 🌼` : `${i + 1}번 화분이 쑥 자랐어요 🌱 (${best.level} / ${POT_FULL})`, 2000);
          }
          store.send('act', { id: me.id, type: 'water', pot: i });
        }, pots.map((q) => q.tag));
      }],
    ],
    cafe: (p) => [
      ['🪟 창가에 앉기', () => {
        goTo(p.state.windowSeatLocal, p);
        moveTarget = null;
        sitLift = 0.61;     // 창가 스툴 높이
        setPose('sit');
        // 창을 등지고 '공원 쪽'을 바라보며 앉습니다 (벽만 보지 않게)
        const vp2 = p.state.viewLocal.clone().applyMatrix4(p.group.matrixWorld);
        const dx = vp2.x - player.position.x, dz = vp2.z - player.position.z;
        player.rotation.y = Math.atan2(dx, dz);
        // 카메라는 앞(공원 쪽)에서 비스듬히 — 뒷모습이 아니라 얼굴과 창가가 함께 보이게
        frontView(player.rotation.y, { dist: 5.6, pitch: 0.18, offs: [0.45, -0.45, 0.9, -0.9, 1.3, -1.3] });
        if (!rainOn) toggleRain(p);
      }],
      ['☕ 음료 마시기', () => {
        // 탁자 앞 의자에 바르게 앉아, 잔디와 노을을 보며 마십니다
        goTo(p.state.seatLocal, p);
        moveTarget = null;
        sitLift = 0.55;     // 카페 의자 높이
        setPose('sit');
        const vp = p.state.viewLocal.clone().applyMatrix4(p.group.matrixWorld);
        player.rotation.y = Math.atan2(vp.x - player.position.x, vp.z - player.position.z);
        frontView(player.rotation.y, { dist: 5.2, pitch: 0.22 });   // 앞에서 — 마시는 얼굴이 보이게
        giveCup(player);
        toast('노을을 보며 한 잔 ☕', 2600);
      }],
      [rainOn ? '☀ 비 그치게 하기' : '🌧 빗소리 켜기', () => toggleRain(p)],
      ['💛 수고했어 보내기', () => {
        if (!cool('cheer', 2500)) return;
        floatEmoji('💛', player.position.clone().add(new THREE.Vector3(0, 2.8, 0)));
        chime();
        bump('cheer');
        store.send('act', { id: me.id, type: 'cheer' });
      }],
    ],
    petcafe: (p) => {
      const pets = petCafe ? petCafe.state.pets : [];
      const choose = (title, fn) => pickFrom(title, pets.map((pt, i) => petTag(pt, i)), (i) => fn(pets[i]), pets.map((pt) => pt.tag));
      // 고른 동물 앞으로 가서 그 동물을 바라봅니다
      const goToPet = (pt, gap) => {
        const d = new THREE.Vector3(pt.obj.position.x - player.position.x, 0, pt.obj.position.z - player.position.z);
        if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
        d.normalize();
        // 서는 자리가 벽 · 기둥에 걸리면 동물의 다른 쪽(옆 · 반대편)에 섭니다
        let stand = null;
        for (const turn of [0, 0.8, -0.8, 1.6, -1.6, Math.PI]) {
          const dd = d.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), turn);
          const c = pt.obj.position.clone().addScaledVector(dd, -gap);
          const c2 = c.clone(); pushOut(c2);
          if (c2.distanceTo(c) < 0.05) { stand = c; d.copy(dd); break; }
        }
        if (!stand) { stand = pt.obj.position.clone().addScaledVector(d, -gap); pushOut(stand); }
        player.position.set(stand.x, standY(stand.x, stand.z), stand.z);
        moveTarget = null;
        d.set(pt.obj.position.x - stand.x, 0, pt.obj.position.z - stand.z).normalize();
        player.rotation.y = Math.atan2(d.x, d.z);
        // 카메라는 동물 쪽(앞)에서 비스듬히 — 내 얼굴과 동물이 함께 보이게
        frontView(Math.atan2(d.x, d.z), { dist: 4.6, pitch: 0.3, offs: [1.3, -1.3, 1.0, -1.0, 1.65, -1.65, 2.1, -2.1] });

        return d;
      };
      return [
        ['🍖 간식 주기', () => choose('누구에게 간식을 줄까요?', (pt) => {
          if (!cool('feed', 2000)) return;
          const d = goToPet(pt, 1.6);
          crouchDown(4.5);                                          // 쪼그려 앉아서
          player.userData.gesture = { type: 'pat', t: 0 };          // 손을 내려 놓아 줍니다
          const spot = player.position.clone().addScaledVector(d, 0.8);
          spot.y = standY(spot.x, spot.z);
          showTreat(spot);
          // 고른 한 마리만 다가와 먹습니다
          petCafe.state.feedSpot = spot;
          pt.state = 'come'; pt.mood = 'eat'; pt.happy = 0; pt.delay = 0.2; pt.phase = Math.random() * 6;
          chime();
          bump('happy');
          toast(`${petTag(pt, pets.indexOf(pt))}에게 간식을 주었어요 🍖`, 2200);
        })],
        ['🤲 쓰다듬기', () => choose('누구를 쓰다듬을까요?', (pt) => {
          if (!cool('pat', 1500)) return;
          goToPet(pt, 1.05);
          crouchDown(4.5);
          // 그 자리에 앉아 고개를 들고 꼬리를 흔듭니다
          pt.happy = 4;
          pt.mood = 'pet';
          pt.state = 'rest';
          pt.phase = Math.random() * 6;
          if (ball && ball.userData.carriedBy === pt) ball.userData.carriedBy = null;
          player.userData.gesture = { type: 'pat', t: 0 };
          floatEmoji('💖', pt.obj.position.clone().add(new THREE.Vector3(0, 0.9, 0)), 0.42);
          chime();
          bump('happy');
        })],
        ['🎾 공 던지기', () => choose('누구에게 공을 던질까요?', (pt) => {
          if (!petCafe || !cool('ball', 2500)) return;
          throwBall(pt);
        })],
      ];
    },
    pavilion: (p) => [
      ['🧘 명상하기', () => {
        // 정자 벤치에 앉아 눈을 감고, 숨 고르기 안내에 맞춰 풍경이 은은하게 울립니다
        const pv = stream.pav;
        const w = pv.benchLocal.clone().applyMatrix4(pv.group.matrixWorld);
        player.position.set(w.x, standY(w.x, w.z), w.z);
        moveTarget = null;
        sitLift = 0.27;                                  // 돗자리 · 네모 방석 · 둥근 방석 위에 (다리를 접고)
        setPose('sit');
        player.rotation.y = pv.ry;                       // 냇물 쪽을 바라봅니다
        player.userData.meditate = true;
        frontView(player.rotation.y, { dist: 4.6, pitch: 0.22, offs: [0, 0.25, -0.25, 0.5, -0.5, 0.75, -0.75, 1.0, -1.0] });
        startBreath();
        ringChime(true);
        clearInterval(meditateTimer);
        meditateTimer = setInterval(() => { if (player.userData.meditate) ringChime(true, 0.5); }, 12000);   // 숨 한 바퀴(12초)마다
        toast('🧘 눈을 감고 물소리와 숨에 귀 기울여요', 3000);
      }],
    ],
    hall: (p) => [
      ['🪑 둥글게 앉기', () => {
        // 비어 있는 자리 중 가장 가까운 곳 (다른 사람이 앉은 자리는 건너뜁니다)
        let best = null, bd = Infinity;
        for (const st of p.state.seats) {
          const w = st.local.clone().applyMatrix4(p.group.matrixWorld);
          let taken = false;
          for (const o of others.values()) if (o.av.userData.pose === 'sit' && Math.hypot(o.av.position.x - w.x, o.av.position.z - w.z) < 0.5) taken = true;
          if (taken) continue;
          const d = Math.hypot(w.x - player.position.x, w.z - player.position.z);
          if (d < bd) { bd = d; best = { w, ry: p.group.rotation.y + st.ry }; }
        }
        if (!best) { toast('자리가 모두 찼어요 🙂 곁에 서서 함께해요', 2400); return; }
        player.position.set(best.w.x, standY(best.w.x, best.w.z), best.w.z);
        moveTarget = null;
        sitLift = 0.64;                                  // 마당 바닥 + 통나무 의자 + 방석
        setPose('sit');
        player.rotation.y = best.ry;
        // 모닥불 건너편에서 — 내 얼굴과 둘러앉은 사람들이 함께 보이게
        frontView(player.rotation.y, { dist: 6.4, pitch: 0.3, offs: [0.2, -0.2, 0.45, -0.45] });
        toast('💬 대화창으로 이야기를 나눠 보세요', 2400);
      }],
      ['💬 이야기 나누기', () => openChat(true)],
      ['🎤 이야기 무대에 서기', () => {
        // 무대 위 세 자리(가운데 · 왼쪽 · 오른쪽) 중 비어 있는 곳 — 두세 명이 서도 겹치지 않게
        let w = null;
        for (const dx of [0, -0.9, 0.9]) {                  // 어깨가 닿지 않게 0.9m 간격
          const c = p.state.stageLocal.clone().add(new THREE.Vector3(dx, 0, -0.2)).applyMatrix4(p.group.matrixWorld);
          let taken = false;
          for (const o of others.values()) if (Math.hypot(o.tx - c.x, o.tz - c.z) < 0.6) taken = true;   // 상대가 서 있는(받은) 자리 기준
          if (!taken) { w = c; break; }
        }
        if (!w) { toast('무대가 꽉 찼어요 🙂 자리에서 박수로 응원해요', 2400); return; }
        if (player.userData.pose !== 'stand') setPose('stand');
        player.position.set(w.x, standY(w.x, w.z), w.z);
        moveTarget = null;
        const c = new THREE.Vector3(0, 0, 0).applyMatrix4(p.group.matrixWorld);
        player.rotation.y = Math.atan2(c.x - w.x, c.z - w.z);   // 둘러앉은 사람들(모닥불) 쪽을 봅니다
        frontView(player.rotation.y, { dist: 7, pitch: 0.24, offs: [0.3, -0.3, 0.6, -0.6] });
        gesture('wave');
        toast('🎤 무대에 섰어요! 인사하고 이야기를 들려줘요', 2600);
      }],
      ['👏 박수 보내기', () => {
        if (!cool('clap', 1200)) return;
        floatEmoji('👏', player.position.clone().add(new THREE.Vector3(0, 2.6, 0)), 0.7, 1.2);
        tone(1318, 0.05, 0.12); setTimeout(() => tone(1175, 0.05, 0.12), 140); setTimeout(() => tone(1318, 0.05, 0.12), 280);
        store.send('act', { id: me.id, type: 'clap' });
      }],
    ],
    plaza: (p) => [
      ['🪑 벤치에 앉기', () => {
        // 가장 가까운 벤치에 앉아 연못을 바라봅니다
        let b = null, bd = Infinity;
        for (const c of (pond.benches || [])) {
          const d = Math.hypot(c.x - player.position.x, c.z - player.position.z);
          if (d < bd) { bd = d; b = c; }
        }
        if (!b) return;
        player.position.set(b.x, standY(b.x, b.z), b.z);
        moveTarget = null;
        sitLift = 0.55;                        // 벤치 좌석 높이 (언덕 벤치와 같은 벤치)
        setPose('sit');
        player.rotation.y = b.ry;
        camYaw = b.ry + Math.PI + 0.35;        // 등 뒤에서 살짝 비껴 — 연못과 분수가 함께 보이게
        camPitch = 0.26;
        camDist = 6;
        toast('벤치에 앉아 물소리를 들으며 쉬어요 🪷', 2600);
      }],
      ['💧 물소리 켜기 · 끄기', () => toggleFountain()],
    ],
    music: (p) => [
      ['🪑 피아노 앞에 앉기', () => {
        goTo(p.state.seatLocal, p);
        sitLift = 0.47;                  // 피아노 의자 높이
        setPose('sit');
        const w = p.state.pianoLocal.clone().applyMatrix4(p.group.matrixWorld);
        const dx = w.x - player.position.x, dz = w.z - player.position.z;
        player.rotation.y = Math.atan2(dx, dz);
        player.userData.atPiano = true;  // 앉아 있는 동안 두 손을 건반 위에
        // 정면은 피아노가 가리므로 옆앞에서 — 얼굴과 건반 위의 손이 함께 보이게
        frontView(player.rotation.y, { dist: 4.6, pitch: 0.3, offs: [1.15, -1.15, 1.5, -1.5, 0.9, -0.9] });
        showPanel(p, true);              // 앉은 뒤에 건반이 나옵니다
        toast(TOUCH ? '아래 건반을 눌러 보세요 🎹' : '숫자키 1~8 이나 아래 건반을 눌러 보세요 🎹', 3000);
      }],
      ['🎵 한 소절 쳐 보기', () => playMelody()],
      ['🎧 힐링 음악 듣기', () => toggleHealing()],
    ],
    field: (p) => [
      ...(player.userData.pose === 'lie' ? [['🧍 일어나기', () => {
        setPose('stand');
        camMode = 'follow';
        camPitch = 0.34;
        camDist = 9;
        toast('잘 쉬었어요 🙂', 1800);
      }]] : []),
      ['🌌 누워서 별 보기', () => {
        goTo(p.state.lieLocal, p);
        setPose('lie');
        camMode = 'lie';
        camPitch = 0.72;
        night.skyTurn = 0;              // 누울 때는 북두칠성이 처음 자리에서 시작
        camYaw = 0.78;                  // 북두칠성이 보이는 쪽
        showPanel(p, true);
        toast(TOUCH ? '화면을 끌어서 밤하늘을 둘러보세요 · 일어나려면 아래 \'일어나기\' ✨' : '드래그해서 밤하늘을 둘러보세요 · 일어나려면 아래 \'일어나기\' 또는 W A S D ✨', 5000);
      }],
      ['⭐ 소원 별 띄우기', () => writeMessage('wish')],
      ['✨ 소원 하나 읽기', () => readRandom(wishes, '⭐', '아직 소원 별이 없어요. 첫 별을 띄워 볼까요?')],
    ],
  };
  function toggleRain(p) {
    rainOn = !rainOn;
    p.state.rain.visible = rainOn;
    setRainSound(rainOn);
    showPanel(currentPlace, true);
  }
  function playKey(i, remote = false) {
    // 내 몸 기준 건반 위치 — 피아노를 마주 보고 앉으므로 좌우가 뒤집힙니다 (흰 건반 폭 0.36 × 크기 0.45)
    if (!remote) player.userData.keyHit = { x: -(i - 3.5) * 0.162, t: 0 };
    tone(SCALE[i], remote ? 0.12 : 0.25);
    flashKey(i);
    if (!remote) store.send('act', { id: me.id, type: 'note', key: i });
  }
  // 한 소절 — 도 미 솔 도 / 솔 미 도
  const MELODY = [[0, 0], [2, 0.4], [4, 0.8], [7, 1.2], [4, 1.75], [2, 2.15], [0, 2.55], [4, 3.0], [0, 3.45]];
  let melodyTimers = [];
  let healingTimer = null;
  function toggleHealing() {
    ensureAudio();
    if (actx && actx.state === 'suspended') actx.resume();
    if (healingTimer) { clearInterval(healingTimer); healingTimer = null; toast('음악을 멈췄어요'); return; }
    const pattern = [0, 2, 4, 2, 5, 4, 2, 0, 4, 5, 7, 4];
    let k = 0;
    const stepFn = () => {
      const i = pattern[k % pattern.length];
      tone(SCALE[i], 0.12, 2.6);              // 건반은 움직이지 않고 소리만
      if (k % 4 === 0) tone(SCALE[i] / 2, 0.09, 3.2);
      k++;
    };
    stepFn();
    healingTimer = setInterval(stepFn, 760);
    toast('🎧 힐링 음악이 흐릅니다. 다시 누르거나 음악실을 벗어나면 멈춰요', 3600);
  }
  function stopMelody() {
    melodyTimers.forEach(clearTimeout);
    melodyTimers = [];
    player.userData.playing = 0;
  }
  function playMelody() {
    const mu = byType('music')[0];
    const near = mu && Math.hypot(player.position.x - mu.x, player.position.z - mu.z) < 7.5;
    if (!near || player.userData.pose !== 'sit') { toast('피아노 앞에 앉아서 쳐 보세요 🎹', 2400); return; }
    if (!cool('melody', 5000)) return;
    player.userData.playing = 4.2;
    melodyTimers.forEach(clearTimeout);
    melodyTimers = MELODY.map(([i, t]) => setTimeout(() => playKey(i), t * 1000));
  }

  // ------------------------------------------------------------------
  // 내 모습 고르기
  // ------------------------------------------------------------------
  function applyLook() {
    me.color = me.look.color;
    localStorage.setItem('shelter:look', JSON.stringify(me.look));
    localStorage.setItem('shelter:color', me.look.color);
    const old = player;
    const np = makeAvatar(me.look.color, me.name, { hair: me.look.hair, hairColor: me.look.hairColor, skin: me.look.skin });
    np.position.copy(old.position);
    np.rotation.y = old.rotation.y;
    np.userData.pose = old.userData.pose;
    scene.remove(old);
    disposeObj(old);
    scene.add(np);
    player = np;
    netDirty = true;
  }
  // 미리 만들어 둔 캐릭터 8종 — 색만이 아니라 '사람'을 고르는 느낌이 나도록
  const PRESETS = [
    { name: '분홍 단발',  color: '#f4a7b9', hair: 0, hairColor: '#241d1a', skin: SKIN[0] },
    { name: '하늘 단정',  color: '#9ad0ec', hair: 1, hairColor: '#3b2a21', skin: SKIN[1] },
    { name: '연두 묶음',  color: '#b8e0a8', hair: 2, hairColor: '#6b4a2f', skin: SKIN[0] },
    { name: '노랑 모자',  color: '#ffd59a', hair: 3, hairColor: '#241d1a', skin: SKIN[2] },
    { name: '보라 단발',  color: '#c9b6f2', hair: 0, hairColor: '#55392c', skin: SKIN[1] },
    { name: '살구 단정',  color: '#f7c59f', hair: 1, hairColor: '#17151c', skin: SKIN[3] },
    { name: '민트 묶음',  color: '#a8e6cf', hair: 2, hairColor: '#8a6b4a', skin: SKIN[2] },
    { name: '코랄 모자',  color: '#ffb3a7', hair: 3, hairColor: '#4a3326', skin: SKIN[0] },
  ];
  // 작은 3D 미리보기 (고르는 즉시 내 모습이 보입니다)
  let lookOpen = false, prevR = null, prevScene = null, prevCam = null, prevAv = null, prevT = 0;
  function ensurePreview() {
    if (prevR) return;
    const cv = $('#look-preview');
    if (!cv) return;
    prevR = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
    prevR.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    prevR.setSize(cv.clientWidth || 170, cv.clientHeight || 240, false);
    prevR.outputColorSpace = THREE.SRGBColorSpace;
    prevR.toneMapping = THREE.ACESFilmicToneMapping;
    prevScene = new THREE.Scene();
    prevScene.add(new THREE.HemisphereLight(0xd6e4ff, 0x6a7a44, 1.5));
    const dl = new THREE.DirectionalLight(0xffdcb4, 2.2);
    dl.position.set(2.5, 4, 3);
    prevScene.add(dl);
    prevCam = new THREE.PerspectiveCamera(30, (cv.clientWidth || 170) / (cv.clientHeight || 240), 0.1, 50);
    prevCam.position.set(0, 1.15, 4.2);
    prevCam.lookAt(0, 1.0, 0);
  }
  function refreshPreview() {
    ensurePreview();
    if (!prevScene) return;
    if (prevAv) prevScene.remove(prevAv);
    prevAv = makeAvatar(me.look.color, me.name, {
      hair: me.look.hair, hairColor: me.look.hairColor, skin: me.look.skin,
    });
    prevAv.userData.label.visible = false;
    prevAv.userData.blob.visible = false;
    prevScene.add(prevAv);
  }
  function markPresetSelected() {
    const box = $('#look-presets');
    if (!box) return;
    [...box.children].forEach((b, i) => {
      const ps = PRESETS[i];
      const same = ps.color === me.look.color && ps.hair === me.look.hair
        && ps.hairColor === me.look.hairColor && ps.skin === me.look.skin;
      b.classList.toggle('on', same);
    });
  }
  function buildLookPicker() {
    const body = $('#look-body');
    if (!body || body.childElementCount) return;
    // 캐릭터 8종
    const pbox = $('#look-presets');
    PRESETS.forEach((ps) => {
      const b = el('button', { type: 'button', className: 'preset' });
      const dot = el('span', { className: 'dot' });
      dot.style.background = ps.color;
      b.append(dot, document.createTextNode(ps.name));
      b.onclick = () => {
        me.look.color = ps.color;
        me.look.hair = ps.hair;
        me.look.hairColor = ps.hairColor;
        me.look.skin = ps.skin;
        applyLook();
        syncLookUI();
      };
      pbox.append(b);
    });
    const mk = (label, items, get, set) => {
      const row = el('div', { className: 'look-row' }, [el('span', { className: 'look-label', textContent: label })]);
      const chips = el('div', { className: 'chips' });
      items.forEach((it) => {
        const b = el('button', { type: 'button', className: 'chip' });
        if (it.swatch) b.style.background = it.swatch; else b.textContent = it.text;
        b.onclick = () => {
          set(it.value);
          applyLook();
          refreshPreview();                 // 미리보기도 바로 (예전엔 캐릭터 8종 버튼만 미리보기를 다시 그렸음)
          for (const c of chips.children) c.classList.remove('on');
          b.classList.add('on');
          markPresetSelected();
        };
        if (get() === it.value) b.classList.add('on');
        chips.append(b);
      });
      row.append(chips);
      body.append(row);
    };
    mk('옷 색', COLORS.map((c) => ({ value: c, swatch: c })), () => me.look.color, (v) => { me.look.color = v; });
    mk('머리', HAIRS.map((h) => ({ value: h.id, text: h.name })), () => me.look.hair, (v) => { me.look.hair = v; });
    mk('머리 색', HAIR_COLORS.map((c) => ({ value: c, swatch: c })), () => me.look.hairColor, (v) => { me.look.hairColor = v; });
    syncLookUI();
  }
  function syncLookUI() {
    const body = $('#look-body');
    if (body) {
      const vals = [me.look.color, me.look.hair, me.look.hairColor];
      [...body.children].forEach((row, ri) => {
        const chips = row.querySelector('.chips');
        if (!chips) return;
        const list = ri === 0 ? COLORS : ri === 1 ? HAIRS.map((x) => x.id) : HAIR_COLORS;
        [...chips.children].forEach((b, bi) => b.classList.toggle('on', list[bi] === vals[ri]));
      });
    }
    markPresetSelected();
    refreshPreview();
  }

  // ------------------------------------------------------------------
  // 대화 — 한 줄씩 주고받고, 머리 위에 말풍선으로 띄웁니다
  // ------------------------------------------------------------------
  const bubbles = [];
  function sayBubble(av, text) {
    const u = av.userData;
    if (u.bubble) { av.remove(u.bubble); disposeObj(u.bubble); u.bubble = null; }
    const lb = makeLabel(text, { size: 30, scale: 0.55, bg: 'rgba(255,255,255,.88)', color: '#2a2338' });
    lb.position.y = 2.55;
    av.add(lb);
    u.bubble = lb;
    bubbles.push({ av, lb, t: 0 });
  }
  // 입장 · 퇴장 알림 — 위쪽 알림 + 대화창에 한 줄 (입장은 작은 딩동 소리)
  let joinQuietUntil = Infinity;
  function announce(text, ding) {
    toast(text, 2600);
    const list = $('#chat-list');
    if (list) { list.append(el('div', { className: 'line sys', textContent: text })); list.scrollTop = list.scrollHeight; }
    if (ding && actx && !muted) { tone(988, 0.05, 0.25); setTimeout(() => tone(1319, 0.05, 0.35), 130); }
  }
  function chatLog(name, text, mine) {
    const list = $('#chat-list');
    if (!list) return;
    const line = el('div', { className: 'line' + (mine ? ' mine' : '') }, [
      el('b', { textContent: name }), el('span', { textContent: text }),
    ]);
    list.append(line);
    while (list.children.length > 60) list.removeChild(list.firstChild);
    list.scrollTop = list.scrollHeight;
  }
  function sendChat(raw) {
    const text = cleanText(raw);
    if (!text) { toast('보낼 수 없는 내용이에요', 1600); return; }
    if (!cool('chat', 700)) return;
    chatLog(me.name, text, true);
    sayBubble(player, text);
    store.send('chat', { id: me.id, name: me.name, text });
  }

  // ------------------------------------------------------------------
  // 패널
  // ------------------------------------------------------------------
  let currentPlace = null;
  function infoText(p) {
    if (!p) return '';
    if (p.type === 'greenhouse') {
      const v = counters.water;
      const stage = v >= TREE_FULL ? '다 자랐어요 🌸' : v >= 10 ? '꽃이 피었어요' : v >= 3 ? '새잎이 났어요' : '새싹';
      return `오늘 큰 나무에 준 물 ${Math.min(v, TREE_FULL)} / ${TREE_FULL}번 · 지금은 "${stage}" · 작은 화분은 들어올 때마다 새싹부터`;
    }
    if (p.type === 'cafe') return `지금까지 오간 "수고했어" ${counters.cheer}번`;
    if (p.type === 'hill') return `소나무에 걸린 쪽지 ${notes.length}장`;
    if (p.type === 'field') return `하늘에 뜬 소원 별 ${wishes.length}개`;
    if (p.type === 'music') return TOUCH ? '아래 건반을 눌러 쳐 보세요' : '숫자키 1~8 로도 칠 수 있어요';
    if (p.type === 'petcafe') return `동물들이 받은 사랑 ${counters.happy}번`;
    if (p.type === 'plaza') return '물소리를 들으며 잠깐 쉬어 가세요';
    return '';
  }
  function refreshPanelInfo() {
    const i = $('#panel .info');
    if (i) i.textContent = infoText(currentPlace);
  }
  function showPanel(p, force = false) {
    if (p === currentPlace && !force) return;
    currentPlace = p;
    const panel = $('#panel');
    if (!p) { panel.classList.remove('show'); document.body.classList.remove('panel-open'); return; }
    panel.replaceChildren(el('h3', { textContent: p.name }), el('p', { textContent: p.desc }), el('div', { className: 'info', textContent: infoText(p) }));
    const row = el('div', { className: 'actions' });
    for (const [label, fn] of (actions[p.type] || (() => []))(p)) row.append(el('button', { type: 'button', textContent: label, onclick: fn }));
    if (row.children.length) panel.append(row);
    if (p.type === 'music' && player.userData.pose === 'sit') {
      const keys = el('div', { className: 'keys' });
      KEY_NAMES.forEach((n, i) => {
        const b = el('button', { type: 'button' }, [el('span', { textContent: n }), el('small', { textContent: String(i + 1) })]);
        b.dataset.i = i;
        b.onpointerdown = (e) => { e.preventDefault(); playKey(i); };
        keys.append(b);
      });
      panel.append(keys);
    }
    panel.classList.add('show');
    document.body.classList.add('panel-open');
  }

  // 길 찾기 버튼
  for (const p of places) {
    $('#places').append(el('button', {
      type: 'button',
      textContent: p.name,
      onclick: () => {
        const d = Math.hypot(p.x, p.z) || 1;
        const stop = Math.min(p.radius * 0.6, d);
        moveTarget = new THREE.Vector3(p.x - (p.x / d) * stop, 0, p.z - (p.z / d) * stop);
        waypoints = [];
        // 냇물을 사이에 두고 있으면 (정자 → 다른 곳, 다른 곳 → 정자) 다리로 건너갑니다
        const north = (v) => v.z > STREAM_Z(v.x);
        if (north(player.position) !== north(new THREE.Vector3(p.x, 0, p.z))) {
          const bz0 = STREAM_Z(BRIDGE_X);
          const near = north(player.position) ? bz0 + 9.5 : bz0 - 9.5, far = north(player.position) ? bz0 - 9.5 : bz0 + 9.5;
          const fin = moveTarget.clone();
          moveTarget = new THREE.Vector3(BRIDGE_X, 0, near);
          waypoints = [new THREE.Vector3(BRIDGE_X, 0, far), fin];
        }
        pushOut(moveTarget, 3);
        bestD = Infinity;
        stuckT = 0;
        detouring = false;
        if (player.userData.pose !== 'stand') setPose('stand');
      },
    }));
  }

  // ------------------------------------------------------------------
  // 다른 사람들 (함께 모드)
  // ------------------------------------------------------------------
  const others = new Map();
  let roomChecked = false;
  const handlers = {
    onPresence(ids) {
      const n = ids.length;
      presentIds = ids.slice();
      $('#people').textContent = n <= 1 ? '👥 지금은 나 혼자 쉬는 중' : `👥 지금 ${n}명이 함께 쉬고 있어요 ▾`;
      if ($('#who').classList.contains('open')) renderWho();
      for (const [id, o] of others) if (!ids.includes(id)) {
        if (o.name && performance.now() > joinQuietUntil) announce(`🚶 ${o.name}님이 나갔어요`, false);
        scene.remove(o.av); disposeObj(o.av); others.delete(id);
      }
      if (!roomChecked && n > 0) {
        roomChecked = true;
        if (n > C.roomCapacity) {
          const m = room.match(/^(.*?)-(\d+)$/);
          const next = m ? `${m[1]}-${Number(m[2]) + 1}` : `${room}-2`;
          const box = $('#roomfull');
          box.replaceChildren('이 방이 조금 붐벼요.', el('a', { href: `?room=${encodeURIComponent(next)}`, textContent: '한적한 방으로 가기 →' }));
          box.style.display = 'block';
        }
      }
    },
    onMove(m) {
      if (!m || m.id === me.id) return;
      let o = others.get(m.id);
      if (!o) {
        const name = String(m.name || '손님').slice(0, 20);
        const color = /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : '#cccccc';
        const lk = m.look && typeof m.look === 'object' ? m.look : {};
        o = {
          av: makeAvatar(color, name, {
            hair: Number.isInteger(lk.hair) ? lk.hair : undefined,
            hairColor: /^#[0-9a-f]{6}$/i.test(lk.hairColor) ? lk.hairColor : undefined,
            skin: /^#[0-9a-f]{6}$/i.test(lk.skin) ? lk.skin : undefined,
          }),
          tx: m.x, tz: m.z, ry: m.ry,
        };
        o.av.position.set(m.x, standY(m.x, m.z), m.z);
        scene.add(o.av);
        others.set(m.id, o);
        // 입장 알림 — 내가 막 들어왔을 때 이미 있던 사람들은 알리지 않습니다 (한꺼번에 뜨지 않게)
        if (performance.now() > joinQuietUntil) announce(`👋 ${String(m.name || '손님').slice(0, 20)}님이 들어왔어요`, true);
      }
      o.name = String(m.name || '손님').slice(0, 20);
      o.tx = Number(m.x) || 0;
      o.tz = Number(m.z) || 0;
      o.ry = Number(m.ry) || 0;
      o.av.userData.pose = ['stand', 'sit', 'lie', 'crouch'].includes(m.pose) ? m.pose : 'stand';
      o.lift = clamp(Number(m.lift) || 0, 0, 1.2);
    },
    onAct(a) {
      if (!a || a.id === me.id) return;
      const o = others.get(a.id);
      if (['bow', 'wave', 'dance', 'stick'].includes(a.type) && o) o.av.userData.gesture = { type: a.type, t: 0, dur: GESTURE_DUR[a.type] };
      // 가위바위보 — 초대 → 대답(상대가 고른 것) → 건 사람이 결과를 모두에게 보여 줌
      if (a.type === 'rpsInvite' && a.to === me.id && o) {
        // '가위바위보가 왔어요' 신호 — 딩동 소리, 알림, 상대 머리 위 말풍선, 다른 탭을 보고 있으면 탭 제목 깜빡임
        ensureAudio();
        tone(880, 0.12, 0.35); setTimeout(() => tone(1175, 0.12, 0.5), 160);
        toast(`✌️ ${String(a.name || '손님').slice(0, 20)}님이 가위바위보를 신청했어요!`, 4000);
        sayBubble(o.av, '✌️ 가위바위보 할래요?');
        if (document.hidden) {
          const t0 = document.title; let on = false;
          const iv = setInterval(() => { document.title = (on = !on) ? '✌️ 가위바위보 신청!' : t0; }, 800);
          const back = () => { clearInterval(iv); document.title = t0; document.removeEventListener('visibilitychange', back); };
          document.addEventListener('visibilitychange', back);
          setTimeout(back, 15000);
        }
        faceTo(player, o.av);
        openRps(`${String(a.name || '손님').slice(0, 20)}님이 가위바위보를 걸었어요!`,
          (i) => store.send('act', { id: me.id, type: 'rpsReply', to: a.id, pick: i }));
      }
      if (a.type === 'rpsReply' && a.to === me.id && o && rpsPending && rpsPending.to === a.id) {
        const pa = rpsPending.pick, pb = rpsPick(a.pick);
        rpsPending = null;
        faceTo(player, o.av);
        rpsShow(player, pa, o.av, pb, 'a');
        store.send('act', { id: me.id, type: 'rpsShow', a: me.id, pa, b: a.id, pb });
      }
      if (a.type === 'rpsShow' && o) {
        const avB = a.b === me.id ? player : (a.b && others.get(a.b) ? others.get(a.b).av : null);
        rpsShow(o.av, rpsPick(a.pa), avB, rpsPick(a.pb), a.b === me.id ? 'b' : null);
      }
      if (a.type === 'note' && Number.isInteger(a.key) && a.key >= 0 && a.key < 8) playKey(a.key, true);
      if (a.type === 'cheer' && o) floatEmoji('💛', o.av.position.clone().add(new THREE.Vector3(0, 2.8, 0)));
      if (a.type === 'emoji' && o && Number.isInteger(a.e) && a.e >= 0 && a.e < EMOJIS.length) floatEmoji(EMOJIS[a.e], o.av.position.clone().add(new THREE.Vector3(0, 2.4, 0)), 0.8, 1.6);
      if (a.type === 'clap' && o) floatEmoji('👏', o.av.position.clone().add(new THREE.Vector3(0, 2.6, 0)), 0.7, 1.2);
      if (a.type === 'windchime') ringChime(false);
      if (a.type === 'water') {
        const gh0 = byType('greenhouse')[0];
        const q = gh0 && Number.isInteger(a.pot) ? gh0.state.pots[a.pot] : null;
        waterEffect(false, q);
        if (q && !q.central) growPot(a.pot, false);
      }
      if (a.type === 'counter' && a.name === 'water' && typeof a.day === 'string' && a.day > counterDay) { counterDay = a.day; counters.water = 0; }   // 상대가 이미 새 날이면 나도 새싹부터
      if (a.type === 'counter' && counters[a.name] !== undefined) applyCounter(a.name, Number(a.value) || 0);
    },
    onChat(c) {
      if (!c || c.id === me.id) return;
      const name = String(c.name || '손님').slice(0, 20);
      const text = String(c.text || '').slice(0, 60);
      if (!text) return;
      chatLog(name, text, false);
      const o = others.get(c.id);
      if (o) sayBubble(o.av, text);
      // 상대가 말을 걸면 내 대화창도 저절로 열립니다
      if (!$('#chat').classList.contains('open')) openChat(true);
      $('#btn-chat').classList.add('ping');
      setTimeout(() => $('#btn-chat').classList.remove('ping'), 2000);
    },
    onMessage(row) {
      if (!row) return;
      if (row.kind === 'note') addNoteMesh(row);
      if (row.kind === 'wish') addStarMesh(row);
      refreshPanelInfo();
    },
  };

  // ------------------------------------------------------------------
  // 입력
  // ------------------------------------------------------------------
  let camYaw = 0, camPitch = 0.34, camDist = 9;
  let camDistNow = 9;
  let lookDrop = 0;
  let camBlockD = Infinity, camBlockT = 0;   // 카메라 가림 판정 유지       // 패널에 가린 만큼 시선을 내리는 양
  let introOn = true;     // 시작 화면에서는 카메라가 광장을 천천히 돕니다
  let introGlow = 0.16;   // 시작 화면은 조금 더 환하게 — 들어가면 천천히 원래 밝기로
  let detour = 1, detourT = 0, noWayT = 0, detouring = false;   // 벽을 돌아갈 때 쓰는 상태
  let bestD = Infinity, stuckT = 0;
  let waypoints = [];      // 길 찾기 중 거쳐 갈 곳 (다리 건너기 등)                             // 목적지에 가까워지는지 감시
  const keys = {};
  const typing = () => document.activeElement && document.activeElement.tagName === 'INPUT';
  window.addEventListener('keydown', (e) => {
    if (typing()) return;
    keys[e.code] = true;
    if (currentPlace && currentPlace.type === 'music' && /^Digit[1-8]$/.test(e.code)) playKey(Number(e.code.slice(5)) - 1);
    if (e.code === 'Escape') { stopBreath(); $('#help').classList.remove('show'); }
    // C — 시점을 캐릭터 뒤로 (눌렀다 바로 떼도 놓치지 않게 여기서 바로 처리)
    if (e.code === 'KeyC' && !introOn && camMode !== 'lie') { camYaw = player.rotation.y + Math.PI; camPitch = 0.34; }
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  const canvas = renderer.domElement;
  let drag = null;
  // 두 손가락 벌리기 · 모으기로 확대 · 축소 (휴대폰엔 휠이 없음)
  const touches = new Map();
  let pinch = null;
  const pinchDist = () => { const [a, b] = [...touches.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
  canvas.addEventListener('pointerdown', (e) => {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) { pinch = { d: pinchDist(), base: camDist }; if (drag) drag.moved = 999; return; }
    drag = { x: e.clientX, y: e.clientY, moved: 0 };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size === 2) { camDist = clamp(pinch.base * pinch.d / pinchDist(), 3.4, 22); return; }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.x = e.clientX;
    drag.y = e.clientY;
    camYaw -= dx * 0.006;
    camPitch = clamp(camPitch + dy * 0.004, camMode === 'lie' ? 0.5 : 0.04, camMode === 'lie' ? 1.45 : 1.2);
  });
  canvas.addEventListener('pointerup', (e) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    if (drag && drag.moved < 8) handleClick(e);
    drag = null;
  });
  canvas.addEventListener('pointercancel', (e) => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; drag = null; });
  canvas.addEventListener('wheel', (e) => { camDist = clamp(camDist + e.deltaY * 0.01, 3.4, 22); }, { passive: true });

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function handleClick(e) {
    ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(clickables, false)[0];
    if (hit) {
      const u = hit.object.userData;
      if (u.kind === 'note') return toast(`📝 ${u.text}`, 4000);
      if (u.kind === 'star') return toast(`⭐ ${u.text}`, 4000);
      if (u.kind === 'key') return playKey(u.index);
    }
    if (camMode === 'lie') return;
    const g = raycaster.intersectObjects(groundMeshes, false)[0];
    if (g) {
      moveTarget = g.point.clone();
      // 한 번 클릭에 하염없이 걷지 않도록, 먼 곳은 그 방향으로 일정 거리까지만
      const mdx = moveTarget.x - player.position.x, mdz = moveTarget.z - player.position.z;
      const md = Math.hypot(mdx, mdz);
      const MAX_STEP = 9;
      if (md > MAX_STEP) {
        moveTarget.x = player.position.x + (mdx / md) * MAX_STEP;
        moveTarget.z = player.position.z + (mdz / md) * MAX_STEP;
      }
      if (md < 0.6) { moveTarget = null; }
      else {
        pushOut(moveTarget, 3);          // 목적지가 피아노 · 건물 안이면 바깥으로 옮깁니다
        bestD = Infinity;
        stuckT = 0;
        detouring = false;
        markSpot(moveTarget);
      }
      if (player.userData.pose !== 'stand') setPose('stand');
      stopBreath();
    }
  }

  // 대화창
  const chatInput = $('#chat-input');
  if (TOUCH) chatInput.placeholder = chatInput.placeholder.replace(/\s*\(Enter\)/, '');
  const openChat = (open) => {
    $('#chat').classList.toggle('open', open);
    if (open) setTimeout(() => chatInput.focus(), 30); else chatInput.blur();
  };
  $('#btn-chat').onclick = () => openChat(!$('#chat').classList.contains('open'));
  $('#chat-close').onclick = () => openChat(false);
  // 휴대폰에서는 길 찾기 목록을 버튼으로 열고 닫습니다
  $('#btn-places').onclick = () => $('#places').classList.toggle('open');
  for (const b2 of document.querySelectorAll('#places button')) {
    b2.addEventListener('click', () => { if (window.innerWidth <= 760) $('#places').classList.remove('open'); });
  }
  // 모습 고르기 창
  const openLook = (open) => {
    buildLookPicker();
    lookOpen = open;
    if (open) refreshPreview();
    $('#look').classList.toggle('show', open);
  };
  $('#look-open').onclick = () => openLook(true);
  $('#look-open2').onclick = () => openLook(true);
  $('#look-done').onclick = () => openLook(false);
  $('#chat-send').onclick = () => { if (chatInput.value.trim()) { sendChat(chatInput.value); chatInput.value = ''; } };
  chatInput.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.isComposing) { if (chatInput.value.trim()) { sendChat(chatInput.value); chatInput.value = ''; } }
    if (e.key === 'Escape') openChat(false);
  };
  for (const b2 of document.querySelectorAll('#chat-quick button')) b2.onclick = () => sendChat(b2.textContent);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !typing()) { openChat(true); e.preventDefault(); }
  });
  // 방 코드 표시와 복사
  $('#room-code').textContent = room;
  // 들어온 뒤에도 방을 바꿀 수 있게
  $('#room-change').onclick = async () => {
    const raw = await askText('들어갈 방 코드 (비우면 공개 방)', '예) FAMILY');
    if (raw === null) return;
    const code = roomCode(raw);
    if (String(raw).trim() && !code) { toast('방 코드는 한글 · 영문 · 숫자로 적어 주세요', 2400); return; }
    const want = code || 'MAIN';
    localStorage.setItem('shelter:lastRoom', want);
    if (want === room) { toast(`이미 "${want}" 방에 있어요`, 2000); return; }
    toast(`"${want}" 방으로 옮겨 가요…`, 2000);
    const u = new URL(location.href); u.pathname = u.pathname.replace(/\/room\/.*/, '/'); u.search = '?room=' + encodeURIComponent(want);
    location.assign(u.toString());
  };
  $('#room-copy').onclick = async () => {
    const url = location.origin + location.pathname.replace(/\/room\/.*/, '') + '?room=' + encodeURIComponent(room);
    try { await navigator.clipboard.writeText(url); toast('초대 주소를 복사했어요 — 친구에게 붙여넣기 하세요', 3000); }
    catch (e) { toast(url, 5000); }
  };

  $('#g-wave').onclick = () => gesture('wave');
  $('#g-dance').onclick = () => gesture('dance');
  $('#g-stick').onclick = () => gesture('stick');
  $('#g-rps').onclick = () => startRps();
  // 이모지 보내기 — 고른 이모지가 내 머리 위에 잠깐 떠 있고, 같은 방 사람들에게도 보입니다
  const EMOJIS = ['😊', '😂', '🥰', '👍', '👏', '🎉', '😮', '😢', '🙏', '❤️', '🌸', '☕'];
  $('#g-emoji').onclick = () => pickFrom('이모지 보내기', EMOJIS, (i) => {
    if (!cool('emoji', 800)) return;
    floatEmoji(EMOJIS[i], player.position.clone().add(new THREE.Vector3(0, 2.4, 0)), 0.8, 1.6);
    store.send('act', { id: me.id, type: 'emoji', e: i });
  });
  // 몇 명인지 누르면 — 지금 들어와 있는 사람들의 닉네임
  $('#people').onclick = () => {
    const box = $('#who');
    box.classList.toggle('open');
    $('#hud').classList.toggle('expanded', box.classList.contains('open'));   // 휴대폰: 방 코드 줄도 이때만
    if (box.classList.contains('open')) renderWho();
    layoutPlaces();
  };
  // 길 찾기 패널은 위의 정보 상자(목록을 펼치면 길어짐) 바로 아래 14px 띄워서
  function layoutPlaces() {
    const pl = $('#places');
    if (window.innerWidth <= 760) { pl.style.top = ''; return; }   // 휴대폰은 따로 배치
    pl.style.top = Math.round($('#hud').getBoundingClientRect().bottom + 14) + 'px';
  }
  window.addEventListener('resize', layoutPlaces);
  setTimeout(layoutPlaces, 0);
  $('#g-bow').onclick = () => { if (player.userData.pose === 'stand') gesture('bow'); else toast('일어선 뒤에 인사할 수 있어요', 1500); };
  $('#btn-help').onclick = () => $('#help').classList.add('show');
  $('#help-close').onclick = () => $('#help').classList.remove('show');
  $('#breath-close').onclick = () => stopBreath();
  $('#btn-sound').onclick = () => {
    ensureAudio();
    if (actx && actx.state === 'suspended') actx.resume();
    muted = !muted;
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.8, actx.currentTime, 0.2);
    if (!muted) startAmbient();
    $('#btn-sound').innerHTML = muted ? '🔇<span> 소리 꺼짐</span>' : '🔊<span> 소리 켜짐</span>';
  };
  $('#myname').textContent = me.name;
  $('#rename').onclick = () => {
    me.name = randomName();
    localStorage.setItem('shelter:name', me.name);
    $('#myname').textContent = me.name;
    const old = player.userData.label;
    const nl = makeLabel(me.name, { size: 32, scale: 0.44 });
    nl.position.copy(old.position);
    player.remove(old);
    disposeObj(old);
    player.add(nl);
    player.userData.label = nl;
    netDirty = true;
  };
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.fov = fovFor(camera.aspect);
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (composer) composer.setSize(window.innerWidth, window.innerHeight);
  });

  // ------------------------------------------------------------------
  // 시작 화면
  // ------------------------------------------------------------------
  document.title = C.title;
  $('#hud-title').textContent = C.title;
  $('#intro-title').textContent = C.title;
  $('#intro-sub').textContent = C.subtitle;
  $('#intro-mode').textContent = store.mode === 'supabase'
    ? `함께 모드 · 방 "${room}"`
    : '혼자 모드 · 쪽지와 소원은 이 브라우저에만 저장돼요';
  if (store.mode === 'local') $('#people').textContent = '혼자 모드로 쉬는 중';
  await Promise.all([setupComposer(), loadData()]);   // 빛 효과 준비와 데이터 불러오기를 동시에
  // 셰이더 미리 준비 — 들어가는 순간 처음 그릴 때 멈추지 않게.
  //   예전엔 네 방향을 실제로 한 번씩 그려 보며 데웠는데, 쉼터는 장면이 커서 이 단계만 10~24초가 걸려
  //   불멍 ↔ 쉼터 이동이 매우 느렸습니다. 이제 셰이더만 비동기로 준비해서 '불러오는 중 · 가는 중' 표시도 멈추지 않습니다.
  //   (처음 몇 프레임은 시작 화면 · 이동 막 뒤에서 그려져 사용자에게 보이지 않습니다)
  try {
    // ① 장면의 모든 재질(숨겨진 것 포함) 셰이더를 비동기로 준비
    // 빛 번짐(블룸)을 쓰면 장면은 화면이 아니라 '중간 그림판'에 그려집니다 — 셰이더도 그 대상으로 준비해야 다시 만들지 않음
    if (composer) renderer.setRenderTarget(composer.readBuffer);
    if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
    else renderer.compile(scene, camera);
    renderer.setRenderTarget(null);
    // ② 지금 시점에서 딱 한 번 그려 그림자 · 빛 번짐 셰이더까지 준비 (예전엔 네 방향을 그려서 매우 느렸음)
    if (composer) composer.render(0.016); else renderer.render(scene, camera);
  } catch (e) { console.warn('미리 준비 생략', e); }
  const enterBtn = $('#enter');
  enterBtn.disabled = false;
  enterBtn.textContent = '들어가기';
  $('#intro').classList.add('ready');   // 대표 이미지를 걷고 실제 3D 장면을 보여 줍니다
  const nameInput = $('#intro-name');
  if (nameInput) {
    nameInput.value = me.name;
    nameInput.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.isComposing) enterBtn.click(); };
  }
  const codeInput = $('#intro-code');
  if (codeInput) {
    codeInput.value = room === 'MAIN' ? '' : room;
    // 주소에 방 코드가 없으면(카톡 · 즐겨찾기로 그냥 열면) 지난번에 들어갔던 방 코드를 미리 채워 둡니다
    const urlHasRoom = params.get('room') || pathCode;
    const last = localStorage.getItem('shelter:lastRoom');
    if (!urlHasRoom && last && last !== 'MAIN') {
      codeInput.value = last;
      $('#intro-mode').textContent = `지난번 방 "${last}" 으로 들어가요 · 공개 방은 코드를 지우세요`;
    }
    codeInput.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.isComposing) enterBtn.click(); };
  }
  enterBtn.onclick = () => {
    // 다른 방 코드를 적었으면 그 방으로 들어갑니다
    if (codeInput) {
      const code = roomCode(codeInput.value);
      const want = code || 'MAIN';
      localStorage.setItem('shelter:lastRoom', want);
      if (want !== room) { location.href = location.pathname.replace(/\/room\/.*/, '') + '?room=' + encodeURIComponent(want); return; }
    }
    // 적어 둔 닉네임을 내 이름으로 (비워 두면 처음 받은 별명 그대로)
    if (nameInput) {
      const nm = nameInput.value.replace(/\s+/g, ' ').trim().slice(0, 12);
      if (nm && nm !== me.name) {
        me.name = nm;
        localStorage.setItem('shelter:name', nm);
        $('#myname').textContent = nm;
        applyLook();                     // 이름표를 새로 그립니다
      }
    }
    ensureAudio();
    if (actx && actx.state === 'suspended') actx.resume();
    startAmbient();                      // 들어가면 배경 음악이 천천히 켜집니다
    $('#btn-sound').innerHTML = '🔊<span> 소리 켜짐</span>';
    $('#intro').classList.remove('show');
    document.body.classList.remove('intro');
    introOn = false;
    // 처음 한 번만 — 시점 돌리는 방법 안내 (다시 보려면 ❔ 도움말)
    if (!localStorage.getItem('shelter:viewHint')) {
      localStorage.setItem('shelter:viewHint', '1');
      const touch = window.matchMedia('(pointer: coarse)').matches;
      setTimeout(() => toast(touch
        ? '👆 화면을 손가락으로 끌면 둘러볼 수 있어요'
        : '🖱 화면을 끌거나 Q · E 키로 둘러봐요 · R · F 위아래 · C 내 뒤로', 5200), 1200);
    }
    joinQuietUntil = performance.now() + 4000;
    if (room !== 'MAIN') localStorage.setItem('shelter:lastRoom', room);   // 실제로 들어간 방을 기억
    store.connect(handlers);
    netDirty = true;
  };

  // ------------------------------------------------------------------
  // 루프
  // ------------------------------------------------------------------
  // ------------------------------------------------------------------
  // 쉼터 ↔ 불멍 오가기 — 길찾기 버튼 하나로 다른 공간으로 넘어갑니다
  //   이름 · 모습(localStorage)과 방 코드(?room=)가 그대로 따라가고,
  //   ?go=1 로 건너오면 시작 화면 없이 바로 들어갑니다.
  // ------------------------------------------------------------------
  {
    const OTHER = { label: '🔥 불멍 캠프', goText: '🔥 불멍 캠프로 가는 중', local: '불멍/index.html', web: '/bulmeong/' };
    const otherUrl = () => {
      const base = location.protocol === 'file:' ? new URL(OTHER.local, location.href).href : new URL(OTHER.web, location.origin).href;
      return base + '?room=' + encodeURIComponent(room) + '&go=1';
    };
    const fade = $('#fade');
    const portalBtn = el('button', { type: 'button', className: 'portal' }, [el('span', { textContent: OTHER.label }), el('span', { className: 'cnt' })]);
    portalBtn.onclick = () => {
      if (window.innerWidth <= 760) $('#places').classList.remove('open');
      fade.querySelector('.go-text').textContent = OTHER.goText;               // '○○로 가는 중'
      fade.classList.add('on');                                               // 화면이 천천히 어두워지고
      if (master && actx) master.gain.setTargetAtTime(0, actx.currentTime, 0.15);   // 소리도 함께 잦아든 뒤
      setTimeout(() => location.assign(otherUrl()), 350);                      // 건너갑니다 (기다림은 짧게)
    };
    $('#places').append(portalBtn);
    // 건너편 공간에 지금 몇 명 있는지 (함께 모드일 때만)
    if (store.watchCount) store.watchCount(`bulmeong:${room}`, (n) => { portalBtn.querySelector('.cnt').textContent = n > 0 ? ` · 지금 ${n}명` : ''; });
    // 건너왔으면 — 시작 화면 없이 바로 들어갑니다. 주소의 go=1 은 지워서, 그 주소를 공유하면 시작 화면부터 보이게.
    if (params.get('go') === '1') {
      const u = new URL(location.href);
      u.searchParams.delete('go');
      history.replaceState(null, '', u.toString());
      // 바로 아래에서 선언되는 루프 변수(netDirty 등)가 준비된 뒤에 들어가도록 한 박자 늦춥니다
      setTimeout(() => {
        enterBtn.click();
        document.documentElement.classList.remove('arriving');
        fade.classList.remove('instant');
        // 처음 몇 프레임(셰이더 · 그림자 첫 준비)은 막 뒤에서 그린 다음 걷습니다 — 들어가자마자 버벅이는 모습이 보이지 않게
        let frames = 0;
        const reveal = () => (++frames < 5 ? requestAnimationFrame(reveal) : fade.classList.remove('on'));
        requestAnimationFrame(reveal);
      }, 0);
      // 브라우저가 새 화면의 소리를 막았으면 — 한 번 누르면 켜지도록 안내
      setTimeout(() => {
        if (!actx || actx.state === 'running' || muted) return;
        const pill = $('#sound-tap');
        pill.classList.add('show');
        const on = () => {
          actx.resume();
          startAmbient();
          pill.classList.remove('show');
          window.removeEventListener('pointerdown', on, true);
          window.removeEventListener('keydown', on, true);
        };
        window.addEventListener('pointerdown', on, true);
        window.addEventListener('keydown', on, true);
      }, 500);
    }
  }

  // 확인용 — 그래픽 메모리(지오메트리 · 텍스처 수)와 셰이더 수
  window.__dbg = () => ({ ...renderer.info.memory, programs: renderer.info.programs.length, others: others.size });
  const clock = new THREE.Clock();
  let netDirty = true, netTimer = 0, lastSentX = 0, lastSentZ = 0;
  const tmp = new THREE.Vector3();
  const tmpMove = new THREE.Vector3(), tmpMove2 = new THREE.Vector3();
  const camRay = new THREE.Raycaster();
  const fireflies = window.__fireflies;
  function tick() {
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;
    WIND.value = t;

    // 이동
    let mx = 0, mz = 0;
    if (!typing()) {
      if (keys.KeyW || keys.ArrowUp) mz += 1;
      if (keys.KeyS || keys.ArrowDown) mz -= 1;
      if (keys.KeyA || keys.ArrowLeft) mx -= 1;
      if (keys.KeyD || keys.ArrowRight) mx += 1;
    }
    let vx = 0, vz = 0;
    if (mx || mz) {
      moveTarget = null;
      const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw), rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
      vx = fx * mz + rx * mx;
      vz = fz * mz + rz * mx;
    } else if (moveTarget) {
      vx = moveTarget.x - player.position.x;
      vz = moveTarget.z - player.position.z;
      if (Math.hypot(vx, vz) < 0.5) {
        if (waypoints.length) { moveTarget = waypoints.shift(); bestD = Infinity; stuckT = 0; }
        else { moveTarget = null; vx = vz = 0; }
      }
    }
    const len = Math.hypot(vx, vz);
    let moving = len > 0.001;
    const beforeX = player.position.x, beforeZ = player.position.z;
    if (moving) {
      if (player.userData.pose !== 'stand') setPose('stand');
      stopBreath();
      if (player.userData.playing > 0) stopMelody();   // 걸어가면서 허공을 치지 않게
      const sp = 5.4 * dt;
      const ux = vx / len, uz = vz / len;
      // ① 그냥 가 본다  ② 막히면 벽을 따라 미끄러진다  ③ 그래도 막히면 멈춘다
      // 한 걸음 가 보고, 막히면 돌아갈 길을 찾습니다.
      const stepTo = (dirx, dirz, out) => {
        out.set(beforeX + dirx * sp, 0, beforeZ + dirz * sp);
        pushOut(out);
        return Math.hypot(out.x - beforeX, out.z - beforeZ);
      };
      let gotX = beforeX, gotZ = beforeZ, got = 0;
      got = stepTo(ux, uz, tmpMove);
      gotX = tmpMove.x; gotZ = tmpMove.z;

      if (got < sp * 0.5) {
        if (moveTarget) {
          // 목적지가 있는 이동(클릭 · 길 찾기) — 멈추지 않고 벽을 돌아갑니다.
          //   한 번 정한 방향은 길이 뚫릴 때까지 유지합니다. (매번 다시 고르면 제자리에서 뱅글뱅글 돕니다)
          if (!detouring) {
            const tx = moveTarget.x - beforeX, tz = moveTarget.z - beforeZ;
            detour = (-uz * tx + ux * tz) > 0 ? 1 : -1;
            detouring = true;
          }
          detourT = 0.2;
          const px2 = -uz * detour, pz2 = ux * detour;                     // 수직(옆으로)
          const mxl = ux + px2, mzl = uz + pz2, ml2 = Math.hypot(mxl, mzl) || 1;
          for (const [dx2, dz2] of [[mxl / ml2, mzl / ml2], [px2, pz2]]) { // 45도 → 90도 순으로 시도
            const d2 = stepTo(dx2, dz2, tmpMove2);
            if (d2 > got) { gotX = tmpMove2.x; gotZ = tmpMove2.z; got = d2; }
            if (got > sp * 0.6) break;
          }
        } else {
          // 키보드로 직접 밀 때 — 비스듬히 닿았으면 미끄러지고, 정면이면 그냥 섭니다
          const pushX = tmpMove.x - (beforeX + ux * sp), pushZ = tmpMove.z - (beforeZ + uz * sp);
          const pl = Math.hypot(pushX, pushZ);
          if (pl > 1e-5) {
            const nx2 = pushX / pl, nz2 = pushZ / pl;
            const dotv = ux * nx2 + uz * nz2;
            if (Math.abs(dotv) <= 0.82) {
              let sx = ux - dotv * nx2, sz = uz - dotv * nz2;
              const sl = Math.hypot(sx, sz);
              if (sl > 1e-5) {
                const d2 = stepTo(sx / sl, sz / sl, tmpMove2);
                if (d2 > got) { gotX = tmpMove2.x; gotZ = tmpMove2.z; got = d2; }
              }
            }
          }
        }
      } else {
        detouring = false;            // 직진이 뚫렸으면 우회 끝
        detourT = 0;
      }
      detourT -= dt;

      if (got < sp * 0.3) { gotX = beforeX; gotZ = beforeZ; got = 0; }
      player.position.x = gotX;
      player.position.z = gotZ;
      const r = Math.hypot(player.position.x, player.position.z);
      if (r > 118) { player.position.x *= 118 / r; player.position.z *= 118 / r; }

      if (got > sp * 0.35) {
        player.rotation.y = Math.atan2(gotX - beforeX, gotZ - beforeZ);
        noWayT = 0;
      } else {
        moving = false;                       // 헛걸음 없이 멈춤
        noWayT += dt;
        // 목적지에 거의 다 왔는데 막혔으면 도착한 것으로 봅니다
        if (moveTarget && Math.hypot(moveTarget.x - beforeX, moveTarget.z - beforeZ) < 2.2) {
          moveTarget = null;
          noWayT = 0;
        } else if (moveTarget && noWayT > 1.2) {   // 돌아갈 길도 없으면 포기
          moveTarget = null;
          noWayT = 0;
          blockedMsg -= dt;
          if (blockedMsg <= 0) { toast('이쪽은 막혀 있어요. 다른 쪽을 클릭해 보세요 🙂', 1800); blockedMsg = 8; }
        }
      }
      // 목적지에 전혀 가까워지지 않으면(=돌기만 하면) 그만둡니다
      if (moveTarget) {
        const curD = Math.hypot(moveTarget.x - player.position.x, moveTarget.z - player.position.z);
        if (curD < bestD - 0.3) { bestD = curD; stuckT = 0; }
        else {
          stuckT += dt;
          if (stuckT > 3.5) {
            moveTarget = null;
            detouring = false;
            stuckT = 0;
            bestD = Infinity;
            blockedMsg -= dt;
            if (blockedMsg <= 0) { toast('돌아갈 길을 못 찾았어요. 다른 쪽을 클릭해 보세요 🙂', 1800); blockedMsg = 8; }
          }
        }
      } else { bestD = Infinity; stuckT = 0; }
      // 클릭 · 길 찾기로 이동할 때는 카메라가 천천히 등 뒤로 돌아감
      if (moveTarget && !drag && moving && detourT <= 0) {
        const mvx = gotX - beforeX, mvz = gotZ - beforeZ;
        const tgx = moveTarget.x - beforeX, tgz = moveTarget.z - beforeZ;
        const ml3 = Math.hypot(mvx, mvz) * Math.hypot(tgx, tgz);
        // 실제로 목적지 쪽으로 가고 있을 때만 카메라가 따라 돕니다 (우회 중 좌우 휘청임 방지)
        // 제대로 걸어 나갈 때만 (한 걸음의 60% 이상) — 무언가에 걸려 제자리에서 들썩일 때
        //   아주 작은 움직임의 방향을 따라 카메라가 좌우로 흔들려 길이 움직이는 것처럼 보였습니다.
        const stepLen = Math.hypot(mvx, mvz);
        if (ml3 > 1e-6 && stepLen > sp * 0.6 && (mvx * tgx + mvz * tgz) / ml3 > 0.6) {
          let d = Math.atan2(-mvx, -mvz) - camYaw;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          camYaw += d * Math.min(1, dt * 1.6);
        }
      }
      netDirty = true;
    } else {
      // 쪼그려 앉았다가 잠시 뒤 일어섭니다
      if (crouchT > 0) {
        crouchT -= dt;
        if (crouchT <= 0 && player.userData.pose === 'crouch') setPose('stand');
      }
      pushOut(player.position);
    }
    // 강아지 · 고양이와도 부딪힙니다
    for (const pet of petList) {
      const dx = player.position.x - pet.position.x, dz = player.position.z - pet.position.z;
      const d = Math.hypot(dx, dz), MIN = 0.55;
      if (d < MIN && d > 1e-3) {
        player.position.x = pet.position.x + (dx / d) * MIN;
        player.position.z = pet.position.z + (dz / d) * MIN;
      }
    }
    // 사람끼리도 겹치지 않게 서로 살짝 밀어냅니다
    for (const n of npcs) {
      const dx = player.position.x - n.av.position.x, dz = player.position.z - n.av.position.z;
      const d = Math.hypot(dx, dz), MIN = 0.78;
      if (d < MIN) {
        const push = (MIN - d) / 2;
        const ux = d > 1e-3 ? dx / d : 1, uz = d > 1e-3 ? dz / d : 0;
        player.position.x += ux * push;
        player.position.z += uz * push;
        n.av.position.x -= ux * push;
        n.av.position.z -= uz * push;
      }
    }
    // sitLift = '좌석이 땅에서 얼마나 높은가'. 앉으면 몸이 0.42 내려가므로 그만큼 뺍니다.
    const seatDrop = 0.42;
    const wantY = standY(player.position.x, player.position.z)
      + (player.userData.pose === 'sit' ? Math.max(0, sitLift - seatDrop) : 0);
    player.position.y = lerp(player.position.y, wantY, Math.min(1, dt * 12));
    animateAvatar(player, dt, moving);
    player.visible = camMode !== 'lie';
    player.userData.label.visible = player.userData.pose === 'stand' && camera.position.distanceTo(player.position) > 9;
    for (let i = 0; i < placeLabels.length; i++) {
      const l = placeLabels[i];
      l.visible = camMode !== 'lie' && camera.position.distanceTo(l.position) > 13;
    }

    // 밤 전환 (누웠을 때)
    const wantNight = camMode === 'lie' ? 1 : 0;
    if (Math.abs(night.mix - wantNight) > 0.001) {
      night.mix = lerp(night.mix, wantNight, Math.min(1, dt * 0.9));
      applyNight(night.mix);
    }
    if (night.mix > 0.5 && !starTimer) startStarMusic();
    if (night.mix < 0.25 && starTimer) stopStarMusic();
    if (night.mix > 0.05) {
      shootTimer -= dt;
      if (shootTimer <= 0) { shootingStar(); shootTimer = 3 + Math.random() * 6; }
    }
    for (let i2 = night.shoot.length - 1; i2 >= 0; i2--) {
      const sh = night.shoot[i2];
      sh.t += dt;
      sh.m.position.addScaledVector(sh.dir, 170 * dt);
      sh.m.material.opacity = 0.9 * Math.max(0, 1 - sh.t / 1.3);
      if (sh.t > 1.3) { scene.remove(sh.m); sh.m.geometry.dispose(); sh.m.material.dispose(); night.shoot.splice(i2, 1); }
    }

    // 그림자는 사람 주변만 정밀하게 — 빛을 따라다니게 합니다.
    moonLight.position.copy(player.position).add(SUN_OFF);
    moonLight.target.position.copy(player.position);
    moonLight.target.updateMatrixWorld();

    // 물결
    if (waterMat && waterMat.normalMap) {
      waterMat.normalMap.offset.set(t * 0.015, t * 0.021);
    }
    // 반딧불이
    if (fireflies) {
      const a = fireflies.geometry.attributes.position, b = fireflies.userData.base;
      for (let i = 0; i < b.length; i++) {
        a.setX(i, b[i].x + Math.sin(t * 0.6 + b[i].p) * 1.2);
        a.setY(i, b[i].y + Math.sin(t * 0.9 + b[i].p * 2) * 0.5);
        a.setZ(i, b[i].z + Math.cos(t * 0.5 + b[i].p) * 1.2);
      }
      a.needsUpdate = true;
      fireflies.material.opacity = 0.55 + Math.sin(t * 2) * 0.25;
    }

    // 다른 사람들
    for (const o of others.values()) {
      const px2 = o.av.position.x, pz = o.av.position.z;
      // 받은 위치까지 걸음 속도로 이어 걷습니다 — 위치를 드물게 받아도 뚝뚝 끊기지 않게. 멀리 떨어졌거나 앉고 누울 땐 바로.
      const dxr = o.tx - px2, dzr = o.tz - pz, dr = Math.hypot(dxr, dzr);
      if (dr > 1e-4) {
        const stepR = dr > 4 || o.av.userData.pose !== 'stand' ? dr : Math.min(dr, 5.6 * dt * (dr > 1.2 ? 1.5 : 1));
        o.av.position.x = px2 + (dxr / dr) * stepR;
        o.av.position.z = pz + (dzr / dr) * stepR;
      }
      o.av.position.y = standY(o.av.position.x, o.av.position.z) + (o.av.userData.pose === 'sit' ? Math.max(0, (o.lift || 0) - 0.42) : 0);
      o.av.rotation.y = o.ry;
      animateAvatar(o.av, dt, Math.hypot(o.tx - px2, o.tz - pz) > 0.05);
    }

    // 둘러보는 사람들 — 목적지까지 걷고, 잠시 머물고, 가까이 오면 인사합니다.
    for (const n of npcs) {
      const a = n.av, u = a.userData;
      let npcMoving = false;
      if (n.wait > 0) {
        n.wait -= dt;
        if (n.wait <= 0) { n.target = npcSpot(); u.pose = 'stand'; n.lastD = undefined; n.stuck = 0; n.walkT = 0; }
      } else {
        const dx = n.target.x - a.position.x, dz = n.target.z - a.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.6) {
          n.wait = 4 + Math.random() * 8;
          n.lastD = undefined;
          n.stuck = 0;
          n.walkT = 0;
          // (예전엔 30% 확률로 그 자리에 앉았는데, 의자가 없는 곳이면 허공에 앉은 것처럼 보여 없앴습니다.
          //  멈춰 서서 둘러봅니다)
        } else {
          const bx0 = a.position.x, bz0 = a.position.z;
          a.position.x += (dx / d) * n.speed * dt;
          a.position.z += (dz / d) * n.speed * dt;
          pushOut(a.position);
          const gotN = Math.hypot(a.position.x - bx0, a.position.z - bz0);
          // '움직였는가' 가 아니라 '목적지에 가까워졌는가' 로 판단합니다.
          //   벽을 따라 조금씩 미끄러지는 것도 걷기로 쳐서 헛발질처럼 보였습니다.
          const nd = Math.hypot(n.target.x - a.position.x, n.target.z - a.position.z);
          const progress = (n.lastD === undefined ? d : n.lastD) - nd;
          n.lastD = nd;
          if (progress < n.speed * dt * 0.35) n.stuck = (n.stuck || 0) + dt;
          else n.stuck = 0;
          n.walkT = (n.walkT || 0) + dt;

          if (n.stuck > 0.7 || n.walkT > 16) {
            // 막혔거나 너무 오래 걸음 — 멈춰 서서 다른 곳을 고릅니다
            if (gotN < n.speed * dt * 0.35) { a.position.x = bx0; a.position.z = bz0; }
            n.target = npcSpot();
            n.wait = 0.8 + Math.random() * 1.6;
            n.stuck = 0;
            n.walkT = 0;
            n.lastD = undefined;
            npcMoving = false;
          } else {
            npcMoving = gotN > n.speed * dt * 0.35;
            if (npcMoving) a.rotation.y = lerp(a.rotation.y, Math.atan2(dx, dz), Math.min(1, dt * 4));
          }
        }
      }
      a.position.y = lerp(a.position.y, standY(a.position.x, a.position.z), Math.min(1, dt * 10));
      n.greet -= dt;
      if (n.greet <= 0 && !u.gesture && a.position.distanceTo(player.position) < 6) {
        u.gesture = { type: Math.random() < 0.6 ? 'wave' : 'bow', t: 0 };
        n.greet = 14;
      }
      animateAvatar(a, dt, npcMoving);
      if (n.pet) {
        const side = new THREE.Vector3(Math.cos(a.rotation.y) * 0.75, 0, -Math.sin(a.rotation.y) * 0.75);
        const px = a.position.x + side.x - Math.sin(a.rotation.y) * 0.3;
        const pz = a.position.z + side.z - Math.cos(a.rotation.y) * 0.3;
        const dd = Math.hypot(px - n.pet.position.x, pz - n.pet.position.z);
        const petMoving = dd > 0.35;
        if (petMoving) {
          n.pet.position.x = lerp(n.pet.position.x, px, Math.min(1, dt * 2.6));
          n.pet.position.z = lerp(n.pet.position.z, pz, Math.min(1, dt * 2.6));
          n.pet.rotation.y = lerp(n.pet.rotation.y, Math.atan2(px - n.pet.position.x, pz - n.pet.position.z), Math.min(1, dt * 5));
        }
        animatePet(n.pet, dt, petMoving);
      }
    }
    if (window.__cat) animatePet(window.__cat, dt, false);

    // 정자 풍경 흔들림 (평소엔 바람에 아주 살짝)
    if (stream.pav) {
      const pv = stream.pav;
      for (const sm of pv.smoke) {
        sm.t = (sm.t + dt * 0.18) % 1;
        sm.sp.position.set(Math.sin(sm.t * 7 + t * 0.6) * 0.05 * sm.t, 0.58 + sm.t * 1.1, Math.cos(sm.t * 5) * 0.03 * sm.t);
        sm.sp.scale.setScalar(0.08 + sm.t * 0.32);
        sm.sp.material.opacity = 0.32 * Math.sin(sm.t * Math.PI);
      }
      pv.swing = Math.max(0, pv.swing - dt * 0.35);
      pv.chime.rotation.z = Math.sin(t * 6) * 0.35 * pv.swing + Math.sin(t * 1.3) * 0.04;
      pv.chime.rotation.x = Math.sin(t * 4.6) * 0.2 * pv.swing;
    }
    // 공 — 날아가고 · 통통 튀고 · 굴러가고 · 강아지가 물고 다님
    updateBall(dt);
    updateStickLight(dt);

    // 멍냥 쉼터 동물들 — 쉬다가, 부르면 달려오고, 쓰다듬으면 좋아합니다
    if (petCafe && petCafe.state.pets) {
      for (const pt of petCafe.state.pets) {
        const o = pt.obj;
        let mv = false;
        if (pt.happy > 0) {
          pt.happy -= dt;
          pt.t += dt;
          const ph = pt.phase || 0;
          const dx = player.position.x - o.position.x, dz = player.position.z - o.position.z;
          o.rotation.y = lerp(o.rotation.y, Math.atan2(dx, dz), Math.min(1, dt * 5));
          animatePet(o, dt, false);
          const gy = standY(o.position.x, o.position.z);
          if (pt.mood === 'eat') {
            // 간식 — 고개를 숙이고 오물오물, 꼬리는 살랑살랑
            o.position.y = gy;
            o.userData.head.rotation.x = 0.75 + Math.sin(pt.t * 9 + ph) * 0.12;
            o.userData.tail.rotation.z = Math.sin(pt.t * 10 + ph) * 0.45;
            if (pt.happy < 1 && Math.random() < dt * 1.2) floatEmoji('💛', o.position.clone().add(new THREE.Vector3(0, 0.9, 0)), 0.38);
          } else if (pt.mood === 'pet') {
            // 쓰다듬기 — 앉아서 고개를 들고 올려다봅니다
            o.position.y = gy - 0.06;
            o.userData.head.rotation.x = -0.3 + Math.sin(pt.t * 2 + ph) * 0.07;
            o.userData.tail.rotation.z = Math.sin(pt.t * 14 + ph) * 0.8;
            o.rotation.z = Math.sin(pt.t * 1.6 + ph) * 0.05;
            if (Math.random() < dt * 1.4) floatEmoji(Math.random() < 0.5 ? '💛' : '💖', o.position.clone().add(new THREE.Vector3(0, 0.95, 0)), 0.4);
          } else {
            // 공놀이 — 신나서 폴짝 (마리마다 박자가 다릅니다)
            o.position.y = gy + Math.abs(Math.sin(pt.t * (7 + (ph % 2)) + ph)) * 0.13;
            o.userData.tail.rotation.z = Math.sin(pt.t * 16 + ph) * 0.7;
            if (Math.random() < dt * 1.2) floatEmoji('💛', o.position.clone().add(new THREE.Vector3(0, 1, 0)), 0.4);
          }
          if (pt.happy <= 0) {
            o.userData.head.rotation.x = 0;
            o.rotation.z = 0;
            if (ball && ball.userData.carriedBy === pt) {      // 다 놀았으면 공을 내려놓습니다
              ball.userData.carriedBy = null;
              ball.userData.roll = { vx: Math.sin(o.rotation.y) * 0.6, vz: Math.cos(o.rotation.y) * 0.6, hop: 0.12, hopT: 0 };
            }
            if (pt.mood === 'eat' && treat) treat.visible = false;
          }
          continue;
        }
        let tx = pt.target.x, tz = pt.target.z, speed = 1.3;
        if (pt.state === 'come') {
          const fs = petCafe.state.feedSpot;
          tx = fs ? fs.x : player.position.x;
          tz = fs ? fs.z : player.position.z;
          speed = 2.4 + (pt.phase % 1) * 0.8;         // 속도도 조금씩 다르게
          if (pt.delay > 0) { pt.delay -= dt; tx = o.position.x; tz = o.position.z; }
        }
        if (pt.state === 'watch') {
          // 공이 날아가고 구르는 동안은 제자리에서 공을 눈으로 따라갑니다
          tx = o.position.x; tz = o.position.z;
          if (ball && ball.visible && ball.userData.thrownTo === pt) {
            o.rotation.y = lerp(o.rotation.y, Math.atan2(ball.position.x - o.position.x, ball.position.z - o.position.z), Math.min(1, dt * 5));
            if (!ball.userData.flight && !ball.userData.roll && !ball.userData.carriedBy) pt.state = 'fetch';   // 멈췄다 — 가지러!
          }
        }
        if (pt.state === 'fetch' && ball) { tx = ball.position.x; tz = ball.position.z; speed = 3.4; }
        if (pt.state === 'bring') { tx = player.position.x; tz = player.position.z; speed = 2.6; }   // 물고 와서 나에게
        const dx = tx - o.position.x, dz = tz - o.position.z;
        const d = Math.hypot(dx, dz);
        const stop = pt.state === 'come' || pt.state === 'bring' ? 1.1 : 0.4;
        if (d > stop) {
          mv = true;
          const bx = o.position.x, bz = o.position.z;
          o.position.x += (dx / d) * speed * dt;
          o.position.z += (dz / d) * speed * dt;
          pushOut(o.position);                         // 동물도 가게 벽 안으로는 들어가지 않습니다
          o.rotation.y = lerp(o.rotation.y, Math.atan2(dx, dz), Math.min(1, dt * 6));
          // 벽 · 다른 동물에 막혀 제자리걸음이면 1초 뒤 다른 곳으로 (같은 자세로 계속 버티지 않게)
          const got = Math.hypot(o.position.x - bx, o.position.z - bz);
          pt.stuck = got < speed * dt * 0.3 ? (pt.stuck || 0) + dt : 0;
          if (pt.stuck > 1) {
            pt.stuck = 0;
            if (pt.state === 'rest') { pt.target = petSpotNear(); pt.t = 2 + Math.random() * 3; }
            else if (pt.state === 'come') { pt.state = 'rest'; pt.target = petSpotNear(); }
          }
        } else if (pt.state === 'fetch' && ball) {
          ball.userData.roll = null;
          ball.userData.carriedBy = pt;              // 입에 물고
          pt.state = 'bring';                        // 나에게 가져옵니다
        } else if (pt.state === 'come' || pt.state === 'bring') {
          if (pt.state === 'bring' && ball && ball.userData.carriedBy === pt) {
            // 내 앞에 공을 툭 내려놓고 신나서 폴짝
            ball.userData.carriedBy = null;
            ball.userData.thrownTo = null;
            ball.userData.roll = { vx: Math.sin(o.rotation.y) * 0.5, vz: Math.cos(o.rotation.y) * 0.5, hop: 0.1, hopT: 0 };
            floatEmoji('🎾', o.position.clone().add(new THREE.Vector3(0, 1, 0)), 0.4);
            bump('happy');
          }
          pt.mood = pt.state === 'bring' ? 'play' : (pt.mood || 'eat');
          pt.state = 'rest';
          pt.happy = 3 + Math.random() * 1.5;
          pt.t = 0;
        } else {
          pt.t -= dt;
          if (pt.t <= 0) { pt.t = 3 + Math.random() * 6; pt.target = petSpotNear(); }
        }
        animatePet(o, dt, mv);
      }
      // 동물끼리 겹치지 않게 살짝 밀어냅니다 (한 마리가 다른 마리 속에 들어가 있던 문제)
      const ps = petCafe.state.pets;
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i].obj.position, c = ps[j].obj.position;
        const ddx = c.x - a.x, ddz = c.z - a.z, dd = Math.hypot(ddx, ddz), MIN = 0.85;
        if (dd < MIN) {
          const ux = dd > 1e-3 ? ddx / dd : 1, uz = dd > 1e-3 ? ddz / dd : 0, push = (MIN - dd) * 0.5;
          a.x -= ux * push; a.z -= uz * push; c.x += ux * push; c.z += uz * push;
          pushOut(a); pushOut(c);
        }
      }
    }

    // 장소 근접
    let near = null, nd = Infinity;
    for (const p of places) {
      const d = Math.hypot(player.position.x - p.x, player.position.z - p.z);
      if (d < p.radius && d < nd) { near = p; nd = d; }
    }
    showPanel(near);

    // 장소 애니메이션
    for (const p of places) {
      if (p.type === 'greenhouse') {
        const pl = p.state.plant, target = pl.userData.target || 0.6;
        pl.scale.setScalar(lerp(pl.scale.x, target, Math.min(1, dt * 2)));
        pl.rotation.y = Math.sin(t * 0.6) * 0.08;
        for (const q of (p.state.pots || [])) {
          if (q.bush) q.bush.scale.setScalar(lerp(q.bush.scale.x, 1 + Math.min(1.3, (q.level || 0) * 0.12), Math.min(1, dt * 1.5)));
          if (!q.bush || !q.bush.userData.shake) continue;
          q.bush.userData.shake -= dt * 0.9;
          q.bush.rotation.z = Math.sin(t * 22) * 0.07 * Math.max(0, q.bush.userData.shake);
          if (q.bush.userData.shake <= 0) q.bush.rotation.z = 0;
        }
        // 물을 맞으면 잎이 잠깐 떨립니다
        if (p.state.shake > 0) {
          p.state.shake -= dt * 0.8;
          pl.rotation.z = Math.sin(t * 24) * 0.06 * Math.max(0, p.state.shake);
        } else pl.rotation.z = lerp(pl.rotation.z, 0, Math.min(1, dt * 4));
      }
      if (p.type === 'hall' && p.state.fire) {
        const fr = p.state.fire;
        // 겹마다 따로 깜빡이면 색이 차례로 바뀌어 보입니다 → 모든 겹이 같은 박자로 천천히 피어오르고, 끝만 살짝 흔들림
        const rise = 1 + Math.sin(t * 1.7) * 0.07 + Math.sin(t * 3.3) * 0.025;
        const sway = Math.sin(t * 1.3) * 0.045;
        for (const [gs, op, sc] of fr.glows) { gs.material.opacity = op * (0.9 + Math.sin(t * 1.1) * 0.1); gs.scale.setScalar(sc * (0.97 + Math.sin(t * 1.1) * 0.03)); }   // 숨 쉬듯 은은하게
        fr.flames.forEach((f) => {
          const b = f.userData.base;
          f.scale.set(b.w * (1 - (rise - 1) * 0.4), b.h * rise, b.w * (1 - (rise - 1) * 0.4));
          f.rotation.z = b.tilt + sway;
          f.material.opacity = b.op;
        });
        if (p.state.garland) p.state.garland.material.opacity = 0.55 + Math.sin(t * 1.2) * 0.05;   // 아주 살짝 숨 쉬듯
        fr.light.intensity = 8 + Math.sin(t * 3.1) * 0.8 + Math.sin(t * 7.3) * 0.4;   // 은은하게 (빠른 깜빡임 없이)
      }
      if (p.type === 'music') {
        // 멀어지면 힐링 음악이 자연스럽게 멈춥니다
        if (healingTimer) {
          const dmus = Math.hypot(player.position.x - p.x, player.position.z - p.z);
          if (dmus > 13) { toggleHealing(); toast('음악실에서 멀어져 음악이 멈췄어요 🎧', 2200); }
        }
        // 음악실에 들어오면 등이 밝아집니다
        const d = Math.hypot(player.position.x - p.x, player.position.z - p.z);
        const k = 1 - smooth(6, 16, d);
        p.state.warm.intensity = lerp(p.state.warm.intensity, 3 + k * 20, Math.min(1, dt * 3));
        p.state.lanternMat.emissiveIntensity = lerp(p.state.lanternMat.emissiveIntensity, 0.6 + k * 1.6, Math.min(1, dt * 3));
      }
      if (p.type === 'cafe' && p.state.rain.visible) {
        const a = p.state.rain.geometry.attributes.position;
        for (let i = 0; i < a.count; i++) {
          let y = a.getY(i) - 18 * dt;
          if (y < 0) y += 16;
          a.setY(i, y);
        }
        a.needsUpdate = true;
      }
      if (p.type === 'field') {
        const b = p.state.bird, a = t * 0.07;
        b.obj.visible = night.mix < 0.25;        // 별 보는 동안에는 새가 날지 않습니다
        // 넓고 느린 원을 그리며, 오르내림도 천천히
        b.obj.position.set(p.x + Math.cos(a) * 34, 19 + Math.sin(t * 0.23) * 2.2, p.z + 20 + Math.sin(a) * 30);
        b.obj.rotation.set(0, -a, 0.18);          // 원 안쪽으로 살짝 기울여 선회
        for (const k of b.birds) {
          // 날갯짓 2초 → 활공 3초를 반복 (새마다 박자가 조금씩 다름)
          const ph = ((t + k.off) % 5) / 5;
          const flapAmt = ph < 0.4 ? Math.sin(ph / 0.4 * Math.PI) : 0;
          const f = Math.sin((t + k.off) * 6.5) * 0.55 * flapAmt + 0.1 * (1 - flapAmt);
          k.wl.rotation.z = f;
          k.wr.rotation.z = -f;                 // 거울로 뒤집힌 날개라 반대로 돌려야 같이 올라갑니다
          k.obj.position.y = k.base.y + Math.sin((t + k.off) * 0.9) * 0.25 - f * 0.08;
          k.obj.position.x = k.base.x + Math.sin((t + k.off) * 0.37) * 0.35;
        }
        for (const s of p.state.stars.children) {
          const k = 2.6 + Math.sin(t * 1.5 + s.userData.phase) * 0.25;   // 은은하게 깜빡
          s.scale.set(k, k, 1);
        }
      }
    }
    for (let i = risingStars.length - 1; i >= 0; i--) {
      const r = risingStars[i];
      r.t += dt / 3;
      const e = 1 - (1 - Math.min(1, r.t)) ** 3;
      r.sp.position.lerpVectors(r.from, r.to, e);
      if (r.t >= 1) risingStars.splice(i, 1);
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.t += dt;
      if (f.hold) {
        // 톡 커지며 나타나 → 머리 위에서 살짝 흔들리며 머물고 → 천천히 떠오르며 사라짐
        const pop = f.t < 0.25 ? 0.6 + 0.6 * (f.t / 0.25) : 1.2 - 0.2 * smooth(0.25, 0.45, f.t);
        f.s.scale.copy(f.base).multiplyScalar(pop);
        if (f.t < f.hold) f.s.position.y += Math.sin(f.t * 4) * 0.002;
        else f.s.position.y += dt * 0.55;
        f.s.material.opacity = 1 - smooth(f.hold, f.hold + 1.6, f.t);
        if (f.t > f.hold + 1.6) { scene.remove(f.s); disposeObj(f.s); floaters.splice(i, 1); }
        continue;
      }
      f.s.position.y += dt * 1.2;
      f.s.position.x += f.vx * dt;
      f.s.material.opacity = 1 - f.t / 2;
      if (f.t > 2) { scene.remove(f.s); disposeObj(f.s); floaters.splice(i, 1); }
    }
    // 물뿌리개 — 기울였다 세우고, 그동안 물줄기가 쏟아집니다
    if (pour) {
      pour.t += dt;
      const tilt = smooth(0, 0.4, pour.t) * (1 - smooth(1.7, 2.1, pour.t));
      if (pour.hand && player.userData.can) {
        // 손에 든 조리개 — 기울이고, 주둥이 끝에서 물이 쏟아집니다
        player.userData.can.rotation.z = -0.9 * tilt;
        player.userData.can.getWorldPosition(tmpV);
        pour.spout = tmpV.clone().add(new THREE.Vector3(0, 0.1, 0))
          .add(new THREE.Vector3(Math.sin(player.rotation.y), 0, Math.cos(player.rotation.y)).multiplyScalar(0.45));
      }
      if (pour.t > 0.35 && pour.t < 1.75 && drops.length < 120) {
        for (let k = 0; k < 2; k++) {
          const d = new THREE.Mesh(dropGeo, dropMat);
          d.scale.set(1, 1.3, 1);
          d.position.set(pour.spout.x + (Math.random() - 0.5) * 0.06, pour.spout.y, pour.spout.z + (Math.random() - 0.5) * 0.06);
          scene.add(d);
          // 고른 화분의 흙(반지름 약 0.2 안)에 떨어지도록 포물선을 계산합니다
          const ax = pour.aim.x + (Math.random() - 0.5) * 0.3, az = pour.aim.z + (Math.random() - 0.5) * 0.3;
          const dh = pour.landY - d.position.y;                         // 올라가야 할 높이(음수면 내려감)
          const vy0 = Math.max(0.9, Math.sqrt(Math.max(0, 22 * dh)) + 0.6);
          const T = (vy0 + Math.sqrt(Math.max(0, vy0 * vy0 - 22 * dh))) / 11;   // y0 + vy0·T − 5.5·T² = landY
          drops.push({ d, vy: vy0, vx: (ax - d.position.x) / T, vz: (az - d.position.z) / T, gh: pour.gh, landY: pour.landY, rising: true });
        }
      }
      if (pour.t > 2.3) { pour = null; takeCan(player); player.userData.watering = 0; }
    }
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.vy -= 11 * dt;
      d.d.position.x += d.vx * dt;
      d.d.position.z += d.vz * dt;
      d.d.position.y += d.vy * dt;
      const landY = d.landY || 1.1;
      if (d.vy < 0) d.rising = false;
      if (!d.rising && d.d.position.y < landY) {
        splash(d.d.position.x, landY, d.d.position.z);
        scene.remove(d.d);
        drops.splice(i, 1);
      }
    }
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const bb = bubbles[i];
      bb.t += dt;
      if (bb.t > 6) {
        if (bb.av.userData.bubble === bb.lb) { bb.av.remove(bb.lb); bb.av.userData.bubble = null; }
        if (!bb.lb.parent) disposeObj(bb.lb);
        bubbles.splice(i, 1);
      }
    }
    for (let i = marks.length - 1; i >= 0; i--) {
      const k = marks[i];
      k.t += dt;
      const e = k.t / 0.7;
      k.m.scale.setScalar(2.4 + e * 1.6);
      k.m.material.opacity = 0.85 * (1 - e);
      if (e >= 1) { scene.remove(k.m); k.m.material.dispose(); marks.splice(i, 1); }
    }
    for (let i = splashes.length - 1; i >= 0; i--) {
      const s = splashes[i];
      s.t += dt;
      const k = s.t / 0.5;
      s.m.scale.setScalar(1 + k * 2.6);
      s.m.material.opacity = 0.75 * (1 - k);
      if (k >= 1) { scene.remove(s.m); s.m.material.dispose(); splashes.splice(i, 1); }
    }

    // 냇물 — 결과 거품이 하류로 흘러갑니다
    if (stream.flowTex) {
      stream.flowTex.offset.x -= dt * 0.16;
      stream.flowTex.offset.y = Math.sin(t * 0.25) * 0.02;
      for (const f of stream.foams) {
        f.x += f.sp * dt;
        if (f.x > 130) f.x = -130;
        const zc2 = STREAM_Z(f.x) + f.off;
        f.m.position.set(f.x, terrainY(f.x, STREAM_Z(f.x)) + 0.78, zc2);
        f.m.rotation.y = Math.atan2(1, (STREAM_Z(f.x + 1) - STREAM_Z(f.x - 1)) / 2) - Math.PI / 2;
        f.m.scale.set(f.sc, 1, f.sc * (0.7 + Math.sin(t * 2 + f.x) * 0.2));
        f.m.material.opacity = 0.18 + Math.sin(t * 1.6 + f.x) * 0.08;
      }
    }

    // 연못 — 물줄기 흔들림 · 거품 · 연잎 · 잉어
    if (pond.jetGroup) {
      const pulse = 1 + Math.sin(t * 1.7) * 0.05;
      pond.column.scale.set(1, pulse, 1);
      pond.jetGroup.rotation.y = Math.sin(t * 0.25) * 0.06;
      pond.foam[0].scale.setScalar(1 + Math.sin(t * 2.3) * 0.02);
      pond.foam[1].scale.setScalar(1 + Math.sin(t * 1.9 + 1) * 0.015);
      // 연잎 — 물결 따라 천천히 흘러가며 살짝 흔들립니다 (빙글빙글 돌지 않게 회전은 아주 조금)
      for (const f of new Set(pond.lily.map((l) => l.flow))) {
        f.a += dt * f.sp;
        f.cr = f.rr + Math.sin(t * 0.21 + f.p) * 0.18;          // 안팎으로 조금씩
      }
      for (const l of pond.lily) {
        const f = l.flow;
        l.m.position.set(Math.cos(f.a) * f.cr + l.dx, l.y + Math.sin(t * 1.1 + f.p) * 0.006, Math.sin(f.a) * f.cr + l.dz);
        if (l.dx === 0) l.m.rotation.z += dt * f.spin;
      }
      for (const k of pond.koi) {
        k.a += dt * k.sp;
        k.m.position.set(Math.cos(k.a) * k.r, 0.3 + Math.sin(t * 1.1 + k.a) * 0.04, Math.sin(k.a) * k.r);
        k.m.rotation.y = -k.a + Math.PI / 2;
        k.m.rotation.z = Math.sin(t * 4 + k.a) * 0.12;
      }
    }

    // 석등 — 사람이 가까이 가면 불이 환해지고, 점광원 두 개가 가장 가까운 등으로 옮겨 갑니다
    {
      let best = [null, null], bestD = [Infinity, Infinity];
      for (const g of lamps) {
        const L = g.userData.lamp;
        const d = Math.hypot(g.position.x - player.position.x, g.position.z - player.position.z);
        const k = 1 - smooth(5, 17, d);
        L.lit = lerp(L.lit, k, Math.min(1, dt * 3));
        L.boxMat.emissiveIntensity = 0.55 + L.lit * 2.4;
        L.halo.material.opacity = 0.28 + L.lit * 0.5;
        L.halo.scale.setScalar(3.6 + L.lit * 2.2);
        if (d < bestD[0]) { bestD[1] = bestD[0]; best[1] = best[0]; bestD[0] = d; best[0] = g; }
        else if (d < bestD[1]) { bestD[1] = d; best[1] = g; }
      }
      roamLights.forEach((l, i) => {
        if (!best[i]) { l.intensity = 0; return; }
        l.position.set(best[i].position.x, best[i].position.y + 2.1, best[i].position.z);
        l.intensity = lerp(l.intensity, 20 * (1 - smooth(4, 18, bestD[i])), Math.min(1, dt * 4));
      });
    }

    // 단축키로 시점 돌리기 — Q/E 좌우로 돌기 · R/F 위아래 (C 는 keydown 에서)
    if (!typing() && !introOn) {
      if (keys.KeyQ) camYaw += dt * 1.9;
      if (keys.KeyE) camYaw -= dt * 1.9;
      const lie = camMode === 'lie';
      if (keys.KeyR) camPitch = clamp(camPitch + dt * 1.1, lie ? 0.5 : 0.04, lie ? 1.45 : 1.2);
      if (keys.KeyF) camPitch = clamp(camPitch - dt * 1.1, lie ? 0.5 : 0.04, lie ? 1.45 : 1.2);
    }

    // 카메라
    const head = tmp.set(player.position.x, player.position.y + 1.5, player.position.z);
    if (introOn) {
      // 시작 화면 — 분수를 중심으로 천천히 한 바퀴 (오른쪽에 장면이 오도록 살짝 비껴 봄)
      const a = t * 0.05 + 0.6;
      const cx = Math.sin(a) * 27, cz = Math.cos(a) * 27;
      camera.position.set(cx, groundY(cx, cz) + 7.5 + Math.sin(t * 0.13) * 0.8, cz);
      camera.lookAt(Math.cos(a) * -7.5, 2.2, -Math.sin(a) * -7.5);
    } else if (camMode === 'lie') {
      camera.position.set(player.position.x, player.position.y + 0.7, player.position.z);
      const p = Math.max(camPitch, 0.5);
      camera.lookAt(camera.position.x - Math.sin(camYaw) * Math.cos(p), camera.position.y + Math.sin(p), camera.position.z - Math.cos(camYaw) * Math.cos(p));
    } else {
      const dir = new THREE.Vector3(Math.sin(camYaw) * Math.cos(camPitch), Math.sin(camPitch), Math.cos(camYaw) * Math.cos(camPitch));
      camRay.set(head, dir);
      camRay.far = camDist;
      const hit = camRay.intersectObjects(occluders, false)[0];
      // 한 번 가리면 0.8초 동안은 그 거리를 유지 — 가렸다 안 가렸다 할 때 들락날락하지 않게
      if (hit) { camBlockD = camBlockT > 0 ? Math.min(camBlockD, hit.distance) : hit.distance; camBlockT = 0.8; }
      else if ((camBlockT -= dt) <= 0) camBlockD = Infinity;
      const block = camBlockD < Infinity ? { distance: camBlockD } : null;
      // 벽에 가리면 가까이 당기고, 벗어나면 천천히 물러납니다.
      // (바로 튕기듯 되돌리면 화면이 흔들립니다)
      const wantDist = block ? Math.max(0.8, block.distance - 0.45) : camDist;   // 벽 바로 앞이면 더 가까이 (1.5m 를 고집하면 벽 속으로 들어가 화면이 까맣게 됨)
      camDistNow = lerp(camDistNow, wantDist, Math.min(1, dt * (wantDist < camDistNow ? 12 : 2.2)));
      const want = head.clone().addScaledVector(dir, camDistNow);
      want.y = Math.max(want.y, groundY(want.x, want.z) + 0.7);
      camera.position.lerp(want, Math.min(1, dt * 5));
      // 아래 패널(장소 · 건반)이 화면을 가리는 만큼 시선을 내려, 캐릭터가 패널 위로 보이게 합니다
      const pnl = document.getElementById('panel');
      pnl.classList.toggle('compact', player.userData.pose !== 'stand');
      const cover = pnl.classList.contains('show') ? Math.min(0.6, pnl.offsetHeight / window.innerHeight) : 0;
      const viewH = 2 * camDistNow * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      lookDrop = lerp(lookDrop, cover * viewH * 0.5, Math.min(1, dt * 3));
      camera.lookAt(head.x, head.y - 0.15 - lookDrop, head.z);
    }
    sky.position.set(camera.position.x, 0, camera.position.z);
    // 밤하늘이 아주 천천히 돕니다 (별 · 별자리가 함께 옆으로 조금씩 흘러감 — 약 17분에 한 바퀴)
    if (night.mix > 0.05) {
      night.skyTurn = (night.skyTurn || 0) + dt * 0.006;
      night.stars.rotation.y = night.skyTurn;
      night.stars.material.uniforms.uTime.value = clock.elapsedTime;   // 반짝임
      night.dipper.rotation.y = night.skyTurn;
    }
    if (!introOn && introGlow > 0.001) introGlow = lerp(introGlow, 0, Math.min(1, dt * 1.2));
    renderer.toneMappingExposure = 1.0 - night.mix * 0.18 + introGlow;

    // 네트워크 (약 6회/초)
    // 네트워크 — 무료 요금제의 '실시간 메시지 수'를 아끼려고 꼭 필요할 때만 보냅니다.
    //   ① 초당 4회까지  ② 위치가 0.08 이상 움직였거나 자세가 바뀌었을 때만
    netTimer += dt;
    const movedEnough = Math.hypot(player.position.x - lastSentX, player.position.z - lastSentZ) > 0.08;
const sendGap = presentIds.length <= 4 ? 0.25 : presentIds.length <= 8 ? 0.4 : 0.6;   // 사람이 많을수록 덜 자주 (메시지 한도)
    if (netTimer > sendGap && (netDirty || movedEnough)) {
      lastSentX = player.position.x;
      lastSentZ = player.position.z;
      netTimer = 0;
      netDirty = false;
      store.send('move', {
        id: me.id, name: me.name, color: me.look.color, look: me.look,
        x: +player.position.x.toFixed(2), z: +player.position.z.toFixed(2), ry: +player.rotation.y.toFixed(2),
        pose: player.userData.pose,
        lift: +sitLift.toFixed(2),
      });
    }

    // 모습 고르기 창이 열려 있으면 작은 미리보기도 그립니다
    if (lookOpen && prevR && prevAv) {
      prevT += dt;
      prevAv.rotation.y = Math.sin(prevT * 0.55) * 0.75;
      animateAvatar(prevAv, dt, false);
      prevR.render(prevScene, prevCam);
    }
    if (composer) composer.render(dt); else renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  tick();
})().catch((e) => {
  console.error(e);
  const b = document.getElementById('enter');
  if (b) b.textContent = '불러오지 못했어요 (인터넷 연결 확인)';
});
