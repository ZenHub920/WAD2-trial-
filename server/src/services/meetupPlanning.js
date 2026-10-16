export const SLOT_MS=30*60*1000;
export function distanceKm(a,b) {
 const rad=d=>d*Math.PI/180,dlat=rad(b.latitude-a.latitude),dlon=rad(b.longitude-a.longitude);
 const h=Math.sin(dlat/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(dlon/2)**2;
 return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
export function rankMeetupOptions({startsAt,endsAt,availability,places,participantCount,durationMinutes=30,maxDistanceKm=15}) {
 const duration=durationMinutes*60000,options=[];
 for(let start=startsAt;start+duration<=endsAt;start+=SLOT_MS) {
  const people=new Map();
  for(const row of availability)if(row.starts_at<=start&&row.ends_at>=start+duration)people.set(row.user_id,row);
  for(const place of places) {
   const distances=[...people.values()].filter(p=>p.latitude!==null&&p.longitude!==null).map(p=>distanceKm(p,place));
   const reachable=distances.filter(d=>d<=maxDistanceKm).length;
   options.push({placeId:place.id,label:place.label,startsAt:start,endsAt:start+duration,
    availableCount:people.size,participantCount,locationRespondents:distances.length,reachableCount:reachable,
    totalDistanceKm:Math.round(distances.reduce((a,b)=>a+b,0)*100)/100,
    maximumDistanceKm:distances.length?Math.round(Math.max(...distances)*100)/100:null,
    votes:place.votes??0});
  }
 }
 return options.sort((a,b)=>b.availableCount-a.availableCount||b.reachableCount-a.reachableCount||a.totalDistanceKm-b.totalDistanceKm
   ||(a.maximumDistanceKm??Infinity)-(b.maximumDistanceKm??Infinity)||b.votes-a.votes||a.startsAt-b.startsAt||a.placeId.localeCompare(b.placeId)).slice(0,20);
}
