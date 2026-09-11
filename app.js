let reservations = [];
let capacity = 30;
let viewDate = new Date();
viewDate.setDate(1);
let selectedDate = "";

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2,"0");
const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const mins = t => { const [h,m]=t.split(":").map(Number); return h*60+m; };
const fmtDate = s => new Intl.DateTimeFormat("es-AR",{weekday:"long",day:"2-digit",month:"2-digit",year:"numeric"}).format(new Date(s+"T12:00:00"));
const esc = s => String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

// Una fecha es reservable si no es anterior a hoy y no cae sábado/domingo.
function isPastDate(k) { return k < dateKey(new Date()); }
function isWeekend(dateObj) { const day = dateObj.getDay(); return day === 0 || day === 6; }
function isReservable(dateObj) { return !isPastDate(dateKey(dateObj)) && !isWeekend(dateObj); }

function setStatus(message="", type="") {
  $("status").textContent = message;
  $("status").className = "status " + type;
}

async function loadSettings() {
  const {data, error} = await supabaseClient.from("configuracion").select("clave,valor");
  if(error) throw error;
  const row = data?.find(x=>x.clave==="cantidad_pc");
  capacity = Number(row?.valor || 30);
  $("capacityLabel").textContent = capacity;
  $("adminCapacity").textContent = capacity;
}

async function loadReservations() {
  const {data,error} = await supabaseClient.from("reservas")
    .select("*")
    .order("fecha",{ascending:true})
    .order("hora_inicio",{ascending:true});
  if(error) throw error;
  reservations = data || [];
}

function dayReservations(k){ return reservations.filter(r=>r.fecha===k); }

function maxUsed(k) {
  const rs=dayReservations(k);
  const points=[...new Set(rs.flatMap(r=>[r.hora_inicio,r.hora_fin]))].sort();
  let max=0;
  for(const p of points){
    const used=rs.filter(r=>mins(r.hora_inicio)<=mins(p)&&mins(r.hora_fin)>mins(p))
      .reduce((s,r)=>s+Number(r.cantidad_pc),0);
    max=Math.max(max,used);
  }
  return max;
}

function availability(date,start,end) {
  return capacity - reservations
    .filter(r=>r.fecha===date && mins(start)<mins(r.hora_fin) && mins(r.hora_inicio)<mins(end))
    .reduce((s,r)=>s+Number(r.cantidad_pc),0);
}

function renderCalendar() {
  const y=viewDate.getFullYear(),m=viewDate.getMonth();
  $("monthTitle").textContent=new Intl.DateTimeFormat("es-AR",{month:"long",year:"numeric"}).format(viewDate);
  const cal=$("calendar"); cal.innerHTML="";
  ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"].forEach(x=>{
    const e=document.createElement("div"); e.className="weekday"; e.textContent=x; cal.appendChild(e);
  });
  const first=new Date(y,m,1), start=(first.getDay()+6)%7, days=new Date(y,m+1,0).getDate();
  for(let i=0;i<start;i++){const e=document.createElement("div");e.className="day empty";cal.appendChild(e)}
  const today=dateKey(new Date());
  for(let d=1;d<=days;d++){
    const dObj=new Date(y,m,d);
    const k=dateKey(dObj), used=maxUsed(k), rs=dayReservations(k);
    const pct=Math.min(100,used/capacity*100);
    const cls=pct>=100?"full":pct>0?"partial":"free";
    const reservable=isReservable(dObj);
    const e=document.createElement("div");
    e.className="day"+(k===today?" today":"")+(reservable?"":" disabled")+(isWeekend(dObj)?" weekend":"");
    e.innerHTML=`<div class="day-number">${d}</div>`;
    if(!reservable){
      e.innerHTML+=`<div class="occupancy">${isWeekend(dObj)?"Sin actividad":"Fecha pasada"}</div>`;
    } else if(rs.length){
      e.innerHTML+=`<div class="occupancy">${used}/${capacity} PC en uso</div>
      <div class="bar"><span class="${cls}bar" style="width:${pct}%"></span></div>`;
      rs.slice(0,2).forEach(r=>e.innerHTML+=`<div class="reservation-mini">${r.hora_inicio}–${r.hora_fin} · ${r.cantidad_pc} PC</div>`);
      if(rs.length>2)e.innerHTML+=`<div class="occupancy">+${rs.length-2} reserva(s)</div>`;
    } else e.innerHTML+=`<div class="occupancy">Sin reservas</div>`;
    if(reservable) e.onclick=()=>openReservation(k);
    cal.appendChild(e);
  }
}

