/*
 * 쉼터 3D — 메인 코드
 * 설정은 config.js 에서 바꾸세요. 이 파일은 수정하지 않아도 됩니다.
 * 파일을 더블클릭해서 열어도 동작하도록 일반 스크립트 + 동적 import 로 작성했습니다.
 */
(async () => {
  'use strict';

  const THREE = await import('https://unpkg.com/three@0.160.0/build/three.module.js');
  const C = window.SPACE_CONFIG;

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
  const me = {
    id: sessionStorage.getItem('shelter:id') || uid(),
    name: localStorage.getItem('shelter:name') || randomName(),
    color: localStorage.getItem('shelter:color') || COLORS[Math.floor(Math.random() * COLORS.length)],
  };
  sessionStorage.setItem('shelter:id', me.id);
  localStorage.setItem('shelter:name', me.name);
  localStorage.setItem('shelter:color', me.color);

  const params = new URLSearchParams(location.search);
  const room = (params.get('room') || 'main').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 30) || 'main';

  // ------------------------------------------------------------------
  // 저장소: 혼자 모드(localStorage) / 함께 모드(Supabase)
  // ------------------------------------------------------------------
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
        .select('value').eq('room', room).eq('name', name).maybeSingle();
      if (error) throw error;
      return Number(data?.value || 0);
    }
    async incCounter(name) {
      const { data, error } = await this.sb.rpc('shelter_increment', { p_room: room, p_name: name });
      if (error) throw error;
      return Number(data);
    }
    connect(h) {
      const ch = this.sb.channel(`shelter:${room}`, { config: { presence: { key: me.id }, broadcast: { self: false } } });
      ch.on('presence', { event: 'sync' }, () => h.onPresence(Object.keys(ch.presenceState())))
        .on('broadcast', { event: 'move' }, ({ payload }) => h.onMove(payload))
        .on('broadcast', { event: 'act' }, ({ payload }) => h.onAct(payload))
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
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  $('#app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(C.theme.fog, 55, 170);
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 600);

  const matCache = new Map();
  function mat(color, opts = {}) {
    const k = color + JSON.stringify(opts);
    if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, ...opts }));
    return matCache.get(k);
  }
  function mesh(geo, material, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    return m;
  }

  function makeLabel(text, { size = 44, color = '#fff', bg = 'rgba(20,22,44,.6)', scale = 1 } = {}) {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    const font = `700 ${size}px "Pretendard","Apple SD Gothic Neo","Malgun Gothic",sans-serif`;
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + size * 1.2;
    const h = Math.ceil(size * 1.7);
    c.width = w; c.height = h;
    ctx.font = font;
    ctx.fillStyle = bg;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(0, 0, w, h, h / 2); else ctx.rect(0, 0, w, h);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, fog: false }));
    sp.renderOrder = 10;
    const k = 0.012 * scale;
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

  function emojiSprite(emoji, size = 1) {
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const g = c.getContext('2d');
    g.font = '72px "Segoe UI Emoji","Apple Color Emoji",sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(emoji, 48, 54);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, fog: false }));
    sp.renderOrder = 11;
    sp.scale.set(size, size, 1);
    return sp;
  }

  // 하늘
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(400, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(C.theme.skyTop) }, bottom: { value: new THREE.Color(C.theme.skyBottom) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y * 2.2 + 0.08, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h, 0.7)), 1.0); }',
    }),
  );
  scene.add(sky);

  {
    const n = 900, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = rnd() * Math.PI * 2, ph = Math.acos(rnd() * 0.85 + 0.12), r = 330;
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.cos(ph);
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 })));
    const moon = mesh(new THREE.SphereGeometry(9, 24, 16), new THREE.MeshBasicMaterial({ color: 0xfff1d0, fog: false }), -120, 150, -220);
    scene.add(moon);
  }

  scene.add(new THREE.HemisphereLight(0x8fa0ff, 0x3b3a2a, 1.25));
  const moonLight = new THREE.DirectionalLight(0xffe2c4, 1.3);
  moonLight.position.set(-40, 70, -30);
  scene.add(moonLight);
  scene.add(new THREE.AmbientLight(0x404060, 0.6));

  // 땅 · 먼 산
  const groundMeshes = [];
  const ground = mesh(new THREE.CircleGeometry(90, 72), mat(C.theme.ground));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  groundMeshes.push(ground);
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2 + rnd() * 0.15, r = 125 + rnd() * 25, h = 18 + rnd() * 30;
    const m = mesh(new THREE.ConeGeometry(16 + rnd() * 14, h, 5), mat('#2c2c4e'), Math.cos(a) * r, h / 2 - 1, Math.sin(a) * r);
    m.rotation.y = rnd() * Math.PI;
    scene.add(m);
  }

  // 높이 (언덕 · 단상)
  const mounds = [], pads = [];
  function groundY(x, z) {
    let y = 0;
    for (const m of mounds) {
      const d = Math.hypot(x - m.x, z - m.z);
      if (d < m.r) y = Math.max(y, m.h * Math.sqrt(1 - (d / m.r) ** 2));
    }
    for (const p of pads) if (Math.hypot(x - p.x, z - p.z) < p.r) y = Math.max(y, p.h);
    return y;
  }

  // 공통 소품
  function pineTree(s = 1) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.6, 6), mat('#6b4a33'), 0, 0.8, 0));
    const layers = [[1.6, 2.2, 2.2], [1.25, 1.9, 3.3], [0.85, 1.6, 4.3]];
    layers.forEach(([r, h, y], i) => g.add(mesh(new THREE.ConeGeometry(r, h, 7), mat(i % 2 ? '#2f5d3a' : '#285233'), 0, y, 0)));
    g.scale.setScalar(s);
    return g;
  }
  function pineRadiusAt(y) {
    const layers = [[1.6, 2.2, 2.2], [1.25, 1.9, 3.3], [0.85, 1.6, 4.3]];
    let r = 0.25;
    for (const [cr, ch, cy] of layers) {
      const t = (y - (cy - ch / 2)) / ch;
      if (t >= 0 && t <= 1) r = Math.max(r, cr * (1 - t));
    }
    return r;
  }
  function bench() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(2.4, 0.12, 0.6), mat('#9a7350'), 0, 0.55, 0));
    g.add(mesh(new THREE.BoxGeometry(2.4, 0.5, 0.1), mat('#9a7350'), 0, 0.9, -0.27));
    for (const x of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.1, 0.55, 0.5), mat('#4a3a2e'), x, 0.27, 0));
    return g;
  }
  const lamps = [];
  function lamp(x, z, withLight) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.2, 6), mat('#2d2d3a'), 0, 1.6, 0));
    g.add(mesh(new THREE.SphereGeometry(0.28, 12, 8), new THREE.MeshBasicMaterial({ color: C.theme.accent }), 0, 3.3, 0));
    if (withLight) {
      const l = new THREE.PointLight(C.theme.accent, 18, 22, 1.2);
      l.position.set(0, 3.2, 0);
      g.add(l);
    }
    g.position.set(x, groundY(x, z), z);
    scene.add(g);
    lamps.push(g);
  }

  // ------------------------------------------------------------------
  // 장소 만들기
  // ------------------------------------------------------------------
  const clickables = [];
  const places = C.places.map((p) => ({ ...p, x: p.position[0], z: p.position[1], radius: p.radius || 12, state: {} }));

  // 광장
  {
    const plaza = mesh(new THREE.CircleGeometry(7, 40), mat(C.theme.path));
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.y = 0.02;
    scene.add(plaza);
    scene.add(mesh(new THREE.CylinderGeometry(2.2, 2.4, 0.6, 20), mat('#8c8aa0'), 0, 0.3, 0));
    const water = mesh(new THREE.CylinderGeometry(1.95, 1.95, 0.05, 20), new THREE.MeshStandardMaterial({ color: '#6fa8dc', emissive: '#284a7a', roughness: 0.2 }), 0, 0.58, 0);
    scene.add(water);
    const lb = makeLabel(C.title, { scale: 1.3 });
    lb.position.set(0, 3.2, 0);
    scene.add(lb);
    pads.push({ x: 0, z: 0, r: 2.3, h: 0 });
  }

  // 길 + 가로등
  places.forEach((p, i) => {
    const d = Math.hypot(p.x, p.z), a = Math.atan2(p.x, p.z);
    const path = mesh(new THREE.PlaneGeometry(3, d), mat(C.theme.path));
    path.rotation.x = -Math.PI / 2;
    path.rotation.z = a;
    path.position.set(p.x / 2, 0.015, p.z / 2);
    scene.add(path);
    const nx = Math.cos(a) * 2.4, nz = -Math.sin(a) * 2.4;
    lamp(p.x * 0.45 + nx, p.z * 0.45 + nz, i < 5);
  });

  const builders = {
    hill(p, g) {
      const r = 13, h = 4.2;
      const mound = mesh(new THREE.SphereGeometry(r, 30, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(C.theme.hill));
      mound.scale.y = h / r;
      g.add(mound);
      groundMeshes.push(mound);
      mounds.push({ x: p.x, z: p.z, r, h });
      const big = pineTree(1.7);
      big.position.y = h - 0.25;
      g.add(big);
      p.state.treeBase = new THREE.Vector3(p.x, h - 0.25, p.z);
      p.state.treeScale = 1.7;
      for (let i = 0; i < 9; i++) {
        const a = rnd() * Math.PI * 2, rr = 8 + rnd() * 6;
        const lx = Math.cos(a) * rr, lz = Math.sin(a) * rr;
        if (lz > 4 && Math.abs(lx) < 4) continue; // 길 쪽은 비워 둠
        const t = pineTree(0.7 + rnd() * 0.5);
        t.position.set(lx, Math.max(0, h * Math.sqrt(Math.max(0, 1 - (rr / r) ** 2))) - 0.1, lz);
        g.add(t);
      }
      const b = bench();
      b.position.set(3.2, h * Math.sqrt(1 - (3.6 / r) ** 2) - 0.1, 1.6);
      b.rotation.y = -0.5;
      g.add(b);
      p.state.notes = new THREE.Group();
      scene.add(p.state.notes);
      p.labelY = 14;
    },

    greenhouse(p, g) {
      const W = 12, D = 9, H = 4.2;
      const glass = new THREE.MeshStandardMaterial({ color: '#cfeffd', transparent: true, opacity: 0.16, roughness: 0.1, depthWrite: false, side: THREE.DoubleSide });
      g.add(mesh(new THREE.BoxGeometry(W, H, D), glass, 0, H / 2, 0));
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, D)), new THREE.LineBasicMaterial({ color: '#e8f6ff', transparent: true, opacity: 0.6 }));
      edges.position.y = H / 2;
      g.add(edges);
      const rise = 1.8, half = D / 2, slope = Math.hypot(half, rise), ang = Math.atan(rise / half);
      for (const s of [-1, 1]) {
        const roof = mesh(new THREE.PlaneGeometry(W, slope), glass, 0, H + rise / 2, s * half / 2);
        roof.rotation.x = -Math.PI / 2 + s * ang;
        g.add(roof);
      }
      for (const x of [-4, 4]) {
        g.add(mesh(new THREE.BoxGeometry(2.2, 0.9, 6), mat('#8a6a4c'), x, 0.45, 0));
        for (let k = 0; k < 4; k++) {
          g.add(mesh(new THREE.CylinderGeometry(0.3, 0.24, 0.4, 8), mat('#b5654a'), x + (k % 2 ? 0.5 : -0.5), 1.1, -2 + k * 1.3));
          g.add(mesh(new THREE.IcosahedronGeometry(0.38, 0), mat(k % 2 ? '#6fbf73' : '#89c97a'), x + (k % 2 ? 0.5 : -0.5), 1.55, -2 + k * 1.3));
        }
      }
      g.add(mesh(new THREE.CylinderGeometry(0.95, 0.72, 1, 12), mat('#b5654a'), 0, 0.5, 0));
      const plant = new THREE.Group();
      plant.add(mesh(new THREE.CylinderGeometry(0.07, 0.1, 2.2, 6), mat('#4f8a3c'), 0, 1.1, 0));
      for (let i = 0; i < 7; i++) {
        const a = i * 2.4, y = 0.6 + i * 0.25;
        const leaf = mesh(new THREE.SphereGeometry(0.42, 8, 6), mat(i % 2 ? '#6fbf73' : '#7fd17f'), Math.cos(a) * 0.45, y, Math.sin(a) * 0.45);
        leaf.scale.set(1, 0.35, 0.6);
        leaf.rotation.y = -a;
        plant.add(leaf);
      }
      const flowers = new THREE.Group();
      for (let i = 0; i < 6; i++) {
        const a = i * 1.05;
        flowers.add(mesh(new THREE.SphereGeometry(0.16, 8, 6), mat('#ff9fbf', { emissive: '#552030' }), Math.cos(a) * 0.4, 2.2 + (i % 2) * 0.15, Math.sin(a) * 0.4));
      }
      flowers.visible = false;
      plant.add(flowers);
      plant.position.y = 1;
      g.add(plant);
      p.state.plant = plant;
      p.state.flowers = flowers;
      p.labelY = 8.5;
    },

    cafe(p, g) {
      const bw = 10, bh = 4.5, bd = 7;
      g.add(mesh(new THREE.BoxGeometry(bw, bh, bd), mat('#d9c3a5'), 0, bh / 2, -2.5));
      const roof = mesh(new THREE.ConeGeometry(7.6, 2.2, 4), mat('#7a4b3a'), 0, bh + 1.1, -2.5);
      roof.rotation.y = Math.PI / 4;
      roof.scale.z = 0.72;
      g.add(roof);
      const win = mesh(new THREE.PlaneGeometry(5.2, 2.2), new THREE.MeshBasicMaterial({ color: '#ffd28a' }), -1.6, 2.2, 1.01);
      g.add(win);
      g.add(mesh(new THREE.BoxGeometry(5.5, 0.15, 0.2), mat('#5a3b2e'), -1.6, 1.05, 1.08));
      g.add(mesh(new THREE.PlaneGeometry(1.4, 2.6), mat('#6b4632'), 3.2, 1.3, 1.01));
      const awning = mesh(new THREE.BoxGeometry(bw + 0.6, 0.12, 2.4), mat('#c75b4a'), 0, 3.6, 2.1);
      awning.rotation.x = 0.28;
      g.add(awning);
      g.add(mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.08, 16), mat('#efe6da'), -1.6, 1.0, 3.4));
      g.add(mesh(new THREE.CylinderGeometry(0.08, 0.12, 1, 6), mat('#3a3a44'), -1.6, 0.5, 3.4));
      g.add(mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.22, 10), mat('#ffffff'), -1.45, 1.15, 3.3));
      for (const dx of [-1, 1]) {
        g.add(mesh(new THREE.BoxGeometry(0.6, 0.08, 0.6), mat('#9a7350'), -1.6 + dx * 1.15, 0.6, 3.4));
        g.add(mesh(new THREE.BoxGeometry(0.06, 0.6, 0.06), mat('#3a3a44'), -1.6 + dx * 1.15, 0.3, 3.4));
      }
      p.state.seatLocal = new THREE.Vector3(-1.6 + 1.15, 0, 3.4);
      p.state.windowLocal = new THREE.Vector3(-1.6, 2, 1);
      // 비
      const n = 700, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { pos[i * 3] = (rnd() - 0.5) * 26; pos[i * 3 + 1] = rnd() * 16; pos[i * 3 + 2] = (rnd() - 0.5) * 26; }
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const rain = new THREE.Points(rg, new THREE.PointsMaterial({ color: '#bcd4ff', size: 0.05, transparent: true, opacity: 0.6 }));
      rain.position.set(p.x, 0, p.z);
      rain.visible = false;
      scene.add(rain);
      p.state.rain = rain;
      p.labelY = 8.5;
    },

    music(p, g) {
      g.add(mesh(new THREE.CylinderGeometry(6, 6.2, 0.4, 24), mat('#b9b2c9'), 0, 0.2, 0));
      pads.push({ x: p.x, z: p.z, r: 6, h: 0.4 });
      for (const [x, z] of [[-4.2, -4.2], [4.2, -4.2], [-4.2, 4.2], [4.2, 4.2]]) g.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 4.6, 8), mat('#efe9f5'), x, 2.7, z));
      const roof = mesh(new THREE.ConeGeometry(8, 2.4, 4), mat('#5b4f7a'), 0, 6.2, 0);
      roof.rotation.y = Math.PI / 4;
      g.add(roof);
      const piano = new THREE.Group();
      piano.add(mesh(new THREE.BoxGeometry(3.4, 1, 1.4), mat('#24212c', { roughness: 0.4 }), 0, 1.3, 0));
      piano.add(mesh(new THREE.BoxGeometry(3.4, 1.4, 0.25), mat('#24212c', { roughness: 0.4 }), 0, 2.4, -0.58));
      for (const x of [-1.5, 1.5]) piano.add(mesh(new THREE.BoxGeometry(0.15, 0.8, 0.15), mat('#24212c'), x, 0.4, 0.4));
      const keys = [];
      for (let i = 0; i < 8; i++) {
        const k = mesh(new THREE.BoxGeometry(0.36, 0.1, 0.7), new THREE.MeshStandardMaterial({ color: '#f6f1e7', emissive: '#000000', roughness: 0.5 }), -1.33 + i * 0.38, 1.85, 0.55);
        k.userData = { kind: 'key', index: i };
        piano.add(k);
        keys.push(k);
        clickables.push(k);
      }
      piano.position.set(0, 0.4, -1);
      g.add(piano);
      const b = bench();
      b.scale.set(0.6, 0.85, 0.8);
      b.position.set(0, 0.4, 0.4);
      b.rotation.y = Math.PI;
      g.add(b);
      p.state.keys = keys;
      p.labelY = 9;
    },

    field(p, g) {
      const W = 34, D = 20;
      const turf = mesh(new THREE.PlaneGeometry(W, D), mat('#3f6b3b'));
      turf.rotation.x = -Math.PI / 2;
      turf.position.y = 0.03;
      g.add(turf);
      const lineMat = new THREE.MeshBasicMaterial({ color: '#e9efe6' });
      const line = (w, d, x, z) => { const l = mesh(new THREE.PlaneGeometry(w, d), lineMat, x, 0.05, z); l.rotation.x = -Math.PI / 2; g.add(l); };
      line(W, 0.15, 0, -D / 2); line(W, 0.15, 0, D / 2); line(0.15, D, -W / 2, 0); line(0.15, D, W / 2, 0); line(0.15, D, 0, 0);
      const ring = mesh(new THREE.RingGeometry(2.9, 3.05, 40), lineMat, 0, 0.05, 0);
      ring.rotation.x = -Math.PI / 2;
      g.add(ring);
      for (const s of [-1, 1]) {
        const goal = new THREE.Group();
        const gm = mat('#f2f2f2');
        goal.add(mesh(new THREE.BoxGeometry(0.12, 2, 0.12), gm, 0, 1, -2.5));
        goal.add(mesh(new THREE.BoxGeometry(0.12, 2, 0.12), gm, 0, 1, 2.5));
        goal.add(mesh(new THREE.BoxGeometry(0.12, 0.12, 5.1), gm, 0, 2, 0));
        goal.position.x = s * (W / 2 - 0.3);
        g.add(goal);
      }
      const blanket = mesh(new THREE.PlaneGeometry(2.4, 3.2), mat('#c98aa8'), 5, 0.06, 3);
      blanket.rotation.x = -Math.PI / 2;
      g.add(blanket);
      p.state.lieLocal = new THREE.Vector3(5, 0, 3);
      // 하늘을 도는 새
      const bird = new THREE.Group();
      const bm = new THREE.MeshBasicMaterial({ color: '#1d1b2e', side: THREE.DoubleSide, fog: false });
      const wingGeo = new THREE.BufferGeometry();
      wingGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, -0.5, 0, 0, 0.7, 2.6, 0, 0]), 3));
      const wl = new THREE.Mesh(wingGeo, bm), wr = new THREE.Mesh(wingGeo, bm);
      wr.scale.x = -1;
      bird.add(wl, wr, mesh(new THREE.ConeGeometry(0.25, 1.6, 5), bm));
      bird.children[2].rotation.x = Math.PI / 2;
      scene.add(bird);
      p.state.bird = { obj: bird, wl, wr };
      p.state.stars = new THREE.Group();
      scene.add(p.state.stars);
      p.labelY = 6;
    },
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
    const label = makeLabel(p.name, { scale: 1.1 });
    label.position.set(p.x, p.labelY || 7, p.z);
    scene.add(label);
    placeLabels.push(label);
  }
  const byType = (t) => places.filter((p) => p.type === t);

  // 카메라를 가리는 큰 물체 (나무 · 건물 · 기둥 · 지붕 · 가로등)
  const occluders = [];
  for (const root of [...places.map((p) => p.group), ...lamps]) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh || groundMeshes.includes(o) || o.material.transparent) return;
      o.geometry.computeBoundingBox();
      const s = new THREE.Vector3();
      o.getWorldScale(s);
      const bb = o.geometry.boundingBox;
      if ((bb.max.y - bb.min.y) * s.y > 1.5) occluders.push(o);
    });
  }

  // ------------------------------------------------------------------
  // 아바타
  // ------------------------------------------------------------------
  function makeAvatar(color, name) {
    const root = new THREE.Group();
    const inner = new THREE.Group();
    const c = new THREE.Color(color);
    inner.add(mesh(new THREE.CapsuleGeometry(0.4, 0.7, 4, 10), new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 }), 0, 0.75, 0));
    inner.add(mesh(new THREE.SphereGeometry(0.32, 16, 12), new THREE.MeshStandardMaterial({ color: c.clone().lerp(new THREE.Color('#ffffff'), 0.45), roughness: 0.7 }), 0, 1.72, 0));
    for (const x of [-0.11, 0.11]) inner.add(mesh(new THREE.SphereGeometry(0.04, 6, 6), new THREE.MeshBasicMaterial({ color: '#2a2238' }), x, 1.76, 0.29));
    root.add(inner);
    const label = makeLabel(name, { size: 34, scale: 0.75 });
    label.position.y = 2.55;
    root.add(label);
    root.userData = { inner, label, pose: 'stand', gesture: null };
    return root;
  }
  function animateAvatar(av, dt, moving) {
    const u = av.userData;
    let ty = 0, rx = 0;
    if (u.pose === 'sit') ty = -0.42;
    if (u.pose === 'lie') { ty = 0.42; rx = -Math.PI / 2; }
    if (moving) ty += Math.abs(Math.sin(performance.now() / 110)) * 0.08;
    if (u.gesture) {
      u.gesture.t += dt;
      const k = Math.sin(Math.min(1, u.gesture.t / 1.4) * Math.PI);
      if (u.gesture.type === 'bow') rx += 0.7 * k;
      if (u.gesture.type === 'wave') ty += Math.abs(Math.sin(u.gesture.t * 9)) * 0.25 * k;
      if (u.gesture.t > 1.4) u.gesture = null;
    }
    u.inner.position.y = lerp(u.inner.position.y, ty, Math.min(1, dt * 10));
    u.inner.rotation.x = lerp(u.inner.rotation.x, rx, Math.min(1, dt * 8));
    u.label.visible = u.pose !== 'lie';
  }

  const player = makeAvatar(me.color, me.name);
  player.position.set(0, 0, 10);
  scene.add(player);

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
    const a = i * 2.399963, yl = 1.5 + ((i * 0.618) % 1) * 3.1;
    const rl = pineRadiusAt(yl) + 0.14, s = hill.state.treeScale;
    const m = mesh(new THREE.PlaneGeometry(0.42, 0.56), new THREE.MeshStandardMaterial({ color: NOTE_COLORS[hashStr(String(item.id)) % NOTE_COLORS.length], side: THREE.DoubleSide, emissive: '#3a3020', roughness: 0.8 }));
    m.position.copy(hill.state.treeBase).add(new THREE.Vector3(Math.cos(a) * rl * s, yl * s, Math.sin(a) * rl * s));
    m.rotation.y = Math.PI / 2 - a;
    m.rotation.z = (rnd() - 0.5) * 0.4;
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
  function addStarMesh(item, fromPos) {
    const field = byType('field')[0];
    if (!field || seen.has('w' + item.id)) return;
    seen.add('w' + item.id);
    wishes.push(item);
    const r = seeded(hashStr(String(item.id) + item.text));
    const a = r() * Math.PI * 2, rad = 4 + r() * 26;
    const target = new THREE.Vector3(field.x + Math.cos(a) * rad, 26 + r() * 20, field.z + Math.sin(a) * rad);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#fff2c8', transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    sp.scale.setScalar(3.2);
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

  const counters = { water: 0, cheer: 0 };
  function applyCounter(name, value) {
    counters[name] = Math.max(counters[name], value);
    const gh = byType('greenhouse')[0];
    if (name === 'water' && gh) {
      const v = counters.water;
      gh.state.plant.userData.target = 0.6 + Math.min(1.8, Math.log10(1 + v) * 0.75);
      gh.state.flowers.visible = v >= 10;
    }
    refreshPanelInfo();
  }

  async function loadData() {
    try {
      const [ns, ws, cw, cc] = await Promise.all([store.list('note'), store.list('wish'), store.getCounter('water'), store.getCounter('cheer')]);
      ns.forEach((n) => addNoteMesh(n));
      ws.forEach((w) => addStarMesh(w));
      applyCounter('water', cw);
      applyCounter('cheer', cc);
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
  const SCALE = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];
  const KEY_NAMES = ['도', '레', '미', '솔', '라', '도', '레', '미'];
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
      const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
      const hp = actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 350;
      const g = actx.createGain(); g.gain.value = 0;
      g.gain.linearRampToValueAtTime(0.3, actx.currentTime + 1.5);
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

  // ------------------------------------------------------------------
  // 효과
  // ------------------------------------------------------------------
  const floaters = [];
  function floatEmoji(emoji, pos) {
    const s = emojiSprite(emoji, 0.9);
    s.position.copy(pos);
    scene.add(s);
    floaters.push({ s, t: 0, vx: (Math.random() - 0.5) * 0.4 });
  }
  const drops = [];
  function waterEffect() {
    const gh = byType('greenhouse')[0];
    if (!gh) return;
    for (let i = 0; i < 14; i++) {
      const d = mesh(new THREE.SphereGeometry(0.07, 6, 4), new THREE.MeshBasicMaterial({ color: '#8fd3ff' }), gh.x + (Math.random() - 0.5) * 1.2, 4.2 + Math.random(), gh.z + (Math.random() - 0.5) * 1.2);
      scene.add(d);
      drops.push({ d, v: 0 });
    }
  }
  function flashKey(i) {
    const mu = byType('music')[0];
    if (!mu) return;
    const k = mu.state.keys[i];
    k.material.emissive.set('#ffb860');
    k.position.y = 1.8;
    setTimeout(() => { k.material.emissive.set('#000000'); k.position.y = 1.85; }, 220);
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
  function setPose(pose) {
    player.userData.pose = pose;
    if (pose !== 'lie') camMode = 'follow';
    netDirty = true;
  }
  function gesture(type) {
    player.userData.gesture = { type, t: 0 };
    store.send('act', { id: me.id, type });
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
    setPose('sit');
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
  function stopBreath() {
    clearTimeout(breathTimer);
    $('#breath').classList.remove('show');
    $('#breath-circle').style.transform = 'scale(.6)';
  }

  async function bump(name) {
    try {
      const v = await store.incCounter(name);
      applyCounter(name, v);
      store.send('act', { id: me.id, type: 'counter', name, value: v });
    } catch (e) { console.warn(e); toast('저장하지 못했어요. 잠시 후 다시 시도해 주세요.'); }
  }

  function goTo(local, place) {
    const w = local.clone().applyMatrix4(place.group.matrixWorld);
    player.position.set(w.x, groundY(w.x, w.z), w.z);
    moveTarget = null;
  }

  let rainOn = false;
  const actions = {
    hill: (p) => [
      ['🧘 앉아서 숨 고르기', () => startBreath()],
      ['📝 쪽지 걸기', () => writeMessage('note')],
      ['📜 쪽지 하나 읽기', () => readRandom(notes, '📝', '아직 걸린 쪽지가 없어요. 첫 쪽지를 걸어 볼까요?')],
    ],
    greenhouse: () => [
      ['💧 물 주기', () => {
        if (!cool('water', 3000)) return;
        waterEffect();
        chime();
        bump('water');
        store.send('act', { id: me.id, type: 'water' });
      }],
    ],
    cafe: (p) => [
      ['🪟 창가에 앉기', () => {
        goTo(p.state.seatLocal, p);
        setPose('sit');
        const wpos = p.state.windowLocal.clone().applyMatrix4(p.group.matrixWorld);
        const dx = wpos.x - player.position.x, dz = wpos.z - player.position.z;
        player.rotation.y = Math.atan2(dx, dz);
        camYaw = Math.atan2(-dx, -dz);
        camPitch = 0.18;
        camDist = 5;
        if (!rainOn) toggleRain(p);
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
    music: () => [],
    field: (p) => [
      ['🌌 누워서 별 보기', () => {
        goTo(p.state.lieLocal, p);
        setPose('lie');
        camMode = 'lie';
        camPitch = 1.05;
        toast('드래그해서 하늘을 둘러보세요. 움직이면 일어나요.', 3500);
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
    tone(SCALE[i], remote ? 0.12 : 0.25);
    flashKey(i);
    if (!remote) store.send('act', { id: me.id, type: 'note', key: i });
  }

  // ------------------------------------------------------------------
  // 패널
  // ------------------------------------------------------------------
  let currentPlace = null;
  function infoText(p) {
    if (!p) return '';
    if (p.type === 'greenhouse') {
      const v = counters.water;
      const stage = v >= 100 ? '활짝 핀 꽃' : v >= 10 ? '꽃이 피었어요' : v >= 3 ? '새잎이 났어요' : '새싹';
      return `모두가 준 물 ${v}번 · 지금은 "${stage}"`;
    }
    if (p.type === 'cafe') return `지금까지 오간 "수고했어" ${counters.cheer}번`;
    if (p.type === 'hill') return `소나무에 걸린 쪽지 ${notes.length}장`;
    if (p.type === 'field') return `하늘에 뜬 소원 별 ${wishes.length}개`;
    if (p.type === 'music') return '숫자키 1~8 로도 칠 수 있어요';
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
    if (!p) { panel.classList.remove('show'); return; }
    panel.replaceChildren(el('h3', { textContent: p.name }), el('p', { textContent: p.desc }), el('div', { className: 'info', textContent: infoText(p) }));
    const row = el('div', { className: 'actions' });
    for (const [label, fn] of (actions[p.type] || (() => []))(p)) row.append(el('button', { type: 'button', textContent: label, onclick: fn }));
    if (row.children.length) panel.append(row);
    if (p.type === 'music') {
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
      $('#people').textContent = n <= 1 ? '지금은 나 혼자 쉬는 중' : `지금 ${n}명이 함께 쉬고 있어요`;
      for (const [id, o] of others) if (!ids.includes(id)) { scene.remove(o.av); others.delete(id); }
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
        o = { av: makeAvatar(color, name), tx: m.x, tz: m.z, ry: m.ry };
        o.av.position.set(m.x, groundY(m.x, m.z), m.z);
        scene.add(o.av);
        others.set(m.id, o);
      }
      o.tx = Number(m.x) || 0;
      o.tz = Number(m.z) || 0;
      o.ry = Number(m.ry) || 0;
      o.av.userData.pose = ['stand', 'sit', 'lie'].includes(m.pose) ? m.pose : 'stand';
    },
    onAct(a) {
      if (!a || a.id === me.id) return;
      const o = others.get(a.id);
      if ((a.type === 'bow' || a.type === 'wave') && o) o.av.userData.gesture = { type: a.type, t: 0 };
      if (a.type === 'note' && Number.isInteger(a.key) && a.key >= 0 && a.key < 8) playKey(a.key, true);
      if (a.type === 'cheer' && o) floatEmoji('💛', o.av.position.clone().add(new THREE.Vector3(0, 2.8, 0)));
      if (a.type === 'water') waterEffect();
      if (a.type === 'counter' && (a.name === 'water' || a.name === 'cheer')) applyCounter(a.name, Number(a.value) || 0);
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
  let camYaw = 0, camPitch = 0.38, camDist = 10;
  const keys = {};
  const typing = () => document.activeElement && document.activeElement.tagName === 'INPUT';
  window.addEventListener('keydown', (e) => {
    if (typing()) return;
    keys[e.code] = true;
    if (currentPlace && currentPlace.type === 'music' && /^Digit[1-8]$/.test(e.code)) playKey(Number(e.code.slice(5)) - 1);
    if (e.code === 'Escape') { stopBreath(); $('#help').classList.remove('show'); }
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  const canvas = renderer.domElement;
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, moved: 0 };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.x = e.clientX;
    drag.y = e.clientY;
    camYaw -= dx * 0.006;
    camPitch = clamp(camPitch + dy * 0.004, camMode === 'lie' ? 0.5 : 0.05, camMode === 'lie' ? 1.45 : 1.25);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (drag && drag.moved < 8) handleClick(e);
    drag = null;
  });
  canvas.addEventListener('wheel', (e) => { camDist = clamp(camDist + e.deltaY * 0.01, 4, 22); }, { passive: true });

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
      if (player.userData.pose !== 'stand') setPose('stand');
      stopBreath();
    }
  }

  $('#g-wave').onclick = () => gesture('wave');
  $('#g-bow').onclick = () => { if (player.userData.pose === 'stand') gesture('bow'); else toast('일어선 뒤에 인사할 수 있어요', 1500); };
  $('#btn-help').onclick = () => $('#help').classList.add('show');
  $('#help-close').onclick = () => $('#help').classList.remove('show');
  $('#breath-close').onclick = () => stopBreath();
  $('#btn-sound').onclick = () => {
    ensureAudio();
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.8;
    $('#btn-sound').textContent = muted ? '🔇 소리 꺼짐' : '🔊 소리 켜짐';
  };
  $('#myname').textContent = me.name;
  $('#rename').onclick = () => {
    me.name = randomName();
    localStorage.setItem('shelter:name', me.name);
    $('#myname').textContent = me.name;
    const old = player.userData.label;
    const nl = makeLabel(me.name, { size: 34, scale: 0.75 });
    nl.position.copy(old.position);
    player.remove(old);
    player.add(nl);
    player.userData.label = nl;
    netDirty = true;
  };
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
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
  await loadData();
  const enterBtn = $('#enter');
  enterBtn.disabled = false;
  enterBtn.textContent = '들어가기';
  enterBtn.onclick = () => {
    ensureAudio();
    if (actx && actx.state === 'suspended') actx.resume();
    $('#intro').classList.remove('show');
    store.connect(handlers);
    netDirty = true;
  };

  // ------------------------------------------------------------------
  // 루프
  // ------------------------------------------------------------------
  const clock = new THREE.Clock();
  let netDirty = true, netTimer = 0;
  const tmp = new THREE.Vector3();
  const camRay = new THREE.Raycaster();
  function tick() {
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;

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
      if (Math.hypot(vx, vz) < 0.3) { moveTarget = null; vx = vz = 0; }
    }
    const len = Math.hypot(vx, vz);
    const moving = len > 0.001;
    if (moving) {
      if (player.userData.pose !== 'stand') setPose('stand');
      stopBreath();
      const sp = 7 * dt;
      player.position.x += (vx / len) * sp;
      player.position.z += (vz / len) * sp;
      const r = Math.hypot(player.position.x, player.position.z);
      if (r > 80) { player.position.x *= 80 / r; player.position.z *= 80 / r; }
      player.rotation.y = Math.atan2(vx, vz);
      // 클릭 · 길 찾기로 이동할 때는 카메라가 천천히 등 뒤로 돌아감
      if (moveTarget && !drag) {
        let d = Math.atan2(-vx, -vz) - camYaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        camYaw += d * Math.min(1, dt * 2.5);
      }
      netDirty = true;
    }
    player.position.y = lerp(player.position.y, groundY(player.position.x, player.position.z), Math.min(1, dt * 12));
    animateAvatar(player, dt, moving);
    player.visible = camMode !== 'lie';
    player.userData.label.visible = player.userData.pose === 'stand' && camera.position.distanceTo(player.position) > 6.5;
    for (const l of placeLabels) l.visible = camMode !== 'lie';

    // 다른 사람들
    for (const o of others.values()) {
      const px = o.av.position.x, pz = o.av.position.z;
      o.av.position.x = lerp(px, o.tx, Math.min(1, dt * 8));
      o.av.position.z = lerp(pz, o.tz, Math.min(1, dt * 8));
      o.av.position.y = groundY(o.av.position.x, o.av.position.z);
      o.av.rotation.y = o.ry;
      animateAvatar(o.av, dt, Math.hypot(o.tx - px, o.tz - pz) > 0.05);
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
        const b = p.state.bird, a = t * 0.18;
        b.obj.position.set(p.x + Math.cos(a) * 20, 24 + Math.sin(t * 0.5) * 1.5, p.z + Math.sin(a) * 20);
        b.obj.rotation.y = -a;
        const f = Math.sin(t * 3) * 0.45;
        b.wl.rotation.z = f;
        b.wr.rotation.z = -f;
        for (const s of p.state.stars.children) {
          const k = 3 + Math.sin(t * 1.5 + s.userData.phase) * 0.5;
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
      f.s.position.y += dt * 1.2;
      f.s.position.x += f.vx * dt;
      f.s.material.opacity = 1 - f.t / 2;
      if (f.t > 2) { scene.remove(f.s); floaters.splice(i, 1); }
    }
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.v += 12 * dt;
      d.d.position.y -= d.v * dt;
      if (d.d.position.y < 1.2) { scene.remove(d.d); drops.splice(i, 1); }
    }

    // 카메라
    const head = tmp.set(player.position.x, player.position.y + 1.4, player.position.z);
    if (camMode === 'lie') {
      camera.position.set(player.position.x, player.position.y + 0.7, player.position.z);
      const p = Math.max(camPitch, 0.5);
      camera.lookAt(camera.position.x - Math.sin(camYaw) * Math.cos(p), camera.position.y + Math.sin(p), camera.position.z - Math.cos(camYaw) * Math.cos(p));
    } else {
      const dir = new THREE.Vector3(Math.sin(camYaw) * Math.cos(camPitch), Math.sin(camPitch), Math.cos(camYaw) * Math.cos(camPitch));
      let dist = camDist;
      camRay.set(head, dir);
      camRay.far = camDist;
      const block = camRay.intersectObjects(occluders, false)[0];
      if (block) dist = Math.max(1.2, block.distance - 0.4);
      const want = head.clone().addScaledVector(dir, dist);
      want.y = Math.max(want.y, groundY(want.x, want.z) + 0.6);
      camera.position.lerp(want, Math.min(1, dt * (block ? 12 : 6)));
      camera.lookAt(head);
    }

    // 네트워크 (약 6회/초)
    netTimer += dt;
    if (netDirty && netTimer > 0.16) {
      netTimer = 0;
      netDirty = false;
      store.send('move', {
        id: me.id, name: me.name, color: me.color,
        x: +player.position.x.toFixed(2), z: +player.position.z.toFixed(2), ry: +player.rotation.y.toFixed(2),
        pose: player.userData.pose,
      });
    }

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  tick();
})().catch((e) => {
  console.error(e);
  const b = document.getElementById('enter');
  if (b) b.textContent = '불러오지 못했어요 (인터넷 연결 확인)';
});
