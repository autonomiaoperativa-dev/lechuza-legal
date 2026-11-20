// Pestaña Cuenta: sesión, cambio de contraseña, primera cuenta de administrador y administración de usuarios.
(() => {
  let S = null; // respuesta de /api/sesion
  const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const dia = (d) => (d ? d.split('-').reverse().join('/') : 'sin vencimiento');
  const irCuenta = () => { document.querySelector('.tab[data-tab="cuenta"]').click(); window.scrollTo(0, 0); };

  // Si la sesión vence con la página abierta, se recarga para mostrar la pantalla de entrada.
  // Si el usuario tiene contraseña temporal, se le lleva a la pestaña Cuenta.
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = async (url, op) => {
    const r = await fetchOriginal(url, op);
    const ruta = typeof url === 'string' ? url : url.url;
    if (ruta.startsWith('/api/') && !ruta.startsWith('/api/sesion')) {
      if (r.status === 401 && S && S.modo !== 'abierto') location.reload();
      if (r.status === 403) r.clone().json().then((j) => { if (j.debe_cambiar) irCuenta(); }).catch(() => {});
    }
    return r;
  };
  async function api(url, cuerpo) {
    const r = await fetchOriginal(url, cuerpo === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Error ' + r.status);
    return j;
  }

  async function salir() {
    await fetchOriginal('/api/sesion/salir', { method: 'POST' });
    location.reload();
  }
  $('#btnSalir').onclick = salir;
  $('#btnSalir2').onclick = salir;

  async function cargar() {
    try { S = await api('/api/sesion'); } catch { return; }
    const u = S.usuario;
    $('#sesionCaja').hidden = !u;
    if (u) $('#sesionNombre').innerHTML = `<strong>${esc(u.nombre || u.usuario)}</strong>${u.rol === 'admin' ? ' · admin' : ''}`;
    $('#formPrimero').hidden = !S.puede_crear_primero;
    $('#miCuenta').hidden = !u;
    $('#adminCaja').hidden = !(u && u.rol === 'admin');
    $('#avisoCambiar').hidden = !(u && u.debe_cambiar);
    const info = $('#cuentaInfo');
    info.hidden = false;
    if (S.modo === 'usuarios') info.hidden = true;
    else if (!S.cuentas_disponibles) info.textContent = 'En esta versión no hay cuentas de usuario porque no guarda datos de forma permanente. El acceso, si está activado, es con una clave compartida.';
    else if (S.puede_crear_primero) info.hidden = true;
    else info.textContent = 'Todavía no hay cuentas de usuario. La primera cuenta (administrador) solo se puede crear desde la computadora donde corre Lechuza Legal.';
    if (u) {
      $('#datosCuenta').innerHTML = `<dt>Usuario</dt><dd>${esc(u.usuario)}</dd><dt>Nombre</dt><dd>${esc(u.nombre || '—')}</dd>
        <dt>Correo</dt><dd>${esc(u.correo || '—')}</dd><dt>Rol</dt><dd>${u.rol === 'admin' ? 'Administrador' : 'Usuario'}</dd>
        <dt>Acceso hasta</dt><dd>${esc(dia(u.vence))}</dd><dt>Último acceso</dt><dd>${esc(fecha(u.ultimo_acceso))}</dd>`;
      if (u.debe_cambiar) irCuenta();
      if (u.rol === 'admin') pintarUsuarios();
    }
  }

  // ---- primera cuenta (administrador) ----
  $('#formPrimero').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#pMsg'); msg.textContent = '';
    if ($('#pContra').value !== $('#pContra2').value) { msg.textContent = 'Las contraseñas no coinciden.'; return; }
    if (!confirm('Al crear esta cuenta, la plataforma pedirá usuario y contraseña a todos (también en esta computadora). ¿Continuar?')) return;
    try {
      await api('/api/usuarios/primero', { usuario: $('#pUsuario').value, nombre: $('#pNombre').value, correo: $('#pCorreo').value, contrasena: $('#pContra').value });
      location.reload();
    } catch (err) { msg.textContent = err.message; }
  });

  // ---- cambio de contraseña ----
  $('#formContra').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#cMsg'); msg.className = 'nota'; msg.textContent = '';
    if ($('#cNueva').value !== $('#cNueva2').value) { msg.className = 'error'; msg.textContent = 'Las contraseñas nuevas no coinciden.'; return; }
    try {
      await api('/api/sesion/contrasena', { actual: $('#cActual').value, nueva: $('#cNueva').value });
      e.target.reset();
      msg.textContent = '✓ Contraseña actualizada.';
      cargar();
    } catch (err) { msg.className = 'error'; msg.textContent = err.message; }
  });

  // ---- administración ----
  function mostrarTemporal(caja, usuario, temporal) {
    caja.innerHTML = `<div class="temporal">Contraseña temporal de <strong>${esc(usuario)}</strong>: <code>${esc(temporal)}</code><br>
      <span class="ayuda">Se muestra solo esta vez. Cópiala y compártela por un medio privado. Al entrar se le pedirá cambiarla.</span></div>`;
  }
  $('#formUsuario').addEventListener('submit', async (e) => {
    e.preventDefault();
    const caja = $('#nMsg'); caja.innerHTML = '';
    try {
      const r = await api('/api/usuarios', { usuario: $('#nUsuario').value, nombre: $('#nNombre').value, correo: $('#nCorreo').value, vence: $('#nVence').value || null, rol: $('#nRol').value });
      e.target.reset();
      mostrarTemporal(caja, r.usuario.usuario, r.contrasena_temporal);
      pintarUsuarios();
    } catch (err) { caja.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  });

  async function pintarUsuarios() {
    let lista;
    try { lista = (await api('/api/usuarios')).usuarios; } catch (err) { $('#tablaUsuarios').innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
    $('#nUsuarios').textContent = `(${lista.length})`;
    const yo = S.usuario.id;
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
    $('#tablaUsuarios').innerHTML = `<table><thead><tr><th>Usuario</th><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Acceso hasta</th><th>Último acceso</th><th>Búsquedas 30 días</th><th>Acciones</th></tr></thead><tbody>
      ${lista.map((u) => {
        const vencido = u.vence && u.vence < hoy;
        const estado = !u.activo ? '<span class="estado-mal">Suspendido</span>' : vencido ? '<span class="estado-mal">Vencido</span>' : '<span class="estado-ok">Activo</span>';
        return `<tr data-id="${u.id}"><td>${esc(u.usuario)}${u.id === yo ? ' <span class="etq">tú</span>' : ''}${u.debe_cambiar ? ' <span class="etq" title="Aún no cambia su contraseña temporal">temporal</span>' : ''}</td>
          <td>${esc(u.nombre || '')}</td><td>${esc(u.correo || '')}</td>
          <td><select data-acc="rol" aria-label="Rol de ${esc(u.usuario)}"><option value="usuario"${u.rol === 'usuario' ? ' selected' : ''}>Usuario</option><option value="admin"${u.rol === 'admin' ? ' selected' : ''}>Admin</option></select></td>
          <td>${estado}</td>
          <td><input type="date" data-acc="vence" value="${esc(u.vence || '')}" aria-label="Acceso hasta para ${esc(u.usuario)}"></td>
          <td>${esc(fecha(u.ultimo_acceso))}</td><td>${u.uso_30d}</td>
          <td>${u.id === yo ? '<span class="ayuda">usa “Cambiar contraseña”</span>' : `<button type="button" class="secundario" data-acc="restablecer">Restablecer contraseña</button>
            <button type="button" class="secundario" data-acc="activo">${u.activo ? 'Suspender' : 'Reactivar'}</button>`}</td></tr>`;
      }).join('')}</tbody></table>`;
  }

  $('#tablaUsuarios').addEventListener('change', async (e) => {
    const tr = e.target.closest('tr[data-id]'); const acc = e.target.dataset.acc;
    if (!tr || !acc) return;
    const caja = $('#uMsg'); caja.innerHTML = '';
    try {
      await api('/api/usuarios/' + tr.dataset.id, acc === 'rol' ? { rol: e.target.value } : { vence: e.target.value || null });
      caja.innerHTML = '<p class="nota">✓ Guardado.</p>';
    } catch (err) { caja.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
    pintarUsuarios();
  });
  $('#tablaUsuarios').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-acc]'); if (!b) return;
    const tr = b.closest('tr[data-id]'); const id = tr.dataset.id; const nombre = tr.cells[0].firstChild.textContent;
    const caja = $('#uMsg'); caja.innerHTML = '';
    try {
      if (b.dataset.acc === 'restablecer') {
        if (!confirm(`¿Generar una contraseña temporal nueva para ${nombre}? Su contraseña actual dejará de funcionar y se cerrarán sus sesiones.`)) return;
        const r = await api(`/api/usuarios/${id}/restablecer`, {});
        mostrarTemporal(caja, nombre, r.contrasena_temporal);
      } else {
        const suspender = b.textContent.trim() === 'Suspender';
        if (suspender && !confirm(`¿Suspender a ${nombre}? Ya no podrá entrar hasta que lo reactives.`)) return;
        await api('/api/usuarios/' + id, { activo: !suspender });
      }
    } catch (err) { caja.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
    pintarUsuarios();
  });

  cargar();
})();