function renderUpcoming() {
  const now=dateKey(new Date());
  const arr=reservations.filter(r=>r.fecha>=now)
    .sort((a,b)=>(a.fecha+a.hora_inicio).localeCompare(b.fecha+b.hora_inicio)).slice(0,8);
  $("upcoming").innerHTML=arr.length ? arr.map(r=>`
    <div class="up-item">
      <strong>${fmtDate(r.fecha)}</strong>
      <small>${r.hora_inicio}–${r.hora_fin} · ${r.cantidad_pc} PC<br>
      ${esc(r.profesor)} · ${esc(r.curso)}</small>
    </div>`).join("") : `<p class="hint">No hay reservas próximas.</p>`;
}

function openReservation(k) {
  const dObj=new Date(k+"T12:00:00");
  if(!isReservable(dObj)){
    setStatus(isWeekend(dObj)
      ? "No se pueden realizar reservas los sábados ni domingos."
      : "No se pueden realizar reservas para fechas pasadas.","error");
    return;
  }
  selectedDate=k;
  $("modalTitle").textContent="Nueva reserva — "+fmtDate(k);
  $("teacher").value="";
  $("course").value="";
  $("start").value="08:00";
  $("end").value="09:20";
  $("quantity").value=1;
  $("notes").value="";
  updateAvailability();
  $("modal").classList.remove("hidden");
}

function updateAvailability() {
  const s=$("start").value,e=$("end").value,q=Number($("quantity").value||0);
  if(!s||!e||mins(e)<=mins(s)){ $("availability").textContent="El horario no es válido."; return; }
  const available=availability(selectedDate,s,e);
  $("availability").innerHTML=available>=q
    ? `🟢 Hay <strong>${available}</strong> computadoras disponibles en ese horario.`
    : `🔴 Solo quedan <strong>${available}</strong> computadoras disponibles.`;
}

$("reservationForm").onsubmit=async e=>{
  e.preventDefault();
  const dObj=new Date(selectedDate+"T12:00:00");
  if(!isReservable(dObj)){
    closeModals();
    return setStatus(isWeekend(dObj)
      ? "No se pueden realizar reservas los sábados ni domingos."
      : "No se pueden realizar reservas para fechas pasadas.","error");
  }
  const s=$("start").value,end=$("end").value,q=Number($("quantity").value);
  if(mins(end)<=mins(s)) return alert("La hora de finalización debe ser posterior a la de inicio.");
  const available=availability(selectedDate,s,end);
  if(q>available) return alert(`No hay suficientes computadoras. Disponibles: ${available}.`);

  setStatus("Guardando reserva...","loading");
  const {error}=await supabaseClient.from("reservas").insert({
    fecha:selectedDate,
    hora_inicio:s,
    hora_fin:end,
    profesor:$("teacher").value.trim(),
    curso:$("course").value.trim(),
    cantidad_pc:q,
    observaciones:$("notes").value.trim() || null
  });

  if(error){
    // El trigger/política de PostgreSQL también controla estas reglas por seguridad.
    let msg = "No se pudo guardar la reserva: "+error.message;
    if(error.message.includes("CAPACIDAD_INSUFICIENTE")) msg = "No hay suficientes computadoras disponibles para ese horario.";
    else if(error.message.includes("FECHA_PASADA")) msg = "No se pueden realizar reservas para fechas pasadas.";
    else if(error.message.includes("FIN_DE_SEMANA")) msg = "No se pueden realizar reservas los sábados ni domingos.";
    alert(msg);
    setStatus("No se pudo guardar la reserva.","error");
    return;
  }

  closeModals();
  await refresh();
  setStatus("Reserva realizada correctamente.","success");
};

["start","end","quantity"].forEach(id=>$(id).addEventListener("input",updateAvailability));
$("prevMonth").onclick=()=>{viewDate.setMonth(viewDate.getMonth()-1);renderCalendar()};
$("nextMonth").onclick=()=>{viewDate.setMonth(viewDate.getMonth()+1);renderCalendar()};
$("closeModal").onclick=closeModals;
$("modal").onclick=e=>{if(e.target===$("modal"))closeModals()};
$("adminBtn").onclick=()=>{window.location.href="admin.html"};
$("closeAdmin").onclick=closeModals;
$("closeAdmin2").onclick=closeModals;
$("adminModal").onclick=e=>{if(e.target===$("adminModal"))closeModals};

function closeModals(){ $("modal").classList.add("hidden"); $("adminModal").classList.add("hidden"); }

async function refresh(){
  try {
    await loadSettings();
    await loadReservations();
    renderCalendar();
    renderUpcoming();
  } catch(error) {
    console.error(error);
    setStatus("No se pudo conectar con la base de datos. Revisá config.js y Supabase.","error");
  }
}

refresh();
