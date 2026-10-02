// World checks: loads the game in a tiny headless window and tests the world's logic through window.__game.
// Usage: PW=/path/to/node_modules/playwright node tools/check.cjs [check ...]
//   checks: reach warren night chaos eat treats saves memory (default: all). URL defaults to the local dev site.
// Prints a report and exits 1 if anything failed.
const { chromium } = require(process.env.PW || 'playwright');
const URL = process.env.URL || 'https://wheek.localhost/';
const want = process.argv.slice(2);
const pick = n => !want.length || want.includes(n);
let failed = 0;
const report = (name, ok, detail) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`); };

// ---- runs in the page: a walkability grid of the active zone using the game's own collision rules
const GRID = `
function grid(g){const Z=g.Z(),E=g.EDGE,res=.2,O=72,N=Math.ceil(2*O/res),B=new Uint8Array(N*N),cx=i=>-O+(i+.5)*res,pr=.1;
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){const x=cx(i),z=cx(j);if(Math.hypot(x,z)>E-.05||(Z.waterY!==undefined&&Z.waterY-g.heightAt(x,z)>.07))B[j*N+i]=1}
  const mark=(x0,x1,z0,z1,t)=>{for(let j=Math.max(0,Math.floor((z0+O)/res));j<=Math.min(N-1,Math.floor((z1+O)/res));j++)for(let i=Math.max(0,Math.floor((x0+O)/res));i<=Math.min(N-1,Math.floor((x1+O)/res));i++)if(t(cx(i),cx(j)))B[j*N+i]=1};
  for(const c of Z.colliders){const r=c.r+pr;mark(c.x-r,c.x+r,c.z-r,c.z+r,(x,z)=>Math.hypot(x-c.x,z-c.z)<r)}
  for(const b of Z.boxes)mark(b.cx-b.hx-pr,b.cx+b.hx+pr,b.cz-b.hz-pr,b.cz+b.hz+pr,()=>true);
  for(const l of Z.logs){const c=Math.cos(l.rot),s=Math.sin(l.rot);mark(l.x-1,l.x+1,l.z-1,l.z+1,(x,z)=>{const dx=x-l.x,dz=z-l.z,al=dx*s+dz*c,lat=dx*c-dz*s;return Math.abs(al)<.86&&Math.abs(lat)>.13&&Math.abs(lat)<.33})}
  return {B,N,res,O,cx}}
function flood(R,x,z){if(!Number.isFinite(x)||!Number.isFinite(z))return null;const {B,N,res,O}=R,seen=new Uint8Array(N*N),s=Math.floor((z+O)/res)*N+Math.floor((x+O)/res);if(B[s])return null;const q=[s];seen[s]=1;
  while(q.length){const k=q.pop(),i=k%N,j=(k-i)/N;for(const [a,b] of [[i+1,j],[i-1,j],[i,j+1],[i,j-1]]){if(a<0||b<0||a>=N||b>=N)continue;const n=b*N+a;if(!seen[n]&&!B[n]){seen[n]=1;q.push(n)}}}return seen}
