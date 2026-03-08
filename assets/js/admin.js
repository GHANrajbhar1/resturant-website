const adminUsernameInput = document.getElementById("adminUsername");
const adminPasswordInput = document.getElementById("adminPassword");
const adminKeyInput = document.getElementById("adminKey");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const loadBtn = document.getElementById("loadBtn");
const authInfo = document.getElementById("authInfo");
const statusMsg = document.getElementById("statusMsg");
const reservationRows = document.getElementById("reservationRows");
const messageRows = document.getElementById("messageRows");
const orderRows = document.getElementById("orderRows");
const metricReservations = document.getElementById("metricReservations");
const metricOrders = document.getElementById("metricOrders");
const metricActiveOrders = document.getElementById("metricActiveOrders");
const metricRevenue = document.getElementById("metricRevenue");

const STATUS_OPTIONS = ["pending", "confirmed", "cancelled", "completed"];
const ORDER_STATUS_OPTIONS = [
  "created",
  "paid",
  "confirmed",
  "preparing",
  "out_for_delivery",
  "completed",
  "cancelled",
  "failed",
  "refunded"
];
const AUTH_TOKEN_STORAGE = "spiceroot-admin-token-session";
const AUTH_USER_STORAGE = "spiceroot-admin-user-session";

const state = {
  token: sessionStorage.getItem(AUTH_TOKEN_STORAGE) || "",
  user: JSON.parse(sessionStorage.getItem(AUTH_USER_STORAGE) || "null"),
  statusConfig: null
};

