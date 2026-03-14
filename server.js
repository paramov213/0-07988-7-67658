/* ═══════════════════════════════════════════════════════════════════════════
   BROKE — Autonomous P2P Messenger | script.js
   Full Logic Stack — PeerJS + Dexie.js + Admin System + Ghost Premium
   ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

/* ═══════════════════════════════════════════════
   SECTION 1: GLOBAL STATE
═══════════════════════════════════════════════ */
const BROKE = {
  /* Node identity */
  myPeerId:        null,
  isAdmin:         false,
  isPremium:       false,
  adminId:         'xeone',

  /* PeerJS */
  peer:            null,
  connections:     new Map(),   // peerId → DataConnection
  activePeerId:    null,

  /* Media calls */
  currentCall:     null,
  localStream:     null,
  isMuted:         false,
  isCamOff:        false,
  incomingCall:    null,

  /* UI state */
  destructTimer:   0,           // seconds, 0 = off
  panicActive:     false,
  fakeHistoryMode: false,
  adminPanelOpen:  false,
  unread:          new Map(),   // peerId → count
  typingTimers:    new Map(),
  pendingFile:     null,

  /* Stats */
  startTime:       Date.now(),
  bytesTransferred:0,
  messageCount:    0,

  /* Heartbeat */
  heartbeatInterval: null,
  reconnectTimers:   new Map(),

  /* Maintenance lock */
  networkLocked:   false,

  /* PEERJS SERVER CONFIG */
  peerConfig: {
    debug: 0,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
      ]
    }
  }
};

/* ═══════════════════════════════════════════════
   SECTION 2: DATABASE (DEXIE.JS)
═══════════════════════════════════════════════ */
const db = new Dexie('BrokeMessenger');
db.version(1).stores({
  messages: '++id, peerId, timestamp, type, direction',
  peers:    'peerId, lastSeen, nickname',
  settings: 'key'
});

async function dbSaveMessage(msg) {
  try { await db.messages.add(msg); } catch(e) { console.warn('DB save error', e); }
}

async function dbGetMessages(peerId, limit = 10000) {
  try {
    return await db.messages
      .where('peerId').equals(peerId)
      .limit(limit)
      .sortBy('timestamp');
  } catch(e) { return []; }
}

async function dbClearMessages(peerId) {
  try { await db.messages.where('peerId').equals(peerId).delete(); } catch(e) {}
}

async function dbPurgeAll() {
  try {
    await db.messages.clear();
    await db.peers.clear();
    toast('Database purged.', 'warning');
  } catch(e) { toast('Purge failed: ' + e.message, 'error'); }
}

async function dbSavePeer(peerId) {
  try {
    await db.peers.put({ peerId, lastSeen: Date.now() });
  } catch(e) {}
}

async function dbGetSetting(key) {
  try { const r = await db.settings.get(key); return r ? r.value : null; } catch(e) { return null; }
}
async function dbSetSetting(key, value) {
  try { await db.settings.put({ key, value }); } catch(e) {}
}

/* ═══════════════════════════════════════════════
   SECTION 3: STARTUP & ACCESS CHECKS
═══════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  /* Check ban */
  if (localStorage.getItem('broke_banned') === 'true') {
    show('access-denied-screen');
    return;
  }

  /* Check maintenance lock (persisted by admin command) */
  if (localStorage.getItem('broke_maintenance') === 'true') {
    show('maintenance-screen');
    /* Still allow hidden admin override — triple-click logo */
    document.querySelector('.maintenance-icon')?.addEventListener('dblclick', () => {
      if (BROKE.isAdmin) {
        localStorage.removeItem('broke_maintenance');
        location.reload();
      }
    });
    return;
  }

  /* Check premium from localStorage */
  if (localStorage.getItem('broke_premium') === 'true') {
    BROKE.isPremium = true;
  }

  /* Show admin modal first */
  show('admin-modal');
  document.getElementById('modal-connect-btn').addEventListener('click', handleModalConnect);
  document.getElementById('modal-admin-id').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleModalConnect();
  });
  document.getElementById('modal-peer-id').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleModalConnect();
  });

  /* Global key bindings */
  document.addEventListener('keydown', handleGlobalKeys);

  /* Visibility change — Anti-Spy for premium */
  document.addEventListener('visibilitychange', handleVisibilityChange);
});

function handleModalConnect() {
  const customId  = document.getElementById('modal-peer-id').value.trim();
  const adminPass = document.getElementById('modal-admin-id').value.trim();

  /* Validate admin */
  if (adminPass === BROKE.adminId) {
    BROKE.isAdmin = true;
  } else if (adminPass !== '') {
    toast('Invalid admin passphrase.', 'error');
    return;
  }

  hide('admin-modal');
  show('app');
  initApp(customId || null);
}

/* ═══════════════════════════════════════════════
   SECTION 4: APP INITIALIZATION
═══════════════════════════════════════════════ */
function initApp(customId) {
  /* Admin UI */
  if (BROKE.isAdmin) {
    show('admin-badge');
    show('admin-panel-toggle');
    initAdminPanel();
  }

  /* Premium UI */
  if (BROKE.isPremium) {
    show('premium-badge');
    document.body.classList.add('premium');
  }

  /* Bind UI */
  bindChatUI();
  bindSidebarUI();
  bindMediaUI();
  bindDestructUI();
  bindEmojiUI();
  bindContextMenus();

  /* Admin panel toggle */
  document.getElementById('admin-panel-toggle').addEventListener('click', toggleAdminPanel);

  /* Start PeerJS */
  initPeer(customId);

  /* Heartbeat for Render.com keep-alive */
  startHeartbeat();

  /* Uptime ticker */
  setInterval(updateStats, 1000);

  /* Show no-peer placeholder */
  showPlaceholder(true);
}

