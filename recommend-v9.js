// Recommendations: heuristic and uncalibrated, not a trained model.
window.installThreeCushionRecommendations = function(env){
const {$,R,stop,config,sim,vals}=env;
// v5 클로저 안의 기존 $('#search').onclick 블록을 이 코드로 교체한다.
// 계약: $, R, env.getOriginal(), balls, env.results, stop, config, sim, vals.
// 복원 기능을 사용하는 다른 클로저 코드에서는 restoreRecommendation()을 호출한다.
let lastRecommendation = null;
function restoreRecommendation() {
  const v = lastRecommendation;
  if (!v || JSON.stringify(env.getOriginal()) !== v.layout || +$('#cue').value !== v.cue || config().cloth !== v.cloth || JSON.stringify(config().physics)!==JSON.stringify(v.physics)) return false;
  const ids = ['angle','power','side','top','stroke'];
  const previous = ids.map(id => $('#'+id).value);
  $('#angle').value = v.deg; $('#power').value = v.power;
  $('#side').value = v.sideUI; $('#top').value = v.topUI; $('#stroke').value = '0';
  const check = sim(config(), true);
  if (!check.score) {
    ids.forEach((id,i) => { $('#'+id).value = previous[i]; });
    lastRecommendation = null; vals(); return false;
  }
  if (check.firstContact) $('#targetBall').value = check.firstContact.target;
  stop(); env.setBalls(env.getOriginal().map(b => ({...b}))); vals();
  return true;
}
$('#search').onclick = () => {
  stop();
  const button = $('#search'), box = $('#shots');
  if (env.getOriginal().some((b,i) => env.getOriginal().some((c,j) => j>i && Math.hypot(b.x-c.x,b.y-c.y)<2*R))) {
    env.results=[]; lastRecommendation=null; box.textContent='공이 겹쳐 추천할 수 없습니다.';
    $('#status').textContent='공끼리 겹치지 않도록 옮겨주세요.'; return;
  }
  const base=config(), layout=JSON.stringify(env.getOriginal()), started=performance.now();
  const deadline=started+12000, searchDeadline=started+8500, maxTrials=2400, seedQuota={direct:12,rail:12}, seedCounts={direct:0,rail:0};
  const changed=()=>JSON.stringify(env.getOriginal())!==layout || +$('#cue').value!==base.cue || config().cloth!==base.cloth || JSON.stringify(config().physics)!==JSON.stringify(base.physics);
  // 실제 DOM에 쓰고 config()로 읽어 범위·스텝·타법과 physics 계약을 그대로 따른다.
  function quantize(deg,power,side,top) {
    const ids=['angle','power','side','top','stroke'], saved=ids.map(id=>$('#'+id).value);
    try {
      deg=((deg+180)%360+360)%360-180;
      $('#angle').value=(Math.round(deg*10)/10).toFixed(1);
      $('#power').value=Math.round(power); $('#side').value=Math.round(side); $('#top').value=Math.round(top); $('#stroke').value='0';
      const o=config();
      return {o,deg:+$('#angle').value,power:+$('#power').value,sideUI:+$('#side').value,topUI:+$('#top').value};
    } finally { ids.forEach((id,i)=>{$('#'+id).value=saved[i]}); }
  }
  const jobs=[], seen=new Set(), seeds=[], validated=[];
  function add(deg,p,s,t) {
    if(Math.hypot(s,t)>80.0001) return;
    const q=quantize(deg,p,s,t), key=[q.deg,q.power,q.sideUI,q.topUI].join('/');
    if(!seen.has(key)){seen.add(key);jobs.push(q)}
  }
  // 직구 가능 구간을 균일 분할하고 전방위 쿠션 먼저 경로를 번갈아 탐색한다.
  const angles=[], cueBall=env.getOriginal()[base.cue];
  for(let k=0;k<3;k++) if(k!==base.cue){
    const d=env.getOriginal()[k], dx=d.x-cueBall.x,dy=d.y-cueBall.y,dist=Math.hypot(dx,dy);
    if(dist<=2*R) continue;
    const center=Math.atan2(dy,dx)*180/Math.PI, span=Math.asin(Math.min(1,2*R/dist))*180/Math.PI;
    for(let i=-9;i<=9;i++) angles.push(center+span*i/10);
  }
  const powers=[Math.round(base.p*100),70,85,100,55];
  const tips=[[0,0],[40,0],[-40,0],[0,50],[0,-50],[60,0],[-60,0],[30,40],[-30,40],[30,-40],[-30,-40]];
  // 탐색 앞부분에서도 다양한 설정을 보도록 각도·조건을 섞는다.
  for(let round=0;round<tips.length*powers.length;round++) {
    const tip=tips[round%tips.length], p=powers[Math.floor(round/tips.length)];
    for(let i=0;i<Math.max(angles.length,36);i++){
      if(i<angles.length) add(angles[i],p,tip[0],tip[1]);
      if(i<36) add(-180+i*10+(round%2)*5,p,tip[0],tip[1]);
    }
  }
  button.disabled=true; env.results=[]; lastRecommendation=null;
  box.textContent='제한된 후보를 탐색하고 화면 적용값을 재검사합니다.';
  let index=0, examined=0, phase='탐색';
  function finish() {
    button.disabled=false;
    if(changed()){ env.results=[]; lastRecommendation=null; box.textContent='조건이 바뀌어 탐색을 중단했습니다. 다시 찾아주세요.'; $('#status').textContent='탐색 중단'; return; }
    function utility(v){let thick=v.r.firstContact?.fraction??.5,robust=v.tests?v.hits/v.tests:0;return robust*100+(v.r.seq[0]!=='쿠션'?6:0)-Math.max(0,v.power-75)*.7-Math.abs(v.sideUI)*.12-(thick<.25?30:0)-(thick>.9?18:0)-v.r.recontact*20}
    validated.sort((a,b)=>utility(b)-utility(a));
    const isDirect=v=>v.r.firstContact?.railsBefore===0;
    // 실전 난이도 판정이 아닌, 모형에서 조건부로 직접 공을 우선하는 임시 기준이다.
    const reasonableDirect=v=>isDirect(v)&&v.tests>=4&&v.hits>=4&&v.hits/v.tests>=2/3&&v.power<=85&&Math.abs(v.sideUI)<=40&&Math.abs(v.topUI)<=50&&!v.r.recontact&&v.r.firstContact.fraction>=.25&&v.r.firstContact.fraction<=.90;
    const preferred=validated.find(reasonableDirect);
    env.results=[];
    function addDistinct(v){if(!v||env.results.length>=3)return false;if(env.results.some(q=>Math.abs(((q.deg-v.deg+540)%360)-180)<8 && q.r.hit[0]===v.r.hit[0] && isDirect(q)===isDirect(v)))return false;env.results.push(v);return true}
    if(preferred){
      addDistinct(preferred);
      // 비슷한 적구 먼저 대안은 하나만 더 보여주고, 유효한 쿠션 먼저 대안도 한 자리를 남긴다.
      for(const v of validated.filter(reasonableDirect)) if(addDistinct(v))break;
      if(env.results.length<3)for(const v of validated.filter(v=>!isDirect(v)))if(addDistinct(v))break;
    }else addDistinct(validated[0]);
    // 대안도 모형상 극단적으로 얇거나 민감한 후보보다 상대적으로 무난한 후보를 먼저 보여준다.
    const moderate=v=>v.tests>=4&&v.hits/v.tests>=1/3&&v.r.firstContact.fraction>=.20&&v.r.firstContact.fraction<=.95&&v.power<=90;
    for(const v of validated.filter(moderate)){if(env.results.length>=3)break;addDistinct(v)}
    for(const v of validated){if(env.results.length>=3)break;addDistinct(v)}
    box.textContent='';
    if(!env.results.length){ box.textContent='제한된 탐색에서 화면 적용값으로 득점하는 후보를 찾지 못했습니다. 득점 코스가 없다는 뜻은 아닙니다.'; }
    else env.results.forEach((v,i)=>{
      const el=document.createElement('button');
      const fc=v.r.firstContact, first=fc?`${['흰 공','노란 공','빨간 공'][fc.target]} · 약 ${Math.round(fc.fraction*100)}% · ${fc.side}`:'확인 불가';
      const cushion=v.r.firstCushion, walls={left:'왼쪽 단쿠션',right:'오른쪽 단쿠션',top:'위 장쿠션',bottom:'아래 장쿠션'}, aim=cushion?(walls[cushion.wall]+' ('+(cushion.x*100).toFixed(1)+', '+(cushion.y*100).toFixed(1)+')cm'):'미확인';
      const tip=(v.topUI>0?'상단':v.topUI<0?'하단':'중단')+' / '+(v.sideUI>0?'오른쪽':v.sideUI<0?'왼쪽':'중앙');
      const easy=v.tests>=4&&v.hits>=4&&v.hits/v.tests>=2/3&&v.power<=85&&Math.abs(v.sideUI)<=40&&Math.abs(v.topUI)<=50&&!v.r.recontact&&fc&&fc.fraction>=.25&&fc.fraction<=.9;
      const reason=easy?'작은 입력 변화에 비교적 여유':'모형상 힘·두께·회전 또는 여유 확인 필요';
      const priority=i===0&&preferred===v?'적구 먼저 우선 기준 충족 · ':i===0&&!preferred?'우선 기준에 맞는 적구 먼저 후보 없음 · ':'';
      el.textContent=`${i===0?'추천':'대안 '+i} · ${v.r.seq[0]==='쿠션'?'쿠션 먼저':'적구 먼저'}\n쿠션 ${v.r.rails}회 · 힘 ${v.power}% · 방향 ${v.deg}°\n첫 적구 ${first}\n당점 ${tip} (좌우 ${v.sideUI}, 상하 ${v.topUI})\n첫 쿠션 ${aim}\n${priority}${reason} · 모형상 ${easy?'보통':'주의'}\n재접촉 ${v.r.recontact}회 · 모형 민감도 ${v.hits}/${v.tests} (변경 후 득점)`;
      el.style.whiteSpace='pre-line';
      el.onclick=()=>{
        if(changed()){box.textContent='조건이 바뀌어 추천을 다시 찾아주세요.';env.results=[];lastRecommendation=null;return;}
        lastRecommendation={...v.o,deg:v.deg,power:v.power,sideUI:v.sideUI,topUI:v.topUI,layout};
        if(!restoreRecommendation()){el.disabled=true;$('#status').textContent='화면 적용값 재검증 실패로 후보를 폐기했습니다.'; return;}
        box.querySelectorAll('button').forEach(b=>b.classList.remove('selected')); el.classList.add('selected');
        $('#status').textContent=(i?'대안 '+i:'추천')+' 적용 · 화면 미리보기와 실행 설정 재검증 완료';
      };
      box.appendChild(el);
    });
    const note=document.createElement('p'); note.className='small';
    note.textContent=`${examined}개 제한 탐색 (적구 먼저 시드 ${seedCounts.direct}개 · 쿠션 먼저 시드 ${seedCounts.rail}개). 적구 먼저 우선은 모형 기준을 만족하는 경우에만 적용합니다. 민감도는 방향 ±0.5°, 힘 ±4%, 좌우 당점 ±5의 유효한 단일 변경값을 기본 모형으로 다시 계산한 득점 횟수이며 실제 성공 확률이 아닙니다. 난이도와 이유는 임의 모형 기준이며 지도자 검수가 없습니다. 재접촉은 모형상 관찰값이지 실제 키스 위험 판정이 아닙니다. 첫 쿠션 좌표는 수구 중심입니다. 천·수구는 현재 설정, 타법은 보통입니다. 샷 유형 분류·지도자 검수 템플릿·인기도는 검증되지 않아 미구현. 실측 검증이 아닙니다.`;
    box.appendChild(note);
    $('#status').textContent=`탐색 완료 · 검증 후보 ${env.results.length}개 · ${examined}개 시도`;
    if(env.results.length) box.querySelector('button').click();
  }
  function step(){
    if(changed()){finish();return;}
    const sliceEnd=performance.now()+35;
    while(performance.now()<sliceEnd){
      if(phase==='탐색'){
        if(index>=jobs.length || examined>=maxTrials || performance.now()>=searchDeadline || (seedCounts.direct>=seedQuota.direct && seedCounts.rail>=seedQuota.rail)){phase='검증';index=0;continue;}
        const q=jobs[index++];examined++;
        const fast=sim(q.o,false,.375), kind=fast.firstContact?.railsBefore===0?'direct':'rail';
        if(fast.score && fast.firstContact && seedCounts[kind]<seedQuota[kind]) {seedCounts[kind]++;seeds.push(q);}
      } else {
        if(index>=seeds.length || performance.now()>=deadline+4000){finish();return;}
        const q=seeds[index++];
        // 미리보기·실행과 동일한 record=true, 기본 precision으로 득점 확인.
        const r=sim(q.o,true);
        if(!r.score || !r.firstContact || r.truncated || r.simultaneous) continue;
        let hits=0,tests=0;
        for(const [da,dp,ds] of [[-.5,0,0],[.5,0,0],[0,-4,0],[0,4,0],[0,0,-5],[0,0,5]]) {
          const p=q.power+dp,s=q.sideUI+ds;
          if(p<20||p>100||Math.hypot(s,q.topUI)>80) continue;
          const perturb=quantize(q.deg+da,p,s,q.topUI);
          if(perturb.deg===q.deg && perturb.power===q.power && perturb.sideUI===q.sideUI) continue;
          tests++; if(sim(perturb.o,false).score) hits++;
        }
        validated.push({...q,r,hits,tests});
      }
    }
    $('#status').textContent=`추천 ${phase} 중 · ${examined}개 시도`;
    setTimeout(step,0);
  }
  setTimeout(step,0);
};

$('#restoreShot').onclick=()=>{if(restoreRecommendation())$('#status').textContent='선택했던 추천 조건을 복원했습니다.';else $('#status').textContent='복원할 추천이 없거나 배치·당구대 조건이 바뀌었습니다.'};

};
