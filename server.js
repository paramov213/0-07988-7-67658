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
        console.log("✅ База Celestra загружена.");
    } catch (e) {
        console.log("⚠️ База не найдена, создаю новую...");
        await saveDB();
    }
}

async function saveDB() {
    try {
        await fs.writeFile(DB_FILE, JSON.stringify(db, null, 4));
    } catch (e) {
        console.error("❌ Ошибка сохранения БД:", e);
    }
}

initDB();

const sessions = {}; 

app.use(express.static(__dirname));

io.on('connection', (socket) => {
    
    // ВХОД / РЕГ
    socket.on('auth', async (data) => {
        const { login, password, type } = data;
        if (!login || !password) return socket.emit('err', 'Пустые поля!');
        
        const u = login.trim().toLowerCase();

        if (type === 'reg') {
            if (db.users[u]) return socket.emit('err', 'Логин занят');
            db.users[u] = password;
            db.profiles[u] = { 
                nick: login, 
                ava: `https://api.dicebear.com/7.x/identicon/svg?seed=${u}`, 
                bio: "Новый пользователь Celestra", 
                ls: "Online" 
            };
            db.economy[u] = { coins: 50 };
            await saveDB();
        }

        if (db.users[u] !== password) return socket.emit('err', 'Неверные данные');

        socket.un = u;
        sessions[u] = socket.id;
        db.profiles[u].ls = "Online";
        
        socket.emit('auth_ok', { un: u, prof: db.profiles[u] });
    });

    // УЛУЧШЕННЫЙ ПОИСК (Исправлено)
    socket.on('search_user', (q) => {
        const query = q ? q.trim().toLowerCase() : "";
        if (query.length < 1) return socket.emit('search_res', []);
        
        const res = Object.keys(db.profiles)
            .filter(l => {
                const nick = db.profiles[l].nick.toLowerCase();
                return l.includes(query) || nick.includes(query);
            })
            .map(l => ({
                login: l,
                nick: db.profiles[l].nick,
                ava: db.profiles[l].ava
            }))
            .slice(0, 10);
            
        socket.emit('search_res', res);
    });

    socket.on('get_h', (target) => {
        if (!socket.un) return;
        const id = [socket.un, target].sort().join('_');
        const prof = db.profiles[target] || { nick: target, ls: "??:??" };
        if (sessions[target]) prof.ls = "Online";
        
        socket.emit('h_res', { 
            target, 
            msgs: db.messages[id] || [], 
            prof: { ...prof, coins: db.economy[target]?.coins || 0 } 
        });
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
        
        if (db.economy[socket.un]) db.economy[socket.un].coins += 5;
        await saveDB();

        if (sessions[d.to]) io.to(sessions[d.to]).emit('receive', { room: socket.un, msg });
        socket.emit('receive', { room: d.to, msg });
    });

    socket.on('update_prof', async (d) => {
        if (!socket.un) return;
        const p = db.profiles[socket.un];
        if (d.nick) p.nick = d.nick;
        if (d.ava) p.ava = d.ava;
        if (d.bio) p.bio = d.bio;
        await saveDB();
        socket.emit('auth_ok', { un: socket.un, prof: p });
    });

    socket.on('typing', (to) => {
        if (sessions[to]) io.to(sessions[to]).emit('is_typing', { f: socket.un });
    });

    socket.on('disconnect', async () => {
        if (socket.un) {
            const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            db.profiles[socket.un].ls = time;
            await saveDB();
            delete sessions[socket.un];
        }
    });
});

http.listen(3000, '0.0.0.0', () => console.log('Celestra запущен на порту 3000'));