/* ═══════════════════════════════════════════════
   SECTION 5: PEERJS — PEER INIT
═══════════════════════════════════════════════ */
function initPeer(customId) {
  setStatus('connecting');

  const options = { ...BROKE.peerConfig };
  BROKE.peer = customId
    ? new Peer(customId, options)
    : new Peer(options);

  BROKE.peer.on('open', (id) => {
    BROKE.myPeerId = id;
    document.getElementById('my-peer-id-display').textContent = id;
    setStatus('online');
    toast('Node online: ' + id, 'success');
    adminLog('Node initialized: ' + id, 'ok');
    document.getElementById('stat-peers').textContent = BROKE.connections.size;
  });

  BROKE.peer.on('connection', (conn) => {
    handleIncomingConnection(conn);
  });

  BROKE.peer.on('call', (call) => {
    handleIncomingCall(call);
  });

  BROKE.peer.on('disconnected', () => {
    setStatus('offline');
    toast('Node disconnected. Reconnecting…', 'warning');
    adminLog('Peer disconnected — attempting reconnect', 'warn');
    scheduleReconnect();
  });

  BROKE.peer.on('error', (err) => {
    console.error('PeerJS error:', err);
    if (err.type === 'peer-unavailable') {
      toast('Peer not found or offline.', 'error');
    } else if (err.type === 'unavailable-id') {
      toast('Peer ID already taken. Reconnecting with new ID…', 'warning');
      setTimeout(() => initPeer(null), 1500);
    } else {
      toast('Network error: ' + err.type, 'error');
      adminLog('Error: ' + err.type, 'error');
    }
  });
}

function scheduleReconnect() {
  setTimeout(() => {
    if (BROKE.peer && BROKE.peer.disconnected && !BROKE.peer.destroyed) {
      try {
        BROKE.peer.reconnect();
        setStatus('connecting');
      } catch(e) {
        initPeer(null);
      }
    }
  }, 3000);
}

/* ═══════════════════════════════════════════════
   SECTION 6: CONNECTIONS — INCOMING
═══════════════════════════════════════════════ */
function handleIncomingConnection(conn) {
  setupConnection(conn);
  toast('Incoming connection from ' + conn.peer, 'info');
  adminLog('New peer connected: ' + conn.peer, 'ok');
  addPeerToSidebar(conn.peer);
  dbSavePeer(conn.peer);
}

function setupConnection(conn) {
  conn.on('open', () => {
    BROKE.connections.set(conn.peer, conn);
    updatePeerDot(conn.peer, true);
    document.getElementById('stat-peers').textContent = BROKE.connections.size;

    /* Send handshake */
    sendControl(conn, { type: 'HANDSHAKE', peerId: BROKE.myPeerId, premium: BROKE.isPremium });
  });

  conn.on('data', (data) => {
    handleIncomingData(conn.peer, data);
  });

  conn.on('close', () => {
    BROKE.connections.delete(conn.peer);
    updatePeerDot(conn.peer, false);
    document.getElementById('stat-peers').textContent = BROKE.connections.size;
    toast('Peer disconnected: ' + conn.peer, 'warning');

    /* Auto-reconnect if it was active chat */
    if (BROKE.activePeerId === conn.peer) {
      scheduleConnectionReconnect(conn.peer);
    }
  });

  conn.on('error', (err) => {
    console.warn('Connection error:', err);
    BROKE.connections.delete(conn.peer);
  });
}

function scheduleConnectionReconnect(peerId) {
  const timer = setTimeout(() => {
    connectToPeer(peerId, true);
  }, 5000);
  BROKE.reconnectTimers.set(peerId, timer);
}

/* ═══════════════════════════════════════════════
   SECTION 7: CONNECTIONS — OUTGOING
═══════════════════════════════════════════════ */
function connectToPeer(peerId, silent = false) {
  if (!peerId || peerId === BROKE.myPeerId) {
    if (!silent) toast('Invalid peer ID.', 'error');
    return;
  }

  if (BROKE.connections.has(peerId)) {
    selectPeer(peerId);
    return;
  }

  if (!silent) toast('Connecting to ' + peerId + '…', 'info');
  setStatus('connecting');

  const conn = BROKE.peer.connect(peerId, {
    reliable: true,
    serialization: 'json'
  });

  setupConnection(conn);
  addPeerToSidebar(peerId);
  dbSavePeer(peerId);

  conn.on('open', () => {
    setStatus('online');
    if (!silent) toast('Connected to ' + peerId, 'success');
    selectPeer(peerId);
  });
}

