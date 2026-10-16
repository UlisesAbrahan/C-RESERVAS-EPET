const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad = n => String(n).padStart(2,"0");
const toKey = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const DIAS = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];

function showMessage(id, message, type="error") {
  const el = $(id);
  el.textContent = message;
  el.className = "message " + type;
}

function clearMessage(id) {
  const el = $(id);
  el.textContent = "";
  el.className = "message";
}

function formatDate(date) {
  return new Intl.DateTimeFormat("es-AR", {
    weekday:"short", day:"2-digit", month:"2-digit", year:"numeric"
  }).format(new Date(date + "T12:00:00"));
}

async function getSession() {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) throw error;
  return data.session;
}

async function checkAdmin(session) {
  if (!session) return false;
  const { data, error } = await supabaseClient
    .from("admin_users")
    .select("user_id")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error) throw error;
  return !!data;
}

function showLogin() {
  $("loginCard").hidden = false;
  $("panelCard").hidden = true;
}

function showPanel(session) {
  $("loginCard").hidden = true;
  $("panelCard").hidden = false;
  $("userInfo").textContent = session.user.email || "Administrador";
  loadCapacity();
}

// ---------- Cantidad de computadoras ----------
async function loadCapacity() {
  clearMessage("capacityMessage");
  const { data, error } = await supabaseClient
    .from("configuracion")
    .select("valor")
    .eq("clave", "cantidad_pc")
    .maybeSingle();

  if (error) {
    showMessage("capacityMessage", "No se pudo leer la cantidad de computadoras: " + error.message, "error");
    return;
  }
  const n = Number(data?.valor || 0);
  $("currentCapacity").textContent = n || "—";
  $("capacityInput").value = n || "";
}

$("saveCapacityBtn").addEventListener("click", async () => {
  clearMessage("capacityMessage");
  const n = Number($("capacityInput").value);

  if (!Number.isInteger(n) || n < 1 || n > 1000) {
    showMessage("capacityMessage", "Ingresá un número entero entre 1 y 1000.", "error");
    return;
  }

  const btn = $("saveCapacityBtn");
  btn.disabled = true; btn.textContent = "Guardando...";

  const { data, error } = await supabaseClient
    .from("configuracion")
    .update({ valor: String(n) })
    .eq("clave", "cantidad_pc")
    .select();

  btn.disabled = false; btn.textContent = "Guardar cantidad";

  if (error) {
    showMessage("capacityMessage", "No se pudo guardar: " + error.message, "error");
    return;
  }
  if (!data?.length) {
    showMessage("capacityMessage", "No se guardó ningún cambio. Verificá que hayas ejecutado supabase.sql actualizado y que tu cuenta sea administradora.", "error");
    return;
  }
  $("currentCapacity").textContent = n;
  showMessage("capacityMessage", `Listo: ahora hay ${n} computadoras disponibles para reservar.`, "success");
});

async function loadReservations() {
  clearMessage("panelMessage");
  $("reservationsContainer").innerHTML = `<div class="loading">Cargando reservas...</div>`;

  const { data, error } = await supabaseClient
    .from("reservas")
    .select("id,fecha,hora_inicio,hora_fin,profesor,curso,cantidad_pc,observaciones,creado_en")
    .order("fecha", {ascending:true})
    .order("hora_inicio", {ascending:true});

  if (error) {
    throw error;
  }

  if (!data?.length) {
    $("reservationsContainer").innerHTML = `<div class="empty">No hay reservas registradas.</div>`;
    return;
  }

  $("reservationsContainer").innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Horario</th>
            <th>Profesor</th>
            <th>Curso</th>
            <th>PC</th>
            <th>Observaciones</th>
            <th>Acción</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(r => `
            <tr>
              <td>${esc(formatDate(r.fecha))}</td>
              <td>${esc(r.hora_inicio.slice(0,5))}–${esc(r.hora_fin.slice(0,5))}</td>
              <td>${esc(r.profesor)}</td>
              <td>${esc(r.curso)}</td>
              <td>${esc(r.cantidad_pc)}</td>
              <td>${esc(r.observaciones || "—")}</td>
              <td><button class="danger delete-btn" data-id="${esc(r.id)}">Eliminar</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>`;

  document.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", () => deleteReservation(btn.dataset.id));
  });
}

