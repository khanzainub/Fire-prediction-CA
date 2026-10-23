// Bundled locally so the API key is never sent to a third-party module host.
import { parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import { DEFAULT_PARSERS } from 'hyparquet/src/convert.js';
export async function decode(buffer,kind){
 const rows=await parquetReadObjects({file:buffer,columns:['osm_id','geom'],compressors});
 const ways=[];
 for(const row of rows){
  const g=row.geom instanceof Uint8Array?DEFAULT_PARSERS.geometryFromBytes(row.geom):row.geom;
  if(!g)throw Error('ohsome returned a missing geometry');
  const lines=g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'||g.type==='Polygon'?g.coordinates:g.type==='MultiPolygon'?g.coordinates.flat():null;
  if(!lines)throw Error('Unexpected ohsome geometry type: '+g.type);
  for(let part=0;part<lines.length;part++){
   const line=lines[part];if(line.length<2)throw Error('Incomplete ohsome line');
   const geometry=line.map(p=>({lon:p[0],lat:p[1]}));
   if(geometry.some(p=>!Number.isFinite(p.lon)||!Number.isFinite(p.lat)||Math.abs(p.lon)>180||Math.abs(p.lat)>90))throw Error('Invalid ohsome coordinates');
   ways.push({id:String(row.osm_id)+':'+part,kind,geometry});
  }
 }
 return ways;
}