/* ═══════════════════════════════════════════════
   SECTION 8: DATA HANDLER (ALL MESSAGE TYPES)
═══════════════════════════════════════════════ */
function handleIncomingData(fromPeerId, data) {
  if (!data || !data.type) return;

  BROKE.bytesTransferred += JSON.stringify(data).length;

  switch (data.type) {

    /* ── CHAT MESSAGE ── */
    case 'MSG': {
      const msg = {
        id:        data.id || generateId(),
        peerId:    fromPeerId,
        content:   data.content,
        timestamp: data.timestamp || Date.now(),
        direction: 'recv',
        type:      'text',
        isPremium: data.isPremium || false,
        selfDestruct: data.selfDestruct || 0
      };
      dbSaveMessage(msg);
      BROKE.messageCount++;
      document.getElementById('stat-msgs').textContent = BROKE.messageCount;

      if (BROKE.activePeerId === fromPeerId) {
        renderMessage(msg);
        sendReadReceipt(fromPeerId, data.id);
      } else {
        incrementUnread(fromPeerId);
      }

      if (msg.selfDestruct > 0) {
        scheduleDestruct(msg.id, msg.selfDestruct * 1000);
      }
      break;
    }

    /* ── FILE MESSAGE ── */
    case 'FILE': {
      const msg = {
        id:        data.id || generateId(),
        peerId:    fromPeerId,
        content:   data.content,  /* base64 */
        fileName:  data.fileName,
        fileSize:  data.fileSize,
        fileType:  data.fileType,
        timestamp: Date.now(),
        direction: 'recv',
        type:      'file'
      };
      dbSaveMessage(msg);

      if (BROKE.activePeerId === fromPeerId) {
        renderMessage(msg);
      } else {
        incrementUnread(fromPeerId);
      }
      break;
    }

    /* ── TYPING INDICATOR ── */
    case 'TYPING': {
      showTypingIndicator(fromPeerId, data.isTyping);
      break;
    }

    /* ── READ RECEIPT ── */
    case 'READ': {
      markMessageRead(data.msgId);
      break;
    }

    /* ── HANDSHAKE ── */
    case 'HANDSHAKE': {
      const li = document.querySelector(`[data-peer="${fromPeerId}"] .peer-list-meta`);
      if (li && data.premium) li.textContent = '[GHOST]';
      break;
    }

    /* ══════════════════════════════════════
       ADMIN COMMANDS
    ══════════════════════════════════════ */

    /* ── BAN ── */
    case 'CMD_BAN': {
      if (data.targetId === BROKE.myPeerId || data.targetId === '*') {
        localStorage.setItem('broke_banned', 'true');
        toast('You have been banned by administrator.', 'error');
        setTimeout(() => {
          document.getElementById('app').style.display = 'none';
          show('access-denied-screen');
        }, 1500);
      }
      break;
    }

    /* ── GIVE PREMIUM ── */
    case 'CMD_GIVE_PREMIUM': {
      if (data.targetId === BROKE.myPeerId || data.targetId === '*') {
        localStorage.setItem('broke_premium', 'true');
        BROKE.isPremium = true;
        document.body.classList.add('premium');
        show('premium-badge');
        toast('🎉 You have been granted GHOST Premium!', 'success');
      }
      break;
    }

    /* ── REMOTE PURGE ── */
    case 'CMD_REMOTE_PURGE': {
      if (data.targetId === BROKE.myPeerId || data.targetId === '*') {
        dbPurgeAll();
      }
      break;
    }

    /* ── MAINTENANCE LOCK ── */
    case 'CMD_MAINTENANCE_ON': {
      localStorage.setItem('broke_maintenance', 'true');
      show('maintenance-screen');
      break;
    }
    case 'CMD_MAINTENANCE_OFF': {
      localStorage.removeItem('broke_maintenance');
      hide('maintenance-screen');
      toast('Network unlocked by administrator.', 'success');
      break;
    }

    /* ── SELF-DESTRUCT (peer-initiated) ── */
    case 'CMD_DESTRUCT': {
      const el = document.querySelector(`[data-msg-id="${data.msgId}"]`);
      if (el) {
        el.style.animation = 'toast-out 0.3s ease forwards';
        setTimeout(() => el.remove(), 300);
      }
      db.messages.delete(data.msgId).catch(() => {});
      break;
    }

    /* ── BROADCAST MESSAGE ── */
    case 'BROADCAST': {
      const sysMsg = {
        id:        generateId(),
        peerId:    fromPeerId,
        content:   '[BROADCAST] ' + data.content,
        timestamp: Date.now(),
        direction: 'system',
        type:      'system'
      };
      renderMessage(sysMsg);
      toast('[BROADCAST] ' + data.content, 'warning');
      break;
    }

    /* ── ADMIN TEXT MESSAGE ── */
    case 'ADMIN_MSG': {
      if (data.targetId === BROKE.myPeerId || data.targetId === '*') {
        toast('⚡ Admin: ' + data.content, 'warning');
        const sysMsg = {
          id:        generateId(),
          peerId:    fromPeerId,
          content:   '⚡ [ADMIN]: ' + data.content,
          timestamp: Date.now(),
          direction: 'system',
          type:      'system'
        };
        dbSaveMessage(sysMsg);
        if (BROKE.activePeerId === fromPeerId) renderMessage(sysMsg);
      }
      break;
    }
  }
}

/* ═══════════════════════════════════════════════
   SECTION 9: SEND MESSAGE
═══════════════════════════════════════════════ */
function sendMessage() {
  const input = document.getElementById('message-input');
  const content = input.value.trim();

  if (!content && !BROKE.pendingFile) return;
  if (!BROKE.activePeerId) { toast('Select a peer first.', 'warning'); return; }

  const conn = BROKE.connections.get(BROKE.activePeerId);
  if (!conn || !conn.open) { toast('Peer not connected.', 'error'); return; }

  /* File send */
  if (BROKE.pendingFile) {
    sendFile(conn);
    return;
  }

  const msgId = generateId();
  const msg = {
    id:           msgId,
    type:         'MSG',
    content:      content,
    timestamp:    Date.now(),
    isPremium:    BROKE.isPremium,
    selfDestruct: BROKE.destructTimer
  };

  try {
    conn.send(msg);
    BROKE.bytesTransferred += JSON.stringify(msg).length;
  } catch(e) {
    toast('Send failed: ' + e.message, 'error');
    return;
  }

  const localMsg = {
    ...msg,
    peerId:    BROKE.activePeerId,
    direction: 'sent',
    type:      'text',
    status:    'sent'
  };
  dbSaveMessage(localMsg);
  BROKE.messageCount++;
  document.getElementById('stat-msgs').textContent = BROKE.messageCount;
  renderMessage(localMsg);
  input.value = '';
  input.style.height = 'auto';

  if (BROKE.destructTimer > 0) {
    scheduleDestruct(msgId, BROKE.destructTimer * 1000, conn);
  }

  /* Stop typing signal */
  sendControl(conn, { type: 'TYPING', isTyping: false });
}

