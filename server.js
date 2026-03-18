const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { 
    maxHttpBufferSize: 1e8, 
    cors: { origin: "*" } 
});
const fs = require('fs').promises;
const path = require('path');

const DB_FILE = path.join(__dirname, 'database.json');

// Полная структура базы данных
let db = { 
    users: {}, 
    profiles: {}, 
    economy: {}, 
    messages: {}, 
    system: { locked: false, admin: "shict" } 
};

async function initDB() {
    try {
        const data = await fs.readFile(DB_FILE, 'utf8');
        db = JSON.parse(data);
        console.log("✅ База данных Celestra загружена");
    } catch (e) {
        await saveDB();
    }
}

async function saveDB() {
    try {
        await fs.writeFile(DB_FILE, JSON.stringify(db, null, 4));
    } catch (e) {
        console.log("❌ Ошибка сохранения:", e);
    }
}

initDB();

const sessions = {}; 

app.use(express.static(__dirname));

io.on('connection', (socket) => {
    
    socket.on('auth', async (data) => {
        const { login, password, type } = data;
        if (!login || !password) return socket.emit('err', 'Заполни все поля');
        const u = login.trim().toLowerCase();

        if (type === 'reg') {
            if (db.users[u]) return socket.emit('err', 'Этот логин уже занят');
            db.users[u] = password;
            db.profiles[u] = { 
                nick: login, 
                ava: `https://api.dicebear.com/7.x/identicon/svg?seed=${u}`, 
                bio: "Новый пользователь Celestra", 
                ls: "Online" 
            };
            db.economy[u] = { coins: 100 }; // Стартовый баланс
            await saveDB();
        }

        if (db.users[u] !== password) return socket.emit('err', 'Неверный логин или пароль');

        socket.un = u;
        sessions[u] = socket.id;
        db.profiles[u].ls = "Online";
        
        // Отправляем полные данные при входе
        socket.emit('auth_ok', { 
            un: u, 
            prof: db.profiles[u], 
            econ: db.economy[u],
            isAdmin: (u === db.system.admin)
        });
    });

    // Смена профиля (НИК и БИО)
    socket.on('update_profile', async (data) => {
        if (!socket.un) return;
        if (data.nick) db.profiles[socket.un].nick = data.nick;
        if (data.bio) db.profiles[socket.un].bio = data.bio;
        await saveDB();
        socket.emit('update_ok', db.profiles[socket.un]);
    });

    socket.on('search_user', (q) => {
        const query = q ? q.trim().toLowerCase() : "";
        if (query.length < 1) return socket.emit('search_res', []);
        
        const res = Object.keys(db.profiles)
            .filter(l => l.includes(query) || db.profiles[l].nick.toLowerCase().includes(query))
            .map(l => ({
                login: l,
                nick: db.profiles[l].nick,
                ava: db.profiles[l].ava
            })).slice(0, 10);
            
        socket.emit('search_res', res);
    });

    socket.on('get_h', (target) => {
        if (!socket.un) return;
        const id = [socket.un, target].sort().join('_');
        const prof = db.profiles[target] || { nick: target, ls: "Offline", bio: "", ava: "" };
        const econ = db.economy[target] || { coins: 0 };
        if (sessions[target]) prof.ls = "Online";
        socket.emit('h_res', { target, msgs: db.messages[id] || [], prof, econ });
    });

    socket.on('msg', async (d) => {
        if (!socket.un || !d.to || !d.txt.trim()) return;
        
        const msg = {
            f: socket.un,
            t: d.to,
            txt: d.txt,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        
        const id = [socket.un, d.to].sort().join('_');
        if (!db.messages[id]) db.messages[id] = [];
        db.messages[id].push(msg);
        
        // Начисляем монеты за активность
        if (db.economy[socket.un]) db.economy[socket.un].coins += 2;
        
        await saveDB();

        if (sessions[d.to]) {
            io.to(sessions[d.to]).emit('receive', { 
                room: socket.un, 
                msg, 
                senderProf: db.profiles[socket.un] 
            });
        }
        socket.emit('receive', { room: d.to, msg, senderProf: db.profiles[d.to] });
    });

    // АДМИН-КОМАНДЫ
    socket.on('admin_cmd', async (data) => {
        if (socket.un !== db.system.admin) return;
        const { cmd, target, value } = data;
        
        if (cmd === 'set_coins' && db.economy[target]) {
            db.economy[target].coins = parseInt(value);
        } else if (cmd === 'ban' && db.users[target]) {
            delete db.users[target];
        }
        await saveDB();
        socket.emit('admin_res', 'Выполнено');
    });

    socket.on('disconnect', () => {
        if (socket.un) {
            db.profiles[socket.un].ls = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            delete sessions[socket.un];
        }
    });
});

http.listen(3000, '0.0.0.0', () => {
    console.log('🚀 Celestra запущен на порту 3000');
});
