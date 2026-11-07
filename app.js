const DEFAULT_SCHEDULE = [
  {id:1,name:"Case",start:"20:30",end:"22:00",kind:"case"},
  {id:2,name:"Flex",start:"22:00",end:"22:30",kind:"flex"},
  {id:3,name:"Case",start:"22:30",end:"00:30",kind:"case"},
  {id:4,name:"Flex",start:"00:30",end:"02:00",kind:"flex"},
  {id:5,name:"Case",start:"02:00",end:"04:00",kind:"case"},
  {id:6,name:"Flex (Blocked)",start:"04:00",end:"05:00",kind:"blocked"}
];
const BREAKS = [
  {name:"Meal break",start:"22:30",end:"23:00",kind:"break"},
  {name:"Rest break",start:"00:15",end:"00:30",kind:"break"},
  {name:"Rest break",start:"03:00",end:"03:15",kind:"break"}
];
const $ = id => document.getElementById(id);
const STORAGE = {schedule:"shiftflow_schedule_v1",tasks:"shiftflow_tasks_v1",done:"shiftflow_done_v1",alerts:"shiftflow_alerts_v1"};
let schedule = load(STORAGE.schedule, DEFAULT_SCHEDULE);
let tasks = load(STORAGE.tasks, []);
let completedByDay = load(STORAGE.done, {});
let firedAlerts = load(STORAGE.alerts, {});
let activeAlert = null;
let snoozeTimer = null;

