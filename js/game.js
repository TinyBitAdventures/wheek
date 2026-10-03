import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// The version comes from the script tag in index.html (js/game.js?v=X.Y.Z), which also busts caches.
const VERSION=new URL(import.meta.url).searchParams.get('v')||'dev';

// ============================================================ utilities
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
let rand = mulberry32(20260925);
const R=(a,b)=>a+(b-a)*rand();
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const lerp=(a,b,t)=>a+(b-a)*t;
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t)};
const angDiff=(a,b)=>{let d=b-a;while(d>Math.PI)d-=Math.PI*2;while(d<-Math.PI)d+=Math.PI*2;return d};
const $=id=>document.getElementById(id);
const PERM=new Uint8Array(512);{const p=[...Array(256).keys()];for(let i=255;i>0;i--){const j=Math.floor(rand()*(i+1));[p[i],p[j]]=[p[j],p[i]]}for(let i=0;i<512;i++)PERM[i]=p[i&255]}
const hash2=(x,y)=>PERM[(PERM[x&255]+(y&255))&511]/255;
function vnoise(x,y){const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi,u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);
  return lerp(lerp(hash2(xi,yi),hash2(xi+1,yi),u),lerp(hash2(xi,yi+1),hash2(xi+1,yi+1),u),v)*2-1}
function fbm(x,y,o=4){let s=0,a=.5,f=1;for(let i=0;i<o;i++){s+=a*vnoise(x*f,y*f);a*=.5;f*=2.03}return s}
function pick(weights){let t=0;for(const k in weights)t+=weights[k];let r=rand()*t;for(const k in weights){r-=weights[k];if(r<=0)return k}return Object.keys(weights)[0]}
const lsGet=(k,d)=>{try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}};
const lsSet=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}};
// settings, saved in this browser: volumes 0-1, graphics quality, screen flashes, whether to show the touch controls
const SET={master:.8,music:.6,sfx:.8,quality:'high',flashes:true,touch:'auto',...lsGet('wheek-settings',{})};

// ============================================================ renderer / scene
const canvas=$('c');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));
renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.05;
renderer.outputColorSpace=THREE.SRGBColorSpace;
const scene=new THREE.Scene();
scene.fog=new THREE.Fog(0xbfd8e8,18,120);
const camera=new THREE.PerspectiveCamera(58,innerWidth/innerHeight,0.02,420);
addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();tCam.aspect=camera.aspect;tCam.updateProjectionMatrix()});

const U={time:{value:0},player:{value:new THREE.Vector3()}};

// sky dome
const skyMat=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,fog:false,uniforms:{top:{value:new THREE.Color(0x4f8fd0)},hor:{value:new THREE.Color(0xcfe3ee)},sunDir:{value:new THREE.Vector3(0,1,0)},sunCol:{value:new THREE.Color(1,0.9,0.7)}},
  vertexShader:`varying vec3 vD;void main(){vD=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader:`uniform vec3 top,hor,sunDir,sunCol;varying vec3 vD;void main(){float h=clamp(vD.y,0.,1.);vec3 c=mix(hor,top,pow(h,.55));float s=max(dot(normalize(vD),normalize(sunDir)),0.);c+=sunCol*(pow(s,600.)*2.+pow(s,12.)*.25);if(vD.y<0.)c=mix(hor,hor*.7,clamp(-vD.y*4.,0.,1.));gl_FragColor=vec4(c,1.);}`});
const sky=new THREE.Mesh(new THREE.SphereGeometry(380,32,16),skyMat);sky.renderOrder=-1;scene.add(sky);
// stars
const starGeo=new THREE.BufferGeometry();{const p=[];for(let i=0;i<1600;i++){const u=rand()*2-1,a=rand()*Math.PI*2,r=Math.sqrt(1-u*u);if(u<0.05)continue;p.push(Math.cos(a)*r*360,u*360,Math.sin(a)*r*360)}starGeo.setAttribute('position',new THREE.Float32BufferAttribute(p,3))}
const starMat=new THREE.PointsMaterial({color:0xffffff,size:1.4,sizeAttenuation:false,transparent:true,opacity:0,fog:false,depthWrite:false});
const stars=new THREE.Points(starGeo,starMat);scene.add(stars);

const hemi=new THREE.HemisphereLight(0xcfe6ff,0x6a5c3a,0.9);scene.add(hemi);
const sun=new THREE.DirectionalLight(0xfff0d8,2.6);
sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
const sc=sun.shadow.camera;sc.left=-18;sc.right=18;sc.top=18;sc.bottom=-18;sc.near=1;sc.far=160;
sun.shadow.bias=-0.0004;sun.shadow.normalBias=0.025;
scene.add(sun);scene.add(sun.target);

// ============================================================ textures
function canvasTex(w,h,draw,srgb=true){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const t=new THREE.CanvasTexture(c);if(srgb)t.colorSpace=THREE.SRGBColorSpace;return t}
const detailTex=canvasTex(512,512,(g,w,h)=>{g.fillStyle='#dedede';g.fillRect(0,0,w,h);for(let i=0;i<14000;i++){const v=170+Math.floor(rand()*85);g.fillStyle=`rgba(${v},${v},${v},.7)`;const s=.8+rand()*2;g.beginPath();g.ellipse(rand()*w,rand()*h,s,s*(0.5+rand()),rand()*3,0,7);g.fill()}for(let i=0;i<220;i++){const v=110+Math.floor(rand()*90);g.fillStyle=`rgba(${v},${v*0.95},${v*0.85},0.35)`;g.beginPath();g.ellipse(rand()*w,rand()*h,4+rand()*12,3+rand()*8,rand()*3,0,7);g.fill()}});
detailTex.wrapS=detailTex.wrapT=THREE.RepeatWrapping;detailTex.anisotropy=8;
const glowTex=canvasTex(64,64,(g,w,h)=>{const gr=g.createRadialGradient(32,32,0,32,32,32);gr.addColorStop(0,'rgba(255,255,255,1)');gr.addColorStop(.25,'rgba(255,255,255,.6)');gr.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gr;g.fillRect(0,0,w,h)});
const heartTex=canvasTex(64,64,(g)=>{g.font='52px serif';g.textAlign='center';g.textBaseline='middle';g.fillText('💗',32,36)});
const blobTex=canvasTex(64,64,(g)=>{const gr=g.createRadialGradient(32,32,0,32,32,32);gr.addColorStop(0,'rgba(0,0,0,.55)');gr.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=gr;g.fillRect(0,0,64,64)});
const furNoise=(()=>{const n=256,d=new Uint8Array(n*n*4);for(let i=0;i<n*n;i++){const v=Math.floor(Math.pow(rand(),0.7)*255);d[i*4]=v;d[i*4+1]=v;d[i*4+2]=v;d[i*4+3]=255}const t=new THREE.DataTexture(d,n,n);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.NearestFilter;t.minFilter=THREE.NearestFilter;t.needsUpdate=true;return t})();

// ============================================================ asset loading
// Models are generated by tools/build_assets.py (Blender) into assets/<name>.glb.
const MODELS=['Birch','Blanket','Burrow','Bush','Carrot','Clover','Clover4','Dandelion','Fence','Fern','FlowerPurple','FlowerWhite','Fox','GardenBed','Grass','GuineaPig','Hawk','Hay','House','Human','LeafPile','Log','LushGrass','MushroomBrown','MushroomRed','Oak','Oak2','Pepper','Pine','Rock','Rock2','Strawberry',
  'Sunflower','Barn','Shop','LampPost','Bench','Goat','Sheep','Duck','Car','Cattail','Umbrella','Sandcastle','Scarecrow','Fountain',
  'RoseHip','RaspLeaf','Lettuce','Watermelon','Cress','Corn','Apple','Seeds','Snowdrift','Bramble','MarketStall','Basket','CressBed','Trough','AppleTree','SunflowerHead',
  'BarnInside','HayPile','BarnHole','Twig','PetShopInside','CatFlap','Cat','CatLoaf','Pellets','LeafRaft','Willow','AgilityTent','AgilityInside','AgilityKit'];
const M={};
const DOUBLE=new Set(['Grass','Plant','Leaves','DryLeaves','Petal','Needles','Cloth','Skin','Flesh']);
async function loadAssets(progress){
  const loader=new GLTFLoader();let done=0;
  await Promise.all(MODELS.map(async k=>{
    const g=await loader.loadAsync(`assets/${k}.glb?v=${VERSION}`);
    g.scene.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;const m=o.material;if(o.geometry.attributes.color)m.vertexColors=true;if(DOUBLE.has(m.name))m.side=THREE.DoubleSide;if(m.name==='Leaves'||m.name==='Needles'){m.roughness=.85;m.color.setScalar(1.35)}if(m.name==='Grass'){m.color.setScalar(1.25)}if(m.name==='Bark'){m.color.setScalar(1.45)}}});
    M[k]=g.scene;done++;progress(done/MODELS.length);
  }));
}
// bake a model into per-material merged geometries (model space)
const BAKED={};const UPNORMAL=new Set(['Grass','LushGrass','Clover','Clover4']);
function bake(name){
  if(BAKED[name])return BAKED[name];
  const root=M[name];root.updateMatrixWorld(true);const groups=new Map();
  root.traverse(o=>{if(!o.isMesh)return;let g=o.geometry.clone();g.applyMatrix4(o.matrixWorld);
    const ng=new THREE.BufferGeometry();
    for(const [an,a] of Object.entries(g.attributes)){
      const size=an==='color'?3:a.itemSize;const arr=new Float32Array(a.count*size);
      for(let i=0;i<a.count;i++){arr[i*size]=a.getX(i);if(size>1)arr[i*size+1]=a.getY(i);if(size>2)arr[i*size+2]=a.getZ(i);if(size>3)arr[i*size+3]=a.getW(i)}
      ng.setAttribute(an,new THREE.BufferAttribute(arr,size));
    }
    ng.setIndex(g.index?Array.from(g.index.array):[...Array(g.attributes.position.count).keys()]);
    const k=o.material.name||o.material.uuid;if(!groups.has(k))groups.set(k,{mat:o.material,geos:[]});groups.get(k).geos.push(ng)});
  const parts=[...groups.values()].map(({mat,geos})=>{
    const names=Object.keys(geos[0].attributes).filter(n=>geos.every(g=>g.attributes[n]));
    geos.forEach(g=>{for(const n of Object.keys(g.attributes))if(!names.includes(n))g.deleteAttribute(n)});
    const geo=geos.length>1?mergeGeometries(geos):geos[0];
    if(UPNORMAL.has(name)&&geo.attributes.normal){const n=geo.attributes.normal;for(let i=0;i<n.count;i++)n.setXYZ(i,0,1,0)}
    return {geo,mat};
  });
  BAKED[name]=parts;return parts;
}
// chunked instanced sets with distance culling
let CHUNKS=[];
function makeSet(name,mats,{chunk=20,view=500,shadow=true,receive=true,parts=null,tint=null}={}){
  parts=parts||bake(name);if(tint)parts=parts.map(p=>tint[p.mat.name]?{geo:p.geo,mat:tint[p.mat.name](p.mat.clone())}:p);
  // which chunk each instance went to, and its slot there (typed arrays: a zone has ~100k instances)
  const buckets=new Map(),list=[],bi=new Uint16Array(mats.length),bj=new Uint32Array(mats.length);
  mats.forEach((m,i)=>{const x=m.elements[12],z=m.elements[14];const kx=Math.floor(x/chunk),kz=Math.floor(z/chunk),key=kx+','+kz;
    let b=buckets.get(key);if(!b){b={list:[],cx:(kx+.5)*chunk,cz:(kz+.5)*chunk,view:view+chunk*.75};buckets.set(key,b);b.id=list.length;list.push(b)}
    bi[i]=b.id;bj[i]=b.list.length;b.list.push(m)});
  for(const b of list){
    b.meshes=parts.map(p=>{const im=new THREE.InstancedMesh(p.geo,p.mat,b.list.length);b.list.forEach((m,j)=>im.setMatrixAt(j,m));im.castShadow=shadow;im.receiveShadow=receive;im.instanceMatrix.needsUpdate=true;im.computeBoundingSphere();ZG.add(im);return im});
    b.list=null;CHUNKS.push(b);   // the matrices now live in the instance buffers
  }
  return {parts,
    setMatrix(i,m,filter){const b=list[bi[i]],j=bj[i];b.meshes.forEach((im,k)=>{if(filter&&!filter(parts[k].mat.name))return;im.setMatrixAt(j,m);im.instanceMatrix.needsUpdate=true})}};
}
const ZERO=new THREE.Matrix4().makeScale(0,0,0);
const tmpM=new THREE.Matrix4(),tmpQ=new THREE.Quaternion(),tmpS=new THREE.Vector3(),tmpP=new THREE.Vector3(),tmpE=new THREE.Euler();
function mat4(x,y,z,ry=0,s=1,rx=0,rz=0,sy=null){tmpE.set(rx,ry,rz);tmpQ.setFromEuler(tmpE);return new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),tmpQ,new THREE.Vector3(s,sy??s,s))}

// wind / push shader injection (after instancing, in world space)
function windify(mat,{amp=0.25,push=0.0,hScale=1,upN=false}={}){
  const prev=mat.onBeforeCompile;
  mat.onBeforeCompile=(sh)=>{
    sh.uniforms.uTime=U.time;sh.uniforms.uPlayer=U.player;
    sh.vertexShader='uniform float uTime;uniform vec3 uPlayer;\n'+sh.vertexShader.replace('#include <project_vertex>',`
      vec4 wp=vec4(transformed,1.0);
      #ifdef USE_INSTANCING
      wp=instanceMatrix*wp;
      #endif
      wp=modelMatrix*wp;
      float hh=max(transformed.y*${hScale.toFixed(3)},0.0);
      vec3 ip=(modelMatrix*vec4(0.,0.,0.,1.)).xyz;
      #ifdef USE_INSTANCING
      ip=(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xyz;
      #endif
      float w=sin(uTime*1.7+ip.x*.35+ip.z*.25)*.6+sin(uTime*3.3+ip.x*1.3+ip.z*.7)*.25;
      wp.x+=w*hh*${amp.toFixed(3)};wp.z+=w*hh*${(amp*.6).toFixed(3)};
      ${push>0?`vec2 dd=wp.xz-uPlayer.xz;float dl=length(dd);float pk=(1.0-smoothstep(0.0,0.3,dl))*hh*${push.toFixed(3)};wp.xz+=normalize(dd+vec2(0.0001))*pk;wp.y-=pk*0.5;`:''}
      vec4 mvPosition=viewMatrix*wp;
      gl_Position=projectionMatrix*mvPosition;`);
    if(upN)sh.fragmentShader=sh.fragmentShader.replace('#include <normal_fragment_begin>',THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;','').replace('normal = normal * faceDirection;',''));
  };
  mat.customProgramCacheKey=()=>'wind'+amp+push+hScale+upN;
}

// ============================================================ terrain
const WORLD=150,HALF=WORLD/2,SEG=300,CELL=WORLD/SEG,EDGE=68;
const HOME={x:0,z:-15};
const PATH=[[0.8,-12],[1.5,-6],[0,0],[-3,8],[-7,17],[-12,28],[-16,38],[-11,50],[-4,58]];
function parkPath(x,z){let best=1e9;for(let i=0;i<PATH.length-1;i++){const[ax,az]=PATH[i],[bx,bz]=PATH[i+1];const dx=bx-ax,dz=bz-az;const t=clamp(((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz),0,1);best=Math.min(best,Math.hypot(x-ax-dx*t,z-az-dz*t))}return best}
function parkForest(x,z){const d=Math.hypot(x-0,z+3);return smooth(19,28,d+fbm(x*.05+7,z*.05,3)*10)}
function parkHeight(x,z){let h=fbm(x*.011+10,z*.011+3,4)*5+fbm(x*.045,z*.045,3)*.7;const dh=Math.hypot(x-HOME.x,z-HOME.z);h*=smooth(6,30,dh)*.9+.1;h+=smooth(58,74,Math.hypot(x,z))*7;const dp=parkPath(x,z);h-=(1-smooth(0,1.2,dp))*.06;return h}
function parkGround(x,z){
  const f=parkForest(x,z),n1=fbm(x*.15,z*.15,3)*.5+.5,n2=fbm(x*.3+40,z*.3,2)*.5+.5;
  let r=lerp(.33,.47,n1),g=lerp(.52,.62,n1),b=lerp(.15,.2,n1);
  const fr=lerp(.34,.27,n2),fg=lerp(.27,.33,n2),fb=lerp(.15,.12,n2);
  r=lerp(r,fr,f);g=lerp(g,fg,f);b=lerp(b,fb,f);
  const dp=parkPath(x,z),pk=1-smooth(.35,1.0,dp+fbm(x*.8,z*.8,2)*.3);
  r=lerp(r,.5,pk);g=lerp(g,.4,pk);b=lerp(b,.27,pk);
  const dh=Math.max(Math.abs(x-HOME.x)-3.4,Math.abs(z-HOME.z)-2.7);if(dh<.6){const k=1-smooth(0,.6,dh);r=lerp(r,.42,k*.7);g=lerp(g,.38,k*.7);b=lerp(b,.3,k*.7)}
  return [r,g,b]}
function parkMapColor(x,z){const f=parkForest(x,z);if(parkPath(x,z)<1.2)return [170,140,95];return [lerp(120,40,f),lerp(170,85,f),lerp(70,40,f)]}
// the active zone's shape (see "zones")
function distToPath(x,z){return Z.path(x,z)}
function forestness(x,z){return Z.forest(x,z)}
let HGRID=null;
function heightAt(x,z){
  const gx=clamp((x+HALF)/CELL,0,SEG-1e-4),gz=clamp((z+HALF)/CELL,0,SEG-1e-4);const ix=Math.floor(gx),iz=Math.floor(gz),fx=gx-ix,fz=gz-iz;
  const a=HGRID[iz*(SEG+1)+ix],b=HGRID[iz*(SEG+1)+ix+1],c=HGRID[(iz+1)*(SEG+1)+ix],d=HGRID[(iz+1)*(SEG+1)+ix+1];
  return fx+fz<1?a+(b-a)*fx+(c-a)*fz:d+(c-d)*(1-fx)+(b-d)*(1-fz);
}
function buildTerrain(){
  const n=(SEG+1)*(SEG+1),pos=new Float32Array(n*3),col=new Float32Array(n*3),uv=new Float32Array(n*2);
  for(let iz=0;iz<=SEG;iz++)for(let ix=0;ix<=SEG;ix++){
    const i=iz*(SEG+1)+ix,x=-HALF+ix*CELL,z=-HALF+iz*CELL;pos[i*3]=x;pos[i*3+1]=HGRID[i];pos[i*3+2]=z;uv[i*2]=x*.9;uv[i*2+1]=z*.9;
    const [r,g,b]=Z.ground(x,z,HGRID[i]);col[i*3]=r*1.15;col[i*3+1]=g*1.15;col[i*3+2]=b*1.15;
  }
  const idx=new Uint32Array(SEG*SEG*6);let k=0;
  for(let iz=0;iz<SEG;iz++)for(let ix=0;ix<SEG;ix++){const a=iz*(SEG+1)+ix,b=a+1,c=a+SEG+1,d=c+1;idx[k++]=a;idx[k++]=c;idx[k++]=b;idx[k++]=b;idx[k++]=c;idx[k++]=d}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('color',new THREE.BufferAttribute(col,3));g.setAttribute('uv',new THREE.BufferAttribute(uv,2));g.setIndex(new THREE.BufferAttribute(idx,1));g.computeVertexNormals();
  const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({vertexColors:true,map:detailTex,roughness:.97,metalness:0}));m.receiveShadow=true;ZG.add(m);
}

// ============================================================ zones
// The world is a 3×3 grid of zones with the park in the middle. Each zone is its own round map, the same size as the
// park, built the first time you walk in from its own seed (so it is the same on every visit). Walking off a zone's rim
// takes you to its neighbour that way: the rim splits into eight compass sectors, four sides and four corners.
const DIRS=[[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]]; // rim sectors: E, SE, S, SW, W, NW, N, NE (+z is south, the top of the map is north)
let Z=null,ZG=scene,PARK=null;const ZONE={};
function zoneAt(gx,gz){for(const k in ZONE){const z=ZONE[k];if(z.gx===gx&&z.gz===gz)return z}return null}
function sectorAt(x,z){return ((Math.round(Math.atan2(z,x)/(Math.PI/4))%8)+8)%8}
function neighbour(z,s){return zoneAt(z.gx+DIRS[s][0],z.gz+DIRS[s][1])}
function defineZone(def){ZONE[def.id]={fog:1,...def,built:false};return ZONE[def.id]}
// point the world globals at a zone's state
function useZone(z){Z=z;({colliders,boxes,trees,bushes,logs,tunnels,spots,patches,humans,pickSets,drops}=z);CHUNKS=z.chunks;HGRID=z.hgrid;ZG=z.group;
  G.leafpiles=z.leafpiles;G.lpSet=z.lpSet;G.bushSet=z.bushSet;G.lushSet=z.lushSet;G.glass=z.glass;mapBg=z.mapBg}
function buildZone(z){
  Object.assign(z,{colliders:[],boxes:[],trees:[],bushes:[],logs:[],tunnels:[],spots:[],patches:[],humans:[],pickSets:[],drops:[],chunks:[],group:new THREE.Group(),
    hgrid:new Float32Array((SEG+1)*(SEG+1)),leafpiles:[],lpSet:null,bushSet:null,lushSet:null,glass:null,mapBg:null,lamps:[],windows:[],critters:[],cars:[],cover:[],barns:[],twigs:[],shops:[],shop:null});
  useZone(z);
  for(let iz=0;iz<=SEG;iz++)for(let ix=0;ix<=SEG;ix++)z.hgrid[iz*(SEG+1)+ix]=z.height(-HALF+ix*CELL,-HALF+iz*CELL);
  const prev=rand;if(z.seed)rand=mulberry32(z.seed);   // the park keeps the world's own sequence: its layout predates zones
  z.build(z);rand=prev;if(z!==PARK)addSignposts(z);
  for(const i of G.zfound[z.id]||[])if(z.tunnels[i])z.tunnels[i].found=true;
  if(z!==PARK)placeZoneFriends(z);
  for(const b of z.barns)setupBarn(b);
  if(z.id==='town')setupPetShop(z);
  if(z.id==='creek')setupRaft(z);
  if(z.id==='zoo')setupAgility(z);
  placeTwigs(z);
  // a plant that ended up inside a rock or trunk can never be eaten: leave it out (without touching the seeded layout)
  for(const ps of z.pickSets)for(const it of ps.items)if(z.colliders.some(c=>Math.hypot(c.x-it.x,c.z-it.z)<c.r)||insideBox(it.x,it.z)){it.alive=false;it.respawn=Infinity;ps.set.setMatrix(it.i,ZERO)}
  Object.assign(z,{leafpiles:G.leafpiles,lpSet:G.lpSet,bushSet:G.bushSet,lushSet:G.lushSet,glass:G.glass});z.built=true}
function showZone(z){const old=Z&&Z.built?Z:null;if(!z.built)buildZone(z);useZone(z);if(old&&old!==z)scene.remove(old.group);scene.add(z.group)}

// ============================================================ items & loot
const ITEMS={
  grass:{name:'Lush Grass',icon:'🌱',rarity:'common',full:5,vitc:0,pts:5},
  dandelion:{name:'Dandelion',icon:'🌼',rarity:'common',full:6,vitc:8,pts:15,model:'Dandelion'},
  clover:{name:'Clover',icon:'☘️',rarity:'common',full:6,vitc:6,pts:12,model:'Clover'},
  daisy:{name:'Daisy',icon:'🌸',rarity:'common',full:3,vitc:3,pts:8,model:'FlowerWhite'},
  violet:{name:'Violet',icon:'💜',rarity:'common',full:3,vitc:6,pts:10,model:'FlowerPurple'},
  hay:{name:'Timothy Hay',icon:'🌾',rarity:'common',full:22,vitc:0,energy:10,pts:25,model:'Hay'},
  berries:{name:'Wild Berries',icon:'🫐',rarity:'uncommon',full:8,vitc:14,pts:35,model:'Strawberry',tint:0x8a1030},
  strawberry:{name:'Strawberry',icon:'🍓',rarity:'uncommon',full:9,vitc:22,pts:40,model:'Strawberry'},
  carrot:{name:'Carrot',icon:'🥕',rarity:'uncommon',full:16,vitc:6,pts:40,model:'Carrot'},
  pepper:{name:'Bell Pepper',icon:'🫑',rarity:'rare',full:10,vitc:40,pts:70,model:'Pepper'},
  chanterelle:{name:'Chanterelle',icon:'🍄',rarity:'rare',full:12,vitc:4,pts:80,model:'MushroomBrown'},
  toadstool:{name:'Fly Agaric',icon:'🍄‍🟫',rarity:'toxic',full:0,vitc:0,pts:0,model:'MushroomRed'},
  goldCarrot:{name:'Golden Carrot',icon:'✨🥕',rarity:'epic',full:30,vitc:20,health:20,pts:250,model:'Carrot',gold:true},
  clover4:{name:'Four-Leaf Clover',icon:'🍀',rarity:'legendary',full:8,vitc:10,pts:300,model:'Clover4',luck:true},
  goldDandelion:{name:'Golden Dandelion',icon:'🌟',rarity:'legendary',full:15,vitc:40,health:30,pts:400,model:'Dandelion',gold:true},
  // each zone's signature treat, found only there
  rosehip:{name:'Rose Hips',icon:'🌹',rarity:'uncommon',full:5,vitc:35,pts:60,model:'RoseHip',zone:'peaks'},
  raspleaf:{name:'Raspberry Leaves',icon:'🍃',rarity:'uncommon',full:8,vitc:16,pts:45,model:'RaspLeaf',zone:'deepwood'},
  romaine:{name:'Romaine Lettuce',icon:'🥬',rarity:'uncommon',full:14,vitc:12,pts:45,model:'Lettuce',zone:'town'},
  watermelon:{name:'Watermelon',icon:'🍉',rarity:'rare',full:14,vitc:18,energy:10,pts:90,model:'Watermelon',zone:'beach'},
  watercress:{name:'Watercress',icon:'🌿',rarity:'uncommon',full:6,vitc:24,pts:50,model:'Cress',zone:'creek'},
  cornhusk:{name:'Corn Husk',icon:'🌽',rarity:'uncommon',full:16,vitc:4,energy:6,pts:40,model:'Corn',zone:'zoo'},
  apple:{name:'Apple Slice',icon:'🍎',rarity:'uncommon',full:10,vitc:8,pts:45,model:'Apple',zone:'farm'},
  seeds:{name:'Sunflower Seeds',icon:'🌻',rarity:'rare',full:20,vitc:2,energy:15,pts:85,model:'Seeds',zone:'sunflowers'},
  // only in Downtown's pet shop, after hours
  pellets:{name:'Fortified Pellets',icon:'🥣',rarity:'uncommon',full:14,vitc:30,pts:50,model:'Pellets',zone:'town'},
};
const ITEM_SCALE={Hay:.8,Carrot:1,Pepper:1.1,Lettuce:1.1,Corn:1.05,Seeds:1.7,Pellets:1.6};
const RARITY={common:['#f2ead8','Found'],uncommon:['#7fe07a','Nice find'],rare:['#56b4ff','Rare find!'],epic:['#c98bff','Epic find!!'],legendary:['#ffd23f','LEGENDARY!!!'],toxic:['#ff6a5a','Careful…']};
const LOOT={
  leafpile:{clover:26,dandelion:16,chanterelle:14,toadstool:12,violet:10,berries:6,clover4:3,goldDandelion:2,nothing:11},
  bush:{berries:72,strawberry:12,clover:10,clover4:1.5,nothing:4},
  log:{chanterelle:34,toadstool:22,clover:14,clover4:4,goldDandelion:3,nothing:12},
  rock:{clover:30,dandelion:24,violet:18,daisy:12,clover4:4,goldDandelion:1,nothing:10},
  bed:{carrot:38,strawberry:26,pepper:24,goldCarrot:4,nothing:6},
  hay:{hay:92,clover4:1.5,goldDandelion:1.5,nothing:5},
  prize:{goldDandelion:40,goldCarrot:30,clover4:30},
  drift:{rosehip:46,clover:16,dandelion:12,clover4:2,goldDandelion:1,nothing:23},
  bramble:{raspleaf:50,berries:22,clover:10,clover4:2,goldDandelion:1.5,nothing:12},
  stall:{romaine:42,carrot:20,pepper:18,strawberry:12,goldCarrot:3,nothing:5},
  picnic:{watermelon:30,strawberry:24,carrot:20,pepper:10,goldCarrot:3,nothing:13},
  cress:{watercress:58,clover:14,dandelion:10,clover4:2.5,nothing:15},
  trough:{cornhusk:48,hay:22,carrot:14,clover4:1.5,nothing:12},
  apples:{apple:54,clover:12,dandelion:10,goldCarrot:2,nothing:20},
  seedhead:{seeds:40,daisy:14,violet:12,dandelion:12,clover4:2,goldDandelion:1.5,nothing:18},
  shopspill:{pellets:55,hay:15,carrot:10,clover:10,nothing:10},
  shopbin:{pellets:25,strawberry:18,carrot:15,pepper:14,apple:8,goldCarrot:4,clover4:2,nothing:4},
  islandlog:{watercress:18,berries:15,strawberry:14,chanterelle:12,raspleaf:8,clover4:5,goldDandelion:4,nothing:10},
};
const SPOTNAME={leafpile:'Leaf Pile',bush:'Berry Bush',log:'Mossy Log',rock:'Mossy Rock',bed:'Garden Bed',hay:'Hay Bale',prize:'the Maze Prize',
  drift:'Snowdrift',bramble:'Bramble Patch',stall:'Market Crate',picnic:'Picnic Basket',cress:'Watercress Bed',trough:'Feed Trough',apples:'Windfall Apples',seedhead:'Sunflower Head',shopspill:'Spilled Pellets',shopbin:'Treat Bin',islandlog:'Driftwood'};
// ============================================================ breeds & coats
const BREEDS={
  american:{name:'American',tag:'Smooth & speedy',desc:'A short, sleek coat. The classic all-rounder.',perk:'🏃 Scurries 12% faster, and sprinting costs less energy',fur:{len:1,droop:1,swirl:0,dens:[340,200],face:.8,layers:16},coats:['tricolor','golden','dutch','agouti','himalayan'],speed:1.12,sprintCost:.75},
  abyssinian:{name:'Abyssinian',tag:'Rosette rummager',desc:'Wild swirls of fur called rosettes, and a very busy nose.',perk:'🍂 Forages 25% faster',fur:{len:2.2,droop:.25,swirl:1,dens:[260,150],face:.6,layers:20},coats:['golden','tricolor','agouti','dutch','himalayan'],forage:1.25},
  peruvian:{name:'Peruvian',tag:'Flowing coat',desc:'Long silky hair that sweeps the ground and hides you in the grass.',perk:'🦅 Hawks spot you 30% slower, but you scurry 8% slower',fur:{len:5.5,droop:.35,swirl:0,dens:[130,80],face:.3,fall:1,clump:1,layers:28},coats:['tricolor','himalayan','golden','dutch','agouti'],hawk:.7,speed:.92},
  skinny:{name:'Skinny Pig',tag:'Social sweetheart',desc:'Almost hairless, warm to the touch and extra cuddly.',perk:'💞 Befriends other piggies twice as fast and loves pets, but gets hungry 20% faster',fur:null,coats:['pink','choc','dalmatian'],social:2,petJoy:1.5,hunger:1.2,scale:.96},
};
const COATS={
  tricolor:{name:'Tricolor',sw:'conic-gradient(#f2e6cc 0 40%,#d17a33 0 75%,#2a1c14 0)'},
  golden:{name:'Golden',sw:'radial-gradient(circle at 35% 30%,#f3d49a,#d9913f)'},
  dutch:{name:'Dutch',sw:'linear-gradient(90deg,#1e1512 0 32%,#f4efe6 0 68%,#1e1512 0)'},
  agouti:{name:'Agouti',sw:'radial-gradient(circle at 35% 30%,#a07448,#4a3420)'},
  himalayan:{name:'Himalayan',sw:'radial-gradient(circle at 70% 70%,#3a2e28 0 22%,#f6f2ea 0)',skin:[.3,.24,.24],redEyes:true},
  pink:{name:'Pink',glow:[.07,.03,.025],sw:'radial-gradient(circle at 35% 30%,#f6cdbf,#dc9a8a)'},
  choc:{name:'Chocolate',glow:[.03,.015,.01],sw:'radial-gradient(circle at 35% 30%,#9a6a52,#5a3a2c)',skin:[.62,.46,.42]},
  dalmatian:{name:'Dalmatian',glow:[.06,.025,.02],sw:'radial-gradient(circle at 30% 35%,#6a4030 0 16%,transparent 0),radial-gradient(circle at 68% 62%,#6a4030 0 20%,#eab4a4 0)'},
};
const PIG_NAMES=['Biscuit','Pip','Clover','Mochi','Peanut','Hazel','Nugget','Pumpkin','Waffles','Ginger','Bean','Truffle','Oreo','Cinnamon','Pickles','Button','Custard','Popcorn','Sprout','Toffee','Marshmallow','Muffin','Nibbles','Juniper'];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function perksFor(breed){return {speed:1,sprintCost:1,forage:1,hawk:1,hunger:1,social:1,petJoy:1,...BREEDS[breed]}}
const RANKS=[[0,'Nibbler'],[4,'Sniffer'],[12,'Rummager'],[25,'Master Forager'],[45,'Legendary Forager']];

// ============================================================ game state
const G={started:false,paused:false,over:false,modal:false,inTunnel:false,
  hp:100,full:80,vitc:75,energy:100,happy:50,score:0,best:lsGet('wheek-best',0),
  day:1,time:7.0,combo:0,comboT:0,forages:0,pets:0,petStreak:0,lastPetHuman:null,petStreakT:0,
  found:{},curios:{},tunnels:0,zfound:{},visited:{park:1},met:{},pals:[],placesDone:{},goals:{},bestStreak:0,hawkDodged:0,foxEscapes:0,mazePrize:0,heard:{},given:{},barns:{},hayFinds:0,teethT:0,gnaws:0,cleanGnaws:0,shop:0,fullHerd:0,island:0,rafts:0,cleanRaft:0,agility:0,rosette:0,agilityBest:0,agilityRuns:0,luckT:0,giftT:40,huddle:false,wheekT:0,sniffCD:0,popcornCD:0,cause:'',nightsSurvived:0,eaten:0};
const pig={pos:new THREE.Vector3(2.5,0,-1.5),vel:new THREE.Vector3(),heading:Math.PI,vy:0,air:false,phase:0,obj:null,parts:{},eating:0,foraging:0,knock:0,popSpin:0,fur:[]};
(()=>{const s=lsGet('wheek-pig',null);const b=s&&BREEDS[s.breed]?s.breed:'american';G.breed=b;G.coat=s&&BREEDS[b].coats.includes(s.coat)?s.coat:BREEDS[b].coats[0];G.name=(s&&s.name)||PIG_NAMES[Math.floor(Math.random()*PIG_NAMES.length)];G.perk=perksFor(b)})();
const keys={};
let colliders=[],boxes=[];
let trees=[],bushes=[],logs=[],tunnels=[],spots=[],patches=[],humans=[],pickSets=[],drops=[];   // the active zone's (see useZone)

// ============================================================ audio (synth)
let AC=null,master=null,ambGain=null,out=null,musicGain=null;   // master is the sound effects' bus; out is the overall volume
function audioInit(){if(AC)return;AC=new (window.AudioContext||window.webkitAudioContext)();out=AC.createGain();out.connect(AC.destination);master=AC.createGain();master.connect(out);
  musicGain=AC.createGain();musicGain.connect(out);applyAudio();loadMusic();
  // wind bed
  const nb=noiseBuf(4);const src=AC.createBufferSource();src.buffer=nb;src.loop=true;const lp=AC.createBiquadFilter();lp.type='lowpass';lp.frequency.value=420;ambGain=AC.createGain();ambGain.gain.value=.05;src.connect(lp).connect(ambGain).connect(master);src.start()}
let _nb=null;function noiseBuf(sec=1){if(_nb&&sec===1)return _nb;const b=AC.createBuffer(1,AC.sampleRate*sec,AC.sampleRate);const d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;if(sec===1)_nb=b;return b}
function env(g,t,a,peak,d){g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(peak,t+a);g.gain.exponentialRampToValueAtTime(0.0001,t+a+d)}
function tone(type,f0,f1,dur,vol,t0=0,filt){if(!AC)return;const t=AC.currentTime+t0;const o=AC.createOscillator();o.type=type;o.frequency.setValueAtTime(f0,t);o.frequency.exponentialRampToValueAtTime(Math.max(20,f1),t+dur);const g=AC.createGain();env(g,t,.012,vol,dur);let n=o;if(filt){const f=AC.createBiquadFilter();f.type=filt[0];f.frequency.value=filt[1];f.Q.value=filt[2]||1;o.connect(f);n=f}n.connect(g).connect(master);o.start(t);o.stop(t+dur+.05);return o}
function noise(dur,vol,type,freq,q=1,t0=0){if(!AC)return;const t=AC.currentTime+t0;const s=AC.createBufferSource();s.buffer=noiseBuf();const f=AC.createBiquadFilter();f.type=type;f.frequency.value=freq;f.Q.value=q;const g=AC.createGain();env(g,t,.005,vol,dur);s.connect(f).connect(g).connect(master);s.start(t,Math.random()*.5);s.stop(t+dur+.05)}
function applyAudio(){if(!AC)return;out.gain.value=SET.master;master.gain.value=.55*SET.sfx;musicGain.gain.value=MUSIC_LEVEL*SET.music}
// ---- music: three seamless loops made with Wavelength (assets/music), cross-faded by where you are and the time of day.
// len is each loop's exact length. A browser that keeps the MP3's encoder delay at the start gets loopStart past it.
const MUSIC={meadow:{len:32*4*60/100},moonlight:{len:24*4*60/72},warren:{len:32*4*60/88}},MUSIC_LEVEL=.7;let musicNow=null,musicT=0;
async function loadMusic(){for(const k in MUSIC){try{const r=await fetch(`assets/music/${k}.mp3?v=${VERSION}`);const buf=await AC.decodeAudioData(await r.arrayBuffer());MUSIC[k].start=musicStart(buf,MUSIC[k].len);MUSIC[k].buf=buf}catch(e){console.warn('music',k,e)}}}
function musicStart(buf,len){const extra=buf.duration-len;if(extra<.002)return 0;const d=buf.getChannelData(0),n=Math.min(d.length,Math.ceil(extra*buf.sampleRate));let i=0;while(i<n&&Math.abs(d[i])<1e-4)i++;return i/buf.sampleRate}
function updateMusic(dt){if(!musicGain)return;musicT-=dt;if(musicT>0)return;musicT=.5;
  const want=!G.started?'meadow':G.under?'warren':isNight()?'moonlight':'meadow',m=MUSIC[want];if(musicNow&&musicNow.k===want||!m.buf)return;
  const t=AC.currentTime;if(musicNow){const o=musicNow;o.g.gain.cancelScheduledValues(t);o.g.gain.setValueAtTime(o.g.gain.value,t);o.g.gain.linearRampToValueAtTime(0,t+3);o.src.stop(t+3.1)}
  const src=AC.createBufferSource(),g=AC.createGain();src.buffer=m.buf;src.loop=true;src.loopStart=m.start;src.loopEnd=m.start+m.len;
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(1,t+(musicNow?3:1.5));src.connect(g).connect(musicGain);src.start(t,m.start);musicNow={k:want,src,g}}
// a hidden tab goes quiet
document.addEventListener('visibilitychange',()=>{if(!AC)return;if(document.hidden)AC.suspend();else AC.resume()});
const SFX={
  wheek(){if(!AC)return;for(let k=0;k<2;k++){const t=AC.currentTime+k*.28;const o=AC.createOscillator();o.type='sawtooth';o.frequency.setValueAtTime(1100,t);o.frequency.exponentialRampToValueAtTime(2600,t+.16);o.frequency.exponentialRampToValueAtTime(2200,t+.24);const l=AC.createOscillator();l.frequency.value=38;const lg=AC.createGain();lg.gain.value=90;l.connect(lg).connect(o.frequency);const f=AC.createBiquadFilter();f.type='bandpass';f.frequency.value=2400;f.Q.value=1.4;const g=AC.createGain();env(g,t,.02,.35,.22);o.connect(f).connect(g).connect(master);o.start(t);l.start(t);o.stop(t+.3);l.stop(t+.3)}},
  chomp(){noise(.05,.25,'bandpass',1800,1.5);noise(.04,.18,'bandpass',1300,1.5,.09)},
  purr(){if(!AC)return;const t=AC.currentTime;const o=AC.createOscillator();o.type='square';o.frequency.value=85;const am=AC.createOscillator();am.frequency.value=22;const ag=AC.createGain();ag.gain.value=.5;const g=AC.createGain();g.gain.value=0;am.connect(ag).connect(g.gain);const f=AC.createBiquadFilter();f.type='lowpass';f.frequency.value=400;const out=AC.createGain();env(out,t,.05,.22,.45);o.connect(f).connect(g).connect(out).connect(master);o.start(t);am.start(t);o.stop(t+.55);am.stop(t+.55)},
  rustle(){noise(.12,.14,'highpass',2500,.7)},
  pop(){tone('sine',500,1300,.12,.3)},
  find(r){const seq={common:[660,880],uncommon:[660,880,1100],rare:[523,784,1046,1318],epic:[523,659,784,1046,1318],legendary:[523,659,784,1046,1318,1568,2093],toxic:[300,220]}[r]||[660];seq.forEach((f,i)=>tone(r==='toxic'?'sawtooth':'triangle',f,f*1.01,.18,.22,i*.08))},
  screech(){if(!AC)return;tone('sawtooth',2900,1700,.9,.22,0,['bandpass',2200,3]);noise(.8,.08,'bandpass',3000,2)},
  yip(){tone('square',760,480,.12,.14,0,['bandpass',900,2]);tone('square',800,500,.12,.14,.18,['bandpass',900,2])},
  hurt(){tone('sine',200,60,.3,.5);tone('sawtooth',1600,900,.25,.18,.02,['bandpass',1500,2])},
  whoosh(){noise(1.4,.25,'lowpass',600,1);noise(1.0,.1,'bandpass',300,2,.4)},
  bird(){const f=2800+Math.random()*1800;for(let i=0;i<2+Math.floor(Math.random()*4);i++)tone('sine',f,f*(Math.random()>.5?1.3:.75),.07,.05,i*.1)},
  cricket(){for(let i=0;i<3;i++)tone('sine',4600,4550,.03,.03,i*.05)},
  jump(){tone('sine',700,1400,.1,.15)},
  sniff(){for(let i=0;i<4;i++)noise(.05,.12,'bandpass',4000,2,i*.08)},
  chut(){for(let i=0;i<3;i++)tone('triangle',520+Math.random()*80,380,.05,.12,i*.09,['lowpass',1400])},
  levelup(){[523,659,784,1046].forEach((f,i)=>tone('square',f,f,.14,.12,i*.1,['lowpass',3000]))},
  baa(){if(!AC)return;const t=AC.currentTime;const o=AC.createOscillator();o.type='sawtooth';o.frequency.setValueAtTime(330+Math.random()*60,t);o.frequency.linearRampToValueAtTime(290,t+.5);const l=AC.createOscillator();l.frequency.value=9;const lg=AC.createGain();lg.gain.value=25;l.connect(lg).connect(o.frequency);const f=AC.createBiquadFilter();f.type='bandpass';f.frequency.value=900;f.Q.value=1.2;const g=AC.createGain();env(g,t,.05,.16,.5);o.connect(f).connect(g).connect(master);o.start(t);l.start(t);o.stop(t+.6);l.stop(t+.6)},
  quack(){for(let i=0;i<2;i++)tone('square',480,300,.12,.1,i*.16,['bandpass',1100,3])},
  honk(){tone('square',420,410,.25,.1,0,['lowpass',1600]);tone('square',525,515,.25,.08,0,['lowpass',1600])},
  meow(){tone('sawtooth',520,780,.18,.12,0,['bandpass',1200,3]);tone('sawtooth',780,420,.32,.12,.17,['bandpass',1100,3])},
};

// ============================================================ world building
function addCollider(x,z,r){colliders.push({x,z,r})}

function buildWorld(){
  buildTerrain();
  const avoid=[];
  // --- house & garden
  const house=M.House.clone();const hy=Math.min(heightAt(HOME.x-3,HOME.z-2.3),heightAt(HOME.x+3,HOME.z-2.3),heightAt(HOME.x-3,HOME.z+2.3),heightAt(HOME.x+3,HOME.z+2.3))-.05;
  house.position.set(HOME.x,hy,HOME.z);ZG.add(house);boxes.push({cx:HOME.x,cz:HOME.z,hx:3.05,hz:2.3});
  house.traverse(o=>{if(o.isMesh&&o.material.name==='Glass'){o.material=o.material.clone();G.glass=o.material;o.material.emissive=new THREE.Color(0xffb35c);o.material.emissiveIntensity=0}});
  avoid.push({x:HOME.x,z:HOME.z,r:5});
  const beds=[[-5,-8.5],[5,-8.5]];
  beds.forEach(([x,z])=>{const b=M.GardenBed.clone();b.position.set(x,heightAt(x,z)-.03,z);ZG.add(b);boxes.push({cx:x,cz:z,hx:1.24,hz:.53});avoid.push({x,z,r:2});
    spots.push({type:'bed',x,z:z+.62,r:.45,ready:true,cd:0,obj:b});spots.push({type:'bed',x,z:z-.62,r:.45,ready:true,cd:0,obj:b})});
  // hay bale
  {const x=-3.6,z=-11.8;const h=M.Hay.clone();h.scale.setScalar(2.4);h.position.set(x,heightAt(x,z),z);h.rotation.y=.4;ZG.add(h);spots.push({type:'hay',x,z,r:.5,ready:true,cd:0,obj:h})}
  // fence (decor; guinea pigs fit under rails)
  const fm=[];for(let x=-10;x<10;x+=2){fm.push(mat4(x,heightAt(x,-4.2),-4.2,0,1))}
  for(let z=-12;z<-4;z+=2){fm.push(mat4(-10,heightAt(-10,z),z,-Math.PI/2,1));fm.push(mat4(10,heightAt(10,z+2),z+2,Math.PI/2,1))}
  makeSet('Fence',fm,{chunk:40});
  // blanket
  {const b=M.Blanket.clone();b.position.set(5.5,heightAt(5.5,3.2)+.005,3.2);b.rotation.y=.3;ZG.add(b)}

  // --- tunnels (burrows) placed first, deep in the forest
  const tunnelNames=['Mossy Hollow','Rooty Den','Fern Gate','Old Oak Warren','Pine Needle Nook','Bramble Burrow','Mushroom Cellar','Stony Tunnel','Twilight Hole'];
  let ti=0;
  for(let tries=0;tunnels.length<9&&tries<3000;tries++){
    const a=rand()*Math.PI*2,rr=R(30,EDGE-6);const x=Math.cos(a)*rr,z=Math.sin(a)*rr;
    if(forestness(x,z)<.8)continue;if(tunnels.some(t=>Math.hypot(t.x-x,t.z-z)<16))continue;
    const rot=Math.atan2(-x,-z)+R(-.8,.8);const o=M.Burrow.clone();o.position.set(x,heightAt(x,z)-.04,z);o.rotation.y=rot;ZG.add(o);
    const ex=x+Math.sin(rot)*.95,ez=z+Math.cos(rot)*.95;
    tunnels.push({x,z,rot,ex,ez,found:false,name:tunnelNames[ti++],obj:o});addCollider(x,z,.62);avoid.push({x,z,r:3});
  }
  // a starter burrow near the meadow edge so players learn tunnels early
  {const x=-14,z=16;const rot=Math.atan2(-x,-z);const o=M.Burrow.clone();o.position.set(x,heightAt(x,z)-.04,z);o.rotation.y=rot;ZG.add(o);tunnels.unshift({x,z,rot,ex:x+Math.sin(rot)*.95,ez:z+Math.cos(rot)*.95,found:false,name:'Meadow Burrow',obj:o});addCollider(x,z,.62);avoid.push({x,z,r:3})}

  // --- hollow logs (walk-through cover)
  for(let tries=0;logs.length<7&&tries<2000;tries++){
    const a=rand()*Math.PI*2,rr=R(24,EDGE-4);const x=Math.cos(a)*rr,z=Math.sin(a)*rr;if(forestness(x,z)<.6)continue;if(avoid.some(p=>Math.hypot(p.x-x,p.z-z)<p.r+2))continue;
    const rot=rand()*Math.PI;const o=M.Log.clone();const y=(heightAt(x+Math.sin(rot)*.8,z+Math.cos(rot)*.8)+heightAt(x-Math.sin(rot)*.8,z-Math.cos(rot)*.8))/2-.03;
    o.position.set(x,y,z);o.rotation.y=rot;ZG.add(o);logs.push({x,z,rot});avoid.push({x,z,r:2.2});
    spots.push({type:'log',x:x+Math.sin(rot+Math.PI/2)*.42,z:z+Math.cos(rot+Math.PI/2)*.42,r:.4,ready:true,cd:0,obj:o});
  }
  // --- trees
  const treeMats={Oak:[],Oak2:[],Pine:[],Birch:[]};
  for(let tries=0;trees.length<290&&tries<30000;tries++){
    const a=rand()*Math.PI*2,rr=Math.sqrt(rand())*(EDGE+5);const x=Math.cos(a)*rr,z=Math.sin(a)*rr;const f=forestness(x,z);
    if(rand()>f*f)continue;if(distToPath(x,z)<1.6)continue;if(avoid.some(p=>Math.hypot(p.x-x,p.z-z)<p.r))continue;
    if(trees.some(t=>Math.hypot(t.x-x,t.z-z)<4.2))continue;
    const kind=pick({Oak:3,Oak2:3,Pine:3,Birch:2});const s=R(.8,1.25);const ry=rand()*Math.PI*2;
    treeMats[kind].push(mat4(x,heightAt(x,z)-.05,z,ry,s));
    const tr={Oak:.36,Oak2:.36,Pine:.26,Birch:.19}[kind]*s;const cr={Oak:3.2,Oak2:3.2,Pine:2.2,Birch:2.2}[kind]*s;
    trees.push({x,z,r:tr,canopy:cr,kind});addCollider(x,z,tr+.06);
  }
  // a few lone meadow trees for shade
  [[12,6],[-12,-2],[9,-13]].forEach(([x,z])=>{treeMats.Oak.push(mat4(x,heightAt(x,z)-.05,z,rand()*6,1.15));trees.push({x,z,r:.42,canopy:3.6});addCollider(x,z,.46)});
  for(const k in treeMats){const set=makeSet(k,treeMats[k],{chunk:24,view:130});set.parts.forEach(p=>{if(p.mat.name==='Leaves'||p.mat.name==='Needles')windify(p.mat,{amp:.012,hScale:1})})}
  // --- bushes (cover + berries)
  const bushMats=[];
  for(let tries=0;bushes.length<80&&tries<8000;tries++){
    const a=rand()*Math.PI*2,rr=Math.sqrt(rand())*EDGE;const x=Math.cos(a)*rr,z=Math.sin(a)*rr;const f=forestness(x,z);
    if(rand()>f*.9+.12)continue;if(distToPath(x,z)<1.2)continue;if(avoid.some(p=>Math.hypot(p.x-x,p.z-z)<p.r*.8))continue;
    if(trees.some(t=>Math.hypot(t.x-x,t.z-z)<t.r+.9))continue;if(bushes.some(b=>Math.hypot(b.x-x,b.z-z)<2.5))continue;
    const s=R(.85,1.3);const i=bushes.length;bushMats.push(mat4(x,heightAt(x,z)-.06,z,rand()*6,s));bushes.push({x,z,s,i,berries:true,cd:0});
  }
  const bushSet=makeSet('Bush',bushMats,{chunk:24,view:90});G.bushSet=bushSet;bushSet.mats=bushMats;
  bushSet.parts.forEach(p=>{if(p.mat.name==='Leaves')windify(p.mat,{amp:.02})});
  bushes.forEach(b=>spots.push({type:'bush',x:b.x,z:b.z,r:.55*b.s+.2,ready:true,cd:0,bush:b}));
  // --- rocks
  const rockMats={Rock:[],Rock2:[]};
  for(let n=0,tries=0;n<55&&tries<5000;tries++){const a=rand()*Math.PI*2,rr=Math.sqrt(rand())*EDGE;const x=Math.cos(a)*rr,z=Math.sin(a)*rr;
    if(distToPath(x,z)<1.4||avoid.some(p=>Math.hypot(p.x-x,p.z-z)<p.r))continue;if(trees.some(t=>Math.hypot(t.x-x,t.z-z)<t.r+1.2))continue;
    const s=R(.35,1.1);const k=rand()<.5?'Rock':'Rock2';rockMats[k].push(mat4(x,heightAt(x,z)-.08*s,z,rand()*6,s));addCollider(x,z,.95*s);
    if(s>.5)spots.push({type:'rock',x:x+.95*s+.12,z,r:.4,ready:true,cd:0});n++}
  for(const k in rockMats)makeSet(k,rockMats[k],{chunk:30,view:110});
  // --- leaf piles
  const lpMats=[];G.leafpiles=[];
  for(let tries=0;G.leafpiles.length<45&&tries<5000;tries++){const a=rand()*Math.PI*2,rr=Math.sqrt(rand())*EDGE;const x=Math.cos(a)*rr,z=Math.sin(a)*rr;
    if(forestness(x,z)<.5||avoid.some(p=>Math.hypot(p.x-x,p.z-z)<p.r*.7))continue;if(trees.some(t=>Math.hypot(t.x-x,t.z-z)<t.r+.6))continue;
    const s=R(.9,1.4),ry=rand()*6;const i=G.leafpiles.length;lpMats.push(mat4(x,heightAt(x,z)-.02,z,ry,s));const lp={x,z,s,ry,i};G.leafpiles.push(lp);
    spots.push({type:'leafpile',x,z,r:.45*s+.15,ready:true,cd:0,lp})}
  G.lpSet=makeSet('LeafPile',lpMats,{chunk:24,view:80,shadow:false});
  // --- ferns
  const fernM=[];for(let tries=0;fernM.length<420&&tries<12000;tries++){const a=rand()*Math.PI*2,rr=Math.sqrt(rand())*EDGE;const x=Math.cos(a)*rr,z=Math.sin(a)*rr;
    if(rand()>forestness(x,z)-.2||distToPath(x,z)<1)continue;if(avoid.some(p=>Math.hypot(p.x-x,p.z-z)<p.r*.6))continue;fernM.push(mat4(x,heightAt(x,z)-.02,z,rand()*6,R(.7,1.4)))}
  const fs=makeSet('Fern',fernM,{chunk:20,view:55,shadow:false});fs.parts.forEach(p=>windify(p.mat,{amp:.12}));
  // --- grass carpet (chunked, pushed by the guinea pig)
  const gm=[];
  for(let cz=-HALF;cz<HALF;cz+=1)for(let cx=-HALF;cx<HALF;cx+=1){
    const f=forestness(cx+.5,cz+.5);if(Math.hypot(cx,cz)>EDGE+4)continue;
    const dens=Math.round(lerp(15,4.5,f));
    for(let k=0;k<dens;k++){const x=cx+rand(),z=cz+rand();if(distToPath(x,z)<.45+rand()*.4)continue;
      if(Math.abs(x-HOME.x)<3.2&&Math.abs(z-HOME.z)<2.5)continue;if(boxes.some(b=>Math.abs(x-b.cx)<b.hx&&Math.abs(z-b.cz)<b.hz))continue;
      gm.push(mat4(x,heightAt(x,z)-.005,z,rand()*6,R(.7,1.35)*(f>.5?.8:1),0,0))}
  }
  const grassSet=makeSet('Grass',gm,{chunk:10,view:32,shadow:false});grassSet.parts.forEach(p=>windify(p.mat,{amp:.35,push:1.1,hScale:1,upN:true}));
  // --- lush grass patches (edible)
  const lushM=[];
  for(let tries=0;patches.length<55&&tries<6000;tries++){const a=rand()*Math.PI*2,rr=Math.sqrt(rand())*EDGE;const x=Math.cos(a)*rr,z=Math.sin(a)*rr;
    const f=forestness(x,z);if(f>.55&&rand()>.25)continue;if(distToPath(x,z)<1||avoid.some(p=>Math.hypot(p.x-x,p.z-z)<p.r*.7))continue;
    if(patches.some(p=>Math.hypot(p.x-x,p.z-z)<4))continue;if(trees.some(t=>Math.hypot(t.x-x,t.z-z)<t.r+.5))continue;
    const p={x,z,amount:1,idx:[],mats:[]};for(let k=0;k<11;k++){const ax=x+R(-.35,.35),az=z+R(-.35,.35);const m={x:ax,z:az,y:heightAt(ax,az)-.01,ry:rand()*6,s:R(.8,1.25)};p.idx.push(lushM.length);p.mats.push(m);lushM.push(mat4(m.x,m.y,m.z,m.ry,m.s))}
    patches.push(p)}
  G.lushSet=makeSet('LushGrass',lushM,{chunk:20,view:70,shadow:false});G.lushSet.parts.forEach(p=>windify(p.mat,{amp:.3,push:1.0,upN:true}));
  // --- pickable plants
  const defs=[['dandelion','Dandelion',70,f=>f<.45],['clover','Clover',70,f=>f<.8],['daisy','FlowerWhite',60,f=>f<.4],['violet','FlowerPurple',45,f=>f<.7]];
  for(const [type,model,n,test] of defs){
    const items=[],mats=[];for(let tries=0;items.length<n&&tries<n*80;tries++){const a=rand()*Math.PI*2,rr=Math.sqrt(rand())*EDGE;const x=Math.cos(a)*rr,z=Math.sin(a)*rr;
      if(!test(forestness(x,z))||distToPath(x,z)<.6||avoid.some(p=>Math.hypot(p.x-x,p.z-z)<p.r*.6))continue;if(boxes.some(b=>Math.abs(x-b.cx)<b.hx+.3&&Math.abs(z-b.cz)<b.hz+.3))continue;
      const it={type,x,z,y:heightAt(x,z)-.005,ry:rand()*6,s:type==='daisy'||type==='violet'?R(.65,.9):R(1.1,1.5),alive:true,respawn:0,i:items.length};items.push(it);mats.push(mat4(it.x,it.y,it.z,it.ry,it.s))}
    const set=makeSet(model,mats,{chunk:20,view:60,shadow:true});set.parts.forEach(p=>windify(p.mat,{amp:.4,push:.8,upN:model.startsWith('Clover')}));
    pickSets.push({type,items,set});
  }
  // --- humans
  const HUM=[{name:'Maya',x:5.2,z:2.8,shirt:0x3c7bd0,pants:0x2d3a4f,hair:0x3b2314,skin:0xf0c8a8},{name:'Leo',x:-4.6,z:-6.4,shirt:0xd2553f,pants:0x5b4a3a,hair:0x151010,skin:0xc48a5e},{name:'Grandma June',x:-8.5,z:5.5,shirt:0x6fb36a,pants:0x50466b,hair:0xdedad2,skin:0xf3d2bf}];
  for(const h of HUM){const o=M.Human.clone(true);o.traverse(m=>{if(m.isMesh){const n=m.material.name;if(['Shirt','Pants','Hair','HumanSkin'].includes(n)){m.material=m.material.clone();m.material.color.set({Shirt:h.shirt,Pants:h.pants,Hair:h.hair,HumanSkin:h.skin}[n]);}}});
    const face=Math.atan2(-h.x,-h.z);o.position.set(h.x,heightAt(h.x,h.z)-.02,h.z);o.rotation.y=face;ZG.add(o);
    const arm=o.getObjectByName('ArmR');humans.push({...h,obj:o,arm,face,petBudget:6,cd:0,tossCD:0,petting:false,t:rand()*5,visible:true,fade:1});addCollider(h.x,h.z+.1,.32)}
  // meadow boundary soft wall & world edge
}

// ============================================================ the other zones
// Each zone is a recipe for buildBiome: its terrain, ground colours and how much of each thing grows where, plus its
// own props (buildings, water, a maze). Heights and colours are plain functions of x,z; placement uses the zone's rand.
const rimLift=(x,z,k=7)=>smooth(58,74,Math.hypot(x,z))*k;
function lineDist(x,z,pts){let best=1e9;for(let i=0;i<pts.length-1;i++){const[ax,az]=pts[i],[bx,bz]=pts[i+1];const dx=bx-ax,dz=bz-az;const t=clamp(((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz),0,1);best=Math.min(best,Math.hypot(x-ax-dx*t,z-az-dz*t))}return best}
const mixc=(a,b,t)=>[lerp(a[0],b[0],t),lerp(a[1],b[1],t),lerp(a[2],b[2],t)];
const wet=(x,z,m=.02)=>Z.waterY!==undefined&&heightAt(x,z)<Z.waterY+m;
function freeAt(x,z,pad=0){if(wet(x,z,.05)||insideBox(x,z,pad))return false;for(const c of colliders){if(Math.abs(c.x-x)<c.r+pad&&Math.abs(c.z-z)<c.r+pad&&Math.hypot(c.x-x,c.z-z)<c.r+pad)return false}return true}
function ringPos(min=0,max=EDGE-1){const a=rand()*Math.PI*2,rr=min+Math.sqrt(rand())*(max-min);return [Math.cos(a)*rr,Math.sin(a)*rr]}
const tintWith=c=>m=>{m.color.lerp(new THREE.Color(c[0]),c[1]);return m};
function addHuman(h){const o=M.Human.clone(true);o.traverse(m=>{if(m.isMesh){const n=m.material.name;if(['Shirt','Pants','Hair','HumanSkin'].includes(n)){m.material=m.material.clone();m.material.color.set({Shirt:h.shirt,Pants:h.pants,Hair:h.hair,HumanSkin:h.skin}[n])}}});
  const face=h.face??Math.atan2(-h.x,-h.z);o.position.set(h.x,heightAt(h.x,h.z)-.02,h.z);o.rotation.y=face;ZG.add(o);
  humans.push({...h,obj:o,arm:o.getObjectByName('ArmR'),face,petBudget:6,cd:0,tossCD:0,petting:false,t:rand()*5,visible:true,fade:1});addCollider(h.x,h.z+.1,.32)}
function addBuilding(model,x,z,{rot=0,scale=1,tint=null,hx=3.05,hz=2.3}={}){const o=M[model].clone(true);
  o.traverse(m=>{if(!m.isMesh)return;const n=m.material.name;if(tint&&tint[n]!==undefined){m.material=m.material.clone();m.material.color.set(tint[n])}
    if(n==='Glass'){m.material=m.material.clone();m.material.emissive=new THREE.Color(0xffb35c);m.material.emissiveIntensity=0;Z.windows.push(m.material)}});
  const sw=Math.abs(Math.sin(rot))>.5,bx=(sw?hz:hx)*scale,bz=(sw?hx:hz)*scale;
  const y=Math.min(heightAt(x-bx,z-bz),heightAt(x+bx,z-bz),heightAt(x-bx,z+bz),heightAt(x+bx,z+bz))-.05;
  o.position.set(x,y,z);o.rotation.y=rot;o.scale.setScalar(scale);ZG.add(o);boxes.push({cx:x,cz:z,hx:bx,hz:bz});Z.avoid.push({x,z,r:Math.max(bx,bz)+1.5});if(model==='Barn')Z.barns.push({obj:o,scale});if(model==='Shop')Z.shops.push({obj:o,scale});return o}
function fenceLine(ax,az,bx,bz,mats){const L=Math.hypot(bx-ax,bz-az),n=Math.max(1,Math.round(L/2)),ry=Math.atan2(-(bz-az),bx-ax);
  for(let i=0;i<n;i++){const x=ax+(bx-ax)*i/n,z=az+(bz-az)*i/n;mats.push(mat4(x,heightAt(x,z),z,ry,1,0,0))}}
function addProp(model,x,z,{rot=rand()*6,scale=1,r=0,y=null}={}){const o=M[model].clone(true);o.position.set(x,y??heightAt(x,z)-.02,z);o.rotation.y=rot;o.scale.setScalar(scale);ZG.add(o);if(r)addCollider(x,z,r*scale);Z.avoid&&Z.avoid.push({x,z,r:Math.max(1,r*2)});return o}
// street lamps: the lanterns (and a soft glow round each) light up at night
function lampPosts(pts){if(!pts.length)return;const lm=pts.map(([x,z])=>{addCollider(x,z,.08);return mat4(x,heightAt(x,z)-.02,z,0,1)});
  makeSet('LampPost',lm,{chunk:30,view:120,tint:{Lamp:m=>{m.emissive=new THREE.Color(0xffc070);m.emissiveIntensity=0;Z.lamps.push(m);return m}}});
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pts.flatMap(([x,z])=>[x,heightAt(x,z)+2.74,z]),3));
  const pm=new THREE.PointsMaterial({map:glowTex,color:0xffc070,size:1.6,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending});ZG.add(new THREE.Points(g,pm));Z.lamps.push({glow:pm})}
// animals that wander inside an area (a pen, a paddock) or paddle about on a pond
const CRITTER={Goat:{r:.3,speed:.55,sfx:'baa',say:'🐐 A goat! It gives you a friendly sniff.'},Sheep:{r:.33,speed:.4,sfx:'baa',say:'🐑 A fluffy sheep! Baa!'},Duck:{r:.14,speed:.35,sfx:'quack',say:'🦆 Quack! A duck paddles over to say hello.',swim:true,meet:2.4}};
function inArea(a){if(a.r){for(let k=0;k<60;k++){const ang=rand()*Math.PI*2,rr=Math.sqrt(rand())*a.r,x=a.x+Math.cos(ang)*rr,z=a.z+Math.sin(ang)*rr;if(!a.water||wet(x,z,-.1))return {x,z}}return {x:a.x,z:a.z}}return {x:R(a.x0,a.x1),z:R(a.z0,a.z1)}}
function addCritters(kind,n,area){for(let i=0;i<n;i++){const o=M[kind].clone(true);ZG.add(o);const p=inArea(area);
  Z.critters.push({kind,obj:o,legs:['LegFL','LegFR','LegBL','LegBR'].map(k=>o.getObjectByName(k)).filter(Boolean),area,x:p.x,z:p.z,tx:p.x,tz:p.z,heading:rand()*Math.PI*2,t:R(0,4),phase:rand()*6,moving:false,sayT:R(4,12)})}}
function updateCritters(dt,t){
  for(const c of Z.critters){const C=CRITTER[c.kind];c.t-=dt;
    const px=pig.pos.x-c.x,pz=pig.pos.z-c.z,pd=Math.hypot(px,pz);
    if(c.t<=0){if(c.moving){c.moving=false;c.t=R(2,6)}else{const p=inArea(c.area);c.tx=p.x;c.tz=p.z;c.moving=true;c.t=R(4,9);
      // ducks paddle over to a guinea pig on the bank: the deep water in their patch nearest to it
      if(C.swim&&pd<7){const a=c.area,ax=pig.pos.x-a.x,az=pig.pos.z-a.z,al=Math.hypot(ax,az)||1;for(let k=1;k>=0;k-=.1){const x=a.x+ax/al*a.r*k,z=a.z+az/al*a.r*k;if(wet(x,z,-.1)){c.tx=x;c.tz=z;c.t=R(3,5);break}}}}}
    const dx=c.tx-c.x,dz=c.tz-c.z,d=Math.hypot(dx,dz);let sp=0;
    if(c.moving&&d>.12){c.heading+=angDiff(c.heading,Math.atan2(dx,dz))*Math.min(1,dt*3);sp=C.speed;c.x+=Math.sin(c.heading)*sp*dt;c.z+=Math.cos(c.heading)*sp*dt}else if(c.moving){c.moving=false;c.t=R(2,6)}
    if(!C.swim&&pd<C.r+.1&&pd>1e-4){const k=(C.r+.1-pd)/pd;pig.pos.x+=px*k;pig.pos.z+=pz*k}
    if(pd<(C.meet||1.4)){if(!G.met[c.kind]){G.met[c.kind]=1;toast(C.say,'good',4);G.happy=Math.min(100,G.happy+10);addScore(40,'new friend!','#ff9fd0');SFX[C.sfx]()}else if((c.sayT-=dt)<=0){c.sayT=R(6,14);SFX[C.sfx]()}}
    c.obj.position.set(c.x,C.swim?Z.waterY-.03+Math.sin(t*2+c.phase)*.008:heightAt(c.x,c.z),c.z);c.obj.rotation.y=c.heading;
    if(c.legs.length){c.phase+=dt*sp*14;const sw=sp?Math.sin(c.phase)*.45:0;c.legs[0].rotation.x=sw;c.legs[3].rotation.x=sw;c.legs[1].rotation.x=-sw;c.legs[2].rotation.x=-sw}}}
// traffic: cars drive each lane and loop round, keep their distance and take turns at the crossroads. Look both ways!
const CAR_COLS=[0xd83a3a,0x3a6ad8,0xf0c030,0x3aa860,0xf0f0f0,0x303238,0xe07a30];
function addTraffic(lanes){for(const L of lanes)for(let i=0;i<L.n;i++){const o=M.Car.clone(true),col=CAR_COLS[Math.floor(rand()*CAR_COLS.length)];
  o.traverse(m=>{if(!m.isMesh)return;if(m.material.name==='CarPaint'){m.material=m.material.clone();m.material.color.set(col)}if(m.material.name==='Light'&&!Z.lamps.includes(m.material)){m.material.emissive=new THREE.Color(0xfff0c0);Z.lamps.push(m.material)}});
  ZG.add(o);Z.cars.push({obj:o,lane:L,s:-80+i*160/L.n+R(-8,8),v:6,wait:0,honkT:0})}}
const carXZ=c=>c.lane.axis==='x'?[c.s*c.lane.dir,c.lane.off]:[c.lane.off,c.s*c.lane.dir];
function updateCars(dt){const cars=Z.cars;G.carT=Math.max(0,(G.carT||0)-dt);
  const inCross=c=>{const [x,z]=carXZ(c);return Math.abs(x-Z.cross[0])<4.5&&Math.abs(z-Z.cross[1])<4.5};
  for(const c of cars){if(c.wait>0){c.wait-=dt;c.obj.visible=false;continue}c.obj.visible=true;
    let want=7;const sc=(c.lane.axis==='x'?Z.cross[0]:Z.cross[1])*c.lane.dir,toCross=sc-4.5-(c.s+2);
    for(const o of cars)if(o!==c&&o.lane===c.lane&&o.wait<=0){const gap=o.s-c.s;if(gap>0&&gap<9)want=Math.min(want,Math.max(0,(gap-5)*2))}
    if(toCross>0&&toCross<5&&cars.some(o=>o!==c&&o.lane.axis!==c.lane.axis&&o.wait<=0&&inCross(o)))want=0;
    c.v=lerp(c.v,want,Math.min(1,dt*2.5));c.s+=c.v*dt;if(c.s>84){c.s=-84;c.wait=R(1,6);continue}
    const [x,z]=carXZ(c),ry=c.lane.axis==='x'?(c.lane.dir>0?Math.PI/2:-Math.PI/2):(c.lane.dir>0?0:Math.PI);c.obj.position.set(x,heightAt(x,z),z);c.obj.rotation.y=ry;
    const fx=Math.sin(ry),fz=Math.cos(ry),dx=pig.pos.x-x,dz=pig.pos.z-z,al=dx*fx+dz*fz,lat=dx*fz-dz*fx;
    if(Math.abs(al)<2.1&&Math.abs(lat)<.95&&c.v>1&&!pig.air&&!G.hidden&&G.carT<=0){G.carT=2;damage(20,'got bumped by a car');const k=Math.sign(lat)||1;pig.vel.set(fx*c.v*.5+fz*k*3,0,fz*c.v*.5-fx*k*3);pig.vy=2;pig.air=true;SFX.honk();toast('🚗 <b>Honk!</b> A car bumped you. Look both ways!','bad',4)}
    c.honkT-=dt;if(al>2&&al<13&&Math.abs(lat)<1.3&&c.v>3&&c.honkT<=0){c.honkT=4;SFX.honk()}
    c.warn=al>2&&al<16&&Math.abs(lat)<1.5&&c.v>2}}

// water: one sheet at the zone's water level, shown wherever the ground dips below it
const waterNormal=(()=>{const n=256,c=document.createElement('canvas');c.width=c.height=n;const g=c.getContext('2d'),img=g.createImageData(n,n);
  const H=(x,y)=>Math.sin(x*.098+y*.05)*.5+Math.sin(x*.049-y*.147+1)*.35+Math.sin((x+y)*.196)*.15+vnoise(x*.06,y*.06)*.4;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){const dx=H(x+1,y)-H(x-1,y),dy=H(x,y+1)-H(x,y-1),i=(y*n+x)*4;img.data[i]=128+dx*90;img.data[i+1]=128+dy*90;img.data[i+2]=255;img.data[i+3]=255}
  g.putImageData(img,0,0);const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(24,24);return t})();
const waterMat=new THREE.MeshStandardMaterial({color:0x2d7196,roughness:.12,metalness:.05,transparent:true,opacity:.8,normalMap:waterNormal,normalScale:new THREE.Vector2(.35,.35),depthWrite:false});
function addWater(y,size=150){const m=new THREE.Mesh(new THREE.PlaneGeometry(size,size),waterMat);m.rotation.x=-Math.PI/2;m.position.y=y;m.receiveShadow=true;ZG.add(m);Z.waterY=y}
// a signpost just inside the rim wherever a neighbouring zone lies, so the ways out are easy to find
function addSignposts(z){
  const post=new THREE.CylinderGeometry(.03,.035,.72,8),wood=new THREE.MeshStandardMaterial({color:0x7a5534,roughness:.9});
  for(let s=0;s<8;s++){const nb=neighbour(z,s);if(!nb)continue;const a=s*Math.PI/4;let r=EDGE-4.5,x,zz;
    for(;r>EDGE-16;r-=.5){x=Math.cos(a)*r;zz=Math.sin(a)*r;if(freeAt(x,zz,.4))break}
    const g=new THREE.Group();const p=new THREE.Mesh(post,wood);p.position.y=.36;g.add(p);
    const tex=canvasTex(512,128,(c,w,h)=>{c.fillStyle='#8a6038';c.fillRect(0,0,w,h);c.strokeStyle='#5a3a1e';c.lineWidth=10;c.strokeRect(5,5,w-10,h-10);c.fillStyle='#fff3d8';c.font='600 50px Fredoka, sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(`${nb.icon} ${nb.name}`,w/2,h/2+3)});
    const board=new THREE.Mesh(new THREE.BoxGeometry(.9,.22,.03),[wood,wood,wood,wood,new THREE.MeshStandardMaterial({map:tex,roughness:.8}),new THREE.MeshStandardMaterial({map:tex,roughness:.8})]);
    board.position.y=.6;g.add(board);g.position.set(x,heightAt(x,zz)-.02,zz);g.rotation.y=Math.atan2(-x,-zz);g.traverse(o=>{if(o.isMesh)o.castShadow=true});ZG.add(g);addCollider(x,zz,.06)}}

function buildBiome(z){
  buildTerrain();
  const C=z.cfg,avoid=[];z.avoid=avoid;
  if(z.water!==undefined)addWater(z.water,z.waterSize);
  if(C.props)C.props(avoid);
  const near=(x,z,k=1)=>avoid.some(p=>Math.hypot(p.x-x,p.z-z)<p.r*k);
  // burrows (hide, nap)
  for(const name of C.burrows||[])for(let k=0;k<600;k++){const [x,zz]=ringPos(10,EDGE-8);
    if(!freeAt(x,zz,1)||distToPath(x,zz)<2||near(x,zz,1.2)||tunnels.some(t=>Math.hypot(t.x-x,t.z-zz)<14))continue;
    const rot=Math.atan2(-x,-zz)+R(-.8,.8),ex=x+Math.sin(rot)*.95,ez=zz+Math.cos(rot)*.95;if(wet(ex,ez,.05))continue;
    const o=M.Burrow.clone();o.position.set(x,heightAt(x,zz)-.04,zz);o.rotation.y=rot;ZG.add(o);
    tunnels.push({x,z:zz,rot,ex,ez,found:false,name,obj:o});addCollider(x,zz,.62);avoid.push({x,z:zz,r:3});break}
  // hollow logs
  for(let n=0,t=0;n<(C.logs||0)&&t<4000;t++){const [x,zz]=ringPos(8,EDGE-4);if(forestness(x,zz)<(C.logForest??.4)||!freeAt(x,zz,1)||distToPath(x,zz)<1.5||near(x,zz))continue;
    const rot=rand()*Math.PI,o=M.Log.clone(),y=(heightAt(x+Math.sin(rot)*.8,zz+Math.cos(rot)*.8)+heightAt(x-Math.sin(rot)*.8,zz-Math.cos(rot)*.8))/2-.03;
    o.position.set(x,y,zz);o.rotation.y=rot;ZG.add(o);logs.push({x,z:zz,rot});avoid.push({x,z:zz,r:2.2});
    spots.push({type:'log',x:x+Math.sin(rot+Math.PI/2)*.42,z:zz+Math.cos(rot+Math.PI/2)*.42,r:.4,ready:true,cd:0,obj:o});n++}
  // trees
  const T=C.trees;if(T){const mats={};for(const k in T.kinds)mats[k]=[];
    for(let t=0;trees.length<T.n&&t<T.n*150;t++){const [x,zz]=ringPos(0,EDGE+5);const f=forestness(x,zz);
      if(rand()>f*f||distToPath(x,zz)<1.6||near(x,zz)||!freeAt(x,zz,.4))continue;if(trees.some(q=>Math.abs(q.x-x)<(T.gap||4.2)&&Math.hypot(q.x-x,q.z-zz)<(T.gap||4.2)))continue;
      const kind=pick(T.kinds),s=R(...(T.scale||[.8,1.25]));mats[kind].push(mat4(x,heightAt(x,zz)-.05,zz,rand()*Math.PI*2,s));
      const tr={Oak:.36,Oak2:.36,Pine:.26,Birch:.19}[kind]*s,cr={Oak:3.2,Oak2:3.2,Pine:2.2,Birch:2.2}[kind]*s;trees.push({x,z:zz,r:tr,canopy:cr,kind});addCollider(x,zz,tr+.06)}
    for(const k in mats)if(mats[k].length){const set=makeSet(k,mats[k],{chunk:24,view:130,tint:T.tint});set.parts.forEach(p=>{if(p.mat.name==='Leaves'||p.mat.name==='Needles')windify(p.mat,{amp:.012,hScale:1})})}}
  // bushes (cover, berries)
  if(C.bushes){const bm=[];for(let t=0;bushes.length<C.bushes&&t<C.bushes*100;t++){const [x,zz]=ringPos();const f=forestness(x,zz);
      if(rand()>f*.9+.12||distToPath(x,zz)<1.2||near(x,zz,.8)||!freeAt(x,zz,.5))continue;if(trees.some(q=>Math.hypot(q.x-x,q.z-zz)<q.r+.9)||bushes.some(b=>Math.hypot(b.x-x,b.z-zz)<2.5))continue;
      const s=R(.85,1.3),i=bushes.length;bm.push(mat4(x,heightAt(x,zz)-.06,zz,rand()*6,s));bushes.push({x,z:zz,s,i,berries:true,cd:0})}
    const set=makeSet('Bush',bm,{chunk:24,view:90,tint:C.bushTint});G.bushSet=set;set.mats=bm;set.parts.forEach(p=>{if(p.mat.name==='Leaves')windify(p.mat,{amp:.02})});
    bushes.forEach(b=>spots.push({type:'bush',x:b.x,z:b.z,r:.55*b.s+.2,ready:true,cd:0,bush:b}))}
  // rocks
  if(C.rocks){const rm={Rock:[],Rock2:[]};for(let n=0,t=0;n<C.rocks&&t<C.rocks*100;t++){const [x,zz]=ringPos();if(C.rockTest&&!C.rockTest(x,zz))continue;
      if(distToPath(x,zz)<1.4||near(x,zz)||!freeAt(x,zz,.8))continue;const s=R(...(C.rockScale||[.35,1.1])),k=rand()<.5?'Rock':'Rock2';
      rm[k].push(mat4(x,heightAt(x,zz)-.08*s,zz,rand()*6,s));addCollider(x,zz,.95*s);if(s>.5&&freeAt(x+.95*s+.12,zz))spots.push({type:'rock',x:x+.95*s+.12,z:zz,r:.4,ready:true,cd:0});n++}
    for(const k in rm)if(rm[k].length)makeSet(k,rm[k],{chunk:30,view:110,tint:C.rockTint})}
  // leaf piles
  if(C.leafpiles){const lm=[];for(let t=0;G.leafpiles.length<C.leafpiles&&t<C.leafpiles*100;t++){const [x,zz]=ringPos();
      if(forestness(x,zz)<.5||near(x,zz,.7)||!freeAt(x,zz,.3)||trees.some(q=>Math.hypot(q.x-x,q.z-zz)<q.r+.6))continue;
      const s=R(.9,1.4),ry=rand()*6,i=G.leafpiles.length;lm.push(mat4(x,heightAt(x,zz)-.02,zz,ry,s));const lp={x,z:zz,s,ry,i};G.leafpiles.push(lp);spots.push({type:'leafpile',x,z:zz,r:.45*s+.15,ready:true,cd:0,lp})}
    G.lpSet=makeSet('LeafPile',lm,{chunk:24,view:80,shadow:false})}
  // ferns
  if(C.ferns){const fm=[];for(let t=0;fm.length<C.ferns&&t<C.ferns*30;t++){const [x,zz]=ringPos(0,EDGE);if(rand()>forestness(x,zz)-.2||distToPath(x,zz)<1||near(x,zz,.6)||wet(x,zz))continue;fm.push(mat4(x,heightAt(x,zz)-.02,zz,rand()*6,R(.7,1.4)))}
    makeSet('Fern',fm,{chunk:20,view:55,shadow:false,tint:C.fernTint}).parts.forEach(p=>windify(p.mat,{amp:.12}))}
  // decor sets that are only looked at: [model, count, test(x,z), scale range]
  for(const [model,n,test,sc,opt] of C.decor||[]){const dm=[];for(let t=0;dm.length<n&&t<n*60;t++){const [x,zz]=ringPos(0,EDGE+2);if(!test(x,zz)||near(x,zz,.5)||!freeAt(x,zz,.2))continue;dm.push(mat4(x,heightAt(x,zz)-.02,zz,rand()*6,R(...sc)))}
    if(dm.length){const set=makeSet(model,dm,{chunk:20,view:70,shadow:true,...(opt||{})});if(opt&&opt.wind)set.parts.forEach(p=>windify(p.mat,opt.wind))}}
  // grass carpet
  if(C.grass){const gm=[];for(let cz=-HALF;cz<HALF;cz++)for(let cx=-HALF;cx<HALF;cx++){if(Math.hypot(cx,cz)>EDGE+4)continue;const d=C.grass(cx+.5,cz+.5),dens=Math.floor(d)+(rand()<d%1?1:0);
      for(let k=0;k<dens;k++){const x=cx+rand(),zz=cz+rand();if(distToPath(x,zz)<.45+rand()*.4||insideBox(x,zz)||wet(x,zz))continue;gm.push(mat4(x,heightAt(x,zz)-.005,zz,rand()*6,R(.7,1.35)*(C.grassScale||1)))}}
    makeSet('Grass',gm,{chunk:10,view:32,shadow:false,tint:C.grassTint}).parts.forEach(p=>windify(p.mat,{amp:.35,push:1.1,hScale:1,upN:true}))}
  // lush grass patches (hold E to munch)
  if(C.lush){const lm=[];for(let t=0;patches.length<C.lush&&t<C.lush*120;t++){const [x,zz]=ringPos();if(C.lushTest&&!C.lushTest(x,zz))continue;
      if(distToPath(x,zz)<1||near(x,zz,.7)||!freeAt(x,zz,.5)||patches.some(p=>Math.hypot(p.x-x,p.z-zz)<4))continue;
      const p={x,z:zz,amount:1,idx:[],mats:[]};for(let k=0;k<11;k++){const ax=x+R(-.35,.35),az=zz+R(-.35,.35);const m={x:ax,z:az,y:heightAt(ax,az)-.01,ry:rand()*6,s:R(.8,1.25)};p.idx.push(lm.length);p.mats.push(m);lm.push(mat4(m.x,m.y,m.z,m.ry,m.s))}
      patches.push(p)}
    G.lushSet=makeSet('LushGrass',lm,{chunk:20,view:70,shadow:false,tint:C.grassTint});G.lushSet.parts.forEach(p=>windify(p.mat,{amp:.3,push:1.0,upN:true}))}
  // pickable plants: [item, model, count, test(x,z)]
  for(const [type,model,n,test,sc] of C.picks||[]){const items=[],mats=[];
    for(let t=0;items.length<n&&t<n*80;t++){const [x,zz]=ringPos();if(!test(x,zz)||distToPath(x,zz)<.6||near(x,zz,.6)||!freeAt(x,zz,.3))continue;
      const it={type,x,z:zz,y:heightAt(x,zz)-.005,ry:rand()*6,s:sc?R(...sc):type==='daisy'||type==='violet'?R(.65,.9):R(1.1,1.5),alive:true,respawn:0,i:items.length};items.push(it);mats.push(mat4(it.x,it.y,it.z,it.ry,it.s))}
    if(!items.length)continue;const set=makeSet(model,mats,{chunk:20,view:60,shadow:true});set.parts.forEach(p=>windify(p.mat,{amp:.4,push:.8,upN:model.startsWith('Clover')}));pickSets.push({type,items,set})}
  for(const h of C.humans||[])addHuman(h);
  // added after the zone's first release: placed from a sequence of their own so the rest of the zone stays where it was
  if(C.extra){rand=mulberry32(z.seed+101);C.extra(avoid,(x,zz,pad=1)=>freeAt(x,zz,pad)&&!near(x,zz)&&!spots.some(s=>Math.hypot(s.x-x,s.z-zz)<2)&&!patches.some(p=>Math.hypot(p.x-x,p.z-zz)<1.2))}
}
// a forage spot that comes with its own prop: the zones' signature treats. off moves the spot out in front of the prop
function spotProp(model,type,x,z,{rot=0,scale=1,r=0,sr=.45,off=0,box=null,y=null}={}){
  const o=addProp(model,x,z,{rot,scale,r,y});const sx=x+Math.sin(rot)*off*scale,sz=z+Math.cos(rot)*off*scale;
  if(box){const sw=Math.abs(Math.sin(rot))>.5;boxes.push({cx:x,cz:z,hx:(sw?box[1]:box[0])*scale,hz:(sw?box[0]:box[1])*scale})}
  spots.push({type,x:sx,z:sz,r:sr*scale,ready:true,cd:0,obj:o});return o}
// try a spot, then rings around it, until ok(x,z) passes
function nearFree(x,z,ok,step=.7,max=6){if(ok(x,z))return [x,z];for(let r=step;r<=max;r+=step)for(let k=0;k<12;k++){const a=k/12*Math.PI*2,px=x+Math.cos(a)*r,pz=z+Math.sin(a)*r;if(ok(px,pz))return [px,pz]}return null}

// ---- Snowcap Peaks: snowfields and pines under a wall of mountains to the north, with a frozen pond
const PEAK_TRAIL=[[0,72],[4,50],[-3,32],[5,14],[0,0]];
defineZone({id:'peaks',blurb:'Snowy slopes and frosted pines. Brr! The cold drains your energy, so huddle or nap to warm up. Try sliding on the frozen pond, and dig in the snowdrifts for rose hips.',name:'Snowcap Peaks',icon:'❄️',gx:0,gz:-1,seed:3101,sig:'rosehip',snow:true,cold:true,fog:.8,fogTint:[0xe8f0ff,.55],
  ice:(x,z)=>Math.hypot((x+16)/9,(z+14)/6)<1,
  height(x,z){const r=Math.hypot(x,z),north=smooth(10,-60,z)*smooth(40,74,r);let h=fbm(x*.018+3,z*.018,4)*4.5+fbm(x*.06,z*.06,3)*.8;
    h+=rimLift(x,z,8)+north*(22+Math.abs(fbm(x*.03,z*.03+9,4))*40);const pond=Math.hypot((x+16)/9,(z+14)/6);if(pond<1.35)h=lerp(h,.4,1-smooth(1,1.35,pond));
    return h-(1-smooth(0,1.4,lineDist(x,z,PEAK_TRAIL)))*.05},
  forest:(x,z)=>clamp(.55+fbm(x*.04+2,z*.04,3)*1.1,0,1)*(1-smooth(6,1,Math.hypot((x+16)/9,(z+14)/6)*6)),
  path:(x,z)=>lineDist(x,z,PEAK_TRAIL),
  ground(x,z,h){const n=fbm(x*.2,z*.2,3)*.5+.5,rock=smooth(.25,.55,fbm(x*.07+5,z*.07,3))*smooth(2,6,h)+smooth(14,24,h)*.3;
    let c=mixc([.86,.9,.97],[.95,.97,1],n);c=mixc(c,[.42,.42,.46],rock*.8);if(Math.hypot((x+16)/9,(z+14)/6)<1.02)c=[.72,.85,.95];
    const tr=1-smooth(.3,1,lineDist(x,z,PEAK_TRAIL));return mixc(c,[.78,.8,.86],tr*.6)},
  build:buildBiome,cfg:{
    burrows:['Snowdrift Den','Frosty Hollow','Icicle Burrow'],logs:4,
    trees:{n:170,kinds:{Pine:6,Birch:1},scale:[.8,1.4],tint:{Needles:tintWith([0xffffff,.32]),Leaves:tintWith([0xffffff,.45])}},
    bushes:22,bushTint:{Leaves:tintWith([0xffffff,.35])},rocks:70,rockTint:{Stone:tintWith([0xdfe6f0,.25])},
    grass:(x,z)=>Math.max(0,fbm(x*.08,z*.08,2))*6,grassTint:{Grass:tintWith([0xd8c890,.55])},lush:8,
    picks:[['clover','Clover',20,()=>true],['dandelion','Dandelion',12,()=>true]],
    props(){const ice=new THREE.Mesh(new THREE.CircleGeometry(1,48),new THREE.MeshStandardMaterial({color:0xcfe8f5,roughness:.06,metalness:.1,transparent:true,opacity:.92}));
      ice.rotation.x=-Math.PI/2;ice.scale.set(9.1,6.1,1);ice.position.set(-16,.43,-14);ice.receiveShadow=true;ZG.add(ice);Z.avoid.push({x:-16,z:-14,r:10})},
    extra(avoid,ok){// snowdrifts over wild rose bushes: dig for rose hips
      for(let n=0,t=0;n<10&&t<3000;t++){const [x,z]=ringPos(8,EDGE-6);if(Math.hypot((x+16)/9,(z+14)/6)<1.4||heightAt(x,z)>6||distToPath(x,z)<1.5||!ok(x,z,1.2))continue;
        const s=R(.85,1.15);spotProp('Snowdrift','drift',x,z,{rot:rand()*6,scale:s,r:.4,sr:.62});n++}}}});

// ---- The Deep Wood: giant old trees, ferns, logs and mushrooms, dim and misty even at noon
const DEEP_TRAIL=[[-72,20],[-50,14],[-30,20],[-12,8],[0,-4],[14,-10],[30,-30]];
defineZone({id:'deepwood',blurb:'Ancient trees and deep shade. Rare mushrooms and four-leaf clovers hide under the leaves, and wild raspberries tangle round the glades, but the foxes are bolder here.',name:'The Deep Wood',icon:'🌲',gx:1,gz:-1,seed:3202,sig:'raspleaf',fog:.42,fogTint:[0x4a6a50,.45],fireflies:.55,loot:{chanterelle:2.2,clover4:2,goldDandelion:1.5},foxes:2,
  height:(x,z)=>fbm(x*.014+20,z*.014,4)*4+fbm(x*.07,z*.07,3)*.6+rimLift(x,z,9),
  forest:(x,z)=>{const glade=Math.min(Math.hypot(x-4,z+2)/9,Math.hypot(x+34,z-30)/7,Math.hypot(x-30,z-26)/6);return clamp(smooth(.7,1.2,glade)*.97+fbm(x*.05,z*.05,2)*.1,0,1)},
  path:(x,z)=>lineDist(x,z,DEEP_TRAIL),
  ground(x,z){const n=fbm(x*.25+9,z*.25,3)*.5+.5,m=smooth(-.2,.4,fbm(x*.06,z*.06+4,3));let c=mixc([.26,.2,.12],[.2,.26,.12],m);c=mixc(c,[.34,.28,.16],n*.4);
    return mixc(c,[.36,.3,.2],(1-smooth(.3,1,lineDist(x,z,DEEP_TRAIL)))*.5)},
  build:buildBiome,cfg:{
    burrows:['Ancient Root Den','Owl Hollow','Moonlit Burrow'],logs:14,logForest:.3,
    trees:{n:330,kinds:{Oak:4,Oak2:4,Pine:2},scale:[1.3,2.2],gap:4.6},
    bushes:45,rocks:40,leafpiles:80,ferns:1100,
    decor:[['MushroomBrown',70,(x,z)=>forestness(x,z)>.6,[.7,1.6]],['MushroomRed',40,(x,z)=>forestness(x,z)>.6,[.7,1.5]]],
    grass:(x,z)=>lerp(9,2.5,forestness(x,z)),lush:16,lushTest:(x,z)=>forestness(x,z)<.6,
    picks:[['clover','Clover',50,()=>true],['violet','FlowerPurple',40,()=>true]],
    extra(avoid,ok){// raspberry brambles round the edges of the glades (thorny, so the hawk can't get you in there)
      for(let n=0,t=0;n<10&&t<3000;t++){const [x,z]=ringPos(6,EDGE-5),f=forestness(x,z);if(f<.25||f>.8||distToPath(x,z)<1.2||!ok(x,z,.9))continue;
        const s=R(.85,1.15);spotProp('Bramble','bramble',x,z,{rot:rand()*6,scale:s,sr:.5});Z.cover.push({x,z,r:.5*s});n++}}}});

// ---- Downtown: a small town, Main Street and Elm Street, houses, lawns and a town square
const MAIN_Z=0,ELM_X=14;
const townPath=(x,z)=>Math.max(0,Math.min(Math.abs(z-MAIN_Z),Math.abs(x-ELM_X))-5.2)+(Math.hypot(x,z)>EDGE+4?9:0);
defineZone({id:'town',blurb:'Shops, a fountain square with a little market, and lots of friendly humans. Wheek for veggies, and look both ways before you cross!',name:'Downtown',icon:'🏙️',gx:1,gz:0,seed:3303,sig:'romaine',toss:{romaine:35,carrot:25,strawberry:20,pepper:18,goldCarrot:2},fog:1.1,edgeMsg:'🚗 That road leads to the highway. Much too busy for a guinea pig!',
  height:(x,z)=>fbm(x*.01,z*.01,3)*.6*smooth(8,30,Math.min(Math.abs(z),Math.abs(x-ELM_X)))+rimLift(x,z,5),
  forest:(x,z)=>smooth(64,74,Math.hypot(x,z)),
  path:townPath,
  ground(x,z){const dm=Math.abs(z-MAIN_Z),de=Math.abs(x-ELM_X),d=Math.min(dm,de),n=fbm(x*.3,z*.3,2)*.5+.5;
    if(d<3){const dash=(dm<.12&&(((x%4)+4)%4)<2&&de>3)||(de<.12&&(((z%4)+4)%4)<2&&dm>3);return dash?[.85,.72,.2]:mixc([.2,.2,.22],[.26,.26,.28],n)}
    if(d<5.2)return mixc([.62,.6,.56],[.7,.68,.64],n)
    return mixc([.32,.52,.16],[.42,.6,.2],n)},
  mapColor(x,z){const d=Math.min(Math.abs(z-MAIN_Z),Math.abs(x-ELM_X));return d<3?[70,70,76]:d<5.2?[180,176,168]:[110,160,70]},
  build:buildBiome,cfg:{
    burrows:['Hedge Hollow','Storm Drain'],bushes:26,rocks:6,
    grass:(x,z)=>townPath(x,z)>.5?10:0,lush:30,
    picks:[['dandelion','Dandelion',40,()=>true],['daisy','FlowerWhite',40,()=>true],['clover','Clover',30,()=>true]],
    humans:[{name:'Mr. Patel',x:-18,z:7.6,shirt:0xe0a030,pants:0x2d3a4f,hair:0x151010,skin:0xa8744e,face:Math.PI},{name:'Rosa',x:22,z:-7.4,shirt:0xc03a6a,pants:0x3a2d4f,hair:0x3b2314,skin:0xe8b890,face:0},
      {name:'Officer Dan',x:ELM_X+7,z:22,shirt:0x2a4a8a,pants:0x1f2a3f,hair:0x6a4a2a,skin:0xf0c8a8,face:-Math.PI/2},{name:'Ellie',x:-30,z:20,shirt:0x6ac0a0,pants:0x5b4a3a,hair:0xd8b060,skin:0xf3d2bf}],
    props(avoid){Z.cross=[ELM_X,MAIN_Z];
      const walls=[0xf2e6d0,0xd8e8f0,0xf0d8d0,0xe8f0d8,0xf0e8b8,0xd0d8e8],roofs=[0x6a3a2a,0x3a4a5a,0x7a5a3a,0x4a5a3a,0x8a3a3a,0x5a4a6a];
      const bricks=[0xb8583a,0xe8d8b0,0x8a9ab0,0x9aba98,0xe0c070,0xc88a70,0xd8d0c8],awnings=[0xd83a3a,0x3a8a4a,0x3a6ad8,0xf0b030,0x8a4ab0,0x2a9aa0];
      // Main Street: shops in the middle of town, houses further out; Elm Street: houses
      let k=0;for(const side of [-1,1])for(let x=-62;x<=62;x+=10){if(Math.abs(x-ELM_X)<9||Math.hypot(x,side*10)>EDGE-6)continue;if(side>0&&x>-38&&x<-6)continue;// the town square
        if(Math.abs(x)<=42)addBuilding('Shop',x,side*8.1,{rot:side<0?0:Math.PI,hx:3.1,hz:2.6,tint:{Facade:bricks[k%7],Cloth:awnings[(k*5+2)%6]}});
        else addBuilding('House',x,side*10.4,{rot:side<0?0:Math.PI,tint:{Plaster:walls[k%6],Roof:roofs[(k*5+1)%6]}});k++}
      for(const side of [-1,1])for(let z=-58;z<=58;z+=10){if(Math.abs(z)<9||Math.hypot(ELM_X+side*10.4,z)>EDGE-6)continue;
        addBuilding('House',ELM_X+side*10.4,z,{rot:side<0?Math.PI/2:-Math.PI/2,tint:{Plaster:walls[k%6],Roof:roofs[(k*5+1)%6]}});k++}
      // street trees and flower planters along the sidewalks
      const tm=[];for(let x=-64;x<=64;x+=7)for(const side of [-1,1]){const z=side*4.6;if(Math.abs(x-ELM_X)<6||Math.hypot(x,z)>EDGE-3||(Math.abs(x)<44&&!(side>0&&x>-38&&x<-6)))continue;if(rand()<.45){tm.push(mat4(x,heightAt(x,z)-.05,z,rand()*6,R(.9,1.1)));trees.push({x,z,r:.2,canopy:2.2,kind:'Birch'});addCollider(x,z,.25)}}
      makeSet('Birch',tm,{chunk:24,view:130});
      for(const [x,z] of [[-30,5.9],[-14,5.9],[-8,26],[ELM_X-6.2,30]]){const b=M.GardenBed.clone();b.position.set(x,heightAt(x,z)-.03,z);ZG.add(b);boxes.push({cx:x,cz:z,hx:1.24,hz:.53});avoid.push({x,z,r:2});
        spots.push({type:'bed',x,z:z+.62,r:.45,ready:true,cd:0,obj:b});spots.push({type:'bed',x,z:z-.62,r:.45,ready:true,cd:0,obj:b})}
      // the town square: a fountain, benches, a hay bale and a picnic blanket
      addProp('Fountain',-22,17,{rot:0,r:1.75});
      for(const [x,z,ry] of [[-22,12.2,0],[-22,21.8,Math.PI],[-17.2,17,-Math.PI/2],[-26.8,17,Math.PI/2]])addProp('Bench',x,z,{rot:ry,r:.35});
      {const x=-33,z=24;const h=M.Hay.clone();h.scale.setScalar(2.2);h.position.set(x,heightAt(x,z),z);ZG.add(h);spots.push({type:'hay',x,z,r:.5,ready:true,cd:0,obj:h})}
      {const b=M.Blanket.clone();b.position.set(-12,heightAt(-12,24)+.005,24);b.rotation.y=.5;ZG.add(b)}
      const lp=[];for(let x=-60;x<=60;x+=12)for(const side of [-1,1])if(Math.abs(x+3-ELM_X)>6&&Math.hypot(x,side*3.4)<EDGE-4)lp.push([x+3,side*3.4]);
      for(let z=-60;z<=60;z+=12)for(const side of [-1,1])if(Math.abs(z+3)>6&&Math.hypot(ELM_X+side*3.4,z)<EDGE-4)lp.push([ELM_X+side*3.4,z+3]);
      lampPosts(lp.concat([[-27,12],[-17,22]]));
      addTraffic([{axis:'x',off:MAIN_Z+1.5,dir:1,n:2},{axis:'x',off:MAIN_Z-1.5,dir:-1,n:2},{axis:'z',off:ELM_X-1.5,dir:1,n:1},{axis:'z',off:ELM_X+1.5,dir:-1,n:1}])},
    extra(avoid,ok){// market stalls round the fountain: a crate of romaine on the ground at the front of each
      for(const [x0,z0,rot] of [[-33.5,13,Math.PI/2],[-10.5,13,-Math.PI/2],[-22,27.5,Math.PI]]){const p=nearFree(x0,z0,(x,z)=>ok(x,z,1.6)&&townPath(x,z)>.6);if(!p)continue;const [x,z]=p;
        spotProp('MarketStall','stall',x,z,{rot,box:[1.02,.5],off:.87,sr:.42});addCollider(x+Math.sin(rot)*.87,z+Math.cos(rot)*.87,.3)}}}});

// ---- Sandy Cove: dunes running down to a sandy beach and the sea to the south-east
const shoreD=(x,z)=>(x+z)*.7071;   // distance toward the sea
defineZone({id:'beach',blurb:'Warm sand, dune grass and the sea. Driftwood hides treats, and picnic baskets hide watermelon.',name:'Sandy Cove',icon:'🏖️',gx:1,gz:1,seed:3404,sig:'watermelon',toss:{watermelon:30,strawberry:30,carrot:22,pepper:16,goldCarrot:2},fog:1.25,fogTint:[0xdff0ff,.3],edgeMsg:'🌊 Only the sea that way. Guinea pigs do not swim!',
  height(x,z){const d=shoreD(x,z),land=fbm(x*.03+4,z*.03,3)*2.2+2.2+rimLift(x,z,7)*(1-smooth(-10,20,d));return lerp(land,.9-(d-14)*.07,smooth(0,16,d))+fbm(x*.2,z*.2,2)*.05*smooth(12,20,d)},
  forest:(x,z)=>clamp(smooth(4,-20,shoreD(x,z))*.8+fbm(x*.05,z*.05,2)*.3,0,1),
  path:(x,z)=>lineDist(x,z,[[-72,-4],[-40,-8],[-18,-2],[-4,6]]),
  ground(x,z,h){const d=shoreD(x,z),n=fbm(x*.3,z*.3,2)*.5+.5;let c=mixc([.86,.77,.56],[.93,.86,.66],n);
    c=mixc(c,[.66,.56,.4],smooth(.35,-.02,h)*smooth(10,20,d));c=mixc(mixc([.4,.55,.22],[.5,.6,.3],n),c,smooth(-6,8,d));return c},
  water:0,waterSize:420,
  build:buildBiome,cfg:{
    burrows:['Dune Den','Driftwood Burrow'],logs:0,
    trees:{n:40,kinds:{Pine:3,Oak2:1},gap:6},bushes:18,rocks:34,rockTest:(x,z)=>shoreD(x,z)>18||shoreD(x,z)<0,
    grass:(x,z)=>lerp(8,0,smooth(-6,12,shoreD(x,z)))+(shoreD(x,z)<14?Math.max(0,fbm(x*.1,z*.1,2))*4:0),grassTint:{Grass:tintWith([0xd8d0a0,.35])},lush:8,lushTest:(x,z)=>shoreD(x,z)<0,
    picks:[['dandelion','Dandelion',25,(x,z)=>shoreD(x,z)<10],['clover','Clover',15,(x,z)=>shoreD(x,z)<4]],
    humans:[{name:'Sunny',x:10,z:6,shirt:0xf08a3a,pants:0x3a6ab0,hair:0xe0c070,skin:0xe8b890,face:Math.PI*.75},{name:'Grandpa Joe',x:13,z:3.4,shirt:0xffffff,pants:0x8a7a5a,hair:0xdedad2,skin:0xc48a5e,face:Math.PI*1.1}],
    props(avoid){
      const dm=[];for(let n=0,t=0;n<9&&t<600;t++){const [x,z]=ringPos(0,EDGE-6);const d=shoreD(x,z);if(d<12||d>22||!freeAt(x,z,1))continue;const rot=rand()*Math.PI,o=M.Log.clone();
        o.position.set(x,heightAt(x,z)-.06,z);o.rotation.y=rot;ZG.add(o);logs.push({x,z,rot});avoid.push({x,z,r:2});spots.push({type:'log',x:x+Math.sin(rot+Math.PI/2)*.42,z:z+Math.cos(rot+Math.PI/2)*.42,r:.4,ready:true,cd:0,obj:o});n++}
      {const b=M.Blanket.clone();b.position.set(11.5,heightAt(11.5,5)+.01,5);b.rotation.y=.8;ZG.add(b);avoid.push({x:11.5,z:5,r:3})}
      addProp('Umbrella',12.5,8,{rot:0,r:.06});
      for(let n=0,t=0;n<5&&t<400;t++){const [x,z]=ringPos(0,EDGE-8),d=shoreD(x,z);if(d<11||d>19||!freeAt(x,z,2))continue;addProp('Umbrella',x,z,{r:.06});n++}
      for(let n=0,t=0;n<4&&t<400;t++){const [x,z]=ringPos(0,EDGE-8),d=shoreD(x,z);if(d<18||d>24||!freeAt(x,z,1.2))continue;addProp('Sandcastle',x,z,{r:.45,scale:R(.9,1.3)});n++}},
    extra(avoid,ok){// picnics: a basket on Sunny and Grandpa Joe's blanket, and two more blankets in the dunes
      spotProp('Basket','picnic',11.5+Math.cos(.8)*.5,5-Math.sin(.8)*.5,{rot:.8,r:.22,sr:.42});
      for(let n=0,t=0;n<2&&t<2000;t++){const [x,z]=ringPos(6,EDGE-8),d=shoreD(x,z);if(d<4||d>15||!ok(x,z,1.6))continue;const rot=rand()*6;
        const b=M.Blanket.clone();b.position.set(x,heightAt(x,z)+.01,z);b.rotation.y=rot;ZG.add(b);avoid.push({x,z,r:2});
        spotProp('Basket','picnic',x+Math.cos(rot)*.45,z-Math.sin(rot)*.45,{rot,r:.22,sr:.42});n++}}}});

// ---- Willow Creek: a winding creek with shallow fords, muddy banks and birches
const CREEK=[[-80,2],[-56,8],[-36,0],[-18,6],[0,14],[18,8],[36,16],[56,10],[80,14]];
const FORDS=[[-36,0],[0,14],[36,16]];
const creekD=(x,z)=>lineDist(x,z,CREEK);
defineZone({id:'creek',blurb:'A winding creek. Guinea pigs can wade the shallow fords by the stepping stones, and watercress grows in the shallows, but the deep water is a no-go.',name:'Willow Creek',icon:'🌊',gx:0,gz:1,seed:3505,sig:'watercress',fog:1,edgeMsg:'🌾 Just endless marsh that way. Better turn back.',
  height(x,z){const d=creekD(x,z),ford=Math.min(...FORDS.map(([a,b])=>Math.hypot(x-a,z-b)));let h=(fbm(x*.02+7,z*.02,3)+1)*1.1*smooth(4,20,d)+.35*smooth(2,6,d)+rimLift(x,z,7);
    const bed=-.55*(1-smooth(1.6,3.4,d));return h+bed*smooth(1.2,3.5,ford)+(1-smooth(1.2,3.5,ford))*(1-smooth(1.6,3.4,d))*-.17},
  forest:(x,z)=>clamp(fbm(x*.04+11,z*.04,3)*1.2+.25+smooth(60,70,Math.hypot(x,z)),0,1)*smooth(3,7,creekD(x,z)),
  path:(x,z)=>Math.min(lineDist(x,z,[[0,-72],[-2,-50],[4,-30],[0,-10],[0,14]]),lineDist(x,z,[[0,14],[-10,34],[-30,50]])),
  ground(x,z,h){const d=creekD(x,z),n=fbm(x*.2,z*.2,3)*.5+.5,f=forestness(x,z);let c=mixc([.3,.52,.16],[.4,.6,.2],n);c=mixc(c,[.3,.3,.14],f*.6);
    c=mixc(c,[.4,.33,.22],1-smooth(2.5,5,d));c=mixc(c,[.46,.42,.34],(1-smooth(.2,1.1,lineDist(x,z,[[0,-72],[-2,-50],[4,-30],[0,-10],[0,14]])))*.6);return c},
  water:-.12,
  build:buildBiome,cfg:{
    burrows:['Riverbank Den','Willow Roots','Kingfisher Burrow'],logs:6,
    trees:{n:170,kinds:{Birch:5,Oak:2,Oak2:2},gap:4.4},bushes:40,rocks:36,rockTest:(x,z)=>creekD(x,z)<8,leafpiles:20,ferns:240,
    grass:(x,z)=>lerp(11,5,forestness(x,z)),lush:50,
    picks:[['clover','Clover',60,()=>true],['dandelion','Dandelion',45,()=>true],['violet','FlowerPurple',40,()=>true],['daisy','FlowerWhite',30,()=>true]],
    props(){// stepping stones across the fords
      const sm=[];for(const [fx,fz] of FORDS){let k=0;for(let t=-3.2;t<=3.2;t+=.8){const x=fx+t*.35+R(-.1,.1),z=fz+t+R(-.1,.1);sm.push(mat4(x,heightAt(x,z)-.03,z,rand()*6,R(.16,.22),0,0,R(.1,.16)));k++}}
      makeSet('Rock2',sm,{chunk:30,view:90});
      for(const [x,z] of [[-56,8],[-18,6],[18,8],[56,10]])addCritters('Duck',1+Math.floor(rand()*2),{x,z,r:1.6,water:true})},
    decor:[['Cattail',160,(x,z)=>{const d=creekD(x,z);return d>2.3&&d<4.4},[.8,1.2]]],
    extra(avoid,ok){// watercress beds in the shallows along the banks, a short wade from dry land: forage them standing in the water
      const depth=(x,z)=>-.12-heightAt(x,z),bank=(x,z)=>{for(let k=0;k<12;k++)for(let r=.4;r<=1.2;r+=.4){const a=k/12*Math.PI*2,bx=x+Math.cos(a)*r,bz=z+Math.sin(a)*r;if(!freeAt(bx,bz,.2))continue;
        let wade=true;for(let t=0;t<=1;t+=.1)if(depth(x+(bx-x)*t,z+(bz-z)*t)>.065){wade=false;break}if(wade)return true}return false};
      for(let n=0,t=0;n<9&&t<600;t++){const i=Math.floor(rand()*(CREEK.length-1)),k=rand(),[ax,az]=CREEK[i],[bx,bz]=CREEK[i+1],L=Math.hypot(bx-ax,bz-az),sd=rand()<.5?-1:1,nx=-(bz-az)/L*sd,nz=(bx-ax)/L*sd;
        let p=null;for(let o=1.4;o<4.5&&!p;o+=.05){const x=ax+(bx-ax)*k+nx*o,z=az+(bz-az)*k+nz*o,d=depth(x,z);if(d>.015&&d<.06)p=[x,z]}
        if(!p||Math.hypot(p[0],p[1])>EDGE-6||spots.some(s=>Math.hypot(s.x-p[0],s.z-p[1])<6)||!bank(p[0],p[1]))continue;
        addProp('CressBed',p[0]-nx*.3,p[1]-nz*.3,{rot:rand()*6,y:-.124});spots.push({type:'cress',x:p[0],z:p[1],r:.45,ready:true,cd:0});n++}}}});

// ---- Critter Corner: a petting zoo of fenced pens, hay and a visitor barn
const ZOO_LOOP=[[72,-6],[50,-4],[30,0],[14,-10],[-6,-14],[-24,-2],[-18,18],[4,24],[24,14],[30,0]];
const PENS=[[-10,-30,10,7,'Goat',3],[12,-28,9,7,'Sheep',3],[-38,-14,8,9,'Goat',2],[-34,20,9,7,'Sheep',3],[-6,36,11,7,'Goat',3],[24,32,10,8,'Duck',4]];
const ZOO_POND=[24,32];
defineZone({id:'zoo',blurb:'A petting zoo of goats, sheep and ducks. Squeeze under the fences to say hello, forage the hay and raid the feed troughs.',name:'Critter Corner',icon:'🐐',gx:-1,gz:1,seed:3606,sig:'cornhusk',toss:{cornhusk:35,carrot:30,strawberry:18,pepper:15,goldCarrot:2},edgeMsg:'🚧 The zoo fence. Staff only past here!',water:-.12,
  height(x,z){const h=(fbm(x*.015+2,z*.015,3)+1)*.7+.2+rimLift(x,z,6),p=Math.hypot((x-ZOO_POND[0])/4.2,(z-ZOO_POND[1])/3.2);return p<1.6?lerp(h,-.55,1-smooth(.8,1.6,p)):h},
  forest:(x,z)=>smooth(52,66,Math.hypot(x,z))*.9,
  path:(x,z)=>lineDist(x,z,ZOO_LOOP),
  ground(x,z){const n=fbm(x*.2,z*.2,3)*.5+.5,p=1-smooth(.8,1.8,lineDist(x,z,ZOO_LOOP));let c=mixc([.34,.54,.18],[.44,.62,.22],n);
    for(const [px,pz,w,h,kind] of PENS)if(kind!=='Duck'&&Math.abs(x-px)<w/2&&Math.abs(z-pz)<h/2)c=mixc(c,[.5,.42,.26],.6+n*.2);return mixc(c,[.66,.6,.5],p)},
  build:buildBiome,cfg:{
    burrows:['Rabbit Warren','Feed Shed Hole'],bushes:20,rocks:8,
    trees:{n:60,kinds:{Oak:3,Oak2:2,Birch:2},gap:5},
    grass:(x,z)=>{for(const [px,pz,w,h,kind] of PENS)if(kind!=='Duck'&&Math.abs(x-px)<w/2&&Math.abs(z-pz)<h/2)return 2;return 9},lush:30,
    picks:[['dandelion','Dandelion',40,()=>true],['clover','Clover',40,()=>true],['daisy','FlowerWhite',25,()=>true]],
    humans:[{name:'Keeper Amy',x:-2,z:-20,shirt:0x3a7a3a,pants:0x5b4a3a,hair:0x8a4a2a,skin:0xf0c8a8},{name:'Noah',x:-20,z:8,shirt:0xe0402a,pants:0x2d3a4f,hair:0x151010,skin:0x8a5a3a},
      {name:'Lily',x:10,z:20,shirt:0xf0a0d0,pants:0x6a5aa0,hair:0xe0c070,skin:0xf3d2bf}],
    props(avoid){const fm=[];
      for(const [px,pz,w,h,kind,n] of PENS){const x0=px-w/2,x1=px+w/2,z0=pz-h/2,z1=pz+h/2;fenceLine(x0,z0,x1,z0,fm);fenceLine(x1,z0,x1,z1,fm);fenceLine(x1,z1,x0,z1,fm);fenceLine(x0,z1,x0,z0,fm);
        // guinea pigs fit under the rails, so pens are open to you; hay inside for foraging
        avoid.push({x:px,z:pz,r:Math.max(w,h)/2+1});if(kind==='Duck'){addCritters('Duck',n,{x:ZOO_POND[0],z:ZOO_POND[1],r:3,water:true});continue}
        const hx=px+R(-w/4,w/4),hz=pz+R(-h/4,h/4),o=M.Hay.clone();o.scale.setScalar(2.2);o.position.set(hx,heightAt(hx,hz),hz);o.rotation.y=rand()*6;ZG.add(o);spots.push({type:'hay',x:hx,z:hz,r:.5,ready:true,cd:0,obj:o});
        addCritters(kind,n,{x0:x0+.6,x1:x1-.6,z0:z0+.6,z1:z1-.6})}
      makeSet('Fence',fm,{chunk:40});
      addBuilding('Barn',28,-18,{rot:Math.PI/2,hx:4.15,hz:3.2});
      for(const [x,z,ry] of [[4,-12,0],[-14,-6,1.2],[-10,18,2.4],[16,22,3.6]])addProp('Bench',x,z,{rot:ry,r:.35});
      const lp=[];for(let i=0;i<ZOO_LOOP.length-1;i++){const [ax,az]=ZOO_LOOP[i],[bx,bz]=ZOO_LOOP[i+1];if(i%2===0)lp.push([(ax+bx)/2+1.6,(az+bz)/2+1.6])}lampPosts(lp.filter(([x,z])=>Math.hypot(x,z)<EDGE-4))},
    decor:[['Cattail',40,(x,z)=>{const p=Math.hypot((x-ZOO_POND[0])/4.2,(z-ZOO_POND[1])/3.2);return p>1.35&&p<1.9},[.8,1.1]]],
    extra(avoid,ok){// feed troughs by the visitor path, with corn spilling over the side
      for(let n=0,t=0;n<4&&t<4000;t++){const [x,z]=ringPos(6,EDGE-10),d=distToPath(x,z);if(d<1.4||d>5||!ok(x,z,1.3)||spots.some(s=>s.type==='trough'&&Math.hypot(s.x-x,s.z-z)<14))continue;
        const rot=Math.floor(rand()*4)*Math.PI/2;spotProp('Trough','trough',x,z,{rot,box:[.68,.24],off:.42,sr:.4});n++}}}});

// ---- Sunny Acres Farm: a red barn, crop fields in rows, hay bales and a duck pond
const FARM_ROAD=[[72,0],[40,-2],[20,4],[4,2],[-8,-4]];
const FIELDS=[[-34,-30,26,18],[-36,6,22,20],[-10,30,26,16]];
const inField=(x,z)=>FIELDS.some(([fx,fz,w,h])=>Math.abs(x-fx)<w/2&&Math.abs(z-fz)<h/2);
const PADDOCK=[24,-26,16,11];
defineZone({id:'farm',blurb:'Fields of carrots in neat rows, hay bales by the big red barn, an apple orchard, sheep in the paddock and ducks on the pond.',name:'Sunny Acres Farm',icon:'🚜',gx:-1,gz:0,seed:3707,sig:'apple',toss:{apple:35,carrot:30,strawberry:15,pepper:18,goldCarrot:2},edgeMsg:'🌾 Nothing but more fields that way, for miles.',
  height(x,z){let h=(fbm(x*.012+5,z*.012,3)+1)*.9+.3+rimLift(x,z,6);const p=Math.hypot(x-26,z-28);if(p<9)h=lerp(h,-.5,1-smooth(5,9,p));return h},
  forest:(x,z)=>smooth(54,68,Math.hypot(x,z))*.9+(inField(x,z)?-1:0),
  path:(x,z)=>lineDist(x,z,FARM_ROAD),
  ground(x,z,h){const n=fbm(x*.2,z*.2,3)*.5+.5;let c=mixc([.36,.56,.18],[.46,.62,.22],n);
    for(const [fx,fz,w,hh] of FIELDS)if(Math.abs(x-fx)<w/2&&Math.abs(z-fz)<hh/2){const row=Math.abs(((x-fx)%1.2+1.2)%1.2-.6)<.25;c=row?[.3,.42,.14]:[.42,.3,.18]}
    c=mixc(c,[.5,.4,.27],1-smooth(.8,1.6,lineDist(x,z,FARM_ROAD)));return mixc(c,[.36,.3,.2],1-smooth(.2,1,h+.1))},
  water:-.12,
  build:buildBiome,cfg:{
    burrows:['Barn Burrow','Haystack Hollow','Field Mouse Hole'],bushes:24,rocks:10,
    trees:{n:50,kinds:{Oak:3,Oak2:3},gap:6},
    grass:(x,z)=>inField(x,z)?0:9,lush:36,lushTest:(x,z)=>!inField(x,z),
    picks:[['dandelion','Dandelion',40,(x,z)=>!inField(x,z)],['clover','Clover',40,(x,z)=>!inField(x,z)],['carrot','Carrot',60,inField,[1,1.2]],['violet','FlowerPurple',20,(x,z)=>!inField(x,z)]],
    humans:[{name:'Farmer Gus',x:2,z:-12,shirt:0x3a5a9a,pants:0x4a3a2a,hair:0x9a9088,skin:0xe8b890,face:Math.PI},{name:'Hannah',x:-20,z:14,shirt:0xe8d040,pants:0x3a4a6a,hair:0x6a3a1a,skin:0xf0c8a8,face:Math.PI/2}],
    props(avoid){
      addBuilding('Barn',-6,-17,{scale:1.25,hx:4.15,hz:3.2});
      for(const [fx,fz] of FIELDS)addProp('Scarecrow',fx+R(-3,3),fz+R(-2,2),{rot:rand()*6,r:.15});
      {const [px,pz,w,h]=PADDOCK,fm=[];fenceLine(px-w/2,pz-h/2,px+w/2,pz-h/2,fm);fenceLine(px+w/2,pz-h/2,px+w/2,pz+h/2,fm);fenceLine(px+w/2,pz+h/2,px-w/2,pz+h/2,fm);fenceLine(px-w/2,pz+h/2,px-w/2,pz-h/2,fm);makeSet('Fence',fm,{chunk:40});
        addCritters('Sheep',5,{x0:px-w/2+.7,x1:px+w/2-.7,z0:pz-h/2+.7,z1:pz+h/2-.7});avoid.push({x:px,z:pz,r:3})}
      addCritters('Duck',4,{x:26,z:28,r:4.5,water:true});
      for(const [x,z] of [[3,-8],[5,-6.5],[-14,-6],[-16,-8],[14,-14]]){const o=M.Hay.clone();o.scale.setScalar(2.6);o.position.set(x,heightAt(x,z),z);o.rotation.y=rand()*6;ZG.add(o);spots.push({type:'hay',x,z,r:.55,ready:true,cd:0,obj:o});avoid.push({x,z,r:1.4})}
      const fm=[];for(const [fx,fz,w,h] of FIELDS){const x0=fx-w/2-.8,x1=fx+w/2+.8,z0=fz-h/2-.8,z1=fz+h/2+.8;fenceLine(x0,z0,x1,z0,fm);fenceLine(x1,z0,x1,z1,fm);fenceLine(x1,z1,x0,z1,fm);fenceLine(x0,z1,x0,z0,fm);avoid.push({x:fx,z:fz,r:2})}
      makeSet('Fence',fm,{chunk:40});
      // crop rows: leafy tops between the pickable carrots
      const cm=[];for(const [fx,fz,w,h] of FIELDS)for(let x=fx-w/2+.6;x<fx+w/2;x+=1.2)for(let z=fz-h/2+.4;z<fz+h/2;z+=.45)cm.push(mat4(x+R(-.05,.05),heightAt(x,z)-.01,z,rand()*6,R(.9,1.3)));
      makeSet('LushGrass',cm,{chunk:14,view:45,shadow:false,tint:{Grass:tintWith([0x4a8a2a,.35])}}).parts.forEach(p=>windify(p.mat,{amp:.3,push:1.0,upN:true}))},
    decor:[['Cattail',50,(x,z)=>{const p=Math.hypot(x-26,z-28);return p>6.6&&p<8.8},[.8,1.2]],['Sunflower',40,(x,z)=>Math.abs(x+6)<7&&z<-24&&z>-30,[.85,1.1],{wind:{amp:.03}}]],
    extra(avoid,ok){// little orchards of apple trees, windfalls in the grass underneath
      for(const [cx,cz] of [[44,18],[46,-18],[-52,-6],[18,44]]){let n=0;for(let i=0;i<6&&n<3;i++){const x=cx+(i%3)*5-5,z=cz+Math.floor(i/3)*5-2.5;
        if(!ok(x,z,1.8)||inField(x,z))continue;addProp('AppleTree',x,z,{rot:rand()*6,r:.2});trees.push({x,z,r:.2,canopy:1.7,kind:'Apple'});
        const a0=rand()*6;for(let k=0;k<8;k++){const a=a0+k*.8,sx=x+Math.cos(a)*.75,sz=z+Math.sin(a)*.75;if(freeAt(sx,sz,.15)){spots.push({type:'apples',x:sx,z:sz,r:.45,ready:true,cd:0});break}}n++}}}}});

// ---- Sunflower Fields: rolling hills of wildflowers around a sunflower maze with a prize in the middle
const MAZE={cx:-6,cz:-4,n:11,cell:2.6};
defineZone({id:'sunflowers',blurb:'Rolling hills of wildflowers around a sunflower maze. Something golden waits in the middle, and fallen sunflower heads are full of seeds.',name:'Sunflower Fields',icon:'🌻',gx:-1,gz:-1,seed:3808,sig:'seeds',edgeMsg:'🌻 Just more sunflowers, as far as a guinea pig can see.',
  height(x,z){const m=Math.max(Math.abs(x-MAZE.cx),Math.abs(z-MAZE.cz))-MAZE.n*MAZE.cell/2;return fbm(x*.016+8,z*.016,4)*3.2*smooth(0,14,m)+.3+rimLift(x,z,7)},
  forest:(x,z)=>smooth(58,70,Math.hypot(x,z))*.8,
  path:(x,z)=>lineDist(x,z,[[48,48],[30,26],[16,12],[MAZE.cx+MAZE.n*MAZE.cell/2+1,MAZE.cz+MAZE.n*MAZE.cell/2-MAZE.cell/2]]),
  ground(x,z){const n=fbm(x*.2,z*.2,3)*.5+.5,fl=smooth(.1,.5,fbm(x*.05+3,z*.05,2));let c=mixc([.38,.58,.18],[.5,.64,.22],n);c=mixc(c,[.55,.6,.22],fl*.4);
    const m=Math.max(Math.abs(x-MAZE.cx),Math.abs(z-MAZE.cz))-MAZE.n*MAZE.cell/2;if(m<.5)c=mixc(c,[.46,.38,.22],.55);return c},
  build:buildBiome,cfg:{
    burrows:['Sunny Burrow','Petal Hollow'],bushes:14,rocks:14,
    trees:{n:24,kinds:{Oak:2,Birch:3},gap:8},
    grass:(x,z)=>{const m=Math.max(Math.abs(x-MAZE.cx),Math.abs(z-MAZE.cz))-MAZE.n*MAZE.cell/2;return m<.5?1:9},lush:30,
    picks:[['dandelion','Dandelion',90,()=>true],['daisy','FlowerWhite',90,()=>true],['violet','FlowerPurple',80,()=>true],['clover','Clover',50,()=>true]],
    props(avoid){buildMaze(avoid)},
    decor:[['Sunflower',260,(x,z)=>Math.max(Math.abs(x-MAZE.cx),Math.abs(z-MAZE.cz))-MAZE.n*MAZE.cell/2>4&&fbm(x*.05+11,z*.05,2)>.15,[.8,1.15],{wind:{amp:.03}}]],
    extra(avoid,ok){// sunflower heads that have nodded off their stalks, full of seeds
      for(let n=0,t=0;n<10&&t<4000;t++){const [x,z]=ringPos(8,EDGE-6),m=Math.max(Math.abs(x-MAZE.cx),Math.abs(z-MAZE.cz))-MAZE.n*MAZE.cell/2;
        if(m<5||fbm(x*.05+11,z*.05,2)<=.1||!ok(x,z,.6))continue;spotProp('SunflowerHead','seedhead',x,z,{rot:rand()*6,sr:.32});n++}}}});

// A maze of sunflower walls (a depth-first maze on an n×n grid), open at the south-east, prize in the middle.
function buildMaze(avoid){const {cx,cz,n,cell}=MAZE,x0=cx-n*cell/2,z0=cz-n*cell/2;
  const vis=new Uint8Array(n*n),walls={h:[],v:[]};for(let i=0;i<=n;i++){walls.h.push(new Array(n).fill(1));walls.v.push(new Array(n).fill(1))}
  // walls.h[r][c]: wall on the north edge of row r; walls.v[c][r]: wall on the west edge of column c
  const st=[[Math.floor(n/2),Math.floor(n/2)]];vis[st[0][1]*n+st[0][0]]=1;
  while(st.length){const [c,r]=st[st.length-1];const opts=[[0,-1],[1,0],[0,1],[-1,0]].filter(([dc,dr])=>{const a=c+dc,b=r+dr;return a>=0&&b>=0&&a<n&&b<n&&!vis[b*n+a]});
    if(!opts.length){st.pop();continue}const [dc,dr]=opts[Math.floor(rand()*opts.length)],a=c+dc,b=r+dr;
    if(dr===-1)walls.h[r][c]=0;if(dr===1)walls.h[r+1][c]=0;if(dc===-1)walls.v[c][r]=0;if(dc===1)walls.v[c+1][r]=0;vis[b*n+a]=1;st.push([a,b])}
  walls.v[n][n-1]=0;   // the way in: east side, bottom row
  const fm=[],gm=[],seg=(ax,az,bx,bz)=>{const L=Math.hypot(bx-ax,bz-az),k=Math.round(L/.46);for(let i=0;i<=k;i++){const x=ax+(bx-ax)*i/k+R(-.06,.06),z=az+(bz-az)*i/k+R(-.06,.06);
    fm.push(mat4(x,heightAt(x,z)-.02,z,rand()*6,R(.85,1.2)));addCollider(x,z,.3);gm.push(mat4(x+R(-.15,.15),heightAt(x,z)-.01,z+R(-.15,.15),rand()*6,R(1.2,1.7)))}};
  for(let r=0;r<=n;r++)for(let c=0;c<n;c++)if(walls.h[r][c])seg(x0+c*cell,z0+r*cell,x0+(c+1)*cell,z0+r*cell);
  for(let c=0;c<=n;c++)for(let r=0;r<n;r++)if(walls.v[c][r])seg(x0+c*cell,z0+r*cell,x0+c*cell,z0+(r+1)*cell);
  makeSet('Sunflower',fm,{chunk:12,view:80,shadow:true}).parts.forEach(p=>windify(p.mat,{amp:.03}));
  makeSet('LushGrass',gm,{chunk:12,view:45,shadow:false}).parts.forEach(p=>windify(p.mat,{amp:.3,push:1.0,upN:true}));
  addProp('Scarecrow',x0+n*cell+2.5,z0+n*cell-cell*1.6,{rot:-Math.PI/2,r:.15});addProp('Bench',x0+n*cell+3,z0+n*cell+1.5,{rot:-Math.PI/2,r:.35});
  const px=cx,pz=cz,o=M.Hay.clone();o.scale.setScalar(2.4);o.position.set(px,heightAt(px,pz),pz);ZG.add(o);spots.push({type:'prize',x:px,z:pz,r:.55,ready:true,cd:0,obj:o});
  avoid.push({x:cx,z:cz,r:n*cell/2+2})}

// ============================================================ guinea pig models
const PIG_PARTS=['Body','EarL','EarR','Nose','FootFL','FootFR','FootBL','FootBR','EyeL','EyeR','Whiskers'];
const h3=(x,y,z)=>PERM[(PERM[(PERM[x&255]+(y&255))&511]+(z&255))&511]/255;
function vnoise3(x,y,z){const xi=Math.floor(x),yi=Math.floor(y),zi=Math.floor(z),xf=x-xi,yf=y-yi,zf=z-zi,u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf),w=zf*zf*(3-2*zf);
  const l=(k)=>lerp(lerp(h3(xi,yi,zi+k),h3(xi+1,yi,zi+k),u),lerp(h3(xi,yi+1,zi+k),h3(xi+1,yi+1,zi+k),u),v);return lerp(l(0),l(1),w)*2-1}
const toLin=c=>c<=.04045?c/12.92:Math.pow((c+.055)/1.055,2.4);
const mix3=(a,b,k)=>[lerp(a[0],b[0],k),lerp(a[1],b[1],k),lerp(a[2],b[2],k)];
// coat patterns, in the Blender builder's body space: x side, y front(-)→back(+), z up
function coatColor(coat,x,y,z,px,py,pz){
  const N=(f,o=0)=>vnoise3(px*f+o,py*f+o*.7,pz*f+o*1.3);
  const CREAM=[.95,.91,.83],WHITE=[.97,.95,.91],DARK=[.13,.1,.08];
  const blaze=y<-.35&&Math.abs(x)<.09+.05*(-y-.35)&&z>-.15;
  const belly=smooth(-.2,-.45,z);
  let c;
  if(coat==='golden'){c=mix3([.93,.66,.34],[.8,.47,.19],smooth(-.3,.5,N(9,3)+.3*y));c=mix3(c,CREAM,belly*.6)}
  else if(coat==='dutch'){const w=N(7,5)*.1;c=((y<-.3+w&&!blaze)||y>.2+w)?DARK:WHITE}
  else if(coat==='agouti'){c=mix3([.58,.42,.25],[.22,.15,.09],smooth(-.1,.4,N(260,2)));c=mix3(c,[.3,.21,.13],smooth(.3,.7,z)*.5);c=mix3(c,[.86,.66,.42],belly*.8)}
  else if(coat==='himalayan'){c=WHITE;const nose=smooth(-.72,-.92,y)*(1-smooth(.1,.35,z));c=mix3(c,[.25,.2,.18],nose)}
  else if(coat==='pink'||coat==='choc'||coat==='dalmatian'){
    const base=coat==='choc'?[.5,.33,.26]:[.94,.72,.65],deep=coat==='choc'?[.4,.26,.2]:[.84,.58,.53];
    c=mix3(base,deep,smooth(-.2,.6,N(14,8)));
    if(y>-.62&&y<-.12)c=mix3(c,deep,smooth(.75,.95,Math.abs(Math.sin(y*44+N(20,4)*2)))*.7); // neck wrinkles
    if(coat==='dalmatian')c=mix3(c,[.42,.26,.2],smooth(.18,.26,N(13,11)));
  }
  else return null;
  const k=.9+.12*N(90,1);return [c[0]*k,c[1]*k,c[2]*k];
}
function paintCoat(geo,coat){
  const pos=geo.attributes.position,n=pos.count,arr=new Float32Array(n*3),S=.14,LIFT=.064;
  if(coatColor(coat,0,0,0,0,0,0)===null)return;
  for(let i=0;i<n;i++){const px=pos.getX(i),py=pos.getY(i),pz=pos.getZ(i);
    const c=coatColor(coat,px/S,-pz/S,(py-LIFT)/S,px,-pz,py);arr[i*3]=toLin(c[0]);arr[i*3+1]=toLin(c[1]);arr[i*3+2]=toLin(c[2])}
  geo.setAttribute('color',new THREE.BufferAttribute(arr,3));
}
let bodyPrepped=false;
function prepBodyGeo(){
  if(bodyPrepped)return;bodyPrepped=true;
  const o=M.GuineaPig;o.updateMatrixWorld(true);const body=o.getObjectByName('Body');const geo=body.geometry;
  {const p=geo.attributes.position,fu=new Float32Array(p.count*2);for(let i=0;i<p.count;i++){fu[i*2]=Math.atan2(p.getX(i),p.getY(i)-.07)/(Math.PI*2)+.5;fu[i*2+1]=p.getZ(i)/.28+.5}geo.setAttribute('furUv',new THREE.BufferAttribute(fu,2))}
  const eyes=['EyeL','EyeR'].map(n=>{const e=o.getObjectByName(n);e.geometry.computeBoundingSphere();return e.geometry.boundingSphere.center.clone().applyMatrix4(e.matrix)});
  const nose=new THREE.Vector3();o.getObjectByName('Nose').getWorldPosition(nose);o.worldToLocal(nose);
  const pos=geo.attributes.position,fl=new Float32Array(pos.count);const v=new THREE.Vector3();
  for(let i=0;i<pos.count;i++){v.fromBufferAttribute(pos,i);let k=1;for(const e of eyes)k=Math.min(k,smooth(.012,.026,v.distanceTo(e)));k=Math.min(k,.25+.75*smooth(.012,.04,v.distanceTo(nose)));if(v.y<.018)k*=.5;fl[i]=k}
  geo.setAttribute('furLen',new THREE.BufferAttribute(fl,1));
}
// shell fur: procedural tapered strands (voronoi cells in the body's wrap-around uv), alpha-to-coverage edges.
// furUv.x wraps the body (~0.47 m), furUv.y runs nose→rump (0.28 m per unit), so uDens ≈ strands per unit in each.
const FUR_GLSL=`
float fh1(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
vec2 fh2(vec2 p){return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453);}
// rosette flow: direction radiating out of the nearest whorl centre (uv space), plus a twist
vec2 rosette(vec2 uv){vec2 g=uv*vec2(7.0,4.0);vec2 c=floor(g);float bd=9.0;vec2 bv=vec2(0.0);
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){vec2 o=vec2(float(i),float(j));vec2 q=o+0.25+0.5*fh2(c+o)-fract(g);float d=dot(q,q);if(d<bd){bd=d;bv=-q;}}
  float l=length(bv)+1e-4;vec2 r=bv/l;return mat2(0.8,0.6,-0.6,0.8)*r*smoothstep(0.0,0.25,l);}
`;
function furMaterial(layer,fu){
  const m=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.92,metalness:0,alphaTest:.5,alphaToCoverage:true});
  m.onBeforeCompile=sh=>{sh.uniforms.uLayer={value:layer};sh.uniforms.uWind=U.time;Object.assign(sh.uniforms,fu);
    sh.vertexShader='attribute vec2 furUv;attribute float furLen;uniform float uLayer,uWind,uLen,uDroop,uSwirl,uFace,uFall;varying vec2 vFurUv;varying float vFl;\n'+FUR_GLSL+sh.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      vFurUv=furUv;vFl=furLen;
      float head=smoothstep(0.035-0.02*uFall,0.1-0.03*uFall,position.z);   // 0 on the body → 1 at the face (+z is forward)
      float L=0.0095*furLen*uLen*mix(1.0,uFace,head);float l2=uLayer*uLayer;
      vec3 n=normalize(objectNormal);vec3 tv=normalize(vec3(0.0,0.0,1.0)-n*n.z+1e-4);vec3 tu=normalize(cross(n,tv));
      // long hair (uFall) parts at the spine, drapes down the sides and pools on the ground as a skirt
      vec3 hz=normalize(vec3(n.x+sign(position.x)*max(n.y,0.0)*0.9,0.0,n.z*0.6)+1e-4);
      vec3 drape=n*L*uLayer*0.6+(hz*0.75+vec3(0.0,-1.3,-0.3))*L*l2;   // rises from the skin, tips fall
      transformed+=mix(n*L*uLayer,drape,uFall);
      transformed.y-=L*l2*0.7*uDroop;transformed.z-=L*l2*1.1*uDroop;   // lie back & down
      vec2 rf=rosette(furUv);transformed+=(tu*rf.x+tv*rf.y)*L*uLayer*uSwirl*1.6;transformed.y+=L*uLayer*uSwirl*0.25*(1.0-length(rf));
      float sway=sin(uWind*2.2+position.z*60.0+position.x*40.0);transformed.x+=sway*L*l2*(0.12+0.25*uFall);
      float under=max(0.003-transformed.y,0.0);transformed.xz+=hz.xz*under*1.3*uFall;transformed.y=max(transformed.y,0.003);`);
    sh.fragmentShader='uniform float uLayer,uSwirl,uClump;uniform vec2 uDens;varying vec2 vFurUv;varying float vFl;\n'+FUR_GLSL+sh.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      if(vFl<0.08)discard;
      vec2 g=vFurUv*uDens;
      g-=rosette(vFurUv)*uLayer*uSwirl*1.2;                    // strands lean along the whorl
      g.y+=uLayer*uLayer*1.5;                                   // comb back toward the rump
      g.x+=sign(vFurUv.x-0.5)*uLayer*uClump*3.5;                // long hair: strands slant away from the spine part
      vec2 c=floor(g),f=fract(g);float bd=9.0,id=0.0;
      for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){vec2 o=vec2(float(i),float(j));vec2 q=o+0.15+0.7*fh2(c+o)-f;float d=dot(q,q);if(d<bd){bd=d;id=fh1(c+o+17.0);}}
      float d=sqrt(bd);
      float h=mix(0.5,1.0,id)*mix(1.0,smoothstep(0.1,0.55,vFl),0.6); // strand length
      if(uLayer>h)discard;
      float px=length(fwidth(g));
      float r=mix(0.72,0.05+0.2*uClump,uLayer/h)+px*0.3;                    // tapered strand, thickened when sub-pixel
      diffuseColor.a=0.5+(r-d)/max(px,0.05)*0.5;
      float ao=mix(0.42,1.12,pow(uLayer,0.8));
      diffuseColor.rgb*=ao*(0.82+0.36*id);`);
  };
  m.customProgramCacheKey=()=>'fur3';return m;
}
// build a guinea pig of any breed/coat: {obj,parts,fur,dispose}
function makePigModel(look,lod=1){
  prepBodyGeo();
  const br=BREEDS[look.breed],co=COATS[look.coat];const o=M.GuineaPig.clone(true);const parts={};const trash=[];
  PIG_PARTS.forEach(n=>parts[n]=o.getObjectByName(n));
  for(const k in parts){const p=parts[k];if(p){p.userData.base=p.position.clone();p.userData.rot=p.rotation.clone()}}
  const body=parts.Body;body.geometry=body.geometry.clone();paintCoat(body.geometry,look.coat);
  body.material=body.material.clone();body.material.color.setScalar(br.fur?.55:1.2);body.material.roughness=br.fur?1:.6;if(co.glow)body.material.emissive=new THREE.Color(...co.glow);trash.push(body.geometry,body.material);
  const skin=parts.EarL.material.clone();if(co.skin)skin.color.setRGB(...co.skin);trash.push(skin);
  ['EarL','EarR','Nose','FootFL','FootFR','FootBL','FootBR'].forEach(n=>{if(parts[n])parts[n].material=skin});
  if(co.redEyes){const em=parts.EyeL.material.clone();em.vertexColors=false;em.color.setRGB(.4,.02,.03);parts.EyeL.material=parts.EyeR.material=em;trash.push(em)}
  const fur=[];
  if(br.fur){const F=br.fur,layers=Math.round(F.layers*lod);
    const fu={uLen:{value:F.len},uDroop:{value:F.droop},uSwirl:{value:F.swirl},uFace:{value:F.face},uFall:{value:F.fall||0},uClump:{value:F.clump||0},uDens:{value:new THREE.Vector2(...F.dens)}};
    for(let i=1;i<=layers;i++){const m=furMaterial(i/layers,fu);trash.push(m);const shell=new THREE.Mesh(body.geometry,m);shell.castShadow=false;shell.receiveShadow=true;body.add(shell);fur.push(shell)}}
  o.scale.setScalar(br.scale||1);
  return {obj:o,parts,fur,dispose(){trash.forEach(x=>x.dispose())}};
}
function buildPig(){
  if(pig.model){scene.remove(pig.obj);pig.model.dispose()}
  const m=makePigModel({breed:G.breed,coat:G.coat});pig.model=m;pig.obj=m.obj;pig.parts=m.parts;pig.fur=m.fur;scene.add(m.obj);
  if(!pig.blob){// soft contact shadow
    const blob=new THREE.Mesh(new THREE.PlaneGeometry(.34,.4),new THREE.MeshBasicMaterial({map:blobTex,transparent:true,depthWrite:false}));blob.rotation.x=-Math.PI/2;scene.add(blob);pig.blob=blob;
    pig.light=new THREE.PointLight(0xffe0b0,0,2.2,2);scene.add(pig.light)}
}

// ============================================================ predators
let hawk=null,foxes=[];
function buildPredators(){
  const h=M.Hawk.clone(true);h.scale.setScalar(1.2);scene.add(h);h.visible=false;
  hawk={obj:h,wL:h.getObjectByName('WingL'),wR:h.getObjectByName('WingR'),state:'away',t:R(40,70),a:0,detect:0,from:new THREE.Vector3(),dt:0,pos:new THREE.Vector3(),vel:new THREE.Vector3()};
  for(let i=0;i<2;i++){const f=M.Fox.clone(true);scene.add(f);f.visible=false;
    foxes.push({obj:f,legs:['LegFL','LegFR','LegBL','LegBR'].map(n=>f.getObjectByName(n)),tail:f.getObjectByName('Tail'),active:false,state:'wander',pos:new THREE.Vector3(),heading:0,target:new THREE.Vector3(),t:0,phase:0,cool:0})}
}

// ============================================================ particles
const PMAX=700;const pGeo=new THREE.BufferGeometry();const pPos=new Float32Array(PMAX*3),pCol=new Float32Array(PMAX*3),pSize=new Float32Array(PMAX);
pGeo.setAttribute('position',new THREE.BufferAttribute(pPos,3));pGeo.setAttribute('color',new THREE.BufferAttribute(pCol,3));pGeo.setAttribute('size',new THREE.BufferAttribute(pSize,1));
const pMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,vertexColors:true,uniforms:{tex:{value:glowTex},scale:{value:innerHeight}},
  vertexShader:`attribute float size;varying vec3 vC;void main(){vC=color;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=size*600./-mv.z;gl_Position=projectionMatrix*mv;}`,
  fragmentShader:`uniform sampler2D tex;varying vec3 vC;void main(){vec4 t=texture2D(tex,gl_PointCoord);if(t.a<.05)discard;gl_FragColor=vec4(vC,t.a);}`});
const pts=new THREE.Points(pGeo,pMat);pts.frustumCulled=false;scene.add(pts);
const parts=[];for(let i=0;i<PMAX;i++)parts.push({life:0});
function emit(x,y,z,n,{col=[1,1,1],spread=.6,up=1,size=.02,life=1,grav=2,jitter=.2}={}){
  for(let k=0;k<n;k++){const p=parts.find(q=>q.life<=0);if(!p)return;p.x=x;p.y=y;p.z=z;const a=rand()*6.28,s=rand()*spread;p.vx=Math.cos(a)*s;p.vz=Math.sin(a)*s;p.vy=up*(.5+rand());p.life=p.max=life*(.6+rand()*.6);p.g=grav;p.size=size*(.6+rand()*.8);
    p.r=clamp(col[0]+(rand()-.5)*jitter,0,1);p.gg=clamp(col[1]+(rand()-.5)*jitter,0,1);p.b=clamp(col[2]+(rand()-.5)*jitter,0,1)}}
function updateParticles(dt){for(let i=0;i<PMAX;i++){const p=parts[i];if(p.life>0){p.life-=dt;p.vy-=p.g*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;const k=Math.max(p.life/p.max,0);pPos[i*3]=p.x;pPos[i*3+1]=p.y;pPos[i*3+2]=p.z;pCol[i*3]=p.r;pCol[i*3+1]=p.gg;pCol[i*3+2]=p.b;pSize[i]=p.size*Math.min(1,k*3)}else pSize[i]=0}
  pGeo.attributes.position.needsUpdate=pGeo.attributes.color.needsUpdate=pGeo.attributes.size.needsUpdate=true}
// hearts (sprites)
const hearts=[];const heartMat=new THREE.SpriteMaterial({map:heartTex,transparent:true,depthWrite:false});
function heart(x,y,z){const s=new THREE.Sprite(heartMat.clone());s.scale.setScalar(.07);s.position.set(x+R(-.05,.05),y,z+R(-.05,.05));(G.under?wScene:G.inside?iScene:scene).add(s);hearts.push({s,life:1.4,vy:R(.18,.3)})}
function updateHearts(dt){for(let i=hearts.length-1;i>=0;i--){const h=hearts[i];h.life-=dt;h.s.position.y+=h.vy*dt;h.s.position.x+=Math.sin(h.life*6)*.03*dt;h.s.material.opacity=Math.min(1,h.life*1.5);if(h.life<=0){h.s.removeFromParent();h.s.material.dispose();hearts.splice(i,1)}}}
// sniff markers
const markers=[];
function marker(x,y,z,color,to=scene){const s=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex,color,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,fog:false}));s.position.set(x,y,z);s.scale.setScalar(.5);to.add(s);markers.push({s,life:7,y})}
function updateMarkers(dt,t){for(let i=markers.length-1;i>=0;i--){const m=markers[i];m.life-=dt;m.s.position.y=m.y+.25+Math.sin(t*3+i)*.08;m.s.scale.setScalar(.45+Math.sin(t*5+i)*.1);m.s.material.opacity=Math.min(1,m.life);if(m.life<=0){m.s.removeFromParent();m.s.material.dispose();markers.splice(i,1)}}}
// fireflies
const ffN=90;const ffGeo=new THREE.BufferGeometry();const ffPos=new Float32Array(ffN*3);ffGeo.setAttribute('position',new THREE.BufferAttribute(ffPos,3));
const ffMat=new THREE.PointsMaterial({map:glowTex,color:0xd8ff70,size:.12,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending});
const fireflies=new THREE.Points(ffGeo,ffMat);fireflies.frustumCulled=false;scene.add(fireflies);const ffData=[...Array(ffN)].map(()=>({x:R(-14,14),z:R(-14,14),y:R(.2,1.6),p:rand()*9}));

// snowfall (Snowcap Peaks): flakes in a box that wraps around the camera
const snowN=1500,snowGeo=new THREE.BufferGeometry(),snowPos=new Float32Array(snowN*3);const snowD=[...Array(snowN)].map(()=>({x:Math.random()*24,y:Math.random()*8,z:Math.random()*24,s:.35+Math.random()*.5,p:Math.random()*6}));
snowGeo.setAttribute('position',new THREE.BufferAttribute(snowPos,3));
const snowPts=new THREE.Points(snowGeo,new THREE.PointsMaterial({map:glowTex,color:0xffffff,size:.06,transparent:true,opacity:.95,depthWrite:false}));snowPts.frustumCulled=false;snowPts.visible=false;scene.add(snowPts);
function updateSnow(dt,t){const cx=camera.position.x,cz=camera.position.z,base=pig.pos.y-1;
  for(let i=0;i<snowN;i++){const d=snowD[i];d.y-=dt*d.s;if(d.y<0)d.y+=8;snowPos[i*3]=((d.x-cx)%24+36)%24-12+cx+Math.sin(t*.8+d.p)*.25;snowPos[i*3+1]=base+d.y;snowPos[i*3+2]=((d.z-cz)%24+36)%24-12+cz+Math.cos(t*.6+d.p)*.25}
  snowGeo.attributes.position.needsUpdate=true}

// ============================================================ UI helpers
function toast(html,cls='',dur=3.2){const d=document.createElement('div');d.className='toast '+cls;d.innerHTML=html;$('toasts').prepend(d);while($('toasts').children.length>6)$('toasts').lastChild.remove();setTimeout(()=>{d.classList.add('out');setTimeout(()=>d.remove(),450)},dur*1000)}
let calloutT=0;
function callout(rarity,name,pts){const [c,label]=RARITY[rarity];const el=$('callout');el.querySelector('.r').textContent=label;el.querySelector('.r').style.color=c;el.querySelector('.i').textContent=name;el.querySelector('.i').style.color=c;el.querySelector('.p').textContent=pts?(pts>0?'+':'')+pts+' pts':'';el.style.opacity=1;calloutT=rarity==='legendary'?3:2}
function flash(color,op=.5){if(!SET.flashes&&!color.startsWith('rgba(0,0,0'))return;const f=$('flash');f.style.transition='none';f.style.background=color;f.style.opacity=op;requestAnimationFrame(()=>{f.style.transition='opacity .9s';f.style.opacity=0})}
const _v=new THREE.Vector3();
function floaty(text,color='#fff',wpos=null){const p=wpos||pig.pos.clone().add(new THREE.Vector3(0,.25,0));_v.copy(p).project(camera);if(_v.z>1)return;const d=document.createElement('div');d.className='floaty';d.textContent=text;d.style.color=color;
  let x=(_v.x*.5+.5)*innerWidth,y=(-_v.y*.5+.5)*innerHeight;d.style.left=x+'px';d.style.top=y+'px';document.body.appendChild(d);const t0=performance.now();x+=R(-20,20);
  (function up(){const k=(performance.now()-t0)/1100;d.style.top=(y-k*60)+'px';d.style.left=x+'px';d.style.opacity=1-k*k;if(k<1)requestAnimationFrame(up);else d.remove()})()}
function mult(){return (1+G.happy/100)*(1+herd.length*.06)}
function addScore(base,label,color){if(!base)return 0;const pts=Math.round(base*(base>0?mult():1));G.score=Math.max(0,G.score+pts);floaty((pts>0?'+':'')+pts+(label?' '+label:''),color||(pts>0?'#ffe38a':'#ff7b6b'));return pts}
function rankIdx(){let r=0;RANKS.forEach(([n],i)=>{if(G.forages>=n)r=i});return r}

// ============================================================ interactions
function mouthPos(){return new THREE.Vector3(pig.pos.x+Math.sin(pig.heading)*.15,pig.pos.y,pig.pos.z+Math.cos(pig.heading)*.15)}
function applyFood(type,{silent=false}={}){
  const it=ITEMS[type];
  if(type==='toadstool'){
    if(rand()<.55+rankIdx()*.1){addScore(20,'good nose!','#9fe88a');toast('👃 Your nose says <b>nope</b> — that Fly Agaric is toxic. Smart pig!','good')}
    else{G.hp=Math.max(0,G.hp-18);hurtFx();G.cause='nibbled a toxic mushroom';toast('🤢 You nibbled a <b>Fly Agaric</b>. Tummy ache! −18 ❤️','bad')}
    return}
  G.full=Math.min(100,G.full+(it.full||0));G.vitc=Math.min(100,G.vitc+(it.vitc||0));if(it.health)G.hp=Math.min(100,G.hp+it.health);if(it.energy)G.energy=Math.min(100,G.energy+it.energy);
  if(it.luck){G.luckT=90;toast('🍀 Lucky! Rare finds are much more likely for 90s','gold')}
  G.eaten++;
  pig.eating=.6;SFX.chomp();setTimeout(()=>SFX.chomp(),160);
  const m=mouthPos();emit(m.x,m.y+.05,m.z,6,{col:[.5,.8,.3],spread:.3,up:.6,size:.012,life:.5});
  return addScore(it.pts*(G.combo>1?G.combo:1),silent?'':'',null);
}
function discover(type){const first=!G.found[type];G.found[type]=(G.found[type]||0)+1;if(first&&type!=='grass'){toast(`📖 New journal entry: <b>${ITEMS[type].icon} ${ITEMS[type].name}</b>`,'gold');addScore(25,'new!','#ffd23f');
  const all=Object.keys(ITEMS).filter(k=>k!=='grass');if(all.every(k=>G.found[k])){toast('🏆 <b>Journal complete!</b> +1500','gold',6);addScore(1500,'journal!','#ffd23f');flash('rgba(255,215,80,.6)',.7)}}}

let forageState=null;
function nearest(list,px,pz,maxd,f=()=>true){let best=null,bd=maxd;for(const o of list){if(!f(o))continue;const d=Math.hypot(o.x-px,o.z-pz)-(o.r||0);if(d<bd){bd=d;best=o}}return best}
function currentActions(){
  const acts=[];if(pig.air||G.raft)return acts;
  const m=mouthPos();
  for(const b of Z.barns)for(const h of b.holes)if(Math.hypot(h.ex-pig.pos.x,h.ez-pig.pos.z)<.45)acts.push({k:'E',label:'Squeeze into the barn',do:()=>enterInside(b,h)});
  if(Z.raft&&Math.hypot(Z.raft.ex-pig.pos.x,Z.raft.ez-pig.pos.z)<.65)acts.push({k:'E',label:'Hop on the leaf raft',do:startRaft});
  if(Z.agility){const b=Z.agility,h=b.holes[0];if(Math.hypot(h.ex-pig.pos.x,h.ez-pig.pos.z)<.5)acts.push({k:'E',label:'Duck under the tent flap',do:()=>enterInside(b,h)})}
  if(Z.shop){const b=Z.shop,h=b.holes[0];if(Math.hypot(h.ex-pig.pos.x,h.ez-pig.pos.z)<.5){const open=shopOpen();
    acts.push(b.flapCD>0?{k:'E',label:`Duchess is watching the cat flap (${Math.ceil(b.flapCD)}s)`,disabled:true}:open?{k:'E',label:'Push through the cat flap',do:()=>enterInside(b,h)}:{k:'E',label:'Cat flap · locked while the shop is open (after 6 PM)',disabled:true})}}
  const gh=humans.find(h=>h.visible&&Math.hypot(h.obj.position.x-pig.pos.x,h.obj.position.z-pig.pos.z)<1.6);const gk=gh&&requestOf(gh);
  if(gk&&G.curios[gk])acts.push({k:'E',label:`Give ${CURIOS[gk].icon} ${CURIOS[gk].name} to ${gh.name}`,do:()=>giveCurio(gh,gk)});
  if(G.gnaw)return [{k:'E',label:'Chomp!',do:gnawHit}];
  const tw=nearTwig();if(tw)acts.push(tw.ready?{k:'E',label:`Gnaw the ${tw.apple?'apple twig':'twig'}`,do:()=>startGnaw(tw)}:{k:'E',label:'Gnawed twig · a new one falls soon',disabled:true});
  const tun=tunnels.find(t=>Math.hypot(t.ex-pig.pos.x,t.ez-pig.pos.z)<.45);if(tun)acts.push({k:'E',label:`Enter tunnel · ${tun.name}`,do:()=>openTunnel(tun)});
  let bestP=null,bd=.22;for(const ps of pickSets)for(const it of ps.items){if(!it.alive)continue;const d=Math.hypot(it.x-m.x,it.z-m.z);if(d<bd){bd=d;bestP={ps,it}}}
  for(const d of drops){if(!d.landed)continue;const dd=Math.hypot(d.x-m.x,d.z-m.z);if(dd<.25&&dd<bd+.05){bd=dd;bestP={drop:d}}}
  if(bestP){const t=bestP.drop?bestP.drop.type:bestP.ps.type;acts.push({k:'E',label:`Eat ${ITEMS[t].name}`,do:()=>eatPickable(bestP)})}
  const patch=patches.find(p=>p.amount>.15&&Math.hypot(p.x-m.x,p.z-m.z)<.5);
  if(patch&&!bestP&&!tun)acts.push({k:'E',hold:true,label:'Munch lush grass',patch});
  const spot=nearest(spots,pig.pos.x,pig.pos.z,.28,s=>s.ready&&(s.type!=='bush'||s.bush.berries||true));
  if(spot)acts.push({k:'F',hold:true,label:`Forage ${SPOTNAME[spot.type]}`,spot});
  else{const s2=nearest(spots,pig.pos.x,pig.pos.z,.28,s=>!s.ready);if(s2)acts.push({k:'F',label:`${SPOTNAME[s2.type]} · picked over (${Math.ceil(s2.cd)}s)`,disabled:true})}
  if(!patch&&!bestP&&!tun&&forestness(pig.pos.x,pig.pos.z)<.6&&distToPath(pig.pos.x,pig.pos.z)>.6&&!insideBox(pig.pos.x,pig.pos.z,.8)&&!(Z.cfg&&Z.cfg.grass&&Z.cfg.grass(pig.pos.x,pig.pos.z)<4)&&!G.wade)acts.push({k:'E',hold:true,label:'Nibble grass',nibble:true});
  const wf=nearestWild(1.3);
  if(wf)acts.push({k:'C',hold:true,label:`Chat with ${esc(wf.name)}${wf.shy?' (shy)':''} · ${BREEDS[wf.look.breed].name}${herd.length>=HERD_MAX?' (herd full: swap someone)':''}`});
  const hum=humans.find(h=>h.visible&&Math.hypot(h.obj.position.x-pig.pos.x,h.obj.position.z-pig.pos.z)<6);
  if(hum&&hum.tossCD<=0)acts.push({k:'Q',label:`Wheek at ${hum.name} for a veggie`});
  return acts;
}
function insideBox(x,z,pad=0){return boxes.some(b=>Math.abs(x-b.cx)<b.hx+pad&&Math.abs(z-b.cz)<b.hz+pad)}
function eatPickable(p){
  if(p.drop){const d=p.drop;d.obj.removeFromParent();drops.splice(drops.indexOf(d),1);discover(d.type);applyFood(d.type);return}
  const {ps,it}=p;it.alive=false;it.respawn=R(90,160);ps.set.setMatrix(it.i,ZERO);discover(ps.type);applyFood(ps.type);
}
let eatTick=0;
function holdEat(dt,act){
  eatTick-=dt;pig.eating=.3;
  if(eatTick>0)return;
  const fast=G.teethT>0?.75:1;
  if(act.hay){eatTick=.45*fast;G.full=Math.min(100,G.full+3);G.energy=Math.min(100,G.energy+.4);SFX.chomp();addScore(3);G.eaten++;discover('hay');
    const m=mouthPos();emit(m.x,m.y+.04,m.z,4,{col:[.85,.74,.36],spread:.25,up:.5,size:.01,life:.5})}
  else if(act.patch){eatTick=.45*fast;const p=act.patch;p.amount=Math.max(0,p.amount-.08);updatePatch(p);G.full=Math.min(100,G.full+3.2);G.vitc=Math.min(100,G.vitc+.4);SFX.chomp();addScore(4);G.eaten++;discover('grass');
    const m=mouthPos();emit(m.x,m.y+.04,m.z,4,{col:[.4,.75,.2],spread:.25,up:.5,size:.01,life:.5})}
  else{eatTick=.7*fast;G.full=Math.min(100,G.full+1.1);SFX.chomp();addScore(1);const m=mouthPos();emit(m.x,m.y+.03,m.z,3,{col:[.35,.6,.2],spread:.2,up:.4,size:.008,life:.4})}
}
function updatePatch(p){const k=.25+.75*p.amount;p.mats.forEach((m,j)=>G.lushSet.setMatrix(p.idx[j],mat4(m.x,m.y,m.z,m.ry,m.s,0,0,m.s*k)))}

function forageSpeed(){return (1+rankIdx()*.18)*G.perk.forage*(G.teethT>0?1.3:1)}
function startForage(spot){if(spot.type==='bush'&&!spot.bush.berries){toast('This bush has been picked clean. Try again later.');spot.ready=false;spot.cd=30;return}
  forageState={spot,t:0,need:1.7/forageSpeed(),rustle:0};$('forage').style.display='block';$('forage').querySelector('.l').textContent='Foraging '+SPOTNAME[spot.type]+'…'}
function updateForage(dt){
  const f=forageState;if(!f)return;
  if(!keys.KeyF||Math.hypot(f.spot.x-pig.pos.x,f.spot.z-pig.pos.z)>f.spot.r+.45){forageState=null;$('forage').style.display='none';return}
  f.t+=dt;f.rustle-=dt;pig.foraging=.2;
  if(f.rustle<=0){f.rustle=.14;SFX.rustle();const c={leafpile:[.75,.4,.1],bush:[.2,.45,.12],log:[.45,.32,.2],rock:[.5,.5,.45],bed:[.3,.2,.12],hay:[.8,.7,.35],prize:[1,.85,.3],drift:[.92,.96,1],bramble:[.25,.42,.12],stall:[.45,.72,.28],picnic:[.85,.3,.3],cress:[.7,.88,1],trough:[.8,.7,.35],apples:[.8,.2,.15],seedhead:[1,.8,.2],shopspill:[.5,.55,.25],shopbin:[.95,.75,.3],islandlog:[.55,.45,.35]}[f.spot.type];emit(f.spot.x+R(-.15,.15),groundAt(f.spot.x,f.spot.z)+.08,f.spot.z+R(-.15,.15),5,{col:c,spread:.6,up:1.2,size:.018,life:.8,grav:3})}
  $('forage').querySelector('i').style.width=(f.t/f.need*100)+'%';
  if(f.t>=f.need){forageState=null;$('forage').style.display='none';completeForage(f.spot)}
}
function completeForage(spot){
  spot.ready=false;spot.cd=spot.type==='prize'?300:R(55,90);if(spot.type==='prize')G.mazePrize++;
  if(spot.type==='leafpile'){G.lpSet.setMatrix(spot.lp.i,mat4(spot.lp.x,heightAt(spot.lp.x,spot.lp.z)-.02,spot.lp.z,spot.lp.ry,spot.lp.s*1.15,0,0,spot.lp.s*.35))}
  let table={...LOOT[spot.type]};
  const luck=rankIdx()*.25+(G.luckT>0?1.5:0);
  for(const k in table){const r=ITEMS[k]?.rarity;if(r==='rare'||r==='epic'||r==='legendary')table[k]*=1+luck}
  if(Z.loot)for(const k in Z.loot)if(table[k])table[k]*=Z.loot[k];
  if(spot.type==='bush'){spot.bush.berries=false;spot.bush.cd=R(80,120);G.bushSet.setMatrix(spot.bush.i,ZERO,n=>n==='Berry')}
  const got=pick(table);
  G.comboT>0?G.combo=Math.min(5,G.combo+1):G.combo=1;G.comboT=22;
  const prevRank=rankIdx();G.forages++;G.happy=Math.min(100,G.happy+5);
  if(rankIdx()>prevRank){SFX.levelup();toast(`⭐ Forager rank up: <b>${RANKS[rankIdx()][1]}</b>! Faster and luckier foraging.`,'gold',5);addScore(150,'rank up!','#ffd23f')}
  if(got==='nothing'){toast('Just dirt and twigs this time…');addScore(3);return}
  revealItem(got,spot);
}
function groundAt(x,z){return G.under?0:G.inside?insideHeight(x,z):heightAt(x,z)}
function activeScene(){return G.under?wScene:G.inside?iScene:scene}
function revealItem(type,spot){
  const it=ITEMS[type];const r=it.rarity;
  const y0=groundAt(spot.x,spot.z)+.08;
  const g=new THREE.Group();const model=M[it.model].clone(true);g.add(model);
  if(it.gold||it.tint){model.traverse(o=>{if(o.isMesh){o.material=o.material.clone();if(it.gold){o.material.color.set(0xffd54a);o.material.emissive=new THREE.Color(0xffa800);o.material.emissiveIntensity=.55;o.material.metalness=.6;o.material.roughness=.3}else if(o.material.name==='Veg'){o.material.color.set(it.tint)}}})}
  const sc=ITEM_SCALE[it.model]||1.4;g.scale.setScalar(sc);g.position.set(spot.x,y0,spot.z);activeScene().add(g);
  const col=new THREE.Color(RARITY[r][0]);
  const beam=new THREE.Mesh(new THREE.CylinderGeometry(.06,.14,2.2,16,1,true),new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:.45,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,fog:false}));
  beam.position.set(spot.x,y0+1.1,spot.z);if(r!=='common'&&r!=='toxic')activeScene().add(beam);
  const burst=r==='legendary'?70:r==='epic'?45:r==='rare'?30:14;emit(spot.x,y0+.1,spot.z,burst,{col:[col.r,col.g,col.b],spread:1,up:1.6,size:.03,life:1.2,grav:1.5,jitter:.1});
  SFX.pop();SFX.find(r);
  const combo=G.combo>1?` <span style="color:#ffd23f">×${G.combo} combo</span>`:'';
  const est=type==='toadstool'?0:Math.round(it.pts*(G.combo||1)*mult());
  callout(r,`${it.icon} ${it.name}`,est);
  if(r==='legendary'){flash('rgba(255,215,80,.55)',.8)}else if(r==='epic')flash('rgba(200,140,255,.35)',.5);
  toast(`${it.icon} <b style="color:${RARITY[r][0]}">${it.name}</b>${combo}`,r==='legendary'||r==='epic'?'gold':'');
  const anim={g,beam,t:0,type,spin:0};revealAnims.push(anim);
}
const revealAnims=[];
function updateReveals(dt){for(let i=revealAnims.length-1;i>=0;i--){const a=revealAnims[i];a.t+=dt;const g=a.g;
  if(a.t<1.1){g.position.y+=dt*(a.t<.5?.5:.05);g.rotation.y+=dt*4;a.beam.material.opacity=.45*(1-a.t/1.4)}
  else{const m=mouthPos();const k=clamp((a.t-1.1)/.35,0,1);g.position.lerp(new THREE.Vector3(m.x,m.y+.06,m.z),k);g.scale.multiplyScalar(1-k*.25);
    if(k>=1){g.removeFromParent();a.beam.removeFromParent();discover(a.type);applyFood(a.type);revealAnims.splice(i,1)}}}}

// wheek & tossing
function wheek(){if(G.wheekCD>0)return;G.wheekCD=1.2;SFX.wheek();G.wheekT=3;floaty('Wheek!','#fff');
  if(G.inside){if(G.inside.cat)catNoise(.4);if(herd.length)setTimeout(()=>SFX.chut(),500);return}
  if(G.under){setTimeout(()=>SFX.wheek(),420);if(herd.length)setTimeout(()=>SFX.chut(),700);return}
  const h=humans.find(h=>h.visible&&Math.hypot(h.obj.position.x-pig.pos.x,h.obj.position.z-pig.pos.z)<6);
  if(h){if(h.tossCD>0){toast(`${h.name}: “You already had a snack, silly!” (${Math.ceil(h.tossCD)}s)`);return}
    h.tossCD=45;const type=pick(Z.toss||{carrot:40,strawberry:30,pepper:25,goldCarrot:2});setTimeout(()=>tossVeg(h,type),600);toast(`🥰 ${h.name} heard you! Here comes a snack…`,'good')}
  if(hawk.state==='circle'){hawk.detect=Math.min(1,hawk.detect+.25);toast('🦅 Oops — the hawk heard that!','bad')}}
function tossVeg(h,type){const it=ITEMS[type];const o=M[it.model].clone(true);if(it.gold)o.traverse(m=>{if(m.isMesh){m.material=m.material.clone();m.material.color.set(0xffd54a);m.material.emissive=new THREE.Color(0xffa800);m.material.emissiveIntensity=.5}});o.scale.setScalar(1.1);ZG.add(o);
  const from=h.obj.position.clone().add(new THREE.Vector3(0,.8,0));const to=new THREE.Vector3(pig.pos.x+Math.sin(pig.heading)*.3,0,pig.pos.z+Math.cos(pig.heading)*.3);to.y=heightAt(to.x,to.z);
  drops.push({obj:o,type,from,to,t:0,landed:false,x:to.x,z:to.z,life:60})}
function updateDrops(dt){for(let i=drops.length-1;i>=0;i--){const d=drops[i];if(!d.landed){d.t+=dt/.9;const k=Math.min(1,d.t);d.obj.position.lerpVectors(d.from,d.to,k);d.obj.position.y+=Math.sin(k*Math.PI)*.7;d.obj.rotation.x+=dt*8;if(k>=1){d.landed=true;d.obj.rotation.set(0,rand()*6,0);d.obj.position.copy(d.to);emit(d.to.x,d.to.y+.05,d.to.z,8,{col:[.5,.4,.3],spread:.4,up:.6,size:.012,life:.5})}}
  else{d.life-=dt;d.obj.position.y=d.to.y+Math.abs(Math.sin(performance.now()/300))*.01;if(d.life<=0){d.obj.removeFromParent();drops.splice(i,1)}}}}

// sniff
function sniff(){if(G.sniffCD>0){toast(`Your nose needs a moment (${Math.ceil(G.sniffCD)}s)`);return}G.sniffCD=10;SFX.sniff();if(G.under){sniffWarren();return}let n=0,t=0;
  for(const s of spots){if(!s.ready)continue;const d=Math.hypot(s.x-pig.pos.x,s.z-pig.pos.z);if(d<22){marker(s.x,heightAt(s.x,s.z)+.2,s.z,0xffd060);n++}}
  for(const tu of tunnels){const d=Math.hypot(tu.x-pig.pos.x,tu.z-pig.pos.z);if(d<32){marker(tu.ex,heightAt(tu.ex,tu.ez)+.35,tu.ez,tu.found?0x7fd0ff:0x9a7bff);if(!tu.found)t++}}
  let bh=0;for(const b of Z.barns)for(const h of b.holes)if(Math.hypot(h.ex-pig.pos.x,h.ez-pig.pos.z)<32){marker(h.ex,heightAt(h.ex,h.ez)+.3,h.ez,0xffb060);bh++}
  if(Z.raft&&Math.hypot(Z.raft.ex-pig.pos.x,Z.raft.ez-pig.pos.z)<32){marker(Z.raft.ex,heightAt(Z.raft.ex,Z.raft.ez)+.3,Z.raft.ez,0x9fe88a);toast('👃 …and a big leaf down by the water. Looks like it would float!')}
  let sf=0;if(Z.shop){const h=Z.shop.holes[0];if(Math.hypot(h.ex-pig.pos.x,h.ez-pig.pos.z)<32){marker(h.ex,heightAt(h.ex,h.ez)+.3,h.ez,0xff9fd0);sf=1}}
  let w=0;for(const f of friends){if(f.state!=='wild'||f.zone!==Z.id)continue;const d=Math.hypot(f.pos.x-pig.pos.x,f.pos.z-pig.pos.z);if(d<30){marker(f.pos.x,f.pos.y+.3,f.pos.z,0xff9fd0);f.known=true;w++}}
  toast(`👃 Sniff sniff… ${n} forage spot${n===1?'':'s'} nearby${t?`, and <b>${t} hidden tunnel${t>1?'s':''}</b>`:''}${bh?`, and <b>a way into the barn</b> 🛖`:''}${sf?`, and <b>a cat flap</b> 🐾`:''}${w?`, and <b>${w} guinea pig${w>1?'s':''}</b> 🐹`:''}!`)}

// ============================================================ tunnels
const tScene=new THREE.Scene();tScene.background=new THREE.Color(0x070403);tScene.fog=new THREE.Fog(0x070403,.5,6);
const tCam=new THREE.PerspectiveCamera(62,innerWidth/innerHeight,.01,50);
let tCurve=null,tPig=null,travel=null;
function buildTunnelScene(){
  const pts=[];for(let i=0;i<14;i++)pts.push(new THREE.Vector3(Math.sin(i*.9)*1.4+R(-.4,.4),Math.sin(i*.6)*.4,-i*2.2));
  tCurve=new THREE.CatmullRomCurve3(pts);
  const tg=new THREE.TubeGeometry(tCurve,260,.34,16,false);
  const c=[];const p=tg.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i);const n=fbm(x*3+z,y*3+z*.7,3)*.5+.5;c.push(lerp(.22,.42,n),lerp(.14,.28,n),lerp(.08,.16,n))}
  tg.setAttribute('color',new THREE.Float32BufferAttribute(c,3));
  tScene.add(new THREE.Mesh(tg,new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.BackSide,roughness:1,map:detailTex,color:0x9a8a78})));
  const rootMat=new THREE.MeshStandardMaterial({color:0x5a3f28,roughness:1});
  for(let i=0;i<70;i++){const t=rand();const c0=tCurve.getPointAt(t);const a=rand()*6.28;const r=new THREE.Mesh(new THREE.CylinderGeometry(.008,.02,R(.3,.8),5),rootMat);r.position.set(c0.x+Math.cos(a)*.3,c0.y+Math.sin(a)*.3,c0.z);r.rotation.set(rand()*3,rand()*3,rand()*3);tScene.add(r)}
  const glowCols=[0x5affc8,0x7ad0ff,0xb8ff6a];
  for(let i=0;i<45;i++){const t=rand();const c0=tCurve.getPointAt(t);const a=R(.3,2.8);const m=new THREE.Mesh(new THREE.SphereGeometry(R(.012,.025),8,6),new THREE.MeshBasicMaterial({color:glowCols[i%3]}));m.position.set(c0.x+Math.cos(a)*.31,c0.y+Math.sin(a)*.31,c0.z);m.scale.y=.5;tScene.add(m)}
  tScene.add(new THREE.HemisphereLight(0x405060,0x201008,.35));
  const pl=new THREE.PointLight(0xffc890,.9,2.6,2);tScene.add(pl);tScene.userData.pl=pl;
  for(let i=0;i<5;i++){const l=new THREE.PointLight(glowCols[i%3],.45,2,2);l.position.copy(tCurve.getPointAt((i+.5)/5));tScene.add(l)}
}
function openTunnel(t){
  G.modal=true;$('tunnelMenu').classList.remove('hidden');$('tmTitle').textContent='🕳 '+t.name;
  const list=$('tmList');list.innerHTML='';
  const rest=document.createElement('button');rest.className='btn';rest.innerHTML='💤 Nap here — restore energy &amp; health, 2 hours pass';rest.onclick=()=>{closeTunnel();restInTunnel()};list.appendChild(rest);
  if(t.node){const dig=document.createElement('button');dig.className='btn';dig.innerHTML='🕳 Crawl down into the warren — explore the tunnels';dig.onclick=()=>{closeTunnel();enterWarren(t)};list.appendChild(dig)}
  const linked=t.node?linkedTo(t):[];linked.forEach(x=>{const b=document.createElement('button');b.className='btn alt';const d=Math.round(Math.hypot(x.x-t.x,x.z-t.z));b.innerHTML=`➜ Scurry to <b>${x.name}</b> <span style="opacity:.6">(${d} m)</span>`;b.onclick=()=>{closeTunnel();startTravel(t,x)};list.appendChild(b)});
  if(!linked.length&&t.node){const p=document.createElement('p');p.textContent=tunnels.filter(x=>x.found).length<2?'Find more tunnels (sniff with R!) to travel between them.':'Explore the warren below. Once you have walked the passages between two burrows, you can scurry straight there.';list.appendChild(p)}
  const back=document.createElement('button');back.className='btn alt';back.textContent='↩ Back outside';back.onclick=closeTunnel;list.appendChild(back);
  G.hidden=true;
}
function closeTunnel(){G.modal=false;G.hidden=false;$('tunnelMenu').classList.add('hidden')}
function findTunnel(tu,below){tu.found=true;G.tunnels++;const zid=tu.node?'park':Z.id,zt=tu.node?PARK.tunnels:tunnels;(G.zfound[zid]||(G.zfound[zid]=[])).push(zt.indexOf(tu));SFX.find('rare');callout('rare','🕳 '+tu.name,100);
  toast(below?`🕳 <b>You found ${tu.name} from below!</b> Climb out here any time.`:`🕳 <b>Tunnel discovered: ${tu.name}!</b> ${G.input==='touch'?'At the entrance, tap Enter tunnel':'Press '+kb('E')+' at the entrance'} to nap, hide or crawl into the warren.`,'gold',5);addScore(100,'tunnel!','#7fd0ff');
  if(zt.every(t=>t.found)){if(zid==='park'){toast('🏆 <b>You found every tunnel in the park!</b> +1000','gold',6);addScore(1000,'all tunnels!','#ffd23f')}else{toast(`🏆 <b>Every burrow in ${Z.name}!</b> +400`,'gold',6);addScore(400,'all burrows!','#ffd23f')}}}
function restInTunnel(){flash('rgba(0,0,0,1)',1);G.time+=2;G.energy=100;G.hp=Math.min(100,G.hp+20);G.full=Math.max(0,G.full-8);G.vitc=Math.max(0,G.vitc-5);if(herd.length){G.happy=Math.min(100,G.happy+herd.length*6);toast(`💤 You and your herd of ${herd.length+1} snuggled up in a warm pile. Energy restored!`,'good')}else toast('💤 You curled up in the cozy burrow. Energy restored!','good');addScore(10+herd.length*10)}
function startTravel(a,b){
  G.inTunnel=true;travel={a,b,t:0};$('prompt').innerHTML='';$('danger').style.display='none';SFX.whoosh();scene.remove(pig.obj);tScene.add(pig.obj);pig.blob.visible=false;G.energy=Math.max(0,G.energy-3);
  flash('rgba(0,0,0,1)',1);
}
function updateTravel(dt){
  travel.t+=dt/3.4;const k=smooth(0,1,travel.t);const p=tCurve.getPointAt(clamp(k,0,.999));const p2=tCurve.getPointAt(clamp(k+.01,0,1));
  pig.obj.position.set(p.x,p.y-.3,p.z);pig.obj.lookAt(p2.x,p2.y-.3,p2.z);animatePigLegs(dt,2.2,true);
  const pc=tCurve.getPointAt(clamp(k-.035,0,1));tCam.position.set(pc.x,pc.y-.16,pc.z);tCam.lookAt(p.x,p.y-.25,p.z);tScene.userData.pl.position.set(pc.x,pc.y-.08,pc.z);
  if(travel.t>=1){const b=travel.b;tScene.remove(pig.obj);scene.add(pig.obj);pig.obj.rotation.set(0,0,0);pig.pos.set(b.ex,heightAt(b.ex,b.ez),b.ez);pig.heading=b.rot;G.camYaw=b.rot+Math.PI;pig.blob.visible=true;G.inTunnel=false;travel=null;regroupHerd();flash('rgba(0,0,0,1)',1);toast(`🕳 Popped out at <b>${b.name}</b>`);addScore(15)}
}

// ============================================================ the warren (explorable underground)
// The burrows open into one cave network. Its layout is the surface map shrunk by WS, so each burrow's den lies right
// under its entrance and every passage heads the way its burrow lies above. The walls are one surface-nets mesh over a
// signed distance field (open space < 0): capsules for passages, domes for chambers, a flat floor at y=0.
const WS=.34,W_RT=.38,W_CY=.3,W_VS=.1,W_TOP=1.55;
const wScene=new THREE.Scene();wScene.background=new THREE.Color(0x0a0604);wScene.fog=new THREE.Fog(0x0a0604,.9,7);
const W={nodes:[],edges:[],prims:[],cells:new Map(),foods:[],curios:[],glows:[],pool:[],trail:[],pts:0,seenPts:0,revealT:0,lightT:0,from:null};
const CURIOS={
  button:{name:'Lost Button',icon:'🔘',rarity:'common',pts:60},
  acorn:{name:'Acorn Cap',icon:'🌰',rarity:'common',pts:60},
  marble:{name:'Blue Marble',icon:'🔵',rarity:'uncommon',pts:100},
  shell:{name:'Snail Shell',icon:'🐚',rarity:'uncommon',pts:100},
  coin:{name:'Old Penny',icon:'🪙',rarity:'uncommon',pts:100},
  feather:{name:'Jay Feather',icon:'🪶',rarity:'rare',pts:180},
  key:{name:'Tiny Brass Key',icon:'🗝️',rarity:'rare',pts:180},
  crystal:{name:'Glow Crystal',icon:'💎',rarity:'epic',pts:300},
  goldAcorn:{name:'Golden Acorn',icon:'✨🌰',rarity:'legendary',pts:600},
};
const HALLS=[['Glowworm Grotto','glow'],['Root Cellar','roots'],['Mushroom Hall','shrooms'],['Old Seed Store','larder'],['Crystal Hollow','crystal']];
const HALL_BLURB={glow:'Glowworms twinkle on the ceiling.',roots:'Tree roots dangle everywhere, and someone left carrots.',shrooms:'Mushrooms glow in the dark.',larder:'An old guinea pig larder, still stocked!',crystal:'The walls sparkle.'};
const smin=(a,b,k)=>{const h=clamp(.5+.5*(b-a)/k,0,1);return lerp(b,a,h)-k*h*(1-h)};
function primSd(p,x,y,z){
  if(p.c){const dx=(x-p.x)/p.r,dy=y/p.h,dz=(z-p.z)/p.r;return (Math.sqrt(dx*dx+dy*dy+dz*dz)-1)*Math.min(p.r,p.h)}
  if(p.v){const qy=y-clamp(y,p.y0,p.y1);return Math.sqrt((x-p.x)**2+qy*qy+(z-p.z)**2)-p.r}
  const bx=p.bx-p.ax,bz=p.bz-p.az,t=clamp(((x-p.ax)*bx+(z-p.az)*bz)/(bx*bx+bz*bz),0,1),qx=x-p.ax-bx*t,qz=z-p.az-bz*t,qy=y-W_CY;
  return Math.sqrt(qx*qx+qy*qy+qz*qz)-W_RT}
function primBox(p){return p.c||p.v?[p.x-p.r,p.x+p.r,p.z-p.r,p.z+p.r]:[Math.min(p.ax,p.bx)-W_RT,Math.max(p.ax,p.bx)+W_RT,Math.min(p.az,p.bz)-W_RT,Math.max(p.az,p.bz)+W_RT]}
const wKey=(cx,cz)=>(cx+500)*1000+cz+500;
// distance to the cave wall without its noise (collision and the camera keep a margin for that)
function wSdf(x,y,z,floor=true){const l=W.cells.get(wKey(Math.floor(x/2),Math.floor(z/2)));if(!l)return 1;let d=1;for(const p of l)d=Math.min(d,primSd(p,x,y,z));return floor?Math.max(d,-y):d}
function warrenCollide(P,pr){const y=.12,e=.02;
  for(let k=0;k<3;k++){const d=wSdf(P.x,y,P.z);if(d<-pr)return;const gx=wSdf(P.x+e,y,P.z)-wSdf(P.x-e,y,P.z),gz=wSdf(P.x,y,P.z+e)-wSdf(P.x,y,P.z-e),gl=Math.hypot(gx,gz);if(gl<1e-6)return;P.x-=gx/gl*(d+pr);P.z-=gz/gl*(d+pr)}}

// naive surface nets: one vertex per cell the surface crosses, one quad per crossing grid edge; normals face open space
function surfaceNets(F,nx,ny,nz,ox,oy,oz,vs){
  const I=(x,y,z)=>x+nx*(y+ny*z);const V=new Int32Array(nx*ny*nz).fill(-1);const pos=[],nor=[],idx=[];const cv=new Float32Array(8);
  const EG=[[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
  for(let z=0;z<nz-1;z++)for(let y=0;y<ny-1;y++)for(let x=0;x<nx-1;x++){
    let m=0;for(let k=0;k<8;k++){const v=F[I(x+(k&1),y+(k>>1&1),z+(k>>2&1))];cv[k]=v;if(v<0)m|=1<<k}
    if(m===0||m===255)continue;
    let sx=0,sy=0,sz=0,c=0;
    for(const [a,b] of EG){if((cv[a]<0)===(cv[b]<0))continue;const t=cv[a]/(cv[a]-cv[b]);sx+=(a&1)+((b&1)-(a&1))*t;sy+=(a>>1&1)+((b>>1&1)-(a>>1&1))*t;sz+=(a>>2&1)+((b>>2&1)-(a>>2&1))*t;c++}
    V[I(x,y,z)]=pos.length/3;pos.push(ox+(x+sx/c)*vs,oy+(y+sy/c)*vs,oz+(z+sz/c)*vs);
    const gx=cv[1]+cv[3]+cv[5]+cv[7]-cv[0]-cv[2]-cv[4]-cv[6],gy=cv[2]+cv[3]+cv[6]+cv[7]-cv[0]-cv[1]-cv[4]-cv[5],gz=cv[4]+cv[5]+cv[6]+cv[7]-cv[0]-cv[1]-cv[2]-cv[3],gl=Math.hypot(gx,gy,gz)||1;
    nor.push(-gx/gl,-gy/gl,-gz/gl)}
  const quad=(a,b,c,d,flip)=>{if(a<0||b<0||c<0||d<0)return;if(flip)idx.push(a,b,c,a,c,d);else idx.push(a,c,b,a,d,c)};
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const s0=F[I(x,y,z)]<0;
    if(x<nx-1&&y>0&&z>0&&(F[I(x+1,y,z)]<0)!==s0)quad(V[I(x,y-1,z-1)],V[I(x,y,z-1)],V[I(x,y,z)],V[I(x,y-1,z)],s0);
    if(y<ny-1&&x>0&&z>0&&(F[I(x,y+1,z)]<0)!==s0)quad(V[I(x-1,y,z-1)],V[I(x-1,y,z)],V[I(x,y,z)],V[I(x,y,z-1)],s0);
    if(z<nz-1&&x>0&&y>0&&(F[I(x,y,z+1)]<0)!==s0)quad(V[I(x-1,y-1,z)],V[I(x,y-1,z)],V[I(x,y,z)],V[I(x-1,y,z)],s0)}
  // make the winding agree with the normals (which way round is easy to get backwards)
  let agree=0;for(let i=0;i<Math.min(idx.length,30000);i+=3){const a=idx[i]*3,b=idx[i+1]*3,c=idx[i+2]*3;
    const ux=pos[b]-pos[a],uy=pos[b+1]-pos[a+1],uz=pos[b+2]-pos[a+2],wx=pos[c]-pos[a],wy=pos[c+1]-pos[a+1],wz=pos[c+2]-pos[a+2];
    agree+=(uy*wz-uz*wy)*nor[a]+(uz*wx-ux*wz)*nor[a+1]+(ux*wy-uy*wx)*nor[a+2]}
  if(agree<0)for(let i=0;i<idx.length;i+=3){const t=idx[i+1];idx[i+1]=idx[i+2];idx[i+2]=t}
  return {pos,nor,idx}}

function wSet(name,mats,tweak){const parts=bake(name);return parts.map(p=>{const mat=tweak?tweak(p.mat.clone()):p.mat;const im=new THREE.InstancedMesh(p.geo,mat,mats.length);mats.forEach((m,j)=>im.setMatrixAt(j,m));im.computeBoundingSphere();wScene.add(im);return im})}
function itemModel(type){const it=ITEMS[type];const o=M[it.model].clone(true);
  if(it.gold||it.tint)o.traverse(m=>{if(m.isMesh){m.material=m.material.clone();if(it.gold){m.material.color.set(0xffd54a);m.material.emissive=new THREE.Color(0xffa800);m.material.emissiveIntensity=.5}else if(m.material.name==='Veg')m.material.color.set(it.tint)}});
  o.scale.setScalar(ITEM_SCALE[it.model]||1.3);return o}
function curioModel(k){const g=new THREE.Group();
  const add=(geo,col,o={})=>{const p={color:col,roughness:o.r??.45,metalness:o.m??0};if(o.e)Object.assign(p,{emissive:new THREE.Color(o.e),emissiveIntensity:o.ei??1});const m=new THREE.Mesh(geo,new THREE.MeshStandardMaterial(p));g.add(m);return m};
  const acorn=(gold)=>{const c=gold?{m:.6,r:.3,e:0xffa800,ei:.6}:{};add(new THREE.SphereGeometry(.026,14,10),gold?0xffd54a:0xb57a3a,c).scale.set(1,1.3,1);const cap=add(new THREE.SphereGeometry(.029,14,8,0,Math.PI*2,0,Math.PI/2),gold?0xffc02a:0x6b4a2a,c);cap.position.y=.012};
  if(k==='marble')add(new THREE.SphereGeometry(.028,18,12),0x3a7bff,{r:.08,e:0x0a2050});
  else if(k==='button'){const b=add(new THREE.CylinderGeometry(.034,.034,.01,20),0xd94a6a);b.rotation.x=1.2}
  else if(k==='acorn')acorn(false);
  else if(k==='shell'){add(new THREE.TorusGeometry(.024,.012,10,20),0xe8c9a0).rotation.y=.4;add(new THREE.SphereGeometry(.013,10,8),0xd8b080).position.set(0,0,.004)}
  else if(k==='coin'){const c=add(new THREE.CylinderGeometry(.026,.026,.006,22),0xc07a3a,{m:.8,r:.3});c.rotation.x=1.3}
  else if(k==='feather'){const f=add(new THREE.ConeGeometry(.014,.11,8),0x3a8adf,{r:.6});f.scale.z=.3;f.rotation.z=1.1}
  else if(k==='key'){add(new THREE.TorusGeometry(.016,.005,8,16),0xd8a830,{m:.8,r:.3}).position.x=-.025;add(new THREE.BoxGeometry(.05,.008,.008),0xd8a830,{m:.8,r:.3}).position.x=.01}
  else if(k==='crystal')add(new THREE.OctahedronGeometry(.032),0x9af0ff,{r:.15,e:0x2a90b0,ei:1.4}).scale.y=1.7;
  else acorn(true);
  return g}

function buildWarren(){
  const wr=mulberry32(20260929),WR=(a,b)=>a+(b-a)*wr();const N=W.nodes,E=W.edges;
  tunnels.forEach(t=>{const n={x:t.x*WS,z:t.z*WS,r:1.05,h:.85,kind:'den',name:t.name,den:t};t.node=n;N.push(n)});
  for(const [name,theme] of HALLS)for(let k=0;k<500;k++){const a=wr()*Math.PI*2,rr=Math.sqrt(wr())*(EDGE-6)*WS,x=Math.cos(a)*rr,z=Math.sin(a)*rr;
    if(N.some(n=>Math.hypot(n.x-x,n.z-z)<n.r+4))continue;N.push({x,z,r:WR(1.35,1.7),h:WR(1,1.15),kind:'hall',theme,name});break}
  const link=(a,b)=>E.push({a,b});
  const segX=(a,b,c,d)=>{const o=(p,q,r)=>Math.sign((q.x-p.x)*(r.z-p.z)-(q.z-p.z)*(r.x-p.x));return o(a,b,c)!==o(a,b,d)&&o(c,d,a)!==o(c,d,b)};
  const segD=(p,a,b)=>{const bx=b.x-a.x,bz=b.z-a.z,t=clamp(((p.x-a.x)*bx+(p.z-a.z)*bz)/(bx*bx+bz*bz),0,1);return Math.hypot(p.x-a.x-bx*t,p.z-a.z-bz*t)};
  const ok=(a,b)=>!E.some(e=>e.a!==a&&e.b!==a&&e.a!==b&&e.b!==b&&segX(a,b,e.a,e.b))&&N.every(n=>n===a||n===b||segD(n,a,b)>n.r+.9);
  // a spanning tree (never crosses itself), then a few short loops, then dead-end nooks
  {const inT=[N[0]],out=N.slice(1);while(out.length){let best=null,bd=1e9;for(const a of inT)for(const b of out){const d=Math.hypot(a.x-b.x,a.z-b.z);if(d<bd){bd=d;best=[a,b]}}link(...best);inT.push(best[1]);out.splice(out.indexOf(best[1]),1)}}
  {const pairs=[];for(let i=0;i<N.length;i++)for(let j=i+1;j<N.length;j++)pairs.push([N[i],N[j],Math.hypot(N[i].x-N[j].x,N[i].z-N[j].z)]);pairs.sort((p,q)=>p[2]-q[2]);
   let extra=0;for(const [a,b,d] of pairs){if(extra>=4||d>13)break;if(E.some(e=>e.a===a&&e.b===b||e.a===b&&e.b===a))continue;if(ok(a,b)){link(a,b);extra++}}}
  {const bases=N.slice();for(let k=0,tries=0;k<4&&tries<400;tries++){const a=bases[Math.floor(wr()*bases.length)],ang=wr()*Math.PI*2,L=WR(2.6,4.2);
    const nk={x:a.x+Math.cos(ang)*L,z:a.z+Math.sin(ang)*L,r:.62,h:.62,kind:'nook',name:'a snug nook'};
    if(Math.hypot(nk.x,nk.z)>EDGE*WS||!N.every(n=>Math.hypot(n.x-nk.x,n.z-nk.z)>n.r+2.2)||!E.every(e=>segD(nk,e.a,e.b)>1.6)||!ok(a,nk))continue;N.push(nk);link(a,nk);k++}}
  // passages wander a little on the way
  for(const e of E){const {a,b}=e,dx=b.x-a.x,dz=b.z-a.z,L=Math.hypot(dx,dz),px=-dz/L,pz=dx/L,w1=WR(-.08,.08)*L,w2=WR(-.04,.04)*L,n=Math.max(4,Math.ceil(L/.45));
    e.len=L;e.pts=[];for(let k=0;k<=n;k++){const t=k/n,o=Math.sin(Math.PI*t)*w1+Math.sin(Math.PI*2*t)*w2;e.pts.push({x:a.x+dx*t+px*o,z:a.z+dz*t+pz*o,seen:false})}
    for(let k=0;k<n;k++)W.prims.push({ax:e.pts[k].x,az:e.pts[k].z,bx:e.pts[k+1].x,bz:e.pts[k+1].z});W.pts+=e.pts.length}
  for(const n of N){W.prims.push({c:1,x:n.x,z:n.z,r:n.r,h:n.h});n.edges=E.filter(e=>e.a===n||e.b===n);if(n.kind==='den')W.prims.push({v:1,x:n.x,z:n.z,r:.3,y0:.4,y1:3})}
  for(const p of W.prims){const [x0,x1,z0,z1]=primBox(p);for(let cx=Math.floor((x0-1)/2);cx<=Math.floor((x1+1)/2);cx++)for(let cz=Math.floor((z0-1)/2);cz<=Math.floor((z1+1)/2);cz++){const k=wKey(cx,cz);if(!W.cells.has(k))W.cells.set(k,[]);W.cells.get(k).push(p)}}

  // --- the distance field and the cave mesh
  let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;for(const p of W.prims){const b=primBox(p);x0=Math.min(x0,b[0]);x1=Math.max(x1,b[1]);z0=Math.min(z0,b[2]);z1=Math.max(z1,b[3])}
  const vs=W_VS,ox=x0-.6,oy=-.25,oz=z0-.6,nx=Math.ceil((x1-x0+1.2)/vs)+1,ny=Math.ceil((W_TOP-oy)/vs)+1,nz=Math.ceil((z1-z0+1.2)/vs)+1;
  const F=new Float32Array(nx*ny*nz).fill(1);
  for(const p of W.prims){const [a0,a1,b0,b1]=primBox(p),pad=.3,top=p.v?ny-1:Math.min(ny-1,Math.ceil(((p.c?p.h:W_CY+W_RT)+pad-oy)/vs));
    const i0=Math.max(0,Math.floor((a0-pad-ox)/vs)),i1=Math.min(nx-1,Math.ceil((a1+pad-ox)/vs)),k0=Math.max(0,Math.floor((b0-pad-oz)/vs)),k1=Math.min(nz-1,Math.ceil((b1+pad-oz)/vs));
    for(let k=k0;k<=k1;k++)for(let j=0;j<=top;j++)for(let i=i0;i<=i1;i++){const q=i+nx*(j+ny*k);F[q]=smin(F[q],primSd(p,ox+i*vs,oy+j*vs,oz+k*vs),.12)}}
  for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const q=i+nx*(j+ny*k);if(F[q]>.4)continue;const x=ox+i*vs,y=oy+j*vs,z=oz+k*vs;
    const wall=vnoise(x*2.4+y*1.7,z*2.4-y*1.3)*.05+vnoise(x*.8-y*.6,z*.8+y*.5)*.07;F[q]=Math.max(F[q]+wall*smooth(0,.25,y),-y)}
  const {pos,nor,idx}=surfaceNets(F,nx,ny,nz,ox,oy,oz,vs);
  const col=new Float32Array(pos.length),uv=new Float32Array(pos.length/3*2);
  for(let i=0;i<pos.length/3;i++){const x=pos[i*3],y=pos[i*3+1],z=pos[i*3+2],ny_=nor[i*3+1];
    const n=vnoise(x*1.6+y*2,z*1.6)*.5+.5,strata=Math.sin(y*24+vnoise(x*.6,z*.6)*4)*.5+.5,floor=smooth(.6,.9,ny_);
    let r=lerp(.2,.34,n)*lerp(.8,1.1,strata),g=lerp(.13,.22,n)*lerp(.8,1.06,strata),b=lerp(.08,.13,n);
    r=lerp(r,.34+n*.08,floor);g=lerp(g,.25+n*.06,floor);b=lerp(b,.16+n*.04,floor);const up=smooth(.2,1.2,y);col[i*3]=r*(1-up*.25);col[i*3+1]=g*(1-up*.22);col[i*3+2]=b*(1-up*.2);
    if(Math.abs(ny_)>.6){uv[i*2]=x*1.3;uv[i*2+1]=z*1.3}else{uv[i*2]=(x+z)*1.3;uv[i*2+1]=y*1.3}}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3));
  geo.setAttribute('color',new THREE.BufferAttribute(col,3));geo.setAttribute('uv',new THREE.BufferAttribute(uv,2));geo.setIndex(idx);geo.computeBoundingSphere();
  wScene.add(new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.97,map:detailTex})));
  W.tris=idx.length/3;

  // --- light
  wScene.add(new THREE.HemisphereLight(0x7a6a58,0x1a1008,.28));
  W.lantern=new THREE.PointLight(0xffd0a0,1.1,3.2,1.6);wScene.add(W.lantern);
  for(let i=0;i<3;i++){const l=new THREE.PointLight(0xffffff,0,5,1.5);wScene.add(l);W.pool.push(l)}
  // --- dens: daylight falls down a shaft from the burrow above
  const ceil=(n,x,z)=>n.h*Math.sqrt(Math.max(0,1-((x-n.x)**2+(z-n.z)**2)/(n.r*n.r)));
  const inHall=(n,a,b)=>{const ang=wr()*Math.PI*2,r=n.r*WR(a,b);return {x:n.x+Math.cos(ang)*r,z:n.z+Math.sin(ang)*r,ang}};
  for(const n of N.filter(n=>n.kind==='den')){
    const sky=new THREE.Mesh(new THREE.CircleGeometry(.45,20),new THREE.MeshBasicMaterial({color:0xffffff,fog:false}));sky.rotation.x=Math.PI/2;sky.position.set(n.x,W_TOP-.07,n.z);wScene.add(sky);
    const beam=new THREE.Mesh(new THREE.CylinderGeometry(.24,.42,W_TOP,18,1,true),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.12,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,fog:false}));
    beam.position.set(n.x,W_TOP/2,n.z);wScene.add(beam);
    const pool=new THREE.Mesh(new THREE.CircleGeometry(.6,24),new THREE.MeshBasicMaterial({map:glowTex,color:0xffffff,transparent:true,opacity:.5,blending:THREE.AdditiveBlending,depthWrite:false,fog:false}));pool.rotation.x=-Math.PI/2;pool.position.set(n.x,.004,n.z);wScene.add(pool);
    n.sky=sky;n.beam=beam;n.pool=pool;W.glows.push({x:n.x,y:1.1,z:n.z,col:new THREE.Color(),i:1,d:4.5,den:n})}
  // --- decor: glowworms, roots, pebbles, mushrooms, crystals
  const glowP=[],rootM=[],pebM=[],shroomM=[],redM=[],crysM=[],hayM=[];
  const tubeTop=lat=>W_CY+Math.sqrt(Math.max(0,W_RT*W_RT-lat*lat))-.03;
  for(const e of E){const nearDen=[e.a,e.b].some(n=>n.kind==='den');
    e.pts.forEach((p,k)=>{if(k===0||k===e.pts.length-1)return;const nx_=e.pts[k+1].x-e.pts[k-1].x,nz_=e.pts[k+1].z-e.pts[k-1].z,l=Math.hypot(nx_,nz_),px=-nz_/l,pz=nx_/l;
      if(wr()<.3){const c=3+Math.floor(wr()*6);for(let i=0;i<c;i++){const lat=WR(-.22,.22);glowP.push(p.x+px*lat+WR(-.2,.2)*nx_/l,tubeTop(lat),p.z+pz*lat+WR(-.2,.2)*nz_/l)}}
      const rootChance=nearDen&&(k<5||k>e.pts.length-6)?.8:.12;
      if(wr()<rootChance){const lat=WR(-.18,.18);rootM.push(mat4(p.x+px*lat,tubeTop(lat)+.02,p.z+pz*lat,wr()*6,1,WR(-.3,.3),WR(-.3,.3),WR(.12,.32)))}
      if(wr()<.35){const lat=(wr()<.5?-1:1)*WR(.18,.26);pebM.push(mat4(p.x+px*lat,-.01,p.z+pz*lat,wr()*6,WR(.025,.06)))}
      if(wr()<.05){const lat=(wr()<.5?-1:1)*WR(.17,.24);(wr()<.25?redM:shroomM).push(mat4(p.x+px*lat,0,p.z+pz*lat,wr()*6,WR(.4,.7)))}})}
  const food=(type,x,z,ry=0)=>{const o=itemModel(type);o.position.set(x,0,z);o.rotation.y=ry;wScene.add(o);W.foods.push({type,x,z,obj:o,alive:true,respawn:0})};
  for(const n of N.filter(n=>n.kind==='hall')){
    const g={x:n.x,y:n.h*.7,z:n.z,col:new THREE.Color(0xffc890),i:.9,d:4};
    if(n.theme==='glow'){for(let i=0;i<260;i++){const a=wr()*Math.PI*2,r=Math.sqrt(wr())*n.r*.92,x=n.x+Math.cos(a)*r,z=n.z+Math.sin(a)*r;glowP.push(x,ceil(n,x,z)-.03,z)}g.col.set(0x5affd0);g.i=1.4;
      for(let i=0;i<3;i++){const p=inHall(n,.4,.75);food(i?'clover':'dandelion',p.x,p.z,p.ang)}}
    if(n.theme==='roots'){for(let i=0;i<70;i++){const p=inHall(n,0,.8);rootM.push(mat4(p.x,ceil(n,p.x,p.z)+.02,p.z,wr()*6,1.3,WR(-.3,.3),WR(-.3,.3),WR(.2,.6)))}
      for(let i=0;i<4;i++){const p=inHall(n,.45,.75);food('carrot',p.x,p.z,p.ang)}}
    if(n.theme==='shrooms'){for(let i=0;i<34;i++){const p=inHall(n,.25,.85);(i%5?shroomM:redM).push(mat4(p.x,0,p.z,wr()*6,WR(.9,1.8)))}g.col.set(0x9affb0);g.i=1.2;
      for(let i=0;i<4;i++){const p=inHall(n,.3,.7);food('chanterelle',p.x,p.z,p.ang)}}
    if(n.theme==='larder'){for(let i=0;i<3;i++){const p=inHall(n,.5,.75);hayM.push(mat4(p.x,0,p.z,wr()*6,WR(1.4,2)))}
      ['berries','berries','strawberry','strawberry','hay','pepper'].forEach(t=>{const p=inHall(n,.25,.7);food(t,p.x,p.z,p.ang)})}
    if(n.theme==='crystal'){for(let i=0;i<40;i++){const p=inHall(n,.55,.92),x=p.x,z=p.z;crysM.push(mat4(x,WR(0,ceil(n,x,z)*.6),z,wr()*6,WR(.6,1.6),WR(-.6,.6),WR(-.6,.6)))}g.col.set(0x8ad8ff);g.i=1.5}
    W.glows.push(g)}
  const pts_=new THREE.BufferGeometry();pts_.setAttribute('position',new THREE.Float32BufferAttribute(glowP,3));
  wScene.add(new THREE.Points(pts_,new THREE.PointsMaterial({map:glowTex,color:0x6affd4,size:.045,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending})));
  {const cone=new THREE.ConeGeometry(.014,1,5);cone.rotateX(Math.PI);cone.translate(0,-.5,0);const im=new THREE.InstancedMesh(cone,new THREE.MeshStandardMaterial({color:0x6a4a2c,roughness:1}),rootM.length);rootM.forEach((m,i)=>im.setMatrixAt(i,m));wScene.add(im)}
  {const im=new THREE.InstancedMesh(new THREE.OctahedronGeometry(.06),new THREE.MeshStandardMaterial({color:0x9ae8ff,emissive:0x2a7090,emissiveIntensity:1.3,roughness:.2,transparent:true,opacity:.9}),crysM.length);crysM.forEach((m,i)=>{m.multiply(new THREE.Matrix4().makeScale(1,2.2,1));im.setMatrixAt(i,m)});wScene.add(im)}
  wSet('Rock',pebM);if(hayM.length)wSet('Hay',hayM);
  const glowShroom=m=>{m.emissive=new THREE.Color(0x2a5a38);m.emissiveIntensity=.8;return m};
  if(shroomM.length)wSet('MushroomBrown',shroomM,glowShroom);if(redM.length)wSet('MushroomRed',redM);
  // --- curios: one in each hall and nook; the golden acorn waits in the farthest one from the meadow
  const dist=new Map([[N[0],0]]);{const todo=[N[0]];while(todo.length){const a=todo.shift();for(const e of a.edges){const b=e.a===a?e.b:e.a,d=dist.get(a)+e.len;if(!dist.has(b)||d<dist.get(b)){dist.set(b,d);todo.push(b)}}}}
  const slots=N.filter(n=>n.kind!=='den');const keys_=Object.keys(CURIOS).filter(k=>k!=='goldAcorn'&&k!=='crystal');
  const far=slots.slice().sort((a,b)=>dist.get(b)-dist.get(a))[0];
  for(const n of slots){const k=n===far?'goldAcorn':n.theme==='crystal'?'crystal':keys_.splice(Math.floor(wr()*keys_.length),1)[0]||'crystal';
    const p=n.kind==='nook'?{x:n.x,z:n.z}:inHall(n,.15,.4);const g=new THREE.Group();const mesh=curioModel(k);g.add(mesh);
    const glow=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex,color:RARITY[CURIOS[k].rarity][0],transparent:true,opacity:.55,depthWrite:false,blending:THREE.AdditiveBlending}));glow.scale.setScalar(.22);g.add(glow);
    g.position.set(p.x,.07,p.z);wScene.add(g);n.curio=k;W.curios.push({k,x:p.x,z:p.z,y:.07,obj:g,mesh,got:false,node:n})}
}

// ---- enter / leave
function snapCamera(){camTgt.set(pig.pos.x,pig.pos.y+.09,pig.pos.z);camPos.set(camTgt.x+Math.sin(G.camYaw)*.5,camTgt.y+.15,camTgt.z+Math.cos(G.camYaw)*.5)}
function swapScene(o,to){o.removeFromParent();to.add(o)}
function enterWarren(t,quiet){G.acts=null;const n=t.node;G.under=true;G.hidden=true;W.from=t;
  if(!quiet){SFX.whoosh();flash('rgba(0,0,0,1)',1)}
  swapScene(pig.obj,wScene);swapScene(pts,wScene);pig.blob.visible=false;pig.light.intensity=0;pig.air=false;pig.vy=0;
  const e=n.edges[0],nx=e.a===n?e.pts[2]:e.pts[e.pts.length-3],h=Math.atan2(nx.x-n.x,nx.z-n.z);
  pig.pos.set(n.x+Math.sin(h)*.62,0,n.z+Math.cos(h)*.62);pig.vel.set(0,0,0);pig.heading=h;G.camYaw=h+Math.PI;
  W.trail.length=0;W.trail.push({x:pig.pos.x,z:pig.pos.z});
  herd.forEach(f=>{swapScene(f.obj,wScene);f.blob.visible=false;f.tag.style.display='none';f.pos.set(n.x,0,n.z);f.vel.set(0,0,0);f.air=false;f.vy=0});
  snapCamera();W.revealT=0;W.lightT=0;
  if(quiet)return;
  if(!G.warrenTip){G.warrenTip=true;toast(`🕳 <b>The Warren.</b> Explore to fill in your map (${kb('M','🗺')}). Walk a passage end to end and it becomes a quick route between burrows.`,'gold',9)}
  else toast(`🕳 Down into the warren under <b>${t.name}</b>`)}
function exitWarren(n){G.acts=null;const t=n.den;G.under=false;G.hidden=false;SFX.whoosh();flash('rgba(0,0,0,1)',1);
  swapScene(pig.obj,scene);swapScene(pts,scene);pig.blob.visible=true;
  herd.forEach(f=>{swapScene(f.obj,scene);f.blob.visible=true});
  pig.pos.set(t.ex,heightAt(t.ex,t.ez),t.ez);pig.vel.set(0,0,0);pig.heading=t.rot;G.camYaw=t.rot+Math.PI;regroupHerd();snapCamera();
  if(t!==W.from){toast(`🕳 Popped out at <b>${t.name}</b>`);addScore(15)}}

// ---- exploring
function chamberFound(n){n.seen=true;
  if(n.kind==='den'){if(!n.den.found)findTunnel(n.den,true)}
  else if(n.kind==='hall'){SFX.find('epic');callout('epic','🕳 '+n.name,150);toast(`🕳 <b>You found the ${n.name}!</b> ${HALL_BLURB[n.theme]}`,'gold',5);addScore(150,'','#c98bff');
    const halls=W.nodes.filter(x=>x.kind==='hall');if(halls.every(x=>x.seen)){toast('🏆 <b>Every hidden chamber found!</b> +800','gold',6);addScore(800,'chambers!','#ffd23f')}}
  else if(W.curios.some(c=>c.node===n&&!c.got))toast('🕳 A snug little nook. Something glints in here…')}
function revealWarren(){const px=pig.pos.x,pz=pig.pos.z;
  for(const e of W.edges){if(e.done||Math.min(Math.hypot(e.a.x-px,e.a.z-pz),Math.hypot(e.b.x-px,e.b.z-pz))>e.len+3)continue;
    let n=0;for(const p of e.pts){if(!p.seen&&Math.hypot(p.x-px,p.z-pz)<2.2){p.seen=true;W.seenPts++}if(p.seen)n++}
    if(n>=e.pts.length*.9){e.done=true;toastRoute()}}
  for(const n of W.nodes)if(!n.seen&&Math.hypot(n.x-px,n.z-pz)<n.r+1)chamberFound(n);
  if(!W.allSeen&&W.edges.every(e=>e.done)){W.allSeen=true;toast('🗺 <b>You mapped the whole warren!</b> +1500','gold',6);addScore(1500,'mapped!','#ffd23f');flash('rgba(255,215,80,.4)',.6)}}
// burrows joined by passages you have walked
function linkedTo(t){const start=t.node,seen=new Set([start]),todo=[start];while(todo.length){const a=todo.pop();for(const e of a.edges){if(!e.done)continue;const b=e.a===a?e.b:e.a;if(!seen.has(b)){seen.add(b);todo.push(b)}}}
  return PARK.tunnels.filter(x=>x!==t&&x.found&&seen.has(x.node))}
function routeCount(){let n=0;for(const t of PARK.tunnels)if(t.found)n+=linkedTo(t).length;return n/2}
function toastRoute(){const n=routeCount();if(n>(W.routes||0)){W.routes=n;toast(`🗺 <b>New quick route!</b> ${n} burrow-to-burrow route${n>1?'s':''} open.`,'good',4);addScore(40,'route!','#7fd0ff')}}
function warrenActions(){const acts=[];if(pig.air)return acts;const m=mouthPos();
  const c=W.curios.find(c=>!c.got&&Math.hypot(c.x-m.x,c.z-m.z)<.3);if(c)acts.push({k:'E',label:`Pick up ${CURIOS[c.k].icon} ${CURIOS[c.k].name}`,do:()=>takeCurio(c)});
  const f=W.foods.find(f=>f.alive&&Math.hypot(f.x-m.x,f.z-m.z)<.26);if(f)acts.push({k:'E',label:`Eat ${ITEMS[f.type].name}`,do:()=>{f.alive=false;f.obj.visible=false;f.respawn=R(150,240);discover(f.type);applyFood(f.type)}});
  const d=W.nodes.find(n=>n.kind==='den'&&Math.hypot(n.x-pig.pos.x,n.z-pig.pos.z)<.5);if(d)acts.push({k:'E',label:`Climb out · ${d.name}`,do:()=>exitWarren(d)});
  return acts}
function takeCurio(c){c.got=true;c.obj.removeFromParent();const it=CURIOS[c.k];G.curios[c.k]=true;SFX.pop();SFX.find(it.rarity);callout(it.rarity,`${it.icon} ${it.name}`,Math.round(it.pts*mult()));
  toast(`${it.icon} <b style="color:${RARITY[it.rarity][0]}">${it.name}</b> added to your curio stash (J)`,it.rarity==='legendary'||it.rarity==='epic'?'gold':'good',4);addScore(it.pts);emit(c.x,.1,c.z,24,{col:[1,.85,.5],spread:.7,up:1.2,size:.02,life:1,grav:1.5});
  if(it.rarity==='legendary')flash('rgba(255,215,80,.55)',.8);
  if(W.curios.every(x=>x.got)){toast('🏆 <b>Curio stash complete!</b> +1000','gold',6);addScore(1000,'stash!','#ffd23f')}}
function sniffWarren(){let c=0,h=0;
  for(const x of W.curios)if(!x.got&&Math.hypot(x.x-pig.pos.x,x.z-pig.pos.z)<12){marker(x.x,.25,x.z,0xffd060,wScene);c++}
  for(const f of W.foods)if(f.alive&&Math.hypot(f.x-pig.pos.x,f.z-pig.pos.z)<8)marker(f.x,.2,f.z,0x9fe88a,wScene);
  for(const n of W.nodes)if(!n.seen&&!n.heard&&Math.hypot(n.x-pig.pos.x,n.z-pig.pos.z)<14){n.heard=true;h++}
  toast(`👃 Sniff sniff… ${c?`<b>${c} curio${c>1?'s':''}</b> nearby`:'earthy smells'}${h?`, and fresh air from <b>${h} unexplored chamber${h>1?'s':''}</b> (marked ? on your map)`:''}.`)}
function updateWarren(dt,t){
  updatePig(dt,t);
  W.revealT-=dt;if(W.revealT<=0){W.revealT=.2;revealWarren()}
  // the herd follows along the trail
  const last=W.trail[0];if(Math.hypot(pig.pos.x-last.x,pig.pos.z-last.z)>.06){W.trail.unshift({x:pig.pos.x,z:pig.pos.z});if(W.trail.length>(HERD_MAX+1)*6+4)W.trail.pop()}
  herd.forEach((f,i)=>{const tp=W.trail[Math.min(W.trail.length-1,(i+1)*6)],hx=tp.x-f.pos.x,hz=tp.z-f.pos.z,hl=Math.hypot(hx,hz);
    if(hl>.07){f.heading+=angDiff(f.heading,Math.atan2(hx,hz))*Math.min(1,dt*8);const s=Math.min(Math.min(3.8,hl*4+.4),hl/Math.max(dt,1e-3));f.vel.set(Math.sin(f.heading)*s,0,Math.cos(f.heading)*s)}else f.vel.multiplyScalar(Math.max(0,1-dt*10));
    f.pos.x+=f.vel.x*dt;f.pos.z+=f.vel.z*dt;const dx=f.pos.x-pig.pos.x,dz=f.pos.z-pig.pos.z,d=Math.hypot(dx,dz);if(d<.2&&d>1e-4){f.pos.x+=dx/d*(.2-d);f.pos.z+=dz/d*(.2-d)}
    for(const o of herd){if(o===f)continue;const ox=f.pos.x-o.pos.x,oz=f.pos.z-o.pos.z,od=Math.hypot(ox,oz);if(od<.18&&od>1e-4){f.pos.x+=ox/od*(.18-od)*.5;f.pos.z+=oz/od*(.18-od)*.5}}
    warrenCollide(f.pos,.09);f.pos.y=0;const moving=Math.hypot(f.vel.x,f.vel.z)>.1;
    f.obj.position.set(f.pos.x,moving?Math.abs(Math.sin(f.phase))*.008:0,f.pos.z);f.obj.rotation.set(0,f.heading,0,'YXZ');f.fur.forEach((s,i)=>s.visible=i%FUR_STEP()===0);animatePigLegs(dt,Math.hypot(f.vel.x,f.vel.z),moving,f)});
  for(const f of W.foods)if(!f.alive){f.respawn-=dt;if(f.respawn<=0&&Math.hypot(f.x-pig.pos.x,f.z-pig.pos.z)>3){f.alive=true;f.obj.visible=true}}
  for(const c of W.curios)if(!c.got){c.obj.position.y=c.y+Math.sin(t*2+c.x)*.012;c.mesh.rotation.y+=dt*1.2}
  // daylight (or moonlight) down the shafts follows the sky above
  const day=clamp(sun.intensity/2.9,0,1);
  for(const n of W.nodes)if(n.sky){n.sky.material.color.copy(skyMat.uniforms.hor.value).multiplyScalar(.5+day*.9);n.beam.material.color.copy(sun.color).multiplyScalar(.25+day*.9);n.pool.material.color.copy(n.beam.material.color)}
  for(const g of W.glows)if(g.den){g.col.copy(sun.color);g.i=.35+day*1.6}
  W.lightT-=dt;if(W.lightT<=0){W.lightT=.25;const near=W.glows.map(g=>[g,Math.hypot(g.x-pig.pos.x,g.z-pig.pos.z)]).sort((a,b)=>a[1]-b[1]);
    W.pool.forEach((l,i)=>{const n=near[i];if(!n||n[1]>9){l.intensity=0;return}l.position.set(n[0].x,n[0].y,n[0].z);l.color.copy(n[0].col);l.intensity=n[0].i;l.distance=n[0].d})}
  W.lantern.position.set(pig.pos.x-Math.sin(pig.heading)*.15,pig.pos.y+.4,pig.pos.z-Math.cos(pig.heading)*.15);
}
function drawWarrenMap(g,s){const w=v=>s(v/WS),big=$('mapwrap').classList.contains('big');
  g.fillStyle='#120b06';g.fillRect(0,0,340,340);g.globalAlpha=.16;g.drawImage(mapBg,0,0,340,340);g.globalAlpha=1;
  g.lineCap=g.lineJoin='round';
  for(const [lw,c] of [[10,'#5a3e22'],[5,'#d2a86e']]){g.strokeStyle=c;g.lineWidth=lw;g.beginPath();
    for(const e of W.edges)for(let k=0;k<e.pts.length-1;k++){const a=e.pts[k],b=e.pts[k+1];if(a.seen&&b.seen){g.moveTo(w(a.x),w(a.z));g.lineTo(w(b.x),w(b.z))}}g.stroke()}
  g.textAlign='center';g.textBaseline='middle';g.font='600 13px Fredoka, sans-serif';const labels=[];
  for(const n of W.nodes){const x=w(n.x),z=w(n.z),r=n.r/WS/144*340;
    if(!n.seen){if(n.heard){g.fillStyle='rgba(255,220,160,.55)';g.fillText('?',x,z)}continue}
    g.fillStyle=n.kind==='hall'?'#e0b880':'#d2a86e';g.beginPath();g.arc(x,z,r,0,7);g.fill();
    if(n.kind==='den'){g.strokeStyle='#ffe08a';g.lineWidth=2.5;g.beginPath();g.arc(x,z,r*.55,0,7);g.stroke()}
    if(big&&n.kind!=='nook')labels.push({n,x,z,r})}
  // names on the big map: chambers first, each tries above, below, then beside its spot until it fits
  const placed=[],hit=(a,b)=>a.x0<b.x1&&a.x1>b.x0&&a.y0<b.y1&&a.y1>b.y0;
  labels.sort((a,b)=>(a.n.kind==='hall'?0:1)-(b.n.kind==='hall'?0:1));
  for(const L of labels){const hall=L.n.kind==='hall';g.font=hall?'600 10.5px Fredoka, sans-serif':'500 9px Fredoka, sans-serif';const tw=g.measureText(L.n.name).width,th=hall?11:9.5,gap=L.r+3;
    let best=null;for(const [dx,dy] of [[0,-gap-th/2],[0,gap+th/2],[gap+tw/2,0],[-gap-tw/2,0],[gap*.7+tw/2,-gap*.7-th/2],[-gap*.7-tw/2,-gap*.7-th/2],[gap*.7+tw/2,gap*.7+th/2],[-gap*.7-tw/2,gap*.7+th/2],[0,-gap-th*1.6],[0,gap+th*1.6]]){
      const cx=clamp(L.x+dx,tw/2+2,338-tw/2),cy=clamp(L.z+dy,th/2+2,338-th/2),box={x0:cx-tw/2-1,x1:cx+tw/2+1,y0:cy-th/2,y1:cy+th/2};
      if(!placed.some(b=>hit(b,box))&&!labels.some(o=>o!==L&&Math.hypot(o.x-cx,o.z-cy)<o.r+1)){best={cx,cy,box};break}if(!best)best={cx,cy,box,over:true}}
    if(best.over){const b=best;best={cx:clamp(L.x,tw/2+2,338-tw/2),cy:clamp(L.z-gap-th/2,th/2+2,338),box:b.box}}
    placed.push(best.box);g.lineWidth=2.6;g.strokeStyle='rgba(0,0,0,.7)';g.fillStyle=hall?'#ffd88a':'#fff3d8';g.strokeText(L.n.name,best.cx,best.cy);g.fillText(L.n.name,best.cx,best.cy)}
  g.textBaseline='alphabetic';
  for(const c of W.curios)if(!c.got&&c.node.seen){g.fillStyle=RARITY[CURIOS[c.k].rarity][0];g.beginPath();g.arc(w(c.x),w(c.z),3.5,0,7);g.fill()}
  herd.forEach(f=>{g.fillStyle='#ff9fd0';g.beginPath();g.arc(w(f.pos.x),w(f.pos.z),3,0,7);g.fill()});
  return w}

// ============================================================ humans / petting
function updateHumans(dt){
  const night=isNight();
  for(const h of humans){
    const target=night?0:1;h.fade=lerp(h.fade,target,dt*1.5);
    const vis=h.fade>.05;if(vis!==h.visible){h.visible=vis;h.obj.visible=vis;if(!vis)toast(`🏡 ${h.name} went inside for the night.`);else toast(`🌅 ${h.name} is back outside!`)}
    if(!h.visible)continue;
    h.cd=Math.max(0,h.cd-dt);h.tossCD=Math.max(0,h.tossCD-dt);if(h.cd<=0&&h.petBudget<=0)h.petBudget=6;
    const dx=pig.pos.x-h.obj.position.x,dz=pig.pos.z-h.obj.position.z,d=Math.hypot(dx,dz);
    const want=d<7?Math.atan2(dx,dz):h.face;h.obj.rotation.y+=angDiff(h.obj.rotation.y,want)*Math.min(1,dt*2);
    const fwd=h.obj.rotation.y;const px=h.obj.position.x+Math.sin(fwd)*.46,pz=h.obj.position.z+Math.cos(fwd)*.46;
    const close=Math.hypot(pig.pos.x-px,pig.pos.z-pz)<.3&&!pig.air;const still=pig.vel.length()<.35;
    h.petting=close&&still&&h.petBudget>0;
    h.t+=dt;
    if(h.petting){
      h.arm.rotation.x=lerp(h.arm.rotation.x,-.12+Math.sin(h.t*5)*.14,dt*8);h.arm.rotation.z=lerp(h.arm.rotation.z,Math.sin(h.t*2.5)*.05,dt*5);
      h.petBudget-=dt;h.petTick=(h.petTick||0)-dt;G.happy=Math.min(100,G.happy+dt*14*G.perk.petJoy);
      if(h.petTick<=0){h.petTick=.5;SFX.purr();const hp=pig.pos;heart(hp.x,hp.y+.18,hp.z);G.pets++;
        if(G.lastPetHuman!==h){if(G.lastPetHuman&&G.petStreakT>0){G.petStreak++;G.bestStreak=Math.max(G.bestStreak,G.petStreak);toast(`💞 Pet streak ×${G.petStreak}! Everyone loves you.`,'good')}else G.petStreak=1;G.lastPetHuman=h}
        G.petStreakT=90;addScore(10*G.petStreak,'',"#ff9fd0")}
      if(h.petBudget<=0){h.cd=40;toast(`${h.name}: “Okay, that's enough cuddles for now!” (back in 40s)`);addScore(40,'pet bonus','#ff9fd0')}
    }else{h.arm.rotation.x=lerp(h.arm.rotation.x,.35+Math.sin(h.t*.8)*.03,dt*3);h.arm.rotation.z=lerp(h.arm.rotation.z,0,dt*3)}
    if(d<2.2&&!h.greeted){h.greeted=true;toast(`🙂 ${h.name} kneels down: “Hello little one! Come here!”`);setTimeout(()=>hearRequest(h),1200)}
    if(d>9)h.greeted=false;
  }
}

// ============================================================ barns: squeeze in through a hole, munch the hay, burrow about in it
// The holes, in the Barn model's own frame (its big doors face +z): one in the back wall, one in the east wall.
// 'in' is where you stand inside, 'face' the way the hole looks out. The inside is its own little scene, built the first time.
const BARN_HOLES=[{x:-2.2,z:-3,face:Math.PI},{x:4,z:1,face:Math.PI/2}];
const BARN={W:8,D:6,HW:3.2,PILE:{x:-1.5,z:.4,R:1.5,H:.9}};
const HAYLOOT={clover:22,dandelion:18,carrot:16,strawberry:12,pepper:8,goldCarrot:3,clover4:2};
const iScene=new THREE.Scene();iScene.background=new THREE.Color(0x140c06);
function setupBarn(b){const o=b.obj;o.updateMatrixWorld(true);
  b.holes=BARN_HOLES.map(h=>{const p=o.localToWorld(new THREE.Vector3(h.x*1.003,0,h.z*1.003)),a=o.rotation.y+h.face,nx=Math.sin(a),nz=Math.cos(a);
    const m=M.BarnHole.clone(true);m.position.set(p.x,heightAt(p.x,p.z)-.02,p.z);m.rotation.y=a;m.scale.setScalar(b.scale);ZG.add(m);
    return {ex:p.x+nx*.5,ez:p.z+nz*.5,out:a,h}})}
function buildBarnInside(b){const s=b.scale,g=new THREE.Group(),B={kind:'barn',title:'🛖 The Barn',onEnter:barnEnter,onExit:B=>{if(B.burrow)popOut(true)},actions:barnActions,update:barnUpdate,sniff:sniffBarn,group:g,s,hx:BARN.W/2*s-.13,hz:BARN.D/2*s-.13,ceil:BARN.HW*s,loftX:1.4*s,loftY:2.05*s,cols:[],boxes:[],treats:[],found:0,burrow:null,day:-1};
  const room=M.BarnInside.clone(true);room.scale.setScalar(s);g.add(room);
  room.traverse(m=>{if(m.isMesh&&m.material.name==='Lamp'){m.material=m.material.clone();m.material.emissive=new THREE.Color(0xffb35c);B.lampMat=m.material}});
  const P=BARN.PILE;B.pile={x:P.x*s,z:P.z*s,R:P.R*s,H:P.H*s};const pile=M.HayPile.clone(true);pile.position.set(B.pile.x,0,B.pile.z);pile.scale.setScalar(s);g.add(pile);
  const prop=(model,x,z,{rot=0,sc=1,box=null,r=0}={})=>{const o=M[model].clone(true);o.position.set(x*s,0,z*s);o.rotation.y=rot;o.scale.setScalar(sc*s);g.add(o);
    if(box){const sw=Math.abs(Math.sin(rot))>.5;B.boxes.push({cx:x*s,cz:z*s,hx:(sw?box[1]:box[0])*s,hz:(sw?box[0]:box[1])*s})}if(r)B.cols.push({x:x*s,z:z*s,r:r*s});return o};
  prop('Hay',-3.3,-2.3,{rot:.2,sc:2.6,r:.32});prop('Hay',-3.35,-1.6,{rot:-.1,sc:2.6,r:.32});prop('Hay',3.2,2.3,{rot:1.4,sc:2.6,r:.32});prop('Trough',2.7,-2.4,{box:[.68,.24]});
  for(const z of [-1,1])B.cols.push({x:1.4*s,z:z*s,r:.13*s});B.cols.push({x:.72*s,z:-.3*s,r:.28*s});   // the middle posts, the foot of the loft ladder
  // the holes from inside: daylight through them, and a patch of light on the floor
  B.holes=BARN_HOLES.map((h,i)=>{const a=h.face+Math.PI,x=h.x*s,z=h.z*s,m=M.BarnHole.clone(true);m.position.set(x,0,z);m.rotation.y=a;m.scale.setScalar(s);g.add(m);
    m.traverse(o=>{if(o.isMesh&&o.material.name==='HoleDark'){o.material=new THREE.MeshBasicMaterial({color:0xfff0d0});B['holeMat'+i]=o.material}});
    const pool=new THREE.Mesh(new THREE.CircleGeometry(.45*s,24),new THREE.MeshBasicMaterial({map:glowTex,color:0xffe0a0,transparent:true,opacity:.35,blending:THREE.AdditiveBlending,depthWrite:false}));
    pool.rotation.x=-Math.PI/2;pool.position.set(x+Math.sin(a)*.35*s,.01,z+Math.cos(a)*.35*s);g.add(pool);(B.pools||(B.pools=[])).push(pool);
    return {x:x+Math.sin(a)*.45,z:z+Math.cos(a)*.45,heading:a,i}});
  // sunbeams through the gaps high up, and warm light
  B.beams=[];for(const [x,z,ry] of [[-2.6,-2.95,0],[.4,-2.95,0],[-3.95,.8,Math.PI/2]]){const bm=new THREE.Mesh(new THREE.PlaneGeometry(.35*s,4.2*s),new THREE.MeshBasicMaterial({map:glowTex,color:0xffe0a0,transparent:true,opacity:.18,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));
    bm.position.set(x*s,1.7*s,z*s);bm.rotation.set(.55,ry,0);g.add(bm);B.beams.push(bm)}
  B.hemi=new THREE.HemisphereLight(0xffe8c8,0x5a3a20,1.4);g.add(B.hemi);B.sun=new THREE.DirectionalLight(0xfff0d8,1.5);B.sun.position.set(-3,6,-2);g.add(B.sun);
  B.fill=new THREE.DirectionalLight(0xffd8b0,.5);B.fill.position.set(4,3,5);g.add(B.fill);
  B.lantern=new THREE.PointLight(0xffc888,1.5,8*s,1.2);B.lantern.position.set(-.6*s,(BARN.HW-.7)*s,1*s);g.add(B.lantern);
  B.bump=new THREE.Mesh(new THREE.SphereGeometry(.16,14,8,0,Math.PI*2,0,Math.PI/2),new THREE.MeshStandardMaterial({color:0xd9b860,roughness:1}));B.bump.visible=false;g.add(B.bump);
  b.inside=B}
function insideHeight(x,z){const B=G.inside;if(B.height)return B.height(x,z);const p=B.pile;if(!p)return 0;const d=Math.hypot(x-p.x,z-p.z);return d<p.R?p.H*Math.pow(1-(d/p.R)**2,.8):0}
// herd members (and the cat) aren't stopped by the shop's tubes: the herd follows you through them, the cat steps over
function insideCollide(P,pr,free){const B=G.inside;
  if(B.tubes&&!free)for(const t of B.tubes){const dx=t.bx-t.ax,dz=t.bz-t.az,k=clamp(((P.x-t.ax)*dx+(P.z-t.az)*dz)/(dx*dx+dz*dz),0,1),qx=t.ax+dx*k,qz=t.az+dz*k,ox=P.x-qx,oz=P.z-qz,d=Math.hypot(ox,oz),m=TUBE_R+pr;
    if(d<m&&d>1e-5){P.x=qx+ox/d*m;P.z=qz+oz/d*m}}
  for(const c of B.cols){const dx=P.x-c.x,dz=P.z-c.z,d=Math.hypot(dx,dz);if(d<c.r+pr&&d>1e-5){P.x=c.x+dx/d*(c.r+pr);P.z=c.z+dz/d*(c.r+pr)}}
  for(const b of B.boxes){const qx=clamp(P.x,b.cx-b.hx,b.cx+b.hx),qz=clamp(P.z,b.cz-b.hz,b.cz+b.hz),dx=P.x-qx,dz=P.z-qz,d=Math.hypot(dx,dz);if(d<pr&&d>1e-5){P.x=qx+dx/d*pr;P.z=qz+dz/d*pr}}
  P.x=clamp(P.x,-B.hx,B.hx);P.z=clamp(P.z,-B.hz,B.hz);if(B.radius){const r=Math.hypot(P.x,P.z);if(r>B.radius){P.x*=B.radius/r;P.z*=B.radius/r}}}
// hidden treats, fresh every day
function hideTreats(B){B.day=G.day;B.found=0;B.treats=[];for(let i=0;i<4;i++){const a=Math.random()*Math.PI*2,r=Math.sqrt(Math.random())*B.pile.R*.8;B.treats.push({x:B.pile.x+Math.cos(a)*r,z:B.pile.z+Math.sin(a)*r,type:pick(HAYLOOT),got:false})}}
// in through a hole (or a cat flap): the inside is its own scene; each kind (barn, shop) adds its own actions and update
function enterInside(b,hole){G.acts=null;iScene.background=new THREE.Color(0x140c06);iScene.fog=null;if(!b.inside)({shop:buildShopInside,island:buildIslandInside,agility:buildAgilityInside}[b.kind]||buildBarnInside)(b);const B=b.inside;iScene.clear();iScene.add(B.group);G.inside=B;G.insideHole=hole;B.from=b;G.hidden=true;forageState=null;$('forage').style.display='none';
  SFX.rustle();flash('rgba(0,0,0,1)',1);swapScene(pig.obj,iScene);swapScene(pts,iScene);pig.blob.visible=false;pig.light.intensity=0;pig.air=false;pig.vy=0;
  const h=B.holes[Math.max(0,b.holes.indexOf(hole))];pig.pos.set(h.x,0,h.z);pig.vel.set(0,0,0);pig.heading=h.heading;G.camYaw=h.heading+Math.PI;W.trail.length=0;W.trail.push({x:pig.pos.x,z:pig.pos.z});
  if(!B.noHerd)herd.forEach(f=>{swapScene(f.obj,iScene);f.blob.visible=false;f.pos.set(h.x,0,h.z);f.vel.set(0,0,0);f.air=false;f.vy=0});friends.forEach(f=>f.tag.style.display='none');snapCamera();
  B.onEnter(B)}
function barnEnter(B){if(B.day!==G.day)hideTreats(B);
  if(!G.barns[Z.id]){G.barns[Z.id]=1;SFX.find('rare');callout('rare','🛖 The Barn',80);addScore(80,'','#7fd0ff')}
  if(!G.barnTip){G.barnTip=true;toast(`🛖 <b>Inside the barn!</b> Hold ${kb('E','Munch')} to munch the hay, or ${G.input==='touch'?'tap Burrow':'press '+kb('F')} to burrow into it: treats are hidden in there. Sniff to find them.`,'gold',9)}
  else toast('🛖 Into the barn')}
function exitInside(){G.acts=null;const B=G.inside,hole=G.insideHole;forageState=null;$('forage').style.display='none';if(B.onExit)B.onExit(B);G.inside=null;G.hidden=false;SFX.rustle();flash('rgba(0,0,0,1)',1);
  swapScene(pig.obj,scene);swapScene(pts,scene);pig.blob.visible=true;herd.forEach(f=>{swapScene(f.obj,scene);f.blob.visible=true});
  pig.pos.set(hole.ex,heightAt(hole.ex,hole.ez),hole.ez);pig.vel.set(0,0,0);pig.heading=hole.out;G.camYaw=hole.out+Math.PI;regroupHerd();snapCamera()}
function insideActions(){const B=G.inside;if(pig.air)return [];return B.actions(B)}
function exitActs(B,label){const h=B.holes.find(h=>Math.hypot(h.x-pig.pos.x,h.z-pig.pos.z)<.45);if(!h)return [];const out=B.from.holes[h.i];return [{k:'E',label,do:()=>{G.insideHole=out;exitInside()}}]}
function barnActions(B){if(B.burrow)return [{k:'F',label:'Pop out of the hay!',do:()=>popOut()}];const acts=exitActs(B,'Squeeze back outside');
  const d=Math.hypot(pig.pos.x-B.pile.x,pig.pos.z-B.pile.z);
  if(d<B.pile.R+.35){acts.push({k:'E',hold:true,label:'Munch the hay',hay:true});acts.push({k:'F',label:'Burrow into the hay',do:startBurrow})}
  return acts}
function startBurrow(){const B=G.inside;B.burrow={x:pig.pos.x,z:pig.pos.z,edge:0,moveT:0};const p=B.pile,d=Math.hypot(pig.pos.x-p.x,pig.pos.z-p.z);
  if(d>p.R-.15){const k=(p.R-.15)/d;B.burrow.x=p.x+(pig.pos.x-p.x)*k;B.burrow.z=p.z+(pig.pos.z-p.z)*k}
  pig.obj.visible=false;B.bump.visible=true;SFX.rustle();setTimeout(()=>SFX.rustle(),120);emit(B.burrow.x,insideHeight(B.burrow.x,B.burrow.z)+.1,B.burrow.z,24,{col:[.9,.78,.4],spread:.7,up:1.4,size:.018,life:.9,grav:2.5});
  if(!G.burrowTip){G.burrowTip=true;toast(`🌾 Wheee! Scurry about under the hay. ${B.treats.filter(t=>!t.got).length} treats are hidden in it. ${G.input==='touch'?'Tap Pop out':'Press '+kb('F')+' or hop'} to pop out.`,'',7)}}
function popOut(quiet){const B=G.inside,u=B.burrow;if(!u)return;B.burrow=null;B.bump.visible=false;pig.obj.visible=true;pig.pos.set(u.x,insideHeight(u.x,u.z),u.z);
  if(quiet)return;pig.vy=2.1;pig.air=true;SFX.jump();setTimeout(()=>SFX.wheek(),150);emit(u.x,pig.pos.y+.1,u.z,40,{col:[.92,.8,.42],spread:1,up:1.8,size:.02,life:1.1,grav:2.5});
  G.happy=Math.min(100,G.happy+10);addScore(12,'popcorn!','#ffb0e0');herdPopcorn()}
function updateBurrow(dt,t){const B=G.inside,u=B.burrow,p=B.pile;
  let ix=0,iz=0;if(keys.KeyW||keys.ArrowUp)iz+=1;if(keys.KeyS||keys.ArrowDown)iz-=1;if(keys.KeyA||keys.ArrowLeft)ix-=1;if(keys.KeyD||keys.ArrowRight)ix+=1;
  if(joy.active){ix=joy.x;iz=-joy.y}else if(pad.on){ix=pad.x;iz=-pad.y}
  const len=Math.min(1,Math.hypot(ix,iz)),yaw=G.camYaw,mx=(-Math.sin(yaw)*iz+Math.cos(yaw)*ix),mz=(-Math.cos(yaw)*iz-Math.sin(yaw)*ix),ml=Math.hypot(mx,mz)||1;
  if(len>.1){u.x+=mx/ml*len*.95*dt;u.z+=mz/ml*len*.95*dt;pig.heading+=angDiff(pig.heading,Math.atan2(mx,mz))*Math.min(1,dt*10);u.moveT-=dt;
    if(u.moveT<=0){u.moveT=.12;SFX.rustle();emit(u.x,insideHeight(u.x,u.z)+.05,u.z,4,{col:[.9,.78,.4],spread:.5,up:1,size:.015,life:.6,grav:3})}G.happy=Math.min(100,G.happy+dt*2)}
  const d=Math.hypot(u.x-p.x,u.z-p.z),lim=p.R-.12;if(d>lim){u.x=p.x+(u.x-p.x)/d*lim;u.z=p.z+(u.z-p.z)/d*lim;if(len>.1){u.edge+=dt;if(u.edge>.35){popOut();return}}}else u.edge=0;
  const y=insideHeight(u.x,u.z);B.bump.position.set(u.x,y-.07,u.z);const w=1+Math.sin(t*14)*.08*(len>.1?1:.3);B.bump.scale.set(w,1/w,w);
  pig.pos.set(u.x,y-.05,u.z);pig.vel.set(0,0,0);
  for(const tr of B.treats)if(!tr.got&&Math.hypot(tr.x-u.x,tr.z-u.z)<.3)foundInHay(tr)}
function foundInHay(tr){const B=G.inside;tr.got=true;B.found++;G.hayFinds=(G.hayFinds||0)+1;const it=ITEMS[tr.type],y=insideHeight(tr.x,tr.z);
  emit(tr.x,y+.1,tr.z,30,{col:[1,.85,.4],spread:.8,up:1.6,size:.022,life:1,grav:2});SFX.pop();SFX.find(it.rarity);callout(it.rarity,`${it.icon} ${it.name}`,Math.round(it.pts*mult()));
  toast(`🌾 Found ${it.icon} <b style="color:${RARITY[it.rarity][0]}">${it.name}</b> in the hay! ${B.treats.filter(t=>!t.got).length||'No more'} left`,'good');discover(tr.type);applyFood(tr.type);
  if(B.treats.every(t=>t.got)){toast('🏆 <b>Every treat in the hay found!</b> More tomorrow. +150','gold',5);addScore(150,'hay!','#ffd23f')}}
function sniffBarn(){const B=G.inside,left=B.treats.filter(t=>!t.got);for(const t of left)marker(t.x,insideHeight(t.x,t.z)+.15,t.z,0xffd060,B.group);
  toast(left.length?`👃 Sniff sniff… <b>${left.length} treat${left.length>1?'s':''}</b> hidden in the hay!`:'👃 Just hay. Lovely, sweet hay. (More treats tomorrow.)')}
function updateInside(dt,t){const B=G.inside;
  if(B.burrow)updateBurrow(dt,t);else if(B.tube)updateTube(dt,t);else updatePig(dt,t);
  const last=W.trail[0];if(!B.burrow&&Math.hypot(pig.pos.x-last.x,pig.pos.z-last.z)>.06){W.trail.unshift({x:pig.pos.x,z:pig.pos.z});if(W.trail.length>(HERD_MAX+1)*6+4)W.trail.pop()}
  if(!B.noHerd)herd.forEach((f,i)=>{const tp=W.trail[Math.min(W.trail.length-1,(i+1)*6)],hx=tp.x-f.pos.x,hz=tp.z-f.pos.z,hl=Math.hypot(hx,hz);
    if(hl>.07){f.heading+=angDiff(f.heading,Math.atan2(hx,hz))*Math.min(1,dt*8);const sp=Math.min(Math.min(3.8,hl*4+.4),hl/Math.max(dt,1e-3));f.vel.set(Math.sin(f.heading)*sp,0,Math.cos(f.heading)*sp)}else f.vel.multiplyScalar(Math.max(0,1-dt*10));
    f.pos.x+=f.vel.x*dt;f.pos.z+=f.vel.z*dt;for(const o of herd){if(o===f)continue;const ox=f.pos.x-o.pos.x,oz=f.pos.z-o.pos.z,od=Math.hypot(ox,oz);if(od<.18&&od>1e-4){f.pos.x+=ox/od*(.18-od)*.5;f.pos.z+=oz/od*(.18-od)*.5}}
    insideCollide(f.pos,.09,true);if(f.air||f.vy>0){f.vy-=9.8*dt;f.pos.y+=f.vy*dt;const gy=insideHeight(f.pos.x,f.pos.z);if(f.pos.y<=gy){f.pos.y=gy;f.vy=0;f.air=false}}else f.pos.y=insideHeight(f.pos.x,f.pos.z);
    const moving=Math.hypot(f.vel.x,f.vel.z)>.1;f.obj.position.set(f.pos.x,f.pos.y+(moving?Math.abs(Math.sin(f.phase))*.008:0),f.pos.z);f.obj.rotation.set(0,f.heading+(f.air?Math.sin(t*14)*.6:0),0,'YXZ');
    f.fur.forEach((s,k)=>s.visible=k%FUR_STEP()===0);animatePigLegs(dt,Math.hypot(f.vel.x,f.vel.z),moving,f)});
  B.update(B,dt,t)}
// the barn's daylight through the holes and gaps follows the sky; the lantern glows more at night
function barnUpdate(B,dt,t){const day=clamp(sun.intensity/2.9,0,1);for(const m of [B.holeMat0,B.holeMat1])if(m)m.color.copy(skyMat.uniforms.hor.value).multiplyScalar(.6+day*.8);
  for(const bm of B.beams)bm.material.opacity=.05+day*.2;for(const pl of B.pools)pl.material.opacity=.1+day*.35;B.sun.intensity=.2+day*1.6;B.sun.color.copy(sun.color);B.hemi.intensity=.55+day*1.05;B.fill.intensity=.15+day*.45;
  const nk=isNight()?1:0;B.lantern.intensity=.8+nk*2;if(B.lampMat)B.lampMat.emissiveIntensity=.8+nk*1.6}

// ============================================================ gnawing: guinea pig teeth never stop growing, so they chew
// Fallen twigs lie at the foot of trees (apple twigs under the apple trees). Gnaw one down in a little timing game:
// press when the marker is in the green. Five good chomps trims your teeth: munching and foraging go faster for a while.
const GNAW={need:5,misses:3,buff:180};
function placeTwigs(z){const zr=mulberry32((z.seed||0)+404),cands=z.trees.filter(t=>t.r>.15),n=Math.min(z===PARK?12:10,Math.floor(cands.length/6));
  for(let k=0,tries=0;k<n&&tries<n*30;tries++){const t=cands[Math.floor(zr()*cands.length)],a=zr()*Math.PI*2,d=t.r+.35+zr()*.3,x=t.x+Math.cos(a)*d,zz=t.z+Math.sin(a)*d;
    if(Math.hypot(x,zz)>EDGE-3||!freeAt(x,zz,.2)||wet(x,zz,.1)||insideBox(x,zz,.4)||z.twigs.some(o=>Math.hypot(o.x-x,o.z-zz)<6)||z.spots.some(s=>Math.hypot(s.x-x,s.z-zz)<.8))continue;
    const rot=zr()*Math.PI*2,o=M.Twig.clone(true),apple=t.kind==='Apple';if(apple)o.traverse(m=>{if(m.isMesh&&m.material.name==='Bark'){m.material=m.material.clone();m.material.color.multiply(new THREE.Color(1.15,.85,.75))}});
    o.position.set(x,heightAt(x,zz)-.005,zz);o.rotation.y=rot;z.group.add(o);z.twigs.push({x,z:zz,rot,obj:o,ready:true,cd:0,apple});k++}}
function nearTwig(){const m=mouthPos();return Z.twigs.find(t=>Math.hypot(t.x-m.x,t.z-m.z)<.32)}
function startGnaw(tw){if(!tw.ready||G.gnaw)return;G.acts=null;forageState=null;$('forage').style.display='none';
  G.gnaw={tw,pos:0,dir:1,speed:.8,c:.5,w:.26,hits:0,miss:0,perfect:0,lock:0};gnawZone();
  const o=tw.obj,m=mouthPos();o.position.set(m.x+Math.sin(pig.heading)*.06,heightAt(m.x,m.z)+.035,m.z+Math.cos(pig.heading)*.06);o.rotation.set(0,pig.heading+Math.PI/2,.12);
  $('gnaw').style.display='block';renderGnaw();SFX.sniff();
  if(!G.gnawTip){G.gnawTip=true;toast(`🦷 Guinea pig teeth never stop growing, so a good gnaw keeps them tidy. ${G.input==='touch'?'Tap Chomp!':'Press '+kb('E')} when the marker is in the green!`,'',7)}}
function gnawZone(){const g=G.gnaw;g.w=Math.max(.11,.26-.03*g.hits);g.c=g.w/2+.04+Math.random()*(1-g.w-.08)}
function renderGnaw(){const g=G.gnaw,el=$('gnaw');el.querySelector('.z').style.left=((g.c-g.w/2)*100)+'%';el.querySelector('.z').style.width=(g.w*100)+'%';
  el.querySelector('.k').innerHTML='🦷'.repeat(g.hits)+'<span style="opacity:.3">'+'🦷'.repeat(GNAW.need-g.hits)+'</span> '+(g.miss?'<span style="color:#ff8a7a">'+'✖'.repeat(g.miss)+'</span>':'')}
function gnawHit(){const g=G.gnaw;if(!g||g.lock>0)return;g.lock=.18;const off=Math.abs(g.pos-g.c),m=mouthPos();
  if(off<=g.w/2){g.hits++;const perfect=off<=g.w/6;if(perfect)g.perfect++;SFX.chomp();setTimeout(()=>SFX.chomp(),90);pig.eating=.45;
    emit(m.x,m.y+.05,m.z,12,{col:g.tw.apple?[.82,.62,.5]:[.75,.6,.4],spread:.5,up:1.1,size:.012,life:.6,grav:3});floaty(perfect?'Perfect!':'Crunch!',perfect?'#ffd23f':'#fff');
    g.tw.obj.scale.set(1-.15*g.hits,1,1);g.speed+=.18;if(g.hits>=GNAW.need)return endGnaw(true)}
  else{g.miss++;tone('sine',180,120,.12,.2);floaty('miss','#ff8a7a');if(g.miss>=GNAW.misses)return endGnaw(false)}
  gnawZone();renderGnaw()}
function endGnaw(ok,quiet){const g=G.gnaw;G.gnaw=null;G.acts=null;$('gnaw').style.display='none';const tw=g.tw;tw.ready=false;tw.cd=R(150,240);tw.obj.visible=false;tw.obj.scale.set(1,1,1);
  tw.obj.position.set(tw.x,heightAt(tw.x,tw.z)-.005,tw.z);tw.obj.rotation.set(0,tw.rot,0);if(quiet)return;
  if(!ok){toast('💥 Snap! The twig broke. Your teeth are a little tidier anyway.','',4);addScore(15);return}
  const clean=g.miss===0;G.teethT=GNAW.buff;G.gnaws=(G.gnaws||0)+1;G.happy=Math.min(100,G.happy+12);SFX.find(clean?'rare':'uncommon');
  callout(clean?'rare':'uncommon','🦷 Teeth trimmed!',0);toast(`🦷 <b>Teeth trimmed!</b> Munching and foraging are faster for 3 minutes.${clean?' <b style="color:#ffd23f">Clean gnaw!</b> +100':''}`,'gold',5);
  addScore(60+g.perfect*15,'gnawed!','#ffd23f');if(clean){G.cleanGnaws=(G.cleanGnaws||0)+1;addScore(100,'clean!','#ffd23f')}}
function updateGnaw(dt){const g=G.gnaw;if(!g)return;g.lock=Math.max(0,g.lock-dt);
  g.pos+=g.dir*g.speed*dt;if(g.pos>1){g.pos=1;g.dir=-1}if(g.pos<0){g.pos=0;g.dir=1}$('gnaw').querySelector('.m').style.left=(g.pos*100)+'%';
  // walking off (or a hawk diving at you) ends it
  const moving=keys.KeyW||keys.KeyA||keys.KeyS||keys.KeyD||keys.ArrowUp||keys.ArrowDown||keys.ArrowLeft||keys.ArrowRight||joy.active&&Math.hypot(joy.x,joy.y)>.4||pad.on;
  if(moving||hawk.state==='dive'){endGnaw(false,true);toast('🦷 You left the twig for later.');tw_restore(g.tw)}}
function tw_restore(tw){tw.ready=true;tw.cd=0;tw.obj.visible=true}

// ============================================================ the pet shop: in through the cat flap after closing time
// One of Downtown's shops is a pet shop. After 6 PM its back door's cat flap lets a guinea pig in: aquariums glowing in
// the dark, shelves of supplies, Duchess the shop cat asleep on the counter, a maze of guinea pig tubes on the floor,
// spilled pellets and a treat bin to raid, and Butterscotch, a lonely shop guinea pig, in her pen. Noise wakes Duchess:
// hide in the tubes, or she boops you back out through the flap.
const SHOP={W:6,D:5,H:3.2,FLAP:{x:1.2,z:-2.5}};
const TUBE_R=.145,TUBE_NODES={A:[.6,-1.9],B:[.6,-.9],C:[-.9,-.9],D:[-1.15,-1.75],E:[-.9,.6],F:[-.45,1.75],G:[-1.85,.8],H:[1.75,-.5]};
const TUBE_SEGS=[['A','B',0xe8504a],['B','C',0x3a8ae8],['C','D',0xf0c030],['C','E',0x4ac060],['E','F',0xe8504a],['E','G',0x3a8ae8],['B','H',0xf0c030]];
const shopOpen=()=>G.time>=18||G.time<7.5,CAT_BED={x:2.05,z:.72};
function setupPetShop(z){const b=z.shops.find(s=>Math.abs(s.obj.position.x+12)<.5&&s.obj.position.z<0);if(!b)return;const o=b.obj;o.updateMatrixWorld(true);
  b.kind='shop';b.flapCD=0;const p=o.localToWorld(new THREE.Vector3(SHOP.FLAP.x,0,SHOP.FLAP.z*1.004)),a=o.rotation.y+Math.PI,nx=Math.sin(a),nz=Math.cos(a);
  const m=M.CatFlap.clone(true);m.position.set(p.x,heightAt(p.x,p.z)-.02,p.z);m.rotation.y=a;ZG.add(m);
  b.holes=[{ex:p.x+nx*.55,ez:p.z+nz*.55,out:a,h:SHOP.FLAP}];z.shop=b;
  // the sign over the awning, and the hours on the door
  const sign=(w,h,draw,lx,ly,lz)=>{const tex=canvasTex(512,Math.round(512*h/w),draw),mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,.05),[0,0,0,0,1,1].map(k=>k?new THREE.MeshStandardMaterial({map:tex,roughness:.7}):new THREE.MeshStandardMaterial({color:0x2a5a50,roughness:.7})));
    mesh.position.copy(o.localToWorld(new THREE.Vector3(lx,ly,lz)));mesh.rotation.y=o.rotation.y;mesh.castShadow=true;ZG.add(mesh)};
  sign(2.6,.5,(c,w,h)=>{c.fillStyle='#2a5a50';c.fillRect(0,0,w,h);c.strokeStyle='#f3e6c8';c.lineWidth=8;c.strokeRect(6,6,w-12,h-12);c.fillStyle='#fff3d8';c.font='600 56px Fredoka, sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText('🐾 PET SHOP 🐹',w/2,h/2+4)},-0.4,3.4,2.62);
  sign(.5,.32,(c,w,h)=>{c.fillStyle='#fff8e8';c.fillRect(0,0,w,h);c.fillStyle='#2a5a50';c.font='700 92px Fredoka, sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText('OPEN',w/2,h*.36);c.font='600 70px Fredoka, sans-serif';c.fillText('8 AM – 6 PM',w/2,h*.75)},1.9,1.5,2.56)}
function buildShopInside(b){const g=new THREE.Group(),B={kind:'shop',title:'🐾 The Pet Shop',onEnter:shopEnter,onExit:shopExit,actions:shopActions,update:shopUpdate,sniff:sniffShop,
    group:g,s:1,hx:SHOP.W/2-.13,hz:SHOP.D/2-.13,ceil:SHOP.H,loftX:Infinity,cols:[],boxes:[],tube:null,day:-1,tubeTreats:[]};
  const room=M.PetShopInside.clone(true);g.add(room);
  room.traverse(m=>{if(!m.isMesh)return;const n=m.material.name;
    if(n==='Water'){m.material=m.material.clone();m.material.transparent=true;m.material.opacity=.75;m.material.emissive=new THREE.Color(0x2aa6d8);m.material.emissiveIntensity=.9}
    if(n==='Glass'){m.material=m.material.clone();m.material.emissive=new THREE.Color(0x3a5a90);B.glassMat=m.material}
    if(n==='Lamp'){m.material=m.material.clone();if(m.name==='ExitSign'){m.material.emissive=new THREE.Color(0x40ff70);m.material.emissiveIntensity=1.4}else{m.material.emissive=new THREE.Color(0xfff2d8);B.lightMat=m.material}}
    if(n==='PenGlass'){m.material=m.material.clone();m.material.transparent=true;m.material.opacity=.3;m.material.depthWrite=false}});
  B.boxes.push({cx:1.5,cz:1.5,hx:1.12,hz:.32},{cx:-2.8,cz:-.2,hx:.22,hz:1.84},{cx:2.76,cz:-.5,hx:.24,hz:1.27},{cx:-2.1,cz:-1.8,hx:.71,hz:.51});
  B.cols.push({x:2.35,z:-2,r:.27},{x:2.55,z:-1.3,r:.22},{x:2.25,z:-1.05,r:.22});
  // the tubes: see-through plastic in four colours, joined at three junctions, open at five ends
  B.tubes=TUBE_SEGS.map(([a,b_,col],i)=>{const [ax,az]=TUBE_NODES[a],[bx,bz]=TUBE_NODES[b_],len=Math.hypot(bx-ax,bz-az);
    const mat=new THREE.MeshStandardMaterial({color:col,transparent:true,opacity:.42,roughness:.25,metalness:0,side:THREE.DoubleSide,depthWrite:false});
    const m=new THREE.Mesh(new THREE.CylinderGeometry(TUBE_R,TUBE_R,len,20,1,true),mat);m.position.set((ax+bx)/2,TUBE_R,(az+bz)/2);m.rotation.set(Math.PI/2,0,0);m.rotation.order='YXZ';m.rotation.y=Math.atan2(bx-ax,bz-az);m.renderOrder=2;g.add(m);
    return {a,b:b_,ax,az,bx,bz,len,i}});
  const deg={};for(const t of B.tubes){deg[t.a]=(deg[t.a]||0)+1;deg[t.b]=(deg[t.b]||0)+1}B.ends=Object.keys(deg).filter(k=>deg[k]===1);
  for(const k in deg){const [x,z]=TUBE_NODES[k];if(deg[k]>1){const j=new THREE.Mesh(new THREE.SphereGeometry(TUBE_R*1.18,20,12),new THREE.MeshStandardMaterial({color:0xf0f0f0,transparent:true,opacity:.4,roughness:.25,depthWrite:false}));j.position.set(x,TUBE_R,z);j.renderOrder=2;g.add(j)}
    else{const t=B.tubes.find(t=>t.a===k||t.b===k),ox=k===t.a?t.ax-t.bx:t.bx-t.ax,oz=k===t.a?t.az-t.bz:t.bz-t.az,ol=Math.hypot(ox,oz);
      const rim=new THREE.Mesh(new THREE.TorusGeometry(TUBE_R*1.02,.018,8,24),new THREE.MeshStandardMaterial({color:0xffffff,roughness:.4}));rim.position.set(x,TUBE_R,z);rim.rotation.y=Math.atan2(ox/ol,oz/ol);g.add(rim)}}
  // the forage spots, Duchess, the light from the street and the fish tanks
  B.spots=[{type:'shopspill',x:-2.05,z:-.25,r:.35,ready:true,cd:0},{type:'shopbin',x:2,z:-1.68,r:.3,ready:true,cd:0}];
  // Duchess's bed: a round cushion on the floor beside the counter
  const bed=new THREE.Mesh(new THREE.CylinderGeometry(.3,.32,.07,28),new THREE.MeshStandardMaterial({color:0x8a2a3a,roughness:.95}));bed.position.set(CAT_BED.x,.035,CAT_BED.z);bed.receiveShadow=true;g.add(bed);
  const rim=new THREE.Mesh(new THREE.TorusGeometry(.29,.05,10,28),new THREE.MeshStandardMaterial({color:0xa8394a,roughness:.95}));rim.rotation.x=Math.PI/2;rim.position.set(CAT_BED.x,.08,CAT_BED.z);g.add(rim);B.cols.push({x:CAT_BED.x,z:CAT_BED.z,r:.34});
  const loaf=M.CatLoaf.clone(true),stand=M.Cat.clone(true);loaf.position.set(CAT_BED.x,.07,CAT_BED.z);loaf.rotation.y=-Math.PI/2-.5;stand.visible=false;g.add(loaf,stand);
  B.cat={state:'sleep',noise:0,loaf,stand,legs:['LegFL','LegFR','LegBL','LegBR'].map(n=>stand.getObjectByName(n)),tail:stand.getObjectByName('Tail'),pos:new THREE.Vector3(CAT_BED.x,.07,CAT_BED.z),heading:-Math.PI/2-.5,t:0,phase:0,seen:null,pounce:0,cool:0,hop:null};
  B.hemi=new THREE.HemisphereLight(0xa8bce0,0x4a4058,1.05);g.add(B.hemi);
  const lamp=new THREE.PointLight(0xffc880,1.6,4.5,1.3);lamp.position.set(2,1.7,1.35);g.add(lamp);   // a little lamp left on by the till
  for(const z of [0,-1.05]){const l=new THREE.PointLight(0x40c0ff,1.1,3.2,1.5);l.position.set(2.5,1.1,z-.5+1);g.add(l)}
  B.street=new THREE.PointLight(0xffc890,1.2,6,1.5);B.street.position.set(-.9,1.6,2.2);g.add(B.street);
  B.ceilLight=new THREE.PointLight(0xfff4e0,0,9,1.2);B.ceilLight.position.set(0,3,0);g.add(B.ceilLight);
  const ex=new THREE.PointLight(0x40ff70,.5,2.2,1.5);ex.position.set(1.2,2.3,-2.3);g.add(ex);
  B.holes=[{x:SHOP.FLAP.x,z:SHOP.FLAP.z+.45,heading:0,i:0}];
  b.inside=B}
// a fresh batch of treats tucked into the tubes each day
function stockTubes(B){B.day=G.day;for(const t of B.tubeTreats)t.obj.removeFromParent();B.tubeTreats=[];
  for(let i=0;i<3;i++){const tb=B.tubes[(i*3+G.day)%B.tubes.length],k=.3+Math.random()*.4,type=pick({pellets:30,strawberry:20,carrot:18,pepper:12,clover4:3,goldCarrot:3});
    const o=itemModel(type);o.scale.multiplyScalar(.8);o.position.set(lerp(tb.ax,tb.bx,k),.03,lerp(tb.az,tb.bz,k));B.group.add(o);B.tubeTreats.push({tb:tb.i,k,type,obj:o,got:false})}}
function shopPig(){return friends.find(f=>f.shopPig)}
function shopEnter(B){if(B.day!==G.day)stockTubes(B);const c=B.cat;c.noise=Math.min(c.noise,.2);if(c.state!=='sleep')catSleep(B);
  const f=shopPig();if(f&&f.state==='wild'){swapScene(f.obj,B.group);f.obj.visible=true;f.pos.set(-2.1,0,-1.8);f.home={x:-2.1,z:-1.8};f.target={x:-2.1,z:-1.8}}
  if(!G.shop){G.shop=1;SFX.find('rare');callout('rare','🐾 The Pet Shop',100);addScore(100,'','#7fd0ff')}
  if(!G.shopTip){G.shopTip=true;toast(`🐾 <b>The pet shop, after hours!</b> Shh… Duchess the cat is asleep on the counter. Noise wakes her (scurrying, wheeking, rummaging): hide in the tubes if she does. Treats are tucked in the tubes, and someone is waiting in the pen…`,'gold',10)}
  else toast('🐾 In through the cat flap… tiptoe!')}
function shopExit(B){B.tube=null;const f=shopPig();if(f&&f.state==='wild'){swapScene(f.obj,scene);f.obj.visible=false;f.tag.style.display='none'}$('befriend').style.display='none';$('danger').style.display='none'}
function shopActions(B){if(B.tube)return [];const acts=exitActs(B,'Push back out through the cat flap');
  for(const k of B.ends){const [x,z]=TUBE_NODES[k];if(Math.hypot(x-pig.pos.x,z-pig.pos.z)<.36){acts.push({k:'E',label:'Crawl into the tube',do:()=>enterTube(k)});break}}
  for(const sp of B.spots){if(Math.hypot(sp.x-pig.pos.x,sp.z-pig.pos.z)<sp.r+.28){acts.push(sp.ready?{k:'F',hold:true,label:`Rummage in the ${SPOTNAME[sp.type]}`,spot:sp,do:()=>{if(!forageState)startForage(sp)}}:{k:'F',label:`${SPOTNAME[sp.type]} · nothing left (${Math.ceil(sp.cd)}s)`,disabled:true});break}}
  const f=shopPig();if(f&&f.state==='wild'&&Math.hypot(f.pos.x-pig.pos.x,f.pos.z-pig.pos.z)<1.2)acts.push({k:'C',hold:true,label:`Chat with ${esc(f.name)} through the glass${herd.length>=HERD_MAX?' (herd full: swap someone)':''}`});
  return acts}
// ---- the tubes: crawl along one, pick a way at each junction, come out at an end
function enterTube(k){const B=G.inside,t=B.tubes.find(t=>t.a===k||t.b===k);B.tube={t,k:t.a===k?.02:.98};tone('triangle',380,300,.08,.08);G.acts=null}
function updateTube(dt,t){const B=G.inside,u=B.tube;let tb=u.t;
  let ix=0,iz=0;if(keys.KeyW||keys.ArrowUp)iz+=1;if(keys.KeyS||keys.ArrowDown)iz-=1;if(keys.KeyA||keys.ArrowLeft)ix-=1;if(keys.KeyD||keys.ArrowRight)ix+=1;
  if(joy.active){ix=joy.x;iz=-joy.y}else if(pad.on){ix=pad.x;iz=-pad.y}
  const yaw=G.camYaw;let mx=-Math.sin(yaw)*iz+Math.cos(yaw)*ix,mz=-Math.cos(yaw)*iz-Math.sin(yaw)*ix;if(G.steer){mx=G.steer[0];mz=G.steer[1]}const ml=Math.hypot(mx,mz);
  const dx=(tb.bx-tb.ax)/tb.len,dz=(tb.bz-tb.az)/tb.len,along=ml>.15?(mx*dx+mz*dz)/ml:0,sp=(keys.ShiftLeft||keys.ShiftRight?1.7:1.1)*G.perk.speed;
  if(Math.abs(along)>.2){u.k+=Math.sign(along)*Math.min(1,Math.abs(along)*1.6)*sp*dt/tb.len;pig.heading+=angDiff(pig.heading,Math.atan2(dx*Math.sign(along),dz*Math.sign(along)))*Math.min(1,dt*12);B.cat.noise+=dt*.035;
    G.tubeRattle=(G.tubeRattle||0)-dt;if(G.tubeRattle<=0){G.tubeRattle=.22;tone('triangle',300+Math.random()*80,260,.05,.03)}}
  // pushing across the tube just short of a junction (turning early, as everyone does): slide on into it
  if(ml>.15&&Math.abs(along)<=.2){if((1-u.k)*tb.len<.25&&!B.ends.includes(tb.b))u.k=1;else if(u.k*tb.len<.25&&!B.ends.includes(tb.a))u.k=0}
  // at the end of a tube: out (at an open end), or round a junction into whichever tube best matches the way you're pushing
  const past=u.k<0||u.k>1,node=u.k<=.002?tb.a:u.k>=.998?tb.b:null;
  if(node&&(past||ml>.15)){
    if(B.ends.includes(node)){if(past){const [x,z]=TUBE_NODES[node],ox=node===tb.a?-dx:dx,oz=node===tb.a?-dz:dz;B.tube=null;pig.pos.set(x+ox*.32,0,z+oz*.32);pig.heading=Math.atan2(ox,oz);pig.vel.set(0,0,0);tone('triangle',300,420,.08,.08);G.acts=null;return}}
    else{let best=null,bd=.25;for(const o of B.tubes){if(o.a!==node&&o.b!==node)continue;const ox=(o.a===node?o.bx-o.ax:o.ax-o.bx)/o.len,oz=(o.a===node?o.bz-o.az:o.az-o.bz)/o.len,d=ml>.15?(mx*ox+mz*oz)/ml:-1;if(d>bd){bd=d;best=o}}
      if(best&&best!==tb){u.t=best;u.k=best.a===node?.01:.99;tb=best}}}
  u.k=clamp(u.k,0,1)
  pig.pos.set(lerp(tb.ax,tb.bx,u.k),0,lerp(tb.az,tb.bz,u.k));pig.vel.set(0,0,0);pig.air=false;pig.vy=0;
  const o=pig.obj;o.position.copy(pig.pos);o.rotation.set(0,pig.heading,0,'YXZ');animatePigLegs(dt,Math.abs(along)>.2?sp:0,Math.abs(along)>.2);U.player.value.copy(pig.pos);
  for(const tr of B.tubeTreats)if(!tr.got&&tr.tb===tb.i&&Math.abs(tr.k-u.k)*tb.len<.16){tr.got=true;tr.obj.removeFromParent();discover(tr.type);applyFood(tr.type);const it=ITEMS[tr.type];SFX.find(it.rarity);
    toast(`🐾 Found ${it.icon} <b style="color:${RARITY[it.rarity][0]}">${it.name}</b> in the tube! ${B.tubeTreats.filter(x=>!x.got).length||'No more'} left`,'good');
    if(B.tubeTreats.every(x=>x.got)){toast('🏆 <b>Every treat in the tubes!</b> More tomorrow night. +120','gold',5);addScore(120,'tubes!','#ffd23f')}}}
// ---- Duchess: noise wakes her; she hops down and hunts you; hide in a tube and she loses you and goes back to sleep
function catNoise(n){const B=G.inside;if(B&&B.cat&&B.cat.state==='sleep')B.cat.noise=Math.min(1.2,B.cat.noise+n)}
function catSleep(B){const c=B.cat;c.state='sleep';c.loaf.visible=true;c.stand.visible=false;c.hop=null;c.pos.set(CAT_BED.x,.07,CAT_BED.z);c.noise=.25}
function catHop(c,from,to,then){c.hop={from:from.clone(),to:to.clone(),t:0,then}}
function shopUpdate(B,dt,t){const c=B.cat,stand=c.stand;
  // noise: scurrying, rummaging and wheeking (and the tubes rattle a little); it fades when you're quiet
  if(c.state==='sleep'){const sp=Math.hypot(pig.vel.x,pig.vel.z),dc=Math.hypot(pig.pos.x-c.pos.x,pig.pos.z-c.pos.z);let n=0;
    if(!B.tube){if(sp>2.2)n+=.32;else if(sp>.3&&dc<2.6)n+=.02}if(forageState)n+=.09;if(pig.air)n+=.25;
    c.noise=n?Math.min(1.2,c.noise+n*dt):Math.max(0,c.noise-dt*.035);
    c.loaf.scale.y=1+Math.sin(t*1.6)*.03;
    if(c.noise>=1){c.state='wake';c.t=1;c.loaf.visible=false;stand.visible=true;stand.position.copy(c.pos);stand.rotation.y=c.heading;SFX.meow();toast('😼 <b>Duchess woke up!</b> Quick, into a tube!','bad',4)}}
  else if(c.state==='wake'){c.t-=dt;c.pos.y=0;stand.position.copy(c.pos);if(c.t<=0)c.state='hunt'}
  else{const hidden=!!B.tube;if(!hidden){c.seen=pig.pos.clone();c.lost=0}
    let target=null,speed=1.2;
    if(c.hop){c.hop.t+=dt/.55;const k=Math.min(1,c.hop.t);c.pos.lerpVectors(c.hop.from,c.hop.to,k);c.pos.y=lerp(c.hop.from.y,c.hop.to.y,k)+Math.sin(k*Math.PI)*.4;if(k>=1){const th=c.hop.then;c.hop=null;th()}}
    else if(c.state==='hunt'){if(hidden){c.lost=(c.lost||0)+dt;target=c.seen;if(c.lost>6){c.state='return';toast('🐈 Duchess lost interest and pads back to the counter.','good')}}
      else{target=pig.pos;const d=Math.hypot(pig.pos.x-c.pos.x,pig.pos.z-c.pos.z);c.cool-=dt;if(c.pounce>0){c.pounce-=dt;speed=2.7}else if(d<1.1&&c.cool<=0){c.pounce=.45;c.cool=1.4;SFX.meow()}
        if(d<.3&&!pig.air)return catBoop(B)}}
    else if(c.state==='return'){target=new THREE.Vector3(CAT_BED.x-.45,0,CAT_BED.z-.3);if(Math.hypot(c.pos.x-target.x,c.pos.z-target.z)<.15)catSleep(B)}
    if(target&&!c.hop){const dx=target.x-c.pos.x,dz=target.z-c.pos.z,dl=Math.hypot(dx,dz);if(dl>.05){c.heading+=angDiff(c.heading,Math.atan2(dx,dz))*Math.min(1,dt*6);c.pos.x+=Math.sin(c.heading)*speed*dt;c.pos.z+=Math.cos(c.heading)*speed*dt;insideCollide(c.pos,.12,true);c.pos.y=0}
      c.phase+=dt*speed*9;const sw=Math.sin(c.phase)*.45;c.legs[0].rotation.x=sw;c.legs[3].rotation.x=sw;c.legs[1].rotation.x=-sw;c.legs[2].rotation.x=-sw}
    if(c.tail)c.tail.rotation.y=Math.sin(t*3)*.3;stand.position.copy(c.pos);stand.rotation.y=c.heading}
  // Butterscotch potters about her pen, and comes to the glass to see you
  const f=shopPig();if(f&&f.state==='wild')updateShopPig(B,f,dt,t);
  for(const sp of B.spots)if(!sp.ready){sp.cd-=dt;if(sp.cd<=0)sp.ready=true}
  // the lights: the street lamp through the window, the fish tanks; at 7:30 the shopkeeper comes to open up
  if(B.glassMat)B.glassMat.emissiveIntensity=isNight()?.8:.3;
  if(!shopOpen()&&G.time<12){toast('🔑 The shopkeeper is unlocking the front door! You slip out through the cat flap.','',5);exitInside()}}
function catBoop(B){SFX.meow();setTimeout(()=>SFX.hurt(),150);G.hp=Math.max(0,G.hp-6);G.cause='was booped by the shop cat';hurtFx();toast('🐾 <b>Boop!</b> Duchess bats you out through the cat flap. She will watch it for a while.','bad',5);
  const b=B.from;exitInside();b.flapCD=45;catSleep(B)}
function updateShopPig(B,f,dt,t){const near=Math.hypot(f.pos.x-pig.pos.x,f.pos.z-pig.pos.z),chat=keys.KeyC&&near<1.2&&!B.tube&&!pig.air;
  f.actT-=dt;if(f.actT<=0){f.actT=R(2,5);f.target={x:R(-2.65,-1.55),z:R(-2.15,-1.45)}}
  const tx=near<2.5?clamp(pig.pos.x,-2.6,-1.6):f.target.x,tz=near<2.5?clamp(pig.pos.z,-2.2,-1.4):f.target.z,hx=tx-f.pos.x,hz=tz-f.pos.z,hl=Math.hypot(hx,hz),mv=hl>.08&&!chat;
  if(mv){f.heading+=angDiff(f.heading,Math.atan2(hx,hz))*Math.min(1,dt*6);f.pos.x+=Math.sin(f.heading)*.5*dt;f.pos.z+=Math.cos(f.heading)*.5*dt}
  else if(near<2.5)f.heading+=angDiff(f.heading,Math.atan2(pig.pos.x-f.pos.x,pig.pos.z-f.pos.z))*Math.min(1,dt*4);
  f.obj.position.set(f.pos.x,mv?Math.abs(Math.sin(f.phase))*.008:0,f.pos.z);f.obj.rotation.set(0,f.heading,0,'YXZ');animatePigLegs(dt,mv?.5:0,mv,f);f.fur.forEach((s,k)=>s.visible=k%FUR_STEP()===0);
  const bf=$('befriend');
  if(chat){f.friend+=dt/((f.shy?5.5:3.2)/G.perk.social*(1+herd.length*.12));f.chatT-=dt;if(f.chatT<=0){f.chatT=.5;SFX.chut();heart(f.pos.x,f.pos.y+.17,f.pos.z)}
    bf.style.display='block';bf.querySelector('.l').textContent=`Chatting with ${f.name}…`;bf.querySelector('i').style.width=(f.friend*100)+'%';
    if(f.friend>=1){bf.style.display='none';if(herd.length>=HERD_MAX)offerSwap(f);else shopPigJoin(f)}}
  else bf.style.display='none';
  // her name over her head while you're close
  if(near<2.2){_fv.set(f.pos.x,f.pos.y+.24,f.pos.z).project(camera);if(_fv.z<1){f.tag.style.display='block';f.tag.style.left=((_fv.x*.5+.5)*innerWidth)+'px';f.tag.style.top=((-_fv.y*.5+.5)*innerHeight)+'px';
    const html=`${esc(f.name)} · shy <i>${'♥'.repeat(Math.floor(f.friend*5))}${'♡'.repeat(5-Math.floor(f.friend*5))}</i>`;if(f.tag._h!==html){f.tag.innerHTML=html;f.tag._h=html}}}else f.tag.style.display='none';
  if(!G.metButterscotch&&near<2){G.metButterscotch=true;toast(`🐹 A little golden guinea pig presses her nose to the glass. This is <b>${esc(f.name)}</b>, and she looks lonely. Hold ${kb('C','Chat')} to chat with her.`,'',7)}}
function shopPigJoin(f){f.zone=Z.id;swapScene(f.obj,iScene);joinHerd(f);f.pos.set(-1.25,0,clamp(pig.pos.z,-2.2,-1.4));f.vy=1.8;f.air=true;
  toast(`🐹 <b>${esc(f.name)}</b> hops right over the glass! She's been waiting for a friend.`,'gold',6)}
function sniffShop(B){let n=0;for(const tr of B.tubeTreats)if(!tr.got){marker(tr.obj.position.x,.3,tr.obj.position.z,0xffd060,B.group);n++}
  for(const sp of B.spots)if(sp.ready)marker(sp.x,.3,sp.z,0xffd060,B.group);
  toast(n?`👃 Sniff sniff… <b>${n} treat${n>1?'s':''}</b> tucked in the tubes, and food on the floor!`:'👃 Pellets, hay and… cat. No treats left in the tubes tonight.')}

// ============================================================ the leaf raft (Willow Creek) and Willow Island
// A big leaf lies on the bank at the top of the creek. Hop on and the current carries you downstream to the east: steer
// between the stepping stones at the fords (rapids!), round the snags, scoop the treats floating by. Three bumps and you
// tip off into the shallows; make it to the end and the creek carries you round the bend to Willow Island.
const RAFT={from:-60,to:64,speed:1.7,lat:1.35,r:.12,stone:.15};
let creekCurve=null,creekLen=0;
function creekPath(){if(creekCurve)return;creekCurve=new THREE.CatmullRomCurve3(CREEK.map(([x,z])=>new THREE.Vector3(x,0,z)),false,'centripetal');creekLen=creekCurve.getLength()}
// a point on the creek: position, flow direction, and n (to your right as you ride downstream)
function creekAt(s){const u=clamp(s/creekLen,0,1),p=creekCurve.getPointAt(u),t=creekCurve.getTangentAt(u);return {x:p.x,z:p.z,tx:t.x,tz:t.z,nx:-t.z,nz:t.x}}
function sAtX(x){let lo=0,hi=creekLen;for(let i=0;i<40;i++){const m=(lo+hi)/2;if(creekCurve.getPointAt(m/creekLen).x<x)lo=m;else hi=m}return lo}
function setupRaft(z){creekPath();const s0=sAtX(RAFT.from),c=creekAt(s0);let side=0,bank=0;
  for(const sd of [1,-1]){for(let l=1.5;l<6;l+=.1){const x=c.x+c.nx*l*sd,zz=c.z+c.nz*l*sd;if(!wet(x,zz,0)){if(freeAt(x+c.nx*sd*.6,zz+c.nz*sd*.6,.3)){side=sd;bank=l}break}}if(side)break}
  if(!side){side=1;bank=3.4}
  const leaf=M.LeafRaft.clone(true),lat=(bank-.4)*side,head=Math.atan2(c.tx,c.tz);leaf.position.set(c.x+c.nx*lat,-.115,c.z+c.nz*lat);leaf.rotation.y=head;z.group.add(leaf);
  const el=(bank+.45)*side,ex=c.x+c.nx*el,ez=c.z+c.nz*el,out=Math.atan2(-c.nx*side,-c.nz*side);
  // a little sign beside it
  const sx=ex+c.tx*.9,sz=ez+c.tz*.9,post=new THREE.Mesh(new THREE.CylinderGeometry(.025,.03,.6,8),new THREE.MeshStandardMaterial({color:0x7a5534,roughness:.9}));post.position.set(sx,heightAt(sx,sz)+.3,sz);z.group.add(post);
  const tex=canvasTex(512,180,(g,w,h)=>{g.fillStyle='#7a9a3a';g.fillRect(0,0,w,h);g.strokeStyle='#4a6a1e';g.lineWidth=10;g.strokeRect(5,5,w-10,h-10);g.fillStyle='#fff8e0';g.font='600 58px Fredoka, sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText('🍃 Leaf rides!',w/2,h*.42);g.font='500 34px Fredoka, sans-serif';g.fillText('down to the willow →',w/2,h*.76)});
  const board=new THREE.Mesh(new THREE.BoxGeometry(.62,.22,.03),new THREE.MeshStandardMaterial({map:tex,roughness:.8}));board.position.set(sx,heightAt(sx,sz)+.55,sz);board.rotation.y=out;board.castShadow=true;z.group.add(board);addCollider(sx,sz,.05);
  // the stepping stones at the fords (as laid in the creek's props) and three snags reaching out from the banks
  const obs=[];for(const [fx,fz] of FORDS)for(let t=-3.2;t<=3.2;t+=.8)obs.push({x:fx+t*.35,z:fz+t,r:RAFT.stone,kind:'stone'});
  const send=sAtX(RAFT.to),snags=[];[[.27,1],[.55,-1],[.83,1]].forEach(([k,sd])=>{const sc=creekAt(s0+(send-s0)*k),a={x:sc.x+sc.nx*.45*sd,z:sc.z+sc.nz*.45*sd},b={x:sc.x+sc.nx*2.2*sd,z:sc.z+sc.nz*2.2*sd};
    const log=M.Log.clone(true);log.scale.setScalar(.62);log.position.set((a.x+b.x)/2,-.11,(a.z+b.z)/2);log.rotation.y=Math.atan2(sc.nx,sc.nz);z.group.add(log);snags.push({ax:a.x,az:a.z,bx:b.x,bz:b.z,r:.13})});
  z.raft={s0,send,leaf,leafLat:lat,ex,ez,out,obs,snags,island:{kind:'island',scale:1,holes:[{ex,ez,out}]}}}
function startRaft(){const RF=Z.raft;G.acts=null;forageState=null;$('forage').style.display='none';if(hawk.state!=='away'){hawk.state='away';hawk.t=R(30,60);hawk.obj.visible=false}
  const F=G.raft={s:RF.s0+.5,lat:clamp(RF.leafLat,-RAFT.lat,RAFT.lat),vl:0,speed:.5,bal:3,got:0,bumps:0,inv:0,duckCD:0,yaw:0,splashT:0,treats:[]};G.hidden=true;RF.leaf.visible=false;
  F.obj=M.LeafRaft.clone(true);ZG.add(F.obj);
  for(let i=0;i<14;i++){const s=RF.s0+8+(RF.send-RF.s0-16)*(i+Math.random()*.6)/14,lat=(Math.random()*2-1)*1.05,c=creekAt(s),type=pick({dandelion:24,clover:24,watercress:20,strawberry:14,pepper:8,goldDandelion:2,clover4:2});
    const o=itemModel(type);o.position.set(c.x+c.nx*lat,-.1,c.z+c.nz*lat);ZG.add(o);F.treats.push({x:o.position.x,z:o.position.z,type,obj:o,got:false})}
  SFX.whoosh();emit(pig.pos.x,-.1,pig.pos.z,20,{col:[.8,.9,1],spread:.6,up:1,size:.015,life:.6});
  if(!G.raftTip){G.raftTip=true;toast(`🍃 <b>Whee!</b> The current carries you downstream. Steer left and right${G.input==='touch'?' with the joystick':''}, push forward to paddle, back to slow down. Thread the stepping stones at the rapids, dodge the snags, scoop up the treats. Three bumps and you're in the water!`,'gold',10)}}
function raftBump(F,awayLat,what){if(F.inv>0)return;F.inv=1;F.bal--;F.bumps++;F.speed*=.25;F.vl=Math.sign(awayLat||1)*1.6;SFX.hurt();emit(pig.pos.x,-.08,pig.pos.z,24,{col:[.85,.93,1],spread:.8,up:1.3,size:.016,life:.7});
  floaty(what,'#9ad8ff');if(F.bal<=0)raftCapsize()}
function updateRaft(dt,t){const RF=Z.raft,F=G.raft;F.inv=Math.max(0,F.inv-dt);F.duckCD=Math.max(0,F.duckCD-dt);
  let ix=0,iz=0;if(keys.KeyW||keys.ArrowUp)iz+=1;if(keys.KeyS||keys.ArrowDown)iz-=1;if(keys.KeyA||keys.ArrowLeft)ix-=1;if(keys.KeyD||keys.ArrowRight)ix+=1;
  if(joy.active){ix=joy.x;iz=-joy.y}else if(pad.on){ix=pad.x;iz=-pad.y}if(G.steerRaft){ix=G.steerRaft[0];iz=G.steerRaft[1]}
  let c=creekAt(F.s);const px=c.x+c.nx*F.lat,pz=c.z+c.nz*F.lat,rapids=FORDS.some(([fx,fz])=>Math.hypot(fx-px,fz-pz)<4.5);
  F.speed=lerp(F.speed,RAFT.speed*(rapids?1.35:1)+iz*.75,Math.min(1,dt*1.5));F.vl=lerp(F.vl,ix*1.5,Math.min(1,dt*4));
  F.s+=F.speed*dt;F.lat+=F.vl*dt;if(Math.abs(F.lat)>RAFT.lat){F.lat=Math.sign(F.lat)*RAFT.lat;F.vl*=-.3;F.speed*=.97;if(Math.random()<.2)SFX.rustle()}
  c=creekAt(F.s);const x=c.x+c.nx*F.lat,z=c.z+c.nz*F.lat;
  for(const o of RF.obs){const dx=x-o.x,dz=z-o.z;if(Math.abs(dx)<1&&Math.abs(dz)<1&&Math.hypot(dx,dz)<o.r+RAFT.r){const along=dx*c.nx+dz*c.nz;F.lat+=Math.sign(along||1)*.12;raftBump(F,along,'bonk!');break}}
  for(const sn of RF.snags){const ax=sn.bx-sn.ax,az=sn.bz-sn.az,k=clamp(((x-sn.ax)*ax+(z-sn.az)*az)/(ax*ax+az*az),0,1),qx=sn.ax+ax*k,qz=sn.az+az*k;
    if(Math.hypot(x-qx,z-qz)<sn.r+RAFT.r){const away=-((sn.ax-c.x)*c.nx+(sn.az-c.z)*c.nz);F.s-=.15;raftBump(F,away,'snag!');break}}
  if(G.raft!==F)return;   // tipped off
  for(const d of Z.critters)if(d.kind==='Duck'&&F.duckCD<=0&&Math.hypot(d.x-x,d.z-z)<.4){F.duckCD=1.5;SFX.quack();F.vl+=Math.sign((x-d.x)*c.nx+(z-d.z)*c.nz||1)*2;floaty('quack!','#fff3a0')}
  for(const tr of F.treats){if(tr.got)continue;tr.obj.position.y=-.1+Math.sin(t*2.5+tr.x)*.012;tr.obj.rotation.y+=dt*.6;
    if(Math.hypot(tr.x-x,tr.z-z)<.34){tr.got=true;tr.obj.removeFromParent();F.got++;discover(tr.type);applyFood(tr.type);SFX.pop()}}
  if(rapids){F.splashT-=dt;if(F.splashT<=0){F.splashT=.12;const o=RF.obs[Math.floor(Math.random()*RF.obs.length)];if(Math.hypot(o.x-x,o.z-z)<6)emit(o.x+R(-.2,.2),-.1,o.z+R(-.2,.2),3,{col:[.9,.96,1],spread:.4,up:.8,size:.014,life:.5})}}
  // the pig and the leaf
  F.yaw=Math.atan2(c.tx,c.tz);const head=F.yaw-F.vl*.18,bob=Math.sin(t*3)*.008+(rapids?Math.sin(t*11)*.006:0);
  F.obj.position.set(x,-.115+bob,z);F.obj.rotation.set(Math.sin(t*2.1)*.03,head,-F.vl*.12+(F.inv>0?Math.sin(t*30)*.12:0),'YXZ');
  pig.pos.set(x,-.09+bob,z);pig.vel.set(0,0,0);pig.heading=head;pig.obj.position.copy(pig.pos);pig.obj.rotation.set(0,head,-F.vl*.08,'YXZ');pig.blob.visible=false;U.player.value.copy(pig.pos);
  animatePigLegs(dt,0,false);
  if(F.s>=RF.send)raftFinish()}
function raftEnd(F){for(const tr of F.treats)tr.obj.removeFromParent();F.obj.removeFromParent();Z.raft.leaf.visible=true;G.raft=null;G.hidden=false;pig.blob.visible=true;G.acts=null}
function raftCapsize(){const F=G.raft,R=Z.raft,c=creekAt(F.s),sd=Math.sign(F.lat||1);raftEnd(F);SFX.whoosh();setTimeout(()=>SFX.hurt(),100);
  let bx=c.x+c.nx*3.6*sd,bz=c.z+c.nz*3.6*sd;for(let l=1.5;l<7;l+=.1){const x=c.x+c.nx*l*sd,z=c.z+c.nz*l*sd;if(!wet(x,z,.02)&&freeAt(x,z,.15)){bx=x;bz=z;break}}
  emit(pig.pos.x,-.1,pig.pos.z,40,{col:[.85,.93,1],spread:1,up:1.6,size:.02,life:.9});pig.pos.set(bx,heightAt(bx,bz),bz);pig.heading=Math.atan2(c.nx*sd,c.nz*sd);G.camYaw=pig.heading+Math.PI;regroupHerd();snapCamera();
  G.energy=Math.max(0,G.energy-10);toast(`💦 <b>Splash!</b> You tumble off the leaf and scramble ashore, soggy but fine.${F.got?` You scooped up ${F.got} treat${F.got>1?'s':''} on the way.`:''} The leaf drifts back to the top of the creek.`,'bad',6)}
function raftFinish(){const F=G.raft,R=Z.raft,clean=F.bumps===0;raftEnd(F);G.rafts=(G.rafts||0)+1;
  addScore(150,'raft ride!','#9ad8ff');if(clean){G.cleanRaft=(G.cleanRaft||0)+1;addScore(150,'no bumps!','#ffd23f')}
  toast(`🍃 <b>What a ride!</b>${clean?' Not a single bump!':''} The creek carries you round the bend to a hidden island…`,'gold',5);enterInside(R.island,R.island.holes[0])}
// ---- Willow Island: an islet round the bend, a giant weeping willow with a root hollow to nap in, driftwood and watercress
function islandHeight(x,z){const r=Math.hypot(x,z);return r<6?.34*Math.pow(1-(r/6)**2,.8)+.01:Math.max(-.4,.01-(r-6)*.28)}
function buildIslandInside(b){const g=new THREE.Group(),B={kind:'island',title:'🌿 Willow Island',noHerd:true,onEnter:islandEnter,onExit:()=>{},actions:islandActions,update:islandUpdate,sniff:sniffIsland,
    group:g,s:1,hx:9,hz:9,ceil:30,loftX:Infinity,cols:[],boxes:[],radius:6.05,height:islandHeight,waterY:0,spots:[]};
  // the island: a mound, sand round its rim, grass on top; water out to the horizon
  const rings=26,segs=72,pos=[],col=[],idx=[];for(let i=0;i<=rings;i++){const r=i/rings*8;for(let j=0;j<=segs;j++){const a=j/segs*Math.PI*2,x=Math.cos(a)*r,z=Math.sin(a)*r,h=islandHeight(x,z),n=fbm(x*.6,z*.6,2)*.5+.5;pos.push(x,h,z);
    const sand=1-smooth(.08,.16,h),gr=mixc([.36,.56,.18],[.46,.64,.22],n),sd=mixc([.86,.78,.56],[.92,.86,.66],n);const c=mixc(gr,sd,sand);col.push(c[0]*1.1,c[1]*1.1,c[2]*1.1)}}
  for(let i=0;i<rings;i++)for(let j=0;j<segs;j++){const a=i*(segs+1)+j,b2=a+segs+1;idx.push(a,b2,a+1,a+1,b2,b2+1)}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(col,3));geo.setIndex(idx);geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95,map:detailTex,side:THREE.DoubleSide})));
  const water=new THREE.Mesh(new THREE.CircleGeometry(80,48),waterMat);water.rotation.x=-Math.PI/2;g.add(water);
  // the willow, its root hollow facing the beach where you land
  const wl=M.Willow.clone(true);wl.position.set(-.5,0,-1.3);g.add(wl);B.cols.push({x:-.5,z:-1.3,r:.6});B.hollow={x:-.5,z:-1.3+.85};
  for(const m of [wl])m.traverse(o=>{if(o.isMesh&&o.material.name==='Leaves')windify(o.material,{amp:.05,hScale:.5})});
  // grass, flowers, cattails round the shore, a couple of bushes, driftwood and two watercress beds
  const rng=mulberry32(909),put=(name,n,test,sc)=>{const mats=[];for(let k=0;k<n*20&&mats.length<n;k++){const a=rng()*Math.PI*2,r=Math.sqrt(rng())*7,x=Math.cos(a)*r,z=Math.sin(a)*r;if(!test(x,z,r))continue;
    mats.push(mat4(x,islandHeight(x,z)-.01,z,rng()*6,sc[0]+rng()*(sc[1]-sc[0])))}iSet(name,mats,g)};
  put('Grass',700,(x,z,r)=>r<5.4&&Math.hypot(x+.5,z+1.3)>.7,[.8,1.3]);put('LushGrass',60,(x,z,r)=>r<5&&Math.hypot(x+.5,z+1.3)>1,[.9,1.2]);
  put('FlowerWhite',26,(x,z,r)=>r<5,[.7,.9]);put('FlowerPurple',20,(x,z,r)=>r<5,[.7,.9]);put('Cattail',60,(x,z,r)=>r>5.9&&r<6.9&&Math.abs(Math.atan2(x,z))>.5,[.8,1.2]);
  for(const [x,z] of [[2.6,-1.6],[-3.2,1.4]]){const o=M.Bush.clone(true);o.position.set(x,islandHeight(x,z)-.05,z);o.scale.setScalar(1.1);g.add(o)}
  {const x=2.9,z=1.9,o=M.Log.clone(true);o.position.set(x,islandHeight(x,z)-.03,z);o.rotation.y=.9;g.add(o);B.cols.push({x:x+Math.sin(.9)*.55,z:z+Math.cos(.9)*.55,r:.2},{x:x-Math.sin(.9)*.55,z:z-Math.cos(.9)*.55,r:.2});
    B.spots.push({type:'islandlog',x:x+Math.cos(.9)*.42,z:z-Math.sin(.9)*.42,r:.4,ready:true,cd:0})}
  for(const [a,r] of [[2.3,6.1],[-2.2,6.1]]){const x=Math.sin(a)*r,z=Math.cos(a)*r,o=M.CressBed.clone(true);o.position.set(x*1.04,-.004,z*1.04);g.add(o);B.spots.push({type:'cress',x:x*.97,z:z*.97,r:.45,ready:true,cd:0})}
  // the leaf, beached where you land
  const leaf=M.LeafRaft.clone(true);leaf.position.set(0,-.02,6.15);leaf.rotation.y=Math.PI;g.add(leaf);B.leafAt={x:0,z:5.75};
  B.sun=new THREE.DirectionalLight(0xfff0d8,2);g.add(B.sun);g.add(B.sun.target);B.hemi=new THREE.HemisphereLight(0xcfe6ff,0x6a5c3a,1);g.add(B.hemi);
  B.holes=[{x:0,z:5.4,heading:Math.PI,i:0}];
  b.inside=B}
function iSet(name,mats,group){if(!mats.length)return;for(const p of bake(name)){const im=new THREE.InstancedMesh(p.geo,p.mat,mats.length);mats.forEach((m,j)=>im.setMatrixAt(j,m));im.computeBoundingSphere();group.add(im)}}
function islandEnter(B){if(!G.island){G.island=1;SFX.find('epic');callout('epic','🌿 Willow Island',200);addScore(200,'new place!','#c98bff');
    toast('🌿 <b>Willow Island.</b> A hidden islet round the bend of the creek, with a giant weeping willow. Curl up in its roots for a nap, forage the driftwood and the watercress, then ride the leaf back.','gold',9)}
  else toast('🌿 Back on Willow Island')}
function islandActions(B){const acts=[];
  if(Math.hypot(B.leafAt.x-pig.pos.x,B.leafAt.z-pig.pos.z)<.6)acts.push({k:'E',label:'Ride the leaf back up the creek',do:()=>{toast('🍃 You paddle the leaf back up the creek to where you started.');exitInside()}});
  if(Math.hypot(B.hollow.x-pig.pos.x,B.hollow.z-pig.pos.z)<.6)acts.push({k:'E',label:'Curl up in the willow roots for a nap',do:()=>{restInTunnel();toast('🌿 The willow rustles you to sleep. So cosy.','good')}});
  for(const sp of B.spots){if(Math.hypot(sp.x-pig.pos.x,sp.z-pig.pos.z)<sp.r+.28){acts.push(sp.ready?{k:'F',hold:true,label:`Forage ${SPOTNAME[sp.type]}`,spot:sp,do:()=>{if(!forageState)startForage(sp)}}:{k:'F',label:`${SPOTNAME[sp.type]} · picked over (${Math.ceil(sp.cd)}s)`,disabled:true});break}}
  return acts}
function islandUpdate(B,dt,t){for(const sp of B.spots)if(!sp.ready){sp.cd-=dt;if(sp.cd<=0)sp.ready=true}
  // the island shares the sky: its light, colours and haze follow the time of day
  B.sun.color.copy(sun.color);B.sun.intensity=sun.intensity*.85;B.sun.position.copy(skyMat.uniforms.sunDir.value).multiplyScalar(30);B.hemi.color.copy(hemi.color);B.hemi.intensity=hemi.intensity;
  iScene.background=skyMat.uniforms.hor.value;if(!iScene.fog)iScene.fog=new THREE.Fog(0xcfe3ee,20,70);iScene.fog.color.copy(scene.fog.color)}
function sniffIsland(B){for(const sp of B.spots)if(sp.ready)marker(sp.x,islandHeight(sp.x,sp.z)+.25,sp.z,0xffd060,B.group);marker(B.hollow.x,.45,B.hollow.z,0x7fd0ff,B.group);
  toast('👃 Sniff sniff… driftwood, watercress, and the cosy hollow under the willow.')}

// ============================================================ the agility tent (Critter Corner)
// Guinea pig agility is a real thing. A striped marquee by the visitor path; duck under the door flap and there's a little
// course in the sawdust: step on the start mat, then the hoop, the weave poles, the tunnel, the jump, the A-frame and the
// seesaw in order, and over the finish line. A knocked bar or a missed weave pole adds seconds. Rosettes go by time.
const AGI={W:6.4,D:5,GOLD:10,SILVER:15,START:{x:.65,z:1.7}};
const AGI_COURSE=[
  {name:'Hoop',x:1.5,z:1.7,nx:1,nz:0,half:.15},
  {name:'Weave poles',x:2.4,z:-.6,nx:0,nz:-1,half:.6,weave:true},
  {name:'Tunnel',x:.4,z:-1.8,nx:-1,nz:0,half:.14},
  {name:'Jump',x:-.5,z:-1.8,nx:-1,nz:0,half:.24,jump:true},
  {name:'A-frame',x:-2.3,z:-.2,nx:0,nz:1,half:.18,minY:.2},
  {name:'Seesaw',x:-.85,z:1.65,nx:1,nz:0,half:.16,minY:.03},
  {name:'Finish',x:-.3,z:1.65,nx:1,nz:0,half:.45}];
const WEAVE_X=2.4,WEAVE_Z=[1,.68,.36,.04,-.28,-.6],SEESAW={x:-1.3,z:1.65,L:.7,h:.14,tilt:.172},AFRAME={x:-2.3,z:-.2,L:.8,h:.3,w:.18};
const ROSETTE=['','🥉 bronze','🥈 silver','🥇 gold'];
function boardSign(o,w,h,draw,lx,ly,lz,edge=0x2a5a50){const tex=canvasTex(512,Math.round(512*h/w),draw),mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,.04),[0,0,0,0,1,1].map(k=>k?new THREE.MeshStandardMaterial({map:tex,roughness:.7}):new THREE.MeshStandardMaterial({color:edge,roughness:.7})));
  o.updateMatrixWorld(true);mesh.position.copy(o.localToWorld(new THREE.Vector3(lx,ly,lz)));mesh.rotation.y=o.rotation.y;mesh.castShadow=true;return mesh}
// the tent goes in the first clear spot beside the visitor path, its door turned to face the path (squared up, so its box collides)
function setupAgility(z){const fits=(cx,cz,sw)=>{const hx=(sw?AGI.D:AGI.W)/2+.7,hz=(sw?AGI.W:AGI.D)/2+.7;let lo=Infinity,hi=-Infinity;
    for(let x=cx-hx;x<=cx+hx;x+=.5)for(let zz=cz-hz;zz<=cz+hz;zz+=.5){if(!freeAt(x,zz,.15)||distToPath(x,zz)<.9||Math.hypot(x,zz)>EDGE-5)return false;
      if(PENS.some(([px,pz,w,h])=>Math.abs(x-px)<w/2+1&&Math.abs(zz-pz)<h/2+1))return false;const y=heightAt(x,zz);lo=Math.min(lo,y);hi=Math.max(hi,y)}
    return hi-lo<.7};
  const cands=[];for(let i=0;i<ZOO_LOOP.length-1;i++){const [ax,az]=ZOO_LOOP[i],[bx,bz]=ZOO_LOOP[i+1],L=Math.hypot(bx-ax,bz-az);
    for(let k=.1;k<=.91;k+=.1)for(const sd of [1,-1]){const nx=-(bz-az)/L*sd,nz=(bx-ax)/L*sd,rot=Math.round(Math.atan2(-nx,-nz)/(Math.PI/2))*Math.PI/2,sw=Math.abs(Math.sin(rot))>.5;
      const off=(sw?AGI.W:AGI.D)/2+2,cx=ax+(bx-ax)*k+nx*off,cz=az+(bz-az)*k+nz*off;cands.push({cx,cz,rot,sw})}}
  cands.sort((a,b)=>Math.hypot(a.cx,a.cz)-Math.hypot(b.cx,b.cz));const at=cands.find(c=>fits(c.cx,c.cz,c.sw));   // nearest the middle of the zoo
  if(!at)return;const {cx,cz,rot,sw}=at,hx=(sw?AGI.D:AGI.W)/2,hz=(sw?AGI.W:AGI.D)/2;
  const y=Math.min(heightAt(cx-hx,cz-hz),heightAt(cx+hx,cz-hz),heightAt(cx-hx,cz+hz),heightAt(cx+hx,cz+hz),heightAt(cx,cz))-.04;
  const o=M.AgilityTent.clone(true);o.position.set(cx,y,cz);o.rotation.y=rot;z.group.add(o);boxes.push({cx,cz,hx,hz});
  const a=rot,nx=Math.sin(a),nz=Math.cos(a);o.updateMatrixWorld(true);const p=o.localToWorld(new THREE.Vector3(0,0,AGI.D/2));
  z.group.add(boardSign(o,1.5,.42,(c,w,h)=>{c.fillStyle='#fff6e0';c.fillRect(0,0,w,h);c.strokeStyle='#c8281e';c.lineWidth=12;c.strokeRect(8,8,w-16,h-16);c.fillStyle='#c8281e';c.font='700 62px Fredoka, sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText('🏅 PIGGY AGILITY',w/2,h*.4);c.fillStyle='#3a6ab0';c.font='600 34px Fredoka, sans-serif';c.fillText('clear rounds daily · all breeds',w/2,h*.76)},0,1.05,AGI.D/2+.06,0xc8281e));
  z.agility={obj:o,kind:'agility',scale:1,holes:[{ex:p.x+nx*.5,ez:p.z+nz*.5,out:a,h:{x:0,z:AGI.D/2}}]}}
function agiHeight(x,z){const B=G.inside;
  const fx=Math.abs(x-AFRAME.x),fz=Math.abs(z-AFRAME.z);if(fx<AFRAME.w&&fz<AFRAME.L)return AFRAME.h*(1-fz/AFRAME.L)+.012;
  const sx=x-SEESAW.x;if(Math.abs(sx)<SEESAW.L&&Math.abs(z-SEESAW.z)<.15)return Math.max(0,SEESAW.h+.0125+sx*Math.sin(B?B.tilt:SEESAW.tilt));
  return 0}
function buildAgilityInside(b){const g=new THREE.Group(),B={kind:'agility',title:'🏅 The Agility Tent',onEnter:agiEnter,onExit:agiExit,actions:agiActions,update:agiUpdate,sniff:sniffAgility,hud:agiHud,
    group:g,s:1,hx:AGI.W/2-.13,hz:AGI.D/2-.13,ceil:1.75,loftX:Infinity,cols:[],boxes:[],height:agiHeight,camMax:3.4,ceilAt:(x,z)=>1.5+1.4*(1-Math.max(Math.abs(x)/(AGI.W/2),Math.abs(z)/(AGI.D/2)))-.2,tilt:SEESAW.tilt,tiltTo:SEESAW.tilt,run:null};
  const room=M.AgilityInside.clone(true);g.add(room);
  room.traverse(m=>{if(m.isMesh&&m.material.name==='HoleDark'){m.material=new THREE.MeshBasicMaterial({color:0xfff0d0});B.gapMat=m.material}});
  const piece=(name,x,z,ry=0)=>{const o=M.AgilityKit.getObjectByName(name).clone(true);o.position.set(x,0,z);o.rotation.y=ry;g.add(o);return o};
  B.cols.push({x:0,z:0,r:.09});   // the centre pole
  for(const [x,z,sw] of [[-2.75,-2.05,0],[-2.2,-2.2,0],[2.75,-2.05,0],[2.75,2.05,0],[-2.75,1.25,1]])B.boxes.push({cx:x,cz:z,hx:sw?.16:.25,hz:sw?.25:.16});   // straw bales
  const C=AGI_COURSE;piece('Hoop',C[0].x,C[0].z,Math.PI/2);for(const s of [-1,1])B.cols.push({x:C[0].x,z:C[0].z+s*.24,r:.03});
  for(const z of WEAVE_Z){piece('Pole',WEAVE_X,z);B.cols.push({x:WEAVE_X,z,r:.025})}
  B.tunnel=piece('Tunnel',1,-1.8);for(const s of [-1,1])B.boxes.push({cx:1,cz:-1.8+s*.2,hx:.6,hz:.02});
  B.tunnel.traverse(m=>{if(m.isMesh&&m.material.name==='Cloth'){m.material=m.material.clone();m.material.transparent=true;B.tunnelMat=m.material}});
  B.jump=piece('Jump',C[3].x,C[3].z,Math.PI/2);B.bar=B.jump.getObjectByName('Bar');for(const s of [-1,1])B.cols.push({x:C[3].x,z:C[3].z+s*.27,r:.03},{x:C[3].x,z:C[3].z+s*.36,r:.05});
  piece('Ramp',AFRAME.x,AFRAME.z,Math.PI/2);
  B.seesaw=piece('Seesaw',SEESAW.x,SEESAW.z);B.plank=B.seesaw.getObjectByName('Plank');B.plank.rotation.z=SEESAW.tilt;
  // the start mat and a chalk finish line
  const mat=new THREE.Mesh(new THREE.PlaneGeometry(.42,.32),new THREE.MeshStandardMaterial({map:canvasTex(128,96,(c,w,h)=>{c.fillStyle='#3a8a4a';c.fillRect(0,0,w,h);c.fillStyle='#fff';c.font='700 30px Fredoka, sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText('START',w/2,h/2)}),roughness:.9}));
  mat.rotation.x=-Math.PI/2;mat.position.set(AGI.START.x,.006,AGI.START.z);g.add(mat);
  const fin=new THREE.Mesh(new THREE.PlaneGeometry(.06,.9),new THREE.MeshStandardMaterial({map:canvasTex(16,128,(c,w,h)=>{for(let i=0;i<8;i++){c.fillStyle=i%2?'#222':'#fff';c.fillRect(0,i*16,w,16)}}),roughness:.9}));
  fin.rotation.x=-Math.PI/2;fin.position.set(C[6].x,.006,C[6].z);g.add(fin);
  // the judge by the centre pole, and the scoreboard on the back wall
  const j=M.Human.clone(true);j.traverse(m=>{if(m.isMesh){const n=m.material.name;if(['Shirt','Pants','Hair','HumanSkin'].includes(n)){m.material=m.material.clone();m.material.color.set({Shirt:0x2a4a8a,Pants:0xd8d0c0,Hair:0x9a9088,HumanSkin:0xe8b890}[n])}}});
  j.position.set(.42,0,.32);g.add(j);B.judge=j;B.judgeArm=j.getObjectByName('ArmR');B.cols.push({x:.42,z:.32,r:.3});
  B.board=new THREE.Mesh(new THREE.PlaneGeometry(1.3,.56),new THREE.MeshBasicMaterial({color:0xffffff}));B.board.position.set(-1.25,.95,-AGI.D/2+.06);g.add(B.board);agiBoard(B);
  // the number of the obstacle to run next, floating over it
  B.badges=C.map((c,i)=>new THREE.SpriteMaterial({map:canvasTex(96,96,(g2,w,h)=>{g2.fillStyle=i===6?'#2a2a2a':'#ffd23f';g2.beginPath();g2.arc(48,48,44,0,7);g2.fill();g2.lineWidth=6;g2.strokeStyle='#fff';g2.stroke();g2.fillStyle=i===6?'#fff':'#5a3a10';g2.font='700 52px Fredoka, sans-serif';g2.textAlign='center';g2.textBaseline='middle';g2.fillText(i===6?'🏁':String(i+1),48,52)}),depthTest:false}));
  B.badge=new THREE.Sprite(B.badges[0]);B.badge.scale.setScalar(.2);B.badge.visible=false;B.badge.renderOrder=5;g.add(B.badge);
  B.hemi=new THREE.HemisphereLight(0xfff0e8,0x8a6a40,1.2);g.add(B.hemi);B.sun=new THREE.DirectionalLight(0xffe8e0,1.2);B.sun.position.set(-2,6,3);g.add(B.sun);B.amb=new THREE.AmbientLight(0xffe0d8,.8);g.add(B.amb);   // sunlight glowing through the canvas
  B.lamp=new THREE.PointLight(0xffd8a0,1.2,9,1.2);B.lamp.position.set(0,2.2,0);g.add(B.lamp);
  B.holes=[{x:0,z:AGI.D/2-.35,heading:Math.PI,i:0}];
  b.inside=B}
function agiBoard(B){const best=G.agilityBest;B.board.material.map?.dispose();
  B.board.material.map=canvasTex(512,220,(c,w,h)=>{c.fillStyle='#fff6e0';c.fillRect(0,0,w,h);c.strokeStyle='#c8281e';c.lineWidth=10;c.strokeRect(5,5,w-10,h-10);c.textAlign='center';c.fillStyle='#c8281e';c.font='700 40px Fredoka, sans-serif';c.fillText('🏅 PIGGY AGILITY',w/2,52);
    c.fillStyle='#3a2a1a';c.font='600 30px Fredoka, sans-serif';c.fillText(`🥇 under ${AGI.GOLD} s   🥈 under ${AGI.SILVER} s   🥉 any clear run`,w/2,108);
    c.fillText(best?`Best: ${best.toFixed(1)} s ${ROSETTE[G.rosette].split(' ')[0]}`:'No runs yet. Start on the green mat!',w/2,160);c.font='500 22px Fredoka, sans-serif';c.fillText('knocked bar +5 s · missed weave pole +2 s',w/2,196)});B.board.material.needsUpdate=true}
function agiEnter(B){B.run=null;B.badge.visible=false;
  if(!G.agility){G.agility=1;SFX.find('rare');callout('rare','🏅 The Agility Tent',150);addScore(150,'new place!','#7fd0ff');
    toast(`🏅 <b>The agility tent!</b> A little course in the sawdust: step on the green START mat and press ${kb('E')} to run it. Hoop, weave poles (first pole on your left), tunnel, jump (hop over the bar!), A-frame, seesaw, then the finish line. Fast and clean wins a rosette.`,'gold',11)}
  else toast('🏅 Into the agility tent')}
function agiExit(B){if(B.run){B.run=null;toast('🏅 Run abandoned. The judge sighs.')}B.badge.visible=false;if(B.tunnelMat)B.tunnelMat.opacity=1}
function agiActions(B){const acts=B.run?[]:exitActs(B,'Duck back out under the flap');
  if(!B.run&&Math.hypot(pig.pos.x-AGI.START.x,pig.pos.z-AGI.START.z)<.32)acts.push({k:'E',label:G.agilityRuns?`Start a run (best ${G.agilityBest.toFixed(1)} s)`:'Start a run!',do:()=>agiStart(B)});
  if(B.run&&B.run.t>0)acts.push({k:'E',label:'Give up this run',do:()=>{B.run=null;B.badge.visible=false;toast('🏅 Run stopped. Back to the mat whenever you like.')}});
  return acts}
function agiStart(B){B.run={next:0,t:-1,faults:0,weave:{k:0,miss:0,armed:false},px:pig.pos.x,pz:pig.pos.z};B.bar.position.y=0;B.bar.rotation.set(0,0,0);B.barDown=false;G.acts=null;
  tone('square',1800,1750,.12,.08);toast('🏅 Ready…','',1.2);B.badge.material=B.badges[0];B.badge.visible=true}
function agiHud(B){const r=B.run;if(!r)return null;const c=AGI_COURSE[r.next];
  return {html:r.t<0?'🏅 Ready…':`🏅 ${r.t.toFixed(1)} s${r.faults?` <span style="color:#ff9a7a">+${r.faults} s</span>`:''} · next: ${r.next<6?(r.next+1)+' '+c.name:'🏁 Finish'}`,pct:r.next/AGI_COURSE.length*100}}
function agiUpdate(B,dt,t){const day=clamp(sun.intensity/2.9,0,1);B.hemi.intensity=.7+day*.7;B.sun.intensity=.3+day*1.1;B.amb.intensity=.25+day*.9;B.lamp.intensity=isNight()?2:1;if(B.gapMat)B.gapMat.color.copy(skyMat.uniforms.hor.value).multiplyScalar(.6+day*.8);
  // the seesaw tips over once you're past the middle, and back when you get off
  const onPlank=Math.abs(pig.pos.x-SEESAW.x)<SEESAW.L&&Math.abs(pig.pos.z-SEESAW.z)<.15&&pig.pos.y>.01;
  B.tiltTo=onPlank?(pig.pos.x>SEESAW.x+.04?-SEESAW.tilt:B.tiltTo):SEESAW.tilt;const was=B.tilt;B.tilt+=clamp(B.tiltTo-B.tilt,-dt*1.4,dt*1.4);B.plank.rotation.z=B.tilt;
  if(Math.abs(was-B.tiltTo)>.01&&Math.abs(B.tilt-B.tiltTo)<=.01){tone('triangle',140,90,.12,.25);emit(SEESAW.x+(B.tiltTo<0?.65:-.65),.03,SEESAW.z,10,{col:[.85,.72,.48],spread:.4,up:.6,size:.012,life:.5,grav:3})}
  if(B.barDown&&B.bar.position.y>-.075){B.bar.position.y=Math.max(-.075,B.bar.position.y-dt*.6);B.bar.rotation.x=Math.min(.5,B.bar.rotation.x+dt*3)}
  if(B.tunnelMat)B.tunnelMat.opacity=lerp(B.tunnelMat.opacity,Math.abs(pig.pos.x-1)<.65&&Math.abs(pig.pos.z+1.8)<.2?.4:1,Math.min(1,dt*8));
  // the judge watches you
  const ja=Math.atan2(pig.pos.x-B.judge.position.x,pig.pos.z-B.judge.position.z);B.judge.rotation.y+=angDiff(B.judge.rotation.y,ja)*Math.min(1,dt*3);
  if(B.judgeArm)B.judgeArm.rotation.x=lerp(B.judgeArm.rotation.x,B.cheer>0?-2.4+Math.sin(t*12)*.3:0,Math.min(1,dt*8));B.cheer=Math.max(0,(B.cheer||0)-dt);
  const r=B.run;if(!r)return;
  if(r.t<0){r.t+=dt*1.6;if(r.t>=0){r.t=0;tone('square',2200,2150,.25,.1);toast('🏅 <b>Go!</b>','good',1.2)}r.px=pig.pos.x;r.pz=pig.pos.z;return}
  r.t+=dt;const c=AGI_COURSE[r.next],px=pig.pos.x,pz=pig.pos.z;
  B.badge.position.set(c.x,(c.minY||0)+.5+Math.sin(t*3)*.03,c.z);
  if(c.weave){const w=r.weave;if(!w.armed){if(pz>WEAVE_Z[0]+.05&&Math.abs(px-WEAVE_X)<.6)w.armed=true}
    else while(w.k<6&&pz<WEAVE_Z[w.k]){const lat=px-WEAVE_X,want=w.k%2===0?1:-1;if(Math.abs(lat)>.45||Math.sign(lat)!==want){w.miss++;floaty('missed a pole','#ff9a7a')}else SFX.pop();w.k++}
    if(w.k>=6){if(w.miss<=2){r.faults+=w.miss*2;agiCleared(B,r,w.miss?`+${w.miss*2} s`:'weave!')}else{toast('🏅 <b>Missed the weave!</b> Back to the top and weave in and out: first pole on your left.','bad',4);r.weave={k:0,miss:0,armed:false}}}}
  else{const d0=(r.px-c.x)*c.nx+(r.pz-c.z)*c.nz,d1=(px-c.x)*c.nx+(pz-c.z)*c.nz,lat=Math.abs(-(px-c.x)*c.nz+(pz-c.z)*c.nx);
    if(d0<0&&d1>=0&&lat<c.half){
      if(c.jump){if(pig.pos.y<.07){r.faults+=5;B.barDown=true;tone('triangle',300,180,.2,.2);floaty('knocked the bar! +5 s','#ff9a7a');agiCleared(B,r,'')}else agiCleared(B,r,'clear!')}
      else if(c.minY&&pig.pos.y<c.minY){}   // went past beside it, not over it
      else if(r.next===6)agiFinish(B,r);else agiCleared(B,r,c.name==='Tunnel'?'whoosh!':c.name==='Seesaw'?'wobble!':'nice!')}}
  r.px=px;r.pz=pz}
function agiCleared(B,r,say){r.next++;if(say)floaty(say,'#ffe9a0');SFX.pop();B.cheer=.6;B.badge.material=B.badges[r.next]}
function agiFinish(B,r){const total=r.t+r.faults,rs=total<=AGI.GOLD?3:total<=AGI.SILVER?2:1,newBest=!G.agilityBest||total<G.agilityBest,better=rs>(G.rosette||0);
  B.run=null;B.badge.visible=false;G.agilityRuns=(G.agilityRuns||0)+1;if(newBest)G.agilityBest=+total.toFixed(1);if(better)G.rosette=rs;
  SFX.levelup();setTimeout(()=>SFX.wheek(),300);B.cheer=2;G.happy=Math.min(100,G.happy+15);herdPopcorn();emit(pig.pos.x,pig.pos.y+.2,pig.pos.z,40,{col:[1,.85,.3],spread:1,up:1.6,size:.02,life:1.1,grav:2});
  addScore(40+(better?[0,80,150,300][rs]:0)+(newBest&&G.agilityRuns>1?30:0),'clear round!','#ffd23f');
  if(better)callout(rs===3?'legendary':rs===2?'epic':'rare',`${ROSETTE[rs].split(' ')[0]} ${ROSETTE[rs].split(' ')[1]} rosette`,[0,80,150,300][rs]);
  toast(`🏁 <b>${total.toFixed(1)} s</b>${r.faults?` (${r.t.toFixed(1)} s + ${r.faults} s faults)`:' · a clean run!'} The judge pins on a <b>${ROSETTE[rs]}</b> rosette${better?'. Your best yet!':''}${newBest&&G.agilityRuns>1?' New personal best!':''}${rs<3?` Gold is under ${AGI.GOLD} s: sprint with Shift.`:''}`,'gold',8);agiBoard(B)}
function sniffAgility(B){const r=B.run;if(r){const c=AGI_COURSE[r.next];marker(c.x,.3,c.z,0xffd060,B.group);toast(`👃 Next up: ${r.next<6?(r.next+1)+', the '+c.name.toLowerCase():'the finish line'}!`);return}
  marker(AGI.START.x,.15,AGI.START.z,0x7fd0ff,B.group);toast('👃 Sawdust, canvas and excitement. The green mat is the start.')}

// ---- requests: some humans have lost a little thing, and it turned up down in the warren. Bring it back for a thank-you
const REQUESTS={
  marble:{who:'Maya',zone:'park',ask:'I lost my favourite blue marble down a hole in the woods. If you ever find it…',thanks:'My marble! You clever little thing!',gift:['strawberry','strawberry'],pts:200},
  acorn:{who:'Leo',zone:'park',ask:"I need an acorn cap to make a tiny hat for my toy mouse. Don't laugh.",thanks:'Perfect! Mr. Whiskers will look so smart.',gift:['carrot','pepper'],pts:150},
  button:{who:'Ellie',zone:'town',ask:'I popped a button off my coat chasing a squirrel through the park. It rolled right down a burrow!',thanks:'My button! Here, have some of my lunch.',gift:['romaine','romaine'],pts:150},
  crystal:{who:'Rosa',zone:'town',ask:'A sparkly crystal would look perfect in my shop window. They say there are some deep under the park…',thanks:"It's beautiful! It's going right in the window.",gift:['goldCarrot'],pts:400},
  coin:{who:'Grandpa Joe',zone:'beach',ask:'I dropped my lucky penny in the woods by the park, years ago. Probably long gone…',thanks:'My lucky penny! Well I never.',gift:['watermelon','strawberry'],pts:250},
  shell:{who:'Sunny',zone:'beach',ask:'My sandcastle needs a little snail shell on top, but the sea ones are all too big!',thanks:'The perfect tiny shell! Watermelon for you!',gift:['watermelon','watermelon'],pts:200},
  feather:{who:'Keeper Amy',zone:'zoo',ask:"I'm making a display about wild birds. A jay feather would be just the thing.",thanks:'A jay feather! The kids will love it.',gift:['cornhusk','carrot'],pts:250},
  key:{who:'Farmer Gus',zone:'farm',ask:'I lost the tiny brass key to my seed chest. Fell right down a burrow near the park, it did.',thanks:'My key! Here, the best of the seed chest.',gift:['goldCarrot','apple'],pts:300},
};
function requestOf(h){for(const k in REQUESTS){const r=REQUESTS[k];if(r.who===h.name&&r.zone===Z.id&&!G.given[k])return k}return null}
function hearRequest(h){const k=requestOf(h);if(!k)return;const r=REQUESTS[k],c=CURIOS[k];
  if(G.curios[k]){toast(`🎁 ${h.name}: “${r.ask}” <b>You have the ${c.icon} ${c.name}!</b> Walk up to them and ${G.input==='touch'?'tap Give':'press '+kb('E')} to give it.`,'gold',8);return}
  if(G.heard[k])return;G.heard[k]=1;toast(`🎁 ${h.name}: “${r.ask}”`,'',8);
  if(!G.requestTip){G.requestTip=true;setTimeout(()=>toast('💡 Lost things turn up in the warren under the park. Requests are listed in your journal (J).','',7),2500)}}
function giveCurio(h,k){const r=REQUESTS[k],c=CURIOS[k];G.given[k]=h.name;SFX.purr();setTimeout(()=>SFX.find('rare'),200);
  for(let i=0;i<6;i++)setTimeout(()=>heart(pig.pos.x,pig.pos.y+.18,pig.pos.z),i*120);toast(`🎁 ${h.name}: “${r.thanks}”`,'gold',6);addScore(r.pts,'thank you!','#ff9fd0');
  r.gift.forEach((t,i)=>{const a=pig.heading+(i-(r.gift.length-1)/2)*.7;spawnDrop(t,pig.pos.x+Math.sin(a)*.35,pig.pos.z+Math.cos(a)*.35)});h.petBudget=6;h.cd=0;G.happy=Math.min(100,G.happy+15)}

// ============================================================ predators AI
function isNight(){return G.time>=20.5||G.time<6}
function coverAt(x,z){
  if(G.hidden||G.inTunnel)return 1;
  for(const l of logs){if(inLog(l,x,z))return 1}
  for(const b of bushes){if(Math.hypot(b.x-x,b.z-z)<.55*b.s)return 1}
  if(Z.cover)for(const c of Z.cover){if(Math.hypot(c.x-x,c.z-z)<c.r)return 1}
  if(insideBox(x,z,.4))return .6;
  let c=0;for(const t of trees){const d=Math.hypot(t.x-x,t.z-z);if(d<t.canopy)c=Math.max(c,.65*(1-d/t.canopy)+.3)}
  return Math.min(c,.9);
}
function inLog(l,x,z){const dx=x-l.x,dz=z-l.z;const c=Math.cos(l.rot),s=Math.sin(l.rot);const along=dx*s+dz*c,lat=dx*c-dz*s;return Math.abs(along)<.85&&Math.abs(lat)<.19}
const _hv=new THREE.Vector3();
function updateHawk(dt,t){
  const h=hawk;const o=h.obj;
  if(h.state==='away'){o.visible=false;if(!isNight()&&G.time>7&&!G.under&&!G.inside&&!G.raft)h.t-=dt;if(h.t<=0){h.state='circle';h.t=R(14,20);h.detect=0;h.a=rand()*6;o.visible=true;SFX.screech();toast('🦅 <b>A hawk is circling!</b> Hide under a bush, in a log — or freeze.','bad',4);if(herd.length){const f=herd[0];setTimeout(()=>{SFX.wheek();toast(`🐹 ${esc(f.name)} wheeks an alarm! More eyes in your herd means the hawk spots you slower.`,'',4)},900)}}return}
  if(h.state==='circle'){
    h.a+=dt*.45;const cx=pig.pos.x+Math.cos(h.a)*13,cz=pig.pos.z+Math.sin(h.a)*13,cy=heightAt(pig.pos.x,pig.pos.z)+20;
    _hv.set(cx,cy,cz);h.vel.subVectors(_hv,o.position);o.position.lerp(_hv,Math.min(1,dt*1.5));
    o.lookAt(o.position.x-Math.sin(h.a)*5,o.position.y,o.position.z+Math.cos(h.a)*5);o.rotateZ(-.35);
    const flap=Math.sin(t*3)>.7?Math.sin(t*14)*.5:.08;h.wL.rotation.z=-flap;h.wR.rotation.z=flap;
    const cov=coverAt(pig.pos.x,pig.pos.z);const moving=pig.vel.length()>.3;
    let rate=(moving?(keys.ShiftLeft||keys.ShiftRight?.2:.12):.025)*(1-cov)*G.perk.hawk*(1-herd.length*.07);if(G.wheekT>0)rate+=.05;
    h.detect=clamp(h.detect+rate*dt-(cov>=1?dt*.2:0),0,1);h.t-=dt;
    if(h.detect>=1){h.state='dive';h.from.copy(o.position);h.dt=0;SFX.screech();toast('🦅 <b>THE HAWK IS DIVING! RUN FOR COVER!</b>','bad',2.5)}
    else if(h.t<=0){h.state='leave';h.t=5;if(h.detect<.7){G.hawkDodged++;addScore(60,'evaded hawk','#9fe88a');toast('😮‍💨 The hawk lost interest. Well hidden!','good')}}
    return}
  if(h.state==='dive'){
    h.dt+=dt/1.6;const k=h.dt;if(k<.75)h.aim=pig.pos.clone();const tgt=h.aim.clone();tgt.y+=.15;
    const p=new THREE.Vector3().lerpVectors(h.from,tgt,k*k);o.lookAt(tgt);o.position.copy(p);h.wL.rotation.z=.9;h.wR.rotation.z=-.9;
    if(k>=1){const cov=coverAt(pig.pos.x,pig.pos.z);
      if(cov>=1||pig.pos.distanceTo(tgt)>.6){G.hawkDodged++;toast('💨 The hawk missed! Close call!','good');addScore(80,'close call!','#9fe88a')}
      else{damage(34,'was snatched at by a hawk');const a=pig.heading;pig.vel.set(Math.sin(a)*3,0,Math.cos(a)*3);pig.vy=2}
      h.state='leave';h.t=5}
    return}
  if(h.state==='leave'){h.t-=dt;o.position.y+=dt*6;o.position.x+=dt*8;h.wL.rotation.z=-Math.sin(t*12)*.6;h.wR.rotation.z=Math.sin(t*12)*.6;o.lookAt(o.position.x+8,o.position.y+6,o.position.z);if(h.t<=0){h.state='away';h.t=R(45,85)}}
}
function updateFoxes(dt,t){
  const night=isNight();const want=night?(Z.foxes||(G.day>=3?2:1)):0;
  foxes.forEach((f,i)=>{
    if(i<want&&!f.active){let x,z,tries=0;do{const a=rand()*6.28;x=pig.pos.x+Math.cos(a)*24;z=pig.pos.z+Math.sin(a)*24;tries++}while((forestness(x,z)<.6||Math.hypot(x,z)>EDGE)&&tries<40);
      f.active=true;f.pos.set(x,heightAt(x,z),z);f.obj.visible=true;f.state='wander';f.target.set(x,0,z);f.t=0;if(i===0)toast('🦊 Night falls… something is prowling the woods.','bad',4)}
    if(!f.active)return;
    if(!night){f.state='leave'}
    const dx=pig.pos.x-f.pos.x,dz=pig.pos.z-f.pos.z,d=Math.hypot(dx,dz);
    const hidden=G.hidden||G.inTunnel||logs.some(l=>inLog(l,pig.pos.x,pig.pos.z));const nearHome=!!Z.home&&Math.hypot(pig.pos.x-Z.home.x,pig.pos.z-Z.home.z)<11;
    let speed=1.1;f.cool-=dt;
    if(f.state==='wander'){f.t-=dt;if(f.t<=0||Math.hypot(f.target.x-f.pos.x,f.target.z-f.pos.z)<.5){const a=rand()*6.28;f.target.set(pig.pos.x+Math.cos(a)*R(6,16),0,pig.pos.z+Math.sin(a)*R(6,16));f.t=R(4,8)}
      if(d<11&&!hidden&&!nearHome&&f.cool<=0){f.state='chase';SFX.yip();toast('🦊 <b>A fox spotted you! Scurry to a tunnel or log!</b>','bad',3)}}
    else if(f.state==='chase'){f.target.set(pig.pos.x,0,pig.pos.z);speed=keys.ShiftLeft||keys.ShiftRight?2.9:3.1;if(hidden||nearHome||d>22){f.state='wander';f.cool=4;G.foxEscapes++;toast(hidden?'🦊 The fox lost your scent. Phew!':'🦊 The fox gave up.','good');addScore(70,'escaped!','#9fe88a')}
      if(d<.32&&!pig.air){damage(28,'was caught by a fox');if(herd.length)scatterFriend(herd[herd.length-1]);pig.vel.set(dx/d*3.5,0,dz/d*3.5);pig.vy=1.8;f.state='wander';f.cool=7;const a=rand()*6.28;f.target.set(f.pos.x-dx/d*12,0,f.pos.z-dz/d*12)}}
    else if(f.state==='leave'){f.target.set(f.pos.x+(f.pos.x-pig.pos.x),0,f.pos.z+(f.pos.z-pig.pos.z));speed=2;if(d>30){f.active=false;f.obj.visible=false;return}}
    const tx=f.target.x-f.pos.x,tz=f.target.z-f.pos.z,tl=Math.hypot(tx,tz)||1;
    const wantH=Math.atan2(tx,tz);f.heading+=angDiff(f.heading,wantH)*Math.min(1,dt*5);
    f.pos.x+=Math.sin(f.heading)*speed*dt;f.pos.z+=Math.cos(f.heading)*speed*dt;
    for(const c of colliders){const cx=f.pos.x-c.x,cz=f.pos.z-c.z,cd=Math.hypot(cx,cz);if(cd<c.r+.2&&cd>0){f.pos.x=c.x+cx/cd*(c.r+.2);f.pos.z=c.z+cz/cd*(c.r+.2)}}
    f.pos.y=heightAt(f.pos.x,f.pos.z);f.obj.position.copy(f.pos);f.obj.rotation.y=f.heading;
    f.phase+=dt*speed*5.5;const sw=Math.sin(f.phase)*.5;f.legs[0].rotation.x=sw;f.legs[3].rotation.x=sw;f.legs[1].rotation.x=-sw;f.legs[2].rotation.x=-sw;
    f.tail.rotation.y=Math.sin(t*2)*.25;f.obj.position.y+=Math.abs(Math.sin(f.phase))*.03;
  });
}

function damage(n,cause){G.hp=Math.max(0,G.hp-n);G.cause=cause;hurtFx();SFX.hurt();toast(`💥 Ouch! −${n} ❤️`,'bad')}
function hurtFx(){const h=$('hurt');h.style.transition='none';h.style.opacity=SET.flashes?1:.35;requestAnimationFrame(()=>{h.style.transition='opacity 1.2s';h.style.opacity=0})}


// ============================================================ other guinea pigs (herd)
const HERD_MAX=6;const friends=[];const herd=[];const trail=[];let blobMat=null;
// guinea pigs who live out in the other zones, after the park's nine: [zone, name, breed, coat, shy]
const ZONE_PIGS=[['peaks','Snowball','peruvian','himalayan',1],['deepwood','Thistle','abyssinian','agouti',0],['deepwood','Fennel','american','agouti',1],['town','Pretzel','american','tricolor',0],
  ['beach','Sandy','peruvian','golden',0],['creek','Pebble','abyssinian','dutch',0],['creek','Willow','skinny','dalmatian',1],['zoo','Cocoa','skinny','choc',0],
  ['farm','Barley','american','golden',0],['farm','Turnip','abyssinian','tricolor',1],['sunflowers','Marigold','peruvian','tricolor',1],['sunflowers','Honey','abyssinian','golden',0]];
function buildFriends(){
  const pool=PIG_NAMES.filter(n=>n!==G.name);const bk=Object.keys(BREEDS);
  const place=(n,test)=>{for(let k=0,tries=0;k<n&&tries<4000;tries++){const a=rand()*6.28,rr=R(6,EDGE-4);const x=Math.cos(a)*rr,z=Math.sin(a)*rr;
    if(!test(x,z)||insideBox(x,z,.8)||distToPath(x,z)<.8)continue;if(colliders.some(c=>Math.hypot(c.x-x,c.z-z)<c.r+.5))continue;
    if(friends.some(f=>Math.hypot(f.home.x-x,f.home.z-z)<10)||Math.hypot(x-pig.pos.x,z-pig.pos.z)<7)continue;addFriend(x,z);k++}};
  function addFriend(x,z){const breed=bk[Math.floor(rand()*bk.length)];const coats=BREEDS[breed].coats;
    const look={breed,coat:coats[Math.floor(rand()*coats.length)]};const name=pool.splice(Math.floor(rand()*pool.length),1)[0];
    const m=makePigModel(look,.6);const sc=R(.84,.98);m.obj.scale.multiplyScalar(sc);scene.add(m.obj);
    if(!blobMat)blobMat=new THREE.MeshBasicMaterial({map:blobTex,transparent:true,depthWrite:false});
    const blob=new THREE.Mesh(new THREE.PlaneGeometry(.34*sc,.4*sc),blobMat);blob.rotation.x=-Math.PI/2;scene.add(blob);
    const tag=document.createElement('div');tag.className='ntag';document.body.appendChild(tag);
    friends.push({zone:'park',origin:'park',placed:true,name,look,shy:rand()<.35,...m,blob,tag,pos:new THREE.Vector3(x,heightAt(x,z),z),vel:new THREE.Vector3(),heading:rand()*6.28,phase:0,seed:rand()*50,
      state:'wild',home:{x,z},target:{x,z},act:'idle',actT:R(1,4),friend:0,eating:0,vy:0,air:false,popSpin:0,spookT:0,chatT:0,t:0,known:false,lastD:99})}
  place(4,(x,z)=>forestness(x,z)<.45&&Math.hypot(x,z+3)<24);
  place(5,(x,z)=>forestness(x,z)>.65);
  // the zones' own guinea pigs: their own random sequence, so the park's layout (and the warren built after this) stays put
  const zr=mulberry32(4242);
  for(const [zone,name,breed,coat,shy] of ZONE_PIGS){const look={breed,coat},m=makePigModel(look,.6),sc=.84+zr()*.14;m.obj.scale.multiplyScalar(sc);m.obj.visible=false;scene.add(m.obj);
    const blob=new THREE.Mesh(new THREE.PlaneGeometry(.34*sc,.4*sc),blobMat);blob.rotation.x=-Math.PI/2;blob.visible=false;scene.add(blob);
    const tag=document.createElement('div');tag.className='ntag';document.body.appendChild(tag);
    friends.push({zone,origin:zone,placed:false,name,look,shy:!!shy,...m,blob,tag,pos:new THREE.Vector3(0,-50,0),vel:new THREE.Vector3(),heading:zr()*6.28,phase:0,seed:zr()*50,
      state:'wild',home:{x:0,z:0},target:{x:0,z:0},act:'idle',actT:1+zr()*3,friend:0,eating:0,vy:0,air:false,popSpin:0,spookT:0,chatT:0,t:0,known:false,lastD:99})}
  // Butterscotch lives in the pet shop's pen (her own zone, so she never shows up outside until she joins you)
  {const look={breed:'abyssinian',coat:'golden'},m=makePigModel(look,.6);m.obj.scale.multiplyScalar(.86);m.obj.visible=false;scene.add(m.obj);
    const blob=new THREE.Mesh(new THREE.PlaneGeometry(.3,.35),blobMat);blob.rotation.x=-Math.PI/2;blob.visible=false;scene.add(blob);const tag=document.createElement('div');tag.className='ntag';document.body.appendChild(tag);
    friends.push({zone:'petshop',origin:'town',placed:true,shopPig:true,name:'Butterscotch',look,shy:true,...m,blob,tag,pos:new THREE.Vector3(-2.1,0,-1.8),vel:new THREE.Vector3(),heading:0,phase:0,seed:7,
      state:'wild',home:{x:-2.1,z:-1.8},target:{x:-2.1,z:-1.8},act:'idle',actT:2,friend:0,eating:0,vy:0,air:false,popSpin:0,spookT:0,chatT:0,t:0,known:true,lastD:99})}
}
// the first time a zone is built, its guinea pigs settle somewhere open and dry, well apart (from a sequence of their own)
function placeZoneFriends(z){const zr=mulberry32(z.seed+202);
  for(const f of friends){if(f.origin!==z.id||f.placed)continue;f.placed=true;if(f.state==='herd')continue;
    for(let t=0;t<4000;t++){const a=zr()*Math.PI*2,rr=12+Math.sqrt(zr())*(EDGE-20),x=Math.cos(a)*rr,zz=Math.sin(a)*rr;
      if(!freeAt(x,zz,.8)||wet(x,zz,.25)||insideBox(x,zz,1.2)||distToPath(x,zz)<1.5||tunnels.some(t=>Math.hypot(t.x-x,t.z-zz)<4)||spots.some(s=>Math.hypot(s.x-x,s.z-zz)<1.2)||
        friends.some(o=>o!==f&&o.origin===z.id&&o.placed&&o.state!=='herd'&&Math.hypot(o.home.x-x,o.home.z-zz)<16))continue;
      f.home={x,z:zz};f.target={x,z:zz};f.pos.set(x,heightAt(x,zz),zz);break}}}
function nearestWild(maxd){let best=null,bd=maxd;for(const f of friends){if(f.state!=='wild'||f.spookT>0||f.zone!==Z.id)continue;const d=Math.hypot(f.pos.x-pig.pos.x,f.pos.z-pig.pos.z);if(d<bd){bd=d;best=f}}return best}
function joinHerd(f){
  f.state='herd';f.friend=1;herd.push(f);f.tag.style.display='none';const fi=friends.indexOf(f),first=!G.pals.includes(fi);if(first)G.pals.push(fi);
  SFX.wheek();setTimeout(()=>SFX.purr(),350);for(let i=0;i<6;i++)setTimeout(()=>heart(f.pos.x,f.pos.y+.16,f.pos.z),i*120);
  G.happy=Math.min(100,G.happy+20);if(first)addScore(150,'new friend!','#ff9fd0');
  toast(first?`🐹 <b>${esc(f.name)}</b> the ${BREEDS[f.look.breed].name} joined your herd! (${herd.length}/${HERD_MAX})`:`🐹 <b>${esc(f.name)}</b> is back in your herd! (${herd.length}/${HERD_MAX})`,'gold',5);
  if(herd.length===1)setTimeout(()=>toast('💡 Your herd follows you everywhere. Stand still together to huddle for happiness &amp; energy.','',7),1800);
  if(herd.length===HERD_MAX&&!G.fullHerd){G.fullHerd=1;toast('🏆 <b>A full herd!</b> Six best friends. +500','gold',6);addScore(500,'full herd!','#ffd23f');flash('rgba(255,160,210,.45)',.6)}
}
// ---- a full herd: someone heads home to make room for a new friend
const homeZone=o=>o.shopPig?'petshop':o.origin;
function offerSwap(f){G.modal=true;G.swapFor=f;f.friend=.9;$('befriend').style.display='none';
  $('swapTitle').innerHTML=`🐹 <b>${esc(f.name)}</b> wants to join!`;
  $('swapList').innerHTML=herd.map((o,i)=>{const z=ZONE[homeZone(o)]||ZONE.town;return `<button class="btn alt" data-i="${i}">👋 ${esc(o.name)}<span>${BREEDS[o.look.breed].name} ${COATS[o.look.coat].name} · heads home to ${z.icon} ${o.shopPig?'the pet shop':z.name}</span></button>`}).join('')+'<button class="btn" data-i="-1">Not now</button>';
  $('swapList').querySelectorAll('button').forEach(b=>b.onclick=()=>{const i=+b.dataset.i;if(i<0)return closeSwap();const o=herd[i];closeSwap();farewell(o);if(f.shopPig&&G.inside&&G.inside.kind==='shop')shopPigJoin(f);else joinHerd(f)});
  $('swapMenu').classList.remove('hidden')}
function closeSwap(){G.modal=false;G.swapFor=null;$('swapMenu').classList.add('hidden')}
function farewell(o){herd.splice(herd.indexOf(o),1);o.state='wild';o.friend=.6;o.spookT=0;o.tag.style.display='none';o.air=false;o.vy=0;
  const hz=homeZone(o);o.zone=hz;swapScene(o.obj,scene);o.blob.visible=false;
  if(hz==='petshop'&&G.inside&&G.inside.kind==='shop'){swapScene(o.obj,G.inside.group);o.obj.visible=true;o.pos.set(-2.1,0,-1.8)}
  else if(hz===Z.id&&!G.inside&&!G.under){o.act='walk';o.target={x:o.home.x,z:o.home.z};o.actT=12;o.obj.visible=true}   // home's here: off she trots
  else{o.obj.visible=false;o.pos.set(o.home.x,0,o.home.z)}
  const z=ZONE[hz]||ZONE.town;SFX.chut();heart(pig.pos.x,pig.pos.y+.18,pig.pos.z);
  toast(`👋 <b>${esc(o.name)}</b> gives you a nuzzle and heads home to ${hz==='petshop'?'the pet shop':z.icon+' '+z.name}. Visit any time.`,'',6)}
function scatterFriend(f){
  herd.splice(herd.indexOf(f),1);f.state='scatter';f.t=4;f.friend=0;f.zone=Z.id;
  toast(`😱 <b>${esc(f.name)}</b> scattered in fright! Find them and befriend them again.`,'bad',5);
}
function regroupHerd(){
  trail.length=0;const bx=-Math.sin(pig.heading),bz=-Math.cos(pig.heading);
  for(let i=0;i<=(HERD_MAX+1)*6;i++)trail.push({x:pig.pos.x+bx*i*.06,z:pig.pos.z+bz*i*.06});
  herd.forEach((f,i)=>{const p=trail[Math.min(trail.length-1,(i+1)*6)];f.pos.set(p.x,heightAt(p.x,p.z),p.z);f.heading=pig.heading;f.vel.set(0,0,0)});
}
function spawnDrop(type,x,z){
  const it=ITEMS[type];const o=M[it.model].clone(true);
  if(it.gold||it.tint)o.traverse(m=>{if(m.isMesh){m.material=m.material.clone();if(it.gold){m.material.color.set(0xffd54a);m.material.emissive=new THREE.Color(0xffa800);m.material.emissiveIntensity=.5}else if(m.material.name==='Veg')m.material.color.set(it.tint)}});
  o.scale.setScalar(ITEM_SCALE[it.model]||1.3);const to=new THREE.Vector3(x,heightAt(x,z),z);o.position.copy(to);o.rotation.y=rand()*6;ZG.add(o);
  drops.push({obj:o,type,from:to.clone(),to,t:1,landed:true,x,z,life:60});
}
function herdGift(f){
  const type=pick({dandelion:26,clover:26,violet:10,berries:14,strawberry:11,carrot:8,pepper:5,clover4:1.5});const it=ITEMS[type];
  const x=f.pos.x+Math.sin(f.heading)*.14,z=f.pos.z+Math.cos(f.heading)*.14;spawnDrop(type,x,z);
  SFX.find(it.rarity);marker(x,heightAt(x,z)+.1,z,0xff9fd0);emit(x,heightAt(x,z)+.05,z,10,{col:[1,.7,.85],spread:.4,up:.8,size:.014,life:.7});
  toast(`🐹 <b>${esc(f.name)}</b> found ${it.icon} <b style="color:${RARITY[it.rarity][0]}">${it.name}</b> and saved it for you!`,'good',4);
}
function herdPopcorn(){herd.forEach((f,i)=>setTimeout(()=>{if(!f.air&&f.state==='herd'){f.vy=1.4;f.air=true;emit(f.pos.x,f.pos.y+.1,f.pos.z,6,{col:[1,.8,.9],spread:.4,up:.7,size:.012,life:.5})}},120+i*140));
  if(herd.length)addScore(8*herd.length,'herd popcorn!','#ffb0e0')}
const _fv=new THREE.Vector3();
function updateFriends(dt,t){
  const last=trail[0];if(!last||Math.hypot(pig.pos.x-last.x,pig.pos.z-last.z)>.06){trail.unshift({x:pig.pos.x,z:pig.pos.z});if(trail.length>(HERD_MAX+1)*6+4)trail.pop()}
  const pSpeed=Math.hypot(pig.vel.x,pig.vel.z),sprinting=pSpeed>2.2;
  const ct=G.started&&keys.KeyC&&!pig.air?nearestWild(1.3):null;
  const bf=$('befriend');
  if(ct){bf.style.display='block';bf.querySelector('.l').textContent=`Chatting with ${ct.name}…`;bf.querySelector('i').style.width=(ct.friend*100)+'%'}else bf.style.display='none';
  if(herd.length&&G.started&&!isNight()){G.giftT-=dt;if(G.giftT<=0){G.giftT=R(45,75);const f=herd[Math.floor(rand()*herd.length)];if(Math.hypot(f.pos.x-pig.pos.x,f.pos.z-pig.pos.z)<4)herdGift(f)}}
  for(const f of friends){
    if(f.state!=='herd'&&f.zone!==Z.id){if(f.obj.visible){f.obj.visible=false;f.blob.visible=false;f.tag.style.display='none'}continue}   // lives in another zone
    const dx=pig.pos.x-f.pos.x,dz=pig.pos.z-f.pos.z,d=Math.hypot(dx,dz)||1e-4;f.lastD=d;
    let tx=f.pos.x,tz=f.pos.z,speed=0,face=null;f.spookT-=dt;
    if(f.state==='wild'){
      if(d<14)f.known=true;
      if(G.started&&sprinting&&d<(f.shy?5:2.6)&&f.spookT<=0){f.spookT=3;f.friend=Math.max(0,f.friend-.35);SFX.pop();floaty('eek!','#ffd0e8',_fv.set(f.pos.x,f.pos.y+.22,f.pos.z).clone());
        if(!G.spookTip){G.spookTip=true;toast(`😳 ${esc(f.name)} got spooked! Walk up gently (no sprinting), then hold ${kb('C','the Chat button')} to chat.`,'',6)}}
      if(f.spookT>0){tx=f.pos.x-dx/d*2;tz=f.pos.z-dz/d*2;speed=2.3}
      else if(f===ct){face=Math.atan2(dx,dz);if(pSpeed<.3)pig.heading+=angDiff(pig.heading,Math.atan2(-dx,-dz))*Math.min(1,dt*6);f.friend+=dt/((f.shy?5.5:3.2)/G.perk.social*(1+herd.length*.12));f.chatT-=dt;
        if(f.chatT<=0){f.chatT=.5;SFX.chut();heart(f.pos.x,f.pos.y+.17,f.pos.z);if(rand()<.4){pig.eating=.2}}
        if(f.friend>=1){if(herd.length>=HERD_MAX)offerSwap(f);else joinHerd(f)}}
      else{
        f.friend=Math.max(0,f.friend-dt*.03);f.actT-=dt;
        if(f.actT<=0){const r=rand();if(r<.45){f.act='nibble';f.actT=R(2,5)}else if(r<.92){f.act='walk';const a=rand()*6.28,rr=R(.4,2.4);f.target={x:f.home.x+Math.cos(a)*rr,z:f.home.z+Math.sin(a)*rr};f.actT=R(3,6)}else{f.act='idle';f.actT=R(1,2);if(!f.air&&!isNight()){f.vy=1.3;f.air=true}}}
        if(f.act==='walk'){tx=f.target.x;tz=f.target.z;speed=.65}else if(f.act==='nibble')f.eating=.3;
        if(d<2.2&&f.act!=='walk')face=Math.atan2(dx,dz); // curious
      }
    }else if(f.state==='herd'&&G.raft){f.act='nibble';f.eating=.3;   // waiting on the bank while you ride
    }else if(f.state==='herd'){
      const i=herd.indexOf(f);const tp=trail[Math.min(trail.length-1,(i+1)*6)]||pig.pos;
      if(d>12){f.pos.set(tp.x,heightAt(tp.x,tp.z),tp.z)}
      tx=tp.x;tz=tp.z;const td=Math.hypot(tx-f.pos.x,tz-f.pos.z);
      if(td>.07)speed=Math.min(3.8,td*4+.4);else{f.actT-=dt;if(f.actT<=0){f.actT=R(2,5);f.act=rand()<.5?'nibble':'idle'}if(f.act==='nibble')f.eating=.3;if(d<1.5)face=Math.atan2(dx,dz)}
    }else if(f.state==='scatter'){
      f.t-=dt;tx=f.pos.x-dx/d*3;tz=f.pos.z-dz/d*3;speed=2.8;
      if(f.t<=0){f.state='wild';f.home={x:f.pos.x,z:f.pos.z};f.act='idle';f.actT=2}
    }
    // steer
    if(speed>0){const hx=tx-f.pos.x,hz=tz-f.pos.z,hl=Math.hypot(hx,hz);
      if(hl>.03){f.heading+=angDiff(f.heading,Math.atan2(hx,hz))*Math.min(1,dt*8);const s=Math.min(speed,hl/Math.max(dt,1e-3));f.vel.set(Math.sin(f.heading)*s,0,Math.cos(f.heading)*s)}else f.vel.set(0,0,0)}
    else{f.vel.multiplyScalar(Math.max(0,1-dt*10));if(face!==null)f.heading+=angDiff(f.heading,face)*Math.min(1,dt*4)}
    {const ox=f.pos.x,oz=f.pos.z;f.pos.x+=f.vel.x*dt;f.pos.z+=f.vel.z*dt;if(f.state!=='herd'&&Z.waterY!==undefined&&Z.waterY-heightAt(f.pos.x,f.pos.z)>.05){f.pos.x=ox;f.pos.z=oz;f.actT=0}}
    // personal space
    if(d<.22){f.pos.x-=dx/d*(.22-d);f.pos.z-=dz/d*(.22-d)}
    for(const o of friends){if(o===f)continue;const ox=f.pos.x-o.pos.x,oz=f.pos.z-o.pos.z,od=Math.hypot(ox,oz);if(od<.2&&od>1e-4){f.pos.x+=ox/od*(.2-od)*.5;f.pos.z+=oz/od*(.2-od)*.5}}
    collide(f.pos,.09);
    const gy=heightAt(f.pos.x,f.pos.z);
    if(f.air||f.vy>0){f.vy-=9.8*dt;f.pos.y+=f.vy*dt;f.popSpin+=dt*14;if(f.pos.y<=gy){f.pos.y=gy;f.vy=0;f.air=false;f.popSpin=0}}else f.pos.y=gy;
    // visibility & pose
    const vis=d<48||f.state==='herd';f.obj.visible=vis;f.blob.visible=vis&&!G.inTunnel;if(!vis){f.tag.style.display='none';continue}
    const showFur=d<24;f.fur.forEach((s,i)=>s.visible=showFur&&i%FUR_STEP()===0);
    const moving=Math.hypot(f.vel.x,f.vel.z)>.1;const o=f.obj;
    const hf=heightAt(f.pos.x+Math.sin(f.heading)*.12,f.pos.z+Math.cos(f.heading)*.12),hb=heightAt(f.pos.x-Math.sin(f.heading)*.12,f.pos.z-Math.cos(f.heading)*.12);
    const bob=moving&&!f.air?Math.abs(Math.sin(f.phase))*.008:Math.sin(t*2.2+f.seed)*.0015;
    f.eating=Math.max(0,f.eating-dt);const dip=f.eating>0?.16+Math.sin(t*18+f.seed)*.03:0;
    o.position.set(f.pos.x,f.pos.y+bob,f.pos.z);
    o.rotation.set(Math.atan2(hb-hf,.24)+dip-(f.air?.25:0),f.heading+(f.air?Math.sin(f.popSpin)*.6:0),f.air?Math.sin(f.popSpin*1.3)*.4:0,'YXZ');
    const br=1+Math.sin(t*3.5+f.seed)*.012;f.parts.Body.scale.set(br,1+Math.sin(t*3.5+f.seed)*.01,1);
    if(f.parts.Nose){const tw=Math.sin(t*(f.eating>0?30:9)+f.seed)>.3?1.12:1;f.parts.Nose.scale.set(tw,tw,1)}
    animatePigLegs(dt,Math.hypot(f.vel.x,f.vel.z),moving&&!f.air,f);
    f.blob.position.set(f.pos.x,gy+.004,f.pos.z);f.blob.rotation.z=-f.heading;
    // name tag
    const showTag=G.started&&!G.inTunnel&&(f.state==='wild'&&d<6||f.state==='herd'&&d<2.5&&G.huddle);
    if(showTag){_fv.set(f.pos.x,f.pos.y+.24,f.pos.z).project(camera);if(_fv.z>1){f.tag.style.display='none'}else{
      f.tag.style.display='block';f.tag.style.left=((_fv.x*.5+.5)*innerWidth)+'px';f.tag.style.top=((-_fv.y*.5+.5)*innerHeight)+'px';
      const html=f.state==='herd'?`${esc(f.name)} <i>♥</i>`:`${esc(f.name)}${f.shy?' · shy':''} <i>${'♥'.repeat(Math.floor(f.friend*5))}${'♡'.repeat(5-Math.floor(f.friend*5))}</i>`;if(f.tag._h!==html){f.tag.innerHTML=html;f.tag._h=html}}}
    else f.tag.style.display='none';
  }
}

// ============================================================ player update
function animatePigLegs(dt,speed,moving,who=pig){
  const P=who.parts;who.phase+=dt*(moving?speed*11+6:0);
  const s=moving?Math.sin(who.phase):0,c=moving?Math.cos(who.phase):0;
  const f=(n,off,amp)=>{const p=P[n];if(!p)return;p.position.z=p.userData.base.z+off*amp;p.position.y=p.userData.base.y+Math.max(0,-off)*amp*.5};
  f('FootFL',s,.012);f('FootBR',s,.012);f('FootFR',-s,.012);f('FootBL',-s,.012);
  const flop=moving?Math.sin(who.phase*2)*.18:Math.sin(performance.now()/900+(who.seed||0))*.04;
  if(P.EarL){P.EarL.rotation.z=P.EarL.userData.rot.z-flop;P.EarR.rotation.z=P.EarR.userData.rot.z+flop}
}
function collide(P,pr){
  for(const c of colliders){const dx=P.x-c.x,dz=P.z-c.z;if(Math.abs(dx)>c.r+pr||Math.abs(dz)>c.r+pr)continue;const d=Math.hypot(dx,dz);if(d<c.r+pr&&d>1e-5){P.x=c.x+dx/d*(c.r+pr);P.z=c.z+dz/d*(c.r+pr)}}
  for(const b of boxes){const qx=clamp(P.x,b.cx-b.hx,b.cx+b.hx),qz=clamp(P.z,b.cz-b.hz,b.cz+b.hz);const dx=P.x-qx,dz=P.z-qz,d=Math.hypot(dx,dz);
    if(d<pr){if(d>1e-5){P.x=qx+dx/d*pr;P.z=qz+dz/d*pr}else{const ox=b.hx-Math.abs(P.x-b.cx),oz=b.hz-Math.abs(P.z-b.cz);if(ox<oz)P.x=b.cx+Math.sign(P.x-b.cx)*(b.hx+pr);else P.z=b.cz+Math.sign(P.z-b.cz)*(b.hz+pr)}}}
  for(const l of logs){const dx=P.x-l.x,dz=P.z-l.z;const c=Math.cos(l.rot),s=Math.sin(l.rot);const along=dx*s+dz*c;let lat=dx*c-dz*s;
    if(Math.abs(along)<.86&&Math.abs(lat)>.13&&Math.abs(lat)<.33){lat=Math.abs(lat)>.23?Math.sign(lat)*.33:Math.sign(lat)*.13;P.x=l.x+s*along+c*lat;P.z=l.z+c*along-s*lat}}
  const dc=Math.hypot(P.x,P.z);if(dc>EDGE){P.x*=EDGE/dc;P.z*=EDGE/dc}
}
function updatePig(dt,t){
  const P=pig.parts;
  // input
  let ix=0,iz=0;if(keys.KeyW||keys.ArrowUp)iz+=1;if(keys.KeyS||keys.ArrowDown)iz-=1;if(keys.KeyA||keys.ArrowLeft)ix-=1;if(keys.KeyD||keys.ArrowRight)ix+=1;
  if(joy.active){ix=joy.x;iz=-joy.y}else if(pad.on){ix=pad.x;iz=-pad.y}
  if(G.gnaw){ix=iz=0}
  const busy=forageState||pig.eating>.25;
  let len=Math.hypot(ix,iz);if(len>1){ix/=len;iz/=len;len=1}
  const yaw=G.camYaw;const fx=-Math.sin(yaw),fz=-Math.cos(yaw),rx=Math.cos(yaw),rz=-Math.sin(yaw);
  let mx=fx*iz+rx*ix,mz=fz*iz+rz*ix;
  const sprint=(keys.ShiftLeft||keys.ShiftRight)&&G.energy>12&&len>0;
  let sp=(sprint?3.1:1.45)*G.perk.speed;if(G.energy<12)sp*=.7;if(G.full<8)sp*=.85;if(busy&&!pig.air)sp*=.15;if(G.wade&&!G.under&&!G.inside)sp*=.55;
  const ice=!G.under&&!G.inside&&Z.ice&&Z.ice(pig.pos.x,pig.pos.z);const tx=mx*sp,tz=mz*sp;const acc=pig.air?2:ice?1.1:12;
  pig.vel.x=lerp(pig.vel.x,tx,Math.min(1,dt*acc));pig.vel.z=lerp(pig.vel.z,tz,Math.min(1,dt*acc));
  if(len>.1){const h=Math.atan2(mx,mz);pig.heading+=angDiff(pig.heading,h)*Math.min(1,dt*10);
    if(!G.drag&&performance.now()-G.lastDrag>1500&&iz>=0)G.camYaw+=angDiff(G.camYaw,pig.heading+Math.PI)*Math.min(1,dt*1.2)}
  if(sprint)G.energy=Math.max(0,G.energy-dt*5.5*G.perk.sprintCost);
  const ox=pig.pos.x,oz=pig.pos.z;pig.pos.x+=pig.vel.x*dt;pig.pos.z+=pig.vel.z*dt;
  // collisions
  const gh=G.under?()=>0:G.inside?insideHeight:heightAt;
  if(G.under)warrenCollide(pig.pos,.1);else if(G.inside)insideCollide(pig.pos,.1);else{collide(pig.pos,.1);waterStep(ox,oz);edgeStep(dt)}
  // vertical
  const gy=gh(pig.pos.x,pig.pos.z);
  if(pig.air||pig.vy>0){pig.vy-=9.8*dt;pig.pos.y+=pig.vy*dt;if(pig.pos.y<=gy){pig.pos.y=gy;pig.vy=0;pig.air=false;pig.popSpin=0}else pig.air=true}else pig.pos.y=gy;
  // pose
  const o=pig.obj;const moving=Math.hypot(pig.vel.x,pig.vel.z)>.12;
  const hf=gh(pig.pos.x+Math.sin(pig.heading)*.12,pig.pos.z+Math.cos(pig.heading)*.12),hb=gh(pig.pos.x-Math.sin(pig.heading)*.12,pig.pos.z-Math.cos(pig.heading)*.12);
  const pitch=Math.atan2(hb-hf,.24);
  const bob=moving&&!pig.air?Math.abs(Math.sin(pig.phase))*.008:Math.sin(t*2.2)*.0015;
  o.position.set(pig.pos.x,pig.pos.y+bob,pig.pos.z);
  pig.eating=Math.max(0,pig.eating-dt);pig.foraging=Math.max(0,pig.foraging-dt);
  let dip=pig.eating>0?.16+Math.sin(t*20)*.03:0;
  let wig=pig.foraging>0?Math.sin(t*28)*.12:0;
  if(pig.air)pig.popSpin+=dt*14;
  o.rotation.set(pitch+dip-(pig.air?.25:0),pig.heading+wig+(pig.air?Math.sin(pig.popSpin)*.6:0),pig.air?Math.sin(pig.popSpin*1.3)*.4:0,'YXZ');
  const breathe=1+Math.sin(t*3.5)*.012;P.Body.scale.set(breathe,1+Math.sin(t*3.5)*.01,1);
  if(P.Nose){const tw=Math.sin(t*(pig.eating>0?30:9))>.3?1.12:1;P.Nose.scale.set(tw,tw,1)}
  animatePigLegs(dt,Math.hypot(pig.vel.x,pig.vel.z),moving&&!pig.air);
  pig.blob.position.set(pig.pos.x,gy+.004,pig.pos.z);pig.blob.rotation.z=-pig.heading;pig.blob.material.opacity=pig.air?.5:1;
  U.player.value.copy(pig.pos);
  if(moving&&!pig.air&&sprint&&rand()<.3)emit(pig.pos.x-Math.sin(pig.heading)*.14,gy+.01,pig.pos.z-Math.cos(pig.heading)*.14,1,{col:[.45,.38,.25],spread:.2,up:.3,size:.01,life:.4})
}

// deep water stops you (slide along the bank); shallow water slows you down
function waterStep(ox,oz){G.wade=false;if(Z.waterY===undefined)return;const deep=(x,z)=>Z.waterY-heightAt(x,z)>.07;
  if(deep(pig.pos.x,pig.pos.z)){if(!deep(pig.pos.x,oz))pig.pos.z=oz;else if(!deep(ox,pig.pos.z))pig.pos.x=ox;else{pig.pos.x=ox;pig.pos.z=oz}
    if(!G.deepTip){G.deepTip=true;toast('💦 Too deep! Guinea pigs can wade the shallows, but they are not swimmers.')}}
  G.wade=Z.waterY-heightAt(pig.pos.x,pig.pos.z)>0;
  if(G.wade&&Math.hypot(pig.vel.x,pig.vel.z)>.3&&rand()<.3)emit(pig.pos.x,Z.waterY+.01,pig.pos.z,2,{col:[.85,.93,1],spread:.35,up:.5,size:.012,life:.45})}
// walk off the rim into the next zone (push outward for a moment so it never happens by accident)
function edgeStep(dt){const r=Math.hypot(pig.pos.x,pig.pos.z),out=(pig.vel.x*pig.pos.x+pig.vel.z*pig.pos.z)/(r||1);
  if(r>EDGE-.3&&out>.2&&!pig.air&&G.started){const nb=neighbour(Z,sectorAt(pig.pos.x,pig.pos.z));
    if(nb){G.exitT=(G.exitT||0)+dt;if(G.exitT>.25)leaveZone(nb)}else if(!G.edgeTip){G.edgeTip=true;toast(Z.edgeMsg||'🌲 That is as far as a little guinea pig should go this way.')}}
  else if(r<EDGE-1.5){G.exitT=0;G.edgeTip=false}}
function leaveZone(nb){if(G.zoning)return;G.zoning=true;G.exitT=0;const from=Z,a=Math.atan2(pig.pos.z,pig.pos.x),zc=$('zonecard');
  zc.querySelector('.a').innerHTML=`Leaving ${from.icon} <b>${from.name}</b>`;zc.querySelector('.b').innerHTML=`Entering ${nb.icon} <b>${nb.name}</b>`;zc.classList.add('on');
  G.modal=true;SFX.whoosh();forageState=null;$('forage').style.display='none';
  setTimeout(()=>{arriveZone(nb,a+Math.PI);G.modal=false;setTimeout(()=>{zc.classList.remove('on');G.zoning=false},900)},550)}
// show a zone and put the pig in it: on the rim at angle ang (walking in), or at a saved spot
function arriveZone(nb,ang,at){G.acts=null;if(G.gnaw){const tw=G.gnaw.tw;endGnaw(false,true);tw_restore(tw)}   // the prompts belong to where you were
  if(G.under)exitWarren(W.from.node);
  showZone(nb);let x=0,z=0;
  if(at){x=at.x;z=at.z}else for(let r=EDGE-2.5;r>6;r-=.5){x=Math.cos(ang)*r;z=Math.sin(ang)*r;if(freeAt(x,z,.3))break}
  pig.pos.set(x,heightAt(x,z),z);pig.vel.set(0,0,0);pig.vy=0;pig.air=false;pig.heading=at?at.h:Math.atan2(-x,-z);G.camYaw=pig.heading+Math.PI;
  herd.forEach(f=>f.zone=nb.id);regroupHerd();snapCamera();
  foxes.forEach(f=>{f.active=false;f.obj.visible=false;f.state='wander'});if(hawk.state!=='away'){hawk.state='away';hawk.t=R(30,60);hawk.obj.visible=false}
  const night=isNight();humans.forEach(h=>{h.visible=!night;h.fade=night?0:1;h.obj.visible=!night});snowPts.visible=!!nb.snow;
  if(at)return;
  if(!G.visited[nb.id]){G.visited[nb.id]=1;SFX.find('epic');callout('epic',`${nb.icon} ${nb.name}`,200);addScore(200,'new place!','#c98bff');toast(`🗺 <b>${nb.name}.</b> ${nb.blurb||''}`,'gold',7)}
  else toast(`${nb.icon} <b>${nb.name}</b>`);
  saveGame(true)}

// camera
G.camYaw=Math.PI*0;G.camPitch=.2;G.camDist=.95;G.drag=false;G.lastDrag=0;
const camPos=new THREE.Vector3(),camTgt=new THREE.Vector3();
function updateCamera(dt){
  const tgt=_v.set(pig.pos.x,pig.pos.y+.09,pig.pos.z);camTgt.lerp(tgt,Math.min(1,dt*10));
  const d=G.raft?2:G.gnaw?.5:G.under?Math.min(G.camDist,.8):G.camDist;let p=G.raft?.36:G.gnaw?.16:G.under?Math.min(G.camPitch,.5):G.camPitch;
  const yaw=G.gnaw?pig.heading+2.1:G.raft?G.raft.yaw+Math.PI:G.camYaw;const want=new THREE.Vector3();const aim=(p,d)=>want.set(camTgt.x+Math.sin(yaw)*Math.cos(p)*d,camTgt.y+Math.sin(p)*d,camTgt.z+Math.cos(yaw)*Math.cos(p)*d);
  if(G.under){// pull in until the line from the pig stays inside the cave; against a wall, look down from higher up instead
    const reach=p=>{aim(p,d);for(let s=1;s<=12;s++){const q=s/12;if(wSdf(lerp(camTgt.x,want.x,q),lerp(camTgt.y,want.y,q),lerp(camTgt.z,want.z,q),false)>-.1)return (s-1)/12}return 1};
    let best=p,bk=reach(p);for(const q of [.7,.95,1.2]){if(bk>=.6||q<=p)continue;const k=reach(q);if(k>bk+.1){bk=k;best=q}}
    aim(best,d*Math.max(.15,bk))}
  else if(G.inside){const B=G.inside;if(B.tube)aim(.6,.75);else aim(p,Math.min(d,B.camMax||(B.radius?4:2.6)));if(B.waterY!==undefined)want.y=Math.max(want.y,B.waterY+.12);want.x=clamp(want.x,-B.hx-.05,B.hx+.05);want.z=clamp(want.z,-B.hz-.05,B.hz+.05);want.y=clamp(want.y,insideHeight(want.x,want.z)+.08,B.ceilAt?B.ceilAt(want.x,want.z):want.x>B.loftX-.15?B.loftY-.15:B.ceil-.25)}
  else if(G.raft){const c=creekAt(G.raft.s-2.1);want.set(c.x+c.nx*G.raft.lat*.6,-.12+.78,c.z+c.nz*G.raft.lat*.6)}   // behind you along the creek's curve, over the water
  else{aim(p,d);const gy=heightAt(want.x,want.z)+.07;if(want.y<gy)want.y=gy}
  camPos.lerp(want,Math.min(1,dt*8));if(G.under&&wSdf(camPos.x,camPos.y,camPos.z,false)>-.05)camPos.copy(want);camera.position.copy(camPos);camera.lookAt(camTgt);
}

// ============================================================ day/night
const SKY=[[0,0x0b1026,0x1a2440,0x8090c0,.25,.22],[5,0x121a3a,0x3a3a5a,0x8090c0,.25,.25],[6,0x3a5a90,0xf0a070,0xffa060,1.1,.6],[7.5,0x4a86c8,0xd8e4ec,0xffe0b0,2.3,1.1],[12,0x3f82d0,0xcfe3ee,0xfff4e0,2.9,1.25],[17,0x4a7ec0,0xe8d8c0,0xffd8a0,2.4,1.1],[19.3,0x405a90,0xf08a50,0xff9050,1.2,.7],[20.5,0x1a2045,0x5a4058,0x8090c0,.3,.3],[24,0x0b1026,0x1a2440,0x8090c0,.25,.22]];
const cA=new THREE.Color(),cB=new THREE.Color();
function lerpHex(a,b,k,out){cA.set(a);cB.set(b);return out.copy(cA).lerp(cB,k)}
function updateDay(dt){
  const prev=G.time;G.time+=dt/15;if(G.time>=24)G.time-=24;
  if(prev<6&&G.time>=6){G.day++;G.nightsSurvived++;toast(`🌅 <b>You survived night ${G.nightsSurvived}!</b> +250`,'gold',5);addScore(250,'survived!','#ffd23f');flash('rgba(255,200,120,.35)',.5);if(G.slot){saveGame(true);toast('💾 Autosaved')}}
  if(prev<19.5&&G.time>=19.5)toast('🌇 Dusk is coming. Foxes hunt at night — know where your tunnels are!','',5);
  const T=G.time;let i=0;while(i<SKY.length-2&&SKY[i+1][0]<=T)i++;const a=SKY[i],b=SKY[i+1];const k=(T-a[0])/(b[0]-a[0]);
  lerpHex(a[1],b[1],k,skyMat.uniforms.top.value);lerpHex(a[2],b[2],k,skyMat.uniforms.hor.value);lerpHex(a[3],b[3],k,sun.color);
  scene.fog.color.copy(skyMat.uniforms.hor.value).multiplyScalar(.95);
  sun.intensity=lerp(a[4],b[4],k);hemi.intensity=lerp(a[5],b[5],k);
  const night=isNight();
  const ang=(T-6)/14*Math.PI;let sd;if(T>=6&&T<=20)sd=new THREE.Vector3(Math.cos(ang)*.8,Math.max(.08,Math.sin(ang)),.45);else{const na=((T+24-20)%24)/10*Math.PI;sd=new THREE.Vector3(-Math.cos(na)*.6,Math.max(.25,Math.sin(na)*.8),-.3)}
  sd.normalize();skyMat.uniforms.sunDir.value.copy(sd);skyMat.uniforms.sunCol.value.copy(sun.color).multiplyScalar(night?.25:1);
  sun.position.copy(pig.pos).addScaledVector(sd,60);sun.target.position.copy(pig.pos);
  hemi.color.copy(skyMat.uniforms.top.value).lerp(new THREE.Color(0xffffff),.5);
  const nk=night?1:T>19.3?smooth(19.3,20.5,T):T<6.5?1-smooth(5,6.5,T):0;
  starMat.opacity=nk;ffMat.opacity=Math.max(nk*.95,Z.fireflies||0);scene.fog.near=lerp(18,6,nk)*Z.fog;scene.fog.far=lerp(120,50,nk)*Math.min(1,Z.fog*1.4);
  if(Z.fogTint)scene.fog.color.lerp(cA.set(Z.fogTint[0]),Z.fogTint[1]*(1-nk*.7));
  if(G.glass)G.glass.emissiveIntensity=nk*2.2;
  for(const m of Z.lamps)if(m.glow)m.glow.opacity=nk*.75;else m.emissiveIntensity=nk*2.5;for(const m of Z.windows)m.emissiveIntensity=nk*1.6;
  pig.light.intensity=nk*.5;pig.light.position.set(pig.pos.x,pig.pos.y+.5,pig.pos.z);
  sky.position.copy(camera.position);stars.position.copy(camera.position);
  if(AC){ambTick-=dt;if(ambTick<=0){ambTick=R(1.5,5);if(!night&&T>5.5)SFX.bird();else SFX.cricket()}ambGain.gain.value=night?.03:.05}
}
let ambTick=2;

// ============================================================ survival tick
function updateSurvival(dt){
  const moving=pig.vel.length()>.3;
  G.full=Math.max(0,G.full-dt*(moving?.42:.3)*G.perk.hunger);
  G.vitc=Math.max(0,G.vitc-dt*.16);
  const chill=Z.cold&&!G.hidden&&!G.huddle&&!G.under;G.energy=Math.max(0,G.energy-dt*.1*(chill?2.4:1));
  if(chill&&!G.coldTip){G.coldTip=true;toast('🥶 Brr! The snow saps your energy. Huddle with your herd or nap in a burrow to warm up.','',6)}
  G.happy=lerp(G.happy,30+herd.length*9,dt*.012);
  {const still=pig.vel.length()<.2&&!pig.air;const near=herd.filter(f=>Math.hypot(f.pos.x-pig.pos.x,f.pos.z-pig.pos.z)<.75).length;G.huddle=still&&near>0;
   if(G.huddle){G.happy=Math.min(100,G.happy+dt*.8*near);G.energy=Math.min(100,G.energy+dt*.15*near)}}
  if(G.full<=0){G.hp-=dt*1.6;G.cause='starved'}
  if(G.vitc<=0){G.hp-=dt*.7;G.cause=G.cause||'got scurvy (no vitamin C!)';if(!G.warnC){G.warnC=true;toast('🍊 You need vitamin C! Find peppers, strawberries or dandelions.','bad',5)}}else G.warnC=false;
  if(G.energy<=0){G.hp-=dt*.4;G.cause='collapsed from exhaustion'}
  if(G.full>55&&G.vitc>25&&G.energy>10)G.hp=Math.min(100,G.hp+dt*.6);
  if(G.full<20&&!G.warnF){G.warnF=true;toast('🌿 Your tummy is rumbling… eat something!','bad')}if(G.full>30)G.warnF=false;
  if(G.energy<15&&!G.warnE){G.warnE=true;toast('⚡ You are sleepy. Nap in a tunnel to recover energy.','bad',5)}if(G.energy>25)G.warnE=false;
  G.comboT=Math.max(0,G.comboT-dt);if(G.comboT<=0)G.combo=0;G.petStreakT=Math.max(0,G.petStreakT-dt);if(G.petStreakT<=0)G.petStreak=0;
  G.luckT=Math.max(0,G.luckT-dt);G.wheekT=Math.max(0,G.wheekT-dt);G.sniffCD=Math.max(0,G.sniffCD-dt);G.popcornCD=Math.max(0,G.popcornCD-dt);G.wheekCD=Math.max(0,(G.wheekCD||0)-dt);
  // regrowth
  for(const s of spots){if(!s.ready){s.cd-=dt;if(s.cd<=0){s.ready=true;if(s.type==='leafpile')G.lpSet.setMatrix(s.lp.i,mat4(s.lp.x,heightAt(s.lp.x,s.lp.z)-.02,s.lp.z,s.lp.ry,s.lp.s))}}}
  if(Z.shop&&Z.shop.flapCD>0)Z.shop.flapCD-=dt;
  for(const t of Z.twigs){if(!t.ready&&!(G.gnaw&&G.gnaw.tw===t)){t.cd-=dt;if(t.cd<=0)tw_restore(t)}}
  G.teethT=Math.max(0,(G.teethT||0)-dt);
  for(const b of bushes){if(!b.berries){b.cd-=dt;if(b.cd<=0){b.berries=true;G.bushSet.setMatrix(b.i,G.bushSet.mats[b.i],n=>n==='Berry')}}}
  for(const p of patches){if(p.amount<1){const before=p.amount;p.amount=Math.min(1,p.amount+dt*.012);if(Math.floor(before*20)!==Math.floor(p.amount*20))updatePatch(p)}}
  for(const ps of pickSets)for(const it of ps.items){if(!it.alive){it.respawn-=dt;if(it.respawn<=0&&Math.hypot(it.x-pig.pos.x,it.z-pig.pos.z)>4){it.alive=true;ps.set.setMatrix(it.i,mat4(it.x,it.y,it.z,it.ry,it.s))}}}
  // tunnel discovery
  if(!G.under&&!G.inside)for(const tu of tunnels){if(!tu.found&&Math.hypot(tu.ex-pig.pos.x,tu.ez-pig.pos.z)<3.2)findTunnel(tu)}
  G.placeT=(G.placeT||1)-dt;if(G.placeT<=0){G.placeT=1;checkPlaces();checkGoals()}
  if(G.hp<=0&&!G.over)gameOver();
}
// ---- goals: a list in the journal, the next one under your stats. pts is the goal's own reward; bonus shows one the game already gives
const GOALS=[
  {id:'forage',icon:'🍂',name:'First Forage',desc:'Forage a leaf pile, berry bush, log or rock',test:()=>G.forages>=1,pts:25},
  {id:'friend',icon:'🐹',name:'A New Friend',desc:'Walk up gently to another guinea pig and chat until they join you',test:()=>G.pals.length>=1,pts:50},
  {id:'burrows3',icon:'🕳',name:'Burrow Finder',desc:'Find 3 burrows (sniffing helps)',test:()=>G.tunnels>=3,pts:100},
  {id:'night1',icon:'🌙',name:'First Night',desc:'Survive a night',test:()=>G.nightsSurvived>=1,bonus:250},
  {id:'pets3',icon:'💞',name:'Crowd Favourite',desc:'A ×3 pet streak: pets from three humans in a row',test:()=>G.bestStreak>=3,pts:100},
  {id:'hawk3',icon:'🦅',name:'Hawk Dodger',desc:'Give the hawk the slip 3 times',test:()=>G.hawkDodged>=3,pts:120},
  {id:'fox',icon:'🦊',name:'Fox Escape',desc:'Get away from a fox that is chasing you',test:()=>G.foxEscapes>=1,pts:100},
  {id:'visit9',icon:'🧭',name:'Wanderer',desc:'Visit all nine places',test:()=>Object.keys(G.visited).length>=9,pts:500},
  {id:'barnyard',icon:'🐐',name:'Barnyard Hello',desc:'Say hello to a goat, a sheep and a duck',test:()=>!!(G.met.Goat&&G.met.Sheep&&G.met.Duck),pts:150},
  {id:'rank3',icon:'⭐',name:'Master Forager',desc:'Forage 25 times',test:()=>G.forages>=25,bonus:150},
  {id:'maze',icon:'🌻',name:'Maze Runner',desc:'Forage the prize in the middle of the sunflower maze',test:()=>G.mazePrize>=1,pts:200},
  {id:'raft',icon:'🍃',name:'Raft Rider',desc:'Ride the leaf raft down Willow Creek to Willow Island',test:()=>G.island>=1,pts:250},
  {id:'cleanraft',icon:'🌊',name:'Not a Splash',desc:'Ride the whole creek on the leaf without a single bump',test:()=>G.cleanRaft>=1,pts:250},
  {id:'agility',icon:'🏅',name:'Clear Round',desc:'Run the agility course in the Critter Corner tent',test:()=>G.agilityRuns>=1,pts:150},
  {id:'agilitygold',icon:'🥇',name:'Best in Show',desc:`Win a gold rosette on the agility course (under ${AGI.GOLD} s)`,test:()=>G.rosette>=3,pts:300},
  {id:'shop',icon:'🐾',name:'After Hours',desc:'Sneak into the pet shop at night and make friends with Butterscotch',test:()=>G.pals.includes(friends.findIndex(f=>f.shopPig)),pts:300},
  {id:'gnaw',icon:'🦷',name:'Tidy Teeth',desc:'Gnaw a twig down without a single miss',test:()=>G.cleanGnaws>=1,pts:150},
  {id:'hay',icon:'🌾',name:'Hay Diver',desc:"Squeeze into a barn, burrow into its hay and find 3 hidden treats",test:()=>G.hayFinds>=3,pts:200},
  {id:'requests3',icon:'🎁',name:'Good Neighbour',desc:'Bring 3 humans the lost things they ask about',test:()=>Object.keys(G.given).length>=3,pts:300},
  {id:'place1',icon:'🗺',name:'Know Your Patch',desc:'Finish everything in one place (see Places)',test:()=>Object.keys(G.placesDone).length>=1,bonus:300},
  {id:'parktunnels',icon:'🕳',name:'Tunnel Master',desc:'Find every burrow in the park',test:()=>PARK.tunnels.every(t=>t.found),bonus:1000},
  {id:'halls',icon:'🌰',name:'Warren Explorer',desc:'Find all five hidden chambers in the warren',test:()=>W.nodes.filter(n=>n.kind==='hall').every(n=>n.seen),pts:300},
  {id:'flavours',icon:'🍽',name:'Local Flavours',desc:"Taste every place's signature treat",test:()=>Object.values(ZONE).every(z=>!z.sig||G.found[z.sig]),pts:400},
  {id:'herd',icon:'💕',name:'Full Herd',desc:'A herd of six friends',test:()=>herd.length>=HERD_MAX,bonus:500},
  {id:'nights7',icon:'🌙',name:'Seasoned Survivor',desc:'Survive 7 nights',test:()=>G.nightsSurvived>=7,pts:500},
  {id:'curios',icon:'🧺',name:'Curio Collector',desc:'Find all nine curios in the warren',test:()=>W.curios.every(c=>c.got),bonus:1000},
  {id:'journal',icon:'📖',name:'Journal Complete',desc:'Discover every treat',test:()=>Object.keys(ITEMS).every(k=>k==='grass'||G.found[k]),bonus:1500},
  {id:'rank4',icon:'🏆',name:'Legendary Forager',desc:'Forage 45 times',test:()=>G.forages>=45,bonus:150},
  {id:'places9',icon:'🌍',name:'Wheek of the World',desc:'Finish everything in all nine places',test:()=>Object.keys(G.placesDone).length>=9,pts:2000},
];
function nextGoal(){return GOALS.find(g=>!G.goals[g.id])}
function checkGoals(quiet){for(const g of GOALS){if(G.goals[g.id]||!g.test())continue;G.goals[g.id]=1;if(quiet)continue;
    SFX.levelup();toast(`🎯 <b>Goal complete: ${g.icon} ${g.name}</b>${g.pts?' +'+g.pts:''}`,'gold',5);if(g.pts)addScore(g.pts,'goal!','#ffd23f')}
  goalLine()}
function goalLine(){const n=nextGoal();$('goalline').innerHTML=n?`🎯 Next: <b>${n.icon} ${n.name}</b> · ${n.desc}`:'🎯 Every goal done. What a guinea pig!'}
// finishing everything in a place: a bonus, once (quiet marks the ones an older save had already finished)
function checkPlaces(quiet){for(const id of PLACE_ORDER){if(G.placesDone[id]||!G.visited[id]||!placeStatus(ZONE[id]).done)continue;G.placesDone[id]=1;if(quiet)continue;
  const z=ZONE[id];SFX.levelup();toast(`🗺 <b>${z.icon} ${z.name} complete!</b> You've done everything there. +300`,'gold',6);addScore(300,'place complete!','#ffd23f')}}

// ============================================================ HUD
const bars={hp:$('b-hp'),full:$('b-full'),vitc:$('b-vitc'),energy:$('b-energy'),happy:$('b-happy')};
let hudT=0;
function updateHUD(dt){
  hudT-=dt;if(hudT>0)return;hudT=.1;
  for(const k in bars){const v=G[k];bars[k].querySelector('.f').style.width=v+'%';bars[k].querySelector('.n').textContent=Math.round(v);bars[k].classList.toggle('low',k!=='happy'&&v<20)}
  $('score').textContent=G.score.toLocaleString();
  const parts=[`×<span>${mult().toFixed(2)}</span> happy bonus`];if(G.combo>1)parts.push(`<span>×${G.combo}</span> forage combo`);if(G.petStreak>1)parts.push(`<span>×${G.petStreak}</span> pet streak`);if(herd.length)parts.push(`<span>×${(1+herd.length*.06).toFixed(2)}</span> herd`);if(G.luckT>0)parts.push(`🍀 <span>${Math.ceil(G.luckT)}s</span>`);if(G.teethT>0)parts.push(`🦷 <span>${Math.ceil(G.teethT)}s</span>`);
  $('mult').innerHTML=parts.join(' · ');
  const h=Math.floor(G.time),m=Math.floor((G.time-h)*60/15)*15;const hh=((h+11)%12)+1;
  $('clock').textContent=`${G.under?'🕳 The Warren':G.inside?G.inside.title+' · '+Z.name:Z.icon+' '+Z.name} · Day ${G.day} · ${hh}:${String(m).padStart(2,'0')} ${h<12?'AM':'PM'} ${isNight()?'🌙':G.time>19?'🌇':G.time<7.5?'🌅':'☀️'}`;
  $('herdline').innerHTML=`🐹 Herd <b>${herd.length}/${HERD_MAX}</b>${herd.length?' · '+herd.map(f=>esc(f.name)).join(', '):' · befriend piggies with C'}`;
  $('rank').innerHTML=`Forager rank: <b>${RANKS[rankIdx()][1]}</b> · ${G.forages} forages · 🕳 ${tunnels.filter(t=>t.found).length}/${tunnels.length}`;
  // danger
  const rh=$('raftHud'),ih=G.inside&&G.inside.hud?G.inside.hud(G.inside):null;if(G.raft){const F=G.raft,R=Z.raft;rh.style.display='block';rh.querySelector('.l').innerHTML=`🍃 Leaf raft · ${'❤️'.repeat(F.bal)}${'🤍'.repeat(3-F.bal)} · 🌼 ${F.got}`;rh.querySelector('i').style.width=clamp((F.s-R.s0)/(R.send-R.s0)*100,0,100)+'%'}
  else if(ih){rh.style.display='block';rh.querySelector('.l').innerHTML=ih.html;rh.querySelector('i').style.width=clamp(ih.pct,0,100)+'%'}else rh.style.display='none';
  const dg=$('danger');
  if(G.inside&&G.inside.cat){const c=G.inside.cat;if(c.state==='sleep'){dg.style.display=c.noise>.04?'block':'none';dg.querySelector('.l').textContent='🐈 Duchess is asleep. Tiptoe…';dg.querySelector('i').style.width=Math.min(100,c.noise*100)+'%'}
    else{dg.style.display='block';dg.querySelector('.l').textContent=c.state==='return'?'🐈 Duchess is going back to sleep…':G.inside.tube?'😼 Duchess is looking for you… stay in the tubes!':'😼 Duchess is awake! Hide in a tube!';dg.querySelector('i').style.width='100%'}}
  else if(hawk.state==='circle'||hawk.state==='dive'){dg.style.display='block';dg.querySelector('.l').textContent=hawk.state==='dive'?'🦅 DIVING! GET UNDER COVER!':`🦅 Hawk overhead ${coverAt(pig.pos.x,pig.pos.z)>=1?'— you are hidden 🌿':'— hide or freeze!'}`;dg.querySelector('i').style.width=(hawk.detect*100)+'%'}
  else if(Z.cars.some(c=>c.warn&&!c.wait)){dg.style.display='block';dg.querySelector('.l').textContent='🚗 Car coming! Get off the road!';dg.querySelector('i').style.width='100%'}
  else if(foxes.some(f=>f.active&&f.state==='chase')){dg.style.display='block';dg.querySelector('.l').textContent='🦊 A fox is chasing you!';dg.querySelector('i').style.width='100%'}
  else dg.style.display='none';
  // prompts
  const acts=G.inTunnel?[]:G.under?warrenActions():G.inside?insideActions():currentActions();G.acts=acts;
  const ph=acts.map((a,i)=>`<div class="pill${a.disabled?' off':''}" data-i="${i}" data-k="${a.k}"><kbd>${keyLabel(a.k)}</kbd>${a.hold?'hold · ':''}${a.label}</div>`).join('')+(G.happy>70&&G.popcornCD<=0?`<div class="pill" data-k="␣"><kbd>${keyLabel('␣')}</kbd>Popcorn!</div>`:'')+(G.huddle?`<div class="pill info">🐹 Huddling with your herd · happy &amp; rested</div>`:'')+edgeHint();
  if(ph!==G.promptHTML){G.promptHTML=ph;$('prompt').innerHTML=ph}
  if(calloutT>0){calloutT-=.1;if(calloutT<=0)$('callout').style.opacity=0}
  drawMap();
}
function edgeHint(){if(G.under||Math.hypot(pig.pos.x,pig.pos.z)<EDGE-6)return '';const nb=neighbour(Z,sectorAt(pig.pos.x,pig.pos.z));
  return nb?`<div class="pill info">➜ ${nb.icon} ${nb.name} this way · keep going to leave ${Z.name}</div>`:''}
const mapC=$('map'),mctx=mapC.getContext('2d');let mapBg=null;
const MAPBG=680;   // the map's terrain is drawn at twice the 340-unit map space, so the big map stays sharp
function drawMapBg(){const c=document.createElement('canvas');c.width=c.height=MAPBG;const g=c.getContext('2d');const img=g.createImageData(MAPBG,MAPBG);
  const col=Z.mapColor||((x,z)=>Z.ground(x,z,heightAt(x,z)).map(v=>v*290));
  for(let y=0;y<MAPBG;y++)for(let x=0;x<MAPBG;x++){const wx=((x+.5)/MAPBG*2-1)*72,wz=((y+.5)/MAPBG*2-1)*72;const i=(y*MAPBG+x)*4;const out=Math.hypot(wx,wz)>EDGE;
    let [r,gg,b]=Z.waterY!==undefined&&heightAt(wx,wz)<Z.waterY?[60,125,170]:col(wx,wz);if(out){r*=.5;gg*=.5;b*=.5}img.data[i]=r;img.data[i+1]=gg;img.data[i+2]=b;img.data[i+3]=255}
  g.putImageData(img,0,0);g.scale(MAPBG/340,MAPBG/340);const s=v=>(v/72*.5+.5)*340;if(Z.home){g.fillStyle='#b5523b';g.fillRect(s(Z.home.x-3),s(Z.home.z-2.3),6/144*340,4.6/144*340)}
  if(Z.mapExtra)Z.mapExtra(g,s);mapBg=Z.mapBg=c}
function fitMap(){const css=mapC.clientWidth||170,px=Math.round(css*Math.min(devicePixelRatio||1,3));if(mapC.width!==px){mapC.width=mapC.height=px}
  mctx.setTransform(px/340,0,0,px/340,0,0);mctx.imageSmoothingEnabled=true;mctx.imageSmoothingQuality='high'}
function drawMap(){if(!mapBg)drawMapBg();fitMap();const g=mctx;const s=v=>(v/72*.5+.5)*340;
  if(G.under){const w=drawWarrenMap(g,s);drawArrow(g,w(pig.pos.x),w(pig.pos.z));return}
  if(G.inside){g.drawImage(mapBg,0,0,340,340);const h=G.insideHole;drawArrow(g,s(h.ex),s(h.ez));return}
  g.drawImage(mapBg,0,0,340,340);
  // passages you have explored, faint under the woods
  g.setLineDash([5,6]);g.strokeStyle='rgba(50,30,12,.5)';g.lineWidth=3;g.beginPath();
  if(Z===PARK)for(const e of W.edges)for(let k=0;k<e.pts.length-1;k++){const a=e.pts[k],b=e.pts[k+1];if(a.seen&&b.seen){g.moveTo(s(a.x/WS),s(a.z/WS));g.lineTo(s(b.x/WS),s(b.z/WS))}}g.stroke();g.setLineDash([]);
  tunnels.forEach(t=>{if(!t.found)return;g.fillStyle='#2a1a0a';g.strokeStyle='#ffd9a0';g.lineWidth=2;g.beginPath();g.arc(s(t.x),s(t.z),6,0,7);g.fill();g.stroke()});
  if(!isNight())humans.forEach(h=>{g.fillStyle='#ffb0d0';g.beginPath();g.arc(s(h.obj.position.x),s(h.obj.position.z),5,0,7);g.fill()});
  friends.forEach(f=>{if(f.state!=='herd'&&f.zone!==Z.id)return;if(f.state==='herd'){g.fillStyle='#ff9fd0';g.beginPath();g.arc(s(f.pos.x),s(f.pos.z),3.5,0,7);g.fill()}else if(f.known){g.fillStyle='#f2d6a8';g.strokeStyle='#6a4a2a';g.lineWidth=1.5;g.beginPath();g.arc(s(f.pos.x),s(f.pos.z),4.5,0,7);g.fill();g.stroke()}});
  foxes.forEach(f=>{if(f.active&&f.pos.distanceTo(pig.pos)<18){g.fillStyle='#ff5a2a';g.beginPath();g.arc(s(f.pos.x),s(f.pos.z),5,0,7);g.fill()}});
  if($('mapwrap').classList.contains('big')){g.textAlign='center';g.font='600 13px Fredoka, sans-serif';g.lineWidth=3;g.strokeStyle='rgba(0,0,0,.65)';g.fillStyle='#fff3d8';
    g.strokeText(`${Z.icon} ${Z.name}`,170,22);g.fillText(`${Z.icon} ${Z.name}`,170,22);g.font='600 11px Fredoka, sans-serif';
    for(let k=0;k<8;k++){const nb=neighbour(Z,k);if(!nb)continue;const a=k*Math.PI/4,x=170+Math.cos(a)*(EDGE+1)/72*170,y=170+Math.sin(a)*(EDGE+1)/72*170,t=`${nb.icon} ${nb.name}`;
      g.save();g.translate(clamp(x,50,290),clamp(y,40,330));g.strokeText(t,0,4);g.fillText(t,0,4);g.restore()}}
  drawArrow(g,s(pig.pos.x),s(pig.pos.z))}
function drawArrow(g,px,pz){g.save();g.translate(px,pz);g.rotate(-pig.heading+Math.PI);g.fillStyle='#fff';g.strokeStyle='#000';g.lineWidth=2;g.beginPath();g.moveTo(0,-10);g.lineTo(7,8);g.lineTo(-7,8);g.closePath();g.fill();g.stroke();g.restore()}

// ============================================================ journal / game over
function openJournal(){G.modal=true;$('journal').classList.remove('hidden');const all=Object.keys(ITEMS);const found=all.filter(k=>G.found[k]).length;
  $('jsub').textContent=`${found}/${all.length} treats discovered · ${G.forages} forages · rank: ${RANKS[rankIdx()][1]}${rankIdx()<RANKS.length-1?` (next at ${RANKS[rankIdx()+1][0]})`:''} · ${Object.keys(G.visited).length}/9 places visited`;
  $('jgrid').innerHTML=all.map(k=>{const it=ITEMS[k];const n=G.found[k];return `<div class="jcell ${n?'':'unk'}"><div class="e">${n?it.icon:'❔'}</div><div class="nm" style="color:${RARITY[it.rarity][0]}">${n?it.name:'???'}</div><div class="ct">${n?'×'+n:(it.zone?ZONE[it.zone].icon+' ':'')+it.rarity}</div></div>`}).join('');
  $('jherd').innerHTML=`<h2 style="margin:18px 0 8px;font-size:20px">🐹 Your herd · ${herd.length}/${HERD_MAX}</h2>`+[`<span class="hcell"><b>${esc(G.name)}</b> · ${BREEDS[G.breed].name} ${COATS[G.coat].name} (you)</span>`,...herd.map(f=>`<span class="hcell"><b>${esc(f.name)}</b> · ${BREEDS[f.look.breed].name} ${COATS[f.look.coat].name}</span>`)].join('')+(herd.length<HERD_MAX?`<p style="font-size:13px;margin:6px 0 0">${friends.filter(f=>f.state!=='herd').length} more piggies are out there, in the park and all the places around it. Sniff (R) to find them.</p>`:'');
  $('jplaces').innerHTML=placesHTML();
  const rq=Object.keys(REQUESTS).filter(k=>G.heard[k]||G.given[k]);
  $('jgoals').innerHTML=`<h2 style="margin:18px 0 8px;font-size:20px">🎯 Goals · ${GOALS.filter(g=>G.goals[g.id]).length}/${GOALS.length}</h2><div class="glist">`+
    GOALS.map(g=>`<div class="gcell${G.goals[g.id]?' done':''}"><span class="gi">${G.goals[g.id]?'✅':g.icon}</span><span><b>${g.name}</b><br>${g.desc}</span><span class="gp">+${g.pts||g.bonus}</span></div>`).join('')+'</div>'+
    `<h2 style="margin:18px 0 8px;font-size:20px">🎁 Requests · ${Object.keys(G.given).length}/${Object.keys(REQUESTS).length}</h2>`+(rq.length?'<div class="glist">'+rq.map(k=>{const r=REQUESTS[k],c=CURIOS[k],z=ZONE[r.zone];
      return `<div class="gcell${G.given[k]?' done':''}"><span class="gi">${G.given[k]?'✅':c.icon}</span><span><b>${r.who}</b> · ${z.icon} ${z.name}<br>${G.given[k]?`You gave them the ${c.name}.`:G.curios[k]?`Wants the ${c.icon} ${c.name}, and you have it! Go and give it.`:`Lost the ${c.name}. Lost things turn up in the warren.`}</span></div>`}).join('')+'</div>':'<p style="font-size:13px;margin:0">Chat to the humans in each place. Some of them have lost something.</p>');
  const halls=W.nodes.filter(n=>n.kind==='hall');
  $('jwarren').innerHTML=`<h2 style="margin:18px 0 4px;font-size:20px">🕳 The Warren · ${warrenPct()}% mapped</h2><p style="font-size:13px;margin:0 0 8px">${halls.filter(n=>n.seen).length}/${halls.length} hidden chambers · ${PARK.tunnels.filter(t=>t.found).length}/${PARK.tunnels.length} park burrows · ${routeCount()} quick routes · curio stash ${W.curios.filter(c=>c.got).length}/${W.curios.length}</p><div class="jgrid">`+
    W.curios.map(c=>{const it=CURIOS[c.k];return `<div class="jcell ${c.got?'':'unk'}"><div class="e">${c.got?it.icon:'❔'}</div><div class="nm" style="color:${RARITY[it.rarity][0]}">${c.got?it.name:'???'}</div><div class="ct">${G.given[c.k]?'given to '+esc(G.given[c.k]):c.got?'curio':it.rarity}</div></div>`}).join('')+'</div>'}
function warrenPct(){return Math.round(W.seenPts/W.pts*100)}
// ---- the places checklist: what there is to do in each of the nine places
const ZONE_CRITTERS={zoo:['Goat','Sheep','Duck'],farm:['Sheep','Duck'],creek:['Duck']},CRITTER_ICON={Goat:'🐐',Sheep:'🐑',Duck:'🦆'};
const PLACE_ORDER=['sunflowers','peaks','deepwood','farm','park','town','zoo','creek','beach'];   // as they lie on the map
function placeStatus(z){const items=[],nf=(G.zfound[z.id]||[]).length,nb=z===PARK?PARK.tunnels.length:z.cfg.burrows.length;
  items.push({icon:'🕳',label:`Burrows found ${Math.min(nf,nb)}/${nb}`,done:nf>=nb});
  const pigs=friends.filter(f=>f.origin===z.id),pals=pigs.filter(f=>G.pals.includes(friends.indexOf(f))).length;
  items.push({icon:'🐹',label:`Piggies befriended ${pals}/${pigs.length}`,done:pals>=pigs.length});
  if(z.sig){const it=ITEMS[z.sig],f=G.found[z.sig];items.push({icon:f?it.icon:'❔',label:f?`Tasted ${it.name}`:'Its signature treat',done:!!f})}
  if(z===PARK){const halls=W.nodes.filter(n=>n.kind==='hall'),seen=halls.filter(n=>n.seen).length;items.push({icon:'🌰',label:`Warren chambers ${seen}/${halls.length}`,done:seen>=halls.length})}
  for(const k of ZONE_CRITTERS[z.id]||[])items.push({icon:CRITTER_ICON[k],label:`Said hello to a ${k.toLowerCase()}`,done:!!G.met[k]});
  if(z.id==='farm'||z.id==='zoo')items.push({icon:'🛖',label:'Squeezed into the barn',done:!!G.barns[z.id]});
  if(z.id==='town')items.push({icon:'🐾',label:'Snuck into the pet shop',done:!!G.shop});
  if(z.id==='creek')items.push({icon:'🍃',label:'Rode the leaf raft to Willow Island',done:!!G.island});
  if(z.id==='zoo')items.push({icon:'🏅',label:'Won a rosette in the agility tent',done:G.rosette>=1});
  return {items,done:items.every(i=>i.done)}}
function placesHTML(){const done=PLACE_ORDER.filter(id=>G.placesDone[id]).length;
  return `<h2 style="margin:18px 0 4px;font-size:20px">🗺 Places · ${Object.keys(G.visited).length}/9 visited · ${done}/9 complete</h2><p style="font-size:13px;margin:0 0 8px">Finish everything in a place for a bonus. They're laid out as they lie on the map.</p><div class="pgrid">`+
    PLACE_ORDER.map(id=>{const z=ZONE[id];if(!G.visited[id])return `<div class="pcell unk"><b>${z.icon} ${z.name}</b><span>Not visited yet</span></div>`;const st=placeStatus(z);
      return `<div class="pcell${G.placesDone[id]?' done':''}"><b>${z.icon} ${z.name}${G.placesDone[id]?' ✓':''}</b>${st.items.map(i=>`<span class="${i.done?'ok':''}">${i.done?'✓':'·'} ${i.icon} ${i.label}</span>`).join('')}</div>`}).join('')+'</div>'}
function closeJournal(){G.modal=false;$('journal').classList.add('hidden')}
function gameOver(){G.over=true;const best=Math.max(G.best,G.score);lsSet('wheek-best',best);
  $('overWhy').textContent=`${G.name} the ${BREEDS[G.breed].name} ${G.cause||'had a very long day'}.`;
  $('overStats').innerHTML=`Score: <b style="color:#ffd23f;font-size:24px">${G.score.toLocaleString()}</b>${G.score>=G.best&&G.score>0?' 🏆 new best!':''}<br>Best: ${best.toLocaleString()}<br>Days survived: ${G.day} · Nights: ${G.nightsSurvived}<br>Forages: ${G.forages} · Treats eaten: ${G.eaten} · Pets: ${G.pets}<br>Places visited: ${Object.keys(G.visited).length}/9 · Burrows found: ${G.tunnels} · Herd: ${herd.length}/${HERD_MAX}<br>Warren: ${warrenPct()}% mapped · Curios: ${W.curios.filter(c=>c.got).length}/${W.curios.length}<br>Journal: ${Object.keys(G.found).length}/${Object.keys(ITEMS).length}`;
  $('retryBtn').classList.toggle('hidden',!lsGet(slotKey(G.slot),null));
  $('over').classList.remove('hidden')}

// ============================================================ saves
// Three slots in localStorage. The world is seeded (the same every game), so a save only keeps what changed:
// the stats, what's been found, the herd (by friend index) and the warren's explored passages.
const SLOTS=3,slotKey=i=>'wheek-slot-'+i;
const SAVE_G=['hp','full','vitc','energy','happy','score','day','time','forages','pets','found','curios','nightsSurvived','eaten','luckT','warrenTip','zfound','visited','met','pals','placesDone','goals','bestStreak','hawkDodged','foxEscapes','mazePrize','heard','given','barns','hayFinds','teethT','gnaws','cleanGnaws','shop','fullHerd','island','rafts','cleanRaft','agility','rosette','agilityBest','agilityRuns'];
function snapshot(){const g={};for(const k of SAVE_G)g[k]=G[k];const ix=(a,f)=>a.flatMap((x,i)=>f(x)?[i]:[]);
  return {v:1,saved:Date.now(),name:G.name,breed:G.breed,coat:G.coat,G:g,
    zone:Z.id,pig:G.raft?{x:+Z.raft.ex.toFixed(2),z:+Z.raft.ez.toFixed(2),h:+Z.raft.out.toFixed(2)}:G.inside?{x:+G.insideHole.ex.toFixed(2),z:+G.insideHole.ez.toFixed(2),h:+G.insideHole.out.toFixed(2)}:{x:+pig.pos.x.toFixed(2),z:+pig.pos.z.toFixed(2),h:+pig.heading.toFixed(2)},under:G.under?PARK.tunnels.indexOf(W.from):-1,herd:herd.map(f=>friends.indexOf(f)),names:friends.map(f=>f.name),known:ix(friends,f=>f.known),
    warren:{edges:W.edges.map(e=>e.pts.map(p=>p.seen?1:0).join('')),seen:ix(W.nodes,n=>n.seen),heard:ix(W.nodes,n=>n.heard),got:ix(W.curios,c=>c.got),routes:W.routes||0}}}
function saveGame(quiet){if(!G.slot||!G.started||G.over)return;lsSet(slotKey(G.slot),snapshot());if(!quiet)toast(`💾 Saved to slot ${G.slot}`,'good')}
function restore(s){
  for(const k of SAVE_G)if(k in s.G)G[k]=s.G[k];
  G.name=s.name;G.breed=BREEDS[s.breed]?s.breed:'american';G.coat=BREEDS[G.breed].coats.includes(s.coat)?s.coat:BREEDS[G.breed].coats[0];G.perk=perksFor(G.breed);buildPig();
  if(!G.zfound||typeof G.zfound!=='object')G.zfound={};if(!G.visited)G.visited={park:1};if(s.tunnels&&!G.zfound.park)G.zfound.park=s.tunnels;   // saves before zones kept only the park's
  PARK.tunnels.forEach((t,i)=>t.found=(G.zfound.park||[]).includes(i));G.tunnels=Object.values(G.zfound).reduce((n,a)=>n+a.length,0);
  // wild piggies' names depend on your own name at load, so keep the ones this game used
  (s.names||[]).forEach((n,i)=>{if(friends[i])friends[i].name=n});
  s.known.forEach(i=>{if(friends[i])friends[i].known=true});
  s.herd.forEach(i=>{const f=friends[i];if(!f||herd.includes(f))return;f.state='herd';f.friend=1;f.tag.style.display='none';herd.push(f)});
  if(!Array.isArray(G.pals))G.pals=[];for(const i of s.herd)if(!G.pals.includes(i))G.pals.push(i);   // saves before v0.3 only knew the herd
  const w=s.warren;
  W.edges.forEach((e,i)=>{const b=w.edges[i]||'';e.pts.forEach((p,k)=>{if(b[k]==='1'&&!p.seen){p.seen=true;W.seenPts++}});e.done=e.pts.filter(p=>p.seen).length>=e.pts.length*.9});
  w.seen.forEach(i=>{if(W.nodes[i])W.nodes[i].seen=true});w.heard.forEach(i=>{if(W.nodes[i])W.nodes[i].heard=true});
  w.got.forEach(i=>{const c=W.curios[i];if(c){c.got=true;c.obj.removeFromParent()}});W.routes=w.routes;W.allSeen=W.edges.every(e=>e.done);
  const zn=ZONE[s.zone]||PARK;if(zn!==PARK){arriveZone(zn,0,s.pig)}else pig.pos.set(s.pig.x,heightAt(s.pig.x,s.pig.z),s.pig.z);pig.heading=s.pig.h;
  if(zn===PARK&&PARK.tunnels[s.under]){enterWarren(PARK.tunnels[s.under],true);pig.pos.set(s.pig.x,0,s.pig.z);pig.heading=s.pig.h;W.trail=[{x:pig.pos.x,z:pig.pos.z}];herd.forEach(f=>f.pos.copy(pig.pos))}
  else regroupHerd();
  if(herd.length>=HERD_MAX)G.fullHerd=1;   // saves before swapping already had their bonus
  if(!s.G.placesDone)checkPlaces(true);if(!s.G.goals)checkGoals(true);
  G.camYaw=pig.heading+Math.PI;snapCamera();updateDay(0)}
function ago(t){const m=Math.round((Date.now()-t)/60000);return m<1?'just now':m<60?`${m} min ago`:m<1440?`${Math.round(m/60)} h ago`:`${Math.round(m/1440)} days ago`}
function renderSlots(){const el=$('slots');el.innerHTML='';
  for(let i=1;i<=SLOTS;i++){const s=lsGet(slotKey(i),null);const row=document.createElement('div');row.className='slot';
    if(s&&s.G){const zn=ZONE[s.zone]||PARK;row.innerHTML=`<button class="btn cont">▶ ${esc(s.name)} the ${BREEDS[s.breed]?.name||'guinea pig'}<span>Slot ${i} · ${zn.icon} ${zn.name} · Day ${s.G.day} · ${s.G.score.toLocaleString()} pts · saved ${ago(s.saved)}</span></button><button class="btn alt del" title="Delete this save">🗑</button>`;
      row.querySelector('.cont').onclick=()=>continueGame(i);row.querySelector('.del').onclick=()=>{if(confirm(`Delete ${s.name}'s save in slot ${i}?`)){try{localStorage.removeItem(slotKey(i))}catch(e){}renderSlots()}}}
    else{row.innerHTML=`<button class="btn alt new">＋ New guinea pig<span>Slot ${i} · empty</span></button>`;row.querySelector('.new').onclick=()=>newGame(i)}
    el.appendChild(row)}}
function newGame(i){G.slot=i;audioInit();$('title').classList.add('hidden');openSelect()}
function continueGame(i){const s=lsGet(slotKey(i),null);if(!s)return renderSlots();G.slot=i;audioInit();restore(s);
  startPlaying(()=>toast(`🐹 Welcome back, ${esc(G.name)}! Day ${G.day}${G.under?', down in the warren':''}.`,'good',5))}
function startPlaying(welcome){
  friends.forEach(f=>{if(f.name===G.name)f.name=PIG_NAMES.find(n=>n!==G.name&&!friends.some(o=>o.name===n))});
  G.selecting=false;camera.clearViewOffset();$('select').classList.add('hidden');G.started=true;$('touchui').classList.remove('hidden');G.camDist=.95;G.camPitch=.2;G.camYaw=pig.heading+Math.PI;$('title').classList.add('hidden');['stats','top','mapwrap','help'].forEach(i=>$(i).classList.remove('hidden'));SFX.wheek();
  goalLine();welcome();saveGame(true)}
addEventListener('pagehide',()=>saveGame(true));

// ============================================================ input
// Every action goes through press/release, whatever pressed it: the keyboard, a touch button or a gamepad.
function press(code,repeat=false){
  if(!G.started)return;keys[code]=true;if(AC&&AC.state==='suspended')AC.resume();
  if(code==='Escape'){if(!$('journal').classList.contains('hidden'))closeJournal();else if(!$('tunnelMenu').classList.contains('hidden'))closeTunnel();else togglePause();return}
  if(code==='KeyP'){togglePause();return}
  if(code==='KeyJ'){if($('journal').classList.contains('hidden'))openJournal();else closeJournal();return}
  if(G.modal||G.paused||G.over||G.inTunnel||repeat)return;
  if(G.inside&&G.inside.burrow&&(code==='Space'||code==='KeyF'||code==='KeyE')){popOut();return}
  if(G.gnaw&&(code==='KeyE'||code==='Space')){gnawHit();return}
  if(code==='Space'){if(G.inside&&G.inside.tube)return;if(!pig.air){if(G.inside&&G.inside.cat)catNoise(.15);pig.vy=1.55;pig.air=true;SFX.jump();if(G.happy>70&&G.popcornCD<=0){G.popcornCD=3;addScore(15,'popcorn!','#ffb0e0');herdPopcorn();emit(pig.pos.x,pig.pos.y+.1,pig.pos.z,10,{col:[1,.8,.9],spread:.5,up:.8,size:.015,life:.6})}}}
  if(code==='KeyE'){const a=(G.acts||currentActions()).find(a=>a.k==='E'&&!a.hold&&a.do&&!a.disabled);if(a)a.do()}
  if(code==='KeyM')$('mapwrap').classList.toggle('big');
  if(code==='KeyF'&&G.inside){const a=insideActions().find(a=>a.k==='F'&&a.do);if(a)a.do()}
  else if(code==='KeyF'&&!G.under){const a=currentActions().find(a=>a.k==='F'&&a.spot);if(a&&!forageState)startForage(a.spot)}
  if(code==='KeyR')G.inside?G.inside.sniff(G.inside):sniff();
  if(code==='KeyQ')wheek();
}
function release(code){keys[code]=false}
addEventListener('keydown',e=>{if(e.target&&e.target.tagName==='INPUT'&&e.target.type!=='range')return;if(e.code==='Escape'&&!$('settings').classList.contains('hidden')){closeSettings();return}if(e.code==='Escape'&&G.swapFor){closeSwap();return}if(G.started&&e.code==='Space')e.preventDefault();if(G.started)setInput('kb');press(e.code,e.repeat)});
addEventListener('keyup',e=>release(e.code));
// which buttons the prompts show: the keyboard's, a gamepad's, or none (on touch the prompts are buttons themselves)
const PAD_GLYPH={E:'Ⓐ',F:'Ⓧ',C:'Ⓨ',Q:'LB',R:'RB','␣':'Ⓑ'};
function keyLabel(k){return G.input==='pad'?PAD_GLYPH[k]||k:k}
// a key in a tip: <kbd>E</kbd> on a keyboard, Ⓐ on a gamepad; on touch, what the button that pops up is called
function kb(k,touch){return G.input==='touch'?touch:`<kbd>${keyLabel(k)}</kbd>`}
function setInput(m,force){if(G.input===m&&!force)return;G.input=m;document.body.classList.toggle('touch',SET.touch==='on'||SET.touch!=='off'&&m==='touch');document.body.classList.toggle('pad',m==='pad');renderHelp();G.promptHTML=''}
function renderHelp(){$('help').innerHTML=G.input==='pad'?'<kbd>L</kbd>move <kbd>R</kbd>look <kbd>RT</kbd>scurry <kbd>Ⓑ</kbd>popcorn <kbd>Ⓐ</kbd>eat/enter <kbd>Ⓧ</kbd>forage <kbd>Ⓨ</kbd>befriend <kbd>RB</kbd>sniff <kbd>LB</kbd>wheek <kbd>⧉</kbd>map <kbd>▲</kbd>journal <kbd>☰</kbd>pause'
  :'<kbd>WASD</kbd>move <kbd>⇧</kbd>scurry <kbd>␣</kbd>popcorn <kbd>E</kbd>eat/enter <kbd>F</kbd>forage <kbd>R</kbd>sniff <kbd>Q</kbd>wheek <kbd>C</kbd>befriend <kbd>M</kbd>map <kbd>J</kbd>journal <kbd>P</kbd>pause · drag to look'}

// ---- touch: a joystick on the left of the screen, look around on the right (pinch to zoom), buttons for the rest
// The prompts become buttons too: tap one to do it, or hold it for the hold actions (munch, forage, chat).
const touchHeld=new Map();   // pointerId -> key held by a touch button
function touchPress(e,code){e.preventDefault();setInput('touch');audioInit();if(AC&&AC.state==='suspended')AC.resume();touchHeld.set(e.pointerId,code);press(code)}
addEventListener('pointerup',e=>{const c=touchHeld.get(e.pointerId);if(c){touchHeld.delete(e.pointerId);release(c)}});
addEventListener('pointercancel',e=>{const c=touchHeld.get(e.pointerId);if(c){touchHeld.delete(e.pointerId);release(c)}});
document.querySelectorAll('#touchui .tb').forEach(b=>b.addEventListener('pointerdown',e=>touchPress(e,b.dataset.k)));
$('prompt').addEventListener('pointerdown',e=>{const el=e.target.closest('.pill');if(!el||!G.started)return;e.preventDefault();setInput('touch');
  if(el.dataset.k==='␣'){touchPress(e,'Space');return}const a=(G.acts||[])[+el.dataset.i];if(!a||a.disabled)return;
  if(a.do&&!a.hold){a.do();return}touchPress(e,'Key'+a.k)});
addEventListener('blur',()=>{for(const k in keys)keys[k]=false;if(G.started&&!G.over&&!G.modal)togglePause(true)});
function togglePause(force){if(G.over)return;G.paused=force??!G.paused;$('pause').classList.toggle('hidden',!G.paused)}
// ---- settings: from the title screen and the pause menu
const FUR_STEP=()=>SET.quality==='low'?2:1;
function applyQuality(){const low=SET.quality==='low';renderer.setPixelRatio(low?1:Math.min(devicePixelRatio,1.75));renderer.setSize(innerWidth,innerHeight);sun.castShadow=!low;
  (pig.fur||[]).forEach((s,i)=>s.visible=i%FUR_STEP()===0)}
function openSettings(){renderSettings();$('settings').classList.remove('hidden')}
function closeSettings(){$('settings').classList.add('hidden');lsSet('wheek-settings',SET)}
function renderSettings(){for(const k of ['master','music','sfx'])$('s-'+k).value=SET[k];
  document.querySelectorAll('#settings .seg').forEach(sg=>{const v=SET[sg.dataset.k];sg.querySelectorAll('button').forEach(b=>b.classList.toggle('on',String(v===true?1:v===false?0:v)===b.dataset.v))})}
for(const k of ['master','music','sfx'])$('s-'+k).addEventListener('input',e=>{SET[k]=+e.target.value;applyAudio();lsSet('wheek-settings',SET)});
document.querySelectorAll('#settings .seg button').forEach(b=>b.addEventListener('click',()=>{const k=b.parentElement.dataset.k;SET[k]=k==='flashes'?b.dataset.v==='1':b.dataset.v;
  if(k==='quality')applyQuality();if(k==='touch')setInput(G.input||'kb',true);renderSettings();lsSet('wheek-settings',SET)}));
const looks=new Map();   // touch pointers looking around (two of them pinch to zoom)
canvas.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'){setInput('touch');if(e.clientX<innerWidth*.4&&!joy.active){joy.start(e);return}looks.set(e.pointerId,{x:e.clientX,y:e.clientY});if(looks.size===2){const [a,b]=[...looks.values()];G.pinch=Math.hypot(a.x-b.x,a.y-b.y)}}
  G.drag=true;G.dragId=e.pointerId;canvas.classList.add('drag');canvas.setPointerCapture(e.pointerId)});
canvas.addEventListener('pointermove',e=>{if(joy.id===e.pointerId){joy.move(e);return}
  if(looks.has(e.pointerId)){looks.set(e.pointerId,{x:e.clientX,y:e.clientY});if(looks.size>=2){const [a,b]=[...looks.values()],d=Math.hypot(a.x-b.x,a.y-b.y);if(G.pinch)G.camDist=clamp(G.camDist*G.pinch/d,.45,4);G.pinch=d;return}}
  if(!G.drag||e.pointerId!==G.dragId)return;G.camYaw-=e.movementX*.006;G.camPitch=clamp(G.camPitch+e.movementY*.004,-.05,1.2);G.lastDrag=performance.now()});
const endPtr=e=>{if(joy.id===e.pointerId){joy.end();return}looks.delete(e.pointerId);G.pinch=0;if(e.pointerId===G.dragId){G.drag=false;canvas.classList.remove('drag');G.lastDrag=performance.now()}};
canvas.addEventListener('pointerup',endPtr);canvas.addEventListener('pointercancel',endPtr);
canvas.addEventListener('wheel',e=>{G.camDist=clamp(G.camDist*(1+e.deltaY*.001),.45,4)},{passive:true});
const joy={active:false,id:null,x:0,y:0,ox:0,oy:0,
  start(e){this.id=e.pointerId;this.active=true;this.ox=e.clientX;this.oy=e.clientY;canvas.setPointerCapture(e.pointerId);const r=$('joyring');r.style.left=this.ox+'px';r.style.top=this.oy+'px';r.classList.add('on');this.knob(0,0)},
  move(e){this.x=clamp((e.clientX-this.ox)/50,-1,1);this.y=clamp((e.clientY-this.oy)/50,-1,1);const l=Math.hypot(this.x,this.y);if(l>1){this.x/=l;this.y/=l}this.knob(this.x,this.y)},
  end(){this.active=false;this.id=null;this.x=this.y=0;$('joyring').classList.remove('on')},
  knob(x,y){$('joyring').firstElementChild.style.transform=`translate(${x*38}px,${y*38}px)`}};

// ---- gamepad: left stick moves, right stick looks, buttons as in renderHelp; in menus the d-pad or stick moves between buttons, Ⓐ picks, Ⓑ goes back
const PADMAP={0:'KeyE',2:'KeyF',3:'KeyC',1:'Space',5:'KeyR',4:'KeyQ',7:'ShiftLeft',6:'ShiftLeft',9:'KeyP',8:'KeyM',12:'KeyJ'};
const pad={x:0,y:0,on:false,prev:[],menu:false,navT:0};
function topOverlay(){for(const id of ['swapMenu','settings','over','journal','tunnelMenu','pause','select','title']){const el=$(id);if(el&&!el.classList.contains('hidden'))return el}return null}
function padTargets(ov){return [...ov.querySelectorAll('button,input[type=range]')].filter(el=>!el.disabled&&el.offsetParent!==null&&!el.closest('.hidden'))}
function pollPad(dt){const gp=[...(navigator.getGamepads?navigator.getGamepads():[])].find(g=>g&&g.connected);if(!gp){pad.on=false;return}
  const b=gp.buttons.map(x=>x.pressed||x.value>.5),dz=v=>Math.abs(v)<.2?0:v,lx=dz(gp.axes[0]||0),ly=dz(gp.axes[1]||0),rx=dz(gp.axes[2]||0),ry=dz(gp.axes[3]||0),edge=i=>b[i]&&!pad.prev[i];
  if(b.some(Boolean)||lx||ly||rx||ry){if(G.input!=='pad'){setInput('pad');audioInit()}if(AC&&AC.state==='suspended')AC.resume()}
  const ov=topOverlay();
  if(ov){if(!pad.menu){pad.menu=true;pad.on=false;for(const c of Object.values(PADMAP))release(c)}
    const list=padTargets(ov);let i=list.indexOf(document.activeElement);pad.navT-=dt;
    const dir=edge(13)||edge(15)?1:edge(12)||edge(14)?-1:pad.navT<=0&&Math.abs(ly)>.5?Math.sign(ly):0;
    if(dir&&list.length){pad.navT=.25;const el=document.activeElement;if(el&&el.type==='range'&&(edge(14)||edge(15))){el.value=+el.value+(edge(15)?1:-1)*(+el.step||.05);el.dispatchEvent(new Event('input'))}
      else{i=i<0?0:(i+dir+list.length)%list.length;list[i].focus();list[i].scrollIntoView({block:'nearest'})}}
    if(edge(0)){const el=i>=0?list[i]:list[0];if(el&&el.type!=='range')el.click()}
    if(edge(1)||edge(9)&&ov.id==='pause'){if(ov.id==='swapMenu')closeSwap();else if(ov.id==='settings')closeSettings();else if(ov.id==='journal')closeJournal();else if(ov.id==='tunnelMenu')closeTunnel();else if(ov.id==='pause')togglePause(false)}
  }else if(G.started){pad.menu=false;pad.x=lx;pad.y=ly;pad.on=!!(lx||ly);
    if(rx||ry){G.camYaw-=rx*dt*2.6;G.camPitch=clamp(G.camPitch+ry*dt*1.6,-.05,1.2);G.lastDrag=performance.now()}
    for(const [k,code] of Object.entries(PADMAP)){if(edge(k))press(code);else if(!b[k]&&pad.prev[k]&&!(code==='ShiftLeft'&&(b[6]||b[7])))release(code)}}
  pad.prev=b}
addEventListener('gamepadconnected',()=>toast('🎮 Gamepad connected! Left stick to scurry, Ⓐ to eat, Ⓧ to forage.','good',5));

// ============================================================ breed select
function selOffset(){if(!G.selecting)return;const w=innerWidth,h=innerHeight;if(w>700)camera.setViewOffset(w,h,-w*.2,0,w,h);else camera.setViewOffset(w,h,0,h*.24,w,h)}
addEventListener('resize',selOffset);
function renderSelect(){
  $('breeds').innerHTML=Object.entries(BREEDS).map(([k,b])=>`<button class="breed ${k===G.breed?'on':''}" data-b="${k}"><b>${b.name}</b><span>${b.tag}</span></button>`).join('');
  $('coats').innerHTML=BREEDS[G.breed].coats.map(c=>`<button class="coat ${c===G.coat?'on':''}" data-c="${c}" title="${COATS[c].name}" style="background:${COATS[c].sw}"></button>`).join('');
  $('coatName').textContent=COATS[G.coat].name;
  const b=BREEDS[G.breed];$('perk').innerHTML=`<b>${b.name}</b> · ${b.desc}<span class="pk">${b.perk}</span>`;
  $('breeds').querySelectorAll('.breed').forEach(el=>el.onclick=()=>{if(el.dataset.b===G.breed)return;G.breed=el.dataset.b;G.coat=BREEDS[G.breed].coats.includes(G.coat)?G.coat:BREEDS[G.breed].coats[0];applyLook()});
  $('coats').querySelectorAll('.coat').forEach(el=>el.onclick=()=>{G.coat=el.dataset.c;applyLook()});
}
function applyLook(){G.perk=perksFor(G.breed);buildPig();updatePig(0.016,0);SFX.purr();renderSelect()}
function openSelect(){G.selecting=true;G.camDist=.62;G.camPitch=.2;$('pigName').value=G.name;renderSelect();$('select').classList.remove('hidden');selOffset()}

// ============================================================ main loop
const clock=new THREE.Clock();let frame=0;
function loop(){
  requestAnimationFrame(loop);
  const dt=Math.min(clock.getDelta(),.05);const t=clock.elapsedTime;U.time.value=t;pollPad(dt);updateMusic(dt);
  if(G.started&&!G.paused&&!G.over&&!G.modal){
    if(G.inTunnel&&travel){updateTravel(dt);updateParticles(dt);renderer.render(tScene,tCam);return}
    if(G.under){updateWarren(dt,t);updateSurvival(dt);updateHawk(dt,t);updateFoxes(dt,t);updateDay(dt)}
    else if(G.inside){updateInside(dt,t);const hold=keys.KeyE?(G.acts||[]).find(a=>a.k==='E'&&a.hold):null;if(hold)holdEat(dt,hold);if(G.inside)updateForage(dt);updateReveals(dt);updateSurvival(dt);updateDay(dt)}else{
    if(G.raft)updateRaft(dt,t);else updatePig(dt,t);
    const hold=(keys.KeyE)&&!G.inTunnel?(G.acts||[]).find(a=>a.k==='E'&&a.hold):null;if(hold)holdEat(dt,hold);
    updateForage(dt);updateGnaw(dt);updateSurvival(dt);updateHumans(dt);updateFriends(dt,t);updateHawk(dt,t);updateFoxes(dt,t);updateDay(dt);updateReveals(dt);updateDrops(dt);
    if(Z.critters.length)updateCritters(dt,t);if(Z.cars.length)updateCars(dt)}
  }else if(!G.started){ // title orbit / breed preview
    if(G.selecting)G.camYaw+=angDiff(G.camYaw,pig.heading+.5+Math.sin(t*.3)*.9)*Math.min(1,dt*2);else G.camYaw+=dt*.08;updateDay(0);updatePig(dt,t);updateFriends(dt,t);
  }
  updateCamera(dt);updateParticles(dt);updateHearts(dt);updateMarkers(dt,t);if(snowPts.visible&&!G.under)updateSnow(dt,t);waterNormal.offset.set(t*.011,t*.007);
  // fireflies
  if(ffMat.opacity>0){for(let i=0;i<ffN;i++){const f=ffData[i];let x=pig.pos.x+f.x+Math.sin(t*.3+f.p)*1.5,z=pig.pos.z+f.z+Math.cos(t*.25+f.p)*1.5;ffPos[i*3]=x;ffPos[i*3+2]=z;ffPos[i*3+1]=heightAt(x,z)+f.y+Math.sin(t*.8+f.p)*.3}ffGeo.attributes.position.needsUpdate=true;ffMat.size=.1+Math.sin(t*4)*.03}
  // chunk culling
  if((frame++&7)===0){const cx=camera.position.x,cz=camera.position.z,k=SET.quality==='low'?.65:1;for(const b of CHUNKS){const v=Math.hypot(b.cx-cx,b.cz-cz)<b.view*k;for(const m of b.meshes)m.visible=v}}
  if(G.started)updateHUD(dt);
  renderer.render(G.under?wScene:G.inside?iScene:scene,camera);
}

// ============================================================ boot
(async()=>{
  const bar=$('startBtn');
  $('ver').textContent='v'+VERSION;
  await loadAssets(p=>{$('loading').textContent=`Growing the forest… ${Math.round(p*100)}%`});
  $('loading').textContent='Planting trees…';await new Promise(r=>setTimeout(r,20));
  PARK=defineZone({id:'park',name:'The Park',icon:'🏡',gx:0,gz:0,seed:0,height:parkHeight,forest:parkForest,path:parkPath,ground:parkGround,mapColor:parkMapColor,home:HOME,build:buildWorld});
  showZone(PARK);buildPig();buildPredators();buildTunnelScene();buildFriends();addSignposts(PARK);
  $('loading').textContent='Digging tunnels…';await new Promise(r=>setTimeout(r,20));buildWarren();
  pig.pos.y=heightAt(pig.pos.x,pig.pos.z);pig.heading=0.4;G.camYaw=pig.heading+Math.PI;camTgt.copy(pig.pos);camPos.set(pig.pos.x+2,pig.pos.y+1,pig.pos.z+2);
  updatePig(0.016,0);updateDay(0);
  $('loading').textContent=G.best?`Best score: ${G.best.toLocaleString()}`:'';
  G.camDist=2.4;G.camPitch=.32;
  bar.classList.add('hidden');renderSlots();$('slots').classList.remove('hidden');setInput(matchMedia('(pointer: coarse)').matches?'touch':'kb');
  loop();
  $('goBtn').onclick=()=>{const nm=$('pigName').value.trim().slice(0,14);G.name=nm||PIG_NAMES[0];lsSet('wheek-pig',{breed:G.breed,coat:G.coat,name:G.name});
    startPlaying(()=>{toast(G.input==='touch'?`🐹 Welcome, ${esc(G.name)}! When there's something to do, a button pops up on the right: hold it to munch grass or forage.`:`🐹 Welcome, ${esc(G.name)}! Munch grass (hold ${kb('E')}) and forage (hold ${kb('F')}).`,'good',6);setTimeout(()=>toast('💡 Humans kneeling in the meadow give pets — walk up to their hand and stay still.','',7),2500);setTimeout(()=>toast(`💡 Sniff with ${kb('R','👃')} to find forage spots and hidden tunnels.`,'',7),6000);setTimeout(()=>toast(`🐹 Other guinea pigs live in the meadow and woods. Walk up gently and hold ${kb('C','the Chat button')} to befriend them — piggies are happier in a herd!`,'',8),10000)})};
  // "Back to your last save" after a game over reloads the page and lands here
  {let r=null;try{r=sessionStorage.getItem('wheek-continue');sessionStorage.removeItem('wheek-continue')}catch(e){}if(r&&lsGet(slotKey(+r),null))continueGame(+r)}
  $('dice').onclick=()=>{let n;do{n=PIG_NAMES[Math.floor(Math.random()*PIG_NAMES.length)]}while(n===$('pigName').value);$('pigName').value=n};
  $('setBtn').onclick=openSettings;$('setBtn2').onclick=openSettings;$('setClose').onclick=closeSettings;applyQuality();
  $('resumeBtn').onclick=()=>togglePause(false);$('saveBtn').onclick=()=>saveGame();$('quitBtn').onclick=()=>{saveGame(true);location.reload()};$('jclose').onclick=closeJournal;$('againBtn').onclick=()=>location.reload();
  $('retryBtn').onclick=()=>{try{sessionStorage.setItem('wheek-continue',G.slot)}catch(e){}location.reload()};
  window.__game={G,W,WS,ZONE,PARK,EDGE,ITEMS,AGI,AGI_COURSE,WEAVE_X,WEAVE_Z,startRaft,creekAt,offerSwap,insideCollide,TUBE_NODES,startGnaw,gnawHit,enterBarn:enterInside,exitBarn:exitInside,enterInside,exitInside,enterTube:n=>enterTube(n),catNoise:n=>catNoise(n),startBurrow,popOut,insideHeight,revealItem,setInput,SET,sun,music:()=>({now:musicNow&&musicNow.k,gain:musicGain&&musicGain.gain.value,tracks:Object.fromEntries(Object.entries(MUSIC).map(([k,m])=>[k,m.buf?{dur:+m.buf.duration.toFixed(4),start:m.start,len:m.len}:null]))}),wSdf,neighbour,freeAt,Z:()=>Z,visit:(id,x=0,z=0,h=0)=>arriveZone(ZONE[id],0,{x,z,h}),enterWarren,exitWarren,pig,friends,herd,joinHerd,keys,applyLook,humans,tunnels,spots,hawk,foxes,heightAt,renderer,scene,camera};
})().catch(e=>{console.error(e);$('loading').textContent='Failed to load: '+e.message});
