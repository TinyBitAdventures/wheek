// Screenshot tour: loads the game, picks a guinea pig, then poses a few scenes and saves a PNG of each.
// Usage: PW=/path/to/node_modules/playwright node tools/shots.cjs [outdir] [scene ...]
//   URL defaults to the local dev site, W/H to 1280x800. Prints draw calls, triangles and any console errors.
const { chromium } = require(process.env.PW || 'playwright');
const URL = process.env.URL || 'https://wheek.localhost/';
const [out = 'shots', ...want] = process.argv.slice(2);
const W = +(process.env.W || 1280), H = +(process.env.H || 800);

// Runs in the page with the game's debug handle (window.__game) in scope as g.
const setup = (page, body) => page.evaluate(`(()=>{const g=window.__game,{G,pig}=g;${body};pig.pos.y=G.under?0:g.heightAt(pig.pos.x,pig.pos.z);})()`);
// Hold the camera where a scene puts it (the game eases it back behind the pig 1.5 s after a drag).
// Headless WebGL runs at a few frames a second, so after a teleport wait until the eased camera has caught up.
const camera = async (page, yaw, dist, pitch) => {
  await setup(page, `G.camYaw=${yaw};G.camDist=${dist};G.camPitch=${pitch};G.lastDrag=performance.now()+1e6`);
  await page.waitForFunction(() => { const g = window.__game; return g.camera.position.distanceTo(g.pig.pos) < g.G.camDist * 1.6 + .3; }, null, { timeout: 30000, polling: 250 });
};