/* ═══════════════════════════════════════════════
   SECTION 10: FILE SEND
═══════════════════════════════════════════════ */
function sendFile(conn) {
  const file = BROKE.pendingFile;
  const reader = new FileReader();
  reader.onload = (e) => {
    const data = {
      type:     'FILE',
      id:       generateId(),
      content:  e.target.result,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      timestamp: Date.now()
    };
    try {
      conn.send(data);
      BROKE.bytesTransferred += file.size;
      const localMsg = { ...data, peerId: BROKE.activePeerId, direction: 'sent', type: 'file' };
      dbSaveMessage(localMsg);
      renderMessage(localMsg);
      clearFilePreview();
    } catch(e) {
      toast('File send failed: ' + e.message, 'error');
    }
  };
  reader.readAsDataURL(file);
}

function clearFilePreview() {
  BROKE.pendingFile = null;
  hide('media-preview-bar');
  document.getElementById('file-input').value = '';
}

/* ═══════════════════════════════════════════════
   SECTION 11: RENDER MESSAGE
═══════════════════════════════════════════════ */
function renderMessage(msg) {
  const list = document.getElementById('messages-list');
  if (!list) return;

  /* System message */
  if (msg.direction === 'system' || msg.type === 'system') {
    const row = document.createElement('div');
    row.className = 'msg-row system';
    row.dataset.msgId = msg.id;
    row.innerHTML = `<div class="msg-bubble system-bubble">${escHtml(msg.content)}</div>`;
    list.appendChild(row);
    scrollToBottom();
    return;
  }

  const isSent = msg.direction === 'sent';
  const row = document.createElement('div');
  row.className = 'msg-row ' + (isSent ? 'sent' : 'recv');
  row.dataset.msgId = msg.id;

  let bubbleContent = '';

  if (msg.type === 'file') {
    const sizeStr = formatBytes(msg.fileSize);
    const icon = getFileIcon(msg.fileType);
    bubbleContent = `
      <div class="msg-file" onclick="downloadFile('${msg.id}', '${escHtml(msg.fileName)}', '${msg.content}')">
        <div class="msg-file-icon">${icon}</div>
        <div class="msg-file-info">
          <div class="msg-file-name">${escHtml(msg.fileName)}</div>
          <div class="msg-file-size">${sizeStr}</div>
        </div>
      </div>`;
  } else {
    bubbleContent = escHtml(msg.content).replace(/\n/g, '<br>');
  }

  const time = formatTime(msg.timestamp);
  const ghostClass = msg.isPremium ? ' ghost-bubble' : '';
  const statusIcon = isSent ? (msg.status === 'read' ? '✓✓' : '✓') : '';

  row.innerHTML = `
    <div class="msg-bubble${ghostClass}">
      ${bubbleContent}
      <div class="msg-meta">
        <span>${time}</span>
        ${msg.isPremium ? '<span>👻</span>' : ''}
        ${isSent ? `<span class="msg-status">${statusIcon}</span>` : ''}
      </div>
    </div>`;

  list.appendChild(row);
  scrollToBottom();
}

/* ═══════════════════════════════════════════════
   SECTION 12: PEER SELECTION & HISTORY LOAD
═══════════════════════════════════════════════ */
async function selectPeer(peerId) {
  /* Deactivate previous */
  document.querySelectorAll('#peer-list li').forEach(li => li.classList.remove('active'));
  const li = document.querySelector(`[data-peer="${peerId}"]`);
  if (li) li.classList.add('active');

  BROKE.activePeerId = peerId;

  /* Update header */
  document.getElementById('chat-peer-name').textContent = peerId;
  document.getElementById('chat-peer-status').textContent =
    BROKE.connections.has(peerId) ? '● Connected' : '○ Offline';

  /* Clear unread */
  clearUnread(peerId);

  /* Load history */
  document.getElementById('messages-list').innerHTML = '';
  showPlaceholder(false);

  const messages = await dbGetMessages(peerId);
  let lastDate = null;
  messages.forEach(msg => {
    const d = new Date(msg.timestamp).toDateString();
    if (d !== lastDate) {
      renderDateSeparator(d);
      lastDate = d;
    }
    renderMessage(msg);
  });

  scrollToBottom();
}

function renderDateSeparator(dateStr) {
  const el = document.createElement('div');
  el.className = 'date-separator';
  el.innerHTML = `<span>${dateStr}</span>`;
  document.getElementById('messages-list').appendChild(el);
}

function showPlaceholder(show_) {
  const ph = document.getElementById('no-peer-placeholder');
  if (show_) {
    ph.style.display = 'flex';
  } else {
    ph.style.display = 'none';
  }
}

/* ═══════════════════════════════════════════════
   SECTION 13: SIDEBAR UI
═══════════════════════════════════════════════ */
function addPeerToSidebar(peerId) {
  if (document.querySelector(`[data-peer="${peerId}"]`)) return;

  const list = document.getElementById('peer-list');
  const li = document.createElement('li');
  li.dataset.peer = peerId;
  const abbr = peerId.substring(0, 2).toUpperCase();

  li.innerHTML = `
    <div class="peer-list-avatar">${abbr}</div>
    <div class="peer-list-info">
      <div class="peer-list-id">${peerId}</div>
      <div class="peer-list-meta">Awaiting connection…</div>
    </div>
    <div class="peer-list-dot" style="background:#52525e;box-shadow:none;"></div>`;

  li.addEventListener('click', () => selectPeer(peerId));
  list.appendChild(li);
}

function updatePeerDot(peerId, online) {
  const li = document.querySelector(`[data-peer="${peerId}"]`);
  if (!li) return;
  const dot = li.querySelector('.peer-list-dot');
  const meta = li.querySelector('.peer-list-meta');
  if (online) {
    dot.style.background = 'var(--accent-green)';
    dot.style.boxShadow = '0 0 5px var(--accent-green)';
    if (meta) meta.textContent = 'Connected';
  } else {
    dot.style.background = '#52525e';
    dot.style.boxShadow = 'none';
    if (meta) meta.textContent = 'Offline';
  }
}

