const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { 
    maxHttpBufferSize: 1e8, 
    cors: { origin: "*" },
    pingTimeout: 60000, 
    pingInterval: 25000
});
const fs = require('fs').promises;
const path = require('path');

// Система анти-сна (axios)
let axios;
try {
    axios = require('axios');
} catch (e) {
    console.log("⚠️ Axios не установлен. Система пинга отключена.");
}

const DB_FILE = path.join(__dirname, 'database.json');

// Глобальный объект базы данных
let db = { 
    users: {}, 
    profiles: {}, 
    economy: {}, 
    messages: {}, 
    streaks: {}, 
    system: { locked: false, admin: "shict" } 
};

// Загрузка базы данных
async function initDB() {
    try {
        const data = await fs.readFile(DB_FILE, 'utf8');
        const parsed = JSON.parse(data);
        db = { ...db, ...parsed };
        console.log("✅ База данных загружена.");
    } catch (e) {
        console.log("⚠️ Файл базы не найден, создаю новый...");
        await saveDB();
    }
}

// Сохранение базы данных
async function saveDB() {
    try {
        await fs.writeFile(DB_FILE, JSON.stringify(db, null, 4));
    } catch (e) {
        console.log("❌ Ошибка записи в БД:", e);
    }
}

initDB();

const sessions = {}; 
app.use(express.static(__dirname));

function getMSKTime() {
    return new Date().toLocaleTimeString("ru-RU", {
        timeZone: "Europe/Moscow",
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getMSKDate() {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" });
}

// Пинг для предотвращения сна сервера
setInterval(() => {
    if (axios) {
        const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:3000`;
        if (url.includes('http')) {
            axios.get(url).catch(() => {});
        }
    }
}, 300000);

io.on('connection', (socket) => {
    
    socket.on('auth', async (data) => {
        const { login, password, type } = data;
        if (!login || !password) return socket.emit('err', 'Введите логин и пароль');
        
        const u = login.trim().toLowerCase(); 

        if (type === 'reg') {
            if (db.users[u]) return socket.emit('err', 'Логин занят');
            db.users[u] = password;
            db.profiles[u] = { 
                nick: login, 
                ava: `https://api.dicebear.com/7.x/identicon/svg?seed=${u}`, 
                bio: "Новый пользователь", 
                ls: "Online",
                nfts: [] 
            };
            db.economy[u] = { coins: 250 }; 
            await saveDB();
        }

        if (!db.users[u] || db.users[u] !== password) {
            return socket.emit('err', 'Ошибка авторизации');
        }

        socket.un = u;
        sessions[u] = socket.id;
        db.profiles[u].ls = "Online";
        
        // Проверка на админа (бесконечные монеты)
        let displayCoins = db.economy[u].coins;
        if (u === db.system.admin) displayCoins = Infinity;

        socket.emit('auth_ok', { 
            un: u, 
            prof: db.profiles[u], 
            econ: { coins: displayCoins },
            isAdmin: (u === db.system.admin)
        });
    });

    socket.on('msg', async (d) => {
        if (!socket.un || !d.to) return;
        
        const id = [socket.un, d.to].sort().join('_');
        const today = getMSKDate();

        // Логика стриков (огоньков)
        if (!db.streaks[id]) {
            db.streaks[id] = { lastDate: today, days: 1 };
        } else {
            const last = db.streaks[id].lastDate;
            if (last !== today) {
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                const yesterdayStr = yesterday.toISOString().split('T')[0];
                
                if (last === yesterdayStr) {
                    db.streaks[id].days += 1;
                } else {
                    db.streaks[id].days = 1;
                }
                db.streaks[id].lastDate = today;
            }
        }

        const msg = {
            f: socket.un,
            t: d.to,
            txt: d.txt || "",
            type: d.type || "text", 
            file: d.file || null,
            time: getMSKTime(),
            timestamp: Date.now() 
        };
        
        if (!db.messages[id]) db.messages[id] = [];
        db.messages[id].push(msg);
        
        // Заработок монет (кроме админа)
        if (socket.un !== db.system.admin) {
            if (db.economy[socket.un]) db.economy[socket.un].coins += 10;
        }
        
        await saveDB();

        const payload = { 
            room: socket.un, 
            msg, 
            senderProf: db.profiles[socket.un],
            streak: db.streaks[id].days
        };

        if (sessions[d.to]) io.to(sessions[d.to]).emit('receive', payload);
        socket.emit('receive', { ...payload, room: d.to });
    });

    socket.on('get_h', (target) => {
        if (!socket.un) return;
        const id = [socket.un, target].sort().join('_');
        const prof = db.profiles[target] || { nick: target, ls: "Offline", ava: "", nfts: [] };
        const streak = db.streaks[id] ? db.streaks[id].days : 0;
        
        if (sessions[target]) prof.ls = "Online";

        let targetCoins = db.economy[target]?.coins || 0;
        if (target === db.system.admin) targetCoins = Infinity;

        socket.emit('h_res', { 
            target, 
            msgs: db.messages[id] || [], 
            prof, 
            econ: { coins: targetCoins },
            streak 
        });
    });

    socket.on('search_user', (q) => {
        if (!socket.un) return;
        const query = q.trim().toLowerCase();
        if (query.length < 1) return socket.emit('search_res', []);
        
        const res = Object.keys(db.profiles)
            .filter(login => login !== socket.un && (login.includes(query) || db.profiles[login].nick.toLowerCase().includes(query)))
            .map(login => ({
                login: login,
                nick: db.profiles[login].nick,
                ava: db.profiles[login].ava
            }))
            .slice(0, 10);
            
        socket.emit('search_res', res);
    });

    socket.on('update_profile', async (data) => {
        if (!socket.un) return;
        if (data.nick) db.profiles[socket.un].nick = data.nick;
        if (data.bio) db.profiles[socket.un].bio = data.bio;
        if (data.ava) db.profiles[socket.un].ava = data.ava; 
        await saveDB();
        socket.emit('update_ok', db.profiles[socket.un]);
    });

    socket.on('buy_nft', async (nftName) => {
        if (!socket.un) return;
        const price = 1000;
        const isAdm = (socket.un === db.system.admin);

        if (isAdm || (db.economy[socket.un] && db.economy[socket.un].coins >= price)) {
            if (!isAdm) db.economy[socket.un].coins -= price;
            
            if (!db.profiles[socket.un].nfts) db.profiles[socket.un].nfts = [];
            if (!db.profiles[socket.un].nfts.includes(nftName)) {
                db.profiles[socket.un].nfts.push(nftName);
            }
            
            await saveDB();
            socket.emit('update_ok', db.profiles[socket.un]);
            socket.emit('econ_update', { coins: isAdm ? Infinity : db.economy[socket.un].coins });
        } else {
            socket.emit('err', 'Нужно 1000 монет');
        }
    });

    socket.on('admin_export_db', () => {
        if (socket.un !== db.system.admin) return;
        socket.emit('admin_db_data', JSON.stringify(db));
    });

    socket.on('admin_import_db', async (jsonStr) => {
        if (socket.un !== db.system.admin) return;
        try {
            db = JSON.parse(jsonStr);
            await saveDB();
            socket.emit('err', 'Данные импортированы!');
        } catch (e) {
            socket.emit('err', 'Ошибка файла');
        }
    });

    socket.on('disconnect', () => {
        if (socket.un) {
            db.profiles[socket.un].ls = getMSKTime();
            delete sessions[socket.un];
        }
    });
});

http.listen(process.env.PORT || 3000, '0.0.0.0', () => {
    console.log("🚀 Celestra Server Running...");
});
