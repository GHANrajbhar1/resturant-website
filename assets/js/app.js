const state = {
  activeCategory: "All",
  cart: JSON.parse(localStorage.getItem("spiceroot-cart") || "[]"),
  stripeEnabled: false,
  razorpayEnabled: false,
  primaryPaymentProvider: null
};

const menuGrid = document.getElementById("menuGrid");
const filtersWrap = document.getElementById("categoryFilters");
const cartBtn = document.getElementById("cartBtn");
const cartBtnMobile = document.getElementById("cartBtnMobile");
const closeCart = document.getElementById("closeCart");
const overlay = document.getElementById("overlay");
const cartItems = document.getElementById("cartItems");
const cartTotal = document.getElementById("cartTotal");
const checkoutBtn = document.getElementById("checkoutBtn");
const upiBtn = document.getElementById("upiBtn");
const codBtn = document.getElementById("codBtn");
const paymentMsg = document.getElementById("paymentMsg");
const configPanel = document.getElementById("configPanel");
const configList = document.getElementById("configList");
const reservationMsg = document.getElementById("reservationMsg");
const contactMsg = document.getElementById("contactMsg");
const toastWrap = document.getElementById("toastWrap");

const menuBtn = document.getElementById("menuBtn");
const mobileNav = document.getElementById("mobileNav");

function formatCurrency(value) {
  return `Rs.${value}`;
}

function saveCart() {
  localStorage.setItem("spiceroot-cart", JSON.stringify(state.cart));
}

function categories() {
  return ["All", ...new Set(window.menuItems.map((item) => item.category))];
}

function renderFilters() {
  filtersWrap.innerHTML = "";
  categories().forEach((category) => {
    const btn = document.createElement("button");
    const active = state.activeCategory === category;
    btn.className = `rounded-full px-3 py-1.5 text-sm border ${active ? "bg-brand-500 border-brand-500" : "border-white/20 hover:bg-white/10"}`;
    btn.textContent = category;
    btn.addEventListener("click", () => {
      state.activeCategory = category;
      renderFilters();
      renderMenu();
    });
    filtersWrap.appendChild(btn);
  });
}

function addToCart(id) {
  const found = state.cart.find((item) => item.id === id);
  if (found) {
    found.qty += 1;
  } else {
    state.cart.push({ id, qty: 1 });
  }
  saveCart();
  updateCartUI();
}

function updateQty(id, delta) {
  const found = state.cart.find((item) => item.id === id);
  if (!found) return;
  found.qty += delta;
  state.cart = state.cart.filter((item) => item.qty > 0);
  saveCart();
  updateCartUI();
}

function renderMenu() {
  const filtered =
    state.activeCategory === "All"
      ? window.menuItems
      : window.menuItems.filter((item) => item.category === state.activeCategory);

  menuGrid.innerHTML = filtered
    .map(
      (item) => `
      <article class="menu-card">
        <img loading="lazy" src="${item.image}" alt="${item.name}" />
        <div class="space-y-2 p-4">
          <div class="flex items-start justify-between gap-2">
            <h3 class="font-semibold">${item.name}</h3>
            <span class="text-brand-100">${formatCurrency(item.price)}</span>
          </div>
          <p class="text-sm text-slate-300">${item.description}</p>
          <button data-id="${item.id}" class="add-to-cart mt-2 rounded bg-brand-500 px-3 py-2 text-sm font-semibold hover:bg-brand-700">Add to Order</button>
        </div>
      </article>`
    )
    .join("");

  document.querySelectorAll(".add-to-cart").forEach((button) => {
    button.addEventListener("click", () => addToCart(Number(button.dataset.id)));
  });
}

function updateCartUI() {
  const count = state.cart.reduce((sum, item) => sum + item.qty, 0);
  cartBtn.textContent = `Cart (${count})`;
  cartBtnMobile.textContent = `Cart (${count})`;

  const detailed = state.cart
    .map((entry) => {
      const item = window.menuItems.find((menuItem) => menuItem.id === entry.id);
      return item ? { ...item, qty: entry.qty } : null;
    })
    .filter(Boolean);

  if (!detailed.length) {
    cartItems.innerHTML = '<p class="text-sm text-slate-300">Your cart is empty.</p>';
    cartTotal.textContent = formatCurrency(0);
    return;
  }

  cartItems.innerHTML = detailed
    .map(
      (item) => `
      <div class="rounded-lg border border-white/10 bg-white/5 p-3">
        <div class="flex items-start justify-between gap-2">
          <div>
            <p class="font-medium">${item.name}</p>
            <p class="text-sm text-slate-300">${formatCurrency(item.price)} x ${item.qty}</p>
          </div>
          <div class="flex items-center gap-2">
            <button data-id="${item.id}" data-action="minus" class="qty-btn rounded border border-white/20 px-2">-</button>
            <button data-id="${item.id}" data-action="plus" class="qty-btn rounded border border-white/20 px-2">+</button>
          </div>
        </div>
      </div>`
    )
    .join("");

  const total = detailed.reduce((sum, item) => sum + item.price * item.qty, 0);
  cartTotal.textContent = formatCurrency(total);

  document.querySelectorAll(".qty-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const id = Number(button.dataset.id);
      const delta = button.dataset.action === "plus" ? 1 : -1;
      updateQty(id, delta);
    });
  });
}

