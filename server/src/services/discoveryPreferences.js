export const CONCEPTS = [
  { id:'post_supper', label:'Food after the concert', aliases:['supper','late night makan','post concert food','get food after the show','supper buddies'] },
  { id:'pre_meetup', label:'Meet before the concert', aliases:['pre show meetup','meet beforehand','pre concert meetup'] },
  { id:'merch_run', label:'Merchandise shopping', aliases:['merch','merch queue','buy merch','merch hunting'] },
  { id:'transport_share', label:'Share transport', aliases:['carpool','share a ride','travel together'] },
  { id:'singalong', label:'Sing along', aliases:['singing loudly','singalong','screamer','scream lyrics'] },
  { id:'quiet', label:'Quiet listening', aliases:['chill','quiet group','listen quietly'] },
  { id:'dancing', label:'Dancing', aliases:['dance','energetic dancing'] },
  { id:'photography', label:'Photography', aliases:['photos','take pictures','concert photography'] },
  { id:'early_queue', label:'Queue early', aliases:['early queue','queue early','arrive early'] },
  { id:'doors', label:'Arrive at doors', aliases:['arrive at doors','doors arrival'] },
  { id:'public_transport', label:'Take public transport', aliases:['mrt','bus','train','take the mrt'] },
  { id:'hearing_protection', label:'Bring concert earplugs', aliases:['earplugs','hearing protection','protect hearing'] },
  { id:'hydration_breaks', label:'Take water and rest breaks', aliases:['water breaks','hydration breaks','rest breaks'] },
  { id:'pre_food', label:'Food before the concert', aliases:['dinner beforehand','pre show dinner','eat before the show'] },
  { id:'phone_light', label:'Keep phone use minimal', aliases:['phone free','no filming','minimal phone use'] },
  { id:'group_photos', label:'Take group photos before or after', aliases:['group photos','group pictures'] },
];
export const normalize = value => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const aliases = new Map(CONCEPTS.flatMap(c => [c.id,c.label,...c.aliases].map(a => [normalize(a),c.id])));
export function suggestions(text='') {
  const query=normalize(text);
  if (!query) return CONCEPTS;
  const words=new Set(query.split(' '));
  return CONCEPTS.map(c => ({...c, relevance:Math.max(...[c.label,...c.aliases].map(a => {
    const n=normalize(a); if(n===query) return 1; if(n.includes(query)) return 0.9;
    const tokens=n.split(' '); return tokens.filter(t=>words.has(t)).length / Math.max(words.size,tokens.length);
  }))})).filter(c=>c.relevance>0).sort((a,b)=>b.relevance-a.relevance || a.id.localeCompare(b.id)).slice(0,10);
}
export function validateAnswers(input) {
  if (!input || typeof input!=='object' || Array.isArray(input)) throw Object.assign(new Error('preferences_required'),{status:400});
  const output={};
  for(const intent of ['about','wants','avoid']) {
    const entries=input[intent]??[];
    if(!Array.isArray(entries)||entries.length>30) throw Object.assign(new Error('invalid_preferences'),{status:400});
    const seen=new Set(); output[intent]=[];
    for(const entry of entries) {
      const text=typeof entry==='string'?entry:entry?.text;
      if(typeof text!=='string'||!text.trim()||text.length>100) throw Object.assign(new Error('invalid_preference_text'),{status:400});
      const explicit=typeof entry==='object'?entry.conceptId:null;
      if(explicit&&!CONCEPTS.some(c=>c.id===explicit)) throw Object.assign(new Error('unknown_concept'),{status:400});
      const key=explicit||aliases.get(normalize(text))||`custom:${normalize(text)}`;
      if(!seen.has(key)){output[intent].push({key,text:text.trim(),recognized:!key.startsWith('custom:')});seen.add(key);}
    }
  }
  return output;
}
export function aggregateAnswers(answers) {
  const profile={about:{},wants:{},avoid:{},respondents:answers.length};
  for(const a of answers) for(const intent of ['about','wants','avoid']) for(const item of a[intent]??[]) {
    profile[intent][item.key]=(profile[intent][item.key]??0)+1/Math.max(1,answers.length);
  }
  return profile;
}
export const individualProfile = answers => aggregateAnswers([answers]);
export function compareProfiles(a,b) {
  const direction=(from,to)=>{
    let total=0,weight=0; const evidence=[];
    for(const [key,support] of Object.entries(from.wants)) {
      const w=support*(key.startsWith('custom:')?0.2:1);weight+=w;
      const overlap=to.about[key]??0;total+=w*overlap;
      if(overlap>0)evidence.push({key,support:overlap,strength:w*overlap});
    }
    const avoid=Object.entries(from.avoid).reduce((sum,[key,support])=>sum+support*(to.about[key]??0),0);
    return {score:Math.max(0,(weight?total/weight:0.5)-Math.min(0.5,avoid/Math.max(1,Object.keys(from.avoid).length))),evidence};
  };
  const ab=direction(a,b),ba=direction(b,a);
  const shared=Object.entries(a.about).filter(([key])=>b.about[key]).map(([key,support])=>({key,support:Math.min(support,b.about[key]),strength:Math.min(support,b.about[key])}));
  const evidence=[...ab.evidence,...ba.evidence,...shared].sort((x,y)=>y.strength-x.strength||x.key.localeCompare(y.key));
  const reasons=[...new Map(evidence.map(e=>[e.key,{concept:e.key,label:CONCEPTS.find(c=>c.id===e.key)?.label??e.key.slice(7),support:Math.round(e.support*100)}])).values()].slice(0,3);
  return {score:Math.round((ab.score+ba.score)/2*10000)/10000,seekerScore:ab.score,groupScore:ba.score,reasons,
    confidence:a.respondents&&b.respondents&&evidence.length?'supported':'limited'};
}