function normalizeAdminKey(raw) {
  const input = String(raw || "").trim();
  if (!input) return "";
  const eqIndex = input.indexOf("=");
  if (eqIndex > -1) {
    const maybeKey = input.slice(0, eqIndex).trim().toUpperCase();
    if (maybeKey === "ADMIN_API_KEY") {
      return input.slice(eqIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    }
  }
  return input.replace(/^['"]|['"]$/g, "");
}

function getAdminKey() {
  const clean = normalizeAdminKey(adminKeyInput.value);
  adminKeyInput.value = clean;
  return clean;
}

function getHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
    return headers;
  }
  const legacyKey = getAdminKey();
  if (legacyKey) {
    headers["x-admin-key"] = legacyKey;
  }
  return headers;
}

function setStatusMessage(message, isError) {
  statusMsg.textContent = message;
  statusMsg.className = `mt-2 text-sm ${isError ? "text-red-300" : "text-emerald-300"}`;
}

function setAuthInfo() {
  if (state.user?.username && state.user?.role) {
    authInfo.textContent = `Logged in as ${state.user.username} (${state.user.role})`;
    return;
  }

  const config = state.statusConfig || {};
  if (config.tokenLoginEnabled) {
    authInfo.textContent = "Token login available. Use username/password.";
  } else if (config.legacyKeyEnabled) {
    authInfo.textContent = "Legacy key mode enabled. Use ADMIN_API_KEY.";
  } else {
    authInfo.textContent = "Admin auth is not configured on server.";
  }
}

function saveSession() {
  if (state.token) {
    sessionStorage.setItem(AUTH_TOKEN_STORAGE, state.token);
  } else {
    sessionStorage.removeItem(AUTH_TOKEN_STORAGE);
  }
  if (state.user) {
    sessionStorage.setItem(AUTH_USER_STORAGE, JSON.stringify(state.user));
  } else {
    sessionStorage.removeItem(AUTH_USER_STORAGE);
  }
  setAuthInfo();
}

function logout() {
  state.token = "";
  state.user = null;
  saveSession();
  setStatusMessage("Logged out.", false);
}

function formatCurrency(value) {
  return `Rs.${Number(value || 0)}`;
}

function renderAnalytics(analytics) {
  const data = analytics || {};
  metricReservations.textContent = String(data.totalReservations || 0);
  metricOrders.textContent = String(data.totalOrders || 0);
  metricActiveOrders.textContent = String(data.activeOrders || 0);
  metricRevenue.textContent = formatCurrency(data.todayRevenueInr || 0);
}

function renderReservations(rows) {
  if (!rows.length) {
    reservationRows.innerHTML =
      '<tr><td colspan="5" class="px-2 py-3 text-slate-400">No reservations found.</td></tr>';
    return;
  }

  reservationRows.innerHTML = rows
    .map((row) => {
      const options = STATUS_OPTIONS.map(
        (option) =>
          `<option value="${option}" ${row.status === option ? "selected" : ""}>${option}</option>`
      ).join("");

      return `
      <tr class="border-b border-white/10">
        <td class="px-2 py-2">
          <p class="font-medium">${row.name}</p>
          <p class="text-xs text-slate-300">${row.phone}</p>
        </td>
        <td class="px-2 py-2">${row.date} ${row.time}</td>
        <td class="px-2 py-2">${row.guests}</td>
        <td class="px-2 py-2">
          <select data-id="${row.id}" class="reservation-status rounded border border-white/20 bg-slate-950 px-2 py-1">
            ${options}
          </select>
        </td>
        <td class="px-2 py-2">
          <button data-id="${row.id}" class="update-status rounded bg-sky-600 px-3 py-1 text-xs font-semibold hover:bg-sky-700">Update</button>
        </td>
      </tr>`;
    })
    .join("");

  document.querySelectorAll(".update-status").forEach((button) => {
    button.addEventListener("click", () => {
      const id = Number(button.dataset.id);
      const select = document.querySelector(`.reservation-status[data-id="${id}"]`);
      updateReservationStatus(id, select.value);
    });
  });
}

function renderMessages(rows) {
  if (!rows.length) {
    messageRows.innerHTML = '<p class="text-slate-400">No messages found.</p>';
    return;
  }

  messageRows.innerHTML = rows
    .map(
      (row) => `
      <article class="rounded-lg border border-white/10 bg-slate-950 p-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="font-medium">${row.name}</p>
            <p class="text-xs text-slate-400">${row.email}</p>
          </div>
          <span class="rounded bg-white/10 px-2 py-1 text-xs">${row.status}</span>
        </div>
        <p class="mt-2 text-sm text-slate-200">${row.message}</p>
        <p class="mt-1 text-xs text-slate-400">${row.created_at}</p>
      </article>`
    )
    .join("");
}

function renderOrders(rows) {
  if (!rows.length) {
    orderRows.innerHTML =
      '<tr><td colspan="5" class="px-2 py-3 text-slate-400">No orders found.</td></tr>';
    return;
  }

  orderRows.innerHTML = rows
    .map((row) => {
      const options = ORDER_STATUS_OPTIONS.map(
        (option) =>
          `<option value="${option}" ${row.status === option ? "selected" : ""}>${option}</option>`
      ).join("");

      return `
      <tr class="border-b border-white/10">
        <td class="px-2 py-2">
          <p class="font-medium">#${row.id}</p>
          <p class="text-xs text-slate-400">${row.created_at}</p>
        </td>
        <td class="px-2 py-2 text-xs text-slate-300">${row.items_summary || "-"}</td>
        <td class="px-2 py-2 font-medium">${formatCurrency(row.total_inr)}</td>
        <td class="px-2 py-2">
          <select data-id="${row.id}" class="order-status rounded border border-white/20 bg-slate-950 px-2 py-1">
            ${options}
          </select>
        </td>
        <td class="px-2 py-2">
          <button data-id="${row.id}" class="update-order-status rounded bg-admin-500 px-3 py-1 text-xs font-semibold hover:bg-admin-700">Update</button>
        </td>
      </tr>`;
    })
    .join("");

  document.querySelectorAll(".update-order-status").forEach((button) => {
    button.addEventListener("click", () => {
      const id = Number(button.dataset.id);
      const select = document.querySelector(`.order-status[data-id="${id}"]`);
      updateOrderStatus(id, select.value);
    });
  });
}

async function fetchJSON(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (_) {
    payload = {};
  }
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

async function checkAdminServerConfig() {
  try {
    const data = await fetchJSON("/api/admin/status");
    state.statusConfig = data;
    setAuthInfo();
    if (!data.adminConfigured) {
      setStatusMessage(
        "Server me admin auth configured nahi hai. .env me ADMIN_USERS_JSON/ADMIN_API_KEY set karo.",
        true
      );
      return false;
    }
    return true;
  } catch (_) {
    setStatusMessage("Server status check failed. Ensure backend is running.", true);
    return false;
  }
}

async function loginAdmin() {
  const configured = await checkAdminServerConfig();
  if (!configured) return;
  const username = String(adminUsernameInput.value || "").trim();
  const password = String(adminPasswordInput.value || "");
  if (!username || !password) {
    setStatusMessage("Enter username and password.", true);
    return;
  }

  try {
    const data = await fetchJSON("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    state.token = data.token || "";
    state.user = data.user || null;
    saveSession();
    setStatusMessage("Login successful.", false);
    adminPasswordInput.value = "";
    loadAdminData();
  } catch (error) {
    setStatusMessage(error.message, true);
  }
}

async function loadAdminData() {
  const configured = await checkAdminServerConfig();
  if (!configured) return;

  if (!state.token && !getAdminKey()) {
    setStatusMessage("Login karo ya legacy admin key enter karo.", true);
    return;
  }

  setStatusMessage("Loading data...", false);

  try {
    const [analyticsData, reservationData, messageData, orderData] = await Promise.all([
      fetchJSON("/api/admin/analytics", { headers: getHeaders() }),
      fetchJSON("/api/admin/reservations", { headers: getHeaders() }),
      fetchJSON("/api/admin/messages", { headers: getHeaders() }),
      fetchJSON("/api/admin/orders", { headers: getHeaders() })
    ]);

    renderAnalytics(analyticsData.analytics || {});
    renderReservations(reservationData.reservations || []);
    renderMessages(messageData.messages || []);
    renderOrders(orderData.orders || []);
    setStatusMessage("Admin data loaded.", false);
  } catch (error) {
    setStatusMessage(error.message, true);
  }
}

async function updateReservationStatus(id, status) {
  try {
    await fetchJSON(`/api/admin/reservations/${id}/status`, {
      method: "PATCH",
      headers: getHeaders(),
      body: JSON.stringify({ status })
    });
    setStatusMessage(`Reservation #${id} updated to ${status}.`, false);
    loadAdminData();
  } catch (error) {
    setStatusMessage(error.message, true);
  }
}

async function updateOrderStatus(id, status) {
  try {
    await fetchJSON(`/api/admin/orders/${id}/status`, {
      method: "PATCH",
      headers: getHeaders(),
      body: JSON.stringify({ status })
    });
    setStatusMessage(`Order #${id} updated to ${status}.`, false);
    loadAdminData();
  } catch (error) {
    setStatusMessage(error.message, true);
  }
}

adminPasswordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    loginAdmin();
  }
});

adminKeyInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    loadAdminData();
  }
});

loginBtn.addEventListener("click", loginAdmin);
logoutBtn.addEventListener("click", logout);
loadBtn.addEventListener("click", loadAdminData);

setAuthInfo();
checkAdminServerConfig();