function toggleCart(open) {
  const isOpen =
    typeof open === "boolean" ? open : !document.body.classList.contains("cart-open");
  document.body.classList.toggle("cart-open", isOpen);
}

function showMessage(element, text, isError) {
  if (!element) return;
  element.textContent = text;
  element.className = `text-sm ${isError ? "text-red-300" : "text-emerald-300"}`;
}

function showToast(message, isError) {
  if (!toastWrap) return;
  const toast = document.createElement("div");
  toast.className = `toast-item ${isError ? "toast-error" : "toast-success"}`;
  toast.textContent = message;
  toastWrap.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("toast-hide");
    setTimeout(() => toast.remove(), 260);
  }, 2800);
}

async function loadConfig() {
  if (!checkoutBtn) return;
  try {
    const response = await fetch("/api/config");
    if (!response.ok) return;
    const data = await response.json();
    state.stripeEnabled = Boolean(data.stripeEnabled);
    state.razorpayEnabled = Boolean(data.razorpayEnabled);
    state.primaryPaymentProvider = data.primaryPaymentProvider || null;
    renderConfigPanel(data);
    if (upiBtn) {
      upiBtn.disabled = !Boolean(data.upiConfigured);
      upiBtn.classList.toggle("opacity-50", !data.upiConfigured);
      upiBtn.classList.toggle("cursor-not-allowed", !data.upiConfigured);
    }
    const onlineEnabled = state.razorpayEnabled || state.stripeEnabled;
    if (!onlineEnabled) {
      checkoutBtn.textContent = "Online Payment Unavailable";
      checkoutBtn.disabled = true;
      if (paymentMsg) {
        paymentMsg.textContent = "Online payment temporarily unavailable. Contact restaurant support.";
      }
    } else {
      checkoutBtn.textContent =
        state.primaryPaymentProvider === "razorpay" ? "Pay Online (Razorpay)" : "Pay Online";
      checkoutBtn.disabled = false;
      if (paymentMsg) {
        paymentMsg.textContent = "";
      }
    }
  } catch (_) {
    checkoutBtn.textContent = "Payment Server Offline";
    checkoutBtn.disabled = true;
    renderConfigPanel(null);
    if (paymentMsg) {
      paymentMsg.textContent = "Payment service unavailable. Try again in a moment.";
    }
  }
}

function renderConfigPanel(config) {
  if (!configPanel || !configList) return;
  const items = [];

  if (!config) {
    items.push("Unable to fetch server configuration.");
  } else {
    (config.missingAdmin || []).forEach((item) => items.push(`Admin: ${item}`));
    (config.missingRazorpay || []).forEach((item) => items.push(`Payment: ${item}`));
    (config.missingStripe || []).forEach((item) => items.push(`Payment: ${item}`));
    (config.missingSmtp || []).forEach((item) => items.push(`Email: ${item}`));
    (config.missingUpi || []).forEach((item) => items.push(`UPI: ${item}`));
  }

  if (!items.length) {
    configPanel.classList.add("hidden");
    configList.innerHTML = "";
    return;
  }

  configPanel.classList.remove("hidden");
  configList.innerHTML = items.map((item) => `<li>${item}</li>`).join("");
}

function clearCartAndRefresh() {
  state.cart = [];
  saveCart();
  updateCartUI();
}

async function placeManualOrder(mode) {
  if (!state.cart.length) {
    showToast("Cart is empty. Add items first.", true);
    return;
  }

  const triggerBtn = mode === "upi" ? upiBtn : codBtn;
  if (triggerBtn) {
    triggerBtn.disabled = true;
  }

  try {
    const response = await fetch("/api/orders/manual-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        items: state.cart
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Order failed.");
    }

    if (mode === "upi" && data.upiUrl) {
      window.location.href = data.upiUrl;
      showToast(`UPI order #${data.orderId} created. Complete payment in your UPI app.`, false);
    } else {
      showToast(`COD order #${data.orderId} placed successfully.`, false);
    }
    clearCartAndRefresh();
    toggleCart(false);
  } catch (error) {
    showToast(error.message, true);
    if (paymentMsg) {
      paymentMsg.textContent = error.message;
    }
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
    }
  }
}

let razorpayScriptPromise = null;

function loadRazorpayScript() {
  if (window.Razorpay) return Promise.resolve();
  if (razorpayScriptPromise) return razorpayScriptPromise;
  razorpayScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Unable to load Razorpay checkout script."));
    document.head.appendChild(script);
  });
  return razorpayScriptPromise;
}

