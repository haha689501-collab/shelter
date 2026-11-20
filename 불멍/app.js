/*
 * 불멍 캠프 — 별 아래 모닥불 앞에서 멍하니 쉬어 가는 3D 공간
 * ------------------------------------------------------------------
 *  쉼터 v2(../app.v2.js)의 캐릭터 · 대화 · 함께 모드 · 이동 규칙을 그대로 가져오고,
 *  장면(밤 숲 · 모닥불 · 텐트 · 해먹 · 호수)과 할 일을 새로 만들었습니다.
 *  텍스처 · 불꽃 · 소리 모두 코드로 만듭니다 (외부 파일 0개).
 *  설정은 같은 폴더의 config.js 에서 바꾸세요.
 */
(async () => {
  'use strict';

  const THREE = await import('https://unpkg.com/three@0.160.0/build/three.module.js');
  const C = window.SPACE_CONFIG;

  // 밤 팔레트 — 하늘은 깊은 남색, 빛은 모닥불 하나가 주인공입니다.
  const T = Object.assign({
    skyTop: '#03050f',
    skyMid: '#0a1230',
    skyBottom: '#1c2a4c',
    fog: '#0a1124',
    fire: '#ff9a4a',
  }, C.theme || {});

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
  // 내 정보 — 이름 · 모습은 쉼터와 같은 저장 칸을 써서, 쉼터에서 고른 모습 그대로 들어옵니다.
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
  me.look = (() => {
    try {
      const v = JSON.parse(localStorage.getItem('shelter:look') || 'null');
      if (v && v.color) return v;
    } catch (e) { /* 깨졌으면 새로 */ }
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
  const pathCode = (decodeURIComponent(location.pathname).match(/\/room\/([A-Za-z0-9가-힣-]+)/) || [])[1];
  const roomCode = (v) => String(v || '').replace(/[^a-zA-Z0-9가-힣-]/g, '').toUpperCase().slice(0, 12);
  const room = roomCode(params.get('room') || pathCode || 'main') || 'MAIN';
  // 쉼터와 같은 Supabase 를 함께 씁니다. 같은 방 코드라도 섞이지 않게 'BUL-' 를 붙여 저장합니다.
  const DBROOM = ('BUL-' + room).slice(0, 30);
  // 카운터 이름은 SQL 제약(water | cheer | happy)에 묶여 있어서, 뜻만 바꿔 빌려 씁니다.
  //   (쉼터 schema.v2.sql 을 고치지 않아도 바로 돌아가게)
  const CNT = { wood: 'water', smore: 'happy', lantern: 'cheer' };

  // ------------------------------------------------------------------
  // 저장소: 혼자 모드(localStorage) / 함께 모드(Supabase)
  //   저장하는 것: 풍등(kind 'wish') · 장작 수 · 마시멜로 수 · 랜턴 켠 수
  //   저장하지 않는 것: 대화 · 움직임 · '고민 태우기'의 글 (불에 태우면 그걸로 끝)
  // ------------------------------------------------------------------
  class LocalStore {
    constructor() { this.mode = 'local'; }
    key(k) { return `bulmeong:${room}:${k}`; }
    async list(kind) { return JSON.parse(localStorage.getItem(this.key(kind)) || '[]'); }
    async add(kind, text) {
      const arr = await this.list(kind);
      const item = { id: uid(), text, created_at: new Date().toISOString() };
      arr.push(item);
      localStorage.setItem(this.key(kind), JSON.stringify(arr.slice(-200)));
      return item;
    }
    async getCounter(name) { return Number(localStorage.getItem(this.key('c:' + name)) || 0); }
    async incCounter(name) {
      const v = (await this.getCounter(name)) + 1;
      localStorage.setItem(this.key('c:' + name), String(v));
      return v;
    }
    connect() {}
    send() {}
  }

  class SupaStore {
    constructor(sb) { this.sb = sb; this.mode = 'supabase'; this.channel = null; }
    async list(kind) {
      const { data, error } = await this.sb.from('shelter_messages')
        .select('id,text,created_at').eq('room', DBROOM).eq('kind', kind)
        .order('created_at', { ascending: false }).limit(120);
      if (error) throw error;
      return (data || []).reverse();
    }
    async add(kind, text) {
      const { data, error } = await this.sb.from('shelter_messages')
        .insert({ room: DBROOM, kind, text }).select('id,text,created_at').single();
      if (error) throw error;
      return data;
    }
    async getCounter(name) {
      const { data, error } = await this.sb.from('shelter_counters')
        .select('value').eq('room', DBROOM).eq('name', name).maybeSingle();
      if (error) throw error;
      return Number(data?.value || 0);
    }
    async incCounter(name) {
      const { data, error } = await this.sb.rpc('shelter_increment', { p_room: DBROOM, p_name: name });
      if (error) throw error;
      return Number(data);
    }
    connect(h) {
      const ch = this.sb.channel(`bulmeong:${room}`, { config: { presence: { key: me.id }, broadcast: { self: false } } });
      ch.on('presence', { event: 'sync' }, () => h.onPresence(Object.keys(ch.presenceState())))
        .on('broadcast', { event: 'move' }, ({ payload }) => h.onMove(payload))
        .on('broadcast', { event: 'act' }, ({ payload }) => h.onAct(payload))
        .on('broadcast', { event: 'chat' }, ({ payload }) => h.onChat(payload))
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'shelter_messages', filter: `room=eq.${DBROOM}` },
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
  const TOUCH = window.matchMedia('(pointer: coarse)').matches;   // 손가락으로 쓰는 화면 — 키보드 안내 대신 터치 안내
  const PHONE = /Android|iPhone|iPad/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, LOW ? 1.3 : 1.8));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = !LOW;
  renderer.shadowMap.type = PHONE ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  $('#app').appendChild(renderer.domElement);
  const ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // 빛 번짐(블룸) — 밤에는 불꽃 · 전구 · 별이 번져 보여야 '불멍' 느낌이 납니다.
  let composer = null;
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
      c.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.42, 0.45, 0.9));
      c.addPass(new OutputPass());
      c.setSize(window.innerWidth, window.innerHeight);
      composer = c;
    } catch (e) { console.warn('블룸 생략', e); }
  }

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(T.fog, 0.021);
  scene.background = new THREE.Color(T.skyTop);
  const fovFor = (aspect) => (aspect < 0.8 ? 62 : 48);
  const camera = new THREE.PerspectiveCamera(fovFor(window.innerWidth / window.innerHeight), window.innerWidth / window.innerHeight, 0.1, 700);

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
  // 네트워크 · 효과에서 쓰는 공용 상태 (앞에서 선언해 둬야 어느 함수에서 불러도 안전합니다)
  let netDirty = true, netTimer = 0, lastSentX = 0, lastSentZ = 0;
  let player = null;
  const floaters = [];
  const npcs = [];

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

  // 불멍에서 더 쓰는 질감 — 나무껍질 · 흙
  painters.bark = (d, S) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const n = fbm(u * 6, v * 30, 3, 6, 30);
      const ridge = 0.55 + 0.45 * Math.abs(Math.sin(u * Math.PI * 16 + n * 7));
      const k = (0.5 + n * 0.6) * ridge;
      px(d, S, x, y, 112 * k, 82 * k, 60 * k);
    }
  };
  painters.dirt = (d, S) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const a = fbm(u * 6, v * 6, 4, 6, 6);
      const b = fbm(u * 34, v * 34, 2, 34, 34);
      const peb = smooth(0.72, 0.8, fbm(u * 22 + 4, v * 22 + 9, 2, 22, 22));
      const k = 0.58 + a * 0.38 + b * 0.22 + peb * 0.25;
      px(d, S, x, y, 122 * k, 98 * k, 76 * k);
    }
  };
  ROUGH.bark = [0.72, 1]; BUMP.bark = 3.6;
  ROUGH.dirt = [0.8, 1]; BUMP.dirt = 2.8;

  // 원 모양으로 가장자리가 흐려지는 투명도 지도 (흙 마당 · 빛 웅덩이)
  function radialAlpha(inner = 0.55) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, '#fff');
    grd.addColorStop(inner, '#fff');
    grd.addColorStop(1, '#000');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }

  // ------------------------------------------------------------------
  // 밤하늘 — 남색 그라데이션 + 은하수 띠 + 반짝이는 별 + 달
  // ------------------------------------------------------------------
  const skyGroup = new THREE.Group();     // 카메라를 따라다닙니다 (아무리 걸어도 하늘이 멀리 있게)
  scene.add(skyGroup);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(T.skyTop) },
      mid: { value: new THREE.Color(T.skyMid) },
      bottom: { value: new THREE.Color(T.skyBottom) },
      uRot: { value: new THREE.Matrix3() },   // 별과 함께 하늘 무늬도 돌도록
      uTime: { value: 0 },
      uAurora: { value: 0.35 },              // 오로라 세기 (누우면 1)
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; uniform mat3 uRot; uniform float uTime; uniform float uAurora; varying vec3 vP;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h21(i), h21(i+vec2(1.0,0.0)), f.x), mix(h21(i+vec2(0.0,1.0)), h21(i+vec2(1.0,1.0)), f.x), f.y); }
      void main(){
        vec3 d = normalize(vP);
        float h = clamp(d.y * 1.35 + 0.06, 0.0, 1.0);
        vec3 c = mix(bottom, mid, smoothstep(0.0, 0.28, h));
        c = mix(c, top, smoothstep(0.2, 0.9, h));
        // 은하수 — 하늘을 비스듬히 가로지르는 옅은 띠 (구름처럼 뭉친 곳과 어두운 틈)
        vec3 n = normalize(vec3(0.62, 0.28, -0.73));
        vec3 ds = uRot * d;                     // 도는 하늘 기준 방향
        float band = exp(-pow(dot(ds, n) / 0.17, 2.0));
        vec2 uv = ds.xz / (abs(ds.y) + 0.55) * 3.0;
        float cl = vn(uv * 2.0) * 0.55 + vn(uv * 5.0) * 0.3 + vn(uv * 12.0) * 0.15;
        float dark = smoothstep(0.55, 0.75, vn(uv * 3.0 + 7.0));
        // (은하수 구름은 '하얀 연기'처럼 보여서 아주 옅게만 남깁니다)
        c += vec3(0.03, 0.035, 0.06) * band * smoothstep(0.25, 0.8, cl) * (1.0 - dark * 0.7) * smoothstep(-0.05, 0.3, d.y);
        // (오로라는 은은하지 않아 뺐습니다)
        // 지평선 쪽 아주 옅은 기운 (멀리 마을 불빛)
        c += vec3(0.07, 0.045, 0.035) * pow(max(0.0, 1.0 - abs(d.y) * 4.0), 3.0);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  skyGroup.add(new THREE.Mesh(new THREE.SphereGeometry(400, 32, 18), skyMat));

  // 별 — 크기 · 색 · 반짝이는 박자가 저마다 다릅니다
  const starMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPR: { value: renderer.getPixelRatio() }, uShow: { value: 1 } },
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
  });
  // 별이 도는 축 — 북쪽(+z, 호수 쪽) 하늘 40° 높이의 '북극성' 자리를 축으로 천천히 돕니다.
  //   (y 축으로 돌리면 머리 위 별은 제자리에서 맴돌기만 해서 '옆으로 흐르는' 느낌이 안 납니다)
  const POLE = new THREE.Vector3(0, Math.sin(THREE.MathUtils.degToRad(40)), Math.cos(THREE.MathUtils.degToRad(40))).normalize();
  const starSky = new THREE.Group();        // 별 · 별자리 · 은하수가 함께 돕니다
  skyGroup.add(starSky);
  const skyDir = (alt, az) => {             // 높이 · 방위(도) → 방향 (방위 0 = 북쪽 +z, 90 = +x)
    const a = THREE.MathUtils.degToRad(alt), z = THREE.MathUtils.degToRad(az);
    return new THREE.Vector3(Math.cos(a) * Math.sin(z), Math.sin(a), Math.cos(a) * Math.cos(z));
  };
  function makeStarPoints(list) {           // list: [{ v(방향), size, color:[r,g,b], phase }]
    const N = list.length;
    const pos = new Float32Array(N * 3), size = new Float32Array(N), ph = new Float32Array(N), col = new Float32Array(N * 3);
    list.forEach((s, i) => {
      pos.set([s.v.x * 360, s.v.y * 360, s.v.z * 360], i * 3);
      size[i] = s.size; ph[i] = s.phase; col.set(s.color, i * 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    const p = new THREE.Points(g, starMat);
    p.frustumCulled = false;
    p.renderOrder = -1;
    return p;
  }
  const starPts = (() => {
    // 하늘 전체(구 표면)에 '고르게' 뿌립니다 — 높이(y)를 균일하게 뽑으면 같은 넓이에 같은 수가 들어가서
    //   머리 위가 비지 않습니다. (예전엔 정육면체 점을 늘려 써서 천정 쪽이 성겼음)
    //   하늘이 돌면 지평선 아래 별이 올라오므로 아래쪽 반구도 함께 만듭니다.
    const N = LOW ? 4200 : 8000;
    const r = seeded(77);
    const band = new THREE.Vector3(0.62, 0.28, -0.73).normalize();
    const list = [];
    for (let i = 0; i < N; i++) {
      let v;
      for (let k = 0; k < 3; k++) {
        const y = r() * 2 - 1, th = r() * Math.PI * 2, rr = Math.sqrt(1 - y * y);
        v = new THREE.Vector3(rr * Math.cos(th), y, rr * Math.sin(th));
        if (Math.abs(v.dot(band)) < 0.2 || r() < 0.6) break;      // 은하수 근처는 조금 더 빽빽하게
      }
      const big = r(), tint = r();
      list.push({
        v,
        size: big > 0.988 ? 4.5 + r() * 2.5 : big > 0.92 ? 2.4 + r() * 1.4 : 1.1 + r() * 1.3,
        phase: r(),
        color: tint < 0.15 ? [1, 0.82, 0.66] : tint < 0.35 ? [0.75, 0.85, 1] : [1, 0.97, 0.92],
      });
    }
    return makeStarPoints(list);
  })();
  starSky.add(starPts);

  // 별자리 — 실제 별의 적경(시) · 적위(도) · 밝기(등급)로 모양을 그대로 옮겼습니다.
  //   밝은 별일수록 크고, 붉은 별(베텔게우스 · 안타레스)과 푸른 별(리겔 · 베가 · 레굴루스)은 색이 다릅니다.
  //   누워서 하늘을 보면 선이 한 획씩 그려지고, 이름과 짧은 이야기가 떠오릅니다.
  const RED = [1, 0.62, 0.45], BLUE = [0.72, 0.84, 1], GOLD = [1, 0.85, 0.55];
  const CONSTELLATIONS = [
    { name: '북두칠성', story: '국자 끝 두 별을 이으면 북극성이 보여요', alt: 62, az: 35,
      stars: [[11.062, 61.75, 1.8], [11.031, 56.38, 2.4], [11.897, 53.69, 2.4], [12.257, 57.03, 3.3], [12.900, 55.96, 1.8], [13.399, 54.93, 2.2], [13.792, 49.31, 1.9]],
      lines: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6]] },
    { name: '작은곰자리', story: '꼬리 끝의 북극성은 늘 같은 자리에', alt: 46, az: 6,
      stars: [[2.530, 89.26, 2.0], [17.537, 86.59, 4.4], [16.766, 82.04, 4.2], [15.734, 77.79, 4.3], [14.845, 74.16, 2.1], [15.345, 71.83, 3.0], [16.292, 75.76, 4.9]],
      lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]] },
    { name: '카시오페이아', story: 'W 모양으로 반짝이는 왕비', alt: 46, az: -42,
      stars: [[0.153, 59.15, 2.3], [0.675, 56.54, 2.2], [0.945, 60.72, 2.5], [1.430, 60.24, 2.7], [1.907, 63.67, 3.4]],
      lines: [[0, 1], [1, 2], [2, 3], [3, 4]] },
    { name: '백조자리', story: '은하수 위를 날아가는 커다란 십자', alt: 78, az: 120,
      stars: [[20.690, 45.28, 1.3], [20.370, 40.26, 2.2], [20.770, 33.97, 2.5], [19.750, 45.13, 2.9], [19.512, 27.96, 3.1, GOLD], [19.938, 35.08, 3.9]],
      lines: [[0, 1], [1, 5], [5, 4], [3, 1], [1, 2]] },
    { name: '거문고자리', story: '여름밤 가장 밝게 빛나는 직녀성 베가', alt: 64, az: 168,
      stars: [[18.615, 38.78, 0.0, BLUE], [18.739, 39.6, 4.7], [18.746, 37.6, 4.3], [18.908, 36.9, 4.3], [18.982, 32.69, 3.2], [18.835, 33.36, 3.5]],
      lines: [[0, 1], [0, 2], [2, 3], [3, 4], [4, 5], [5, 2]] },
    { name: '전갈자리', story: '붉은 심장 안타레스가 두근거려요', alt: 24, az: 182,
      stars: [[16.090, -19.81, 2.6], [16.006, -22.62, 2.3], [15.981, -26.11, 2.9], [16.353, -25.59, 2.9], [16.490, -26.43, 1.0, RED], [16.598, -28.22, 2.8], [16.836, -34.29, 2.3], [16.864, -38.05, 3.0], [16.910, -42.36, 3.6], [17.203, -43.24, 3.3], [17.622, -43.0, 1.9], [17.793, -40.13, 3.0], [17.708, -39.03, 2.4], [17.560, -37.10, 1.6]],
      lines: [[0, 1], [1, 2], [1, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 13]] },
    { name: '오리온자리', story: '세 개의 허리띠 별을 찬 겨울 사냥꾼', alt: 34, az: 236,
      stars: [[5.919, 7.41, 0.5, RED], [5.418, 6.35, 1.6], [5.679, -1.94, 1.8], [5.603, -1.20, 1.7], [5.533, -0.30, 2.2], [5.796, -9.67, 2.1], [5.242, -8.20, 0.1, BLUE], [5.585, 9.93, 3.4]],
      lines: [[7, 0], [7, 1], [0, 2], [1, 4], [2, 3], [3, 4], [2, 5], [4, 6]] },
    { name: '사자자리', story: '물음표를 뒤집은 갈기, 봄밤의 사자', alt: 40, az: 292,
      stars: [[10.139, 11.97, 1.4, BLUE], [10.122, 16.76, 3.5], [10.333, 19.84, 2.0], [10.278, 23.42, 3.4], [9.880, 26.0, 3.9], [9.764, 23.77, 3.0], [11.235, 20.52, 2.6], [11.237, 15.43, 3.3], [11.818, 14.57, 2.1]],
      lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [2, 6], [6, 8], [8, 7], [7, 0], [6, 7]] },
  ];
  const constels = [];
  {
    const eq = ([ra, dec]) => {           // 적경 · 적위 → 천구 위 방향 (적도 좌표)
      const a = ra * 15 * Math.PI / 180, d = dec * Math.PI / 180;
      return new THREE.Vector3(Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d));
    };
    const Z = new THREE.Vector3(0, 0, 1);
    const core = [], haloPos = [], haloCol = [];
    for (const c of CONSTELLATIONS) {
      // ① 별자리 안에서의 모양 — 중심에서 본 동쪽 · 북쪽 (그대로 옮겨서 좌우가 뒤집히지 않게)
      const vs = c.stars.map(eq);
      const cen = vs.reduce((s, v) => s.add(v), new THREE.Vector3()).normalize();
      const e0 = new THREE.Vector3().crossVectors(Z, cen).normalize();
      const n0 = Z.clone().addScaledVector(cen, -cen.z).normalize();
      // ② 우리 하늘의 자리 — 그 자리에서의 '북쪽'은 북극성 방향, '동쪽'은 북쪽 × 방향
      const dir = skyDir(c.alt, c.az);
      const n1 = POLE.clone().addScaledVector(dir, -POLE.dot(dir)).normalize();
      const e1 = new THREE.Vector3().crossVectors(n1, dir).normalize();
      const pts = vs.map((v) => {
        const k = v.dot(cen);
        return dir.clone().addScaledVector(e1, v.dot(e0) / k).addScaledVector(n1, v.dot(n0) / k).normalize();
      });
      pts.forEach((p, i) => {
        const mag = c.stars[i][2], col = c.stars[i][3] || [1, 0.96, 0.9];
        core.push({ v: p, size: clamp(2.8 + (4 - mag) * 1.1, 2.4, 7), phase: (i * 0.37) % 1, color: col });   // 또렷하게 (빛무리 공은 없이)
        const k = clamp(0.25 + (3.5 - mag) * 0.2, 0.08, 1);              // 밝은 별일수록 빛무리도 큼
        haloPos.push(p.x * 352, p.y * 352, p.z * 352);
        haloCol.push(col[0] * k, col[1] * k, col[2] * k);
      });
      // ③ 별자리 선 — 아주 가늘고 옅게, 별에 바로 붙지 않게 양 끝을 조금 띄움 (누우면 은은하게 떠오름)
      const seg = [];
      for (const [a, b] of c.lines) {
        const A = pts[a], B = pts[b], L = A.distanceTo(B), gap = Math.min(0.01, L * 0.22);
        const A2 = A.clone().lerp(B, gap / L), B2 = B.clone().lerp(A, gap / L);
        seg.push(A2.x * 354, A2.y * 354, A2.z * 354, B2.x * 354, B2.y * 354, B2.z * 354);
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
      const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#9fb6e8', transparent: true, opacity: 0.05, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
      lines.renderOrder = -1;
      lines.frustumCulled = false;
      starSky.add(lines);
      // ④ 이름 + 짧은 이야기 — 별자리 아래쪽에
      let low = pts[0];
      for (const p of pts) if (p.dot(n1) < low.dot(n1)) low = p;
      const at = low.clone().addScaledVector(n1, -0.07).normalize();
      const name = makeLabel(c.name, { size: 32, scale: 12, bg: 'rgba(12,16,40,0)', color: '#cdd8f5' });   // 배경 없이 옅은 글씨만
      name.position.copy(at).multiplyScalar(348);
      // 이름표는 텐트 천 · 나무에 가려지도록 (깊이 검사를 켬 — 예전엔 텐트 안에서도 비쳐 보였음)
      for (const lb of [name]) { lb.material.opacity = 0; lb.material.depthTest = true; lb.renderOrder = -1; starSky.add(lb); }
      constels.push({ name, lines });
    }
    starSky.add(makeStarPoints(core));
  }

  // 달 — 호수 건너편 낮게 떠서 물에 길게 비칩니다
  const MOON_DIR = new THREE.Vector3(0.18, 0.3, 1).normalize();
  const moonTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const img = g.createImageData(128, 128);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const dx = (x - 64) / 60, dy = (y - 64) / 60, r = Math.hypot(dx, dy);
      const i = (y * 128 + x) * 4;
      const m = fbm(x / 22, y / 22, 4) * 0.5 + fbm(x / 9 + 3, y / 9, 2) * 0.2;
      const k = 0.78 + m * 0.35 - (r > 0.7 ? (r - 0.7) * 0.4 : 0);
      img.data[i] = 250 * k; img.data[i + 1] = 246 * k; img.data[i + 2] = 230 * k;
      img.data[i + 3] = 255 * (1 - smooth(0.96, 1.0, r));
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  {
    const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, fog: false, depthWrite: false, toneMapped: false, color: '#fffaf0' }));
    moon.position.copy(MOON_DIR).multiplyScalar(340);
    moon.scale.setScalar(19);
    skyGroup.add(moon);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#9fb4ff', fog: false, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.position.copy(moon.position);
    halo.scale.setScalar(95);
    skyGroup.add(halo);
  }

  // 빛 — 달빛(푸르고 약하게) + 하늘빛 + 모닥불(주인공)
  scene.add(new THREE.HemisphereLight('#4a5f9c', '#2a1f15', 1.3));
  const camFill = new THREE.PointLight('#ffdcbc', 1.4, 7, 2);    // 카메라 쪽에서 얼굴을 살짝 — 역광에 얼굴이 새까맣지 않게
  scene.add(camFill);
  const moonLight = new THREE.DirectionalLight('#a8bcff', 1.15);
  moonLight.position.copy(MOON_DIR).multiplyScalar(60);
  scene.add(moonLight);

  // ------------------------------------------------------------------
  // 지형 — 가운데 캠프 마당은 평평하게, 북쪽(+z)에 호수, 멀리는 낮은 산자락
  // ------------------------------------------------------------------
  const LAKE = { x: 4, z: 33, rx: 15, rz: 10 };
  const lakeD = (x, z) => Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz);   // 1 = 물가
  const WATER_Y = -0.32;
  function terrainY(x, z) {
    const r = Math.hypot(x, z);
    let h = (fbm(x * 0.045 + 10, z * 0.045 + 5, 3) - 0.5) * 2.2 * smooth(16, 32, r);
    h += (fbm(x * 0.2, z * 0.2, 2) - 0.5) * 0.12;                                     // 마당의 아주 작은 굴곡
    h += smooth(34, 95, r) * (fbm(x * 0.012 + 3, z * 0.012 + 7, 3) * 18 - 3);         // 멀리 산자락
    h = lerp(-1.7, h, smooth(0.72, 1.18, lakeD(x, z)));                               // 호수 바닥
    return h;
  }
  // 호숫가 데크 — 물가까지 이어진 나무 마루
  const DECK = { x: LAKE.x, z: 21.2, hw: 2.6, hd: 2.4, y: 0.34 };
  const onDeck = (x, z) => Math.abs(x - DECK.x) < DECK.hw && Math.abs(z - DECK.z) < DECK.hd;
  function groundY(x, z) {
    const h = terrainY(x, z);
    return onDeck(x, z) ? Math.max(h, DECK.y) : h;
  }
  const standY = (x, z) => groundY(x, z) + 0.05;

  // 충돌 — 원 {x,z,r} · 회전 상자 {x,z,hw,hd,c,s} · 타원 {x,z,rx,rz}(호수)
  const blockers = [];
  function pushOut(pos, maxStep = 0.35) {
    for (let iter = 0; iter < 3; iter++) {
      let cx = 0, cz = 0, hits = 0;
      for (const b of blockers) {
        const dx = pos.x - b.x, dz = pos.z - b.z;
        if (b.rx !== undefined) {
          if (onDeck(pos.x, pos.z)) continue;            // 데크 위는 물 위라도 걸을 수 있습니다
          const e = Math.hypot(dx / b.rx, dz / b.rz);
          if (e >= 1) continue;
          const k = e > 1e-3 ? 1 / e : 1;
          cx += (b.x + dx * k) - pos.x;
          cz += (b.z + dz * k) - pos.z;
          hits++;
        } else if (b.hw !== undefined) {
          const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
          if (Math.abs(lx) >= b.hw || Math.abs(lz) >= b.hd) continue;
          const px2 = b.hw - Math.abs(lx), pz2 = b.hd - Math.abs(lz);
          let nlx = lx, nlz = lz;
          if (px2 < pz2) nlx = (lx < 0 ? -1 : 1) * b.hw; else nlz = (lz < 0 ? -1 : 1) * b.hd;
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
  const boxBlock = (x, z, hw, hd, ry) => blockers.push({ x, z, hw, hd, c: Math.cos(ry), s: Math.sin(ry) });
  // 물이 보이는 가장자리(땅이 수면 아래로 내려가는 곳)까지 막습니다. 데크 위만 예외
  //   (예전엔 0.93배라 물가 안쪽 1m 띠를 따라 물속을 걸을 수 있었음)
  blockers.push({ x: LAKE.x, z: LAKE.z, rx: LAKE.rx * 1.1, rz: LAKE.rz * 1.1 });

  const groundMeshes = [], clickables = [], occluders = [];
  const places = C.places.map((p) => ({ ...p, x: p.position[0], z: p.position[1], radius: p.radius || 7, state: {} }));
  const byType = (t) => places.filter((p) => p.type === t);
  const placeOf = (t) => byType(t)[0];

  // 오솔길 — 모닥불에서 각 장소로 이어지는 흙길 (땅 색에만 섞습니다)
  const trails = places.filter((p) => p.type !== 'fire').map((p) => [0, 0, p.x, p.z]);
  function trailD(x, z) {
    let best = Infinity;
    for (const [ax, az, bx, bz] of trails) {
      const vx = bx - ax, vz = bz - az, L = vx * vx + vz * vz;
      const t = clamp(((x - ax) * vx + (z - az) * vz) / L, 0, 1);
      const w = Math.sin(t * Math.PI * 2 + ax) * 0.9;       // 살짝 구불구불
      best = Math.min(best, Math.hypot(x - (ax + vx * t) - w * vz / Math.sqrt(L), z - (az + vz * t) + w * vx / Math.sqrt(L)));
    }
    return best;
  }
  {
    const SEG = LOW ? 120 : 190, SIZE = 300;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = -pos.getY(i);
      pos.setZ(i, terrainY(x, z));
      const n = fbm(x * 0.08, z * 0.08, 2);
      const path = 1 - smooth(0.6, 1.7, trailD(x, z) + (n - 0.5) * 0.8);
      const shore = 1 - smooth(1.0, 1.22, lakeD(x, z));
      const g = [0.42 + n * 0.16, 0.52 + n * 0.14, 0.42 + n * 0.1];
      const dirt = [0.95, 0.72, 0.55];
      const sand = [0.9, 0.82, 0.7];
      for (let k = 0; k < 3; k++) col[i * 3 + k] = lerp(lerp(g[k], dirt[k], path * 0.8), sand[k], shore * 0.7);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, matT('grass', { repeat: 75, color: '#ffffff', vertexColors: true }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    groundMeshes.push(ground);

    // 모닥불 둘레 흙 마당
    const yard = new THREE.Mesh(new THREE.CircleGeometry(6.4, 48),
      matT('dirt', { repeat: 3, color: '#b9a08a', transparent: true, alphaMap: radialAlpha(0.62), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    yard.rotation.x = -Math.PI / 2;
    yard.position.y = terrainY(0, 0) + 0.025;
    yard.receiveShadow = true;
    scene.add(yard);
  }

  // 먼 능선 — 하늘보다 조금 어두운 실루엣 두 겹 (가까운 쪽은 뾰족한 숲 모양)
  function ridgeRing(radius, base, amp, freq, color, jag) {
    const N = 320, pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
      let h = base + fbm(Math.cos(a) * freq + 20, Math.sin(a) * freq + 20, 4) * amp;
      if (jag) h += (hash2(i * 7, 3) - 0.5) * jag + Math.abs(Math.sin(i * 1.7)) * jag * 0.6;
      pos.push(x, -20, z, x, h, z);
      if (i < N) { const j = i * 2; idx.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, fog: false, side: THREE.DoubleSide }));
    m.renderOrder = -1;
    skyGroup.add(m);
  }
  ridgeRing(330, 14, 46, 2.2, '#0b1226', 0);
  ridgeRing(250, 10, 20, 3.4, '#060a17', 7);

  // ------------------------------------------------------------------
  // 숲 — 층층이 겹친 소나무 실루엣 (인스턴싱으로 수백 그루도 가볍게)
  // ------------------------------------------------------------------
  const pineGeo = (() => {
    const pts = [[0, 7.6], [0.95, 6.0], [0.5, 6.1], [1.45, 4.5], [0.75, 4.6], [1.95, 2.9], [0.95, 3.0], [2.35, 1.35], [0.2, 1.3], [0, 1.3]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    const g = new THREE.LatheGeometry(pts, 9);
    g.computeVertexNormals();
    return g;
  })();
  const trunkGeo = new THREE.CylinderGeometry(0.13, 0.24, 2.2, 7);
  trunkGeo.translate(0, 1.1, 0);
  const treeSpots = [];
  {
    const r = seeded(9);
    const avoid = (x, z) => {
      if (lakeD(x, z) < 1.32) return true;
      if (trailD(x, z) < 2.4) return true;
      for (const p of places) if (Math.hypot(x - p.x, z - p.z) < p.radius + (p.type === 'hammock' ? 9 : 1.5)) return true;
      return Math.hypot(x, z) < 11;
    };
    let tries = 0;
    const target = LOW ? 260 : 460;
    while (treeSpots.length < target && tries++ < 6000) {
      const a = r() * Math.PI * 2;
      const d = 12 + Math.pow(r(), 0.75) * 85;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (avoid(x, z)) continue;
      if (d < 22 && r() < 0.55) continue;        // 가까운 곳은 듬성듬성
      treeSpots.push({ x, z, s: 0.75 + r() * 0.9 * (d > 30 ? 1.2 : 0.8), ry: r() * 6.28, tint: r() });
    }
  }
  {
    const n = treeSpots.length;
    // 양면 — 카메라가 잎 덩어리 안으로 들어가는 것을 가림 검사가 놓치지 않게 (예전엔 바깥면만 감지해 화면이 검게 됨)
    const leaf = new THREE.InstancedMesh(pineGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, envMapIntensity: 0.1, flatShading: true, side: THREE.DoubleSide }), n);
    const trunk = new THREE.InstancedMesh(trunkGeo, matT('bark', { repeat: 1, color: '#7a5f4c' }), n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const c = new THREE.Color();
    treeSpots.forEach((t, i) => {
      p.set(t.x, terrainY(t.x, t.z) - 0.1, t.z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.ry);
      s.setScalar(t.s);
      m4.compose(p, q, s);
      leaf.setMatrixAt(i, m4);
      trunk.setMatrixAt(i, m4);
      c.set('#24402f').lerp(new THREE.Color('#1a2f2a'), t.tint);
      leaf.setColorAt(i, c);
      if (Math.hypot(t.x, t.z) < 50) blockers.push({ x: t.x, z: t.z, r: 0.35 * t.s + 0.15 });
    });
    leaf.castShadow = trunk.castShadow = true;
    occluders.push(leaf, trunk);          // 카메라가 나무 속에 들어가지 않게 (가리면 앞으로 당김)
    leaf.receiveShadow = true;
    scene.add(leaf, trunk);
  }

  // 풀포기 — 짧고 넓적한 잎 다섯 장이 부드럽게 휘어진 모양 (예전 뾰족한 잎은 '선인장 가시' 같았음)
  {
    const blade = new THREE.BufferGeometry();
    const v = [], ix = [];
    for (let b = 0; b < 5; b++) {
      const a = (b / 5) * Math.PI * 2 + 0.4;
      const cx = Math.cos(a), cz = Math.sin(a);          // 잎이 휘는 방향(바깥)
      const tx = -cz, tz = cx;                            // 잎의 너비 방향
      const H = 0.2 + (b % 2) * 0.06, bend = 0.09 + (b % 3) * 0.03;
      const rows = [[0, 0.045, 0], [0.45, 0.04, 0.35], [0.8, 0.026, 0.75], [1, 0.012, 1]];   // [높이비, 반너비, 휨비]
      const base = v.length / 3;
      for (const [hy, w, bk] of rows) {
        const ox = cx * bend * bk * bk, oz = cz * bend * bk * bk;
        v.push(ox - tx * w, hy * H, oz - tz * w, ox + tx * w, hy * H, oz + tz * w);
      }
      for (let r = 0; r < 3; r++) { const o = base + r * 2; ix.push(o, o + 1, o + 3, o, o + 3, o + 2); }
    }
    blade.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    blade.setIndex(ix);
    blade.computeVertexNormals();
    const N = LOW ? 3500 : 9000;
    const grass = new THREE.InstancedMesh(blade, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, side: THREE.DoubleSide, envMapIntensity: 0.1 }), N);
    const r = seeded(31), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    let k = 0, guard = 0;
    while (k < N && guard++ < N * 6) {
      const a = r() * Math.PI * 2, d = 5.5 + Math.pow(r(), 0.8) * 50;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (lakeD(x, z) < 1.1 || trailD(x, z) < 0.9 || onDeck(x, z)) continue;
      p.set(x, terrainY(x, z), z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
      s.setScalar(0.75 + r() * 0.6);
      m4.compose(p, q, s);
      grass.setMatrixAt(k, m4);
      c.set('#4f7342').lerp(new THREE.Color('#728a4c'), r());
      grass.setColorAt(k, c);
      k++;
    }
    grass.count = k;
    scene.add(grass);
  }

  // 바위 몇 개
  {
    const r = seeded(5);
    for (let i = 0; i < 26; i++) {
      const a = r() * 6.28, d = 8 + r() * 30;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (lakeD(x, z) < 1.05 || trailD(x, z) < 1.5 || places.some((p) => Math.hypot(x - p.x, z - p.z) < p.radius)) continue;
      const s = 0.3 + r() * 0.7;
      const rock = mesh(new THREE.DodecahedronGeometry(s, 1), matT('rock', { repeat: 1, color: '#8d8a92' }), x, terrainY(x, z) + s * 0.25, z);
      rock.scale.set(1.2, 0.6, 1);
      rock.rotation.y = r() * 6;
      rock.castShadow = rock.receiveShadow = true;
      scene.add(rock);
      if (s > 0.55) blockers.push({ x, z, r: s * 1.05 });
    }
  }

  // ------------------------------------------------------------------
  // 모닥불 — 돌 테두리 · 세워 쌓은 장작 · 숯불 · 불꽃(셰이더) · 불티 · 연기 · 일렁이는 빛
  // ------------------------------------------------------------------
  const FIRE_Y = terrainY(0, 0);
  const fire = { level: 1, boost: 0, flick: 1, flickT: 0, group: new THREE.Group(), flames: [], coals: [] };
  fire.group.position.set(0, FIRE_Y, 0);
  scene.add(fire.group);
  blockers.push({ x: 0, z: 0, r: 1.45 });
  {
    const g = fire.group;
    // 돌 테두리
    const r = seeded(12);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + r() * 0.1;
      const s = 0.22 + r() * 0.08;
      const st = mesh(new THREE.DodecahedronGeometry(s, 1), mat('#6e6864', { roughness: 0.95 })   /* 무늬 없는 매끈한 돌 */, Math.cos(a) * 1.08, s * 0.45, Math.sin(a) * 1.08);
      st.scale.set(1.25, 0.75, 1);
      st.rotation.set(r(), a, r());
      st.receiveShadow = true;
      g.add(st);
    }
    // 바닥 재 · 숯 — 가운데가 달아오른 원판
    const emberTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const x = c.getContext('2d');
      const img = x.createImageData(128, 128);
      for (let yy = 0; yy < 128; yy++) for (let xx = 0; xx < 128; xx++) {
        const dx = (xx - 64) / 64, dy = (yy - 64) / 64, rr = Math.hypot(dx, dy);
        const n = fbm(xx / 10, yy / 10, 3);
        const hot = Math.max(0, 1 - rr * 1.35) * (0.4 + n * 0.9);
        const i = (yy * 128 + xx) * 4;
        img.data[i] = 30 + hot * 255; img.data[i + 1] = 20 + hot * hot * 140; img.data[i + 2] = 16 + hot * hot * hot * 40;
        img.data[i + 3] = 255 * (1 - smooth(0.8, 1, rr));
      }
      x.putImageData(img, 0, 0);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    fire.bed = new THREE.Mesh(new THREE.CircleGeometry(0.95, 32), new THREE.MeshBasicMaterial({ map: emberTex, transparent: true, depthWrite: false }));
    fire.bed.rotation.x = -Math.PI / 2;
    fire.bed.position.y = 0.04;
    g.add(fire.bed);
    // 장작 — 원뿔처럼 기대어 세운 6개 + 바닥에 엇갈린 2개
    const barkM = matT('bark', { repeat: 1, color: '#6b5546' });
    const charM = new THREE.MeshStandardMaterial({ ...texSet('bark', 1), color: '#3a2a20', roughness: 1, emissive: '#ff4a10', emissiveIntensity: 0.0 });
    fire.charM = charM;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const log = new THREE.Group();
      const body = mesh(new THREE.CylinderGeometry(0.04, 0.095, 1.0, 8), i % 2 ? barkM : charM, 0, 0.5, 0);
      log.add(body);
      // 서로 엇갈려 기대도록 — 가운데(높이 약 1m)에서 교차하고, 가늘어진 끝은 반대편으로 살짝 빠져나갑니다
      //   (예전엔 끝이 한 점에 모여 둥근 뭉치처럼 보였음)
      log.position.set(Math.cos(a) * 0.56, 0, Math.sin(a) * 0.56);
      log.rotation.y = -a + [0.14, -0.1, 0.06, -0.16, 0.1, -0.05][i];
      log.rotation.z = 0.74 + (i % 3) * 0.05;   // 낮게 — 약 0.6m 에서 교차 (불꽃 크기는 그대로)          // 가운데로 기대기 (rotation.y 로 방향을 맞춘 뒤 z 로 기울임)
      log.rotation.order = 'YXZ';
      g.add(log);
    }
    for (const a of [0.4, 2.0]) {
      const l = mesh(new THREE.CylinderGeometry(0.11, 0.12, 1.7, 9), barkM, 0, 0.12, 0);
      l.rotation.set(0, a, Math.PI / 2);
      g.add(l);
    }
    // 달아오른 숯 조각
    const coalGeo = new THREE.DodecahedronGeometry(0.09, 0);
    for (let i = 0; i < 16; i++) {
      const a = r() * 6.28, d = r() * 0.55;
      const cm = new THREE.MeshStandardMaterial({ color: '#1a120e', emissive: '#ff5a1a', emissiveIntensity: 1.2 + r(), roughness: 1 });
      const c = mesh(coalGeo, cm, Math.cos(a) * d, 0.06, Math.sin(a) * d);
      c.scale.setScalar(0.7 + r() * 0.8);
      c.rotation.set(r() * 3, r() * 3, 0);
      g.add(c);
      fire.coals.push({ m: cm, base: cm.emissiveIntensity, p: r() * 6.28 });
    }
  }
  // 불꽃 — 얇은 판 여러 장에 잡음으로 일렁이는 불을 그립니다 (판은 늘 카메라를 향해 돕니다)
  const flameVS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  const flameFS = `
    uniform float uTime; uniform float uSeed; uniform float uPower; varying vec2 vUv;
    float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      return mix(mix(h21(i), h21(i+vec2(1.0,0.0)), f.x), mix(h21(i+vec2(0.0,1.0)), h21(i+vec2(1.0,1.0)), f.x), f.y); }
    float fb(vec2 p){ return vn(p) * 0.55 + vn(p * 2.1 + 3.1) * 0.3 + vn(p * 4.3 + 7.7) * 0.15; }
    void main(){
      float t = uTime + uSeed * 13.0;
      vec2 uv = vUv;
      float n1 = fb(vec2(uv.x * 2.6 + uSeed * 5.0, uv.y * 3.2 - t * 1.9));
      float n2 = fb(vec2(uv.x * 5.5 - uSeed * 3.0, uv.y * 6.0 - t * 3.1));
      float x = (uv.x - 0.5) * 2.0;
      x += (n1 - 0.5) * 0.9 * uv.y;                               // 위로 갈수록 크게 흔들림
      float w = mix(0.95, 0.04, pow(uv.y, 0.75));
      float shape = 1.0 - smoothstep(w * 0.35, w, abs(x));
      float h = uv.y + (n2 - 0.5) * 0.4;
      float top = 1.0 - smoothstep(0.25 * uPower, 0.95, h);
      float a = shape * top * smoothstep(0.0, 0.1, uv.y);
      a *= smoothstep(0.12, 0.55, n1 * 0.55 + n2 * 0.45 + (1.0 - uv.y) * 0.55);
      a = clamp(a * 1.5, 0.0, 1.0);
      vec3 col = mix(vec3(0.85, 0.16, 0.02), vec3(1.0, 0.52, 0.1), smoothstep(0.08, 0.5, a));
      col = mix(col, vec3(1.0, 0.78, 0.42), smoothstep(0.6, 0.98, a));
      gl_FragColor = vec4(col * a * 0.6, a);
    }`;
  {
    const specs = [
      { w: 1.7, h: 2.7, x: 0, z: 0, seed: 0.1 },
      { w: 1.15, h: 2.0, x: 0.3, z: 0.1, seed: 0.37 },
      { w: 1.15, h: 1.9, x: -0.28, z: -0.12, seed: 0.73 },
      { w: 0.9, h: 1.5, x: 0.05, z: 0.32, seed: 0.55 },
      { w: 0.9, h: 1.4, x: -0.1, z: -0.32, seed: 0.91 },
    ];
    for (const s of specs) {
      const geo = new THREE.PlaneGeometry(s.w, s.h);
      geo.translate(0, s.h / 2, 0);
      const m = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uSeed: { value: s.seed }, uPower: { value: 1 } },
        vertexShader: flameVS, fragmentShader: flameFS,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      });
      const f = mesh(geo, m, s.x, 0.08, s.z);
      f.renderOrder = 5;
      f.userData.base = s;
      fire.group.add(f);
      fire.flames.push(f);
    }
    // 불 주변 빛무리 (블룸이 없는 휴대폰에서도 따뜻해 보이게)
    fire.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ff8a3a', transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    fire.glow.position.y = 0.9;
    fire.glow.scale.setScalar(4.2);
    fire.group.add(fire.glow);
    // 땅에 비친 불빛 웅덩이
    const pool = new THREE.Mesh(new THREE.CircleGeometry(5.5, 40), new THREE.MeshBasicMaterial({ color: '#ff8030', transparent: true, opacity: 0.16, alphaMap: radialAlpha(0.05), depthWrite: false, blending: THREE.AdditiveBlending }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.035;
    fire.group.add(pool);
    fire.pool = pool;
  }
  // 모닥불 빛 — 그림자를 드리우는 점광원 하나 (일렁임은 아주 은은하게)
  const fireLight = new THREE.PointLight(T.fire, 36, 0, 2);
  fireLight.position.set(0, FIRE_Y + 1.15, 0);
  if (!LOW) {
    fireLight.castShadow = true;
    fireLight.shadow.mapSize.set(1024, 1024);
    fireLight.shadow.bias = -0.004;
    fireLight.shadow.normalBias = 0.03;
    fireLight.shadow.camera.near = 0.5;
    fireLight.shadow.camera.far = 40;
  }
  scene.add(fireLight);

  // 불티 — 작은 불씨가 휘돌며 올라가다 식어서 사라집니다
  const EMBERS = LOW ? 70 : 150;
  const emberData = [];
  const emberGeo = new THREE.BufferGeometry();
  emberGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(EMBERS * 3), 3));
  emberGeo.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(EMBERS), 1));
  emberGeo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(EMBERS), 1));
  const emberMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uPR: { value: renderer.getPixelRatio() }, uH: { value: window.innerHeight } },
    vertexShader: `
      attribute float aLife; attribute float aSize; varying float vL; uniform float uPR; uniform float uH;
      void main(){
        vL = aLife;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uPR * uH * 0.0025 / max(0.5, -mv.z) * 10.0;
      }`,
    fragmentShader: `
      varying float vL;
      void main(){
        if (vL <= 0.0) discard;
        float r = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.05, r);
        vec3 hot = vec3(1.0, 0.85, 0.45), cool = vec3(1.0, 0.25, 0.04);
        vec3 c = mix(cool, hot, smoothstep(0.35, 1.0, vL));
        gl_FragColor = vec4(c * a * smoothstep(0.0, 0.3, vL) * 1.6, 1.0);
      }`,
  });
  const emberPts = new THREE.Points(emberGeo, emberMat);
  emberPts.frustumCulled = false;
  emberPts.renderOrder = 6;
  scene.add(emberPts);
  for (let i = 0; i < EMBERS; i++) emberData.push({ x: 0, y: -10, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, ph: Math.random() * 6.28, size: 1 });
  function spawnEmber(e, burst = 1) {
    const a = Math.random() * 6.28, d = Math.random() * 0.45;
    e.x = Math.cos(a) * d; e.z = Math.sin(a) * d; e.y = FIRE_Y + 0.3 + Math.random() * 0.5;
    e.vx = (Math.random() - 0.5) * 0.3 * burst; e.vz = (Math.random() - 0.5) * 0.3 * burst;
    e.vy = (0.9 + Math.random() * 1.4) * (burst > 1 ? 1.7 : 1);
    e.max = e.life = 1.6 + Math.random() * 2.4;
    e.size = 0.5 + Math.random() * 0.9;
    e.ph = Math.random() * 6.28;
  }
  let emberAcc = 0;
  function sparkBurst(n = 40) {
    let k = 0;
    for (const e of emberData) { if (e.life <= 0 || Math.random() < 0.4) { spawnEmber(e, 2.4); if (++k >= n) break; } }
  }
  // 연기 — 아주 옅게, 불빛을 받아 아래쪽만 살짝 붉게
  const smokes = [];
  for (let i = 0; i < (LOW ? 6 : 12); i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: '#8a8290', transparent: true, opacity: 0, depthWrite: false }));
    s.renderOrder = 4;
    scene.add(s);
    smokes.push({ s, t: i / 12, sp: 0.07 + Math.random() * 0.03, dx: (Math.random() - 0.5) * 2 });
  }

  // ------------------------------------------------------------------
  // 둘러앉는 자리 — 통나무 벤치 4개(2자리씩) + 캠핑 의자 2개 = 10자리, 모두 불을 바라봅니다
  //   off = 엉덩이가 땅에서 얼마나 위에 있나 − 0.42 (앉기 규약, 쉼터와 같음)
  // ------------------------------------------------------------------
  const seats = [];
  const seatGroups = [];     // 불멍 중엔 숨깁니다 (불에만 집중)
  const SEAT_R = 3.55;
  const ringItems = [['chair', 40], ['log', 112], ['log', 160], ['chair', 205], ['log', 285], ['log', 332]];
  const barkM2 = matT('bark', { repeat: 1, color: '#8a6d58' });
  const ringEndTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#c9a77f'; g.fillRect(0, 0, 64, 64);
    for (let i = 1; i < 9; i++) { g.strokeStyle = `rgba(110,70,40,${0.25 + (i % 2) * 0.15})`; g.lineWidth = 1.4; g.beginPath(); g.arc(32 + i * 0.3, 32, i * 3.4, 0, 6.29); g.stroke(); }
    g.strokeStyle = '#5a4130'; g.lineWidth = 5; g.beginPath(); g.arc(32, 32, 30, 0, 6.29); g.stroke();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const endM = new THREE.MeshStandardMaterial({ map: ringEndTex, roughness: 0.9 });
  const CHAIR_COLORS = ['#b5533c', '#3c6b8a'];
  let chairN = 0;
  for (const [kind, deg] of ringItems) {
    const a = THREE.MathUtils.degToRad(deg);
    const x = Math.sin(a) * SEAT_R, z = Math.cos(a) * SEAT_R;
    const face = Math.atan2(-x, -z);            // 불을 바라보는 방향
    const y0 = terrainY(x, z);
    if (kind === 'log') {
      const g = new THREE.Group();
      g.position.set(x, y0, z);
      g.rotation.y = face;
      const log = mesh(new THREE.CylinderGeometry(0.25, 0.27, 2.2, 14), barkM2, 0, 0.27, 0);
      log.rotation.z = Math.PI / 2;
      log.castShadow = log.receiveShadow = true;
      g.add(log);
      for (const s of [-1, 1]) {
        const cap = mesh(new THREE.CircleGeometry(0.25, 16), endM, s * 1.101, 0.27, 0);
        cap.rotation.y = s * Math.PI / 2;
        g.add(cap);
        const chock = mesh(new THREE.BoxGeometry(0.16, 0.12, 0.5), barkM2, s * 0.75, 0.05, 0);
        g.add(chock);
      }
      // 앉는 자리가 반들반들 — 윗면을 살짝 깎아 낸 판
      const top = mesh(new THREE.BoxGeometry(2.0, 0.03, 0.26), matT('wood', { repeat: 1, color: '#d6b08a' }), 0, 0.515, 0);
      top.receiveShadow = true;
      g.add(top);
      scene.add(g);
      seatGroups.push(g);
      boxBlock(x, z, 1.12, 0.3, face);
      for (const s of [-0.52, 0.52]) {
        const sx = x + Math.cos(face) * s, sz = z - Math.sin(face) * s;
        seats.push({ x: sx, z: sz, ry: face, off: 0.53 - 0.42, kind, mesh: log });
      }
      log.userData = { kind: 'seat', seats: seats.slice(-2) };
      clickables.push(log);
    } else {
      // 캠핑 의자 — X 자 다리 + 천 좌판 + 기울어진 등받이
      const g = new THREE.Group();
      g.position.set(x, y0, z);
      g.rotation.y = face;
      const frame = mat('#2c2d33', { roughness: 0.5, metalness: 0.6 });
      const cloth = matT('cloth', { repeat: 1, color: CHAIR_COLORS[chairN++ % 2] });
      for (const s of [-1, 1]) {
        for (const d of [-1, 1]) {
          const leg = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.62, 6), frame, s * 0.26, 0.24, 0);
          leg.rotation.x = d * 0.62;
          g.add(leg);
        }
        const arm = mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.5, 6), frame, s * 0.29, 0.6, 0.02);
        arm.rotation.x = Math.PI / 2;
        g.add(arm);
      }
      const seatC = mesh(new THREE.BoxGeometry(0.56, 0.04, 0.48), cloth, 0, 0.45, 0);
      seatC.rotation.x = -0.08;
      const back = mesh(new THREE.BoxGeometry(0.56, 0.6, 0.035), cloth, 0, 0.78, -0.27);
      back.rotation.x = -0.22;
      seatC.castShadow = back.castShadow = true;
      g.add(seatC, back);
      // 의자에 걸쳐 둔 담요
      const blanket = mesh(new THREE.BoxGeometry(0.5, 0.02, 0.62), matT('cloth', { repeat: 2, color: '#d9c6a0' }), 0.03, 0.97, -0.33);
      blanket.rotation.x = -1.1;
      g.add(blanket);
      scene.add(g);
      seatGroups.push(g);
      blockers.push({ x, z, r: 0.38 });
      seats.push({ x, z, ry: face, off: 0.49 - 0.42, kind, mesh: seatC });
      seatC.userData = { kind: 'seat', seats: seats.slice(-1) };
      back.userData = seatC.userData;
      clickables.push(seatC, back);
    }
  }

  // 장작더미 · 도끼 꽂힌 그루터기
  {
    const x = -5.6, z = 3.4, ry = Math.atan2(-x, -z);
    const g = new THREE.Group();
    g.position.set(x, terrainY(x, z), z);
    g.rotation.y = ry;
    const logG = new THREE.CylinderGeometry(0.11, 0.12, 1.2, 8);
    let k = 0;
    for (let row = 0; row < 4; row++) for (let i = 0; i < 4 - row; i++) {
      const l = mesh(logG, k++ % 3 ? barkM2 : matT('bark', { repeat: 1, color: '#a3836a' }), (i - (3 - row) / 2) * 0.24, 0.12 + row * 0.2, 0);
      l.rotation.x = Math.PI / 2;
      l.castShadow = true;
      g.add(l);
      const cap = mesh(new THREE.CircleGeometry(0.11, 10), endM, l.position.x, l.position.y, 0.601);
      g.add(cap);
    }
    const stump = mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.5, 12), barkM2, 1.1, 0.25, 0.2);
    stump.castShadow = true;
    g.add(stump);
    const topC = mesh(new THREE.CircleGeometry(0.32, 14), endM, 1.1, 0.505, 0.2);
    topC.rotation.x = -Math.PI / 2;
    g.add(topC);
    const axe = new THREE.Group();
    axe.position.set(1.1, 0.55, 0.2);
    axe.rotation.set(0.3, 0.6, -0.5);
    axe.add(mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.62, 6), mat('#a07a52'), 0, 0.3, 0));
    axe.add(mesh(new THREE.BoxGeometry(0.2, 0.12, 0.03), mat('#8b9096', { metalness: 0.7, roughness: 0.4 }), 0.06, 0.02, 0));
    g.add(axe);
    scene.add(g);
    boxBlock(x + Math.cos(ry) * 0.5, z - Math.sin(ry) * 0.5, 1.2, 0.5, ry);
    occluders.push(stump);
  }

  // 전구 줄 — 캠프를 빙 둘러 기둥 사이에 늘어진 꼬마전구
  const bulbs = { pts: null, base: [] };
  const garlandObjs = [];     // 꼬마전구 줄(가랜드) 전부 — 텐트 안에 누우면 숨깁니다
  {
    const N = 7, R = 9.2, top = 2.7;
    const poles = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + 0.22;
      const x = Math.sin(a) * R, z = Math.cos(a) * R;
      if (trailD(x, z) < 1.2) continue;
      const p = mesh(new THREE.CylinderGeometry(0.05, 0.07, top + 0.1, 7), barkM2, x, terrainY(x, z) + top / 2, z);
      p.castShadow = true;
      scene.add(p);
      garlandObjs.push(p);
      blockers.push({ x, z, r: 0.25 });
      poles.push(new THREE.Vector3(x, terrainY(x, z) + top, z));
    }
    const pos = [], wire = [];
    for (let i = 0; i < poles.length; i++) {
      const A = poles[i], B = poles[(i + 1) % poles.length];
      const M = 14;
      for (let k = 0; k <= M; k++) {
        const t = k / M;
        const p = A.clone().lerp(B, t);
        p.y -= Math.sin(t * Math.PI) * 0.65;
        wire.push(p.x, p.y, p.z);
        if (k > 0 && k < M && k % 2 === 0) pos.push(p.x, p.y - 0.07, p.z);
      }
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    const campWire = new THREE.Line(wg, new THREE.LineBasicMaterial({ color: '#1a1714' }));
    scene.add(campWire);
    garlandObjs.push(campWire);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    bulbs.pts = new THREE.Points(bg, new THREE.PointsMaterial({ map: glowTex, color: '#ffd08a', size: 0.55, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    scene.add(bulbs.pts);
    garlandObjs.push(bulbs.pts);
    const core = new THREE.Points(bg, new THREE.PointsMaterial({ map: glowTex, color: '#fff3d0', size: 0.16, transparent: true, depthWrite: false, sizeAttenuation: true }));
    scene.add(core);
    garlandObjs.push(core);
  }

  // 천 무늬 — 줄무늬 · 조각보(퀼트). 캔버스로 그려 천 질감 위에 색을 입힙니다
  function stripeTex(colors, n = 12, across = true) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const w = 128 / n;
    for (let i = 0; i < n; i++) {
      g.fillStyle = colors[i % colors.length];
      if (across) g.fillRect(i * w, 0, w + 1, 128); else g.fillRect(0, i * w, 128, w + 1);
    }
    g.globalAlpha = 0.18;                       // 실 결
    for (let y = 0; y < 128; y += 2) { g.fillStyle = y % 4 ? '#000' : '#fff'; g.fillRect(0, y, 128, 1); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  function quiltTex(colors) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const r = seeded(colors.length * 7 + colors[0].length);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      g.fillStyle = colors[Math.floor(r() * colors.length)];
      g.fillRect(x * 32, y * 32, 32, 32);
      g.fillStyle = 'rgba(255,255,255,.35)';    // 작은 꽃 · 점 무늬
      for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(x * 32 + 5 + r() * 22, y * 32 + 5 + r() * 22, 1.6 + r() * 1.6, 0, 6.3); g.fill(); }
    }
    g.strokeStyle = 'rgba(255,248,230,.75)';    // 바느질 선
    g.setLineDash([3, 3]);
    g.lineWidth = 1.5;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, 128); g.moveTo(0, i * 32); g.lineTo(128, i * 32); g.stroke(); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const BULB_COLORS = ['#ffcf7a', '#ff9a8a', '#9fd8ff', '#b8f0a0', '#e7b8ff'];
  // 꼬마전구 줄 — a 에서 b 까지 늘어지게 (색색 전구)
  function bulbString(parent, a, b, sag, n, colors = BULB_COLORS, size = 0.32) {
    const pos = [], col = [], wire = [];
    const cc = new THREE.Color();
    for (let k = 0; k <= 24; k++) {
      const t = k / 24, p = a.clone().lerp(b, t);
      p.y -= Math.sin(t * Math.PI) * sag;
      wire.push(p.x, p.y, p.z);
    }
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1), p = a.clone().lerp(b, t);
      p.y -= Math.sin(t * Math.PI) * sag + 0.05;
      pos.push(p.x, p.y, p.z);
      cc.set(colors[k % colors.length]);
      col.push(cc.r, cc.g, cc.b);
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    const wireL = new THREE.Line(wg, new THREE.LineBasicMaterial({ color: '#2a2420' }));
    parent.add(wireL);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    bg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const glow = new THREE.Points(bg, new THREE.PointsMaterial({ map: glowTex, vertexColors: true, size, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    const core = new THREE.Points(bg, new THREE.PointsMaterial({ map: glowTex, color: '#fff6e0', size: size * 0.3, transparent: true, depthWrite: false, sizeAttenuation: true }));
    parent.add(glow, core);
    garlandObjs.push(wireL, glow, core);
    return glow;
  }

  // ------------------------------------------------------------------
  // 텐트촌 — 안에 랜턴이 켜지면 천 전체가 은은하게 빛납니다
  // ------------------------------------------------------------------
  const tents = [];
  function tentGeo(w, h, L) {
    // 삼각 기둥 — 앞(문)은 비워 두고, 뒤 · 지붕 두 장 · 바닥
    const hw = w / 2, hl = L / 2;
    const v = [
      -hw, 0, -hl, hw, 0, -hl, 0, h, -hl,           // 뒤
      -hw, 0, -hl, 0, h, -hl, 0, h, hl, -hw, 0, hl, // 왼 지붕
      hw, 0, -hl, hw, 0, hl, 0, h, hl, 0, h, -hl,   // 오른 지붕
    ];
    const ix = [0, 2, 1, 3, 6, 5, 3, 5, 4, 7, 10, 9, 7, 9, 8];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    const uv = [0, 0, 1, 0, 0.5, 1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1, 0, 1, 1, 0, 1];
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(ix);
    g.computeVertexNormals();
    return g;
  }
  {
    const p = placeOf('tent');
    const TENT_COLORS = ['#f1e4c8', '#e9d8bd', '#f3e6d0'];        // 벨 텐트 — 크림색 캔버스
    const TRIM = ['#c96a5a', '#5f8a6e', '#7c6aa8'];
    const spots = p ? [[p.x + 1.8, p.z + 2.2], [p.x - 3.2, p.z - 0.6], [p.x + 1.4, p.z - 3.4]] : [];
    spots.forEach(([x, z], i) => {
      const ry = Math.atan2(-x, -z);       // 문이 모닥불 쪽
      const g = new THREE.Group();
      g.position.set(x, terrainY(x, z), z);
      g.rotation.y = ry;
      // 벨 텐트 — 낮은 원통 벽 + 원뿔 지붕. 모닥불 쪽으로 문이 넓게(110°) 열려 있어
      //   안에 누우면 열린 문 너머로 모닥불과 별이 보입니다.
      const m = new THREE.MeshStandardMaterial({ ...texSet('cloth', 2), color: TENT_COLORS[i], roughness: 0.95, side: THREE.DoubleSide, emissive: '#ff9a40', emissiveIntensity: 0 });
      const OPEN = 1.92, T0 = OPEN / 2, TL = Math.PI * 2 - OPEN;     // 문 = θ 0 (로컬 +z) 둘레
      const R = 1.75, WALL = 0.8, ROOF_R = 1.95, ROOF_H = 1.55;
      const wall = mesh(new THREE.CylinderGeometry(R, R, WALL, 40, 1, true, T0, TL), m, 0, WALL / 2, 0);
      const roof = mesh(new THREE.ConeGeometry(ROOF_R, ROOF_H, 40, 1, true, T0, TL), m, 0, WALL + ROOF_H / 2, 0);
      wall.castShadow = roof.castShadow = true;
      wall.receiveShadow = roof.receiveShadow = true;
      g.add(wall, roof);
      // 처마 띠 — 색 천을 한 바퀴
      const trimM = new THREE.MeshStandardMaterial({ map: stripeTex([TRIM[i], '#fff4e0'], 24), side: THREE.DoubleSide, roughness: 0.9 });
      g.add(mesh(new THREE.CylinderGeometry(ROOF_R + 0.01, ROOF_R + 0.01, 0.13, 40, 1, true, T0, TL), trimM, 0, WALL - 0.02, 0));
      // 삼각 깃발 줄 — 처마를 따라 알록달록
      const flagGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.09, 0, 0), new THREE.Vector3(0.09, 0, 0), new THREE.Vector3(0, -0.2, 0)]);
      flagGeo.computeVertexNormals();
      const FLAG_C = ['#e45b4f', '#f6a646', '#f7d774', '#5fb3a8', '#3d7fa8', '#b58ad8'];
      for (let k = 0; k < 22; k++) {
        const th = T0 + 0.08 + (k / 21) * (TL - 0.16);
        const fl = mesh(flagGeo, new THREE.MeshStandardMaterial({ color: FLAG_C[k % FLAG_C.length], side: THREE.DoubleSide, roughness: 0.8 }), Math.sin(th) * (ROOF_R + 0.03), WALL - 0.08, Math.cos(th) * (ROOF_R + 0.03));
        fl.rotation.y = th;
        g.add(fl);
      }
      // 꼭대기 — 작은 모자와 깃발
      g.add(mesh(new THREE.ConeGeometry(0.12, 0.16, 12), mat(TRIM[i]), 0, WALL + ROOF_H + 0.06, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6), mat('#6b5040'), 0, WALL + ROOF_H + 0.3, 0));
      const pen = mesh(new THREE.PlaneGeometry(0.3, 0.16), new THREE.MeshStandardMaterial({ color: TRIM[i], side: THREE.DoubleSide }), 0.15, WALL + ROOF_H + 0.47, 0);
      g.add(pen);
      // 걷어 묶은 문 자락 — 열린 문 양쪽에 둥글게 말린 천
      for (const s of [-1, 1]) {
        const th = s * T0;
        const roll = mesh(new THREE.CylinderGeometry(0.075, 0.075, WALL + 0.35, 10), m, Math.sin(th) * (R + 0.02), (WALL + 0.35) / 2, Math.cos(th) * (R + 0.02));
        roll.rotation.z = -s * 0.08;
        g.add(roll);
        const tie = mesh(new THREE.TorusGeometry(0.085, 0.015, 6, 12), mat(TRIM[i]), roll.position.x, 0.55, roll.position.z);
        tie.rotation.x = Math.PI / 2;
        g.add(tie);
      }
      // 바닥 — 둥근 깔개
      const floor = mesh(new THREE.CircleGeometry(R - 0.05, 40), new THREE.MeshStandardMaterial({ map: stripeTex(['#7a6a58', '#8d7b66'], 10, false), roughness: 1 }), 0, 0.03, 0);
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      g.add(floor);
      // 줄 · 말뚝 — 문 쪽은 비우고 뒤 · 옆으로 다섯 줄
      for (let k = 0; k < 5; k++) {
        const th = Math.PI + (k - 2) * 0.62;
        const rope = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(Math.sin(th) * ROOF_R, WALL, Math.cos(th) * ROOF_R), new THREE.Vector3(Math.sin(th) * 3.0, 0.02, Math.cos(th) * 3.0)]);
        g.add(new THREE.Line(rope, new THREE.LineBasicMaterial({ color: '#5c5548' })));
        g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.18, 5), mat('#6b5040'), Math.sin(th) * 3.0, 0.07, Math.cos(th) * 3.0));
      }
      // 랜턴 — 안쪽 뒤 벽 가까이 (누웠을 때 시야를 가리지 않게)
      const lanternM = new THREE.MeshStandardMaterial({ color: '#ffe0a8', emissive: '#ffb050', emissiveIntensity: 2, roughness: 0.4 });
      g.add(mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.2, 10), lanternM, 0.55, 1.05, -1.25));
      g.add(mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.03, 10), mat('#2b2724', { metalness: 0.6 }), 0.55, 1.16, -1.25));
      const light = new THREE.PointLight('#ffb35a', 0, 9, 2);
      light.position.set(0, 1.3, 0.2);
      g.add(light);
      // 잠자리 — 두툼한 매트리스 · 조각보 이불 · 베개 둘 (머리는 안쪽, 발은 문 쪽)
      const QUILTS = [['#e98a6a', '#f4c36b', '#f7e3c0', '#c96a5a'], ['#7fb38a', '#e8d9a8', '#a8cfa0', '#5f8a6e'], ['#a98ad0', '#f2b8c6', '#f4e6f0', '#7c6aa8']];
      const bed = new THREE.Group();
      bed.position.set(0, 0.04, -0.45);
      const mattress = mesh(new THREE.BoxGeometry(1.0, 0.16, 2.05), matT('cloth', { repeat: 2, color: '#f3ead8' }), 0, 0.08, 0);
      const piping = mesh(new THREE.BoxGeometry(1.03, 0.03, 2.08), mat(QUILTS[i][3], { roughness: 0.8 }), 0, 0.16, 0);
      const qm = new THREE.MeshStandardMaterial({ map: quiltTex(QUILTS[i]), roughness: 0.9 });
      const quilt = mesh(new THREE.BoxGeometry(1.06, 0.07, 1.35), qm, 0, 0.2, 0.35);
      const fold = mesh(new THREE.CapsuleGeometry(0.06, 0.95, 4, 10), qm, 0, 0.24, -0.33);
      fold.rotation.z = Math.PI / 2;
      bed.add(mattress, piping, quilt, fold);
      for (const s of [-1, 1]) {
        const pil = mesh(new THREE.CapsuleGeometry(0.12, 0.26, 4, 12), s < 0 ? mat('#fffaf0', { roughness: 0.85 }) : new THREE.MeshStandardMaterial({ map: stripeTex([QUILTS[i][0], '#fff6e8'], 8), roughness: 0.85 }), s * 0.22, 0.25, -0.78);
        pil.rotation.z = Math.PI / 2;
        pil.scale.set(1, 1, 0.55);
        bed.add(pil);
      }
      bed.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.add(bed);
      // 천장 꼬마전구 — 뒤에서 앞으로 한 줄
      bulbString(g, new THREE.Vector3(0, 1.95, -1.1), new THREE.Vector3(0, 1.75, 1.0), 0.15, 9, BULB_COLORS, 0.2);
      // 문 앞 동그란 러그
      const rug = mesh(new THREE.CircleGeometry(0.75, 32), new THREE.MeshStandardMaterial({ map: stripeTex([QUILTS[i][0], QUILTS[i][2], QUILTS[i][1]], 9, false), roughness: 1 }), 0, 0.025, 2.35);
      rug.rotation.x = -Math.PI / 2;
      rug.scale.set(1, 0.7, 1);
      rug.receiveShadow = true;
      g.add(rug);
      scene.add(g);
      blockers.push({ x, z, r: R + 0.1 });
      occluders.push(wall, roof);
      wall.userData = roof.userData = { kind: 'tent', i };
      clickables.push(wall, roof);
      const at = (lz) => new THREE.Vector3(0, 0, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry).add(new THREE.Vector3(x, 0, z));
      const lie = at(0.5), door = at(2.7);
      tents.push({ g, m, light, lanternM, on: i !== 1, lie: { x: lie.x, z: lie.z, ry }, door: { x: door.x, z: door.z }, x, z });
    });
  }
  function setTent(i, on) {
    const t = tents[i];
    if (!t) return;
    t.on = on;
  }

  // ------------------------------------------------------------------
  // 해먹 — 두 나무 사이에 걸린 천, 누우면 천천히 흔들립니다
  // ------------------------------------------------------------------
  const hammock = { swing: 0 };
  {
    const p = placeOf('hammock');
    if (p) {
      const hamDecor = new THREE.Group();      // 두 소나무 · 랜턴 · 꼬마전구 — 해먹에 누우면 숨깁니다 (하늘을 가리지 않게)
      scene.add(hamDecor);
      hammock.decor = hamDecor;
      const ang = 0.7;                                  // 해먹이 걸린 방향
      const ax = Math.cos(ang), az = -Math.sin(ang);
      const A = new THREE.Vector3(p.x - ax * 2.1, 0, p.z - az * 2.1), B = new THREE.Vector3(p.x + ax * 2.1, 0, p.z + az * 2.1);
      // 해먹 나무 — 층층 원뿔 소나무는 아래로 뾰족한 잎끝이 보여서, 곧은 줄기 위쪽에만 가지와 둥근 잎 뭉치를 둡니다
      for (const q of [A, B]) {
        q.y = terrainY(q.x, q.z);
        const t = new THREE.Group();
        t.position.copy(q);
        const barkM = matT('bark', { repeat: 1, color: '#7d6250' });
        const leafM = new THREE.MeshStandardMaterial({ color: '#2f5238', roughness: 1, flatShading: true });
        t.add(mesh(new THREE.CylinderGeometry(0.15, 0.28, 4.4, 14), barkM, 0, 2.2, 0));   // 곧은 줄기 (끝은 수관 속에 숨음)
        for (let k = 0; k < 5; k++) {                        // 뿌리 — 밑동이 땅을 움켜쥔 모양
          const a2 = k * 1.26 + 0.4;
          const root = mesh(new THREE.CylinderGeometry(0.04, 0.12, 0.75, 6), barkM, Math.cos(a2) * 0.32, 0.1, Math.sin(a2) * 0.32);
          root.rotation.set(-Math.sin(a2) * 1.15, 0, Math.cos(a2) * 1.15);
          t.add(root);
        }
        // 수관 — 줄기 끝을 감싸는 둥근 잎 덩어리 여러 개 (가지가 삐죽 보이면 꺾인 기둥처럼 보였음)
        const rr = seeded(q === A ? 51 : 52);
        const leafSoft = new THREE.MeshStandardMaterial({ color: '#2d4d36', roughness: 1 });
        for (let k = 0; k < 11; k++) {                     // 3.2m 부터 둥글게 — 서 있는 눈높이에서도 '나무'로 보이게
          const a2 = rr() * 6.28, d = k === 0 ? 0 : 0.6 + rr() * 0.8, h = 3.5 + rr() * 1.7;
          const cl = mesh(new THREE.IcosahedronGeometry(0.85 + rr() * 0.5, 2), leafSoft, Math.cos(a2) * d, h, Math.sin(a2) * d);
          cl.scale.set(1.15, 0.85, 1.15);
          t.add(cl);
        }
        // 해먹 줄을 감아 묶은 밧줄 고리
        const ring = mesh(new THREE.TorusGeometry(0.27, 0.035, 6, 18), mat('#d8c9a8', { roughness: 0.9 }), 0, 1.9, 0);
        ring.rotation.x = Math.PI / 2;
        t.add(ring);
        t.traverse((o) => { if (o.isMesh) { o.castShadow = true; occluders.push(o); } });
        hamDecor.add(t);
        blockers.push({ x: q.x, z: q.z, r: 0.45 });
      }
      const y0 = terrainY(p.x, p.z);
      const pivot = new THREE.Group();          // 흔들림 축 = 두 나무를 잇는 선
      pivot.position.set(p.x, y0 + 1.75, p.z);
      pivot.rotation.y = ang;
      scene.add(pivot);
      const L = 3.2, W = 0.95;
      const geo = new THREE.PlaneGeometry(L, W, 24, 6);
      const pa = geo.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        const x = pa.getX(i), yv = pa.getY(i);
        const u = x / (L / 2), v = yv / (W / 2);
        const sag = 1.05 * (1 - u * u);
        const narrow = 1 - 0.75 * Math.pow(Math.abs(u), 2.2);   // 끝으로 갈수록 오므라듦
        pa.setXYZ(i, x, -0.15 - sag + v * v * 0.22 * narrow, v * W / 2 * narrow);
      }
      geo.computeVertexNormals();
      const hamTex = stripeTex(['#e45b4f', '#f6a646', '#f7d774', '#fff4dc', '#5fb3a8', '#3d7fa8', '#fff4dc', '#f6a646'], 16, false);
      const cloth = mesh(geo, new THREE.MeshStandardMaterial({ map: hamTex, normalMap: texSet('cloth', 2).normalMap, side: THREE.DoubleSide, roughness: 0.9 }));
      cloth.castShadow = cloth.receiveShadow = true;
      // 줄무늬 한 줄
      pivot.add(cloth);
      for (const s of [-1, 1]) {
        const rope = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(s * 1.84, 0.15, 0), new THREE.Vector3(s * 1.6, -0.15, 0)]);   // 나무에 감은 고리에서 천 끝으로
        pivot.add(new THREE.Line(rope, new THREE.LineBasicMaterial({ color: '#6e6656' })));
      }
      cloth.userData = { kind: 'hammock' };
      clickables.push(cloth);
      // 양쪽 가장자리 술 장식 — 천 끝을 따라 색실이 달랑달랑
      {
        const tasM = [mat('#f7d774'), mat('#e45b4f'), mat('#5fb3a8')];
        const tg = new THREE.CylinderGeometry(0.012, 0.02, 0.16, 5);
        for (let k = -7; k <= 7; k++) {
          const x = k * 0.19, u = x / (L / 2);
          const narrow = 1 - 0.75 * Math.pow(Math.abs(u), 2.2);
          const y = -0.15 - 1.05 * (1 - u * u) + 0.22 * narrow - 0.08;
          for (const s of [-1, 1]) {
            const ts = mesh(tg, tasM[(k + 7) % 3], x, y, s * (W / 2) * narrow);
            pivot.add(ts);
          }
        }
        // 베개 · 담요 — 머리 쪽에 폭신한 베개, 발 쪽에 접힌 니트 담요
        const pilG = new THREE.Group();                     // 천의 기울기(이 자리에서 약 -0.66)를 따라 눕힘
        pilG.position.set(-0.95, -0.74, 0);
        pilG.rotation.z = -0.66;
        const pil = mesh(new THREE.CapsuleGeometry(0.11, 0.22, 4, 12), mat('#fff6e8', { roughness: 0.85 }));
        pil.rotation.x = Math.PI / 2;
        pil.scale.set(1, 1, 0.6);
        pilG.add(pil);
        const blanket = mesh(new THREE.BoxGeometry(0.5, 0.05, 0.42), new THREE.MeshStandardMaterial({ map: quiltTex(['#f4c36b', '#e98a6a', '#fff1d6']), roughness: 0.95 }), 0.75, -0.92, 0);
        blanket.rotation.z = 0.55;                          // 천의 기울기를 따라
        pil.castShadow = blanket.castShadow = true;
        // (베개 · 이불은 두지 않습니다 — 해먹만으로 충분)
      }
      // 두 소나무 사이 위쪽에 색색 꼬마전구 줄 + 나무에 매단 랜턴
      bulbString(hamDecor, new THREE.Vector3(A.x, A.y + 2.9, A.z), new THREE.Vector3(B.x, B.y + 2.9, B.z), 0.5, 14);
      for (const [q, h] of [[A, 2.4], [B, 2.1]]) {
        const lanM = new THREE.MeshStandardMaterial({ color: '#ffe2b0', emissive: '#ffa850', emissiveIntensity: 1.8 });
        const lan = mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.22, 10), lanM, q.x + Math.cos(ang) * (q === A ? 0.3 : -0.3), q.y + h, q.z - Math.sin(ang) * (q === A ? 0.3 : -0.3));
        hamDecor.add(lan);
        // 걸이 — 줄기에서 랜턴 위까지 짧은 나무 막대 + 끈
        const bx = lan.position.x - q.x, bz = lan.position.z - q.z;
        const arm = mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.36, 6), mat('#5a4030'), q.x + bx * 0.55, lan.position.y + 0.3, q.z + bz * 0.55);
        arm.rotation.order = 'YXZ';
        arm.rotation.y = Math.atan2(bx, bz);     // 랜턴 쪽을 보고
        arm.rotation.x = Math.PI / 2;            // 눕혀서 줄기에서 수평으로 뻗게
        hamDecor.add(arm);
        hamDecor.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(lan.position.x, lan.position.y + 0.11, lan.position.z), new THREE.Vector3(lan.position.x, lan.position.y + 0.3, lan.position.z)]), new THREE.LineBasicMaterial({ color: '#3a2c22' })));
        const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffb46a', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
        gl.position.copy(lan.position);
        gl.scale.setScalar(1.4);
        hamDecor.add(gl);
      }
      const hamLight = new THREE.PointLight('#ffc68a', 5, 9, 2);
      hamLight.position.set(p.x, y0 + 2.6, p.z);
      scene.add(hamLight);
      hammock.pivot = pivot;
      hammock.ry = ang;
      hammock.x = p.x; hammock.z = p.z;
      hammock.off = 1.75 - 1.2 - 0.3;          // 누운 몸이 천 바닥에 닿게 (lie 자세는 몸이 0.34 위에 뜸)
      hammock.side = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang));   // 흔들리는 방향(천의 옆)
    }
  }

  // ------------------------------------------------------------------
  // 호수 · 데크 — 달빛이 물 위에 길게 비치고, 풍등이 하늘로 올라갑니다
  // ------------------------------------------------------------------
  const water = {};
  {
    const g = new THREE.CircleGeometry(1, 64);
    const wm = new THREE.MeshStandardMaterial({ color: '#0b1a33', roughness: 0.78, metalness: 0.05, ...{ normalMap: texSet('ripple', 26).normalMap }, transparent: true, opacity: 0.94 });
    wm.normalScale = new THREE.Vector2(0.16, 0.16);
    const w = new THREE.Mesh(g, wm);
    w.rotation.x = -Math.PI / 2;
    w.scale.set(LAKE.rx * 1.12, LAKE.rz * 1.15, 1);
    w.position.set(LAKE.x, WATER_Y, LAKE.z);
    w.receiveShadow = true;
    scene.add(w);
    water.mat = wm;
    // 달빛 길 — 물 위에 가늘고 길게 끊어지며 반짝이는 띠
    const c = document.createElement('canvas');
    c.width = 64; c.height = 256;
    const x = c.getContext('2d');
    const img = x.createImageData(64, 256);
    for (let yy = 0; yy < 256; yy++) for (let xx = 0; xx < 64; xx++) {
      const u = (xx - 32) / 32, v = yy / 256;
      const across = Math.exp(-u * u * (6 + v * 10));
      const along = Math.sin(v * Math.PI);
      const breaks = smooth(0.35, 0.75, fbm(xx / 7, yy / 3.2, 3));
      const a = across * along * (0.25 + breaks * 0.95);
      const i = (yy * 64 + xx) * 4;
      img.data[i] = 255; img.data[i + 1] = 250; img.data[i + 2] = 235; img.data[i + 3] = clamp(a * 255, 0, 255);
    }
    x.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping;
    water.glade = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: t, color: '#7f90bc', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));   // 은은한 달빛 (예전 #c9d6ff 는 너무 하얬음)
    water.glade.rotation.order = 'YXZ';
    water.glade.renderOrder = 3;
    scene.add(water.glade);
    // 데크
    const deckM = matT('wood', { repeat: 2, color: '#b38d6a' });
    const top = mesh(new THREE.BoxGeometry(DECK.hw * 2, 0.12, DECK.hd * 2), deckM, DECK.x, DECK.y - 0.06, DECK.z);
    top.castShadow = top.receiveShadow = true;
    scene.add(top);
    for (const sx of [-1, 1]) for (const sz of [-1, 0, 1]) {
      const px2 = DECK.x + sx * (DECK.hw - 0.15), pz2 = DECK.z + sz * (DECK.hd - 0.15);
      const post = mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.2, 7), deckM, px2, DECK.y - 1.1, pz2);
      scene.add(post);
    }
    // 난간 — 양옆만 (앞은 물가에 걸터앉을 수 있게 비워 둠)
    for (const sx of [-1, 1]) {
      const rail = mesh(new THREE.BoxGeometry(0.07, 0.07, DECK.hd * 2), deckM, DECK.x + sx * (DECK.hw - 0.1), DECK.y + 0.75, DECK.z);
      scene.add(rail);
      for (const sz of [-1, 0, 1]) scene.add(mesh(new THREE.BoxGeometry(0.07, 0.75, 0.07), deckM, DECK.x + sx * (DECK.hw - 0.1), DECK.y + 0.38, DECK.z + sz * (DECK.hd - 0.12)));
      boxBlock(DECK.x + sx * (DECK.hw + 0.05), DECK.z, 0.14, DECK.hd, 0);
    }
    // 데크 끝 작은 등불
    const lampM = new THREE.MeshStandardMaterial({ color: '#ffe2b0', emissive: '#ffb050', emissiveIntensity: 1.6 });
    for (const sx of [-1, 1]) {
      const lp = mesh(new THREE.BoxGeometry(0.16, 0.22, 0.16), lampM, DECK.x + sx * (DECK.hw - 0.1), DECK.y + 0.9, DECK.z + DECK.hd - 0.12);
      scene.add(lp);
      garlandObjs.push(lp);                  // 텐트 안에 누우면 숨김
      const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffb46a', transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
      gl.position.copy(lp.position);
      gl.scale.setScalar(1.3);
      scene.add(gl);
      garlandObjs.push(gl);
    }
    const deckLight = new THREE.PointLight('#ffb46a', 4, 10, 2);
    deckLight.position.set(DECK.x, DECK.y + 1.3, DECK.z + 1.6);
    scene.add(deckLight);
    // 물가 갈대
    const reedM = new THREE.MeshStandardMaterial({ color: '#3c4a2c', roughness: 1 });
    const rr = seeded(44);
    for (let i = 0; i < 70; i++) {
      const a = rr() * 6.28;
      const k = 0.98 + rr() * 0.12;
      const x2 = LAKE.x + Math.cos(a) * LAKE.rx * k, z2 = LAKE.z + Math.sin(a) * LAKE.rz * k;
      if (Math.abs(x2 - DECK.x) < DECK.hw + 1.2 && z2 < LAKE.z) continue;
      const h = 0.7 + rr() * 0.9;
      const reed = mesh(new THREE.CylinderGeometry(0.008, 0.02, h, 4), reedM, x2, terrainY(x2, z2) + h / 2, z2);
      reed.rotation.set((rr() - 0.5) * 0.3, 0, (rr() - 0.5) * 0.3);
      scene.add(reed);
      if (rr() < 0.4) {
        const head = mesh(new THREE.CapsuleGeometry(0.03, 0.14, 3, 6), mat('#5a3f2c'), x2, terrainY(x2, z2) + h, z2);
        scene.add(head);
      }
    }
  }
  // 물가에 걸터앉는 자리 (데크 끝)
  const deckSeats = [-0.7, 0.7].map((dx) => ({ x: DECK.x + dx, z: DECK.z + DECK.hd - 0.3, ry: 0, off: 0.05 - 0.42, kind: 'deck' }));

  // 반딧불이 — 물가와 숲 가장자리에서 천천히 깜빡입니다
  const flies = (() => {
    const N = LOW ? 50 : 110;
    const base = [];
    const r = seeded(3);
    for (let i = 0; i < N; i++) {
      const nearLake = r() < 0.55;
      let x, z;
      if (nearLake) { const a = r() * 6.28, k = 1.05 + r() * 0.3; x = LAKE.x + Math.cos(a) * LAKE.rx * k; z = LAKE.z + Math.sin(a) * LAKE.rz * k; }
      else { const a = r() * 6.28, d = 13 + r() * 16; x = Math.cos(a) * d; z = Math.sin(a) * d; }
      base.push({ x, y: terrainY(x, z) + 0.4 + r() * 1.8, z, p: r() * 6.28, s: 0.6 + r() * 0.8 });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(N), 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(N).fill(0.9), 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: emberMat.uniforms,
      vertexShader: emberMat.vertexShader,
      fragmentShader: `
        varying float vL;
        void main(){
          float r = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, r); a *= a;
          gl_FragColor = vec4(vec3(0.75, 1.0, 0.45) * a * vL * 1.4, 1.0);
        }`,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    scene.add(pts);
    return { pts, base };
  })();

  // 장소 이름표 — 멀리서 보이고, 가까이 가면 숨깁니다
  const placeLabels = [];
  for (const p of places) {
    if (p.type === 'fire') continue;
    const lb = makeLabel(p.name, { size: 34, scale: 0.7, bg: 'rgba(20,14,10,.5)', color: '#ffe2b8' });
    const h = p.type === 'lake' ? DECK.y + 3.2 : p.type === 'tent' ? 3.6 : 3.4;
    lb.position.set(p.x, terrainY(p.x, p.z) + h, p.z);
    scene.add(lb);
    placeLabels.push(lb);
  }

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
    // 불멍: 눈 반짝임은 빛을 받는 재질로 — 스스로 빛나는 흰색은 어두운 밤 얼굴에서 눈만 번쩍여 무서워 보였음
    const mGlint = new THREE.MeshStandardMaterial({ color: '#f4f0ea', roughness: 0.3, envMapIntensity: 0 });

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
    if (u.strumT !== undefined) u.strumT += dt;
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
      // 마시멜로 굽기 — 꼬챙이 든 팔을 불 쪽으로 길게 뻗습니다
      // 불꽃막대 — 앞으로 든 팔을 천천히 흔들어 불꽃으로 그림을 그리듯
      if (u.sparkler && i === 1) { rx = -1.15 + Math.sin(u.t * 2.1) * 0.28; rz = sgn * (0.5 + Math.sin(u.t * 1.6) * 0.22); er = -0.3 + Math.sin(u.t * 2.6) * 0.1; }   // 몸 바깥쪽으로 — 얼굴을 가리지 않게
      if (u.roasting && i === 1 && u.pose === 'sit') { rx = -1.0 + Math.sin(u.t * 0.7) * 0.03; rz = sgn * 0.08; er = -0.12; }
      // 기타 — 한 손은 넥을 잡고, 한 손은 줄 위에서 위아래로 긁습니다
      if (u.guitar && u.pose === 'sit') {
        if (i === 1) { rx = -0.95; rz = sgn * 0.42; er = -0.75; }
        else {
          const k2 = Math.max(0, 1 - (u.strumT === undefined ? 9 : u.strumT) / 0.2);
          rx = -0.55; rz = sgn * -0.28; er = -1.2 + (u.strumDir < 0 ? -k2 : k2) * 0.28;
        }
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
  // 손에 드는 것들 — 기타 · 마시멜로 꼬챙이 · 장작 · 구긴 종이 · 납작한 돌
  // ------------------------------------------------------------------
  function makeGuitar() {
    const g = new THREE.Group();
    const wood = mat('#c0844a', { roughness: 0.5 });
    const side = mat('#7a4a26', { roughness: 0.6 });
    const dark = mat('#3a2418', { roughness: 0.6 });
    const lower = mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.09, 22), side, 0, -0.07, 0);
    lower.rotation.x = Math.PI / 2;
    const upperB = mesh(new THREE.CylinderGeometry(0.145, 0.145, 0.09, 20), side, 0, 0.16, 0);
    upperB.rotation.x = Math.PI / 2;
    const top1 = mesh(new THREE.CircleGeometry(0.19, 22), wood, 0, -0.07, 0.046);
    const top2 = mesh(new THREE.CircleGeometry(0.145, 20), wood, 0, 0.16, 0.0461);
    const hole = mesh(new THREE.CircleGeometry(0.05, 16), mat('#140c08'), 0, 0.07, 0.047);
    const neck = mesh(new THREE.BoxGeometry(0.05, 0.46, 0.03), dark, 0, 0.5, 0.03);
    const head = mesh(new THREE.BoxGeometry(0.07, 0.12, 0.028), dark, 0, 0.79, 0.03);
    const bridge = mesh(new THREE.BoxGeometry(0.1, 0.015, 0.012), dark, 0, -0.1, 0.05);
    g.add(lower, upperB, top1, top2, hole, neck, head, bridge);
    const sm = new THREE.LineBasicMaterial({ color: '#e8e2d0', transparent: true, opacity: 0.6 });
    for (let i = 0; i < 4; i++) {
      const x = (i - 1.5) * 0.011;
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, -0.1, 0.055), new THREE.Vector3(x, 0.73, 0.048)]), sm));
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }
  function giveGuitar(av) {
    const u = av.userData;
    if (u.guitarObj) return;
    const gt = makeGuitar();
    // 무릎 위에 비스듬히 — 넥은 왼손(+x) 쪽 위로
    gt.position.set(-0.04, 0.16, 0.3);
    gt.rotation.set(-0.25, 0, -1.15);
    u.upper.add(gt);
    u.guitarObj = gt;
    u.guitar = true;
  }
  function takeGuitar(av) {
    const u = av.userData;
    if (u.guitarObj) u.upper.remove(u.guitarObj);
    u.guitarObj = null;
    u.guitar = false;
  }

  const MALLOW_STOPS = [[0, '#fff8ee'], [0.45, '#f2c77e'], [0.75, '#c07a3c'], [1.0, '#5a321a'], [1.25, '#1c1410']];
  const _mc = new THREE.Color(), _mc2 = new THREE.Color();
  function mallowColor(lv, out) {
    for (let i = 1; i < MALLOW_STOPS.length; i++) {
      const [b, cb] = MALLOW_STOPS[i], [a, ca] = MALLOW_STOPS[i - 1];
      if (lv <= b || i === MALLOW_STOPS.length - 1) {
        return out.set(ca).lerp(_mc2.set(cb), clamp((lv - a) / (b - a), 0, 1));
      }
    }
    return out;
  }
  function giveStick(av) {
    const u = av.userData;
    if (u.stickObj2) return;
    const g = new THREE.Group();
    const stick = mesh(new THREE.CylinderGeometry(0.012, 0.016, 1.55, 6), mat('#8a6a48'), 0, -0.78, 0);
    g.add(stick);
    const mm = new THREE.MeshStandardMaterial({ color: '#fff8ee', roughness: 0.75 });
    const mallow = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.09, 12), mm, 0, -1.5, 0);
    g.add(mallow);
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ff8a2a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    flame.position.y = -1.5;
    flame.scale.setScalar(0.35);
    g.add(flame);
    g.position.set(0, -0.26, 0.02);
    g.rotation.x = -0.72;                  // 팔 끝에서 앞 위로 길게
    u.arms[1].elbow.add(g);
    g.userData = { mm, flame, mallow };
    u.stickObj2 = g;
    u.roasting = true;
    u.roastLv = u.roastLv || 0;
  }
  function takeStick(av) {
    const u = av.userData;
    if (u.stickObj2) u.arms[1].elbow.remove(u.stickObj2);
    u.stickObj2 = null;
    u.roasting = false;
    u.roastLv = 0;
  }
  const MALLOW_GONE = 1.9;     // 불이 붙고(1.12) 약 7초 더 두면 다 타서 재가 됨
  // 다 타 버림 — 재 한 덩이가 툭 떨어지고, 꼬챙이는 내려놓음 (먹은 수에는 안 셈)
  function burnAway(av, mine) {
    const s = av.userData.stickObj2;
    if (s) {
      const from = new THREE.Vector3();
      s.userData.mallow.getWorldPosition(from);
      const ash = mesh(new THREE.DodecahedronGeometry(0.035, 0), new THREE.MeshStandardMaterial({ color: '#1c1714', emissive: '#ff4a10', emissiveIntensity: 0.5, roughness: 1 }), from.x, from.y, from.z);
      scene.add(ash);
      projectiles.push({ obj: ash, from, to: new THREE.Vector3(from.x, standY(from.x, from.z) + 0.03, from.z), t: 0, dur: 0.55, h: 0.04 });
    }
    floatEmoji(mine ? '😭' : '💨', av.position.clone().add(new THREE.Vector3(0, 2.1, 0)), 0.7, 1.4);
    takeStick(av);
    if (mine) {
      toast('😭 마시멜로가 다 타 버렸어요… 새로 구워 볼까요?', 3000);
      store.send('act', { id: me.id, type: 'burnt' });
      netDirty = true;
      showPanel(currentPlace, true);
    }
  }
  function tintMallow(av, t) {
    const u = av.userData, s = u.stickObj2;
    if (!s) return;
    mallowColor(u.roastLv, s.userData.mm.color);
    const burning = u.roastLv > 1.12;
    // 불이 붙은 뒤 — 불길이 점점 커지고 마시멜로는 까맣게 쪼그라듦 (MALLOW_GONE 에서 재가 되어 떨어짐)
    const bk = clamp((u.roastLv - 1.12) / (MALLOW_GONE - 1.12), 0, 1);
    s.userData.flame.material.opacity = burning ? (0.7 + Math.sin(t * 17) * 0.2) * (0.8 + 0.4 * bk) : 0;
    s.userData.flame.scale.setScalar(0.45 + bk * 0.95 + Math.sin(t * 13) * 0.08 * bk);   // 점점 활활
    s.userData.mallow.scale.setScalar(1 - 0.55 * bk);
    s.userData.mm.emissive = s.userData.mm.emissive || new THREE.Color();
    s.userData.mm.emissive.set(burning ? '#ff5a10' : '#000000');
    s.userData.mm.emissiveIntensity = burning ? 0.6 + 0.4 * Math.sin(t * 9) * bk : 1;
  }

  // ------------------------------------------------------------------
  // 불꽃막대(스파클러) — 모닥불에서 불을 붙여 약 25초. 막대 끝에서 반짝이는 불꽃이 사방으로 튐
  // ------------------------------------------------------------------
  const SPARKLER_SECS = 25;
  const sparkWire = new THREE.CylinderGeometry(0.006, 0.006, 0.62, 5);
  sparkWire.userData.shared = true;
  function giveSparkler(av, left = SPARKLER_SECS) {
    const u = av.userData;
    if (u.sparkObj) return;
    if (u.roasting) takeStick(av);                    // 손이 하나라 꼬챙이 · 기타와는 동시에 못 듦
    if (guitarists.has(av)) stopGuitar(av);
    const g = new THREE.Group();
    const wire = mesh(sparkWire, mat('#5e5a58', { metalness: 0.6, roughness: 0.4 }), 0, -0.31, 0);
    g.add(wire);
    const coat = mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.36, 8), mat('#3b3634', { roughness: 1 }), 0, -0.45, 0);   // 타들어 가는 부분
    g.add(coat);
    const tip = new THREE.Object3D();
    tip.position.y = -0.62;
    g.add(tip);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#fff8e8', transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false }));
    glow.scale.setScalar(0.2);
    tip.add(glow);
    g.position.set(0, -0.26, 0.04);
    g.rotation.x = -0.9;                             // 손에서 앞 위로
    u.arms[1].elbow.add(g);
    g.userData = { tip, glow, coat };
    u.sparkObj = g;
    u.sparkler = true;
    u.sparkLeft = left;
  }
  function takeSparkler(av) {
    const u = av.userData;
    if (u.sparkObj) { u.arms[1].elbow.remove(u.sparkObj); disposeObj(u.sparkObj); }
    u.sparkObj = null;
    u.sparkler = false;
    u.sparkLeft = 0;
  }
  // 튀는 불꽃 — 점이 아니라 '가는 빛줄기'(선분). 아주 빠르게 사방으로 뻗고, 끝에서 2~4갈래로 다시 갈라짐(별꽃 모양).
  //   (예전엔 둥근 점이 떨어지듯 날아서 "물조리개 물 튀듯" 보였음)
  const SPARKS = LOW ? 300 : 600;
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 6).fill(-50), 3));
  sparkGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SPARKS * 6), 3));
  const sparkPts = new THREE.LineSegments(sparkGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false }));
  sparkPts.frustumCulled = false;
  sparkPts.renderOrder = 7;
  scene.add(sparkPts);
  const sparkData = Array.from({ length: SPARKS }, () => ({ x: 0, y: -50, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, gen: 0, split: false }));
  let sparkNext = 0;
  function emitSpark(x, y, z, dx, dy, dz, speed, life, gen) {
    const e = sparkData[sparkNext]; sparkNext = (sparkNext + 1) % SPARKS;
    e.x = x; e.y = y; e.z = z;
    e.vx = dx * speed; e.vy = dy * speed; e.vz = dz * speed;
    e.max = e.life = life; e.gen = gen; e.split = false;
  }
  const randDir = () => { const th = Math.random() * 6.28, y = Math.random() * 2 - 1, r = Math.sqrt(1 - y * y); return [r * Math.cos(th), y, r * Math.sin(th)]; };
  const sparkLight = new THREE.PointLight('#ffd9a0', 0, 5, 2);   // 내 불꽃막대만 주변을 비춤 (빛은 하나만)
  scene.add(sparkLight);
  const _tipW = new THREE.Vector3();
  function updateSparklers(dt, t) {
    const holders = [player, ...[...others.values()].map((o) => o.av)];
    for (const av of holders) {
      const u = av.userData;
      if (!u.sparkObj) continue;
      if (av !== player) u.sparkLeft = Math.max(0.6, (u.sparkLeft || SPARKLER_SECS) - dt);   // 다른 사람 것 — 끝은 상대가 알려 줌
      if (av === player) {
        u.sparkLeft -= dt;
        if (u.sparkLeft <= 0) { takeSparkler(player); toast('🎇 불꽃막대가 다 탔어요', 1800); netDirty = true; showPanel(currentPlace, true); continue; }
      }
      const left = u.sparkLeft === undefined ? 1 : clamp(u.sparkLeft / SPARKLER_SECS, 0, 1);
      const so = u.sparkObj.userData;
      // 타들어 갈수록 끝이 손 쪽으로 (코팅이 짧아짐)
      const len = 0.36 * left + 0.02;
      so.coat.scale.y = len / 0.36;
      so.coat.position.y = -0.27 - len / 2;
      so.tip.position.y = -0.27 - len;
      const fade = left < 0.08 ? left / 0.08 : 1;
      so.glow.material.opacity = (0.8 + Math.sin(t * 37) * 0.15) * fade;
      so.glow.scale.setScalar(0.26 + Math.sin(t * 23) * 0.05);   // 끝은 작고 밝게 (크면 빛 공처럼 보임)
      so.tip.getWorldPosition(_tipW);
      if (!av.visible) continue;
      // 한 프레임에 몇 줄기씩 사방으로 — 빠르고 짧게 (초속 3~6m, 0.06~0.18초)
      const n = Math.round((av === player ? 12 : 8) * fade * (dt * 60));
      for (let k = 0; k < n; k++) {
        const [dx, dy, dz] = randDir();
        emitSpark(_tipW.x, _tipW.y, _tipW.z, dx, dy, dz, 3 + Math.random() * 3, 0.06 + Math.random() * 0.12, 0);
      }
      if (av === player) {
        sparkLight.position.copy(_tipW);
        sparkLight.intensity = (2.6 + Math.sin(t * 31) * 0.6) * fade;
      }
    }
    if (!player.userData.sparkObj) sparkLight.intensity = Math.max(0, sparkLight.intensity - dt * 10);
    const pa = sparkGeo.attributes.position, ca = sparkGeo.attributes.color;
    for (let i = 0; i < SPARKS; i++) {
      const e = sparkData[i];
      if (e.life > 0) {
        e.life -= dt;
        e.vy -= 1.2 * dt;                                       // 거의 떨어지지 않음
        e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt;
        // 반쯤 날아가면 끝에서 2~4갈래로 갈라짐 (갈라진 가지는 한 번 더 갈라지지 않음)
        if (e.gen === 0 && !e.split && e.life < e.max * 0.45 && Math.random() < 0.8) {
          e.split = true;
          const m = 2 + Math.floor(Math.random() * 3), sp0 = Math.hypot(e.vx, e.vy, e.vz) || 1;
          for (let k = 0; k < m; k++) {
            const [rx, ry, rz] = randDir();
            const dx = e.vx / sp0 + rx * 0.9, dy = e.vy / sp0 + ry * 0.9, dz = e.vz / sp0 + rz * 0.9, dl = Math.hypot(dx, dy, dz) || 1;
            emitSpark(e.x, e.y, e.z, dx / dl, dy / dl, dz / dl, 1.6 + Math.random() * 1.8, 0.04 + Math.random() * 0.07, 1);
          }
        }
      }
      const j = i * 6;
      if (e.life <= 0) { pa.array[j + 1] = pa.array[j + 4] = -50; continue; }
      // 빛줄기 길이 = 속도 × 0.03초 (움직임이 남긴 빛 자국)
      const tl = 0.03;
      pa.array[j] = e.x; pa.array[j + 1] = e.y; pa.array[j + 2] = e.z;
      pa.array[j + 3] = e.x - e.vx * tl; pa.array[j + 4] = e.y - e.vy * tl; pa.array[j + 5] = e.z - e.vz * tl;
      const a = Math.min(1, (e.life / e.max) * 1.6) * (e.gen ? 0.8 : 1);
      ca.array[j] = 1.6 * a; ca.array[j + 1] = 1.45 * a; ca.array[j + 2] = 1.05 * a;          // 머리 — 하얗게
      ca.array[j + 3] = 0.9 * a * 0.25; ca.array[j + 4] = 0.55 * a * 0.25; ca.array[j + 5] = 0.15 * a * 0.25;   // 꼬리 — 금빛으로 사라짐
    }
    pa.needsUpdate = ca.needsUpdate = true;
  }
  function startSparkler() {
    if (player.userData.sparkObj) { takeSparkler(player); netDirty = true; showPanel(currentPlace, true); return; }
    if (Math.hypot(player.position.x, player.position.z) > 7) { toast('모닥불 가까이 가서 불을 붙여요', 1600); return; }
    if (player.userData.pose === 'stand') faceTo(player, fire.group);
    giveSparkler(player);
    sparkBurst(12);
    // 시점 — 내 앞쪽 비스듬히 · 가까이 (뒤에서 보면 불꽃막대가 몸에 가려 안 보였음)
    camYaw = player.rotation.y - 0.95;   // 불꽃막대를 든 쪽에서
    camPitch = 0.22;
    camDist = 4.2;
    arriveYaw = null;
    toast('🎇 불꽃막대에 불을 붙였어요 · 들고 걸어 다녀도 돼요', 2800);
    netDirty = true;
    showPanel(currentPlace, true);
  }

  const carryLogGeo = new THREE.CylinderGeometry(0.08, 0.09, 0.7, 8);
  carryLogGeo.userData.shared = true;
  const makeCarryLog = () => {
    const m = mesh(carryLogGeo, matT('bark', { repeat: 1, color: '#8a6d58' }));
    m.rotation.z = Math.PI / 2;
    const g = new THREE.Group();
    g.add(m);
    return g;
  };
  const paperGeo = (() => {
    const g = new THREE.IcosahedronGeometry(0.09, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = 0.75 + hash2(i * 13, 7) * 0.45;
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
    }
    g.computeVertexNormals();
    return g;
  })();
  paperGeo.userData.shared = true;
  const makePaper = () => mesh(paperGeo, new THREE.MeshStandardMaterial({ color: '#f3ecdc', roughness: 0.9, flatShading: true }));
  const makeStone = () => {
    const s = mesh(new THREE.SphereGeometry(0.07, 10, 8), mat('#8b8a90', { roughness: 0.6 }));
    s.scale.set(1, 0.4, 0.85);
    return s;
  };

  // 던지기 — 손에 쥐여 주고, 팔을 휘두르는 순간 손을 떠나 포물선으로 날아갑니다
  const projectiles = [];
  function throwItem(av, obj, target, { dur = 0.75, h = 1.2, onLand } = {}) {
    const u = av.userData;
    obj.position.set(0, -0.27, 0.06);
    u.arms[1].elbow.add(obj);
    u.gesture = { type: 'throw', t: 0, dur: 1.05 };
    setTimeout(() => {
      if (!obj.parent) return;
      const from = new THREE.Vector3();
      obj.getWorldPosition(from);
      obj.parent.remove(obj);
      obj.position.copy(from);
      scene.add(obj);
      projectiles.push({ obj, from, to: target.clone(), t: 0, dur, h, onLand });
    }, 430);
  }

  // ------------------------------------------------------------------
  // 모닥불 이웃 (NPC) — 혼자 들어와도 불가에 사람 온기가 있도록
  // ------------------------------------------------------------------
  const NPC_DEFS = [
    { name: '모닥불 지기', color: '#c98a5a', hair: 3, hairColor: '#3b2a21', skin: SKIN[2], seat: 0, role: 'roast', scale: 1.04 },
    { name: '기타 든 이웃', color: '#7f9cc4', hair: 1, hairColor: '#241d1a', skin: SKIN[1], seat: 4, role: 'guitar', scale: 1.0 },
    { name: '별 좋아하는 이웃', color: '#d9a7c7', hair: 2, hairColor: '#6b4a2f', skin: SKIN[0], seat: 7, role: 'talk', scale: 0.96 },
  ];
  const NPC_LINES = ['불이 참 따뜻하네요', '오늘은 별이 유난히 많아요', '타닥타닥 소리, 좋죠?', '천천히 쉬다 가세요 🙂', '마시멜로 하나 구워 보세요', '여기선 아무것도 안 해도 돼요'];
  for (const d of NPC_DEFS) {
    const seat = seats[d.seat];
    if (!seat) continue;
    const av = makeAvatar(d.color, d.name, { hair: d.hair, hairColor: d.hairColor, skin: d.skin, npc: true, scale: d.scale });
    av.position.set(seat.x, standY(seat.x, seat.z) + seat.off, seat.z);
    av.rotation.y = seat.ry;
    av.userData.pose = 'sit';
    // 이웃은 이름표 없이 — 사람만 조용히 앉아 있게
    av.remove(av.userData.label);
    av.userData.label = new THREE.Object3D();
    scene.add(av);
    seat.npc = av;
    npcs.push({ av, name: d.name, role: d.role, seat, t: 4 + Math.random() * 8, greet: 3, talk: 20 + Math.random() * 30, busy: false });
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

  // ------------------------------------------------------------------
  // 소리 — 전부 WebAudio 로 생성 (음원 파일 0개)
  //   배경은 '음악'이 아니라 자연음: 장작 타는 소리 · 풀벌레 · 부엉이 · 물결 · 바람
  //   지속음(드론)은 깔지 않습니다 ("웅 소리" 지적을 받았음)
  // ------------------------------------------------------------------
  let actx = null, master = null, muted = false, noiseBuf = null;
  const amb = {};
  function ensureAudio() {
    if (actx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    master = actx.createGain();
    master.gain.value = 0.8;
    master.connect(actx.destination);
    const len = actx.sampleRate * 2;
    noiseBuf = actx.createBuffer(1, len, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  function tone(freq, vol = 0.25, dur = 1.8, when = 0) {
    if (!actx || muted) return;
    const t = actx.currentTime + when;
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
  const chime = () => { tone(784, 0.1, 1.4); tone(1046.5, 0.07, 1.6, 0.12); };
  // 짧은 잡음 한 토막 — 타닥 · 쉭 · 첨벙 모두 이것으로
  function burst({ freq = 2500, q = 1, type = 'bandpass', vol = 0.1, dur = 0.05, when = 0, attack = 0.003 } = {}) {
    if (!actx || muted || vol < 0.002) return;
    const t = actx.currentTime + when;
    const src = actx.createBufferSource();
    src.buffer = noiseBuf;
    const f = actx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 1.5, attack + dur + 0.05);
  }
  // 장작 타는 소리 — 대부분은 작은 '틱', 가끔 '타닥타닥', 드물게 '탁!'
  function crackle(k) {
    // 따뜻한 타닥 — 날카로운 고음 대신 1.2~3kHz 의 부드러운 '톡', 가끔 여유 있게 '타닥 · 타닥'
    //   (예전의 저음 '탁' 소리는 탁자 치는 소리처럼 들려서 뺐습니다)
    const r = Math.random();
    if (r < 0.7) burst({ freq: 1200 + Math.random() * 1800, q: 0.6 + Math.random() * 0.7, vol: (0.02 + 0.045 * Math.random()) * k, dur: 0.014 + Math.random() * 0.022 });
    else {
      const n = 2 + Math.floor(Math.random() * 2);
      let w = 0;
      for (let i = 0; i < n; i++) {
        burst({ freq: 1400 + Math.random() * 1500, q: 0.8, vol: (0.025 + 0.04 * Math.random()) * k, dur: 0.016 + Math.random() * 0.02, when: w });
        w += 0.08 + Math.random() * 0.14;
      }
    }
  }
  function whoosh(k) {
    burst({ freq: 900, q: 0.5, type: 'bandpass', vol: 0.035 * k, dur: 0.6, attack: 0.12 });   // 장작이 닿을 때 부드러운 '화르륵'
    for (let i = 0; i < 9; i++) setTimeout(() => crackle(k * 1.3), 120 + i * (60 + Math.random() * 120));
  }
  function plip(k = 1) {
    if (!actx || muted) return;
    const t = actx.currentTime;
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.setValueAtTime(1100, t);
    o.frequency.exponentialRampToValueAtTime(260, t + 0.09);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06 * k, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + 0.16);
    burst({ freq: 1400, q: 0.8, vol: 0.03 * k, dur: 0.09 });
  }
  // 풀벌레 — 높은 소리가 서너 번 짧게 끊어지며 '찌르르'
  function chirp() {
    if (!actx || muted) return;
    const f = [4300, 4750, 5200][Math.floor(Math.random() * 3)];
    const t0 = actx.currentTime, n = 3 + Math.floor(Math.random() * 3);
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = f;
    g.gain.value = 0.0001;
    const v = 0.014 + Math.random() * 0.014;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * 0.055;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(v, t + 0.008);
      g.gain.linearRampToValueAtTime(0.0001, t + 0.03);
    }
    o.connect(g).connect(master);
    o.start(t0); o.stop(t0 + n * 0.055 + 0.05);
  }
  // 부엉이 — 멀리서 '부-엉' 두 번
  function hoot() {
    if (!actx || muted) return;
    const lp = actx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900;
    lp.connect(master);
    [[0, 0.32, 395], [0.5, 0.55, 370]].forEach(([w, d, f]) => {
      const t = actx.currentTime + w;
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(f * 0.93, t + d);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.03, t + 0.07);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(lp);
      o.start(t); o.stop(t + d + 0.05);
    });
  }
  // 배경 — 장작 타는 바탕 소리 · 바람 · 호수 물결 (거리에 따라 크기가 바뀜)
  function loopNoise(filterType, freq, q) {
    const src = actx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = actx.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = actx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(master);
    src.start(0, Math.random() * 1.5);
    return g;
  }
  function startAmbient() {
    if (!actx || amb.fire) return;
    amb.fire = loopNoise('lowpass', 480, 0.4);      // 불이 '쏴아' 타는 바탕
    amb.wind = loopNoise('lowpass', 300, 0.3);
    amb.lake = loopNoise('bandpass', 420, 0.5);
    const lfo = actx.createOscillator(), lg = actx.createGain();
    lfo.frequency.value = 0.18; lg.gain.value = 0.25;
    lfo.connect(lg);
    amb.lakeLfo = lg;
    lfo.start();
  }
  let crackleT = 0, chirpT = 2, hootT = 25;
  function updateAudio(dt) {
    if (!actx || !amb.fire) return;
    const now = actx.currentTime;
    const dF = Math.hypot(player.position.x, player.position.z);
    const atFire = zen.on || (mySeat && mySeat.kind !== 'deck');   // 불가에 앉았으면 타닥 소리를 바로 앞에서 듣는 크기로
    const near = atFire ? 1 : clamp(1 / (1 + Math.pow(dF / 4.2, 2)), 0, 1);
    const lv = fire.level;
    amb.fire.gain.setTargetAtTime(muted ? 0 : (zen.on ? 0.045 : 0.035 + 0.015 * (lv - 1)) * near, now, 0.4);
    amb.wind.gain.setTargetAtTime(muted ? 0 : (zen.on ? 0.0015 : 0.004), now, 1);
    const dL = Math.max(0, (lakeD(player.position.x, player.position.z) - 1) * 10);
    amb.lake.gain.setTargetAtTime(muted ? 0 : 0.022 / (1 + dL * dL * 0.04) * (zen.on ? 0 : 1), now, 0.6);
    if (muted) return;
    crackleT -= dt;
    if (crackleT <= 0) { if (near > 0.03) crackle(near * (0.7 + 0.3 * lv) * (zen.on ? 1.7 : atFire ? 1.5 : 1.2)); crackleT = (atFire ? 0.16 + Math.random() * 0.55 : 0.25 + Math.random() * 0.7) / Math.max(0.85, lv); }   // 넉넉한 간격
    chirpT -= dt;
    if (chirpT <= 0) { chirp(); chirpT = 0.35 + Math.random() * 1.15; }    // 불멍 중에도 귀뚜라미는 들립니다
    // (부엉이 소리는 뺐습니다 — 맑은 음 두 개가 '입장 알림음'처럼 들렸음)
  }

  // 기타 — 줄을 튕기는 소리(카플러스-스트롱)를 직접 계산합니다. 다장조 C · G · Am · F
  const ksCache = new Map();
  function ksBuffer(f) {
    const key = f.toFixed(2);
    if (ksCache.has(key)) return ksCache.get(key);
    const sr = actx.sampleRate, len = Math.floor(sr * 2.4);
    const buf = actx.createBuffer(1, len, sr), d = buf.getChannelData(0);
    const N = Math.max(2, Math.round(sr / f));
    const ring = new Float32Array(N);
    for (let i = 0; i < N; i++) ring[i] = Math.random() * 2 - 1;
    for (let i = 0; i < N; i++) ring[i] = (ring[i] + ring[(i + 1) % N]) * 0.5;   // 처음부터 살짝 부드럽게
    let idx = 0;
    for (let i = 0; i < len; i++) {
      const a = ring[idx], b = ring[(idx + 1) % N];
      d[i] = a;
      ring[idx] = (a + b) * 0.5 * 0.997;
      idx = (idx + 1) % N;
    }
    ksCache.set(key, buf);
    return buf;
  }
  function pluck(f, when, vol) {
    const src = actx.createBufferSource();
    src.buffer = ksBuffer(f);
    const lp = actx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2600;
    const g = actx.createGain();
    g.gain.value = vol;
    src.connect(lp).connect(g).connect(master);
    src.start(when);
    src.stop(when + 2.4);
  }
  const CHORDS = [
    [130.81, 164.81, 196.0, 261.63, 329.63],
    [98.0, 123.47, 146.83, 196.0, 246.94, 392.0],
    [110.0, 164.81, 220.0, 261.63, 329.63],
    [87.31, 130.81, 174.61, 220.0, 261.63],
  ];
  const STRUM = [[0, 1, 1], [0.62, 1, 0.65], [0.93, -1, 0.42], [1.24, 1, 0.7], [1.55, -1, 0.4]];   // [박자, 방향, 세기]
  const CHORD_LEN = 1.86;
  const guitarists = new Map();     // 아바타 → { t, i, c, vol }
  function startGuitar(av, vol) {
    giveGuitar(av);
    if (!guitarists.has(av)) guitarists.set(av, { t: 0, i: 0, c: 0, vol });
  }
  function stopGuitar(av) {
    takeGuitar(av);
    guitarists.delete(av);
  }
  function updateGuitars(dt) {
    for (const [av, g] of guitarists) {
      if (!av.parent) { guitarists.delete(av); continue; }
      g.t += dt;
      while (g.i < STRUM.length && g.t >= STRUM[g.i][0]) {
        const [, dir, k] = STRUM[g.i];
        av.userData.strumT = 0;
        av.userData.strumDir = dir;
        // 소리는 '내가 기타 치기를 눌렀을 때'만 — 이웃 · 다른 사람은 치는 모습만 보입니다 (불가에선 타닥 소리가 주인공)
        if (actx && !muted && av === player) {
          const att = 1;
          const notes = dir > 0 ? CHORDS[g.c] : CHORDS[g.c].slice().reverse().slice(0, 4);
          const t0 = actx.currentTime + 0.01;
          notes.forEach((f, i) => pluck(f, t0 + i * 0.024, g.vol * k * att * (0.85 + Math.random() * 0.3)));
        }
        g.i++;
      }
      if (g.t >= CHORD_LEN) { g.t -= CHORD_LEN; g.i = 0; g.c = (g.c + 1) % CHORDS.length; }
    }
  }

  // ------------------------------------------------------------------
  // 효과 — 이모지 · 물결 고리 · 별똥별
  // ------------------------------------------------------------------
  const rings = [];
  const ringGeo = new THREE.RingGeometry(0.2, 0.26, 28);
  function ripple(x, z, size = 1, y = WATER_Y + 0.02) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#cfe0ff', transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
    m.position.set(x, y, z);
    m.rotation.x = -Math.PI / 2;
    scene.add(m);
    rings.push({ m, t: 0, size });
  }
  function markSpot(v) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffe2b8', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    m.position.set(v.x, groundY(v.x, v.z) + 0.07, v.z);
    m.rotation.x = -Math.PI / 2;
    scene.add(m);
    rings.push({ m, t: 0, size: 1.4, mark: true });
  }
  const shooting = [];
  let shootT = 12;
  function shootingStar() {
    const a = Math.random() * Math.PI * 2;
    const start = new THREE.Vector3(Math.cos(a) * 200, 120 + Math.random() * 90, Math.sin(a) * 200);
    const dir = new THREE.Vector3(-Math.cos(a) + (Math.random() - 0.5), -0.35 - Math.random() * 0.3, -Math.sin(a) + (Math.random() - 0.5)).normalize();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -dir.x * 22, -dir.y * 22, -dir.z * 22], 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 0.1, 0.15, 0.3], 3));
    const m = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, fog: false, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.copy(start);
    skyGroup.add(m);
    shooting.push({ m, dir, t: 0 });
  }

  // ------------------------------------------------------------------
  // 풍등 — 소원을 적어 띄우면 저장되고, 같은 방 사람들 하늘에도 떠오릅니다
  // ------------------------------------------------------------------
  const lanterns = [];
  const lanternIds = new Set();
  const lanternGeo = new THREE.CylinderGeometry(0.34, 0.24, 0.66, 12, 1, true);
  const lanternMat = new THREE.MeshStandardMaterial({ color: '#ffd59a', emissive: '#ff8a2a', emissiveIntensity: 1.5, side: THREE.DoubleSide, roughness: 0.8, fog: false });
  function lanternHome(id) {
    const h = hashStr(String(id));
    const r1 = (h & 1023) / 1023, r2 = ((h >>> 10) & 1023) / 1023, r3 = ((h >>> 20) & 1023) / 1023;
    return new THREE.Vector3(LAKE.x + (r1 - 0.5) * 110, 24 + r3 * 38, LAKE.z + 4 + r2 * 85);
  }
  function addLantern(item, from) {
    if (lanternIds.has(String(item.id))) return;
    lanternIds.add(String(item.id));
    const g = new THREE.Group();
    const body = mesh(lanternGeo, lanternMat);
    g.add(body);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffa04a', transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    glow.scale.setScalar(2.6);
    g.add(glow);
    g.scale.setScalar(1.6);
    body.userData = { kind: 'lantern', text: item.text };
    clickables.push(body);
    const home = lanternHome(item.id);
    const L = { g, home, ph: (hashStr(String(item.id)) % 628) / 100, rise: null };
    if (from) { g.position.copy(from); L.rise = { from: from.clone(), t: 0 }; }
    else g.position.copy(home);
    scene.add(g);
    lanterns.push(L);
    while (lanterns.length > 120) { const o = lanterns.shift(); scene.remove(o.g); }
  }

  // ------------------------------------------------------------------
  // 데이터 — 풍등(소원) · 장작 · 마시멜로 숫자
  // ------------------------------------------------------------------
  const counters = { wood: 0, smore: 0 };
  function applyCounter(name, v) {
    if (counters[name] === undefined) return;
    counters[name] = Math.max(counters[name], v);
    refreshPanelInfo();
  }
  async function loadData() {
    try {
      const list = await store.list('wish');
      for (const it of list) addLantern(it);
      for (const k of Object.keys(counters)) counters[k] = await store.getCounter(CNT[k]);
    } catch (e) { console.warn('불러오기 실패', e); }
  }
  async function bump(name) {
    try {
      const v = await store.incCounter(CNT[name]);
      applyCounter(name, v);
      store.send('act', { id: me.id, type: 'counter', name, value: v });
    } catch (e) { console.warn(e); }
  }

  // ------------------------------------------------------------------
  // 행동
  // ------------------------------------------------------------------
  const cooldown = {};
  function cool(name, ms) {
    const now = Date.now();
    if (cooldown[name] && now - cooldown[name] < ms) { toast('조금만 천천히 해 볼까요? 🙂', 1500); return false; }
    cooldown[name] = now;
    return true;
  }
  let camMode = 'follow';   // follow | lie | zen
  let moveTarget = null, waypoints = [];
  let arriveYaw = null;     // 길 찾기로 도착하면 카메라가 돌아갈 방향 (캠프 쪽에서 장소를 바라봄)
  let seatOff = 0;          // 앉거나 누운 자리의 높이 보정 (상대에게도 'lift' 로 보냄)
  let mySeat = null, lieSpot = null;
  let blockedMsg = 0;
  function standUp() {
    const s = mySeat, l = lieSpot;
    setPose('stand');
    if (s) {
      // 앉았던 자리에서 등 뒤로 한 걸음 — 통나무 · 의자 속에 서 있지 않게
      const back = s.kind === 'deck' ? 1.2 : 0.85;
      player.position.x -= Math.sin(s.ry) * back;
      player.position.z -= Math.cos(s.ry) * back;
    }
    if (l && l.kind === 'tent' && l.door) {
      // 텐트 문 밖으로 한 걸음 더 나와 모닥불 쪽을 보고 섭니다
      player.position.x = l.door.x + Math.sin(l.ry) * 0.9;
      player.position.z = l.door.z + Math.cos(l.ry) * 0.9;
      player.rotation.y = l.ry;
      // 카메라는 텐트 반대편(모닥불 쪽) 비스듬히 위에서 — 텐트 지붕이 화면을 덮지 않게
      camYaw = l.ry + 0.9;
      camPitch = 0.3;
      camDist = 6;
      camera.position.set(player.position.x + Math.sin(camYaw) * 6, player.position.y + 3.4, player.position.z + Math.cos(camYaw) * 6);
    }
    if (l && l.kind === 'hammock') {
      player.position.x += hammock.side.x * 1.3;
      player.position.z += hammock.side.z * 1.3;
    }
    pushOut(player.position, 3);
  }
  function setPose(pose) {
    const u = player.userData;
    if (pose === 'stand') {
      if (u.pose === 'lie') camPitch = 0.3;          // 하늘을 올려다보던 각도에서 다시 보통 시점으로
      seatOff = 0; mySeat = null; lieSpot = null;
      if (zen.on) stopZen();
      if (u.roasting) { takeStick(player); }
      if (guitarists.has(player)) stopGuitar(player);
    }
    if (pose === 'lie' && u.sparkObj) takeSparkler(player);   // 누우면 불꽃막대는 내려놓음
    u.pose = pose;
    document.body.classList.toggle('lying', pose === 'lie');   // 누워 있을 땐 아래 안내 상자를 작게 (시야를 가리지 않게)
    camMode = pose === 'lie' ? 'lie' : zen.on ? 'zen' : 'follow';
    netDirty = true;
    if (currentPlace) showPanel(currentPlace, true);
  }
  const GESTURE_DUR = { wave: 2.2, bow: 2.2, dance: 6, throw: 1.05 };
  function gesture(type) {
    if (type === 'dance' && player.userData.pose !== 'stand') { toast('일어선 뒤에 출 수 있어요', 1500); return; }
    if (type === 'bow' && player.userData.pose !== 'stand') { toast('일어선 뒤에 인사할 수 있어요', 1500); return; }
    player.userData.gesture = { type, t: 0, dur: GESTURE_DUR[type] };
    store.send('act', { id: me.id, type });
  }
  function seatTaken(seat) {
    if (seat.npc) return true;
    for (const o of others.values()) {
      if (o.av.userData.pose === 'sit' && Math.hypot(o.tx - seat.x, o.tz - seat.z) < 0.4) return true;
    }
    return false;
  }
  function sitAt(seat) {
    if (seatTaken(seat)) { toast('누군가 앉아 있는 자리예요 🙂', 1600); return; }
    if (player.userData.pose !== 'stand') setPose('stand');
    moveTarget = null; waypoints = [];
    player.position.set(seat.x, standY(seat.x, seat.z) + seat.off, seat.z);
    player.rotation.y = seat.ry;
    seatOff = seat.off;
    mySeat = seat;
    setPose('sit');
    // 비스듬히 뒤에서 — 내 얼굴 옆선과 불이 한 화면에
    camYaw = seat.ry + Math.PI + 0.55;
    camPitch = seat.kind === 'deck' ? 0.22 : 0.3;
    camDist = Math.min(camDist, 6.5);
  }
  function nearestFree(list) {
    let best = null, bd = Infinity;
    for (const s of list) {
      if (seatTaken(s)) continue;
      const d = Math.hypot(s.x - player.position.x, s.z - player.position.z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
  function sitFire() {
    const s = nearestFree(seats);
    if (!s) { toast('빈자리가 없어요. 조금 기다려 볼까요?', 1800); return; }
    sitAt(s);
    if (!localStorage.getItem('bulmeong:zenHint')) {
      localStorage.setItem('bulmeong:zenHint', '1');
      setTimeout(() => toast('🔥 아래 "불멍하기"를 누르면 불만 바라보는 화면이 돼요', 4200), 700);
    }
  }
  function lieAt(spot) {
    if (player.userData.pose !== 'stand') setPose('stand');
    moveTarget = null; waypoints = [];
    player.position.set(spot.x, standY(spot.x, spot.z) + spot.off, spot.z);
    player.rotation.y = spot.ry;
    seatOff = spot.off;
    lieSpot = spot;
    setPose('lie');
    // 해먹은 양 끝에 나무가 있어서, 옆(하늘이 트인 쪽)을 올려다봅니다
    camYaw = spot.kind === 'hammock' ? spot.ry + Math.PI / 2 : spot.ry + Math.PI;
    if (spot.kind === 'tent') camYaw = Math.atan2(spot.x, spot.z);   // 텐트 — 시선을 모닥불 정면으로
    camPitch = spot.kind === 'tent' ? 0.12 : spot.kind === 'hammock' ? 1.3 : 1.05;   // 해먹은 거의 바로 위 하늘을     // 텐트 안에선 열린 문 밖(모닥불 · 별)을 봅니다
    toast(spot.kind === 'tent' ? '⛺ 텐트 안에서 쉬어요 · 문 밖으로 모닥불과 별이 보여요' : (TOUCH ? '🌌 화면을 끌어서 밤하늘을 둘러봐요 · 가끔 별똥별이 지나가요' : '🌌 드래그로 밤하늘을 둘러봐요 · 가끔 별똥별이 지나가요'), 3800);
  }
  function lieHammock() {
    if (!hammock.pivot) return;
    for (const o of others.values()) if (o.av.userData.pose === 'lie' && Math.hypot(o.tx - hammock.x, o.tz - hammock.z) < 1.6) { toast('누군가 해먹에 누워 있어요 🙂', 1800); return; }
    const ax = Math.cos(hammock.ry), az = -Math.sin(hammock.ry);
    lieAt({ x: hammock.x + ax * 0.8, z: hammock.z + az * 0.8, ry: Math.atan2(ax, az), off: 0.42, kind: 'hammock' });
  }
  function nearestTent() {
    let best = null, bd = Infinity;
    tents.forEach((t, i) => { const d = Math.hypot(t.x - player.position.x, t.z - player.position.z); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  function lieTent() {
    const i = nearestTent();
    if (i === null) return;
    const s = tents[i].lie;
    lieAt({ x: s.x, z: s.z, ry: s.ry, off: 0.1, kind: 'tent', door: tents[i].door });
  }
  function toggleLantern(i, on, mine = true) {
    const t = tents[i];
    if (!t) return;
    t.on = on === undefined ? !t.on : on;
    if (mine) {
      store.send('act', { id: me.id, type: 'lantern', i, on: t.on });
      tone(t.on ? 1318 : 880, 0.05, 0.25);
      toast(t.on ? '🏮 랜턴을 켰어요' : '랜턴을 껐어요 — 별이 더 잘 보여요', 1800);
    }
    refreshPanelInfo();
  }

  // 장작 넣기
  const FIRE_AIM = () => new THREE.Vector3((Math.random() - 0.5) * 0.4, FIRE_Y + 0.35, (Math.random() - 0.5) * 0.4);
  function addWood(av = player, mine = true) {
    if (mine) {
      if (!cool('wood', 2500)) return;
      if (Math.hypot(player.position.x, player.position.z) > 7) { toast('모닥불 가까이 가서 넣어요', 1600); return; }
      if (player.userData.pose === 'stand') faceTo(player, fire.group);
    }
    if (av.position.distanceTo(fire.group.position) < 6.5) av.userData.gesture = { type: 'pat', t: 0, dur: 1.6 };   // 손을 앞으로 내밀어 넣는 몸짓
    placeLog(av, () => {
      fire.boost = Math.min(2.2, fire.boost + 0.75);
      sparkBurst(35);
      const d = av.position.distanceTo(player.position);
      whoosh(clamp(1 / (1 + Math.pow(d / 5, 2)), 0.1, 1));
      if (mine) toast('🪵 장작이 불 속에 자리 잡았어요 · 타닥타닥', 2200);
    });
    if (mine) { bump('wood'); store.send('act', { id: me.id, type: 'wood' }); }
  }
  // 장작 놓기 — 넣는 사람 쪽 돌 테두리 위에 장작이 놓이고, 천천히 불 속으로 밀려 들어가
  //   다른 장작에 비스듬히 기댄 채 타오르다 숯이 되어 사라집니다.
  const placedLogs = [];
  const placeLogGeo = new THREE.CylinderGeometry(0.075, 0.09, 0.9, 8);
  function placeLog(av, onIn) {
    let dx = av.position.x - fire.group.position.x, dz = av.position.z - fire.group.position.z;
    const L = Math.hypot(dx, dz) || 1;
    dx /= L; dz /= L;
    const side = (Math.random() - 0.5) * 0.5;                       // 똑같은 자리에 겹치지 않게 살짝 옆으로
    const ca = Math.cos(side), sa = Math.sin(side);
    [dx, dz] = [dx * ca - dz * sa, dx * sa + dz * ca];
    const m = new THREE.MeshStandardMaterial({ ...texSet('bark', 1), color: '#8a6d58', roughness: 1, emissive: '#ff4a10', emissiveIntensity: 0, transparent: true, opacity: 0 });
    const g = new THREE.Group();
    g.add(mesh(placeLogGeo, m));
    g.rotation.order = 'YXZ';
    g.rotation.y = Math.atan2(dx, dz);
    g.position.set(dx * 1.45, FIRE_Y + 0.32, dz * 1.45);
    g.rotation.x = -1.45;                                           // 처음엔 거의 눕힌 채 돌 위에
    scene.add(g);
    placedLogs.push({ g, m, dx, dz, t: 0, onIn, lit: false });
  }
  function updateLogs(dt) {
    for (let i = placedLogs.length - 1; i >= 0; i--) {
      const o = placedLogs[i];
      o.t += dt;
      if (o.t < 0.35) { o.m.opacity = o.t / 0.35; continue; }      // 살며시 나타나고
      const e = smooth(0.35, 1.9, o.t);                            // 1.5초에 걸쳐 불 속으로 밀려 들어가며 비스듬히 섭니다
      const r = lerp(1.45, 0.62, e);
      o.g.position.set(o.dx * r, FIRE_Y + lerp(0.32, 0.36, e) + Math.sin(e * Math.PI) * 0.06, o.dz * r);
      o.g.rotation.x = lerp(-1.45, -0.95, e);
      if (!o.lit && e > 0.85) { o.lit = true; o.m.transparent = false; o.m.opacity = 1; if (o.onIn) o.onIn(); }
      if (o.lit) {                                                 // 타오르며 검게 그을리고, 점점 줄어들다 사라집니다
        const b = smooth(1.9, 16, o.t);
        o.m.color.setRGB(lerp(0.54, 0.16, b), lerp(0.43, 0.11, b), lerp(0.35, 0.08, b));
        o.m.emissiveIntensity = 0.15 + b * 0.6 + Math.sin(o.t * 2.3) * 0.05;
        o.g.scale.set(1, 1 - b * 0.55, 1);
        if (o.t > 15) { o.m.transparent = true; o.m.opacity = 1 - smooth(15, 17, o.t); }
        if (o.t > 17) { scene.remove(o.g); o.m.dispose(); placedLogs.splice(i, 1); }
      }
    }
  }
  // 고민 태우기 — 글은 어디에도 저장 · 전송하지 않습니다 (불꽃만 함께 봅니다)
  async function burnWorry() {
    if (Math.hypot(player.position.x, player.position.z) > 7) { toast('모닥불 가까이 가서 태워요', 1600); return; }
    const raw = await askWith('불에 태워 보낼 고민', '예) 내일 발표가 걱정돼', '여기 적은 글은 저장되지도, 다른 사람에게 보이지도 않아요. 불과 함께 사라져요.', '태우기');
    if (raw === null || !String(raw).trim()) return;
    if (!cool('burn', 3000)) return;
    if (player.userData.pose === 'stand') faceTo(player, fire.group);
    throwBurn(player, true);
    store.send('act', { id: me.id, type: 'burn' });
  }
  function throwBurn(av, mine) {
    throwItem(av, makePaper(), FIRE_AIM(), {
      dur: 0.8, h: 1.3,
      onLand: () => {
        fire.burn = 1;
        sparkBurst(80);
        const d = av.position.distanceTo(player.position);
        const k = clamp(1 / (1 + Math.pow(d / 5, 2)), 0.1, 1);
        burst({ freq: 3000, q: 0.5, vol: 0.05 * k, dur: 1.1, attack: 0.1 });
        for (let i = 0; i < 6; i++) setTimeout(() => crackle(k * 1.2), 200 + i * 140);
        if (mine) {
          setTimeout(() => toast('🔥 고민이 불꽃이 되어 하늘로 날아갔어요. 조금 가벼워졌기를.', 4200), 600);
          // 금빛 불씨 몇 개가 아주 높이 올라갑니다
          setTimeout(() => floatEmoji('✨', new THREE.Vector3(0, FIRE_Y + 2.6, 0), 0.6), 900);
        }
      },
    });
  }
  // 마시멜로
  function startRoast() {
    if (!mySeat || mySeat.kind === 'deck') { toast('모닥불 자리에 앉아서 구워요', 1600); return; }
    if (guitarists.has(player)) stopGuitar(player);       // 기타와 꼬챙이는 한 번에 하나만
    if (player.userData.sparkObj) takeSparkler(player);
    giveStick(player);
    player.userData.roastLv = 0;
    toast('🍡 꼬챙이를 불 쪽으로… 노릇해지면 "먹기"를 눌러요', 3000);
    netDirty = true;
    showPanel(currentPlace, true);
  }
  function eatMallow(av = player, mine = true) {
    const lv = av.userData.roastLv || 0;
    floatEmoji(lv > 1.12 ? '😅' : '😋', av.position.clone().add(new THREE.Vector3(0, 2.1, 0)), 0.7, 1.4);
    if (mine) {
      toast(lv < 0.3 ? '아직 하얀데… 그래도 말랑해요 😋' : lv < 0.8 ? '노릇노릇 완벽해요! 😋' : lv < 1.12 ? '살짝 탔지만 고소해요 😋' : '앗, 새까맣게 탔어요 😅 다시 구워 볼까요?', 2600);
      bump('smore');
      store.send('act', { id: me.id, type: 'eat' });
    }
    takeStick(av);
    if (mine) { netDirty = true; showPanel(currentPlace, true); }
  }
  function toggleMyGuitar() {
    if (guitarists.has(player)) stopGuitar(player);
    else {
      if (!mySeat || mySeat.kind === 'deck') { toast('모닥불 자리에 앉아서 쳐요', 1600); return; }
      if (player.userData.roasting) takeStick(player);
      if (player.userData.sparkObj) takeSparkler(player);
      startGuitar(player, 0.065);
      toast('🎸 C · G · Am · F — 같은 방 사람들에게도 들려요', 2600);
    }
    netDirty = true;
    showPanel(currentPlace, true);
  }
  function faceTo(av, target) {
    const tp = target.position || target;
    av.rotation.y = Math.atan2(tp.x - av.position.x, tp.z - av.position.z);
    if (av === player) { netDirty = true; netTimer = 1; }
  }
  // 풍등 날리기
  async function sendLantern() {
    const raw = await askWith('풍등에 적을 소원', '예) 모두 따뜻한 겨울 보내기를', '이름 · 연락처 같은 개인정보는 적지 말아 주세요. 남긴 소원은 같은 방 사람들도 볼 수 있어요.', '띄우기');
    if (raw === null) return;
    const text = cleanText(raw);
    if (!text) { toast('띄울 수 없는 내용이에요. 다른 말로 적어 볼까요?'); return; }
    if (!cool('lantern', 8000)) return;
    try {
      const item = await store.add('wish', text);
      addLantern(item, player.position.clone().add(new THREE.Vector3(Math.sin(player.rotation.y) * 1.2, 1.6, Math.cos(player.rotation.y) * 1.2)));
      camPitch = 0.12;                // 떠오르는 풍등이 화면에 들어오게 살짝 올려다봄
      toast('🏮 풍등이 천천히 하늘로 올라가요', 3000);
      chime();
      refreshPanelInfo();
    } catch (e) {
      console.warn(e);
      toast('저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
  }
  function readLantern() {
    if (!lanterns.length) { toast('아직 띄운 풍등이 없어요. 첫 풍등을 띄워 볼까요?'); return; }
    const L = lanterns[Math.floor(Math.random() * lanterns.length)];
    toast(`🏮 ${L.g.children[0].userData.text}`, 4200);
  }
  // 물수제비
  const skips = [];
  function skipStone(av = player, mine = true, hops, ry) {
    if (mine) {
      if (!onDeck(player.position.x, player.position.z) && lakeD(player.position.x, player.position.z) > 1.35) { toast('호숫가 데크 끝에서 던져 보세요 🪨', 1800); return; }
      if (!cool('skip', 2200)) return;
      if (player.userData.pose !== 'stand') standUp();
      ry = Math.abs(Math.atan2(Math.sin(player.rotation.y), Math.cos(player.rotation.y))) < 1.1 ? player.rotation.y : 0;
      player.rotation.y = ry;
      const r = Math.random();
      hops = r < 0.15 ? 1 : r < 0.4 ? 2 + Math.floor(Math.random() * 2) : r < 0.85 ? 4 + Math.floor(Math.random() * 2) : 6 + Math.floor(Math.random() * 3);
      store.send('act', { id: me.id, type: 'skip', hops, ry });
    }
    const stone = makeStone();
    const fx = Math.sin(ry), fz = Math.cos(ry);
    av.userData.gesture = { type: 'throw', t: 0, dur: 1.05 };
    stone.position.set(0, -0.27, 0.06);
    av.userData.arms[1].elbow.add(stone);
    setTimeout(() => {
      if (!stone.parent) return;
      const from = new THREE.Vector3();
      stone.getWorldPosition(from);
      stone.parent.remove(stone);
      scene.add(stone);
      // 튀는 지점들 — 점점 짧게
      const pts = [from];
      let x = from.x, z = from.z, step = 4.2;
      for (let i = 0; i < hops; i++) {
        x += fx * step; z += fz * step;
        pts.push(new THREE.Vector3(x, WATER_Y + 0.03, z));
        step *= 0.68;
      }
      skips.push({ stone, pts, seg: 0, t: 0, hops, mine });
    }, 430);
  }

  // ------------------------------------------------------------------
  // 불멍 모드 — 화면의 버튼이 사라지고, 불꽃과 짧은 문장만 남습니다
  // ------------------------------------------------------------------
  const ZEN_LINES = [
    '아무것도 하지 않아도 괜찮아요',
    '오늘의 무게는 여기 잠시 내려놓아요',
    '오늘 하루도 여기까지 잘 왔어요',
    '생각이 떠오르면, 불티처럼 흘려보내요',
    '당신은 지금도 충분히 잘하고 있어요',
    '타닥타닥, 그 소리만 들어 봐요',
    '지금 이 순간이면 충분해요',
    '내일 일은 내일의 내가 할 거예요',
    '따뜻한 쪽으로 몸을 조금 기대 봐요',
  ];
  const zen = { on: false, t: 0, lineT: 0, line: Math.floor(Math.random() * ZEN_LINES.length) };
  const zenLook = new THREE.Vector3();
  function startZen() {
    if (!mySeat || mySeat.kind === 'deck') { toast('모닥불 자리에 앉아서 해요', 1600); return; }
    zen.on = true;
    zen.t = 0;
    zen.lineT = 0;
    camMode = 'zen';
    zenLook.set(player.position.x, player.position.y + 1.2, player.position.z);
    document.body.classList.add('zen');
    $('#zen').classList.add('show');
    showZenLine();
    openChat(false);
  }
  function stopZen() {
    if (!zen.on) return;
    zen.on = false;
    camMode = player.userData.pose === 'lie' ? 'lie' : 'follow';
    document.body.classList.remove('zen');
    $('#zen').classList.remove('show');
    camera.fov = fovFor(camera.aspect);
    camera.updateProjectionMatrix();
    toast(`🔥 불멍 ${fmtTime(Math.max(1, zen.t))} 했어요`, 3200);   // 하는 동안엔 시간을 띄우지 않고, 끝날 때만
    if (currentPlace) showPanel(currentPlace, true);
  }
  const fmtTime = (s) => (s < 60 ? `${Math.floor(s)}초` : `${Math.floor(s / 60)}분${s % 60 >= 1 ? ' ' + Math.floor(s % 60) + '초' : ''}`);
  function showZenLine() {
    const el2 = $('#zen-line');
    el2.classList.remove('on');
    setTimeout(() => {
      zen.line = (zen.line + 1) % ZEN_LINES.length;
      el2.textContent = ZEN_LINES[zen.line];
      el2.classList.add('on');
    }, 900);
  }

  // 글 받기 — 안내 문구 · 버튼 글자를 상황에 맞게 바꿔서
  async function askWith(title, ph, notice, okText) {
    const n = $('#modal-notice'), ok = $('#modal-ok');
    const n0 = n.textContent, ok0 = ok.textContent;
    n.textContent = notice;
    ok.textContent = okText;
    const v = await askText(title, ph);
    n.textContent = n0;
    ok.textContent = ok0;
    return v;
  }

  // ------------------------------------------------------------------
  // 패널 — 장소에 가까이 가면 아래에 할 수 있는 일이 나옵니다
  // ------------------------------------------------------------------
  let currentPlace = null;
  function infoText(p) {
    if (!p) return '';
    if (p.type === 'fire') return `모두가 넣은 장작 ${counters.wood}개 · 구워 먹은 마시멜로 ${counters.smore}개`;
    if (p.type === 'tent') return `불 켜진 텐트 ${tents.filter((t) => t.on).length} / ${tents.length}`;
    if (p.type === 'hammock') return TOUCH ? '누우면 해먹이 천천히 흔들려요 · 화면을 끌어서 하늘을 둘러봐요' : '누우면 해먹이 천천히 흔들려요 · 드래그로 하늘을 둘러봐요';
    if (p.type === 'lake') return `밤하늘에 뜬 풍등 ${lanterns.length}개`;
    return '';
  }
  function refreshPanelInfo() {
    const i = $('#panel .info');
    if (i) i.textContent = infoText(currentPlace);
  }
  function actionsFor(p) {
    const u = player.userData, pose = u.pose;
    if (p.type === 'fire') {
      if (pose === 'sit' && mySeat && mySeat.kind !== 'deck') {
        return [
          ['🔥 불멍하기', startZen],
          u.roasting ? ['😋 먹기', () => eatMallow()] : ['🍡 마시멜로 굽기', startRoast],
          [guitarists.has(player) ? '🎸 그만 치기' : '🎸 기타 치기', toggleMyGuitar],
          [u.sparkObj ? '🎇 불꽃막대 끄기' : '🎇 불꽃막대', startSparkler],
          ['🪵 장작 넣기', () => addWood()],
          ['📝 고민 태우기', burnWorry],
          ['🙋 일어나기', standUp],
        ];
      }
      return [['🪑 빈자리에 앉기', sitFire], [u.sparkObj ? '🎇 불꽃막대 끄기' : '🎇 불꽃막대', startSparkler], ['🪵 장작 넣기', () => addWood()], ['📝 고민 태우기', burnWorry]];
    }
    if (p.type === 'tent') {
      if (pose === 'lie') return [['🙋 일어나기', standUp]];
      const i = nearestTent();
      return [[tents[i] && tents[i].on ? '🏮 랜턴 끄기' : '🏮 랜턴 켜기', () => toggleLantern(nearestTent())], ['🛌 텐트 안에 누워 쉬기', lieTent]];
    }
    if (p.type === 'hammock') {
      if (pose === 'lie') return [['🙋 일어나기', standUp]];
      return [['🌙 해먹에 눕기', lieHammock]];
    }
    if (p.type === 'lake') {
      const list = [['🏮 풍등 날리기', sendLantern], ['📜 풍등 읽기', readLantern], ['🪨 물수제비', () => skipStone()]];
      if (pose === 'sit') list.push(['🙋 일어나기', standUp]);
      else list.push(['🌊 물가에 걸터앉기', () => { const s = nearestFree(deckSeats); if (s) sitAt(s); else toast('물가 자리가 다 찼어요', 1600); }]);
      return list;
    }
    return [];
  }
  function showPanel(p, force = false) {
    if (p === currentPlace && !force) return;
    currentPlace = p;
    const panel = $('#panel');
    if (!p) { panel.classList.remove('show'); document.body.classList.remove('panel-open'); return; }
    panel.replaceChildren(el('h3', { textContent: p.name }), el('p', { textContent: p.desc }), el('div', { className: 'info', textContent: infoText(p) }));
    const row = el('div', { className: 'actions' });
    for (const [label, fn] of actionsFor(p)) row.append(el('button', { type: 'button', textContent: label, onclick: fn }));
    if (row.children.length) panel.append(row);
    panel.classList.add('show');
    document.body.classList.add('panel-open');
  }
  // 길 찾기 버튼
  for (const p of places) {
    $('#places').append(el('button', {
      type: 'button',
      textContent: p.name,
      onclick: () => {
        if (player.userData.pose !== 'stand') standUp();
        const dx = p.x - player.position.x, dz = p.z - player.position.z, d = Math.hypot(dx, dz) || 1;
        if (p.type === 'fire') {
          moveTarget = new THREE.Vector3(p.x - (dx / d) * 5, 0, p.z - (dz / d) * 5);
          arriveYaw = null;
        } else {
          // 캠프(모닥불) 쪽에 서서 장소를 바라봅니다 — 숲 쪽에서 오면 카메라가 나무 속에 갇히던 문제
          const cl = Math.hypot(p.x, p.z) || 1, cx = -p.x / cl, cz = -p.z / cl;
          const stop = p.radius * 0.5;
          moveTarget = new THREE.Vector3(p.x + cx * stop, 0, p.z + cz * stop);
          if (p.type === 'lake') moveTarget.set(DECK.x, 0, DECK.z);
          arriveYaw = Math.atan2(cx, cz);
        }
        waypoints = [];
        pushOut(moveTarget, 3);
        bestD = Infinity; stuckT = 0; detouring = false;
      },
    }));
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
  // 다른 사람들 (함께 모드)
  // ------------------------------------------------------------------
  const others = new Map();
  let roomChecked = false;
  const okColor = (v) => /^#[0-9a-f]{6}$/i.test(v);
  const handlers = {
    onPresence(ids) {
      const n = ids.length;
      presentIds = ids.slice();
      $('#people').textContent = n <= 1 ? '👥 지금은 나 혼자 불가에' : `👥 지금 ${n}명이 불가에 모였어요 ▾`;
      if ($('#who').classList.contains('open')) renderWho();
      for (const [id, o] of others) if (!ids.includes(id)) {
        if (o.name && performance.now() > joinQuietUntil) announce(`🚶 ${o.name}님이 자리를 떴어요`, false);
        guitarists.delete(o.av);
        scene.remove(o.av); disposeObj(o.av); others.delete(id);
      }
      if (!roomChecked && n > 0) {
        roomChecked = true;
        if (n > C.roomCapacity) {
          const m = room.match(/^(.*?)-(\d+)$/);
          const next = m ? `${m[1]}-${Number(m[2]) + 1}` : `${room}-2`;
          const box = $('#roomfull');
          box.replaceChildren('이 모닥불이 조금 붐벼요.', el('a', { href: `?room=${encodeURIComponent(next)}`, textContent: '한적한 모닥불로 가기 →' }));
          box.style.display = 'block';
        }
      }
    },
    onMove(m) {
      if (!m || m.id === me.id) return;
      let o = others.get(m.id);
      if (!o) {
        const name = String(m.name || '손님').slice(0, 20);
        const lk = m.look && typeof m.look === 'object' ? m.look : {};
        o = {
          av: makeAvatar(okColor(m.color) ? m.color : '#cccccc', name, {
            hair: Number.isInteger(lk.hair) ? lk.hair : undefined,
            hairColor: okColor(lk.hairColor) ? lk.hairColor : undefined,
            skin: okColor(lk.skin) ? lk.skin : undefined,
          }),
          tx: Number(m.x) || 0, tz: Number(m.z) || 0, ry: Number(m.ry) || 0,
        };
        o.av.position.set(o.tx, standY(o.tx, o.tz), o.tz);
        scene.add(o.av);
        others.set(m.id, o);
        if (performance.now() > joinQuietUntil) announce(`👋 ${name}님이 불가에 왔어요`, true);
      }
      o.name = String(m.name || '손님').slice(0, 20);
      o.tx = Number(m.x) || 0;
      o.tz = Number(m.z) || 0;
      o.ry = Number(m.ry) || 0;
      const u = o.av.userData;
      u.pose = ['stand', 'sit', 'lie'].includes(m.pose) ? m.pose : 'stand';
      o.lift = clamp(Number(m.lift) || 0, -0.5, 1.2);
      // 기타 · 마시멜로 — 늦게 들어온 사람도 지금 상태 그대로 보이게 움직임에 실어 보냅니다
      if (m.g && u.pose === 'sit') startGuitar(o.av, 0.08); else if (guitarists.has(o.av)) stopGuitar(o.av);
      // 불꽃막대 — 늦게 들어온 사람에게도 남은 시간만큼 보임
      if (m.sp > 0 && u.pose !== 'lie') { if (!u.sparkObj) giveSparkler(o.av, Number(m.sp)); u.sparkLeft = clamp(Number(m.sp), 0, SPARKLER_SECS); } else if (u.sparkObj) takeSparkler(o.av);
      if (m.rs && u.pose === 'sit') { giveStick(o.av); u.roastLv = clamp(Number(m.rl) || 0, 0, MALLOW_GONE); } else if (u.roasting) takeStick(o.av);
    },
    onAct(a) {
      if (!a || a.id === me.id) return;
      const o = others.get(a.id);
      if (['bow', 'wave', 'dance'].includes(a.type) && o) o.av.userData.gesture = { type: a.type, t: 0, dur: GESTURE_DUR[a.type] };
      if (a.type === 'emoji' && o && Number.isInteger(a.e) && a.e >= 0 && a.e < EMOJIS.length) floatEmoji(EMOJIS[a.e], o.av.position.clone().add(new THREE.Vector3(0, 2.4, 0)), 0.8, 1.6);
      if (a.type === 'wood' && o) addWood(o.av, false);
      if (a.type === 'burn' && o) throwBurn(o.av, false);
      if (a.type === 'eat' && o) eatMallow(o.av, false);
      if (a.type === 'burnt' && o) burnAway(o.av, false);
      if (a.type === 'lantern' && Number.isInteger(a.i)) toggleLantern(a.i, !!a.on, false);
      if (a.type === 'skip' && o && Number.isInteger(a.hops)) skipStone(o.av, false, clamp(a.hops, 1, 9), Number(a.ry) || 0);
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
      if (!$('#chat').classList.contains('open') && !zen.on) openChat(true);
      $('#btn-chat').classList.add('ping');
      setTimeout(() => $('#btn-chat').classList.remove('ping'), 2000);
    },
    onMessage(row) {
      if (!row) return;
      if (row.kind === 'wish') { addLantern(row, null); refreshPanelInfo(); }
    },
  };

  // ------------------------------------------------------------------
  // 입력
  // ------------------------------------------------------------------
  let camYaw = Math.PI * 0.85, camPitch = 0.3, camDist = 8.5, camDistNow = 8.5;
  let lookDrop = 0, camBlockD = Infinity, camBlockT = 0;
  let introOn = true;
  let detour = 1, detourT = 0, noWayT = 0, detouring = false;
  let bestD = Infinity, stuckT = 0;

  const keys = {};
  const typing = () => document.activeElement && document.activeElement.tagName === 'INPUT';
  window.addEventListener('keydown', (e) => {
    if (typing()) return;
    keys[e.code] = true;
    if (e.code === 'Escape') {
      $('#help').classList.remove('show');
      if (zen.on) stopZen();
      else if (player.userData.pose === 'lie') standUp();
    }
    if (e.code === 'KeyC' && !introOn && camMode === 'follow') { camYaw = player.rotation.y + Math.PI; camPitch = 0.3; }
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
    if (camMode === 'zen') return;
    if (drag.moved > 8) arriveYaw = null;
    camYaw -= dx * 0.006;
    camPitch = clamp(camPitch + dy * 0.004, camMode === 'lie' ? 0.1 : 0.04, camMode === 'lie' ? 1.5 : 1.2);
  });
  canvas.addEventListener('pointerup', (e) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    if (drag && drag.moved < 8) handleClick(e);
    drag = null;
  });
  canvas.addEventListener('pointercancel', (e) => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; drag = null; });
  canvas.addEventListener('wheel', (e) => { camDist = clamp(camDist + e.deltaY * 0.01, 3.2, 22); }, { passive: true });

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function handleClick(e) {
    if (introOn) return;
    ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(clickables, false)[0];
    if (hit) {
      const u = hit.object.userData;
      if (u.kind === 'lantern') return toast(`🏮 ${u.text}`, 4200);
      if (zen.on) return;
      const dd = Math.hypot(hit.point.x - player.position.x, hit.point.z - player.position.z);
      if (u.kind === 'seat' && dd < 14) {
        const free = u.seats.filter((s) => !seatTaken(s)).sort((a, b) => Math.hypot(a.x - hit.point.x, a.z - hit.point.z) - Math.hypot(b.x - hit.point.x, b.z - hit.point.z));
        if (free[0]) return sitAt(free[0]);
        return toast('누군가 앉아 있는 자리예요 🙂', 1600);
      }
      if (u.kind === 'tent' && dd < 10) return toggleLantern(u.i);
      if (u.kind === 'hammock' && dd < 10) return lieHammock();
    }
    if (camMode === 'lie') return;
    const g = raycaster.intersectObjects(groundMeshes, false)[0];
    if (g) {
      if (zen.on) stopZen();
      moveTarget = g.point.clone();
      const mdx = moveTarget.x - player.position.x, mdz = moveTarget.z - player.position.z;
      const md = Math.hypot(mdx, mdz);
      const MAX_STEP = 9;
      if (md > MAX_STEP) {
        moveTarget.x = player.position.x + (mdx / md) * MAX_STEP;
        moveTarget.z = player.position.z + (mdz / md) * MAX_STEP;
      }
      // 물을 클릭했으면 — 데크 앞쪽 물이면 데크 끝으로, 그 밖이면 가장 가까운 물가로 (물속으로 걸어 들어가지 않게)
      if (lakeD(moveTarget.x, moveTarget.z) < 1.14 && !onDeck(moveTarget.x, moveTarget.z)) {
        if (Math.abs(moveTarget.x - DECK.x) < DECK.hw + 4 && moveTarget.z > DECK.z) {
          moveTarget.set(clamp(moveTarget.x, DECK.x - DECK.hw + 0.5, DECK.x + DECK.hw - 0.5), 0, DECK.z + DECK.hd - 0.4);
        } else {
          const ex = (moveTarget.x - LAKE.x) / LAKE.rx, ez = (moveTarget.z - LAKE.z) / LAKE.rz, e = Math.hypot(ex, ez) || 1;
          moveTarget.set(LAKE.x + ex / e * LAKE.rx * 1.16, 0, LAKE.z + ez / e * LAKE.rz * 1.16);
        }
      }
      if (md < 0.6) moveTarget = null;
      else {
        if (player.userData.pose !== 'stand') standUp();
        pushOut(moveTarget, 3);
        bestD = Infinity; stuckT = 0; detouring = false; waypoints = [];
        markSpot(moveTarget);
      }
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
  $('#btn-places').onclick = () => $('#places').classList.toggle('open');
  for (const b2 of document.querySelectorAll('#places button')) {
    b2.addEventListener('click', () => { if (window.innerWidth <= 760) $('#places').classList.remove('open'); });
  }
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
    if (e.key === 'Enter' && !typing() && !introOn && !zen.on) { openChat(true); e.preventDefault(); }
  });
  $('#room-code').textContent = room;
  $('#room-change').onclick = async () => {
    const raw = await askText('들어갈 방 코드 (비우면 공개 방)', '예) FAMILY');
    if (raw === null) return;
    const code = roomCode(raw);
    if (String(raw).trim() && !code) { toast('방 코드는 한글 · 영문 · 숫자로 적어 주세요', 2400); return; }
    const want = code || 'MAIN';
    localStorage.setItem('bulmeong:lastRoom', want);
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
  $('#g-bow').onclick = () => gesture('bow');
  $('#g-dance').onclick = () => gesture('dance');
  const EMOJIS = ['😊', '😂', '🥰', '👍', '👏', '🔥', '🌙', '⭐', '🙏', '❤️', '🍡', '😴'];
  $('#g-emoji').onclick = () => pickFrom('이모지 보내기', EMOJIS, (i) => {
    if (!cool('emoji', 800)) return;
    floatEmoji(EMOJIS[i], player.position.clone().add(new THREE.Vector3(0, 2.4, 0)), 0.8, 1.6);
    store.send('act', { id: me.id, type: 'emoji', e: i });
  });
  $('#people').onclick = () => {
    const box = $('#who');
    box.classList.toggle('open');
    $('#hud').classList.toggle('expanded', box.classList.contains('open'));
    if (box.classList.contains('open')) renderWho();
    layoutPlaces();
  };
  function layoutPlaces() {
    const pl = $('#places');
    if (window.innerWidth <= 760) { pl.style.top = ''; return; }
    pl.style.top = Math.round($('#hud').getBoundingClientRect().bottom + 14) + 'px';
  }
  window.addEventListener('resize', layoutPlaces);
  setTimeout(layoutPlaces, 0);
  $('#btn-help').onclick = () => $('#help').classList.add('show');
  $('#help-close').onclick = () => $('#help').classList.remove('show');
  $('#zen-stop').onclick = () => stopZen();
  // 소리 장치를 통째로 새로 — 다른 앱에 다녀와 소리가 안 날 때. 모닥불 · 풀벌레 · 호수 소리를 다시 켭니다.
  function rebuildAudio() {
    const old = actx;
    for (const k of Object.keys(amb)) delete amb[k];
    ksCache.clear();
    actx = null; master = null; noiseBuf = null;
    try { if (old) old.close(); } catch (e) { /* 이미 닫힘 */ }
    ensureAudio();
    if (actx) startAmbient();
  }
  // 소리 깨우기 — 휴대폰은 다른 앱(카톡 등)에 다녀오면 소리 장치가 멈춥니다.
  //   아이폰은 상태가 'suspended' 가 아니라 'interrupted' 라서, 예전 코드(suspended 일 때만 resume)로는 다시 켜지지 않았고
  //   🔊 버튼을 누르면 오히려 '꺼짐'으로 바뀌어 새로고침밖에 방법이 없었습니다.
  //   ※ 아이폰은 카톡 등에 다녀오면 소리 권한을 '몇 초 뒤에야' 돌려줍니다. 예전엔 다시 켜기를 한 번만 시도하고 끝나서
  //     우연히 다시 켜질 때까지 오래 걸렸음 → 돌아오면 0.25초마다 계속 다시 켜기를 시도 (글자 안내는 없음).
  // 아이폰에 '음악처럼 재생하는 소리'라고 알림 — 다른 앱 전환 · 무음 스위치에 덜 끊김 (사파리 16.4+)
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* 없는 브라우저 */ }
  let wasAway = false, retryTimer = null;
  const soundAsleep = () => !!actx && actx.state !== 'running';
  function wakeAudio() {
    if (!actx || muted) return;
    if (actx.state !== 'running') actx.resume().then(() => { if (actx && actx.state === 'running') $('#sound-tap').classList.remove('show'); }).catch(() => {});
  }
  // 돌아온 뒤 소리가 날 때까지 0.25초마다 다시 켜기 (최대 30초) — 켜지는 순간 표시를 걷음
  function retryWake() {
    clearInterval(retryTimer);
    const t0 = performance.now();
    retryTimer = setInterval(() => {
      if (!actx || muted || document.hidden) { clearInterval(retryTimer); return; }
      if (actx.state === 'running') { clearInterval(retryTimer); $('#sound-tap').classList.remove('show'); wasAway = false; return; }
      actx.resume().catch(() => {});
      if (performance.now() - t0 > 30000) clearInterval(retryTimer);
    }, 250);
  }
  // 화면을 만지거나 키를 누르면 그 순간에도 바로 시도 (휴대폰은 '손을 떼는 순간(touchend)'이 가장 확실)
  for (const ev of ['touchend', 'click', 'keydown']) window.addEventListener(ev, wakeAudio, { capture: true, passive: true });
  // 다른 앱으로 나가면 스스로 쉬고, 돌아오면 계속 다시 켜기 + 아직 안 켜졌으면 '다시 켜는 중' 표시
  document.addEventListener('visibilitychange', () => {
    if (!actx) return;
    if (document.hidden) {
      wasAway = true;
      clearInterval(retryTimer);
      if (actx.state === 'running') actx.suspend().catch(() => {});
      return;
    }
    if (muted) return;
    wakeAudio();
    retryWake();
    // (돌아온 뒤 '다시 켜는 중' 글자는 띄우지 않음 — 조용히 다시 켜기만)
  });
  window.addEventListener('pageshow', () => { wakeAudio(); if (actx && !muted) retryWake(); });
  $('#sound-tap').addEventListener('click', () => { wakeAudio(); });
  $('#btn-sound').onclick = () => {
    ensureAudio();
    // 소리가 멈춰 있으면(다른 앱에 다녀온 뒤 등) 이 버튼은 '다시 켜기' — 끄지 않습니다
    if (soundAsleep() && !muted) {
      // 직접 눌렀는데도 멈춰 있으면 — 마지막 수단으로 소리 장치를 새로 만듦 (아이폰의 '켜짐인데 소리 없음' 문제 대비)
      if (wasAway) { wasAway = false; clearInterval(retryTimer); rebuildAudio(); } else actx.resume().catch(() => {});
      startAmbient();
      $('#sound-tap').classList.remove('show');
      toast('🔊 소리를 다시 켰어요', 1500);
      return;
    }
    if (actx && actx.state !== 'running') actx.resume().catch(() => {});
    muted = !muted;
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.8, actx.currentTime, 0.2);
    if (!muted) startAmbient();
    $('#btn-sound').innerHTML = muted ? '🔇<span> 소리 꺼짐</span>' : '🔊<span> 소리 켜짐</span>';
  };
  // 휴대폰 첫 안내 카드 — "어떻게 움직여야 하는지 모르겠다"는 분들을 위해. 길찾기 버튼도 반짝이게 합니다.
  //   '알겠어요'를 누르거나 길찾기를 한 번 쓰면 다시 안 띄웁니다 (안 눌러도 3번까지만)
  function showCoach(lines) {
    const K = 'bulmeong:coach';
    const n = Number(localStorage.getItem(K) || 0);
    if (n >= 3) return;
    localStorage.setItem(K, String(n + 1));
    const card = el('div', { id: 'coach', className: 'glass' }, [
      el('h4', { textContent: '이렇게 움직여요' }),
      ...lines.map((t) => { const p = el('p'); p.innerHTML = t; return p; }),
      el('button', { type: 'button', textContent: '알겠어요' }),
    ]);
    document.body.append(card);
    const btn = $('#btn-places');
    btn.classList.add('coach-pulse');
    const done = () => { localStorage.setItem(K, '9'); card.classList.remove('show'); btn.classList.remove('coach-pulse'); setTimeout(() => card.remove(), 400); };
    card.querySelector('button').onclick = done;
    btn.addEventListener('click', done, { once: true });
    setTimeout(() => card.classList.add('show'), 700);
  }
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
    emberMat.uniforms.uH.value = window.innerHeight;
    if (composer) composer.setSize(window.innerWidth, window.innerHeight);
  });

  // ------------------------------------------------------------------
  // 내 캐릭터 — 모닥불 남쪽에서 시작
  // ------------------------------------------------------------------
  player = makeAvatar(me.look.color, me.name, { hair: me.look.hair, hairColor: me.look.hairColor, skin: me.look.skin });
  player.position.set(4.0, standY(4.0, -5.1), -5.1);
  player.rotation.y = Math.atan2(-4.0, 5.1);
  scene.add(player);

  // ------------------------------------------------------------------
  // 시작 화면
  // ------------------------------------------------------------------
  document.title = C.title;
  $('#hud-title').textContent = C.title;
  $('#intro-title').textContent = C.title;
  $('#intro-sub').textContent = C.subtitle;
  $('#intro-mode').textContent = store.mode === 'supabase'
    ? `함께 모드 · 방 "${room}"`
    : '혼자 모드 · 풍등은 이 브라우저에만 저장돼요';
  if (store.mode === 'local') $('#people').textContent = '혼자 모드로 불 쬐는 중';
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
  enterBtn.textContent = '불멍캠프 시작하기';
  $('#intro').classList.add('ready');
  const nameInput = $('#intro-name');
  nameInput.value = me.name;
  nameInput.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.isComposing) enterBtn.click(); };
  const codeInput = $('#intro-code');
  codeInput.value = room === 'MAIN' ? '' : room;
  {
    const urlHasRoom = params.get('room') || pathCode;
    const last = localStorage.getItem('bulmeong:lastRoom');
    if (!urlHasRoom && last && last !== 'MAIN') {
      codeInput.value = last;
      $('#intro-mode').textContent = `지난번 방 "${last}" 으로 들어가요 · 공개 방은 코드를 지우세요`;
    }
  }
  codeInput.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.isComposing) enterBtn.click(); };
  enterBtn.onclick = () => {
    const want = roomCode(codeInput.value) || 'MAIN';
    localStorage.setItem('bulmeong:lastRoom', want);
    if (want !== room) { location.href = location.pathname.replace(/\/room\/.*/, '') + '?room=' + encodeURIComponent(want); return; }
    const nm = nameInput.value.replace(/\s+/g, ' ').trim().slice(0, 12);
    if (nm && nm !== me.name) {
      me.name = nm;
      localStorage.setItem('shelter:name', nm);
      $('#myname').textContent = nm;
      applyLook();
    }
    ensureAudio();
    if (actx && actx.state === 'suspended') actx.resume();
    startAmbient();
    $('#btn-sound').innerHTML = '🔊<span> 소리 켜짐</span>';
    $('#intro').classList.remove('show');
    document.body.classList.remove('intro');
    introOn = false;
    camYaw = player.rotation.y + Math.PI;
    camPitch = 0.3;
    camera.position.set(player.position.x - Math.sin(player.rotation.y) * 8, player.position.y + 4, player.position.z - Math.cos(player.rotation.y) * 8);
    // 휴대폰은 안내 카드(길찾기 · 톡 · 끌기), 컴퓨터는 예전처럼 한 줄 안내
    //   (쉼터 ↔ 불멍으로 건너온 경우엔 이미 길찾기를 쓴 것이라 띄우지 않음)
    // 휴대폰은 들어올 때마다 길찾기 버튼이 반짝 — 이번 방문에서 한 번 누르면 멈춤 (안내 카드는 처음 몇 번만)
    if (TOUCH && params.get('go') !== '1') {
      const pb = $('#btn-places');
      pb.classList.add('coach-pulse');
      pb.addEventListener('click', () => pb.classList.remove('coach-pulse'), { once: true });
    }
    if (TOUCH) { if (params.get('go') !== '1') showCoach([
          '📍 위쪽 <b>길찾기</b>를 누르면 모닥불 · 텐트 · 해먹 · 호숫가로 <b>바로 이동</b>해요',
          '👆 화면을 <b>터치</b>하면 그곳으로 이동할 수 있어요',
        ]); }
    else if (!localStorage.getItem('bulmeong:viewHint')) {
      localStorage.setItem('bulmeong:viewHint', '1');
      const touch = window.matchMedia('(pointer: coarse)').matches;
      setTimeout(() => toast(touch
        ? '👆 땅을 누르면 걸어가요 · 모닥불 가까이 가 보세요'
        : '🖱 땅을 클릭하거나 W A S D 로 걸어요 · 모닥불 가까이 가 보세요', 5200), 1200);
    }
    joinQuietUntil = performance.now() + 4000;
    if (room !== 'MAIN') localStorage.setItem('bulmeong:lastRoom', room);
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
    // 다른 공간 탭 — 길찾기 옆에 따로 (길찾기에는 이 공간의 장소만)
    //   이름 · 모습(localStorage)과 방 코드(?room=)가 그대로 따라가고, ?go=1 로 건너오면 시작 화면 없이 바로 들어갑니다.
    const DESTS = [
      { icon: '🌲', label: '쉼터', title: '쉼터로 이동', goText: '🌲 쉼터로 이동 중', local: '../index.v2.html', web: '/', channel: 'shelter' },
      { icon: '🎅', label: '산타', title: '산타 마을로 이동', goText: '🎅 산타 마을로 이동 중', local: '../산타/index.html', web: '/santa/' },
    ];
    const urlOf = (D) => {
      const base = location.protocol === 'file:' ? new URL(D.local, location.href).href : new URL(D.web, location.origin).href;
      return base + '?room=' + encodeURIComponent(room) + '&go=1';
    };
    const fade = $('#fade');
    let anchor = $('#btn-places');
    for (const D of DESTS) {
      const b = el('button', { type: 'button', className: `glass iconbtn space-tab st-${DESTS.indexOf(D)}`, title: D.title }, [document.createTextNode(D.icon), el('span', { className: 'lbl', textContent: ' ' + D.label }), el('span', { className: 'cnt' })]);
      b.onclick = () => {
        $('#places').classList.remove('open');
        fade.querySelector('.go-text').textContent = D.goText;                  // '○○로 이동 중'
        fade.classList.add('on');                                               // 화면이 천천히 어두워지고
        if (master && actx) master.gain.setTargetAtTime(0, actx.currentTime, 0.15);   // 소리도 함께 잦아든 뒤
        setTimeout(() => location.assign(urlOf(D)), 450);                       // 건너갑니다
      };
      anchor.after(b);
      anchor = b;
      // 건너편 공간에 지금 몇 명 있는지 (함께 모드일 때만)
      if (D.channel && store.watchCount) store.watchCount(`${D.channel}:${room}`, (n) => { b.querySelector('.cnt').textContent = n > 0 ? ` ${n}` : ''; });
    }
    {
      // 휴대폰 — 탭을 이름표 바로 아래에 (이름표가 '지금 2명이 함께 쉬고 있어요' 처럼 두 줄로 늘어나도 가리지 않게)
      const hud = $('#hud');
      const place = () => { const r = hud.getBoundingClientRect(); document.documentElement.style.setProperty('--tabTop', Math.round(r.bottom + 6) + 'px'); };
      place();
      addEventListener('resize', place);
      setInterval(place, 600);
    }
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
  const tmp = new THREE.Vector3();
  const tmpMove = new THREE.Vector3(), tmpMove2 = new THREE.Vector3();
  const camRay = new THREE.Raycaster();
  const tmpM4 = new THREE.Matrix4();
  window.__bul = { cam: () => camera.position.clone(), pos: () => player.position.clone(), lake: (x, z) => lakeD(x, z), deck: (x, z) => onDeck(x, z) };   // 확인용
  const emPos = emberGeo.attributes.position, emLife = emberGeo.attributes.aLife, emSize = emberGeo.attributes.aSize;
  const flyPos = flies.pts.geometry.attributes.position, flyLife = flies.pts.geometry.attributes.aLife;
  let lastRl = 0;
  function tick() {
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;

    // ---------- 이동 (쉼터와 같은 규칙: 키보드 정면 충돌은 멈춤 · 클릭 이동은 우회) ----------
    let mx = 0, mz = 0;
    if (!typing() && !introOn) {
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
      if (player.userData.pose !== 'stand') standUp();
      if (zen.on) stopZen();
      const sp = 5.0 * dt;
      const ux = vx / len, uz = vz / len;
      const stepTo = (dirx, dirz, out) => {
        out.set(beforeX + dirx * sp, 0, beforeZ + dirz * sp);
        pushOut(out);
        return Math.hypot(out.x - beforeX, out.z - beforeZ);
      };
      let gotX, gotZ, got = stepTo(ux, uz, tmpMove);
      gotX = tmpMove.x; gotZ = tmpMove.z;
      if (got < sp * 0.5) {
        if (moveTarget) {
          // 목적지가 있으면 벽을 돌아갑니다. 한 번 정한 방향은 길이 뚫릴 때까지 유지 (뱅글뱅글 방지)
          if (!detouring) {
            const tx = moveTarget.x - beforeX, tz = moveTarget.z - beforeZ;
            detour = (-uz * tx + ux * tz) > 0 ? 1 : -1;
            detouring = true;
          }
          detourT = 0.2;
          const px2 = -uz * detour, pz2 = ux * detour;
          const mxl = ux + px2, mzl = uz + pz2, ml2 = Math.hypot(mxl, mzl) || 1;
          for (const [dx2, dz2] of [[mxl / ml2, mzl / ml2], [px2, pz2]]) {
            const d2 = stepTo(dx2, dz2, tmpMove2);
            if (d2 > got) { gotX = tmpMove2.x; gotZ = tmpMove2.z; got = d2; }
            if (got > sp * 0.6) break;
          }
        } else {
          // 키보드 — 비스듬히 닿았으면 미끄러지고, 정면(35° 이내)이면 그냥 섭니다
          const pushX = tmpMove.x - (beforeX + ux * sp), pushZ = tmpMove.z - (beforeZ + uz * sp);
          const pl = Math.hypot(pushX, pushZ);
          if (pl > 1e-5) {
            const nx2 = pushX / pl, nz2 = pushZ / pl;
            const dotv = ux * nx2 + uz * nz2;
            if (Math.abs(dotv) <= 0.82) {
              const sx = ux - dotv * nx2, sz = uz - dotv * nz2;
              const sl = Math.hypot(sx, sz);
              if (sl > 1e-5) {
                const d2 = stepTo(sx / sl, sz / sl, tmpMove2);
                if (d2 > got) { gotX = tmpMove2.x; gotZ = tmpMove2.z; got = d2; }
              }
            }
          }
        }
      } else { detouring = false; detourT = 0; }
      detourT -= dt;
      if (got < sp * 0.3) { gotX = beforeX; gotZ = beforeZ; got = 0; }
      player.position.x = gotX;
      player.position.z = gotZ;
      const r = Math.hypot(player.position.x, player.position.z);
      if (r > 70) { player.position.x *= 70 / r; player.position.z *= 70 / r; }
      if (got > sp * 0.35) {
        player.rotation.y = Math.atan2(gotX - beforeX, gotZ - beforeZ);
        noWayT = 0;
      } else {
        moving = false;
        noWayT += dt;
        if (moveTarget && Math.hypot(moveTarget.x - beforeX, moveTarget.z - beforeZ) < 2.2) { moveTarget = null; noWayT = 0; }
        else if (moveTarget && noWayT > 1.2) {
          moveTarget = null; noWayT = 0;
          blockedMsg -= dt;
          if (blockedMsg <= 0) { toast('이쪽은 막혀 있어요. 다른 쪽을 클릭해 보세요 🙂', 1800); blockedMsg = 8; }
        }
      }
      if (moveTarget) {
        const curD = Math.hypot(moveTarget.x - player.position.x, moveTarget.z - player.position.z);
        if (curD < bestD - 0.3) { bestD = curD; stuckT = 0; }
        else if ((stuckT += dt) > 3.5) {
          moveTarget = null; detouring = false; stuckT = 0; bestD = Infinity;
          toast('돌아갈 길을 못 찾았어요. 다른 쪽을 클릭해 보세요 🙂', 1800);
        }
      } else { bestD = Infinity; stuckT = 0; }
      if (moveTarget && !drag && moving && detourT <= 0) {
        const mvx = gotX - beforeX, mvz = gotZ - beforeZ;
        const tgx = moveTarget.x - beforeX, tgz = moveTarget.z - beforeZ;
        const ml3 = Math.hypot(mvx, mvz) * Math.hypot(tgx, tgz);
        if (ml3 > 1e-6 && Math.hypot(mvx, mvz) > sp * 0.6 && (mvx * tgx + mvz * tgz) / ml3 > 0.6) {
          let d = Math.atan2(-mvx, -mvz) - camYaw;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          camYaw += d * Math.min(1, dt * 1.6);
        }
      }
      netDirty = true;
    } else if (player.userData.pose === 'stand') {
      pushOut(player.position);
    }
    // 해먹에 누워 있으면 몸도 천을 따라 살짝 옆으로
    let swingOff = 0;
    if (hammock.pivot) {
      const lying = lieSpot && lieSpot.kind === 'hammock';
      let hamBusy = lying;
      for (const o of others.values()) if (o.av.userData.pose === 'lie' && Math.hypot(o.tx - hammock.x, o.tz - hammock.z) < 1.6) hamBusy = true;
      hammock.amp = lerp(hammock.amp || 0.015, hamBusy ? 0.075 : 0.015, Math.min(1, dt * 0.8));
      const a = Math.sin(t * 0.85) * hammock.amp;
      hammock.pivot.rotation.order = 'YXZ';
      hammock.pivot.rotation.x = a;
      swingOff = -a * 1.25;
      if (lying) {
        player.position.x = lieSpot.x + hammock.side.x * swingOff;
        player.position.z = lieSpot.z + hammock.side.z * swingOff;
      }
    }
    const wantY = standY(player.position.x, player.position.z) + (player.userData.pose === 'stand' ? 0 : seatOff);
    player.position.y = lerp(player.position.y, wantY, Math.min(1, dt * 12));
    animateAvatar(player, dt, moving);
    player.visible = camMode !== 'lie';
    player.userData.label.visible = player.userData.pose === 'stand' && camera.position.distanceTo(player.position) > 9;
    for (const l of placeLabels) l.visible = camMode === 'follow' && camera.position.distanceTo(l.position) > 12;

    // ---------- 모닥불 ----------
    fire.boost = Math.max(0, fire.boost - dt * 0.055);
    fire.burn = Math.max(0, (fire.burn || 0) - dt * 0.6);
    const wantLv = 1 + fire.boost + fire.burn * 0.5;
    fire.level = lerp(fire.level, wantLv, Math.min(1, dt * 2.5));
    // 일렁임 — 0.1초마다 목표를 새로 뽑고 부드럽게 따라갑니다 (빠른 깜빡임 없이)
    fire.flickT -= dt;
    if (fire.flickT <= 0) { fire.flickTarget = 0.88 + Math.random() * 0.22; fire.flickT = 0.08 + Math.random() * 0.12; }
    fire.flick = lerp(fire.flick, fire.flickTarget || 1, Math.min(1, dt * 7));
    const lv = fire.level;
    fireLight.intensity = 30 * lv * fire.flick;
    fireLight.position.set(Math.sin(t * 2.3) * 0.08, FIRE_Y + 1.0 + lv * 0.18, Math.cos(t * 1.9) * 0.08);
    for (const f of fire.flames) {
      const b = f.userData.base;
      f.material.uniforms.uTime.value = t;
      f.material.uniforms.uPower.value = 0.9 + (lv - 1) * 0.35;
      f.scale.set(0.85 + lv * 0.15, 0.7 + lv * 0.3 + (fire.flick - 1) * 0.6, 1);
      f.rotation.y = Math.atan2(camera.position.x - b.x, camera.position.z - b.z);
    }
    fire.glow.material.opacity = 0.2 + 0.08 * lv * fire.flick;
    fire.glow.scale.setScalar(3.4 + lv * 0.9);
    fire.pool.material.opacity = 0.11 + 0.05 * lv * fire.flick;
    fire.bed.material.color.setScalar(0.8 + 0.25 * fire.flick);
    for (const c of fire.coals) c.m.emissiveIntensity = c.base * (0.75 + 0.25 * Math.sin(t * 1.3 + c.p)) * (0.8 + 0.2 * lv);
    fire.charM.emissiveIntensity = 0.06 + 0.05 * Math.sin(t * 0.9);
    // 불티
    emberAcc += dt * (9 + lv * 9);
    for (let i = 0; i < emberData.length; i++) {
      const e = emberData[i];
      if (e.life <= 0 && emberAcc >= 1) { spawnEmber(e); emberAcc -= 1; }
      if (e.life > 0) {
        e.life -= dt;
        e.vy = Math.max(0.3, e.vy - dt * 0.25);
        e.x += (e.vx + Math.sin(t * 2.2 + e.ph) * 0.35) * dt;
        e.z += (e.vz + Math.cos(t * 1.8 + e.ph) * 0.35) * dt;
        e.y += e.vy * dt;
      }
      emPos.setXYZ(i, e.x, e.life > 0 ? e.y : -50, e.z);
      emLife.setX(i, Math.max(0, e.life / e.max));
      emSize.setX(i, e.size);
    }
    emberAcc = Math.min(emberAcc, 3);
    emPos.needsUpdate = emLife.needsUpdate = emSize.needsUpdate = true;
    // 연기
    for (const s of smokes) {
      s.t = (s.t + dt * s.sp) % 1;
      const k = s.t;
      s.s.position.set(Math.sin(k * 5 + s.dx) * 0.3 * k + k * 1.2, FIRE_Y + 2.0 + k * 6, Math.cos(k * 4 + s.dx) * 0.3 * k + k * 0.5);
      s.s.scale.setScalar(1 + k * 4.5);
      s.s.material.opacity = 0.09 * Math.sin(k * Math.PI) * (0.7 + 0.3 * lv);
      s.s.visible = camMode !== 'lie';           // 텐트 · 해먹에서 하늘을 볼 땐 연기를 없앱니다
    }
    // 텐트 랜턴 — 켜고 끌 때 천천히
    for (const tn of tents) {
      const w = tn.on ? 1 : 0;
      tn.glow = lerp(tn.glow || 0, w, Math.min(1, dt * 3));
      // 내가 이 텐트 안에 누워 있으면 — 바로 위 랜턴이 눈부시지 않게 은은한 무드등 정도로
      const inside = lieSpot && lieSpot.kind === 'tent' && Math.hypot(lieSpot.x - tn.lie.x, lieSpot.z - tn.lie.z) < 0.1;
      tn.dim = lerp(tn.dim === undefined ? 1 : tn.dim, inside ? 0.18 : 1, Math.min(1, dt * 4));
      tn.m.emissiveIntensity = tn.glow * 0.32 * tn.dim * (0.96 + 0.04 * Math.sin(t * 3 + tn.x));
      tn.light.intensity = tn.glow * 5 * (0.3 + 0.7 * tn.dim);
      tn.lanternM.emissiveIntensity = (0.2 + tn.glow * 2.2) * tn.dim;
    }
    // 반딧불이
    for (let i = 0; i < flies.base.length; i++) {
      const b = flies.base[i];
      flyPos.setXYZ(i, b.x + Math.sin(t * 0.5 * b.s + b.p) * 1.3, b.y + Math.sin(t * 0.8 + b.p * 2) * 0.4, b.z + Math.cos(t * 0.45 * b.s + b.p) * 1.3);
      flyLife.setX(i, Math.pow(Math.max(0, Math.sin(t * 0.9 * b.s + b.p * 3)), 3));
    }
    flyPos.needsUpdate = flyLife.needsUpdate = true;
    // 물결 · 달빛 길 — 카메라에서 본 '달의 반사' 자리에 띠를 눕힙니다
    // 잔잔한 물 — 고운 잔물결이 아주 느리게, 가끔 물방울 동심원이 퍼집니다
    if (water.mat.normalMap) water.mat.normalMap.offset.set(t * 0.0025 + Math.sin(t * 0.13) * 0.004, t * 0.004 + Math.cos(t * 0.11) * 0.004);
    water.dropT = (water.dropT === undefined ? 1 : water.dropT) - dt;
    if (water.dropT <= 0) {
      water.dropT = 0.9 + Math.random() * 2.4;
      const a = Math.random() * 6.28, k = Math.sqrt(Math.random()) * 0.85;
      ripple(LAKE.x + Math.cos(a) * LAKE.rx * k, LAKE.z + Math.sin(a) * LAKE.rz * k, 0.45 + Math.random() * 0.35);
    }
    {
      const cy = camera.position.y - WATER_Y;
      const ry = MOON_DIR.y;
      const k = cy / ry;                                         // 물에 비친 달까지 가는 수평 거리 비율
      const px = camera.position.x + MOON_DIR.x * k, pz = camera.position.z + MOON_DIR.z * k;
      const L = Math.min(40, 8 + k * 0.6);
      const cx = px + MOON_DIR.x * L * 0.35, cz = pz + MOON_DIR.z * L * 0.35;
      const inLake = lakeD(cx, cz) < 1.05;
      water.glade.visible = inLake;
      if (inLake) {
        water.glade.position.set(cx, WATER_Y + 0.02, cz);
        water.glade.rotation.set(-Math.PI / 2, 0, 0);
        water.glade.rotation.y = Math.atan2(MOON_DIR.x, MOON_DIR.z);
        water.glade.scale.set(1.6 + L * 0.03, L, 1);
        water.glade.material.opacity = (1 - smooth(0.85, 1.05, lakeD(cx, cz))) * (0.2 + Math.sin(t * 1.7) * 0.03 + Math.sin(t * 3.1) * 0.02);   // 은은하게
      }
    }
    // 별 · 별똥별 · 하늘
    starMat.uniforms.uTime.value = t;
    skyMat.uniforms.uTime.value = t;
    skyGroup.position.set(camera.position.x, 0, camera.position.z);
    // 별 · 별자리 · 은하수가 북극성 축을 중심으로 천천히 옆으로 흐릅니다 (약 13분에 한 바퀴)
    starSky.quaternion.setFromAxisAngle(POLE, t * 0.008);
    skyMat.uniforms.uRot.value.setFromMatrix4(tmpM4.makeRotationFromQuaternion(starSky.quaternion).invert());
    {
      // 별자리 — 선 없이 별만. 누워서 하늘을 보면 이름만 옅게 떠오릅니다
      const lying = camMode === 'lie';
      for (const cs of constels) {
        cs.name.material.opacity = lerp(cs.name.material.opacity, lying ? 0.55 : 0, Math.min(1, dt * 0.8));
        cs.lines.material.opacity = lerp(cs.lines.material.opacity, lying ? 0.24 : 0.05, Math.min(1, dt * 0.6));   // 누우면 은은하게
      }
      // 해먹에 누운 동안엔 해먹 장식(두 소나무 · 랜턴 · 전구)을 숨겨 하늘을 온전히
      const onHam = !!(lieSpot && lieSpot.kind === 'hammock');
      if (hammock.decor) hammock.decor.visible = !onHam;
      if (hammock.pivot) hammock.pivot.visible = !onHam;
    }
    shootT -= dt;
    if (shootT <= 0) { shootingStar(); shootT = camMode === 'lie' ? 4 + Math.random() * 7 : 18 + Math.random() * 30; }
    for (let i = shooting.length - 1; i >= 0; i--) {
      const s = shooting[i];
      s.t += dt;
      s.m.position.addScaledVector(s.dir, 150 * dt);
      s.m.material.opacity = 0.9 * Math.max(0, 1 - s.t / 1.2);
      if (s.t > 1.2) { skyGroup.remove(s.m); s.m.geometry.dispose(); s.m.material.dispose(); shooting.splice(i, 1); }
    }
    // 풍등
    for (const L of lanterns) {
      if (L.rise) {
        L.rise.t += dt;
        const up = smooth(0, 7, L.rise.t) * 4.5;                     // ① 7초 동안 눈앞에서 천천히 떠오르고
        const e = smooth(6, 40, L.rise.t);                           // ② 그다음 34초에 걸쳐 하늘 자리로
        tmpV.copy(L.rise.from); tmpV.y += up;
        L.g.position.lerpVectors(tmpV, L.home, e);
        L.g.position.x += Math.sin(t * 0.7 + L.ph) * 0.35 * Math.min(1, L.rise.t / 3);
        if (L.rise.t >= 40) L.rise = null;
      } else {
        L.g.position.set(L.home.x + Math.sin(t * 0.05 + L.ph) * 3, L.home.y + Math.sin(t * 0.3 + L.ph) * 0.6, L.home.z + Math.cos(t * 0.04 + L.ph) * 3);
      }
      L.g.children[1].material.opacity = 0.6 + 0.15 * Math.sin(t * 2.3 + L.ph);
    }

    // ---------- 손에 든 것들 ----------
    if (player.userData.roasting) {
      player.userData.roastLv += dt / 9;
      tintMallow(player, t);
      const step = Math.round(player.userData.roastLv * 10) / 10;
      if (step !== lastRl) { lastRl = step; netDirty = true; }
      if (player.userData.roastLv > 1.12 && !player.userData.burnWarned) { player.userData.burnWarned = true; toast('🔥 앗, 마시멜로에 불이 붙었어요! 얼른 "먹기"!', 2600); }
      if (player.userData.roastLv >= MALLOW_GONE) burnAway(player, true);   // 그래도 안 먹으면 다 타 버림
    } else player.userData.burnWarned = false;
    for (const o of others.values()) if (o.av.userData.roasting) tintMallow(o.av, t);
    updateSparklers(dt, t);
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      p.t += dt / p.dur;
      const e = Math.min(1, p.t);
      p.obj.position.lerpVectors(p.from, p.to, e);
      p.obj.position.y += Math.sin(e * Math.PI) * p.h;
      p.obj.rotation.x += dt * 7;
      if (p.t >= 1) { scene.remove(p.obj); projectiles.splice(i, 1); if (p.onLand) p.onLand(); }
    }
    for (let i = skips.length - 1; i >= 0; i--) {
      const s = skips[i];
      const a = s.pts[s.seg], b = s.pts[s.seg + 1];
      if (!b) {
        // 마지막 — 퐁당 가라앉습니다
        ripple(a.x, a.z, 2.2);
        plip(0.8);
        scene.remove(s.stone);
        skips.splice(i, 1);
        if (s.mine) setTimeout(() => toast(s.hops >= 6 ? `🪨 물수제비 ${s.hops}번! 대단해요 🎉` : `🪨 물수제비 ${s.hops}번`, 2400), 200);
        continue;
      }
      const segLen = a.distanceTo(b);
      s.t += dt * 9 / Math.max(0.6, segLen);
      const e = Math.min(1, s.t);
      s.stone.position.lerpVectors(a, b, e);
      s.stone.position.y += Math.sin(e * Math.PI) * Math.min(1.2, segLen * 0.16);
      s.stone.rotation.y += dt * 20;
      if (s.t >= 1) {
        s.t = 0;
        s.seg++;
        if (s.pts[s.seg + 1]) { ripple(b.x, b.z, 1); const d = b.distanceTo(player.position); plip(clamp(1 / (1 + Math.pow(d / 8, 2)), 0.1, 1)); }
      }
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.t += dt / (r.mark ? 0.7 : 1.6);
      r.m.scale.setScalar(r.size * (1 + r.t * (r.mark ? 1.2 : 5)));
      r.m.material.opacity = (r.mark ? 0.85 : 0.5) * (1 - r.t);
      if (r.t >= 1) { scene.remove(r.m); r.m.material.dispose(); rings.splice(i, 1); }
    }
    updateGuitars(dt);
    updateLogs(dt);

    // ---------- 다른 사람들 ----------
    for (const o of others.values()) {
      const px2 = o.av.position.x, pz = o.av.position.z;
      // 받은 위치까지 걸음 속도로 이어 걷습니다 — 위치를 드물게 받아도 뚝뚝 끊기지 않게. 멀리 떨어졌거나 앉고 누울 땐 바로.
      const dxr = o.tx - px2, dzr = o.tz - pz, dr = Math.hypot(dxr, dzr);
      if (dr > 1e-4) {
        const stepR = dr > 4 || o.av.userData.pose !== 'stand' ? dr : Math.min(dr, 5.6 * dt * (dr > 1.2 ? 1.5 : 1));
        o.av.position.x = px2 + (dxr / dr) * stepR;
        o.av.position.z = pz + (dzr / dr) * stepR;
      }
      o.av.position.y = standY(o.av.position.x, o.av.position.z) + (o.av.userData.pose === 'stand' ? 0 : (o.lift || 0));
      o.av.rotation.y = o.ry;
      animateAvatar(o.av, dt, Math.hypot(o.tx - px2, o.tz - pz) > 0.05);
    }

    // ---------- 모닥불 이웃 ----------
    for (const n of npcs) {
      const u = n.av.userData;
      n.t -= dt;
      if (n.role === 'roast') {
        if (!u.roasting && n.t <= 0) { giveStick(n.av); u.roastLv = 0; n.t = 9 + Math.random() * 4; }
        else if (u.roasting) {
          u.roastLv += dt / 9;
          tintMallow(n.av, t);
          if (n.t <= 0) { eatMallow(n.av, false); n.t = 18 + Math.random() * 14; }
        }
      }
      if (n.role === 'guitar' && !u.guitarObj) giveGuitar(n.av);   // 무릎에 기타만 — 소리는 내가 칠 때만 납니다
      const dp = n.av.position.distanceTo(player.position);
      n.greet -= dt;
      if (n.greet <= 0 && dp < 6 && player.userData.pose === 'stand' && !u.gesture) {
        u.gesture = { type: 'wave', t: 0, dur: 2.2 };
        n.greet = 40;
      }
      n.talk -= dt;
      if (n.talk <= 0) {
        if (dp < 12 && !zen.on) sayBubble(n.av, NPC_LINES[Math.floor(Math.random() * NPC_LINES.length)]);
        n.talk = 35 + Math.random() * 45;
      }
      // 앉은 채로 고개를 불 쪽 · 내 쪽으로 천천히
      animateAvatar(n.av, dt, false);
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.t += dt;
      if (f.hold) {
        const pop = f.t < 0.25 ? 0.6 + 0.6 * (f.t / 0.25) : 1.2 - 0.2 * smooth(0.25, 0.45, f.t);
        f.s.scale.copy(f.base).multiplyScalar(pop);
        if (f.t >= f.hold) f.s.position.y += dt * 0.55;
        f.s.material.opacity = 1 - smooth(f.hold, f.hold + 1.6, f.t);
        if (f.t > f.hold + 1.6) { scene.remove(f.s); disposeObj(f.s); floaters.splice(i, 1); }
        continue;
      }
      f.s.position.y += dt * 1.2;
      f.s.position.x += f.vx * dt;
      f.s.material.opacity = 1 - f.t / 2;
      if (f.t > 2) { scene.remove(f.s); disposeObj(f.s); floaters.splice(i, 1); }
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

    // ---------- 장소 근접 ----------
    let near = null, nd = Infinity;
    for (const p of places) {
      const d = Math.hypot(player.position.x - p.x, player.position.z - p.z);
      if (d < p.radius && d < nd) { near = p; nd = d; }
    }
    if (mySeat && mySeat.kind === 'deck') near = placeOf('lake');
    showPanel(near);

    // ---------- 카메라 ----------
    if (arriveYaw !== null && !moveTarget && camMode === 'follow') {   // 도착하면 캠프 쪽에서 바라보는 시점으로 천천히
      let d = arriveYaw - camYaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      camYaw += d * Math.min(1, dt * 2.2);
      camPitch = lerp(camPitch, 0.3, Math.min(1, dt * 2));
      if (Math.abs(d) < 0.02) arriveYaw = null;
    }
    if (!typing() && !introOn && camMode !== 'zen') {
      if (keys.KeyQ) camYaw += dt * 1.9;
      if (keys.KeyE) camYaw -= dt * 1.9;
      const lie = camMode === 'lie';
      if (keys.KeyR) camPitch = clamp(camPitch + dt * 1.1, lie ? 0.35 : 0.04, lie ? 1.5 : 1.2);
      if (keys.KeyF) camPitch = clamp(camPitch - dt * 1.1, lie ? 0.35 : 0.04, lie ? 1.5 : 1.2);
    }
    const head = tmp.set(player.position.x, player.position.y + 1.5, player.position.z);
    if (introOn) {
      // 시작 화면 — 모닥불을 중심으로 아주 천천히 돕니다
      const a = t * 0.04 + 2.4;
      camera.position.set(Math.sin(a) * 10.5, FIRE_Y + 2.7 + Math.sin(t * 0.13) * 0.3, Math.cos(a) * 10.5);
      camera.lookAt(Math.cos(a) * 2.6, FIRE_Y + 1.3, -Math.sin(a) * 2.6);
    } else if (camMode === 'lie') {
      // 텐트 안에서는 머리 쪽(안쪽)에서 봅니다 — 발끝 자리에 카메라를 두면 문밖에 서 있는 것처럼 보임
      const hk = lieSpot && lieSpot.kind === 'tent' ? 1.3 : 0;
      camera.position.set(player.position.x - Math.sin(player.rotation.y) * hk, player.position.y + (hk ? 0.55 : 0.75), player.position.z - Math.cos(player.rotation.y) * hk);
      const p = Math.max(camPitch, 0.1);
      // 텐트 안에선 살짝 당겨 봅니다 — 문 너머 모닥불이 가깝고 크게
      const wfl = hk ? (window.innerWidth < window.innerHeight ? 44 : 28) : fovFor(camera.aspect);
      if (Math.abs(camera.fov - wfl) > 0.05) { camera.fov = lerp(camera.fov, wfl, Math.min(1, dt * 1.5)); camera.updateProjectionMatrix(); }
      camera.lookAt(camera.position.x - Math.sin(camYaw) * Math.cos(p), camera.position.y + Math.sin(p), camera.position.z - Math.cos(camYaw) * Math.cos(p));
    } else if (camMode === 'zen' && mySeat) {
      // 불멍 — 내 어깨 너머로 불을 바라봅니다. 아주 천천히 숨 쉬듯 움직임
      zen.t += dt;
      zen.lineT += dt;
      if (zen.lineT > 13) { zen.lineT = 0; showZenLine(); }
      const s = mySeat, L = Math.hypot(s.x, s.z) || 1;
      const ux = -s.x / L, uz = -s.z / L, sx = -uz, sz = ux;
      const want = tmpV.set(
        s.x + ux * 0.3 + sx * 0.6 + Math.sin(t * 0.11) * 0.05,
        player.position.y + 1.32 + Math.sin(t * 0.23) * 0.035,
        s.z + uz * 0.3 + sz * 0.6 + Math.cos(t * 0.09) * 0.05);
      camera.position.lerp(want, Math.min(1, dt * 1.2));
      zenLook.lerp(tmp.set(0, FIRE_Y + 0.85 + fire.level * 0.1, 0), Math.min(1, dt * 1.2));
      camera.lookAt(zenLook);
      const wf = window.innerWidth < window.innerHeight ? 58 : 40;
      if (Math.abs(camera.fov - wf) > 0.05) { camera.fov = lerp(camera.fov, wf, Math.min(1, dt * 0.8)); camera.updateProjectionMatrix(); }
    } else {
      const dir = new THREE.Vector3(Math.sin(camYaw) * Math.cos(camPitch), Math.sin(camPitch), Math.cos(camYaw) * Math.cos(camPitch));
      camRay.set(head, dir);
      camRay.far = camDist;
      const hit = camRay.intersectObjects(occluders, false)[0];
      if (hit) { camBlockD = camBlockT > 0 ? Math.min(camBlockD, hit.distance) : hit.distance; camBlockT = 0.8; }
      else if ((camBlockT -= dt) <= 0) camBlockD = Infinity;
      const wantDist = camBlockD < Infinity ? Math.max(0.8, camBlockD - 0.45) : camDist;
      camDistNow = lerp(camDistNow, wantDist, Math.min(1, dt * (wantDist < camDistNow ? 12 : 2.2)));
      const want = head.clone().addScaledVector(dir, camDistNow);
      want.y = Math.max(want.y, groundY(want.x, want.z) + 0.7);
      camera.position.lerp(want, Math.min(1, dt * 5));
      const pnl = $('#panel');
      const cover = pnl.classList.contains('show') ? Math.min(0.6, pnl.offsetHeight / window.innerHeight) : 0;
      const viewH = 2 * camDistNow * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      lookDrop = lerp(lookDrop, cover * viewH * 0.5, Math.min(1, dt * 3));
      camera.lookAt(head.x, head.y - 0.15 - lookDrop, head.z);
      const wf = fovFor(camera.aspect);
      if (Math.abs(camera.fov - wf) > 0.05) { camera.fov = lerp(camera.fov, wf, Math.min(1, dt * 2)); camera.updateProjectionMatrix(); }
    }
    // 불멍 화면은 불 바로 앞이라 눈부시지 않게 노출을 조금 낮춥니다
    renderer.toneMappingExposure = lerp(renderer.toneMappingExposure, camMode === 'zen' ? 0.9 : lieSpot && lieSpot.kind === 'tent' ? 0.85 : 1.2, Math.min(1, dt * 1.5));
    // 불멍 중엔 이웃 · 다른 사람 · 나 · 말풍선을 숨기고 모닥불만 남깁니다
    {
      const hide = camMode === 'zen';
      // 텐트 안에 누워 있을 때도 — 열린 문 너머로 모닥불 · 밤하늘만 (이웃 · 사람 · 꼬마전구 숨김)
      const inTent = !!(lieSpot && lieSpot.kind === 'tent');
      for (const n of npcs) n.av.visible = !(hide || inTent);
      for (const o of others.values()) o.av.visible = !(hide || inTent);
      for (const gobj of garlandObjs) gobj.visible = !inTent;
      if (inTent && hammock.decor) hammock.decor.visible = false;   // 해먹 랜턴 · 전구도 (텐트 문 너머 왼쪽에 보이던 불빛)
      if (hide) player.visible = false;
      for (const sg of seatGroups) sg.visible = !hide;          // 의자 · 통나무 벤치도 숨겨 모닥불만
    }
    camFill.position.copy(camera.position);
    camFill.intensity = camMode === 'follow' ? 1.4 : 0;
    updateAudio(dt);

    // ---------- 네트워크 (초당 4회까지, 움직였거나 상태가 바뀌었을 때만) ----------
    netTimer += dt;
    const movedEnough = Math.hypot(player.position.x - lastSentX, player.position.z - lastSentZ) > 0.08;
const sendGap = presentIds.length <= 4 ? 0.25 : presentIds.length <= 8 ? 0.4 : 0.6;   // 사람이 많을수록 덜 자주 (메시지 한도)
    if (netTimer > sendGap && (netDirty || movedEnough) && !introOn) {
      lastSentX = player.position.x;
      lastSentZ = player.position.z;
      netTimer = 0;
      netDirty = false;
      const u = player.userData;
      store.send('move', {
        id: me.id, name: me.name, color: me.look.color, look: me.look,
        x: +player.position.x.toFixed(2), z: +player.position.z.toFixed(2), ry: +player.rotation.y.toFixed(2),
        pose: u.pose, lift: +(u.pose === 'stand' ? 0 : seatOff).toFixed(2),
        g: guitarists.has(player) ? 1 : 0, rs: u.roasting ? 1 : 0, rl: +(u.roastLv || 0).toFixed(1), sp: u.sparkObj ? Math.round(u.sparkLeft) : 0,
      });
    }

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