async function deleteReservation(id) {
  if (!confirm("¿Seguro que querés eliminar esta reserva? Esta acción no se puede deshacer.")) return;

  const btn = document.querySelector(`.delete-btn[data-id="${CSS.escape(id)}"]`);
  if (btn) { btn.disabled = true; btn.textContent = "Eliminando..."; }

  const { error } = await supabaseClient
    .from("reservas")
    .delete()
    .eq("id", id);

  if (error) {
    if (btn) { btn.disabled = false; btn.textContent = "Eliminar"; }
    showMessage("panelMessage", "No se pudo eliminar la reserva: " + error.message, "error");
    return;
  }

  showMessage("panelMessage", "Reserva eliminada correctamente.", "success");
  await loadReservations();
}

$("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  clearMessage("loginMessage");

  const email = $("email").value.trim();
  const password = $("password").value;

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

 if (error) {
  console.error("ERROR LOGIN:", error);
  showMessage("loginMessage", error.message, "error");
  return;
}

  try {
    const isAdmin = await checkAdmin(data.session);
    if (!isAdmin) {
      await supabaseClient.auth.signOut();
      showMessage("loginMessage", "La cuenta es válida, pero no tiene permisos de administrador.", "error");
      return;
    }

    showPanel(data.session);
    await loadReservations();
  } catch (error) {
    await supabaseClient.auth.signOut();
    showMessage("loginMessage", "No se pudo verificar el permiso de administrador.", "error");
  }
});

$("refreshBtn").addEventListener("click", async () => {
  try { await loadReservations(); }
  catch (error) { showMessage("panelMessage", "No se pudieron cargar las reservas: " + error.message, "error"); }
});

$("logoutBtn").addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  showLogin();
});

// ---------- Volver al menú principal ----------
$("homeBtn").addEventListener("click", () => { window.location.href = "index.html"; });

// ---------- Descarga de histórico en Excel ----------

// Devuelve {desde, hasta} (claves YYYY-MM-DD) según el rango elegido.
function calcularRango(tipo) {
  const hoy = new Date();
  if (tipo === "week") {
    // Lunes a viernes de la semana actual.
    const dow = hoy.getDay(); // 0=domingo..6=sábado
    const offsetLunes = dow === 0 ? -6 : 1 - dow;
    const lunes = new Date(hoy); lunes.setDate(hoy.getDate() + offsetLunes);
    const viernes = new Date(lunes); viernes.setDate(lunes.getDate() + 4);
    return { desde: toKey(lunes), hasta: toKey(viernes) };
  }
  if (tipo === "month") {
    const primero = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const ultimo = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
    return { desde: toKey(primero), hasta: toKey(ultimo) };
  }
  // custom
  const desde = $("rangeFrom").value;
  const hasta = $("rangeTo").value;
  return { desde, hasta };
}

$("exportBtn").addEventListener("click", () => {
  clearMessage("exportMessage");
  $("exportPanel").hidden = !$("exportPanel").hidden;
});

$("cancelExportBtn").addEventListener("click", () => {
  $("exportPanel").hidden = true;
});

document.querySelectorAll('input[name="range"]').forEach(r => {
  r.addEventListener("change", () => {
    $("customRange").hidden = document.querySelector('input[name="range"]:checked').value !== "custom";
  });
});