function incrementUnread(peerId) {
  const count = (BROKE.unread.get(peerId) || 0) + 1;
  BROKE.unread.set(peerId, count);
  const li = document.querySelector(`[data-peer="${peerId}"]`);
  if (!li) return;
  let badge = li.querySelector('.peer-list-unread');
  if (!badge) {
    badge = document.createElement('div');
    badge.className = 'peer-list-unread';
    li.appendChild(badge);
  }
  badge.textContent = count;
}

function clearUnread(peerId) {
  BROKE.unread.set(peerId, 0);
  const badge = document.querySelector(`[data-peer="${peerId}"] .peer-list-unread`);
  if (badge) badge.remove();
}

/* ═══════════════════════════════════════════════
   SECTION 14: TYPING INDICATORS & READ RECEIPTS
═══════════════════════════════════════════════ */
let typingTimeout = null;
function handleTypingInput() {
  if (!BROKE.activePeerId) return;
  const conn = BROKE.connections.get(BROKE.activePeerId);
  if (!conn || !conn.open) return;

  sendControl(conn, { type: 'TYPING', isTyping: true });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    sendControl(conn, { type: 'TYPING', isTyping: false });
  }, 2000);
}

function showTypingIndicator(fromPeerId, isTyping) {
  if (fromPeerId !== BROKE.activePeerId) return;
  const indicator = document.getElementById('typing-indicator');
  if (isTyping) {
    indicator.classList.remove('hidden');
    scrollToBottom();
    clearTimeout(BROKE.typingTimers.get(fromPeerId));
    BROKE.typingTimers.set(fromPeerId, setTimeout(() => {
      indicator.classList.add('hidden');
    }, 3500));
  } else {
    indicator.classList.add('hidden');
  }
}

function sendReadReceipt(peerId, msgId) {
  const conn = BROKE.connections.get(peerId);
  if (conn && conn.open) {
    sendControl(conn, { type: 'READ', msgId });
  }
}

function markMessageRead(msgId) {
  const el = document.querySelector(`[data-msg-id="${msgId}"] .msg-status`);
  if (el) el.textContent = '✓✓';
  db.messages.update(msgId, { status: 'read' }).catch(() => {});
}

/* ═══════════════════════════════════════════════
   SECTION 15: SELF-DESTRUCT SYSTEM
═══════════════════════════════════════════════ */
function scheduleDestruct(msgId, ms, conn) {
  setTimeout(async () => {
    /* Remove from DOM */
    const el = document.querySelector(`[data-msg-id="${msgId}"]`);
    if (el) {
      el.style.transition = 'opacity 0.4s, transform 0.4s';
      el.style.opacity = '0';
      el.style.transform = 'scale(0.8)';
      setTimeout(() => el.remove(), 400);
    }
    /* Remove from DB */
    try { await db.messages.delete(msgId); } catch(e) {}

    /* Signal peer to destruct their copy */
    if (conn && conn.open) {
      conn.send({ type: 'CMD_DESTRUCT', msgId });
    }
  }, ms);
}

function bindDestructUI() {
  const toggle = document.getElementById('self-destruct-toggle');
  const picker = document.getElementById('destruct-picker');
  toggle.addEventListener('click', () => picker.classList.toggle('visible'));

  document.querySelectorAll('.destruct-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.destruct-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      BROKE.destructTimer = parseInt(btn.dataset.seconds, 10);
      if (BROKE.destructTimer > 0) {
        toast(`Self-destruct set: ${BROKE.destructTimer}s`, 'warning');
      } else {
        toast('Self-destruct disabled', 'info');
      }
    });
  });
}

/* ═══════════════════════════════════════════════
   SECTION 16: MEDIA CALLS
═══════════════════════════════════════════════ */
function handleIncomingCall(call) {
  BROKE.incomingCall = call;
  const isVideo = call.metadata?.video !== false;

  document.getElementById('call-modal-title').textContent =
    (isVideo ? '📹 Video' : '🎙 Audio') + ' Call Incoming';
  document.getElementById('call-modal-peer').textContent = call.peer;
  show('call-modal');

  document.getElementById('call-accept-btn').onclick = () => acceptCall(call, isVideo);
  document.getElementById('call-decline-btn').onclick = () => declineCall(call);
}

async function acceptCall(call, isVideo) {
  hide('call-modal');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true });
    BROKE.localStream = stream;
    call.answer(stream);
    setupCallHandlers(call, call.peer);
  } catch(e) {
    toast('Media access denied: ' + e.message, 'error');
  }
}

function declineCall(call) {
  hide('call-modal');
  call.close();
  BROKE.incomingCall = null;
  toast('Call declined.', 'info');
}

async function startCall(peerId, video = true) {
  if (!peerId) { toast('Select a peer first.', 'warning'); return; }
  const conn = BROKE.peer;
  if (!conn) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video, audio: true });
    BROKE.localStream = stream;
    const call = BROKE.peer.call(peerId, stream, { metadata: { video } });
    setupCallHandlers(call, peerId);
  } catch(e) {
    toast('Media access error: ' + e.message, 'error');
  }
}

function setupCallHandlers(call, peerId) {
  BROKE.currentCall = call;
  document.getElementById('pip-peer-label').textContent = 'Call with ' + peerId;
  document.getElementById('pip-status').textContent = 'Connecting…';
  show('pip-window');

  /* Show local video */
  document.getElementById('local-video').srcObject = BROKE.localStream;

  call.on('stream', (remoteStream) => {
    document.getElementById('remote-video').srcObject = remoteStream;
    document.getElementById('pip-status').textContent = '● Live';
  });

  call.on('close', () => endCall());
  call.on('error', (e) => {
    toast('Call error: ' + e.message, 'error');
    endCall();
  });
}

