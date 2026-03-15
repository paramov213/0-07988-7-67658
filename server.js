// Константы и Инициализация БД
const ADMIN_ROOT_ID = "xeone";
const db = new Dexie("BrokeDB");
db.version(1).stores({
    messages: '++id, peerId, text, timestamp, isGhost'
});

let peer, conn, currentCall;
let localStream; // Глобальная переменная для стрима
let isAdmin = false;
let isPremium = localStorage.getItem('broke_premium') === 'true';

// 1. ПРОВЕРКА БАНА ПРИ ЗАПУСКЕ (The Ban Hammer)
if (localStorage.getItem('broke_banned') === 'true') {
    document.getElementById('ban-screen').style.display = 'flex';
    throw new Error("Banned");
}

// 2. АДМИН МОДАЛКА И СТАРТ
function checkAdmin() {
    const val = document.getElementById('admin-input').value;
    if (val === ADMIN_ROOT_ID) {
        isAdmin = true;
        document.body.classList.add('admin-active');
        document.getElementById('admin-controls').classList.remove('hidden');
        document.getElementById('user-badge').innerText = "[ADMIN]";
    }
    
    // Применяем Premium Ghost визуализацию, если активна
    if (isPremium) {
        document.body.classList.add('premium-active');
        document.getElementById('premium-tools').classList.remove('hidden');
        if (!isAdmin) document.getElementById('user-badge').innerText = "[GHOST]";
    }

    document.getElementById('admin-modal').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    initPeer();
}

// 3. PEERJS LOGIC
function initPeer() {
    // Используем сервера по умолчанию для простоты статического хостинга
    peer = new Peer(null, { debug: 2 });

    peer.on('open', (id) => {
        document.getElementById('my-id-display').innerText = `ID: ${id}`;
        startHeartbeat();
    });

    peer.on('error', (err) => {
        console.error("PeerJS Error:", err);
        alert("PeerJS Error: " + err.type);
    });

    // Обработка входящего текстового соединения
    peer.on('connection', (connection) => {
        // Мы поддерживаем только одно активное соединение в этой версии
        if (conn) conn.close(); 
        conn = connection;
        setupConnListeners();
    });

    // Обработка входящего медиавызова (Видео/Аудио)
    peer.on('call', (call) => {
        handleIncomingCall(call);
    });
}

// 4. ADMIN CONTROL (Targeted Actions)
function sendAdminCmd(type) {
    const targetId = document.getElementById('target-peer-id').value;
    if (!targetId) return alert("Enter Target ID");
    
    // Создаем временное соединение для отправки команды
    const tempConn = peer.connect(targetId, { reliable: true });
    
    tempConn.on('open', () => {
        // Отправляем скрытый сигнал CMD_* вместе с рут-токеном
        tempConn.send({ type: type, adminToken: ADMIN_ROOT_ID });
        alert(`Admin Command ${type} sent to ${targetId}`);
        // Закрываем через секунду
        setTimeout(() => tempConn.close(), 1000);
    });

    tempConn.on('error', (err) => {
        alert(`Failed to connect to admin target: ${err.message}`);
    });
}

// 5. MESSAGE & SIGNAL HANDLING
function setupConnListeners() {
    document.getElementById('active-contact').innerText = `Connected: ${conn.peer}`;

    conn.on('data', (data) => {
        // Проверка на админские сигналы
        if (data.adminToken === ADMIN_ROOT_ID) {
            handleAdminSignals(data.type);
            return;
        }

        // Обработка обычных сообщений
        if (data.type === 'MSG') {
            displayMessage(data.text, 'received', data.isGhost);
            saveToDB(conn.peer, data.text, data.isGhost);
            
            // Логика Self-Destruct на стороне получателя
            if (data.selfDestruct) {
                const timer = data.selfDestruct;
                setTimeout(() => {
                    const msgs = document.getElementById('messages-container').querySelectorAll('.msg-received');
                    if (msgs.length > 0) msgs[msgs.length - 1].remove();
                }, timer);
            }
        }
    });

    conn.on('close', () => {
        document.getElementById('active-contact').innerText = "Connection lost.";
        conn = null;
    });
}

