/* Delivery Date & Time Slot Picker — native, no app */
(function () {
  'use strict';

  var CFG_ID = 'DeliveryPickerConfig';
  var LS_KEY = 'dp_selection';

  var cfg = null, rules = null, mounted = new WeakSet(), syncing = false;

  /* ---------- utils ---------- */
  function pad(n) { return String(n).padStart(2, '0'); }
  function keyOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function parseKey(k) { var p = String(k).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function prettyDate(k) {
    if (!k) return '';
    try {
      return parseKey(k).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    } catch (e) { return k; }
  }

  /* ---------- config + rules ---------- */
  function readConfig() {
    var node = document.getElementById(CFG_ID);
    if (!node) return null;
    try { return JSON.parse(node.textContent); } catch (e) { return null; }
  }

  function buildRules(c) {
    var closed = new Set();
    String(c.closedWeekdaysRaw || '').split(',').forEach(function (s) {
      var n = parseInt(s.trim(), 10);
      if (Number.isInteger(n) && n >= 0 && n <= 6) closed.add(n);
    });
    var holidays = new Set();
    String(c.holidaysRaw || '').split(/\r?\n/).forEach(function (s) {
      s = s.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) holidays.add(s);
    });
    var p = String(c.cutoff || '13:00').split(':');
    return {
      closed: closed,
      holidays: holidays,
      cutH: parseInt(p[0], 10) || 0,
      cutM: parseInt(p[1], 10) || 0
    };
  }

  function minDate() {
    var now = new Date();
    var d = addDays(startOfDay(now), Number(cfg.leadDays) || 0);
    if (Number(cfg.leadDays) === 0) {
      var past = now.getHours() > rules.cutH ||
        (now.getHours() === rules.cutH && now.getMinutes() >= rules.cutM);
      if (past) d = addDays(d, 1);
    }
    return d;
  }
  function maxDate() { return addDays(startOfDay(new Date()), Number(cfg.maxDays) || 30); }

  function isBlackout(d) {
    return rules.closed.has(d.getDay()) || rules.holidays.has(keyOf(d));
  }
  function nextOpen(from) {
    var d = new Date(from), max = maxDate(), guard = 0;
    while (d <= max && guard++ < 400) {
      if (!isBlackout(d)) return d;
      d = addDays(d, 1);
    }
    return null;
  }

  /* ---------- state ---------- */
  var state = { date: null, variantId: null, variantTitle: null };

  function saveState() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function loadState() {
    try {
      var s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (s && s.date) state = Object.assign(state, s);
    } catch (e) {}
  }

  /* ---------- cart ---------- */
  function cartFetch(url, body) {
    return fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : { 'Accept': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json(); });
  }

  async function hydrateFromCart() {
    try {
      var cart = await cartFetch('/cart.js');
      var attrs = cart.attributes || {};
      if (attrs['Delivery Date']) state.date = attrs['Delivery Date'];
      if (attrs['Delivery Time Slot']) state.variantTitle = attrs['Delivery Time Slot'];
      var line = (cart.items || []).find(function (i) {
        return String(i.product_id) === String(cfg.slotProductId);
      });
      if (line) state.variantId = String(line.variant_id);
    } catch (e) {}
  }

  async function syncCart() {
    if (syncing) return;
    syncing = true;
    try {
      var cart = await cartFetch('/cart.js');
      var updates = {};
      (cart.items || []).forEach(function (i) {
        if (String(i.product_id) === String(cfg.slotProductId)) updates[i.key] = 0;
      });
      if (Object.keys(updates).length) {
        await cartFetch('/cart/update.js', { updates: updates });
      }

      if (state.variantId) {
        await cartFetch('/cart/add.js', {
          items: [{
            id: Number(state.variantId),
            quantity: 1,
            properties: {
              '_Delivery Date': state.date || '',
              '_Delivery Window': state.variantTitle || ''
            }
          }]
        });
      }

      await cartFetch('/cart/update.js', {
        attributes: {
          'Delivery Date': state.date || '',
          'Delivery Time Slot': state.variantTitle || ''
        }
      });

      saveState();
      broadcastCartUpdate();
    } finally {
      syncing = false;
    }
  }

  function broadcastCartUpdate() {
    ['cart:refresh', 'cart:update', 'cart-update'].forEach(function (n) {
      document.dispatchEvent(new CustomEvent(n, { bubbles: true }));
    });
    document.dispatchEvent(new CustomEvent('delivery:updated', { detail: Object.assign({}, state) }));
  }

  /* ---------- required enforcement (soft) ---------- */
  function enforceRequired() {
    if (!cfg.required) return;
    var blocked = !state.date || !state.variantId;
    document.querySelectorAll('[name="checkout"], button[name="checkout"]').forEach(function (btn) {
      btn.disabled = blocked;
      btn.setAttribute('aria-disabled', blocked ? 'true' : 'false');
      if (blocked) btn.setAttribute('title', 'Please choose a delivery date and time first.');
      else btn.removeAttribute('title');
    });
  }

  /* ---------- mount ---------- */
  function mount(root) {
    if (!root || mounted.has(root)) return;
    mounted.add(root);

    var dateInput = root.querySelector('#dp-date');
    var slotsWrap = root.querySelector('#dp-slots');
    var msg = root.querySelector('#dp-msg');
    var picker = null;

    function setMsg(text, type) {
      if (!msg) return;
      msg.textContent = text || '';
      msg.className = 'dp__msg' + (type ? ' is-' + type : '');
    }

    function highlight() {
      slotsWrap.querySelectorAll('.dp__slot').forEach(function (btn) {
        var on = String(btn.dataset.variantId) === String(state.variantId);
        btn.classList.toggle('is-selected', on);
        btn.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    }

    async function refreshSlots() {
      slotsWrap.classList.add('is-loading');
      try {
        var res = await fetch('/?sections=delivery-slots', { headers: { 'Accept': 'application/json' } });
        var data = await res.json();
        var html = data['delivery-slots'];
        if (!html) throw new Error('section missing');
        var tmp = document.createElement('div');
        tmp.innerHTML = html;
        var fresh = tmp.querySelector('#dp-slots');
        if (fresh) slotsWrap.innerHTML = fresh.innerHTML;
      } catch (e) {
        /* keep the server-rendered slots as fallback */
      } finally {
        slotsWrap.classList.remove('is-loading');
        highlight();
      }
    }

    async function onDateChange(dateStr) {
      if (!dateStr) return;
      var d = parseKey(dateStr);

      if (isBlackout(d)) {
        setMsg('Sarado kami sa araw na iyon. Pumili ng ibang petsa.', 'error');
        if (picker) picker.clear();
        state.date = null; state.variantId = null; state.variantTitle = null;
        highlight(); enforceRequired();
        return;
      }

      var wasSameDate = state.date === dateStr;
      state.date = dateStr;

      if (!wasSameDate) {
        state.variantId = null;
        state.variantTitle = null;
      }

      setMsg('Kinukuha ang available na time slots…');
      await refreshSlots();

      var anyOpen = slotsWrap.querySelector('.dp__slot:not([disabled])');
      if (!anyOpen) {
        setMsg('Wala nang available na time window sa araw na ito. Pumili ng ibang petsa.', 'error');
        state.variantId = null; state.variantTitle = null;
      } else if (state.variantId) {
        setMsg('Delivery: ' + prettyDate(state.date) + ', ' + state.variantTitle, 'ok');
      } else {
        setMsg('Pumili ng time window.', '');
      }
      highlight(); enforceRequired();
    }

    slotsWrap.addEventListener('click', async function (e) {
      var btn = e.target.closest('.dp__slot');
      if (!btn || btn.disabled) return;
      if (!state.date) { setMsg('Pumili muna ng petsa.', 'error'); return; }

      state.variantId = String(btn.dataset.variantId);
      state.variantTitle = btn.dataset.title || '';
      highlight();
      setMsg('Sine-save…');

      try {
        await syncCart();
        setMsg('Delivery set: ' + prettyDate(state.date) + ', ' + state.variantTitle, 'ok');
      } catch (err) {
        setMsg('May problema sa pag-save. Subukan ulit.', 'error');
      }
      enforceRequired();
    });

    /* ---------- date picker ---------- */
    function initDatePicker() {
      var min = minDate(), max = maxDate();

      if (typeof window.flatpickr === 'undefined') {
        dateInput.type = 'date';
        dateInput.readOnly = false;
        dateInput.min = keyOf(min);
        dateInput.max = keyOf(max);
        if (state.date) dateInput.value = state.date;
        dateInput.addEventListener('change', function () {
          if (dateInput.value) onDateChange(dateInput.value);
        });
        if (state.date) onDateChange(state.date);
        return;
      }

      var initial = state.date && !isBlackout(parseKey(state.date)) ? state.date : null;
      if (!initial) {
        var n = nextOpen(min);
        initial = n ? keyOf(n) : null;
      }

      picker = window.flatpickr(dateInput, {
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: 'D, M j, Y',
        minDate: min,
        maxDate: max,
        defaultDate: initial || undefined,
        disable: [function (date) { return isBlackout(date); }],
        disableMobile: true,
        onChange: function (dates, str) { if (str) onDateChange(str); }
      });

      if (initial) onDateChange(initial);
    }

    initDatePicker();
    highlight();
    enforceRequired();
  }

  function initAll() {
    if (!cfg) return;
    document.querySelectorAll('[data-dp]').forEach(mount);
    document.querySelectorAll('cart-drawer').forEach(function (d) {
      if (!d._dpListener) {
        d._dpListener = true;
        d.addEventListener('click', function () { setTimeout(initAll, 120); });
      }
    });
  }

  /* ---------- boot ---------- */
  async function boot() {
    cfg = readConfig();
    if (!cfg) return;
    rules = buildRules(cfg);
    loadState();
    await hydrateFromCart();
    initAll();

    document.addEventListener('delivery:updated', function () {
      setTimeout(function () { enforceRequired(); }, 50);
    });
  }

  window.DeliveryPicker = { init: initAll, state: function () { return Object.assign({}, state); } };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();