function endCall() {
  if (BROKE.currentCall) {
    BROKE.currentCall.close();
    BROKE.currentCall = null;
  }
  if (BROKE.localStream) {
    BROKE.localStream.getTracks().forEach(t => t.stop());
    BROKE.localStream = null;
  }
  document.getElementById('remote-video').srcObject = null;
  document.getElementById('local-video').srcObject = null;
  hide('pip-window');
  toast('Call ended.', 'info');
}

function bindMediaUI() {
  document.getElementById('audio-call-btn').addEventListener('click', () => {
    if (BROKE.activePeerId) startCall(BROKE.activePeerId, false);
    else toast('Select a peer first.', 'warning');
  });
  document.getElementById('video-call-btn').addEventListener('click', () => {
    if (BROKE.activePeerId) startCall(BROKE.activePeerId, true);
    else toast('Select a peer first.', 'warning');
  });
  document.getElementById('pip-end-btn').addEventListener('click', endCall);
  document.getElementById('pip-mute-btn').addEventListener('click', () => {
    if (!BROKE.localStream) return;
    BROKE.isMuted = !BROKE.isMuted;
    BROKE.localStream.getAudioTracks().forEach(t => t.enabled = !BROKE.isMuted);
    document.getElementById('pip-mute-btn').textContent = BROKE.isMuted ? '🔇' : '🎙';
  });
  document.getElementById('pip-cam-btn').addEventListener('click', () => {
    if (!BROKE.localStream) return;
    BROKE.isCamOff = !BROKE.isCamOff;
    BROKE.localStream.getVideoTracks().forEach(t => t.enabled = !BROKE.isCamOff);
    document.getElementById('pip-cam-btn').textContent = BROKE.isCamOff ? '🚫' : '📹';
  });
}

/* ═══════════════════════════════════════════════
   SECTION 17: ADMIN PANEL
═══════════════════════════════════════════════ */
function initAdminPanel() {
  /* Close */
  document.getElementById('admin-panel-close').addEventListener('click', toggleAdminPanel);

  /* BAN */
  document.getElementById('admin-ban-btn').addEventListener('click', () => {
    const target = document.getElementById('target-peer-id').value.trim();
    if (!target) { toast('Enter Target Peer ID.', 'warning'); return; }
    broadcastCommand({ type: 'CMD_BAN', targetId: target });
    adminLog('BAN sent → ' + target, 'error');
    toast('BAN signal sent to ' + target, 'warning');
  });

  /* GIVE PREMIUM */
  document.getElementById('admin-premium-btn').addEventListener('click', () => {
    const target = document.getElementById('target-peer-id').value.trim();
    if (!target) { toast('Enter Target Peer ID.', 'warning'); return; }
    broadcastCommand({ type: 'CMD_GIVE_PREMIUM', targetId: target });
    adminLog('PREMIUM granted → ' + target, 'ok');
    toast('PREMIUM signal sent to ' + target, 'success');
  });

  /* REMOTE PURGE */
  document.getElementById('admin-purge-btn').addEventListener('click', () => {
    const target = document.getElementById('target-peer-id').value.trim();
    if (!target) { toast('Enter Target Peer ID.', 'warning'); return; }
    if (!confirm('REMOTE PURGE: Wipe IndexedDB of target ' + target + '?')) return;
    broadcastCommand({ type: 'CMD_REMOTE_PURGE', targetId: target });
    adminLog('PURGE sent → ' + target, 'warn');
    toast('PURGE signal sent to ' + target, 'warning');
  });

  /* ADMIN MSG */
  document.getElementById('admin-msg-btn').addEventListener('click', () => {
    const target = document.getElementById('target-peer-id').value.trim();
    const text   = document.getElementById('admin-msg-text').value.trim();
    if (!target || !text) { toast('Enter target and message.', 'warning'); return; }
    broadcastCommand({ type: 'ADMIN_MSG', targetId: target, content: text });
    adminLog('MSG → ' + target + ': ' + text, 'ok');
    toast('Admin message sent.', 'success');
    document.getElementById('admin-msg-text').value = '';
  });

  /* LOCK */
  document.getElementById('admin-lock-btn').addEventListener('click', () => {
    if (!confirm('LOCK NETWORK? All connected peers will enter Maintenance Mode.')) return;
    BROKE.networkLocked = true;
    broadcastCommand({ type: 'CMD_MAINTENANCE_ON' }, true);
    adminLog('MAINTENANCE MODE ON', 'warn');
    toast('Network locked. Maintenance mode active.', 'warning');
  });

  /* UNLOCK */
  document.getElementById('admin-unlock-btn').addEventListener('click', () => {
    BROKE.networkLocked = false;
    localStorage.removeItem('broke_maintenance');
    broadcastCommand({ type: 'CMD_MAINTENANCE_OFF' }, true);
    adminLog('MAINTENANCE MODE OFF', 'ok');
    toast('Network unlocked.', 'success');
  });

  /* BROADCAST */
  document.getElementById('admin-broadcast-btn').addEventListener('click', () => {
    const text = document.getElementById('admin-broadcast-text').value.trim();
    if (!text) { toast('Enter broadcast message.', 'warning'); return; }
    broadcastToAll({ type: 'BROADCAST', content: text });
    adminLog('BROADCAST: ' + text, 'ok');
    toast('Broadcast sent to all peers.', 'success');
    document.getElementById('admin-broadcast-text').value = '';
  });
}

function toggleAdminPanel() {
  BROKE.adminPanelOpen = !BROKE.adminPanelOpen;
  const panel = document.getElementById('admin-panel');
  if (BROKE.adminPanelOpen) panel.classList.remove('hidden');
  else panel.classList.add('hidden');
}

