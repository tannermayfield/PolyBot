const fs = require('node:fs');
// Rebuild: download https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson
// then run: node regions-build-map.cjs /path/to/countries.geojson
if (!process.argv[2]) { console.error('Usage: node regions-build-map.cjs <countries.geojson>'); process.exit(1); }
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const selected = new Set('MX GT HN SV NI CR PA CU DO PR CO VE EC PE BO PY CL AR UY ES GQ'.split(' '));
function simplify(points, epsilon) {
  if(points.length<3)return points;
  const [a,b]=[points[0],points.at(-1)];let far=0,idx=0;
  points.forEach((p,i)=>{const dx=b[0]-a[0],dy=b[1]-a[1], t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));const d=Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);if(d>far){far=d;idx=i;}});
  return far>epsilon?[...simplify(points.slice(0,idx+1),epsilon).slice(0,-1),...simplify(points.slice(idx),epsilon)]:[a,b];
}
const paths=[];
for(const f of data.features){
 const id=f.properties['ISO3166-1-Alpha-2'];
 const polygons=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;
 let d='';
 for(const poly of polygons){
  const ring=poly[0];
  if(!ring.some(([x,y])=>x>=-120&&x<=22&&y>=-58&&y<=53))continue;
  const points=simplify(ring,selected.has(id)?.055:.16);
  if(points.length<4)continue;
  d+=points.map(([x,y],i)=>(i?'L':'M')+((x+120)*4).toFixed(1)+','+((53-y)*4).toFixed(1)).join('')+'Z';
 }
 if(d)paths.push({id,d});
}
fs.writeFileSync('regions-map.json',JSON.stringify({source:'Natural Earth public-domain geographic data, via datasets/geo-countries',url:'https://github.com/datasets/geo-countries',viewBox:'0 0 568 444',paths}));
console.log(paths.length,fs.statSync('regions-map.json').size);