const scenes = {
  // One of each breed joins, the herd follows for a few seconds, then huddles.
  async herd(page) {
    await setup(page, `G.time=11;const pick=['american','abyssinian','peruvian','skinny'].map(b=>g.friends.find(f=>f.look.breed===b&&!g.herd.includes(f))).filter(Boolean);
      [...pick,...g.friends.filter(f=>!pick.includes(f)&&!g.herd.includes(f))].slice(0,6-g.herd.length).forEach(f=>g.joinHerd(f))`);
    await page.keyboard.down('KeyW'); await page.waitForTimeout(5000); await page.keyboard.up('KeyW');
    await camera(page, 'window.__game.pig.heading+2.6', 1.3, .45);
    await page.waitForTimeout(3000); // let the stragglers catch up and huddle
  },
  // A kneeling human in the meadow: stand by their hand for pets.
  async pets(page) {
    await setup(page, `G.time=11;const h=g.humans[0].obj;pig.pos.set(h.position.x+Math.sin(h.rotation.y)*1.2,0,h.position.z+Math.cos(h.rotation.y)*1.2);pig.heading=h.rotation.y+Math.PI`);
    await camera(page, 'window.__game.pig.heading+Math.PI+.5', 1.6, .25);
  },
  // Holding F at a leaf pile in the woods.
  async forage(page) {
    await setup(page, `G.time=16.5;const s=g.spots.filter(s=>s.type==='leafpile'&&Math.hypot(s.x,s.z)>18).sort((a,b)=>Math.hypot(a.x,a.z)-Math.hypot(b.x,b.z))[0];
      pig.pos.set(s.x+.35,0,s.z+.35);pig.heading=Math.atan2(s.x-pig.pos.x,s.z-pig.pos.z)`);
    await camera(page, 'window.__game.pig.heading+Math.PI+.6', 1, .4);
    await page.waitForTimeout(600);
    await page.keyboard.down('KeyF'); await page.waitForTimeout(1200);
  },
  // The house and garden beds at noon.
  async house(page) {
    await setup(page, `G.time=12;pig.pos.set(0,0,-6);pig.heading=Math.PI`);
    await camera(page, .2, 3.5, .35);
  },
  // Scurrying along a quick route between two found burrows (routes open once their passages are explored).
  async tunnel(page) {
    await page.keyboard.up('KeyF');
    await setup(page, `G.time=18;const [a,b]=g.tunnels;a.found=b.found=true;g.W.edges.forEach(e=>e.done=true);pig.pos.set(a.ex,0,a.ez);pig.heading=a.rot+Math.PI`);
    // keep the pig on the entrance (the herd can nudge it) until the prompt list, refreshed about once a second, offers the tunnel
    await page.waitForFunction(() => { const g = window.__game, [a] = g.tunnels; g.pig.pos.set(a.ex, g.heightAt(a.ex, a.ez), a.ez); return (g.G.acts || []).some(x => x.label.startsWith('Enter tunnel')); }, null, { timeout: 10000, polling: 200 });
    await page.keyboard.press('KeyE');
    await page.click('#tmList .btn.alt >> nth=0', { timeout: 30000 });
    await page.waitForTimeout(1600);
  },
  // Down in the warren: crawl along the first passage from the Meadow Burrow's den.
  async warren(page) {
    await page.waitForFunction(() => !window.__game.G.inTunnel, null, { timeout: 120000, polling: 250 });
    await setup(page, `G.time=12;g.enterWarren(g.tunnels[0],true)`);
    await page.keyboard.down('KeyW'); await page.waitForTimeout(2500); await page.keyboard.up('KeyW');
    await page.waitForTimeout(1500);
  },
  // A den under a burrow: daylight falls down the shaft.
  async den(page) {
    await setup(page, `const n=g.tunnels[0].node;if(!g.G.under)g.enterWarren(g.tunnels[0],true);pig.pos.set(n.x-.35,0,n.z+.2);pig.heading=Math.PI/2;G.camYaw=pig.heading+Math.PI;G.camPitch=.25`);
    await page.waitForTimeout(3500);
  },
  // A hidden chamber with the full map open.
  async chamber(page) {
    await setup(page, `const n=g.W.nodes.find(n=>n.theme==='${process.env.HALL || 'shrooms'}');if(!g.G.under)g.enterWarren(g.tunnels[0],true);pig.pos.set(n.x+n.r*.7,0,n.z);pig.heading=-Math.PI/2;G.camYaw=pig.heading+Math.PI;G.camPitch=.35`);
    await page.waitForTimeout(3500);
  },
  // The other zones: visit() builds a zone and drops the pig in at a spot.
  async peaks(page) {
    await setup(page, `document.getElementById('mapwrap').classList.remove('big');G.time=11;g.visit('peaks',-10,-4,-2.3)`);
    await camera(page, 'window.__game.pig.heading+Math.PI', 3.2, .35);
  },
  async creek(page) {
    await setup(page, `G.time=12;g.visit('creek',0,9.5,0)`);
    await camera(page, 'window.__game.pig.heading+Math.PI', 2.6, .35);
  },
  async town(page) {
    await setup(page, `G.time=10;g.visit('town',-10,4.5,1.2)`);
    await camera(page, 'window.__game.pig.heading+Math.PI', 4, .35);
  },
  async maze(page) {
    await setup(page, `G.time=12;g.visit('sunflowers',-6,-4,0)`);
    await camera(page, 'window.__game.pig.heading+Math.PI', 16, 1.15);
  },
  async map(page) {
    await setup(page, `g.W.edges.forEach(e=>e.pts.forEach(p=>p.seen=true));g.W.nodes.forEach(n=>n.seen=true);document.getElementById('mapwrap').classList.add('big')`);
    await page.waitForTimeout(1200);
  },
};
// A guinea pig who lives out on the beach, chatting.
scenes.zonepig = async page => {
  await setup(page, `document.getElementById('mapwrap').classList.remove('big');G.time=10.5;g.visit('beach',0,0,0);const f=g.friends.find(f=>f.origin==='beach');pig.pos.set(f.pos.x+.7,0,f.pos.z+.3);pig.heading=Math.atan2(f.pos.x-pig.pos.x,f.pos.z-pig.pos.z)`);
  await camera(page, 'window.__game.pig.heading+Math.PI+.9', 1.3, .3);
};
// Each zone's signature forage spot (sig-peaks, sig-town, ...): the pig stands just off it, looking at it.
for (const [zone, type, dist] of [['peaks', 'drift', 2], ['deepwood', 'bramble', 2.2], ['town', 'stall', 3.4], ['beach', 'picnic', 1.8], ['creek', 'cress', 1.8], ['zoo', 'trough', 2.2], ['farm', 'apples', 3.6], ['sunflowers', 'seedhead', 1.6]])
  scenes['sig-' + zone] = async page => {
    await setup(page, `document.getElementById('mapwrap').classList.remove('big');G.time=11;g.visit('${zone}',0,0,0);const s=g.Z().spots.find(s=>s.type==='${type}');
      const a=[0,1,2,3,4,5].map(k=>k*1.05).find(a=>g.freeAt(s.x+Math.cos(a)*(s.r+.35),s.z+Math.sin(a)*(s.r+.35),.12))||0;pig.pos.set(s.x+Math.cos(a)*(s.r+.35),0,s.z+Math.sin(a)*(s.r+.35));pig.heading=Math.atan2(s.x-pig.pos.x,s.z-pig.pos.z)`);
    await camera(page, 'window.__game.pig.heading+Math.PI+.5', dist, .32);
  };

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, ignoreHTTPSErrors: true });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', e => errors.push('PAGE ' + e.message));
  const pick = name => !want.length || want.includes(name);
  // Toasts and "rare find" callouts are timing noise in a still, so clear them first.
  const shot = async name => {
    await page.evaluate(() => { document.getElementById('toasts').innerHTML = ''; const c = document.getElementById('callout'); c.style.transition = 'none'; c.style.opacity = 0; });
    await page.screenshot({ path: `${out}/${name}.png`, timeout: 120000 });
  };

  await page.goto(URL);
  await page.waitForFunction(() => !document.getElementById('slots').classList.contains('hidden'), null, { timeout: 180000 });
  const version = await page.evaluate(() => document.getElementById('ver')?.textContent || '');
  if (pick('title')) await shot('title');
  await page.click('#slots .new >> nth=0');
  await page.click('.breed[data-b=abyssinian]');
  await page.waitForTimeout(1200);
  if (pick('select')) await shot('select');
  await page.fill('#pigName', 'Pepper');
  await page.click('#goBtn');
  await page.waitForTimeout(1500);
  for (const [name, run] of Object.entries(scenes)) {
    if (!pick(name)) continue;
    await run(page);
    await page.waitForTimeout(2000);
    await shot(name);
  }
  if (pick('journal')) { await page.keyboard.press('KeyJ'); await page.waitForTimeout(600); await shot('journal'); }
  const info = await page.evaluate(() => { const g = window.__game, r = g.renderer.info.render; return { calls: r.calls, triangles: r.triangles, caveTris: g.W.tris, nodes: g.W.nodes.length, edges: g.W.edges.length, friends: g.friends.length, tunnels: g.tunnels.length, spots: g.spots.length }; });
  console.log(JSON.stringify({ url: URL, version, ...info }));
  console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'no console errors');
  await browser.close();
})();