function load(key,fallback){try{const v=localStorage.getItem(key);return v?JSON.parse(v):structuredClone(fallback)}catch{return structuredClone(fallback)}}
function save(key,value){localStorage.setItem(key,JSON.stringify(value))}
function timeParts(hhmm){const [h,m]=hhmm.split(":").map(Number);return h*60+m}
function formatTime(hhmm){const [h,m]=hhmm.split(":").map(Number);const d=new Date();d.setHours(h,m,0,0);return d.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",hour12:true})}
function dateKey(d=new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function startOfShift(now){const d=new Date(now);if(d.getHours()<5)d.setDate(d.getDate()-1);d.setHours(20,30,0,0);return d}
function isWeekday(d){return d.getDay()>=1&&d.getDay()<=5}
function getShiftWindow(now){
  const start=startOfShift(now), end=new Date(start);end.setDate(end.getDate()+1);end.setHours(5,0,0,0);
  return {start,end,active:isWeekday(start)};
}
function makeBlocks(shiftStart){
  return [...schedule,...BREAKS].map(b=>{
    const s=new Date(shiftStart),e=new Date(shiftStart);
    const sm=timeParts(b.start),em=timeParts(b.end);
    s.setHours(Math.floor(sm/60),sm%60,0,0);e.setHours(Math.floor(em/60),em%60,0,0);
    if(sm<20*60)s.setDate(s.getDate()+1);
    if(em<20*60)e.setDate(e.getDate()+1);
    if(e<=s)e.setDate(e.getDate()+1);
    return {...b,startDate:s,endDate:e};
  }).sort((a,b)=>a.startDate-b.startDate);
}
function fmtClock(d,zone){return new Intl.DateTimeFormat("en-US",{timeZone:zone,hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:true}).format(d)}
function updateClocks(){
  const now=new Date();
  $("istClock").innerHTML=fmtClock(now,"Asia/Kolkata").replace(/ (AM|PM)/,`<small>$1</small>`);
  $("ptClock").textContent=fmtClock(now,"America/Los_Angeles");
  $("ptZone").textContent=new Intl.DateTimeFormat("en-US",{timeZone:"America/Los_Angeles",timeZoneName:"short"}).formatToParts(now).find(p=>p.type==="timeZoneName")?.value||"PT";
  $("todayLabel").textContent=new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata",weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(now).toUpperCase();
  $("istDate").textContent=new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata",day:"2-digit",month:"short"}).format(now);
  const h=now.getHours();$("greeting").textContent=h<12?"GOOD MORNING":h<17?"GOOD AFTERNOON":"GOOD EVENING";
}
function currentBlock(blocks,now){
  const active=blocks.filter(b=>now>=b.startDate&&now<b.endDate);
  // Breaks intentionally overlay case/flex blocks, so show the break as the current activity.
  return active.find(b=>b.kind==="break")||active.find(b=>b.kind!=="break");
}
function nextBlock(blocks,now){return blocks.find(b=>b.startDate>now)}
function durationLabel(ms){const sec=Math.max(0,Math.floor(ms/1000)),h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;return [h,m,s].map(n=>String(n).padStart(2,"0")).join(":")}
function renderSchedule(blocks,now){
  const list=$("scheduleList");list.innerHTML="";
  const visible=blocks.filter(b=>b.endDate>now || b.startDate>now).slice(0,8);
  visible.forEach(b=>{
    const el=document.createElement("div");el.className="schedule-item";
    const type=b.kind==="break"?"break":b.kind==="flex"||b.kind==="blocked"?"flex":"";
    el.innerHTML=`<span class="schedule-color ${type}"></span><div class="schedule-info"><strong>${escapeHtml(b.name)}</strong><span>${formatDateTime(b.startDate)} – ${formatDateTime(b.endDate)}</span></div><span class="schedule-day">${b.kind==="break"?"BREAK":b.kind.toUpperCase()}</span>`;
    list.appendChild(el);
  });
  if(!visible.length)list.innerHTML='<div class="empty-state">Your shift is complete. Enjoy your time.</div>';
}
function formatDateTime(d){return d.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",hour12:true})}
function renderShift(){
  const now=new Date(),window=getShiftWindow(now),blocks=makeBlocks(window.start);
  $("shiftDay").textContent=window.active?"WEEKDAY SHIFT":"WEEKEND";
  if(!window.active){
    $("currentActivity").textContent="You're off shift";$("activityBadge").textContent="RECHARGE";
    $("countdownLabel").textContent="NEXT WEEKDAY SHIFT";$("countdown").textContent=durationLabel(nextWeekdayStart(now)-now);
    $("nextActivity").textContent="Case";$("nextTime").textContent="08:30 PM";
    $("activityProgress").style.width="0%";$("currentStart").textContent="WEEKEND";$("currentEnd").textContent="NO DEFAULT SHIFT";
    $("completionPercent").textContent="0%";$("ringProgress").style.strokeDashoffset=578.05;$("ringTime").textContent="Weekend";
    document.body.dataset.scene="break";renderSchedule([],now);return;
  }
  const active=currentBlock(blocks,now),next=nextBlock(blocks,now);
  if(active){
    const pct=Math.min(100,Math.max(0,(now-active.startDate)/(active.endDate-active.startDate)*100));
    $("currentActivity").textContent=active.name;$("activityBadge").textContent=active.kind==="break"?"TAKE A BREATHER":"IN PROGRESS";
    $("countdownLabel").textContent="TIME REMAINING";$("countdown").textContent=durationLabel(active.endDate-now);
    $("nextActivity").textContent=next?.name||"Shift complete";$("nextTime").textContent=next?formatDateTime(next.startDate):"05:00 AM";
    $("activityProgress").style.width=pct+"%";$("currentStart").textContent=formatDateTime(active.startDate);$("currentEnd").textContent=formatDateTime(active.endDate);
    document.body.dataset.scene=active.kind==="break"?"break":active.kind==="blocked"?"night":"work";
  }else{
    $("currentActivity").textContent=now<window.start?"Shift starts at 08:30 PM":"Shift complete";
    $("activityBadge").textContent=now<window.start?"UP NEXT":"COMPLETED";
    $("countdownLabel").textContent=now<window.start?"UNTIL SHIFT START":"ENJOY YOUR TIME";
    $("countdown").textContent=durationLabel(Math.max(0,(now<window.start?window.start:nextWeekdayStart(now))-now));
    $("nextActivity").textContent="Case";$("nextTime").textContent="08:30 PM";$("activityProgress").style.width="0%";
    $("currentStart").textContent="08:30 PM";$("currentEnd").textContent="05:00 AM";document.body.dataset.scene="night";
  }
  const elapsed=Math.max(0,Math.min(window.end-window.start,now-window.start)),total=window.end-window.start,p=Math.min(100,elapsed/total*100);
  $("completionPercent").textContent=Math.round(p)+"%";$("ringProgress").style.strokeDashoffset=578.05-(578.05*p/100);
  $("ringTime").textContent=now<window.start?"Starts 08:30 PM":durationLabel(Math.max(0,window.end-now))+" left";
  renderSchedule(blocks,now);checkScheduleAlerts(blocks,now);
}
function nextWeekdayStart(now){
  const d=new Date(now);d.setHours(20,30,0,0);
  if(now.getHours()>=5)d.setDate(d.getDate()+1);
  while(!isWeekday(d))d.setDate(d.getDate()+1);
  return d;
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function checkScheduleAlerts(blocks,now){
  blocks.forEach(b=>{
    const key=`${b.name}-${b.startDate.getTime()}`;
    if(Math.abs(now-b.startDate)<1100&&!firedAlerts[key]){
      firedAlerts[key]=true;save(STORAGE.alerts,firedAlerts);
      showAlert(b.kind==="break"?"BREAK TIME":"SCHEDULE CHANGE",b.name,b.kind==="break"?"Step away and recharge.":`Your ${b.name} block starts now. Update your Omni-channel status.`,b.kind);
      browserNotify(b.name,`Your ${b.name} block starts now.`);
      playTone(b.kind==="break"?660:880);
    }
  });
  // Weekly cab reminder: Thursday 04:00 IST. The 04:00 reminder belongs to Thursday morning.
  if(now.getDay()===4&&now.getHours()===4&&now.getMinutes()===0){
    const key="cab-"+dateKey(now);if(!firedAlerts[key]){firedAlerts[key]=true;save(STORAGE.alerts,firedAlerts);showAlert("WEEKLY REMINDER","Book your cab","It's Thursday, 4:00 AM. Book your cab for the upcoming commute.","cab");browserNotify("Book your cab","Weekly Thursday reminder.");playTone(520);}
  }
}
function browserNotify(title,body){if("Notification"in window&&Notification.permission==="granted"){try{new Notification(title,{body,icon:""})}catch(e){}}}
function playTone(freq=760){try{const ctx=new (window.AudioContext||window.webkitAudioContext)(),o=ctx.createOscillator(),g=ctx.createGain();o.type="sine";o.frequency.value=freq;g.gain.setValueAtTime(.0001,ctx.currentTime);g.gain.exponentialRampToValueAtTime(.08,ctx.currentTime+.03);g.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+.35);o.connect(g);g.connect(ctx.destination);o.start();o.stop(ctx.currentTime+.36);o.onended=()=>ctx.close()}catch(e){}}
function showAlert(kicker,title,message,kind="case"){
  activeAlert={kicker,title,message,kind};$("alertKicker").textContent=kicker;$("alertTitle").textContent=title;$("alertMessage").textContent=message;
  $("alertSymbol").textContent=kind==="break"?"☼":kind==="cab"?"↗":kind==="flex"?"✧":"✦";
  $("alertBackdrop").classList.add("show");$("alertBackdrop").setAttribute("aria-hidden","false");
}
function closeAlert(){ $("alertBackdrop").classList.remove("show");$("alertBackdrop").setAttribute("aria-hidden","true");activeAlert=null}
$("ackAlert").addEventListener("click",closeAlert);
$("snoozeAlert").addEventListener("click",()=>{if(activeAlert){const a={...activeAlert};closeAlert();clearTimeout(snoozeTimer);snoozeTimer=setTimeout(()=>showAlert(a.kicker,a.title,a.message+" (Snoozed reminder)",a.kind),5*60*1000)}});
$("notificationPermission").addEventListener("click",async()=>{if(!("Notification"in window)){showAlert("BROWSER LIMITATION","Notifications unavailable","This browser does not support desktop notifications.");return}const p=await Notification.requestPermission();showAlert("NOTIFICATION SETTINGS",p==="granted"?"Notifications enabled":"Permission not enabled",p==="granted"?"Browser notifications are ready when this page is open.":"Allow notifications in your browser site settings to enable them.");});
$("testReminder").addEventListener("click",()=>{showAlert("TEST NOTIFICATION","Book your cab","This is a preview of your weekly cab reminder.","cab");playTone(520)});
function renderTasks(){
  const list=$("taskList");list.innerHTML="";
  if(!tasks.length)list.innerHTML='<div class="empty-state">No tasks yet. Add one small thing to get started.</div>';
  tasks.forEach(t=>{
    const row=document.createElement("label");row.className="task-row"+(t.done?" done":"");
    row.innerHTML=`<input type="checkbox" ${t.done?"checked":""} aria-label="Complete task"><span>${escapeHtml(t.text)}</span><button class="task-delete" type="button" aria-label="Delete task">×</button>`;
    row.querySelector("input").addEventListener("change",e=>{t.done=e.target.checked;save(STORAGE.tasks,tasks);renderTasks();renderAnalytics()});
    row.querySelector("button").addEventListener("click",()=>{tasks=tasks.filter(x=>x.id!==t.id);save(STORAGE.tasks,tasks);renderTasks();renderAnalytics()});
    list.appendChild(row);
  });
  const done=tasks.filter(t=>t.done).length;$("taskCount").textContent=`${tasks.length} ITEMS`;$("taskSummary").textContent=tasks.length?`${done} of ${tasks.length} completed`:"Small steps, steady progress.";
}
$("taskForm").addEventListener("submit",e=>{e.preventDefault();const input=$("taskInput"),text=input.value.trim();if(!text)return;tasks.push({id:Date.now(),text,done:false,created:dateKey()});save(STORAGE.tasks,tasks);input.value="";renderTasks();renderAnalytics()});
$("clearCompleted").addEventListener("click",()=>{tasks=tasks.filter(t=>!t.done);save(STORAGE.tasks,tasks);renderTasks();renderAnalytics()});
function renderAnalytics(){
  const days=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],now=new Date(),monday=new Date(now);monday.setHours(0,0,0,0);monday.setDate(monday.getDate()-(monday.getDay()+6)%7);
  const counts=days.map((_,i)=>{const d=new Date(monday);d.setDate(monday.getDate()+i);return tasks.filter(t=>t.done&&t.created===dateKey(d)).length});
  const total=counts.reduce((a,b)=>a+b,0),max=Math.max(4,...counts);
  $("tasksDone").textContent=total;$("completionRate").textContent=tasks.length?Math.round(total/tasks.length*100)+"%":"0%";
  $("weekRange").textContent=`${monday.toLocaleDateString("en-IN",{day:"numeric",month:"short"})} – ${new Date(monday.getTime()+6*86400000).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}`;
  $("weeklyChart").innerHTML="";
  days.forEach((day,i)=>{const group=document.createElement("div");group.className="bar-group";const bar=document.createElement("div");bar.className="bar";bar.style.height=Math.max(3,counts[i]/max*100)+"%";bar.title=`${counts[i]} completed`;const label=document.createElement("span");label.className="bar-label";label.textContent=day;group.append(bar,label);$("weeklyChart").appendChild(group)});
}
function renderEditor(){
  const host=$("scheduleEditor");host.innerHTML="";
  schedule.forEach((item,i)=>{
    const row=document.createElement("div");row.className="editor-row";
    row.innerHTML=`<div class="editor-field"><label>ACTIVITY</label><input data-i="${i}" data-key="name" value="${escapeHtml(item.name)}"></div><div class="editor-field"><label>START (24H)</label><input type="time" data-i="${i}" data-key="start" value="${item.start}"></div><div class="editor-field"><label>END (24H)</label><input type="time" data-i="${i}" data-key="end" value="${item.end}"></div>`;
    host.appendChild(row);
  });
}
$("editScheduleBtn").addEventListener("click",()=>{renderEditor();$("scheduleBackdrop").classList.add("show");$("scheduleBackdrop").setAttribute("aria-hidden","false")});
function closeSchedule(){$("scheduleBackdrop").classList.remove("show");$("scheduleBackdrop").setAttribute("aria-hidden","true")}
$("closeSchedule").addEventListener("click",closeSchedule);
$("saveSchedule").addEventListener("click",()=>{
  document.querySelectorAll("#scheduleEditor input").forEach(input=>{const i=Number(input.dataset.i),key=input.dataset.key;schedule[i][key]=input.value.trim()});
  schedule.forEach(s=>{s.kind=/flex/i.test(s.name)?"flex":"case";if(/blocked/i.test(s.name))s.kind="blocked"});
  save(STORAGE.schedule,schedule);closeSchedule();renderShift();
});
$("resetSchedule").addEventListener("click",()=>{schedule=structuredClone(DEFAULT_SCHEDULE);save(STORAGE.schedule,schedule);renderEditor()});
document.querySelectorAll("[data-scene-choice]").forEach(btn=>btn.addEventListener("click",()=>{document.body.dataset.scene=btn.dataset.sceneChoice;document.querySelectorAll(".scene-option").forEach(b=>b.classList.toggle("active",b===btn))}));
function tick(){updateClocks();renderShift()}
renderTasks();renderAnalytics();tick();setInterval(tick,1000);