function handleAdminSignals(cmd) {
    switch(cmd) {
        case 'CMD_BAN':
            localStorage.setItem('broke_banned', 'true');
            alert("NETWORK CONTROL: YOUR ID HAS BEEN BANNED.");
            location.reload(); // Перезагрузка активирует ban-screen
            break;
        case 'CMD_GIVE_PREMIUM':
            localStorage.setItem('broke_premium', 'true');
            alert("NETWORK CONTROL: PREMIUM GHOST ACCESS GRANTED. RESTART APP.");
            break;
        case 'REMOTE_PURGE':
            db.messages.clear();
            alert("Network Notice: History Purged by Admin.");
            location.reload();
            break;
        case 'CMD_LOCK':
            alert("NETWORK CONTROL: MAINTENANCE MODE ACTIVE.");
            document.body.classList.add('panic-mode');
            break;
    }
}

// 6. GHOST (PREMIUM) FEATURES
// Panic Button (Esc)
document.addEventListener('keydown', (e) => {
    if (e.key === "Escape") {
        document.body.classList.toggle('panic-mode');
    }
});

// Anti-Spy (Скрытие при потере фокуса)
window.onblur = () => {
    if (isPremium) document.body.classList.add('panic-mode');
};
window.onfocus = () => {
    document.body.classList.remove('panic-mode');
};

// Fake History subversion
function toggleFakeHistory() {
    const container = document.getElementById('messages-container');
    container.innerHTML = `
        <div class="msg msg-received">Mom: Don't forget to buy milk.</div>
        <div class="msg msg-sent">Okay, I will be home by 7.</div>
        <div class="msg msg-received">Boss: Send me the report by EOD.</div>
    `;
    document.getElementById('active-contact').innerText = "Mom";
}

// --- ИСПРАВЛЕНИЯ ЛОГИКИ ЗВОНКОВ (CALL LOGIC) ---

async function handleIncomingCall(call) {
    currentCall = call;
    const overlay = document.getElementById('call-overlay');
    const status = document.getElementById('call-status');
    const acceptBtn = document.getElementById('accept-call');
    const declineBtn = document.getElementById('decline-call');

    // Обновляем UI
    status.innerText = `Incoming Call from: ${call.peer}`;
    overlay.style.display = 'flex'; // Показываем оверлей

    // Назначаем обработчики кнопок
    acceptBtn.onclick = async () => {
        try {
            // Запрашиваем доступ к камере/микрофону
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            
            // Отображаем локальное видео в PIP-окне
            document.getElementById('local-video').srcObject = localStream;
            
            // Отвечаем на вызов, отправляя свой стрим
            call.answer(localStream);
            status.innerText = "Connecting...";

            // Обработка удаленного стрима
            call.on('stream', (remoteStream) => {
                status.innerText = "Connected";
                document.getElementById('remote-video').srcObject = remoteStream;
            });

        } catch (err) {
            console.error("Failed to get local stream", err);
            alert("Cannot accept call: Camera/Mic access denied.");
            endCall();
        }
    };

    declineBtn.onclick = () => {
        call.close();
        endCall();
    };

    // Очистка, если звонящий повесил трубку до ответа
    call.on('close', endCall);
    call.on('error', (err) => {
        console.error("Call error:", err);
        endCall();
    });
}