function broadcastCommand(cmd, toAll = false) {
  BROKE.connections.forEach((conn, peerId) => {
    if (conn.open) {
      try { conn.send(cmd); } catch(e) {}
    }
  });
}

function broadcastToAll(data) {
  BROKE.connections.forEach((conn) => {
    if (conn.open) {
      try { conn.send(data); } catch(e) {}
    }
  });
}

function sendControl(conn, data) {
  if (conn && conn.open) {
    try { conn.send(data); } catch(e) {}
  }
}

function adminLog(msg, type = 'info') {
  if (!BROKE.isAdmin) return;
  const list = document.getElementById('admin-log-list');
  if (!list) return;
  const li = document.createElement('li');
  const time = new Date().toLocaleTimeString();
  li.textContent = `[${time}] ${msg}`;
  li.className = type === 'error' ? 'log-error' : type === 'warn' ? 'log-warn' : type === 'ok' ? 'log-ok' : '';
  list.prepend(li);
  /* Keep max 100 log entries */
  while (list.children.length > 100) list.lastChild.remove();
}

/* ═══════════════════════════════════════════════
   SECTION 18: PREMIUM GHOST FEATURES
═══════════════════════════════════════════════ */
function activatePanic() {
  BROKE.panicActive = !BROKE.panicActive;
  const overlay = document.getElementById('panic-overlay');
  if (BROKE.panicActive) {
    overlay.classList.remove('hidden');
    toast('PANIC MODE — click overlay to deactivate', 'warning');
    overlay.onclick = () => deactivatePanic();
  } else {
    deactivatePanic();
  }
}

function deactivatePanic() {
  BROKE.panicActive = false;
  document.getElementById('panic-overlay').classList.add('hidden');
}

function activateFakeHistory() {
  BROKE.fakeHistoryMode = !BROKE.fakeHistoryMode;
  const app = document.getElementById('app');

  if (BROKE.fakeHistoryMode) {
    /* Build fake message list if not exists */
    let fakeEl = document.getElementById('fake-messages');
    if (!fakeEl) {
      fakeEl = document.createElement('div');
      fakeEl.id = 'fake-messages';
      fakeEl.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:24px;flex:1;overflow-y:auto;';
      const FAKE_MSGS = [
        { dir: 'recv', text: "Hey! Just checking in 👋" },
        { dir: 'sent', text: "Hi! Yeah I'm good, you?" },
        { dir: 'recv', text: "Great! Did you watch that documentary last night?" },
        { dir: 'sent', text: "Oh yes! Really interesting stuff about ocean life 🐋" },
        { dir: 'recv', text: "Same! We should plan a trip to the aquarium sometime." },
        { dir: 'sent', text: "Absolutely, let's do it next weekend maybe?" },
        { dir: 'recv', text: "Sounds perfect! I'll check my schedule 📅" },
      ];
      FAKE_MSGS.forEach(fm => {
        const row = document.createElement('div');
        row.className = 'fake-msg-row ' + fm.dir;
        row.innerHTML = `<div class="fake-bubble">${escHtml(fm.text)}</div>`;
        fakeEl.appendChild(row);
      });
      document.getElementById('chat-area').insertBefore(fakeEl, document.getElementById('input-bar'));
    }
    document.getElementById('messages-container').style.display = 'none';
    fakeEl.style.display = 'flex';
    toast('🎭 Fake history active', 'info');
  } else {
    const fakeEl = document.getElementById('fake-messages');
    if (fakeEl) fakeEl.style.display = 'none';
    document.getElementById('messages-container').style.display = 'flex';
    toast('Fake history deactivated', 'info');
  }
}

function handleVisibilityChange() {
  if (!BROKE.isPremium) return;
  if (document.hidden) {
    document.getElementById('app').style.filter = 'blur(50px) brightness(0)';
  } else {
    document.getElementById('app').style.filter = '';
  }
}

/* ═══════════════════════════════════════════════
   SECTION 19: UI BINDINGS
═══════════════════════════════════════════════ */
function bindChatUI() {
  /* Send button */
  document.getElementById('send-btn').addEventListener('click', sendMessage);

  /* Enter to send (Shift+Enter = newline) */
  const input = document.getElementById('message-input');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  /* Auto-resize textarea */
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
    handleTypingInput();
  });

  /* Clear chat */
  document.getElementById('clear-chat-btn').addEventListener('click', async () => {
    if (!BROKE.activePeerId) return;
    if (!confirm('Clear all messages with this peer?')) return;
    await dbClearMessages(BROKE.activePeerId);
    document.getElementById('messages-list').innerHTML = '';
    toast('Chat cleared.', 'info');
  });

  /* Export chat */
  document.getElementById('export-chat-btn').addEventListener('click', async () => {
    if (!BROKE.activePeerId) return;
    const msgs = await dbGetMessages(BROKE.activePeerId);
    const text = msgs.map(m =>
      `[${new Date(m.timestamp).toLocaleString()}] ${m.direction === 'sent' ? 'ME' : m.peerId}: ${m.content}`
    ).join('\n');
    downloadText('broke-chat-' + BROKE.activePeerId + '.txt', text);
    toast('Chat exported.', 'success');
  });

  /* File attach */
  document.getElementById('attach-btn').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });
  document.getElementById('file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    BROKE.pendingFile = file;
    document.getElementById('media-preview-name').textContent = '📎 ' + file.name + ' (' + formatBytes(file.size) + ')';
    show('media-preview-bar');
  });
  document.getElementById('media-preview-cancel').addEventListener('click', clearFilePreview);

  /* Copy peer ID */
  document.getElementById('copy-id-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(BROKE.myPeerId || '').then(() => toast('Peer ID copied!', 'success'));
  });
}