$("downloadExcelBtn").addEventListener("click", async () => {
  clearMessage("exportMessage");
  const tipo = document.querySelector('input[name="range"]:checked').value;
  const { desde, hasta } = calcularRango(tipo);

  if (!desde || !hasta) {
    showMessage("exportMessage", "Elegí una fecha de inicio y de fin.", "error");
    return;
  }
  if (hasta < desde) {
    showMessage("exportMessage", "La fecha 'hasta' no puede ser anterior a la fecha 'desde'.", "error");
    return;
  }

  const btn = $("downloadExcelBtn");
  btn.disabled = true; btn.textContent = "Generando...";

  try {
    // Solo trae reservas que existen hoy en la tabla: las eliminadas
    // por el admin ya no están, así que jamás se incluyen.
    const { data, error } = await supabaseClient
      .from("reservas")
      .select("id,fecha,hora_inicio,hora_fin,profesor,curso,cantidad_pc,observaciones,creado_en")
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .order("fecha", { ascending: true })
      .order("hora_inicio", { ascending: true });

    if (error) throw error;

    if (!data?.length) {
      showMessage("exportMessage", "No hay reservas registradas en ese período.", "error");
      return;
    }

    const filas = data.map(r => {
      const fechaReserva = new Date(r.fecha + "T12:00:00");
      const creado = new Date(r.creado_en);
      return {
        "Fecha reservada": r.fecha,
        "Día": DIAS[fechaReserva.getDay()],
        "Hora inicio": r.hora_inicio.slice(0,5),
        "Hora fin": r.hora_fin.slice(0,5),
        "Profesor": r.profesor,
        "Curso": r.curso,
        "Cantidad PC": r.cantidad_pc,
        "Observaciones": r.observaciones || "",
        "Fecha de solicitud": toKey(creado),
        "Hora de solicitud": creado.toLocaleTimeString("es-AR", { hour:"2-digit", minute:"2-digit" })
      };
    });

    const hoja = XLSX.utils.json_to_sheet(filas);
    hoja["!cols"] = [
      {wch:14},{wch:11},{wch:10},{wch:9},{wch:22},{wch:14},{wch:11},{wch:28},{wch:16},{wch:14}
    ];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Reservas");
    XLSX.writeFile(libro, `historico_reservas_${desde}_a_${hasta}.xlsx`);

    showMessage("exportMessage", `Se descargaron ${filas.length} reserva(s) del ${desde} al ${hasta}.`, "success");

    // Ofrece purgar de la base lo ya descargado, para no acumular registros.
    const idsDescargados = data.map(r => r.id);
    setTimeout(async () => {
      const confirmar = confirm(
        `Ya descargaste el Excel con ${idsDescargados.length} reserva(s).\n\n` +
        `¿Querés eliminar ahora esas mismas reservas de la base de datos para liberar espacio? ` +
        `Esta acción no se puede deshacer.`
      );
      if (!confirmar) return;

      const { error: delError } = await supabaseClient
        .from("reservas")
        .delete()
        .in("id", idsDescargados);

      if (delError) {
        showMessage("exportMessage", "No se pudieron eliminar las reservas descargadas: " + delError.message, "error");
        return;
      }
      showMessage("exportMessage", `${idsDescargados.length} reserva(s) eliminada(s) de la base tras la descarga.`, "success");
      $("exportPanel").hidden = true;
      await loadReservations();
    }, 150);

  } catch (error) {
    showMessage("exportMessage", "No se pudo generar el histórico: " + error.message, "error");
  } finally {
    btn.disabled = false; btn.textContent = "Descargar Excel";
  }
});

(async function init() {
  try {
    const session = await getSession();
    if (!session) return showLogin();

    const isAdmin = await checkAdmin(session);
    if (!isAdmin) {
      await supabaseClient.auth.signOut();
      return showLogin();
    }

    showPanel(session);
    await loadReservations();
  } catch (error) {
    console.error(error);
    showLogin();
    showMessage("loginMessage", "No se pudo conectar con Supabase.", "error");
  }
})();
