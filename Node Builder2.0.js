const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let img = null;
let nodes = []; //{id, name, x, y, links:[id,...]}
let calibPoints = []; // {x, y, lat, lng} - known reference points
let transform = null; // {latCoef:[a,b,c], lngCoef:[d,e,f]} once 3+ valid points exist
let mode = 'add';
let linkFirst = null;
let nextNum = 1;
 
document.getElementById('fileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      draw();
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});
 
document.getElementById('modeAdd').addEventListener('click', () => setMode('add'));
document.getElementById('modeLink').addEventListener('click', () => setMode('link'));
document.getElementById('modeCalib').addEventListener('click', () => setMode('calib'));
function setMode(m){
  mode = m; linkFirst = null;
  document.getElementById('modeAdd').classList.toggle('active', m === 'add');
  document.getElementById('modeLink').classList.toggle('active', m === 'link');
  document.getElementById('modeCalib').classList.toggle('active', m === 'calib');
  draw();
}
 
canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = Math.round((e.clientX - rect.left) * scaleX);
  const y = Math.round((e.clientY - rect.top) * scaleY);
 
  if (mode === 'add') {
    const name = prompt('Name this location (e.g. "Library"):');
    if (!name) return;
    const id = slugify(name);
    nodes.push({ id, name, x, y, links: [] });
    nextNum++;
    refreshList(); draw();
  } else if (mode === 'link') {
    const hit = nearestNode(x, y);
    if (!hit) return;
    if (!linkFirst) { linkFirst = hit; draw(); return; }
    if (linkFirst.id !== hit.id) toggleLink(linkFirst, hit);
    linkFirst = null;
    draw();
  } else if (mode === 'calib') {
    const raw = prompt( 'Enter the real latitude, longitude for this exact spot (e.g. "-25.7461, 28.1881"):\n\nTip: right-click the spot on the Googlr Maps and copy the coordinates shown.');
    if (!raw) return;
    const parts = raw.split(',').maps(s => parseFloat(s.trim()));
     if (parts.length !== 2 || parts.some(isNaN)) { alert('Could not read that as "lat, lng" - try again.'); return; }
    calibPoints.push({ x, y, lat: parts[0], lng: parts[1] });
    computeTransform();
    refreshCalibList(); refreshList(); draw();
  }
});

function nearestNode(x, y){
  let best = null, bestD = 20 * 20; // 20px click radius (in image pixels)
  for (const n of nodes){
    const d = (n.x-x)**2 + (n.y-y)**2;
    if (d < bestD){ bestD = d; best = n; }
  }
  return best;
}
function toggleLink(a, b){
  const has = a.links.includes(b.id);
  if (has){
    a.links = a.links.filter(id => id !== b.id);
    b.links = b.links.filter(id => id !== a.id);
  } else {
    a.links.push(b.id);
    b.links.push(a.id);
  }
}
function slugify(name){
  let base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '');
  if (!base) base = 'node';
  let id = base, i = 1;
  while (nodes.some(n => n.id === id)) { id = base + (i++); }
  return id;
}
 
