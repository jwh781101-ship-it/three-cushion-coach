// Three-cushion physics module: approximate, not calibrated.
window.createThreeCushionEngine = function({getOriginal,W,H,R,dt}) {
return function sim(o, record = false, precision = 1) {
  // Piecewise-linear continuous collision detection; cloth impulses are discretized.
  // Simultaneous contacts are resolved sequentially, not as a coupled impact system.
  const P=o.physics || {}, param=(key,def,lo,hi)=>Number.isFinite(P[key])?Math.max(lo,Math.min(hi,P[key])):def;
  const g=9.81,k=.4,eps=1e-10, tol=1e-9;
  const muSlide=param('muSlide',.20,0,1), muRoll=param('muRoll',Number.isFinite(o.cloth)?Math.max(0,Math.min(1,o.cloth)):.008,0,1), muSpin=param('muSpin',.012,0,1);
  const eBall=param('eBall',.94,0,1), muBall=param('muBall',.05,0,1), eRail=param('eRail',.82,0,1), muRail=param('muRail',.14,0,1);
  const names=['흰 공','노란 공','빨간 공'], cue=o.cue;
  const b=getOriginal().map(p=>({x:p.x,y:p.y,vx:0,vy:0,wx:0,wy:0,wz:0})), c=b[cue];
  const speed=1+o.p*3.1,dx=Math.cos(o.a),dy=Math.sin(o.a);
  c.vx=speed*dx;c.vy=speed*dy;c.wx=-dy*o.top*.75*speed/R;c.wy=dx*o.top*.75*speed/R;c.wz=-o.side*.55*speed/R;
  let hit=[],rails=0,score=false,seq=[],frames=[],points=[],times=[],recontact=0,truncated=false,firstContact=null,firstCushion=null;
  let events=[],decided=false,time=0,distance=0,simultaneous=false,invalidInitial=false;
  const cueContact=new Set();
  const clamp=(x,a,z)=>Math.max(a,Math.min(z,x));
  const state=()=>b.map(q=>({x:q.x,y:q.y}));
  function frame(){if(!record)return; if(times.length && Math.abs(times[times.length-1]-time)<1e-12){frames[frames.length-1]=state();points[points.length-1]={x:c.x,y:c.y};return;} frames.push(state());points.push({x:c.x,y:c.y});times.push(time);}
  function cloth(q,h){
    let ux=q.vx-R*q.wy,uy=q.vy+R*q.wx,u=Math.hypot(ux,uy);
    if(u>eps){let j=Math.min(muSlide*g*h,u/(1+1/k)),jx=-j*ux/u,jy=-j*uy/u;q.vx+=jx;q.vy+=jy;q.wx+=jy/(k*R);q.wy-=jx/(k*R);}
    ux=q.vx-R*q.wy;uy=q.vy+R*q.wx;
    if(Math.hypot(ux,uy)<1e-7){let v=Math.hypot(q.vx,q.vy);if(v>0){let f=Math.max(0,1-muRoll*g*h/v);q.vx*=f;q.vy*=f;q.wx=-q.vy/R;q.wy=q.vx/R;}}
    q.wz=Math.sign(q.wz)*Math.max(0,Math.abs(q.wz)-muSpin*g*h/R);
  }
  function move(h){distance+=Math.hypot(c.vx,c.vy)*h;for(const q of b){q.x+=q.vx*h;q.y+=q.vy*h;}time+=h;for(const i of cueContact)if(Math.hypot(c.x-b[i].x,c.y-b[i].y)>2*R+1e-7)cueContact.delete(i);}
  function emit(ev){if(events.length&&Math.abs(events[events.length-1].time-time)<1e-9)simultaneous=true;ev.time=time;ev.index=events.length;ev.afterDecision=decided;events.push(ev);}
  function cushion(i,wall,nx,ny){
    const q=b[i],vn=q.vx*nx+q.vy*ny;if(vn>=-eps)return false;
    // 쿠션 높이와 앞뒤 회전을 포함하는 수평 충격 근사.
    const tx=-ny,ty=nx,h=.4,rad=Math.sqrt(1-h*h);
    const un=vn+h*R*(q.wy*nx-q.wx*ny);
    if(un>=0){q.vx-=vn*nx;q.vy-=vn*ny;}else{
      const kn=1+h*h/k,kt=1+1/k;
      const ut=q.vx*tx+q.vy*ty+h*R*(q.wy*tx-q.wx*ty)-rad*R*q.wz;
      const jn=-(1+eRail)*un/kn,jt=clamp(-ut/kt,-muRail*jn,muRail*jn);
      const jx=jn*nx+jt*tx,jy=jn*ny+jt*ty;
      q.vx+=jx;q.vy+=jy;q.wx-=h*jy/(k*R);q.wy+=h*jx/(k*R);q.wz-=rad*jt/(k*R);
      const post=q.vx*nx+q.vy*ny;if(post<0){q.vx-=post*nx;q.vy-=post*ny;}
    }
    const before=decided;emit({type:'cushion',ball:i,wall,x:q.x,y:q.y});
    if(i===cue&&!before){rails++;seq.push('쿠션');if(!firstCushion)firstCushion={wall,x:q.x,y:q.y,time};}
    else if(i===cue&&!firstCushion)firstCushion={wall,x:q.x,y:q.y,time};
    return true;
  }
  function pair(i,j){
    const a=b[i],d=b[j],x=d.x-a.x,y=d.y-a.y,dist=Math.hypot(x,y),nx=dist>eps?x/dist:1,ny=dist>eps?y/dist:0;
    const rvx=d.vx-a.vx,rvy=d.vy-a.vy,vn=rvx*nx+rvy*ny;if(vn>=-eps)return false;
    const target=i===cue?j:i;
    if(!firstContact&&(i===cue||j===cue)){let cb=b[cue],ob=b[target],v=Math.hypot(cb.vx,cb.vy);if(v>eps){let signed=clamp(((cb.x-ob.x)*cb.vy-(cb.y-ob.y)*cb.vx)/(v*2*R),-1,1);firstContact={target,fraction:1-Math.abs(signed),offset:-signed*100,side:Math.abs(signed)<.015?'정면':signed>0?'적구 왼쪽':'적구 오른쪽',railsBefore:rails,x:cb.x,y:cb.y,time};}}
    const tx=-ny,ty=nx,jn=-(1+eBall)*vn/2,vt=rvx*tx+rvy*ty-R*(a.wz+d.wz),jt=clamp(-vt/(2+2/k),-muBall*jn,muBall*jn),jx=jn*nx+jt*tx,jy=jn*ny+jt*ty;
    a.vx-=jx;a.vy-=jy;d.vx+=jx;d.vy+=jy;a.wz-=jt/(k*R);d.wz-=jt/(k*R);
    const isCue=i===cue||j===cue, continuing=isCue&&cueContact.has(target);
    emit({type:'ball',balls:[i,j],x:(a.x+d.x)/2,y:(a.y+d.y)/2,continuing});
    if(isCue)cueContact.add(target);
    if(!decided&&isCue&&!continuing){if(hit.includes(target))recontact++;else{hit.push(target);seq.push(names[target]);if(hit.length===2){score=rails>=3;decided=true;}}}
    return true;
  }
  // Reject overlapping/out-of-bounds starting positions instead of inventing impacts.
  for(let i=0;i<b.length;i++){let q=b[i];if(q.x<R-tol||q.x>W-R+tol||q.y<R-tol||q.y>H-R+tol)invalidInitial=true;for(let j=0;j<i;j++)if(Math.hypot(q.x-b[j].x,q.y-b[j].y)<2*R-tol)invalidInitial=true;}
  frame();
  if(!invalidInitial){
    const prec=Number.isFinite(precision)?clamp(precision,.1,10):1;
    for(let t=0;t<3000;t++){
      let maxV=Math.max(...b.map(q=>Math.hypot(q.vx,q.vy))),n=Math.max(1,Math.ceil(maxV*dt/(R*.4/prec))),h=dt/n;
      for(let s=0;s<n;s++){
        for(const q of b)cloth(q,h);
        let left=h,iterations=0;
        while(left>1e-12){
          let candidates=[];
          function add(t0,kind,i,j,nx,ny,wall){if(t0>=-tol&&t0<=left+tol)candidates.push({t:Math.max(0,t0),kind,i,j,nx,ny,wall});}
          for(let i=0;i<b.length;i++){let q=b[i];if(q.vx<-eps)add((R-q.x)/q.vx,0,i,0,1,0,'left');if(q.vx>eps)add((W-R-q.x)/q.vx,0,i,1,-1,0,'right');if(q.vy<-eps)add((R-q.y)/q.vy,0,i,2,0,1,'top');if(q.vy>eps)add((H-R-q.y)/q.vy,0,i,3,0,-1,'bottom');}
          for(let i=0;i<b.length;i++)for(let j=i+1;j<b.length;j++){let a=b[i],d=b[j],x=d.x-a.x,y=d.y-a.y,vx=d.vx-a.vx,vy=d.vy-a.vy,A=vx*vx+vy*vy,B=x*vx+y*vy,C=x*x+y*y-4*R*R,disc=B*B-A*C;if(A>eps&&B<0&&disc>=0)add((-B-Math.sqrt(disc))/A,1,i,j,0,0,'');}
          if(!candidates.length){move(left);left=0;break;}
          candidates.sort((a,z)=>a.t-z.t||a.kind-z.kind||a.i-z.i||a.j-z.j);
          let v=candidates[0];if(candidates.length>1&&Math.abs(candidates[1].t-v.t)<1e-9)simultaneous=true;
          const advance=Math.min(left,v.t);if(advance>0){move(advance);left-=advance;}
          let ok=v.kind===0?cushion(v.i,v.wall,v.nx,v.ny):pair(v.i,v.j);
          if(ok)frame();
          if(++iterations>128||!ok){truncated=true;left=0;break;}
        }
        if(truncated)break;
      }
      if(record&&t%2===0)frame();
      if(truncated)break;
      if(t===2999&&b.some(q=>Math.hypot(q.vx,q.vy)>=.005))truncated=true;
      if(!record&&decided)break;
      if(t>20&&b.every(q=>Math.hypot(q.vx,q.vy)<.005&&Math.hypot(q.vx-R*q.wy,q.vy+R*q.wx)<.005))break;
    }
  }
  frame();
  return {score,rails,hit,seq,frames,points,times,recontact,truncated,firstContact,events,firstCushion,finalPositions:state(),cueDistance:distance,elapsed:time,simultaneous,invalidInitial,physics:{muSlide,muRoll,muSpin,eBall,muBall,eRail,muRail}};
}
};