function near(R,seen,x,z,rad){const {N,res,O,cx}=R;for(let j=Math.max(0,Math.floor((z-rad+O)/res));j<=Math.min(N-1,Math.floor((z+rad+O)/res));j++)for(let i=Math.max(0,Math.floor((x-rad+O)/res));i<=Math.min(N-1,Math.floor((x+rad+O)/res));i++)if(seen[j*N+i]&&Math.hypot(cx(i)-x,cx(j)-z)<=rad)return true;return false}
`;
const frames = (page, n) => page.evaluate(n => new Promise(r => { let k = 0; (function f() { if (++k >= n) r(); else requestAnimationFrame(f) })() }), n);

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
  const page = await browser.newPage({ viewport: { width: 200, height: 130 }, ignoreHTTPSErrors: true });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', e => errors.push('PAGE ' + e.message));
  const start = async () => {
    await page.waitForFunction(() => !document.getElementById('slots').classList.contains('hidden'), null, { timeout: 180000 });
    await page.evaluate(() => { try { for (let i = 1; i <= 3; i++) localStorage.removeItem('wheek-slot-' + i) } catch (e) { } });
    await page.evaluate(() => { document.querySelector('#slots .new').click(); document.getElementById('goBtn').click() });
    await page.waitForFunction(() => window.__game && window.__game.G.started, null, { timeout: 60000 });
  };
  await page.goto(URL); await start();
  const zones = await page.evaluate(() => Object.keys(window.__game.ZONE));

  // 1. every exit, burrow, forage spot, plant, human and animal can be reached from wherever you walk in
  if (pick('reach')) for (const id of zones) {
    const r = await page.evaluate(`(()=>{${GRID};const g=window.__game;g.visit('${id}',0,0,0);const Z=g.Z(),E=g.EDGE;
      const arr=[];for(let s=0;s<8;s++){if(!g.neighbour(Z,s))continue;const a=s*Math.PI/4;let p=null;for(let r=E-2.5;r>6;r-=.5){const x=Math.cos(a)*r,z=Math.sin(a)*r;if(g.freeAt(x,z,.3)){p={s,x,z};break}}arr.push(p||{s,x:NaN,z:NaN})}
      const R=grid(g),seen=arr.length&&flood(R,arr[0].x,arr[0].z),out={arrivals:arr.length,bad:[]};
      if(!seen){out.bad.push('arrival '+arr[0].s+' is blocked');return out}
      const chk=(what,x,z,rad)=>{if(!near(R,seen,x,z,rad))out.bad.push(what+' @'+x.toFixed(1)+','+z.toFixed(1))};
      for(const p of arr)chk('arrival from sector '+p.s,p.x,p.z,.3);
      for(const t of Z.tunnels)chk('burrow '+t.name,t.ex,t.ez,.4);
      for(const s of Z.spots)chk(s.type+' spot',s.x,s.z,s.r+.25);
      for(const ps of Z.pickSets)for(const it of ps.items)if(it.respawn!==Infinity)chk(ps.type,it.x,it.z,.35);
      for(const h of Z.humans)chk('human '+h.name,h.obj.position.x,h.obj.position.z,.85);
      const pigs=g.friends.filter(f=>f.origin===Z.id&&f.state==='wild');for(const f of pigs)chk('guinea pig '+f.name,f.home.x,f.home.z,.6);
      for(const c of Z.critters)if(c.kind==='Duck')chk('duck pond',c.area.x,c.area.z,c.area.r+2.4);else chk(c.kind,c.x,c.z,1.4);
      out.counts=[Z.tunnels.length,Z.spots.length,Z.pickSets.reduce((n,p)=>n+p.items.length,0),Z.humans.length,Z.critters.length,pigs.length].join('/');return out})()`);
    report(`reach ${id}`, !r.bad.length, `${r.arrivals} ways in · burrows/spots/plants/humans/animals/piggies ${r.counts}${r.bad.length ? ' · ' + r.bad.length + ' unreachable: ' + r.bad.slice(0, 6).join('; ') : ''}`);
    // placement: nothing to eat, enter or pet stands in water, and animals are where they belong
    const p = await page.evaluate(() => { const g = window.__game, Z = g.Z(), bad = [], wet = (x, z) => Z.waterY !== undefined && g.heightAt(x, z) < Z.waterY;
      for (const t of Z.tunnels) if (wet(t.ex, t.ez)) bad.push('burrow in water ' + t.name);
      for (const s of Z.spots) if (s.type === 'cress' ? Z.waterY - g.heightAt(s.x, s.z) > .07 : wet(s.x, s.z)) bad.push(s.type + (s.type === 'cress' ? ' too deep to wade to' : ' spot in water'));
      const sig = { peaks: 'drift', deepwood: 'bramble', town: 'stall', beach: 'picnic', creek: 'cress', zoo: 'trough', farm: 'apples', sunflowers: 'seedhead' }[Z.id];
      if (sig && Z.spots.filter(s => s.type === sig).length < 3) bad.push('only ' + Z.spots.filter(s => s.type === sig).length + ' ' + sig + ' spots');
      for (const ps of Z.pickSets) for (const it of ps.items) if (wet(it.x, it.z)) bad.push(ps.type + ' in water');
      for (const h of Z.humans) if (wet(h.x, h.z)) bad.push('human in water ' + h.name);
      const pigs = g.friends.filter(f => f.origin === Z.id); if (!pigs.length) bad.push('no guinea pigs live here');
      for (const f of pigs) if (f.state === 'wild' && (wet(f.home.x, f.home.z) || !g.freeAt(f.home.x, f.home.z, .1))) bad.push('guinea pig ' + f.name + ' lives in water or a wall');
      for (const c of Z.critters) { const swim = c.kind === 'Duck'; if (swim && !(Z.waterY - g.heightAt(c.x, c.z) > .05)) bad.push('duck on land'); if (!swim && wet(c.x, c.z)) bad.push(c.kind + ' in water') }
      return bad });
    report(`placement ${id}`, !p.length, p.slice(0, 5).join('; '));
  }

  // 2. the warren: every den, curio and treat can be reached from where you crawl in
  if (pick('warren')) {
    const r = await page.evaluate(() => { const g = window.__game, W = g.W; g.visit('park', 0, 0, 0); g.enterWarren(g.PARK.tunnels[0], true);
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const n of W.nodes) { x0 = Math.min(x0, n.x - 3); x1 = Math.max(x1, n.x + 3); z0 = Math.min(z0, n.z - 3); z1 = Math.max(z1, n.z + 3) }
      const res = .08, NX = Math.ceil((x1 - x0) / res), NZ = Math.ceil((z1 - z0) / res), B = new Uint8Array(NX * NZ);
      for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) B[j * NX + i] = g.wSdf(x0 + (i + .5) * res, .12, z0 + (j + .5) * res) < -.1 ? 0 : 1;
      const ci = (x, z) => Math.floor((z - z0) / res) * NX + Math.floor((x - x0) / res), seen = new Uint8Array(NX * NZ), s = ci(g.pig.pos.x, g.pig.pos.z), bad = [];
      if (B[s]) return { bad: ['entry point is inside the wall'] };
      const q = [s]; seen[s] = 1; while (q.length) { const k = q.pop(), i = k % NX, j = (k - i) / NX; for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) { if (a < 0 || b < 0 || a >= NX || b >= NZ) continue; const n = b * NX + a; if (!seen[n] && !B[n]) { seen[n] = 1; q.push(n) } } }
      const nr = (x, z, rad) => { for (let j = Math.floor((z - rad - z0) / res); j <= Math.floor((z + rad - z0) / res); j++) for (let i = Math.floor((x - rad - x0) / res); i <= Math.floor((x + rad - x0) / res); i++) if (i >= 0 && j >= 0 && i < NX && j < NZ && seen[j * NX + i] && Math.hypot(x0 + (i + .5) * res - x, z0 + (j + .5) * res - z) <= rad) return true; return false };
      for (const n of W.nodes) if (!nr(n.x, n.z, n.kind === 'den' ? .5 : n.r)) bad.push(n.kind + ' ' + n.name);
      for (const c of W.curios) if (!nr(c.x, c.z, .42)) bad.push('curio ' + c.k);
      for (const f of W.foods) if (!nr(f.x, f.z, .4)) bad.push('food ' + f.type);
      g.exitWarren(g.PARK.tunnels[0].node);
      return { bad, n: [W.nodes.length, W.curios.length, W.foods.length].join('/') } });
    report('warren', !r.bad.length, `chambers/curios/treats ${r.n}${r.bad.length ? ' · unreachable: ' + r.bad.join('; ') : ''}`);
  }

  // 3. night in every zone: foxes come out, lamps light up, the hawk circles; nothing goes NaN
  if (pick('night')) for (const id of zones) {
    await page.evaluate(id => { const g = window.__game; g.G.time = 21.5; g.visit(id, 0, 0, 0); g.G.day = 3; g.hawk.state = 'away'; g.hawk.t = 0.01 }, id);
    await frames(page, 40);
    const r = await page.evaluate(() => { const g = window.__game, Z = g.Z(), ok = v => Number.isFinite(v);
      return { foxes: g.foxes.filter(f => f.active).length, finite: ok(g.pig.pos.x) && ok(g.pig.pos.y) && ok(g.G.hp) && g.foxes.every(f => !f.active || ok(f.pos.x) && ok(f.pos.z)), lamps: Z.lamps.filter(m => m.glow ? m.glow.opacity > 0 : m.emissiveIntensity > 0).length, nLamps: Z.lamps.length, humansIn: Z.humans.every(h => !h.visible) } });
    report(`night ${id}`, r.finite && r.foxes > 0 && r.lamps === r.nLamps && r.humansIn, `${r.foxes} foxes out · ${r.lamps}/${r.nLamps} lights on · humans inside: ${r.humansIn}${r.finite ? '' : ' · NaN!'}`);
    await page.evaluate(() => { window.__game.G.time = 11; window.__game.G.hp = 100 });
  }

  // 4. random mashing in every zone (and down in the warren): no errors, nothing becomes NaN
  if (pick('chaos')) for (const id of [...zones, 'warren']) {
    await page.evaluate(id => { const g = window.__game; if (id === 'warren') { g.visit('park', 0, 0, 0); g.enterWarren(g.PARK.tunnels[0], true) } else g.visit(id, 0, 0, 0); g.G.hp = 100; g.G.energy = 100 }, id);
    const before = errors.length;
    for (let k = 0; k < 12; k++) {
      const keys = ['KeyW', 'KeyA', 'KeyD', 'KeyS', 'ShiftLeft'].filter(() => Math.random() < .5);
      for (const kk of keys) await page.keyboard.down(kk);
      const tap = ['Space', 'KeyE', 'KeyR', 'KeyQ', 'KeyF'][Math.floor(Math.random() * 5)]; await page.keyboard.press(tap);
      await frames(page, 6);
      for (const kk of keys) await page.keyboard.up(kk);
    }
    const r = await page.evaluate(() => { const g = window.__game, ok = v => Number.isFinite(v); document.querySelectorAll('.overlay:not(.hidden)').forEach(o => { if (o.id === 'tunnelMenu') document.querySelector('#tmList .btn.alt:last-child')?.click() });
      const out = { finite: ok(g.pig.pos.x) && ok(g.pig.pos.y) && ok(g.pig.pos.z) && ok(g.G.hp) && ok(g.G.score), zone: g.G.under ? 'warren' : g.Z().id }; if (g.G.under) g.exitWarren(g.W.from.node); g.G.modal = false; g.G.paused = false; return out });
    report(`chaos ${id}`, r.finite && errors.length === before, `${r.finite ? '' : 'NaN! '}${errors.slice(before).join(' | ')}`);
  }

  // 5. eating a plant and foraging a spot actually work (they update instanced sets in place)
  if (pick('eat')) for (const id of ['park', 'farm']) {
    const setup = await page.evaluate(id => { const g = window.__game; g.G.time = 11; g.visit(id, 0, 0, 0); const Z = g.Z(), ps = Z.pickSets.find(p => p.items.some(i => i.alive)), it = ps.items.find(i => i.alive && g.freeAt(i.x - .15, i.z, .12));
      window.__eat = { ps: Z.pickSets.indexOf(ps), i: ps.items.indexOf(it), eaten: g.G.eaten }; g.pig.pos.set(it.x - .15, g.heightAt(it.x - .15, it.z), it.z); g.pig.heading = Math.PI / 2; return ps.type }, id);
    await page.waitForFunction(() => { const g = window.__game, e = window.__eat, it = g.Z().pickSets[e.ps].items[e.i]; g.pig.pos.set(it.x - .15, g.heightAt(it.x - .15, it.z), it.z); g.pig.heading = Math.PI / 2; return (g.G.acts || []).some(a => a.label.startsWith('Eat')) }, null, { timeout: 60000, polling: 200 });
    await page.keyboard.press('KeyE'); await frames(page, 4);
    const ate = await page.evaluate(() => { const g = window.__game, e = window.__eat, it = g.Z().pickSets[e.ps].items[e.i]; return !it.alive && g.G.eaten > e.eaten });
    const spot = await page.evaluate(() => { const g = window.__game, Z = g.Z(), s = Z.spots.find(s => s.ready && g.freeAt(s.x + s.r + .1, s.z, .12)); window.__spot = Z.spots.indexOf(s); g.pig.pos.set(s.x + s.r + .1, g.heightAt(s.x + s.r + .1, s.z), s.z); g.G.forages0 = g.G.forages; return s.type });
    await page.keyboard.down('KeyF');
    const foraged = await page.waitForFunction(() => { const g = window.__game, s = g.Z().spots[window.__spot]; if (s.ready) { g.pig.pos.set(s.x + s.r + .1, g.heightAt(s.x + s.r + .1, s.z), s.z); window.__game.keys.KeyF = true; const a = (g.G.acts || []).find(a => a.k === 'F' && a.spot); if (a && !document.getElementById('forage').style.display.includes('block')) document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' })) } return !s.ready }, null, { timeout: 120000, polling: 250 }).then(() => true, () => false);
    await page.keyboard.up('KeyF');
    report(`eat & forage ${id}`, ate && foraged, `ate a ${setup}: ${ate} · foraged a ${spot}: ${foraged}`);
  }

  // 5b. every zone's signature treat: reveal it at one of its spots and eat it (the model loads, the journal counts it);
  //     then wade in and forage a watercress bed for real
  if (pick('treats')) {
    const r = await page.evaluate(async () => { const g = window.__game, out = [];
      for (const [type, it] of Object.entries(g.ITEMS)) { if (!it.zone) continue; g.visit(it.zone, 0, 0, 0); const n0 = g.G.found[type] || 0, s = g.Z().spots.find(s => s.ready);
        g.revealItem(type, s); const t0 = performance.now(); while (!((g.G.found[type] || 0) > n0) && performance.now() - t0 < 60000) await new Promise(r => setTimeout(r, 100));
        if (!((g.G.found[type] || 0) > n0)) out.push(type) }
      return out });
    report('signature treats', !r.length, r.length ? 'never eaten: ' + r.join(', ') : '8 zones');
    await page.evaluate(() => { const g = window.__game; g.G.time = 11; g.visit('creek', 0, 0, 0); const s = g.Z().spots.find(s => s.type === 'cress'); window.__cress = g.Z().spots.indexOf(s); g.G.forages0 = g.G.forages; g.pig.pos.set(s.x, g.heightAt(s.x, s.z), s.z) });
    await page.keyboard.down('KeyF');
    const ok = await page.waitForFunction(() => { const g = window.__game, s = g.Z().spots[window.__cress]; if (s.ready) { g.pig.pos.set(s.x, g.heightAt(s.x, s.z), s.z); if (!document.getElementById('forage').style.display.includes('block')) document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' })) } return !s.ready && g.G.wade !== undefined }, null, { timeout: 120000, polling: 250 }).then(() => true, () => false);
    await page.keyboard.up('KeyF');
    report('wade & forage watercress', ok, ok ? '' : 'the cress bed never got foraged');
  }

  // 6. saves: continue a game saved before zones existed, and one saved in a zone
  if (pick('saves')) {
    await page.evaluate(() => { const g = window.__game, names = g.friends.map(f => f.name);
      localStorage.setItem('wheek-slot-3', JSON.stringify({ v: 1, saved: Date.now() - 3600e3, name: 'Oldie', breed: 'peruvian', coat: 'golden', G: { hp: 90, full: 70, vitc: 60, energy: 80, happy: 60, score: 1234, day: 2, time: 10, forages: 5, pets: 3, found: { clover: 2 }, curios: {}, nightsSurvived: 1, eaten: 4, luckT: 0 },
        pig: { x: 3, z: 2, h: 1 }, under: -1, tunnels: [0, 3], herd: [2], known: [2, 4], names, warren: { edges: [], seen: [], heard: [], got: [], routes: 0 } }));
      localStorage.setItem('wheek-slot-2', JSON.stringify({ ...JSON.parse(localStorage.getItem('wheek-slot-3')), name: 'Zoey', zone: 'beach', pig: { x: -20, z: -10, h: 0 }, G: { ...JSON.parse(localStorage.getItem('wheek-slot-3')).G, zfound: { beach: [1] }, visited: { park: 1, beach: 1 }, met: { Duck: 1 } } })) });
    for (const [slot, zone, name] of [[3, 'park', 'Oldie'], [2, 'beach', 'Zoey']]) {
      await page.goto(URL);
      await page.waitForFunction(() => !document.getElementById('slots').classList.contains('hidden'), null, { timeout: 180000 });
      const label = await page.evaluate(slot => document.querySelectorAll('#slots .slot')[slot - 1].innerText.replace(/\s+/g, ' '), slot);
      const before = errors.length;
      await page.evaluate(slot => document.querySelectorAll('#slots .slot')[slot - 1].querySelector('.cont').click(), slot);
      await page.waitForFunction(() => window.__game && window.__game.G.started, null, { timeout: 60000 });
      await frames(page, 10);
      const r = await page.evaluate(() => { const g = window.__game, Z = g.Z(); return { zone: Z.id, name: g.G.name, herd: g.herd.length, park: g.PARK.tunnels.map(t => t.found ? 1 : 0).join(''), zoneFound: Z.tunnels.map(t => t.found ? 1 : 0).join(''), pos: [g.pig.pos.x, g.pig.pos.z].map(v => v.toFixed(1)).join(',') } });
      report(`save slot ${slot} (${zone})`, r.zone === zone && r.name === name && r.herd === 1 && errors.length === before && (zone !== 'park' || r.park.startsWith('1001')) && (zone === 'park' || r.zoneFound[1] === '1'),
        `"${label}" → ${r.zone} at ${r.pos}, herd ${r.herd}, park burrows ${r.park}${zone === 'park' ? '' : ', zone burrows ' + r.zoneFound}`);
    }
  }

  // 6b. a v0.3 save round trip: befriend a guinea pig who lives on the farm, save there, reload, continue
  if (pick('saves')) {
    await page.evaluate(() => { for (let i = 1; i <= 3; i++) localStorage.removeItem('wheek-slot-' + i) });
    await page.goto(URL); await start();
    const want = await page.evaluate(() => { const g = window.__game; g.visit('farm', 0, 0, 0); const f = g.friends.find(f => f.origin === 'farm'); g.joinHerd(f); document.getElementById('saveBtn').click(); return { name: f.name, i: g.friends.indexOf(f) } });
    await page.goto(URL);
    await page.waitForFunction(() => !document.getElementById('slots').classList.contains('hidden'), null, { timeout: 180000 });
    await page.evaluate(() => document.querySelector('#slots .slot .cont').click());
    await page.waitForFunction(() => window.__game && window.__game.G.started, null, { timeout: 60000 });
    const r = await page.evaluate(() => { const g = window.__game; return { zone: g.Z().id, herd: g.herd.map(f => f.name), pals: g.G.pals } });
    report('save round trip (farm guinea pig)', r.zone === 'farm' && r.herd.includes(want.name) && r.pals.includes(want.i), `${r.zone}, herd ${r.herd.join(',')}, befriended ${r.pals.join(',')}`);
  }

  // 7. after visiting every zone: memory and what the renderer holds
  if (pick('memory')) {
    const r = await page.evaluate(async zones => { const g = window.__game; for (const id of zones) { g.visit(id, 0, 0, 0); await new Promise(r => requestAnimationFrame(r)) } g.visit('park', 0, 0, 0);
      const m = g.renderer.info.memory; return { heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1, geometries: m.geometries, textures: m.textures } }, zones);
    report('memory after every zone', true, `JS heap ${r.heap} MB · ${r.geometries} geometries · ${r.textures} textures`);
  }

  console.log(errors.length ? `console errors (${errors.length}):\n  ` + [...new Set(errors)].slice(0, 10).join('\n  ') : 'no console errors');
  await browser.close();
  process.exit(failed || errors.length ? 1 : 0);
})();