async function startRazorpayCheckout(config) {
  await loadRazorpayScript();

  return new Promise((resolve, reject) => {
    const paymentObject = new window.Razorpay({
      key: config.keyId,
      amount: config.amount,
      currency: config.currency,
      name: config.name,
      description: config.description,
      order_id: config.orderId,
      handler: async (response) => {
        try {
          const verifyResponse = await fetch("/api/payments/verify-razorpay", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(response)
          });
          const verifyData = await verifyResponse.json();
          if (!verifyResponse.ok) {
            throw new Error(verifyData.error || "Payment verification failed.");
          }
          resolve();
        } catch (error) {
          reject(error);
        }
      },
      theme: { color: "#f97316" },
      modal: {
        ondismiss: () => reject(new Error("Payment cancelled by user."))
      }
    });
    paymentObject.open();
  });
}

async function createOnlineCheckout() {
  if (!state.cart.length) {
    showToast("Cart is empty. Add items first.", true);
    return;
  }
  if (!state.stripeEnabled && !state.razorpayEnabled) {
    if (paymentMsg) {
      paymentMsg.textContent = "Online payment is not configured yet. Please contact restaurant support.";
    }
    showToast("Online payment unavailable right now.", true);
    return;
  }
  checkoutBtn.disabled = true;
  checkoutBtn.textContent = "Processing...";

  try {
    const response = await fetch("/api/payments/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: state.cart })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Unable to start payment.");
    }
    if (payload.provider === "razorpay" && payload.razorpay) {
      await startRazorpayCheckout(payload.razorpay);
      showToast("Payment successful. Thank you for your order.", false);
      clearCartAndRefresh();
      toggleCart(false);
      if (paymentMsg) paymentMsg.textContent = "";
      return;
    }
    if (payload.checkoutUrl) {
      window.location.href = payload.checkoutUrl;
      return;
    }
    throw new Error("Missing checkout redirect URL.");
  } catch (error) {
    if (paymentMsg) {
      paymentMsg.textContent = error.message;
    } else {
      showToast(error.message, true);
    }
    checkoutBtn.disabled = false;
    checkoutBtn.textContent =
      state.razorpayEnabled || state.stripeEnabled
        ? state.primaryPaymentProvider === "razorpay"
          ? "Pay Online (Razorpay)"
          : "Pay Online"
        : "Online Payment Unavailable";
  }
}

function handlePaymentStatusFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const payment = params.get("payment");
  if (payment === "success") {
    showToast("Payment successful. Thank you for your order.", false);
    state.cart = [];
    saveCart();
    updateCartUI();
    params.delete("payment");
    const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
    history.replaceState({}, "", newUrl);
  } else if (payment === "cancelled") {
    showToast("Payment was cancelled. You can retry anytime.", true);
    params.delete("payment");
    const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
    history.replaceState({}, "", newUrl);
  }
}

if (cartBtn) cartBtn.addEventListener("click", () => toggleCart(true));
if (cartBtnMobile) cartBtnMobile.addEventListener("click", () => toggleCart(true));
if (closeCart) closeCart.addEventListener("click", () => toggleCart(false));
if (overlay) overlay.addEventListener("click", () => toggleCart(false));
if (menuBtn && mobileNav) {
  menuBtn.addEventListener("click", () => mobileNav.classList.toggle("hidden"));
}
if (checkoutBtn) checkoutBtn.addEventListener("click", createOnlineCheckout);
if (upiBtn) upiBtn.addEventListener("click", () => placeManualOrder("upi"));
if (codBtn) codBtn.addEventListener("click", () => placeManualOrder("cod"));

const reservationForm = document.getElementById("reservationForm");
if (reservationForm) {
  reservationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (reservationMsg) {
      reservationMsg.textContent = "Submitting reservation...";
    }
    const formElement = event.currentTarget;
    const formData = new FormData(formElement);
    const payload = Object.fromEntries(formData.entries());

    try {
      const response = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Reservation failed.");
      }
      showMessage(
        reservationMsg,
        `Reservation confirmed. ID: #${data.reservationId}`,
        false
      );
      showToast("Reservation submitted successfully.", false);
      if (formElement && typeof formElement.reset === "function") {
        formElement.reset();
      }
    } catch (error) {
      showMessage(reservationMsg, error.message, true);
      showToast(error.message, true);
    }
  });
}

const contactForm = document.getElementById("contactForm");
if (contactForm) {
  contactForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (contactMsg) {
      contactMsg.textContent = "Sending message...";
    }
    const formElement = event.currentTarget;
    const formData = new FormData(formElement);
    const payload = Object.fromEntries(formData.entries());

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Message failed.");
      }
      showMessage(contactMsg, data.message, false);
      showToast("Message sent successfully.", false);
      if (formElement && typeof formElement.reset === "function") {
        formElement.reset();
      }
    } catch (error) {
      showMessage(contactMsg, error.message, true);
      showToast(error.message, true);
    }
  });
}

const yearElement = document.getElementById("year");
if (yearElement) {
  yearElement.textContent = new Date().getFullYear();
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Service worker can fail in restricted environments.
    });
  });
}

renderFilters();
renderMenu();
updateCartUI();
loadConfig();
handlePaymentStatusFromUrl();