// Функция старта вызова (вызывается из хедера чата)
async function startCall(type) {
    if (!conn) return alert("Connect to a peer first.");
    
    const overlay = document.getElementById('call-overlay');
    const status = document.getElementById('call-status');
    const remoteVideo = document.getElementById('remote-video');
    const localVideo = document.getElementById('local-video');

    status.innerText = `Calling ${conn.peer}...`;
    overlay.style.display = 'flex';
    
    // Скрываем кнопки Accept/Decline для звонящего
    document.querySelector('.call-btns').style.display = 'none';

    try {
        const constraints = { video: type === 'video', audio: true };
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // Показываем себя в PIP
        localVideo.srcObject = localStream;

        // Инициируем вызов
        const call = peer.call(conn.peer, localStream);
        currentCall = call;

        // Ждем ответный стрим
        call.on('stream', (remoteStream) => {
            status.innerText = "Connected";
            remoteVideo.srcObject = remoteStream;
        });

        call.on('close', endCall);
        call.on('error', endCall);

    } catch (err) {
        console.error("Call failed:", err);
        alert("Could not start call: " + err.message);
        endCall();
    }
}

function endCall() {
    const overlay = document.getElementById('call-overlay');
    const remoteVideo = document.getElementById('remote-video');
    const localVideo = document.getElementById('local-video');

    // Останавливаем стримы
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    // Очищаем видеоэлементы
    remoteVideo.srcObject = null;
    localVideo.srcObject = null;

    // Скрываем UI
    overlay.style.display = 'none';
    
    // Восстанавливаем кнопки для следующего раза
    document.querySelector('.call-btns').style.display = 'flex';
    
    currentCall = null;
}

// --- КОНЕЦ ИСПРАВЛЕНИЙ CALL LOGIC ---

// 8. UI, DB & MESSAGE ACTIONS
async function saveToDB(peerId, text, isGhost) {
    try {
        await db.messages.add({ peerId, text, timestamp: Date.now(), isGhost });
        // Очистка старых сообщений (> 10,000)
        const count = await db.messages.count();
        if (count > 10000) {
            const oldest = await db.messages.orderBy('id').first();
            db.messages.delete(oldest.id);
        }
    } catch(e) { console.error("DB Error", e); }
}

function displayMessage(text, type, isGhost = false) {
    const container = document.getElementById('messages-container');
    const msgDiv = document.createElement('div');
    // Применяем классы для стилизации (отправитель/получатель + премиум)
    msgDiv.className = `msg msg-${type} ${isGhost ? 'premium-msg' : ''}`;
    msgDiv.innerText = text;
    container.appendChild(msgDiv);
    // Авто-скролл вниз
    container.scrollTop = container.scrollHeight;
}

// Обработчик кнопки отправки
document.getElementById('send-btn').onclick = () => {
    const textInput = document.getElementById('msg-input');
    const text = textInput.value;
    const timer = parseInt(document.getElementById('self-destruct-timer').value);
    
    if (conn && text) {
        const payload = {
            type: 'MSG',
            text: text,
            isGhost: isPremium, // Сообщение помечается как Ghost, если отправитель Premium
            selfDestruct: timer > 0 ? timer : null
        };
        
        conn.send(payload);
        displayMessage(text, 'sent', isPremium);
        saveToDB('me', text, isPremium);
        textInput.value = '';
        
        // Логика Self-Destruct на стороне отправителя
        if (timer > 0) {
            setTimeout(() => {
                const msgs = document.getElementById('messages-container').querySelectorAll('.msg-sent');
                if (msgs.length > 0) msgs[msgs.length - 1].remove();
            }, timer);
        }
    }
};

// Поддержка отправки по Enter
document.getElementById('msg-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('send-btn').click();
});

// Функция подключения к пиру (из сайдбара)
function connectToPeer() {
    const id = document.getElementById('dest-id').value;
    if (!id || id === peer.id) return alert("Invalid ID");
    
    // Закрываем старое соединение, если есть
    if (conn) conn.close();

    conn = peer.connect(id, { reliable: true });
    setupConnListeners();
}

// Heartbeat (каждые 15 сек) для обхода сна Render.com
function startHeartbeat() {
    setInterval(() => {
        if (peer && !peer.destroyed && peer.socket && peer.socket._ws && peer.socket._ws.readyState === WebSocket.OPEN) {
            peer.socket.send({type: 'HEARTBEAT'});
        }
    }, 15000);
}