// ---- Pixel -> GPS calibration -------------------------------------------
// Fits lat = a*x + b*y + c  and  lng = d*x + e*y + f  from the calibration
// points using least squares (exact when there are exactly 3 points, an
// averaged best fit when there are more). This is a flat-plane approximation
// which is accurate enough for a single campus (a few hundred metres across).
function solve3x3(M, rhs){
  const det = m => m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])
                  - m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])
                  + m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
  const D = det(M);
  if (Math.abs(D) < 1e-9) return null; // degenerate: points are collinear
  const withCol = (col, vec) => M.map((row,i) => row.map((v,j) => j===col ? vec[i] : v));
  return [det(withCol(0,rhs))/D, det(withCol(1,rhs))/D, det(withCol(2,rhs))/D];
}
function computeTransform(){
  if (calibPoints.length < 3) { transform = null; return; }
  let Sxx=0,Sxy=0,Sx=0,Syy=0,Sy=0,S1=0, SxLat=0,SyLat=0,SLat=0, SxLng=0,SyLng=0,SLng=0;
  calibPoints.forEach(p => {
    Sxx+=p.x*p.x; Sxy+=p.x*p.y; Sx+=p.x; Syy+=p.y*p.y; Sy+=p.y; S1+=1;
    SxLat+=p.x*p.lat; SyLat+=p.y*p.lat; SLat+=p.lat;
    SxLng+=p.x*p.lng; SyLng+=p.y*p.lng; SLng+=p.lng;
  });
  const M = [[Sxx,Sxy,Sx],[Sxy,Syy,Sy],[Sx,Sy,S1]];
  const latCoef = solve3x3(M, [SxLat,SyLat,SLat]);
  const lngCoef = solve3x3(M, [SxLng,SyLng,SLng]);
  transform = (latCoef && lngCoef) ? { latCoef, lngCoef } : null;
}
function pixelToGeo(x, y){
  if (!transform) return null;
  const [a,b,c] = transform.latCoef;
  const [d,e,f] = transform.lngCoef;
  return { lat: a*x + b*y + c, lng: d*x + e*y + f };
}
function refreshCalibList(){
  document.getElementById('calibCount').textContent = calibPoints.length;
  const statusEl = document.getElementById('calibStatus');
  if (calibPoints.length < 3){
    statusEl.textContent = `Add ${3 - calibPoints.length} more point(s) to enable lat/lng conversion.`;
    statusEl.className = 'bad';
  } else if (!transform){
    statusEl.textContent = 'Points look collinear (all in a line) - pick points spread across the image.';
    statusEl.className = 'bad';
  } else {
    statusEl.textContent = `Calibrated from ${calibPoints.length} point(s). Node lat/lng shown below and in export.`;
    statusEl.className = 'ok';
  }
  const ul = document.getElementById('calibList');
  ul.innerHTML = '';
  calibPoints.forEach((p, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>C${i+1} <small>(${p.x}, ${p.y}) → ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</small></span>`;
    const del = document.createElement('button');
    del.textContent = '✕'; del.className = 'danger';
    del.onclick = () => { calibPoints.splice(i,1); computeTransform(); refreshCalibList(); refreshList(); draw(); };
    li.appendChild(del);
    ul.appendChild(li);
  });
}
document.getElementById('clearCalib').addEventListener('click', () => {
  if (calibPoints.length && !confirm('Remove all calibration points?')) return;
  calibPoints = []; transform = null; refreshCalibList(); refreshList(); draw();
});
 
function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if (img) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  else { ctx.fillStyle = '#ddd'; ctx.fillRect(0,0,canvas.width,canvas.height); }
 
  // links
  ctx.strokeStyle = '#C08A2E'; ctx.lineWidth = 2;
  const drawn = new Set();
  nodes.forEach(n => n.links.forEach(lid => {
    const key = [n.id, lid].sort().join('-');
    if (drawn.has(key)) return; drawn.add(key);
    const t = nodes.find(x => x.id === lid);
    if (!t) return;
    ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(t.x, t.y); ctx.stroke();
  }));
 
  // calibration points (red crosses)
  ctx.strokeStyle = '#a8452f'; ctx.lineWidth = 2;
  calibPoints.forEach((p, i) => {
    ctx.beginPath();
    ctx.moveTo(p.x-7,p.y); ctx.lineTo(p.x+7,p.y);
    ctx.moveTo(p.x,p.y-7); ctx.lineTo(p.x,p.y+7);
    ctx.stroke();
    ctx.fillStyle = '#a8452f';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillText('C'+(i+1), p.x+9, p.y+4);
  });
 
  // nodes
  nodes.forEach(n => {
    ctx.beginPath();
    ctx.arc(n.x, n.y, 8, 0, Math.PI*2);
    ctx.fillStyle = (linkFirst && linkFirst.id === n.id) ? '#C08A2E' : '#1E4C52';
    ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#152A33';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText(n.name, n.x + 12, n.y - 10);
  });
}
 
function refreshList(){
  document.getElementById('count').textContent = nodes.length;
  const ul = document.getElementById('nodeList');
  ul.innerHTML = '';
  nodes.forEach(n => {
    const geo = pixelToGeo(n.x, n.y);
    const geoText = geo ? ` · ${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}` : '';
    const li = document.createElement('li');
    li.innerHTML = `<span>${n.name} <small>(${n.x}, ${n.y}) · ${n.links.length} link(s)${geoText}</small></span>`;
    const del = document.createElement('button');
    del.textContent = '✕'; del.className = 'danger';
    del.onclick = () => {
      nodes.forEach(m => m.links = m.links.filter(id => id !== n.id));
      nodes = nodes.filter(m => m.id !== n.id);
      refreshList(); draw();
    };
    li.appendChild(del);
    ul.appendChild(li);
  });
}
 
document.getElementById('clearAll').addEventListener('click', () => {
  if (nodes.length && !confirm('Remove all nodes?')) return;
  nodes = []; refreshList(); draw();
});
 
document.getElementById('exportBtn').addEventListener('click', () => {
  const lines = nodes.map(n => {
    const geo = pixelToGeo(n.x, n.y);
    const geoFields = geo ? `, lat:${geo.lat.toFixed(6)}, lng:${geo.lng.toFixed(6)}` : '';
    return `  { id:"${n.id}", name:"${n.name}", x:${n.x}, y:${n.y}${geoFields}, links:[${n.links.map(l=>'"'+l+'"').join(',')}] },`;
  });
  const calibNote = transform
    ? `// lat/lng on each node were computed from ${calibPoints.length} GPS calibration point(s).`
    : `// NOTE: no lat/lng included - add 3+ GPS calibration points (not in a line) to enable this.`;
  const code =
`// Paste this in place of the "nodes" array in eduvos-streetview.js
// Also set the SVG viewBox in eduvos-streetview.html to:
//   viewBox="0 0 ${canvas.width} ${canvas.height}"
// so these coordinates line up with your map image.
${calibNote}
const nodes = [
${lines.join('\n')}
];`;
  document.getElementById('output').value = code;
});


