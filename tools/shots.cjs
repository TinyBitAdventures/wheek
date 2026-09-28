// Screenshot tour: loads the game, picks a guinea pig, then poses a few scenes and saves a PNG of each.
// Usage: PW=/path/to/node_modules/playwright node tools/shots.cjs [outdir] [scene ...]
//   URL defaults to the local dev site, W/H to 1280x800. Prints draw calls, triangles and any console errors.
const { chromium } = require(process.env.PW || 'playwright');
const URL = process.env.URL || 'https://wheek.localhost/';
const [out = 'shots', ...want] = process.argv.slice(2);
const W = +(process.env.W || 1280), H = +(process.env.H || 800);

// Runs in the page with the game's debug handle (window.__game) in scope as g.
const setup = (page, body) => page.evaluate(`(()=>{const g=window.__game,{G,pig}=g;${body};pig.pos.y=g.heightAt(pig.pos.x,pig.pos.z);})()`);
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
  // Inside the burrow, scurrying between two found tunnels.
  async tunnel(page) {
    await page.keyboard.up('KeyF');
    await setup(page, `G.time=18;const [a,b]=g.tunnels;a.found=b.found=true;pig.pos.set(a.ex,0,a.ez);pig.heading=a.rot+Math.PI`);
    // keep the pig on the entrance (the herd can nudge it) until the prompt list, refreshed about once a second, offers the tunnel
    await page.waitForFunction(() => { const g = window.__game, [a] = g.tunnels; g.pig.pos.set(a.ex, g.heightAt(a.ex, a.ez), a.ez); return (g.G.acts || []).some(x => x.label.startsWith('Enter tunnel')); }, null, { timeout: 10000, polling: 200 });
    await page.keyboard.press('KeyE');
    await page.click('#tmList .btn.alt >> nth=0', { timeout: 5000 });
    await page.waitForTimeout(1600);
  },
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
    await page.screenshot({ path: `${out}/${name}.png` });
  };

  await page.goto(URL);
  await page.waitForFunction(() => !document.getElementById('startBtn').disabled, null, { timeout: 180000 });
  const version = await page.evaluate(() => document.getElementById('ver')?.textContent || '');
  if (pick('title')) await shot('title');
  await page.click('#startBtn');
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
  const info = await page.evaluate(() => { const g = window.__game, r = g.renderer.info.render; return { calls: r.calls, triangles: r.triangles, friends: g.friends.length, tunnels: g.tunnels.length, spots: g.spots.length }; });
  console.log(JSON.stringify({ url: URL, version, ...info }));
  console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'no console errors');
  await browser.close();
})();