function bindSidebarUI() {
  document.getElementById('connect-btn').addEventListener('click', () => {
    const peerId = document.getElementById('connect-peer-input').value.trim();
    if (peerId) { connectToPeer(peerId); document.getElementById('connect-peer-input').value = ''; }
    else toast('Enter a Peer ID.', 'warning');
  });

  document.getElementById('connect-peer-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('connect-btn').click();
  });

  document.getElementById('panic-btn').addEventListener('click', activatePanic);
  document.getElementById('fake-history-btn').addEventListener('click', () => {
    if (!BROKE.isPremium) { toast('Ghost Premium required for Fake History.', 'warning'); return; }
    activateFakeHistory();
  });
}

function bindEmojiUI() {
  const btn = document.getElementById('emoji-btn');
  const panel = document.getElementById('emoji-panel');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.classList.toggle('hidden');
  });

  /* Convert text nodes to spans for click */
  panel.addEventListener('click', (e) => {
    const target = e.target;
    const emoji = target.textContent.trim();
    if (emoji) {
      const input = document.getElementById('message-input');
      input.value += emoji;
      input.focus();
    }
  });

  document.addEventListener('click', () => panel.classList.add('hidden'));
}

function bindContextMenus() {
  document.getElementById('messages-list').addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.msg-row');
    if (!row) return;
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, [
      { icon: '📋', label: 'Copy text', action: () => {
        const text = row.querySelector('.msg-bubble')?.innerText || '';
        navigator.clipboard.writeText(text);
        toast('Copied!', 'success');
      }},
      { icon: '🗑', label: 'Delete message', className: 'danger', action: async () => {
        const msgId = row.dataset.msgId;
        row.remove();
        try { await db.messages.delete(parseInt(msgId)); } catch(e) {}
      }},
      ...(BROKE.isPremium ? [{ icon: '💣', label: 'Destruct now', className: 'danger', action: () => {
        const msgId = row.dataset.msgId;
        const conn = BROKE.connections.get(BROKE.activePeerId);
        scheduleDestruct(msgId, 100, conn);
      }}] : [])
    ]);
  });
}

function showContextMenu(x, y, items) {
  document.querySelectorAll('.context-menu').forEach(el => el.remove());
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'context-menu-item ' + (item.className || '');
    div.innerHTML = `${item.icon} ${item.label}`;
    div.addEventListener('click', () => { item.action(); menu.remove(); });
    menu.appendChild(div);
  });
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';
  document.body.appendChild(menu);

  setTimeout(() => {
    document.addEventListener('click', () => menu.remove(), { once: true });
  }, 10);
}

/* ═══════════════════════════════════════════════
   SECTION 20: GLOBAL KEY BINDINGS
═══════════════════════════════════════════════ */
function handleGlobalKeys(e) {
  /* Esc = Panic for premium */
  if (e.key === 'Escape') {
    if (BROKE.isPremium) {
      activatePanic();
    } else {
      deactivatePanic();
      hide('call-modal');
    }
  }
}

/* ═══════════════════════════════════════════════
   SECTION 21: HEARTBEAT (RENDER.COM KEEP-ALIVE)
═══════════════════════════════════════════════ */
function startHeartbeat() {
  BROKE.heartbeatInterval = setInterval(() => {
    /* Ping all open connections */
    BROKE.connections.forEach((conn, peerId) => {
      if (conn && conn.open) {
        try {
          conn.send({ type: 'PING', ts: Date.now() });
        } catch(e) {
          /* Connection likely dead, remove */
          BROKE.connections.delete(peerId);
          updatePeerDot(peerId, false);
        }
      }
    });

    /* Reconnect peer if disconnected */
    if (BROKE.peer && BROKE.peer.disconnected && !BROKE.peer.destroyed) {
      try { BROKE.peer.reconnect(); } catch(e) {}
    }
  }, 15000);
}

/* ═══════════════════════════════════════════════
   SECTION 22: STATS UPDATER
═══════════════════════════════════════════════ */
function updateStats() {
  const uptime = Math.floor((Date.now() - BROKE.startTime) / 1000);
  document.getElementById('stat-uptime').textContent = formatDuration(uptime);
  document.getElementById('stat-bytes').textContent = formatBytes(BROKE.bytesTransferred);
  document.getElementById('stat-peers').textContent = BROKE.connections.size;
}

/* ═══════════════════════════════════════════════
   SECTION 23: TOAST SYSTEM
═══════════════════════════════════════════════ */
function toast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;

  const icons = { success: '✓', error: '⚠', warning: '⚡', info: 'ℹ' };
  t.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ'}</span><span>${escHtml(message)}</span>`;
  container.appendChild(t);

  setTimeout(() => {
    t.classList.add('toast-out');
    setTimeout(() => t.remove(), 250);
  }, 3500);
}

/* ═══════════════════════════════════════════════
   SECTION 24: UTILITY FUNCTIONS
═══════════════════════════════════════════════ */
function show(id)  {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}
function hide(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

function setStatus(state) {
  const dot = document.getElementById('connection-status');
  if (!dot) return;
  dot.className = 'status-dot ' + state;
}

function scrollToBottom() {
  const c = document.getElementById('messages-container');
  if (c) requestAnimationFrame(() => { c.scrollTop = c.scrollHeight; });
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function escHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

function formatDuration(s) {
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}

function getFileIcon(type) {
  if (!type) return '📄';
  if (type.startsWith('image/')) return '🖼';
  if (type.startsWith('video/')) return '🎬';
  if (type.startsWith('audio/')) return '🎵';
  if (type.includes('pdf'))     return '📕';
  if (type.includes('zip') || type.includes('compressed')) return '🗜';
  if (type.includes('text'))    return '📝';
  return '📎';
}

function downloadFile(msgId, fileName, dataUrl) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = fileName;
  a.click();
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/* ═══════════════════════════════════════════════
   END OF BROKE SCRIPT.JS — FULL LOGIC STACK
═══════════════════════════════════════════════ */
